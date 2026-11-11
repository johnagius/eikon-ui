/* Dispensing labels, new layout: fill one label (template, patient, medicine, dose, route, frequency, note,
   warnings), see the printed label as you type, print it, and pick a recent label to use again.
   Same endpoint and the same history entry as the classic Smart labels screen (GET/PUT /labels/state). The printed page
   is built by the classic screen's own code, copied unchanged (buildPrintHtml, printLabelHtml, openPrintTab), so the
   label that comes out of the printer is the same for the same input.
   Saving: the PUT sends the one new history entry (the server upserts history by id and never deletes by omission) with
   the templates and pharmacy details read from the server just before, unchanged (the server keeps settings exactly as
   sent, so they are never written over with an older copy). The entry keeps its id across retries.
   Labels are in English only (John, 2026-11-11), as on the classic screen: a template saved earlier with language
   "mt" prints English too, so reprinting an old Maltese label gives the English text of the same directions and
   warnings; templates and history are sent back exactly as read, never rewritten. Templates, the full history and the warnings table stay in
   the classic screen; the pharmacy's details are Settings › Pharmacy details (modules.phdreg.js, the same stored values).
   FIN-dayzero (W18): the printed label (buildPrintHtml) has the pharmacy's address and phone and plain directions, in the
   classic screen's code too, so a label still prints the same from either screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, loading: false, error: "", history: [], templates: [], pharm: {}, f: null, inc: false, variants: null, saving: false, again: false, err: "", pending: [], done: "", find: "" };
  // counter: this person's usual labels (starred) and the template used last, kept in this browser only
  function picks() { return E.picks ? E.picks("lblreg") : null; }
  function pref(k, v) { var key = "eikon_lblreg_" + k + ":" + ((E.state.user || {}).location_id || ""); try { if (v === undefined) return window.localStorage.getItem(key); window.localStorage.setItem(key, String(v)); } catch (e) { return null; } }
  function fold(v) { return E.people && E.people.foldMt ? E.people.foldMt(v) : String(v || "").toLowerCase(); }
  function usualOf(l) { // a usual label: the medicine and its directions, never the patient
    var d = { drugName: String(l.drugName || "").trim(), dose: l.dose || "", frequency: l.frequency || "", route: l.route || "", customInstructions: l.customInstructions || "", selectedWarnings: (l.selectedWarnings || []).slice(), templateId: l.templateId || "" };
    return { id: [norm(d.drugName), norm(d.dose), d.frequency, d.route, norm(d.customInstructions)].join("|"), label: d.drugName, sub: [d.dose, d.frequency, d.route !== "Oral" ? d.route : "", d.customInstructions].filter(Boolean).join(" · "), data: d };
  }

  // ---- the classic screen's code, unchanged (modules.labels.js) ----
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function uid() { return "lb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
  function todayStr() { var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function nowStr() { var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); }
  function fmtDate(v) {
    if (!v) return "-";
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) { var p = s.split(/[-T ]/); return p[2] + "/" + p[1] + "/" + p[0]; }
    return s;
  }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  function getDefaultTemplates() {
    return [
      { id: "tpl_std", name: "Standard Label", size: "standard", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: true },
      { id: "tpl_large", name: "Large Print (Elderly)", size: "large", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: false }
    ];
  }
  var WARNINGS = [
    { id: "w01", en: "Take with food" },
    { id: "w02", en: "Take on an empty stomach" },
    { id: "w03", en: "May cause drowsiness" },
    { id: "w04", en: "Do not drive or operate machinery" },
    { id: "w05", en: "Keep refrigerated (2-8°C)" },
    { id: "w06", en: "Shake well before use" },
    { id: "w07", en: "For external use only" },
    { id: "w08", en: "Avoid alcohol" },
    { id: "w09", en: "Avoid prolonged sun exposure" },
    { id: "w10", en: "Complete the full course" },
    { id: "w11", en: "Swallow whole, do not crush" },
    { id: "w12", en: "Dissolve under the tongue" },
    { id: "w13", en: "Take at bedtime" },
    { id: "w14", en: "Take in the morning" },
    { id: "w15", en: "Store below 25°C" },
    { id: "w16", en: "Keep out of reach of children" },
    { id: "w17", en: "Do not stop taking without medical advice" },
    { id: "w18", en: "May cause dizziness" },
    { id: "w19", en: "Take with plenty of water" },
    { id: "w20", en: "Not suitable during pregnancy" }
  ];
  var FREQUENCIES_EN = [
    "Once daily", "Twice daily", "Three times daily", "Four times daily",
    "Every morning", "Every evening", "Every 4 hours", "Every 6 hours",
    "Every 8 hours", "Every 12 hours", "Once weekly", "As needed", "As directed"
  ];
  var ROUTES = ["Oral", "Topical", "Sublingual", "Rectal", "Inhaled", "Nasal", "Ophthalmic", "Otic", "Intramuscular", "Subcutaneous", "Intravenous"];

  function buildPrintHtml(labelData, pharm, tpl) {
    var isLarge = tpl && tpl.size === "large";
    var fs = isLarge ? '2.8mm' : '2.2mm';
    var lh = '1.2';
    var h = '';
    h += '<div style="font-family:Arial,Helvetica,sans-serif;color:#000;font-size:' + fs + ';line-height:' + lh + ';">';
    // FIN-dayzero (W18): the pharmacy's address and phone under its name (Settings › Pharmacy details), the medicine on its
    // own line and the directions in words ("1 capsule, Three times daily (oral)"), no "Rx:" or "Dose/Freq: … | …".
    // The same in the classic Smart labels and the new Labels screen, so a label prints the same from either.
    h += '<div style="font-weight:900;">' + esc(pharm.name || "Pharmacy") + '</div>';
    var at = [];
    if (pharm.address) at.push(esc(pharm.address));
    if (pharm.phone) at.push('Tel ' + esc(pharm.phone));
    if (at.length) h += '<div style="font-size:.8em;">' + at.join(' \u00B7 ') + '</div>';
    if (labelData.patientName) h += '<div>For <b>' + esc(labelData.patientName) + '</b></div>';
    h += '<div style="font-weight:700;">' + esc(labelData.drugName || "") + '</div>';
    var how = [labelData.dose, labelData.frequency].filter(function (x) { return String(x || "").trim(); }).map(esc).join(', ');
    if (labelData.route) how += (how ? ' ' : '') + '(' + esc(String(labelData.route).toLowerCase()) + ')';
    if (how) h += '<div>' + how + '</div>';
    if (labelData.customInstructions) h += '<div>' + esc(labelData.customInstructions) + '</div>';
    // warnings
    var selWarnings = WARNINGS.filter(function (w) { return (labelData.selectedWarnings || []).indexOf(w.id) !== -1; });
    selWarnings.forEach(function (w) {
      h += '<div style="font-weight:700;font-size:.85em;">⚠ ' + esc(w.en);
      h += '</div>';
    });
    // date — same size as body so it's legible on small labels
    h += '<div style="font-size:.85em;color:#333;">' + fmtDate(todayStr());
    if (pharm.licence) h += ' \u00B7 Reg. no. ' + esc(pharm.licence);
    h += '</div>';
    h += '</div>';
    return h;
  }
  function openPrintTab(html) {
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var w = null;
    w = E.openPrintUrl(url, { delay: 80, closeAfter: true, closeDelay: 250 });
    if (!w) {
      try {
        var a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.style.display = "none";
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e2) {}
    }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
  function printLabelHtml(html) {
    openPrintTab(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
      '@page{margin:0;}' +
      'html,body{margin:0;padding:0.8mm 1mm 0.5mm 1.5mm;width:100%;height:auto;box-sizing:border-box;}' +
      'div,b,i,span{page-break-inside:avoid;}' +
      '</style></head><body>' +
      html +
      '</body></html>'
    );
  }
  // ---- end of the classic screen's code ----

  // The pharmacy on the label: the saved details, with the name taken from this pharmacy when none is saved (as the
  // classic screen does when it opens; here it is only used for printing, never saved).
  function pharmacy() {
    var p = Object.assign({ name: "", address: "", phone: "", licence: "" }, S.pharm || {});
    var u = E.state.user || {};
    if (!p.name && u.location_name) p.name = u.location_name;
    return p;
  }
  function blank() {
    var lastTpl = pref("tpl"), tid = S.templates.some(function (t) { return t.id === lastTpl; }) ? lastTpl : (S.templates.length > 0 ? S.templates[0].id : "tpl_std");
    return { patientName: "", drugName: "", dose: "", frequency: FREQUENCIES_EN[0], route: ROUTES[0], customInstructions: "", selectedWarnings: [], templateId: tid };
  }
  function tplOf(id) { return S.templates.find(function (t) { return t.id === id; }) || S.templates[0] || {}; }
  // the label exactly as the classic screen collects it from its form
  function labelNow() {
    var f = S.f;
    return { patientName: S.inc ? String(f.patientName || "").trim() : "", drugName: String(f.drugName || "").trim(), dose: String(f.dose || "").trim(), frequency: f.frequency, route: f.route,
      customInstructions: String(f.customInstructions || "").trim(), selectedWarnings: f.selectedWarnings, templateId: f.templateId };
  }
  // what the classic screen remembers about a medicine from the history: each different dose/frequency/route/note
  function medicines() {
    var db = {};
    S.history.forEach(function (l) {
      var drug = (l.drugName || "").trim(); if (!drug) return;
      var key = norm(drug); if (!db[key]) db[key] = { name: drug, entries: [] };
      var entry = { dose: l.dose || "", frequency: l.frequency || "", route: l.route || "", customInstructions: l.customInstructions || "", selectedWarnings: l.selectedWarnings || [] };
      var dup = db[key].entries.some(function (e) { return e.dose === entry.dose && e.frequency === entry.frequency && e.route === entry.route && e.customInstructions === entry.customInstructions; });
      if (!dup) db[key].entries.push(entry);
    });
    return db;
  }
  function patients() {
    if (!E._eikon_patients) E._eikon_patients = {}; // shared with the classic screen and screening
    S.history.forEach(function (l) { var n = (l.patientName || "").trim(); if (n) E._eikon_patients[norm(n)] = n; });
    return Object.keys(E._eikon_patients).map(function (k) { return E._eikon_patients[k]; });
  }
  function applyEntry(entry, typing) { // the classic autofill: only what the earlier label had
    var f = S.f;
    if (entry.dose && !(typing && f.dose)) f.dose = entry.dose; // as the name is typed, a dose already written stays
    if (entry.frequency) f.frequency = entry.frequency;
    if (entry.route) f.route = entry.route;
    if (entry.customInstructions && !(typing && f.customInstructions)) f.customInstructions = entry.customInstructions;
    if (entry.selectedWarnings && entry.selectedWarnings.length > 0) f.selectedWarnings = entry.selectedWarnings.slice();
    S.variants = null;
  }
  function variantText(entry, i) {
    var parts = [];
    if (entry.dose) parts.push(entry.dose);
    if (entry.frequency) parts.push(entry.frequency);
    if (entry.route && entry.route !== "Oral") parts.push(entry.route);
    if (entry.customInstructions) parts.push('"' + entry.customInstructions + '"');
    return parts.join(" • ") || "Variation " + (i + 1);
  }

  function css() {
    if (document.getElementById("eikon-lblreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-lblreg-css";
    st.textContent =
      ".lbl{max-width:1080px;margin:0 auto}" +
      ".lbl-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".lbl h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.lbl-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".lbl-btn{font:inherit;font-size:14px;font-weight:600;min-height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".lbl-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.lbl-btn:disabled{opacity:.55;cursor:default}" +
      ".lbl-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:20px;align-items:start;margin-top:16px}" +
      ".lbl-side{position:sticky;top:14px;min-width:0}" +
      ".lbl-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;min-width:0}" +
      ".lbl-form label,.lbl-form .row{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".lbl-form>label:first-child{border-top:0}" +
      ".lbl-form label>span,.lbl-form .row>span{flex:0 0 108px;font-size:15px}" +
      ".lbl-form input:not([type=checkbox]),.lbl-form select,.lbl-form textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".lbl-form textarea{resize:vertical;min-height:44px;line-height:1.4}" +
      ".lbl-form label.chk{justify-content:flex-start}.lbl-form label.chk input{width:20px;height:20px;accent-color:var(--accent);margin:0}" +
      ".lbl-form .hd{font-size:13px;font-weight:600;color:var(--muted);padding:14px 14px 5px;border-top:.5px solid var(--border)}" +
      ".lbl-seg{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:1;min-width:0;padding:6px 0}" +
      ".lbl-seg button,.lbl-chip{font:inherit;font-size:13.5px;font-weight:600;min-height:36px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;padding:4px 8px;line-height:1.2}" +
      ".lbl-seg button.on,.lbl-chip.on{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".lbl-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 12px}.lbl-chip{border-radius:999px;font-weight:500;text-align:left}" +
      ".lbl-var{padding:8px 14px 10px;border-top:.5px solid var(--border)}.lbl-var p{margin:0 0 6px;font-size:13px;color:var(--muted)}.lbl-var div{display:flex;flex-wrap:wrap;gap:6px}" +
      ".lbl-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:10px 14px 6px;border-top:.5px solid var(--border)}" +
      ".lbl-err{color:var(--danger);font-size:13px;padding:6px 14px 0}.lbl-ok{color:var(--muted);font-size:13px;padding:6px 14px 0}" +
      ".lbl-lab{font-size:13px;font-weight:600;color:var(--muted);margin:0 2px 7px}" +
      ".lbl-paper{background:#fff;color:#000;border:1px solid var(--border);border-radius:10px;padding:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}" +
      ".lbl-paper>.in{width:46mm;max-width:100%;padding:0.8mm 1mm 0.5mm 1.5mm;box-sizing:border-box;zoom:1.75;margin:0 auto;overflow-wrap:anywhere}" +
      ".lbl-cap{font-size:12.5px;color:var(--muted);margin:8px 2px 0;line-height:1.45}" +
      ".lbl-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".lbl-row{display:flex;gap:10px;align-items:center;padding:10px 14px;border-top:.5px solid var(--border)}.lbl-row:first-child{border-top:0}" +
      ".lbl-row .t{flex:1;min-width:0}.lbl-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.lbl-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".lbl-skel{border-radius:14px;margin-top:16px;max-width:640px}.lbl-skel i{height:44px}" + // the rest is .eikon-skel in app.css (E.skeleton)
      ".lbl-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".lbl-note{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}" +
      // counter: usual labels, Print again, the search over recent labels, and the actions in thumb reach on a phone
      ".lbl-wd{border-top:.5px solid var(--border)}.lbl-wd>summary{border-top:0;cursor:pointer;list-style:none;display:flex;gap:6px;align-items:baseline;min-height:20px;padding-bottom:10px}.lbl-wd>summary::-webkit-details-marker{display:none}" +
      ".lbl-wd>summary::before{content:'›';display:inline-block;transition:transform .15s;color:var(--muted)}.lbl-wd[open]>summary::before{transform:rotate(90deg)}.lbl-wd>summary .n{font-weight:400;overflow-wrap:anywhere}.lbl-wd>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}" +
      ".lbl-mini{display:none}.lbl-ph{color:#555;font-size:2.2mm;padding:2mm 0}" +
      ".lbl-acts .sp{flex:1}.lbl-star[aria-pressed=true] span{color:#B7791F}" +
      ".lbl-usual{margin-bottom:14px}.lbl-uchips{display:flex;flex-wrap:wrap;gap:8px}" +
      ".lbl-uchip{display:inline-flex;align-items:stretch;border:1px solid var(--border);border-radius:12px;background:var(--panel2);overflow:hidden;max-width:100%}" +
      ".lbl-uchip button{font:inherit;border:0;background:none;color:var(--text);cursor:pointer}.lbl-uchip .u{text-align:left;padding:7px 4px 7px 12px;min-height:44px;min-width:0}.lbl-uchip .u b{display:block;font-size:14px;font-weight:600;overflow-wrap:anywhere}.lbl-uchip .u span{display:block;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}" +
      ".lbl-uchip .x{width:36px;min-height:44px;font-size:18px;color:var(--muted);border-left:.5px solid var(--border)}.lbl-uchip button:hover{background:rgba(127,127,127,.07)}.lbl-uchip button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}" +
      ".lbl-flab{display:block;margin-top:16px}#lbl-recent{margin:8px 0 18px}#lbl-recent:empty{display:none}" +
      ".lbl-btn.a{color:var(--accent);border-color:var(--accent);background:transparent}.lbl-btn.q{border-color:transparent;background:transparent;color:var(--accent);font-weight:500}.lbl-btn.q:hover{text-decoration:underline}" +
      ".lbl-form input::-webkit-calendar-picker-indicator{display:none!important}" +
      ".lbl-more{display:block;width:100%;border:0;border-top:.5px solid var(--border);background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;padding:10px 14px;min-height:44px;text-align:left;cursor:pointer}" +
      ".lbl-find{display:block;width:100%;max-width:560px;box-sizing:border-box;height:42px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px}" +
      ".lbl-find:focus-visible{outline:2px solid var(--accent);outline-offset:1px}" +
      ".lbl-row .b{display:flex;gap:8px;flex:none}" +
      ".lbl :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) :is(.lbl-seg button.on,.lbl-chip.on){color:#00160E}html[data-ui2]:not([data-ui2-visit]) .lbl-err{color:#FF7A72}}" +
      "@media (max-width:860px){.lbl-grid{grid-template-columns:minmax(0,1fr)}.lbl-side{position:static}}" +
      "@media (max-width:600px){.lbl-btn{min-height:44px;border-radius:22px;padding:0 18px;font-size:15px}.lbl-back{display:inline-flex;align-items:center;min-height:44px;padding:0}.lbl-seg button,.lbl-chip{min-height:44px}.lbl-form label.chk input{width:24px;height:24px}.lbl{padding:4px 16px 0}.lbl h1{font-size:32px}.lbl-form label>span,.lbl-form .row>span{flex-basis:92px}" +
        ".lbl-acts{position:fixed;left:0;right:0;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:6;margin:0;padding:8px 16px;background:var(--bg);border-top:.5px solid var(--border);box-shadow:0 -6px 16px rgba(0,0,0,.06)}" +
        ".lbl-acts .lbl-btn.p{flex:1 1 auto}.lbl-acts .sp{display:none}.lbl-acts{flex-wrap:wrap}.lbl-mini{display:block;flex:1 1 100%;order:-1;font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lbl-mini b{color:var(--text)}.lbl-mini a{color:var(--accent);font-weight:600}.lbl{padding-bottom:110px!important}.lbl{padding-bottom:72px}.lbl-form :is(input,select,textarea,button){scroll-margin-bottom:150px}" +
        ".lbl-find{max-width:none;height:44px}" +
        ".lbl-wd>summary{min-height:44px;box-sizing:border-box;align-items:center;padding:10px 14px}" +
        ".lbl-row{flex-wrap:wrap}.lbl-row .t{flex:1 1 100%}.lbl-row .b{flex:1 1 100%}.lbl-row .b .lbl-btn{flex:1}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/labels/state", { method: "GET" });
      if (!r || r.ok === false) throw new Error((r && r.error) || "Could not load the labels");
      var st = r.state || r; // the same reading as the classic screen
      S.history = Array.isArray(st.labelHistory) ? st.labelHistory : [];
      S.templates = Array.isArray(st.templates) ? st.templates : [];
      if (S.templates.length === 0) S.templates = getDefaultTemplates();
      S.pharm = st.pharmacyDetails || {};
      if (!S.f) S.f = blank();
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the labels"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function previewHtml() {
    var tpl = tplOf(S.f.templateId);
    var lab = labelNow(); // before a medicine is written the paper says so (on screen only; the printed page is unchanged)
    var h = '<div class="lbl-lab" id="lbl-prev-lab">Printed label</div><div class="lbl-paper" role="group" aria-labelledby="lbl-prev-lab"><div class="in" id="lbl-prev">' + (lab.drugName ? buildPrintHtml(lab, pharmacy(), tpl) : '<div class="lbl-ph">The label shows here as you type the medicine.</div>') + "</div></div>";
    h += '<p class="lbl-cap">What the printer gets, line for line. Where the lines break depends on your label paper.</p>';
    return h;
  }
  function refreshPreview() {
    var box = S.mount && S.mount.querySelector("#lbl-side");
    if (box) box.innerHTML = previewHtml();
    var mini = S.mount && S.mount.querySelector("#lbl-mini");
    if (mini) mini.innerHTML = miniHtml();
  }
  // counter (phone): the label in one line beside Print, so it is checked before printing (the full preview is below)
  function miniHtml() {
    var l = labelNow(); if (!l.drugName) return "Write the medicine to see the label.";
    var n = (l.selectedWarnings || []).length;
    return "<b>" + esc(l.drugName) + "</b> " + esc([l.dose, l.frequency].filter(Boolean).join(" | ") + (l.patientName ? " · " + l.patientName : "") + (n ? " · " + n + (n === 1 ? " warning" : " warnings") : "")) + ' <a href="#lbl-side" data-act="see">See label</a>';
  }

  function statusHtml() {
    if (S.err) return '<div class="lbl-err">' + esc(S.err) + (S.pending.length && !S.saving ? ' <button type="button" class="lbl-btn" data-act="retry" style="margin:4px 0 0">Save again</button>' : "") + "</div>";
    if (S.saving) return '<div class="lbl-ok">Saving to the history\u2026</div>';
    if (S.done) return '<div class="lbl-ok">' + esc(S.done) + "</div>";
    return "";
  }
  function setStatus() { // the line under the form changes without redrawing the form being used
    var el = S.mount && S.mount.querySelector("#lbl-status"); if (!el) return;
    el.innerHTML = statusHtml();
    var rb = el.querySelector("[data-act=retry]"); if (rb) rb.addEventListener("click", function () { flush(); });
  }
  function formHtml() {
    var meds = medicines(), f = S.f, opt = function (list, cur) { return list.map(function (v) { return "<option" + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>"; }).join(""); };
    // counter: the medicine first (it fills in what it was given with before), the patient next, the label's look last
    var h = '<form class="lbl-form" id="lbl-add" autocomplete="off">' +
      '<label><span>Medicine</span><input name="drugName" list="lbl-meds" value="' + esc(f.drugName) + '" placeholder="Name and strength" aria-required="true" enterkeyhint="next"></label>';
    if (S.variants && S.variants.length) {
      h += '<div class="lbl-var" role="group" aria-labelledby="lbl-var-lab"><p id="lbl-var-lab">Given before in more than one way. Choose one:</p><div>' +
        S.variants.map(function (v, i) { return '<button type="button" class="lbl-chip" data-act="variant" data-i="' + i + '">' + esc(variantText(v, i)) + "</button>"; }).join("") + "</div></div>";
    }
    h += '<label><span>Dose</span><input name="dose" value="' + esc(f.dose) + '" placeholder="e.g. 1 tablet, 5ml"></label>' +
      '<label><span>Frequency</span><select name="frequency">' + opt(FREQUENCIES_EN, f.frequency) + "</select></label>" +
      '<label><span>Route</span><select name="route">' + opt(ROUTES, f.route) + "</select></label>" +
      '<label><span>Note</span><textarea name="customInstructions" rows="2" placeholder="Other directions">' + esc(f.customInstructions) + "</textarea></label>" +
      '<label class="chk"><input type="checkbox" name="inc"' + (S.inc ? " checked" : "") + '><span style="flex:1">Patient name on the label</span></label>' +
      (S.inc ? '<label><span>Patient</span><input name="patientName" list="lbl-pats" value="' + esc(f.patientName) + '" placeholder="Name and surname"></label>' : "") +
      '<details class="lbl-wd"' + (wOpen() ? " open" : "") + '><summary class="hd" id="lbl-w-lab">' + warnSummary() + '</summary><div class="lbl-chips" role="group" aria-labelledby="lbl-w-lab">' +
      WARNINGS.map(function (w) { var on = f.selectedWarnings.indexOf(w.id) !== -1; return '<button type="button" class="lbl-chip' + (on ? " on" : "") + '" data-act="warn" data-w="' + w.id + '" aria-pressed="' + on + '">' + esc(w.en) + "</button>"; }).join("") + "</div></details>" +
      '<div class="hd">Label</div>' +
      '<label><span>Template</span><select name="templateId">' + S.templates.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === f.templateId ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + "</select></label>";
    h += '<div id="lbl-status" role="status">' + statusHtml() + "</div>";
    var pk = picks(), starOn = !!(pk && f.drugName && pk.isFav(usualOf(f).id));
    h += '<div class="lbl-acts">' + (pk ? '<button type="button" class="lbl-btn lbl-star" data-act="star" aria-pressed="' + starOn + '"' + (String(f.drugName || "").trim() ? "" : " disabled") + '><span aria-hidden="true">' + (starOn ? "★" : "☆") + "</span> Usual label</button>" : "") +
      '<span class="sp"></span><div class="lbl-mini" id="lbl-mini">' + miniHtml() + '</div><button type="button" class="lbl-btn" data-act="clear">Clear</button><button type="submit" class="lbl-btn p">Print label</button></div>' +
      '<datalist id="lbl-meds">' + Object.keys(meds).map(function (k) { return '<option value="' + esc(meds[k].name) + '">'; }).join("") + "</datalist>" +
      '<datalist id="lbl-pats">' + patients().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    return h;
  }

  // counter: on a phone the 20 warnings fold away under one line that says which are chosen (open on a wider screen)
  function wOpen() { if (S.wOpen != null) return S.wOpen; try { return !window.matchMedia("(max-width:600px)").matches; } catch (e) { return true; } }
  function warnSummary() {
    var on = WARNINGS.filter(function (w) { return (S.f.selectedWarnings || []).indexOf(w.id) !== -1; });
    return "Warnings" + (on.length ? ' <span class="n">· ' + on.length + " chosen: " + esc(on.map(function (w) { return w.en; }).join(", ")) + "</span>" : ' <span class="n">· none chosen</span>');
  }
  function starState() { // the star follows what is typed: on when these directions are a usual label
    var b = S.mount && S.mount.querySelector("[data-act=star]"), pk = picks(); if (!b || !pk) return;
    var has = !!String(S.f.drugName || "").trim(), on = has && pk.isFav(usualOf(S.f).id);
    b.disabled = !has; b.setAttribute("aria-pressed", String(on)); var sp = b.querySelector("span"); if (sp) sp.textContent = on ? "★" : "☆";
  }
  // counter: usual labels, one tap fills the form (the patient stays as typed)
  function usualHtml() {
    var pk = picks(), list = pk ? pk.favs() : [];
    if (!list.length) return "";
    return '<div class="lbl-usual" role="group" aria-labelledby="lbl-usual-lab"><div class="lbl-lab" id="lbl-usual-lab">Usual labels</div><div class="lbl-uchips">' +
      list.map(function (x, i) { return '<span class="lbl-uchip"><button type="button" class="u" data-act="usual" data-i="' + i + '"><b>' + esc(x.label) + "</b>" + (x.sub ? "<span>" + esc(x.sub) + "</span>" : "") + '</button><button type="button" class="x" data-act="unusual" data-i="' + i + '" aria-label="Remove ' + esc(x.label) + ' from usual labels">×</button></span>'; }).join("") + "</div></div>";
  }
  // counter: when a label was printed, as the other Services lists say it ("Today 16:34", "8 Nov, 10:03"); the stored stamp is unchanged
  var MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function when(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(v || "")); if (!m) return String(v || "");
    var today = E.maltaYmd ? E.maltaYmd() : todayStr(), d = m[1] + "-" + m[2] + "-" + m[3];
    var y = new Date(Date.parse(today + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
    var day = d === today ? "Today" : d === y ? "Yesterday" : Number(m[3]) + " " + MON3[Number(m[2]) - 1] + (m[1] === today.slice(0, 4) ? "" : " " + m[1]);
    return day + (m[4] ? (day === "Today" || day === "Yesterday" ? " " : ", ") + m[4] : "");
  }
  // counter: recent labels with a search over the whole history; Print again is one tap
  function recentHtml() {
    var q = fold(S.find).trim(), all = S.history.map(function (l, i) { return { l: l, i: i }; });
    var list = q ? all.filter(function (x) { return fold([x.l.drugName, x.l.patientName, x.l.printedBy].join(" ")).indexOf(q) >= 0; }).slice(0, 20) : all.slice(0, S.moreRecent ? 10 : 3);
    if (!S.history.length) return "";
    if (!list.length) return '<div class="lbl-quiet" style="margin-top:0">No label for “' + esc(S.find.trim()) + '”. Try the medicine or the patient\'s surname.</div>';
    return '<div class="lbl-list">' + list.map(function (x) {
      var l = x.l, i = x.i, bits = [l.dose, l.frequency].filter(Boolean).join(" · ");
      return '<div class="lbl-row"><div class="t"><b>' + esc(l.drugName || "—") + "</b><span>" + esc((l.patientName ? l.patientName + " · " : "") + (bits ? bits + " · " : "") + when(l.printedAt) + (l.printedBy ? " · " + l.printedBy : "")) +
        '</span></div><div class="b"><button type="button" class="lbl-btn q" data-act="again" data-i="' + i + '" aria-label="Use again: ' + esc(l.drugName || "label") + '">Use again</button>' +
        '<button type="button" class="lbl-btn a" data-act="reprint" data-i="' + i + '" aria-label="Print again: ' + esc(l.drugName || "label") + (l.patientName ? " for " + esc(l.patientName) : "") + '">Print again</button></div></div>';
    }).join("") + (!q && !S.moreRecent && S.history.length > 3 ? '<button type="button" class="lbl-more" data-act="more">Show more recent labels</button>' : "") + "</div>" + (q && list.length === 20 ? '<p class="lbl-note" style="margin-top:6px">The 20 most recent matches. Type more to narrow it down.</p>' : "");
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "lblreg") return; // left before a reply came back: do not draw over the next screen
    if (S.f && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var h = '<div class="lbl"><button class="lbl-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("lblreg")) + '</button>' +
      '<h1>Dispensing labels</h1><p class="lbl-sub">Type the medicine, check the label, print it. A recent label prints again in one tap.</p>';
    if (S.loading && !S.f) h += E.skeleton(5, "Opening labels", "lbl-skel");
    else if (S.error && !S.f) h += '<div class="lbl-quiet" role="alert">' + esc(S.error) + ' <button type="button" class="lbl-btn" data-act="reload" style="margin-left:6px">Try again</button></div>';
    else if (S.f) {
      // counter: find a recent label first (one tap prints it again), the usual labels, then a new label
      if (S.history.length) h += '<label class="lbl-lab lbl-flab" for="lbl-find">Print a recent label again</label><input id="lbl-find" class="lbl-find" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Medicine or patient" value="' + esc(S.find) + '">';
      h += '<div id="lbl-recent">' + recentHtml() + "</div>";
      h += usualHtml();
      h += '<div class="lbl-grid"><div style="min-width:0"><div class="lbl-lab" style="margin-top:4px">New label</div>' + formHtml() + "</div>" + '<div class="lbl-side" id="lbl-side">' + previewHtml() + "</div></div>";
    }
    h += '<p class="lbl-note">The name, address and phone at the top of a label are the <a href="#phdreg" style="color:var(--accent)">Pharmacy details</a> in Settings. Templates, the full print history and the warnings table are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) && (ae.name ? "[name=" + ae.name + "]" : ae.id === "lbl-find" ? "#lbl-find" : "");
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) again.focus(); }
    wire();
  }

  function keep() {
    var f = S.mount && S.mount.querySelector("#lbl-add"); if (!f || !S.f) return;
    ["templateId", "patientName", "drugName", "dose", "frequency", "route", "customInstructions"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.f[k] = el.value; });
  }
  function focus(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); var ae = document.activeElement; if (x && !(ae && ae !== document.body && S.mount.contains(ae) && ae.closest && ae.closest("form"))) x.focus(); }, 30); }

  function wire() {
    var m = S.mount;
    function wireRecent(box) { box.querySelectorAll("[data-act]").forEach(function (b) { b.addEventListener("click", function (ev) { onAct(b, ev); }); }); }
    wireRecent(m);
    function onAct(b, ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("lblreg");
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "lblreg"); } catch (x) {} E.openClassic("labels"); }
        else if (act === "warn") { var id = b.getAttribute("data-w"), ws = S.f.selectedWarnings, i = ws.indexOf(id); if (i !== -1) ws.splice(i, 1); else ws.push(id); var on = i === -1; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); keep(); refreshPreview(); var sm = m.querySelector("#lbl-w-lab"); if (sm) sm.innerHTML = warnSummary(); }
        else if (act === "variant") { keep(); applyEntry(S.variants[Number(b.getAttribute("data-i"))]); paint(true); var d = m.querySelector("[name=dose]"); if (d) d.focus(); }
        else if (act === "clear") { S.f = blank(); S.variants = null; S.done = ""; if (!S.pending.length) S.err = ""; paint(true); focus("[name=drugName]"); }
        else if (act === "again") { var l = S.history[Number(b.getAttribute("data-i"))]; if (!l) return; S.f = { patientName: l.patientName, drugName: l.drugName, dose: l.dose, frequency: l.frequency, route: l.route, customInstructions: l.customInstructions, selectedWarnings: (l.selectedWarnings || []).slice(), templateId: l.templateId || (S.templates[0] || {}).id };
          if (l.patientName) S.inc = true; S.variants = null; S.done = ""; if (!S.pending.length) S.err = ""; paint(true); var pb = m.querySelector("#lbl-add button[type=submit]"); if (pb) pb.focus(); try { m.querySelector("#lbl-add").scrollIntoView({ block: "start", behavior: "smooth" }); } catch (x2) {} }
        else if (act === "retry") flush();
        else if (act === "see") { ev.preventDefault(); var sd = m.querySelector("#lbl-side"); if (sd) { try { sd.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x3) {} } }
        else if (act === "more") { S.moreRecent = true; var box = m.querySelector("#lbl-recent"); if (box) { box.innerHTML = recentHtml(); wireRecent(box); var rows = box.querySelectorAll("[data-act=reprint]"); if (rows[3]) rows[3].focus(); } }
        else if (act === "reprint") reprint(Number(b.getAttribute("data-i")));
        else if (act === "star") { keep(); var pk = picks(); if (!pk || !String(S.f.drugName || "").trim()) return; var u = usualOf(S.f), on = !pk.isFav(u.id); pk.fav(u, on); E.toast && E.toast(on ? "Added to usual labels." : "Taken off usual labels."); paint(true); var sb = m.querySelector("[data-act=star]"); if (sb) sb.focus(); }
        else if (act === "usual" || act === "unusual") { var pk2 = picks(), x = pk2 && pk2.favs()[Number(b.getAttribute("data-i"))]; if (!x) return; keep();
          if (act === "unusual") { pk2.fav(x, false); paint(true); var nx = m.querySelector("[data-act=usual]") || m.querySelector("[name=drugName]"); if (nx) nx.focus(); return; }
          var d0 = x.data || {}; S.f = Object.assign({}, S.f, { drugName: d0.drugName || "", dose: d0.dose || "", frequency: d0.frequency || FREQUENCIES_EN[0], route: d0.route || ROUTES[0], customInstructions: d0.customInstructions || "", selectedWarnings: (d0.selectedWarnings || []).slice(), templateId: S.templates.some(function (t) { return t.id === d0.templateId; }) ? d0.templateId : S.f.templateId });
          S.lastMed = norm(S.f.drugName); S.variants = null; S.done = ""; if (!S.pending.length) S.err = ""; paint(true); var nf = m.querySelector(S.inc && !S.f.patientName ? "[name=patientName]" : "#lbl-add button[type=submit]"); if (nf) nf.focus(); }
        else if (act === "reload") load().then(function () { focus("[name=drugName]"); });
    }
    var fd = m.querySelector("#lbl-find");
    if (fd) {
      fd.addEventListener("input", function () { S.find = fd.value; var box = m.querySelector("#lbl-recent"); if (box) { box.innerHTML = recentHtml(); wireRecent(box); } });
      fd.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === "ArrowDown") && m.querySelector("#lbl-recent [data-act=reprint]")) { e.preventDefault(); m.querySelector("#lbl-recent [data-act=reprint]").focus(); return; } if (e.key === "Escape" && fd.value) { e.preventDefault(); e.stopPropagation(); fd.value = ""; S.find = ""; var box = m.querySelector("#lbl-recent"); if (box) { box.innerHTML = recentHtml(); wireRecent(box); } } });
    }
    var f = m.querySelector("#lbl-add"); if (!f) return;
    if (E.personPick && f.querySelector("[name=patientName]")) E.personPick.attach({ key: "lblreg", form: f, fields: { name: "patientName" },
      local: function () { return patients().map(function (n) { return { name: n, from: "label" }; }); }, onFill: function () { keep(); refreshPreview(); } }); // people known to this pharmacy, and the names on earlier labels
    var wd = f.querySelector(".lbl-wd"); if (wd) wd.addEventListener("toggle", function () { S.wOpen = wd.open; });
    f.addEventListener("submit", function (ev) { ev.preventDefault(); print(); });
    f.addEventListener("input", function (ev) {
      var n = ev.target && ev.target.name; keep();
      if (n === "inc") return;
      if (n === "drugName") { // a medicine given before fills in what it had (the classic autofill)
        var med = medicines()[norm(S.f.drugName)];
        if (med && norm(S.f.drugName) !== S.lastMed) {
          S.lastMed = norm(S.f.drugName);
          if (med.entries.length === 1) { applyEntry(med.entries[0], true); redraw(); return; }
          if (med.entries.length > 1) { S.variants = med.entries; redraw(); return; }
        }
        if (!med) { S.lastMed = ""; if (S.variants) { S.variants = null; redraw(); return; } }
      }
      if (S.done || (S.err && !S.pending.length)) { S.done = ""; S.err = ""; setStatus(); } // typing clears an old note (an unsaved label's note stays)
      refreshPreview();
      starState();
    });
    function redraw() { E.repaintKeepingFocus(m, function () { paint(true); }); } // mid-word in the medicine name: the cursor stays put
    var inc = f.querySelector("[name=inc]");
    if (inc) inc.addEventListener("change", function () { keep(); S.inc = inc.checked; if (!S.inc) S.f.patientName = ""; paint(true); var x = m.querySelector(S.inc ? "[name=patientName]" : "[name=inc]"); if (x) x.focus(); });
  }

  function print() {
    keep(); S.done = "";
    var label = labelNow();
    if (!label.drugName) { if (!S.pending.length) S.err = "Write the medicine name. Nothing was printed."; paint(true); var d = S.mount.querySelector("[name=drugName]"); if (d) d.focus(); return; }
    var u = E.state.user;
    var entry = Object.assign({}, label, { id: uid(), printedAt: nowStr(), printedBy: u ? u.full_name || u.email : "Unknown" });
    // printed at once, from the click (a print window opened later is blocked by the browser), as the classic screen does
    printLabelHtml(buildPrintHtml(entry, pharmacy(), tplOf(label.templateId)));
    pref("tpl", label.templateId); // counter: the next label starts on this template
    S.pending.push(entry);
    flush();
  }
  // counter: a recent label printed again in one tap. The label is the one shown, exactly as "Use again" then
  // "Print label" would print and save it (same fields, a new id and time, the person printing now).
  function reprint(i) {
    var l = S.history[i]; if (!l) return;
    var u = E.state.user, tid = l.templateId || (S.templates[0] || {}).id;
    var label = { patientName: String(l.patientName || "").trim(), drugName: String(l.drugName || "").trim(), dose: String(l.dose || "").trim(), frequency: l.frequency, route: l.route,
      customInstructions: String(l.customInstructions || "").trim(), selectedWarnings: (l.selectedWarnings || []).slice(), templateId: tid };
    if (!label.drugName) return;
    var entry = Object.assign({}, label, { id: uid(), printedAt: nowStr(), printedBy: u ? u.full_name || u.email : "Unknown" });
    printLabelHtml(buildPrintHtml(entry, pharmacy(), tplOf(tid)));
    S.done = ""; S.pending.push(entry);
    var busy = S.saving;
    Promise.resolve(flush()).then(function () {
      if (!E.toast || E.state.activeModuleId !== "lblreg") return;
      if (S.err) E.toast("Printed, but not yet in the history. Press Save again under the form.", "warn");
      else if (!busy) E.toast("Sent to the printer: " + label.drugName + ". Saved to recent labels.", "success");
    });
  }

  // Every printed label waiting to reach the history goes in one PUT; each keeps its id, so sending one again never
  // makes a second copy. A label printed while a save is on its way waits for the next round.
  async function flush() {
    if (S.saving) { S.again = true; return; }
    if (!S.pending.length) return;
    var batch = S.pending.slice();
    S.saving = true; S.err = ""; setStatus();
    try {
      // settings are read fresh and sent back unchanged; only the new history entries are added
      var r = await E.apiFetch("/labels/state", { method: "GET" });
      if (!r || r.ok === false) throw new Error((r && r.error) || "Could not read the labels");
      var st = r.state || r;
      var w = await E.apiFetch("/labels/state", { method: "PUT", body: JSON.stringify({ state: { labelHistory: batch, templates: Array.isArray(st.templates) ? st.templates : [], pharmacyDetails: st.pharmacyDetails || {} } }) });
      if (!w || w.ok === false) throw new Error((w && w.error) || "Save failed");
      S.pending = S.pending.filter(function (e) { return batch.indexOf(e) < 0; });
      S.done = batch.length === 1 ? "Sent to the printer and saved to recent labels." : batch.length + " labels sent to the printer and saved to recent labels.";
    } catch (x) {
      E.saveFailText(x);
      S.err = "Printed, but not yet in the history (" + (x && x.network ? "no answer from the server" : String((x && (x.message || x)) || "error")) + "). Save again: a label is never saved twice.";
    }
    S.saving = false;
    if (S.again) { S.again = false; if (S.pending.length && !S.err) return flush(); }
    setStatus();
    if (S.err) return;
    return load();
  }

  E.registerModule({
    id: "lblreg", title: "Dispensing labels", order: 3, icon: "🏷️", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.f = null; S.find = ""; S.wOpen = null; S.moreRecent = false; S.variants = null; S.err = S.pending.length ? "Printed earlier, not yet in the history. Save again: a label is never saved twice." : ""; S.done = ""; S.lastMed = ""; css(); paint(); return load().then(function () { var phone = false; try { phone = window.matchMedia("(max-width:600px)").matches; } catch (e) {} if (!phone) focus("[name=drugName]"); }); } // a phone keyboard does not jump up on open
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("lblreg") < 0) E.UI2_DESTINATIONS.push("lblreg");
  if (E.UI2_PARENT) E.UI2_PARENT.lblreg = "services";
})();
