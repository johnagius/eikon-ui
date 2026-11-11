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
    if (qv === "1") localStorage.removeItem("eikon_bookings");
    if (qv === "0") localStorage.setItem("eikon_bookings", "0");
  } catch (e) {}
  // On for everyone in the new layout since the server went live (2026-11-03); ?bookings=0 still hides it on a device.
  var ENABLED = true;
  try { ENABLED = localStorage.getItem("eikon_bookings") !== "0"; } catch (e) {}
  E.bookingsOn = function () { return ENABLED && !!(E.isUi2 && E.isUi2()); };
  // Set up at this pharmacy (remembered from the last time Bookings was opened here). Until then the Customers screen
  // keeps its "Appointment" button for the classic Appointments, so nobody loses the way they book today.
  function readyKey() { var u = (E.state && E.state.user) || {}; return "eikon_bk_ready_" + (u.org_id || "") + "_" + (u.location_id || ""); }
  E.bookingsReady = function () { try { return E.bookingsOn() && localStorage.getItem(readyKey()) === "1"; } catch (e) { return false; } };
  if (ENABLED && Array.isArray(E.UI2_RAIL) && !E.UI2_RAIL.some(function (x) { return x.id === "bookings"; })) {
    var at = E.UI2_RAIL.findIndex(function (x) { return x.id === "customers"; });
    E.UI2_RAIL.splice(at >= 0 ? at + 1 : 1, 0, { id: "bookings", title: "Bookings" });
  }
  // Always a screen of the new layout, even where the rail does not show it yet: a link to #bookings (Today's
  // bookings, an old bookmark) must open it here, not drop the person into the classic layout for the session.
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("bookings") < 0) E.UI2_DESTINATIONS.push("bookings");

  var S = { by: (function () { try { return localStorage.getItem("eikon_bk_by") === "room" ? "room" : "person"; } catch (e) { return "person"; } })(), mount: null, view: "day", date: null, setup: null, bookings: [], loading: false, error: "", sheet: null, onVis: null, seq: 0, poll: 0, picking: false, newDraft: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return ymd(d); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000); }
  // "Thu 5 Nov" (with the year when it is not this year): the words the toast and the Move button use.
  function shortDate(s) { var d = new Date(s + "T12:00:00"), o = { weekday: "short", day: "numeric", month: "short" }; if (s.slice(0, 4) !== todayStr().slice(0, 4)) o.year = "numeric"; return d.toLocaleDateString("en-GB", o).replace(/,/g, ""); }
  function telLink(ph) { var n = String(ph || "").replace(/[^\d+]/g, ""); return n ? '<a class="bkx-tel" href="tel:' + esc(n) + '">' + esc(ph) + "</a>" : ""; }
  function userKey() { var u = (E.state && E.state.user) || {}; return String(u.location_id || "") + "|" + String(u.id != null ? u.id : (u.email || "")); }
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
.bkx{--t:#066B4F;--ti:#fff;--ts:rgba(10,143,106,.11);--bg:#F2F2F7;--sf:#fff;--l2:#6A6A70;--l3:rgba(60,60,67,.42);--sep:rgba(60,60,67,.15);--fill:rgba(118,118,128,.12);--red:#C4221A;\
font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,sans-serif;color:#000;background:var(--bg);min-height:100%;padding:24px 28px 80px;-webkit-font-smoothing:antialiased}\
.bkx *{box-sizing:border-box}:where(.bkx) button{font:inherit;border:0;cursor:pointer;background:none;color:inherit}\
.bkx-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:18px;max-width:880px}\
.bkx h1{font-size:34px;line-height:41px;font-weight:700;letter-spacing:-.022em;margin:0}.bkx .sub{font-size:15px;color:var(--l2)}\
.bkx-add{height:40px;padding:0 18px;border-radius:20px;background:var(--t);color:var(--ti)!important;font-size:15px;font-weight:600}\
.bkx-days{display:flex;gap:6px;margin-bottom:22px;max-width:880px}\
.bkx-day{flex:1;height:60px;border-radius:16px;background:var(--sf);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}\
.bkx-day small{font-size:11px;font-weight:600;color:var(--l2);text-transform:uppercase;letter-spacing:.03em}.bkx-day b{font-size:19px;font-weight:600}\
.bkx-day.on{background:var(--t);color:var(--ti)}.bkx-day.on small{color:inherit}\
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
.bkx-btn.fill{background:var(--t);color:var(--ti)}.bkx-btn.tint{background:var(--ts);color:var(--t)}.bkx-btn.red{background:rgba(255,59,48,.10);color:var(--red)}\
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
.bkx-slot.on{background:var(--t);color:var(--ti)}.bkx-slot.on small{color:inherit}\
.bkx-f{background:var(--sf);border-radius:16px;overflow:hidden;margin-bottom:16px}\
.bkx-f label{display:flex;align-items:center;min-height:50px;padding:0 16px;gap:12px;position:relative}.bkx-f label+label::before{content:'';position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--sep)}\
.bkx-f label:focus-within{background:var(--ts)}.bkx-f label span{width:92px;font-size:17px;font-weight:500;flex:none}.bkx-f input,.bkx-f select{flex:1;min-width:0;border:0;outline:0;font:inherit;font-size:17px;background:transparent;padding:12px 0;color:inherit}\
.bkx-note{font-size:13px;color:var(--l2);text-align:center;margin-top:10px}.bkx-err{color:var(--red);font-size:15px;font-weight:600;margin:0 4px 12px}.bkx-f .epp-list,.bkx-f .epp-note{margin:0 16px}\
.bkx-acts{display:grid;gap:8px}\
.bkx-seg{display:flex;background:rgba(118,118,128,.12);border-radius:10px;padding:2px;margin-bottom:16px}.bkx-seg button{flex:1;height:32px;border-radius:8px;font-size:14px;font-weight:600;color:rgba(60,60,67,.8)}\
.bkx-seg button.on{background:#fff;color:#000;box-shadow:0 1px 3px rgba(0,0,0,.12)}\
.bkx-qr{padding:4px 16px 14px;display:flex;flex-direction:column;align-items:center;gap:10px}.bkx-qrcard{background:#fff;color:#000;border-radius:16px;padding:18px 18px 14px;text-align:center;width:260px;box-shadow:0 0 0 .5px var(--sep)}.bkx-qrcard b{display:block;font-size:18px}.bkx-qrcard span{display:block;font-size:14px;color:#555;margin:2px 0 8px}.bkx-qrcard svg{width:200px;height:200px}.bkx-qrcard small{display:block;font-size:12px;color:#555;margin-top:6px;word-break:break-all}.bkx-pre{font-style:normal;color:var(--l2);font-size:16px;margin-right:2px}.bkx-linkrow{display:flex;align-items:center;gap:10px;padding:10px 16px 12px;position:relative}.bkx-linkrow::before{content:'';position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--sep)}.bkx-linkrow a{flex:1;min-width:0;color:var(--t);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bkx-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1}.bkx-chip{height:32px;padding:0 12px;border-radius:16px;background:var(--fill);font-size:14px;font-weight:600;color:inherit}.bkx-chip.on{background:var(--t);color:var(--ti)}.bkx-win select{border:0;background:var(--fill);border-radius:8px;height:30px;font:inherit;font-size:14px;color:inherit;padding:0 6px;margin-left:6px;max-width:130px}@media(max-width:760px){.bkx-win{display:grid!important;grid-template-columns:72px minmax(0,1fr) auto minmax(0,1fr) auto auto;align-items:center;column-gap:6px;row-gap:8px;padding-top:10px!important;padding-bottom:10px!important}.bkx-win input[type=time]{width:100%!important;min-width:0}.bkx-win select{grid-column:2/-1;grid-row:2;margin-left:0;max-width:none;height:34px}.bkx-win>span:not(:first-child){display:none}}.bkx-away{margin:0 16px 14px;padding:12px;border-radius:12px;background:var(--fill)}.bkx-away label{padding:0;min-height:40px}.bkx-away label+label::before{display:none}.bkx-call{font-size:14px;margin-top:8px}.bkx-snd{display:flex;align-items:center;gap:12px;padding:12px 16px;position:relative}.bkx-snd+.bkx-snd::before{content:'';position:absolute;top:0;left:16px;right:0;height:.5px;background:var(--sep)}.bkx-snd>i{width:9px;height:9px;border-radius:50%;flex:none}.bkx-snd .t{flex:1;min-width:0}.bkx-snd b{display:block;font-size:16px;font-weight:600}.bkx-snd b small{font-weight:400;color:var(--l2);font-size:13px}.bkx-snd span{display:block;font-size:13px;color:var(--l2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bkx-snd .a{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.bkx-mini{height:30px;padding:0 10px;border-radius:15px;background:var(--fill);font-size:13px;font-weight:600;color:var(--t)}.bkx-mini.red{color:var(--red)}.bkx-mini:disabled{opacity:.35}@media(max-width:600px){.bkx-snd{flex-wrap:wrap}.bkx-snd .a{flex-basis:100%;justify-content:flex-start;padding-left:21px}}.bkx-gear{width:40px;height:40px;padding:0;border-radius:50%;display:grid;place-items:center}.bkx-add{white-space:nowrap}.bkx-plus{display:none}\
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
.bkx-ok{color:var(--t);font-size:15px;font-weight:600;margin:0 4px 12px}\
.bkx h1{display:flex;align-items:center;flex-wrap:wrap;gap:0 6px}.bkx h1 .nxh-q{margin-left:0;top:0;flex:none}\
.bkx-navrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;max-width:880px}.bkx-navrow .bkx-view{margin:0;flex:0 1 220px;min-width:140px}.bkx-navr{display:flex;align-items:center;gap:8px;margin-left:auto}\
.bkx-arr{width:44px;height:44px;padding:0;border-radius:22px;font-size:24px;line-height:1;display:grid;place-items:center}.bkx-today{height:44px;padding:0 16px;border-radius:22px;background:var(--ts);color:var(--t);font-size:15px;font-weight:600}\
.bkx-dateb{font:inherit;font-size:15px;color:var(--l2);padding:0;min-height:32px;text-decoration:underline;text-decoration-color:var(--l3);text-underline-offset:3px}.bkx-goto{font:inherit;font-size:16px;height:36px;border-radius:10px;border:1px solid var(--sep);background:var(--sf);color:inherit;padding:0 8px}\
.bkx-day.now:not(.on) b{color:var(--t)}.bkx-day.past:not(.on){background:transparent;box-shadow:inset 0 0 0 1px var(--sep)}\
.bkx-tel{color:var(--t);font-weight:600;text-decoration:none}.bkx-tel:hover{text-decoration:underline}.bkx-namebtn{font:inherit;font-size:20px;font-weight:700;text-align:left;padding:0;color:inherit;text-decoration:underline;text-decoration-color:var(--l3);text-underline-offset:4px}\
.bkx-stline{font-size:15px;font-weight:600;margin:0 4px 12px}.bkx-was{font-size:15px;color:var(--l2);margin:0 4px 14px}\
.bkx-mail{display:flex;align-items:flex-start;gap:12px;background:var(--sf);border-radius:16px;padding:12px 16px;margin-bottom:16px;font-size:15px}.bkx-mail input{width:22px;height:22px;margin:1px 0 0;flex:none;accent-color:var(--t)}.bkx-mail small{display:block;font-size:13px;color:var(--l2);margin-top:2px}\
.bkx-back{display:flex;align-items:center;gap:0 8px;flex-wrap:wrap;margin:-4px 4px 10px;font-size:14px;color:var(--l2)}.bkx-back button{min-height:44px;padding:0 6px;color:var(--t);font-weight:600;text-decoration:underline;text-underline-offset:3px}\
@media(max-width:600px){.bkx-navrow .bkx-view{flex-basis:150px}}.bkx-ask{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:rgba(201,119,46,.16);border-radius:14px;padding:12px 14px;margin:0 0 14px;font-size:15px;font-weight:600}.bkx-ask-b{display:flex;gap:8px;margin-left:auto}.bkx-ask .bkx-btn{min-height:44px;height:44px;border-radius:22px}.bkx-ask .bkx-btn.red{background:var(--sf)}.bkx-closed{font-style:normal;font-size:13px;color:var(--l2);margin-left:auto}\
";
  // The day calendar, walk-ins, blocked time, reminders (2026-11).
  var CSS2 = "\
.bkx{--amb:#8A5300;--ambs:rgba(201,119,46,.16)}\
@media(prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .bkx{--amb:#FFB340;--ambs:rgba(255,179,64,.16)}}\
.bkx-tools{display:flex;gap:8px;align-items:center}.bkx-walk{height:40px;padding:0 16px;border-radius:20px;background:var(--ts);color:var(--t);font-size:15px;font-weight:600;white-space:nowrap}\
.bkx-sum{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin:0 4px 12px;font-size:15px;color:var(--l2);max-width:1180px}.bkx-sum>span{font-variant-numeric:tabular-nums}\
.bkx-remb{min-height:36px;padding:0 14px;border-radius:18px;background:var(--fill);font-size:14px;font-weight:600;color:inherit}.bkx-remb.warn{background:var(--ambs);color:var(--amb)}\
.bkx-cal{background:var(--sf);border-radius:22px;max-width:1180px;overflow:auto;max-height:max(440px,calc(100vh - 290px));position:relative;overscroll-behavior:contain}\
.bkx-calh,.bkx-calb{display:grid;grid-template-columns:52px repeat(var(--cols),minmax(150px,1fr));min-width:calc(52px + var(--cols) * 150px)}\
.bkx-calh{position:sticky;top:0;z-index:3;background:var(--sf);box-shadow:0 .5px 0 var(--sep)}.bkx-axh{position:sticky;left:0;background:var(--sf)}\
.bkx-ch{padding:10px 10px 8px;min-width:0}.bkx-ch b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bkx-ch span{display:block;font-size:12px;color:var(--l2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.bkx-calb{position:relative}.bkx-ax{position:sticky;left:0;z-index:2;background:var(--sf);height:100%}.bkx-ax span{position:absolute;right:8px;transform:translateY(-1px);font-size:12px;color:var(--l2);font-variant-numeric:tabular-nums}\
.bkx-col{position:relative;border-left:.5px solid var(--sep);background:repeating-linear-gradient(135deg,var(--fill) 0 2px,transparent 2px 9px)}\
.bkx-col::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(to bottom,var(--sep) 0 .5px,transparent .5px 120px);pointer-events:none;z-index:1}\
.bkx-open{position:absolute;left:0;right:0;background:var(--sf)}\
.bkx-free{position:absolute;left:3px;right:3px;border-radius:8px;display:flex;align-items:flex-start;justify-content:space-between;padding:4px 8px;font-size:12px;color:var(--l2);text-align:left;z-index:1;overflow:hidden}\
.bkx-free i{font-style:normal;font-weight:600;color:var(--t);opacity:0}.bkx-free:hover,.bkx-free:focus-visible{background:var(--ts);color:var(--t)}.bkx-free:hover i,.bkx-free:focus-visible i{opacity:1}\
.bkx-ev{position:absolute;left:3px;right:3px;z-index:2;display:flex;flex-direction:column;justify-content:flex-start;border-radius:8px;background:var(--bg);border-left:4px solid var(--c);padding:3px 8px;text-align:left;overflow:hidden;font-size:13px;line-height:17px;box-shadow:0 0 0 .5px var(--sep)}\
.bkx-ev b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}.bkx-ev span{display:block;font-size:12px;color:var(--l2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.bkx-ev.sm{flex-direction:row;gap:6px;align-items:center;padding-top:1px;padding-bottom:1px}.bkx-ev.sm b{flex:0 1 auto}.bkx-ev.sm span{flex:1 1 0;min-width:0}.bkx-ev.dim{opacity:.62}\
.bkx-ev em,.bkx-r em,.bkx-wb em{font-style:normal;font-weight:600}.bkx .ok{color:var(--t)}.bkx .bad{color:var(--red)}.bkx .warn{color:var(--amb)}.bkx .mut{color:var(--l2)}\
.bkx-offb{position:absolute;left:3px;right:3px;z-index:2;border-radius:8px;background:repeating-linear-gradient(135deg,var(--fill) 0 6px,rgba(118,118,128,.2) 6px 12px);padding:3px 8px;text-align:left;font-size:12px;color:var(--l2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}\
.bkx-offb b{color:var(--l1,inherit);font-weight:600}.bkx-awayb{display:flex;align-items:flex-start;padding-top:10px;font-size:14px}\
.bkx-now{position:absolute;left:0;right:0;height:2px;background:var(--red);z-index:3;pointer-events:none}.bkx-now::before{content:'';position:absolute;left:-4px;top:-3px;width:8px;height:8px;border-radius:50%;background:var(--red)}\
.bkx-free:focus-visible,.bkx-ev:focus-visible,.bkx-offb:focus-visible{outline:2px solid var(--t);outline-offset:1px;z-index:4}\
.bkx-leg{background:var(--sf);border-radius:22px;padding:16px 18px;max-width:880px;margin:0 0 18px;box-shadow:inset 0 0 0 2px var(--ts)}.bkx-leg b{display:block;font-size:17px;font-weight:700;margin-bottom:4px}.bkx-legb{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.bkx-legb .bkx-btn{min-height:44px;border-radius:22px}\
.bkx-hist{font-size:14px;font-weight:600;color:var(--l2);margin:-6px 4px 14px}.bkx-hist.warn{color:var(--amb)}\
.bkx-rep{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-8px 0 18px}.bkx-rep select{font:inherit;font-size:16px;height:40px;border-radius:12px;border:0;background:var(--sf);color:inherit;padding:0 10px}\
.bkx-wl{display:flex;gap:6px;flex-wrap:wrap;margin:-8px 0 16px}.bkx-link{font:inherit;font-size:15px;color:var(--t);font-weight:600;min-height:44px;padding:0 4px;text-decoration:underline;text-underline-offset:3px}\
.bkx-wd{font-size:12px;color:var(--l2);display:block}.bkx-wb.off{border-left-color:var(--l3)!important;background:transparent;box-shadow:inset 0 0 0 .5px var(--sep)}\
.bkx-walk2{display:none}.bkx-navrow .bkx-chips{min-width:0}@media(max-width:600px){.bkx-tools .bkx-walk{display:none}.bkx-walk2{display:block;height:44px;border-radius:22px}.bkx-navrow .bkx-chips{flex-wrap:nowrap;overflow-x:auto;flex:1 1 100%;margin:0 -16px;padding:0 16px 2px;scrollbar-width:none}.bkx-navrow .bkx-chips::-webkit-scrollbar{display:none}.bkx-chip{flex:none}.bkx-calh,.bkx-calb{grid-template-columns:44px repeat(var(--cols),minmax(132px,1fr));min-width:calc(44px + var(--cols) * 132px)}.bkx-cal{border-radius:16px;max-height:none}}\
";
  function injectCss() { if (document.getElementById("bkx-css")) return; var st = document.createElement("style"); st.id = "bkx-css"; st.textContent = CSS + CSS2; document.head.appendChild(st); }

  // ---------- data ----------
  async function load(opts) {
    opts = opts || {};
    var my = ++S.seq; // a later day asked for meanwhile (‹ › pressed twice): this reply is dropped
    S.loading = true; if (!opts.quiet) S.error = "";
    if (!opts.silent) paint();
    try {
      // setup, the day (or week) and the waiting list at once: one round trip instead of three
      var to = S.view === "week" ? addDays(S.date, 6) : S.date; // the week is one call too
      var needSetup = !S.setup || opts.setup;
      // ...and the blocked time of those days, and the rooms with the set-up (the calendar's columns)
      var got = await Promise.all([needSetup ? api("/bookings/setup") : null, api("/bookings?from=" + S.date + "&to=" + to), api("/bookings/waitlist").catch(function () { return null; }),
        api("/bookings/exceptions?from=" + S.date + "&to=" + to).catch(function () { return null; }), needSetup ? api("/bookings/rooms").catch(function () { return null; }) : null]);
      if (my !== S.seq) return;
      if (needSetup) { var su = got[0]; S.setup = { services: su.services || [], providers: su.providers || [] }; S.rooms = ((got[4] && got[4].rooms) || []).filter(function (r) { return r.active !== false; }); }
      S.exc = (got[3] && got[3].exceptions) || [];
      S.mail = got[1].mail || null; S.messages = got[1].messages || {}; S.noShows = got[1].noShows || {};
      try { if (S.setup.services.length) localStorage.setItem(readyKey(), "1"); else localStorage.removeItem(readyKey()); } catch (eR) {}
      S.bookings = got[1].bookings || [];
      S.waiting = (got[2] && got[2].waiting) || [];
    } catch (e) {
      if (my !== S.seq) return;
      // the minute's quiet refresh never swaps the day for an error: the list stays, the next minute tries again
      if (!opts.quiet) S.error = e && e.status === 404 ? "Bookings is not switched on for this pharmacy yet." : errMsg(e);
    }
    S.loading = false;
    if (!S.error) checkLegacy();
    if (opts.quiet && S.sheet) return; // a sheet opened while the refresh was out: it is not redrawn under the person
    paint();
    // Arrived from the search (eikon.search.js): open that booking.
    var want = null; try { want = JSON.parse(sessionStorage.getItem("eikon_bk_open") || "null"); sessionStorage.removeItem("eikon_bk_open"); } catch (e) {}
    if (want && Date.now() - (want.at || 0) < 60000 && !S.error && (S.bookings || []).some(function (b) { return b.id === want.id; })) { S.sheet = { kind: "booking", id: want.id }; paint(); return; }
    // Arrived from a customer's "Booking" button: open a new booking with their details filled in.
    var carry = null; try { carry = JSON.parse(sessionStorage.getItem("eikon_bk_carry") || "null"); sessionStorage.removeItem("eikon_bk_carry"); } catch (e) {}
    if (carry && carry.at && Date.now() - Number(carry.at) > 15 * 60000) carry = null; // an old hand-over is ignored
    // Sent here to set Bookings up first (Customers, BACKLOG4 item 1): the person waits for the set-up, then their booking opens.
    if (carry && S.setup && !S.error && !S.setup.services.length) { try { sessionStorage.setItem("eikon_bk_carry", JSON.stringify(carry)); } catch (e) {} carry = null; }
    if (carry && S.setup && !S.error) {
      var first = S.setup.services.filter(function (x) { return x.active; })[0];
      if (first) { S.sheet = { kind: "new", serviceId: first.id, slots: [], slot: null, name: carry.name, phone: carry.phone, email: carry.email }; paint(); return loadSlots(); }
    }
  }

  // ---------- paint ----------
  var STATE_LABEL = { arrived: ["Here", "var(--t)"], done: ["Done", "var(--l3)"], no_show: ["No-show", "var(--red)"], confirmed: ["Confirmed", "var(--l2)"], cancelled: ["Cancelled", "var(--l3)"] };
  function rowHtml(b, past, pastDay) {
    var s = svc(b.serviceId) || {}, p = prov(b.providerId) || {}, st = STATE_LABEL[b.status] || (pastDay && b.status === "booked" ? ["Not marked", "var(--l2)"] : null);
    return '<button class="bkx-r' + (past ? " bkx-past" : "") + '" data-act="open" data-id="' + b.id + '">' +
      '<div class="bkx-time">' + esc(b.start) + "<small>" + esc(b.end) + "</small></div>" +
      '<div class="bkx-bar" style="background:' + svcColor(s) + '"></div>' +
      '<div class="bkx-txt"><b>' + esc(b.personName) + "</b><span>" + esc(s.name || "Booking") + (p.name ? " · " + esc(plabel(p)) : "") + (b.roomName ? " · " + esc(b.roomName) : "") + "</span></div>" +
      (st ? '<span class="bkx-st" style="color:' + st[1] + '">' + st[0] + "</span>" : "") + "</button>";
  }
  // Seven days from yesterday ("did she come yesterday?" is one tap); ‹ › move it a week at a time (q6-2: any day,
  // past ones too). The strip always holds the chosen day.
  function stripFrom() { var y = addDays(todayStr(), -1); return addDays(y, Math.floor(daysBetween(y, S.date) / 7) * 7); }
  function daysHtml() {
    var t = todayStr(), from = stripFrom(), h = "";
    for (var i = 0; i < 7; i++) {
      var d = addDays(from, i), dt = new Date(d + "T12:00:00");
      h += '<button class="bkx-day' + (d === S.date ? " on" : "") + (d === t ? " now" : "") + (d < t ? " past" : "") + '" data-act="day" data-d="' + d + '" aria-pressed="' + (d === S.date) + '" aria-label="' + esc(longDate(d) + (d === t ? ", today" : "")) + '"><small>' + dt.toLocaleDateString("en-GB", { weekday: "short" }) + "</small><b>" + dt.getDate() + "</b></button>";
    }
    return '<div class="bkx-days">' + h + "</div>";
  }
  // Day | Week, then Today (when away from it), ‹ and ›: the same row in both views.
  function navHtml() {
    var t = todayStr(), away = S.view === "week" ? !(t >= S.date && t <= addDays(S.date, 6)) : S.date !== t;
    return '<div class="bkx-navrow"><div class="bkx-seg bkx-view"><button class="' + (S.view === "day" ? "on" : "") + '" data-act="view" data-v="day" aria-pressed="' + (S.view === "day") + '">Day</button><button class="' + (S.view === "week" ? "on" : "") + '" data-act="view" data-v="week" aria-pressed="' + (S.view === "week") + '">Week</button></div>' +
      '<div class="bkx-navr">' + (away ? '<button class="bkx-today" data-act="today">Today</button>' : "") + (S.setup && S.setup.services.length ? '<button class="bkx-walk bkx-walk2" data-act="walkin">Walk-in</button>' : "") +
      '<button class="bkx-btn bkx-arr" data-act="wk" data-n="-7" aria-label="A week earlier" title="A week earlier">‹</button><button class="bkx-btn bkx-arr" data-act="wk" data-n="7" aria-label="A week later" title="A week later">›</button></div></div>';
  }
  // The date under the title: a tap opens a date box to go to any day.
  function dateLineHtml() {
    var label = S.view === "week" ? weekLabel() : longDate(S.date);
    if (S.picking) return '<input class="bkx-goto" id="bkx-goto" type="date" value="' + esc(S.date) + '" aria-label="Go to a day">';
    return '<button class="bkx-dateb" data-act="pickdate" aria-label="' + esc(label + ". Choose another day") + '">' + esc(label) + "</button>";
  }
  // Seven days from the chosen date, one column each (stacked on a phone); tap a day to open it. Each day says how
  // much is booked and how much is still free, and shows blocked time between the bookings.
  function weekHtml(list) {
    var h = '<div class="bkx-week">', t = todayStr();
    for (var i = 0; i < 7; i++) {
      var d = addDays(S.date, i), dt = new Date(d + "T12:00:00");
      var dayList = list.filter(function (b) { return b.date === d && b.status !== "cancelled"; });
      var cols = columnsFor(d, S.bookings), f = d < t ? 0 : freeMin(cols, d), closed = !cols.some(function (c) { return c.wins.length; });
      var offs = []; cols.forEach(function (c) { c.offs.forEach(function (o) { if (!offs.some(function (x) { return x.id === o.id; })) offs.push(o); }); if (c.away && !offs.some(function (x) { return x.id === c.away.id; })) offs.push({ id: c.away.id, a: 0, b: 0, note: "Away" + (c.away.note ? ": " + c.away.note : ""), pid: c.pid, away: true }); });
      var items = dayList.map(function (b) { return { at: minOf(b.start), b: b }; }).concat(offs.map(function (o) { return { at: o.a, o: o }; })).sort(function (x, y) { return x.at - y.at; });
      var sub = (dayList.length ? dayList.length + " booked" : closed ? "Closed" : "Free") + (f && dayList.length ? " · " + dur(f) + " free" : "");
      h += '<div class="bkx-wcol"><button class="bkx-wh' + (d === t ? " now" : "") + '" data-act="openday" data-d="' + d + '" aria-label="' + esc(longDate(d) + ": " + sub + ". Open the day") + '"><small>' +
        dt.toLocaleDateString("en-GB", { weekday: "short" }) + "</small><b>" + dt.getDate() + "</b><span>" + esc(sub) + "</span></button>" +
        items.map(function (it) {
          if (it.o) { var op = prov(it.o.pid) || {}; return '<button class="bkx-wb off" data-act="exc" data-id="' + it.o.id + '"><b>' + (it.o.away ? "" : hm(it.o.a) + " ") + "</b>" + esc(it.o.note || "Blocked") + "<span>" + esc(plabel(op)) + "</span></button>"; }
          var b = it.b, sv = svc(b.serviceId) || {}, mk = markOf(b);
          return '<button class="bkx-wb" data-act="open" data-id="' + b.id + '" style="border-left-color:' + svcColor(sv) + '"><b>' + esc(b.start) + "</b> " + esc(b.personName) + "<span>" + esc(sv.name || "") + (mk ? ' · <em class="' + mk[1] + '">' + mk[0] + "</em>" : "") + "</span></button>";
        }).join("") + "</div>";
    }
    return h + "</div>";
  }

  // ---------- the day calendar (2026-11) ----------
  // One column per practitioner (or per room), the day's hours down the side. White is working time, the stripes are
  // not; a booking is a coloured block; blocked time (lunch, training) a grey one. Every free stretch is a button: a
  // tap books there (the time under the finger, to the 5 minutes), Enter books its first minute.
  var PXM = 2; // pixels per minute: an hour is 120px, a 15-minute booking 30px
  function minOf(t) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }
  function hm(x) { x = Math.max(0, Math.min(24 * 60 - 1, Math.round(x))); return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); }
  function dur(min) { min = Math.max(0, Math.round(min)); var h = Math.floor(min / 60), m = min % 60; return h ? h + "h" + (m ? " " + m + "m" : "") : m + " min"; }
  function excOf(d, pid, kind) { return (S.exc || []).filter(function (e) { return e.date === d && e.providerId === pid && (!kind || e.kind === kind); }); }
  function provsFor(d, list) {
    var ids = {}; (list || []).forEach(function (b) { if (b.date === d) ids[b.providerId] = 1; });
    return ((S.setup && S.setup.providers) || []).filter(function (p) { return p.active !== false || ids[p.id]; });
  }
  // The working windows of one practitioner on a day: weekly hours plus extra sessions; a whole day off empties them.
  function winsOf(p, d) {
    var wd = new Date(d + "T12:00:00").getDay(), h = p.hours || {};
    var wins = (h[wd] || h[String(wd)] || []).map(function (w) { return { a: minOf(w[0]), b: minOf(w[1]), pid: p.id, room: Number(w[2]) || 0 }; });
    excOf(d, p.id, "extra").forEach(function (e) { wins.push({ a: minOf(e.start), b: minOf(e.end), pid: p.id, room: 0 }); });
    return wins.filter(function (w) { return w.b > w.a; });
  }
  function offsOf(p, d) { return excOf(d, p.id, "off").filter(function (e) { return e.start; }).map(function (e) { return { a: minOf(e.start), b: minOf(e.end), id: e.id, note: e.note || "", pid: p.id }; }); }
  function awayOf(p, d) { return excOf(d, p.id, "off").filter(function (e) { return !e.start; })[0] || null; }
  // Columns for a day: { key, label, pid (person columns), wins, offs, away, books }
  function columnsFor(d, list) {
    var fl = S.filter || "", live = (list || []).filter(function (b) { return b.date === d && b.status !== "cancelled"; });
    var provs = provsFor(d, live);
    var byRoom = S.by === "room" && (S.rooms || []).length;
    if (fl.charAt(0) === "p") provs = provs.filter(function (p) { return String(p.id) === fl.slice(2); });
    if (!byRoom && fl.charAt(0) !== "r") return provs.map(function (p) {
      var away = awayOf(p, d);
      return { key: "p" + p.id, label: plabel(p), pid: p.id, wins: away ? [] : winsOf(p, d), offs: offsOf(p, d), away: away, books: live.filter(function (b) { return b.providerId === p.id; }) };
    });
    var rooms = (S.rooms || []).slice();
    if (fl.charAt(0) === "r") rooms = rooms.filter(function (r) { return r.name === fl.slice(2); });
    var cols = rooms.map(function (r) {
      var wins = [], offs = [];
      provs.forEach(function (p) { if (awayOf(p, d)) return; var mine = winsOf(p, d).filter(function (w) { return w.room === r.id; }); if (mine.length) { wins = wins.concat(mine); offs = offs.concat(offsOf(p, d)); } });
      return { key: "r" + r.id, label: r.name, wins: wins, offs: offs, books: live.filter(function (b) { return b.roomId === r.id || (!b.roomId && b.roomName === r.name); }) };
    });
    var loose = live.filter(function (b) { return !b.roomId && !rooms.some(function (r) { return r.name === b.roomName; }); });
    if (loose.length && fl.charAt(0) !== "r") cols.push({ key: "r0", label: "No room", wins: [], offs: [], books: loose });
    return cols;
  }
  // Free stretches of a column: working windows minus bookings and blocked time; today, never before now.
  function gapsOf(col, d) {
    if (col.away) return [];
    var t = todayStr(), floor = d === t ? Math.ceil((minOf(nowHM()) + 1) / 5) * 5 : d < t ? Infinity : 0;
    var busy = col.books.map(function (b) { return [minOf(b.start), minOf(b.end)]; }).concat(col.offs.map(function (o) { return [o.a, o.b]; }));
    var out = [];
    col.wins.forEach(function (w) {
      var segs = [[Math.max(w.a, floor), w.b]];
      busy.forEach(function (x) { var nx = []; segs.forEach(function (s) { if (x[1] <= s[0] || x[0] >= s[1]) nx.push(s); else { if (x[0] > s[0]) nx.push([s[0], x[0]]); if (x[1] < s[1]) nx.push([x[1], s[1]]); } }); segs = nx; });
      segs.forEach(function (s) { if (s[1] - s[0] >= 5) out.push({ a: s[0], b: s[1], pid: w.pid }); });
    });
    out.sort(function (x, y) { return x.a - y.a; });
    // the same stretch twice (two sessions in one room): once
    return out.filter(function (g, i) { return !out.slice(0, i).some(function (h) { return h.a === g.a && h.b === g.b && h.pid === g.pid; }); });
  }
  function freeMin(cols, d) { return cols.reduce(function (n, c) { return n + gapsOf(c, d).reduce(function (m, g) { return m + g.b - g.a; }, 0); }, 0); }

  // What the customer has been told and said, in words (never colour alone).
  function remState(b) {
    if (b.status === "confirmed") return "confirmed";
    if (b.status !== "booked" || b.date < todayStr()) return "";
    if (b.date > addDays(todayStr(), 1) && (!S.mail || !S.mail.on || !b.personEmail)) return ""; // a call is for today and tomorrow, not every day ahead
    var ms = (S.messages || {})[b.id] || [], rem = ms.filter(function (m) { return /^remind/.test(m.kind); }).pop();
    if (rem && rem.status === "sent") return "reminded";
    var mail = S.mail;
    if (!b.personEmail) return "call:no e-mail";
    if (mail && !mail.on) return "call:e-mails are off";
    if (rem && rem.status === "failed") return "call:the reminder did not go";
    // still to come: the evening before (from 18:00), or the hours before on the day itself
    var t = todayStr(), comes = mail && ((b.date > t && mail.evening && !(b.date === addDays(t, 1) && minOf(nowHM()) >= 19 * 60)) || (mail.hours > 0 && (b.date > t || minOf(b.start) - mail.hours * 60 > minOf(nowHM()) - 15)));
    return comes ? "due" : "call:not reminded";
  }
  function markOf(b) {
    if (b.status === "arrived") return ["Here", "ok"];
    if (b.status === "done") return ["Done", "mut"];
    if (b.status === "no_show") return ["No-show", "bad"];
    if (b.status === "confirmed") return ["Confirmed", "ok"];
    if (b.status === "booked" && b.date < todayStr()) return ["Not marked", "mut"];
    var r = remState(b);
    if (r === "reminded") return ["Reminded", "mut"];
    if (r.indexOf("call:") === 0) return ["To call", "warn"];
    return null;
  }
  function calHtml(list) {
    var d = S.date, cols = columnsFor(d, list), t = todayStr(), past = d < t;
    if (!cols.length) return '<div class="bkx-sec"><div class="bkx-g"><div class="bkx-empty">Nobody to show. ' + (isAdmin() ? "Add a practitioner in Bookings settings › People." : "") + "</div></div></div>";
    var lo = Infinity, hi = -Infinity;
    cols.forEach(function (c) {
      c.wins.forEach(function (w) { lo = Math.min(lo, w.a); hi = Math.max(hi, w.b); });
      c.books.forEach(function (b) { lo = Math.min(lo, minOf(b.start)); hi = Math.max(hi, minOf(b.end)); });
      c.offs.forEach(function (o) { lo = Math.min(lo, o.a); hi = Math.max(hi, o.b); });
    });
    var closed = !isFinite(lo);
    if (closed) { lo = 9 * 60; hi = 13 * 60; }
    lo = Math.floor(lo / 60) * 60; hi = Math.max(lo + 60, Math.ceil(hi / 60) * 60);
    var H = (hi - lo) * PXM, y = function (m) { return (m - lo) * PXM; };
    var head = '<div class="bkx-calh"><div class="bkx-axh"></div>' + cols.map(function (c) {
      var n = c.books.length, f = past ? 0 : freeMin([c], d);
      // W33: today after the last hours have ended is over, not "full" (FIN-dayzero)
      var over = d === t && c.wins.length && c.wins.every(function (w) { return w.b <= minOf(nowHM()); });
      var sub = c.away ? "Away" + (c.away.note ? " · " + c.away.note : "") : (n ? n + " booked" : "Nothing booked") + (past || !c.wins.length ? "" : over ? " · finished for today" : " · " + (f ? dur(f) + " free" : "full"));
      return '<div class="bkx-ch"><b>' + esc(c.label) + "</b><span>" + esc(sub) + "</span></div>";
    }).join("") + "</div>";
    var axis = '<div class="bkx-ax" aria-hidden="true">';
    for (var m = lo; m < hi; m += 60) axis += '<span style="top:' + y(m) + 'px">' + hm(m) + "</span>";
    axis += "</div>";
    var nowM = minOf(nowHM());
    var body = cols.map(function (c) {
      var h = '<div class="bkx-col" style="height:' + H + 'px">';
      c.wins.forEach(function (w) { h += '<div class="bkx-open" style="top:' + y(w.a) + "px;height:" + (w.b - w.a) * PXM + 'px"></div>'; });
      if (!past) gapsOf(c, d).forEach(function (g) {
        var p = prov(g.pid) || {}, lab = "Free " + hm(g.a) + " to " + hm(g.b) + (p.name ? " with " + plabel(p) : "") + ". Book";
        h += '<button class="bkx-free" data-act="tap" data-pid="' + g.pid + '" data-a="' + g.a + '" data-b="' + g.b + '" style="top:' + y(g.a) + "px;height:" + (g.b - g.a) * PXM + 'px" aria-label="' + esc(lab) + '"><span>' + ((g.b - g.a) >= 15 ? "Free · " + hm(g.a) : "") + "</span><i>+ Book</i></button>";
      });
      c.offs.forEach(function (o) {
        h += '<button class="bkx-offb" data-act="exc" data-id="' + o.id + '" style="top:' + y(o.a) + "px;height:" + Math.max(18, (o.b - o.a) * PXM) + 'px"><b>' + esc(o.note || "Blocked") + "</b> " + hm(o.a) + "–" + hm(o.b) + "</button>";
      });
      if (c.away) h += '<button class="bkx-offb bkx-awayb" data-act="exc" data-id="' + c.away.id + '" style="top:0;height:' + H + 'px"><b>Away</b> ' + esc(c.away.note || "") + "</button>";
      c.books.forEach(function (b) {
        var s = svc(b.serviceId) || {}, a = minOf(b.start), z = Math.max(a + 10, minOf(b.end)), mk = markOf(b), ns = (S.noShows || {})[b.id], small = (z - a) * PXM < 44;
        h += '<button class="bkx-ev' + (small ? " sm" : "") + (b.status === "done" || b.status === "no_show" ? " dim" : "") + '" data-act="open" data-id="' + b.id + '" style="top:' + y(a) + "px;height:" + ((z - a) * PXM - 2) + "px;--c:" + svcColor(s) + '">' +
          "<b>" + esc(b.start) + " " + esc(b.personName) + "</b><span>" + esc(s.name || "Booking") + (b.walkIn ? " · walk-in" : "") + (b.seriesId ? " · repeats" : "") +
          (mk ? ' · <em class="' + mk[1] + '">' + mk[0] + "</em>" : "") + (ns ? ' · <em class="warn">missed ' + ns + "</em>" : "") + "</span></button>";
      });
      if (d === t && nowM >= lo && nowM <= hi) h += '<div class="bkx-now" style="top:' + y(nowM) + 'px" aria-hidden="true"></div>';
      return h + "</div>";
    }).join("");
    var lbl = "Calendar for " + longDate(d) + (closed ? ". Nobody works this day" : "");
    return '<div class="bkx-cal" role="region" aria-label="' + esc(lbl) + '" tabindex="-1" style="--cols:' + cols.length + '">' + head + '<div class="bkx-calb" style="height:' + H + 'px">' + axis + body + "</div></div>" +
      (closed && !past ? '<div class="bkx-note" style="text-align:left;margin:8px 4px 0">Nobody has hours on this day.' + (isAdmin() ? " Add hours in Bookings settings › People, or open another day." : "") + "</div>" : "");
  }
  // The line over the calendar: what the day holds, and the reminders: who was reminded, who confirmed, who to call.
  function daySumHtml(list) {
    var d = S.date, t = todayStr(), live = list.filter(function (b) { return b.date === d && b.status !== "cancelled"; });
    var cols = columnsFor(d, list), f = d < t ? 0 : freeMin(cols, d), parts = [];
    var coming = live.filter(function (b) { return b.status === "booked" || b.status === "confirmed"; });
    var h = '<div class="bkx-sum"><span>' + live.length + " booked" + (f ? " · " + dur(f) + " free" : "") + ((S.waiting || []).length ? " · " + S.waiting.length + " waiting" : "") + "</span>";
    if (d >= t && coming.length) {
      var c = { confirmed: 0, reminded: 0, call: 0, due: 0 };
      coming.forEach(function (b) { var r = remState(b); c[r.indexOf("call:") === 0 ? "call" : r] = (c[r.indexOf("call:") === 0 ? "call" : r] || 0) + 1; });
      if (c.confirmed) parts.push(c.confirmed + " confirmed");
      if (c.reminded) parts.push(c.reminded + " reminded");
      if (c.due) parts.push(c.due + " to be reminded");
      if (c.call) parts.push(c.call + " to call");
      h += '<button class="bkx-remb' + (c.call ? " warn" : "") + '" data-act="calls">' + esc(parts.join(" · ")) + "</button>";
    }
    var cancelled = list.filter(function (b) { return b.date === d && b.status === "cancelled"; }).length;
    if (cancelled) h += '<button class="bkx-dateb" data-act="cancelled" aria-expanded="' + !!S.showCancelled + '">' + cancelled + " cancelled</button>";
    return h + "</div>";
  }
  function callsHtml(sh) {
    var d = S.date, list = S.bookings.filter(function (b) { return b.date === d && (b.status === "booked" || b.status === "confirmed"); });
    var groups = [["call", "To call", "No reminder reaches them"], ["reminded", "Reminded, not confirmed yet", ""], ["due", "To be reminded by e-mail", ""], ["confirmed", "Confirmed", ""]];
    var h = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Close</button><b>Reminders · ' + esc(dayShort(d)) + '</b><span style="width:60px"></span></div>';
    if (S.mail && !S.mail.on) h += '<div class="bkx-was">E-mails are not set up here, so nobody is reminded by e-mail.' + (isAdmin() ? " Set them up in Bookings settings › Messages." : "") + "</div>";
    if (sh.err) h += '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>";
    groups.forEach(function (g) {
      var rows = list.filter(function (b) { var r = remState(b); return g[0] === "call" ? r.indexOf("call:") === 0 : r === g[0]; });
      if (!rows.length) return;
      h += '<div class="bkx-lab"><span>' + esc(g[1]) + " · " + rows.length + "</span></div><div class=\"bkx-g\" style=\"margin-bottom:16px\">" + rows.map(function (b) {
        var why = remState(b).replace(/^call:/, ""), s = svc(b.serviceId) || {};
        return '<div class="bkx-r"><div class="bkx-time">' + esc(b.start) + '</div><div class="bkx-txt"><b>' + esc(b.personName) + "</b><span>" + esc(s.name || "") + (g[0] === "call" ? " · " + esc(why) : "") + (b.confirmedVia ? " · " + (b.confirmedVia === "customer" ? "on their link" : "by phone") : "") + (b.personPhone ? " · " + telLink(b.personPhone) : "") + "</span></div>" +
          (b.status === "booked" ? '<button class="bkx-btn tint" data-act="confirm" data-id="' + b.id + '" aria-label="' + esc(b.personName + " said yes: mark confirmed") + '">Confirmed</button>' : "") + "</div>";
      }).join("") + "</div>";
    });
    if (!list.length) h += '<div class="bkx-g"><div class="bkx-empty">Nothing booked on this day.</div></div>';
    return h + '<div class="bkx-note">Called someone and they are coming? Press Confirmed beside their name.</div>';
  }
  function cancelledHtml(list) {
    var rows = list.filter(function (b) { return b.date === S.date && b.status === "cancelled"; });
    if (!S.showCancelled || !rows.length) return "";
    return '<div class="bkx-sec" style="margin-top:16px"><h2>Cancelled</h2><div class="bkx-g">' + rows.map(function (b) { return rowHtml(b, true, true); }).join("") + "</div></div>";
  }

  // ---------- old Appointments: the one-time move ----------
  // Checked once per session for the pharmacist (a dry run reads the old tables and writes nothing to them). While the
  // old screen still holds appointments that are not in Bookings, a card says how many and brings them over in one tap.
  function legKey() { var u = (E.state && E.state.user) || {}; return "eikon_bk_legacy_" + (u.org_id || "") + "_" + (u.location_id || ""); }
  async function checkLegacy() {
    if (!isAdmin() || S.legacyAsked) return; S.legacyAsked = true;
    try { if (sessionStorage.getItem(legKey()) === "0") return; } catch (e) {}
    try {
      var r = await api("/bookings/import-legacy?dry=1", { method: "POST", body: "{}" }), rp = (r && r.report) || {};
      if (rp.bookings || rp.waiting) { S.legacy = { report: rp }; paint(); }
      else { try { sessionStorage.setItem(legKey(), "0"); } catch (e) {} }
    } catch (e) {}
  }
  function legacyHtml() {
    var L = S.legacy; if (!L) return "";
    var pl = function (n, one, many) { return n + " " + (n === 1 ? one : many); };
    if (L.done) {
      var d = L.done;
      return '<div class="bkx-leg" role="status"><b>Your old appointments are in Bookings</b><div class="sub">' + esc(pl(d.bookings, "appointment", "appointments") + (d.upcoming ? ", " + d.upcoming + " still to come" : "") + (d.waiting ? ", " + pl(d.waiting, "person", "people") + " waiting" : "") +
        ". The old Appointments are unchanged. Check each person’s hours once.") + '</div><div class="bkx-legb"><button class="bkx-btn fill" data-act="leg-hours">Check hours</button><button class="bkx-btn" data-act="leg-ok">OK</button></div></div>';
    }
    var r = L.report, what = [pl(r.bookings, "appointment", "appointments") + (r.upcoming ? " (" + r.upcoming + " still to come)" : "")];
    if (r.providers) what.push(pl(r.providers, "doctor", "doctors"));
    if (r.waiting) what.push(pl(r.waiting, "person", "people") + " on the waiting list");
    var fresh = !(S.setup && S.setup.services.length);
    return '<div class="bkx-leg"><b>Bring your old appointments into Bookings</b><div class="sub">The old Appointments screen has ' + esc(joinAnd(what)) + " not in Bookings yet. " +
      (fresh ? "Doctors, hours and services come with them, so there is nothing else to set up. " : "") +
      "Eikon copies them; the old Appointments are not changed or deleted, and doing it again never copies twice.</div>" +
      (L.err ? '<div class="bkx-err" role="alert" style="margin:10px 0 0">' + esc(L.err) + "</div>" : "") +
      '<div class="bkx-legb"><button class="bkx-btn fill" data-act="leg-run"' + (L.running ? " disabled" : "") + ">" + (L.running ? "Bringing them over…" : "Bring them over") + '</button><button class="bkx-btn" data-act="leg-later">Not now</button></div></div>';
  }

  // ---------- walk-in, blocking time ----------
  function walkinHtml(sh) {
    var services = S.setup.services.filter(function (x) { return x.active; });
    var h = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Cancel</button><b>Walk-in</b><span style="width:70px"></span></div>' +
      '<div class="bkx-was">Someone at the counter now: it starts now with whoever does it and is free, and is marked Here.</div>' +
      '<div class="bkx-lab">What</div><div class="bkx-svcs">' + services.map(function (x) {
        return '<button class="bkx-svc' + (x.id === sh.serviceId ? " on" : "") + '" data-act="w-svc" data-id="' + x.id + '" aria-pressed="' + (x.id === sh.serviceId) + '"><b>' + esc(x.name) + "</b><span>" + x.durationMin + " min · " + money(x.priceCents) + "</span></button>"; }).join("") + "</div>" +
      '<div class="bkx-lab">Who</div><div class="bkx-f">' +
      '<label><span>Name</span><input id="bkx-name" name="personName" autocomplete="off" autocapitalize="words" enterkeyhint="go" value="' + esc(sh.name || "") + '" placeholder="Full name"></label>' +
      '<label><span>Mobile</span><input id="bkx-phone" name="personPhone" type="tel" inputmode="tel" autocomplete="off" enterkeyhint="go" value="' + esc(sh.phone || "") + '" placeholder="Optional"></label></div>' +
      histHtml(sh) +
      (sh.err ? '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>" : "") +
      (sh.next && sh.next.length ? '<div class="bkx-slots">' + sh.next.map(function (x, i) { return '<button class="bkx-slot" data-act="w-next" data-i="' + i + '">Book ' + esc(x.time) + "<small>" + esc((prov(x.providerId) || {}).name || x.providerName || "") + "</small></button>"; }).join("") + "</div>" : "") +
      '<button class="bkx-btn fill lg" data-act="w-go"' + (sh.saving ? " disabled" : "") + ">" + (sh.saving ? "Starting…" : "Start now") + "</button>";
    return h;
  }
  var WHY = ["Lunch", "Break", "Training", "Meeting"];
  function blockHtml(sh) {
    var provs = (S.setup.providers || []).filter(function (p) { return p.active !== false; });
    return '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Cancel</button><b>Block time</b><span style="width:70px"></span></div>' +
      '<div class="bkx-was">' + esc(longDate(sh.date)) + ". Nobody can book this time; bookings already in it stay.</div>" +
      '<div class="bkx-f"><label><span>Who</span><select id="bkx-b-pid">' + provs.map(function (p) { return '<option value="' + p.id + '"' + (p.id === sh.pid ? " selected" : "") + ">" + esc(plabel(p)) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>From</span><input id="bkx-b-from" type="time" step="300" value="' + esc(sh.from) + '"></label>' +
      '<label><span>To</span><input id="bkx-b-to" type="time" step="300" value="' + esc(sh.to) + '"></label>' +
      '<label style="align-items:flex-start;padding-top:10px;padding-bottom:10px"><span>Why</span><div class="bkx-chips">' + WHY.map(function (w) { return '<button type="button" class="bkx-chip' + (sh.note === w ? " on" : "") + '" data-act="b-why" data-w="' + w + '" aria-pressed="' + (sh.note === w) + '">' + w + "</button>"; }).join("") + "</div></label>" +
      '<label><span>Or</span><input id="bkx-b-note" value="' + esc(WHY.indexOf(sh.note) >= 0 ? "" : sh.note || "") + '" placeholder="Another reason" enterkeyhint="done"></label></div>' +
      (sh.err ? '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>" : "") +
      '<button class="bkx-btn fill lg" data-act="b-go"' + (sh.saving ? " disabled" : "") + ">" + (sh.saving ? "Blocking…" : "Block " + esc(sh.from) + "–" + esc(sh.to)) + "</button>";
  }
  function excHtml(sh) {
    var e = (S.exc || []).find(function (x) { return x.id === sh.id; }); if (!e) return "";
    var p = prov(e.providerId) || {};
    return '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Close</button><b>' + esc(e.start ? (e.note || "Blocked") : "Away") + '</b><span style="width:60px"></span></div>' +
      '<div class="bkx-g" style="padding:16px 18px;margin-bottom:16px"><div style="font-size:20px;font-weight:700">' + esc(plabel(p)) + '</div><div class="sub">' + esc(longDate(e.date)) + " · " + esc(e.start ? e.start + "–" + e.end : "all day") + (e.note && e.start ? "" : e.note ? " · " + esc(e.note) : "") + "</div></div>" +
      (sh.err ? '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>" : "") +
      (isAdmin() && e.date >= todayStr() ? '<div class="bkx-acts"><button class="bkx-btn red lg" data-act="unblock">Unblock</button></div><div class="bkx-note">Unblocking opens the time for bookings again. Bookings cancelled when it was blocked stay cancelled.</div>' : '<div class="bkx-note">' + (isAdmin() ? "A past day is shown as it was." : "Your pharmacist can change blocked time.") + "</div>");
  }
  // A customer's record here (no-shows) under the name, when it is known: from the booking or typed in New booking.
  function histHtml(sh) {
    var h = sh.hist; if (!h || !h.total) return "";
    // on a booking's own sheet, the record is the other bookings: this one is not "before"
    var me = sh.kind === "booking" ? S.bookings.find(function (x) { return x.id === sh.id; }) : null;
    var tot = h.total - (me && me.status !== "cancelled" ? 1 : 0), ns = h.noShows - (me && me.status === "no_show" ? 1 : 0);
    if (tot <= 0) return "";
    var bad = ns > 0;
    return '<div class="bkx-hist' + (bad ? " warn" : "") + '" role="status">' + (bad ? "Missed " + ns + " of " + tot + (tot === 1 ? " other booking" : " other bookings") + (h.lastNoShow ? ", last on " + esc(shortDate(h.lastNoShow)) : "") : tot + (tot === 1 ? " other booking" : " other bookings") + ", none missed") + (h.by === "name" ? " (same name)" : "") + "</div>";
  }
  async function loadHist(sh, who) {
    var q = [];
    if (who.idCard) q.push("card=" + encodeURIComponent(who.idCard));
    if (who.email) q.push("email=" + encodeURIComponent(who.email));
    if (String(who.phone || "").replace(/\D/g, "").length >= 6) q.push("phone=" + encodeURIComponent(who.phone));
    if (!q.length && String(who.name || "").trim().length >= 3) q.push("name=" + encodeURIComponent(who.name));
    var key = q.join("&"); if (!key || sh.histKey === key) return; sh.histKey = key;
    try { var r = await api("/bookings/person?" + key); if (S.sheet === sh && sh.histKey === key) { sh.hist = r; paint(); } } catch (e) {}
  }
  // The booking sheet's lines on reminders, confirmation, repeats and no-shows.
  function bookingFacts(b) {
    var out = [], ms = (S.messages || {})[b.id] || [], last = function (k) { return ms.filter(function (m) { return m.kind === k || (k === "remind" && /^remind/.test(m.kind)); }).pop(); };
    var cf = last("confirm"), rm = last("remind");
    if (b.walkIn) out.push("Walk-in");
    if (b.seriesId) { var all = S.bookings.filter(function (x) { return x.seriesId === b.seriesId && x.status !== "cancelled"; }); out.push("Repeats" + (all.length > 1 ? " · " + all.length + " in view" : "")); }
    if (b.status === "confirmed") out.push(b.confirmedVia === "customer" ? "Confirmed by the customer on their link" : b.confirmedVia === "staff" ? "Confirmed by phone" : "Confirmed");
    if (rm) out.push(rm.status === "sent" ? "Reminder e-mailed" : rm.status === "failed" ? "The reminder e-mail did not go" : "Reminder being sent");
    else if (cf) out.push(cf.status === "sent" ? "Booking e-mail sent" : cf.status === "failed" ? "The booking e-mail did not go" : "");
    var r = remState(b); if (r.indexOf("call:") === 0) out.push("To call: " + r.slice(5));
    return out.filter(Boolean);
  }

  function setupHtml() {
    // Only the pharmacist can create services (the server refuses others): staff get a plain note, not a form that fails.
    if (!isAdmin()) return '<div class="bkx-sec"><div class="bkx-g" style="padding:20px 18px;max-width:560px"><div style="font-size:20px;font-weight:700;margin-bottom:4px">Bookings is not set up yet</div><div class="sub">Your pharmacist can set it up here in a minute: one service and who does it. Until then, the old Appointments screen still works.</div>' + (E.openClassic ? '<div style="margin-top:12px"><button class="bkx-btn" data-act="old-appts">Open the old Appointments</button></div>' : "") + "</div></div>";
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
  // The calendar opens at the work: today at the hour now, another day at its first booking or session.
  function scrollCal() {
    var cal = S.mount && S.mount.querySelector(".bkx-cal"); if (!cal) return;
    var key = S.date + "|" + S.view + "|" + (S.filter || "") + "|" + S.by; if (S.calKey === key) return; S.calKey = key;
    var tgt = cal.querySelector(".bkx-now") || cal.querySelector(".bkx-ev") || cal.querySelector(".bkx-free");
    if (tgt && cal.scrollHeight > cal.clientHeight + 4) cal.scrollTop = Math.max(0, tgt.offsetTop - 60);
  }
  function paint() {
    if (!S.mount) return;
    if (E.state.activeModuleId !== "bookings") return; // left before a reply came back: do not draw over the next screen
    keepFields(); // a name typed while the free times were still loading used to be wiped by the redraw they caused
    keepSettings(); // q6-2: what was changed in Settings survives every redraw (a save elsewhere, a tab, a reply)
    var isToday = S.date === todayStr(), now = nowHM(), pastDay = S.view === "day" && S.date < todayStr();
    // With several practitioners (or rooms), the day can be narrowed to one; the choice is kept while you move between days.
    var provsAll = (S.setup && S.setup.providers || []).filter(function (p) { return p.active !== false; });
    var roomsSeen = {}; S.bookings.forEach(function (b) { if (b.roomName) roomsSeen[b.roomName] = 1; }); (S.rooms || []).forEach(function (r) { roomsSeen[r.name] = 1; });
    var fl = S.filter || "";
    var match = function (b) { return !fl || (fl.charAt(0) === "p" ? String(b.providerId) === fl.slice(2) : b.roomName === fl.slice(2)); };
    // a past day shows everything that was booked, cancelled ones too, each with what happened (read only)
    var list = S.bookings.filter(function (b) { return (pastDay || b.status !== "cancelled") && match(b); });
    var nBooked = list.filter(function (b) { return b.status !== "cancelled"; }).length;
    var hasSetup = S.setup && S.setup.services.length;
    var body = "";
    if (S.error) body = '<div class="bkx-sec"><div class="bkx-g"><div class="bkx-empty">' + esc(S.error) + "</div></div></div>";
    else if (S.setup && !hasSetup) body = legacyHtml() + setupHtml();
    else if (!S.setup) body = '<div class="bkx-sec"><div class="bkx-g"><div class="bkx-empty">Loading…</div></div></div>';
    else {
      // With several practitioners (or rooms), the calendar can be narrowed to one; the choice is kept from day to day.
      var seg = S.view === "day" && (S.rooms || []).length, rm = seg && S.by === "room";
      // the day view's People | Rooms decides what the chips narrow to; the week shows both
      var pOpts = provsAll.length > 1 && !rm ? provsAll.map(function (p) { return ["p:" + p.id, plabel(p)]; }) : [];
      var rOpts = Object.keys(roomsSeen).length > 1 && (!seg || rm) ? Object.keys(roomsSeen).sort().map(function (r) { return ["r:" + r, r]; }) : [];
      var opts = pOpts.length || rOpts.length ? [["", "Everyone"]].concat(pOpts, rOpts) : [];
      var byRoom = seg;
      body = legacyHtml() + (opts.length || byRoom ? '<div class="bkx-navrow" style="margin-bottom:12px">' + (opts.length ? '<div class="bkx-chips">' + opts.map(function (o) { return '<button class="bkx-chip' + (fl === o[0] ? " on" : "") + '" data-act="filter" data-f="' + esc(o[0]) + '" aria-pressed="' + (fl === o[0]) + '">' + esc(o[1]) + "</button>"; }).join("") + "</div>" : "") +
        (byRoom ? '<div class="bkx-seg bkx-view" style="margin-left:auto;flex:0 0 180px" role="group" aria-label="Columns"><button class="' + (S.by !== "room" ? "on" : "") + '" data-act="by" data-v="person" aria-pressed="' + (S.by !== "room") + '">People</button><button class="' + (S.by === "room" ? "on" : "") + '" data-act="by" data-v="room" aria-pressed="' + (S.by === "room") + '">Rooms</button></div>' : "") + "</div>" : "");
      if (S.view === "week") body += weekHtml(list);
      else {
        var fil = S.bookings.filter(match);
        body += daySumHtml(fil) + calHtml(S.bookings) + cancelledHtml(fil);
        if ((S.waiting || []).length) {
          var wpage = E.listPage ? E.listPage.take("bk:wait", S.waiting, {}) : { rows: S.waiting };
          body += '<div class="bkx-sec" style="margin-top:22px"><h2>Waiting</h2><div class="bkx-g">' + wpage.rows.map(function (w) {
            var sv = svc(w.serviceId) || {}, days = Math.max(0, Math.round((Date.now() - Date.parse(String(w.createdAt).replace(" ", "T") + "Z")) / 86400000));
            return '<div class="bkx-r"><div class="bkx-time" style="color:var(--l2)">' + (days ? days + "d" : "new") + '</div><div class="bkx-bar" style="background:' + svcColor(sv) + '"></div>' +
              '<div class="bkx-txt"><b>' + esc(w.personName) + "</b><span>" + esc(sv.name || "") + (w.note ? " · " + esc(w.note) : "") + (w.personPhone ? " · " + telLink(w.personPhone) : "") + "</span></div>" +
              '<button class="bkx-btn tint" data-act="wl-book" data-id="' + w.id + '">Book</button><button class="bkx-btn" data-act="wl-remove" data-id="' + w.id + '" aria-label="' + esc("Remove " + w.personName + " from the waiting list") + '">✕</button></div>';
          }).join("") + "</div>" + (E.listPage && wpage.rows.length < S.waiting.length ? E.listPage.moreHtml("bk:wait", wpage) : "") + "</div>";
        }
      }
    }
    var hadSheet = !!S.mount.querySelector(".bkx-sheet"), fk = null, sel = null;
    try { fk = focusKey(document.activeElement); sel = selOf(document.activeElement); } catch (e) {} // keyboard niceties must never stop the screen drawing
    S.mount.innerHTML = '<div class="bkx">' +
      '<div class="bkx-top"><div><h1>Bookings</h1><div class="sub">' + (hasSetup ? dateLineHtml() + " · " + nBooked + " booked" : esc(longDate(S.date))) + "</div></div>" +
      (hasSetup ? '<div class="bkx-tools">' + (isAdmin() ? '<button class="bkx-btn bkx-gear" data-act="settings" aria-label="Bookings settings" title="Settings"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></svg></button>' : "") + '<button class="bkx-walk" data-act="walkin" title="Someone at the counter now">Walk-in</button><button class="bkx-add" data-act="new" aria-label="New booking"><span class="bkx-plus" aria-hidden="true">+</span><span class="bkx-add-l">New booking</span></button></div>' : "") + "</div>" +
      (hasSetup ? navHtml() : "") +
      (hasSetup && S.view === "day" ? daysHtml() : "") + body + "</div>" + sheetHtml();
    restoreSettings();
    try { afterPaint(hadSheet, fk, sel); } catch (e) {}
    var shEl = S.sheet && (S.sheet.kind === "new" || S.sheet.kind === "walkin") && S.mount.querySelector(".bkx-sheet");
    if (shEl && E.personPick) try { E.personPick.attach({ key: "bookings", form: shEl, fields: { name: "personName", phone: "personPhone" }, onFill: function () { histFromSheet(); } }); } catch (e) {}
    scrollCal();
  }

  // The address in "Test to" (kept across redraws of the sheet); empty means the sign-in email.
  function testTo() { var el = document.getElementById("bkm-testto"); var v = el ? el.value.trim() : ""; if (S.sheet) S.sheet.testTo = v; return v; }

  // ---------- keyboard ----------
  // The screen is redrawn whole on every change, which used to drop keyboard focus back to the top of the page.
  // Focus now stays on the same control, moves into a sheet when one opens and back to what opened it when it closes.
  function focusKey(el) {
    if (!el || !S.mount || el === S.mount || !S.mount.contains(el)) return null;
    if (el.id) return "#" + cssq(el.id);
    var k = el.tagName.toLowerCase(), any = false;
    Array.prototype.forEach.call(el.attributes, function (a) { if (a.name.indexOf("data-") === 0) { k += "[" + a.name + '="' + cssq(a.value) + '"]'; any = true; } });
    return any ? k : null;
  }
  function cssq(v) { return window.CSS && window.CSS.escape ? window.CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g, function (c) { return "\\" + c; }); }
  function selOf(el) { try { return el && typeof el.selectionStart === "number" ? [el.value, el.selectionStart, el.selectionEnd] : null; } catch (e) { return null; } }
  function focusables(box) { return Array.prototype.filter.call(box.querySelectorAll("button,input:not([type=hidden]),select,textarea,a[href],[tabindex]:not([tabindex='-1'])"), function (e) { return !e.disabled && e.offsetParent !== null; }); }
  function afterPaint(hadSheet, fk, sel) {
    var sheet = S.mount.querySelector(".bkx-sheet"), act = document.activeElement;
    if (sheet) { var t = sheet.querySelector(".bkx-sh b") || sheet.querySelector("b"); sheet.setAttribute("aria-label", t ? t.textContent.trim() : "Bookings"); }
    if (sheet && !hadSheet) S.opener = fk;
    if (act && act !== document.body && !S.mount.contains(act)) return; // focus is somewhere else on the page: leave it there
    var target = null;
    try { target = fk ? S.mount.querySelector(fk) : null; } catch (e) { target = null; }
    if (sheet && !hadSheet) target = sheet; // a sheet just opened: start inside it (the sheet itself, so a phone keyboard does not pop up)
    else if (sheet && (!target || !sheet.contains(target))) target = sheet;
    else if (!sheet && hadSheet && !target) { try { target = S.opener ? S.mount.querySelector(S.opener) : null; } catch (e) { target = null; } S.opener = null; }
    if (!target || document.activeElement === target) return;
    target.focus({ preventScroll: true });
    if (sel && target.value === sel[0] && typeof target.setSelectionRange === "function") { try { target.setSelectionRange(sel[1], sel[2]); } catch (e) {} }
  }
  var nTimer = 0;
  function onKey(ev) {
    if (!S.mount || E.state.activeModuleId !== "bookings") return;
    if (nTimer) { clearTimeout(nTimer); nTimer = 0; } // another key straight after N: a scanner or typing, not the shortcut
    if (S.picking && ev.target && ev.target.id === "bkx-goto" && (ev.key === "Escape" || ev.key === "Enter")) {
      ev.preventDefault(); S.picking = false; paint();
      if (E.focusSoon) E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-act="pickdate"]'); }, 0);
      return;
    }
    // N opens New booking, as on every other screen: not while typing, with a sheet or the search open, or with a modifier
    if (!S.sheet && (ev.key === "n" || ev.key === "N") && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.isComposing && !ev.defaultPrevented) {
      var fa = document.activeElement;
      if (fa && (/^(INPUT|SELECT|TEXTAREA)$/.test(fa.tagName) || fa.isContentEditable)) return;
      if (document.querySelector(".esr-ov, [aria-modal=true]:not([hidden])")) return;
      nTimer = setTimeout(function () {
        nTimer = 0; if (S.sheet || !S.mount || E.state.activeModuleId !== "bookings") return;
        var nb = (E.mainButton && E.mainButton(S.mount)) || S.mount.querySelector('[data-act="new"]'); if (nb) nb.click();
      }, 90);
      return;
    }
    if (!S.sheet) return;
    var sheet = S.mount.querySelector(".bkx-sheet"); if (!sheet) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (S.sheet.kind === "settings") { if (S.sheet.ask) { S.sheet.ask = null; return paint(); } return closeSettings(); } // Escape on the question: back to editing
      if (S.sheet.kind === "new") keepNewDraft();
      if (S.sheet.kind === "move") { S.sheet = { kind: "booking", id: S.sheet.id, b: S.sheet.b, card: S.sheet.card }; paint(); return; } // Escape steps back to the booking
      S.sheet = null; paint(); return;
    }
    if (ev.key === "Enter" && !ev.isComposing && ev.target && ev.target.tagName === "INPUT" && sheet.contains(ev.target)) {
      // Enter in a field does what the big button says: book, add to the waiting list, or cancel (a choice in the people list is taken first, by the list)
      var go = sheet.querySelector('[data-act="docancel"]') || sheet.querySelector('[data-act="book"]') || sheet.querySelector('[data-act="w-go"]') || sheet.querySelector('[data-act="b-go"]');
      if (go && !go.disabled && (ev.target.id === "bkx-reason" || /^bkx-(name|phone|email|b-note|b-from|b-to)$/.test(ev.target.id))) { ev.preventDefault(); go.click(); }
      return;
    }
    if (ev.key !== "Tab") return;
    var f = focusables(sheet); if (!f.length) return;
    var a = document.activeElement, first = f[0], last = f[f.length - 1];
    if (!sheet.contains(a)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && (a === first || a === sheet)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && a === last) { ev.preventDefault(); first.focus(); }
  }

  // ---------- sheets ----------
  function sheetHtml() {
    var sh = S.sheet; if (!sh) return "";
    var inner = "";
    if (sh.kind === "new") {
      // From a tap on the calendar (sh.day, sh.pid): that person's services and that day's free times, the one under
      // the finger chosen. Otherwise the next free times from today, whoever is free.
      var services = S.setup.services.filter(function (x) { return x.active && (!sh.pid || (x.providerIds || []).indexOf(sh.pid) >= 0); });
      var chosen = svc(sh.serviceId), sp = sh.pid && prov(sh.pid);
      var waitFor = sh.waitlistId ? [] : (S.waiting || []).filter(function (w) { return w.serviceId === sh.serviceId; });
      var rp = Number(sh.repeat) || 0, rn = Number(sh.repeatN) || 6, every = ["", "every week", "every 2 weeks", "every 3 weeks", "every 4 weeks"][rp / 7] || "";
      inner = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Cancel</button><b>New booking</b><span style="width:70px"></span></div>' +
        (sh.back ? '<p class="bkx-back" role="status"><span>Your unsaved booking is back</span><span aria-hidden="true">·</span><button type="button" data-act="draft-clear">Clear</button></p>' : "") +
        '<div class="bkx-lab">What</div><div class="bkx-svcs">' + services.map(function (x) {
          return '<button class="bkx-svc' + (x.id === sh.serviceId ? " on" : "") + '" data-act="svc" data-id="' + x.id + '"><b>' + esc(x.name) + "</b><span>" + x.durationMin + " min · " + money(x.priceCents) + "</span></button>"; }).join("") + "</div>" +
        '<div class="bkx-lab" style="align-items:center"><span>When' + (sh.day ? " · " + esc(shortDate(sh.day)) + (sp ? " with " + esc(plabel(sp)) : "") : "") + "</span>" + (sh.day ? '<button class="bkx-link" data-act="anyday" style="text-transform:none;letter-spacing:0;min-height:32px">Any day</button>' : (sh.slot ? "<b style=\"color:var(--t);text-transform:none;letter-spacing:0\">" + esc((prov(sh.slot.providerId) || {}).name || "") + "</b>" : "")) + "</div>" +
        '<div class="bkx-slots">' + (sh.slotsLoading ? '<span class="sub">Finding free times…</span>' : (sh.slots || []).length ? sh.slots.map(function (x, i) {
          var on = sh.slot && sh.slot.date === x.date && sh.slot.time === x.time && sh.slot.providerId === x.providerId;
          return '<button class="bkx-slot' + (on ? " on" : "") + '" data-act="slot" data-i="' + i + '" aria-pressed="' + !!on + '">' + esc(x.time) + (sh.day ? "" : "<small>" + esc(dayShort(x.date)) + "</small>") + "</button>"; }).join("") : '<span class="sub">' + (sh.day ? "No free time for this on " + esc(shortDate(sh.day)) + (sp ? " with " + esc(plabel(sp)) : "") + ". Press Any day." : "No free times in the next three weeks.") + "</span>") + "</div>" +
        // Repeat: the same time every week (or 2, 3, 4 weeks), a few times. Weekly injections, B12, dressings.
        '<div class="bkx-rep"><label for="bkx-rep" class="sub" style="font-weight:600">Repeat</label><select id="bkx-rep">' + [[0, "Just once"], [7, "Every week"], [14, "Every 2 weeks"], [21, "Every 3 weeks"], [28, "Every 4 weeks"]].map(function (o) { return '<option value="' + o[0] + '"' + (rp === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
        (rp ? '<select id="bkx-repn" aria-label="How many times in all">' + [2, 3, 4, 5, 6, 8, 10, 12].map(function (n) { return '<option value="' + n + '"' + (rn === n ? " selected" : "") + ">" + n + " times</option>"; }).join("") + "</select>" : "") + "</div>" +
        (waitFor.length ? '<div class="bkx-lab">Waiting for this</div><div class="bkx-wl">' + waitFor.slice(0, 6).map(function (w) { return '<button class="bkx-chip" data-act="wl-pick" data-id="' + w.id + '">' + esc(w.personName) + "</button>"; }).join("") + "</div>" : "") +
        '<div class="bkx-lab">Who</div><div class="bkx-f">' +
        '<label><span>Name</span><input id="bkx-name" name="personName" autocomplete="off" autocapitalize="words" enterkeyhint="done" value="' + esc(sh.name || "") + '" placeholder="Full name"></label>' +
        '<label><span>Mobile</span><input id="bkx-phone" name="personPhone" type="tel" inputmode="tel" autocomplete="off" enterkeyhint="done" value="' + esc(sh.phone || "") + '" placeholder="Optional"></label>' +
        '<label><span>Email</span><input id="bkx-email" name="personEmail" type="email" inputmode="email" autocapitalize="off" spellcheck="false" autocomplete="off" enterkeyhint="done" value="' + esc(sh.email || "") + '" placeholder="Optional"></label></div>' +
        histHtml(sh) +
        (sh.err ? '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>" : "") +
        '<button class="bkx-btn fill lg" data-act="book"' + (sh.saving ? " disabled" : "") + ">" + (sh.saving ? "Booking…" : sh.slot ? (rp ? "Book " + rn + " times, " + every + ", from " + esc(dayShort(sh.slot.date)) + " at " + esc(sh.slot.time) : "Book " + esc(dayShort(sh.slot.date)) + " at " + esc(sh.slot.time)) : "Book " + esc(chosen ? chosen.name.toLowerCase() : "")) /* the service is chosen just above: the button says when, on one line */ + "</button>" +
        (sh.waitlistId ? "" : '<button class="bkx-btn lg" data-act="wl-add" style="margin-top:8px">No time suits? Add to the waiting list</button>') +
        (sh.day && sh.pid && isAdmin() && sh.day >= todayStr() ? '<div style="text-align:center;margin-top:6px"><button class="bkx-link" data-act="block-here">Block this time instead (lunch, training)</button></div>' : "");
    }
    if (sh.kind === "booking") {
      var b = S.bookings.find(function (x) { return x.id === sh.id; }) || sh.b; if (!b) return ""; // sh.b: just moved to a day not on screen
      var s = svc(b.serviceId) || {}, pastB = b.date < todayStr(), canMove = !pastB && (b.status === "booked" || b.status === "confirmed");
      var stl = STATE_LABEL[b.status];
      // The name opens the customer's card when exactly one card is this person (E.people.cardOf); the phone calls.
      inner = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Close</button><b>' + (b.date !== todayStr() ? esc(shortDate(b.date)) + " " : "") + esc(b.start) + " · " + esc(s.name || "") + '</b><span style="width:60px"></span></div>' +
        '<div class="bkx-g" style="padding:16px 18px;margin-bottom:16px"><div style="font-size:20px;font-weight:700">' +
        (sh.card ? '<button class="bkx-namebtn" data-act="card" aria-label="' + esc("Open " + b.personName + "’s customer card") + '">' + esc(b.personName) + "</button>" : esc(b.personName)) + '</div><div class="sub">' +
        [telLink(b.personPhone), esc(b.personEmail || "")].filter(Boolean).join(" · ") + (b.notes ? "<br>" + esc(b.notes) : "") + '</div><div class="sub" style="margin-top:6px">Ref ' + esc(b.ref) + " · " + money(b.priceCents) + "</div>" +
        (bookingFacts(b).length ? '<div class="sub" style="margin-top:6px">' + esc(bookingFacts(b).join(" · ")) + "</div>" : "") + "</div>" +
        (sh.hist ? histHtml(sh) : (S.noShows || {})[b.id] ? '<div class="bkx-hist warn" role="status">Missed ' + S.noShows[b.id] + " bookings before</div>" : "") +
        (sh.note ? '<div class="bkx-ok" role="status">' + sh.note + "</div>" : "") +
        (pastB || b.status === "cancelled"
          // D3: a past day is read only; a cancelled booking says why
          ? '<div class="bkx-stline" style="color:' + (stl ? stl[1] : "var(--l2)") + '">' + esc(stl ? stl[0] : "Not marked") + (b.status === "cancelled" && b.cancelReason ? '<span style="color:var(--l2);font-weight:400"> · ' + esc(b.cancelReason) + "</span>" : "") + "</div>" +
            (pastB ? '<div class="bkx-note" style="text-align:left;margin:0 4px">A past day is shown as it was.</div>' : "")
          : sh.cancelling
          ? '<div class="bkx-f"><label><span>Reason</span><input id="bkx-reason" placeholder="e.g. Called to cancel" value="" enterkeyhint="done"></label></div>' + (b.personEmail ? tellHtml(b, "cancel") : "") + (sh.err ? '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>" : "") +
            '<div class="bkx-acts"><button class="bkx-btn red lg" data-act="docancel">Cancel this booking</button><button class="bkx-btn lg" data-act="nocancel">Keep it</button></div>'
          : (sh.err ? '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>" : "") + '<div class="bkx-acts">' +
            (b.status !== "arrived" && b.status !== "done" ? '<button class="bkx-btn fill lg" data-act="st" data-s="arrived">Arrived</button>' : "") +
            (b.status !== "done" ? '<button class="bkx-btn tint lg" data-act="st" data-s="done">Done</button>' : "") +
            (canMove ? '<button class="bkx-btn lg" data-act="move">Change time</button>' : "") +
            (b.status === "booked" || b.status === "confirmed" ? '<button class="bkx-btn lg" data-act="st" data-s="no_show">No-show</button>' : "") +
            ((b.status === "booked" || b.status === "confirmed") && E.tell ? '<button class="bkx-btn lg" data-act="remind">Remind ' + esc(E.tell.firstName(b.personName)) + "</button>" : "") + // d-cust: a reminder by WhatsApp, SMS or e-mail, nothing sent by itself
            '<button class="bkx-btn red lg" data-act="cancel">Cancel booking</button></div>');
    }
    if (sh.kind === "move") inner = moveHtml(sh);
    if (sh.kind === "walkin") inner = walkinHtml(sh);
    if (sh.kind === "block") inner = blockHtml(sh);
    if (sh.kind === "exc") inner = excHtml(sh);
    if (sh.kind === "calls") inner = callsHtml(sh);
    if (sh.kind === "series") {
      var sr = sh.result, first = sr.series[0] || {}, ssv = svc(first.serviceId) || {};
      inner = '<div class="bkx-sh"><span style="width:60px"></span><b>Booked ' + sr.series.length + (sr.series.length === 1 ? " time" : " times") + '</b><button class="bkx-btn" data-act="close">Done</button></div>' +
        '<div class="bkx-was">' + esc(first.personName || "") + " · " + esc(ssv.name || "") + " · " + esc(first.start || "") + "</div>" +
        '<div class="bkx-g" style="margin-bottom:16px">' + sr.series.map(function (x) { return '<div class="bkx-r"><div class="bkx-time">' + esc(x.start) + '</div><div class="bkx-txt"><b>' + esc(shortDate(x.date)) + "</b></div><em class=\"ok\">Booked</em></div>"; }).join("") + "</div>" +
        (sr.skipped.length ? '<div class="bkx-lab"><span>Not free at ' + esc(first.start || "") + " · " + sr.skipped.length + '</span></div><div class="bkx-g">' + sr.skipped.map(function (x) { return '<div class="bkx-r"><div class="bkx-txt"><b>' + esc(shortDate(x.date)) + '</b><span>Someone else is booked then</span></div><button class="bkx-btn tint" data-act="sr-find" data-d="' + esc(x.date) + '">Find a time</button></div>'; }).join("") + "</div>" : "") +
        (sh.note ? '<div class="bkx-note">' + sh.note + "</div>" : "");
    }
    if (sh.kind === "settings") inner = settingsHtml(sh);
    if (sh.kind === "offer") {
      var o = sh.offer, osv = svc(o.serviceId) || {};
      inner = '<div class="bkx-sh"><span style="width:60px"></span><b>A time just freed up</b><span style="width:60px"></span></div>' + (sh.note ? '<div class="bkx-ok" role="status">' + sh.note + "</div>" : "") +
        '<div class="bkx-g" style="padding:18px"><div style="font-size:20px;font-weight:700">' + esc(dayShort(o.date).replace(/^./, function (c) { return c.toUpperCase(); })) + " at " + esc(o.start) + '</div><div class="sub">' +
        esc(o.personName) + " is first on the waiting list for " + esc((osv.name || "this").toLowerCase()) + (o.personPhone ? " · " + esc(o.personPhone) : "") + "</div></div>" +
        (sh.err ? '<div class="bkx-err" style="margin-top:12px">' + esc(sh.err) + "</div>" : "") +
        '<div class="bkx-acts" style="margin-top:16px"><button class="bkx-btn fill lg" data-act="offer-book">Book ' + esc(o.personName.split(" ")[0]) + " at " + esc(o.start) + '</button><button class="bkx-btn lg" data-act="close">Not now</button></div>';
    }
    return '<div class="bkx-scrim" data-act="close"></div><div class="bkx-sheet bkx" role="dialog" aria-modal="true" tabindex="-1" style="padding-top:10px;min-height:0;outline:0"><div class="bkx-grab"></div>' + inner + "</div>";
  }

  // ---------- Change time (q6-2, BACKLOG6 F4) ----------
  // The free times of the booking's own service, a day at a time from the booking's day (‹ › a week, any day ahead).
  // Moving sends PATCH /bookings/:id { version, date, start } (providerId only when the time is someone else's), which
  // the server checks for a free time and, like the customer's own link, answers with the "changed" e-mail.
  function moveHtml(sh) {
    var b = S.bookings.find(function (x) { return x.id === sh.id; }) || sh.b; if (!b) return "";
    var s = svc(b.serviceId) || {}, t = todayStr(), from = sh.from, h = "";
    h += '<div class="bkx-sh"><button class="bkx-btn" data-act="move-back">Back</button><b>Change time</b><span style="width:60px"></span></div>' +
      '<div class="bkx-was">' + esc(b.personName) + " · " + esc(s.name || "") + " · now " + esc(shortDate(b.date)) + " at " + esc(b.start) + "</div>";
    h += '<div class="bkx-lab" style="align-items:center"><span>' + esc(new Date(from + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" })) + " – " + esc(new Date(addDays(from, 6) + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" })) + '</span><span style="display:flex;gap:8px">' +
      '<button class="bkx-btn bkx-arr" data-act="mv-wk" data-n="-7" aria-label="A week earlier"' + (from <= t ? " disabled" : "") + '>‹</button><button class="bkx-btn bkx-arr" data-act="mv-wk" data-n="7" aria-label="A week later">›</button></span></div>';
    h += '<div class="bkx-days" style="margin-bottom:14px">';
    for (var i = 0; i < 7; i++) {
      var d = addDays(from, i), dt = new Date(d + "T12:00:00");
      h += '<button class="bkx-day' + (d === sh.day && !sh.next ? " on" : "") + (d === t ? " now" : "") + '" data-act="mv-day" data-d="' + d + '" aria-pressed="' + (d === sh.day && !sh.next) + '" aria-label="' + esc(longDate(d)) + '"' + (d < t ? " disabled" : "") + "><small>" + dt.toLocaleDateString("en-GB", { weekday: "short" }) + "</small><b>" + dt.getDate() + "</b></button>";
    }
    h += "</div>";
    if (sh.err) h += '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>";
    h += '<div class="bkx-slots" aria-live="polite">' + (sh.loading ? '<span class="sub">Finding free times…</span>' : (sh.slots || []).length ? sh.slots.map(function (x, i) {
      var on = sh.slot && sh.slot.date === x.date && sh.slot.time === x.time && sh.slot.providerId === x.providerId, other = x.providerId !== b.providerId ? (prov(x.providerId) || {}).name || x.providerName || "" : "";
      var lab = esc(x.time) + (x.date !== sh.day || sh.next ? "<small>" + esc(dayShort(x.date)) + "</small>" : "") + (other ? "<small>" + esc(other) + "</small>" : "");
      return '<button class="bkx-slot' + (on ? " on" : "") + '" data-act="mv-slot" data-i="' + i + '" aria-pressed="' + !!on + '">' + lab + "</button>";
    }).join("") : '<span class="sub">No free times on ' + esc(longDate(sh.day)) + ". Try another day.</span>") + "</div>";
    h += mailHtml(b);
    h += '<button class="bkx-btn fill lg" data-act="mv-go"' + (sh.saving || !sh.slot ? " disabled" : "") + ">" + (sh.saving ? "Moving…" : sh.slot ? "Move to " + esc(shortDate(sh.slot.date)) + " at " + esc(sh.slot.time) : "Choose a new time") + "</button>";
    return h;
  }
  // Who is told, said before the move: the server e-mails every moved booking that has an e-mail (D2), when this
  // pharmacy can send. The tick shows it and cannot be taken off: the server has no way yet to move without telling.
  function mailHtml(b) {
    var call = b.personPhone ? ", so call them: " + telLink(b.personPhone) : ", and no phone on this booking";
    if (!b.personEmail) return '<div class="bkx-mail"><span>' + esc(b.personName) + " has no e-mail" + call + "</span></div>";
    var ms = S.mailState;
    if (ms && ms.canSend === false) return '<div class="bkx-mail"><span>E-mails are not set up at this pharmacy, so ' + esc(b.personName) + " is not told" + (b.personPhone ? ". Call them: " + telLink(b.personPhone) : "") + '.<small>Set up e-mails in Bookings settings › Messages.</small></span></div>';
    return tellHtml(b, "move");
  }
  // "Tell the customer by e-mail", on unless the pharmacist is telling them now (on the phone, at the counter): then the
  // move or cancel is sent with notify: false and no e-mail goes.
  function tellHtml(b, what) {
    var on = !(S.sheet && S.sheet.noTell);
    return '<label class="bkx-mail"><input type="checkbox"' + (on ? " checked" : "") + ' id="bkx-tell"><span>Tell the customer by e-mail<small>' + esc(b.personEmail) + " · untick if you are telling them yourself</small></span></label>";
  }
  // Can this pharmacy send e-mails? Only the pharmacist can read that (Settings › Messages); for others it is learnt
  // from the server's answer to the move.
  async function loadMailState() {
    if (!isAdmin()) return;
    if (S.mailState && Date.now() - S.mailState.at < 5 * 60000) return;
    try {
      var st = (await api("/bookings/settings")).settings || {}, sn = (await api("/bookings/senders")).senders || [];
      S.mailState = { at: Date.now(), canSend: st.provider !== "off" && !!st.canSend && sn.some(function (x) { return x.enabled && x.hasKey && (x.fromEmail || st.fromEmail); }) };
    } catch (e) { S.mailState = null; }
  }
  async function loadMoveSlots(sh) {
    var b = S.bookings.find(function (x) { return x.id === sh.id; }) || sh.b; if (!b) return;
    sh.loading = true; sh.next = false; sh.slot = null; paint();
    var day = sh.day, got = [];
    try { got = (await api("/bookings/slots?service_id=" + b.serviceId + "&date=" + day)).slots || []; }
    catch (e) { sh.err = errMsg(e); }
    if (S.sheet !== sh || sh.day !== day) return;
    // one button a time, the booking's own practitioner first when they are free then; never the time it has now
    var byTime = {};
    got.forEach(function (x) {
      if (day === b.date && x.time === b.start && x.providerId === b.providerId) return;
      var cur = byTime[x.time]; if (!cur || (x.providerId === b.providerId && cur.providerId !== b.providerId)) byTime[x.time] = x;
    });
    sh.slots = Object.keys(byTime).sort().map(function (k) { var x = byTime[k]; return { date: day, time: x.time, providerId: x.providerId, providerName: x.providerName }; });
    sh.loading = false; paint();
  }
  function moveToast(b, u) {
    var when = "Moved to " + shortDate(u.date) + " at " + u.start, who = b.personName, ph = b.personPhone;
    var call = ph ? ": call " + ph : "";
    return when + ({ sent: " · " + who + " is told by e-mail", "not-told": " · no e-mail sent", "no-email": " · " + who + " has no e-mail" + call, off: " · e-mails are not set up" + call,
      "opted-out": " · " + who + " asked for no e-mails" + call, failed: " · the e-mail did not go" + call, error: " · the e-mail did not go" + call })[u.message || ""] || when;
  }

  function settingsHtml(sh) {
    var tabs = [["services", "Services"], ["hours", "People"], ["rooms", "Rooms"], ["messages", "Messages"]];
    var h = '<div class="bkx-sh"><button class="bkx-btn" data-act="close">Done</button><b>Bookings settings</b><span style="width:60px"></span></div>' +
      '<div class="bkx-seg">' + tabs.map(function (t) { return '<button class="' + (sh.tab === t[0] ? "on" : "") + '" data-act="tab" data-t="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
    if (sh.ask) h += '<div class="bkx-ask" role="alert"><span>You changed ' + esc(joinAnd(sh.ask.items.map(function (x) { return x.label; }))) + '.</span>' +
      '<span class="bkx-ask-b"><button class="bkx-btn fill" data-act="ask-save">Save</button><button class="bkx-btn red" data-act="ask-drop">Throw away</button></span></div>';
    if (sh.err) h += '<div class="bkx-err" role="alert">' + esc(sh.err) + "</div>";
    if (sh.okMsg) h += '<div class="bkx-ok" role="status">' + esc(sh.okMsg) + "</div>";
    var provs = S.setup.providers;
    if (sh.tab === "services") {
      var list = S.setup.services.concat(sh.newService ? [{ id: 0, name: "", durationMin: 15, priceCents: 0, active: true, providerIds: provs.length ? [provs[0].id] : [] }] : []);
      h += list.map(function (x) {
        return '<div class="bkx-f" data-svc="' + x.id + '">' +
          '<label><span>Name</span><input data-k="name" value="' + esc(x.name) + '" placeholder="e.g. Blood pressure"></label>' +
          '<label><span>Minutes</span><input data-k="dur" type="number" min="5" max="480" value="' + x.durationMin + '"></label>' +
          '<label><span>Price €</span><input data-k="price" type="number" min="0" step="0.5" value="' + (x.priceCents / 100) + '"></label>' +
          '<label style="align-items:flex-start;padding-top:12px;padding-bottom:12px"><span>Who</span><div class="bkx-chips">' + provs.map(function (p) { var on = ((sh.chipDraft && sh.chipDraft[x.id]) || x.providerIds || []).indexOf(p.id) >= 0; return '<button type="button" class="bkx-chip' + (on ? " on" : "") + '" data-act="chip" data-pid="' + p.id + '" aria-pressed="' + on + '">' + esc(plabel(p)) + "</button>"; }).join("") + "</div></label>" +
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
          '<label><span>Name</span><input id="bkm-name" value="' + esc(m.fromName) + '" placeholder="Your pharmacy"></label>' +
          // Tests go where you say: the sign-in email can be a made-up address that a stranger owns.
          '<label><span>Test to</span><input id="bkm-testto" type="email" inputmode="email" autocomplete="email" value="' + esc(sh.testTo != null ? sh.testTo : ((E.state.user || {}).email || "")) + '" placeholder="Your own email"></label></div>';
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
          '<div class="bkx-acts"><button class="bkx-btn fill lg" data-act="msg-save">Save</button><button class="bkx-btn lg" data-act="msg-test">Send a test</button></div>';
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

  // A tab of the same settings sheet: what was changed on another tab is kept (q6-2), not thrown away.
  async function openSettings(tab) {
    var sh = S.sheet && S.sheet.kind === "settings" ? S.sheet : null;
    if (sh) { keepSettings(); sh.tab = tab || "services"; sh.err = sh.okMsg = ""; sh.ask = null; }
    else sh = S.sheet = { kind: "settings", tab: tab || "services" };
    paint();
    await loadTab(sh);
  }
  async function loadTab(sh) {
    if (sh.tab === "hours" || sh.tab === "rooms") { try { sh.rooms = (await api("/bookings/rooms")).rooms; } catch (e) { sh.rooms = sh.rooms || []; } if (S.sheet === sh) paint(); }
    if (sh.tab === "messages") {
      try { sh.msg = (await api("/bookings/settings")).settings; sh.senders = (await api("/bookings/senders")).senders; } catch (e) { sh.err = errMsg(e); }
      if (S.sheet === sh) paint();
    }
  }

  // ---------- settings: nothing changed is thrown away (q6-2, BACKLOG6 F3) ----------
  // Every field of the settings sheet has a key (its card and its place in it). Before each redraw the fields that
  // differ from what they were drawn with are noted in sh.kept, and put back after it while the field is drawn with
  // the same starting value (so a value the server changed wins, and a card just saved shows what it saved).
  // Done, the scrim and Escape ask first when anything is changed and not saved: "You changed Maria Borg's hours.
  // Save · Throw away". Save runs each card's own Save button, so the bodies sent are the ones Save always sent.
  function setKey(el) {
    if (el.id) return el.id === "bkm-testto" ? "" : "#" + el.id; // the test address is not a setting (kept in sh.testTo)
    var k = el.getAttribute("data-k"), box = el.closest && el.closest("[data-prov],[data-svc],[data-room]"); if (!k || !box) return "";
    var pre = box.hasAttribute("data-prov") ? "prov:" + box.getAttribute("data-prov") : box.hasAttribute("data-svc") ? "svc:" + box.getAttribute("data-svc") : "room:" + box.getAttribute("data-room");
    return pre + ":" + k + ":" + (el.getAttribute("data-d") || "") + ":" + (el.getAttribute("data-i") || "");
  }
  function fieldNow(el) { return /^(checkbox|radio)$/i.test(el.type || "") ? el.checked : el.value; }
  function fieldWas(el) {
    if (/^(checkbox|radio)$/i.test(el.type || "")) return el.defaultChecked;
    if (el.tagName === "SELECT") { for (var i = 0; i < el.options.length; i++) if (el.options[i].defaultSelected) return el.options[i].value; return el.options.length ? el.options[0].value : ""; }
    return el.defaultValue;
  }
  function sheetFields() { var box = S.mount && S.mount.querySelector(".bkx-sheet"); return box ? Array.prototype.slice.call(box.querySelectorAll("input,select,textarea")) : []; }
  function keepSettings() {
    var sh = S.sheet; if (!sh || sh.kind !== "settings") return;
    sh.kept = sh.kept || {};
    sheetFields().forEach(function (el) { var k = setKey(el); if (!k) return; var v = fieldNow(el), d = fieldWas(el); if (v !== d) sh.kept[k] = { was: d, now: v }; else delete sh.kept[k]; });
    (sh.dropKept || []).forEach(function (pre) { Object.keys(sh.kept).forEach(function (k) { if (k.indexOf(pre) === 0) delete sh.kept[k]; }); });
    sh.dropKept = [];
  }
  function restoreSettings() {
    var sh = S.sheet; if (!sh || sh.kind !== "settings" || !sh.kept) return;
    sheetFields().forEach(function (el) {
      var k = setKey(el), x = k && sh.kept[k]; if (!x) return;
      if (fieldWas(el) !== x.was) { delete sh.kept[k]; return; } // drawn with another value now (saved, or changed elsewhere): that stands
      if (typeof x.now === "boolean") el.checked = x.now; else el.value = x.now;
    });
  }
  // Forget what was kept for a card, after it was saved, cancelled or redrawn from its draft.
  function dropKept(pre) { var sh = S.sheet; if (!sh || sh.kind !== "settings") return; (sh.dropKept = sh.dropKept || []).push(pre); }
  function hoursOf(h) { var o = {}; for (var d = 0; d < 7; d++) { var ws = (h && (h[d] || h[String(d)])) || []; if (ws.length) o[d] = ws.map(function (w) { return w[2] ? [w[0], w[1], Number(w[2])] : [w[0], w[1]]; }); } return JSON.stringify(o); }
  function joinAnd(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  // What is changed and not saved, one line each: { label, tab, sel } (sel: the button that saves it).
  function unsaved() {
    var sh = S.sheet; if (!sh || sh.kind !== "settings") return [];
    keepSettings();
    var out = [], seen = {}, add = function (key, label, tab, sel) { if (seen[key]) return; seen[key] = 1; out.push({ label: label, tab: tab, sel: sel }); };
    var provHours = {};
    Object.keys(sh.kept || {}).forEach(function (k) { var m = /^prov:(\d+):(from|to|room):/.exec(k); if (m) provHours[m[1]] = 1; });
    Object.keys(sh.pdraft || {}).forEach(function (pid) { var p = prov(Number(pid)), d = sh.pdraft[pid]; if (p && hoursOf(d.hours) !== hoursOf(p.hours)) provHours[pid] = 1; });
    var provDetails = {};
    Object.keys(sh.kept || {}).forEach(function (k) { var m = /^prov:(\d+):(title|name|speciality):/.exec(k); if (m) provDetails[m[1]] = 1; });
    Object.keys(sh.pdraft || {}).forEach(function (pid) { var p = prov(Number(pid)), d = sh.pdraft[pid]; if (p && (d.title !== (p.title || "") || d.name !== p.name || d.speciality !== (p.speciality || ""))) provDetails[pid] = 1; });
    (S.setup.providers || []).forEach(function (p) {
      if (!provHours[p.id] && !provDetails[p.id]) return;
      add("prov" + p.id, plabel(p) + "’s " + (provHours[p.id] ? "hours" : "details"), "hours", '[data-act="hours-save"][data-id="' + p.id + '"]');
    });
    var svcs = {};
    Object.keys(sh.kept || {}).forEach(function (k) { var m = /^svc:(\d+):/.exec(k); if (m) svcs[m[1]] = 1; });
    Object.keys(sh.chipDraft || {}).forEach(function (sid) { var x = svc(Number(sid)), a = (sh.chipDraft[sid] || []).slice().sort().join(), b = ((x && x.providerIds) || []).slice().sort().join(); if (!x || a !== b) svcs[sid] = 1; });
    Object.keys(svcs).forEach(function (sid) { var x = svc(Number(sid)); if (Number(sid) && !x) return; if (!Number(sid) && !sh.newService) return; add("svc" + sid, x ? "the " + x.name + " service" : "the new service", "services", '[data-act="svc-save"][data-id="' + sid + '"]'); });
    Object.keys(sh.kept || {}).forEach(function (k) {
      var m = /^room:(\d+):/.exec(k);
      if (m) { var r = (sh.rooms || []).find(function (x) { return String(x.id) === m[1]; }); add("room" + m[1], "the room " + ((r && r.name) || ""), "rooms", '[data-act="room-save"][data-id="' + m[1] + '"]'); }
      if (k === "#room-new") add("room-new", "the new room", "rooms", '[data-act="room-add"]');
      if (/^#np-/.test(k) && sh.addingPerson) add("np", "the new practitioner", "hours", '[data-act="np-save"]');
      if (/^#bks-/.test(k) && sh.adding) add("snd", "the new sender", "messages", '[data-act="snd-save"]');
      if (/^#bkm-/.test(k) && sh.msg) add("msg", "the message settings", "messages", '[data-act="msg-save"]');
    });
    return out;
  }
  // Done, the scrim or Escape on the settings sheet.
  function closeSettings() {
    var sh = S.sheet, list = unsaved();
    if (!list.length) { S.sheet = null; return paint(); }
    sh.ask = { items: list }; sh.err = sh.okMsg = ""; paint();
    if (E.focusSoon) E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-act="ask-save"]'); }, 0);
  }
  // Save on the question: each changed card through its own Save, one after the other; the first refusal stops it,
  // says why next to the card, and keeps everything.
  async function saveAsked() {
    var sh = S.sheet; if (!sh || !sh.ask) return;
    var items = sh.ask.items, saved = []; sh.ask = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; if (S.sheet !== sh) return;
      if (sh.tab !== it.tab) { keepSettings(); sh.tab = it.tab; sh.err = sh.okMsg = ""; paint(); await loadTab(sh); }
      var btn = S.mount && S.mount.querySelector(".bkx-sheet " + it.sel); if (!btn) continue;
      sh.err = ""; await onClick({ target: btn });
      if (S.sheet !== sh) return;
      if (sh.err) { paint(); return; }
      saved.push(it.label);
    }
    var left = unsaved(); if (left.length) { sh.ask = { items: left }; return paint(); }
    S.sheet = null; paint(); if (saved.length) toast("Saved " + joinAnd(saved));
  }
  function dropAsked() {
    var sh = S.sheet; if (!sh) return;
    S.sheet = null; paint();
  }

  function keepFields() {
    if (!S.sheet) return;
    if (S.sheet.kind === "block") return readBlock(S.sheet);
    if (S.sheet.kind !== "new" && S.sheet.kind !== "walkin") return;
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    if (g("bkx-name") !== undefined) { S.sheet.name = g("bkx-name"); S.sheet.phone = g("bkx-phone"); if (g("bkx-email") !== undefined) S.sheet.email = g("bkx-email"); }
  }
  function histFromSheet() { var sh = S.sheet; if (sh && (sh.kind === "new" || sh.kind === "walkin")) { keepFields(); loadHist(sh, { email: sh.email, phone: sh.phone, name: sh.name }); } }
  async function loadSlots() {
    var sh = S.sheet; if (!sh || !sh.serviceId) return;
    sh.slotsLoading = true; paint();
    var sid = sh.serviceId, day = sh.day;
    try {
      if (day) { // a tap on the calendar: that day's free times with that person, the one nearest the tap chosen
        var r1 = await api("/bookings/slots?service_id=" + sid + "&date=" + day + (sh.pid ? "&provider_id=" + sh.pid : ""));
        sh.slots = (r1.slots || []).map(function (x) { return { date: day, time: x.time, providerId: x.providerId, providerName: x.providerName }; });
      } else { var r = await api("/bookings/next?service_id=" + sid + "&count=6"); sh.slots = r.slots || []; }
    } catch (e) { sh.slots = []; sh.err = errMsg(e); }
    if (S.sheet !== sh || sh.serviceId !== sid || sh.day !== day) return;
    sh.slotsLoading = false;
    var at = minOf(sh.at), best = null;
    if (day && isFinite(at)) sh.slots.forEach(function (x) { var dx = minOf(x.time) - at, sc = dx >= 0 ? dx : 1000 - dx; if (!best || sc < best.sc) best = { sc: sc, x: x }; });
    sh.slot = best ? best.x : sh.slots[0] || null; paint();
  }

  // A half-typed New booking closed by Escape or a tap beside it is kept for this person, today, in this tab's memory
  // only; New booking brings it back with "Your unsaved booking is back · Clear".
  function keepNewDraft() {
    var sh = S.sheet; if (!sh || sh.kind !== "new") return;
    keepFields();
    if (![sh.name, sh.phone, sh.email].some(function (v) { return String(v || "").trim(); })) { S.newDraft = null; return; }
    S.newDraft = { who: userKey(), day: todayStr(), serviceId: sh.serviceId, name: sh.name || "", phone: sh.phone || "", email: sh.email || "" };
  }
  // The customer's card for the booking's name, when exactly one card is this person (never guessed).
  async function findCard(sh) {
    var b = S.bookings.find(function (x) { return x.id === sh.id; }); if (!b || !E.people || !E.people.cardOf) return;
    var q = String(b.personPhone || b.personName || "").trim(); if (q.length < 2) return;
    try {
      var r = await api("/people?q=" + encodeURIComponent(q) + "&limit=50");
      var card = E.people.cardOf({ name: b.personName, phone: b.personPhone, email: b.personEmail, id_card: b.personIdCard }, ((r && r.people) || []).filter(function (p) { return !p.merged_into; }));
      if (card && S.sheet === sh) { sh.card = { id: card.id }; paint(); }
    } catch (e) {}
  }

  // ---------- the calendar's actions (2026-11) ----------
  // Returns false when the action is not one of these, so onClick carries on.
  async function calClick(act, t, ev) {
    var sh = S.sheet;
    if (act === "q58-more") { if (E.listPage) E.listPage.more(t.getAttribute("data-key")); return paint(); }
    if (act === "old-appts") { if (E.openClassic) E.openClassic("appointments"); return; }
    if (act === "by") { S.by = t.getAttribute("data-v") === "room" ? "room" : "person"; S.filter = ""; try { localStorage.setItem("eikon_bk_by", S.by); } catch (e) {} return paint(); }
    if (act === "cancelled") { S.showCancelled = !S.showCancelled; return paint(); }
    if (act === "calls") { S.sheet = { kind: "calls" }; return paint(); }
    if (act === "confirm") { // they said yes on the phone
      var cb = S.bookings.find(function (x) { return x.id === Number(t.getAttribute("data-id")); }); if (!cb) return;
      t.disabled = true;
      try {
        var cu = await api("/bookings/" + cb.id, { method: "PATCH", body: JSON.stringify({ version: cb.version, status: "confirmed" }) });
        S.bookings = S.bookings.map(function (x) { return x.id === cb.id ? cu.booking : x; }); toast(cb.personName + " is confirmed");
      } catch (e) { if (S.sheet) S.sheet.err = e && e.status === 409 ? "Someone else changed " + cb.personName + "’s booking. Here it is as it is now." : errMsg(e); await load({ silent: true }); }
      return paint();
    }
    // A tap on free time: New booking for that person, that day, the time under the finger (to the 5 minutes).
    if (act === "tap") {
      var pid = Number(t.getAttribute("data-pid")), a = Number(t.getAttribute("data-a")), z = Number(t.getAttribute("data-b")), at = a;
      if (ev && ev.detail && typeof ev.clientY === "number") { var rc = t.getBoundingClientRect(); at = a + Math.floor(Math.max(0, ev.clientY - rc.top) / PXM / 5) * 5; }
      at = Math.max(a, Math.min(at, z - 5));
      var mine = S.setup.services.filter(function (x) { return x.active && (x.providerIds || []).indexOf(pid) >= 0; });
      var p = prov(pid) || {};
      if (!mine.length) { toast(plabel(p) + " has no service to book yet. Add one in Bookings settings.", "error"); return; }
      var last = mine.find(function (x) { return x.id === S.lastSvc; }) || mine[0];
      S.sheet = { kind: "new", serviceId: last.id, day: S.date, pid: pid, at: hm(at), slots: [], slot: null };
      paint(); if (E.focusSoon) E.focusSoon(function () { return document.getElementById("bkx-name"); }, 30);
      return loadSlots();
    }
    if (act === "anyday") { sh.day = null; sh.pid = null; sh.at = null; sh.err = ""; return loadSlots(); }
    if (act === "wl-pick") {
      var wp = (S.waiting || []).find(function (x) { return x.id === Number(t.getAttribute("data-id")); }); if (!wp) return;
      sh.name = wp.personName; sh.phone = wp.personPhone; sh.email = wp.personEmail; sh.waitlistId = wp.id; sh.err = "";
      paint(); loadHist(sh, { email: wp.personEmail, phone: wp.personPhone, name: wp.personName }); return;
    }
    if (act === "block-here") {
      var from = sh.slot ? sh.slot.time : sh.at || "13:00";
      S.sheet = { kind: "block", pid: sh.pid, date: sh.day, from: from, to: hm(minOf(from) + 60), note: "Lunch" };
      paint(); if (E.focusSoon) E.focusSoon(function () { return document.getElementById("bkx-b-from"); }, 30); return;
    }
    if (act === "b-why") { readBlock(sh); sh.note = t.getAttribute("data-w"); sh.err = ""; return paint(); }
    if (act === "b-go") return saveBlock(sh);
    if (act === "exc") { S.sheet = { kind: "exc", id: Number(t.getAttribute("data-id")) }; return paint(); }
    if (act === "unblock") {
      var ex = (S.exc || []).find(function (x) { return x.id === sh.id; }); if (!ex) return;
      t.disabled = true;
      try { await api("/bookings/exceptions/" + ex.id, { method: "DELETE" }); S.sheet = null; toast("Unblocked: " + (ex.start ? ex.start + "–" + ex.end : "the whole day") + " can be booked again"); return load({ silent: true }); }
      catch (e) { sh.err = errMsg(e); t.disabled = false; return paint(); }
    }
    if (act === "walkin") {
      var ws = S.setup.services.filter(function (x) { return x.active; });
      S.sheet = { kind: "walkin", serviceId: (ws.find(function (x) { return x.id === S.lastSvc; }) || ws[0] || {}).id };
      paint(); if (E.focusSoon) E.focusSoon(function () { return document.getElementById("bkx-name"); }, 30); return;
    }
    if (act === "w-svc") { sh.serviceId = Number(t.getAttribute("data-id")); sh.err = ""; sh.next = null; return paint(); }
    if (act === "w-go") return saveWalkin(sh);
    if (act === "w-next") { // nobody free now: book the next free time instead, with the person filled in
      var nx = sh.next[Number(t.getAttribute("data-i"))]; if (!nx) return;
      S.sheet = { kind: "new", serviceId: sh.serviceId, slots: sh.next, slot: nx, name: sh.name, phone: sh.phone, hist: sh.hist, histKey: sh.histKey }; return paint();
    }
    if (act === "sr-find") {
      var f0 = sh.result.series[0] || {};
      S.sheet = { kind: "new", serviceId: f0.serviceId, day: t.getAttribute("data-d"), pid: f0.providerId, at: f0.start, slots: [], slot: null, name: f0.personName, phone: f0.personPhone, email: f0.personEmail };
      paint(); return loadSlots();
    }
    if (act === "leg-later") { S.legacy = null; try { sessionStorage.setItem(legKey(), "0"); } catch (e) {} return paint(); }
    if (act === "leg-ok") { S.legacy = null; return paint(); }
    if (act === "leg-hours") { S.legacy = null; return openSettings("hours"); }
    if (act === "leg-run") {
      var L = S.legacy; if (!L || L.running) return;
      L.running = true; L.err = ""; paint();
      try {
        var ir = await api("/bookings/import-legacy", { method: "POST", body: "{}" });
        S.legacy = { done: ir.report || {} }; try { sessionStorage.setItem(legKey(), "0"); } catch (e) {}
        toast("Old appointments brought over");
        await load({ setup: true, silent: true });
        if (E.focusSoon) E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-act="leg-hours"]'); }, 0);
      } catch (e) { L.running = false; L.err = errMsg(e) + ". The old appointments are as they were: try again."; paint(); }
      return;
    }
    return false;
  }
  function readBlock(sh) {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    if (g("bkx-b-pid") !== undefined) { sh.pid = Number(g("bkx-b-pid")); sh.from = g("bkx-b-from"); sh.to = g("bkx-b-to"); var n = String(g("bkx-b-note") || "").trim(); if (n) sh.note = n; }
  }
  async function saveBlock(sh) {
    readBlock(sh); if (sh.saving) return;
    var a = minOf(sh.from), z = minOf(sh.to);
    if (!isFinite(a) || !isFinite(z)) { sh.err = "Write the time it starts and ends."; return paint(); }
    if (z <= a) { sh.err = "The end must be after the start."; return paint(); }
    // bookings already in that time stay: say so before blocking, rather than leave a customer in blocked time unseen
    var clash = S.bookings.filter(function (b) { return b.date === sh.date && b.providerId === sh.pid && (b.status === "booked" || b.status === "confirmed") && minOf(b.start) < z && minOf(b.end) > a; });
    if (clash.length && !sh.clashOk) { sh.clashOk = true; sh.err = clash.map(function (b) { return b.personName + " at " + b.start; }).join(", ") + (clash.length === 1 ? " is" : " are") + " booked then and will stay booked. Press Block again to block the rest, or move them first."; return paint(); }
    sh.saving = true; sh.err = ""; paint();
    try {
      await api("/bookings/exceptions", { method: "POST", body: JSON.stringify({ providerId: sh.pid, date: sh.date, kind: "off", start: hm(a), end: hm(z), note: sh.note || "Blocked" }) });
      S.sheet = null; toast("Blocked " + hm(a) + "–" + hm(z) + " for " + plabel(prov(sh.pid) || {}) + (sh.note ? " · " + sh.note : ""));
      return load({ silent: true });
    } catch (e) { sh.saving = false; sh.err = errMsg(e); return paint(); }
  }
  async function saveWalkin(sh) {
    keepFields(); if (sh.saving) return;
    var name = String(sh.name || "").trim();
    if (!name) { sh.err = "Type the person's name."; paint(); var nm = document.getElementById("bkx-name"); if (nm) nm.focus(); return; }
    sh.saving = true; sh.err = ""; sh.next = null; paint();
    var day = todayStr(), body = { walkIn: true, serviceId: sh.serviceId, personName: name, personPhone: sh.phone || "" };
    try {
      // E.postOnce: a reply lost on a bad line is checked against today's list before anything is sent again
      var r = E.postOnce ? await E.postOnce("/bookings", body, { list: async function () { return (await api("/bookings?from=" + day + "&to=" + day)).bookings || []; }, same: function (b) { return b.walkIn && b.personName === name && b.serviceId === sh.serviceId; } })
        : await api("/bookings", { method: "POST", body: JSON.stringify(body) });
      S.lastSvc = sh.serviceId; S.sheet = null; S.date = day; S.view = "day";
      if (E.linkPerson) E.linkPerson({ name: name, phone: sh.phone }, "bookings");
      var wb = r && r.booking;
      toast(wb ? "Walk-in: " + name + " with " + ((prov(wb.providerId) || {}).name || "") + ", " + wb.start + "–" + wb.end : "Walk-in saved");
      return load({ silent: true });
    } catch (e) {
      sh.saving = false;
      var nx = e && e.bodyJson && e.bodyJson.next;
      if (e && e.status === 409) { sh.err = (e.bodyJson && e.bodyJson.error || "Nobody is free right now") + "." + (nx && nx.length ? " The next free times today:" : " Nothing else is free today."); sh.next = nx || []; }
      else sh.err = E.saveFailText ? E.saveFailText(e) : errMsg(e);
      return paint();
    }
  }
  // Repeat: one POST books them all; the ones not free come back to be found one by one.
  async function bookSeries(sh) {
    var body = { serviceId: sh.serviceId, providerId: sh.slot.providerId, date: sh.slot.date, start: sh.slot.time, personName: sh.name, personPhone: sh.phone, personEmail: sh.email, waitlistId: sh.waitlistId || undefined,
      repeat: { everyDays: Number(sh.repeat), count: Number(sh.repeatN) || 6 } };
    try {
      var r = E.postOnce ? await E.postOnce("/bookings", body, { list: async function () { return (await api("/bookings?from=" + body.date + "&to=" + body.date)).bookings || []; }, same: function (b) { return b.personName === body.personName && b.start === body.start && b.date === body.date && b.status !== "cancelled"; } })
        : await api("/bookings", { method: "POST", body: JSON.stringify(body) });
      S.lastSvc = sh.serviceId; S.newDraft = null; S.date = body.date; S.view = "day";
      if (E.linkPerson) E.linkPerson({ name: sh.name, phone: sh.phone, email: sh.email }, "bookings");
      if (r && r.series) S.sheet = { kind: "series", result: { series: r.series, skipped: r.skipped || [] }, note: r.message === "sent" ? esc(sh.name) + " is sent one e-mail with every date." : "" };
      else { S.sheet = null; toast("Booked " + sh.name); }
      return load({ silent: true });
    } catch (e) {
      sh.saving = false;
      var nx = e && e.bodyJson && e.bodyJson.next;
      if (e && e.status === 409) { sh.err = "Someone just took the first time. Here are the next free ones."; if (nx && nx.length) { sh.slots = nx; sh.slot = nx[0]; sh.day = null; sh.pid = null; } else return loadSlots(); }
      else sh.err = E.saveFailText ? E.saveFailText(e) : errMsg(e);
      return paint();
    }
  }

  // ---------- actions ----------
  async function onClick(ev) {
    var t = ev.target.closest("[data-act]"); if (!t || !S.mount.contains(t)) return;
    var act = t.getAttribute("data-act");
    keepFields();
    if (await calClick(act, t, ev) !== false) return;
    if (act === "day") { S.date = t.getAttribute("data-d"); return load({ silent: true }); }
    if (act === "wk") { S.date = addDays(S.date, Number(t.getAttribute("data-n"))); return load({ silent: true }); }
    if (act === "today") { S.date = todayStr(); return load({ silent: true }); }
    if (act === "pickdate") {
      S.picking = true; paint();
      var gi = document.getElementById("bkx-goto");
      if (gi) { try { gi.focus(); } catch (e0) {} try { if (gi.showPicker) gi.showPicker(); } catch (e1) {} }
      return;
    }
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
        S.sheet = null; toast("Booked " + rb.booking.personName + " · " + o.start); if (E.linkPerson) E.linkPerson({ name: o.personName, phone: o.personPhone, email: o.personEmail }, "bookings"); return load({ silent: true }); }
      catch (e) { S.sheet.err = e && e.status === 409 ? "Someone took that time first." : errMsg(e); return paint(); }
    }
    if (act === "view") { S.view = t.getAttribute("data-v"); return load({ silent: true }); }
    if (act === "openday") { S.view = "day"; S.date = t.getAttribute("data-d"); return load({ silent: true }); }
    if (act === "close") {
      if (S.sheet && S.sheet.kind === "settings") return closeSettings();
      if (S.sheet && S.sheet.kind === "new") { if (t.classList.contains("bkx-scrim")) keepNewDraft(); else S.newDraft = null; } // a tap beside the sheet keeps what was typed; Cancel does not
      S.sheet = null; return paint();
    }
    if (act === "draft-clear") { ["bkx-name", "bkx-phone", "bkx-email"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; }); S.newDraft = null; S.sheet.back = false; S.sheet.name = S.sheet.phone = S.sheet.email = ""; paint(); if (E.focusSoon) E.focusSoon(function () { return document.getElementById("bkx-name"); }, 0); return; }
    if (act === "card") {
      var cb = S.sheet && S.sheet.card; if (!cb) return;
      try { sessionStorage.setItem("eikon_customers_open", JSON.stringify({ id: cb.id, at: Date.now() })); } catch (e) {}
      S.sheet = null; location.hash = "#customers"; return;
    }
    if (act === "move") {
      var mb = (S.bookings.find(function (x) { return x.id === S.sheet.id; }) || S.sheet.b); if (!mb) return;
      var mday = mb.date < todayStr() ? todayStr() : mb.date;
      var msh = S.sheet = { kind: "move", id: mb.id, b: mb, day: mday, from: mday, slots: [], slot: null, card: S.sheet.card };
      paint(); await loadMailState(); if (S.sheet === msh) paint();
      return loadMoveSlots(msh);
    }
    if (act === "move-back") { S.sheet = { kind: "booking", id: S.sheet.id, b: S.sheet.b, card: S.sheet.card }; return paint(); }
    if (act === "mv-wk") {
      var wsh = S.sheet, nf = addDays(wsh.from, Number(t.getAttribute("data-n"))); if (nf < todayStr()) nf = todayStr();
      wsh.from = nf; wsh.day = nf; wsh.err = ""; return loadMoveSlots(wsh);
    }
    if (act === "mv-day") { S.sheet.day = t.getAttribute("data-d"); S.sheet.err = ""; return loadMoveSlots(S.sheet); }
    if (act === "mv-slot") { S.sheet.slot = S.sheet.slots[Number(t.getAttribute("data-i"))]; S.sheet.err = ""; return paint(); }
    if (act === "mv-go") {
      var gsh = S.sheet, gb = S.bookings.find(function (x) { return x.id === gsh.id; }) || gsh.b; if (!gb || !gsh.slot || gsh.saving) return;
      // exactly what the server takes for a move: the version it was read at, the new day and time
      var mbody = { version: gb.version, date: gsh.slot.date, start: gsh.slot.time };
      if (gsh.slot.providerId && gsh.slot.providerId !== gb.providerId) mbody.providerId = gsh.slot.providerId; // only when the time is another person's
      var tellM = document.getElementById("bkx-tell"); if (tellM && !tellM.checked) mbody.notify = false; // the pharmacist tells them
      gsh.saving = true; gsh.err = ""; paint();
      try {
        var mu = await api("/bookings/" + gb.id, { method: "PATCH", body: JSON.stringify(mbody) });
        S.bookings = S.bookings.map(function (x) { return x.id === gb.id ? (mu.booking || x) : x; });
        var said = moveToast(gb, { date: mu.booking.date, start: mu.booking.start, message: mu.message });
        var callNote = mu.message === "sent" || mu.message === "not-told" || !gb.personPhone ? "" : esc(said.replace(/: call .*$/, "")) + ": call " + telLink(gb.personPhone);
        if (mu.offer) { S.sheet = { kind: "offer", offer: mu.offer, note: callNote }; if (!callNote) toast(said); } // the time it left: to the first person waiting
        else if (!callNote) { S.sheet = null; toast(said); }
        else S.sheet = { kind: "booking", id: gb.id, b: mu.booking, card: gsh.card, note: callNote }; // the number to call stays on screen
        return load({ silent: true });
      } catch (e) {
        gsh.saving = false;
        var nx2 = e && e.bodyJson && e.bodyJson.next;
        if (e && e.status === 409 && Array.isArray(nx2)) { // the time was taken meanwhile: the next free ones, as New booking does
          gsh.err = "Someone just took that time. Here are the next free ones.";
          if (nx2.length) { gsh.slots = nx2.map(function (x) { return { date: x.date, time: x.time, providerId: x.providerId, providerName: x.providerName }; }); gsh.slot = gsh.slots[0]; gsh.next = true; }
          else { gsh.slots = []; gsh.slot = null; }
          return paint();
        }
        if (e && e.status === 409 && e.bodyJson && e.bodyJson.current) { // changed by someone else: show it as it is now
          await load({ silent: true }); S.sheet = { kind: "booking", id: gb.id, card: gsh.card, err: "Someone else changed this booking. Here it is as it is now." }; return paint();
        }
        if (e && e.status === 409) { gsh.err = "Someone just took that time. Choose another."; return loadMoveSlots(gsh); }
        gsh.err = errMsg(e); return paint();
      }
    }
    if (act === "ask-save") return saveAsked();
    if (act === "ask-drop") return dropAsked();
    if (act === "new") {
      var first = S.setup.services.filter(function (x) { return x.active; })[0];
      var dft = S.newDraft && S.newDraft.who === userKey() && S.newDraft.day === todayStr() ? S.newDraft : null;
      if (dft && !svc(dft.serviceId)) dft.serviceId = first ? first.id : null;
      S.sheet = dft ? { kind: "new", serviceId: dft.serviceId, slots: [], slot: null, name: dft.name, phone: dft.phone, email: dft.email, back: true } : { kind: "new", serviceId: first ? first.id : null, slots: [], slot: null };
      S.newDraft = null; // taken back: a save or Cancel leaves nothing behind; a tap beside it keeps it again
      paint(); if (E.focusSoon) E.focusSoon(function () { return document.getElementById("bkx-name"); }, 30);
      return loadSlots();
    }
    if (act === "svc") { S.sheet.serviceId = Number(t.getAttribute("data-id")); S.sheet.err = ""; return loadSlots(); }
    if (act === "slot") { S.sheet.slot = S.sheet.slots[Number(t.getAttribute("data-i"))]; S.sheet.err = ""; return paint(); }
    if (act === "book") {
      var sh = S.sheet;
      var noName = !String(sh.name || "").trim();
      if (!sh.slot) { sh.err = noName ? "Pick a time and type the person's name." : "Pick a time."; return paint(); }
      if (noName) { sh.err = "Type the person's name."; paint(); var nm = document.getElementById("bkx-name"); if (nm) nm.focus(); return; }
      sh.saving = true; sh.err = ""; paint();
      if (Number(sh.repeat)) return bookSeries(sh);
      try {
        var r = await api("/bookings", { method: "POST", body: JSON.stringify({ serviceId: sh.serviceId, providerId: sh.slot.providerId, date: sh.slot.date, start: sh.slot.time, personName: sh.name, personPhone: sh.phone, personEmail: sh.email, waitlistId: sh.waitlistId || undefined }) });
        S.lastSvc = sh.serviceId; S.sheet = null; S.newDraft = null; S.date = r.booking.date; if (E.linkPerson) E.linkPerson({ name: sh.name, phone: sh.phone, email: sh.email }, "bookings"); toast("Booked " + r.booking.personName + " · " + dayShort(r.booking.date) + " " + r.booking.start);
        return load({ silent: true });
      } catch (e) {
        sh.saving = false;
        var nx = e && e.bodyJson && e.bodyJson.next;
        if (e && e.status === 409) { sh.err = "Someone just took that time. Here are the next free ones."; if (nx && nx.length) { sh.slots = nx; sh.slot = nx[0]; } else { return loadSlots(); } }
        else sh.err = errMsg(e);
        return paint();
      }
    }
    if (act === "open") {
      var osh = S.sheet = { kind: "booking", id: Number(t.getAttribute("data-id")) }; paint();
      var ob = S.bookings.find(function (x) { return x.id === osh.id; });
      if (ob) loadHist(osh, { idCard: ob.personIdCard, email: ob.personEmail, phone: ob.personPhone, name: ob.personName });
      return findCard(osh);
    }
    if (act === "cancel") { S.sheet.cancelling = true; S.sheet.err = ""; paint(); setTimeout(function () { var r = document.getElementById("bkx-reason"); if (r) r.focus(); }, 30); return; }
    if (act === "remind") { var rb0 = S.bookings.find(function (x) { return x.id === S.sheet.id; }); if (rb0 && E.tell) E.tell.open({ person: { name: rb0.personName, phone: rb0.personPhone || "", email: rb0.personEmail || "" }, purpose: "booking", ref: { kind: "booking", id: rb0.id }, vars: { service: (svc(rb0.serviceId) || {}).name || "", date: rb0.date, time: rb0.start }, subtitle: (svc(rb0.serviceId) || {}).name || "", back: t }); return; }
    if (act === "nocancel") { S.sheet.cancelling = false; S.sheet.err = ""; return paint(); }
    if (act === "st" || act === "docancel") {
      var b = (S.bookings.find(function (x) { return x.id === S.sheet.id; }) || S.sheet.b); if (!b) return;
      var body = { version: b.version, status: act === "st" ? t.getAttribute("data-s") : "cancelled" };
      if (act === "docancel") { body.cancelReason = (document.getElementById("bkx-reason") || {}).value || ""; if (!body.cancelReason.trim()) { S.sheet.err = "Say why it was cancelled."; return paint(); } }
      var tellEl = document.getElementById("bkx-tell"); if (act === "docancel" && tellEl && !tellEl.checked) body.notify = false; // the pharmacist tells them
      try {
        var u = await api("/bookings/" + b.id, { method: "PATCH", body: JSON.stringify(body) });
        S.bookings = S.bookings.map(function (x) { return x.id === b.id ? u.booking : x; });
        S.sheet = null; toast(act === "docancel" ? "Cancelled" + (u.message === "sent" ? " · " + b.personName + " is told by e-mail" : u.message === "not-told" ? " · no e-mail sent" : "") : ({ arrived: "Marked as here", done: "Done", no_show: "Marked as no-show" })[body.status]);
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
        S.sheet.newService = false; S.sheet.okMsg = "Saved " + body.name; dropKept("svc:" + id + ":"); if (S.sheet.chipDraft) delete S.sheet.chipDraft[id]; await load({ setup: true, silent: true });
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "chip") {
      var on = !t.classList.contains("on"); t.classList.toggle("on", on); t.setAttribute("aria-pressed", String(on));
      var cbox = t.closest("[data-svc]"); if (cbox && S.sheet) { S.sheet.chipDraft = S.sheet.chipDraft || {}; S.sheet.chipDraft[cbox.getAttribute("data-svc")] = Array.prototype.map.call(cbox.querySelectorAll(".bkx-chip.on"), function (c) { return Number(c.getAttribute("data-pid")); }); }
      return;
    }
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
      dr.hours[wd] = list; S.sheet.pdraft = S.sheet.pdraft || {}; S.sheet.pdraft[wp] = dr; S.sheet.err = S.sheet.okMsg = ""; dropKept("prov:" + wp + ":"); // the card is drawn from its draft now
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
        delete S.sheet.pdraft[pid]; dropKept("prov:" + pid + ":"); S.sheet.okMsg = "Saved " + plabel({ title: d2.title, name: d2.name }); await load({ setup: true, silent: true });
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "away-open") { S.sheet.away = { pid: Number(t.getAttribute("data-id")), from: todayStr() }; S.sheet.err = S.sheet.okMsg = ""; return paint(); }
    if (act === "away-close") { S.sheet.away = null; dropKept("#aw-"); return paint(); }
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
    if (act === "np-cancel") { S.sheet.addingPerson = false; dropKept("#np-"); return paint(); }
    if (act === "np-save") {
      var nv = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
      S.sheet.err = "";
      try {
        await api("/bookings/providers", { method: "POST", body: JSON.stringify({ name: nv("np-name"), title: nv("np-title"), speciality: nv("np-spec"), kind: nv("np-title") ? "doctor" : "pharmacist", hours: {} }) });
        S.sheet.addingPerson = false; dropKept("#np-"); S.sheet.okMsg = "Added. Give them hours below, then choose them under Services."; await load({ setup: true, silent: true });
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "room-add" || act === "room-save") {
      S.sheet.err = S.sheet.okMsg = "";
      try {
        if (act === "room-add") await api("/bookings/rooms", { method: "POST", body: JSON.stringify({ name: (document.getElementById("room-new") || {}).value || "" }) });
        else { var rid = Number(t.getAttribute("data-id")); await api("/bookings/rooms/" + rid, { method: "PUT", body: JSON.stringify({ name: t.closest("[data-room]").querySelector('[data-k="rname"]').value }) }); }
        dropKept(act === "room-add" ? "#room-new" : "room:" + t.getAttribute("data-id") + ":"); S.sheet.rooms = (await api("/bookings/rooms")).rooms; S.sheet.okMsg = "Rooms saved";
      } catch (e) { S.sheet.err = errMsg(e); }
      return paint();
    }
    if (act === "qr") {
      // The QR encoder (MIT, vendored) loads only when asked for.
      var url2 = location.origin + "/book/" + ((S.sheet && S.sheet.msg && S.sheet.msg.publicSlug) || "");
      try {
        if (!window.qrcode) await E.loadVendor("qrcode");
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
        else if (act === "snd-cancel") { sh3.adding = null; dropKept("#bks-"); }
        else if (act === "snd-save") {
          var kd = sh3.adding.kind, nb = { kind: kd, fromEmail: gv("bks-from"), dailyCap: Number(gv("bks-cap") || 0) };
          if (kd === "smtp") { nb.smtpHost = gv("bks-host"); nb.smtpSecure = gv("bks-sec"); nb.smtpPort = nb.smtpSecure === "starttls" ? 587 : 465; nb.smtpUser = gv("bks-user"); nb.password = gv("bks-key"); }
          else nb.apiKey = gv("bks-key");
          var added = (await api("/bookings/senders", { method: "POST", body: JSON.stringify(nb) })).sender;
          sh3.adding = null; dropKept("#bks-"); await reload(); sh3.okMsg = added.label + " added. Press Test to check it.";
        } else if (act === "snd-move") {
          var ids = sh3.senders.map(function (x) { return x.id; }), i = ids.indexOf(gid), j = i + Number(t.getAttribute("data-d"));
          if (i >= 0 && j >= 0 && j < ids.length) { ids.splice(j, 0, ids.splice(i, 1)[0]); sh3.senders = (await api("/bookings/senders/order", { method: "POST", body: JSON.stringify({ ids: ids }) })).senders; }
        } else if (act === "snd-test") {
          var tr = await api("/bookings/senders/" + gid + "/test", { method: "POST", body: JSON.stringify({ to: testTo() }) }); await reload(); sh3.okMsg = "Test sent to " + tr.sentTo + " through " + tr.sender + ".";
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
        try { S.sheet.msg = (await api("/bookings/settings", { method: "PUT", body: JSON.stringify(body2) })).settings; dropKept("#bkm-"); S.sheet.okMsg = body2.provider === "off" ? "Emails are off" : "Saved. Customers with an email now get messages."; }
        catch (e) { S.sheet.err = errMsg(e); }
      } else {
        try { var r2 = await api("/bookings/settings/test", { method: "POST", body: JSON.stringify({ to: testTo() }) }); S.sheet.okMsg = "Test sent to " + r2.sentTo; }
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
    var tid = ev.target && ev.target.id;
    if (S.sheet && (tid === "bkx-rep" || tid === "bkx-repn")) { keepFields(); S.sheet[tid === "bkx-rep" ? "repeat" : "repeatN"] = Number(ev.target.value) || 0; return paint(); }
    if (S.sheet && tid === "bkx-tell") { S.sheet.noTell = !ev.target.checked; return; }
    if (S.sheet && S.sheet.kind === "block" && /^bkx-b-/.test(tid || "")) { readBlock(S.sheet); S.sheet.clashOk = false; S.sheet.err = ""; return paint(); }
    if (ev.target && ev.target.id === "bkx-goto") {
      var v = ev.target.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v === S.date) return;
      S.date = v; load({ silent: true }); return; // the box stays open while a date is being typed; leaving it closes it
    }
    if (!ev.target || ev.target.id !== "bkm-provider" || !S.sheet || !S.sheet.msg) return;
    var m = S.sheet.msg, g = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    ["fromEmail:bkm-from", "fromName:bkm-name", "address:bkm-addr", "phone:bkm-phone", "smtpHost:bkm-host", "smtpUser:bkm-user"].forEach(function (pair) {
      var kv = pair.split(":"), v = g(kv[1]); if (v !== undefined) m[kv[0]] = v; });
    m.provider = ev.target.value; paint();
  }

  // The date box closes when focus leaves it (Escape too: see onKey).
  function onFocusOut(ev) {
    if (ev.target && /^bkx-(name|phone|email)$/.test(ev.target.id || "")) { setTimeout(histFromSheet, 0); return; } // who is this: their bookings here, and any missed
    if (!ev.target || ev.target.id !== "bkx-goto") return;
    setTimeout(function () { var a = document.activeElement; if (!S.picking || (a && a.id === "bkx-goto")) return; S.picking = false; paint(); }, 0);
  }

  async function render(ctx) {
    injectCss();
    S.mount = ctx.mount; S.date = S.date || todayStr(); S.sheet = null;
    try { var w0 = JSON.parse(sessionStorage.getItem("eikon_bk_open") || "null"); if (w0 && /^\d{4}-\d{2}-\d{2}$/.test(w0.date || "")) { S.date = w0.date; S.view = "day"; } } catch (e) {} // the search opens one booking: show its day
    S.mount.addEventListener("click", onClick);
    S.mount.addEventListener("change", onChange);
    document.addEventListener("keydown", onKey);
    // Refresh when the tab comes back into view, and every minute while Bookings is on screen (q6-2, as Today does):
    // a booking made online or at another counter appears. Never while a sheet is open or a field has focus.
    S.onVis = function () { if (!document.hidden && S.mount && E.state.activeModuleId === "bookings" && !S.sheet && !S.picking) load({ silent: true, quiet: true }); };
    document.addEventListener("visibilitychange", S.onVis);
    if (S.poll) clearInterval(S.poll);
    S.poll = setInterval(function () {
      if (document.hidden || !S.mount || E.state.activeModuleId !== "bookings" || S.sheet || S.loading || S.picking) return;
      var a = document.activeElement; if (a && S.mount.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
      load({ silent: true, quiet: true });
    }, Number(window.EIKON_BK_POLL_MS) || 60000);
    S.mount.addEventListener("focusout", onFocusOut);
    await load();
  }
  function destroy() {
    if (S.mount) { S.mount.removeEventListener("click", onClick); S.mount.removeEventListener("change", onChange); S.mount.removeEventListener("focusout", onFocusOut); }
    if (S.poll) { clearInterval(S.poll); S.poll = 0; }
    S.picking = false;
    if (S.onVis) document.removeEventListener("visibilitychange", S.onVis);
    document.removeEventListener("keydown", onKey);
    S.mount = null; S.sheet = null; S.opener = null;
  }

  E.registerModule({ id: "bookings", title: "Bookings", order: 3, icon: "📅", ui2Only: true, render: render, destroy: destroy });
})();
