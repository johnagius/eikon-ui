/* ui/modules.pharmacovigilance.js
   Eikon – Pharmacovigilance (ADR Reporting) module

   EU/Malta-compliant ADR reporting (EMA / MPA standards).
   Uses simple cloud state sync via GET/PUT /pharmacovigilance/state.

   Endpoints:
     GET  /pharmacovigilance/state
     PUT  /pharmacovigilance/state
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ── helpers ────────────────────────────────────────────────────────────
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function uid() { return "pv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
  function nowLocal() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function fmtDate(v) {
    if (!v) return "-";
    var d = new Date(v); if (isNaN(d)) return String(v);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  async function api(method, path, body) {
    var o = { method: method };
    if (body !== undefined) { o.headers = { "Content-Type": "application/json" }; o.body = JSON.stringify(body); }
    return E.apiFetch(path, o);
  }

  // ── cloud store ────────────────────────────────────────────────────────
  var reports = [];
  var dirty = false;
  var syncing = false;

  async function cloudLoad() {
    try {
      var r = await api("GET", "/pharmacovigilance/state");
      reports = Array.isArray(r.reports) ? r.reports : (r.state && Array.isArray(r.state.reports) ? r.state.reports : []);
    } catch (e) { E.warn("[pv] cloudLoad error", e); }
  }

  async function cloudSave() {
    if (syncing) return;
    syncing = true;
    try { await api("PUT", "/pharmacovigilance/state", { state: { reports: reports } }); dirty = false; }
    catch (e) { E.warn("[pv] cloudSave error", e); }
    finally { syncing = false; }
  }

  function save() { dirty = true; cloudSave(); }

  // ── severity helpers ───────────────────────────────────────────────────
  var SERIOUSNESS = ["Non-serious", "Serious – Hospitalisation", "Serious – Life-threatening", "Serious – Disability", "Serious – Congenital anomaly", "Serious – Other medically important", "Fatal"];
  var OUTCOMES = ["Recovered", "Recovering", "Not recovered", "Recovered with sequelae", "Fatal", "Unknown"];
  var CAUSALITY = ["Certain", "Probable/Likely", "Possible", "Unlikely", "Conditional/Unclassified", "Unassessable"];
  var REPORT_TYPES = ["Initial", "Follow-up", "Final"];
  var STATUS_LIST = ["Draft", "Submitted to MPA", "Submitted to EMA (EudraVigilance)", "Closed"];

  // ── styles ─────────────────────────────────────────────────────────────
  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return; stylesDone = true;
    var s = document.createElement("style"); s.id = "eikon-pv-style";
    s.textContent = [
      ".pv{--ac:#6c8cff;--ac2:#a78bfa;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.03);--bd:rgba(255,255,255,.10);--r:16px;--r2:12px;--txt:#e8eefc;--mut:rgba(170,183,214,.78);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--txt);margin:-14px}",
      ".pv *{box-sizing:border-box}",
      ".pv .hero{position:relative;border-radius:20px;border:1px solid var(--bd);overflow:hidden;padding:20px 22px 16px;margin-bottom:16px;background:linear-gradient(135deg,rgba(108,140,255,.16),rgba(167,139,250,.10),rgba(46,229,157,.06));box-shadow:0 14px 40px rgba(0,0,0,.3)}",
      ".pv .hero h2{margin:0 0 2px;font-size:20px;font-weight:900;letter-spacing:.3px}",
      ".pv .hero .sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}",
      ".pv .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}",
      ".pv .kpi{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);padding:14px;text-align:center}",
      ".pv .kpi .n{font-size:28px;font-weight:900;letter-spacing:.3px}",
      ".pv .kpi .l{font-size:11.5px;color:var(--mut);margin-top:3px}",
      ".pv .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}",
      ".pv .tab{padding:9px 14px;border-radius:var(--r2);border:1px solid var(--bd);background:var(--pnl);color:var(--txt);cursor:pointer;font-size:13px;font-weight:700;transition:transform .08s,background .15s,border-color .15s}",
      ".pv .tab:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}",
      ".pv .tab:active{transform:translateY(1px)}",
      ".pv .tab.on{background:rgba(108,140,255,.16);border-color:rgba(108,140,255,.55)}",
      ".pv .card{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);box-shadow:0 10px 28px rgba(0,0,0,.25);overflow:hidden;margin-bottom:14px}",
      ".pv .card .hd{padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:10px}",
      ".pv .card .hd h3{margin:0;font-size:14px;font-weight:800}",
      ".pv .card .bd{padding:16px}",
      ".pv .row{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}",
      ".pv .fld{display:flex;flex-direction:column;gap:5px}",
      ".pv .fld label{color:var(--mut);font-size:12px;font-weight:600}",
      ".pv .fld input,.pv .fld select,.pv .fld textarea{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.18);color:var(--txt);padding:9px 10px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .15s,box-shadow .15s}",
      ".pv .fld input:focus,.pv .fld select:focus,.pv .fld textarea:focus{border-color:rgba(108,140,255,.6);box-shadow:0 0 0 3px rgba(108,140,255,.12)}",
      ".pv .fld textarea{min-height:64px;resize:vertical;line-height:1.35}",
      ".pv .fld .hint{font-size:11px;color:var(--mut);margin-top:-2px}",
      ".pv .fld input::placeholder,.pv .fld textarea::placeholder{color:rgba(170,183,214,.5)}",
      ".pv .hr{height:1px;background:var(--bd);margin:14px 0}",
      ".pv .btn{border:1px solid var(--bd);background:var(--pnl);color:var(--txt);padding:9px 14px;border-radius:var(--r2);cursor:pointer;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:8px;transition:transform .08s,background .15s,border-color .15s}",
      ".pv .btn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}",
      ".pv .btn:active{transform:translateY(1px)}",
      ".pv .btn.pr{background:rgba(108,140,255,.16);border-color:rgba(108,140,255,.55)}",
      ".pv .btn.gd{background:rgba(46,229,157,.12);border-color:rgba(46,229,157,.55)}",
      ".pv .btn.dn{background:rgba(255,92,122,.12);border-color:rgba(255,92,122,.55)}",
      ".pv .btn.sm{padding:6px 10px;font-size:12px;border-radius:10px}",
      ".pv .tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}",
      ".pv .tbl th{position:sticky;top:0;background:rgba(11,18,32,.95);backdrop-filter:blur(6px);padding:9px 10px;text-align:left;font-size:11.5px;color:var(--mut);border-bottom:1px solid var(--bd);white-space:nowrap;z-index:2}",
      ".pv .tbl td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:top}",
      ".pv .tbl tr:hover td{background:rgba(255,255,255,.03)}",
      ".pv .twrap{border:1px solid var(--bd);border-radius:var(--r);overflow:auto;background:rgba(0,0,0,.12);max-height:55vh}",
      ".pv .tag{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--bd);font-size:11px;white-space:nowrap}",
      ".pv .tag.s{border-color:rgba(255,107,157,.45);background:rgba(255,107,157,.10);color:#ffd6e4}",
      ".pv .tag.ok{border-color:rgba(46,229,157,.45);background:rgba(46,229,157,.10);color:#c8ffec}",
      ".pv .tag.w{border-color:rgba(255,204,102,.45);background:rgba(255,204,102,.10);color:#ffeec8}",
      ".pv .tag.d{border-color:rgba(108,140,255,.45);background:rgba(108,140,255,.10);color:#d0dbff}",
      ".pv .toast{position:fixed;left:50%;bottom:18px;transform:translate(-50%,12px);opacity:0;z-index:99999;padding:10px 14px;border-radius:14px;border:1px solid var(--bd);background:rgba(11,18,32,.85);backdrop-filter:blur(10px);color:var(--txt);font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.45);transition:opacity .25s,transform .25s}",
      ".pv .toast.show{opacity:1;transform:translate(-50%,0)}",
      ".pv .empty{text-align:center;padding:32px 14px;color:var(--mut);font-size:13px}",
      ".pv .badge{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid var(--bd);background:rgba(255,255,255,.04)}",
      ".pv .step-bar{display:flex;gap:0;margin-bottom:18px}",
      ".pv .step{flex:1;text-align:center;padding:10px 6px;font-size:12px;font-weight:700;border-bottom:3px solid rgba(255,255,255,.08);color:var(--mut);cursor:pointer;transition:color .15s,border-color .15s}",
      ".pv .step.active{color:var(--txt);border-color:var(--ac)}",
      ".pv .step.done{color:var(--gd);border-color:var(--gd)}",
      ".pv .sec{display:none}.pv .sec.vis{display:block}",
      "@media(max-width:900px){.pv .row{grid-template-columns:repeat(6,1fr)}}",
      "@media print{.pv{background:#fff;color:#111}.pv .hero,.pv .tabs,.pv .toast{display:none!important}.pv .card{box-shadow:none;border:1px solid #ddd}.pv .tbl th{background:#f5f5f5;color:#333}.pv .tbl td{border-color:#eee}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  // ── toast ──────────────────────────────────────────────────────────────
  function toast(msg) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    var root = document.querySelector(".pv") || document.body;
    root.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 20);
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { try { t.remove(); } catch (e) {} }, 300); }, 2200);
  }

  // ── build select options ───────────────────────────────────────────────
  function opts(arr, selected) {
    return arr.map(function (v) { return '<option value="' + esc(v) + '"' + (v === selected ? " selected" : "") + '>' + esc(v) + '</option>'; }).join("");
  }

  // ── form step wizard ───────────────────────────────────────────────────
  var STEPS = [
    { key: "patient", label: "Patient" },
    { key: "drug", label: "Suspected Drug(s)" },
    { key: "reaction", label: "Reaction / ADR" },
    { key: "reporter", label: "Reporter" },
    { key: "review", label: "Review & Submit" }
  ];

  // ── main render ────────────────────────────────────────────────────────
  var ROOT;
  var currentTab = "list"; // list | form
  var editId = null;
  var formStep = 0;
  var formData = {};

  function newFormData() {
    return {
      id: uid(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "Draft",
      report_type: "Initial",
      // Patient
      pt_initials: "", pt_age: "", pt_sex: "", pt_weight: "", pt_height: "",
      pt_dob: "", pt_id: "", pt_medical_history: "",
      // Drugs (array of {name, dose, route, frequency, start_date, stop_date, indication, batch_no, mah})
      drugs: [{ name: "", dose: "", route: "Oral", frequency: "", start_date: "", stop_date: "", indication: "", batch_no: "", mah: "" }],
      // Reaction
      reaction_description: "", reaction_start: "", reaction_stop: "",
      reaction_seriousness: "Non-serious", reaction_outcome: "Unknown",
      reaction_causality: "Possible", reaction_meddra: "",
      // Reporter
      reporter_name: "", reporter_qualification: "Pharmacist", reporter_email: "",
      reporter_phone: "", reporter_institution: "", reporter_address: "",
      report_date: nowLocal(),
      // Notes
      notes: ""
    };
  }

  async function render(ctx) {
    ensureStyles();
    ROOT = ctx.mount;
    ROOT.innerHTML = '<div class="pv"><div id="pv-app"></div></div>';
    await cloudLoad();
    renderApp();
  }

  function renderApp() {
    var app = document.getElementById("pv-app");
    if (!app) return;

    // KPIs
    var total = reports.length;
    var drafts = reports.filter(function (r) { return r.status === "Draft"; }).length;
    var submitted = reports.filter(function (r) { return r.status && r.status.indexOf("Submitted") === 0; }).length;
    var serious = reports.filter(function (r) { return r.reaction_seriousness && r.reaction_seriousness.indexOf("Serious") === 0; }).length;

    var h = '';
    // Hero header
    h += '<div class="hero">';
    h += '<h2>Pharmacovigilance</h2>';
    h += '<div class="sub">Adverse Drug Reaction Reporting &bull; EU/Malta MPA Compliant &bull; Cloud-synced</div>';
    h += '<div class="kpi-row">';
    h += '<div class="kpi"><div class="n" style="color:var(--ac)">' + total + '</div><div class="l">Total Reports</div></div>';
    h += '<div class="kpi"><div class="n" style="color:var(--wn)">' + drafts + '</div><div class="l">Drafts</div></div>';
    h += '<div class="kpi"><div class="n" style="color:var(--gd)">' + submitted + '</div><div class="l">Submitted</div></div>';
    h += '<div class="kpi"><div class="n" style="color:var(--pk)">' + serious + '</div><div class="l">Serious</div></div>';
    h += '</div>';
    h += '<div class="tabs">';
    h += '<div class="tab' + (currentTab === "list" ? " on" : "") + '" data-pv-tab="list">All Reports</div>';
    h += '<div class="tab' + (currentTab === "form" ? " on" : "") + '" data-pv-tab="form">' + (editId ? "Edit Report" : "New Report") + '</div>';
    h += '</div>';
    h += '</div>';

    // Content
    h += '<div id="pv-content"></div>';
    app.innerHTML = h;

    // Tab clicks
    app.querySelectorAll("[data-pv-tab]").forEach(function (el) {
      el.addEventListener("click", function () {
        var t = el.getAttribute("data-pv-tab");
        if (t === "form" && currentTab !== "form") { editId = null; formStep = 0; formData = newFormData(); }
        currentTab = t;
        renderApp();
      });
    });

    if (currentTab === "list") renderList();
    else renderForm();
  }

  // ── list view ──────────────────────────────────────────────────────────
  function renderList() {
    var c = document.getElementById("pv-content");
    if (!c) return;

    var h = '<div class="card"><div class="hd"><h3>ADR Reports</h3>';
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    h += '<input class="btn sm" id="pv-search" type="text" placeholder="Search..." style="width:200px;background:rgba(0,0,0,.18);border:1px solid var(--bd);color:var(--txt);padding:7px 10px;border-radius:10px;font-size:12px;outline:none" />';
    h += '<button class="btn pr sm" id="pv-new">+ New Report</button>';
    h += '</div></div><div class="bd">';

    if (!reports.length) {
      h += '<div class="empty">No ADR reports yet. Click <b>+ New Report</b> to get started.</div>';
    } else {
      h += '<div class="twrap"><table class="tbl"><thead><tr>';
      h += '<th>Date</th><th>Patient</th><th>Drug(s)</th><th>Reaction</th><th>Seriousness</th><th>Status</th><th>Actions</th>';
      h += '</tr></thead><tbody id="pv-tbody"></tbody></table></div>';
    }
    h += '</div></div>';
    c.innerHTML = h;

    if (reports.length) fillTable("");

    // Bind search
    var si = document.getElementById("pv-search");
    if (si) si.addEventListener("input", function () { fillTable(si.value); });

    // New report button
    var nb = document.getElementById("pv-new");
    if (nb) nb.addEventListener("click", function () { editId = null; formStep = 0; formData = newFormData(); currentTab = "form"; renderApp(); });
  }

  function fillTable(q) {
    var tb = document.getElementById("pv-tbody");
    if (!tb) return;
    q = norm(q);
    var sorted = reports.slice().sort(function (a, b) { return (b.report_date || b.created_at || "").localeCompare(a.report_date || a.created_at || ""); });
    var rows = sorted.filter(function (r) {
      if (!q) return true;
      var hay = [r.pt_initials, r.reaction_description, r.status, r.reporter_name, r.reaction_seriousness]
        .concat((r.drugs || []).map(function (d) { return d.name; })).join(" ");
      return norm(hay).indexOf(q) >= 0;
    });

    if (!rows.length) { tb.innerHTML = '<tr><td colspan="7" style="color:var(--mut);text-align:center;padding:18px">No matching reports.</td></tr>'; return; }

    tb.innerHTML = rows.map(function (r) {
      var drugs = (r.drugs || []).map(function (d) { return esc(d.name || "?"); }).join(", ");
      var ser = r.reaction_seriousness || "";
      var tagCls = ser.indexOf("Serious") === 0 ? "s" : (ser === "Non-serious" ? "ok" : "w");
      var stCls = r.status === "Draft" ? "w" : (r.status === "Closed" ? "d" : "ok");
      return '<tr>' +
        '<td style="white-space:nowrap">' + esc(fmtDate(r.report_date || r.created_at)) + '</td>' +
        '<td><b>' + esc(r.pt_initials || "-") + '</b><br><span style="font-size:11px;color:var(--mut)">' + esc(r.pt_sex || "") + (r.pt_age ? " " + r.pt_age + "y" : "") + '</span></td>' +
        '<td>' + (drugs || '<span style="color:var(--mut)">-</span>') + '</td>' +
        '<td style="max-width:200px">' + esc(r.reaction_description || "-").slice(0, 80) + '</td>' +
        '<td><span class="tag ' + tagCls + '">' + esc(ser) + '</span></td>' +
        '<td><span class="tag ' + stCls + '">' + esc(r.status || "Draft") + '</span></td>' +
        '<td style="white-space:nowrap"><button class="btn sm" data-pv-edit="' + esc(r.id) + '">Edit</button> <button class="btn sm dn" data-pv-del="' + esc(r.id) + '">Del</button></td>' +
        '</tr>';
    }).join("");

    // bind edit/delete
    tb.querySelectorAll("[data-pv-edit]").forEach(function (b) {
      b.addEventListener("click", function () { startEdit(b.getAttribute("data-pv-edit")); });
    });
    tb.querySelectorAll("[data-pv-del]").forEach(function (b) {
      b.addEventListener("click", function () { deleteReport(b.getAttribute("data-pv-del")); });
    });
  }

  function startEdit(id) {
    var r = reports.find(function (x) { return x.id === id; });
    if (!r) return;
    editId = id;
    formData = JSON.parse(JSON.stringify(r));
    if (!Array.isArray(formData.drugs) || !formData.drugs.length) formData.drugs = [{ name: "", dose: "", route: "Oral", frequency: "", start_date: "", stop_date: "", indication: "", batch_no: "", mah: "" }];
    formStep = 0;
    currentTab = "form";
    renderApp();
  }

  function deleteReport(id) {
    if (!confirm("Delete this ADR report permanently?")) return;
    reports = reports.filter(function (r) { return r.id !== id; });
    save();
    toast("Report deleted");
    renderApp();
  }

  // ── form wizard ────────────────────────────────────────────────────────
  function renderForm() {
    var c = document.getElementById("pv-content");
    if (!c) return;

    var h = '';

    // Step bar
    h += '<div class="card"><div class="bd"><div class="step-bar">';
    STEPS.forEach(function (s, i) {
      var cls = i === formStep ? "active" : (i < formStep ? "done" : "");
      h += '<div class="step ' + cls + '" data-pv-step="' + i + '">' + (i + 1) + '. ' + esc(s.label) + '</div>';
    });
    h += '</div>';

    // Step content
    h += '<div id="pv-step-body"></div>';

    // Navigation buttons
    h += '<div class="hr"></div>';
    h += '<div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap">';
    h += '<div>';
    if (formStep > 0) h += '<button class="btn" id="pv-prev">Back</button>';
    h += '</div><div style="display:flex;gap:10px">';
    h += '<button class="btn" id="pv-cancel">Cancel</button>';
    if (formStep < STEPS.length - 1) h += '<button class="btn pr" id="pv-next">Next Step</button>';
    else h += '<button class="btn gd" id="pv-submit">Save Report</button>';
    h += '</div></div>';

    h += '</div></div>';
    c.innerHTML = h;

    // Render current step content
    renderStepBody();

    // Bind step bar clicks
    c.querySelectorAll("[data-pv-step]").forEach(function (el) {
      el.addEventListener("click", function () {
        collectStepData();
        formStep = parseInt(el.getAttribute("data-pv-step"), 10);
        renderForm();
      });
    });

    // Bind nav
    var prev = document.getElementById("pv-prev");
    var next = document.getElementById("pv-next");
    var cancel = document.getElementById("pv-cancel");
    var submit = document.getElementById("pv-submit");

    if (prev) prev.addEventListener("click", function () { collectStepData(); formStep--; renderForm(); });
    if (next) next.addEventListener("click", function () { collectStepData(); formStep++; renderForm(); });
    if (cancel) cancel.addEventListener("click", function () { currentTab = "list"; renderApp(); });
    if (submit) submit.addEventListener("click", doSubmit);
  }

  function renderStepBody() {
    var sb = document.getElementById("pv-step-body");
    if (!sb) return;
    var key = STEPS[formStep].key;
    var h = '';

    if (key === "patient") {
      h += '<h3 style="margin:0 0 12px;font-size:15px">Patient Information</h3>';
      h += '<div class="row">';
      h += field(3, "pt_initials", "Patient Initials", "text", "e.g. J.D.", "Use initials only – no full names for privacy");
      h += field(2, "pt_age", "Age", "number", "e.g. 65");
      h += field(2, "pt_sex", "Sex", "select", "", "", ["", "Male", "Female", "Other"]);
      h += field(2, "pt_weight", "Weight (kg)", "number", "e.g. 78");
      h += field(3, "pt_height", "Height (cm)", "number", "e.g. 175");
      h += field(3, "pt_dob", "Date of Birth", "date");
      h += field(3, "pt_id", "Patient ID (optional)", "text", "ID card / passport");
      h += field(6, "pt_medical_history", "Relevant Medical History", "textarea", "Allergies, conditions, past ADRs...");
      h += '</div>';
    } else if (key === "drug") {
      h += '<h3 style="margin:0 0 4px;font-size:15px">Suspected Drug(s)</h3>';
      h += '<div style="font-size:12px;color:var(--mut);margin-bottom:12px">Add all suspected and concomitant medicines.</div>';
      h += '<div id="pv-drugs"></div>';
      h += '<button class="btn sm" id="pv-add-drug" style="margin-top:10px">+ Add Drug</button>';
    } else if (key === "reaction") {
      h += '<h3 style="margin:0 0 12px;font-size:15px">Adverse Reaction Details</h3>';
      h += '<div class="row">';
      h += field(12, "reaction_description", "Reaction Description", "textarea", "Describe the adverse reaction in detail...", "Include onset, symptoms, course, and any relevant lab results");
      h += field(3, "reaction_start", "Reaction Start", "datetime-local");
      h += field(3, "reaction_stop", "Reaction Stop", "datetime-local");
      h += field(3, "reaction_seriousness", "Seriousness", "select", "", "", SERIOUSNESS);
      h += field(3, "reaction_outcome", "Outcome", "select", "", "", OUTCOMES);
      h += field(3, "reaction_causality", "Causality (WHO-UMC)", "select", "", "Assessment of causal relationship", CAUSALITY);
      h += field(3, "reaction_meddra", "MedDRA Term (optional)", "text", "e.g. Rash, Nausea...");
      h += field(3, "report_type", "Report Type", "select", "", "", REPORT_TYPES);
      h += field(3, "status", "Report Status", "select", "", "", STATUS_LIST);
      h += '</div>';
    } else if (key === "reporter") {
      h += '<h3 style="margin:0 0 12px;font-size:15px">Reporter Information</h3>';
      h += '<div class="row">';
      h += field(4, "reporter_name", "Reporter Name", "text", "Your full name");
      h += field(4, "reporter_qualification", "Qualification", "select", "", "", ["Pharmacist", "Physician", "Nurse", "Patient/Consumer", "Other Healthcare Professional"]);
      h += field(4, "reporter_email", "Email", "email", "email@example.com");
      h += field(4, "reporter_phone", "Phone", "tel", "+356 ...");
      h += field(4, "reporter_institution", "Pharmacy / Institution", "text", "Name of pharmacy");
      h += field(4, "reporter_address", "Address", "text", "Business address");
      h += field(12, "notes", "Additional Notes", "textarea", "Any additional information...");
      h += '</div>';
    } else if (key === "review") {
      h += renderReview();
    }

    sb.innerHTML = h;

    // Bind drug step
    if (key === "drug") renderDrugs();

    // Set field values from formData
    sb.querySelectorAll("[data-pv-field]").forEach(function (el) {
      var k = el.getAttribute("data-pv-field");
      if (formData[k] != null) el.value = String(formData[k]);
    });
  }

  function field(span, key, label, type, placeholder, hint, selectOptions) {
    var h = '<div class="fld" style="grid-column:span ' + span + '">';
    h += '<label>' + esc(label) + '</label>';
    if (type === "select") {
      h += '<select data-pv-field="' + key + '">';
      (selectOptions || []).forEach(function (v) {
        h += '<option value="' + esc(v) + '"' + (formData[key] === v ? ' selected' : '') + '>' + esc(v || "– Select –") + '</option>';
      });
      h += '</select>';
    } else if (type === "textarea") {
      h += '<textarea data-pv-field="' + key + '" placeholder="' + esc(placeholder || "") + '">' + esc(formData[key] || "") + '</textarea>';
    } else {
      h += '<input type="' + type + '" data-pv-field="' + key + '" placeholder="' + esc(placeholder || "") + '" value="' + esc(formData[key] || "") + '" />';
    }
    if (hint) h += '<div class="hint">' + esc(hint) + '</div>';
    h += '</div>';
    return h;
  }

  // ── drug sub-form ──────────────────────────────────────────────────────
  function renderDrugs() {
    var wrap = document.getElementById("pv-drugs");
    if (!wrap) return;
    var drugs = formData.drugs || [];
    wrap.innerHTML = drugs.map(function (d, i) {
      var h = '<div class="card" style="margin-bottom:10px"><div class="hd"><h3>Drug #' + (i + 1) + '</h3>';
      if (drugs.length > 1) h += '<button class="btn sm dn" data-pv-rm-drug="' + i + '">Remove</button>';
      h += '</div><div class="bd"><div class="row">';
      h += drugField(i, 4, "name", "Drug Name", "text", "e.g. Amoxicillin 500mg");
      h += drugField(i, 2, "dose", "Dose", "text", "e.g. 500mg");
      h += drugField(i, 2, "route", "Route", "select", "", ["Oral", "IV", "IM", "SC", "Topical", "Inhaled", "Rectal", "Other"]);
      h += drugField(i, 2, "frequency", "Frequency", "text", "e.g. TDS, BD");
      h += drugField(i, 2, "start_date", "Start Date", "date");
      h += drugField(i, 3, "stop_date", "Stop Date", "date");
      h += drugField(i, 3, "indication", "Indication", "text", "e.g. URTI");
      h += drugField(i, 3, "batch_no", "Batch No.", "text", "Batch / Lot number");
      h += drugField(i, 3, "mah", "MAH", "text", "Marketing Auth. Holder");
      h += '</div></div></div>';
      return h;
    }).join("");

    // Bind remove
    wrap.querySelectorAll("[data-pv-rm-drug]").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(b.getAttribute("data-pv-rm-drug"), 10);
        collectDrugData();
        formData.drugs.splice(idx, 1);
        renderDrugs();
      });
    });

    // Bind add
    var addBtn = document.getElementById("pv-add-drug");
    if (addBtn) addBtn.addEventListener("click", function () {
      collectDrugData();
      formData.drugs.push({ name: "", dose: "", route: "Oral", frequency: "", start_date: "", stop_date: "", indication: "", batch_no: "", mah: "" });
      renderDrugs();
    });
  }

  function drugField(idx, span, key, label, type, placeholder, selectOptions) {
    var val = (formData.drugs[idx] || {})[key] || "";
    var attr = 'data-pv-drug="' + idx + '" data-pv-dkey="' + key + '"';
    var h = '<div class="fld" style="grid-column:span ' + span + '">';
    h += '<label>' + esc(label) + '</label>';
    if (type === "select") {
      h += '<select ' + attr + '>';
      (selectOptions || []).forEach(function (v) { h += '<option' + (v === val ? ' selected' : '') + '>' + esc(v) + '</option>'; });
      h += '</select>';
    } else {
      h += '<input type="' + type + '" ' + attr + ' placeholder="' + esc(placeholder || "") + '" value="' + esc(val) + '" />';
    }
    h += '</div>';
    return h;
  }

  function collectDrugData() {
    document.querySelectorAll("[data-pv-drug]").forEach(function (el) {
      var i = parseInt(el.getAttribute("data-pv-drug"), 10);
      var k = el.getAttribute("data-pv-dkey");
      if (formData.drugs[i]) formData.drugs[i][k] = el.value;
    });
  }

  // ── collect current step data ──────────────────────────────────────────
  function collectStepData() {
    document.querySelectorAll("[data-pv-field]").forEach(function (el) {
      formData[el.getAttribute("data-pv-field")] = el.value;
    });
    if (STEPS[formStep].key === "drug") collectDrugData();
  }

  // ── review step ────────────────────────────────────────────────────────
  function renderReview() {
    var d = formData;
    var drugs = (d.drugs || []).filter(function (x) { return x.name; });
    var h = '<h3 style="margin:0 0 14px;font-size:15px">Review ADR Report</h3>';
    h += '<div class="row">';
    h += reviewBlock(6, "Patient", [
      ["Initials", d.pt_initials], ["Age", d.pt_age ? d.pt_age + "y" : "-"], ["Sex", d.pt_sex || "-"],
      ["Weight", d.pt_weight ? d.pt_weight + " kg" : "-"], ["Height", d.pt_height ? d.pt_height + " cm" : "-"]
    ]);
    h += reviewBlock(6, "Reporter", [
      ["Name", d.reporter_name], ["Qualification", d.reporter_qualification],
      ["Email", d.reporter_email], ["Phone", d.reporter_phone]
    ]);
    h += '</div>';
    h += '<div class="hr"></div>';
    h += '<div style="margin-bottom:10px"><b>Suspected Drug(s):</b></div>';
    if (drugs.length) {
      h += '<div class="twrap" style="max-height:none"><table class="tbl"><thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Freq</th><th>Start</th><th>Stop</th><th>Indication</th><th>Batch</th><th>MAH</th></tr></thead><tbody>';
      drugs.forEach(function (dr) {
        h += '<tr><td><b>' + esc(dr.name) + '</b></td><td>' + esc(dr.dose) + '</td><td>' + esc(dr.route) + '</td><td>' + esc(dr.frequency) + '</td><td>' + esc(dr.start_date) + '</td><td>' + esc(dr.stop_date) + '</td><td>' + esc(dr.indication) + '</td><td>' + esc(dr.batch_no) + '</td><td>' + esc(dr.mah) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    } else {
      h += '<div style="color:var(--mut);font-size:13px">No drugs entered.</div>';
    }
    h += '<div class="hr"></div>';
    h += '<div class="row">';
    h += reviewBlock(6, "Reaction", [
      ["Description", (d.reaction_description || "-").slice(0, 120)],
      ["Start", fmtDate(d.reaction_start)], ["Stop", fmtDate(d.reaction_stop)],
      ["Seriousness", d.reaction_seriousness], ["Outcome", d.reaction_outcome],
      ["Causality", d.reaction_causality], ["MedDRA", d.reaction_meddra || "-"]
    ]);
    h += reviewBlock(6, "Report", [
      ["Type", d.report_type], ["Status", d.status],
      ["Date", fmtDate(d.report_date)], ["Notes", (d.notes || "-").slice(0, 80)]
    ]);
    h += '</div>';
    return h;
  }

  function reviewBlock(span, title, pairs) {
    var h = '<div style="grid-column:span ' + span + ';border:1px solid var(--bd);border-radius:var(--r);padding:12px;background:rgba(0,0,0,.08)">';
    h += '<div style="font-weight:800;font-size:13px;margin-bottom:8px">' + esc(title) + '</div>';
    pairs.forEach(function (p) {
      h += '<div style="display:flex;gap:8px;font-size:12.5px;margin-bottom:4px"><span style="color:var(--mut);min-width:90px">' + esc(p[0]) + ':</span><span style="font-weight:600">' + esc(p[1] || "-") + '</span></div>';
    });
    h += '</div>';
    return h;
  }

  // ── submit / save ──────────────────────────────────────────────────────
  function doSubmit() {
    collectStepData();
    formData.updated_at = new Date().toISOString();

    // Validation
    if (!formData.pt_initials && !formData.pt_age) { toast("Please enter at least patient initials or age."); return; }
    var hasDrug = (formData.drugs || []).some(function (d) { return d.name; });
    if (!hasDrug) { toast("Please enter at least one suspected drug."); return; }
    if (!formData.reaction_description) { toast("Please describe the adverse reaction."); return; }

    if (editId) {
      var idx = reports.findIndex(function (r) { return r.id === editId; });
      if (idx >= 0) reports[idx] = formData;
      else reports.push(formData);
    } else {
      reports.push(formData);
    }

    save();
    toast(editId ? "Report updated" : "Report saved");
    editId = null;
    currentTab = "list";
    renderApp();
  }

  // ── register ───────────────────────────────────────────────────────────
  E.registerModule({
    id: "pharmacovigilance",
    title: "Pharmacovigilance",
    order: 410,
    icon: "🛡️",
    render: render
  });
})();
