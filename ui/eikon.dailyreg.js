/* ============================================================
   EIKON — the daily compliance registers' one pattern  (eikon.dailyreg.js)
   Shared by Temperature, Cleaning, Daily register, Locum register, Locum receipts and Certificates, so each one
   looks and behaves the same: the same header, today first with a one-tap "log now", the month with its gaps said
   plainly, the same sign-off and lock, the same printout. Each screen keeps its own reads, forms and saves (the
   classic bodies); this file draws, and reads/writes only the month's sign-offs.

   E.dailyReg.head({ id, title, sub, acts })      back button, title, one line, the screen's buttons
   E.dailyReg.today({ tone, word, title, sub, body, acts })
                                                  the "Today" card. tone: ok | due | late | info; word: the state in
                                                  words ("Done", "Not yet", "Overdue"), so colour is never alone
   E.dailyReg.gaps({ unit, done, total, missed, label })
                                                  one line: "29 of 31 days logged · Not logged: Mon 3 Nov, Sun 9 Nov"
   E.dailyReg.cal({ month, days, pick, label })   the month as a small calendar (Monday first). days: { ymd: { tone:
                                                  ok | none | miss | bad, n: "3", say: "3 entries" } }; a missed day is
                                                  a button (data-dly-day) when pick is true, for logging it late
   E.dailyReg.sign(reg, month, { gaps, what })    the sign-off card for an ended month (pharmacist: sign; staff: who
                                                  signs; signed: by whom, when, and that the month is locked)
   E.dailyReg.signed(reg, month)                  that month's sign-off row (from the cache) or null
   E.dailyReg.load(month, repaint)                reads the month's sign-offs once (GET /registers/signoffs?month=),
                                                  cached for this page; repaint() when they arrive
   E.dailyReg.wire(root, reg, month, repaint)     after each paint (the sign-off form)
   E.dailyReg.after(reg, month)                   the printout's "Signed off by …" line (html) when a sign-off exists, else ""
   Registers: temperature | cleaning | daily | locum (the worker also takes receipts).
   No lock (Director, 08:37): a signed-off month still takes lines and corrections as before; the card says how many
   lines were changed after the sign-off (o.changed, from updated_at). Without the route (an older worker) the card
   simply does not show.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var C = {}; // month -> { rows: { register: row }, loading, err, waiters: [] }
  var F = {}; // "reg|month" -> { note, err, saving, open }
  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { return (E.maltaYmd && E.maltaYmd()) || (function () { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); })(); }
  function thisMonth() { return today().slice(0, 7); }
  function monthName(ym) { return MON[Number(String(ym).slice(5, 7)) - 1] || ""; }
  function monthLabel(ym) { return monthName(ym) + " " + String(ym).slice(0, 4); }
  function dayShort(s) { var p = String(s).split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); return WDS[d.getDay()] + " " + d.getDate() + " " + SHORT[d.getMonth()]; }
  function niceAt(s) { // "2026-11-02 08:14:00" (UTC from the server) -> "2 Nov 2026"
    var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return "";
    var d = new Date(String(s).replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
    var y = isFinite(d) && E.maltaYmd ? E.maltaYmd(d) : m[0];
    var q = y.split("-"); return Number(q[2]) + " " + SHORT[Number(q[1]) - 1] + " " + q[0];
  }
  // Who signs off: the pharmacist in charge = an admin or a pharmacist (roles round: E.isPic, rights read once per sign-in).
  function isAdmin() { var u = E.state && E.state.user; return !!(u && (u.role === "admin" || (E.isPic && E.isPic()))); }
  var D = E.dailyReg = {};

  D.css = function () {
    if (document.getElementById("eikon-dailyreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-dailyreg-css";
    st.textContent =
      ".dly-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0;margin:-10px 0 0;cursor:pointer}" +
      ".dly-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".dly-top h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}" +
      ".dly-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".dly-acts{display:flex;gap:8px;flex-wrap:wrap}" +
      ".dly-btn{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".dly-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.dly-btn:disabled{opacity:.55;cursor:default}.dly-btn:active:not(:disabled){opacity:.7}" +
      ".dly-btn:focus-visible,.dly-back:focus-visible,.dly-cal button:focus-visible,.dly-today input:focus-visible,.dly-sign textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      // today
      ".dly-today{background:var(--panel2);border:1px solid var(--border);border-left:4px solid var(--ok);border-radius:14px;padding:14px 16px;margin-top:16px}" +
      ".dly-today.due{border-left-color:#C98A12}.dly-today.late{border-left-color:var(--danger)}.dly-today.info{border-left-color:var(--border)}" +
      ".dly-th{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.dly-th .t{flex:1;min-width:200px}" +
      ".dly-th h2{font-size:16px;font-weight:700;margin:0;line-height:1.3}.dly-th p{margin:2px 0 0;color:var(--muted);font-size:13.5px}" +
      ".dly-word{display:inline-block;font-size:11.5px;font-weight:700;letter-spacing:.02em;padding:2px 9px;border-radius:10px;margin-right:6px;vertical-align:2px;background:rgba(28,138,91,.14);color:var(--ok)}" +
      ".dly-today.due .dly-word{background:rgba(201,138,18,.16);color:#8A5A00}.dly-today.late .dly-word{background:rgba(191,59,46,.13);color:var(--danger)}.dly-today.info .dly-word{background:rgba(118,118,128,.14);color:var(--muted)}" +
      "@media (prefers-color-scheme:dark){.dly-today.due .dly-word{color:#F0B64A}}" +
      ".dly-tb{margin-top:10px}.dly-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-top:.5px solid var(--border)}.dly-line:first-child{border-top:0}" +
      ".dly-line .n{flex:1;min-width:150px}.dly-line .n b{display:block;font-size:14.5px;font-weight:600}.dly-line .n span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".dly-line input{width:76px;min-height:44px;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:var(--bg,transparent);color:var(--text);font:inherit;font-size:16px;padding:0 10px;font-variant-numeric:tabular-nums}" +
      ".dly-line input.wide{width:auto;flex:1;min-width:140px}.dly-line input[aria-invalid=true]{border-color:var(--danger)}" +
      ".dly-line small{color:var(--muted);font-size:12.5px}.dly-line .ok{color:var(--ok);font-weight:600;font-size:13.5px}.dly-line .bad{color:var(--danger);font-weight:600;font-size:13.5px}" +
      ".dly-fl{display:flex;flex-direction:column;gap:3px;font-size:12.5px;font-weight:600;color:var(--muted)}.dly-fl.wide{flex:1;min-width:150px}.dly-fl.wide input{width:100%}.dly-fl input{width:130px}" +
      ".dly-nudge{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0 0;padding:10px 14px;border:1px solid var(--border);border-left:4px solid #C98A12;border-radius:12px;background:var(--panel2);font-size:14px}.dly-nudge span{flex:1;min-width:180px}" +
      ".dly-msg{color:var(--danger);font-size:13px;font-weight:600;flex-basis:100%}.dly-msg:empty{display:none}" +
      // gaps line and calendar
      ".dly-gaps{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:14px;margin:12px 2px 0}.dly-gaps b{font-variant-numeric:tabular-nums}" +
      ".dly-gaps .miss{color:var(--danger);font-weight:600}.dly-gaps .none{color:var(--ok);font-weight:600}" +
      ".dly-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin-top:10px;max-width:520px}" +
      ".dly-cal .wd{font-size:11px;font-weight:700;color:var(--muted);text-align:center;padding:2px 0}" +
      ".dly-cal .c{min-height:44px;border-radius:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;font:inherit;font-size:13px;border:1px solid transparent;background:transparent;color:var(--text);padding:2px;box-sizing:border-box}" +
      ".dly-cal .c i{font-style:normal;font-variant-numeric:tabular-nums}.dly-cal .c small{font-size:10.5px;color:var(--muted);line-height:1.1}" +
      ".dly-cal .c.ok{background:rgba(28,138,91,.10)}.dly-cal .c.ok small{color:var(--ok);font-weight:700}" +
      ".dly-cal .c.miss{border:1px dashed var(--danger);color:var(--danger)}.dly-cal .c.miss small{color:var(--danger);font-weight:700}" +
      ".dly-cal .c.bad{background:rgba(191,59,46,.12)}.dly-cal .c.none small{color:var(--muted)}.dly-cal .c.today{box-shadow:inset 0 0 0 2px var(--accent)}" +
      ".dly-cal button.c{cursor:pointer}.dly-cal .c.future{color:var(--muted)}" +
      ".dly-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      // sign-off
      ".dly-sign{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:18px}" +
      ".dly-sign .chg{color:#8A5A00}@media (prefers-color-scheme:dark){.dly-sign .chg{color:#F0B64A}}.dly-sign h2{font-size:15.5px;margin:0 0 2px;font-weight:700}.dly-sign p{margin:2px 0;color:var(--muted);font-size:13.5px}.dly-sign.done{border-left:4px solid var(--ok)}" +
      ".dly-sign label{display:block;font-size:13.5px;font-weight:600;margin:10px 0 4px}.dly-sign textarea{width:100%;box-sizing:border-box;min-height:56px;border:1px solid var(--border);border-radius:10px;background:var(--bg,transparent);color:var(--text);font:inherit;font-size:16px;padding:8px 10px}" +
      ".dly-sign .acts{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}.dly-sign .err{color:var(--danger);font-size:13px;font-weight:600;margin-top:6px}.dly-sign .err:empty{display:none}" +
      ".dly-foot{font-size:12.5px;color:var(--muted);margin-top:14px}" +
      // VISUAL X4: Correct is a quiet text link with a 44 px target on these registers, not an outlined button per row
      ".dly-page .ecr-btn{border:0!important;background:none!important;min-height:44px;min-width:44px;padding:0 8px!important;font-size:13.5px;font-weight:600;color:var(--accent);text-decoration:underline;text-underline-offset:2px;cursor:pointer}" +
      ".dly-page{margin:0 auto}.dly-page:not(.wide){max-width:880px}.dly-page.wide{max-width:none}" +
      ".dly-back{min-height:44px;min-width:44px}" +
      ".dly-quietnote{color:var(--muted);font-size:12.5px;margin:14px 2px 0}" +
      "@media (max-width:600px){.dly-top h1{font-size:32px}.dly-line .n{flex-basis:100%}}" +
      "@media print{.dly-back,.dly-acts,.dly-today,.dly-gaps,.dly-cal,.dly-sign,.dly-quietnote,.dly-foot,.dly-fixes{display:none!important}}";
    document.head.appendChild(st);
  };

  D.head = function (o) {
    var back = E.ui2BackLabel ? E.ui2BackLabel(o.id) : "‹ Registers";
    return '<button class="dly-back" data-act="back">' + esc(back) + "</button>" +
      '<div class="dly-top"><div><h1>' + esc(o.title) + '</h1><p class="dly-sub">' + esc(o.sub || "") + "</p></div>" +
      '<div class="dly-acts">' + (o.acts || "") + "</div></div>";
  };

  D.today = function (o) {
    var tone = o.tone || "info";
    return '<section class="dly-today ' + tone + '" aria-label="Today"><div class="dly-th"><div class="t"><h2>' + (o.word ? '<span class="dly-word">' + esc(o.word) + "</span>" : "") + esc(o.title || "") + "</h2>" +
      (o.sub ? "<p>" + esc(o.sub) + "</p>" : "") + "</div>" + (o.acts ? '<div class="dly-acts">' + o.acts + "</div>" : "") + "</div>" +
      (o.body ? '<div class="dly-tb">' + o.body + "</div>" : "") + "</section>";
  };

  // "29 of 31 days logged · Not logged: Mon 3 Nov, Sun 9 Nov". unit: "day" | "week"; missed: ymd list (a week by its Monday).
  D.gaps = function (o) {
    var unit = o.unit || "day", n = (o.missed || []).length, word = function (k) { return k + " " + unit + (k === 1 ? "" : "s"); };
    var list = (o.missed || []).slice(0, 12).map(function (d) { return unit === "week" ? "week of " + dayShort(d) : dayShort(d); });
    if (n > 12) list.push("and " + (n - 12) + " more");
    return '<p class="dly-gaps" data-gaps="' + n + '"><span><b>' + (o.done != null ? o.done : 0) + "</b> of " + word(o.total || 0) + " " + esc(o.label || "logged") + "</span>" +
      (n ? '<span class="miss">· ' + esc((o.missLabel || "Not logged") + ": " + list.join(", ")) + "</span>" : '<span class="none">· nothing missed</span>') + "</p>";
  };

  // The month as a small calendar, Monday first. Days after today are faint and never buttons.
  D.cal = function (o) {
    var p = o.month.split("-"), first = new Date(Number(p[0]), Number(p[1]) - 1, 1), n = new Date(Number(p[0]), Number(p[1]), 0).getDate(), t = today();
    var h = '<div class="dly-cal" role="group" aria-label="' + esc((o.label || "The month") + ", " + monthLabel(o.month)) + '">' + ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(function (w) { return '<span class="wd" aria-hidden="true">' + w + "</span>"; }).join("");
    for (var i = 0; i < (first.getDay() + 6) % 7; i++) h += '<span class="c" aria-hidden="true"></span>';
    var lead = (first.getDay() + 6) % 7, stop = n; // this month: up to the end of the week we are in (later weeks are empty)
    if (o.month === t.slice(0, 7)) stop = Math.min(n, Number(t.slice(8)) + (6 - (lead + Number(t.slice(8)) - 1) % 7));
    for (var d = 1; d <= stop; d++) {
      var key = o.month + "-" + pad(d), c = (o.days || {})[key] || {}, fut = key > t, tone = fut ? "future" : (c.tone || "none");
      var say = d + " " + monthName(o.month) + ": " + (fut ? "ahead" : (c.say || (tone === "miss" ? "not logged" : "nothing recorded")));
      var inner = "<i>" + d + "</i><small aria-hidden=\"true\">" + esc(fut ? "" : (c.n != null ? c.n : tone === "miss" ? "–" : "")) + '</small><span class="dly-sr">' + esc(say) + "</span>";
      var cls = "c " + tone + (key === t ? " today" : "");
      if (fut) { h += '<span class="c future" aria-hidden="true"><i>' + d + "</i><small></small></span>"; continue; }
      if (o.pick && !fut && tone === "miss") h += '<button type="button" class="' + cls + '" data-dly-day="' + key + '" aria-label="' + esc(say + ". Log it late") + '">' + inner + "</button>";
      else h += '<span class="' + cls + '">' + inner + "</span>";
    }
    return h + "</div>";
  };

  // ---- sign-offs
  D.load = function (month, repaint) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return Promise.resolve(null);
    var c = C[month];
    if (c && (c.rows || c.loading) && !c.err) { if (repaint && c.loading) c.waiters.push(repaint); return c.promise; }
    c = C[month] = { rows: null, loading: true, err: "", waiters: repaint ? [repaint] : [] };
    var rights = E.loadRights && E.state && E.state.user && E.state.user.role !== "admin" ? E.loadRights().catch(function () { return null; }) : null; // a pharmacist signs off too
    c.promise = Promise.all([E.apiFetch("/registers/signoffs?month=" + encodeURIComponent(month), { method: "GET" }), rights]).then(function (rr) { var r = rr[0];
      var rows = {}; ((r && r.ok && r.signoffs) || []).forEach(function (s) { rows[s.register] = s; });
      c.rows = rows;
    }).catch(function (e) { c.err = (e && e.network) ? "offline" : "error"; c.rows = null; }).then(function () {
      c.loading = false; var w = c.waiters; c.waiters = []; w.forEach(function (fn) { try { fn(); } catch (x) {} }); return c.rows;
    });
    return c.promise;
  };
  function row(reg, month) { var c = C[month]; return c && c.rows ? c.rows[reg] || null : null; }
  D.signed = row;
  // Lines changed after the month was signed off (updated_at is UTC, as signed_at). rows: the month's entries.
  D.changedAfter = function (reg, month, rows) {
    var s = row(reg, month); if (!s || !s.signed_at) return 0;
    return (rows || []).filter(function (e) { return e && e.updated_at && String(e.updated_at) > String(s.signed_at); }).length;
  };

  D.sign = function (reg, month, o) {
    o = o || {};
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return "";
    if (month >= thisMonth()) return '<p class="dly-quietnote">Once ' + esc(monthName(month)) + " has ended, the pharmacist signs it off here.</p>";
    var c = C[month];
    if (!c || c.loading) return '<div class="dly-sign" aria-busy="true"><p>Checking the sign-off…</p></div>';
    if (c.err === "offline") return '<p class="dly-quietnote">Can\'t reach the server to check the sign-off. It shows again when the register is opened.</p>';
    if (c.err) return ""; // an older worker without sign-offs: nothing to show
    var s = row(reg, month);
    if (s) return '<div class="dly-sign done" data-signed="' + esc(reg) + '"><h2>Signed off by ' + esc(s.signed_name || "the pharmacist") + " on " + esc(niceAt(s.signed_at)) + "</h2>" +
      (s.note ? "<p>Note: " + esc(s.note) + "</p>" : "") +
      (o.changed ? '<p class="chg">' + esc(o.changed + (o.changed === 1 ? " line was" : " lines were") + " changed after the sign-off. Each change is on record with the reason.") + "</p>" : "") + "</div>";
    var gaps = Number(o.gaps) || 0, what = o.what || "days";
    if (!isAdmin()) return '<div class="dly-sign"><h2>' + esc(monthLabel(month)) + " is not signed off yet</h2><p>The pharmacist signs off each month once it has ended.</p></div>";
    var f = F[reg + "|" + month] || {}, id = "dly-note-" + reg;
    return '<form class="dly-sign" data-sign="' + esc(reg) + '" novalidate><h2>Sign off ' + esc(monthLabel(month)) + "</h2>" +
      "<p>" + (gaps ? esc(gaps + " " + (gaps === 1 ? what.replace(/s$/, "") : what) + " not logged. Say why before you sign.") : "Everything is logged. Check it, then sign it off.") + "</p>" +
      '<label for="' + id + '">' + (gaps ? "Why are " + esc(what) + " missing? (required)" : "Note (optional)") + "</label>" +
      '<textarea id="' + id + '" name="note" rows="2" maxlength="500"' + (gaps ? ' aria-required="true"' : "") + (f.err ? ' aria-invalid="true" aria-describedby="' + id + '-e"' : "") + ">" + esc(f.note || "") + "</textarea>" +
      '<div class="err" id="' + id + '-e" role="alert">' + esc(f.err || "") + "</div>" +
      '<div class="acts"><button type="submit" class="dly-btn p"' + (f.saving ? " disabled" : "") + ">" + (f.saving ? "Signing…" : "Sign off " + esc(monthName(month))) + "</button></div></form>";
  };

  // This month open, last month not signed off yet: say so at the top, with the way there (one small read, cached).
  D.nudge = function (reg, month, repaint) {
    if (month !== thisMonth()) return "";
    var p = month.split("-"), lm = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 2, 1)).toISOString().slice(0, 7), c = C[lm];
    if (!c) { D.load(lm, repaint); return ""; }
    if (c.loading || c.err || !c.rows || c.rows[reg]) return "";
    return '<div class="dly-nudge"><span>' + esc(monthLabel(lm)) + " is not signed off yet." + (isAdmin() ? "" : " The pharmacist signs it off.") + "</span>" +
      (isAdmin() ? '<button class="dly-btn" data-dly-prev>Sign off ' + esc(monthName(lm)) + "</button>" : "") + "</div>";
  };
  D.wire = function (root, reg, month, repaint) {
    var pv = root && root.querySelector("[data-dly-prev]");
    if (pv) pv.addEventListener("click", function () { var b = root.querySelector(".emb [data-mb=prev]"); if (b) b.click(); setTimeout(function () { var f = root.ownerDocument.querySelector('form[data-sign="' + reg + '"] textarea, form[data-sign="' + reg + '"] button'); if (f) f.focus(); }, 900); }); // last month, at its sign-off
    var form = root && root.querySelector('form[data-sign="' + reg + '"]'); if (!form) return;
    var k = reg + "|" + month, ta = form.querySelector("textarea");
    ta.addEventListener("input", function () { F[k] = Object.assign(F[k] || {}, { note: ta.value }); });
    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var f = F[k] = Object.assign(F[k] || {}, { note: ta.value, err: "" });
      if (f.saving) return;
      if (ta.getAttribute("aria-required") === "true" && !String(ta.value).trim()) { f.err = "Say why days are missing. Nothing was signed."; repaint(); var t2 = root.querySelector('form[data-sign="' + reg + '"] textarea'); if (t2) t2.focus(); return; }
      f.saving = true; repaint();
      try {
        var r = await E.apiFetch("/registers/signoffs", { method: "POST", body: JSON.stringify({ register: reg, month: month, note: String(ta.value || "").trim() }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Not signed");
        if (!C[month] || !C[month].rows) C[month] = { rows: {}, loading: false, waiters: [] };
        C[month].rows[reg] = r.signoff; delete F[k];
        E.toast(monthLabel(month) + " signed off" + (r.already ? " (it already was)" : ""), "success");
      } catch (e) { f.saving = false; f.err = E.saveFailText ? E.saveFailText(e) : String((e && e.message) || e); }
      repaint();
      var done = root.querySelector('[data-signed="' + reg + '"] h2'); if (done) { done.setAttribute("tabindex", "-1"); done.focus(); }
      else { var t3 = root.querySelector('form[data-sign="' + reg + '"] textarea'); if (t3) t3.focus(); }
    });
  };

  // The printout's last line: who signed the month off, or that it is not signed off yet.
  D.after = function (reg, month) {
    var s = row(reg, month); if (!s) return "";
    return '<p style="margin-top:14px;font-size:11px">Signed off by ' + esc(s.signed_name || "the pharmacist") + " on " + esc(niceAt(s.signed_at)) + (s.note ? ". Note: " + esc(s.note) : "") + ".</p>";
  };
  // The footer every daily register ends with (VISUAL X3): plain words, no trip to the old screens.
  D.foot = function (extra) {
    return '<p class="ecr-foot dly-foot">' + (isAdmin() ? "Made a mistake? Press Correct on the line \u2014 what it said before stays on record." : "A wrong line is corrected by the pharmacist (Correct, with the reason).") + (extra ? " " + esc(extra) : "") + "</p>";
  };
  D.monthLabel = monthLabel; D.dayShort = dayShort; D.today = D.today; D.todayYmd = today;
  E.printDocs = E.printDocs || {};
})();
