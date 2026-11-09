/* Controlled drugs supplied (DDA sales), new layout: this month's entries by day, and one form per prescription
   (patient, prescriber, serial, then each medicine and quantity; one register entry per medicine, as in the classic
   register). A full ID card fills in the name and address from earlier entries; a known prescriber fills in the reg no.
   A serial that already has entries is shown and needs a second press (part-dispense), like the classic warning.
   Everything is checked before anything is sent; lines go one at a time and a failure keeps the rest in the form,
   so a retry never records a line twice. Other months and the printout use eikon.months.js.
   Correct (the pharmacist only, eikon.correct.js): the line is read again, the form is filled, a reason is required,
   and the whole entry is sent as the server has it with only the corrected fields changed (the update replaces every
   column), the same body as the classic edit. A line is never deleted here. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // One builder for both prescription registers: DDA sales and POYC take the same entries; they differ in the urgent
  // flag, in how the ID card is stored (sales pads it like the server does; POYC keeps it as typed) and in where
  // earlier patients and prescribers are looked up (sales has lookup routes; POYC searches its own recent months).
  function make(C) {
  var S = { mount: null, month: "", entries: [], doctors: [], loading: false, error: "", adding: null, saving: false, err: "", bad: {}, dup: null, dupOk: "" };
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var TEXT = ["entry_date", "client_id_card", "client_name", "client_address", "doctor_name", "doctor_reg_no", "prescription_serial_no"];
  // Correcting a line: the fields of the classic edit form, the classic's PUT body.
  var FIX = { entity: C.entity, action: C.action,
    fields: [{ k: "entry_date", label: "Supplied", type: "date", req: true, what: "the day it was supplied" }, { k: "client_id_card", label: "ID card", req: true, what: "the ID card" },
      { k: "client_name", label: "Patient", req: true, what: "the patient's name" }, { k: "client_address", label: "Address", req: true, what: "the address" },
      { k: "medicine_name_dose", label: "Medicine", req: true, what: "the medicine" }, { k: "quantity", label: "Qty", type: "int", req: true, what: "the quantity" },
      { k: "doctor_name", label: "Prescriber", req: true, what: "the prescriber" }, { k: "doctor_reg_no", label: "Reg no.", req: true, what: "the prescriber's reg no." },
      { k: "prescription_serial_no", label: "Serial no.", req: true, what: "the prescription serial no." }].concat(C.urgent ? [{ k: "urgent", label: "Urgent", type: "check" }] : []),
    rows: function () { return S.entries; },
    reread: async function (row) { // the line's month (and this month, if its date was changed elsewhere)
      var months = [String(row.entry_date || "").slice(0, 7), S.month].filter(function (x, i, a) { return /^\d{4}-\d{2}$/.test(x) && a.indexOf(x) === i; });
      for (var i = 0; i < months.length; i++) {
        var r = await E.apiFetch(C.path + "/entries?month=" + encodeURIComponent(months[i]), { method: "GET" });
        var hit = ((r && r.entries) || []).filter(function (e) { return String(e.id) === String(row.id); })[0];
        if (hit) return hit;
      }
      return null;
    },
    put: function (row) { return C.path + "/entries/" + encodeURIComponent(String(row.id)); },
    body: function (r) {
      var b = { entry_date: String(r.entry_date || "").trim(), client_name: String(r.client_name || "").trim(), client_id_card: C.pad ? idCard(r.client_id_card) : String(r.client_id_card || "").trim(),
        client_address: String(r.client_address || "").trim(), medicine_name_dose: String(r.medicine_name_dose || "").trim(), quantity: Number(r.quantity), doctor_name: String(r.doctor_name || "").trim(),
        doctor_reg_no: String(r.doctor_reg_no || "").trim(), prescription_serial_no: String(r.prescription_serial_no || "").trim() };
      if (C.urgent) b.urgent = Number(r.urgent) === 1 || r.urgent === true ? 1 : 0;
      return b;
    },
    check: function (r) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.entry_date)) || String(r.entry_date) > today()) return "Choose the day it was supplied (not a day ahead).";
      if (!/^\d+$/.test(String(r.quantity)) || Number(r.quantity) < 1) return "The quantity should be a whole number, 1 or more.";
      return "";
    },
    paint: function () { paint(); }, idle: function () { E.whenFormIdle(S.mount, function () { paint(); }); }, done: function () { return load(); } };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dmy(s) { var p = String(s).split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1].slice(0, 3); }
  function idCard(raw) { // same rule as the classic register and the server: 123M → 0000123M
    var s = String(raw || "").replace(/\s+/g, "").toUpperCase(), m = /^(\d{1,7})([A-Z])$/.exec(s);
    return m && C.pad ? ("0000000" + m[1]).slice(-7) + m[2] : s;
  }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x || "").trim(); if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = 1; out.push(k); } }); return out.sort(function (x, y) { return x.localeCompare(y); }); }
  function blank() { return { entry_date: today(), client_id_card: "", client_name: "", client_address: "", doctor_name: "", doctor_reg_no: "", prescription_serial_no: "", urgent: 0, lines: [{ medicine_name_dose: "", quantity: "" }] }; }

  function css() {
    if (document.getElementById("eikon-cdsreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-cdsreg-css";
    st.textContent =
      ".cds{max-width:880px;margin:0 auto}" +
      ".cds-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 8px 0 0;margin-bottom:2px;min-height:44px;cursor:pointer}" +
      ".cds-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".cds h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.cds-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".cds-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".cds-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cds-btn:disabled{opacity:.55;cursor:default}.cds-btn.t{border:0;background:none;color:var(--accent);padding:0 4px}" +
      ".cds-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.cds-lab b{color:var(--text)}" +
      ".cds-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".cds-row{display:flex;gap:12px;align-items:center;padding:10px 16px;border-top:.5px solid var(--border)}.cds-row:first-child{border-top:0}" +
      ".cds-row .t{flex:1;min-width:0}.cds-row b{font-size:15px;font-weight:600}.cds-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}.cds-row em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums;font-size:15px}" +
      ".cds-pill{font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(215,38,28,.12);color:var(--danger);margin-left:6px}" +
      ".cds-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".cds-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.cds-form label:first-child{border-top:0}" +
      ".cds-form label>span{flex:0 0 104px;font-size:15px}.cds-form input:not([type=checkbox]){flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".cds-form input[type=checkbox]{width:20px;height:20px;accent-color:var(--accent);margin-left:auto}.cds-form label small{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}" +
      ".cds-form .row{display:flex;align-items:center;gap:10px;padding:0 14px;border-top:.5px solid var(--border);min-height:44px}.cds-form .row input.n{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}.cds-form .row input.q{flex:0 0 64px;text-align:right;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit}" +
      ".cds-form .row.ok{opacity:.55}.cds-form .row small{color:var(--accent);font-size:12px;font-weight:600}" +
      ".cds-form .hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:12px 14px 4px;border-top:.5px solid var(--border);display:flex;justify-content:space-between}" +
      ".cds-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:space-between;align-items:center}" +
      ".cds-err{color:var(--danger);font-size:13px;padding:4px 14px}.cds-err:empty{padding:0}.cds-form label.miss>span{color:var(--danger)}.cds-form label.miss:focus-within>span{color:inherit}.cds-form .row.miss input.n::placeholder{color:var(--danger)}.cds-form .row .q[aria-invalid=true]{color:var(--danger)}" +
      ".cds-dup{margin:6px 14px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12);font-size:13.5px}.cds-dup b{display:block;margin-bottom:4px}.cds-dup div{color:var(--muted);font-size:12.5px}" +
      ".cds-hacts{display:flex;flex-direction:row-reverse;gap:8px;align-items:center}.cds-hacts .cds-btn{min-height:44px;display:inline-flex;align-items:center;text-decoration:none;border-radius:22px}.cds " + ".ecr-btn{border:0;background:none;min-height:44px;padding:0 8px;border-radius:8px}" +
      ".cds-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.cds{padding:4px 16px 0}.cds h1{font-size:32px}.cds-form label>span{flex-basis:92px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch(C.path + "/entries?month=" + encodeURIComponent(S.month), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the register");
      S.entries = r.entries || [];
      E.correct.loadMarks(C.id, FIX, S.month + "-01"); // which lines were corrected, by whom and why
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  // The legal register as the classic screen prints it (its report): the month, the classic's columns in its order,
  // oldest first (the report's order: date, then the order typed). DDA sales has the Urgent column; POYC has none.
  // E.printDocs.<cdsreg|poyreg>(ym, entries): the same doc the screen prints, for the inspection pack (one object, no copy).
  E.printDocs = E.printDocs || {};
  E.printDocs[C.id] = function (m, entries) {
    var MB = E.months, rows = (entries || []).slice().sort(function (a, b) { return String(a.entry_date).localeCompare(String(b.entry_date)) || Number(a.id) - Number(b.id); });
    return { register: C.report, month: m, landscape: true, sections: [{ heading: m, sub: "Range: " + MB.first(m) + " to " + MB.last(m), cols: C.printCols,
      rows: rows.map(function (r) {
        var row = [r.entry_date || "", r.client_name || "", r.client_id_card || "", r.client_address || "", r.medicine_name_dose || "", r.quantity == null ? "" : String(r.quantity), r.doctor_name || "", r.doctor_reg_no || "", r.prescription_serial_no || ""];
        if (C.urgent) row.push(r.urgent === 1 || r.urgent === true || String(r.urgent || "").toLowerCase() === "true" ? "URGENT" : "");
        return row; }),
      empty: "No entries for the selected date range." }] };
  };
  function printMonth() { E.months.print(E.printDocs[C.id](S.month, S.entries)); }
  async function loadDoctors() { // the prescribers this pharmacy sees most, for the name list
    try { S.doctors = await C.doctors(""); } catch (e) { S.doctors = []; }
    // only the suggestion list changes: redrawing the form here could swallow a tap that lands at the same moment
    var dl = S.mount && S.mount.querySelector("#cds-docs"); if (dl) dl.innerHTML = uniq(S.doctors.map(function (d) { return d.doctor_name; })).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== C.id) return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var mn = MON[Number(S.month.slice(5)) - 1] + " " + S.month.slice(0, 4);
    var h = '<div class="cds"><button class="cds-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(C.id) : "‹ Registers") + "</button>" +
      '<div class="cds-top"><div><h1>' + esc(C.title) + '</h1><p class="cds-sub">' + esc(C.sub) + '</p></div><span class="cds-hacts">' + (S.adding ? "" : '<button class="cds-btn p" data-act="add">New prescription</button>') + '<a class="cds-btn cds-bymed" href="#cdreg">By medicine</a></span></div>'; // the main button first in Tab order (right after the heading), drawn on the right
    if (S.adding) {
      var a = S.adding, saved = a.lines.some(function (l) { return l.saved; }), lock = saved ? " disabled" : "";
      var bad = S.bad || {}, inv = function (k) { return bad[k] ? ' aria-invalid="true"' : ""; };
      var fld = function (k, label, extra, hint) { return '<label' + (bad[k] ? ' class="miss"' : "") + '><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k]) + '"' + (extra || "") + inv(k) + lock + ">" + (hint || "") + "</label>"; };
      h += '<form class="cds-form" id="cds-add" autocomplete="off">' +
        fld("entry_date", "Supplied", ' type="date" max="' + esc(today()) + '"') +
        fld("client_id_card", "ID card", ' placeholder="e.g. 123456M" autocapitalize="characters"', a.found ? "<small>Known</small>" : "") +
        fld("client_name", "Patient", ' placeholder="Name and surname"') +
        fld("client_address", "Address", ' placeholder="Street, number, town"') +
        fld("doctor_name", "Prescriber", ' list="cds-docs" placeholder="Dr name"') +
        fld("doctor_reg_no", "Reg no.", ' inputmode="numeric"') +
        fld("prescription_serial_no", "Serial no.", ' placeholder="From the prescription"') +
        (C.urgent ? '<label><span>Urgent</span><input type="checkbox" name="urgent"' + (a.urgent ? " checked" : "") + lock + "></label>" : "") +
        '<div class="hd"><span>Medicine, strength and form</span><span>Qty</span></div>' +
        a.lines.map(function (l, i) {
          var ln = a.lines.length > 1 ? ", line " + (i + 1) : "";
          return '<div class="row' + (l.saved ? " ok" : "") + (bad["n" + i] ? " miss" : "") + '"><input class="n" data-i="' + i + '" data-k="medicine_name_dose" list="cds-meds" value="' + esc(l.medicine_name_dose) + '" placeholder="e.g. Morphine 10mg tablets" aria-label="Medicine, strength and form' + ln + '"' + inv("n" + i) + (l.saved ? " disabled" : "") + ">" +
            (l.saved ? "<small>Saved</small>" : '<input class="q" data-i="' + i + '" data-k="quantity" inputmode="numeric" value="' + esc(l.quantity) + '" placeholder="0" aria-label="Quantity' + ln + '"' + inv("q" + i) + ">") + "</div>";
        }).join("");
      if (S.dup) h += '<div class="cds-dup"><b>Serial ' + esc(a.prescription_serial_no) + " already has " + S.dup.entries.length + (S.dup.entries.length === 1 ? " entry" : " entries") + " (" + esc(S.dup.total_qty) + " given). If this is the rest of the prescription, press Yes, record.</b>" +
        S.dup.entries.slice(0, 4).map(function (e) { return "<div>" + esc(dmy(e.entry_date)) + " · " + esc(e.client_name) + " · " + esc(e.medicine_name_dose) + " × " + esc(e.quantity) + "</div>"; }).join("") + "</div>";
      h += '<div class="cds-err" role="alert">' + esc(S.err) + "</div>" +
        '<div class="acts"><button type="button" class="cds-btn t" data-act="line">Add a medicine</button><span style="display:flex;gap:8px"><button type="button" class="cds-btn" data-act="add-cancel">' + (saved ? "Close" : "Cancel") + '</button><button type="submit" class="cds-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : S.dup ? "Yes, save it" : "Save prescription") + "</button></span></div>" +
        '<datalist id="cds-docs">' + uniq(S.doctors.map(function (d) { return d.doctor_name; })).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
        '<datalist id="cds-meds">' + uniq(S.entries.map(function (e) { return e.medicine_name_dose; })).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    }
    h += E.months.bar(S.month, { label: C.title });
    if (S.loading && !S.entries.length) h += '<div class="cds-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="cds-quiet">' + esc(S.error) + "</div>";
    else {
      if (S.entries.length) h += '<div class="cds-lab"><span><b>' + S.entries.length + "</b> " + (S.entries.length === 1 ? "line" : "lines") + " supplied in " + esc(mn) + "</span></div>";
      if (E.cdMonthSummary) h += E.cdMonthSummary(S.entries, "medicine_name_dose", "supplied"); // this month by medicine, from the lines already here
      h += S.entries.length ? '<div class="cds-list">' + S.entries.map(function (e) {
        return '<div class="cds-row"><div class="t"><b>' + esc(e.medicine_name_dose) + "</b>" + (Number(e.urgent) ? '<i class="cds-pill" style="font-style:normal">Urgent</i>' : "") +
          "<span>" + esc(dmy(e.entry_date)) + " · " + esc(e.client_name) + " · " + esc(e.doctor_name) + " · Rx " + esc(e.prescription_serial_no) + "</span>" + E.correct.mark(C.id, e) + "</div><em>" + esc(e.quantity) + "</em>" +
          E.correct.button(C.id, e, e.medicine_name_dose + " × " + e.quantity + " for " + e.client_name + ", " + dmy(e.entry_date)) + "</div>" + E.correct.panel(C.id, e, FIX);
      }).join("") + "</div>" : '<div class="cds-quiet" data-empty>' + esc(E.months.empty(S.month, "Nothing supplied this month yet.")) + (S.adding ? "" : ' <button class="cds-btn p" data-act="add" style="margin-left:6px">New prescription</button>') + "</div>";
    }
    h += '<p class="ecr-foot" style="font-size:12.5px;color:var(--muted);margin-top:12px">' + (E.correct.can && E.correct.can() ? "Made a mistake? Press Correct on the line — what it said before stays on record." : "Made a mistake? A wrong line is corrected by the pharmacist (Correct, with the reason).") + "</p></div>";
    var ae = document.activeElement, back = ae && m.contains(ae) && ae.closest && ae.closest("#cds-add") ? (ae.name ? "[name=" + ae.name + "]" : ae.getAttribute("data-i") != null ? '[data-i="' + ae.getAttribute("data-i") + '"][data-k="' + ae.getAttribute("data-k") + '"]' : "") : "";
    m.innerHTML = h;
    if (back) { var again = m.querySelector("#cds-add " + back); if (again && !again.disabled) again.focus(); } // a lookup filling fields keeps your place
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash(C.id) : "#registers";
        else if (act === "add") { S.adding = blank(); S.err = ""; S.bad = {}; S.dup = null; S.dupOk = ""; paint(); if (!S.doctors.length) loadDoctors(); var f = m.querySelector("[name=client_id_card]"); if (f) f.focus(); }
        else if (act === "add-cancel" && S.fromCd && E.cdHand) { S.adding = null; S.dup = null; S.fromCd = ""; E.cdHand.back(); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; S.bad = {}; S.dup = null; paint(); var ab = m.querySelector("[data-act=add]"); if (ab) ab.focus(); }
        else if (act === "line") { keep(); S.adding.lines.push({ medicine_name_dose: "", quantity: "" }); paint(); var ins = m.querySelectorAll(".cds-form .row input.n"); if (ins.length) ins[ins.length - 1].focus(); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", C.id); } catch (x) {} E.openClassic(C.classic); }
      });
    });
    E.months.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; E.correct.reset(C.id); load(); }, paint: function () { paint(); }, print: printMonth });
    E.correct.wire(m, C.id, FIX);
    if (E.cdMonthWire) E.cdMonthWire(m);
    var f = m.querySelector("#cds-add");
    if (f && E.cdBalanceWire) E.cdBalanceWire(f, -1); // the balance check at entry (words only)
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      f.addEventListener("input", function (ev) { unmark(ev.target); }); // a field being put right stops being red
      if (E.ddaMedSuggest) f.querySelectorAll("input.n").forEach(function (el) { E.ddaMedSuggest(el, { path: C.path, field: "medicine_name_dose", known: function () { return S.entries.map(function (e) { return e.medicine_name_dose; }); } }); }); // generic or brand, and what was written before
      // lookups run as the ID card is completed and when the prescriber field is left (a repaint can swallow a "change" event)
      var idIn = f.querySelector("[name=client_id_card]"); if (idIn) { idIn.addEventListener("input", function () { clearTimeout(S.idT); S.idT = setTimeout(function () { lookupPatient(idIn.value); }, 300); }); idIn.addEventListener("blur", function () { lookupPatient(idIn.value); }); }
      var dn = f.querySelector("[name=doctor_name]"); if (dn) dn.addEventListener("blur", function () { lookupDoctor(dn.value); });
      // people known here, offered as the ID card or the name is typed; choosing one fills only empty fields
      if (E.personPick) E.personPick.attach({ key: C.id, form: f, fields: { id: "client_id_card", name: "client_name", address: "client_address" }, sources: C.pad ? ["dda", "people"] : ["people"], idValue: idCard,
        local: function () { return S.entries.map(function (e) { return { name: e.client_name, id_card: e.client_id_card, address: e.client_address, date: e.entry_date, from: C.pad ? "DDA sale" : "POYC" }; }); },
        onFill: function () { keep(); } });
      var sn = f.querySelector("[name=prescription_serial_no]"); if (sn) sn.addEventListener("input", function () { if (S.dup) { S.dup = null; S.dupOk = ""; keep(); E.repaintKeepingFocus(S.mount, function () { paint(true); }); } }); // the cursor stays where you are typing
    }
  }

  function unmark(el) {
    if (!el || el.getAttribute("aria-invalid") !== "true") return;
    el.removeAttribute("aria-invalid");
    var k = el.name || (el.getAttribute("data-k") === "quantity" ? "q" : "n") + el.getAttribute("data-i"), box = el.closest("label, .row");
    if (S.bad) delete S.bad[k];
    if (box && !box.querySelector("[aria-invalid=true]")) box.classList.remove("miss");
  }
  function keep() {
    var f = S.mount && S.mount.querySelector("#cds-add"); if (!f || !S.adding) return;
    TEXT.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el && !el.disabled) S.adding[k] = String(el.value || "").trim(); });
    var u = f.querySelector("[name=urgent]"); if (u && !u.disabled) S.adding.urgent = u.checked ? 1 : 0;
    f.querySelectorAll("[data-i]").forEach(function (el) { var l = S.adding.lines[Number(el.getAttribute("data-i"))]; if (l && !l.saved) l[el.getAttribute("data-k")] = String(el.value || "").trim(); });
  }

  async function lookupPatient(raw) {
    var id = idCard(raw); if (!/^\d{1,7}[A-Z]$/.test(id) || !S.adding || S.adding.looked === id) return;
    S.adding.looked = id;
    try {
      var r = await C.patient(id);
      if (!S.adding || !r || !r.ok) return;
      keep(); idInPlace(id);
      if (r.found) { // fill only what is still empty: never overwrite what was typed
        fillIn({ client_name: r.client_name, client_address: r.client_address }); markKnown(true);
      } else { // not in this register yet: the pharmacy's people list may know them from another screen
        var p = E.people ? await E.people.byIdCard(id) : null;
        if (!S.adding || S.adding.looked !== id) return;
        keep(); idInPlace(id); // what was typed while the second lookup ran is kept
        if (p) fillIn({ client_name: p.name, client_address: p.address });
        markKnown(!!p);
      }
    } catch (e) {}
  }
  async function lookupDoctor(name) {
    name = String(name || "").trim(); if (!name || !S.adding || S.adding.lookedDoc === name) return;
    S.adding.lookedDoc = name;
    var hit = S.doctors.filter(function (d) { return d.doctor_name.toLowerCase() === name.toLowerCase(); });
    if (!hit.length) { try { hit = (await C.doctors(name)).filter(function (d) { return d.doctor_name.toLowerCase() === name.toLowerCase(); }); } catch (e) { return; } }
    var regs = uniq(hit.map(function (d) { return d.doctor_reg_no; }));
    if (regs.length !== 1 || !S.adding) return; // two doctors with one name: let the person type it
    keep(); fillIn({ doctor_reg_no: regs[0] });
  }
  // A lookup fills the form in place, only fields still empty and never the one with focus. It used to redraw the form
  // (paint(true)) while focus was moving to the next field; that field was replaced and what was typed next was lost.
  function addForm() { return S.mount && S.mount.querySelector("#cds-add"); }
  function fillIn(vals) {
    var a = S.adding, f = addForm(), want = {}; if (!a) return;
    Object.keys(vals).forEach(function (k) { if (vals[k] && !a[k]) want[k] = String(vals[k]); });
    if (!f) { Object.keys(want).forEach(function (k) { a[k] = want[k]; }); return; }
    E.fillEmpty(f, want).forEach(function (k) { a[k] = want[k]; });
  }
  function idInPlace(id) { // the ID card written the register's way (123m -> 0000123M), unless it is still being typed
    var el = addForm() && addForm().querySelector("[name=client_id_card]");
    if (el && el !== document.activeElement && !el.disabled) { el.value = id; S.adding.client_id_card = id; }
  }
  function markKnown(on) {
    S.adding.found = !!on;
    var el = addForm() && addForm().querySelector("[name=client_id_card]"), lab = el && el.closest("label"), sm = lab && lab.querySelector("small");
    if (on && lab && !sm) lab.insertAdjacentHTML("beforeend", "<small>Known</small>"); else if (!on && sm) sm.remove();
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    a.client_id_card = idCard(a.client_id_card);
    var todo = a.lines.filter(function (l) { return !l.saved && (l.medicine_name_dose || l.quantity); });
    // Everything that is missing or wrong is said at once, each field marked; the cursor goes to the first one.
    var need = [["client_id_card", "the ID card"], ["client_name", "the patient's name"], ["client_address", "the address"], ["doctor_name", "the prescriber"], ["doctor_reg_no", "the prescriber's reg no."], ["prescription_serial_no", "the serial no."]];
    var bad = {}, say = [], first = "";
    var flag = function (k, sel, words) { bad[k] = 1; if (words) say.push(words); if (!first) first = sel; };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.entry_date) || a.entry_date > today()) flag("entry_date", "[name=entry_date]", "the day it was supplied (today or earlier)");
    need.forEach(function (n) { if (!a[n[0]]) flag(n[0], "[name=" + n[0] + "]", n[1]); });
    var lineSay = [];
    if (!todo.length) { flag("n0", '[data-i="0"][data-k=medicine_name_dose]', "at least one medicine and its quantity"); }
    else todo.forEach(function (l) {
      var i = a.lines.indexOf(l);
      if (!l.medicine_name_dose) { bad["n" + i] = 1; if (!first) first = '[data-i="' + i + '"][data-k=medicine_name_dose]'; lineSay.push("the medicine for quantity " + l.quantity); }
      else if (!/^\d+$/.test(l.quantity) || Number(l.quantity) < 1) { bad["q" + i] = 1; if (!first) first = '[data-i="' + i + '"][data-k=quantity]'; lineSay.push("how many of " + l.medicine_name_dose + " (a whole number)"); }
    });
    say = say.concat(lineSay);
    S.bad = bad;
    if (say.length) S.err = "Write " + (say.length === 1 ? say[0] : say.slice(0, -1).join(", ") + " and " + say[say.length - 1]).replace(/\.$/, "") + ". Nothing was saved.";
    if (S.err) { paint(true); var fx = first && S.mount && S.mount.querySelector("#cds-add " + first); if (fx && !fx.disabled) fx.focus(); return; }
    // a serial already in the register: show it once and ask for a second press (part-dispense), like the classic warning
    if (!a.lines.some(function (l) { return l.saved; }) && S.dupOk !== a.prescription_serial_no) {
      S.saving = true; paint();
      var dup = null; try { var c = await E.apiFetch(C.path + "/check-serial?serial=" + encodeURIComponent(a.prescription_serial_no), { method: "GET" }); if (c && c.ok && c.found) dup = c; } catch (e) {}
      S.saving = false;
      if (dup) { S.dup = dup; S.dupOk = a.prescription_serial_no; return paint(); }
    }
    // the ID card and the person: add it to them, stop on someone else's card, or change theirs (E.people.confirmPerson)
    var asked = null;
    if (!a.lines.some(function (l) { return l.saved; }) && E.people && E.people.confirmPerson) {
      S.saving = true; paint();
      asked = await E.people.confirmPerson({ name: a.client_name, id_card: a.client_id_card, address: a.client_address }, { key: C.id, record: C.pad ? "DDA sale" : "POYC entry" });
      S.saving = false;
      if (asked.action !== "save") { // nothing is saved; the form keeps everything (a name or card put in when asked)
        if (asked.action === "fill") { if (asked.field === "name") a.client_name = asked.value; else a.client_id_card = idCard(asked.value); }
        paint(true); var back = S.mount && S.mount.querySelector("[name=" + (asked.field === "name" ? "client_name" : "client_id_card") + "]"); if (back) back.focus();
        return;
      }
    }
    S.saving = true; paint();
    var done = 0, failed = "", lost = null;
    // count what the register already holds for these lines, so a save whose answer is lost can be checked afterwards
    var monthList = async function () { var r0 = await E.apiFetch(C.path + "/entries?month=" + a.entry_date.slice(0, 7), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; };
    var same = function (e, l) { return e.entry_date === a.entry_date && String(e.medicine_name_dose).trim().toLowerCase() === String(l.medicine_name_dose).trim().toLowerCase() && Number(e.quantity) === Number(l.quantity) && String(e.prescription_serial_no).trim() === a.prescription_serial_no && String(e.client_id_card).replace(/\s+/g, "").toUpperCase().replace(/^0+/, "") === String(a.client_id_card).replace(/\s+/g, "").toUpperCase().replace(/^0+/, ""); };
    var before = null; try { before = await monthList(); } catch (e0) { before = null; }
    for (var i = 0; i < todo.length; i++) {
      var l = todo[i];
      try {
        var r = await E.apiFetch(C.path + "/entries", { method: "POST", body: JSON.stringify({ entry_date: a.entry_date, client_name: a.client_name, client_id_card: a.client_id_card, client_address: a.client_address,
          medicine_name_dose: l.medicine_name_dose, quantity: Number(l.quantity), doctor_name: a.doctor_name, doctor_reg_no: a.doctor_reg_no, prescription_serial_no: a.prescription_serial_no, urgent: a.urgent ? 1 : 0 }) }); // the POYC server ignores urgent
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
        l.saved = true; done++;
      } catch (x) { failed = x && x.network ? E.saveFailText(x) : String((x && (x.message || x)) || "error"); lost = x && x.network ? l : null; break; } // stop: the rest stay in the form
    }
    if (lost && before) { // the answer was lost: look in the register before anything is sent again
      try {
        var after = await monthList();
        if (after.filter(function (e) { return same(e, lost); }).length > before.filter(function (e) { return same(e, lost); }).length) { lost.saved = true; done++; failed = todo[done] ? "the connection dropped (the line before it did save)" : ""; }
        else failed = "the connection dropped and it is not in the register";
      } catch (e1) { failed = "the connection dropped. Check the register below before pressing Save prescription again"; }
    }
    S.saving = false;
    if (done && E.linkPerson) E.linkPerson({ name: a.client_name, id_card: a.client_id_card, address: a.client_address, doctor_name: a.doctor_name }, C.id === "poyreg" ? "register:poyc" : "register:dda-sales", asked); // one person in Customers, found or added
    var backCd = !failed && S.fromCd && E.cdHand; if (backCd) S.fromCd = ""; // opened from the medicine's register: back to it after the save
    if (!failed) { S.adding = null; S.bad = {}; S.dup = null; S.dupOk = ""; E.toast("Saved · " + (done === 1 ? ((a.lines.filter(function (l) { return l.saved; })[0] || a.lines[0] || {}).medicine_name_dose || "1 medicine") : done + " medicines") + " for " + a.client_name, "success"); if (a.entry_date.slice(0, 7) !== S.month) S.month = a.entry_date.slice(0, 7); }
    else S.err = (done ? done + " saved. " : "") + "Not saved from " + (todo[done] || {}).medicine_name_dose + ": " + String(failed).replace(/\.$/, "") + ". Press Save prescription to try the rest again.";
    if (backCd) { E.cdHand.back(); return; }
    return load();
  }

  E.registerModule({
    id: C.id, title: C.title, order: 3, icon: "℞", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.month = E.months.take(C.id) || today().slice(0, 7); S.entries = []; E.months.reset(); E.correct.reset(C.id); S.adding = null; S.err = ""; S.bad = {}; S.dup = null; S.dupOk = ""; S.fromCd = ""; css();
      var hand = E.cdHand && E.cdHand.take(C.id); // "Supplied" / "POYC" on a medicine's running register: the form opens with it written in
      if (hand) { S.fromCd = hand.name; S.adding = blank(); S.adding.lines[0].medicine_name_dose = String(hand.name || ""); paint(true); loadDoctors(); if (E.onReconnect) E.onReconnect(load); E.focusSoon(function () { return S.mount && S.mount.querySelector("#cds-add [name=client_id_card]"); }, 30); return load(); }
      paint(); if (E.onReconnect) E.onReconnect(load); return E.takeOpenForm(C.id, S.mount, load(), { btn: "[data-act=add]", form: "#cds-add", fill: { id_card: "client_id_card", name: "client_name", address: "client_address" } }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(C.id) < 0) E.UI2_DESTINATIONS.push(C.id);
  if (E.UI2_PARENT) E.UI2_PARENT[C.id] = "registers";
  }

  function ym(back) { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); }
  // POYC has no lookup routes: search its own last six months, newest first, as the classic POYC screen does
  async function poycSearch(q) {
    var res = await Promise.all([0, 1, 2, 3, 4, 5].map(function (b) { return E.apiFetch("/dda-poyc/entries?month=" + ym(b) + "&q=" + encodeURIComponent(q), { method: "GET" }).catch(function () { return null; }); }));
    return [].concat.apply([], res.map(function (r) { return (r && r.ok && r.entries) || []; }));
  }

  make({ id: "cdsreg", path: "/dda-sales", classic: "dda-sales", entity: "dda_sales_entries", action: "DDA_SALES_ENTRY_UPDATE", report: "DDA Sales Report",
    printCols: ["Date", "Client Name", "ID Card", "Address", "Medicine Name & Dose", "Qty", "Doctor Name", "Doctor Reg No.", "Prescription Serial No.", "Urgent"], title: "Controlled drugs supplied", sub: "Every controlled drug handed over against a prescription.", urgent: true, pad: true,
    patient: function (id) { return E.apiFetch("/dda-sales/client?client_id_card=" + encodeURIComponent(id), { method: "GET" }); },
    doctors: async function (q) { var r = await E.apiFetch("/dda-sales/doctors?limit=" + (q ? 5 : 50) + (q ? "&q=" + encodeURIComponent(q) : ""), { method: "GET" }); return (r && r.ok && r.doctors) || []; } });

  make({ id: "poyreg", path: "/dda-poyc", classic: "dda-poyc", entity: "dda_poyc_entries", action: "DDA_POYC_ENTRY_UPDATE", report: "DDA POYC Report",
    printCols: ["Date", "Client", "ID Card", "Address", "Medicine (name & dose)", "Qty", "Doctor", "Reg No.", "Prescription Serial No."], title: "POYC controlled drugs", sub: "Controlled drugs given under the Pharmacy of Your Choice scheme.", urgent: false, pad: false,
    patient: async function (id) {
      var hit = (await poycSearch(id)).filter(function (e) { return String(e.client_id_card || "").replace(/\s+/g, "").toUpperCase().replace(/^0+/, "") === id.replace(/^0+/, ""); })[0];
      return hit ? { ok: true, found: true, client_name: hit.client_name, client_address: hit.client_address } : { ok: true, found: false };
    },
    doctors: async function (q) {
      var rows = q ? await poycSearch(q) : [].concat.apply([], (await Promise.all([0, 1, 2].map(function (b) { return E.apiFetch("/dda-poyc/entries?month=" + ym(b), { method: "GET" }).catch(function () { return null; }); }))).map(function (r) { return (r && r.ok && r.entries) || []; }));
      var seen = {}, out = [];
      rows.forEach(function (e) { var k = e.doctor_name + "|" + e.doctor_reg_no; if (e.doctor_name && e.doctor_reg_no && !seen[k]) { seen[k] = 1; out.push({ doctor_name: e.doctor_name, doctor_reg_no: e.doctor_reg_no }); } });
      return out;
    } });
})();
