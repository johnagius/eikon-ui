/* Dispensing labels, new layout: fill one label (template, language, patient, medicine, dose, route, frequency, note,
   warnings), see the printed label as you type, print it, and pick a recent label to use again.
   Same endpoint and the same history entry as the classic Smart labels screen (GET/PUT /labels/state). The printed page
   is built by the classic screen's own code, copied unchanged (buildPrintHtml, printLabelHtml, openPrintTab), so the
   label that comes out of the printer is the same for the same input.
   Saving: the PUT sends the one new history entry (the server upserts history by id and never deletes by omission) with
   the templates and pharmacy details read from the server just before, unchanged (the server keeps settings exactly as
   sent, so they are never written over with an older copy). The entry keeps its id across retries.
   As on the classic screen, Maltese is printed only by a template whose language is Maltese; the language choice on its
   own shows the Maltese wording on screen. Templates, pharmacy details, the full history and the warnings table stay in
   the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, loading: false, error: "", history: [], templates: [], pharm: {}, f: null, inc: false, mt: true, variants: null, saving: false, again: false, err: "", pending: [], done: "" };

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
    { id: "w01", en: "Take with food", mt: "Ħu meħud mal-ikel" },
    { id: "w02", en: "Take on an empty stomach", mt: "Ħu fuq stonku vojt" },
    { id: "w03", en: "May cause drowsiness", mt: "Jista’ jikkawża ngħas" },
    { id: "w04", en: "Do not drive or operate machinery", mt: "Issuqx u tħaddimx makkinarju" },
    { id: "w05", en: "Keep refrigerated (2-8°C)", mt: "Żomb fil-friġġ (2-8°C)" },
    { id: "w06", en: "Shake well before use", mt: "Ħawwad sew qabel l-użu" },
    { id: "w07", en: "For external use only", mt: "Għall-użu estern biss" },
    { id: "w08", en: "Avoid alcohol", mt: "Evita l-alkoħol" },
    { id: "w09", en: "Avoid prolonged sun exposure", mt: "Evita espożizzjoni twila għax-xemx" },
    { id: "w10", en: "Complete the full course", mt: "Lesti l-kors kollu" },
    { id: "w11", en: "Swallow whole, do not crush", mt: "Ibla’ sħiħ, tfarrakx" },
    { id: "w12", en: "Dissolve under the tongue", mt: "Ħoll taħt l-ilsien" },
    { id: "w13", en: "Take at bedtime", mt: "Ħu qabel l-irqad" },
    { id: "w14", en: "Take in the morning", mt: "Ħu filgħodu" },
    { id: "w15", en: "Store below 25°C", mt: "Aħżen taħt 25°C" },
    { id: "w16", en: "Keep out of reach of children", mt: "Żomb ‘il bogħod mit-tfal" },
    { id: "w17", en: "Do not stop taking without medical advice", mt: "Tiqafx tieħu mingħajr parir mediku" },
    { id: "w18", en: "May cause dizziness", mt: "Jista’ jikkawża sturdament" },
    { id: "w19", en: "Take with plenty of water", mt: "Ħu ma’ ħafna ilma" },
    { id: "w20", en: "Not suitable during pregnancy", mt: "Mhux adattat waqt it-tqala" }
  ];
  var FREQUENCIES_EN = [
    "Once daily", "Twice daily", "Three times daily", "Four times daily",
    "Every morning", "Every evening", "Every 4 hours", "Every 6 hours",
    "Every 8 hours", "Every 12 hours", "Once weekly", "As needed", "As directed"
  ];
  var FREQUENCIES_MT = {
    "Once daily": "Darba kuljum",
    "Twice daily": "Darbtejn kuljum",
    "Three times daily": "Tliet darbiet kuljum",
    "Four times daily": "Erba’ darbiet kuljum",
    "Every morning": "Kull filgħodu",
    "Every evening": "Kull filgħaxija",
    "Every 4 hours": "Kull 4 sigħat",
    "Every 6 hours": "Kull 6 sigħat",
    "Every 8 hours": "Kull 8 sigħat",
    "Every 12 hours": "Kull 12-il siegħa",
    "Once weekly": "Darba fil-ġimgħa",
    "As needed": "Skont il-bżonn",
    "As directed": "Skont id-direzzjonijiet"
  };
  var ROUTES = ["Oral", "Topical", "Sublingual", "Rectal", "Inhaled", "Nasal", "Ophthalmic", "Otic", "Intramuscular", "Subcutaneous", "Intravenous"];

  function buildPrintHtml(labelData, pharm, tpl) {
    var isLarge = tpl && tpl.size === "large";
    var showMt = tpl && tpl.language === "mt";
    var fs = isLarge ? '2.8mm' : '2.2mm';
    var lh = '1.2';
    var h = '';
    h += '<div style="font-family:Arial,Helvetica,sans-serif;color:#000;font-size:' + fs + ';line-height:' + lh + ';">';
    // pharmacy name
    h += '<div style="font-weight:900;">' + esc(pharm.name || "Pharmacy");
    if (pharm.phone) h += ' <span style="font-weight:400;font-size:.75em;">T:' + esc(pharm.phone) + '</span>';
    h += '</div>';
    // fields
    if (labelData.patientName) h += '<div><b>Pat:</b> ' + esc(labelData.patientName) + '</div>';
    h += '<div><b>Rx:</b> ' + esc(labelData.drugName || "") + '</div>';
    // dose + freq on one line
    var doseFreq = '';
    if (labelData.dose) doseFreq += esc(labelData.dose);
    if (labelData.dose && labelData.frequency) doseFreq += ' | ';
    if (labelData.frequency) {
      doseFreq += esc(labelData.frequency);
      if (showMt && FREQUENCIES_MT[labelData.frequency]) doseFreq += ' <i style="font-size:.85em;">(' + esc(FREQUENCIES_MT[labelData.frequency]) + ')</i>';
    }
    if (doseFreq) h += '<div><b>Dose/Freq:</b> ' + doseFreq + '</div>';
    if (labelData.route) h += '<div><b>Route:</b> ' + esc(labelData.route) + '</div>';
    if (labelData.customInstructions) h += '<div><b>Note:</b> ' + esc(labelData.customInstructions) + '</div>';
    // warnings
    var selWarnings = WARNINGS.filter(function (w) { return (labelData.selectedWarnings || []).indexOf(w.id) !== -1; });
    selWarnings.forEach(function (w) {
      h += '<div style="font-weight:700;font-size:.85em;">⚠ ' + esc(w.en);
      if (showMt) h += ' <i style="font-weight:400;">(' + esc(w.mt) + ')</i>';
      h += '</div>';
    });
    // date — same size as body so it's legible on small labels
    h += '<div style="font-size:.85em;color:#333;">' + fmtDate(todayStr());
    if (pharm.licence) h += ' | Lic:' + esc(pharm.licence);
    h += '</div>';
    h += '</div>';
    return h;
  }
  function openPrintTab(html) {
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var w = null;
    try { w = window.open(url, "_blank"); } catch (e) { w = null; }
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
      "<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},80);});" +
      "window.addEventListener('afterprint',function(){setTimeout(function(){try{window.close();}catch(e){}},250);});<\/script>" +
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
    return { patientName: "", drugName: "", dose: "", frequency: FREQUENCIES_EN[0], route: ROUTES[0], customInstructions: "", selectedWarnings: [], templateId: S.templates.length > 0 ? S.templates[0].id : "tpl_std" };
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
  function applyEntry(entry) { // the classic autofill: only what the earlier label had
    var f = S.f;
    if (entry.dose) f.dose = entry.dose;
    if (entry.frequency) f.frequency = entry.frequency;
    if (entry.route) f.route = entry.route;
    if (entry.customInstructions) f.customInstructions = entry.customInstructions;
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
      ".lbl-form label.chk{justify-content:space-between}.lbl-form label.chk input{width:20px;height:20px;accent-color:var(--accent);margin:0}" +
      ".lbl-form .hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:14px 14px 5px;border-top:.5px solid var(--border)}" +
      ".lbl-seg{display:grid;grid-template-columns:1fr 1fr;gap:6px;flex:1;min-width:0;padding:6px 0}" +
      ".lbl-seg button,.lbl-chip{font:inherit;font-size:13.5px;font-weight:600;min-height:36px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;padding:4px 8px;line-height:1.2}" +
      ".lbl-seg button.on,.lbl-chip.on{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".lbl-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 12px}.lbl-chip{border-radius:999px;font-weight:500;text-align:left}" +
      ".lbl-var{padding:8px 14px 10px;border-top:.5px solid var(--border)}.lbl-var p{margin:0 0 6px;font-size:13px;color:var(--muted)}.lbl-var div{display:flex;flex-wrap:wrap;gap:6px}" +
      ".lbl-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:10px 14px 6px;border-top:.5px solid var(--border)}" +
      ".lbl-err{color:var(--danger);font-size:13px;padding:6px 14px 0}.lbl-ok{color:var(--muted);font-size:13px;padding:6px 14px 0}" +
      ".lbl-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 2px 7px}" +
      ".lbl-paper{background:#fff;color:#000;border:1px solid var(--border);border-radius:10px;padding:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}" +
      ".lbl-paper>.in{width:46mm;max-width:100%;padding:0.8mm 1mm 0.5mm 1.5mm;box-sizing:border-box;zoom:1.75;margin:0 auto;overflow-wrap:anywhere}" +
      ".lbl-cap{font-size:12.5px;color:var(--muted);margin:8px 2px 0;line-height:1.45}" +
      ".lbl-mt{margin-top:12px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:13.5px;line-height:1.5}.lbl-mt b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}.lbl-mt p{margin:2px 0}" +
      ".lbl-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".lbl-row{display:flex;gap:10px;align-items:center;padding:10px 14px;border-top:.5px solid var(--border)}.lbl-row:first-child{border-top:0}" +
      ".lbl-row .t{flex:1;min-width:0}.lbl-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.lbl-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".lbl-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".lbl-note{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) :is(.lbl-seg button.on,.lbl-chip.on){color:#00160E}html[data-ui2]:not([data-ui2-visit]) .lbl-err{color:#FF7A72}}" +
      "@media (max-width:860px){.lbl-grid{grid-template-columns:minmax(0,1fr)}.lbl-side{position:static}}" +
      "@media (max-width:600px){.lbl{padding:4px 16px 0}.lbl h1{font-size:32px}.lbl-form label>span,.lbl-form .row>span{flex-basis:92px}}";
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
    var h = '<div class="lbl-lab" id="lbl-prev-lab">Printed label</div><div class="lbl-paper" role="group" aria-labelledby="lbl-prev-lab"><div class="in" id="lbl-prev">' + buildPrintHtml(labelNow(), pharmacy(), tpl) + "</div></div>";
    h += '<p class="lbl-cap">What the printer gets, line for line. Where the lines break depends on your label paper.</p>';
    if (S.mt) {
      var f = S.f, ws = WARNINGS.filter(function (w) { return (f.selectedWarnings || []).indexOf(w.id) !== -1; });
      h += '<div class="lbl-mt" lang="mt"><b lang="en">In Maltese</b>' + (FREQUENCIES_MT[f.frequency] ? "<p>" + esc(FREQUENCIES_MT[f.frequency]) + "</p>" : "") +
        ws.map(function (w) { return "<p>⚠ " + esc(w.mt) + "</p>"; }).join("") +
        '<p lang="en" style="color:var(--muted);font-size:12.5px;margin-top:6px">' + (tpl.language === "mt" ? "This template prints the Maltese on the label too." : "To read to the patient. The printed label is in English, as on the classic screen; Maltese prints only from a Maltese template.") + "</p></div>";
    }
    return h;
  }
  function refreshPreview() {
    var box = S.mount && S.mount.querySelector("#lbl-side");
    if (box) box.innerHTML = previewHtml();
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
    var h = '<form class="lbl-form" id="lbl-add" autocomplete="off">' +
      '<label><span>Template</span><select name="templateId">' + S.templates.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === f.templateId ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + "</select></label>" +
      '<div class="row"><span id="lbl-lang-lab">Language</span><div class="lbl-seg" role="group" aria-labelledby="lbl-lang-lab">' +
        '<button type="button" data-act="lang" data-v="en" aria-pressed="' + !S.mt + '" class="' + (S.mt ? "" : "on") + '">English</button>' +
        '<button type="button" data-act="lang" data-v="both" aria-pressed="' + S.mt + '" class="' + (S.mt ? "on" : "") + '">English + Maltese</button></div></div>' +
      '<label class="chk"><span style="flex:1">Patient name on the label</span><input type="checkbox" name="inc"' + (S.inc ? " checked" : "") + "></label>" +
      (S.inc ? '<label><span>Patient</span><input name="patientName" list="lbl-pats" value="' + esc(f.patientName) + '" placeholder="Name and surname"></label>' : "") +
      '<label><span>Medicine</span><input name="drugName" list="lbl-meds" value="' + esc(f.drugName) + '" placeholder="Name and strength" aria-required="true"></label>';
    if (S.variants && S.variants.length) {
      h += '<div class="lbl-var" role="group" aria-labelledby="lbl-var-lab"><p id="lbl-var-lab">Given before in more than one way. Choose one:</p><div>' +
        S.variants.map(function (v, i) { return '<button type="button" class="lbl-chip" data-act="variant" data-i="' + i + '">' + esc(variantText(v, i)) + "</button>"; }).join("") + "</div></div>";
    }
    h += '<label><span>Dose</span><input name="dose" value="' + esc(f.dose) + '" placeholder="e.g. 1 tablet, 5ml"></label>' +
      '<label><span>Frequency</span><select name="frequency">' + opt(FREQUENCIES_EN, f.frequency) + "</select></label>" +
      '<label><span>Route</span><select name="route">' + opt(ROUTES, f.route) + "</select></label>" +
      '<label><span>Note</span><textarea name="customInstructions" rows="2" placeholder="Other directions">' + esc(f.customInstructions) + "</textarea></label>" +
      '<div class="hd" id="lbl-w-lab">Warnings</div><div class="lbl-chips" role="group" aria-labelledby="lbl-w-lab">' +
      WARNINGS.map(function (w) { var on = f.selectedWarnings.indexOf(w.id) !== -1; return '<button type="button" class="lbl-chip' + (on ? " on" : "") + '" data-act="warn" data-w="' + w.id + '" aria-pressed="' + on + '">' + esc(w.en) + "</button>"; }).join("") + "</div>";
    h += '<div id="lbl-status" role="status">' + statusHtml() + "</div>";
    h += '<div class="lbl-acts"><button type="button" class="lbl-btn" data-act="clear">Clear</button><button type="submit" class="lbl-btn p">Print label</button></div>' +
      '<datalist id="lbl-meds">' + Object.keys(meds).map(function (k) { return '<option value="' + esc(meds[k].name) + '">'; }).join("") + "</datalist>" +
      '<datalist id="lbl-pats">' + patients().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    return h;
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "lblreg") return; // left before a reply came back: do not draw over the next screen
    if (S.f && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var h = '<div class="lbl"><button class="lbl-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("lblreg")) + '</button>' +
      '<h1>Dispensing labels</h1><p class="lbl-sub">Fill in the label, check it, print it.</p>';
    if (S.loading && !S.f) h += '<div class="lbl-quiet">Opening labels…</div>';
    else if (S.error && !S.f) h += '<div class="lbl-quiet">' + esc(S.error) + "</div>";
    else if (S.f) {
      h += '<div class="lbl-grid"><div style="min-width:0">' + formHtml() + "</div>" + '<div class="lbl-side" id="lbl-side">' + previewHtml() + "</div></div>";
      var recent = S.history.slice(0, 8);
      h += '<div class="lbl-lab" style="margin-top:22px">Recent labels</div>';
      h += recent.length ? '<div class="lbl-list">' + recent.map(function (l, i) {
        var bits = [l.dose, l.frequency].filter(Boolean).join(" · ");
        return '<div class="lbl-row"><div class="t"><b>' + esc(l.drugName || "—") + "</b><span>" + esc((l.patientName ? l.patientName + " · " : "") + (bits ? bits + " · " : "") + (l.printedAt || "") + (l.printedBy ? " · " + l.printedBy : "")) +
          '</span></div><button type="button" class="lbl-btn" data-act="again" data-i="' + i + '" aria-label="Use again: ' + esc(l.drugName || "label") + '">Use again</button></div>';
      }).join("") + "</div>" : '<div class="lbl-quiet" style="margin-top:0">No labels printed yet.</div>';
    }
    h += '<p class="lbl-note">Templates, pharmacy details, the full print history and the warnings table are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) && ae.name ? "[name=" + ae.name + "]" : "";
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
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("lblreg");
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "lblreg"); } catch (x) {} E.openClassic("labels"); }
        else if (act === "lang") { keep(); S.mt = b.getAttribute("data-v") === "both"; paint(true); var lb = m.querySelector('[data-act=lang][data-v="' + b.getAttribute("data-v") + '"]'); if (lb) lb.focus(); }
        else if (act === "warn") { var id = b.getAttribute("data-w"), ws = S.f.selectedWarnings, i = ws.indexOf(id); if (i !== -1) ws.splice(i, 1); else ws.push(id); var on = i === -1; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); keep(); refreshPreview(); }
        else if (act === "variant") { keep(); applyEntry(S.variants[Number(b.getAttribute("data-i"))]); paint(true); var d = m.querySelector("[name=dose]"); if (d) d.focus(); }
        else if (act === "clear") { S.f = blank(); S.variants = null; S.done = ""; if (!S.pending.length) S.err = ""; paint(true); focus("[name=drugName]"); }
        else if (act === "again") { var l = S.history[Number(b.getAttribute("data-i"))]; if (!l) return; S.f = { patientName: l.patientName, drugName: l.drugName, dose: l.dose, frequency: l.frequency, route: l.route, customInstructions: l.customInstructions, selectedWarnings: (l.selectedWarnings || []).slice(), templateId: l.templateId || (S.templates[0] || {}).id };
          if (l.patientName) S.inc = true; S.variants = null; S.done = ""; if (!S.pending.length) S.err = ""; paint(true); var pb = m.querySelector("#lbl-add button[type=submit]"); if (pb) pb.focus(); try { m.querySelector("#lbl-add").scrollIntoView({ block: "start", behavior: "smooth" }); } catch (x2) {} }
        else if (act === "retry") flush();
      });
    });
    var f = m.querySelector("#lbl-add"); if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); print(); });
    f.addEventListener("input", function (ev) {
      var n = ev.target && ev.target.name; keep();
      if (n === "inc") return;
      if (n === "drugName") { // a medicine given before fills in what it had (the classic autofill)
        var med = medicines()[norm(S.f.drugName)];
        if (med && norm(S.f.drugName) !== S.lastMed) {
          S.lastMed = norm(S.f.drugName);
          if (med.entries.length === 1) { applyEntry(med.entries[0]); paint(true); return; }
          if (med.entries.length > 1) { S.variants = med.entries; paint(true); return; }
        }
        if (!med) { S.lastMed = ""; if (S.variants) { S.variants = null; paint(true); return; } }
      }
      if (S.done || (S.err && !S.pending.length)) { S.done = ""; S.err = ""; setStatus(); } // typing clears an old note (an unsaved label's note stays)
      refreshPreview();
    });
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
    S.pending.push(entry);
    flush();
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
    render: function (ctx) { S.mount = ctx && ctx.mount; S.f = null; S.variants = null; S.err = S.pending.length ? "Printed earlier, not yet in the history. Save again: a label is never saved twice." : ""; S.done = ""; S.lastMed = ""; css(); paint(); return load().then(function () { focus("[name=drugName]"); }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("lblreg") < 0) E.UI2_DESTINATIONS.push("lblreg");
  if (E.UI2_PARENT) E.UI2_PARENT.lblreg = "services";
})();
