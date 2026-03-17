/* ui/modules.screening.js
   Eikon – Clinical Screening Campaigns module

   Plan and run health screening events and campaigns
   (e.g. Diabetes Awareness Week, Blood Pressure Month, Cholesterol Check Day).

   Endpoints:
     GET  /screening/state
     PUT  /screening/state
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ── POCT integration (shared patient data) ──────────────────────────────
  // Reuse POCT's cloud patient store instead of a separate client table
  function getPoctCloud() {
    return window.__POCT_CLOUD || { records: [], patients: [], loaded: false };
  }

  function getPoctPatients() {
    var cloud = getPoctCloud();
    return Array.isArray(cloud.patients) ? cloud.patients : [];
  }

  // Maltese ID Card: 7 digits + 1 letter, zero-padded (matches POCT normalizePatientId)
  function normalizePatientId(raw) {
    var s = String(raw == null ? "" : raw).trim().toUpperCase().replace(/\s+/g, "");
    var m = s.match(/^(\d{1,7})([A-Z])$/);
    if (m) return m[1].padStart(7, "0") + m[2];
    return s;
  }

  function getPoctPatientById(pidNorm) {
    if (!pidNorm) return null;
    var pats = getPoctPatients();
    for (var i = 0; i < pats.length; i++) {
      if (pats[i] && pats[i].patientId === pidNorm) return pats[i];
    }
    return null;
  }

  // Search POCT patients by partial ID or name
  function searchPoctPatients(query) {
    var q = norm(query);
    if (!q) return [];
    var pats = getPoctPatients();
    var results = [];
    for (var i = 0; i < pats.length; i++) {
      var p = pats[i];
      if (!p) continue;
      if (norm(p.patientId).indexOf(q) !== -1 || norm(p.name).indexOf(q) !== -1) {
        results.push(p);
        if (results.length >= 10) break;
      }
    }
    return results;
  }

  // Push screening participant into POCT records + patient master
  function pushToPoctCloud(participant, campaign) {
    var cloud = getPoctCloud();
    if (!cloud.loaded) return; // POCT not loaded yet, skip

    // Upsert patient master
    var pid = normalizePatientId(participant.idCard || "");
    if (pid) {
      var pats = Array.isArray(cloud.patients) ? cloud.patients : [];
      var map = {};
      for (var i = 0; i < pats.length; i++) {
        if (pats[i] && pats[i].patientId) map[pats[i].patientId] = pats[i];
      }
      var nowIso = new Date().toISOString();
      var existing = map[pid];
      if (!existing) {
        map[pid] = {
          patientId: pid,
          name: (participant.name || "").trim(),
          phone: (participant.phone || "").trim(),
          age: participant.dob ? calculateAge(participant.dob) : null,
          address: "",
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
          lastSeenIso: participant.date || nowIso,
          conflicts: []
        };
      } else {
        if (!existing.name && participant.name) existing.name = participant.name.trim();
        if (!existing.phone && participant.phone) existing.phone = participant.phone.trim();
        existing.updatedAtIso = nowIso;
        existing.lastSeenIso = participant.date || nowIso;
        map[pid] = existing;
      }
      var out = [];
      for (var k in map) { if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]); }
      cloud.patients = out;
    }

    // Add a POCT record for this screening
    var recId = "sc_" + (participant.id || Date.now()) + "_" + Math.random().toString(36).slice(2, 6);
    var mappedType = campaignPoctType(campaign.type);
    var testTypeLabels = { bp: "Blood Pressure", hba1c: "HbA1c", bg: "Blood Glucose", chol: "Cholesterol", bmi: "Weight / BMI", urine: "Urine (Combur 9)" };
    var rec = {
      id: recId,
      testType: mappedType || campaign.type || "General Health Check",
      testLabel: mappedType ? (testTypeLabels[mappedType] || campaign.type) : campaign.type,
      performedAtIso: (participant.date || todayStr()) + "T00:00:00",
      performedAtLocal: (participant.date || todayStr()) + "T00:00",
      patient: {
        patientId: pid || "",
        name: (participant.name || "").trim(),
        phone: (participant.phone || "").trim(),
        age: participant.dob ? calculateAge(participant.dob) : null,
        address: ""
      },
      feeDue: 0,
      intervention: participant.referral || "",
      notes: "[Screening Campaign: " + (campaign.name || "") + "] " + (participant.resultNotes || ""),
      results: (participant.poctResults && mappedType) ? participant.poctResults : {},
      source: "screening",
      campaignId: campaign.id,
      campaignName: campaign.name,
      updatedAtIso: new Date().toISOString()
    };
    var recs = Array.isArray(cloud.records) ? cloud.records : [];
    // Avoid duplicates — check if we already have a record from this participant+campaign
    var dupIdx = -1;
    for (var j = 0; j < recs.length; j++) {
      if (recs[j] && recs[j].source === "screening" && recs[j].campaignId === campaign.id &&
          recs[j].patient && recs[j].patient.patientId === pid && pid) {
        dupIdx = j; break;
      }
    }
    if (dupIdx >= 0) {
      recs[dupIdx] = rec;
    } else {
      recs.push(rec);
    }
    cloud.records = recs;

    // Trigger POCT cloud save
    if (cloud.saveTimer) clearTimeout(cloud.saveTimer);
    cloud.saveTimer = setTimeout(function () {
      if (typeof window.POCT !== "undefined" && window.POCT.saveRecords) {
        // Use POCT's own save pipeline if available
        window.POCT.saveRecords(cloud.records);
      }
    }, 400);
  }

  function calculateAge(dobStr) {
    if (!dobStr) return null;
    var parts = dobStr.split("-");
    if (parts.length !== 3) return null;
    var birth = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var now = new Date();
    var age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    return age;
  }

  // Legacy compat: keep building cross-module patient memory
  if (!E._eikon_patients) E._eikon_patients = {};

  function buildPatientMemory() {
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        var name = (p.name || "").trim();
        if (name) E._eikon_patients[norm(name)] = name;
      });
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function uid() { return "sc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
  function todayStr() { var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function fmtDate(v) {
    if (!v) return "-";
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
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
      toastWrap.className = "sc-toast-wrap";
      document.body.appendChild(toastWrap);
    }
    var t = document.createElement("div");
    t.className = "sc-toast " + (kind || "good");
    t.innerHTML = '<span class="sc-toast-dot"></span>' + esc(msg);
    toastWrap.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 250);
    }, 2400);
  }

  // ── cloud store ──────────────────────────────────────────────────────────
  var campaigns = [];
  var dirty = false;
  var syncing = false;
  var currentUser = null;

  async function cloudLoad() {
    try {
      var r = await api("GET", "/screening/state");
      campaigns = Array.isArray(r.campaigns) ? r.campaigns : (r.state && Array.isArray(r.state.campaigns) ? r.state.campaigns : []);
      buildPatientMemory();
    } catch (e) { E.warn("[screening] cloudLoad error", e); }
  }

  async function cloudSave() {
    if (syncing) return;
    syncing = true;
    try { await api("PUT", "/screening/state", { state: { campaigns: campaigns } }); dirty = false; }
    catch (e) { E.warn("[screening] cloudSave error", e); }
    finally { syncing = false; }
  }

  function save() { dirty = true; cloudSave(); }

  // ── reference data ───────────────────────────────────────────────────────
  var CAMPAIGN_TYPES = [
    "Blood Pressure Check", "Diabetes Screening", "Cholesterol Check",
    "Blood Glucose Monitoring", "BMI Assessment", "Urine Screening",
    "Cardiovascular Risk", "Flu Vaccination", "Smoking Cessation",
    "General Health Check", "Other"
  ];

  var CAMPAIGN_TYPE_ICONS = {
    "Blood Pressure Check": "\uD83E\uDEC0", "Diabetes Screening": "\uD83E\uDE78",
    "Cholesterol Check": "\uD83E\uDDEA", "Blood Glucose Monitoring": "\uD83D\uDCC8",
    "BMI Assessment": "\u2696\uFE0F", "Urine Screening": "\uD83E\uDDEA",
    "Cardiovascular Risk": "\u2764\uFE0F",
    "Flu Vaccination": "\uD83D\uDC89",
    "Smoking Cessation": "\uD83D\uDEAD",
    "General Health Check": "\uD83E\uDE7A",
    "Other": "\uD83D\uDCCB"
  };

  // ── POCT ↔ Campaign type mapping ──────────────────────────────────────
  // Maps campaign types to POCT test type IDs; null = no POCT link
  var CAMPAIGN_POCT_MAP = {
    "Blood Pressure Check": "bp",
    "Diabetes Screening": "hba1c",
    "Cholesterol Check": "chol",
    "Blood Glucose Monitoring": "bg",
    "BMI Assessment": "bmi",
    "Urine Screening": "urine",
    // Non-POCT campaign types:
    "Cardiovascular Risk": null,
    "Flu Vaccination": null,
    "Smoking Cessation": null,
    "General Health Check": null,
    "Other": null
  };

  // POCT result field definitions per test type
  var POCT_FIELDS = {
    bp: {
      label: "Blood Pressure Results",
      fields: [
        { key: "sys", label: "Systolic (mmHg)", type: "number", placeholder: "e.g. 120", required: true },
        { key: "dia", label: "Diastolic (mmHg)", type: "number", placeholder: "e.g. 80", required: true },
        { key: "pulse", label: "Pulse (bpm)", type: "number", placeholder: "e.g. 72" },
        { key: "arm", label: "Arm", type: "select", options: ["Left", "Right"] },
        { key: "position", label: "Position", type: "select", options: ["Sitting", "Standing", "Lying"] }
      ]
    },
    hba1c: {
      label: "HbA1c Results",
      fields: [
        { key: "pct", label: "HbA1c (%)", type: "number", placeholder: "e.g. 5.7", required: true, step: "0.1" },
        { key: "mmol", label: "HbA1c (mmol/mol)", type: "number", placeholder: "e.g. 39" }
      ]
    },
    bg: {
      label: "Blood Glucose Results",
      fields: [
        { key: "glucose", label: "Glucose (mmol/L)", type: "number", placeholder: "e.g. 5.5", required: true, step: "0.1" },
        { key: "timing", label: "Timing", type: "select", options: ["Fasting", "Random", "Post-meal (1h)", "Post-meal (2h)"] }
      ]
    },
    chol: {
      label: "Cholesterol Results",
      fields: [
        { key: "tc", label: "Total Cholesterol", type: "number", placeholder: "mmol/L", step: "0.1" },
        { key: "hdl", label: "HDL", type: "number", placeholder: "mmol/L", step: "0.1" },
        { key: "ldl", label: "LDL", type: "number", placeholder: "mmol/L", step: "0.1" },
        { key: "tg", label: "Triglycerides", type: "number", placeholder: "mmol/L", step: "0.1" },
        { key: "ratio", label: "TC/HDL Ratio", type: "number", placeholder: "e.g. 4.2", step: "0.1" },
        { key: "fasting", label: "Fasting", type: "select", options: ["Yes", "No"] }
      ]
    },
    bmi: {
      label: "BMI / Weight Results",
      fields: [
        { key: "weight", label: "Weight (kg)", type: "number", placeholder: "e.g. 75", step: "0.1" },
        { key: "height", label: "Height (cm)", type: "number", placeholder: "e.g. 170", step: "0.1" },
        { key: "bmi", label: "BMI", type: "number", placeholder: "Auto-calculated", step: "0.1" },
        { key: "category", label: "Category", type: "select", options: ["Underweight", "Normal", "Overweight", "Obese I", "Obese II", "Obese III"] },
        { key: "waist", label: "Waist (cm)", type: "number", placeholder: "e.g. 85", step: "0.1" }
      ]
    },
    urine: {
      label: "Urine (Combur) Results",
      fields: [
        { key: "leu", label: "Leukocytes", type: "select", options: ["Negative", "Trace", "+", "++", "+++"] },
        { key: "nit", label: "Nitrite", type: "select", options: ["Negative", "Positive"] },
        { key: "uro", label: "Urobilinogen", type: "select", options: ["Normal", "1+", "2+", "3+", "4+"] },
        { key: "pro", label: "Protein", type: "select", options: ["Negative", "Trace", "+", "++", "+++"] },
        { key: "ph", label: "pH", type: "number", placeholder: "e.g. 6.0", step: "0.5" },
        { key: "bld", label: "Blood", type: "select", options: ["Negative", "Trace", "+", "++", "+++"] },
        { key: "ket", label: "Ketones", type: "select", options: ["Negative", "Trace", "+", "++", "+++"] },
        { key: "glu", label: "Glucose", type: "select", options: ["Negative", "Trace", "+", "++", "+++", "++++"] },
        { key: "appearance", label: "Appearance", type: "select", options: ["Clear", "Slightly cloudy", "Cloudy", "Turbid"] }
      ]
    }
  };

  // Helper: get POCT test type for a campaign type string (or null)
  function campaignPoctType(campType) {
    return CAMPAIGN_POCT_MAP.hasOwnProperty(campType) ? CAMPAIGN_POCT_MAP[campType] : null;
  }

  var REFERRAL_OPTIONS = [
    "No referral needed", "Referred to GP", "Referred to specialist",
    "Referred to hospital", "Referred to dietitian", "Referred to pharmacist follow-up",
    "Self-monitoring advised", "Other"
  ];

  var RESULT_CATEGORIES = ["Normal", "Borderline", "Abnormal", "Requires urgent attention"];

  var PARTICIPANT_TYPES = ["Pre-registered", "Walk-in"];

  var FOLLOW_UP_STATUS = ["Pending", "Scheduled", "Completed", "No-show", "Cancelled"];

  var CAMPAIGN_LOCATIONS = [
    "Pharmacy Floor", "Community Centre", "GP Surgery", "Hospital Outpatient",
    "Mobile Unit", "Workplace", "School/University", "Care Home",
    "Health Fair", "Online/Remote", "Other"
  ];

  // ── styles ───────────────────────────────────────────────────────────────
  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return; stylesDone = true;
    var s = document.createElement("style"); s.id = "eikon-screening-style";
    s.textContent = [
      /* root + ambient background */
      ".sc{--ac:#4ea1ff;--ac2:#7c6cff;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.035);--pnl2:rgba(255,255,255,.055);--bd:rgba(255,255,255,.09);--bd2:rgba(255,255,255,.14);--r:18px;--r2:12px;--txt:#e8eefc;--mut:rgba(170,183,214,.72);--shadow:0 12px 36px rgba(0,0,0,.35);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--txt);margin:-14px;min-height:calc(100vh - 56px);background:radial-gradient(1200px 600px at 10% 8%,rgba(78,161,255,.13),transparent 60%),radial-gradient(900px 500px at 88% 15%,rgba(124,108,255,.10),transparent 55%),radial-gradient(800px 600px at 50% 100%,rgba(46,229,157,.07),transparent 50%)}",
      ".sc *{box-sizing:border-box}",
      ".sc .container{max-width:1200px;margin:0 auto;padding:22px 20px 40px}",

      /* ── hero ── */
      ".sc .hero{position:relative;border-radius:22px;border:1px solid var(--bd2);overflow:hidden;padding:28px 28px 22px;margin-bottom:20px;background:linear-gradient(135deg,rgba(78,161,255,.14),rgba(124,108,255,.10),rgba(46,229,157,.06));box-shadow:var(--shadow);backdrop-filter:blur(8px)}",
      ".sc .hero::before{content:'';position:absolute;inset:0;background:radial-gradient(600px circle at 80% 20%,rgba(124,108,255,.12),transparent 60%);pointer-events:none}",
      ".sc .hero h2{margin:0 0 4px;font-size:22px;font-weight:900;letter-spacing:.3px;position:relative}",
      ".sc .hero .sub{color:var(--mut);font-size:13px;position:relative}",

      /* ── KPI row ── */
      ".sc .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}",
      ".sc .kpi{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);padding:18px 14px;text-align:center;backdrop-filter:blur(6px);transition:transform .15s,border-color .2s,box-shadow .2s}",
      ".sc .kpi:hover{transform:translateY(-2px);border-color:var(--bd2);box-shadow:0 8px 24px rgba(0,0,0,.25)}",
      ".sc .kpi .n{font-size:30px;font-weight:900;letter-spacing:.5px;line-height:1.1}",
      ".sc .kpi .l{font-size:11px;color:var(--mut);margin-top:5px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}",

      /* ── tabs ── */
      ".sc .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;padding:4px;background:var(--pnl);border-radius:14px;border:1px solid var(--bd)}",
      ".sc .tab{padding:10px 18px;border-radius:10px;border:none;background:transparent;color:var(--mut);cursor:pointer;font-size:13px;font-weight:700;transition:all .18s;position:relative}",
      ".sc .tab:hover{color:var(--txt);background:rgba(255,255,255,.05)}",
      ".sc .tab.on{color:var(--txt);background:rgba(78,161,255,.15);box-shadow:0 2px 12px rgba(78,161,255,.15)}",

      /* ── card ── */
      ".sc .card{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);box-shadow:var(--shadow);overflow:hidden;margin-bottom:16px;backdrop-filter:blur(6px);transition:border-color .2s}",
      ".sc .card:hover{border-color:var(--bd2)}",
      ".sc .card .hd{padding:14px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--pnl)}",
      ".sc .card .hd h3{margin:0;font-size:15px;font-weight:800}",
      ".sc .card .bd{padding:20px}",

      /* ── form fields ── */
      ".sc .fld{display:flex;flex-direction:column;gap:5px}",
      ".sc .fld label{color:var(--mut);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}",
      ".sc .fld input,.sc .fld select,.sc .fld textarea{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.22);color:var(--txt);padding:10px 12px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .2s,box-shadow .2s}",
      ".sc .fld input:focus,.sc .fld select:focus,.sc .fld textarea:focus{border-color:rgba(78,161,255,.55);box-shadow:0 0 0 3px rgba(78,161,255,.12)}",
      ".sc .fld textarea{min-height:68px;resize:vertical;line-height:1.4}",
      ".sc .fld input::placeholder,.sc .fld textarea::placeholder{color:rgba(170,183,214,.4)}",

      /* ── buttons ── */
      ".sc .btn{border:1px solid var(--bd);background:var(--pnl2);color:var(--txt);padding:9px 16px;border-radius:var(--r2);cursor:pointer;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:8px;transition:all .15s;position:relative;overflow:hidden}",
      ".sc .btn:hover{background:rgba(255,255,255,.08);border-color:var(--bd2);transform:translateY(-1px)}",
      ".sc .btn:active{transform:translateY(0)}",
      ".sc .btn.pri{background:linear-gradient(135deg,rgba(78,161,255,.22),rgba(124,108,255,.18));border-color:rgba(78,161,255,.4);color:#8ac4ff}",
      ".sc .btn.pri:hover{background:linear-gradient(135deg,rgba(78,161,255,.3),rgba(124,108,255,.24));border-color:rgba(78,161,255,.55);box-shadow:0 4px 16px rgba(78,161,255,.15)}",
      ".sc .btn.ok{background:linear-gradient(135deg,rgba(46,229,157,.18),rgba(46,229,157,.12));border-color:rgba(46,229,157,.4);color:#6af0be}",
      ".sc .btn.dn{background:linear-gradient(135deg,rgba(255,107,157,.18),rgba(255,107,157,.12));border-color:rgba(255,107,157,.35);color:#ff9ebe}",
      ".sc .btn.dn:hover{background:linear-gradient(135deg,rgba(255,107,157,.28),rgba(255,107,157,.2));border-color:rgba(255,107,157,.5);box-shadow:0 4px 16px rgba(255,107,157,.12)}",
      ".sc .btn.sm{padding:7px 12px;font-size:12px;border-radius:10px}",

      /* ── table ── */
      ".sc table{width:100%;border-collapse:collapse;font-size:13px}",
      ".sc th{text-align:left;padding:11px 14px;border-bottom:2px solid var(--bd2);color:var(--mut);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;position:sticky;top:0;background:rgba(11,18,32,.92);backdrop-filter:blur(6px);z-index:2}",
      ".sc td{padding:10px 14px;border-bottom:1px solid var(--bd);transition:background .12s}",
      ".sc tbody tr{transition:background .12s}",
      ".sc tbody tr:hover td{background:rgba(78,161,255,.04)}",
      ".sc tbody tr:hover{cursor:pointer}",

      /* ── badges ── */
      ".sc .badge{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.2px}",
      ".sc .badge::before{content:'';width:6px;height:6px;border-radius:50%}",
      ".sc .badge.normal{background:rgba(46,229,157,.12);color:#6af0be}.sc .badge.normal::before{background:#2ee59d}",
      ".sc .badge.borderline{background:rgba(255,204,102,.12);color:#ffcc66}.sc .badge.borderline::before{background:#ffcc66}",
      ".sc .badge.abnormal{background:rgba(255,107,157,.12);color:#ff9ebe}.sc .badge.abnormal::before{background:#ff6b9d}",
      ".sc .badge.urgent{background:rgba(255,80,80,.15);color:#ff6b6b}.sc .badge.urgent::before{background:#ff5050}",
      ".sc .badge.active{background:rgba(78,161,255,.12);color:#8ac4ff}.sc .badge.active::before{background:#4ea1ff}",
      ".sc .badge.completed{background:rgba(46,229,157,.12);color:#6af0be}.sc .badge.completed::before{background:#2ee59d}",
      ".sc .badge.planned{background:rgba(255,204,102,.12);color:#ffcc66}.sc .badge.planned::before{background:#ffcc66}",
      ".sc .badge.cancelled{background:rgba(255,255,255,.06);color:var(--mut)}.sc .badge.cancelled::before{background:rgba(170,183,214,.4)}",

      /* ── search ── */
      ".sc .search-bar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}",
      ".sc .search-bar input{flex:1;min-width:200px;border:1px solid var(--bd);background:rgba(0,0,0,.22);color:var(--txt);padding:10px 14px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .2s}",
      ".sc .search-bar input:focus{border-color:rgba(78,161,255,.55);box-shadow:0 0 0 3px rgba(78,161,255,.1)}",

      /* ── modal ── (note: NO space between .sc and .modal-bg — element has both classes) */
      ".sc-modal-bg{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .2s}",
      ".sc-modal-bg.show{opacity:1}",
      ".sc-modal{background:linear-gradient(165deg,#141e30,#111b2a 40%,#0f1824);border:1px solid var(--bd2);border-radius:20px;max-width:680px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.04) inset;transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1),opacity .2s;opacity:0}",
      ".sc-modal-bg.show .sc-modal{transform:translateY(0) scale(1);opacity:1}",
      ".sc-modal .m-hd{padding:20px 24px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,rgba(78,161,255,.06),rgba(124,108,255,.04))}",
      ".sc-modal .m-hd h3{margin:0;font-size:17px;font-weight:800}",
      ".sc-modal .m-bd{padding:22px 24px}",
      ".sc-modal .m-ft{padding:16px 24px;border-top:1px solid var(--bd);display:flex;justify-content:flex-end;gap:8px;background:rgba(0,0,0,.1);--ac:#4ea1ff;--ac2:#7c6cff;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.035);--pnl2:rgba(255,255,255,.055);--bd:rgba(255,255,255,.09);--bd2:rgba(255,255,255,.14);--r:18px;--r2:12px;--txt:#e8eefc;--mut:rgba(170,183,214,.72)}",
      ".sc-modal .m-ft .btn{border:1px solid var(--bd);background:var(--pnl2);color:var(--txt);padding:9px 16px;border-radius:var(--r2);cursor:pointer;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:8px;transition:all .15s;position:relative;overflow:hidden}",
      ".sc-modal .m-ft .btn:hover{background:rgba(255,255,255,.08);border-color:var(--bd2);transform:translateY(-1px)}",
      ".sc-modal .m-ft .btn:active{transform:translateY(0)}",
      ".sc-modal .m-ft .btn.pri{background:linear-gradient(135deg,rgba(78,161,255,.22),rgba(124,108,255,.18));border-color:rgba(78,161,255,.4);color:#8ac4ff}",
      ".sc-modal .m-ft .btn.pri:hover{background:linear-gradient(135deg,rgba(78,161,255,.3),rgba(124,108,255,.24));border-color:rgba(78,161,255,.55);box-shadow:0 4px 16px rgba(78,161,255,.15)}",
      ".sc-modal .m-ft .btn.dn{background:linear-gradient(135deg,rgba(255,107,157,.18),rgba(255,107,157,.12));border-color:rgba(255,107,157,.35);color:#ff9ebe}",
      ".sc-modal .m-ft .btn.dn:hover{background:linear-gradient(135deg,rgba(255,107,157,.28),rgba(255,107,157,.2));border-color:rgba(255,107,157,.5);box-shadow:0 4px 16px rgba(255,107,157,.12)}",
      ".sc-modal .close-x{width:32px;height:32px;border-radius:10px;border:1px solid var(--bd);background:rgba(255,255,255,.04);color:var(--mut);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}",
      ".sc-modal .close-x:hover{background:rgba(255,107,157,.12);border-color:rgba(255,107,157,.3);color:#ff9ebe}",

      /* ── toast ── */
      ".sc-toast-wrap{position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none}",
      ".sc-toast{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;font-size:13px;font-weight:600;background:rgba(11,18,32,.88);backdrop-filter:blur(10px);border:1px solid var(--bd);box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(8px);transition:all .22s}",
      ".sc-toast.show{opacity:1;transform:translateY(0)}",
      ".sc-toast-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}",
      ".sc-toast.good .sc-toast-dot{background:#2ee59d}",
      ".sc-toast.bad .sc-toast-dot{background:#ff6b9d}",
      ".sc-toast.warn .sc-toast-dot{background:#ffcc66}",

      /* ── campaign cards (grid) ── */
      ".sc .camp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}",
      ".sc .camp-card{border:1px solid var(--bd);border-radius:16px;background:var(--pnl);padding:18px;cursor:pointer;transition:all .18s;position:relative;overflow:hidden}",
      ".sc .camp-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:3px 3px 0 0;background:linear-gradient(90deg,var(--ac),var(--ac2));opacity:.6;transition:opacity .2s}",
      ".sc .camp-card:hover{border-color:var(--bd2);transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,.3)}",
      ".sc .camp-card:hover::before{opacity:1}",
      ".sc .camp-card .cc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}",
      ".sc .camp-card .cc-icon{font-size:26px;line-height:1}",
      ".sc .camp-card .cc-name{font-size:15px;font-weight:800;margin-bottom:2px}",
      ".sc .camp-card .cc-type{font-size:12px;color:var(--mut)}",
      ".sc .camp-card .cc-meta{display:flex;gap:16px;font-size:12px;color:var(--mut);margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)}",
      ".sc .camp-card .cc-meta span{display:flex;align-items:center;gap:4px}",
      ".sc .camp-card .cc-stat{font-weight:800;color:var(--txt)}",
      ".sc .camp-card .cc-actions{display:flex;gap:6px;margin-top:12px}",

      /* ── summary grid ── */
      ".sc .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}",
      ".sc .summary-item{border:1px solid var(--bd);border-radius:14px;background:var(--pnl);padding:18px;backdrop-filter:blur(4px);transition:border-color .2s}",
      ".sc .summary-item:hover{border-color:var(--bd2)}",
      ".sc .summary-item .s-label{font-size:10.5px;color:var(--mut);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}",
      ".sc .summary-item .s-value{font-size:26px;font-weight:900}",

      /* ── empty state ── */
      ".sc .empty{text-align:center;padding:50px 20px;color:var(--mut)}",
      ".sc .empty .icon{font-size:48px;margin-bottom:12px;opacity:.7}",
      ".sc .empty .msg{font-size:14px;margin-bottom:16px}",

      /* ── detail header ── */
      ".sc .detail-hero{border:1px solid var(--bd2);border-radius:var(--r);background:linear-gradient(135deg,rgba(78,161,255,.08),rgba(124,108,255,.06));padding:22px 24px;margin-bottom:16px;backdrop-filter:blur(6px)}",
      ".sc .detail-hero h3{font-size:18px;font-weight:900;margin:0 0 12px;display:flex;align-items:center;gap:10px}",

      /* ── scrollbar ── */
      ".sc ::-webkit-scrollbar{width:6px}",
      ".sc ::-webkit-scrollbar-track{background:transparent}",
      ".sc ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}",
      ".sc ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.2)}",

      /* ── responsive ── */
      /* ── autocomplete dropdown ── */
      ".sc-ac-dropdown{position:absolute;left:0;right:0;top:100%;z-index:10001;background:linear-gradient(165deg,#1a2640,#141e30);border:1px solid var(--bd2);border-radius:10px;max-height:180px;overflow-y:auto;box-shadow:0 12px 36px rgba(0,0,0,.5);display:none}",
      ".sc-ac-dropdown.open{display:block}",
      ".sc-ac-item{padding:9px 14px;font-size:13px;color:var(--txt);cursor:pointer;transition:background .12s}",
      ".sc-ac-item:hover,.sc-ac-item.hl{background:rgba(78,161,255,.14)}",
      ".sc-ac-item:first-child{border-radius:10px 10px 0 0}",
      ".sc-ac-item:last-child{border-radius:0 0 10px 10px}",

      /* ── progress bar ── */
      ".sc .progress-wrap{margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)}",
      ".sc .progress-label{display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-bottom:5px;font-weight:600}",
      ".sc .progress-bar{height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden}",
      ".sc .progress-fill{height:100%;border-radius:3px;transition:width .4s cubic-bezier(.16,1,.3,1);background:linear-gradient(90deg,var(--ac),var(--ac2))}",
      ".sc .progress-fill.high{background:linear-gradient(90deg,#2ee59d,#1bc47e)}",
      ".sc .progress-fill.over{background:linear-gradient(90deg,#ff6b9d,#ff5a7a)}",

      /* ── overdue indicator ── */
      ".sc .badge.overdue{background:rgba(255,80,80,.15);color:#ff6b6b;animation:sc-pulse 2s ease-in-out infinite}",
      ".sc .badge.overdue::before{background:#ff5050}",
      "@keyframes sc-pulse{0%,100%{opacity:1}50%{opacity:.7}}",

      /* ── campaign location pill ── */
      ".sc .camp-card .cc-location{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--mut);background:rgba(255,255,255,.04);padding:3px 10px;border-radius:8px;margin-top:4px}",

      /* ── action bar ── */
      ".sc .action-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding:12px 16px;border:1px solid var(--bd);border-radius:var(--r2);background:var(--pnl)}",

      /* ── stat mini-bar (for summary) ── */
      ".sc .stat-bar-wrap{margin-top:6px}",
      ".sc .stat-bar{height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden}",
      ".sc .stat-bar-fill{height:100%;border-radius:2px}",

      /* ── enhanced empty state ── */
      ".sc .empty .cta-btn{display:inline-flex;align-items:center;gap:8px;margin-top:12px;padding:10px 20px;border-radius:var(--r2);background:linear-gradient(135deg,rgba(78,161,255,.22),rgba(124,108,255,.18));border:1px solid rgba(78,161,255,.4);color:#8ac4ff;font-size:13px;font-weight:700;cursor:pointer;transition:all .18s}",
      ".sc .empty .cta-btn:hover{background:linear-gradient(135deg,rgba(78,161,255,.3),rgba(124,108,255,.24));border-color:rgba(78,161,255,.55);transform:translateY(-1px);box-shadow:0 4px 16px rgba(78,161,255,.15)}",

      /* ── table row hover enhancement ── */
      ".sc tbody tr:nth-child(even) td{background:rgba(255,255,255,.012)}",

      "@media(max-width:700px){.sc .container{padding:14px 12px}.sc .kpi-row{grid-template-columns:repeat(2,1fr)}.sc .camp-grid{grid-template-columns:1fr}.sc .summary-grid{grid-template-columns:1fr}.sc-modal{max-width:100%;border-radius:16px}.sc .action-bar{flex-direction:column}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  // ── campaign helpers ─────────────────────────────────────────────────────
  function getCampaignStatus(c) {
    var today = todayStr();
    if (c.status === "Cancelled") return "Cancelled";
    if (c.endDate && c.endDate < today) return "Completed";
    if (c.startDate && c.startDate <= today && (!c.endDate || c.endDate >= today)) return "Active";
    return "Planned";
  }

  function getAllParticipants() {
    var all = [];
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        all.push(Object.assign({}, p, { campaignId: c.id, campaignName: c.name }));
      });
    });
    return all;
  }

  function getAllFollowUps() {
    var all = [];
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        (p.followUps || []).forEach(function (f) {
          all.push(Object.assign({}, f, { participantId: p.id, participantName: p.name, campaignId: c.id, campaignName: c.name }));
        });
      });
    });
    return all;
  }

  // ── autocomplete helper ──────────────────────────────────────────────────
  function attachAutocomplete(input, getSuggestions, onSelect) {
    var dropdown = document.createElement("div");
    dropdown.className = "sc-ac-dropdown";
    input.parentNode.style.position = "relative";
    input.parentNode.appendChild(dropdown);
    var hlIdx = -1;

    function show(items) {
      dropdown.innerHTML = "";
      hlIdx = -1;
      if (!items.length) { dropdown.classList.remove("open"); return; }
      items.forEach(function (item, i) {
        var d = document.createElement("div");
        d.className = "sc-ac-item";
        d.textContent = item;
        d.addEventListener("mousedown", function (e) {
          e.preventDefault();
          input.value = item;
          dropdown.classList.remove("open");
          if (onSelect) onSelect(item);
        });
        dropdown.appendChild(d);
      });
      dropdown.classList.add("open");
    }

    input.addEventListener("input", function () {
      var v = input.value.trim();
      if (v.length < 1) { dropdown.classList.remove("open"); return; }
      show(getSuggestions(v));
    });
    input.addEventListener("focus", function () {
      var v = input.value.trim();
      if (v.length >= 1) show(getSuggestions(v));
    });
    input.addEventListener("blur", function () {
      setTimeout(function () { dropdown.classList.remove("open"); }, 150);
    });
    input.addEventListener("keydown", function (e) {
      var items = dropdown.querySelectorAll(".sc-ac-item");
      if (!items.length || !dropdown.classList.contains("open")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); hlIdx = Math.min(hlIdx + 1, items.length - 1); updateHl(items); }
      else if (e.key === "ArrowUp") { e.preventDefault(); hlIdx = Math.max(hlIdx - 1, 0); updateHl(items); }
      else if (e.key === "Enter" && hlIdx >= 0) { e.preventDefault(); items[hlIdx].dispatchEvent(new Event("mousedown")); }
      else if (e.key === "Escape") { dropdown.classList.remove("open"); }
    });

    function updateHl(items) {
      items.forEach(function (el, i) { el.classList.toggle("hl", i === hlIdx); });
    }
  }

  // ── modal helper ─────────────────────────────────────────────────────────
  function openModal(title, bodyHtml, footerHtml) {
    var bg = document.createElement("div");
    bg.className = "sc-modal-bg";
    var modal = document.createElement("div");
    modal.className = "sc-modal";
    modal.innerHTML =
      '<div class="m-hd"><h3>' + title + '</h3><button class="close-x">&times;</button></div>' +
      '<div class="m-bd">' + bodyHtml + '</div>' +
      '<div class="m-ft">' + footerHtml + '</div>';
    bg.appendChild(modal);
    document.body.appendChild(bg);
    // animate in
    requestAnimationFrame(function () { requestAnimationFrame(function () { bg.classList.add("show"); }); });
    // close handlers
    function close() {
      bg.classList.remove("show");
      setTimeout(function () { bg.remove(); }, 220);
    }
    modal.querySelector(".close-x").addEventListener("click", close);
    bg.addEventListener("click", function (e) { if (e.target === bg) close(); });
    return { bg: bg, modal: modal, close: close };
  }

  // ── CSV export ─────────────────────────────────────────────────────────
  function csvEscape(v) { var s = String(v == null ? "" : v); return s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s; }

  function exportCampaignCSV(c) {
    var pt = campaignPoctType(c.type);
    var pDef = pt ? POCT_FIELDS[pt] : null;
    var baseHeaders = ["ID Card", "Name", "Phone", "Email", "DOB", "Type", "Screening Date"];
    var poctHeaders = pDef ? pDef.fields.map(function (f) { return f.label; }) : [];
    var tailHeaders = ["Result Notes", "Result Category", "Referral", "Referral Notes"];
    var rows = [baseHeaders.concat(poctHeaders).concat(tailHeaders)];
    (c.participants || []).forEach(function (p) {
      var base = [p.idCard, p.name, p.phone, p.email, p.dob, p.type, p.date];
      var poctVals = pDef ? pDef.fields.map(function (f) { return (p.poctResults && p.poctResults[f.key] != null) ? p.poctResults[f.key] : ""; }) : [];
      var tail = [p.resultNotes, p.resultCategory, p.referral, p.referralNotes];
      rows.push(base.concat(poctVals).concat(tail).map(csvEscape));
    });
    var csv = rows.map(function (r) { return r.join(","); }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (c.name || "campaign").replace(/[^a-zA-Z0-9_-]/g, "_") + "_participants.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 100);
    toast("CSV exported", "good");
  }

  function exportAllCampaignsCSV() {
    var rows = [["Campaign", "Type", "Status", "Location", "Start Date", "End Date", "Target", "Participants", "Abnormal", "Referrals"]];
    campaigns.forEach(function (c) {
      var ps = c.participants || [];
      var abn = ps.filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
      var refs = ps.filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;
      rows.push([c.name, c.type, getCampaignStatus(c), c.location, c.startDate, c.endDate, c.targetScreenings, ps.length, abn, refs].map(csvEscape));
    });
    var csv = rows.map(function (r) { return r.join(","); }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "screening_campaigns_export.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 100);
    toast("All campaigns exported", "good");
  }

  // ── overdue helper ────────────────────────────────────────────────────────
  function isOverdue(f) {
    if (!f.scheduledDate) return false;
    if (f.status === "Completed" || f.status === "Cancelled") return false;
    return f.scheduledDate < todayStr();
  }

  // ── render ───────────────────────────────────────────────────────────────
  var activeTab = "campaigns";
  var activeCampaignId = null;
  var searchQ = "";

  async function render(ctx) {
    var mount = ctx.mount;
    currentUser = ctx.user;
    ensureStyles();

    await cloudLoad();

    mount.innerHTML = "";
    var root = document.createElement("div");
    root.className = "sc";
    mount.appendChild(root);

    function redraw() {
      root.innerHTML = "";
      var container = document.createElement("div");
      container.className = "container";
      root.appendChild(container);

      // hero
      var hero = document.createElement("div");
      hero.className = "hero";
      var totalParticipants = 0, totalAbnormal = 0, totalReferrals = 0;
      campaigns.forEach(function (c) {
        (c.participants || []).forEach(function (p) {
          totalParticipants++;
          if (p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention") totalAbnormal++;
          if (p.referral && p.referral !== "No referral needed") totalReferrals++;
        });
      });
      hero.innerHTML = '<h2>\uD83E\uDE7A Clinical Screening Campaigns</h2><div class="sub">Plan and run health screening events \u2014 track participants, results &amp; referrals</div>';
      container.appendChild(hero);

      // KPI
      var activeCampaigns = campaigns.filter(function (c) { return getCampaignStatus(c) === "Active"; }).length;
      var overdueCount = getAllFollowUps().filter(function (f) { return isOverdue(f); }).length;
      var kpiRow = document.createElement("div");
      kpiRow.className = "kpi-row";
      var kpis = [
        { n: campaigns.length, l: "Campaigns", color: "#4ea1ff" },
        { n: activeCampaigns, l: "Active Now", color: "#2ee59d" },
        { n: totalParticipants, l: "Screened", color: "#7c6cff" },
        { n: totalAbnormal, l: "Abnormal", color: "#ffcc66" },
        { n: totalReferrals, l: "Referrals", color: "#ff6b9d" },
        { n: overdueCount, l: "Overdue", color: "#ff5050" }
      ];
      kpis.forEach(function (k) {
        kpiRow.innerHTML += '<div class="kpi"><div class="n" style="color:' + k.color + '">' + k.n + '</div><div class="l">' + k.l + '</div></div>';
      });
      container.appendChild(kpiRow);

      // tabs
      var tabs = document.createElement("div");
      tabs.className = "tabs";
      var tabDefs = [
        { id: "campaigns", label: "Campaigns" },
        { id: "participants", label: "All Participants" },
        { id: "followups", label: "Follow-ups" },
        { id: "summary", label: "Summary" }
      ];
      tabDefs.forEach(function (t) {
        var b = document.createElement("button");
        b.className = "tab" + (activeTab === t.id ? " on" : "");
        b.textContent = t.label;
        b.addEventListener("click", function () { activeTab = t.id; activeCampaignId = null; searchQ = ""; redraw(); });
        tabs.appendChild(b);
      });
      container.appendChild(tabs);

      if (activeTab === "campaigns" && activeCampaignId) {
        renderCampaignDetail(container, redraw);
      } else if (activeTab === "campaigns") {
        renderCampaignsList(container, redraw);
      } else if (activeTab === "participants") {
        renderAllParticipants(container, redraw);
      } else if (activeTab === "followups") {
        renderFollowUps(container, redraw);
      } else if (activeTab === "summary") {
        renderSummary(container, redraw);
      }
    }

    redraw();
  }

  // ── campaigns list (card grid) ───────────────────────────────────────────
  function renderCampaignsList(container, redraw) {
    // header row
    var hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px";
    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    searchBar.style.marginBottom = "0";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search campaigns\u2026";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") redraw(); });
    searchBar.appendChild(searchInput);
    hdr.appendChild(searchBar);

    var btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex;gap:8px";

    if (campaigns.length > 0) {
      var expAllBtn = document.createElement("button");
      expAllBtn.className = "btn sm ok";
      expAllBtn.innerHTML = "\uD83D\uDCE5 Export All";
      expAllBtn.addEventListener("click", function () { exportAllCampaignsCSV(); });
      btnGroup.appendChild(expAllBtn);
    }

    var addBtn = document.createElement("button");
    addBtn.className = "btn pri";
    addBtn.innerHTML = "<span style='font-size:16px'>+</span> New Campaign";
    addBtn.addEventListener("click", function () { showCampaignModal(null, redraw); });
    btnGroup.appendChild(addBtn);
    hdr.appendChild(btnGroup);
    container.appendChild(hdr);

    var filtered = campaigns;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = campaigns.filter(function (c) {
        return norm(c.name).indexOf(q) !== -1 || norm(c.type).indexOf(q) !== -1;
      });
    }

    // sort by start date desc
    filtered = filtered.slice().sort(function (a, b) { return (b.startDate || "").localeCompare(a.startDate || ""); });

    if (filtered.length === 0) {
      var emptyDiv = document.createElement("div");
      emptyDiv.className = "empty";
      emptyDiv.innerHTML = '<div class="icon">\uD83D\uDCCB</div><div class="msg">' + (searchQ ? 'No campaigns match your search.' : 'No campaigns yet. Create your first screening campaign to get started.') + '</div>';
      if (!searchQ) {
        var ctaBtn = document.createElement("button");
        ctaBtn.className = "cta-btn";
        ctaBtn.innerHTML = "<span style='font-size:16px'>+</span> Create First Campaign";
        ctaBtn.addEventListener("click", function () { showCampaignModal(null, redraw); });
        emptyDiv.appendChild(ctaBtn);
      }
      container.appendChild(emptyDiv);
      return;
    }

    var grid = document.createElement("div");
    grid.className = "camp-grid";

    filtered.forEach(function (c) {
      var status = getCampaignStatus(c);
      var pCount = (c.participants || []).length;
      var abn = (c.participants || []).filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
      var refs = (c.participants || []).filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;
      var icon = CAMPAIGN_TYPE_ICONS[c.type] || "\uD83D\uDCCB";
      var goal = parseInt(c.targetScreenings, 10) || 0;
      var pct = goal > 0 ? Math.min(Math.round(pCount / goal * 100), 100) : 0;
      var pctClass = pct >= 100 ? "high" : (pct > 100 ? "over" : "");

      var card = document.createElement("div");
      card.className = "camp-card";
      card.innerHTML =
        '<div class="cc-top">' +
          '<div><div class="cc-name">' + esc(c.name) + '</div><div class="cc-type">' + esc(c.type) + '</div>' +
            (c.location ? '<div class="cc-location">\uD83D\uDCCD ' + esc(c.location) + '</div>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px"><span class="badge ' + norm(status) + '">' + esc(status) + '</span><span class="cc-icon">' + icon + '</span></div>' +
        '</div>' +
        '<div class="cc-meta">' +
          '<span>\uD83D\uDCC5 ' + fmtDate(c.startDate) + (c.endDate ? ' \u2013 ' + fmtDate(c.endDate) : '') + '</span>' +
        '</div>' +
        '<div class="cc-meta">' +
          '<span>\uD83D\uDC65 <span class="cc-stat">' + pCount + '</span> screened</span>' +
          '<span>\u26A0\uFE0F <span class="cc-stat" style="color:#ffcc66">' + abn + '</span> abnormal</span>' +
          '<span>\uD83D\uDCE4 <span class="cc-stat" style="color:#ff6b9d">' + refs + '</span> referrals</span>' +
        '</div>' +
        (goal > 0 ? '<div class="progress-wrap"><div class="progress-label"><span>Goal: ' + pCount + ' / ' + goal + '</span><span>' + pct + '%</span></div><div class="progress-bar"><div class="progress-fill ' + pctClass + '" style="width:' + pct + '%"></div></div></div>' : '') +
        '<div class="cc-actions"></div>';

      var actions = card.querySelector(".cc-actions");
      var viewBtn = document.createElement("button");
      viewBtn.className = "btn sm pri";
      viewBtn.textContent = "View Details";
      viewBtn.addEventListener("click", function (e) { e.stopPropagation(); activeCampaignId = c.id; redraw(); });
      actions.appendChild(viewBtn);

      var editBtn = document.createElement("button");
      editBtn.className = "btn sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function (e) { e.stopPropagation(); showCampaignModal(c, redraw); });
      actions.appendChild(editBtn);

      var dupBtn = document.createElement("button");
      dupBtn.className = "btn sm";
      dupBtn.textContent = "Duplicate";
      dupBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var clone = JSON.parse(JSON.stringify(c));
        clone.id = uid();
        clone.name = c.name + " (Copy)";
        clone.participants = [];
        campaigns.push(clone);
        save();
        toast("Campaign duplicated", "good");
        redraw();
      });
      actions.appendChild(dupBtn);

      var delBtn = document.createElement("button");
      delBtn.className = "btn sm dn";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("Delete campaign \"" + c.name + "\"? This cannot be undone.")) return;
        campaigns = campaigns.filter(function (x) { return x.id !== c.id; });
        save();
        toast("Campaign deleted", "warn");
        redraw();
      });
      actions.appendChild(delBtn);

      card.addEventListener("click", function () { activeCampaignId = c.id; redraw(); });
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  // ── campaign detail ──────────────────────────────────────────────────────
  function renderCampaignDetail(container, redraw) {
    var c = campaigns.find(function (x) { return x.id === activeCampaignId; });
    if (!c) { activeCampaignId = null; redraw(); return; }

    // back button
    var backBtn = document.createElement("button");
    backBtn.className = "btn sm";
    backBtn.innerHTML = "\u2190 Back to Campaigns";
    backBtn.style.marginBottom = "14px";
    backBtn.addEventListener("click", function () { activeCampaignId = null; redraw(); });
    container.appendChild(backBtn);

    var status = getCampaignStatus(c);
    var participants = c.participants || [];
    var abnormal = participants.filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
    var referrals = participants.filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;
    var icon = CAMPAIGN_TYPE_ICONS[c.type] || "\uD83D\uDCCB";

    // detail hero
    var dh = document.createElement("div");
    dh.className = "detail-hero";
    var goal = parseInt(c.targetScreenings, 10) || 0;
    var pct = goal > 0 ? Math.min(Math.round(participants.length / goal * 100), 100) : 0;
    var pctClass = pct >= 100 ? "high" : "";

    dh.innerHTML =
      '<h3><span style="font-size:24px">' + icon + '</span> ' + esc(c.name) + ' <span class="badge ' + norm(status) + '">' + esc(status) + '</span></h3>' +
      (c.location ? '<div style="margin-bottom:12px"><span class="cc-location" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--mut);background:rgba(255,255,255,.04);padding:4px 12px;border-radius:8px">\uD83D\uDCCD ' + esc(c.location) + '</span></div>' : '') +
      '<div class="summary-grid" style="margin-bottom:0">' +
        '<div class="summary-item"><div class="s-label">Type</div><div class="s-value" style="font-size:16px">' + esc(c.type) + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Period</div><div class="s-value" style="font-size:16px">' + fmtDate(c.startDate) + ' \u2014 ' + fmtDate(c.endDate) + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Participants</div><div class="s-value" style="color:#7c6cff">' + participants.length + (goal > 0 ? '<span style="font-size:14px;color:var(--mut)"> / ' + goal + '</span>' : '') + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Abnormal</div><div class="s-value" style="color:#ffcc66">' + abnormal + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Referrals</div><div class="s-value" style="color:#ff6b9d">' + referrals + '</div></div>' +
      '</div>' +
      (goal > 0 ? '<div class="progress-wrap" style="border-top:none;margin-top:14px"><div class="progress-label"><span>Goal Progress: ' + participants.length + ' / ' + goal + '</span><span>' + pct + '%</span></div><div class="progress-bar" style="height:8px"><div class="progress-fill ' + pctClass + '" style="width:' + pct + '%"></div></div></div>' : '') +
      (c.notes ? '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bd);color:var(--mut);font-size:13px"><strong style="color:var(--txt)">Notes:</strong> ' + esc(c.notes) + '</div>' : '');
    container.appendChild(dh);

    // action bar
    var actionBar = document.createElement("div");
    actionBar.className = "action-bar";

    var editCampBtn = document.createElement("button");
    editCampBtn.className = "btn sm";
    editCampBtn.innerHTML = "\u270F\uFE0F Edit Campaign";
    editCampBtn.addEventListener("click", function () { showCampaignModal(c, redraw); });
    actionBar.appendChild(editCampBtn);

    var exportBtn = document.createElement("button");
    exportBtn.className = "btn sm ok";
    exportBtn.innerHTML = "\uD83D\uDCE5 Export CSV";
    exportBtn.addEventListener("click", function () { exportCampaignCSV(c); });
    actionBar.appendChild(exportBtn);

    var dupCBtn = document.createElement("button");
    dupCBtn.className = "btn sm";
    dupCBtn.innerHTML = "\uD83D\uDCCB Duplicate";
    dupCBtn.addEventListener("click", function () {
      var clone = JSON.parse(JSON.stringify(c));
      clone.id = uid();
      clone.name = c.name + " (Copy)";
      clone.participants = [];
      campaigns.push(clone);
      save();
      toast("Campaign duplicated", "good");
      activeCampaignId = null;
      redraw();
    });
    actionBar.appendChild(dupCBtn);

    container.appendChild(actionBar);

    // participants card
    var pCard = document.createElement("div");
    pCard.className = "card";
    var pHd = document.createElement("div");
    pHd.className = "hd";
    pHd.innerHTML = '<h3>\uD83D\uDC65 Participants (' + participants.length + ')</h3>';
    var addPBtn = document.createElement("button");
    addPBtn.className = "btn pri sm";
    addPBtn.textContent = "+ Add Participant";
    addPBtn.addEventListener("click", function () { showParticipantModal(c, null, redraw); });
    pHd.appendChild(addPBtn);
    pCard.appendChild(pHd);

    var pBd = document.createElement("div");
    pBd.className = "bd";
    pBd.style.overflowX = "auto";

    if (participants.length === 0) {
      pBd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDC65</div><div class="msg">No participants yet. Add sign-ups or walk-ins.</div></div>';
    } else {
      // Build a short POCT result summary for table display
      var poctType = campaignPoctType(c.type);
      function poctSummary(pr) {
        if (!pr || !poctType) return "";
        if (poctType === "bp" && pr.sys && pr.dia) return pr.sys + "/" + pr.dia + (pr.pulse ? " (" + pr.pulse + " bpm)" : "");
        if (poctType === "hba1c" && pr.pct) return pr.pct + "%" + (pr.mmol ? " (" + pr.mmol + " mmol)" : "");
        if (poctType === "bg" && pr.glucose) return pr.glucose + " mmol/L" + (pr.timing ? " (" + pr.timing + ")" : "");
        if (poctType === "chol" && pr.tc) return "TC:" + pr.tc + (pr.hdl ? " HDL:" + pr.hdl : "") + (pr.ldl ? " LDL:" + pr.ldl : "");
        if (poctType === "bmi" && pr.bmi) return "BMI:" + pr.bmi + (pr.weight ? " (" + pr.weight + "kg)" : "");
        if (poctType === "urine") {
          var parts = [];
          if (pr.glu && pr.glu !== "Negative") parts.push("Glu:" + pr.glu);
          if (pr.pro && pr.pro !== "Negative") parts.push("Pro:" + pr.pro);
          if (pr.bld && pr.bld !== "Negative") parts.push("Bld:" + pr.bld);
          if (pr.leu && pr.leu !== "Negative") parts.push("Leu:" + pr.leu);
          return parts.length ? parts.join(" ") : "All negative";
        }
        return "";
      }

      var pTable = document.createElement("table");
      pTable.innerHTML = '<thead><tr><th>ID Card</th><th>Name</th><th>Type</th><th>Date</th>' + (poctType ? '<th>POCT Results</th>' : '') + '<th>Result</th><th>Category</th><th>Referral</th><th>Follow-ups</th><th></th></tr></thead>';
      var pTbody = document.createElement("tbody");
      participants.forEach(function (p) {
        var fuCount = (p.followUps || []).length;
        var catClass = norm(p.resultCategory || "").replace(/\s+/g, "");
        if (catClass === "requiresurgentattention") catClass = "urgent";
        var poctVal = poctSummary(p.poctResults);
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td style="font-family:monospace;font-size:12px;letter-spacing:.5px">' + esc(p.idCard || "-") + '</td>' +
          '<td><strong>' + esc(p.name) + '</strong>' + (p.phone ? '<br><span style="color:var(--mut);font-size:11px">' + esc(p.phone) + '</span>' : '') + '</td>' +
          '<td>' + esc(p.type || "Walk-in") + '</td>' +
          '<td>' + fmtDate(p.date) + '</td>' +
          (poctType ? '<td style="font-family:monospace;font-size:12px;white-space:nowrap">' + esc(poctVal || "-") + '</td>' : '') +
          '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.resultNotes || "-") + '</td>' +
          '<td>' + (p.resultCategory ? '<span class="badge ' + catClass + '">' + esc(p.resultCategory) + '</span>' : '-') + '</td>' +
          '<td>' + esc(p.referral || "-") + '</td>' +
          '<td style="text-align:center">' + fuCount + '</td>' +
          '<td style="white-space:nowrap"></td>';

        var actionTd = tr.querySelector("td:last-child");
        var eBtn = document.createElement("button");
        eBtn.className = "btn sm";
        eBtn.textContent = "Edit";
        eBtn.addEventListener("click", function (ev) { ev.stopPropagation(); showParticipantModal(c, p, redraw); });
        actionTd.appendChild(eBtn);

        var fuBtn = document.createElement("button");
        fuBtn.className = "btn sm pri";
        fuBtn.textContent = "Follow-up";
        fuBtn.style.marginLeft = "4px";
        fuBtn.addEventListener("click", function (ev) { ev.stopPropagation(); showFollowUpModal(c, p, null, redraw); });
        actionTd.appendChild(fuBtn);

        var dBtn = document.createElement("button");
        dBtn.className = "btn sm dn";
        dBtn.textContent = "Del";
        dBtn.style.marginLeft = "4px";
        dBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (!confirm("Remove participant \"" + p.name + "\"?")) return;
          c.participants = c.participants.filter(function (x) { return x.id !== p.id; });
          save();
          toast("Participant removed", "warn");
          redraw();
        });
        actionTd.appendChild(dBtn);

        pTbody.appendChild(tr);
      });
      pTable.appendChild(pTbody);
      pBd.appendChild(pTable);
    }

    pCard.appendChild(pBd);
    container.appendChild(pCard);

    // follow-ups for this campaign
    var fuList = [];
    participants.forEach(function (p) {
      (p.followUps || []).forEach(function (f) {
        fuList.push(Object.assign({}, f, { participantName: p.name, participantId: p.id }));
      });
    });

    if (fuList.length > 0) {
      var fuCard = document.createElement("div");
      fuCard.className = "card";
      fuCard.innerHTML = '<div class="hd"><h3>\uD83D\uDDD3\uFE0F Follow-ups (' + fuList.length + ')</h3></div>';
      var fuBd = document.createElement("div");
      fuBd.className = "bd";
      fuBd.style.overflowX = "auto";
      var fuTable = document.createElement("table");
      fuTable.innerHTML = '<thead><tr><th>Participant</th><th>Scheduled</th><th>Reason</th><th>Status</th><th>Notes</th><th></th></tr></thead>';
      var fuTbody = document.createElement("tbody");
      fuList.forEach(function (f) {
        var tr = document.createElement("tr");
        var statusClass = norm(f.status || "pending");
        var overdueFlag = isOverdue(f);
        var badgeClass = overdueFlag ? "overdue" : (statusClass === "completed" ? "completed" : statusClass === "scheduled" ? "active" : statusClass === "no-show" ? "abnormal" : "planned");
        var badgeText = overdueFlag ? "Overdue" : esc(f.status || "Pending");
        tr.innerHTML =
          '<td>' + esc(f.participantName) + '</td>' +
          '<td>' + fmtDate(f.scheduledDate) + '</td>' +
          '<td>' + esc(f.reason || "-") + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td>' +
          '<td>' + esc(f.notes || "-") + '</td>' +
          '<td></td>';
        var aTd = tr.querySelector("td:last-child");
        var eBtn = document.createElement("button");
        eBtn.className = "btn sm";
        eBtn.textContent = "Edit";
        eBtn.addEventListener("click", function () {
          var participant = participants.find(function (p) { return p.id === f.participantId; });
          if (participant) showFollowUpModal(c, participant, f, redraw);
        });
        aTd.appendChild(eBtn);
        fuTbody.appendChild(tr);
      });
      fuTable.appendChild(fuTbody);
      fuBd.appendChild(fuTable);
      fuCard.appendChild(fuBd);
      container.appendChild(fuCard);
    }
  }

  // ── all participants tab ─────────────────────────────────────────────────
  function renderAllParticipants(container, redraw) {
    var all = getAllParticipants();
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83D\uDC65 All Participants (' + all.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.style.overflowX = "auto";

    // search
    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search by ID card, name, campaign, or referral\u2026";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") redraw(); });
    searchBar.appendChild(searchInput);
    bd.appendChild(searchBar);

    var filtered = all;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = all.filter(function (p) {
        return norm(p.idCard).indexOf(q) !== -1 || norm(p.name).indexOf(q) !== -1 || norm(p.campaignName).indexOf(q) !== -1 || norm(p.referral).indexOf(q) !== -1;
      });
    }

    if (filtered.length === 0) {
      var emptyP = document.createElement("div");
      emptyP.className = "empty";
      emptyP.innerHTML = '<div class="icon">\uD83D\uDC65</div><div class="msg">No participants found.</div>';
      bd.appendChild(emptyP);
    } else {
      var table = document.createElement("table");
      table.innerHTML = '<thead><tr><th>ID Card</th><th>Name</th><th>Campaign</th><th>Date</th><th>Category</th><th>Referral</th></tr></thead>';
      var tbody = document.createElement("tbody");
      filtered.forEach(function (p) {
        var catClass = norm(p.resultCategory || "").replace(/\s+/g, "");
        if (catClass === "requiresurgentattention") catClass = "urgent";
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td style="font-family:monospace;font-size:12px;letter-spacing:.5px">' + esc(p.idCard || "-") + '</td>' +
          '<td><strong>' + esc(p.name) + '</strong></td>' +
          '<td>' + esc(p.campaignName) + '</td>' +
          '<td>' + fmtDate(p.date) + '</td>' +
          '<td>' + (p.resultCategory ? '<span class="badge ' + catClass + '">' + esc(p.resultCategory) + '</span>' : '-') + '</td>' +
          '<td>' + esc(p.referral || "-") + '</td>';
        tr.addEventListener("click", function () { activeTab = "campaigns"; activeCampaignId = p.campaignId; redraw(); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── follow-ups tab ───────────────────────────────────────────────────────
  function renderFollowUps(container, redraw) {
    var all = getAllFollowUps();
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83D\uDDD3\uFE0F Follow-up Tracker (' + all.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.style.overflowX = "auto";

    // filter buttons
    var filterBar = document.createElement("div");
    filterBar.style.cssText = "display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap";
    var overdueAll = all.filter(function (f) { return isOverdue(f); });
    var filterStatuses = ["All", "Overdue"].concat(FOLLOW_UP_STATUS);
    var activeFilter = searchQ || "All";
    filterStatuses.forEach(function (st) {
      var b = document.createElement("button");
      b.className = "btn sm" + (activeFilter === st ? " pri" : "") + (st === "Overdue" && overdueAll.length > 0 ? " dn" : "");
      b.textContent = st + (st === "Overdue" ? " (" + overdueAll.length + ")" : "");
      b.addEventListener("click", function () { searchQ = st === "All" ? "" : st; redraw(); });
      filterBar.appendChild(b);
    });
    bd.appendChild(filterBar);

    var filtered = all;
    if (searchQ === "Overdue") {
      filtered = overdueAll;
    } else if (searchQ) {
      var q = norm(searchQ);
      filtered = all.filter(function (f) { return norm(f.status) === q; });
    }

    // sort by scheduled date
    filtered.sort(function (a, b) { return (a.scheduledDate || "").localeCompare(b.scheduledDate || ""); });

    if (filtered.length === 0) {
      var emptyFU = document.createElement("div");
      emptyFU.className = "empty";
      emptyFU.innerHTML = '<div class="icon">\uD83D\uDDD3\uFE0F</div><div class="msg">No follow-ups found.</div>';
      bd.appendChild(emptyFU);
    } else {
      var table = document.createElement("table");
      table.innerHTML = '<thead><tr><th>Participant</th><th>Campaign</th><th>Scheduled</th><th>Reason</th><th>Status</th><th>Notes</th></tr></thead>';
      var tbody = document.createElement("tbody");
      filtered.forEach(function (f) {
        var statusClass = norm(f.status || "pending");
        var overdueFlag = isOverdue(f);
        var badgeClass = overdueFlag ? "overdue" : (statusClass === "completed" ? "completed" : statusClass === "scheduled" ? "active" : statusClass === "no-show" ? "abnormal" : "planned");
        var badgeText = overdueFlag ? "Overdue" : esc(f.status || "Pending");
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><strong>' + esc(f.participantName) + '</strong></td>' +
          '<td>' + esc(f.campaignName) + '</td>' +
          '<td>' + fmtDate(f.scheduledDate) + '</td>' +
          '<td>' + esc(f.reason || "-") + '</td>' +
          '<td><span class="badge ' + badgeClass + '">' + badgeText + '</span></td>' +
          '<td>' + esc(f.notes || "-") + '</td>';
        tr.addEventListener("click", function () { activeTab = "campaigns"; activeCampaignId = f.campaignId; redraw(); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── summary tab ──────────────────────────────────────────────────────────
  function renderSummary(container, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83D\uDCCA Campaign Summary Report</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";

    if (campaigns.length === 0) {
      bd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDCCA</div><div class="msg">No campaigns to summarize.</div></div>';
      card.appendChild(bd);
      container.appendChild(card);
      return;
    }

    // overall summary
    var totalP = 0, totalAbn = 0, totalRef = 0, totalFU = 0;
    var byCampaign = [];

    campaigns.forEach(function (c) {
      var participants = c.participants || [];
      var pCount = participants.length;
      var abn = participants.filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
      var refs = participants.filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;
      var fus = 0;
      participants.forEach(function (p) { fus += (p.followUps || []).length; });

      totalP += pCount;
      totalAbn += abn;
      totalRef += refs;
      totalFU += fus;

      byCampaign.push({ name: c.name, type: c.type, status: getCampaignStatus(c), participants: pCount, abnormal: abn, referrals: refs, followUps: fus });
    });

    // overall KPIs
    var overallGrid = document.createElement("div");
    overallGrid.className = "summary-grid";
    var totalOverdue = getAllFollowUps().filter(function (f) { return isOverdue(f); }).length;
    var summaryKpis = [
      { l: "Total Campaigns", v: campaigns.length, color: "#4ea1ff" },
      { l: "Total Screened", v: totalP, color: "#7c6cff" },
      { l: "Abnormal Results", v: totalAbn, color: "#ffcc66" },
      { l: "Referrals Made", v: totalRef, color: "#ff6b9d" },
      { l: "Follow-ups", v: totalFU, color: "#2ee59d" },
      { l: "Overdue", v: totalOverdue, color: "#ff5050" },
      { l: "Abnormal Rate", v: (totalP ? Math.round(totalAbn / totalP * 100) : 0) + "%", color: "#a78bfa" },
      { l: "Referral Rate", v: (totalP ? Math.round(totalRef / totalP * 100) : 0) + "%", color: "#ff9ebe" }
    ];
    summaryKpis.forEach(function (k) {
      overallGrid.innerHTML += '<div class="summary-item"><div class="s-label">' + k.l + '</div><div class="s-value" style="color:' + k.color + '">' + k.v + '</div></div>';
    });
    bd.appendChild(overallGrid);

    // per-campaign breakdown
    var breakdownTitle = document.createElement("h4");
    breakdownTitle.style.cssText = "margin:20px 0 12px;font-size:14px;font-weight:800";
    breakdownTitle.textContent = "Per-Campaign Breakdown";
    bd.appendChild(breakdownTitle);

    var tableWrap = document.createElement("div");
    tableWrap.style.overflowX = "auto";
    var table = document.createElement("table");
    table.innerHTML = '<thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Screened</th><th>Abnormal</th><th>Referrals</th><th>Follow-ups</th></tr></thead>';
    var tbody = document.createElement("tbody");
    byCampaign.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td><strong>' + esc(r.name) + '</strong></td>' +
        '<td>' + esc(r.type) + '</td>' +
        '<td><span class="badge ' + norm(r.status) + '">' + esc(r.status) + '</span></td>' +
        '<td>' + r.participants + '</td>' +
        '<td>' + r.abnormal + '</td>' +
        '<td>' + r.referrals + '</td>' +
        '<td>' + r.followUps + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    bd.appendChild(tableWrap);

    // referral breakdown
    var refTitle = document.createElement("h4");
    refTitle.style.cssText = "margin:20px 0 12px;font-size:14px;font-weight:800";
    refTitle.textContent = "Referral Breakdown";
    bd.appendChild(refTitle);

    var refCounts = {};
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        var r = p.referral || "No referral needed";
        refCounts[r] = (refCounts[r] || 0) + 1;
      });
    });

    var refTableWrap = document.createElement("div");
    refTableWrap.style.overflowX = "auto";
    var refTable = document.createElement("table");
    refTable.innerHTML = '<thead><tr><th>Referral Type</th><th>Count</th><th>%</th><th style="min-width:120px"></th></tr></thead>';
    var refTbody = document.createElement("tbody");
    var maxRefCount = Math.max.apply(null, Object.values(refCounts).concat([1]));
    Object.keys(refCounts).sort(function (a, b) { return refCounts[b] - refCounts[a]; }).forEach(function (r) {
      var pctVal = totalP ? Math.round(refCounts[r] / totalP * 100) : 0;
      var barWidth = Math.round(refCounts[r] / maxRefCount * 100);
      var barColor = r === "No referral needed" ? "#2ee59d" : "#ff6b9d";
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + esc(r) + '</td>' +
        '<td>' + refCounts[r] + '</td>' +
        '<td>' + pctVal + '%</td>' +
        '<td><div class="stat-bar-wrap"><div class="stat-bar"><div class="stat-bar-fill" style="width:' + barWidth + '%;background:' + barColor + '"></div></div></div></td>';
      refTbody.appendChild(tr);
    });
    refTable.appendChild(refTbody);
    refTableWrap.appendChild(refTable);
    bd.appendChild(refTableWrap);

    // result category breakdown
    var catTitle = document.createElement("h4");
    catTitle.style.cssText = "margin:20px 0 12px;font-size:14px;font-weight:800";
    catTitle.textContent = "Result Category Breakdown";
    bd.appendChild(catTitle);

    var catCounts = {};
    var catColors = { "Normal": "#2ee59d", "Borderline": "#ffcc66", "Abnormal": "#ff6b9d", "Requires urgent attention": "#ff5050" };
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        var cat = p.resultCategory || "Uncategorised";
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      });
    });

    var catTableWrap = document.createElement("div");
    catTableWrap.style.overflowX = "auto";
    var catTable = document.createElement("table");
    catTable.innerHTML = '<thead><tr><th>Category</th><th>Count</th><th>%</th><th style="min-width:120px"></th></tr></thead>';
    var catTbody = document.createElement("tbody");
    var maxCatCount = Math.max.apply(null, Object.values(catCounts).concat([1]));
    Object.keys(catCounts).sort(function (a, b) { return catCounts[b] - catCounts[a]; }).forEach(function (cat) {
      var pctVal = totalP ? Math.round(catCounts[cat] / totalP * 100) : 0;
      var barWidth = Math.round(catCounts[cat] / maxCatCount * 100);
      var barColor = catColors[cat] || "#4ea1ff";
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + esc(cat) + '</td>' +
        '<td>' + catCounts[cat] + '</td>' +
        '<td>' + pctVal + '%</td>' +
        '<td><div class="stat-bar-wrap"><div class="stat-bar"><div class="stat-bar-fill" style="width:' + barWidth + '%;background:' + barColor + '"></div></div></div></td>';
      catTbody.appendChild(tr);
    });
    catTable.appendChild(catTbody);
    catTableWrap.appendChild(catTable);
    bd.appendChild(catTableWrap);

    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── campaign modal ───────────────────────────────────────────────────────
  function showCampaignModal(existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), name: "", type: CAMPAIGN_TYPES[0], startDate: todayStr(), endDate: "", notes: "", status: "Active", location: "", targetScreenings: "", participants: [] };

    var bodyHtml =
      '<div class="sc"><div class="fld" style="margin-bottom:14px"><label>Campaign Name</label><input type="text" id="sc-m-name" placeholder="e.g. Diabetes Awareness Week" value="' + esc(data.name) + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Type</label><select id="sc-m-type">' + CAMPAIGN_TYPES.map(function (t) { return '<option' + (t === data.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld"><label>Status</label><select id="sc-m-status"><option' + (data.status === "Active" ? ' selected' : '') + '>Active</option><option' + (data.status === "Cancelled" ? ' selected' : '') + '>Cancelled</option></select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Location / Venue</label><select id="sc-m-location"><option value="">-- Select --</option>' + CAMPAIGN_LOCATIONS.map(function (l) { return '<option' + (l === data.location ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld"><label>Target Screenings</label><input type="number" id="sc-m-target" placeholder="e.g. 50" min="0" value="' + esc(data.targetScreenings || "") + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Start Date</label><input type="date" id="sc-m-start" value="' + esc(data.startDate) + '"></div>' +
        '<div class="fld"><label>End Date</label><input type="date" id="sc-m-end" value="' + esc(data.endDate) + '"></div>' +
      '</div>' +
      '<div class="fld"><label>Notes</label><textarea id="sc-m-notes" placeholder="Campaign description, goals\u2026">' + esc(data.notes) + '</textarea></div></div>';

    var footerHtml = '<button class="btn close-cancel">Cancel</button><button class="btn pri" id="sc-m-save">Save Campaign</button>';

    var m = openModal(isEdit ? "Edit Campaign" : "New Campaign", bodyHtml, footerHtml);
    m.modal.querySelector(".close-cancel").addEventListener("click", m.close);

    m.modal.querySelector("#sc-m-save").addEventListener("click", function () {
      var name = m.modal.querySelector("#sc-m-name").value.trim();
      if (!name) { m.modal.querySelector("#sc-m-name").style.borderColor = "#ff5a7a"; return; }

      data.name = name;
      data.type = m.modal.querySelector("#sc-m-type").value;
      data.status = m.modal.querySelector("#sc-m-status").value;
      data.location = m.modal.querySelector("#sc-m-location").value;
      data.targetScreenings = m.modal.querySelector("#sc-m-target").value;
      data.startDate = m.modal.querySelector("#sc-m-start").value;
      data.endDate = m.modal.querySelector("#sc-m-end").value;
      data.notes = m.modal.querySelector("#sc-m-notes").value.trim();

      if (isEdit) {
        var idx = campaigns.findIndex(function (c) { return c.id === data.id; });
        if (idx !== -1) { data.participants = campaigns[idx].participants; campaigns[idx] = data; }
      } else {
        campaigns.push(data);
      }

      save();
      m.close();
      toast(isEdit ? "Campaign updated" : "Campaign created", "good");
      redraw();
    });

    // focus first field
    setTimeout(function () { var f = m.modal.querySelector("#sc-m-name"); if (f) f.focus(); }, 80);
  }

  // ── participant modal ────────────────────────────────────────────────────
  function showParticipantModal(campaign, existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), idCard: "", name: "", phone: "", email: "", dob: "", type: "Walk-in", date: todayStr(), resultNotes: "", resultCategory: "", referral: "No referral needed", referralNotes: "", poctResults: {}, followUps: [] };
    if (!data.poctResults) data.poctResults = {};

    var poctType = campaignPoctType(campaign.type);
    var poctDef = poctType ? POCT_FIELDS[poctType] : null;

    // Build POCT-specific fields HTML
    var poctFieldsHtml = "";
    if (poctDef) {
      var cols = Math.min(poctDef.fields.length, 3);
      poctFieldsHtml = '<div style="border-top:1px solid var(--bd);padding-top:14px;margin-bottom:14px">' +
        '<strong style="font-size:13px;color:var(--txt)">' + esc(poctDef.label) + '</strong> ' +
        '<span style="color:var(--mut);font-size:11px">(syncs to POCT records)</span></div>' +
        '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:12px;margin-bottom:14px">';
      poctDef.fields.forEach(function (f) {
        var val = data.poctResults[f.key] != null ? data.poctResults[f.key] : "";
        if (f.type === "select") {
          poctFieldsHtml += '<div class="fld"><label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
            '<select id="sc-poct-' + f.key + '">' +
            '<option value="">-- Select --</option>' +
            f.options.map(function (o) { return '<option' + (String(val) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join("") +
            '</select></div>';
        } else {
          poctFieldsHtml += '<div class="fld"><label>' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
            '<input type="number" id="sc-poct-' + f.key + '" placeholder="' + esc(f.placeholder || '') + '"' +
            (f.step ? ' step="' + f.step + '"' : '') +
            ' value="' + esc(val) + '"></div>';
        }
      });
      poctFieldsHtml += '</div>';
    }

    var bodyHtml =
      '<div class="sc"><div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>ID Card *</label><input type="text" id="sc-p-idcard" placeholder="e.g. 123456M" value="' + esc(data.idCard) + '" style="text-transform:uppercase" autocomplete="off"></div>' +
        '<div class="fld"><label>Full Name</label><input type="text" id="sc-p-name" placeholder="Auto-filled from POCT" value="' + esc(data.name) + '"></div>' +
        '<div class="fld"><label>Phone</label><input type="text" id="sc-p-phone" placeholder="+356\u2026" value="' + esc(data.phone) + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Date of Birth</label><input type="date" id="sc-p-dob" value="' + esc(data.dob) + '"></div>' +
        '<div class="fld"><label>Type</label><select id="sc-p-type">' + PARTICIPANT_TYPES.map(function (t) { return '<option' + (t === data.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld"><label>Screening Date</label><input type="date" id="sc-p-date" value="' + esc(data.date) + '"></div>' +
      '</div>' +
      poctFieldsHtml +
      '<div style="border-top:1px solid var(--bd);padding-top:14px;margin-bottom:14px"><strong style="font-size:13px;color:var(--txt)">Assessment</strong></div>' +
      '<div class="fld" style="margin-bottom:14px"><label>Result Notes</label><textarea id="sc-p-result" placeholder="Describe screening results\u2026">' + esc(data.resultNotes) + '</textarea></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Result Category</label><select id="sc-p-cat"><option value="">-- Select --</option>' + RESULT_CATEGORIES.map(function (c) { return '<option' + (c === data.resultCategory ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld"><label>Referral</label><select id="sc-p-ref">' + REFERRAL_OPTIONS.map(function (r) { return '<option' + (r === data.referral ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      '<div class="fld"><label>Referral Notes</label><textarea id="sc-p-refnotes" placeholder="Additional referral details\u2026">' + esc(data.referralNotes) + '</textarea></div></div>';

    var footerHtml = '<button class="btn close-cancel">Cancel</button><button class="btn pri" id="sc-p-save">Save Participant</button>';

    var m = openModal(isEdit ? "Edit Participant" : "Add Participant", bodyHtml, footerHtml);
    m.modal.querySelector(".close-cancel").addEventListener("click", m.close);

    // BMI auto-calculation for BMI campaigns
    if (poctType === "bmi") {
      setTimeout(function () {
        var wEl = m.modal.querySelector("#sc-poct-weight");
        var hEl = m.modal.querySelector("#sc-poct-height");
        var bmiEl = m.modal.querySelector("#sc-poct-bmi");
        var catEl = m.modal.querySelector("#sc-poct-category");
        function autoBmi() {
          if (!wEl || !hEl || !bmiEl) return;
          var w = parseFloat(wEl.value), h = parseFloat(hEl.value);
          if (w > 0 && h > 0) {
            var bmiVal = (w / ((h / 100) * (h / 100))).toFixed(1);
            bmiEl.value = bmiVal;
            if (catEl) {
              var v = parseFloat(bmiVal);
              var cat = v < 18.5 ? "Underweight" : v < 25 ? "Normal" : v < 30 ? "Overweight" : v < 35 ? "Obese I" : v < 40 ? "Obese II" : "Obese III";
              catEl.value = cat;
            }
          }
        }
        if (wEl) wEl.addEventListener("input", autoBmi);
        if (hEl) hEl.addEventListener("input", autoBmi);
      }, 100);
    }

    m.modal.querySelector("#sc-p-save").addEventListener("click", function () {
      var rawId = m.modal.querySelector("#sc-p-idcard").value.trim();
      var pid = normalizePatientId(rawId);
      var name = m.modal.querySelector("#sc-p-name").value.trim();
      // Require at least ID card or name
      if (!pid && !name) {
        if (!rawId) m.modal.querySelector("#sc-p-idcard").style.borderColor = "#ff5a7a";
        if (!name) m.modal.querySelector("#sc-p-name").style.borderColor = "#ff5a7a";
        return;
      }

      // Collect POCT result fields
      var poctResults = {};
      if (poctDef) {
        var hasRequired = true;
        poctDef.fields.forEach(function (f) {
          var el = m.modal.querySelector("#sc-poct-" + f.key);
          if (!el) return;
          var v = el.value.trim();
          if (f.required && !v) {
            el.style.borderColor = "#ff5a7a";
            hasRequired = false;
          }
          if (f.type === "number" && v) {
            poctResults[f.key] = parseFloat(v);
          } else {
            poctResults[f.key] = v;
          }
        });
        if (!hasRequired) {
          toast("Please fill in the required POCT fields", "warn");
          return;
        }
      }

      data.idCard = pid || rawId;
      data.name = name;
      data.phone = m.modal.querySelector("#sc-p-phone").value.trim();
      data.dob = m.modal.querySelector("#sc-p-dob").value;
      data.type = m.modal.querySelector("#sc-p-type").value;
      data.date = m.modal.querySelector("#sc-p-date").value;
      data.poctResults = poctResults;
      data.resultNotes = m.modal.querySelector("#sc-p-result").value.trim();
      data.resultCategory = m.modal.querySelector("#sc-p-cat").value;
      data.referral = m.modal.querySelector("#sc-p-ref").value;
      data.referralNotes = m.modal.querySelector("#sc-p-refnotes").value.trim();

      if (!campaign.participants) campaign.participants = [];

      if (isEdit) {
        var idx = campaign.participants.findIndex(function (p) { return p.id === data.id; });
        if (idx !== -1) { data.followUps = campaign.participants[idx].followUps; campaign.participants[idx] = data; }
      } else {
        data.followUps = [];
        campaign.participants.push(data);
      }

      // Sync to POCT cloud (patient master + screening record)
      try { pushToPoctCloud(data, campaign); } catch (e) { /* POCT not loaded yet, ok */ }

      // Also keep cross-module patient memory
      var pName = data.name.trim();
      if (pName) E._eikon_patients[norm(pName)] = pName;

      save();
      m.close();
      toast(isEdit ? "Participant updated" : "Participant added", "good");
      redraw();
    });

    // ID card: auto-normalize, autosuggest from POCT patients, autofill on blur/select
    setTimeout(function () {
      var idInput = m.modal.querySelector("#sc-p-idcard");
      var nameEl = m.modal.querySelector("#sc-p-name");
      var phoneEl = m.modal.querySelector("#sc-p-phone");
      var dobEl = m.modal.querySelector("#sc-p-dob");
      if (!idInput) return;

      // Auto-uppercase + normalize on input
      idInput.addEventListener("input", function () {
        var raw = idInput.value;
        var up = raw.toUpperCase();
        if (up !== raw) {
          var s0 = idInput.selectionStart, e0 = idInput.selectionEnd;
          idInput.value = up;
          try { idInput.setSelectionRange(s0, e0); } catch (e) {}
        }
        var mm = up.trim().replace(/\s+/g, "").match(/^(\d{1,7})([A-Z])$/);
        if (mm) {
          var padded = mm[1].padStart(7, "0") + mm[2];
          if (padded !== up.trim().replace(/\s+/g, "")) {
            idInput.value = padded;
          }
        }
      });

      // Autofill from POCT patient on blur
      idInput.addEventListener("blur", function () {
        var pid = normalizePatientId(idInput.value);
        if (!pid) return;
        idInput.value = pid;
        var pat = getPoctPatientById(pid);
        if (!pat) return;
        if (nameEl && !nameEl.value.trim() && pat.name) nameEl.value = pat.name;
        if (phoneEl && !phoneEl.value.trim() && pat.phone) phoneEl.value = pat.phone;
      });

      // Autosuggest dropdown for ID card (search POCT patients)
      attachAutocomplete(idInput, function (query) {
        var results = searchPoctPatients(query);
        return results.map(function (p) { return p.patientId + " \u2014 " + (p.name || "Unknown"); });
      }, function (selected) {
        // Extract patient ID from "0123456M — Name" format
        var pid = selected.split(" \u2014 ")[0].trim();
        idInput.value = pid;
        var pat = getPoctPatientById(pid);
        if (pat) {
          if (nameEl) nameEl.value = pat.name || "";
          if (phoneEl) phoneEl.value = pat.phone || "";
        }
      });

      idInput.focus();
    }, 80);
  }

  // ── follow-up modal ──────────────────────────────────────────────────────
  function showFollowUpModal(campaign, participant, existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), scheduledDate: "", reason: "", status: "Pending", notes: "" };

    var bodyHtml =
      '<div class="sc"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Scheduled Date *</label><input type="date" id="sc-f-date" value="' + esc(data.scheduledDate) + '"></div>' +
        '<div class="fld"><label>Status</label><select id="sc-f-status">' + FOLLOW_UP_STATUS.map(function (s) { return '<option' + (s === data.status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      '<div class="fld" style="margin-bottom:14px"><label>Reason</label><input type="text" id="sc-f-reason" placeholder="e.g. Re-test blood pressure, GP referral follow-up" value="' + esc(data.reason) + '"></div>' +
      '<div class="fld"><label>Notes</label><textarea id="sc-f-notes" placeholder="Additional notes\u2026">' + esc(data.notes) + '</textarea></div></div>';

    var footerHtml = '<button class="btn close-cancel">Cancel</button>' +
      (isEdit ? '<button class="btn dn" id="sc-f-del">Delete</button>' : '') +
      '<button class="btn pri" id="sc-f-save">Save Follow-up</button>';

    var m = openModal((isEdit ? "Edit" : "Schedule") + " Follow-up \u2014 " + esc(participant.name), bodyHtml, footerHtml);
    m.modal.querySelector(".close-cancel").addEventListener("click", m.close);

    if (isEdit) {
      m.modal.querySelector("#sc-f-del").addEventListener("click", function () {
        if (!confirm("Delete this follow-up?")) return;
        participant.followUps = (participant.followUps || []).filter(function (f) { return f.id !== data.id; });
        save();
        m.close();
        toast("Follow-up deleted", "warn");
        redraw();
      });
    }

    m.modal.querySelector("#sc-f-save").addEventListener("click", function () {
      var scheduledDate = m.modal.querySelector("#sc-f-date").value;
      if (!scheduledDate) { m.modal.querySelector("#sc-f-date").style.borderColor = "#ff5a7a"; return; }

      data.scheduledDate = scheduledDate;
      data.status = m.modal.querySelector("#sc-f-status").value;
      data.reason = m.modal.querySelector("#sc-f-reason").value.trim();
      data.notes = m.modal.querySelector("#sc-f-notes").value.trim();

      if (!participant.followUps) participant.followUps = [];

      if (isEdit) {
        var idx = participant.followUps.findIndex(function (f) { return f.id === data.id; });
        if (idx !== -1) participant.followUps[idx] = data;
      } else {
        participant.followUps.push(data);
      }

      save();
      m.close();
      toast(isEdit ? "Follow-up updated" : "Follow-up scheduled", "good");
      redraw();
    });

    setTimeout(function () { var f = m.modal.querySelector("#sc-f-date"); if (f) f.focus(); }, 80);
  }

  // ── register ─────────────────────────────────────────────────────────────
  E.registerModule({
    id: "screening",
    title: "Screening Campaigns",
    icon: "\uD83E\uDE7A",
    order: 70,
    render: render
  });

})();
