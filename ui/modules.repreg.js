/* Repeat prescriptions, new layout: the ones still valid (soonest to expire first), the ones that ran out in the last
   month, a search, and one form to record a prescription (expiry is set by the server, six months on). Renew opens the
   form filled with the same patient, medicine and prescriber. A known ID card fills the name; a known prescriber fills
   the reg no (only empty fields). Recording only; corrections and deletions stay in the classic register. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", q: "", adding: null, saving: false, err: "", mo: "", moEntries: [], moLoading: false, moError: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var F = ["entry_date", "client_id", "client_name", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function back(days) { var d = new Date(); d.setDate(d.getDate() - days); return ymd(d); }
  function daysUntil(s) { var p = String(s).split("-"), t = new Date(); return Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  // The year is left out when it is this year (3 Nov), kept otherwise (4 Mar 2027): rows stay on fewer lines on a phone.
  function dm(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + (Number(p[0]) === new Date().getFullYear() ? "" : " " + p[0]) : ""; }
  function low(s) { return String(s || "").toLowerCase(); }
  // Wide screens get a table (the classic's columns); phones and narrow windows keep the two-line list.
  var WIDE = "(min-width:1200px)", mqWide = null;
  function wide() { try { return window.matchMedia(WIDE).matches; } catch (e) { return false; } }
  function watchWidth() {
    if (mqWide) return;
    try { mqWide = window.matchMedia(WIDE); var f = function () { if (S.mount && E.state.activeModuleId === "repreg") E.whenFormIdle(S.mount, function () { paint(); }); };
      if (mqWide.addEventListener) mqWide.addEventListener("change", f); else if (mqWide.addListener) mqWide.addListener(f); } catch (e) {}
  }

  function css() {
    if (document.getElementById("eikon-repreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-repreg-css";
    st.textContent =
      ".rep{max-width:880px;margin:0 auto}" +
      ".rep-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".rep-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".rep h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.rep-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".rep-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".rep-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.rep-btn:disabled{opacity:.55;cursor:default}" +
      ".rep-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".rep-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.rep-lab b{color:var(--text)}" +
      ".rep-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".rep-row{display:flex;gap:12px;align-items:center;padding:11px 16px;border-top:.5px solid var(--border)}.rep-row:first-child{border-top:0}" +
      ".rep-row .t{flex:1;min-width:0}.rep-row b{font-size:15px;font-weight:600}.rep-row .m{font-size:14px;margin-top:2px}.rep-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}" +
      ".rep-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}.rep-pill.soon{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.rep-pill.gone{background:rgba(215,38,28,.12);color:var(--danger)}" +
      ".rep-row .a{display:flex;flex-direction:column;align-items:flex-end;gap:6px}" +
      ".rep-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".rep-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.rep-form label:first-child{border-top:0}" +
      ".rep-form label>span{flex:0 0 104px;font-size:15px}.rep-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}.rep-form label small{color:var(--accent);font-size:12px;font-weight:600}" +
      ".rep-form .note{font-size:13px;color:var(--muted);padding:8px 14px 0}.rep-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}" +
      ".rep-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".rep-h2{font-size:20px;font-weight:700;letter-spacing:-.01em;margin:28px 0 0}" +
      ".rep-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (min-width:1200px){.rep{max-width:1180px}}" +
      ".rep-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.rep-tbl{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;font-size:13.5px}" +
      ".rep-tbl th{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}" +
      ".rep-tbl td{padding:8px 12px;border-top:.5px solid var(--border);vertical-align:middle}.rep-tbl tbody tr:first-child td{border-top:0}.rep-tbl td.n{white-space:nowrap;font-variant-numeric:tabular-nums}.rep-tbl td.b{font-weight:600}.rep-tbl td.r{text-align:right;white-space:nowrap}.rep-tbl td.r .rep-btn{margin-left:8px}" +
      "@media (max-width:600px){.rep{padding:4px 16px 0}.rep h1{font-size:32px}.rep-form label>span{flex-basis:92px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { // a year back covers every prescription still valid (six months) and the ones just run out
      var r = await E.apiFetch("/repeat-prescriptions/entries?from=" + back(366) + "&to=" + today(), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load repeat prescriptions");
      S.entries = r.entries || [];
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load repeat prescriptions"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function key(e) { return low(e.client_id).replace(/\s+/g, "") + "|" + low(e.medicine_name_dose).replace(/\s+/g, " ").trim(); }
  function renewedBy(e) { // a later prescription for the same patient and medicine
    return S.entries.filter(function (x) { return x.id !== e.id && key(x) === key(e) && (x.entry_date > e.entry_date || (x.entry_date === e.entry_date && x.id > e.id)); })[0] || null;
  }
  function rowHtml(e) {
    var n = daysUntil(e.expires_date), nx = renewedBy(e);
    if (nx) return '<div class="rep-row"><div class="t"><b>' + esc(e.client_name) + '</b><div class="m">' + esc(e.medicine_name_dose) + " · " + esc(e.posology) + "</div><span>" + esc(e.client_id) + " · " + esc(e.prescriber_name) + " · written " + esc(dm(e.entry_date)) + '</span></div><div class="a"><span class="rep-pill">Renewed ' + esc(dm(nx.entry_date)) + "</span></div></div>";
    var pill = n < 0 ? '<span class="rep-pill gone">Expired ' + esc(dm(e.expires_date)) + "</span>" : n <= 21 ? '<span class="rep-pill soon">Expires in ' + n + (n === 1 ? " day" : " days") + "</span>" : '<span class="rep-pill">Until ' + esc(dm(e.expires_date)) + "</span>";
    return '<div class="rep-row"><div class="t"><b>' + esc(e.client_name) + '</b><div class="m">' + esc(e.medicine_name_dose) + " · " + esc(e.posology) + "</div><span>" + esc(e.client_id) + " · " + esc(e.prescriber_name) + " · written " + esc(dm(e.entry_date)) + '</span></div><div class="a">' + pill +
      '<button class="rep-btn" data-act="renew" data-id="' + e.id + '">Renew</button></div></div>';
  }

  function pillHtml(e) {
    var n = daysUntil(e.expires_date), nx = renewedBy(e);
    if (nx) return '<span class="rep-pill">Renewed ' + esc(dm(nx.entry_date)) + "</span>";
    return n < 0 ? '<span class="rep-pill gone">Expired ' + esc(dm(e.expires_date)) + "</span>" : n <= 21 ? '<span class="rep-pill soon">Expires in ' + n + (n === 1 ? " day" : " days") + "</span>" : '<span class="rep-pill">Until ' + esc(dm(e.expires_date)) + "</span>";
  }
  function tableHtml(rows) {
    return '<table class="rep-tbl"><thead><tr><th scope="col">Patient</th><th scope="col">ID card</th><th scope="col">Medicine</th><th scope="col">Dose</th><th scope="col">Prescriber</th><th scope="col">Written</th><th scope="col"><span class="rep-sr">Status</span></th></tr></thead><tbody>' +
      rows.map(function (e) {
        return '<tr><td class="b">' + esc(e.client_name) + '</td><td class="n">' + esc(e.client_id) + "</td><td>" + esc(e.medicine_name_dose) + "</td><td>" + esc(e.posology) + "</td><td>" + esc(e.prescriber_name) + '</td><td class="n">' + esc(dm(e.entry_date)) + '</td><td class="r">' + pillHtml(e) +
          (renewedBy(e) ? "" : '<button class="rep-btn" data-act="renew" data-id="' + e.id + '">Renew</button>') + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "repreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var qi = m.querySelector("#rep-q"); if (qi) S.q = qi.value;
    var h = '<div class="rep"><button class="rep-back" data-act="back">‹ Registers</button>' +
      '<div class="rep-top"><div><h1>Repeat prescriptions</h1><p class="rep-sub">Prescriptions on file, and when each one runs out.</p></div>' + (S.adding ? "" : '<button class="rep-btn p" data-act="add">Record a prescription</button>') + "</div>";
    if (S.adding) {
      var a = S.adding, fld = function (k, label, extra, hint) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + ">" + (hint || "") + "</label>"; };
      h += '<form class="rep-form" id="rep-add" autocomplete="off">' + fld("entry_date", "Written", ' type="date" max="' + esc(today()) + '"') + fld("client_id", "ID card", ' placeholder="e.g. 123456M" autocapitalize="characters"', a.known ? "<small>Known</small>" : "") +
        fld("client_name", "Patient", ' placeholder="Name and surname"') + fld("medicine_name_dose", "Medicine", ' placeholder="e.g. Atorvastatin 20mg"') + fld("posology", "Dose", ' placeholder="e.g. 1 at night"') +
        fld("prescriber_name", "Prescriber", ' list="rep-docs" placeholder="Dr name"') + fld("prescriber_reg_no", "Reg no.", ' inputmode="numeric"') +
        '<div class="note">Valid for six months from the day it was written.</div>' + (S.err ? '<div class="rep-err">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="rep-btn" data-act="add-cancel">Cancel</button><button type="submit" class="rep-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Record") + "</button></div>" +
        '<datalist id="rep-docs">' + uniq(S.entries.map(function (e) { return e.prescriber_name; })).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    }
    if (S.loading && !S.entries.length) h += '<div class="rep-quiet">Opening repeat prescriptions…</div>';
    else if (S.error) h += '<div class="rep-quiet">' + esc(S.error) + "</div>";
    else {
      h += '<input class="rep-q" id="rep-q" type="search" placeholder="Search patient, ID card or medicine" value="' + esc(S.q) + '">';
      var q = low(S.q).trim(), match = function (e) { return !q || [e.client_name, e.client_id, e.medicine_name_dose, e.prescriber_name].some(function (v) { return low(v).indexOf(q) >= 0; }); };
      var t = today(), list = S.entries.filter(match);
      var valid = list.filter(function (e) { return e.expires_date >= t; }).sort(function (x, y) { return String(x.expires_date).localeCompare(String(y.expires_date)); });
      var gone = list.filter(function (e) { return e.expires_date < t && e.expires_date >= back(30) && !renewedBy(e); }).sort(function (x, y) { return String(y.expires_date).localeCompare(String(x.expires_date)); });
      var W = wide(), block = function (rows) { return W ? tableHtml(rows) : '<div class="rep-list">' + rows.map(rowHtml).join("") + "</div>"; };
      h += '<div class="rep-lab">Still valid <b>' + valid.length + "</b></div>" + (valid.length ? block(valid) : '<div class="rep-quiet">' + (q ? "No valid prescription matches." : "No repeat prescription on file.") + "</div>");
      if (gone.length) h += '<div class="rep-lab">Ran out this month <b>' + gone.length + "</b></div>" + block(gone);
    }
    // Every prescription written in a month, any month: the register as the classic screen lists and prints it.
    var mo = S.moEntries.filter(function (e) { var q2 = low(S.q).trim(); return !q2 || [e.client_name, e.client_id, e.medicine_name_dose, e.prescriber_name].some(function (v) { return low(v).indexOf(q2) >= 0; }); });
    h += '<h2 class="rep-h2" id="rep-bymonth">Written by month</h2>' + E.months.bar(S.mo, { label: "Repeat prescriptions written" }) +
      (S.moLoading && !S.moEntries.length ? '<div class="rep-quiet">Opening ' + esc(E.months.label(S.mo)) + "…</div>" : S.moError ? '<div class="rep-quiet">' + esc(S.moError) + "</div>" :
        '<div class="rep-lab">Written in ' + esc(E.months.label(S.mo)) + " <b>" + mo.length + "</b></div>" + (mo.length ? '<div class="rep-list">' + mo.map(rowHtml).join("") + "</div>" : '<div class="rep-quiet" data-empty>' + (S.moEntries.length ? "No prescription that month matches." : esc(E.months.empty(S.mo))) + "</div>"));
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Correcting or deleting a prescription is in the <a href="#" data-act="classic" style="color:var(--accent)">classic register</a>.</p></div>';
    var ae = document.activeElement, keepSel = ae && m.contains(ae) && ae.name ? "[name=" + ae.name + "]" : ae && ae.id === "rep-q" ? "#rep-q" : "";
    m.innerHTML = h;
    if (keepSel) { var again = m.querySelector(keepSel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } } // typing keeps its place
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = "#registers";
        else if (act === "add") { S.adding = { entry_date: today() }; S.err = ""; paint(true); focus("client_id"); }
        else if (act === "renew") { var e = S.entries.find(function (x) { return x.id === Number(b.getAttribute("data-id")); }); if (!e) return; S.adding = { entry_date: today(), client_id: e.client_id, client_name: e.client_name, medicine_name_dose: e.medicine_name_dose, posology: e.posology, prescriber_name: e.prescriber_name, prescriber_reg_no: e.prescriber_reg_no, known: true }; S.err = ""; paint(true); window.scrollTo({ top: 0, behavior: "smooth" }); focus("entry_date"); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "repreg"); } catch (x) {} E.openClassic("repeatprescriptions"); }
      });
    });
    var qn = m.querySelector("#rep-q"); if (qn) qn.addEventListener("input", function () { paint(); });
    E.months.wire(m, { month: function () { return S.mo; }, go: function (ym) { S.mo = ym; S.moEntries = []; loadMonth(); }, paint: function () { paint(); }, print: printMonth });
    var f = m.querySelector("#rep-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      var idIn = f.querySelector("[name=client_id]"); if (idIn) idIn.addEventListener("blur", function () { fillPatient(); });
      var dn = f.querySelector("[name=prescriber_name]"); if (dn) dn.addEventListener("blur", function () { fillPrescriber(); });
      if (E.personPick) E.personPick.attach({ key: "repreg", form: f, fields: { id: "client_id", name: "client_name" }, idValue: function (v) { return String(v || "").replace(/\s+/g, "").toUpperCase(); },
        local: function () { return S.entries.map(function (e) { return { name: e.client_name, id_card: e.client_id, date: e.entry_date, from: "prescription" }; }); },
        onFill: function () { keep(); } });
    }
  }
  async function loadMonth() {
    var want = S.mo; S.moLoading = true; S.moError = ""; paint();
    try {
      var r = await E.apiFetch("/repeat-prescriptions/entries?month=" + encodeURIComponent(want), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the month");
      if (want !== S.mo) return;
      S.moEntries = (r.entries || []).slice().sort(function (a, b) { return String(b.entry_date).localeCompare(String(a.entry_date)) || b.id - a.id; });
    } catch (e) { if (want === S.mo) S.moError = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the month"); }
    if (want !== S.mo) return;
    S.moLoading = false; E.whenFormIdle(S.mount, paint);
  }
  // The classic printout: Date, Expires, Client (with the ID card), Medicine Name & Dose, Posology, Prescriber Name, Reg No; oldest first.
  function printMonth() {
    var MB = E.months;
    MB.print({ register: "Repeat prescriptions", month: S.mo, landscape: true, sections: [{ cols: ["Date", "Expires", "Client", "Medicine name and dose", "Posology", "Prescriber name", "Reg no"],
      rows: S.moEntries.slice().reverse().map(function (e) { return [MB.dmy(e.entry_date), MB.dmy(e.expires_date), { html: "<b>" + esc(e.client_name || "") + "</b><br>ID: " + esc(e.client_id || "") }, e.medicine_name_dose || "", e.posology || "", e.prescriber_name || "", e.prescriber_reg_no || ""]; }) }] });
  }
  function focus(n) { setTimeout(function () { var x = S.mount && S.mount.querySelector("[name=" + n + "]"); if (x && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) x.focus(); }, 30); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x || "").trim(); if (k && !seen[low(k)]) { seen[low(k)] = 1; out.push(k); } }); return out.sort(); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#rep-add"); if (!f || !S.adding) return;
    F.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }
  function fillPatient() { // only empty fields, from the newest earlier prescription for this ID card
    keep(); var raw = S.adding && S.adding.client_id, id = low(raw).replace(/\s+/g, ""); if (!id) return;
    var same = E.people ? function (v) { return E.people.sameIdCard(v, raw); } : function (v) { return low(v).replace(/\s+/g, "") === id; }; // 123M is 0000123M
    var hit = S.entries.filter(function (e) { return same(e.client_id); })[0];
    if (hit && !S.adding.client_name) { if (fillIn({ client_name: hit.client_name })) markKnown(); return; }
    if (hit || S.adding.client_name || !E.people) return;
    E.people.byIdCard(raw).then(function (p) { // not in this register: the pharmacy's people list may know them from another screen
      if (!p || !S.adding || S.adding.client_id !== raw) return;
      keep(); if (!S.adding.client_name && fillIn({ client_name: p.name })) markKnown();
    });
  }
  function fillPrescriber() {
    keep(); var n = low(S.adding && S.adding.prescriber_name).trim(); if (!n || S.adding.prescriber_reg_no) return;
    var regs = uniq(S.entries.filter(function (e) { return low(e.prescriber_name).trim() === n; }).map(function (e) { return e.prescriber_reg_no; }));
    if (regs.length === 1) fillIn({ prescriber_reg_no: regs[0] }); // two doctors with one name: let the person type it
  }
  // A lookup fills the form in place, only fields still empty and never the one with focus. It used to redraw the form
  // (paint(true)) as the field was left; the field focus was moving to was replaced and what was typed next was lost.
  function fillIn(vals) {
    var a = S.adding, f = S.mount && S.mount.querySelector("#rep-add"), want = {}; if (!a) return 0;
    Object.keys(vals).forEach(function (k) { if (vals[k] && !a[k]) want[k] = String(vals[k]); });
    var got = f ? E.fillEmpty(f, want) : Object.keys(want);
    got.forEach(function (k) { a[k] = want[k]; });
    return got.length;
  }
  function markKnown() {
    S.adding.known = true;
    var el = S.mount && S.mount.querySelector("#rep-add [name=client_id]"), lab = el && el.closest("label");
    if (lab && !lab.querySelector("small")) lab.insertAdjacentHTML("beforeend", "<small>Known</small>");
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    a.client_id = String(a.client_id || "").replace(/\s+/g, "").toUpperCase();
    var need = [["client_id", "the ID card"], ["client_name", "the patient's name"], ["medicine_name_dose", "the medicine"], ["posology", "the dose"], ["prescriber_name", "the prescriber"], ["prescriber_reg_no", "the prescriber's reg no."]];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.entry_date || "") || a.entry_date > today()) S.err = "Choose the day it was written. Nothing was saved.";
    else { var miss = need.filter(function (n) { return !a[n[0]]; })[0]; if (miss) S.err = "Write " + miss[1] + ". Nothing was saved."; }
    if (S.err) return paint(true);
    // the ID card and the person (E.people.confirmPerson): asked before anything is saved; Go back keeps the form
    var asked = null;
    if (E.people && E.people.confirmPerson) {
      S.saving = true; paint(true);
      asked = await E.people.confirmPerson({ name: a.client_name, id_card: a.client_id }, { key: "repreg", record: "prescription" });
      S.saving = false;
      if (asked.action !== "save") { if (asked.action === "fill") { if (asked.field === "name") a.client_name = asked.value; else a.client_id = asked.value; } paint(true); focus(asked.field === "name" ? "client_name" : "client_id"); return; }
    }
    S.saving = true; paint(true);
    try {
      var body = {}; F.forEach(function (k) { body[k] = a[k]; }); body.expires_date = ""; // the server sets six months on
      var r = await E.postOnce("/repeat-prescriptions/entries", body, { list: async function () { var r0 = await E.apiFetch("/repeat-prescriptions/entries?from=" + body.entry_date + "&to=" + body.entry_date, { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; },
        same: function (e) { return e.entry_date === body.entry_date && String(e.client_id || "").trim().toLowerCase() === String(body.client_id || "").trim().toLowerCase() && String(e.medicine_name_dose || "").trim().toLowerCase() === String(body.medicine_name_dose || "").trim().toLowerCase() && String(e.prescriber_reg_no || "").trim().toLowerCase() === String(body.prescriber_reg_no || "").trim().toLowerCase(); } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Recorded for " + a.client_name, "success");
      if (E.linkPerson) E.linkPerson({ name: body.client_name, id_card: body.client_id }, "register:repeat", asked); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false;
    if (!S.adding && a.entry_date) { S.mo = a.entry_date.slice(0, 7); loadMonth(); } // the month it was written shows it
    return load();
  }

  E.registerModule({
    id: "repreg", title: "Repeat prescriptions", order: 3, icon: "℞", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.err = ""; S.q = ""; S.mo = E.months.now(); S.moEntries = []; E.months.reset(); css(); watchWidth(); paint(); loadMonth(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("repreg") < 0) E.UI2_DESTINATIONS.push("repreg");
  if (E.UI2_PARENT) E.UI2_PARENT.repreg = "registers";
})();
