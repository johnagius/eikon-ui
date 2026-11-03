/* Repeat prescriptions, new layout: the ones still valid (soonest to expire first), the ones that ran out in the last
   month, a search, and one form to record a prescription (expiry is set by the server, six months on). Renew opens the
   form filled with the same patient, medicine and prescriber. A known ID card fills the name; a known prescriber fills
   the reg no (only empty fields). Recording only; corrections and deletions stay in the classic register. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", q: "", adding: null, saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var F = ["entry_date", "client_id", "client_name", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function back(days) { var d = new Date(); d.setDate(d.getDate() - days); return ymd(d); }
  function daysUntil(s) { var p = String(s).split("-"), t = new Date(); return Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function dm(s) { var p = String(s).split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0]; }
  function low(s) { return String(s || "").toLowerCase(); }

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
      ".rep-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.rep{padding:4px 16px 0}.rep h1{font-size:32px}.rep-form label>span{flex-basis:92px}}";
    document.head.appendChild(st);
  }

  async function load() {
    S.loading = true; S.error = ""; paint();
    try { // a year back covers every prescription still valid (six months) and the ones just run out
      var r = await E.apiFetch("/repeat-prescriptions/entries?from=" + back(366) + "&to=" + today(), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load repeat prescriptions");
      S.entries = r.entries || [];
    } catch (e) { S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load repeat prescriptions"); }
    S.loading = false; paint();
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
      h += '<div class="rep-lab">Still valid <b>' + valid.length + "</b></div>" + (valid.length ? '<div class="rep-list">' + valid.map(rowHtml).join("") + "</div>" : '<div class="rep-quiet">' + (q ? "No valid prescription matches." : "No repeat prescription on file.") + "</div>");
      if (gone.length) h += '<div class="rep-lab">Ran out this month <b>' + gone.length + '</b></div><div class="rep-list">' + gone.map(rowHtml).join("") + "</div>";
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Correcting or deleting a prescription and older ones are in the <a href="#" data-act="classic" style="color:var(--accent)">classic register</a>.</p></div>';
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
    var f = m.querySelector("#rep-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      var idIn = f.querySelector("[name=client_id]"); if (idIn) idIn.addEventListener("blur", function () { fillPatient(); });
      var dn = f.querySelector("[name=prescriber_name]"); if (dn) dn.addEventListener("blur", function () { fillPrescriber(); });
    }
  }
  function focus(n) { setTimeout(function () { var x = S.mount && S.mount.querySelector("[name=" + n + "]"); if (x) x.focus(); }, 30); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x || "").trim(); if (k && !seen[low(k)]) { seen[low(k)] = 1; out.push(k); } }); return out.sort(); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#rep-add"); if (!f || !S.adding) return;
    F.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }
  function fillPatient() { // only empty fields, from the newest earlier prescription for this ID card
    keep(); var id = low(S.adding && S.adding.client_id).replace(/\s+/g, ""); if (!id) return;
    var hit = S.entries.filter(function (e) { return low(e.client_id).replace(/\s+/g, "") === id; })[0];
    if (hit && !S.adding.client_name) { S.adding.client_name = hit.client_name; S.adding.known = true; paint(true); }
  }
  function fillPrescriber() {
    keep(); var n = low(S.adding && S.adding.prescriber_name).trim(); if (!n || S.adding.prescriber_reg_no) return;
    var regs = uniq(S.entries.filter(function (e) { return low(e.prescriber_name).trim() === n; }).map(function (e) { return e.prescriber_reg_no; }));
    if (regs.length === 1) { S.adding.prescriber_reg_no = regs[0]; paint(true); } // two doctors with one name: let the person type it
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
    S.saving = true; paint(true);
    try {
      var body = {}; F.forEach(function (k) { body[k] = a[k]; }); body.expires_date = ""; // the server sets six months on
      var r = await E.apiFetch("/repeat-prescriptions/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Recorded for " + a.client_name, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "repreg", title: "Repeat prescriptions", order: 3, icon: "℞", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.err = ""; S.q = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("repreg") < 0) E.UI2_DESTINATIONS.push("repreg");
  if (E.UI2_PARENT) E.UI2_PARENT.repreg = "registers";
})();
