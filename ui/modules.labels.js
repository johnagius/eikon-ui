/* ui/modules.labels.js
   Eikon – Smart Label Generator module

   Create and print medication dispensing labels with customizable templates.
   Multi-language support (English + Maltese), standard warnings, print preview,
   reprint from history, and audit log.

   Features:
   - Patient name autosuggest (shared across modules via E._eikon_patients)
   - Medicine name autosuggest with auto-fill of dose/advice/warnings
   - Flash animation on autofilled fields
   - Print via hidden iframe (actual printer output)
   - Pharmacy name auto-filled from user location_name

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

  // ── toast ────────────────────────────────────────────────────────────────
  var toastWrap = null;
  function toast(msg, kind) {
    if (!toastWrap) {
      toastWrap = document.createElement("div");
      toastWrap.className = "lb-toast-wrap";
      document.body.appendChild(toastWrap);
    }
    var t = document.createElement("div");
    t.className = "lb-toast " + (kind || "good");
    t.innerHTML = '<span class="lb-toast-dot"></span>' + esc(msg);
    toastWrap.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 250);
    }, 2400);
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
    { id: "w01", en: "Take with food", mt: "Hu me\u0127ud mal-ikel" },
    { id: "w02", en: "Take on an empty stomach", mt: "Hu fuq stonku vojt" },
    { id: "w03", en: "May cause drowsiness", mt: "Jista\u2019 jikka\u0121una ng\u0127as" },
    { id: "w04", en: "Do not drive or operate machinery", mt: "Issuqx u t\u0127addimx makkinarju" },
    { id: "w05", en: "Keep refrigerated (2-8\u00B0C)", mt: "\u017Bomb fil-fri\u0121\u0121 (2-8\u00B0C)" },
    { id: "w06", en: "Shake well before use", mt: "\u0126awwad sew qabel l-u\u017Cu" },
    { id: "w07", en: "For external use only", mt: "G\u0127all-u\u017Cu estern biss" },
    { id: "w08", en: "Avoid alcohol", mt: "Evita l-alko\u0127ol" },
    { id: "w09", en: "Avoid prolonged sun exposure", mt: "Evita espo\u017Cizzjoni twila g\u0127ax-xemx" },
    { id: "w10", en: "Complete the full course", mt: "Lesti l-kors kollu" },
    { id: "w11", en: "Swallow whole, do not crush", mt: "Ibla\u2019 s\u0127i\u0127, tfarrakx" },
    { id: "w12", en: "Dissolve under the tongue", mt: "\u0126oll ta\u0127t l-ilsien" },
    { id: "w13", en: "Take at bedtime", mt: "Hu qabel l-irqad" },
    { id: "w14", en: "Take in the morning", mt: "Hu filg\u0127odu" },
    { id: "w15", en: "Store below 25\u00B0C", mt: "A\u0127\u017Cen ta\u0127t 25\u00B0C" },
    { id: "w16", en: "Keep out of reach of children", mt: "\u017Bomb \u2018il bog\u0127od mit-tfal" },
    { id: "w17", en: "Do not stop taking without medical advice", mt: "Tiqafx tie\u0127u ming\u0127ajr parir mediku" },
    { id: "w18", en: "May cause dizziness", mt: "Jista\u2019 jikka\u0121una sturdament" },
    { id: "w19", en: "Take with plenty of water", mt: "Hu ma\u2019 \u0127afna ilma" },
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
    "Four times daily": "Erba\u2019 darbiet kuljum",
    "Every morning": "Kull filg\u0127odu",
    "Every evening": "Kull filg\u0127axija",
    "Every 4 hours": "Kull 4 sig\u0127at",
    "Every 6 hours": "Kull 6 sig\u0127at",
    "Every 8 hours": "Kull 8 sig\u0127at",
    "Every 12 hours": "Kull 12-il sieg\u0127a",
    "Once weekly": "Darba fil-\u0121img\u0127a",
    "As needed": "Skont il-b\u017Conn",
    "As directed": "Skont id-direzzjonijiet"
  };

  var ROUTES = ["Oral", "Topical", "Sublingual", "Rectal", "Inhaled", "Nasal", "Ophthalmic", "Otic", "Intramuscular", "Subcutaneous", "Intravenous"];

  // ── patient + medicine memory ────────────────────────────────────────────
  // Shared patient store across modules (labels + screening)
  if (!E._eikon_patients) E._eikon_patients = {};

  function buildMemory() {
    // Build patient names from label history
    labelHistory.forEach(function (l) {
      var name = (l.patientName || "").trim();
      if (name) E._eikon_patients[norm(name)] = name;
    });
  }

  function getPatientSuggestions(query) {
    var q = norm(query);
    if (!q) return [];
    var results = [];
    var seen = {};
    Object.keys(E._eikon_patients).forEach(function (k) {
      if (k.indexOf(q) !== -1 && !seen[k]) {
        seen[k] = true;
        results.push(E._eikon_patients[k]);
      }
    });
    return results.slice(0, 8);
  }

  // Medicine memory: drug name -> array of { dose, frequency, route, customInstructions, selectedWarnings }
  var medicineDb = {};

  function buildMedicineDb() {
    medicineDb = {};
    labelHistory.forEach(function (l) {
      var drug = (l.drugName || "").trim();
      if (!drug) return;
      var key = norm(drug);
      if (!medicineDb[key]) medicineDb[key] = { name: drug, entries: [] };
      // avoid exact duplicates
      var entry = {
        dose: l.dose || "",
        frequency: l.frequency || "",
        route: l.route || "",
        customInstructions: l.customInstructions || "",
        selectedWarnings: l.selectedWarnings || []
      };
      var isDup = medicineDb[key].entries.some(function (e) {
        return e.dose === entry.dose && e.frequency === entry.frequency && e.route === entry.route && e.customInstructions === entry.customInstructions;
      });
      if (!isDup) medicineDb[key].entries.push(entry);
    });
  }

  function getMedicineSuggestions(query) {
    var q = norm(query);
    if (!q) return [];
    var results = [];
    Object.keys(medicineDb).forEach(function (k) {
      if (k.indexOf(q) !== -1) {
        results.push(medicineDb[k]);
      }
    });
    return results.slice(0, 8);
  }

  // ── autocomplete component ───────────────────────────────────────────────
  function attachAutocomplete(input, getSuggestions, onSelect) {
    var dropdown = document.createElement("div");
    dropdown.className = "lb-ac-dropdown";
    dropdown.style.display = "none";
    input.parentNode.style.position = "relative";
    input.parentNode.appendChild(dropdown);
    var activeIdx = -1;
    var items = [];

    function show(suggestions) {
      dropdown.innerHTML = "";
      items = suggestions;
      activeIdx = -1;
      if (suggestions.length === 0) { dropdown.style.display = "none"; return; }
      suggestions.forEach(function (s, i) {
        var div = document.createElement("div");
        div.className = "lb-ac-item";
        if (typeof s === "string") {
          div.textContent = s;
        } else {
          // medicine with entries count
          div.innerHTML = '<strong>' + esc(s.name) + '</strong>' + (s.entries.length > 1 ? ' <span style="color:var(--mut);font-size:11px">(' + s.entries.length + ' variations)</span>' : '');
        }
        div.addEventListener("mousedown", function (e) {
          e.preventDefault();
          onSelect(s);
          dropdown.style.display = "none";
        });
        dropdown.appendChild(div);
      });
      dropdown.style.display = "";
    }

    input.addEventListener("input", function () {
      var val = input.value.trim();
      if (val.length < 1) { dropdown.style.display = "none"; return; }
      var sugs = getSuggestions(val);
      show(sugs);
    });

    input.addEventListener("keydown", function (e) {
      if (dropdown.style.display === "none" || items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        updateActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        updateActive();
      } else if (e.key === "Enter" && activeIdx >= 0) {
        e.preventDefault();
        onSelect(items[activeIdx]);
        dropdown.style.display = "none";
      } else if (e.key === "Escape") {
        dropdown.style.display = "none";
      }
    });

    function updateActive() {
      var divs = dropdown.querySelectorAll(".lb-ac-item");
      divs.forEach(function (d, i) { d.classList.toggle("active", i === activeIdx); });
    }

    input.addEventListener("blur", function () {
      setTimeout(function () { dropdown.style.display = "none"; }, 150);
    });
  }

  // ── flash animation helper ───────────────────────────────────────────────
  function flashField(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("lb-autofilled");
    void el.offsetWidth; // force reflow
    el.classList.add("lb-autofilled");
  }

  // ── print via iframe ─────────────────────────────────────────────────────
  function printLabelHtml(html) {
    var iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;";
    document.body.appendChild(iframe);
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><style>');
    doc.write('body{margin:0;padding:0;font-family:"Segoe UI",system-ui,sans-serif;}');
    doc.write('.label-preview{padding:14px 18px;line-height:1.5;font-size:13px;}');
    doc.write('.label-preview.large{font-size:17px;padding:24px 28px;line-height:1.65;}');
    doc.write('.lp-header{border-bottom:2px solid #222;padding-bottom:6px;margin-bottom:8px;}');
    doc.write('.lp-header h4{margin:0;font-weight:900;font-size:1.15em;}');
    doc.write('.lp-header .lp-addr{font-size:.78em;color:#666;margin-top:2px;}');
    doc.write('.lp-row{margin:3px 0;display:flex;gap:6px;}');
    doc.write('.lp-label{font-weight:700;color:#333;min-width:80px;}');
    doc.write('.lp-val{color:#111;} .lp-mt{color:#666;font-style:italic;font-size:.9em;}');
    doc.write('.lp-warn{margin-top:8px;padding-top:6px;border-top:1.5px solid #ddd;}');
    doc.write('.lp-warn div{font-weight:700;font-size:.88em;color:#b45309;margin:2px 0;}');
    doc.write('.lp-warn .lp-wmt{color:#888;font-weight:400;font-style:italic;}');
    doc.write('.lp-footer{margin-top:8px;padding-top:6px;border-top:1.5px solid #ddd;font-size:.78em;color:#888;display:flex;justify-content:space-between;}');
    doc.write('</style></head><body>');
    doc.write(html);
    doc.write('</body></html>');
    doc.close();
    iframe.contentWindow.focus();
    setTimeout(function () {
      iframe.contentWindow.print();
      setTimeout(function () { iframe.remove(); }, 1000);
    }, 250);
  }

  // ── styles ───────────────────────────────────────────────────────────────
  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return; stylesDone = true;
    var s = document.createElement("style"); s.id = "eikon-labels-style";
    s.textContent = [
      /* root + ambient background */
      ".lb{--ac:#a78bfa;--ac2:#5aa2ff;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.035);--pnl2:rgba(255,255,255,.055);--bd:rgba(255,255,255,.09);--bd2:rgba(255,255,255,.14);--r:18px;--r2:12px;--txt:#e8eefc;--mut:rgba(170,183,214,.72);--shadow:0 12px 36px rgba(0,0,0,.35);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--txt);margin:-14px;min-height:calc(100vh - 56px);background:radial-gradient(1100px 600px at 12% 10%,rgba(167,139,250,.12),transparent 58%),radial-gradient(900px 500px at 85% 20%,rgba(90,162,255,.10),transparent 55%),radial-gradient(800px 600px at 50% 100%,rgba(46,229,157,.07),transparent 50%)}",
      ".lb *{box-sizing:border-box}",
      ".lb .container{max-width:1200px;margin:0 auto;padding:22px 20px 40px}",

      /* hero */
      ".lb .hero{position:relative;border-radius:22px;border:1px solid var(--bd2);overflow:hidden;padding:28px 28px 22px;margin-bottom:20px;background:linear-gradient(135deg,rgba(167,139,250,.14),rgba(90,162,255,.10),rgba(46,229,157,.06));box-shadow:var(--shadow);backdrop-filter:blur(8px)}",
      ".lb .hero::before{content:'';position:absolute;inset:0;background:radial-gradient(500px circle at 75% 25%,rgba(167,139,250,.12),transparent 60%);pointer-events:none}",
      ".lb .hero h2{margin:0 0 4px;font-size:22px;font-weight:900;letter-spacing:.3px;position:relative}",
      ".lb .hero .sub{color:var(--mut);font-size:13px;position:relative}",

      /* KPI */
      ".lb .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}",
      ".lb .kpi{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);padding:18px 14px;text-align:center;backdrop-filter:blur(6px);transition:transform .15s,border-color .2s,box-shadow .2s}",
      ".lb .kpi:hover{transform:translateY(-2px);border-color:var(--bd2);box-shadow:0 8px 24px rgba(0,0,0,.25)}",
      ".lb .kpi .n{font-size:30px;font-weight:900;letter-spacing:.5px;line-height:1.1}",
      ".lb .kpi .l{font-size:11px;color:var(--mut);margin-top:5px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}",

      /* tabs */
      ".lb .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;padding:4px;background:var(--pnl);border-radius:14px;border:1px solid var(--bd)}",
      ".lb .tab{padding:10px 18px;border-radius:10px;border:none;background:transparent;color:var(--mut);cursor:pointer;font-size:13px;font-weight:700;transition:all .18s;position:relative}",
      ".lb .tab:hover{color:var(--txt);background:rgba(255,255,255,.05)}",
      ".lb .tab.on{color:var(--txt);background:rgba(167,139,250,.15);box-shadow:0 2px 12px rgba(167,139,250,.15)}",

      /* card */
      ".lb .card{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);box-shadow:var(--shadow);overflow:hidden;margin-bottom:16px;backdrop-filter:blur(6px);transition:border-color .2s}",
      ".lb .card:hover{border-color:var(--bd2)}",
      ".lb .card .hd{padding:14px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--pnl)}",
      ".lb .card .hd h3{margin:0;font-size:15px;font-weight:800}",
      ".lb .card .bd{padding:20px}",

      /* form */
      ".lb .fld{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}",
      ".lb .fld label{color:var(--mut);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}",
      ".lb .fld input,.lb .fld select,.lb .fld textarea{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.22);color:var(--txt);padding:10px 12px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .2s,box-shadow .2s}",
      ".lb .fld input:focus,.lb .fld select:focus,.lb .fld textarea:focus{border-color:rgba(167,139,250,.55);box-shadow:0 0 0 3px rgba(167,139,250,.12)}",
      ".lb .fld textarea{min-height:68px;resize:vertical;line-height:1.4}",
      ".lb .fld input::placeholder,.lb .fld textarea::placeholder{color:rgba(170,183,214,.4)}",

      /* autofill flash animation */
      "@keyframes lbFlash{0%{border-color:rgba(255,204,102,.8);box-shadow:0 0 0 3px rgba(255,204,102,.25);background:rgba(255,204,102,.08)}50%{border-color:rgba(255,204,102,.3);box-shadow:0 0 0 3px rgba(255,204,102,.08);background:rgba(0,0,0,.22)}100%{border-color:rgba(255,204,102,.8);box-shadow:0 0 0 3px rgba(255,204,102,.25);background:rgba(255,204,102,.08)}}",
      ".lb .lb-autofilled{animation:lbFlash 1.2s ease-in-out infinite !important;border-color:rgba(255,204,102,.8) !important}",

      /* autocomplete dropdown */
      ".lb-ac-dropdown{position:absolute;left:0;right:0;top:100%;z-index:100;background:linear-gradient(165deg,#1a2538,#151f30);border:1px solid var(--bd2);border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.5);max-height:220px;overflow-y:auto;margin-top:4px}",
      ".lb-ac-item{padding:10px 14px;cursor:pointer;font-size:13px;transition:background .1s;border-bottom:1px solid rgba(255,255,255,.05)}",
      ".lb-ac-item:last-child{border-bottom:none}",
      ".lb-ac-item:hover,.lb-ac-item.active{background:rgba(167,139,250,.12)}",

      /* btn */
      ".lb .btn{border:1px solid var(--bd);background:var(--pnl2);color:var(--txt);padding:9px 16px;border-radius:var(--r2);cursor:pointer;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:8px;transition:all .15s;position:relative;overflow:hidden}",
      ".lb .btn:hover{background:rgba(255,255,255,.08);border-color:var(--bd2);transform:translateY(-1px)}",
      ".lb .btn:active{transform:translateY(0)}",
      ".lb .btn.pri{background:linear-gradient(135deg,rgba(167,139,250,.22),rgba(90,162,255,.18));border-color:rgba(167,139,250,.4);color:#c4b5fd}",
      ".lb .btn.pri:hover{background:linear-gradient(135deg,rgba(167,139,250,.3),rgba(90,162,255,.24));border-color:rgba(167,139,250,.55);box-shadow:0 4px 16px rgba(167,139,250,.15)}",
      ".lb .btn.ok{background:linear-gradient(135deg,rgba(46,229,157,.18),rgba(46,229,157,.12));border-color:rgba(46,229,157,.4);color:#6af0be}",
      ".lb .btn.dn{background:linear-gradient(135deg,rgba(255,107,157,.18),rgba(255,107,157,.12));border-color:rgba(255,107,157,.35);color:#ff9ebe}",
      ".lb .btn.dn:hover{background:linear-gradient(135deg,rgba(255,107,157,.28),rgba(255,107,157,.2));border-color:rgba(255,107,157,.5);box-shadow:0 4px 16px rgba(255,107,157,.12)}",
      ".lb .btn.sm{padding:7px 12px;font-size:12px;border-radius:10px}",

      /* table */
      ".lb table{width:100%;border-collapse:collapse;font-size:13px}",
      ".lb th{text-align:left;padding:11px 14px;border-bottom:2px solid var(--bd2);color:var(--mut);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;position:sticky;top:0;background:rgba(11,18,32,.92);backdrop-filter:blur(6px);z-index:2}",
      ".lb td{padding:10px 14px;border-bottom:1px solid var(--bd);transition:background .12s}",
      ".lb tbody tr{transition:background .12s}",
      ".lb tbody tr:hover td{background:rgba(167,139,250,.04)}",
      ".lb tbody tr:hover{cursor:pointer}",

      /* search */
      ".lb .search-bar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}",
      ".lb .search-bar input{flex:1;min-width:200px;border:1px solid var(--bd);background:rgba(0,0,0,.22);color:var(--txt);padding:10px 14px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .2s}",
      ".lb .search-bar input:focus{border-color:rgba(167,139,250,.55);box-shadow:0 0 0 3px rgba(167,139,250,.1)}",

      /* warnings tags */
      ".lb .warn-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}",
      ".lb .warn-tag{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:20px;font-size:11.5px;font-weight:600;cursor:pointer;border:1px solid var(--bd);background:var(--pnl);transition:all .15s;user-select:none}",
      ".lb .warn-tag:hover{background:rgba(255,255,255,.06);border-color:var(--bd2)}",
      ".lb .warn-tag.on{background:linear-gradient(135deg,rgba(255,204,102,.14),rgba(255,180,60,.10));border-color:rgba(255,204,102,.45);color:#ffcc66}",
      ".lb .warn-tag.on::before{content:'\u2713 ';font-weight:800}",

      /* label preview */
      ".lb .label-preview-wrap{border:2px dashed var(--bd2);border-radius:16px;padding:4px;background:rgba(255,255,255,.02);position:relative;margin:16px 0}",
      ".lb .label-preview-wrap::before{content:'PREVIEW';position:absolute;top:-9px;left:20px;background:#111b2a;padding:0 8px;font-size:10px;font-weight:700;color:var(--mut);letter-spacing:1px}",
      ".lb .label-preview{background:#fff;color:#111;border-radius:12px;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}",
      ".lb .label-preview.large{font-size:17px;padding:28px 30px;line-height:1.65}",
      ".lb .label-preview.standard{font-size:13px;padding:18px 22px;line-height:1.5}",
      ".lb .label-preview .lp-header{border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:10px}",
      ".lb .label-preview .lp-header h4{margin:0;font-weight:900;font-size:1.15em;color:#111}",
      ".lb .label-preview .lp-header .lp-addr{font-size:.78em;color:#666;margin-top:2px}",
      ".lb .label-preview .lp-row{margin:4px 0;display:flex;gap:6px}",
      ".lb .label-preview .lp-label{font-weight:700;color:#333;min-width:80px;flex-shrink:0}",
      ".lb .label-preview .lp-val{color:#111}",
      ".lb .label-preview .lp-mt{color:#666;font-style:italic;font-size:.9em}",
      ".lb .label-preview .lp-warn{margin-top:10px;padding-top:8px;border-top:1.5px solid #ddd}",
      ".lb .label-preview .lp-warn div{font-weight:700;font-size:.88em;color:#b45309;margin:3px 0;display:flex;align-items:center;gap:5px}",
      ".lb .label-preview .lp-warn .lp-wmt{color:#888;font-weight:400;font-style:italic}",
      ".lb .label-preview .lp-footer{margin-top:10px;padding-top:8px;border-top:1.5px solid #ddd;font-size:.78em;color:#888;display:flex;justify-content:space-between}",

      /* modal */
      ".lb-modal-bg{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .2s}",
      ".lb-modal-bg.show{opacity:1}",
      ".lb-modal{background:linear-gradient(165deg,#141e30,#111b2a 40%,#0f1824);border:1px solid rgba(255,255,255,.14);border-radius:20px;max-width:680px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.04) inset;transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1),opacity .2s;opacity:0}",
      ".lb-modal-bg.show .lb-modal{transform:translateY(0) scale(1);opacity:1}",
      ".lb-modal .m-hd{padding:20px 24px 16px;border-bottom:1px solid rgba(255,255,255,.09);display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,rgba(167,139,250,.06),rgba(90,162,255,.04))}",
      ".lb-modal .m-hd h3{margin:0;font-size:17px;font-weight:800}",
      ".lb-modal .m-bd{padding:22px 24px}",
      ".lb-modal .m-ft{padding:16px 24px;border-top:1px solid rgba(255,255,255,.09);display:flex;justify-content:flex-end;gap:8px;background:rgba(0,0,0,.1)}",
      ".lb-modal .close-x{width:32px;height:32px;border-radius:10px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.04);color:rgba(170,183,214,.72);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}",
      ".lb-modal .close-x:hover{background:rgba(255,107,157,.12);border-color:rgba(255,107,157,.3);color:#ff9ebe}",

      /* toast */
      ".lb-toast-wrap{position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none}",
      ".lb-toast{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;font-size:13px;font-weight:600;background:rgba(11,18,32,.88);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(8px);transition:all .22s}",
      ".lb-toast.show{opacity:1;transform:translateY(0)}",
      ".lb-toast-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}",
      ".lb-toast.good .lb-toast-dot{background:#2ee59d}",
      ".lb-toast.bad .lb-toast-dot{background:#ff6b9d}",
      ".lb-toast.warn .lb-toast-dot{background:#ffcc66}",

      /* medicine variant picker */
      ".lb .variant-picker{margin-top:8px;padding:10px;border:1px solid var(--bd);border-radius:var(--r2);background:rgba(255,204,102,.04)}",
      ".lb .variant-picker .vp-title{font-size:11px;color:var(--wn);font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}",
      ".lb .variant-btn{display:block;width:100%;text-align:left;padding:8px 12px;margin-bottom:4px;border:1px solid var(--bd);border-radius:10px;background:var(--pnl);color:var(--txt);font-size:12px;cursor:pointer;transition:all .12s}",
      ".lb .variant-btn:hover{background:rgba(255,204,102,.1);border-color:rgba(255,204,102,.3)}",
      ".lb .variant-btn:last-child{margin-bottom:0}",

      /* empty */
      ".lb .empty{text-align:center;padding:50px 20px;color:var(--mut)}",
      ".lb .empty .icon{font-size:48px;margin-bottom:12px;opacity:.7}",
      ".lb .empty .msg{font-size:14px;margin-bottom:16px}",

      /* scrollbar */
      ".lb ::-webkit-scrollbar{width:6px}",
      ".lb ::-webkit-scrollbar-track{background:transparent}",
      ".lb ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}",
      ".lb ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.2)}",

      /* responsive */
      "@media(max-width:700px){.lb .container{padding:14px 12px}.lb .kpi-row{grid-template-columns:repeat(2,1fr)}.lb .create-layout{grid-template-columns:1fr !important}.lb-modal{max-width:100%;border-radius:16px}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  // ── modal helper ─────────────────────────────────────────────────────────
  function openModal(title, bodyHtml, footerHtml) {
    var bg = document.createElement("div");
    bg.className = "lb-modal-bg";
    var modal = document.createElement("div");
    modal.className = "lb-modal";
    modal.innerHTML =
      '<div class="m-hd"><h3>' + title + '</h3><button class="close-x">&times;</button></div>' +
      '<div class="m-bd">' + bodyHtml + '</div>' +
      '<div class="m-ft">' + footerHtml + '</div>';
    bg.appendChild(modal);
    document.body.appendChild(bg);
    requestAnimationFrame(function () { requestAnimationFrame(function () { bg.classList.add("show"); }); });
    function close() {
      bg.classList.remove("show");
      setTimeout(function () { bg.remove(); }, 220);
    }
    modal.querySelector(".close-x").addEventListener("click", close);
    bg.addEventListener("click", function (e) { if (e.target === bg) close(); });
    return { bg: bg, modal: modal, close: close };
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
    buildMemory();
    buildMedicineDb();

    // Auto-fill pharmacy name from location if not set
    if (!pharmacyDetails.name && currentUser && currentUser.location_name) {
      pharmacyDetails.name = currentUser.location_name;
      save();
    }

    mount.innerHTML = "";
    var root = document.createElement("div");
    root.className = "lb";
    mount.appendChild(root);

    function redraw() {
      root.innerHTML = "";
      var container = document.createElement("div");
      container.className = "container";
      root.appendChild(container);

      // hero
      var hero = document.createElement("div");
      hero.className = "hero";
      hero.innerHTML = '<h2>\uD83C\uDFF7\uFE0F Smart Label Generator</h2><div class="sub">Create and print medication dispensing labels with customizable templates</div>';
      container.appendChild(hero);

      // KPI
      var todayLabels = labelHistory.filter(function (l) { return (l.printedAt || "").indexOf(todayStr()) === 0; }).length;
      var uniqueDrugs = Object.keys(medicineDb).length;
      var kpiRow = document.createElement("div");
      kpiRow.className = "kpi-row";
      var kpis = [
        { n: labelHistory.length, l: "Total Printed", color: "#a78bfa" },
        { n: todayLabels, l: "Today", color: "#5aa2ff" },
        { n: uniqueDrugs, l: "Known Drugs", color: "#2ee59d" },
        { n: templates.length, l: "Templates", color: "#ffcc66" }
      ];
      kpis.forEach(function (k) {
        kpiRow.innerHTML += '<div class="kpi"><div class="n" style="color:' + k.color + '">' + k.n + '</div><div class="l">' + k.l + '</div></div>';
      });
      container.appendChild(kpiRow);

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
      container.appendChild(tabs);

      if (activeTab === "create") renderCreateLabel(container, redraw);
      else if (activeTab === "history") renderHistory(container, redraw);
      else if (activeTab === "templates") renderTemplates(container, redraw);
      else if (activeTab === "warnings") renderWarnings(container, redraw);
      else if (activeTab === "settings") renderSettings(container, redraw);
    }

    redraw();
  }

  // ── create label ─────────────────────────────────────────────────────────
  function renderCreateLabel(container, redraw) {
    var label = currentLabel || {
      patientName: "", drugName: "", dose: "", frequency: FREQUENCIES_EN[0],
      route: ROUTES[0], customInstructions: "", selectedWarnings: [],
      templateId: templates.length > 0 ? templates[0].id : "tpl_std"
    };
    currentLabel = label;

    var layout = document.createElement("div");
    layout.className = "create-layout";
    layout.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start";

    // left: form
    var formCard = document.createElement("div");
    formCard.className = "card";
    formCard.innerHTML = '<div class="hd"><h3>\uD83D\uDCDD Label Details</h3></div>';
    var formBd = document.createElement("div");
    formBd.className = "bd";

    formBd.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="fld"><label>Template</label><select id="lb-tpl">' +
          templates.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === label.templateId ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join("") +
        '</select></div>' +
        '<div class="fld"><label>Language</label><select id="lb-lang"><option value="en"' + (!showMaltese ? ' selected' : '') + '>English only</option><option value="both"' + (showMaltese ? ' selected' : '') + '>English + Maltese</option></select></div>' +
      '</div>' +
      '<div class="fld"><label>Patient Name *</label><input type="text" id="lb-patient" placeholder="Start typing to search\u2026" value="' + esc(label.patientName) + '" autocomplete="off"></div>' +
      '<div class="fld"><label>Drug Name *</label><input type="text" id="lb-drug" placeholder="Start typing to search\u2026" value="' + esc(label.drugName) + '" autocomplete="off"></div>' +
      '<div id="lb-variant-area"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="fld"><label>Dose</label><input type="text" id="lb-dose" placeholder="e.g. 1 tablet, 5ml" value="' + esc(label.dose) + '"></div>' +
        '<div class="fld"><label>Route</label><select id="lb-route">' + ROUTES.map(function (r) { return '<option' + (r === label.route ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      '<div class="fld"><label>Frequency</label><select id="lb-freq">' + FREQUENCIES_EN.map(function (f) { return '<option' + (f === label.frequency ? ' selected' : '') + '>' + esc(f) + '</option>'; }).join("") + '</select></div>' +
      '<div class="fld"><label>Custom Instructions</label><textarea id="lb-custom" placeholder="Additional instructions\u2026">' + esc(label.customInstructions) + '</textarea></div>';

    // warning selector
    var warnFld = document.createElement("div");
    warnFld.className = "fld";
    warnFld.innerHTML = '<label>Warning / Advisory Labels</label>';
    var warnList = document.createElement("div");
    warnList.className = "warn-list";
    warnList.id = "lb-warn-list";
    WARNINGS.forEach(function (w) {
      var selected = (label.selectedWarnings || []).indexOf(w.id) !== -1;
      var tag = document.createElement("span");
      tag.className = "warn-tag" + (selected ? " on" : "");
      tag.setAttribute("data-wid", w.id);
      tag.textContent = w.en;
      tag.addEventListener("click", function () {
        var idx = label.selectedWarnings.indexOf(w.id);
        if (idx !== -1) label.selectedWarnings.splice(idx, 1);
        else label.selectedWarnings.push(w.id);
        tag.classList.toggle("on");
        // remove flash when user manually changes
        tag.classList.remove("lb-autofilled");
        updatePreview();
      });
      warnList.appendChild(tag);
    });
    warnFld.appendChild(warnList);
    formBd.appendChild(warnFld);

    formCard.appendChild(formBd);
    layout.appendChild(formCard);

    // right: preview + actions
    var previewCard = document.createElement("div");
    previewCard.className = "card";
    previewCard.style.position = "sticky";
    previewCard.style.top = "14px";
    previewCard.innerHTML = '<div class="hd"><h3>\uD83D\uDD0D Print Preview</h3></div>';
    var previewBd = document.createElement("div");
    previewBd.className = "bd";
    var previewArea = document.createElement("div");
    previewArea.id = "lb-preview-area";
    previewBd.appendChild(previewArea);

    var actionRow = document.createElement("div");
    actionRow.style.cssText = "display:flex;gap:8px;margin-top:16px;flex-wrap:wrap";

    var printBtn = document.createElement("button");
    printBtn.className = "btn pri";
    printBtn.innerHTML = "\uD83D\uDDA8\uFE0F Print Label";
    printBtn.addEventListener("click", function () {
      collectFormData();
      if (!label.patientName || !label.drugName) { toast("Patient Name and Drug Name are required", "bad"); return; }
      var entry = Object.assign({}, label, { id: uid(), printedAt: nowStr(), printedBy: currentUser ? currentUser.full_name || currentUser.email : "Unknown" });
      labelHistory.unshift(entry);
      save();
      // rebuild memory with new entry
      buildMemory();
      buildMedicineDb();
      // print via iframe
      var previewEl = document.querySelector("#lb-preview-area .label-preview");
      if (previewEl) {
        printLabelHtml(previewEl.outerHTML);
      }
      toast("Label sent to printer and saved to history", "good");
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
    container.appendChild(layout);

    // ── attach autocomplete: patient name ──
    var patientInput = document.getElementById("lb-patient");
    attachAutocomplete(patientInput, getPatientSuggestions, function (name) {
      patientInput.value = name;
      label.patientName = name;
      updatePreview();
    });

    // ── attach autocomplete: drug name ──
    var drugInput = document.getElementById("lb-drug");
    attachAutocomplete(drugInput, getMedicineSuggestions, function (med) {
      drugInput.value = med.name;
      label.drugName = med.name;
      // if only 1 entry, auto-fill immediately; if multiple, show variant picker
      if (med.entries.length === 1) {
        applyMedicineEntry(med.entries[0]);
      } else if (med.entries.length > 1) {
        showVariantPicker(med.entries);
      }
      updatePreview();
    });

    function applyMedicineEntry(entry) {
      var doseEl = document.getElementById("lb-dose");
      var freqEl = document.getElementById("lb-freq");
      var routeEl = document.getElementById("lb-route");
      var customEl = document.getElementById("lb-custom");

      if (entry.dose) { doseEl.value = entry.dose; label.dose = entry.dose; flashField("lb-dose"); }
      if (entry.frequency) {
        freqEl.value = entry.frequency; label.frequency = entry.frequency; flashField("lb-freq");
      }
      if (entry.route) {
        routeEl.value = entry.route; label.route = entry.route; flashField("lb-route");
      }
      if (entry.customInstructions) {
        customEl.value = entry.customInstructions; label.customInstructions = entry.customInstructions; flashField("lb-custom");
      }
      // auto-fill warnings
      if (entry.selectedWarnings && entry.selectedWarnings.length > 0) {
        label.selectedWarnings = entry.selectedWarnings.slice();
        // update warning tags visually
        var warnListEl = document.getElementById("lb-warn-list");
        if (warnListEl) {
          warnListEl.querySelectorAll(".warn-tag").forEach(function (tag) {
            var wid = tag.getAttribute("data-wid");
            var isOn = label.selectedWarnings.indexOf(wid) !== -1;
            tag.classList.toggle("on", isOn);
            if (isOn) {
              tag.classList.remove("lb-autofilled");
              void tag.offsetWidth;
              tag.classList.add("lb-autofilled");
            }
          });
        }
      }
      // clear variant area
      var va = document.getElementById("lb-variant-area");
      if (va) va.innerHTML = "";
      updatePreview();
    }

    function showVariantPicker(entries) {
      var va = document.getElementById("lb-variant-area");
      if (!va) return;
      va.innerHTML = '';
      var picker = document.createElement("div");
      picker.className = "variant-picker";
      picker.innerHTML = '<div class="vp-title">Multiple dosages found \u2014 choose one:</div>';
      entries.forEach(function (entry, i) {
        var btn = document.createElement("button");
        btn.className = "variant-btn";
        var parts = [];
        if (entry.dose) parts.push(entry.dose);
        if (entry.frequency) parts.push(entry.frequency);
        if (entry.route && entry.route !== "Oral") parts.push(entry.route);
        if (entry.customInstructions) parts.push('"' + entry.customInstructions + '"');
        btn.textContent = parts.join(" \u2022 ") || "Variation " + (i + 1);
        btn.addEventListener("click", function () {
          applyMedicineEntry(entry);
        });
        picker.appendChild(btn);
      });
      va.appendChild(picker);
    }

    // collect form data
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
      var html = '<div class="label-preview-wrap"><div class="label-preview ' + sizeClass + '">';

      html += '<div class="lp-header"><h4>' + esc(pharmacyDetails.name || "Pharmacy Name") + '</h4>';
      if (pharmacyDetails.address) html += '<div class="lp-addr">' + esc(pharmacyDetails.address) + (pharmacyDetails.phone ? ' | Tel: ' + esc(pharmacyDetails.phone) : '') + '</div>';
      html += '</div>';

      html += '<div class="lp-row"><span class="lp-label">Patient:</span> <span class="lp-val">' + esc(label.patientName || "\u2014") + '</span></div>';
      html += '<div class="lp-row"><span class="lp-label">Drug:</span> <span class="lp-val"><strong>' + esc(label.drugName || "\u2014") + '</strong></span></div>';
      if (label.dose) html += '<div class="lp-row"><span class="lp-label">Dose:</span> <span class="lp-val">' + esc(label.dose) + '</span></div>';
      html += '<div class="lp-row"><span class="lp-label">Frequency:</span> <span class="lp-val">' + esc(label.frequency);
      if (showMaltese && FREQUENCIES_MT[label.frequency]) html += ' <span class="lp-mt">(' + esc(FREQUENCIES_MT[label.frequency]) + ')</span>';
      html += '</span></div>';
      html += '<div class="lp-row"><span class="lp-label">Route:</span> <span class="lp-val">' + esc(label.route) + '</span></div>';
      if (label.customInstructions) html += '<div class="lp-row"><span class="lp-label">Note:</span> <span class="lp-val">' + esc(label.customInstructions) + '</span></div>';

      var selWarnings = WARNINGS.filter(function (w) { return (label.selectedWarnings || []).indexOf(w.id) !== -1; });
      if (selWarnings.length > 0) {
        html += '<div class="lp-warn">';
        selWarnings.forEach(function (w) {
          html += '<div>\u26A0\uFE0F ' + esc(w.en);
          if (showMaltese) html += ' <span class="lp-wmt">(' + esc(w.mt) + ')</span>';
          html += '</div>';
        });
        html += '</div>';
      }

      html += '<div class="lp-footer"><span>Date: ' + fmtDate(todayStr()) + '</span>';
      if (pharmacyDetails.licence) html += '<span>Lic: ' + esc(pharmacyDetails.licence) + '</span>';
      html += '</div>';
      html += '</div></div>';
      previewArea.innerHTML = html;
    }

    // remove flash on manual input
    ["lb-dose", "lb-freq", "lb-route", "lb-custom"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", function () { el.classList.remove("lb-autofilled"); });
        el.addEventListener("change", function () { el.classList.remove("lb-autofilled"); });
      }
    });

    // attach change listeners for preview
    ["lb-tpl", "lb-lang", "lb-patient", "lb-drug", "lb-dose", "lb-route", "lb-freq", "lb-custom"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", updatePreview);
      if (el) el.addEventListener("change", updatePreview);
    });

    updatePreview();
  }

  // ── history ──────────────────────────────────────────────────────────────
  function renderHistory(container, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83D\uDCCB Print History (' + labelHistory.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.style.overflowX = "auto";

    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search by patient, drug, or date\u2026";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") redraw(); });
    searchBar.appendChild(searchInput);
    bd.appendChild(searchBar);

    var filtered = labelHistory;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = labelHistory.filter(function (l) {
        return norm(l.patientName).indexOf(q) !== -1 || norm(l.drugName).indexOf(q) !== -1 || (l.printedAt || "").indexOf(q) !== -1;
      });
    }

    if (filtered.length === 0) {
      bd.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDCCB</div><div class="msg">No labels in history.</div></div>';
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
          '<td style="white-space:nowrap"></td>';
        var actionTd = tr.querySelector("td:last-child");
        var reprintBtn = document.createElement("button");
        reprintBtn.className = "btn sm pri";
        reprintBtn.textContent = "Reprint";
        reprintBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          currentLabel = {
            patientName: l.patientName, drugName: l.drugName, dose: l.dose,
            frequency: l.frequency, route: l.route, customInstructions: l.customInstructions,
            selectedWarnings: l.selectedWarnings || [], templateId: l.templateId || (templates[0] || {}).id
          };
          activeTab = "create";
          toast("Label loaded \u2014 ready to reprint", "good");
          redraw();
        });
        actionTd.appendChild(reprintBtn);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── templates ────────────────────────────────────────────────────────────
  function renderTemplates(container, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    var hd = document.createElement("div");
    hd.className = "hd";
    hd.innerHTML = '<h3>\uD83D\uDCC4 Label Templates</h3>';
    var addBtn = document.createElement("button");
    addBtn.className = "btn pri sm";
    addBtn.textContent = "+ New Template";
    addBtn.addEventListener("click", function () { showTemplateModal(null, redraw); });
    hd.appendChild(addBtn);
    card.appendChild(hd);

    var bd = document.createElement("div");
    bd.className = "bd";
    bd.style.overflowX = "auto";

    if (templates.length === 0) {
      bd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDCC4</div><div class="msg">No templates. Add one to get started.</div></div>';
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
          '<td>' + (t.isDefault ? '<span style="color:#2ee59d;font-weight:700">\u2713 Default</span>' : '-') + '</td>' +
          '<td style="white-space:nowrap"></td>';
        var actionTd = tr.querySelector("td:last-child");
        var eBtn = document.createElement("button");
        eBtn.className = "btn sm";
        eBtn.textContent = "Edit";
        eBtn.addEventListener("click", function (e) { e.stopPropagation(); showTemplateModal(t, redraw); });
        actionTd.appendChild(eBtn);

        if (!t.isDefault) {
          var dBtn = document.createElement("button");
          dBtn.className = "btn sm dn";
          dBtn.textContent = "Delete";
          dBtn.style.marginLeft = "4px";
          dBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            if (!confirm("Delete template \"" + t.name + "\"?")) return;
            templates = templates.filter(function (x) { return x.id !== t.id; });
            save();
            toast("Template deleted", "warn");
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
    container.appendChild(card);
  }

  function showTemplateModal(existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing, { fields: (existing.fields || []).slice() }) : { id: uid(), name: "", size: "standard", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: false };

    var allFields = [
      { id: "patientName", label: "Patient Name" }, { id: "drugName", label: "Drug Name" },
      { id: "dose", label: "Dose" }, { id: "frequency", label: "Frequency" },
      { id: "route", label: "Route" }, { id: "warnings", label: "Warning Labels" },
      { id: "pharmacyDetails", label: "Pharmacy Details" }, { id: "date", label: "Date" },
      { id: "customInstructions", label: "Custom Instructions" }
    ];

    var bodyHtml =
      '<div class="lb">' +
        '<div class="fld"><label>Template Name</label><input type="text" id="lb-t-name" placeholder="e.g. Large Print Label" value="' + esc(data.name) + '"></div>' +
        '<div class="fld"><label>Label Size</label><select id="lb-t-size"><option value="standard"' + (data.size === "standard" ? ' selected' : '') + '>Standard</option><option value="large"' + (data.size === "large" ? ' selected' : '') + '>Large Print (Elderly)</option></select></div>' +
        '<div class="fld"><label>Fields to Include</label><div id="lb-t-fields" class="warn-list">' +
          allFields.map(function (f) {
            var on = data.fields.indexOf(f.id) !== -1;
            return '<span class="warn-tag' + (on ? ' on' : '') + '" data-fid="' + f.id + '">' + esc(f.label) + '</span>';
          }).join("") +
        '</div></div>' +
        '<div class="fld"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;text-transform:none;letter-spacing:0"><input type="checkbox" id="lb-t-default"' + (data.isDefault ? ' checked' : '') + ' style="width:auto;margin:0"> Set as default template</label></div>' +
      '</div>';

    var footerHtml = '<button class="lb btn close-cancel">Cancel</button><button class="lb btn pri" id="lb-t-save">Save Template</button>';
    var m = openModal(isEdit ? "Edit Template" : "New Template", bodyHtml, footerHtml);
    m.modal.querySelector(".close-cancel").addEventListener("click", m.close);

    m.modal.querySelectorAll("#lb-t-fields .warn-tag").forEach(function (tag) {
      tag.addEventListener("click", function () {
        var fid = tag.getAttribute("data-fid");
        var idx = data.fields.indexOf(fid);
        if (idx !== -1) data.fields.splice(idx, 1);
        else data.fields.push(fid);
        tag.classList.toggle("on");
      });
    });

    m.modal.querySelector("#lb-t-save").addEventListener("click", function () {
      var name = m.modal.querySelector("#lb-t-name").value.trim();
      if (!name) { m.modal.querySelector("#lb-t-name").style.borderColor = "#ff5a7a"; return; }
      data.name = name;
      data.size = m.modal.querySelector("#lb-t-size").value;
      data.isDefault = m.modal.querySelector("#lb-t-default").checked;
      if (data.isDefault) templates.forEach(function (t) { t.isDefault = false; });
      if (isEdit) {
        var idx = templates.findIndex(function (t) { return t.id === data.id; });
        if (idx !== -1) templates[idx] = data;
      } else {
        templates.push(data);
      }
      save(); m.close();
      toast(isEdit ? "Template updated" : "Template created", "good");
      redraw();
    });
    setTimeout(function () { var f = m.modal.querySelector("#lb-t-name"); if (f) f.focus(); }, 80);
  }

  // ── warnings reference ───────────────────────────────────────────────────
  function renderWarnings(container, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\u26A0\uFE0F Standard Warning / Advisory Labels</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.style.overflowX = "auto";
    var table = document.createElement("table");
    table.innerHTML = '<thead><tr><th style="width:40px">#</th><th>English</th><th>Maltese (Malti)</th></tr></thead>';
    var tbody = document.createElement("tbody");
    WARNINGS.forEach(function (w, i) {
      var tr = document.createElement("tr");
      tr.innerHTML = '<td style="color:var(--mut);text-align:center">' + (i + 1) + '</td><td><strong>' + esc(w.en) + '</strong></td><td style="color:var(--mut);font-style:italic">' + esc(w.mt) + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    bd.appendChild(table);
    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── pharmacy settings ────────────────────────────────────────────────────
  function renderSettings(container, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83C\uDFE5 Pharmacy Details</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.innerHTML =
      '<p style="color:var(--mut);font-size:13px;margin-top:0;margin-bottom:16px">These details appear on printed labels. Pharmacy name is auto-filled from your location.</p>' +
      '<div class="fld"><label>Pharmacy Name</label><input type="text" id="lb-s-name" placeholder="Pharmacy name" value="' + esc(pharmacyDetails.name) + '"></div>' +
      '<div class="fld"><label>Address</label><input type="text" id="lb-s-addr" placeholder="Full address" value="' + esc(pharmacyDetails.address) + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div class="fld"><label>Phone</label><input type="text" id="lb-s-phone" placeholder="+356\u2026" value="' + esc(pharmacyDetails.phone) + '"></div>' +
        '<div class="fld"><label>Licence Number</label><input type="text" id="lb-s-lic" placeholder="Licence #" value="' + esc(pharmacyDetails.licence) + '"></div>' +
      '</div>';
    var saveBtn = document.createElement("button");
    saveBtn.className = "btn pri";
    saveBtn.style.marginTop = "16px";
    saveBtn.innerHTML = "Save Pharmacy Details";
    saveBtn.addEventListener("click", function () {
      pharmacyDetails.name = document.getElementById("lb-s-name").value.trim();
      pharmacyDetails.address = document.getElementById("lb-s-addr").value.trim();
      pharmacyDetails.phone = document.getElementById("lb-s-phone").value.trim();
      pharmacyDetails.licence = document.getElementById("lb-s-lic").value.trim();
      save();
      toast("Pharmacy details saved", "good");
    });
    bd.appendChild(saveBtn);
    card.appendChild(bd);
    container.appendChild(card);
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
