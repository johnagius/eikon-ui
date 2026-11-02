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
  if (ENABLED && Array.isArray(E.UI2_RAIL) && !E.UI2_RAIL.some(function (x) { return x.id === "bookings"; })) {
    var at = E.UI2_RAIL.findIndex(function (x) { return x.id === "customers"; });
    E.UI2_RAIL.splice(at >= 0 ? at + 1 : 1, 0, { id: "bookings", title: "Bookings" });
    if (Array.isArray(E.UI2_DESTINATIONS)) E.UI2_DESTINATIONS.push("bookings");
  }

  var S = { mount: null, date: null, setup: null, bookings: [], loading: false, error: "", sheet: null, onVis: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); }
  function todayStr() { return ymd(new Date()); }
  function nowHM() { var d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function longDate(s) { return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); }
  function dayShort(s) { var t = todayStr(); if (s === t) return "today"; if (s === addDays(t, 1)) return "tomorrow"; return new Date(s + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" }); }
  function money(c) { c = Number(c) || 0; return c === 0 ? "free" : "€" + (c / 100).toFixed(c % 100 ? 2 : 0); }
  function initials(n) { var p = String(n || "").trim().split(/\s+/); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
  var COLORS = ["#0A8F6A", "#5856D6", "#C9772E", "#1A9FB5", "#B4566A", "#6E8B3D"];
  function svcColor(svc) { return (svc && svc.color) || COLORS[((svc && svc.id) || 0) % COLORS.length]; }
  function svc(id) { return ((S.setup && S.setup.services) || []).find(function (x) { return x.id === id; }); }
  function prov(id) { return ((S.setup && S.setup.providers) || []).find(function (x) { return x.id === id; }); }
  function api(path, opts) { return E.apiFetch(path, opts || { method: "GET" }); }
  function toast(msg, kind) { try { (E.toast || E.showToast)(msg, kind || "success"); } catch (e) {} }
  function errMsg(e) { return (e && (e.bodyJson && e.bodyJson.error || e.message)) || "Something went wrong"; }

  var CSS = "\
.bkx{--t:#0A8F6A;--ts:rgba(10,143,106,.11);--bg:#F2F2F7;--sf:#fff;--l2:rgba(60,60,67,.64);--l3:rgba(60,60,67,.42);--sep:rgba(60,60,67,.15);--fill:rgba(118,118,128,.12);--red:#D7261C;\
font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,sans-serif;color:#000;background:var(--bg);min-height:100%;padding:24px 28px 80px;-webkit-font-smoothing:antialiased}\
.bkx *{box-sizing:border-box}:where(.bkx) button{font:inherit;border:0;cursor:pointer;background:none;color:inherit}\
.bkx-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;max-width:880px}\
.bkx h1{font-size:34px;line-height:41px;font-weight:700;letter-spacing:-.022em;margin:0}.bkx .sub{font-size:15px;color:var(--l2)}\
.bkx-add{height:40px;padding:0 18px;border-radius:20px;background:var(--t);color:#fff!important;font-size:15px;font-weight:600}\
.bkx-days{display:flex;gap:6px;margin-bottom:22px;max-width:880px}\
.bkx-day{flex:1;height:60px;border-radius:16px;background:var(--sf);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}\
.bkx-day small{font-size:11px;font-weight:600;color:var(--l2);text-transform:uppercase;letter-spacing:.03em}.bkx-day b{font-size:19px;font-weight:600}\
.bkx-day.on{background:var(--t);color:#fff}.bkx-day.on small{color:#fff;opacity:.85}\
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
.bkx-slot.on{background:var(--t);color:#fff}.bkx-slot.on small{color:#fff;opacity:.85}\
.bkx-f{background:var(--sf);border-radius:16px;overflow:hidden;margin-bottom:16px}\
.bkx-f label{display:flex;align-items:center;min-height:50px;padding:0 16px;gap:12px;position:relative}.bkx-f label+label::before{content:'';position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--sep)}\
.bkx-f label span{width:92px;font-size:17px;font-weight:500;flex:none}.bkx-f input,.bkx-f select{flex:1;min-width:0;border:0;outline:0;font:inherit;font-size:17px;background:transparent;padding:12px 0}\
.bkx-note{font-size:13px;color:var(--l2);text-align:center;margin-top:10px}.bkx-err{color:var(--red);font-size:15px;font-weight:600;margin:0 4px 12px}\
.bkx-acts{display:grid;gap:8px}\
";
  function injectCss() { if (document.getElementById("bkx-css")) return; var st = document.createElement("style"); st.id = "bkx-css"; st.textContent = CSS; document.head.appendChild(st); }

  // ---------- data ----------
  async function load(opts) {
    opts = opts || {};
    S.loading = true; S.error = "";
    if (!opts.silent) paint();
    try {
      if (!S.setup || opts.setup) { var su = await api("/bookings/setup"); S.setup = { services: su.services || [], providers: su.providers || [] }; }
      var r = await api("/bookings?from=" + S.date + "&to=" + S.date);
      S.bookings = r.bookings || [];
    } catch (e) {
      S.error = e && e.status === 404 ? "Bookings is not switched on for this pharmacy yet." : errMsg(e);
    }
    S.loading = false; paint();
  }

  // ---------- paint ----------
  var STATE_LABEL = { arrived: ["Here", "var(--t)"], done: ["Done", "var(--l3)"], no_show: ["No-show", "var(--red)"], confirmed: ["Confirmed", "var(--l2)"], cancelled: ["Cancelled", "var(--l3)"] };
  function rowHtml(b, past) {
    var s = svc(b.serviceId) || {}, p = prov(b.providerId) || {}, st = STATE_LABEL[b.status];
    return '<button class="bkx-r' + (past ? " bkx-past" : "") + '" data-act="open" data-id="' + b.id + '">' +
      '<div class="bkx-time">' + esc(b.start) + "<small>" + esc(b.end) + "</small></div>" +
      '<div class="bkx-bar" style="background:' + svcColor(s) + '"></div>' +
      '<div class="bkx-txt"><b>' + esc(b.personName) + "</b><span>" + esc(s.name || "Booking") + (p.name ? " · " + esc(p.name) : "") + "</span></div>" +
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
  function setupHtml() {
    return '<div class="bkx-sec"><div class="bkx-g" style="padding:20px 18px">' +
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
    var isToday = S.date === todayStr(), now = nowHM();
    var list = S.bookings.filter(function (b) { return b.status !== "cancelled"; });
    var up = list.filter(function (b) { return !isToday || b.end > now; });
    var past = list.filter(function (b) { return isToday && b.end <= now; });
    var hasSetup = S.setup && S.setup.services.length;
    var body = "";
    if (S.error) body = '<div class="bkx-sec"><div class="bkx-g"><div class="bkx-empty">' + esc(S.error) + "</div></div></div>";
    else if (S.setup && !hasSetup) body = setupHtml();
    else if (!S.setup) body = '<div class="bkx-sec"><div class="bkx-g"><div class="bkx-empty">Loading…</div></div></div>';
    else {
      body = '<div class="bkx-sec"><h2>' + (isToday ? "Next" : "Booked") + "</h2><div class=\"bkx-g\">" +
        (up.length ? up.map(function (b) { return rowHtml(b, false); }).join("") : '<div class="bkx-empty">' + (isToday ? "Nothing else booked today." : "Nothing booked on this day.") + "</div>") + "</div></div>";
      if (past.length) body += '<div class="bkx-sec"><h2>Earlier</h2><div class="bkx-g">' + past.map(function (b) { return rowHtml(b, true); }).join("") + "</div></div>";
    }
    S.mount.innerHTML = '<div class="bkx">' +
      '<div class="bkx-top"><div><h1>Bookings</h1><div class="sub">' + esc(longDate(S.date)) + (hasSetup ? " · " + list.length + " booked" : "") + "</div></div>" +
      (hasSetup ? '<button class="bkx-add" data-act="new">New booking</button>' : "") + "</div>" +
      (hasSetup ? daysHtml() : "") + body + "</div>" + sheetHtml();
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
        '<button class="bkx-btn fill lg" data-act="book"' + (sh.saving ? " disabled" : "") + ">" + (sh.saving ? "Booking…" : "Book " + esc(chosen ? chosen.name.toLowerCase() : "") + (sh.slot ? " · " + esc(dayShort(sh.slot.date)) + " " + esc(sh.slot.time) : "")) + "</button>";
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
    return '<div class="bkx-scrim" data-act="close"></div><div class="bkx-sheet bkx" style="padding-top:10px;min-height:0"><div class="bkx-grab"></div>' + inner + "</div>";
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
        var r = await api("/bookings", { method: "POST", body: JSON.stringify({ serviceId: sh.serviceId, providerId: sh.slot.providerId, date: sh.slot.date, start: sh.slot.time, personName: sh.name, personPhone: sh.phone, personEmail: sh.email }) });
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
        S.sheet = null; toast(act === "docancel" ? "Cancelled" : ({ arrived: "Marked as here", done: "Done", no_show: "Marked as no-show" })[body.status]); paint();
      } catch (e) {
        if (e && e.status === 409) { S.sheet.err = "Someone else changed this booking. Showing the latest."; await load({ silent: true }); S.sheet = { kind: "booking", id: b.id, err: S.sheet ? S.sheet.err : "" }; return paint(); }
        S.sheet.err = errMsg(e); paint();
      }
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

  async function render(ctx) {
    injectCss();
    S.mount = ctx.mount; S.date = S.date || todayStr(); S.sheet = null;
    S.mount.addEventListener("click", onClick);
    // No polling: refresh when the tab comes back into view.
    S.onVis = function () { if (!document.hidden && S.mount && E.state.activeModuleId === "bookings") load({ silent: true }); };
    document.addEventListener("visibilitychange", S.onVis);
    await load();
  }
  function destroy() {
    if (S.mount) S.mount.removeEventListener("click", onClick);
    if (S.onVis) document.removeEventListener("visibilitychange", S.onVis);
    S.mount = null; S.sheet = null;
  }

  E.registerModule({ id: "bookings", title: "Bookings", order: 3, icon: "📅", ui2Only: true, render: render, destroy: destroy });
})();
