/* ============================================================
   EIKON — Bookings (modules.bookings.js)
   The new appointment screen, on the /bookings routes:
   - the day at a glance, next bookings first
   - book in three steps: what, when (the next free times), who
   - Arrived, Done, No-show, Cancel (with a reason) on each booking
   - if someone else takes a time first, say so and offer the next ones
   Hidden until switched on: ?bookings=1 (remembered on this browser), ?bookings=0 to hide.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // ---------- switch ----------
  try {
    var qv = new URL(location.href).searchParams.get("bookings");
    if (qv === "1") localStorage.setItem("eikon_bookings", "1");
    if (qv === "0") localStorage.removeItem("eikon_bookings");
  } catch (e) {}
  var ENABLED = false;
  try { ENABLED = localStorage.getItem("eikon_bookings") === "1"; } catch (e) {}
  E.bookingsOn = function () { return ENABLED && !!(E.isUi2 && E.isUi2()); };
  if (ENABLED && Array.isArray(E.UI2_RAIL) && !E.UI2_RAIL.some(function (x) { return x.id === "bookings"; })) {
    var at = E.UI2_RAIL.findIndex(function (x) { return x.id === "customers"; });
    E.UI2_RAIL.splice(at >= 0 ? at + 1 : 1, 0, { id: "bookings", title: "Bookings" });
    if (Array.isArray(E.UI2_DESTINATIONS)) E.UI2_DESTINATIONS.push("bookings");
  }

  var S = { mount: null, view: "day", date: null, setup: null, bookings: [], loading: false, error: "", sheet: null, onVis: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); }
  function todayStr() { return ymd(new Date()); }
  function nowHM() { var d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function longDate(s) { return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); }
  function dayShort(s) { var t = todayStr(); if (s === t) return "today"; if (s === addDays(t, 1)) return "tomorrow"; return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" }); }
  function weekLabel() {
    var a = new Date(S.date + "T12:00:00"), b = new Date(addDays(S.date, 6) + "T12:00:00");
    var m = function (d) { return d.toLocaleDateString("en-GB", { month: "long" }); };
    return a.getDate() + (m(a) === m(b) ? "" : " " + m(a)) + " – " + b.getDate() + " " + m(b);
  }
  function money(c) { c = Number(c) || 0; return c === 0 ? "free" : "€" + (c / 100).toFixed(c % 100 ? 2 : 0); }
  function initials(n) { var p = String(n || "").trim().split(/\s+/); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
  var COLORS = ["#0A8F6A", "#5856D6", "#C9772E", "#1A9FB5", "#B4566A", "#6E8B3D"];
  function svcColor(svc) { return (svc && svc.color) || COLORS[((svc && svc.id) || 0) % COLORS.length]; }
  function svc(id) { return ((S.setup && S.setup.services) || []).find(function (x) { return x.id === id; }); }
  function plabel(p) { return [p.title, p.name].filter(Boolean).join(" "); }
  function prov(id) { return ((S.setup && S.setup.providers) || []).find(function (x) { return x.id === id; }); }
  function isAdmin() { return !!(E.state && E.state.user && E.state.user.role === "admin"); }
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
  function api(path, opts) { return E.apiFetch(path, opts || { method: "GET" }); }
  function toast(msg, kind) { try { (E.toast || E.showToast)(msg, kind || "success"); } catch (e) {} }
  function errMsg(e) { return (e && (e.bodyJson && e.bodyJson.error || e.message)) || "Something went wrong"; }

  var CSS = "\
.bkx{--t:#077A5B;--ts:rgba(10,143,106,.11);--bg:#F2F2F7;--sf:#fff;--l2:#6A6A70;--l3:rgba(60,60,67,.42);--sep:rgba(60,60,67,.15);--fill:rgba(118,118,128,.12);--red:#C4221A;\
font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,sans-serif;color:#000;background:var(--bg);min-height:100%;padding:24px 28px 80px;-webkit-font-smoothing:antialiased}\
.bkx *{box-sizing:border-box}:where(.bkx) button{font:inherit;border:0;cursor:pointer;background:none;color:inherit}\
.bkx-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;max-width:880px}\
.bkx h1{font-size:34px;line-height:41px;font-weight:700;letter-spacing:-.022em;margin:0}.bkx .sub{font-size:15px;color:var(--l2)}\
.bkx-add{height:40px;padding:0 18px;border-radius:20px;background:var(--t);color:#fff!important;font-size:15px;font-weight:600}\
.bkx-days{display:flex;gap:6px;margin-bottom:22px;max-width:880px}\
.bkx-day{flex:1;height:60px;border-radius:16px;background:var(--sf);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}\
.bkx-day small{font-size:11px;font-weight:600;color:var(--l2);text-transform:uppercase;letter-spacing:.03em}.bkx-day b{font-size:19px;font-weight:600}\
.bkx-day.on{background:var(--t);color:#fff}.bkx-day.on small{color:inherit}\
.bkx-sec{max-width:880px;margin-bottom:26px}.bkx-sec h2{font-size:20px;font-weight:700;letter-spacing:-.012em;margin:0 4px 8px}\
.bkx-g{background:var(--sf);border-radius:22px;overflow:hidden}\
.bkx-r{display:flex;align-items:center;gap:14px;min-height:62px;padding:12px 16px;position:relative;width:100%;text-align:left}\
.bkx-r+.bkx-r::before{content:'';position:absolute;top:0;left:84px;right:0;height:.5px;background:var(--sep)}\
.bkx-time{width:52px;flex:none;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}.bkx-time small{display:block;font-size:12px;font-weight:500;color:var(--l2)}\
.bkx-bar{width:4px;align-self:stretch;border-radius:2px;flex:none}.bkx-txt{flex:1;min-width:0}\
.bkx-txt b{display:block;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bkx-txt span{font-size:13px;color:var(--l2)}\
.bkx-st{font-size:13px;font-weight:600;flex:none}.bkx-past{opacity:.55}\
.bkx-empty{padding:22px 18px;color:var(--l2);font-size:15px}\
.bkx-btn{height:34px;padding:0 15px;border-radius:17px;font-size:15px;font-weight:600;background:var(--fill)}\
.bkx-btn.fill{background:var(--t);color:#fff}.bkx-btn.tint{background:var(--ts);color:var(--t)}.bkx-btn.red{background:rgba(255,59,48,.10);color:var(--red)}\
.bkx-btn.lg{height:50px;border-radius:25px;width:100%;font-size:17px}\
.bkx-scrim{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:900}\
.bkx-sheet{position:fixed;z-index:901;left:50%;bottom:0;transform:translateX(-50%);width:min(560px,100%);max-height:92vh;overflow:auto;background:var(--bg);border-radius:28px 28px 0 0;padding:10px 18px 28px;box-shadow:0 -10px 40px rgba(0,0,0,.18)}\
@media(min-width:900px){.bkx-sheet{bottom:auto;top:50%;transform:translate(-50%,-50%);border-radius:28px}}\
.bkx-grab{width:38px;height:5px;border-radius:3px;background:var(--fill);margin:2px auto 10px}\
.bkx-sh{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.bkx-sh b{font-size:20px;font-weight:700}\
.bkx-lab{font-size:13px;font-weight:600;color:var(--l2);text-transform:uppercase;letter-spacing:.04em;margin:0 4px 8px;display:flex;justify-content:space-between}\
.bkx-svcs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px}\
.bkx-svc{background:var(--sf);border-radius:16px;padding:12px 14px;border:2px solid transparent;text-align:left}.bkx-svc b{display:block;font-size:15px;font-weight:600}.bkx-svc span{font-size:13px;color:var(--l2)}\
.bkx-svc.on{border-color:var(--t)}\
.bkx-slots{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;min-height:40px}\
.bkx-slot{height:40px;padding:0 14px;border-radius:12px;background:var(--sf);font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}.bkx-slot small{font-size:12px;font-weight:500;color:var(--l2);margin-left:5px}\
.bkx-slot.on{background:var(--t);color:#fff}.bkx-slot.on small{color:inherit}\
.bkx-f{background:var(--sf);border-radius:16px;overflow:hidden;margin-bottom:16px}\
.bkx-f label{display:flex;align-items:center;min-height:50px;padding:0 16px;gap:12px;position:relative}.bkx-f label+label::before{content:'';position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--sep)}\
.bkx-f label:focus-within{background:var(--ts)}.bkx-f label span{width:92px;font-size:17px;font-weight:500;flex:none}.bkx-f input,.bkx-f select{flex:1;min-width:0;border:0;outline:0;font:inherit;font-size:17px;background:transparent;padding:12px 0;color:inherit}\
.bkx-note{font-size:13px;color:var(--l2);text-align:center;margin-top:10px}.bkx-err{color:var(--red);font-size:15px;font-weight:600;margin:0 4px 12px}\
.bkx-acts{display:grid;gap:8px}\
.bkx-seg{display:flex;background:rgba(118,118,128,.12);border-radius:10px;padding:2px;margin-bottom:16px}.bkx-seg button{flex:1;height:32px;border-radius:8px;font-size:14px;font-weight:600;color:rgba(60,60,67,.8)}\
.bkx-seg button.on{background:#fff;color:#000;box-shadow:0 1px 3px rgba(0,0,0,.12)}\
.bkx-qr{padding:4px 16px 14px;display:flex;flex-direction:column;align-items:center;gap:10px}.bkx-qrcard{background:#fff;color:#000;border-radius:16px;padding:18px 18px 14px;text-align:center;width:260px;box-shadow:0 0 0 .5px var(--sep)}.bkx-qrcard b{display:block;font-size:18px}.bkx-qrcard span{display:block;font-size:14px;color:#555;margin:2px 0 8px}.bkx-qrcard svg{width:200px;height:200px}.bkx-qrcard small{display:block;font-size:12px;color:#555;margin-top:6px;word-break:break-all}.bkx-pre{font-style:normal;color:var(--l2);font-size:16px;margin-right:2px}.bkx-linkrow{display:flex;align-items:center;gap:10px;padding:10px 16px 12px;position:relative}.bkx-linkrow::before{content:'';position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--sep)}.bkx-linkrow a{flex:1;min-width:0;color:var(--t);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bkx-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1}.bkx-chip{height:32px;padding:0 12px;border-radius:16px;background:var(--fill);font-size:14px;font-weight:600;color:var(--l2)}.bkx-chip.on{background:var(--t);color:#fff}.bkx-win select{border:0;background:var(--fill);border-radius:8px;height:30px;font:inherit;font-size:14px;color:inherit;padding:0 6px;margin-left:6px;max-width:130px}@media(max-width:760px){.bkx-win{display:grid!important;grid-template-columns:72px minmax(0,1fr) auto minmax(0,1fr) auto auto;align-items:center;column-gap:6px;row-gap:8px;padding-top:10px!important;padding-bottom:10px!important}.bkx-win input[type=time]{width:100%!important;min-width:0}.bkx-win select{grid-column:2/-1;grid-row:2;margin-left:0;max-width:none;height:34px}.bkx-win>span:not(:first-child){display:none}}.bkx-away{margin:0 16px 14px;padding:12px;border-radius:12px;background:var(--fill)}.bkx-away label{padding:0;min-height:40px}.bkx-away label+label::before{display:none}.bkx-call{font-size:14px;margin-top:8px}.bkx-snd{display:flex;align-items:center;gap:12px;padding:12px 16px;position:relative}.bkx-snd+.bkx-snd::before{content:'';position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--sep)}.bkx-snd>i{width:9px;height:9px;border-radius:50%;flex:none}.bkx-snd .t{flex:1;min-width:0}.bkx-snd b{display:block;font-size:16px;font-weight:600}.bkx-snd b small{font-weight:400;color:var(--l2);font-size:13px}.bkx-snd span{display:block;font-size:13px;color:var(--l2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bkx-snd .a{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.bkx-mini{height:30px;padding:0 10px;border-radius:15px;background:var(--fill);font-size:13px;font-weight:600;color:var(--t)}.bkx-mini.red{color:var(--red)}.bkx-mini:disabled{opacity:.35}@media(max-width:600px){.bkx-snd{flex-wrap:wrap}.bkx-snd .a{flex-basis:100%;justify-content:flex-start;padding-left:21px}}.bkx-gear{width:40px;height:40px;padding:0;border-radius:50%;display:grid;place-items:center}.bkx-add{white-space:nowrap}.bkx-plus{display:none}\
@media(max-width:600px){.bkx-add{width:40px;padding:0;display:grid;place-items:center}.bkx-add-l{display:none}.bkx-plus{display:block;font-size:26px;font-weight:400;line-height:1;margin-top:-2px}.bkx-top{align-items:flex-start}}\
.bkx-f input[type=time]{width:128px;flex:0 0 auto}\
.bkx-f input[type=checkbox]{appearance:none;-webkit-appearance:none;width:51px!important;height:31px!important;border-radius:16px;background:rgba(120,120,128,.16);position:relative;flex:0 0 auto;cursor:pointer;transition:background .2s;margin:0}\
.bkx-f input[type=checkbox]::after{content:'';position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 3px 8px rgba(0,0,0,.15),0 1px 1px rgba(0,0,0,.16);transition:transform .2s}\
.bkx-f input[type=checkbox]:checked{background:#34C759}.bkx-f input[type=checkbox]:checked::after{transform:translateX(20px)}\
@media(max-width:760px){.bkx-closed{display:none}.bkx-f input[type=time]{width:auto;flex:1 1 0!important;min-width:0}.bkx-f input[type=time]::-webkit-calendar-picker-indicator{display:none}.bkx-f label{gap:8px}.bkx-f label>span:first-child{flex:0 0 76px}}\
.bkx-view{max-width:220px;margin:0 0 14px}\
.bkx-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;max-width:1180px}\
.bkx-wcol{background:var(--sf);border-radius:18px;padding:8px;min-height:220px;display:flex;flex-direction:column;gap:6px}\
.bkx-wh{display:flex;flex-direction:column;align-items:center;padding:6px 0 8px;border-radius:12px}.bkx-wh small{font-size:11px;font-weight:600;color:var(--l2);text-transform:uppercase}\
.bkx-wh b{font-size:20px;font-weight:600}.bkx-wh span{font-size:12px;color:var(--l2)}.bkx-wh.now b{color:var(--t)}\
.bkx-wb{display:block;width:100%;text-align:left;border-left:3px solid;border-radius:8px;background:var(--bg);padding:6px 8px;font-size:13px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.bkx-wb b{font-variant-numeric:tabular-nums}.bkx-wb span{display:block;font-size:12px;color:var(--l2);overflow:hidden;text-overflow:ellipsis}\
@media(max-width:760px){.bkx-week{grid-template-columns:1fr}.bkx-wcol{min-height:0;flex-direction:column}.bkx-wh{flex-direction:row;gap:8px;justify-content:flex-start;padding:4px 6px}.bkx-wh span{margin-left:auto}}\
.bkx-ok{color:var(--t);font-size:15px;font-weight:600;margin:0 4px 12px}.bkx-closed{font-style:normal;font-size:13px;color:var(--l3);margin-left:auto}\
";
  function injectCss() { if (document.getElementById("bkx-css")) return; var st = document.createElement("style"); st.id = "bkx-css"; st.textContent = CSS; document.head.appendChild(st); }

  // ---------- data ----------
  async function load(opts) {
    opts = opts || {};
    S.loading = true; S.error = "";
    if (!opts.silent) paint();
    try {
      if (!S.setup || opts.setup) { var su = await api("/bookings/setup"); S.setup = { services: su.services || [], providers: su.providers || [] }; }
      var to = S.view === "week" ? addDays(S.date, 6) : S.date; // the week is one call too
      var r = await api("/bookings?from=" + S.date + "&to=" + to);
      S.bookings = r.bookings || [];
      try { S.waiting = (await api("/bookings/waitlist")).waiting || []; } catch (e) { S.waiting = []; }
    } catch (e) {
      S.error = e && e.status === 404 ? "Bookings is not switched on for this pharmacy yet." : errMsg(e);
    }
    S.loading = false; paint();
    // Arrived from a customer's "Booking" button: open a new booking with their details filled in.
    var carry = null; try { carry = JSON.parse(sessionStorage.getItem("eikon_bk_carry") || "null"); sessionStorage.removeItem("eikon_bk_carry"); } catch (e) {}
    if (carry && S.setup && !S.error) {
      var first = S.setup.services.filter(function (x) { return x.active; })[0];
      if (first) { S.sheet = { kind: "new", serviceId: first.id, slots: [], slot: null, name: carry.name, phone: carry.phone, email: carry.email }; paint(); return loadSlots(); }
    }
  }

  // ---------- paint ----------
  var STATE_LABEL = { arrived: ["Here", "var(--t)"], done: ["Done", "var(--l3)"], no_show: ["No-show", "var(--red)"], confirmed: ["Confirmed", "var(--l2)"], cancelled: ["Cancelled", "var(--l3)"] };
  function rowHtml(b, past) {
    var s = svc(b.serviceId) || {}, p = prov(b.providerId) || {}, st = STATE_LABEL[b.status];
    return '<button class="bkx-r' + (past ? " bkx-past" : "") + '" data-act="open" data-id="' + b.id + '">' +
      '<div class="bkx-time">' + esc(b.start) + "<small>" + esc(b.end) + "</small></div>" +
      '<div class="bkx-bar" style="background:' + svcColor(s) + '"></div>' +
      '<div class="bkx-txt"><b>' + esc(b.personName) + "</b><span>" + esc(s.name || "Booking") + (p.name ? " · " + esc(plabel(p)) : "") + (b.roomName ? " · " + esc(b.roomName) : "") + "</span></div>" +
      (st ? '<span class="bkx-st" style="color:' + st[1] + '">' + st[0] + "</span>" : "") + "</button>";
  }
  function daysHtml() {
    var t = todayStr(), h = "";
    for (var i = 0; i < 7; i++) {
      var d = addDays(t, i), dt = new Date(d + "T12:00:00");
      h += '<button class="bkx-day' + (d === S.date ? " on" : "") + '" data-act="day" data-d="' + d + '"><small>' + dt.toLocaleDateString("en-GB", { weekday: "short" }) + "</small><b>" + dt.getDate() + "</b></button>";
    }
    return '<div class="bkx-days">' + h + "</div>";
  }
  // Seven days from the chosen date, one column each (stacked on a phone); tap a day to open it.
  function weekHtml(list) {
    var h = '<div class="bkx-week">';
    for (var i = 0; i < 7; i++) {
      var d = addDays(S.date, i), dt = new Date(d + "T12:00:00");
      var dayList = list.filter(function (b) { return b.date === d; });
      h += '<div class="bkx-wcol"><button class="bkx-wh' + (d === todayStr() ? " now" : "") + '" data-act="openday" data-d="' + d + '"><small>' +
        dt.toLocaleDateString("en-GB", { weekday: "short" }) + "</small><b>" + dt.getDate() + "</b><span>" + (dayList.length ? dayList.length + " booked" : "Free") + "</span></button>" +
        dayList.map(function (b) {
          var sv = svc(b.serviceId) || {};
          return '<button class="bkx-wb" data-act="open" data-id="' + b.id + '" style="border-left-color:' + svcColor(sv) + '"><b>' + esc(b.start) + "</b> " + esc(b.personName) + "<span>" + esc(sv.name || "") + "</span></button>";
        }).join("") + "</div>";
    }
    return h + "</div>";
  }

  function setupHtml() {
    return '<div class="bkx-sec"><div class="bkx-g" style="padding:20px 18px;max-width:560px">' +
      '<div style="font-size:20px;font-weight:700;margin-bottom:4px">Set up bookings</div>' +
      '<div class="sub" style="margin-bottom:16px">One service and who does it. You can add more later.</div>' +
      '<div class="bkx-f"><label><span>Service</span><input id="bkx-s-name" placeholder="Flu vaccine" value="Flu vaccine"></label>' +
      '<label><span>Minutes</span><input id="bkx-s-dur" type="number" min="5" max="480" value="10"></label>' +
      '<label><span>Price €</span><input id="bkx-s-price" type="number" min="0" step="0.5" value="0"></label></div>' +
      '<div class="bkx-f"><label><span>Who</span><input id="bkx-p-name" placeholder="Your name" value="' + esc((E.state && E.state.user && E.state.user.full_name) || "") + '"></label>' +
      '<label><span>Hours</span><input id="bkx-p-from" type="time" value="09:00" style="flex:0 0 auto"> to <input id="bkx-p-to" type="time" value="13:00" style="flex:0 0 auto"></label>' +
      '<label><span>Days</span><select id="bkx-p-days"><option value="12345">Monday to Friday</option><option value="123456">Monday to Saturday</option><option value="0123456">Every day</option></select></label></div>' +
      (S.sheetErr ? '<div class="bkx-err">' + esc(S.sheetErr) + "</div>" : "") +
      '<button class="bkx-btn fill lg" data-act="setup">Start taking bookings</button></div></div>';
  }
  function paint() {
    if (!S.mount) return;
    if (E.state.activeModuleId !== "bookings") return; // left before a reply came back: do not draw over the next screen
    var isToday = S.date === todayStr(), now = nowHM();
    // With several practitioners (or rooms), the day can be narrowed to one; the choice is kept while you move between days.
    var provsAll = (S.setup && S.setup.providers || []).filter(function (p) { return p.active !== false; });
    var roomsSeen = {}; S.bookings.forEach(function (b) { if (b.roomName) roomsSeen[b.roomName] = 1; });
    var fl = S.filter || "";
    var list = S.bookings.filter(function (b) { return b.status !== "cancelled" && (!fl || (fl.charAt(0) === "p" ? String(b.providerId) === fl.slice(2) : b.roomName === fl.slice(2))); });
    var up = list.filter(function (b) { return !isToday || b.end > now; });
    var past = list.filter(function (b) { return isToday && b.end <= now; });
    var hasSetup = S.setup && S.setup.services.length;
    var body = "";
    if (S.error) body = '<div class="bkx-sec"><div class="bkx-g"><div class="bkx-empty">' + esc(S.error) + "</div></div></div>";
    else if (S.setup && !hasSetup) body = setupHtml();
    else if (!S.setup) body = '<div class="bkx-sec"><div class="bkx-g"><div class="bkx-empty">Loading…</div></div></div>';
    else if (S.view === "week") body = weekHtml(list);
    else {
      var opts = provsAll.length > 1 || Object.keys(roomsSeen).length > 1 ? [["", "Everyone"]].concat(provsAll.length > 1 ? provsAll.map(function (p) { return ["p:" + p.id, plabel(p)]; }) : []).concat(Object.keys(roomsSeen).length > 1 ? Object.keys(roomsSeen).sort().map(function (r) { return ["r:" + r, r]; }) : []) : [];
      body = (opts.length ? '<div class="bkx-chips" style="margin:0 0 14px">' + opts.map(function (o) { return '<button class="bkx-chip' + (fl === o[0] ? " on" : "") + '" data-act="filter" data-f="' + esc(o[0]) + '" aria-pressed="' + (fl === o[0]) + '">' + esc(o[1]) + "</button>"; }).join("") + "</div>" : "") +
        '<div class="bkx-sec"><h2>' + (isToday ? "Next" : "Booked") + "</h2><div class=\"bkx-g\">" +
        (up.length ? up.map(function (b) { return rowHtml(b, false); }).join("") : '<div class="bkx-empty">' + (isToday ? "Nothing else booked today." : "Nothing booked on this day.") + "</div>") + "</div></div>";
      if ((S.waiting || []).length) body += '<div class="bkx-sec"><h2>Waiting</h2><div class="bkx-g">' + S.waiting.map(function (w) {
        var sv = svc(w.serviceId) || {}, days = Math.max(0, Math.round((Date.now() - Date.parse(String(w.createdAt).replace(" ", "T") + "Z")) / 86400000));
        return '<div class="bkx-r"><div class="bkx-time" style="color:var(--l2)">' + (days ? days + "d" : "new") + '</div><div class="bkx-bar" style="background:' + svcColor(sv) + '"></div>' +
          '<div class="bkx-txt"><b>' + esc(w.personName) + "</b><span>" + esc(sv.name || "") + (w.note ? " · " + esc(w.note) : "") + "</span></div>" +
          '<button class="bkx-btn tint" data-act="wl-book" data-id="' + w.id + '">Book</button><button class="bkx-btn" data-act="wl-remove" data-id="' + w.id + '" aria-label="Remove">✕</button></div>';
      }).join("") + "</div></div>";
      if (past.length) body += '<div class="bkx-sec"><h2>Earlier</h2><div class="bkx-g">' + past.map(function (b) { return rowHtml(b, true); }).join("") + "</div></div>";
    }
    S.mount.innerHTML = '<div class="bkx">' +
      '<div class="bkx-top"><div><h1>Bookings</h1><div class="sub">' + esc(S.view === "week" ? weekLabel() : longDate(S.date)) + (hasSetup ? " · " + list.length + " booked" : "") + "</div></div>" +
      (hasSetup ? '<div style="display:flex;gap:8px">' + (isAdmin() ? '<button class="bkx-btn bkx-gear" data-act="settings" aria-label="Bookings settings" title="Settings"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg></button>' : "") + '<button class="bkx-add" data-act="new" aria-label="New booking"><span class="bkx-plus" aria-hidden="true">+</span><span class="bkx-add-l">New booking</span></button></div>' : "") + "</div>" +
      (hasSetup ? '<div class="bkx-seg bkx-view"><button class="' + (S.view === "day" ? "on" : "") + '" data-act="view" data-v="day">Day</button><button class="' + (S.view === "week" ? "on" : "") + '" data-act="view" data-v="week">Week</button></div>' : "") +
      (hasSetup && S.view === "day" ? daysHtml() : "") + body + "</div>" + sheetHtml();
  }

  // ---------- sheets ----------
  function sheetHtml() {
    var sh = S.sheet; if (!sh) return "";
    var inner = "";
    if (sh.kind === "new") {
      var services = S.setup.services.filter(function (x) { return x.active; });
      var chosen = svc(sh.serviceId);
      inner = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Cancel</button><b>New booking</b><span style="width:70px"></span></div>' +
        '<div class="bkx-lab">What</div><div class="bkx-svcs">' + services.map(function (x) {
          return '<button class="bkx-svc' + (x.id === sh.serviceId ? " on" : "") + '" data-act="svc" data-id="' + x.id + '"><b>' + esc(x.name) + "</b><span>" + x.durationMin + " min · " + money(x.priceCents) + "</span></button>"; }).join("") + "</div>" +
        '<div class="bkx-lab">When' + (sh.slot ? "<b style=\"color:var(--t);text-transform:none;letter-spacing:0\">" + esc((prov(sh.slot.providerId) || {}).name || "") + "</b>" : "") + "</div>" +
        '<div class="bkx-slots">' + (sh.slotsLoading ? '<span class="sub">Finding free times…</span>' : (sh.slots || []).length ? sh.slots.map(function (x, i) {
          var on = sh.slot && sh.slot.date === x.date && sh.slot.time === x.time && sh.slot.providerId === x.providerId;
          return '<button class="bkx-slot' + (on ? " on" : "") + '" data-act="slot" data-i="' + i + '">' + esc(x.time) + "<small>" + esc(dayShort(x.date)) + "</small></button>"; }).join("") : '<span class="sub">No free times in the next three weeks.</span>') + "</div>" +
        '<div class="bkx-lab">Who</div><div class="bkx-f">' +
        '<label><span>Name</span><input id="bkx-name" autocomplete="off" value="' + esc(sh.name || "") + '" placeholder="Full name"></label>' +
        '<label><span>Mobile</span><input id="bkx-phone" inputmode="tel" value="' + esc(sh.phone || "") + '" placeholder="Optional"></label>' +
        '<label><span>Email</span><input id="bkx-email" inputmode="email" value="' + esc(sh.email || "") + '" placeholder="Optional"></label></div>' +
        (sh.err ? '<div class="bkx-err">' + esc(sh.err) + "</div>" : "") +
        '<button class="bkx-btn fill lg" data-act="book"' + (sh.saving ? " disabled" : "") + ">" + (sh.saving ? "Booking…" : "Book " + esc(chosen ? chosen.name.toLowerCase() : "") + (sh.slot ? " · " + esc(dayShort(sh.slot.date)) + " " + esc(sh.slot.time) : "")) + "</button>" +
        (sh.waitlistId ? "" : '<button class="bkx-btn lg" data-act="wl-add" style="margin-top:8px">No time suits? Add to the waiting list</button>');
    }
    if (sh.kind === "booking") {
      var b = S.bookings.find(function (x) { return x.id === sh.id; }); if (!b) return "";
      var s = svc(b.serviceId) || {};
      inner = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Close</button><b>' + esc(b.start) + " · " + esc(s.name || "") + '</b><span style="width:60px"></span></div>' +
        '<div class="bkx-g" style="padding:16px 18px;margin-bottom:16px"><div style="font-size:20px;font-weight:700">' + esc(b.personName) + '</div><div class="sub">' +
        [b.personPhone, b.personEmail].filter(Boolean).map(esc).join(" · ") + (b.notes ? "<br>" + esc(b.notes) : "") + '</div><div class="sub" style="margin-top:6px">Ref ' + esc(b.ref) + " · " + money(b.priceCents) + "</div></div>" +
        (sh.cancelling
          ? '<div class="bkx-f"><label><span>Reason</span><input id="bkx-reason" placeholder="e.g. Called to cancel" value=""></label></div>' + (sh.err ? '<div class="bkx-err">' + esc(sh.err) + "</div>" : "") +
            '<div class="bkx-acts"><button class="bkx-btn red lg" data-act="docancel">Cancel this booking</button><button class="bkx-btn lg" data-act="nocancel">Keep it</button></div>'
          : (sh.err ? '<div class="bkx-err">' + esc(sh.err) + "</div>" : "") + '<div class="bkx-acts">' +
            (b.status !== "arrived" && b.status !== "done" ? '<button class="bkx-btn fill lg" data-act="st" data-s="arrived">Arrived</button>' : "") +
            (b.status !== "done" ? '<button class="bkx-btn tint lg" data-act="st" data-s="done">Done</button>' : "") +
            (b.status === "booked" || b.status === "confirmed" ? '<button class="bkx-btn lg" data-act="st" data-s="no_show">No-show</button>' : "") +
            '<button class="bkx-btn red lg" data-act="cancel">Cancel booking</button></div>');
    }
    if (sh.kind === "settings") inner = settingsHtml(sh);
    if (sh.kind === "offer") {
      var o = sh.offer, osv = svc(o.serviceId) || {};
      inner = '<div class="bkx-sh"><span style="width:60px"></span><b>A time just freed up</b><span style="width:60px"></span></div>' +
        '<div class="bkx-g" style="padding:18px"><div style="font-size:20px;font-weight:700">' + esc(dayShort(o.date).replace(/^./, function (c) { return c.toUpperCase(); })) + " at " + esc(o.start) + '</div><div class="sub">' +
        esc(o.personName) + " is first on the waiting list for " + esc((osv.name || "this").toLowerCase()) + (o.personPhone ? " · " + esc(o.personPhone) : "") + "</div></div>" +
        (sh.err ? '<div class="bkx-err" style="margin-top:12px">' + esc(sh.err) + "</div>" : "") +
        '<div class="bkx-acts" style="margin-top:16px"><button class="bkx-btn fill lg" data-act="offer-book">Book ' + esc(o.personName.split(" ")[0]) + " at " + esc(o.start) + '</button><button class="bkx-btn lg" data-act="close">Not now</button></div>';
    }
    return '<div class="bkx-scrim" data-act="close"></div><div class="bkx-sheet bkx" style="padding-top:10px;min-height:0"><div class="bkx-grab"></div>' + inner + "</div>";
  }

  function settingsHtml(sh) {
    var tabs = [["services", "Services"], ["hours", "People"], ["rooms", "Rooms"], ["messages", "Messages"]];
    var h = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Done</button><b>Bookings settings</b><span style="width:60px"></span></div>' +
      '<div class="bkx-seg">' + tabs.map(function (t) { return '<button class="' + (sh.tab === t[0] ? "on" : "") + '" data-act="tab" data-t="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
    if (sh.err) h += '<div class="bkx-err">' + esc(sh.err) + "</div>";
    if (sh.okMsg) h += '<div class="bkx-ok">' + esc(sh.okMsg) + "</div>";
    var provs = S.setup.providers;
    if (sh.tab === "services") {
      var list = S.setup.services.concat(sh.newService ? [{ id: 0, name: "", durationMin: 15, priceCents: 0, active: true, providerIds: provs.length ? [provs[0].id] : [] }] : []);
      h += list.map(function (x) {
        return '<div class="bkx-f" data-svc="' + x.id + '">' +
          '<label><span>Name</span><input data-k="name" value="' + esc(x.name) + '" placeholder="e.g. Blood pressure"></label>' +
          '<label><span>Minutes</span><input data-k="dur" type="number" min="5" max="480" value="' + x.durationMin + '"></label>' +
          '<label><span>Price €</span><input data-k="price" type="number" min="0" step="0.5" value="' + (x.priceCents / 100) + '"></label>' +
          '<label style="align-items:flex-start;padding-top:12px;padding-bottom:12px"><span>Who</span><div class="bkx-chips">' + provs.map(function (p) { var on = (x.providerIds || []).indexOf(p.id) >= 0; return '<button type="button" class="bkx-chip' + (on ? " on" : "") + '" data-act="chip" data-pid="' + p.id + '" aria-pressed="' + on + '">' + esc(plabel(p)) + "</button>"; }).join("") + "</div></label>" +
          '<label><span>Bookable</span><input data-k="active" type="checkbox"' + (x.active ? " checked" : "") + ' style="flex:0 0 auto;width:22px;height:22px"></label>' +
          '<label><span>Online</span><input data-k="online" type="checkbox"' + (x.online ? " checked" : "") + ' style="flex:0 0 auto;width:22px;height:22px"><em class="bkx-closed" style="margin-left:8px">Customers can book it on your page</em></label>' +
          '<div style="padding:8px 16px 14px"><button class="bkx-btn tint" data-act="svc-save" data-id="' + x.id + '">' + (x.id ? "Save" : "Add service") + "</button></div></div>";
      }).join("") + (sh.newService ? "" : '<button class="bkx-btn lg" data-act="svc-new">Add a service</button>') +
      '<div class="bkx-g" style="padding:16px 18px;margin-top:18px"><div style="font-size:17px;font-weight:600">From the old Appointments</div>' +
      '<div class="sub" style="margin:4px 0 12px">Brings doctors, clinics, hours, appointments and the waiting list into Bookings. The old screen keeps working and its records are not changed. Safe to run again.</div>' +
      (sh.importReport ? '<div class="sub" style="color:#000;margin-bottom:12px">' + esc(importText(sh.importReport)) + "</div>" : "") +
      '<div style="display:flex;gap:8px"><button class="bkx-btn" data-act="imp-check">Check</button>' + (sh.importReport && sh.importReport.dry && (sh.importReport.bookings || sh.importReport.providers || sh.importReport.waiting) ? '<button class="bkx-btn fill" data-act="imp-run">Import</button>' : "") + "</div></div>";
    }
    if (sh.tab === "hours") {
      // People: who gives the services, their title and speciality, their weekly hours (any number of windows a day,
      // each optionally in a room), and "Mark away" to close time and tell the customers.
      var rooms = (sh.rooms || []).filter(function (r) { return r.active; });
      h += '<div class="sub" style="margin:0 4px 12px">Everyone who sees customers. A day can have more than one window, each in a room if you use rooms.</div>';
      h += provs.map(function (p) {
        var dr = (sh.pdraft && sh.pdraft[p.id]) || { title: p.title || "", name: p.name, speciality: p.speciality || "", hours: JSON.parse(JSON.stringify(p.hours || {})) };
        var c = '<div class="bkx-f" data-prov="' + p.id + '">' +
          '<label><span>Title</span><input data-k="title" value="' + esc(dr.title) + '" placeholder="Dr, Pharm., Nurse"></label>' +
          '<label><span>Name</span><input data-k="name" value="' + esc(dr.name) + '"></label>' +
          '<label><span>Speciality</span><input data-k="speciality" value="' + esc(dr.speciality) + '" placeholder="Optional, e.g. Physiotherapy"></label>';
        WD_ORDER.forEach(function (d) {
          var wins = dr.hours[d] || dr.hours[String(d)] || [];
          if (!wins.length) c += '<label><span>' + WD[d] + '</span><em class="bkx-closed" style="flex:1">Closed</em><button type="button" class="bkx-mini" data-act="win-add" data-id="' + p.id + '" data-d="' + d + '">Add hours</button></label>';
          wins.forEach(function (w, i) {
            c += '<label class="bkx-win"><span>' + (i ? "" : WD[d]) + '</span><input data-d="' + d + '" data-i="' + i + '" data-k="from" type="time" value="' + esc(w[0]) + '" style="flex:0 0 auto"> – <input data-d="' + d + '" data-i="' + i + '" data-k="to" type="time" value="' + esc(w[1]) + '" style="flex:0 0 auto">' +
              (rooms.length ? '<select data-d="' + d + '" data-i="' + i + '" data-k="room" aria-label="Room"><option value="">No room</option>' + rooms.map(function (r) { return '<option value="' + r.id + '"' + (Number(w[2]) === r.id ? " selected" : "") + ">" + esc(r.name) + "</option>"; }).join("") + "</select>" : "") +
              '<span style="flex:1"></span>' + (i === wins.length - 1 && wins.length < 3 ? '<button type="button" class="bkx-mini" data-act="win-add" data-id="' + p.id + '" data-d="' + d + '" aria-label="Add another window">+</button>' : "") +
              '<button type="button" class="bkx-mini red" data-act="win-del" data-id="' + p.id + '" data-d="' + d + '" data-i="' + i + '" aria-label="Remove these hours">×</button></label>';
          });
        });
        c += '<div style="padding:8px 16px 14px;display:flex;gap:8px;flex-wrap:wrap"><button class="bkx-btn tint" data-act="hours-save" data-id="' + p.id + '">Save</button>' +
          '<button class="bkx-btn" data-act="away-open" data-id="' + p.id + '">Mark away</button></div>';
        if (sh.away && sh.away.pid === p.id) {
          var a = sh.away;
          c += '<div class="bkx-away"><div style="font-weight:600;margin-bottom:6px">' + esc(plabel(p)) + ' is away</div>' +
            '<label><span>From</span><input id="aw-from" type="date" value="' + esc(a.from) + '"></label>' +
            '<label><span>To</span><input id="aw-to" type="date" value="' + esc(a.to || "") + '"><em class="bkx-closed" style="margin-left:6px">Leave empty for one day</em></label>' +
            '<label><span>Hours</span><input id="aw-st" type="time" value="' + esc(a.start || "") + '" style="flex:0 0 auto"> – <input id="aw-en" type="time" value="' + esc(a.end || "") + '" style="flex:0 0 auto"><em class="bkx-closed" style="margin-left:6px">Empty means all day</em></label>' +
            '<label><span>Why</span><input id="aw-why" value="' + esc(a.reason || "") + '" placeholder="Shown to customers, e.g. ' + esc(plabel(p)) + ' is unwell"></label>' +
            '<div style="display:flex;gap:8px;margin-top:8px"><button class="bkx-btn fill" data-act="away-go" data-id="' + p.id + '">Cancel those bookings and tell customers</button><button class="bkx-btn" data-act="away-close">Back</button></div>' +
            (a.result ? '<div class="bkx-call">' + esc(a.result.cancelled + " cancelled · " + a.result.emailed + " told by email") + (a.result.toCall.length ? "<br><b>Please call:</b> " + a.result.toCall.map(function (x) { return esc(x.personName + (x.personPhone ? " " + x.personPhone : "") + " (" + dayShort(x.date) + " " + x.start + ")"); }).join(", ") : "") + "</div>" : "") +
            "</div>";
        }
        return c + "</div>";
      }).join("");
      h += sh.addingPerson ? '<div class="bkx-f"><label><span>Title</span><input id="np-title" placeholder="Dr, Pharm., Nurse"></label><label><span>Name</span><input id="np-name" placeholder="Name and surname"></label><label><span>Speciality</span><input id="np-spec" placeholder="Optional"></label>' +
        '<div style="padding:8px 16px 14px;display:flex;gap:8px"><button class="bkx-btn fill" data-act="np-save">Add</button><button class="bkx-btn" data-act="np-cancel">Cancel</button></div></div>'
        : '<button class="bkx-btn lg" data-act="np-new">Add a practitioner</button>';
    }
    if (sh.tab === "rooms") {
      var rs = sh.rooms || [];
      h += '<div class="sub" style="margin:0 4px 12px">Clinic rooms, if you use them. Choose a room for each practitioner’s hours under People; two people can’t have the same room at the same time.</div>' +
        '<div class="bkx-f">' + (rs.length ? rs.map(function (r) { return '<label data-room="' + r.id + '"><span>Room</span><input data-k="rname" value="' + esc(r.name) + '"><button type="button" class="bkx-mini" data-act="room-save" data-id="' + r.id + '">Save</button></label>'; }).join("") : '<label><em class="bkx-closed">No rooms yet</em></label>') +
        '<label><span>New</span><input id="room-new" placeholder="e.g. Room 1, Physio room"><button type="button" class="bkx-mini" data-act="room-add">Add</button></label></div>';
    }
    if (sh.tab === "messages") {
      var m = sh.msg;
      if (!m) h += '<div class="bkx-g"><div class="bkx-empty">Loading…</div></div>';
      else {
        var on = m.provider !== "off", snds = sh.senders || [];
        var sLabel = { ready: "Ready", resting: "Resting after an error", limit: "Free limit reached", off: "Switched off", nokey: "Needs its key" };
        var dot = { ready: "var(--t)", resting: "#C9772E", limit: "#C9772E", off: "var(--l3)", nokey: "var(--red)" };
        h += '<div class="sub" style="margin:0 4px 12px">A confirmation with a calendar file, a reminder the evening before and a private link to see or cancel. Emails go through your senders in order: if one fails or reaches its free limit, the next one sends.</div>' +
          '<div class="bkx-f"><label><span>Emails</span><input id="bkm-on" type="checkbox"' + (on ? " checked" : "") + '><em class="bkx-closed" style="margin-left:8px">' + (on ? "On" : "Off") + "</em></label>" +
          '<label><span>From</span><input id="bkm-from" inputmode="email" value="' + esc(m.fromEmail) + '" placeholder="bookings@yourpharmacy.mt"></label>' +
          '<label><span>Name</span><input id="bkm-name" value="' + esc(m.fromName) + '" placeholder="Your pharmacy"></label></div>';
        h += '<h2 style="font-size:13px;font-weight:600;color:var(--l2);text-transform:uppercase;letter-spacing:.04em;margin:18px 4px 6px">Senders</h2><div class="bkx-g">';
        if (!snds.length) h += '<div class="bkx-empty" style="text-align:left;padding:14px 16px">No sender yet. Brevo sends 300 emails a day for free and Resend 100; add both and Eikon uses the second when the first is busy or used up.</div>';
        snds.forEach(function (x, i) {
          var use = x.dailyCap ? x.usedToday + " of " + x.dailyCap + " today" : x.usedToday + " today";
          var why = x.status === "ready" ? use : x.status === "limit" ? "back " + (x.restingUntil && x.restingUntil.slice(0, 10) > todayStr() ? "tomorrow" : "soon") : x.status === "resting" ? String(x.lastError || "").slice(0, 70) : "";
          h += '<div class="bkx-snd"><i style="background:' + dot[x.status] + '"></i><div class="t"><b>' + (i + 1) + ". " + esc(x.label) + (x.fromEmail ? ' <small>· ' + esc(x.fromEmail) + "</small>" : "") + "</b><span>" + esc(sLabel[x.status] || x.status) + (why ? " · " + esc(why) : "") + "</span></div>" +
            '<div class="a"><button class="bkx-mini" data-act="snd-move" data-id="' + x.id + '" data-d="-1" aria-label="Move up"' + (i === 0 ? " disabled" : "") + '>↑</button><button class="bkx-mini" data-act="snd-move" data-id="' + x.id + '" data-d="1" aria-label="Move down"' + (i === snds.length - 1 ? " disabled" : "") + '>↓</button>' +
            '<button class="bkx-mini" data-act="snd-test" data-id="' + x.id + '">Test</button><button class="bkx-mini" data-act="snd-toggle" data-id="' + x.id + '">' + (x.enabled ? "Switch off" : "Switch on") + '</button><button class="bkx-mini red" data-act="snd-remove" data-id="' + x.id + '">Remove</button></div></div>';
        });
        h += "</div>";
        var ad = sh.adding;
        if (!ad) h += '<div class="bkx-acts" style="margin-top:8px"><button class="bkx-btn" data-act="snd-add">Add a sender</button></div>';
        else {
          var kinds = [["brevo", "Brevo"], ["resend", "Resend"], ["smtp", "Own mail server"]], dflt = { brevo: 290, resend: 95, smtp: 0 };
          h += '<div class="bkx-seg" style="margin-top:12px">' + kinds.map(function (k) { return '<button class="' + (ad.kind === k[0] ? "on" : "") + '" data-act="snd-kind" data-k="' + k[0] + '">' + k[1] + "</button>"; }).join("") + "</div>" +
            '<div class="sub" style="margin:0 4px 10px">' + (ad.kind === "brevo" ? "Free for 300 emails a day. Create a key in Brevo under SMTP &amp; API, and verify your sender address there." : ad.kind === "resend" ? "Free for 100 emails a day and 3,000 a month. Create a key in Resend and verify your domain there." : "Your own email account, e.g. the pharmacy's mailbox. Ask your provider for the server name.") + "</div>" +
            '<div class="bkx-f">' + (ad.kind === "smtp" ? '<label><span>Server</span><input id="bks-host" placeholder="smtp.yourprovider.com" autocapitalize="off"></label>' +
              '<label><span>Security</span><select id="bks-sec"><option value="tls">SSL · port 465</option><option value="starttls">STARTTLS · port 587</option></select></label>' +
              '<label><span>Username</span><input id="bks-user" autocapitalize="off" autocomplete="off"></label><label><span>Password</span><input id="bks-key" type="password" autocomplete="new-password"></label>'
              : '<label><span>API key</span><input id="bks-key" type="password" autocomplete="off" placeholder="Paste the key"></label>') +
            '<label><span>From</span><input id="bks-from" inputmode="email" placeholder="' + esc(m.fromEmail || "Same as above") + '"></label>' +
            '<label><span>Daily limit</span><input id="bks-cap" inputmode="numeric" value="' + dflt[ad.kind] + '"><em class="bkx-closed" style="margin-left:6px">0 means no limit</em></label></div>' +
            '<div class="bkx-acts"><button class="bkx-btn fill" data-act="snd-save">Add sender</button><button class="bkx-btn" data-act="snd-cancel">Cancel</button></div>';
        }
        h += '<div class="bkx-f" style="margin-top:18px">' +
          '<label><span>Evening</span><input id="bkm-eve" type="checkbox"' + (m.remindEvening ? " checked" : "") + ' style="flex:0 0 auto;width:22px;height:22px"><em class="bkx-closed" style="margin-left:6px">Reminder at 18:00 the day before</em></label>' +
          '<label><span>Also</span><select id="bkm-hrs">' + [0, 1, 2, 3, 4].map(function (n) { return '<option value="' + n + '"' + (m.remindHours === n ? " selected" : "") + ">" + (n ? n + " hour" + (n > 1 ? "s" : "") + " before" : "No second reminder") + "</option>"; }).join("") + "</select></label>" +
          '<label><span>Cancel</span><select id="bkm-cut">' + [[0, "Any time online"], [60, "Up to 1 hour before"], [120, "Up to 2 hours before"], [1440, "Up to the day before"]].map(function (o) { return '<option value="' + o[0] + '"' + (m.cancelCutoffMin === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
          '<label><span>Address</span><input id="bkm-addr" value="' + esc(m.address) + '"></label><label><span>Phone</span><input id="bkm-phone" inputmode="tel" value="' + esc(m.phone) + '"></label></div>' +
          '<div class="bkx-f"><label><span>Online</span><input id="bkm-public" type="checkbox"' + (m.publicEnabled ? " checked" : "") + ' style="flex:0 0 auto;width:22px;height:22px"><em class="bkx-closed" style="margin-left:8px">A booking page for your customers</em></label>' +
          (m.publicEnabled && m.publicSlug ? '<label><span>Address</span><em class="bkx-pre">/book/</em><input id="bkm-slug" value="' + esc(m.publicSlug) + '" autocapitalize="off" autocomplete="off" spellcheck="false"></label>' +
            '<div class="bkx-linkrow"><a href="' + esc(location.origin + "/book/" + m.publicSlug) + '" target="_blank" rel="noopener">' + esc(location.origin.replace(/^https?:\/\//, "") + "/book/" + m.publicSlug) + '</a><button class="bkx-mini" data-act="copy-link">Copy link</button><button class="bkx-mini" data-act="qr">QR code</button></div>' +
            (sh.qrSvg ? '<div class="bkx-qr"><div class="bkx-qrcard" id="bkx-qrcard"><b>' + esc((E.state.user || {}).location_name || "") + "</b><span>Scan to book</span>" + sh.qrSvg + "<small>" + esc(location.origin.replace(/^https?:\/\//, "") + "/book/" + m.publicSlug) + '</small></div><button class="bkx-btn" data-act="qr-print">Print</button></div>' : "") : "") + "</div>" +
          (m.canSend ? "" : '<div class="bkx-err">The server needs its BOOKINGS_KEY secret before emails can be switched on.</div>') +
          '<div class="bkx-acts"><button class="bkx-btn fill lg" data-act="msg-save">Save</button><button class="bkx-btn lg" data-act="msg-test">Send me a test</button></div>';
      }
    }
    return h;
  }

  function importText(r) {
    var pl = function (n, one, many) { return n + " " + (n === 1 ? one : many); };
    var parts = [];
    if (r.providers) parts.push(pl(r.providers, "person", "people"));
    if (r.services) parts.push(pl(r.services, "service", "services"));
    if (r.bookings) parts.push(pl(r.bookings, "appointment", "appointments"));
    if (r.waiting) parts.push(pl(r.waiting, "person waiting", "people waiting"));
    if (r.extras) parts.push(pl(r.extras, "extra session", "extra sessions"));
    if (parts.length > 1) parts = [parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]];
    var head = r.dry ? "Would bring over: " : "Brought over: ";
    var tail = (r.clashes ? " · " + r.clashes + " clashing double-bookings kept as cancelled" : "") + (r.skipped ? " · " + pl(r.skipped, "appointment", "appointments") + " already here" : "");
    return (r.dry && !r.bookings && !r.providers && !r.waiting ? "Nothing new to bring over" + tail : head + parts.join(", ") + tail) + ".";
  }

  async function openSettings(tab) {
    S.sheet = { kind: "settings", tab: tab || "services" }; paint();
    if (S.sheet.tab === "hours" || S.sheet.tab === "rooms") { try { S.sheet.rooms = (await api("/bookings/rooms")).rooms; } catch (e) { S.sheet.rooms = []; } paint(); }
    if (S.sheet.tab === "messages") {
      try { S.sheet.msg = (await api("/bookings/settings")).settings; S.sheet.senders = (await api("/bookings/senders")).senders; } catch (e) { S.sheet.err = errMsg(e); }
      paint();
    }
  }

  function keepFields() {
    if (!S.sheet || S.sheet.kind !== "new") return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    if (g("bkx-name") !== undefined) { S.sheet.name = g("bkx-name"); S.sheet.phone = g("bkx-phone"); S.sheet.email = g("bkx-email"); }
  }
  async function loadSlots() {
    var sh = S.sheet; if (!sh || !sh.serviceId) return;
    sh.slotsLoading = true; paint();
    try { var r = await api("/bookings/next?service_id=" + sh.serviceId + "&count=6"); sh.slots = r.slots || []; }
    catch (e) { sh.slots = []; sh.err = errMsg(e); }
    sh.slotsLoading = false; sh.slot = sh.slots[0] || null; paint();
  }

  // ---------- actions ----------
  async function onClick(ev) {
    var t = ev.target.closest("[data-act]"); if (!t || !S.mount.contains(t)) return;
    var act = t.getAttribute("data-act");
    keepFields();
    if (act === "day") { S.date = t.getAttribute("data-d"); return load({ silent: true }); }
    if (act === "filter") { S.filter = t.getAttribute("data-f") || ""; return paint(); }
    if (act === "wl-book") {
      var w = (S.waiting || []).find(function (x) { return x.id === Number(t.getAttribute("data-id")); }); if (!w) return;
      S.sheet = { kind: "new", serviceId: w.serviceId, slots: [], slot: null, name: w.personName, phone: w.personPhone, email: w.personEmail, waitlistId: w.id };
      paint(); return loadSlots();
    }
    if (act === "wl-remove") {
      try { await api("/bookings/waitlist/" + t.getAttribute("data-id"), { method: "PATCH", body: JSON.stringify({ status: "removed" }) }); toast("Removed from the waiting list"); } catch (e) { toast(errMsg(e), "error"); }
      return load({ silent: true });
    }
    if (act === "wl-add") {
      var sh2 = S.sheet;
      if (!String(sh2.name || "").trim()) { sh2.err = "Type the person's name."; return paint(); }
      try { await api("/bookings/waitlist", { method: "POST", body: JSON.stringify({ serviceId: sh2.serviceId, personName: sh2.name, personPhone: sh2.phone, personEmail: sh2.email }) });
        S.sheet = null; toast(sh2.name + " is on the waiting list"); return load({ silent: true }); }
      catch (e) { sh2.err = errMsg(e); return paint(); }
    }
    if (act === "offer-book") {
      var o = S.sheet.offer;
      try { var rb = await api("/bookings", { method: "POST", body: JSON.stringify({ serviceId: o.serviceId, providerId: o.providerId, date: o.date, start: o.start, personName: o.personName, personPhone: o.personPhone, personEmail: o.personEmail, waitlistId: o.waitlistId }) });
        S.sheet = null; toast("Booked " + rb.booking.personName + " · " + o.start); return load({ silent: true }); }
      catch (e) { S.sheet.err = e && e.status === 409 ? "Someone took that time first." : errMsg(e); return paint(); }
    }
    if (act === "view") { S.view = t.getAttribute("data-v"); return load({ silent: true }); }
    if (act === "openday") { S.view = "day"; S.date = t.getAttribute("data-d"); return load({ silent: true }); }
    if (act === "close") { S.sheet = null; return paint(); }
    if (act === "new") {
      var first = S.setup.services.filter(function (x) { return x.active; })[0];
      S.sheet = { kind: "new", serviceId: first ? first.id : null, slots: [], slot: null };
      paint(); setTimeout(function () { var n = document.getElementById("bkx-name"); if (n) n.focus(); }, 30);
      return loadSlots();
    }
    if (act === "svc") { S.sheet.serviceId = Number(t.getAttribute("data-id")); S.sheet.err = ""; return loadSlots(); }
    if (act === "slot") { S.sheet.slot = S.sheet.slots[Number(t.getAttribute("data-i"))]; S.sheet.err = ""; return paint(); }
    if (act === "book") {
      var sh = S.sheet;
      if (!sh.slot) { sh.err = "Pick a time."; return paint(); }
      if (!String(sh.name || "").trim()) { sh.err = "Type the person's name."; return paint(); }
      sh.saving = true; sh.err = ""; paint();
      try {
        var r = await api("/bookings", { method: "POST", body: JSON.stringify({ serviceId: sh.serviceId, providerId: sh.slot.providerId, date: sh.slot.date, start: sh.slot.time, personName: sh.name, personPhone: sh.phone, personEmail: sh.email, waitlistId: sh.waitlistId || undefined }) });
        S.sheet = null; S.date = r.booking.date; toast("Booked " + r.booking.personName + " · " + dayShort(r.booking.date) + " " + r.booking.start);
        return load({ silent: true });
      } catch (e) {
        sh.saving = false;
        var nx = e && e.bodyJson && e.bodyJson.next;
        if (e && e.status === 409) { sh.err = "Someone just took that time. Here are the next free ones."; if (nx && nx.length) { sh.slots = nx; sh.slot = nx[0]; } else { return loadSlots(); } }
        else sh.err = errMsg(e);
        return paint();
      }
    }
    if (act === "open") { S.sheet = { kind: "booking", id: Number(t.getAttribute("data-id")) }; return paint(); }
    if (act === "cancel") { S.sheet.cancelling = true; S.sheet.err = ""; paint(); setTimeout(function () { var r = document.getElementById("bkx-reason"); if (r) r.focus(); }, 30); return; }
    if (act === "nocancel") { S.sheet.cancelling = false; S.sheet.err = ""; return paint(); }
    if (act === "st" || act === "docancel") {
      var b = S.bookings.find(function (x) { return x.id === S.sheet.id; }); if (!b) return;
      var body = { version: b.version, status: act === "st" ? t.getAttribute("data-s") : "cancelled" };
      if (act === "docancel") { body.cancelReason = (document.getElementById("bkx-reason") || {}).value || ""; if (!body.cancelReason.trim()) { S.sheet.err = "Say why it was cancelled."; return paint(); } }
      try {
        var u = await api("/bookings/" + b.id, { method: "PATCH", body: JSON.stringify(body) });
        S.bookings = S.bookings.map(function (x) { return x.id === b.id ? u.booking : x; });
        S.sheet = null; toast(act === "docancel" ? "Cancelled" : ({ arrived: "Marked as here", done: "Done", no_show: "Marked as no-show" })[body.status]);
        if (act === "docancel" && u.offer) S.sheet = { kind: "offer", offer: u.offer };
        paint();
      } catch (e) {
        if (e && e.status === 409) { S.sheet.err = "Someone else changed this booking. Showing the latest."; await load({ silent: true }); S.sheet = { kind: "booking", id: b.id, err: S.sheet ? S.sheet.err : "" }; return paint(); }
        S.sheet.err = errMsg(e); paint();
      }
    }
    if (act === "settings") return openSettings("services");
    if (act === "imp-check" || act === "imp-run") {
      S.sheet.err = S.sheet.okMsg = "";
      try {
        var ir = await api("/bookings/import-legacy" + (act === "imp-check" ? "?dry=1" : ""), { method: "POST", body: "{}" });
        S.sheet.importReport = ir.report;
        if (act === "imp-run") { toast("Old appointments brought over"); await load({ setup: true, silent: true }); }
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "tab") return openSettings(t.getAttribute("data-t"));
    if (act === "svc-new") { S.sheet.newService = true; S.sheet.err = S.sheet.okMsg = ""; return paint(); }
    if (act === "svc-save") {
      var box = t.closest("[data-svc]"), q = function (k) { return box.querySelector('[data-k="' + k + '"]'); };
      var id = Number(t.getAttribute("data-id"));
      var body = { name: q("name").value, durationMin: Number(q("dur").value), priceCents: Math.round(Number(q("price").value || 0) * 100), providerIds: Array.prototype.map.call(box.querySelectorAll(".bkx-chip.on"), function (c) { return Number(c.getAttribute("data-pid")); }), active: q("active").checked, online: q("online").checked };
      S.sheet.err = S.sheet.okMsg = "";
      try {
        await api("/bookings/services" + (id ? "/" + id : ""), { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
        S.sheet.newService = false; S.sheet.okMsg = "Saved " + body.name; await load({ setup: true, silent: true });
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "chip") { var on = !t.classList.contains("on"); t.classList.toggle("on", on); t.setAttribute("aria-pressed", String(on)); return; }
    // People tab: read a practitioner card back from the screen (so typing survives adding or removing a window).
    var readProv = function (pid) {
      var box = S.mount.querySelector('[data-prov="' + pid + '"]'), hrs = {}, g = function (k) { var el = box.querySelector('[data-k="' + k + '"]:not([data-d])'); return el ? el.value : ""; };
      box.querySelectorAll('[data-k="from"]').forEach(function (f) {
        var d = f.getAttribute("data-d"), i = f.getAttribute("data-i");
        var to = box.querySelector('[data-d="' + d + '"][data-i="' + i + '"][data-k="to"]').value, rm = box.querySelector('[data-d="' + d + '"][data-i="' + i + '"][data-k="room"]');
        (hrs[d] = hrs[d] || []).push(rm && rm.value ? [f.value, to, Number(rm.value)] : [f.value, to]);
      });
      return { title: g("title").trim(), name: g("name").trim(), speciality: g("speciality").trim(), hours: hrs };
    };
    // a second window starts after a break, the way most pharmacies split the day (09:00–13:00, then 16:00–19:00); blank when it would run past midnight
    function nextWin(last) {
      var m = /^(\d{2}):(\d{2})$/.exec((last && last[1]) || ""); if (!m) return ["", ""];
      var a = Number(m[1]) * 60 + Number(m[2]) + 180, b = a + 180, hm = function (x) { return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); };
      return b <= 23 * 60 + 59 ? [hm(a), hm(b)] : ["", ""];
    }
    if (act === "win-add" || act === "win-del") {
      var wp = Number(t.getAttribute("data-id")), wd = t.getAttribute("data-d"), dr = readProv(wp);
      var list = dr.hours[wd] || [];
      if (act === "win-add") list.push(list.length ? nextWin(list[list.length - 1]) : ["09:00", "13:00"]); else list.splice(Number(t.getAttribute("data-i")), 1);
      dr.hours[wd] = list; S.sheet.pdraft = S.sheet.pdraft || {}; S.sheet.pdraft[wp] = dr; S.sheet.err = S.sheet.okMsg = "";
      return paint();
    }
    if (act === "hours-save") {
      var pid = Number(t.getAttribute("data-id")), d2 = readProv(pid), hours = {}, bad = "";
      S.sheet.pdraft = S.sheet.pdraft || {}; S.sheet.pdraft[pid] = d2;
      if (!d2.name) bad = "Give the practitioner a name.";
      Object.keys(d2.hours).forEach(function (d) {
        var ws = d2.hours[d].slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
        ws.forEach(function (w, i) {
          if (!w[0] || !w[1]) bad = bad || WD[d] + ": give both times, or remove the line.";
          else if (w[1] <= w[0]) bad = bad || WD[d] + ": the end must be after the start.";
          else if (i && w[0] < ws[i - 1][1]) bad = bad || WD[d] + ": two windows overlap.";
        });
        if (ws.length) hours[d] = ws;
      });
      S.sheet.err = bad; S.sheet.okMsg = "";
      if (bad) return paint();
      var pr = prov(pid);
      try {
        await api("/bookings/providers/" + pid, { method: "PUT", body: JSON.stringify({ name: d2.name, title: d2.title, speciality: d2.speciality, kind: pr.kind, hours: hours, active: pr.active }) });
        delete S.sheet.pdraft[pid]; S.sheet.okMsg = "Saved " + plabel({ title: d2.title, name: d2.name }); await load({ setup: true, silent: true });
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "away-open") { S.sheet.away = { pid: Number(t.getAttribute("data-id")), from: todayStr() }; S.sheet.err = S.sheet.okMsg = ""; return paint(); }
    if (act === "away-close") { S.sheet.away = null; return paint(); }
    if (act === "away-go") {
      var aw = S.sheet.away, gv = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
      Object.assign(aw, { from: gv("aw-from"), to: gv("aw-to"), start: gv("aw-st"), end: gv("aw-en"), reason: gv("aw-why") });
      if (!window.confirm("Cancel every booking with " + plabel(prov(aw.pid)) + " in that time and tell the customers?")) return;
      S.sheet.err = "";
      try {
        aw.result = await api("/bookings/providers/" + aw.pid + "/away", { method: "POST", body: JSON.stringify({ from: aw.from, to: aw.to || aw.from, start: aw.start, end: aw.end, reason: aw.reason }) });
        await load({ setup: true, silent: true });
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "np-new") { S.sheet.addingPerson = true; return paint(); }
    if (act === "np-cancel") { S.sheet.addingPerson = false; return paint(); }
    if (act === "np-save") {
      var nv = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
      S.sheet.err = "";
      try {
        await api("/bookings/providers", { method: "POST", body: JSON.stringify({ name: nv("np-name"), title: nv("np-title"), speciality: nv("np-spec"), kind: nv("np-title") ? "doctor" : "pharmacist", hours: {} }) });
        S.sheet.addingPerson = false; S.sheet.okMsg = "Added. Give them hours below, then choose them under Services."; await load({ setup: true, silent: true });
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "room-add" || act === "room-save") {
      S.sheet.err = S.sheet.okMsg = "";
      try {
        if (act === "room-add") await api("/bookings/rooms", { method: "POST", body: JSON.stringify({ name: (document.getElementById("room-new") || {}).value || "" }) });
        else { var rid = Number(t.getAttribute("data-id")); await api("/bookings/rooms/" + rid, { method: "PUT", body: JSON.stringify({ name: t.closest("[data-room]").querySelector('[data-k="rname"]').value }) }); }
        S.sheet.rooms = (await api("/bookings/rooms")).rooms; S.sheet.okMsg = "Rooms saved";
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "qr") {
      // The QR encoder (MIT, vendored) loads only when asked for.
      var url2 = location.origin + "/book/" + ((S.sheet && S.sheet.msg && S.sheet.msg.publicSlug) || "");
      try {
        if (!window.qrcode) await new Promise(function (ok, no) { var sc = document.createElement("script"); sc.src = "vendor/qrcode-generator-1.4.4.js"; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
        var q = window.qrcode(0, "M"); q.addData(url2); q.make();
        S.sheet.qrSvg = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      } catch (e) { S.sheet.err = "The QR code could not be made. Copy the link instead."; }
      return paint();
    }
    if (act === "qr-print") {
      var card = document.getElementById("bkx-qrcard"); if (!card) return;
      var w = window.open("", "_blank", "noopener=no,width=480,height=640");
      if (!w) { toast("Allow pop-ups to print the QR code", "warn"); return; }
      w.document.write('<!doctype html><title>Scan to book</title><style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;text-align:center;padding:40px}b{display:block;font-size:28px}span{display:block;font-size:18px;color:#555;margin:6px 0 18px}svg{width:320px;height:320px}small{display:block;margin-top:14px;font-size:14px;color:#555}</style>' + card.innerHTML);
      w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
      return;
    }
    if (act === "copy-link") {
      var url = location.origin + "/book/" + ((S.sheet && S.sheet.msg && S.sheet.msg.publicSlug) || "");
      try { await navigator.clipboard.writeText(url); toast("Link copied · " + url); } catch (e) { window.prompt("Copy the link", url); }
      return;
    }
    if (/^snd-/.test(act)) {
      var sh3 = S.sheet, gid = Number(t.getAttribute("data-id")), gv = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
      sh3.err = sh3.okMsg = "";
      var reload = async function () { sh3.senders = (await api("/bookings/senders")).senders; };
      try {
        if (act === "snd-add") sh3.adding = { kind: "brevo" };
        else if (act === "snd-kind") sh3.adding = { kind: t.getAttribute("data-k") };
        else if (act === "snd-cancel") sh3.adding = null;
        else if (act === "snd-save") {
          var kd = sh3.adding.kind, nb = { kind: kd, fromEmail: gv("bks-from"), dailyCap: Number(gv("bks-cap") || 0) };
          if (kd === "smtp") { nb.smtpHost = gv("bks-host"); nb.smtpSecure = gv("bks-sec"); nb.smtpPort = nb.smtpSecure === "starttls" ? 587 : 465; nb.smtpUser = gv("bks-user"); nb.password = gv("bks-key"); }
          else nb.apiKey = gv("bks-key");
          var added = (await api("/bookings/senders", { method: "POST", body: JSON.stringify(nb) })).sender;
          sh3.adding = null; await reload(); sh3.okMsg = added.label + " added. Press Test to check it.";
        } else if (act === "snd-move") {
          var ids = sh3.senders.map(function (x) { return x.id; }), i = ids.indexOf(gid), j = i + Number(t.getAttribute("data-d"));
          if (i >= 0 && j >= 0 && j < ids.length) { ids.splice(j, 0, ids.splice(i, 1)[0]); sh3.senders = (await api("/bookings/senders/order", { method: "POST", body: JSON.stringify({ ids: ids }) })).senders; }
        } else if (act === "snd-test") {
          var tr = await api("/bookings/senders/" + gid + "/test", { method: "POST", body: "{}" }); await reload(); sh3.okMsg = "Test sent to " + tr.sentTo + " through " + tr.sender + ".";
        } else if (act === "snd-toggle") {
          var cur3 = sh3.senders.find(function (x) { return x.id === gid; });
          await api("/bookings/senders/" + gid, { method: "PATCH", body: JSON.stringify({ enabled: !(cur3 && cur3.enabled) }) }); await reload();
        } else if (act === "snd-remove") {
          var cur4 = sh3.senders.find(function (x) { return x.id === gid; });
          if (!window.confirm("Remove " + (cur4 ? cur4.label : "this sender") + "? Its key is deleted.")) return;
          await api("/bookings/senders/" + gid, { method: "DELETE" }); await reload();
        }
      } catch (e) { sh3.err = errMsg(e); try { await reload(); } catch (e2) {} }
      return paint();
    }
    if (act === "msg-save" || act === "msg-test") {
      var g2 = function (id) { return document.getElementById(id); };
      S.sheet.err = S.sheet.okMsg = "";
      if (act === "msg-save") {
        var body2 = { provider: g2("bkm-on").checked ? "on" : "off", fromEmail: g2("bkm-from").value, fromName: g2("bkm-name").value, remindEvening: g2("bkm-eve").checked,
          remindHours: Number(g2("bkm-hrs").value), cancelCutoffMin: Number(g2("bkm-cut").value), address: g2("bkm-addr").value, phone: g2("bkm-phone").value,
          publicEnabled: g2("bkm-public").checked };
        if (g2("bkm-slug") && g2("bkm-slug").value.trim() !== (S.sheet.msg.publicSlug || "")) body2.publicSlug = g2("bkm-slug").value.trim().toLowerCase();
        try { S.sheet.msg = (await api("/bookings/settings", { method: "PUT", body: JSON.stringify(body2) })).settings; S.sheet.okMsg = body2.provider === "off" ? "Emails are off" : "Saved. Customers with an email now get messages."; }
        catch (e) { S.sheet.err = errMsg(e); }
      } else {
        try { var r2 = await api("/bookings/settings/test", { method: "POST", body: "{}" }); S.sheet.okMsg = "Test sent to " + r2.sentTo; }
        catch (e) { S.sheet.err = errMsg(e); }
      }
      return paint();
    }
    if (act === "setup") {
      var v = function (id) { return (document.getElementById(id) || {}).value || ""; };
      var days = v("bkx-p-days"), from = v("bkx-p-from"), to = v("bkx-p-to"), hours = {};
      String(days).split("").forEach(function (d) { hours[d] = [[from, to]]; });
      S.sheetErr = "";
      try {
        var p = await api("/bookings/providers", { method: "POST", body: JSON.stringify({ name: v("bkx-p-name") || "Pharmacist", kind: "pharmacist", hours: hours }) });
        await api("/bookings/services", { method: "POST", body: JSON.stringify({ name: v("bkx-s-name"), durationMin: Number(v("bkx-s-dur")), priceCents: Math.round(Number(v("bkx-s-price") || 0) * 100), providerIds: [p.provider.id] }) });
        toast("Bookings are ready"); return load({ setup: true });
      } catch (e) { S.sheetErr = errMsg(e); paint(); }
    }
  }

  function onChange(ev) {
    if (!ev.target || ev.target.id !== "bkm-provider" || !S.sheet || !S.sheet.msg) return;
    var m = S.sheet.msg, g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    ["fromEmail:bkm-from", "fromName:bkm-name", "address:bkm-addr", "phone:bkm-phone", "smtpHost:bkm-host", "smtpUser:bkm-user"].forEach(function (pair) {
      var kv = pair.split(":"), v = g(kv[1]); if (v !== undefined) m[kv[0]] = v; });
    m.provider = ev.target.value; paint();
  }

  async function render(ctx) {
    injectCss();
    S.mount = ctx.mount; S.date = S.date || todayStr(); S.sheet = null;
    S.mount.addEventListener("click", onClick);
    S.mount.addEventListener("change", onChange);
    // No polling: refresh when the tab comes back into view.
    S.onVis = function () { if (!document.hidden && S.mount && E.state.activeModuleId === "bookings") load({ silent: true }); };
    document.addEventListener("visibilitychange", S.onVis);
    await load();
  }
  function destroy() {
    if (S.mount) { S.mount.removeEventListener("click", onClick); S.mount.removeEventListener("change", onChange); }
    if (S.onVis) document.removeEventListener("visibilitychange", S.onVis);
    S.mount = null; S.sheet = null;
  }

  E.registerModule({ id: "bookings", title: "Bookings", order: 3, icon: "📅", ui2Only: true, render: render, destroy: destroy });
})();
