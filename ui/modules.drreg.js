/* Daily register (prescription medicines supplied), new layout: the month by day, a search, a quick entry form
   that fills a known prescriber's registration number and a known client's name, and a printout.
   Same endpoints as the classic screen (/daily-register/entries); corrections still happen there. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: null, entries: [], history: [], q: "", loading: false, error: "", form: null, saving: false };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = String(s).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function shiftMonth(m, k) { var p = m.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(m) { var p = m.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function dayLong(s) { var d = parse(s), t = ymd(new Date()); return s === t ? "Today" : WDN[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; }
  function norm(s) { return String(s || "").trim().toLowerCase(); }

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
      ".drr-q{flex:1;min-width:200px;height:38px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 12px;outline:0}" +
      ".drr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 2px 7px;display:flex;gap:8px}.drr-lab b{color:var(--text)}" +
      ".drr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".drr-row{padding:11px 16px;border-top:.5px solid var(--border)}.drr-row:first-child{border-top:0}" +
      ".drr-row b{display:block;font-size:14.5px;font-weight:600}.drr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}" +
      ".drr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".drr-form label{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border)}.drr-form label:first-child{border-top:0}" +
      ".drr-form label>span{flex:0 0 96px;font-size:15px}.drr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".drr-form label.miss>span{color:var(--danger)}" +
      ".drr-form .acts{display:flex;gap:8px;padding:10px 16px 8px;justify-content:flex-end;align-items:center}.drr-form .acts small{margin-right:auto;color:var(--muted);font-size:12.5px}" +
      ".drr-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
      ".drr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".drr-print,.drr-pmeta{display:none}" +
      "@media (max-width:600px){.drr{padding:4px 16px 0}.drr h1{font-size:32px}.drr-form label>span{flex-basis:84px}.drr-form .acts{flex-wrap:wrap}.drr-form .acts small{flex-basis:100%;margin:0 0 4px}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.drr-back,.drr-acts,.drr-bar,.drr-lab,.drr-list,.drr-form,.drr-note,.eikon-toast{display:none!important}" +
      ".eikon-content{padding:0!important}.drr-pmeta{display:block;font-size:12px;margin:2px 0 8px}.drr-print{display:table;width:100%;border-collapse:collapse;font-size:10.5px}" +
      ".drr-print th,.drr-print td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}}";
    document.head.appendChild(st);
  }

  async function load() {
    S.loading = true; S.error = ""; paint();
    try {
      // This month for the list; last month too, so a returning client or a prescriber can be filled in.
      var res = await Promise.all([S.month, shiftMonth(S.month, -1)].map(function (mo) { return E.apiFetch("/daily-register/entries?month=" + encodeURIComponent(mo), { method: "GET" }); }));
      var byNewest = function (a, b) { return (String(a.entry_date) + String(a.id).padStart(9, "0")) < (String(b.entry_date) + String(b.id).padStart(9, "0")) ? 1 : -1; };
      S.entries = ((res[0] && res[0].entries) || []).slice().sort(byNewest);
      S.history = S.entries.concat((res[1] && res[1].entries) || []);
    } catch (e) {
      S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
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
      h += '<label' + ((f.missing || []).indexOf(k) >= 0 ? ' class="miss"' : "") + "><span>" + fd[1] + '</span><input name="' + k + '" type="' + fd[2] + '"' + list +
        (k === "entry_date" ? ' max="' + esc(ymd(new Date())) + '"' : "") + ' placeholder="' + esc(fd[3]) + '" value="' + esc(f[k] || "") + '"></label>';
    });
    h += '<datalist id="drr-presc">' + Object.keys(prescribers).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>";
    h += '<datalist id="drr-ids">' + Object.keys(ids).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>";
    if (f.err) h += '<div class="drr-err">' + esc(f.err) + "</div>";
    h += '<div class="acts"><small>Every line is needed for the register.</small><button type="button" class="drr-btn" data-act="cancel">Cancel</button><button type="submit" class="drr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Add to register") + "</button></div></form>";
    return h;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "drreg") return; // left before a reply came back: do not draw over the next screen
    var isNow = S.month >= thisMonth(), user = E.state.user || {};
    var h = '<div class="drr"><button class="drr-back" data-act="back">‹ Registers</button>' +
      '<div class="drr-top"><div><h1>Daily register</h1><p class="drr-sub">Prescription medicines supplied, one line each.</p></div>' +
      '<div class="drr-acts">' + (S.form ? "" : '<button class="drr-btn p" data-act="new">New entry</button>') + '<button class="drr-btn" data-act="print">Print</button></div></div>' +
      '<p class="drr-pmeta">' + esc((user.location_name || "") + " · Daily register · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>";
    if (S.form) h += formHtml();
    h += '<div class="drr-bar"><div class="drr-month"><button class="drr-arrow" data-act="prev" aria-label="Previous month">‹</button><b>' + esc(monthLabel(S.month)) + '</b><button class="drr-arrow" data-act="next" aria-label="Next month"' + (isNow ? " disabled" : "") + '>›</button></div>' +
      '<input class="drr-q" id="drr-q" type="search" placeholder="Search client, ID, medicine or prescriber" value="' + esc(S.q) + '"></div>';
    var shown = S.entries.filter(matches);
    if (S.loading && !S.entries.length) h += '<div class="drr-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="drr-quiet">' + esc(S.error) + "</div>";
    else if (!S.entries.length) h += '<div class="drr-quiet">Nothing recorded in ' + esc(monthLabel(S.month)) + ".</div>";
    else if (!shown.length) h += '<div class="drr-quiet">No entry matches “' + esc(S.q) + "”.</div>";
    else {
      var day = null;
      shown.forEach(function (e) {
        if (e.entry_date !== day) {
          if (day) h += "</div>";
          day = e.entry_date;
          var n = shown.filter(function (x) { return x.entry_date === day; }).length;
          h += '<div class="drr-lab">' + esc(dayLong(day)) + " <b>" + n + '</b></div><div class="drr-list">';
        }
        h += '<div class="drr-row"><b>' + esc(e.medicine_name_dose) + " · " + esc(e.client_name) + "</b><span>" + esc(e.posology) + " · " + esc(e.prescriber_name) +
          (e.prescriber_reg_no ? " (" + esc(e.prescriber_reg_no) + ")" : "") + " · " + esc(e.client_id) + "</span></div>";
      });
      h += "</div>";
    }
    h += '<p class="drr-note" style="font-size:12.5px;color:var(--muted);margin-top:12px">To correct or remove a line, open it in the <a href="#" data-act="classic" style="color:var(--accent)">classic register</a>.</p>';
    h += '<table class="drr-print"><thead><tr><th>Date</th><th>Client</th><th>ID card</th><th>Medicine and dose</th><th>Posology</th><th>Prescriber</th><th>Reg no</th></tr></thead><tbody>' +
      (S.entries.length ? S.entries.slice().reverse().map(function (e) {
        return "<tr><td>" + esc(e.entry_date) + "</td><td>" + esc(e.client_name) + "</td><td>" + esc(e.client_id) + "</td><td>" + esc(e.medicine_name_dose) + "</td><td>" + esc(e.posology) + "</td><td>" + esc(e.prescriber_name) + "</td><td>" + esc(e.prescriber_reg_no) + "</td></tr>";
      }).join("") : '<tr><td colspan="7">Nothing recorded this month.</td></tr>') + "</tbody></table></div>";
    m.innerHTML = h;
    bind(m);
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#registers";
        else if (a === "prev") { S.month = shiftMonth(S.month, -1); load(); }
        else if (a === "next") { if (S.month < thisMonth()) { S.month = shiftMonth(S.month, 1); load(); } }
        else if (a === "print") window.print();
        else if (a === "new") { S.form = { entry_date: ymd(new Date()) }; paint(); setTimeout(function () { var c = m.querySelector("[name=client_id]"); if (c && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) c.focus(); }, 30); }
        else if (a === "cancel") { S.form = null; paint(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "drreg"); } catch (e) {} E.openClassic("dailyregister"); }
      });
    });
    var q = m.querySelector("#drr-q");
    if (q) q.addEventListener("input", function () {
      S.q = q.value; var pos = q.selectionStart; paint();
      var q2 = S.mount.querySelector("#drr-q"); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }
    });
    var f = m.querySelector("#drr-form");
    if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); save(f); });
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
  }

  async function save(f) {
    if (S.saving) return;
    var body = {};
    FIELDS.forEach(function (fd) { var el = f.querySelector("[name=" + fd[0] + "]"); body[fd[0]] = el ? String(el.value || "").trim() : ""; });
    var missing = FIELDS.filter(function (fd) { return !body[fd[0]]; }).map(function (fd) { return fd[0]; });
    S.form = Object.assign({}, body, { err: "", missing: missing });
    if (missing.length) { S.form.err = "Fill in " + missing.map(function (k) { return FIELDS.find(function (fd) { return fd[0] === k; })[1].toLowerCase(); }).join(", ") + ". Nothing was saved."; return paint(); }
    if (body.entry_date > ymd(new Date())) { S.form.err = "The date is in the future. Nothing was saved."; return paint(); }
    S.saving = true; paint();
    try {
      var r = await E.postOnce("/daily-register/entries", body, { list: async function () { var r0 = await E.apiFetch("/daily-register/entries?month=" + body.entry_date.slice(0, 7), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; },
        same: function (e) { return e.entry_date === body.entry_date && String(e.client_id || "").trim().toLowerCase() === String(body.client_id || "").trim().toLowerCase() && String(e.medicine_name_dose || "").trim().toLowerCase() === String(body.medicine_name_dose || "").trim().toLowerCase() && String(e.prescriber_reg_no || "").trim().toLowerCase() === String(body.prescriber_reg_no || "").trim().toLowerCase() && String(e.client_name || "").trim().toLowerCase() === String(body.client_name || "").trim().toLowerCase(); } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.form = null; E.toast("Added · " + body.medicine_name_dose + " · " + body.client_name, "success");
      S.month = body.entry_date.slice(0, 7);
    } catch (e) {
      S.form.err = E.saveFailText(e);
    }
    S.saving = false;
    return load();
  }

  E.registerModule({
    id: "drreg", title: "Daily register", order: 3, icon: "Rx", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.form = null; if (!S.month) S.month = thisMonth(); css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("drreg") < 0) E.UI2_DESTINATIONS.push("drreg");
  if (E.UI2_PARENT) E.UI2_PARENT.drreg = "registers";
})();
