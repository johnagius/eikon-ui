/* Daily register (prescription medicines supplied), new layout: the month by day, a search, a quick entry form
   that fills a known prescriber's registration number and a known client's name, and a printout.
   Same endpoints as the classic screen (/daily-register/entries). Correct (the pharmacist only, eikon.correct.js):
   the line is read again, the classic edit's seven fields, a required reason, the whole line sent (the update replaces
   every column). A line is never deleted here.
   The daily registers' one pattern (eikon.dailyreg.js): today first (how many lines today, "Add line" on today's date,
   "Another for <client>"), the month as a calendar with the lines per day, the month's sign-off, the same printout. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: null, entries: [], history: [], q: "", loading: false, error: "", form: null, saving: false, last: null };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Correcting a line: the classic edit form's fields and its PUT body.
  var FIX = { entity: "daily_register_entries", action: "DAILY_REGISTER_ENTRY_UPDATE",
    fields: [{ k: "entry_date", label: "Date", type: "date", req: true, what: "the date" }, { k: "client_name", label: "Client", req: true, what: "the client's name" },
      { k: "client_id", label: "ID card", req: true, what: "the client's ID card" }, { k: "medicine_name_dose", label: "Medicine", req: true, what: "the medicine and dose" },
      { k: "posology", label: "Posology", req: true, what: "the posology" }, { k: "prescriber_name", label: "Prescriber", req: true, what: "the prescriber" },
      { k: "prescriber_reg_no", label: "Reg no", req: true, what: "the prescriber's reg no" }],
    rows: function () { return S.entries; },
    reread: async function (row) {
      var months = [String(row.entry_date || "").slice(0, 7), S.month].filter(function (x, i, a) { return /^\d{4}-\d{2}$/.test(x) && a.indexOf(x) === i; });
      for (var i = 0; i < months.length; i++) {
        var r = await E.apiFetch("/daily-register/entries?month=" + encodeURIComponent(months[i]), { method: "GET" });
        var hit = ((r && r.entries) || []).filter(function (e) { return String(e.id) === String(row.id); })[0];
        if (hit) return hit;
      }
      return null;
    },
    put: function (row) { return "/daily-register/entries/" + encodeURIComponent(String(row.id)); },
    body: function (r) { var b = {}; ["entry_date", "client_name", "client_id", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no"].forEach(function (k) { b[k] = String(r[k] == null ? "" : r[k]).trim(); }); return b; },
    check: function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(String(r.entry_date)) && String(r.entry_date) <= ymd(new Date()) ? "" : "Choose the date (not a day ahead)."; },
    paint: function () { paint(); }, idle: function () { E.whenFormIdle(S.mount, paint); }, done: function () { return load(); } };
  var WDN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var FIELDS = [
    ["entry_date", "Date", "date", ""],
    ["client_id", "ID card", "text", "e.g. 123456M"],
    ["client_name", "Client", "text", "Name and surname"],
    ["medicine_name_dose", "Medicine", "text", "Name and dose, e.g. Amoxil 500mg"],
    ["posology", "Posology", "text", "e.g. 1-1-1 x 7 days"],
    ["prescriber_name", "Prescriber", "text", "e.g. Dr Abela"],
    ["prescriber_reg_no", "Reg no", "text", "Prescriber's registration number"]
  ];
  // How a missing field is named in the message ("Write the ID card and the posology. Nothing was saved.")
  var SAY = { entry_date: "the date (today or earlier)", client_id: "the ID card", client_name: "the client's name", medicine_name_dose: "the medicine and dose", posology: "the posology", prescriber_name: "the prescriber", prescriber_reg_no: "the prescriber's reg no" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = String(s).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function shiftMonth(m, k) { var p = m.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(m) { var p = m.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function dayLong(s) { var d = parse(s), t = ymd(new Date()); return s === t ? "Today" : WDN[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  // Wide screens get the register as a table (the classic's columns); phones and narrow windows keep the two-line list.
  var WIDE = "(min-width:1200px)", mqWide = null;
  function wide() { try { return window.matchMedia(WIDE).matches; } catch (e) { return false; } }
  function watchWidth() {
    if (mqWide) return;
    try { mqWide = window.matchMedia(WIDE); var f = function () { if (S.mount && E.state.activeModuleId === "drreg") E.whenFormIdle(S.mount, paint); };
      if (mqWide.addEventListener) mqWide.addEventListener("change", f); else if (mqWide.addListener) mqWide.addListener(f); } catch (e) {}
  }
  function todayYmd() { return (E.maltaYmd && E.maltaYmd()) || ymd(new Date()); }
  // The month at a glance: lines per day (a day with none is not "missed": nothing may have been supplied).
  function monthHtml() {
    var D = E.dailyReg, by = {}, days = {};
    S.entries.forEach(function (e) { by[e.entry_date] = (by[e.entry_date] || 0) + 1; });
    Object.keys(by).forEach(function (d) { days[d] = { tone: "ok", n: String(by[d]), say: by[d] + (by[d] === 1 ? " line" : " lines") }; });
    return '<p class="dly-gaps"><span><b>' + S.entries.length + "</b> " + (S.entries.length === 1 ? "line" : "lines") + " on <b>" + Object.keys(by).length + "</b> " + (Object.keys(by).length === 1 ? "day" : "days") + " in " + esc(monthLabel(S.month)) + "</span></p>" +
      D.cal({ month: S.month, days: days, label: "Lines per day" });
  }
  function dayShort(s) { var d = parse(s); return s === ymd(new Date()) ? "Today" : WDN[d.getDay()].slice(0, 3) + " " + d.getDate() + " " + MON[d.getMonth()]; }

  function css() {
    if (document.getElementById("eikon-drreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-drreg-css";
    st.textContent =
      ".drr{max-width:900px;margin:0 auto}" +
      ".drr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".drr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".drr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.drr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".drr-acts{display:flex;gap:8px}" +
      ".drr-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".drr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.drr-btn:disabled{opacity:.55;cursor:default}" +
      ".drr-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:18px 0 6px}" +
      ".drr-month{display:flex;align-items:center;gap:6px}.drr-month b{font-size:17px;min-width:150px;text-align:center}" +
      ".drr-arrow{width:34px;height:34px;border-radius:50%;border:0;background:rgba(118,118,128,.12);color:var(--text);font-size:18px;cursor:pointer}.drr-arrow:disabled{opacity:.35;cursor:default}" +
      ".drr-q{flex:1;min-width:200px;height:44px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".drr-lab{font-size:13px;font-weight:600;color:var(--muted);margin:16px 2px 7px;display:flex;gap:8px}.drr-lab b{color:var(--text)}" +
      ".drr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".drr-row{padding:11px 16px;border-top:.5px solid var(--border);display:flex;align-items:center;gap:12px}.drr-row:first-child{border-top:0}.drr-rt{flex:1;min-width:0}" +
      ".drr-tbl td.c{width:1%;white-space:nowrap;vertical-align:middle;padding-top:4px;padding-bottom:4px}.drr-tbl tr.drr-fix td{padding:0}.drr-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      ".drr-row b{display:block;font-size:14.5px;font-weight:600}.drr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}" +
      ".drr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".drr-form label{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border)}.drr-form label:first-child{border-top:0}" +
      ".drr-form label>span{flex:0 0 96px;font-size:15px}.drr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".drr-form label.miss>span{color:var(--danger)}.drr-form label.miss:focus-within>span{color:inherit}" +
      ".drr-btn.again{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".drr-form .acts{display:flex;gap:8px;padding:10px 16px 8px;justify-content:flex-end;align-items:center}.drr-form .acts small{margin-right:auto;color:var(--muted);font-size:12.5px}" +
      ".drr-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}.drr-err:empty{padding:0}" +
      ".drr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".drr-print,.drr-pmeta{display:none}" +
      "@media (min-width:1200px){.drr{max-width:1180px}}" +
      ".drr-tbl{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:12px;font-size:13.5px}" +
      ".drr-tbl th{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}" +
      ".drr-tbl td{padding:9px 12px;border-top:.5px solid var(--border);vertical-align:top}.drr-tbl tbody tr:first-child td{border-top:0}" +
      ".drr-tbl td.d{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}.drr-tbl td.m{font-weight:600}.drr-tbl td.n{white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".drr-tbl tr.nd td{border-top:1px solid var(--border)}" +
      "@media (max-width:600px){.drr{padding:4px 16px 0}.drr h1{font-size:32px}.drr-form label>span{flex-basis:84px}.drr-form .acts{flex-wrap:wrap}.drr-form .acts small{flex-basis:100%;margin:0 0 4px}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.drr-back,.drr-acts,.drr-bar,.drr-lab,.drr-list,.drr-tbl,.drr-form,.drr-note,.eikon-toast{display:none!important}" +
      ".eikon-content{padding:0!important}.drr-pmeta{display:block;font-size:12px;margin:2px 0 8px}.drr-print{display:table;width:100%;border-collapse:collapse;font-size:10.5px}" +
      ".drr-print th,.drr-print td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      // This month for the list; last month too, so a returning client or a prescriber can be filled in.
      var res = await Promise.all([S.month, shiftMonth(S.month, -1)].map(function (mo) { return E.apiFetch("/daily-register/entries?month=" + encodeURIComponent(mo), { method: "GET" }); }));
      var byNewest = function (a, b) { return (String(a.entry_date) + String(a.id).padStart(9, "0")) < (String(b.entry_date) + String(b.id).padStart(9, "0")) ? 1 : -1; };
      S.entries = ((res[0] && res[0].entries) || []).slice().sort(byNewest);
      S.history = S.entries.concat((res[1] && res[1].entries) || []);
      E.correct.loadMarks("drreg", FIX, S.month + "-01"); // which lines were corrected, by whom and why
      if (S.month < thisMonth()) E.dailyReg.load(S.month, function () { E.whenFormIdle(S.mount, paint); }); // an ended month: its sign-off
    } catch (e) {
      if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
    }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function matches(e) {
    if (!S.q) return true;
    var q = norm(S.q);
    return [e.client_name, e.client_id, e.medicine_name_dose, e.prescriber_name, e.prescriber_reg_no, e.posology].some(function (v) { return norm(v).indexOf(q) >= 0; });
  }

  function formHtml() {
    var f = S.form, prescribers = {}, ids = {};
    S.history.forEach(function (e) { if (e.prescriber_name) prescribers[e.prescriber_name] = 1; if (e.client_id) ids[e.client_id] = 1; });
    var h = '<form class="drr-form" id="drr-form" autocomplete="off">';
    FIELDS.forEach(function (fd) {
      var k = fd[0], list = k === "prescriber_name" ? ' list="drr-presc"' : k === "client_id" ? ' list="drr-ids"' : "";
      var miss = (f.missing || []).indexOf(k) >= 0;
      h += '<label' + (miss ? ' class="miss"' : "") + "><span>" + fd[1] + '</span><input name="' + k + '" type="' + fd[2] + '"' + list + (miss ? ' aria-invalid="true"' : "") +
        (k === "entry_date" ? ' max="' + esc(ymd(new Date())) + '"' : "") + ' placeholder="' + esc(fd[3]) + '" value="' + esc(f[k] || "") + '"></label>';
    });
    h += '<datalist id="drr-presc">' + Object.keys(prescribers).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>";
    h += '<datalist id="drr-ids">' + Object.keys(ids).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>";
    h += '<div class="drr-err" role="alert">' + esc(f.err || "") + "</div>";
    h += '<div class="acts"><small>Every line is needed for the register.</small><button type="button" class="drr-btn" data-act="cancel">Cancel</button><button type="submit" class="drr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save entry") + "</button></div></form>";
    return h;
  }

  // What is typed in the form survives every repaint (a month change, a list arriving, Print). It used to be redrawn
  // from the values the form was opened with, so typing a search or changing month with the form open emptied it.
  function keep() {
    var f = S.mount && S.mount.querySelector("#drr-form"); if (!f || !S.form) return;
    FIELDS.forEach(function (fd) { var el = f.querySelector("[name=" + fd[0] + "]"); if (el) S.form[fd[0]] = String(el.value || ""); });
  }
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "drreg") return; // left before a reply came back: do not draw over the next screen
    keep();
    var ae = document.activeElement, back = ae && m.contains(ae) && ae.closest && ae.closest("#drr-form") && ae.name ? ae.name : "";
    var MB = E.months, user = E.state.user || {};
    var D = E.dailyReg, cur = S.month === thisMonth();
    var again = S.last ? '<button class="dly-btn drr-btn again" data-act="again" aria-label="' + esc("Another medicine for " + S.last.client_name + ", same prescriber") + '">' + esc("Another for " + S.last.client_name) + "</button>" : "";
    var h = '<div class="drr dly-page wide">' + D.head({ id: "drreg", title: "Daily register", sub: "Prescription medicines supplied, one line each.", acts: S.form ? "" : again + '<button class="dly-btn p" data-act="new">New entry</button>' }) +
      '<p class="drr-pmeta">' + esc((user.location_name || "") + " · Daily register · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>";
    if (cur && !(S.loading && !S.entries.length) && !S.error) {
      var tn = S.entries.filter(function (e) { return e.entry_date === todayYmd(); }).length;
      h += D.today({ tone: tn ? "ok" : "info", word: tn ? "Today" : "None yet", title: tn ? tn + (tn === 1 ? " line today" : " lines today") : "No lines today yet",
        sub: "Each prescription medicine supplied goes on one line, on today's date." });
    }
    h += D.nudge("daily", S.month, function () { E.whenFormIdle(S.mount, paint); });
    if (S.form) h += formHtml();
    h += MB.bar(S.month, { label: "Daily register" }) +
      '<div class="drr-bar"><input class="drr-q" id="drr-q" type="search" aria-label="Search this month" placeholder="Search client, ID, medicine or prescriber" value="' + esc(S.q) + '"></div>';
    if (!S.loading && !S.error && S.entries.length && !S.q) h += monthHtml();
    h += '<div id="drr-res">' + resultsHtml() + "</div>";
    if (!S.loading && !S.error) h += D.sign("daily", S.month, { gaps: 0, what: "days", changed: D.changedAfter("daily", S.month, S.entries) });
    h += D.foot();
    h += '<table class="drr-print"><thead><tr><th>Date</th><th>Client</th><th>ID card</th><th>Medicine and dose</th><th>Posology</th><th>Prescriber</th><th>Reg no</th></tr></thead><tbody>' +
      (S.entries.length ? S.entries.slice().reverse().map(function (e) {
        return "<tr><td>" + esc(e.entry_date) + "</td><td>" + esc(e.client_name) + "</td><td>" + esc(e.client_id) + "</td><td>" + esc(e.medicine_name_dose) + "</td><td>" + esc(e.posology) + "</td><td>" + esc(e.prescriber_name) + "</td><td>" + esc(e.prescriber_reg_no) + "</td></tr>";
      }).join("") : '<tr><td colspan="7">Nothing recorded this month.</td></tr>') + "</tbody></table></div>";
    m.innerHTML = h;
    D.wire(m, "daily", S.month, paint);
    if (back) { var again = m.querySelector("#drr-form [name=" + back + "]"); if (again) again.focus(); } // a repaint keeps your place in the form
    bind(m);
    E.correct.wire(m, "drreg", FIX);
    MB.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; E.correct.reset("drreg"); load(); }, paint: paint, print: printMonth });
  }
  // The list (or table) under the search: redrawn alone as a search is typed, so the form and the bar stay as they are.
  function resultsHtml() {
    var MB = E.months, h = "", shown = S.entries.filter(matches);
    if (S.loading && !S.entries.length) h += '<div class="drr-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="drr-quiet">' + esc(S.error) + "</div>";
    else if (!S.entries.length) h += '<div class="drr-quiet" data-empty>' + esc(MB.empty(S.month)) + "</div>";
    else if (!shown.length) h += '<div class="drr-quiet">No entry matches “' + esc(S.q) + "”.</div>";
    else if (wide()) {
      h += '<table class="drr-tbl"><thead><tr><th scope="col">Date</th><th scope="col">Client</th><th scope="col">ID card</th><th scope="col">Medicine and dose</th><th scope="col">Posology</th><th scope="col">Prescriber</th><th scope="col">Reg no</th>' + (E.correct.can() ? '<th scope="col"><span class="drr-sr">Correct</span></th>' : "") + "</tr></thead><tbody>" +
        shown.map(function (e, i) {
          var first = i === 0 || shown[i - 1].entry_date !== e.entry_date, pan = E.correct.panel("drreg", e, FIX);
          return '<tr' + (first && i ? ' class="nd"' : "") + '><td class="d">' + (first ? esc(dayShort(e.entry_date)) : "") + "</td><td>" + esc(e.client_name) + '</td><td class="n">' + esc(e.client_id) + '</td><td class="m">' + esc(e.medicine_name_dose) + E.correct.mark("drreg", e) + "</td><td>" + esc(e.posology) + "</td><td>" + esc(e.prescriber_name) + '</td><td class="n">' + esc(e.prescriber_reg_no) + "</td>" +
            (E.correct.can() ? '<td class="c">' + E.correct.button("drreg", e, e.medicine_name_dose + " for " + e.client_name + ", " + dayShort(e.entry_date)) + "</td>" : "") + "</tr>" +
            (pan ? '<tr class="drr-fix"><td colspan="8">' + pan + "</td></tr>" : "");
        }).join("") + "</tbody></table>";
    }
    else {
      var day = null;
      shown.forEach(function (e) {
        if (e.entry_date !== day) {
          if (day) h += "</div>";
          day = e.entry_date;
          var n = shown.filter(function (x) { return x.entry_date === day; }).length;
          h += '<div class="drr-lab">' + esc(dayShort(day)) + " · " + n + (n === 1 ? " line" : " lines") + '</div><div class="drr-list">';
        }
        h += '<div class="drr-row"><div class="drr-rt"><b>' + esc(e.medicine_name_dose) + " · " + esc(e.client_name) + "</b><span>" + esc(e.posology) + " · " + esc(e.prescriber_name) +
          (e.prescriber_reg_no ? " (" + esc(e.prescriber_reg_no) + ")" : "") + " · " + esc(e.client_id) + "</span>" + E.correct.mark("drreg", e) + "</div>" +
          E.correct.button("drreg", e, e.medicine_name_dose + " for " + e.client_name + ", " + dayShort(e.entry_date)) + "</div>" + E.correct.panel("drreg", e, FIX);
      });
      h += "</div>";
    }
    return h;
  }
  // The classic daily register printout (its columns, in its order), oldest first; the whole month, whatever the search.
  function printDoc(ym, entries) {
    var MB = E.months, byNewest = function (a, b) { return (String(a.entry_date) + String(a.id).padStart(9, "0")) < (String(b.entry_date) + String(b.id).padStart(9, "0")) ? 1 : -1; };
    var doc = { register: "Daily register", month: ym, landscape: true, sections: [{ cols: ["Date", "Client", "Medicine name and dose", "Posology", "Prescriber name", "Reg no"],
      rows: entries.slice().sort(byNewest).reverse().map(function (e) { return [MB.dmy(e.entry_date), { html: "<b>" + esc(e.client_name || "") + "</b><br>ID: " + esc(e.client_id || "") }, e.medicine_name_dose || "", e.posology || "", e.prescriber_name || "", e.prescriber_reg_no || ""]; }) }] };
    var after = E.dailyReg ? E.dailyReg.after("daily", ym) : ""; if (after) doc.after = after;
    return doc;
  }
  if (E.printDocs) E.printDocs.drreg = printDoc; // the inspection pack prints the same page
  function printMonth() { E.months.print(printDoc(S.month, S.entries)); }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("drreg") : "#registers";
        else if (a === "again") { var L = S.last; S.form = { entry_date: L.entry_date, client_id: L.client_id, client_name: L.client_name, prescriber_name: L.prescriber_name, prescriber_reg_no: L.prescriber_reg_no }; paint(); var md = m.querySelector("#drr-form [name=medicine_name_dose]"); if (md) md.focus(); }
        else if (a === "new") { S.form = { entry_date: ymd(new Date()) }; paint(); E.focusSoon(function () { return m.querySelector("[name=client_id]"); }, 30); }
        else if (a === "cancel") { S.form = null; paint(); var nb = m.querySelector("[data-act=new]"); if (nb) nb.focus(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "drreg"); } catch (e) {} E.openClassic("dailyregister"); }
      });
    });
    var q = m.querySelector("#drr-q");
    if (q) q.addEventListener("input", function () { // only the list is redrawn: the search box and the form are left alone
      S.q = q.value; var res = S.mount.querySelector("#drr-res"); if (res) { res.innerHTML = resultsHtml(); E.correct.wire(res, "drreg", FIX); }
    });
    var f = m.querySelector("#drr-form");
    if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); save(f); });
    f.addEventListener("input", function (ev) { // a field being put right stops being red
      var el = ev.target; if (!el || el.getAttribute("aria-invalid") !== "true") return;
      el.removeAttribute("aria-invalid"); var lb = el.closest("label"); if (lb) lb.classList.remove("miss");
      if (S.form && S.form.missing) S.form.missing = S.form.missing.filter(function (k) { return k !== el.name; });
    });
    // A known prescriber brings their registration number; a known ID card brings the client's name.
    var g = function (n) { return f.querySelector("[name=" + n + "]"); };
    g("prescriber_name").addEventListener("change", function () {
      var hit = S.history.find(function (e) { return norm(e.prescriber_name) === norm(g("prescriber_name").value) && e.prescriber_reg_no; });
      if (hit && !g("prescriber_reg_no").value) g("prescriber_reg_no").value = hit.prescriber_reg_no;
    });
    g("client_id").addEventListener("change", function () {
      var hit = S.history.find(function (e) { return norm(e.client_id) === norm(g("client_id").value) && e.client_name; });
      if (hit && !g("client_name").value) g("client_name").value = hit.client_name;
    });
    if (E.personPick) E.personPick.attach({ key: "drreg", form: f, fields: { id: "client_id", name: "client_name" },
      local: function () { return S.history.concat(S.entries).map(function (e) { return { name: e.client_name, id_card: e.client_id, date: e.entry_date, from: "register entry" }; }); } });
  }

  async function save(f) {
    if (S.saving) return;
    var body = {};
    FIELDS.forEach(function (fd) { var el = f.querySelector("[name=" + fd[0] + "]"); body[fd[0]] = el ? String(el.value || "").trim() : ""; });
    var missing = FIELDS.filter(function (fd) { return !body[fd[0]]; }).map(function (fd) { return fd[0]; });
    S.form = Object.assign({}, body, { err: "", missing: missing });
    if (body.entry_date > ymd(new Date())) missing.unshift("entry_date");
    S.form.missing = missing;
    if (missing.length) {
      var w = missing.map(function (k) { return SAY[k]; });
      S.form.err = "Write " + (w.length === 1 ? w[0] : w.slice(0, -1).join(", ") + " and " + w[w.length - 1]) + ". Nothing was saved.";
      paint(); var fx = S.mount && S.mount.querySelector("#drr-form [name=" + missing[0] + "]"); if (fx) fx.focus(); return;
    }
    // the ID card and the person (E.people.confirmPerson): asked before anything is saved; Go back keeps the form
    if (E.people && E.people.confirmPerson) {
      S.saving = true; paint();
      var asked = await E.people.confirmPerson({ name: body.client_name, id_card: body.client_id }, { key: "drreg", record: "register entry" });
      S.saving = false;
      if (asked.action !== "save") {
        if (asked.action === "fill") { var fk = asked.field === "name" ? "client_name" : "client_id", fe = f.querySelector("[name=" + fk + "]"); S.form[fk] = asked.value; if (fe) fe.value = asked.value; } // the repaint keeps what the form shows
        paint(); var back = S.mount && S.mount.querySelector("#drr-form [name=" + (asked.field === "name" ? "client_name" : "client_id") + "]"); if (back) back.focus();
        return;
      }
    }
    S.saving = true; paint();
    try {
      var r = await E.postOnce("/daily-register/entries", body, { list: async function () { var r0 = await E.apiFetch("/daily-register/entries?month=" + body.entry_date.slice(0, 7), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; },
        same: function (e) { return e.entry_date === body.entry_date && String(e.client_id || "").trim().toLowerCase() === String(body.client_id || "").trim().toLowerCase() && String(e.medicine_name_dose || "").trim().toLowerCase() === String(body.medicine_name_dose || "").trim().toLowerCase() && String(e.prescriber_reg_no || "").trim().toLowerCase() === String(body.prescriber_reg_no || "").trim().toLowerCase() && String(e.client_name || "").trim().toLowerCase() === String(body.client_name || "").trim().toLowerCase(); } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.form = null; E.toast("Saved · " + body.medicine_name_dose + " for " + body.client_name, "success");
      S.last = { entry_date: body.entry_date, client_id: body.client_id, client_name: body.client_name, prescriber_name: body.prescriber_name, prescriber_reg_no: body.prescriber_reg_no }; // "Another for …": the next line of the same prescription
      S.month = body.entry_date.slice(0, 7);
    } catch (e) {
      S.form.err = E.saveFailText(e);
    }
    S.saving = false;
    return load();
  }

  E.registerModule({
    id: "drreg", title: "Daily register", order: 3, icon: "Rx", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.form = null; E.dailyReg.css(); S.last = null; S.month = E.months.take("drreg") || thisMonth(); S.entries = []; E.months.reset(); E.correct.reset("drreg"); css(); watchWidth(); paint(); return E.takeOpenForm("drreg", S.mount, load(), { btn: "[data-act=new]", form: "#drr-form", fill: { id_card: "client_id", name: "client_name" } }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("drreg") < 0) E.UI2_DESTINATIONS.push("drreg");
  if (E.UI2_PARENT) E.UI2_PARENT.drreg = "registers";
})();
