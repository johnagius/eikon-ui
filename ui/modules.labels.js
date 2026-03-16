/* ui/modules.labels.js
   Eikon – Smart Label Generator module

   Create and print medication dispensing labels with customizable templates.
   Multi-language support (English + Maltese), standard warnings, print preview,
   reprint from history, and audit log.

   Endpoints:
     GET  /labels/state
     PUT  /labels/state
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ── helpers ──────────────────────────────────────────────────────────────
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
  async function api(method, path, body) {
    var o = { method: method };
    if (body !== undefined) { o.headers = { "Content-Type": "application/json" }; o.body = JSON.stringify(body); }
    return E.apiFetch(path, o);
  }

  // ── cloud store ──────────────────────────────────────────────────────────
  var labelHistory = [];
  var templates = [];
  var pharmacyDetails = { name: "", address: "", phone: "", licence: "" };
  var dirty = false;
  var syncing = false;
  var currentUser = null;

  async function cloudLoad() {
    try {
      var r = await api("GET", "/labels/state");
      var st = r.state || r;
      labelHistory = Array.isArray(st.labelHistory) ? st.labelHistory : [];
      templates = Array.isArray(st.templates) ? st.templates : getDefaultTemplates();
      if (st.pharmacyDetails) pharmacyDetails = st.pharmacyDetails;
    } catch (e) { E.warn("[labels] cloudLoad error", e); }
    if (templates.length === 0) templates = getDefaultTemplates();
  }

  async function cloudSave() {
    if (syncing) return;
    syncing = true;
    try { await api("PUT", "/labels/state", { state: { labelHistory: labelHistory, templates: templates, pharmacyDetails: pharmacyDetails } }); dirty = false; }
    catch (e) { E.warn("[labels] cloudSave error", e); }
    finally { syncing = false; }
  }

  function save() { dirty = true; cloudSave(); }

  // ── default templates ────────────────────────────────────────────────────
  function getDefaultTemplates() {
    return [
      { id: "tpl_std", name: "Standard Label", size: "standard", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: true },
      { id: "tpl_large", name: "Large Print (Elderly)", size: "large", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: false }
    ];
  }

  // ── warning labels ───────────────────────────────────────────────────────
  var WARNINGS = [
    { id: "w01", en: "Take with food", mt: "Hu meħud mal-ikel" },
    { id: "w02", en: "Take on an empty stomach", mt: "Hu fuq stonku vojt" },
    { id: "w03", en: "May cause drowsiness", mt: "Jista' jikkaġuna ngħas" },
    { id: "w04", en: "Do not drive or operate machinery", mt: "Issuqx u tħaddimx makkinarju" },
    { id: "w05", en: "Keep refrigerated (2-8°C)", mt: "Żomm fil-friġġ (2-8°C)" },
    { id: "w06", en: "Shake well before use", mt: "Ħawwad sew qabel l-użu" },
    { id: "w07", en: "For external use only", mt: "Għall-użu estern biss" },
    { id: "w08", en: "Avoid alcohol", mt: "Evita l-alkoħol" },
    { id: "w09", en: "Avoid prolonged sun exposure", mt: "Evita espożizzjoni twila għax-xemx" },
    { id: "w10", en: "Complete the full course", mt: "Lesti l-kors kollu" },
    { id: "w11", en: "Swallow whole, do not crush", mt: "Ibla' sħiħ, tfarrakx" },
    { id: "w12", en: "Dissolve under the tongue", mt: "Ħoll taħt l-ilsien" },
    { id: "w13", en: "Take at bedtime", mt: "Hu qabel l-irqad" },
    { id: "w14", en: "Take in the morning", mt: "Hu filgħodu" },
    { id: "w15", en: "Store below 25°C", mt: "Aħżen taħt 25°C" },
    { id: "w16", en: "Keep out of reach of children", mt: "Żomm 'il bogħod mit-tfal" },
    { id: "w17", en: "Do not stop taking without medical advice", mt: "Tiqafx tieħu mingħajr parir mediku" },
    { id: "w18", en: "May cause dizziness", mt: "Jista' jikkaġuna sturdament" },
    { id: "w19", en: "Take with plenty of water", mt: "Hu ma' ħafna ilma" },
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
    "Four times daily": "Erba' darbiet kuljum",
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

  // ── styles ───────────────────────────────────────────────────────────────
  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return; stylesDone = true;
    var s = document.createElement("style"); s.id = "eikon-labels-style";
    s.textContent = [
      ".lb{--ac:#5aa2ff;--ac2:#a78bfa;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.03);--bd:rgba(255,255,255,.10);--r:16px;--r2:12px;--txt:#e8eefc;--mut:rgba(170,183,214,.78);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--txt);margin:-14px}",
      ".lb *{box-sizing:border-box}",
      /* hero */
      ".lb .hero{position:relative;border-radius:20px;border:1px solid var(--bd);overflow:hidden;padding:20px 22px 16px;margin-bottom:16px;background:linear-gradient(135deg,rgba(167,139,250,.16),rgba(90,162,255,.10),rgba(46,229,157,.06));box-shadow:0 14px 40px rgba(0,0,0,.3)}",
      ".lb .hero h2{margin:0 0 2px;font-size:20px;font-weight:900;letter-spacing:.3px}",
      ".lb .hero .sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}",
      /* kpi */
      ".lb .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px}",
      ".lb .kpi{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);padding:14px;text-align:center}",
      ".lb .kpi .n{font-size:28px;font-weight:900;letter-spacing:.3px}",
      ".lb .kpi .l{font-size:11.5px;color:var(--mut);margin-top:3px}",
      /* tabs */
      ".lb .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}",
      ".lb .tab{padding:9px 14px;border-radius:var(--r2);border:1px solid var(--bd);background:var(--pnl);color:var(--txt);cursor:pointer;font-size:13px;font-weight:700;transition:transform .08s,background .15s,border-color .15s}",
      ".lb .tab:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}",
      ".lb .tab:active{transform:translateY(1px)}",
      ".lb .tab.on{background:rgba(167,139,250,.16);border-color:rgba(167,139,250,.55)}",
      /* card */
      ".lb .card{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);box-shadow:0 10px 28px rgba(0,0,0,.25);overflow:hidden;margin-bottom:14px}",
      ".lb .card .hd{padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:10px}",
      ".lb .card .hd h3{margin:0;font-size:14px;font-weight:800}",
      ".lb .card .bd{padding:16px}",
      /* form */
      ".lb .fld{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}",
      ".lb .fld label{color:var(--mut);font-size:12px;font-weight:600}",
      ".lb .fld input,.lb .fld select,.lb .fld textarea{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.18);color:var(--txt);padding:9px 10px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .15s,box-shadow .15s}",
      ".lb .fld input:focus,.lb .fld select:focus,.lb .fld textarea:focus{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 3px rgba(167,139,250,.12)}",
      ".lb .fld textarea{min-height:64px;resize:vertical;line-height:1.35}",
      /* btn */
      ".lb .btn{border:1px solid var(--bd);background:var(--pnl);color:var(--txt);padding:9px 14px;border-radius:var(--r2);cursor:pointer;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:8px;transition:transform .08s,background .15s,border-color .15s}",
      ".lb .btn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}",
      ".lb .btn:active{transform:translateY(1px)}",
      ".lb .btn.pri{background:rgba(167,139,250,.18);border-color:rgba(167,139,250,.5);color:#c4b5fd}",
      ".lb .btn.ok{background:rgba(46,229,157,.15);border-color:rgba(46,229,157,.45);color:#6af0be}",
      ".lb .btn.dn{background:rgba(255,107,157,.15);border-color:rgba(255,107,157,.45);color:#ff9ebe}",
      ".lb .btn.sm{padding:6px 10px;font-size:12px}",
      /* table */
      ".lb table{width:100%;border-collapse:collapse;font-size:13px}",
      ".lb th{text-align:left;padding:10px 12px;border-bottom:2px solid var(--bd);color:var(--mut);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}",
      ".lb td{padding:9px 12px;border-bottom:1px solid var(--bd)}",
      ".lb tr:hover td{background:rgba(255,255,255,.02)}",
      /* search */
      ".lb .search-bar{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap}",
      ".lb .search-bar input{flex:1;min-width:180px;border:1px solid var(--bd);background:rgba(0,0,0,.18);color:var(--txt);padding:9px 12px;border-radius:var(--r2);outline:none;font-size:13px}",
      ".lb .search-bar input:focus{border-color:rgba(167,139,250,.6)}",
      /* warnings */
      ".lb .warn-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}",
      ".lb .warn-tag{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:20px;font-size:11.5px;font-weight:600;cursor:pointer;border:1px solid var(--bd);background:var(--pnl);transition:background .15s,border-color .15s}",
      ".lb .warn-tag.on{background:rgba(255,204,102,.15);border-color:rgba(255,204,102,.5);color:#ffcc66}",
      ".lb .warn-tag:hover{background:rgba(255,255,255,.06)}",
      /* label preview */
      ".lb .label-preview{border:2px dashed var(--bd);border-radius:var(--r);background:#fff;color:#000;padding:16px 20px;font-family:'Courier New',Courier,monospace;margin:14px 0}",
      ".lb .label-preview.large{font-size:18px;padding:24px 28px;line-height:1.6}",
      ".lb .label-preview.standard{font-size:13px;padding:14px 18px;line-height:1.4}",
      ".lb .label-preview h4{margin:0 0 6px;font-weight:900;font-size:1.1em;border-bottom:2px solid #000;padding-bottom:4px}",
      ".lb .label-preview .lp-row{margin:3px 0}",
      ".lb .label-preview .lp-label{font-weight:700;color:#333}",
      ".lb .label-preview .lp-warn{margin-top:8px;padding-top:6px;border-top:1px solid #999}",
      ".lb .label-preview .lp-warn div{font-weight:700;font-size:.9em}",
      ".lb .label-preview .lp-pharmacy{margin-top:8px;padding-top:6px;border-top:1px solid #999;font-size:.85em;color:#555}",
      /* modal */
      ".lb .modal-bg{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}",
      ".lb .modal{background:#111b2a;border:1px solid var(--bd);border-radius:var(--r);max-width:700px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)}",
      ".lb .modal .m-hd{padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between}",
      ".lb .modal .m-hd h3{margin:0;font-size:16px;font-weight:800}",
      ".lb .modal .m-bd{padding:20px}",
      ".lb .modal .m-ft{padding:14px 20px;border-top:1px solid var(--bd);display:flex;justify-content:flex-end;gap:8px}",
      /* empty */
      ".lb .empty{text-align:center;padding:40px 20px;color:var(--mut);font-size:14px}",
      ".lb .empty .icon{font-size:40px;margin-bottom:10px}",
      /* print styles */
      "@media print{body *{visibility:hidden !important}.lb .label-preview,.lb .label-preview *{visibility:visible !important}.lb .label-preview{position:fixed;left:0;top:0;border:none;margin:0;box-shadow:none}}",
      /* responsive */
      "@media(max-width:700px){.lb .kpi-row{grid-template-columns:repeat(2,1fr)}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  // ── render ───────────────────────────────────────────────────────────────
  var activeTab = "create";
  var searchQ = "";
  var currentLabel = null;
  var showMaltese = true;

  async function render(ctx) {
    var mount = ctx.mount;
    currentUser = ctx.user;
    ensureStyles();

    await cloudLoad();

    mount.innerHTML = "";
    var root = document.createElement("div");
    root.className = "lb";
    mount.appendChild(root);

    function redraw() {
      root.innerHTML = "";

      // hero
      var hero = document.createElement("div");
      hero.className = "hero";
      hero.innerHTML = '<h2>\uD83C\uDFF7\uFE0F Smart Label Generator</h2><div class="sub">Create and print medication dispensing labels with customizable templates</div>';
      root.appendChild(hero);

      // KPI
      var todayLabels = labelHistory.filter(function (l) { return (l.printedAt || "").indexOf(todayStr()) === 0; }).length;
      var kpiRow = document.createElement("div");
      kpiRow.className = "kpi-row";
      kpiRow.innerHTML =
        '<div class="kpi"><div class="n" style="color:#a78bfa">' + labelHistory.length + '</div><div class="l">Labels Printed</div></div>' +
        '<div class="kpi"><div class="n" style="color:#5aa2ff">' + todayLabels + '</div><div class="l">Today</div></div>' +
        '<div class="kpi"><div class="n" style="color:#2ee59d">' + templates.length + '</div><div class="l">Templates</div></div>';
      root.appendChild(kpiRow);

      // tabs
      var tabs = document.createElement("div");
      tabs.className = "tabs";
      var tabDefs = [
        { id: "create", label: "Create Label" },
        { id: "history", label: "Print History" },
        { id: "templates", label: "Templates" },
        { id: "warnings", label: "Warning Labels" },
        { id: "settings", label: "Pharmacy Details" }
      ];
      tabDefs.forEach(function (t) {
        var b = document.createElement("button");
        b.className = "tab" + (activeTab === t.id ? " on" : "");
        b.textContent = t.label;
        b.addEventListener("click", function () { activeTab = t.id; searchQ = ""; redraw(); });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);

      if (activeTab === "create") {
        renderCreateLabel(root, redraw);
      } else if (activeTab === "history") {
        renderHistory(root, redraw);
      } else if (activeTab === "templates") {
        renderTemplates(root, redraw);
      } else if (activeTab === "warnings") {
        renderWarnings(root, redraw);
      } else if (activeTab === "settings") {
        renderSettings(root, redraw);
      }
    }

    redraw();
  }

  // ── create label ─────────────────────────────────────────────────────────
  function renderCreateLabel(root, redraw) {
    var label = currentLabel || {
      patientName: "", drugName: "", dose: "", frequency: FREQUENCIES_EN[0],
      route: ROUTES[0], customInstructions: "", selectedWarnings: [],
      templateId: templates.length > 0 ? templates[0].id : "tpl_std"
    };
    currentLabel = label;

    var layout = document.createElement("div");
    layout.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:16px";

    // left: form
    var formCard = document.createElement("div");
    formCard.className = "card";
    formCard.innerHTML = '<div class="hd"><h3>Label Details</h3></div>';
    var formBd = document.createElement("div");
    formBd.className = "bd";

    // template + language
    var row1 = document.createElement("div");
    row1.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:12px";
    row1.innerHTML =
      '<div class="fld"><label>Template</label><select id="lb-tpl">' +
        templates.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === label.templateId ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join("") +
      '</select></div>' +
      '<div class="fld"><label>Language</label><select id="lb-lang"><option value="en"' + (!showMaltese ? ' selected' : '') + '>English only</option><option value="both"' + (showMaltese ? ' selected' : '') + '>English + Maltese</option></select></div>';
    formBd.appendChild(row1);

    formBd.innerHTML +=
      '<div class="fld"><label>Patient Name *</label><input type="text" id="lb-patient" placeholder="Full name" value="' + esc(label.patientName) + '"></div>' +
      '<div class="fld"><label>Drug Name *</label><input type="text" id="lb-drug" placeholder="Drug name and strength" value="' + esc(label.drugName) + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="fld"><label>Dose</label><input type="text" id="lb-dose" placeholder="e.g. 1 tablet, 5ml" value="' + esc(label.dose) + '"></div>' +
        '<div class="fld"><label>Route</label><select id="lb-route">' + ROUTES.map(function (r) { return '<option' + (r === label.route ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      '<div class="fld"><label>Frequency</label><select id="lb-freq">' + FREQUENCIES_EN.map(function (f) { return '<option' + (f === label.frequency ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join("") + '</select></div>' +
      '<div class="fld"><label>Custom Instructions</label><textarea id="lb-custom" placeholder="Additional instructions...">' + esc(label.customInstructions) + '</textarea></div>';

    // warning selector
    var warnTitle = document.createElement("div");
    warnTitle.className = "fld";
    warnTitle.innerHTML = '<label>Warning / Advisory Labels</label>';
    var warnList = document.createElement("div");
    warnList.className = "warn-list";
    WARNINGS.forEach(function (w) {
      var selected = (label.selectedWarnings || []).indexOf(w.id) !== -1;
      var tag = document.createElement("span");
      tag.className = "warn-tag" + (selected ? " on" : "");
      tag.textContent = w.en;
      tag.addEventListener("click", function () {
        var idx = label.selectedWarnings.indexOf(w.id);
        if (idx !== -1) label.selectedWarnings.splice(idx, 1);
        else label.selectedWarnings.push(w.id);
        tag.classList.toggle("on");
        updatePreview();
      });
      warnList.appendChild(tag);
    });
    warnTitle.appendChild(warnList);
    formBd.appendChild(warnTitle);

    formCard.appendChild(formBd);
    layout.appendChild(formCard);

    // right: preview
    var previewCard = document.createElement("div");
    previewCard.className = "card";
    previewCard.innerHTML = '<div class="hd"><h3>Print Preview</h3></div>';
    var previewBd = document.createElement("div");
    previewBd.className = "bd";
    var previewArea = document.createElement("div");
    previewArea.id = "lb-preview-area";
    previewBd.appendChild(previewArea);

    // print + save buttons
    var actionRow = document.createElement("div");
    actionRow.style.cssText = "display:flex;gap:8px;margin-top:14px;flex-wrap:wrap";

    var printBtn = document.createElement("button");
    printBtn.className = "btn pri";
    printBtn.textContent = "Print Label";
    printBtn.addEventListener("click", function () {
      collectFormData();
      if (!label.patientName || !label.drugName) { alert("Patient Name and Drug Name are required."); return; }
      // save to history
      var entry = Object.assign({}, label, { id: uid(), printedAt: nowStr(), printedBy: currentUser ? currentUser.full_name || currentUser.email : "Unknown" });
      labelHistory.unshift(entry);
      save();
      // print
      window.print();
      redraw();
    });
    actionRow.appendChild(printBtn);

    var clearBtn = document.createElement("button");
    clearBtn.className = "btn";
    clearBtn.textContent = "Clear Form";
    clearBtn.addEventListener("click", function () {
      currentLabel = null;
      redraw();
    });
    actionRow.appendChild(clearBtn);

    previewBd.appendChild(actionRow);
    previewCard.appendChild(previewBd);
    layout.appendChild(previewCard);

    root.appendChild(layout);

    // attach change listeners
    function collectFormData() {
      label.templateId = document.getElementById("lb-tpl").value;
      showMaltese = document.getElementById("lb-lang").value === "both";
      label.patientName = document.getElementById("lb-patient").value.trim();
      label.drugName = document.getElementById("lb-drug").value.trim();
      label.dose = document.getElementById("lb-dose").value.trim();
      label.route = document.getElementById("lb-route").value;
      label.frequency = document.getElementById("lb-freq").value;
      label.customInstructions = document.getElementById("lb-custom").value.trim();
    }

    function updatePreview() {
      collectFormData();
      var tpl = templates.find(function (t) { return t.id === label.templateId; }) || templates[0] || {};
      var sizeClass = tpl.size === "large" ? "large" : "standard";
      var html = '<div class="label-preview ' + sizeClass + '">';

      // pharmacy header
      html += '<h4>' + esc(pharmacyDetails.name || "Pharmacy Name") + '</h4>';

      // patient
      html += '<div class="lp-row"><span class="lp-label">Patient:</span> ' + esc(label.patientName || "—") + '</div>';

      // drug
      html += '<div class="lp-row"><span class="lp-label">Medication:</span> ' + esc(label.drugName || "—") + '</div>';

      // dose
      if (label.dose) html += '<div class="lp-row"><span class="lp-label">Dose:</span> ' + esc(label.dose) + '</div>';

      // frequency
      html += '<div class="lp-row"><span class="lp-label">Frequency:</span> ' + esc(label.frequency);
      if (showMaltese && FREQUENCIES_MT[label.frequency]) html += ' <em style="color:#666">(' + esc(FREQUENCIES_MT[label.frequency]) + ')</em>';
      html += '</div>';

      // route
      html += '<div class="lp-row"><span class="lp-label">Route:</span> ' + esc(label.route) + '</div>';

      // custom instructions
      if (label.customInstructions) html += '<div class="lp-row"><span class="lp-label">Instructions:</span> ' + esc(label.customInstructions) + '</div>';

      // warnings
      var selWarnings = WARNINGS.filter(function (w) { return (label.selectedWarnings || []).indexOf(w.id) !== -1; });
      if (selWarnings.length > 0) {
        html += '<div class="lp-warn">';
        selWarnings.forEach(function (w) {
          html += '<div>\u26A0 ' + esc(w.en);
          if (showMaltese) html += ' <em style="color:#666">(' + esc(w.mt) + ')</em>';
          html += '</div>';
        });
        html += '</div>';
      }

      // date + pharmacy
      html += '<div class="lp-pharmacy">';
      html += 'Date: ' + fmtDate(todayStr());
      if (pharmacyDetails.address) html += '<br>' + esc(pharmacyDetails.address);
      if (pharmacyDetails.phone) html += ' | Tel: ' + esc(pharmacyDetails.phone);
      if (pharmacyDetails.licence) html += ' | Licence: ' + esc(pharmacyDetails.licence);
      html += '</div>';

      html += '</div>';
      previewArea.innerHTML = html;
    }

    // attach listeners
    ["lb-tpl", "lb-lang", "lb-patient", "lb-drug", "lb-dose", "lb-route", "lb-freq", "lb-custom"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", updatePreview);
      if (el) el.addEventListener("change", updatePreview);
    });

    updatePreview();
  }

  // ── history ──────────────────────────────────────────────────────────────
  function renderHistory(root, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>Print History (' + labelHistory.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";

    // search
    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search by patient, drug, or date...";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchBar.appendChild(searchInput);
    var searchBtn = document.createElement("button");
    searchBtn.className = "btn sm";
    searchBtn.textContent = "Search";
    searchBtn.addEventListener("click", function () { redraw(); });
    searchBar.appendChild(searchBtn);
    bd.appendChild(searchBar);

    var filtered = labelHistory;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = labelHistory.filter(function (l) {
        return norm(l.patientName).indexOf(q) !== -1 || norm(l.drugName).indexOf(q) !== -1 || (l.printedAt || "").indexOf(q) !== -1;
      });
    }

    if (filtered.length === 0) {
      bd.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDCCB</div>No labels in history.</div>';
    } else {
      var table = document.createElement("table");
      table.innerHTML = '<thead><tr><th>Patient</th><th>Drug</th><th>Dose</th><th>Frequency</th><th>Printed</th><th>By</th><th></th></tr></thead>';
      var tbody = document.createElement("tbody");
      filtered.forEach(function (l) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><strong>' + esc(l.patientName) + '</strong></td>' +
          '<td>' + esc(l.drugName) + '</td>' +
          '<td>' + esc(l.dose || "-") + '</td>' +
          '<td>' + esc(l.frequency || "-") + '</td>' +
          '<td>' + esc(l.printedAt || "-") + '</td>' +
          '<td>' + esc(l.printedBy || "-") + '</td>' +
          '<td></td>';
        var actionTd = tr.querySelector("td:last-child");
        var reprintBtn = document.createElement("button");
        reprintBtn.className = "btn sm pri";
        reprintBtn.textContent = "Reprint";
        reprintBtn.addEventListener("click", function () {
          currentLabel = {
            patientName: l.patientName, drugName: l.drugName, dose: l.dose,
            frequency: l.frequency, route: l.route, customInstructions: l.customInstructions,
            selectedWarnings: l.selectedWarnings || [], templateId: l.templateId || (templates[0] || {}).id
          };
          activeTab = "create";
          redraw();
        });
        actionTd.appendChild(reprintBtn);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── templates ────────────────────────────────────────────────────────────
  function renderTemplates(root, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    var hd = document.createElement("div");
    hd.className = "hd";
    hd.innerHTML = '<h3>Label Templates</h3>';
    var addBtn = document.createElement("button");
    addBtn.className = "btn pri sm";
    addBtn.textContent = "+ New Template";
    addBtn.addEventListener("click", function () { showTemplateModal(null, redraw); });
    hd.appendChild(addBtn);
    card.appendChild(hd);

    var bd = document.createElement("div");
    bd.className = "bd";

    if (templates.length === 0) {
      bd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDCC4</div>No templates. Add one to get started.</div>';
    } else {
      var table = document.createElement("table");
      table.innerHTML = '<thead><tr><th>Name</th><th>Size</th><th>Fields</th><th>Default</th><th></th></tr></thead>';
      var tbody = document.createElement("tbody");
      templates.forEach(function (t) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><strong>' + esc(t.name) + '</strong></td>' +
          '<td>' + esc(t.size || "standard") + '</td>' +
          '<td>' + (t.fields || []).length + ' fields</td>' +
          '<td>' + (t.isDefault ? "Yes" : "-") + '</td>' +
          '<td></td>';
        var actionTd = tr.querySelector("td:last-child");
        var eBtn = document.createElement("button");
        eBtn.className = "btn sm";
        eBtn.textContent = "Edit";
        eBtn.addEventListener("click", function () { showTemplateModal(t, redraw); });
        actionTd.appendChild(eBtn);

        if (!t.isDefault) {
          var dBtn = document.createElement("button");
          dBtn.className = "btn sm dn";
          dBtn.textContent = "Delete";
          dBtn.style.marginLeft = "4px";
          dBtn.addEventListener("click", function () {
            if (!confirm("Delete template \"" + t.name + "\"?")) return;
            templates = templates.filter(function (x) { return x.id !== t.id; });
            save();
            redraw();
          });
          actionTd.appendChild(dBtn);
        }

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── template modal ───────────────────────────────────────────────────────
  function showTemplateModal(existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing, { fields: (existing.fields || []).slice() }) : { id: uid(), name: "", size: "standard", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: false };

    var allFields = [
      { id: "patientName", label: "Patient Name" },
      { id: "drugName", label: "Drug Name" },
      { id: "dose", label: "Dose" },
      { id: "frequency", label: "Frequency" },
      { id: "route", label: "Route" },
      { id: "warnings", label: "Warning Labels" },
      { id: "pharmacyDetails", label: "Pharmacy Details" },
      { id: "date", label: "Date" },
      { id: "customInstructions", label: "Custom Instructions" }
    ];

    var bg = document.createElement("div");
    bg.className = "lb modal-bg";
    var modal = document.createElement("div");
    modal.className = "modal";

    modal.innerHTML =
      '<div class="m-hd"><h3>' + (isEdit ? "Edit Template" : "New Template") + '</h3><button class="btn sm close-m">&times;</button></div>' +
      '<div class="m-bd">' +
        '<div class="fld"><label>Template Name</label><input type="text" id="lb-t-name" placeholder="e.g. Large Print Label" value="' + esc(data.name) + '"></div>' +
        '<div class="fld"><label>Label Size</label><select id="lb-t-size"><option value="standard"' + (data.size === "standard" ? ' selected' : '') + '>Standard</option><option value="large"' + (data.size === "large" ? ' selected' : '') + '>Large Print (Elderly)</option></select></div>' +
        '<div class="fld"><label>Fields to Include</label><div id="lb-t-fields" class="warn-list">' +
          allFields.map(function (f) {
            var on = data.fields.indexOf(f.id) !== -1;
            return '<span class="warn-tag' + (on ? ' on' : '') + '" data-fid="' + f.id + '">' + esc(f.label) + '</span>';
          }).join("") +
        '</div></div>' +
        '<div class="fld"><label><input type="checkbox" id="lb-t-default"' + (data.isDefault ? ' checked' : '') + '> Set as default template</label></div>' +
      '</div>' +
      '<div class="m-ft"><button class="btn close-m">Cancel</button><button class="btn pri" id="lb-t-save">Save</button></div>';

    bg.appendChild(modal);
    document.body.appendChild(bg);

    // field toggles
    modal.querySelectorAll("#lb-t-fields .warn-tag").forEach(function (tag) {
      tag.addEventListener("click", function () {
        var fid = tag.getAttribute("data-fid");
        var idx = data.fields.indexOf(fid);
        if (idx !== -1) data.fields.splice(idx, 1);
        else data.fields.push(fid);
        tag.classList.toggle("on");
      });
    });

    bg.querySelectorAll(".close-m").forEach(function (b) { b.addEventListener("click", function () { bg.remove(); }); });
    bg.addEventListener("click", function (e) { if (e.target === bg) bg.remove(); });

    modal.querySelector("#lb-t-save").addEventListener("click", function () {
      var name = modal.querySelector("#lb-t-name").value.trim();
      if (!name) { modal.querySelector("#lb-t-name").style.borderColor = "#ff5a7a"; return; }

      data.name = name;
      data.size = modal.querySelector("#lb-t-size").value;
      data.isDefault = modal.querySelector("#lb-t-default").checked;

      // if setting as default, unset others
      if (data.isDefault) {
        templates.forEach(function (t) { t.isDefault = false; });
      }

      if (isEdit) {
        var idx = templates.findIndex(function (t) { return t.id === data.id; });
        if (idx !== -1) templates[idx] = data;
      } else {
        templates.push(data);
      }

      save();
      bg.remove();
      redraw();
    });
  }

  // ── warnings reference ───────────────────────────────────────────────────
  function renderWarnings(root, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>Standard Warning / Advisory Labels</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";

    var table = document.createElement("table");
    table.innerHTML = '<thead><tr><th>#</th><th>English</th><th>Maltese</th></tr></thead>';
    var tbody = document.createElement("tbody");
    WARNINGS.forEach(function (w, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(w.en) + '</td>' +
        '<td><em>' + esc(w.mt) + '</em></td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    bd.appendChild(table);

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── pharmacy settings ────────────────────────────────────────────────────
  function renderSettings(root, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>Pharmacy Details</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.innerHTML =
      '<p style="color:var(--mut);font-size:12.5px;margin-top:0">These details appear on printed labels.</p>' +
      '<div class="fld"><label>Pharmacy Name</label><input type="text" id="lb-s-name" placeholder="Pharmacy name" value="' + esc(pharmacyDetails.name) + '"></div>' +
      '<div class="fld"><label>Address</label><input type="text" id="lb-s-addr" placeholder="Full address" value="' + esc(pharmacyDetails.address) + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="fld"><label>Phone</label><input type="text" id="lb-s-phone" placeholder="+356..." value="' + esc(pharmacyDetails.phone) + '"></div>' +
        '<div class="fld"><label>Licence Number</label><input type="text" id="lb-s-lic" placeholder="Licence #" value="' + esc(pharmacyDetails.licence) + '"></div>' +
      '</div>';

    var saveBtn = document.createElement("button");
    saveBtn.className = "btn pri";
    saveBtn.style.marginTop = "14px";
    saveBtn.textContent = "Save Pharmacy Details";
    saveBtn.addEventListener("click", function () {
      pharmacyDetails.name = document.getElementById("lb-s-name").value.trim();
      pharmacyDetails.address = document.getElementById("lb-s-addr").value.trim();
      pharmacyDetails.phone = document.getElementById("lb-s-phone").value.trim();
      pharmacyDetails.licence = document.getElementById("lb-s-lic").value.trim();
      save();
      saveBtn.textContent = "Saved!";
      setTimeout(function () { saveBtn.textContent = "Save Pharmacy Details"; }, 1500);
    });
    bd.appendChild(saveBtn);

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── register ─────────────────────────────────────────────────────────────
  E.registerModule({
    id: "labels",
    title: "Smart Labels",
    icon: "\uD83C\uDFF7\uFE0F",
    order: 71,
    render: render
  });

})();
