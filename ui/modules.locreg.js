/* Locum register, new layout: which pharmacist was in charge, when, with their registration number.
   The month by day, a quick entry form that fills a known locum's registration number, and a printout.
   Same endpoints as the classic screen (/locumregister/entries). Correct (the pharmacist only, eikon.correct.js): read
   again, the classic edit's five fields and body, a required reason, the whole line sent (the update replaces every
   column). A line is never deleted here.
   The daily registers' one pattern (eikon.dailyreg.js): today first — who is in charge now, with Sign in (the classic
   create body, time in = now, Malta time) and Sign out (the classic edit body, the whole line as read again, only the
   time out = now), each one tap; the month as a calendar with the days that had work (a reading, a cleaning or a
   daily-register line, as the Inspection check counts them) but no pharmacist, each a tap to add that day; the month's
   sign-off; the same printout. Sign in is filled in only with the signed-in pharmacist (when this register already has their reg no), never with
   a previous person. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: null, entries: [], history: [], loading: false, error: "", form: null, saving: false, work: {}, quick: null };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var FIX = { reasonPh: "e.g. Time out typed as 13:00, left at 14:30", entity: "locum_register_entries", action: "LOCUM_REGISTER_ENTRY_UPDATE",
    fields: [{ k: "entry_date", label: "Date", type: "date", req: true, what: "the date" }, { k: "time_in", label: "Time in", type: "time", req: true, what: "the time in" },
      { k: "time_out", label: "Time out", type: "time", hint: "Optional" }, { k: "locum_full_name", label: "Pharmacist", req: true, what: "the pharmacist's name" },
      { k: "registration_number", label: "Reg no", req: true, what: "the registration number" }],
    rows: function () { return S.entries; },
    reread: async function (row) {
      var months = [String(row.entry_date || "").slice(0, 7), S.month].filter(function (x, i, a) { return /^\d{4}-\d{2}$/.test(x) && a.indexOf(x) === i; });
      for (var i = 0; i < months.length; i++) {
        var r = await E.apiFetch("/locumregister/entries?month=" + encodeURIComponent(months[i]), { method: "GET" });
        var hit = ((r && r.entries) || []).filter(function (e) { return String(e.id) === String(row.id); })[0];
        if (hit) return hit;
      }
      return null;
    },
    put: function (row) { return "/locumregister/entries/" + encodeURIComponent(String(row.id)); },
    body: function (r) { return { entry_date: String(r.entry_date || ""), time_in: String(r.time_in || ""), time_out: String(r.time_out || ""), locum_full_name: String(r.locum_full_name || "").trim(), registration_number: String(r.registration_number || "").trim() }; },
    check: function (r) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.entry_date)) || String(r.entry_date) > ymd(new Date())) return "Choose the date (not a day ahead).";
      if (!/^\d{2}:\d{2}$/.test(String(r.time_in))) return "Write the time in, e.g. 08:00.";
      if (String(r.time_out || "") && !/^\d{2}:\d{2}$/.test(String(r.time_out))) return "Write the time out, e.g. 13:00, or leave it empty.";
      return "";
    },
    paint: function () { paint(); }, idle: function () { E.whenFormIdle(S.mount, paint); }, done: function () { return load(); } };
  var WDN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = String(s).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function shiftMonth(m, k) { var p = m.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(m) { var p = m.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function dayLong(s) { var d = parse(s); return s === ymd(new Date()) ? "Today" : WDN[d.getDay()].slice(0, 3) + " " + d.getDate() + " " + MON[d.getMonth()]; }
  function todayYmd() { return (E.maltaYmd && E.maltaYmd()) || ymd(new Date()); }
  function nowHm() { return (E.maltaHm && E.maltaHm()) || hmNow(); }
  // The signed-in pharmacist as a locum line already names them (name and reg no), or null.
  function selfLocum() {
    var u = E.state.user || {}, n = norm(u.full_name); if (!(u.role === "admin" || (E.isPic && E.isPic())) || !n) return null; // roles round: an admin or a pharmacist
    var hit = S.history.find(function (e) { return norm(e.locum_full_name).replace(/^(dr|pharm)\.?\s+/, "") === n.replace(/^(dr|pharm)\.?\s+/, "") && e.registration_number; });
    return hit ? { name: hit.locum_full_name, reg: hit.registration_number } : null;
  }
  function hmNow() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function css() {
    if (document.getElementById("eikon-locreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-locreg-css";
    // Shares the look of the other rebuilt registers; only what differs is here.
    st.textContent =
      ".lcr{max-width:860px;margin:0 auto}" +
      ".lcr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0;margin:-10px 0 0;cursor:pointer}" +
      ".lcr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".lcr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.lcr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".lcr-acts{display:flex;gap:8px}" +
      ".lcr-btn{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".lcr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.lcr-btn:disabled{opacity:.55;cursor:default}.lcr-btn:active:not(:disabled){opacity:.7}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .lcr-btn.p{color:#00160E}}" +
      ".lcr-form :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}.lcr-quiet .lcr-btn{margin-left:8px}" +
      ".lcr-month{display:flex;align-items:center;gap:6px;margin:18px 0 6px}.lcr-month b{font-size:17px;min-width:150px;text-align:center}" +
      ".lcr-arrow{width:34px;height:34px;border-radius:50%;border:0;background:rgba(118,118,128,.12);color:var(--text);font-size:18px;cursor:pointer}.lcr-arrow:disabled{opacity:.35;cursor:default}" +
      ".lcr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 2px 7px}" +
      ".lcr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".lcr-row{display:flex;align-items:center;gap:12px;padding:11px 16px;border-top:.5px solid var(--border)}.lcr-row:first-child{border-top:0}" +
      ".lcr-row .t{flex:1;min-width:0}.lcr-row b{display:block;font-size:14.5px;font-weight:600}.lcr-row span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".lcr-row .tm{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);white-space:nowrap}" +
      ".lcr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".lcr-form label{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border)}.lcr-form label:first-child{border-top:0}" +
      ".lcr-form label>span{flex:0 0 108px;font-size:15px;white-space:nowrap}.lcr-form label.miss{box-shadow:inset 3px 0 0 var(--danger)}.lcr-form label.miss>span{font-weight:700}.lcr-form label.miss>span::after{content:' *';color:var(--danger)}" +
      ".lcr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".lcr-form .acts{display:flex;gap:8px;padding:10px 16px 8px;justify-content:flex-end}" +
      ".lcr-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
      ".lcr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".lcr-print,.lcr-pmeta{display:none}" +
      "@media (max-width:600px){.lcr{padding:4px 16px 0}.lcr h1{font-size:32px}.lcr-form label>span{flex-basis:100px}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.lcr-back,.lcr-acts,.lcr-month,.lcr-lab,.lcr-list,.lcr-form,.lcr-note,.eikon-toast{display:none!important}" +
      ".eikon-content{padding:0!important}.lcr-pmeta{display:block;font-size:12px;margin:2px 0 8px}.lcr-print{display:table;width:100%;border-collapse:collapse;font-size:11px}" +
      ".lcr-print th,.lcr-print td{border:1px solid #999;padding:3px 6px;text-align:left}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var res = await Promise.all([S.month, shiftMonth(S.month, -1)].map(function (mo) { return E.apiFetch("/locumregister/entries?month=" + encodeURIComponent(mo), { method: "GET" }); }));
      var byNewest = function (a, b) { return (String(a.entry_date) + (a.time_in || "")) < (String(b.entry_date) + (b.time_in || "")) ? 1 : -1; };
      S.entries = ((res[0] && res[0].entries) || []).slice().sort(byNewest);
      S.history = S.entries.concat((res[1] && res[1].entries) || []);
      E.correct.loadMarks("locreg", FIX, S.month + "-01"); // which lines were corrected, by whom and why
      loadWork(S.month);
      if (S.month < thisMonth()) E.dailyReg.load(S.month, function () { E.whenFormIdle(S.mount, paint); }); // an ended month: its sign-off
    } catch (e) {
      if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
    }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  // Today first: who is in charge now (Sign out), or nobody (Sign in, the last pharmacist already filled in).
  function todayHtml() {
    if (S.month !== thisMonth() || (S.loading && !S.entries.length) || S.error) return "";
    var D = E.dailyReg, t = todayYmd(), lines = S.entries.filter(function (e) { return e.entry_date === t; });
    var open = lines.filter(function (e) { return !String(e.time_out || "").trim(); })[0], q = S.quick || {};
    if (open) return D.today({ tone: "ok", word: "In charge", title: open.locum_full_name + " since " + String(open.time_in || "").slice(0, 5), sub: "Reg no " + open.registration_number + ". Sign out when they leave.",
      acts: '<button class="dly-btn p" data-act="signout" data-id="' + esc(open.id) + '"' + (q.saving ? " disabled" : "") + ">" + (q.saving ? "Saving…" : "Sign out now") + "</button>",
      body: q.err ? '<div class="dly-msg" role="alert">' + esc(q.err) + "</div>" : "" });
    // Never a previous person (Director D7): only the signed-in pharmacist, when this register already holds their reg
    // no; otherwise both empty, with the names used here offered as suggestions.
    var me = selfLocum(), v = S.quickVals || {};
    var nm = v.quick_name != null ? v.quick_name : (me ? me.name : ""), rg = v.quick_reg != null ? v.quick_reg : (me ? me.reg : "");
    var done = lines.length ? "Signed out: " + lines.map(function (e) { return e.locum_full_name + " " + String(e.time_in || "").slice(0, 5) + "–" + String(e.time_out || "").slice(0, 5); }).join(", ") + "." : "";
    var body = '<div class="dly-line"><label class="dly-fl wide" for="lcr-qn"><span>Pharmacist</span><input id="lcr-qn" name="quick_name" autocomplete="off" list="lcr-names" placeholder="Name and surname" value="' + esc(nm) + '"' + (q.bad === "name" ? ' aria-invalid="true" aria-describedby="lcr-qmsg"' : "") + "></label>" +
      '<label class="dly-fl" for="lcr-qr"><span>Reg no</span><input id="lcr-qr" name="quick_reg" autocomplete="off" placeholder="Registration number" value="' + esc(rg) + '"' + (q.bad === "reg" ? ' aria-invalid="true" aria-describedby="lcr-qmsg"' : "") + "></label>" +
      '<button class="dly-btn p" data-act="signin"' + (q.saving ? " disabled" : "") + ">" + (q.saving ? "Saving…" : "Sign in now") + "</button>" +
      '<div class="dly-msg" id="lcr-qmsg" role="alert">' + esc(q.err || "") + "</div></div>";
    return D.today({ tone: lines.length ? "info" : "due", word: lines.length ? "Nobody now" : "Not yet", title: lines.length ? "Nobody is in charge now" : "Nobody signed in today", sub: done || "Sign in as the pharmacist in charge: today, " + nowHm() + ".", body: body });
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // Days of the month with work recorded (a reading, a cleaning, a daily-register or a controlled-drug line) but no pharmacist.
  function missed() {
    var w = S.work[S.month]; if (!w) return [];
    var t = todayYmd(), have = {}; S.entries.forEach(function (e) { have[e.entry_date] = 1; });
    return Object.keys(w).filter(function (d) { return d < t && !have[d]; }).sort();
  }
  function gapsHtml() {
    var D = E.dailyReg, w = S.work[S.month], t = todayYmd(), days = {}, miss = missed();
    if (!w) return "";
    var have = {}; S.entries.forEach(function (e) { (have[e.entry_date] = have[e.entry_date] || []).push(e); });
    var worked = Object.keys(w).filter(function (d) { return d < t; }).length;
    Object.keys(have).forEach(function (d) { days[d] = { tone: "ok", n: "✓", say: have[d].map(function (e) { return e.locum_full_name; }).join(", ") }; });
    miss.forEach(function (d) { days[d] = { tone: "miss", say: "work recorded, no pharmacist" }; });
    return D.gaps({ unit: "day", done: worked - miss.length, total: worked, missed: miss, label: "with work have a pharmacist", missLabel: "No pharmacist" }) +
      D.cal({ month: S.month, days: days, pick: true, label: "Days with a pharmacist in charge" });
  }
  // The days with work, as the Inspection check counts them: three small month reads, once per month on this page.
  function loadWork(month) {
    if (S.work[month] || S.workLoading === month) return;
    S.workLoading = month;
    var last = month + "-" + pad2(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate()), t = todayYmd(); if (last > t) last = t;
    var cd = month + "-01" > t ? Promise.resolve(null) : E.apiFetch("/dda-register/check?days_only=1&from=" + month + "-01&to=" + last, { method: "GET" }).catch(function () { return null; }); // controlled-drug days count as work (Finish round)
    Promise.all(["/temperature/entries", "/cleaning/entries", "/daily-register/entries"].map(function (p) { return E.apiFetch(p + "?month=" + encodeURIComponent(month), { method: "GET" }).catch(function () { return null; }); }).concat([cd])).then(function (rs) {
      var w = {}; rs.forEach(function (r) { ((r && r.entries) || []).forEach(function (e) { if (e.entry_date) w[e.entry_date] = 1; }); var dy = r && r.days; if (dy) (dy.supplied || []).concat(dy.received || []).forEach(function (d) { w[d] = 1; }); });
      S.work[month] = w; S.workLoading = null; if (S.month === month) E.whenFormIdle(S.mount, paint);
    });
  }

  function formHtml() {
    var f = S.form, names = {}, miss = f.missing || [];
    S.history.forEach(function (e) { if (e.locum_full_name) names[e.locum_full_name] = 1; });
    var row = function (k, label, type, ph, extra) {
      var b = miss.indexOf(k) >= 0;
      return '<label' + (b ? ' class="miss"' : "") + "><span>" + label + '</span><input name="' + k + '" type="' + type + '" placeholder="' + esc(ph) + '" value="' + esc(f[k] || "") + '"' + (extra || "") + (b ? ' aria-invalid="true" aria-describedby="lcr-err"' : "") + "></label>";
    };
    return '<form class="lcr-form" id="lcr-form" novalidate autocomplete="off" aria-label="New locum">' +
      row("entry_date", "Date", "date", "", ' max="' + esc(ymd(new Date())) + '"') +
      row("time_in", "Time in", "time", "") +
      row("time_out", "Time out", "time", "Optional") +
      row("locum_full_name", "Pharmacist", "text", "Name and surname", ' list="lcr-names"') +
      row("registration_number", "Reg no", "text", "Registration number") +
      (f.err ? '<div class="lcr-err" id="lcr-err" role="alert">' + esc(f.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="lcr-btn" data-act="cancel">Cancel</button><button type="submit" class="lcr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save locum") + "</button></div></form>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "locreg") return; // left before a reply came back: do not draw over the next screen
    var MB = E.months, user = E.state.user || {};
    var D = E.dailyReg, cur = S.month === thisMonth();
    var h = '<div class="lcr dly-page">' + D.head({ id: "locreg", title: "Locum register", sub: "Which pharmacist was in charge, and when.", acts: S.form ? "" : '<button class="dly-btn' + (cur ? "" : " p") + '" data-act="new">' + "New locum" + "</button>" }) +
      '<p class="lcr-pmeta">' + esc((user.location_name || "") + " · Locum register · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>";
    h += todayHtml() + D.nudge("locum", S.month, function () { E.whenFormIdle(S.mount, paint); });
    if (S.form) h += formHtml();
    h += MB.bar(S.month, { label: "Locum register" });
    if (!S.loading && !S.error) h += gapsHtml();
    if (S.loading && !S.entries.length) h += '<div class="lcr-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="lcr-quiet" role="alert">' + esc(S.error) + ' <button class="lcr-btn" data-act="retry">Try again</button></div>';
    else if (!S.entries.length) h += '<div class="lcr-quiet" data-empty>' + esc(MB.empty(S.month)) + "</div>";
    else {
      var day = null;
      S.entries.forEach(function (e) {
        if (e.entry_date !== day) { if (day) h += "</div>"; day = e.entry_date; h += '<div class="lcr-lab">' + esc(dayLong(day)) + '</div><div class="lcr-list">'; }
        h += '<div class="lcr-row"><div class="t"><b>' + esc(e.locum_full_name) + "</b><span>Reg no " + esc(e.registration_number) + "</span>" + E.correct.mark("locreg", e) + '</div><div class="tm">' +
          esc(e.time_in || "") + (e.time_out ? "–" + esc(e.time_out) : " onwards") + "</div>" + E.correct.button("locreg", e, e.locum_full_name + ", " + dayLong(e.entry_date) + " from " + (e.time_in || "")) + "</div>" + E.correct.panel("locreg", e, FIX);
      });
      h += "</div>";
    }
    if (!S.loading && !S.error) h += D.sign("locum", S.month, { gaps: missed().length, what: "days", changed: D.changedAfter("locum", S.month, S.entries) });
    var nmList = {}; S.history.forEach(function (e) { if (e.locum_full_name) nmList[e.locum_full_name] = 1; });
    h += '<datalist id="lcr-names">' + Object.keys(nmList).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>";
    h += D.foot();
    h += '<table class="lcr-print"><thead><tr><th>Date</th><th>Time in</th><th>Time out</th><th>Pharmacist</th><th>Reg no</th></tr></thead><tbody>' +
      (S.entries.length ? S.entries.slice().reverse().map(function (e) {
        return "<tr><td>" + esc(e.entry_date) + "</td><td>" + esc(e.time_in || "") + "</td><td>" + esc(e.time_out || "") + "</td><td>" + esc(e.locum_full_name) + "</td><td>" + esc(e.registration_number) + "</td></tr>";
      }).join("") : '<tr><td colspan="5">No locum recorded this month.</td></tr>') + "</tbody></table></div>";
    var ae = document.activeElement, keepQ = ae && m.contains(ae) && /^quick_/.test(ae.name || "") ? ae.name : "";
    if (keepQ) { S.quickVals = S.quickVals || {}; m.querySelectorAll("[name^=quick_]").forEach(function (el) { S.quickVals[el.name] = el.value; }); }
    m.innerHTML = h;
    if (keepQ) { var qe = m.querySelector("[name=" + keepQ + "]"); if (qe) qe.focus(); } // a list arriving never takes the field being typed
    bind(m);
    E.correct.wire(m, "locreg", FIX);
    D.wire(m, "locum", S.month, paint);
    MB.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; E.correct.reset("locreg"); load(); }, paint: paint, print: printMonth });
  }
  // The classic locum register printout: one line per entry, oldest first.
  function printDoc(ym, entries) {
    var MB = E.months, rows = entries.slice().sort(function (a, b) { return (String(a.entry_date) + (a.time_in || "")) < (String(b.entry_date) + (b.time_in || "")) ? 1 : -1; }).reverse(); // as the list is sorted, oldest first
    var doc = { register: "Locum register", month: ym, sections: [{ cols: ["Date", "Time in", "Time out", "Name and surname", "Registration no"],
      rows: rows.map(function (e) { return [MB.dmy(e.entry_date), e.time_in || "", e.time_out || "", e.locum_full_name || "", e.registration_number || ""]; }) }] };
    var after = E.dailyReg ? E.dailyReg.after("locum", ym) : ""; if (after) doc.after = after;
    return doc;
  }
  if (E.printDocs) E.printDocs.locreg = printDoc; // the inspection pack prints the same page
  function printMonth() { E.months.print(printDoc(S.month, S.entries)); }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("locreg") : "#registers";
        else if (a === "retry") load();
        else if (a === "signin") signIn();
        else if (a === "signout") signOut(b.getAttribute("data-id"));
        else if (a === "new") { S.form = { entry_date: ymd(new Date()), time_in: hmNow() }; paint(); E.focusSoon(function () { return m.querySelector("[name=locum_full_name]"); }, 30); }
        else if (a === "cancel") { S.form = null; paint(); var nb = m.querySelector("[data-act=new]"); if (nb) nb.focus(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "locreg"); } catch (e) {} E.openClassic("locumregister"); }
      });
    });
    m.querySelectorAll("[data-dly-day]").forEach(function (c) { // a day with work and no pharmacist: the form, on that day
      c.addEventListener("click", function () { S.form = { entry_date: c.getAttribute("data-dly-day"), time_in: "" }; paint(); E.focusSoon(function () { return m.querySelector("#lcr-form [name=time_in]"); }, 30); });
    });
    m.querySelectorAll("[name=quick_name],[name=quick_reg]").forEach(function (el) {
      el.addEventListener("input", function () { S.quickVals = S.quickVals || {}; S.quickVals[el.name] = el.value; el.removeAttribute("aria-invalid");
        if (el.name === "quick_name") { var hit = S.history.find(function (e) { return norm(e.locum_full_name) === norm(el.value) && e.registration_number; }); var rgi = m.querySelector("[name=quick_reg]"); if (hit && rgi && !rgi.value) { rgi.value = hit.registration_number; S.quickVals.quick_reg = rgi.value; } } });
      el.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); signIn(); } });
    });
    var f = m.querySelector("#lcr-form");
    if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); save(f); });
    var nm = f.querySelector("[name=locum_full_name]"), rg = f.querySelector("[name=registration_number]");
    // a locum who worked here before brings their registration number: on leaving the name, or as soon as a suggestion
    // is picked; only into an empty field, never over what was typed (E.fillEmpty)
    var fillReg = function () {
      var hit = S.history.find(function (e) { return norm(e.locum_full_name) === norm(nm.value) && e.registration_number; });
      if (!hit) return;
      if (E.fillEmpty) E.fillEmpty(f, { registration_number: hit.registration_number }); else if (!rg.value) rg.value = hit.registration_number;
    };
    nm.addEventListener("change", fillReg);
    nm.addEventListener("input", function (ev) { if (!ev.inputType || ev.inputType === "insertReplacementText") fillReg(); }); // a datalist pick
    f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.saving) { ev.preventDefault(); S.form = null; paint(); var nb = m.querySelector("[data-act=new]"); if (nb) nb.focus(); } });
  }

  // Sign in: the classic create body (the form's), today, time in = now, no time out.
  async function signIn() {
    if (S.quick && S.quick.saving) return;
    var g = function (n) { var el = S.mount && S.mount.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { entry_date: todayYmd(), time_in: nowHm(), time_out: "", locum_full_name: g("quick_name"), registration_number: g("quick_reg") };
    if (!body.locum_full_name || !body.registration_number) {
      S.quick = { err: !body.locum_full_name && !body.registration_number ? "Write the pharmacist and the registration number. Nothing was saved." : !body.locum_full_name ? "Write the pharmacist. Nothing was saved." : "Write the registration number. Nothing was saved.", bad: !body.locum_full_name ? "name" : "reg" };
      paint(); var fx = S.mount.querySelector("[name=" + (S.quick.bad === "name" ? "quick_name" : "quick_reg") + "]"); if (fx) fx.focus(); return;
    }
    S.quick = { saving: true }; paint();
    try {
      var r = await E.postOnce("/locumregister/entries", body, { list: async function () { var r0 = await E.apiFetch("/locumregister/entries?month=" + body.entry_date.slice(0, 7), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; },
        same: function (e) { return e.entry_date === body.entry_date && String(e.time_in || "").slice(0, 5) === body.time_in && norm(e.locum_full_name) === norm(body.locum_full_name); } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.quick = null; S.quickVals = null; E.toast("Signed in · " + body.locum_full_name + " from " + body.time_in, "success");
    } catch (e) { S.quick = { err: E.saveFailText(e) }; }
    await load(); focusToday();
  }
  // Sign out: the classic edit body, the whole line as the server has it now, with only the time out = now.
  async function signOut(id) {
    if (S.quick && S.quick.saving) return;
    var shown = S.entries.find(function (e) { return String(e.id) === String(id); }); if (!shown) return;
    S.quick = { saving: true }; paint();
    try {
      var cur = await FIX.reread(shown);
      if (!cur) throw new Error("This line is no longer in the register. Nothing was saved.");
      if (String(cur.time_out || "").trim()) { S.quick = null; E.toast(cur.locum_full_name + " was already signed out at " + String(cur.time_out).slice(0, 5), "warn"); await load(); return focusToday(); }
      var out = nowHm(); if (out < String(cur.time_in || "").slice(0, 5)) out = String(cur.time_in).slice(0, 5);
      var body = FIX.body(Object.assign({}, cur, { time_out: out }));
      var r = await E.apiFetch("/locumregister/entries/" + encodeURIComponent(String(cur.id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.quick = null; E.toast("Signed out · " + cur.locum_full_name + " at " + out, "success");
    } catch (e) { S.quick = { err: E.saveFailText(e) }; }
    await load(); focusToday();
  }
  function focusToday() {
    var ae = document.activeElement, h2 = S.mount && S.mount.querySelector(".dly-today h2");
    if (h2 && (!ae || ae === document.body || S.mount.contains(ae))) { h2.setAttribute("tabindex", "-1"); h2.focus({ preventScroll: true }); }
  }

  async function save(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { entry_date: v("entry_date"), time_in: v("time_in"), time_out: v("time_out"), locum_full_name: v("locum_full_name"), registration_number: v("registration_number") };
    var need = { entry_date: "the date", time_in: "the time in", locum_full_name: "the pharmacist", registration_number: "the registration number" };
    var missing = Object.keys(need).filter(function (k) { return !body[k]; }), errs = [];
    if (missing.length) errs.push("Fill in " + missing.map(function (k) { return need[k]; }).join(", "));
    if (body.entry_date && body.entry_date > ymd(new Date())) { errs.push("the date is in the future: choose today or earlier"); missing.push("entry_date"); }
    if (body.time_in && body.time_out && body.time_out < body.time_in) { errs.push("time out is before time in"); missing.push("time_out"); }
    S.form = Object.assign({}, body, { err: "", missing: missing });
    if (errs.length) { // every problem at once, each field marked, the first one focused
      S.form.err = errs.join("; ").replace(/^./, function (c) { return c.toUpperCase(); }) + ". Nothing was saved."; paint();
      var first = S.mount.querySelector('#lcr-form [name="' + missing[0] + '"]'); if (first) first.focus(); return;
    }
    S.saving = true; paint();
    try {
      var r = await E.postOnce("/locumregister/entries", body, { list: async function () { var r0 = await E.apiFetch("/locumregister/entries?month=" + body.entry_date.slice(0, 7), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; },
        same: function (e) { return e.entry_date === body.entry_date && String(e.time_in || "").slice(0, 5) === body.time_in && String(e.locum_full_name || "").trim().toLowerCase() === String(body.locum_full_name || "").trim().toLowerCase(); } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.form = null; E.toast("Saved · locum " + body.locum_full_name + " from " + body.time_in, "success");
      S.month = body.entry_date.slice(0, 7);
    } catch (e) {
      S.form.err = E.saveFailText(e);
    }
    S.saving = false;
    var saved = !S.form;
    await load();
    if (saved && S.mount && (!document.activeElement || document.activeElement === document.body)) { var nb = S.mount.querySelector("[data-act=new]"); if (nb) nb.focus({ preventScroll: true }); }
  }

  E.registerModule({
    id: "locreg", title: "Locum register", order: 3, icon: "◷", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.form = null; S.quick = null; S.quickVals = null; E.dailyReg.css(); S.month = E.months.take("locreg") || thisMonth(); S.entries = []; E.months.reset(); E.correct.reset("locreg"); css(); paint(); return E.takeOpenForm("locreg", S.mount, load(), { btn: "[data-act=new]", form: "#lcr-form" }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("locreg") < 0) E.UI2_DESTINATIONS.push("locreg");
  if (E.UI2_PARENT) E.UI2_PARENT.locreg = "registers";
})();
