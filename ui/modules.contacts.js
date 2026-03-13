/* ============================================================
   EIKON — Contacts Module  (modules.contacts.js)
   - Emergency & important numbers (static)
   - 24/7 Public health clinics (static)
   - Editable tables: Suppliers, Medical Reps, Head Office,
     Organisation Pharmacies, POYC
   - Import/Export CSV
   - Shared across organisation locations (with warnings)
   ============================================================ */
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  /* ---- helpers ---- */
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") n.className = String(v || "");
      else if (k === "text") n.textContent = String(v == null ? "" : v);
      else if (k === "html") n.innerHTML = String(v == null ? "" : v);
      else if (k === "style") n.setAttribute("style", String(v || ""));
      else if (k === "value") { n.value = String(v == null ? "" : v); }
      else if (k === "type") n.type = String(v || "");
      else if (k === "placeholder") n.placeholder = String(v || "");
      else if (k === "disabled") n.disabled = !!v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, String(v));
    });
    if (Array.isArray(kids)) {
      kids.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") n.appendChild(document.createTextNode(c));
        else n.appendChild(c);
      });
    }
    return n;
  }

  /* ---- toast ---- */
  var _toastWrap = null;
  function toast(title, message, kind, ms) {
    if (!_toastWrap) {
      _toastWrap = document.getElementById("eikon-toast-wrap");
      if (!_toastWrap) {
        _toastWrap = el("div", { id: "eikon-toast-wrap", style: "position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));" });
        document.body.appendChild(_toastWrap);
      }
    }
    var t = el("div", { style: "border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);" });
    if (kind === "good") t.style.borderColor = "rgba(67,209,122,.35)";
    else if (kind === "bad") t.style.borderColor = "rgba(255,90,122,.35)";
    else if (kind === "warn") t.style.borderColor = "rgba(255,200,90,.35)";
    t.innerHTML = '<div style="font-weight:900;margin:0 0 4px 0;font-size:13px;">' + esc(title) + '</div><div style="margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;">' + esc(message) + '</div>';
    _toastWrap.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, ms || 3500);
  }

  /* ---- confirm modal ---- */
  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function (resolve) {
      E.modal.show(
        title || "Confirm",
        '<div class="eikon-help" style="white-space:pre-wrap;">' + esc(bodyText || "") + "</div>",
        [
          { label: cancelLabel || "Cancel", onClick: function () { E.modal.hide(); resolve(false); } },
          { label: okLabel || "OK", primary: true, onClick: function () { E.modal.hide(); resolve(true); } }
        ]
      );
    });
  }

  /* ---- shared-data warning ---- */
  var SHARED_WARNING = "This information is shared across all locations in your organisation.\nChanges will affect every location.";

  async function confirmShared(action) {
    return modalConfirm(
      "Shared Data",
      SHARED_WARNING + "\n\nAre you sure you want to " + action + "?",
      "Yes, proceed",
      "Cancel"
    );
  }

  /* ============================================================
     API helpers
     ============================================================ */
  async function apiList(table) {
    var resp = await E.apiFetch("/contacts/" + table, { method: "GET" });
    return (resp && resp.rows) ? resp.rows : [];
  }

  async function apiSave(table, row) {
    return E.apiFetch("/contacts/" + table, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    });
  }

  async function apiDelete(table, id) {
    return E.apiFetch("/contacts/" + table + "/" + id, { method: "DELETE" });
  }

  async function apiBulk(table, rows) {
    return E.apiFetch("/contacts/" + table + "/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rows })
    });
  }

  /* ============================================================
     CSV helpers
     ============================================================ */
  function escapeCsvField(val) {
    var s = String(val == null ? "" : val);
    if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function rowsToCsv(headers, rows, fields) {
    var lines = [headers.map(escapeCsvField).join(",")];
    rows.forEach(function (r) {
      lines.push(fields.map(function (f) { return escapeCsvField(r[f] || ""); }).join(","));
    });
    return lines.join("\n");
  }

  function csvToRows(text, fields) {
    var lines = String(text || "").split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) return [];
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
      var vals = parseCsvLine(lines[i]);
      if (vals.length === 0) continue;
      var row = {};
      fields.forEach(function (f, idx) {
        row[f] = (vals[idx] || "").trim();
      });
      rows.push(row);
    }
    return rows;
  }

  function parseCsvLine(line) {
    var result = [];
    var current = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  /* ============================================================
     Module-scoped CSS (injected once)
     ============================================================ */
  var cssInjected = false;
  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    var st = document.createElement("style");
    st.textContent = [
      /* layout */
      ".ct-section{margin-bottom:28px;}",
      ".ct-section-title{font-weight:900;font-size:15px;margin:0 0 12px 0;display:flex;align-items:center;gap:8px;}",
      ".ct-section-title .ct-icon{font-size:18px;}",

      /* emergency grid */
      ".ct-emerg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;}",
      ".ct-emerg-card{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;transition:border-color .15s;}",
      ".ct-emerg-card:hover{border-color:var(--accent);}",
      ".ct-emerg-icon{font-size:22px;flex-shrink:0;width:36px;text-align:center;}",
      ".ct-emerg-info{flex:1;min-width:0;}",
      ".ct-emerg-name{font-weight:700;font-size:13px;margin-bottom:2px;}",
      ".ct-emerg-num{font-size:13px;color:var(--accent);font-weight:600;letter-spacing:.3px;}",
      ".ct-emerg-note{font-size:11px;color:var(--muted);margin-top:2px;}",

      /* clinic grid */
      ".ct-clinic-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;}",
      ".ct-clinic-card{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:14px;transition:border-color .15s;}",
      ".ct-clinic-card:hover{border-color:var(--ok);}",
      ".ct-clinic-name{font-weight:800;font-size:13px;margin-bottom:4px;}",
      ".ct-clinic-num{font-size:13px;color:var(--ok);font-weight:600;margin-bottom:3px;}",
      ".ct-clinic-note{font-size:11px;color:var(--muted);line-height:1.4;}",
      ".ct-badge-24{display:inline-block;background:rgba(67,209,122,.15);color:var(--ok);font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;margin-left:6px;vertical-align:middle;}",

      /* editable tables */
      ".ct-table-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;}",
      ".ct-table-actions{display:flex;gap:6px;flex-wrap:wrap;}",
      ".ct-btn{font-family:inherit;font-size:12px;font-weight:700;border:1px solid var(--border);background:rgba(255,255,255,.06);color:var(--text);border-radius:8px;padding:6px 12px;cursor:pointer;transition:all .15s;white-space:nowrap;}",
      ".ct-btn:hover{border-color:var(--accent);background:rgba(90,162,255,.10);}",
      ".ct-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);}",
      ".ct-btn.primary:hover{background:#4a92ef;}",
      ".ct-btn.danger{color:var(--danger);border-color:rgba(255,90,122,.3);}",
      ".ct-btn.danger:hover{background:rgba(255,90,122,.10);}",
      ".ct-btn .btn-ico{margin-right:4px;}",

      /* toggle section */
      ".ct-toggle-wrap{display:flex;align-items:center;gap:8px;margin-bottom:10px;}",
      ".ct-toggle-label{font-size:12px;color:var(--muted);cursor:pointer;user-select:none;}",

      /* shared badge */
      ".ct-shared-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(255,200,90,.12);color:#ffca5a;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;}",

      /* search bar */
      ".ct-search-wrap{position:relative;display:inline-flex;align-items:center;margin-bottom:8px;}",
      ".ct-search{width:100%;max-width:320px;background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12px;padding:7px 10px 7px 32px;outline:none;transition:border-color .15s;}",
      ".ct-search:focus{border-color:var(--accent);}",
      ".ct-search-ico{position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;opacity:.4;pointer-events:none;}",
      ".ct-match-count{font-size:11px;color:var(--muted);margin-left:10px;white-space:nowrap;}",

      /* specialty filter dropdown */
      ".ct-filter-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}",
      ".ct-specialty-select{background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:12px;padding:7px 10px;outline:none;transition:border-color .15s;max-width:360px;cursor:pointer;}",
      ".ct-specialty-select:focus{border-color:var(--accent);}",
      ".ct-specialty-select option{background:var(--panel);color:var(--text);}",

      /* scrollable table body */
      ".ct-scroll-wrap{border:1px solid var(--border);border-radius:10px;overflow:hidden;}",
      ".ct-scroll-wrap table.eikon-table{margin:0;border:none;}",
      ".ct-scroll-wrap thead{position:sticky;top:0;z-index:1;}",
      ".ct-scroll-wrap thead th{background:var(--panel2);border-bottom:1px solid var(--border);}",
      ".ct-scroll-body{max-height:calc(5 * 42px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent;}",
      ".ct-scroll-body::-webkit-scrollbar{width:6px;}",
      ".ct-scroll-body::-webkit-scrollbar-track{background:transparent;}",
      ".ct-scroll-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}",

      /* empty state */
      ".ct-empty{text-align:center;padding:28px 14px;color:var(--muted);font-size:13px;}",

      /* import modal */
      ".ct-import-area{width:100%;min-height:120px;background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:monospace;font-size:12px;padding:10px;resize:vertical;}",
      ".ct-import-hint{font-size:11px;color:var(--muted);margin-top:6px;line-height:1.4;}"
    ].join("\n");
    document.head.appendChild(st);
  }

  /* ============================================================
     STATIC DATA
     ============================================================ */
  var EMERGENCY_NUMBERS = [
    { icon: "🚨", name: "All Emergencies", number: "112", note: "Police, Ambulance, Fire" },
    { icon: "🚑", name: "Ambulance", number: "196", note: "" },
    { icon: "👮", name: "Police (General HQ)", number: "2122 4001", note: "Lines 2122 4001 – 4007" },
    { icon: "🔥", name: "Civil Protection (CPD)", number: "2393 0000", note: "Fire & rescue" },
    { icon: "📞", name: "Urgent Non-Emergency Care", number: "1400", note: "Helpline" },
    { icon: "🏥", name: "Mater Dei Hospital", number: "2545 0000", note: "Malta" },
    { icon: "🏥", name: "Gozo General Hospital", number: "2156 1600", note: "Gozo" },
  ];

  var HEALTH_CLINICS_24H = [
    {
      name: "Floriana Health Centre",
      number: "2124 3314",
      note: "Frangisk Saver Fenech Road, Floriana. Covers: Cospicua, Vittoriosa, Senglea, Kalkara."
    },
    {
      name: "Mosta Health Centre",
      number: "2143 3256 / 2143 2062",
      note: "Rotunda Square, Mosta. Covers: Rabat, Mdina, Dingli, Attard, Bidnija, Kuncizzjoni."
    },
    {
      name: "Paola Health Centre",
      number: "2169 1314 / 2169 1315",
      note: "Antoine De Paule Square, Paola. Covers: Paola, Tarxien, Santa Lucia, Birzebbuga, Zejtun, Marsaxlokk, Zabbar, Marsascala, Xghajra, Fgura, Gudja, Ghaxaq."
    },
    {
      name: "Primary HealthCare Call Centre",
      number: "2123 1231",
      note: "Appointments & information for all health centres."
    }
  ];

  /* ============================================================
     TABLE DEFINITIONS
     ============================================================ */
  var TABLE_DEFS = {
    suppliers: {
      title: "Supplier Contacts",
      icon: "📦",
      apiTable: "suppliers",
      columns: [
        { key: "name", label: "Supplier Name", placeholder: "e.g. PharmaSupply Ltd" },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 2123 4567" },
        { key: "email", label: "Email", placeholder: "e.g. [email protected]" }
      ],
      hideable: false
    },
    medreps: {
      title: "Medical Representative Contacts",
      icon: "👔",
      apiTable: "medreps",
      columns: [
        { key: "name", label: "Representative Name", placeholder: "e.g. John Smith" },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 7912 3456" },
        { key: "email", label: "Email", placeholder: "e.g. [email protected]" }
      ],
      hideable: false
    },
    headoffice: {
      title: "Company Head Office Numbers",
      icon: "🏢",
      apiTable: "headoffice",
      columns: [
        { key: "name", label: "Office / Department", placeholder: "e.g. Head Office" },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 2123 4567" }
      ],
      hideable: true,
      hideKey: "contacts_hide_headoffice",
      hideLabel: "Hide this section"
    },
    orgpharmacies: {
      title: "Organisation Pharmacies",
      icon: "💊",
      apiTable: "orgpharmacies",
      columns: [
        { key: "name", label: "Pharmacy Name", placeholder: "e.g. Branch - Valletta" },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 2123 4567" }
      ],
      hideable: true,
      hideKey: "contacts_hide_orgpharmacies",
      hideLabel: "Hide this section"
    },
    poyc: {
      title: "POYC Contacts",
      icon: "🏛️",
      apiTable: "poyc",
      columns: [
        { key: "name", label: "Contact Person / Office", placeholder: "e.g. Collections Dept" },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 2344 5678" }
      ],
      hideable: false
    },
    locums: {
      title: "Locum Contacts",
      icon: "🧑‍⚕️",
      apiTable: "locums",
      columns: [
        { key: "name", label: "Locum Name", placeholder: "e.g. Jane Doe" },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 7912 3456" }
      ],
      hideable: false
    },
    doctors: {
      title: "Doctor Contacts",
      icon: "🩺",
      apiTable: "doctors",
      columns: [
        { key: "name", label: "Doctor Name", placeholder: "e.g. Dr. John Borg" },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 2123 4567" }
      ],
      hideable: false
    },
    specialists: {
      title: "Specialist Contacts",
      icon: "🔬",
      apiTable: "specialists",
      columns: [
        { key: "name", label: "Specialist Name", placeholder: "e.g. Dr. Maria Vella" },
        { key: "specialty", label: "Specialty", placeholder: "e.g. Cardiology", isSpecialty: true },
        { key: "phone", label: "Phone Number", placeholder: "e.g. 2123 4567" }
      ],
      hideable: false,
      hasSpecialtyFilter: true
    }
  };

  /* ============================================================
     SPECIALTY LIST — short (abbreviation) + long (full name)
     ============================================================ */
  var SPECIALTIES = [
    { short: "Allergy & Immunology", long: "Allergy and Immunology" },
    { short: "Anaesthesiology", long: "Anaesthesiology" },
    { short: "Andrology", long: "Andrology (Male Reproductive Medicine)" },
    { short: "Cardiology", long: "Cardiology (Heart & Cardiovascular)" },
    { short: "Cardiac Surgery", long: "Cardiac Surgery (Heart Surgery)" },
    { short: "Clinical Genetics", long: "Clinical Genetics (Medical Genetics)" },
    { short: "Clinical Pharmacology", long: "Clinical Pharmacology" },
    { short: "Colorectal Surgery", long: "Colorectal Surgery" },
    { short: "Dentistry", long: "Dentistry (General Dental Practice)" },
    { short: "Dermatology", long: "Dermatology (Skin)" },
    { short: "Diabetology", long: "Diabetology (Diabetes & Metabolism)" },
    { short: "Emergency Medicine", long: "Emergency Medicine (A&E)" },
    { short: "Endocrinology", long: "Endocrinology (Hormones & Glands)" },
    { short: "ENT", long: "ENT (Ears, Nose and Throat / Otorhinolaryngology)" },
    { short: "Forensic Medicine", long: "Forensic Medicine (Legal Medicine)" },
    { short: "Gastroenterology", long: "Gastroenterology (Digestive System)" },
    { short: "General Practice", long: "General Practice (Family Medicine / GP)" },
    { short: "General Surgery", long: "General Surgery" },
    { short: "Geriatrics", long: "Geriatrics (Elderly Care Medicine)" },
    { short: "Gynaecology", long: "Gynaecology (Women's Reproductive Health)" },
    { short: "Haematology", long: "Haematology (Blood Disorders)" },
    { short: "Hand Surgery", long: "Hand Surgery" },
    { short: "Hepatology", long: "Hepatology (Liver)" },
    { short: "Infectious Disease", long: "Infectious Disease" },
    { short: "Internal Medicine", long: "Internal Medicine (General Medicine)" },
    { short: "Intensive Care", long: "Intensive Care Medicine (ICU / Critical Care)" },
    { short: "Maxillofacial Surgery", long: "Oral and Maxillofacial Surgery" },
    { short: "Microbiology", long: "Microbiology (Medical Microbiology)" },
    { short: "Neonatology", long: "Neonatology (Newborn Medicine)" },
    { short: "Nephrology", long: "Nephrology (Kidneys)" },
    { short: "Neurology", long: "Neurology (Brain & Nervous System)" },
    { short: "Neurosurgery", long: "Neurosurgery (Brain & Spine Surgery)" },
    { short: "Nuclear Medicine", long: "Nuclear Medicine" },
    { short: "Obstetrics", long: "Obstetrics (Pregnancy & Childbirth)" },
    { short: "Obs & Gynae", long: "Obstetrics and Gynaecology (O&G)" },
    { short: "Occupational Medicine", long: "Occupational Medicine (Workplace Health)" },
    { short: "Oncology", long: "Oncology (Cancer)" },
    { short: "Ophthalmology", long: "Ophthalmology (Eyes)" },
    { short: "Oral Surgery", long: "Oral Surgery" },
    { short: "Orthodontics", long: "Orthodontics (Teeth Alignment)" },
    { short: "Orthopaedics", long: "Orthopaedics (Bones, Joints & Muscles)" },
    { short: "Paediatrics", long: "Paediatrics (Children's Medicine)" },
    { short: "Paediatric Surgery", long: "Paediatric Surgery" },
    { short: "Pain Medicine", long: "Pain Medicine (Pain Management)" },
    { short: "Palliative Care", long: "Palliative Care (End-of-Life Care)" },
    { short: "Pathology", long: "Pathology (Laboratory Medicine)" },
    { short: "Plastic Surgery", long: "Plastic & Reconstructive Surgery" },
    { short: "Podiatry", long: "Podiatry (Foot & Ankle)" },
    { short: "Psychiatry", long: "Psychiatry (Mental Health)" },
    { short: "Public Health", long: "Public Health Medicine" },
    { short: "Pulmonology", long: "Pulmonology (Lungs & Respiratory)" },
    { short: "Radiology", long: "Radiology (Diagnostic Imaging)" },
    { short: "Radiotherapy", long: "Radiotherapy (Radiation Oncology)" },
    { short: "Rehabilitation Medicine", long: "Rehabilitation Medicine (Physiatry)" },
    { short: "Renal Medicine", long: "Renal Medicine (Kidney Care)" },
    { short: "Rheumatology", long: "Rheumatology (Joints & Autoimmune)" },
    { short: "Sexual Health", long: "Sexual Health (Genitourinary Medicine / GUM)" },
    { short: "Sleep Medicine", long: "Sleep Medicine" },
    { short: "Spinal Surgery", long: "Spinal Surgery" },
    { short: "Sports Medicine", long: "Sports Medicine (Exercise Medicine)" },
    { short: "Thoracic Surgery", long: "Thoracic Surgery (Chest Surgery)" },
    { short: "Transplant Surgery", long: "Transplant Surgery" },
    { short: "Trauma Surgery", long: "Trauma Surgery" },
    { short: "Urology", long: "Urology (Urinary Tract & Male Reproductive)" },
    { short: "Vascular Surgery", long: "Vascular Surgery (Blood Vessels)" }
  ];

  /* ============================================================
     RENDER
     ============================================================ */
  async function render(_ref) {
    var mount = _ref.mount;
    var user = _ref.user;

    injectCSS();

    mount.innerHTML = "";

    /* ---- page wrapper ---- */
    var page = el("div", { style: "max-width:1100px;margin:0 auto;" });
    mount.appendChild(page);

    /* ---- shared info banner ---- */
    var banner = el("div", {
      class: "eikon-alert",
      style: "background:rgba(255,200,90,.08);border:1px solid rgba(255,200,90,.22);border-radius:12px;padding:10px 14px;margin-bottom:22px;display:flex;align-items:center;gap:10px;font-size:12px;color:#ffca5a;"
    });
    banner.innerHTML =
      '<span style="font-size:18px;">⚠️</span>' +
      '<span><strong>Shared Data</strong> — Editable contact tables below are shared across all locations in your organisation. Any changes you make will be visible to all locations.</span>';
    page.appendChild(banner);

    /* ========================================
       SECTION 1 — Emergency Numbers
       ======================================== */
    var sec1 = el("div", { class: "ct-section" });
    sec1.innerHTML = '<div class="ct-section-title"><span class="ct-icon">🚨</span> Emergency &amp; Important Numbers</div>';
    var grid1 = el("div", { class: "ct-emerg-grid" });
    EMERGENCY_NUMBERS.forEach(function (item) {
      var card = el("div", { class: "ct-emerg-card" });
      card.innerHTML =
        '<div class="ct-emerg-icon">' + item.icon + '</div>' +
        '<div class="ct-emerg-info">' +
        '  <div class="ct-emerg-name">' + esc(item.name) + '</div>' +
        '  <div class="ct-emerg-num">' + esc(item.number) + '</div>' +
        (item.note ? '  <div class="ct-emerg-note">' + esc(item.note) + '</div>' : '') +
        '</div>';
      grid1.appendChild(card);
    });
    sec1.appendChild(grid1);
    page.appendChild(sec1);

    /* ========================================
       SECTION 2 — 24/7 Health Clinics
       ======================================== */
    var sec2 = el("div", { class: "ct-section" });
    sec2.innerHTML = '<div class="ct-section-title"><span class="ct-icon">🏥</span> 24/7 Public Health Clinics</div>';
    var grid2 = el("div", { class: "ct-clinic-grid" });
    HEALTH_CLINICS_24H.forEach(function (clinic) {
      var card = el("div", { class: "ct-clinic-card" });
      card.innerHTML =
        '<div class="ct-clinic-name">' + esc(clinic.name) + ' <span class="ct-badge-24">24/7</span></div>' +
        '<div class="ct-clinic-num">' + esc(clinic.number) + '</div>' +
        '<div class="ct-clinic-note">' + esc(clinic.note) + '</div>';
      grid2.appendChild(card);
    });
    sec2.appendChild(grid2);
    page.appendChild(sec2);

    /* ========================================
       SECTION 3–7 — Editable tables
       ======================================== */
    var tableOrder = ["suppliers", "medreps", "doctors", "specialists", "locums", "headoffice", "orgpharmacies", "poyc"];

    tableOrder.forEach(function (tableKey) {
      var def = TABLE_DEFS[tableKey];
      renderEditableSection(page, def, user);
    });
  }

  /* ============================================================
     EDITABLE SECTION builder
     ============================================================ */
  function renderEditableSection(parent, def, user) {
    var sec = el("div", { class: "ct-section", "data-table": def.apiTable });

    /* ---- hidden state (from localStorage) ---- */
    var isHidden = false;
    if (def.hideable) {
      try { isHidden = localStorage.getItem(def.hideKey) === "1"; } catch (e) {}
    }

    /* ---- section title row ---- */
    var titleRow = el("div", { class: "ct-table-header" });
    var titleLeft = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;" });
    titleLeft.innerHTML =
      '<div class="ct-section-title" style="margin:0;"><span class="ct-icon">' + def.icon + '</span> ' + esc(def.title) + '</div>' +
      '<span class="ct-shared-badge">⚠ Shared</span>';
    titleRow.appendChild(titleLeft);

    var actionsWrap = el("div", { class: "ct-table-actions" });
    titleRow.appendChild(actionsWrap);
    sec.appendChild(titleRow);

    /* ---- hide toggle ---- */
    if (def.hideable) {
      var toggleWrap = el("div", { class: "ct-toggle-wrap" });
      var chk = el("input", { type: "checkbox", checked: isHidden, id: "chk-" + def.apiTable });
      var lbl = el("label", { class: "ct-toggle-label", for: "chk-" + def.apiTable, text: def.hideLabel });
      toggleWrap.appendChild(chk);
      toggleWrap.appendChild(lbl);
      sec.appendChild(toggleWrap);
    }

    /* ---- search bar ---- */
    var searchWrap = el("div", { class: "ct-search-wrap" });
    searchWrap.innerHTML = '<svg class="ct-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';
    var searchInput = el("input", { class: "ct-search", type: "text", placeholder: "Search " + def.title.toLowerCase() + "…" });
    var matchCount = el("span", { class: "ct-match-count" });
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(matchCount);
    sec.appendChild(searchWrap);

    /* ---- specialty filter (only for specialists table) ---- */
    var specialtyFilter = "";
    var specialtySelect = null;
    if (def.hasSpecialtyFilter) {
      var filterRow = el("div", { class: "ct-filter-row" });
      specialtySelect = el("select", { class: "ct-specialty-select" });
      specialtySelect.appendChild(el("option", { value: "", text: "All Specialties" }));
      SPECIALTIES.forEach(function (sp) {
        specialtySelect.appendChild(el("option", { value: sp.short, text: sp.short + " — " + sp.long }));
      });
      filterRow.appendChild(specialtySelect);
      sec.appendChild(filterRow);
    }

    /* ---- table container ---- */
    var tableContainer = el("div");
    sec.appendChild(tableContainer);
    parent.appendChild(sec);

    /* ---- state ---- */
    var rows = [];
    var loading = true;
    var searchQuery = "";

    /* ---- hide toggle handler ---- */
    if (def.hideable) {
      var checkbox = sec.querySelector("#chk-" + def.apiTable);
      checkbox.addEventListener("change", function () {
        isHidden = checkbox.checked;
        try { localStorage.setItem(def.hideKey, isHidden ? "1" : "0"); } catch (e) {}
        renderTable();
      });
    }

    /* ---- search handler ---- */
    var searchTimer = null;
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        searchQuery = (searchInput.value || "").trim().toLowerCase();
        renderTable();
      }, 120);
    });

    /* ---- specialty filter handler ---- */
    if (specialtySelect) {
      specialtySelect.addEventListener("change", function () {
        specialtyFilter = specialtySelect.value;
        renderTable();
      });
    }

    /* ---- action buttons ---- */
    var btnAdd = el("button", { class: "ct-btn primary" });
    btnAdd.innerHTML = '<span class="btn-ico">+</span> Add';
    btnAdd.addEventListener("click", function () { showAddModal(); });

    var btnImport = el("button", { class: "ct-btn" });
    btnImport.innerHTML = '<span class="btn-ico">📥</span> Import';
    btnImport.addEventListener("click", function () { showImportModal(); });

    var btnExport = el("button", { class: "ct-btn" });
    btnExport.innerHTML = '<span class="btn-ico">📤</span> Export';
    btnExport.addEventListener("click", function () { doExport(); });

    actionsWrap.appendChild(btnAdd);
    actionsWrap.appendChild(btnImport);
    actionsWrap.appendChild(btnExport);

    /* ---- render table ---- */
    function renderTable() {
      tableContainer.innerHTML = "";

      if (def.hideable && isHidden) {
        searchWrap.style.display = "none";
        if (specialtySelect) specialtySelect.parentNode.style.display = "none";
        tableContainer.innerHTML = '<div class="ct-empty" style="opacity:.5;">Section hidden. Uncheck to show.</div>';
        return;
      }
      searchWrap.style.display = "";
      if (specialtySelect) specialtySelect.parentNode.style.display = "";

      if (loading) {
        matchCount.textContent = "";
        tableContainer.innerHTML = '<div class="ct-empty">Loading…</div>';
        return;
      }

      if (rows.length === 0) {
        matchCount.textContent = "";
        tableContainer.innerHTML = '<div class="ct-empty">No contacts yet. Click <strong>+ Add</strong> to get started.</div>';
        return;
      }

      /* filter rows */
      var filtered = rows;
      if (specialtyFilter) {
        filtered = filtered.filter(function (row) {
          return String(row.specialty || "").toLowerCase() === specialtyFilter.toLowerCase();
        });
      }
      if (searchQuery) {
        filtered = filtered.filter(function (row) {
          return def.columns.some(function (col) {
            return String(row[col.key] || "").toLowerCase().indexOf(searchQuery) !== -1;
          });
        });
      }
      matchCount.textContent = (searchQuery || specialtyFilter) ? (filtered.length + " of " + rows.length) : (rows.length + " total");

      if (filtered.length === 0) {
        var noMsg = "No matches";
        if (searchQuery) noMsg += ' for "' + esc(searchQuery) + '"';
        if (specialtyFilter) noMsg += (searchQuery ? " in " : " for ") + esc(specialtyFilter);
        tableContainer.innerHTML = '<div class="ct-empty">' + noMsg + '.</div>';
        return;
      }

      /* outer scroll wrapper */
      var scrollWrap = el("div", { class: "ct-scroll-wrap" });

      /* header table (sticky) */
      var headTbl = el("table", { class: "eikon-table", style: "margin:0;border:none;" });
      var thead = el("thead");
      var headTr = el("tr");
      headTr.appendChild(el("th", { text: "#", style: "width:40px;text-align:center;" }));
      def.columns.forEach(function (col) {
        headTr.appendChild(el("th", { text: col.label }));
      });
      headTr.appendChild(el("th", { text: "Actions", style: "width:100px;text-align:center;" }));
      thead.appendChild(headTr);
      headTbl.appendChild(thead);
      scrollWrap.appendChild(headTbl);

      /* scrollable body */
      var scrollBody = el("div", { class: "ct-scroll-body" });
      var bodyTbl = el("table", { class: "eikon-table", style: "margin:0;border:none;" });
      var tbody = el("tbody");

      filtered.forEach(function (row, fIdx) {
        var realIdx = rows.indexOf(row);
        var tr = el("tr");
        tr.appendChild(el("td", { text: String(realIdx + 1), style: "text-align:center;color:var(--muted);font-size:12px;width:40px;" }));
        def.columns.forEach(function (col) {
          var td = el("td");
          if (col.key === "email" && row[col.key]) {
            td.innerHTML = '<a href="mailto:' + esc(row[col.key]) + '" style="color:var(--accent);text-decoration:none;">' + esc(row[col.key]) + '</a>';
          } else if (col.key === "phone" && row[col.key]) {
            td.innerHTML = '<span style="font-weight:600;letter-spacing:.3px;">' + esc(row[col.key]) + '</span>';
          } else if (col.isSpecialty && row[col.key]) {
            td.innerHTML = '<span style="display:inline-block;background:rgba(90,162,255,.12);color:var(--accent);font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;">' + esc(row[col.key]) + '</span>';
          } else {
            td.textContent = row[col.key] || "";
          }
          tr.appendChild(td);
        });

        /* action btns */
        var actTd = el("td", { style: "text-align:center;white-space:nowrap;width:100px;" });
        var editBtn = el("button", { class: "ct-btn", style: "padding:4px 8px;font-size:11px;", text: "Edit" });
        var delBtn = el("button", { class: "ct-btn danger", style: "padding:4px 8px;font-size:11px;margin-left:4px;", text: "Del" });

        (function (r, ri) {
          editBtn.addEventListener("click", function () { showEditModal(r, ri); });
          delBtn.addEventListener("click", function () { doDelete(r, ri); });
        })(row, realIdx);

        actTd.appendChild(editBtn);
        actTd.appendChild(delBtn);
        tr.appendChild(actTd);
        tbody.appendChild(tr);
      });
      bodyTbl.appendChild(tbody);
      scrollBody.appendChild(bodyTbl);
      scrollWrap.appendChild(scrollBody);
      tableContainer.appendChild(scrollWrap);
    }

    /* ---- build field HTML for modals ---- */
    function buildFieldHtml(col, idPrefix, value) {
      var html = '<div class="eikon-field" style="margin-bottom:10px;">' +
        '<label class="eikon-label">' + esc(col.label) + '</label>';
      if (col.isSpecialty) {
        html += '<select class="eikon-input" id="' + idPrefix + col.key + '" style="cursor:pointer;">';
        html += '<option value="">— Select specialty —</option>';
        SPECIALTIES.forEach(function (sp) {
          var sel = (value && value === sp.short) ? ' selected' : '';
          html += '<option value="' + esc(sp.short) + '"' + sel + '>' + esc(sp.short) + ' — ' + esc(sp.long) + '</option>';
        });
        html += '</select>';
      } else {
        html += '<input class="eikon-input" id="' + idPrefix + col.key + '" value="' + esc(value || "") + '" placeholder="' + esc(col.placeholder || "") + '" />';
      }
      html += '</div>';
      return html;
    }

    /* ---- Add modal ---- */
    function showAddModal() {
      var fields = def.columns.map(function (col) {
        return buildFieldHtml(col, "ct-add-", "");
      }).join("");

      E.modal.show(
        "Add " + def.title.replace(" Contacts", "").replace(" Numbers", ""),
        '<div style="max-width:400px;">' + fields + '</div>',
        [
          { label: "Cancel", onClick: function () { E.modal.hide(); } },
          { label: "Save", primary: true, onClick: async function () {
            var newRow = {};
            var hasValue = false;
            def.columns.forEach(function (col) {
              var inp = document.getElementById("ct-add-" + col.key);
              newRow[col.key] = inp ? inp.value.trim() : "";
              if (newRow[col.key]) hasValue = true;
            });
            if (!hasValue) { toast("Validation", "Please fill in at least one field.", "warn"); return; }

            var ok = await confirmShared("add this entry");
            if (!ok) return;

            E.modal.hide();
            try {
              var resp = await apiSave(def.apiTable, newRow);
              if (resp && resp.id) newRow.id = resp.id;
              else newRow.id = "tmp-" + Date.now();
              rows.push(newRow);
              renderTable();
              toast("Saved", "Contact added.", "good");
            } catch (err) {
              toast("Error", String(err && (err.message || err)), "bad");
            }
          }}
        ]
      );
    }

    /* ---- Edit modal ---- */
    function showEditModal(row, idx) {
      var fields = def.columns.map(function (col) {
        return buildFieldHtml(col, "ct-edit-", row[col.key] || "");
      }).join("");

      E.modal.show(
        "Edit Contact",
        '<div style="max-width:400px;">' + fields + '</div>',
        [
          { label: "Cancel", onClick: function () { E.modal.hide(); } },
          { label: "Save", primary: true, onClick: async function () {
            var ok = await confirmShared("edit this entry");
            if (!ok) return;

            def.columns.forEach(function (col) {
              var inp = document.getElementById("ct-edit-" + col.key);
              if (inp) row[col.key] = inp.value.trim();
            });

            E.modal.hide();
            try {
              await apiSave(def.apiTable, row);
              renderTable();
              toast("Saved", "Contact updated.", "good");
            } catch (err) {
              toast("Error", String(err && (err.message || err)), "bad");
            }
          }}
        ]
      );
    }

    /* ---- Delete ---- */
    async function doDelete(row, idx) {
      var ok = await confirmShared("delete this entry");
      if (!ok) return;
      try {
        if (row.id && String(row.id).indexOf("tmp-") !== 0) {
          await apiDelete(def.apiTable, row.id);
        }
        rows.splice(idx, 1);
        renderTable();
        toast("Deleted", "Contact removed.", "good");
      } catch (err) {
        toast("Error", String(err && (err.message || err)), "bad");
      }
    }

    /* ---- Export ---- */
    function doExport() {
      if (rows.length === 0) {
        toast("Export", "No data to export.", "warn");
        return;
      }
      var headers = def.columns.map(function (c) { return c.label; });
      var fields = def.columns.map(function (c) { return c.key; });
      var csv = rowsToCsv(headers, rows, fields);

      E.modal.show(
        "Export — " + def.title,
        '<div>' +
        '<div class="eikon-help" style="margin-bottom:8px;">Copy the CSV text below:</div>' +
        '<textarea class="ct-import-area" id="ct-export-area" readonly>' + esc(csv) + '</textarea>' +
        '</div>',
        [
          { label: "Close", onClick: function () { E.modal.hide(); } },
          { label: "Copy to clipboard", primary: true, onClick: function () {
            var area = document.getElementById("ct-export-area");
            if (area) {
              area.select();
              try { navigator.clipboard.writeText(area.value); } catch (e) { document.execCommand("copy"); }
            }
            toast("Copied", "CSV copied to clipboard.", "good");
          }}
        ]
      );
      /* auto-select */
      setTimeout(function () {
        var area = document.getElementById("ct-export-area");
        if (area) area.select();
      }, 100);
    }

    /* ---- Import ---- */
    function showImportModal() {
      var headers = def.columns.map(function (c) { return c.label; });
      var hint = "Expected CSV format (first row = header):\n" + headers.join(", ");

      E.modal.show(
        "Import — " + def.title,
        '<div>' +
        '<div class="eikon-help" style="margin-bottom:8px;">Paste CSV text below. Existing entries will be kept — imported rows are appended.</div>' +
        '<textarea class="ct-import-area" id="ct-import-area" placeholder="Paste CSV here…"></textarea>' +
        '<div class="ct-import-hint">' + esc(hint) + '</div>' +
        '</div>',
        [
          { label: "Cancel", onClick: function () { E.modal.hide(); } },
          { label: "Import", primary: true, onClick: async function () {
            var area = document.getElementById("ct-import-area");
            var text = area ? area.value : "";
            var fields = def.columns.map(function (c) { return c.key; });
            var imported = csvToRows(text, fields);

            if (imported.length === 0) {
              toast("Import", "No valid rows found. Check your CSV format.", "warn");
              return;
            }

            var ok = await confirmShared("import " + imported.length + " row(s)");
            if (!ok) return;

            E.modal.hide();
            try {
              var resp = await apiBulk(def.apiTable, imported);
              /* assign IDs if returned */
              if (resp && resp.ids && Array.isArray(resp.ids)) {
                imported.forEach(function (r, i) { r.id = resp.ids[i] || ("tmp-" + Date.now() + "-" + i); });
              } else {
                imported.forEach(function (r, i) { r.id = "tmp-" + Date.now() + "-" + i; });
              }
              rows = rows.concat(imported);
              renderTable();
              toast("Imported", imported.length + " row(s) imported.", "good");
            } catch (err) {
              toast("Error", String(err && (err.message || err)), "bad");
            }
          }}
        ]
      );
    }

    /* ---- initial load ---- */
    apiList(def.apiTable).then(function (data) {
      rows = Array.isArray(data) ? data : [];
      loading = false;
      renderTable();
    }).catch(function (err) {
      loading = false;
      rows = [];
      renderTable();
      E.warn("[contacts] failed to load " + def.apiTable + ":", err);
    });

    renderTable();
  }

  /* ============================================================
     REGISTER
     ============================================================ */
  E.registerModule({
    id: "contacts",
    title: "Contacts",
    icon: "📇",
    order: 2,
    render: render
  });

})();
