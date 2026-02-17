(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.poct.js)");

  function dbg() {
    try {
      if (E && typeof E.dbg === "function") E.dbg.apply(null, arguments);
      else console.log.apply(console, arguments);
    } catch (e) {}
  }
  function err() {
    try {
      if (E && typeof E.error === "function") E.error.apply(null, arguments);
      else console.error.apply(console, arguments);
    } catch (e) {}
  }


  // ------------------------------------------------------------
  // Module-scoped CSS (fully scoped to .poct-root)
  // ------------------------------------------------------------
  var poctStyleInstalled = false;
  function ensurePoctStyles() {
    if (poctStyleInstalled) return;
    poctStyleInstalled = true;
    var st = document.createElement("style");
    st.type = "text/css";
    st.id = "eikon-poct-style";
    st.textContent = `.poct-root{margin:-14px;}
.poct-root{--bg:#0b1220;--panel:#121a2b;--panel2:#0f1726;--text:#e8eefc;--muted:#aab7d6;--border:rgba(255,255,255,.12);--accent:#4ea1ff;--good:#2ee59d;--warn:#ffcc66;--bad:#ff5c7a;--shadow:0 12px 30px rgba(0,0,0,.35);--radius:16px;--radius2:12px;--pad:14px;--pad2:10px;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;--sans:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}.poct-root *{box-sizing:border-box}.poct-root,.poct-root{height:100%}.poct-root{margin:0;font-family:var(--sans);color:var(--text);background:radial-gradient(1100px 600px at 15% 10%,rgba(78,161,255,.18),transparent 60%),radial-gradient(900px 500px at 85% 20%,rgba(46,229,157,.12),transparent 60%),radial-gradient(900px 700px at 50% 100%,rgba(255,92,122,.10),transparent 55%),var(--bg)}.poct-root a{color:inherit}.poct-root .app{display:grid;grid-template-columns:1fr;min-height:100vh}.poct-root .sidebar{padding:16px;border-right:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));position:sticky;top:0;height:100vh;overflow:auto}.poct-root .brand{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius);background:rgba(255,255,255,.03);box-shadow:var(--shadow);margin-bottom:12px}.poct-root .logo{width:38px;height:38px;border-radius:12px;background:radial-gradient(16px 16px at 30% 30%,rgba(255,255,255,.55),transparent 70%),linear-gradient(135deg,rgba(78,161,255,.9),rgba(46,229,157,.85));display:flex;align-items:center;justify-content:center;font-weight:800;color:#061023;letter-spacing:.5px}.poct-root .brand h1{font-size:14px;margin:0;line-height:1.1}.poct-root .brand .sub{font-size:12px;color:var(--muted);margin-top:2px}.poct-root .nav{display:flex;flex-direction:column;gap:8px;margin-top:12px}.poct-root .nav button{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);cursor:pointer;text-align:left;display:flex;gap:10px;align-items:center;transition:transform .08s ease,background .12s ease,border-color .12s ease;user-select:none}.poct-root .nav button:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}.poct-root .nav button:active{transform:translateY(1px)}.poct-root .nav button.active{background:rgba(78,161,255,.14);border-color:rgba(78,161,255,.45)}.poct-root .nav .icon{width:28px;height:28px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);font-size:15px}.poct-root .sidebar .small{margin-top:14px;padding:12px;border-radius:var(--radius);border:1px solid var(--border);background:rgba(255,255,255,.02);color:var(--muted);font-size:12px;line-height:1.35}.poct-root .sidebar .small .k{font-family:var(--mono);color:rgba(232,238,252,.9);font-size:11px;display:inline-block;padding:2px 6px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.03);margin-right:6px}.poct-root .main{padding:18px;overflow:auto}.poct-root .topbar{position:sticky;top:0;z-index:5000;isolation:isolate;background:var(--panel);padding:12px 12px 10px;border:1px solid var(--border);border-radius:16px;box-shadow:0 10px 26px rgba(0,0,0,.25);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.poct-root .topbar .title{margin:0;font-size:18px;letter-spacing:.2px}.poct-root .topbar .meta{color:var(--muted);font-size:12px;margin-top:4px}.poct-root .top-left{flex:1;min-width:0}.poct-root .nav.tabs{width:100%}.poct-root .actions{display:none}.poct-root .btn{border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);padding:10px 12px;border-radius:12px;cursor:pointer;transition:transform .08s ease,background .12s ease,border-color .12s ease;user-select:none;display:inline-flex;align-items:center;gap:8px;font-size:13px}.poct-root .btn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}.poct-root .btn:active{transform:translateY(1px)}.poct-root .btn.primary{background:rgba(78,161,255,.16);border-color:rgba(78,161,255,.55)}.poct-root .btn.danger{background:rgba(255,92,122,.12);border-color:rgba(255,92,122,.55)}.poct-root .btn.good{background:rgba(46,229,157,.12);border-color:rgba(46,229,157,.55)}.poct-root .btn small{color:var(--muted);font-size:11px}.poct-root .grid{display:grid;grid-template-columns:1fr;gap:14px}.poct-root .card{border:1px solid var(--border);border-radius:var(--radius);background:rgba(255,255,255,.03);box-shadow:var(--shadow);overflow:hidden}.poct-root .card .hd{padding:12px 14px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.02);display:flex;align-items:center;justify-content:space-between;gap:10px}.poct-root .card .hd h2{margin:0;font-size:14px;letter-spacing:.2px}.poct-root .card .hd .hint{color:var(--muted);font-size:12px}.poct-root .card .bd{padding:14px}.poct-root .row{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}.poct-root .field{display:flex;flex-direction:column;gap:6px}.poct-root .field label{color:var(--muted);font-size:12px}.poct-root .field input,.poct-root .field select,.poct-root .field textarea{width:100%;border:1px solid var(--border);background:rgba(0,0,0,.18);color:var(--text);padding:10px 10px;border-radius:12px;outline:none;font-size:13px}.poct-root .field input::placeholder,.poct-root .field textarea::placeholder{color:rgba(170,183,214,.65)}.poct-root .field textarea{min-height:80px;resize:vertical;line-height:1.35}.poct-root .field .mini{color:var(--muted);font-size:11px;margin-top:-2px}.poct-root .hr{height:1px;background:var(--border);margin:14px 0}.poct-root .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.03);font-size:12px;color:var(--muted)}.poct-root .pill strong{color:var(--text)}.poct-root .table-wrap{border:1px solid var(--border);border-radius:var(--radius);overflow:auto;background:rgba(0,0,0,.14)}.poct-root table{width:100%;border-collapse:separate;border-spacing:0;min-width:980px}.poct-root thead th{position:sticky;top:0;background:rgba(18,26,43,.95);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);font-size:12px;color:rgba(232,238,252,.92);text-align:left;padding:10px 10px;white-space:nowrap;z-index:2}.poct-root tbody td{border-bottom:1px solid rgba(255,255,255,.08);font-size:12.5px;padding:9px 10px;vertical-align:top}.poct-root tbody tr:hover td{background:rgba(255,255,255,.03)}.poct-root .mono{font-family:var(--mono)}.poct-root .muted{color:var(--muted)}.poct-root .nowrap{white-space:nowrap}.poct-root .wrap{white-space:normal}.poct-root .td-actions{display:flex;gap:8px;flex-wrap:wrap}.poct-root .tag{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.03);font-size:11px;color:var(--muted);white-space:nowrap}.poct-root .tag.good{border-color:rgba(46,229,157,.6);background:rgba(46,229,157,.10);color:rgba(200,255,236,.95)}.poct-root .tag.warn{border-color:rgba(255,204,102,.6);background:rgba(255,204,102,.10);color:rgba(255,238,200,.95)}.poct-root .tag.bad{border-color:rgba(255,92,122,.6);background:rgba(255,92,122,.10);color:rgba(255,210,220,.95)}.poct-root .toast{position:fixed;right:14px;bottom:14px;z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none}.poct-root .toast .t{pointer-events:none;max-width:420px;border:1px solid var(--border);background:rgba(18,26,43,.92);backdrop-filter:blur(8px);border-radius:14px;padding:10px 12px;box-shadow:var(--shadow);color:var(--text);font-size:13px;display:flex;gap:10px;align-items:flex-start;opacity:0;transform:translateY(8px);animation:toastIn .18s ease forwards}.poct-root .toast .t .dot{width:10px;height:10px;border-radius:999px;margin-top:4px;flex:0 0 auto;background:var(--accent)}.poct-root .toast .t.good .dot{background:var(--good)}.poct-root .toast .t.warn .dot{background:var(--warn)}.poct-root .toast .t.bad .dot{background:var(--bad)}.poct-root .toast .t .msg{line-height:1.3}.poct-root .toast .t .msg .small{color:var(--muted);font-size:12px;margin-top:3px}@keyframes toastIn{.poct-root to{opacity:1;transform:translateY(0)}}.poct-root .section{display:none}.poct-root .section.active{display:block}.poct-root .kbd{font-family:var(--mono);font-size:11px;color:rgba(232,238,252,.92);border:1px solid var(--border);background:rgba(255,255,255,.03);padding:2px 6px;border-radius:8px}@media (max-width:980px){.poct-root .app{grid-template-columns:1fr}.poct-root .sidebar{position:relative;height:auto;border-right:none;border-bottom:1px solid var(--border)}.poct-root table{min-width:900px}}@media print{.poct-root{background:#fff;color:#111}.poct-root .sidebar,.poct-root .topbar,.poct-root .actions,.poct-root .toast{display:none !important}.poct-root .app{display:block}.poct-root .main{padding:0}.poct-root .card{box-shadow:none;border:0}.poct-root .card .hd{border:0;background:transparent;padding:0;margin-bottom:10px}.poct-root .card .bd{padding:0}.poct-root .table-wrap{border:0;background:transparent}.poct-root thead th{position:static;background:transparent;color:#111;border-bottom:1px solid #ddd}.poct-root tbody td{border-bottom:1px solid #eee}}.poct-root .app{grid-template-columns:1fr !important}.poct-root .sidebar{display:none !important}.poct-root .topbar{position:sticky;top:0;z-index:9999;isolation:isolate;background:rgba(11,18,32,.96);border:1px solid var(--border);border-radius:18px;padding:14px 14px 10px;margin:0 0 14px;backdrop-filter:blur(10px)}.poct-root .topbar .top-left{display:flex;flex-direction:column;gap:10px;flex:1;min-width:260px}.poct-root .brand-inline{display:flex;align-items:center;gap:12px}.poct-root .brand-inline .logo{width:40px;height:40px;border-radius:16px;font-size:18px}.poct-root .storage-meta{margin-top:4px}.poct-root .tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;align-items:stretch;width:100%}.poct-root .tabs button{width:100%;padding:10px 12px;border-radius:14px;border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;text-align:center;transition:transform .08s ease,background .2s ease,border-color .2s ease}.poct-root .tabs button:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.22)}.poct-root .tabs button.active{background:rgba(78,161,255,.18);border-color:rgba(78,161,255,.55)}.poct-root .tabs .icon{display:inline-block;margin-right:8px;opacity:.95}.poct-root .spark-wrap{display:flex;align-items:center;justify-content:flex-start;min-height:54px}.poct-root .spark{width:100%;max-width:140px;height:30px;display:block}.poct-root .spark.big{width:100%;max-width:none;height:64px}.poct-root td.spark-cell{overflow:hidden}.poct-root .spark-cell-wrap{display:flex;align-items:center;justify-content:center;min-height:30px}.poct-root .spark path{fill:none;stroke:var(--accent);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:.95}.poct-root .spark path.line2{stroke:rgba(232,238,252,.65);stroke-dasharray:4 4}.poct-root .spark .axis{stroke:rgba(255,255,255,.10);stroke-width:1}.poct-root .spark .dot{fill:var(--accent)}.poct-root .spark .dot2{fill:rgba(232,238,252,.65)}.poct-root .badge{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.04);font-size:12px;font-weight:800;color:var(--text);white-space:nowrap}.poct-root .badge.warn{border-color:rgba(255,204,102,.45);background:rgba(255,204,102,.10)}.poct-root .badge.good{border-color:rgba(46,229,157,.45);background:rgba(46,229,157,.10)}.poct-root .note-inv{margin-bottom:6px}.poct-root .tag.inv{border-color:rgba(255,204,102,.35);background:rgba(255,204,102,.10)}@media (max-width:980px){.poct-root .topbar{padding:12px 12px 10px}.poct-root table{min-width:900px}}@media print{.poct-root .topbar,.poct-root #toast{display:none !important}.poct-root .main{padding:0}}`;
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Original UI markup (from attached prototype) — no <script>
  // ------------------------------------------------------------
  var POCT_HTML = `<div class="app"><main class="main"><div class="topbar" id="topbar"><div class="top-left"><div class="brand-inline"><div style="min-width:220px;"><h2 class="title" id="pageTitle">POCT</h2><div class="meta" id="pageMeta">Point of Care Testing • stored in the cloud</div></div></div><div class="nav tabs" id="nav" aria-label="Modules"><button type="button" class="active" data-section="sec-dashboard" onclick="return POCT_nav('sec-dashboard')"><span class="icon">🏠</span>Dashboard</button><button type="button" data-section="sec-patients" onclick="return POCT_nav('sec-patients')"><span class="icon">🧑‍⚕️</span>Patients</button><button type="button" data-section="sec-bp" onclick="return POCT_nav('sec-bp')"><span class="icon">🩺</span>Blood Pressure</button><button type="button" data-section="sec-urine" onclick="return POCT_nav('sec-urine')"><span class="icon">🧪</span>Urine (Combur 9)</button><button type="button" data-section="sec-hba1c" onclick="return POCT_nav('sec-hba1c')"><span class="icon">🧬</span>HbA1c</button><button type="button" data-section="sec-bg" onclick="return POCT_nav('sec-bg')"><span class="icon">🩸</span>Blood Glucose</button><button type="button" data-section="sec-chol" onclick="return POCT_nav('sec-chol')"><span class="icon">🫀</span>Cholesterol</button><button type="button" data-section="sec-bmi" onclick="return POCT_nav('sec-bmi')"><span class="icon">⚖️</span>Weight / BMI</button><button type="button" data-section="sec-all" onclick="return POCT_nav('sec-all')"><span class="icon">🗂️</span>All Records</button></div></div></div><section class="section active" id="sec-dashboard"><div class="grid"><div class="card"><div class="hd"><h2>Overview</h2></div><div class="bd"><div class="row"><div class="field" style="grid-column: span 4;"><label>Total records</label><input id="dashTotal" type="text" readonly /></div><div class="field" style="grid-column: span 4;"><label>Patients (unique by Patient ID)</label><input id="dashPatients" type="text" readonly /></div><div class="field" style="grid-column: span 12;"><label>Quick search (all modules)</label><input id="dashSearch" type="text" placeholder="Type patient name, ID, or phone..." /><div class="mini">Shows the latest matches across all tests.</div></div></div><div class="hr"></div><div class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Test</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">Results</th><th class="nowrap">Actions</th></tr></thead><tbody id="dashTbody"><tr><td colspan="8" class="muted">No records yet.</td></tr></tbody></table></div><div class="hr"></div><div class="row"></div></div></div></div></section><section class="section" id="sec-patients"><div class="grid"><div class="card"><div class="hd"><h2>Patients</h2><div class="hint"></div></div><div class="bd"><div class="row"><div class="field" style="grid-column: span 6;"><label>Search patients</label><input id="pt_search" type="text" placeholder="Search by patient name, ID, or phone." /><div class="mini">Patient IDs are auto-normalised (uppercase). Maltese IDs like <span class="kbd">789M</span> become <span class="kbd">0000789M</span>.</div></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="pt_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="pt_to" type="date" /></div></div><div class="hr"></div><div class="table-wrap"><table><thead><tr><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">Last Seen</th><th class="nowrap">HbA1c</th><th class="nowrap">BG</th><th class="nowrap">TC</th><th class="nowrap">BMI</th><th class="nowrap">BP</th><th class="nowrap">Flags</th><th class="nowrap">Actions</th></tr></thead><tbody id="pt_tbody"></tbody></table></div></div></div><div class="card" id="pt_detail_card" style="display:none;"><div class="hd"><h2 id="pt_detail_title">Patient Details</h2><div class="hint" id="pt_detail_hint">Charts + timeline</div></div><div class="bd"><div class="row"><div class="field" style="grid-column: span 4;"><label>Name</label><input id="pt_detail_name" type="text" placeholder="Patient name" /></div><div class="field" style="grid-column: span 4;"><label>Phone</label><input id="pt_detail_phone" type="text" placeholder="Contact number" /></div><div class="field" style="grid-column: span 2;"><label>Age</label><input id="pt_detail_age" type="number" min="0" step="1" placeholder="" /></div><div class="field" style="grid-column: span 2;"><label>Patient ID</label><input id="pt_detail_pid" type="text" readonly /></div><div class="field" style="grid-column: span 12;"><label>Address</label><input id="pt_detail_addr" type="text" placeholder="Address (optional)" /></div></div><div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;"><button class="btn primary" id="pt_save"><span>💾</span>Save Patient</button><button class="btn" id="pt_close"><span>✖️</span>Close</button></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 3;"><label>HbA1c (%)</label><div id="pt_chart_hba1c" class="spark-wrap"></div></div><div class="field" style="grid-column: span 3;"><label>Blood Glucose (mmol/L)</label><div id="pt_chart_bg" class="spark-wrap"></div></div><div class="field" style="grid-column: span 3;"><label>Total Cholesterol (mmol/L)</label><div id="pt_chart_tc" class="spark-wrap"></div></div><div class="field" style="grid-column: span 3;"><label>BMI</label><div id="pt_chart_bmi" class="spark-wrap"></div></div><div class="field" style="grid-column: span 12;"><label>Blood Pressure (Sys/Dia)</label><div id="pt_chart_bp" class="spark-wrap"></div></div></div><div class="hr"></div><div class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Test</th><th class="nowrap">Results</th><th class="nowrap">Intervention</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="pt_records_tbody"></tbody></table></div><div class="hr"></div><div class="small" id="pt_conflicts_box"></div></div></div></div></section><section class="section" id="sec-bp"><div class="grid"><div class="card"><div class="hd"><h2>Blood Pressure Test</h2><div class="hint"></div></div><div class="bd"><input type="hidden" id="bp_record_id" value="" /><div class="row"><div class="field" style="grid-column: span 3;"><label>Date &amp; Time</label><input id="bp_dt" type="datetime-local" /></div><div class="field" style="grid-column: span 3;"><label>Patient Name</label><input id="bp_name" type="text" placeholder="Full name" /></div><div class="field" style="grid-column: span 2;"><label>Patient ID</label><input id="bp_pid" type="text" placeholder="ID / Passport" /></div><div class="field" style="grid-column: span 2;"><label>Contact Number</label><input id="bp_phone" type="text" placeholder="+356 ..." /></div><div class="field" style="grid-column: span 2;"><label>Age</label><input id="bp_age" type="number" min="0" step="1" placeholder="Years" /></div><div class="field" style="grid-column: span 6;"><label>Address (optional)</label><input id="bp_address" type="text" placeholder="Optional" /></div><div class="field" style="grid-column: span 6;"><label>Notes</label><input id="bp_notes" type="text" placeholder="Optional notes..." /></div></div><div class="row"><div class="field" style="grid-column: span 12;"><label>Intervention / Medication started (optional)</label><input id="bp_intervention" type="text" placeholder="e.g. Started metformin 500mg BD, lifestyle advice, dose change..." /></div></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 2;"><label>Systolic (mmHg)</label><input id="bp_sys" type="number" min="0" step="1" placeholder="e.g. 120" /></div><div class="field" style="grid-column: span 2;"><label>Diastolic (mmHg)</label><input id="bp_dia" type="number" min="0" step="1" placeholder="e.g. 80" /></div><div class="field" style="grid-column: span 2;"><label>Pulse (bpm)</label><input id="bp_pulse" type="number" min="0" step="1" placeholder="e.g. 72" /></div><div class="field" style="grid-column: span 3;"><label>Arm</label><select id="bp_arm"><option>Left</option><option>Right</option></select></div><div class="field" style="grid-column: span 3;"><label>Position</label><select id="bp_pos"><option>Sitting</option><option>Standing</option><option>Supine</option></select></div></div><div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;"><button class="btn primary" id="bp_save"><span>💾</span>Save Blood Pressure</button><button class="btn" id="bp_clear"><span>🧹</span>Clear Form</button></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 6;"><label>Search saved BP results</label><input id="bp_search" type="text" placeholder="Search by patient name, ID, phone..." /></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="bp_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="bp_to" type="date" /></div></div><div style="margin-top:12px;" class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">Sys</th><th class="nowrap">Dia</th><th class="nowrap">Pulse</th><th class="nowrap">Arm</th><th class="nowrap">Position</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="bp_tbody"><tr><td colspan="12" class="muted">No BP records yet.</td></tr></tbody></table></div></div></div></div></section><section class="section" id="sec-urine"><div class="grid"><div class="card"><div class="hd"><h2>Urine Test (Combur 9)</h2><div class="hint"></div></div><div class="bd"><input type="hidden" id="ur_record_id" value="" /><div class="row"><div class="field" style="grid-column: span 3;"><label>Date &amp; Time</label><input id="ur_dt" type="datetime-local" /></div><div class="field" style="grid-column: span 3;"><label>Patient Name</label><input id="ur_name" type="text" placeholder="Full name" /></div><div class="field" style="grid-column: span 2;"><label>Patient ID</label><input id="ur_pid" type="text" placeholder="ID / Passport" /></div><div class="field" style="grid-column: span 2;"><label>Contact Number</label><input id="ur_phone" type="text" placeholder="+356 ..." /></div><div class="field" style="grid-column: span 2;"><label>Age</label><input id="ur_age" type="number" min="0" step="1" placeholder="Years" /></div><div class="field" style="grid-column: span 6;"><label>Address (optional)</label><input id="ur_address" type="text" placeholder="Optional" /></div><div class="field" style="grid-column: span 6;"><label>Notes</label><input id="ur_notes" type="text" placeholder="Optional notes..." /></div></div><div class="row"><div class="field" style="grid-column: span 12;"><label>Intervention / Medication started (optional)</label><input id="ur_intervention" type="text" placeholder="e.g. Started metformin 500mg BD, lifestyle advice, dose change..." /></div></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 4;"><label>Leukocytes</label><select id="ur_leu"></select><div class="mini">Typical scale: Negative → Trace → + → ++ → +++</div></div><div class="field" style="grid-column: span 4;"><label>Nitrite</label><select id="ur_nit"></select><div class="mini">Typical: Negative / Positive</div></div><div class="field" style="grid-column: span 4;"><label>Urobilinogen</label><select id="ur_uro"></select><div class="mini">Typical: Normal → + → ++ → +++</div></div><div class="field" style="grid-column: span 4;"><label>Protein</label><select id="ur_pro"></select></div><div class="field" style="grid-column: span 4;"><label>pH</label><select id="ur_ph"></select><div class="mini">Select common pH scale value</div></div><div class="field" style="grid-column: span 4;"><label>Blood</label><select id="ur_bld"></select></div><div class="field" style="grid-column: span 4;"><label>Ketone</label><select id="ur_ket"></select></div><div class="field" style="grid-column: span 4;"><label>Glucose</label><select id="ur_glu"></select></div><div class="field" style="grid-column: span 12;"><label>Optional: Colour / Appearance (free text)</label><input id="ur_appearance" type="text" placeholder="e.g. Yellow, clear / cloudy, etc." /></div></div><div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;"><button class="btn primary" id="ur_save"><span>💾</span>Save Urine Test</button><button class="btn" id="ur_clear"><span>🧹</span>Clear Form</button></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 6;"><label>Search saved urine results</label><input id="ur_search" type="text" placeholder="Search by patient name, ID, phone..." /></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="ur_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="ur_to" type="date" /></div></div><div style="margin-top:12px;" class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">LEU</th><th class="nowrap">NIT</th><th class="nowrap">URO</th><th class="nowrap">PRO</th><th class="nowrap">pH</th><th class="nowrap">BLD</th><th class="nowrap">KET</th><th class="nowrap">GLU</th><th class="nowrap">Appearance</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="ur_tbody"><tr><td colspan="17" class="muted">No urine records yet.</td></tr></tbody></table></div></div></div></div></section><section class="section" id="sec-hba1c"><div class="grid"><div class="card"><div class="hd"><h2>HbA1c Test</h2><div class="hint"></div></div><div class="bd"><input type="hidden" id="hb_record_id" value="" /><div class="row"><div class="field" style="grid-column: span 3;"><label>Date &amp; Time</label><input id="hb_dt" type="datetime-local" /></div><div class="field" style="grid-column: span 3;"><label>Patient Name</label><input id="hb_name" type="text" placeholder="Full name" /></div><div class="field" style="grid-column: span 2;"><label>Patient ID</label><input id="hb_pid" type="text" placeholder="ID / Passport" /></div><div class="field" style="grid-column: span 2;"><label>Contact Number</label><input id="hb_phone" type="text" placeholder="+356 ..." /></div><div class="field" style="grid-column: span 2;"><label>Age</label><input id="hb_age" type="number" min="0" step="1" placeholder="Years" /></div><div class="field" style="grid-column: span 6;"><label>Address (optional)</label><input id="hb_address" type="text" placeholder="Optional" /></div><div class="field" style="grid-column: span 6;"><label>Notes</label><input id="hb_notes" type="text" placeholder="Optional notes..." /></div></div><div class="row"><div class="field" style="grid-column: span 12;"><label>Intervention / Medication started (optional)</label><input id="hb_intervention" type="text" placeholder="e.g. Started metformin 500mg BD, lifestyle advice, dose change..." /></div></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 4;"><label>HbA1c (%)</label><input id="hb_pct" type="number" min="0" step="0.1" placeholder="e.g. 6.5" /><div class="mini">If you enter %, mmol/mol will auto-calc.</div></div><div class="field" style="grid-column: span 4;"><label>HbA1c (mmol/mol)</label><input id="hb_mmol" type="number" min="0" step="1" placeholder="e.g. 48" /><div class="mini">If you enter mmol/mol, % will auto-calc.</div></div></div><div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;"><button class="btn primary" id="hb_save"><span>💾</span>Save HbA1c</button><button class="btn" id="hb_clear"><span>🧹</span>Clear Form</button></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 6;"><label>Search saved HbA1c results</label><input id="hb_search" type="text" placeholder="Search by patient name, ID, phone..." /></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="hb_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="hb_to" type="date" /></div></div><div style="margin-top:12px;" class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">HbA1c %</th><th class="nowrap">HbA1c mmol/mol</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="hb_tbody"><tr><td colspan="9" class="muted">No HbA1c records yet.</td></tr></tbody></table></div></div></div></div></section><section class="section" id="sec-bg"><div class="grid"><div class="card"><div class="hd"><h2>Blood Glucose Test</h2><div class="hint">Simple capillary glucose record (mmol/L)</div></div><div class="bd"><input type="hidden" id="bg_record_id" value="" /><div class="row"><div class="field" style="grid-column: span 3;"><label>Date &amp; Time</label><input id="bg_dt" type="datetime-local" /></div><div class="field" style="grid-column: span 3;"><label>Patient Name</label><input id="bg_name" type="text" placeholder="Full name" /></div><div class="field" style="grid-column: span 2;"><label>Patient ID</label><input id="bg_pid" type="text" placeholder="ID / Passport" /></div><div class="field" style="grid-column: span 2;"><label>Contact Number</label><input id="bg_phone" type="text" placeholder="+356 ..." /></div><div class="field" style="grid-column: span 2;"><label>Age</label><input id="bg_age" type="number" min="0" step="1" placeholder="Years" /></div><div class="field" style="grid-column: span 6;"><label>Address (optional)</label><input id="bg_address" type="text" placeholder="Optional" /></div><div class="field" style="grid-column: span 6;"><label>Notes</label><input id="bg_notes" type="text" placeholder="Optional notes..." /></div></div><div class="row"><div class="field" style="grid-column: span 12;"><label>Intervention / Medication started (optional)</label><input id="bg_intervention" type="text" placeholder="Optional" /></div></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 6;"><label>Blood Glucose (mmol/L)</label><input id="bg_glucose" type="number" min="0" step="0.1" placeholder="e.g. 6.4" /></div><div class="field" style="grid-column: span 6;"><label>Timing</label><select id="bg_timing"><option>Random</option><option>Fasting</option><option>Post-prandial</option></select></div></div><div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;"><button class="btn primary" id="bg_save"><span>💾</span>Save Blood Glucose</button><button class="btn" id="bg_clear"><span>🧹</span>Clear Form</button></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 6;"><label>Search saved blood glucose results</label><input id="bg_search" type="text" placeholder="Search by patient name, ID, phone..." /></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="bg_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="bg_to" type="date" /></div></div><div style="margin-top:12px;" class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">Glucose</th><th class="nowrap">Timing</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="bg_tbody"><tr><td colspan="9" class="muted">No blood glucose records yet.</td></tr></tbody></table></div></div></div></div></section><section class="section" id="sec-chol"><div class="grid"><div class="card"><div class="hd"><h2>Cholesterol Test</h2><div class="hint"></div></div><div class="bd"><input type="hidden" id="ch_record_id" value="" /><div class="row"><div class="field" style="grid-column: span 3;"><label>Date &amp; Time</label><input id="ch_dt" type="datetime-local" /></div><div class="field" style="grid-column: span 3;"><label>Patient Name</label><input id="ch_name" type="text" placeholder="Full name" /></div><div class="field" style="grid-column: span 2;"><label>Patient ID</label><input id="ch_pid" type="text" placeholder="ID / Passport" /></div><div class="field" style="grid-column: span 2;"><label>Contact Number</label><input id="ch_phone" type="text" placeholder="+356 ..." /></div><div class="field" style="grid-column: span 2;"><label>Age</label><input id="ch_age" type="number" min="0" step="1" placeholder="Years" /></div><div class="field" style="grid-column: span 6;"><label>Address (optional)</label><input id="ch_address" type="text" placeholder="Optional" /></div><div class="field" style="grid-column: span 6;"><label>Notes</label><input id="ch_notes" type="text" placeholder="Optional notes..." /></div></div><div class="row"><div class="field" style="grid-column: span 12;"><label>Intervention / Medication started (optional)</label><input id="ch_intervention" type="text" placeholder="e.g. Started metformin 500mg BD, lifestyle advice, dose change..." /></div></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 3;"><label>Total Cholesterol (mmol/L)</label><input id="ch_tc" type="number" min="0" step="0.1" placeholder="e.g. 5.2" /></div><div class="field" style="grid-column: span 3;"><label>HDL (mmol/L)</label><input id="ch_hdl" type="number" min="0" step="0.1" placeholder="e.g. 1.3" /></div><div class="field" style="grid-column: span 3;"><label>LDL (mmol/L)</label><input id="ch_ldl" type="number" min="0" step="0.1" placeholder="e.g. 3.1" /></div><div class="field" style="grid-column: span 3;"><label>Triglycerides (mmol/L)</label><input id="ch_tg" type="number" min="0" step="0.1" placeholder="e.g. 1.7" /></div><div class="field" style="grid-column: span 4;"><label>TC/HDL Ratio (auto)</label><input id="ch_ratio" type="text" readonly /><div class="mini">Calculated when TC and HDL present.</div></div><div class="field" style="grid-column: span 4;"><label>Fasting status (optional)</label><select id="ch_fasting"><option value="">Select</option><option>Fasting</option><option>Non-fasting</option><option>Unknown</option></select></div></div><div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;"><button class="btn primary" id="ch_save"><span>💾</span>Save Cholesterol</button><button class="btn" id="ch_clear"><span>🧹</span>Clear Form</button></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 6;"><label>Search saved cholesterol results</label><input id="ch_search" type="text" placeholder="Search by patient name, ID, phone..." /></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="ch_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="ch_to" type="date" /></div></div><div style="margin-top:12px;" class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">TC</th><th class="nowrap">HDL</th><th class="nowrap">LDL</th><th class="nowrap">TG</th><th class="nowrap">TC/HDL</th><th class="nowrap">Fasting</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="ch_tbody"><tr><td colspan="13" class="muted">No cholesterol records yet.</td></tr></tbody></table></div></div></div></div></section><section class="section" id="sec-bmi"><div class="grid"><div class="card"><div class="hd"><h2>Weight / BMI (Metric)</h2><div class="hint"></div></div><div class="bd"><input type="hidden" id="bm_record_id" value="" /><div class="row"><div class="field" style="grid-column: span 3;"><label>Date &amp; Time</label><input id="bm_dt" type="datetime-local" /></div><div class="field" style="grid-column: span 3;"><label>Patient Name</label><input id="bm_name" type="text" placeholder="Full name" /></div><div class="field" style="grid-column: span 2;"><label>Patient ID</label><input id="bm_pid" type="text" placeholder="ID / Passport" /></div><div class="field" style="grid-column: span 2;"><label>Contact Number</label><input id="bm_phone" type="text" placeholder="+356 ..." /></div><div class="field" style="grid-column: span 2;"><label>Age</label><input id="bm_age" type="number" min="0" step="1" placeholder="Years" /></div><div class="field" style="grid-column: span 6;"><label>Address (optional)</label><input id="bm_address" type="text" placeholder="Optional" /></div><div class="field" style="grid-column: span 6;"><label>Notes</label><input id="bm_notes" type="text" placeholder="Optional notes..." /></div></div><div class="row"><div class="field" style="grid-column: span 12;"><label>Intervention / Medication started (optional)</label><input id="bm_intervention" type="text" placeholder="e.g. Started metformin 500mg BD, lifestyle advice, dose change..." /></div></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 4;"><label>Weight (kg)</label><input id="bm_weight" type="number" min="0" step="0.1" placeholder="e.g. 78.4" /></div><div class="field" style="grid-column: span 4;"><label>Height (cm)</label><input id="bm_height" type="number" min="0" step="0.1" placeholder="e.g. 175" /></div><div class="field" style="grid-column: span 4;"><label>BMI (auto)</label><input id="bm_bmi" type="text" readonly /></div><div class="field" style="grid-column: span 6;"><label>BMI Category (auto)</label><input id="bm_cat" type="text" readonly /></div><div class="field" style="grid-column: span 6;"><label>Optional: Waist circumference (cm)</label><input id="bm_waist" type="number" min="0" step="0.1" placeholder="Optional" /></div></div><div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap;"><button class="btn primary" id="bm_save"><span>💾</span>Save Weight/BMI</button><button class="btn" id="bm_clear"><span>🧹</span>Clear Form</button></div><div class="hr"></div><div class="row"><div class="field" style="grid-column: span 6;"><label>Search saved weight/BMI results</label><input id="bm_search" type="text" placeholder="Search by patient name, ID, phone..." /></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="bm_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="bm_to" type="date" /></div></div><div style="margin-top:12px;" class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">Weight (kg)</th><th class="nowrap">Height (cm)</th><th class="nowrap">BMI</th><th class="nowrap">Category</th><th class="nowrap">Waist (cm)</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="bm_tbody"><tr><td colspan="12" class="muted">No weight/BMI records yet.</td></tr></tbody></table></div></div></div></div></section><section class="section" id="sec-all"><div class="grid"><div class="card"><div class="hd"><h2>All Records</h2><div class="hint"></div></div><div class="bd"><div class="row"><div class="field" style="grid-column: span 6;"><label>Search (name / ID / phone / notes)</label><input id="all_search" type="text" placeholder="Type anything..." /></div><div class="field" style="grid-column: span 3;"><label>Test type</label><select id="all_type"><option value="">All</option><option value="bp">Blood Pressure</option><option value="urine">Urine (Combur 9)</option><option value="hba1c">HbA1c</option><option value="bg">Blood Glucose</option><option value="chol">Cholesterol</option><option value="bmi">Weight / BMI</option></select></div><div class="field" style="grid-column: span 3;"><label>Sort</label><select id="all_sort"><option value="dt_desc">Newest first</option><option value="dt_asc">Oldest first</option><option value="name_asc">Patient A→Z</option><option value="name_desc">Patient Z→A</option></select></div><div class="field" style="grid-column: span 3;"><label>From date</label><input id="all_from" type="date" /></div><div class="field" style="grid-column: span 3;"><label>To date</label><input id="all_to" type="date" /></div><div class="field" style="grid-column: span 6;"><label>Quick actions</label><div style="display:flex; gap:10px; flex-wrap:wrap;"><button class="btn" id="all_print_list"><span>🖨️</span>Print current list</button><button class="btn good" id="all_export_csv"><span>📄</span>Export CSV (current list)</button></div></div></div><div class="hr"></div><div class="table-wrap"><table><thead><tr><th class="nowrap">Date/Time</th><th class="nowrap">Test</th><th class="nowrap">Patient</th><th class="nowrap">Patient ID</th><th class="nowrap">Phone</th><th class="nowrap">Age</th><th class="nowrap">Results</th><th class="nowrap">Notes</th><th class="nowrap">Actions</th></tr></thead><tbody id="all_tbody"><tr><td colspan="9" class="muted">No records yet.</td></tr></tbody></table></div></div></div></div></section></main></div><div class="toast" id="toast"></div>`;

async function poctRuntime(root){
"use strict";
      var E = window.EIKON;
      try{ window.__POCT_ACTIVE_ROOT = root; }catch(e){}
      var STORAGE_KEY = "poct_records_v1";
      var PATIENTS_KEY = "poct_patients_v1";
      var MIGRATION_KEY_V2 = "poct_poctr2_migrated";
      function nowLocalDatetimeValue(){
        var d = new Date();
        var pad = function(n){ return String(n).padStart(2, "0"); };
        var yyyy = d.getFullYear();
        var mm = pad(d.getMonth()+1);
        var dd = pad(d.getDate());
        var hh = pad(d.getHours());
        var mi = pad(d.getMinutes());
        return yyyy + "-" + mm + "-" + dd + "T" + hh + ":" + mi;
      }
      function parseLocalDatetimeValue(v){
        if(!v) return null;
        var d = new Date(v);
        if(isNaN(d.getTime())) return null;
        return d;
      }
      function formatDisplayDatetime(isoOrLocal){
        var d;
        if(isoOrLocal instanceof Date) d = isoOrLocal;
        else if(typeof isoOrLocal === "string"){
          var tmp = new Date(isoOrLocal);
          if(!isNaN(tmp.getTime())) d = tmp;
          else{
            d = parseLocalDatetimeValue(isoOrLocal) || new Date();
          }
        }else{
          d = new Date();
        }
        var pad = function(n){ return String(n).padStart(2, "0"); };
        var yyyy = d.getFullYear();
        var mm = pad(d.getMonth()+1);
        var dd = pad(d.getDate());
        var hh = pad(d.getHours());
        var mi = pad(d.getMinutes());
        return yyyy + "-" + mm + "-" + dd + " " + hh + ":" + mi;
      }
      function toIso(d){
        try{ return d.toISOString(); }catch(e){ return new Date().toISOString(); }
      }
      function uid(){
        return "r_" + Date.now() + "_" + Math.random().toString(16).slice(2);
      }
      function safeJsonParse(s, fallback){
        try{
          var v = JSON.parse(s);
          return (v === null || v === undefined) ? fallback : v;
        }catch(e){
          return fallback;
        }
      }
      
      // Cloud storage (no localStorage)
      var __cloud = window.__POCT_CLOUD || (window.__POCT_CLOUD = {
        loaded:false,
        loading:null,
        records:[],
        patients:[],
        migratedV2:false,
        saving:false,
        pending:false,
        saveTimer:null,
        lastError:""
      });
      function deepClone(v){
        try{ return JSON.parse(JSON.stringify(v)); }catch(e){ return v; }
      }
      async function cloudLoad(){
        if(__cloud.loaded) return;
        if(__cloud.loading) return __cloud.loading;
        __cloud.loading = (async function(){
          try{
            var resp = await (E && E.apiFetch ? E.apiFetch("/poct/state", { method:"GET" }) : fetch("/poct/state").then(function(r){ return r.json(); }));
            // expected: {ok:true, state:{records:[],patients:[]}} OR {ok:true, records:[], patients:[]}
            var st = (resp && (resp.state || resp.data)) ? (resp.state || resp.data) : resp;
            var recs = st && (st.records || st.entries) ? (st.records || st.entries) : (resp && resp.records) || [];
            var pats = st && st.patients ? st.patients : (resp && resp.patients) || [];
            __cloud.records = Array.isArray(recs) ? recs : [];
            __cloud.patients = Array.isArray(pats) ? pats : [];
            __cloud.loaded = true;
          }catch(e){
            // If backend not ready yet (e.g. 404), start empty (session-only) but keep running.
            try{
              if(e && (e.status === 404 || e.status === 400)){
                __cloud.records = [];
                __cloud.patients = [];
                __cloud.loaded = true;
                return;
              }
            }catch(e2){}
            __cloud.lastError = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : e);
            __cloud.records = __cloud.records || [];
            __cloud.patients = __cloud.patients || [];
            __cloud.loaded = true;
            try{ if(window.__POCT_TOAST) window.__POCT_TOAST("Cloud load failed", "warn", __cloud.lastError); }catch(e3){}
          }finally{
            __cloud.loading = null;
          }
        })();
        return __cloud.loading;
      }
      async function cloudSaveNow(){
        if(__cloud.saving){
          __cloud.pending = true;
          return;
        }
        __cloud.saving = true;
        try{
          var payload = { records: (__cloud.records||[]), patients: (__cloud.patients||[]) };
          var resp2 = await E.apiFetch("/poct/state", {
            method:"PUT",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify(payload)
          });
          if(!resp2 || !resp2.ok){
            throw new Error(resp2 && resp2.error ? resp2.error : "Save failed");
          }
                  try{ dbg("[poct] cloud save OK"); }catch(eOK){}
}catch(e){
          __cloud.lastError = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : e);
          try{ if(window.__POCT_TOAST) window.__POCT_TOAST("Cloud save failed", "warn", __cloud.lastError); }catch(e2){}
        }finally{
          __cloud.saving = false;
          if(__cloud.pending){
            __cloud.pending = false;
            setTimeout(function(){ cloudSaveNow(); }, 50);
          }
        }
      }
      function cloudScheduleSave(){
        try{ if(__cloud.saveTimer) clearTimeout(__cloud.saveTimer); }catch(e){}
        __cloud.saveTimer = setTimeout(function(){ cloudSaveNow(); }, 350);
      }
      function cloudWipe(){
        __cloud.records = [];
        __cloud.patients = [];
        cloudScheduleSave();
      }
      function loadRecords(){
        return deepClone(__cloud.records || []);
      }
      function saveRecords(arr){
        __cloud.records = deepClone(Array.isArray(arr)?arr:[]);
        cloudScheduleSave();
      }
      function loadPatients(){
        var arr = deepClone(__cloud.patients || []);
        if(!Array.isArray(arr)) arr = [];
        return arr;
      }
      function savePatients(arr){
        __cloud.patients = deepClone(Array.isArray(arr)?arr:[]);
        cloudScheduleSave();
      }
function patientsToMap(arr){
        var map = {};
        for(var i=0;i<arr.length;i++){
          var p = arr[i];
          if(p && p.patientId) map[String(p.patientId)] = p;
        }
        return map;
      }
      function mapToPatients(map){
        var out = [];
        for(var k in map){
          if(Object.prototype.hasOwnProperty.call(map,k)){
            out.push(map[k]);
          }
        }
        out.sort(function(a,b){
          var an = lower((a && a.name) ? a.name : "");
          var bn = lower((b && b.name) ? b.name : "");
          if(an < bn) return -1;
          if(an > bn) return 1;
          var ai = String((a && a.patientId) ? a.patientId : "");
          var bi = String((b && b.patientId) ? b.patientId : "");
          if(ai < bi) return -1;
          if(ai > bi) return 1;
          return 0;
        });
        return out;
      }
      function getPatientById(pidNorm){
        if(!pidNorm) return null;
        var arr = loadPatients();
        for(var i=0;i<arr.length;i++){
          if(arr[i] && arr[i].patientId === pidNorm) return arr[i];
        }
        return null;
      }
      function upsertPatientMaster(patient, ctx){
        var pid = normalizePatientId(patient && patient.patientId ? patient.patientId : "");
        if(!pid) return;
        var all = loadPatients();
        var map = patientsToMap(all);
        var existing = map[pid] || null;
        var nowIso = toIso(new Date());
        if(!existing){
          map[pid] = {
            patientId: pid,
            name: must(patient && patient.name ? patient.name : ""),
            phone: must(patient && patient.phone ? patient.phone : ""),
            age: (patient && (patient.age!==null && patient.age!==undefined)) ? patient.age : null,
            address: must(patient && patient.address ? patient.address : ""),
            createdAtIso: nowIso,
            updatedAtIso: nowIso,
            lastSeenIso: ctx && ctx.performedAtIso ? ctx.performedAtIso : nowIso,
            conflicts: []
          };
          savePatients(mapToPatients(map));
          return;
        }
        var enteredName = must(patient && patient.name ? patient.name : "");
        var enteredPhone = must(patient && patient.phone ? patient.phone : "");
        var exName = must(existing.name);
        var exPhone = must(existing.phone);
        var conflict = false;
        if(exName && enteredName && lower(exName) !== lower(enteredName)) conflict = true;
        if(exPhone && enteredPhone && lower(exPhone) !== lower(enteredPhone)) conflict = true;
        if(conflict){
          existing.conflicts = Array.isArray(existing.conflicts) ? existing.conflicts : [];
          existing.conflicts.unshift({
            atIso: nowIso,
            recordId: ctx && ctx.recordId ? String(ctx.recordId) : "",
            testType: ctx && ctx.testType ? String(ctx.testType) : "",
            performedAtIso: ctx && ctx.performedAtIso ? String(ctx.performedAtIso) : "",
            existingName: exName,
            existingPhone: exPhone,
            enteredName: enteredName,
            enteredPhone: enteredPhone
          });
          toast("Duplicate Patient ID: different name/phone", "warn", "Saved record, but patient master not overwritten. Check Patients → Flags.");
        }else{
          if(!exName && enteredName) existing.name = enteredName;
          if(!exPhone && enteredPhone) existing.phone = enteredPhone;
          if(exName && enteredName && lower(exName) === lower(enteredName)) existing.name = enteredName;
          if(exPhone && enteredPhone && lower(exPhone) === lower(enteredPhone)) existing.phone = enteredPhone;
        }
        var enteredAddr = must(patient && patient.address ? patient.address : "");
        if(!must(existing.address) && enteredAddr) existing.address = enteredAddr;
        if(must(existing.address) && enteredAddr) existing.address = enteredAddr;
        var enteredAge = (patient && (patient.age!==null && patient.age!==undefined)) ? patient.age : null;
        if((existing.age===null || existing.age===undefined) && (enteredAge!==null && enteredAge!==undefined)) existing.age = enteredAge;
        if((enteredAge!==null && enteredAge!==undefined)) existing.age = enteredAge;
        if(ctx && ctx.performedAtIso){
          var dNew = new Date(ctx.performedAtIso);
          var dOld = existing.lastSeenIso ? new Date(existing.lastSeenIso) : null;
          if(!dOld || isNaN(dOld.getTime()) || (!isNaN(dNew.getTime()) && dNew.getTime() > dOld.getTime())){
            existing.lastSeenIso = ctx.performedAtIso;
          }
        }
        existing.updatedAtIso = nowIso;
        map[pid] = existing;
        savePatients(mapToPatients(map));
      }
      function rebuildPatientsFromRecords(force){
        var existing = loadPatients();
        if(existing.length > 0 && !force) return;
        var all = loadRecords();
        var map = {};
        for(var i=0;i<all.length;i++){
          var r = all[i] || {};
          var p = r.patient || {};
          var pid = normalizePatientId(p.patientId || "");
          if(!pid) continue;
          if(p.patientId !== pid){
            p.patientId = pid;
            r.patient = p;
          }
          var tempToast = window.__POCT_SUPPRESS_TOASTS;
          window.__POCT_SUPPRESS_TOASTS = true;
          upsertPatientMaster(
            {patientId: pid, name: p.name||"", phone: p.phone||"", age: p.age, address: p.address||""},
            {recordId: r.id||"", testType: r.testType||"", performedAtIso: r.performedAtIso||""}
          );
          window.__POCT_SUPPRESS_TOASTS = tempToast;
        }
        saveRecords(all);
      }
      function upsertRecord(rec){
        if(rec && rec.patient){
          rec.patient = normalizePatientInPlace(rec.patient);
          if(rec.patient.patientId){
            upsertPatientMaster(rec.patient, {recordId: rec.id||"", testType: rec.testType||"", performedAtIso: rec.performedAtIso||""});
          }
        }
        var all = loadRecords();
        var idx = -1;
        for(var i=0;i<all.length;i++){
          if(all[i] && String(all[i].id) === String(rec.id)){
            idx = i; break;
          }
        }
        if(idx >= 0){
          all[idx] = rec;
        }else{
          all.push(rec);
        }
        saveRecords(all);
      }
      function deleteRecordById(id){
        var sid = String(id);
        var all = loadRecords();
        var out = [];
        for(var i=0;i<all.length;i++){
          if(all[i] && String(all[i].id) !== sid) out.push(all[i]);
        }
        saveRecords(out);
      }
      function getById(id){
        var sid = String(id);
        var all = loadRecords();
        for(var i=0;i<all.length;i++){
          if(all[i] && String(all[i].id) === sid) return all[i];
        }
        return null;
      }
      function esc(s){
        return String(s === null || s === undefined ? "" : s)
          .replace(/&/g,"&amp;")
          .replace(/</g,"&lt;")
          .replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;")
          .replace(/'/g,"&#39;");
      }
      function notesHtml(r){
        var inv = must(r && r.intervention ? r.intervention : "");
        var notes = must(r && r.notes ? r.notes : "");
        var out = "";
        if(inv){
          out += "<div class='note-inv'><span class='tag inv'>💊 " + esc(inv) + "</span></div>";
        }
        if(notes){
          out += "<div>" + esc(notes) + "</div>";
        }
        return out || "<span class='muted'>—</span>";
      }
function numOrNull(v){
        if(v === null || v === undefined) return null;
        var s = String(v).trim();
        if(!s) return null;
        var n = Number(s);
        if(isNaN(n)) return null;
        return n;
      }
      function moneyFormat(n){
        var x = Number(n);
        if(isNaN(x)) x = 0;
        return x.toFixed(2);
      }
      function toast(msg, kind, small){
        if(window.__POCT_SUPPRESS_TOASTS) return;
        var wrap = document.getElementById("toast");
        var t = document.createElement("div");
        t.className = "t" + (kind ? " " + kind : "");
        t.innerHTML =
          '<div class="dot"></div>' +
          '<div class="msg">' +
            esc(msg) +
            (small ? '<div class="small">'+esc(small)+'</div>' : '') +
          '</div>';
        wrap.appendChild(t);
        setTimeout(function(){
          try{
            t.style.opacity = "0";
            t.style.transform = "translateY(8px)";
            t.style.transition = "opacity .25s ease, transform .25s ease";
          }catch(e){}
        }, 2400);
        setTimeout(function(){
          try{ wrap.removeChild(t); }catch(e){}
        }, 2900);
      }
      function lower(s){ return String(s||"").toLowerCase(); }
      function normalizePatientId(raw){
        var s = String(raw === null || raw === undefined ? "" : raw).trim().toUpperCase();
        s = s.replace(/\s+/g, "");
        var m = s.match(/^(\d{1,7})([A-Z])$/);
        if(m){
          var digits = m[1];
          var letter = m[2];
          return digits.padStart(7, "0") + letter;
        }
        return s;
      }
      function setInputValuePreserveCaret(el, v){
        try{
          var start = el.selectionStart;
          var end = el.selectionEnd;
          el.value = v;
          if(typeof start === "number" && typeof end === "number"){
            var delta = v.length - (el.value||"").length;
            var ns = Math.max(0, start + delta);
            var ne = Math.max(0, end + delta);
            el.setSelectionRange(ns, ne);
          }
        }catch(e){
          try{ el.value = v; }catch(_e){}
        }
      }
      function wirePatientIdInput(pidEl, nameEl, phoneEl, ageEl, addrEl){
        if(!pidEl) return;
        function normalizeIntoInput(){
          var before = String(pidEl.value || "");
          var norm = normalizePatientId(before);
          if(norm !== before){
            try{ pidEl.value = norm; }catch(e){}
          }else{
            var up = before.toUpperCase();
            if(up !== before){
              try{ pidEl.value = up; }catch(e){}
            }
          }
        }
        pidEl.addEventListener("input", function(){
          var raw = String(pidEl.value || "");
          var up = raw.toUpperCase();
          if(up !== raw){
            try{
              var s0 = pidEl.selectionStart, e0 = pidEl.selectionEnd;
              pidEl.value = up;
              if(typeof s0 === "number" && typeof e0 === "number") pidEl.setSelectionRange(s0, e0);
            }catch(e){}
          }
          var m = up.trim().replace(/\s+/g,"").match(/^(\d{1,7})([A-Z])$/);
          if(m){
            var padded = m[1].padStart(7, "0") + m[2];
            if(padded !== up.trim().replace(/\s+/g,"")){
              try{ pidEl.value = padded; }catch(e){}
            }
          }
        });
        pidEl.addEventListener("blur", function(){
          normalizeIntoInput();
          var pid = normalizePatientId(pidEl.value || "");
          if(!pid) return;
          var pat = getPatientById(pid);
          if(!pat) return;
          if(nameEl && !must(nameEl.value) && must(pat.name)) nameEl.value = pat.name;
          if(phoneEl && !must(phoneEl.value) && must(pat.phone)) phoneEl.value = pat.phone;
          if(ageEl && (!must(ageEl.value)) && (pat.age!==null && pat.age!==undefined && String(pat.age)!=="")) ageEl.value = String(pat.age);
          if(addrEl && !must(addrEl.value) && must(pat.address)) addrEl.value = pat.address;
          toast("Auto-filled patient details", "good", "From patient master record (" + pid + ")");
        });
      }
      function normalizePatientInPlace(p){
        var out = p || {};
        out.patientId = normalizePatientId(out.patientId || "");
        out.name = must(out.name || "");
        out.phone = must(out.phone || "");
        out.address = must(out.address || "");
        return out;
      }
      function recordSearchHaystack(r){
        var p = (r && r.patient) ? r.patient : {};
        var parts = [
          r && r.testType ? r.testType : "",
          r && r.testLabel ? r.testLabel : "",
          r && r.intervention ? r.intervention : "",
          r && r.notes ? r.notes : "",
          p.name || "",
          p.patientId || "",
          p.phone || "",
          p.address || "",
          String(p.age || "")
        ];
        var res = r && r.results ? r.results : {};
        for(var k in res){
          if(Object.prototype.hasOwnProperty.call(res, k)){
            parts.push(String(res[k]));
          }
        }
        return lower(parts.join(" | "));
      }
      function withinDateRange(recordIso, fromDateStr, toDateStr){
        if(!fromDateStr && !toDateStr) return true;
        var d = new Date(recordIso);
        if(isNaN(d.getTime())) return true;
        var startOk = true;
        var endOk = true;
        if(fromDateStr){
          var from = new Date(fromDateStr + "T00:00:00");
          if(!isNaN(from.getTime())) startOk = (d.getTime() >= from.getTime());
        }
        if(toDateStr){
          var to = new Date(toDateStr + "T23:59:59");
          if(!isNaN(to.getTime())) endOk = (d.getTime() <= to.getTime());
        }
        return startOk && endOk;
      }
      function testLabel(type){
        if(type === "bp") return "Blood Pressure";
        if(type === "urine") return "Urine (Combur 9)";
        if(type === "hba1c") return "HbA1c";
        if(type === "bg") return "Blood Glucose";
        if(type === "chol") return "Cholesterol";
        if(type === "bmi") return "Weight / BMI";
        return type || "";
      }
      var nav = document.getElementById("nav");
      var navButtons = Array.prototype.slice.call(nav.querySelectorAll("button"));
      var sections = Array.prototype.slice.call(root.querySelectorAll(".section"));
      var pageTitle = document.getElementById("pageTitle");
      var pageMeta = document.getElementById("pageMeta");
      function removeUiAnnotations(){
        var banned = {
          "Prototype": true,
          "— later you can swap LocalStorage with Cloud storage without changing the UI layout too much.": true,
          "Counts + quick search": true,
          "Overview + quick search": true,
          "Storagepoct_records_v1 + poct_patients_v1": true,
          "Master patient record (dedupe) + mini charts": true,
          "Master patient record (primary key: Patient ID) • dedupe + mini charts": true,
          "Save by patient + date/time": true,
          "Record systolic/diastolic/pulse + patient data": true,
          "Record Combur 9 dipstick parameters": true,
          "Standard dipstick-style scales": true,
          "Record % and mmol/mol (auto conversion)": true,
          "Stores % and mmol/mol": true,
          "Record blood glucose readings": true,
          "Simple capillary glucose record (mmol/L)": true,
          "Record TC/HDL/LDL/TG + ratio (auto)": true,
          "Simple pharmacy POCT panel (mmol/L)": true,
          "Record weight/height; BMI + category auto": true,
          "Auto-calculates BMI + category": true,
          "Unified search + print": true,
          "Unified search + print + export CSV": true
        };
        var blocks = root.querySelectorAll(".hint, .pill, .meta, .storage-meta");
        for(var i=0;i<blocks.length;i++){
          var el = blocks[i];
          if(!el) continue;
          var txt = String(el.textContent || "").trim();
          if(!txt) continue;
          if(banned[txt]){
            el.textContent = "";
            el.style.display = "none";
          }
        }
      }
      function setActiveSection(id){
        for(var i=0;i<navButtons.length;i++){
          var b = navButtons[i];
          b.classList.toggle("active", b.getAttribute("data-section") === id);
        }
        for(var j=0;j<sections.length;j++){
          sections[j].classList.toggle("active", sections[j].id === id);
        }
        var title = "POCT";
        var meta = "Point of Care Testing • stored in the cloud";
        // Keep the top bar stable; section titles are already shown in the left navigation.
        pageTitle.textContent = title;
        pageMeta.textContent = meta;
        removeUiAnnotations();
        renderAll();
      }
      removeUiAnnotations();
      var __routeLock = false;
      window.POCT_nav = function(sectionId){
        try{
          if(!sectionId) return false;
          __routeLock = true;
          dbg("[poct] nav ->", sectionId);
          // IMPORTANT: Do not touch window.location.hash here. The main app router uses the hash for modules.
          setActiveSection(sectionId);
        }catch(e){
          err("[poct] nav error", e);
        }
        setTimeout(function(){ __routeLock = false; }, 0);
        return false;
      };
      nav.addEventListener("click", function(e){
        var t = e.target;
        if(t && t.nodeType === 3) t = t.parentNode; // TEXT_NODE -> element
        var btn = null;
        if(t){
          if(t.closest){
            btn = t.closest("button");
          }else{
            var cur = t;
            while(cur && cur !== nav){
              if(cur.tagName && String(cur.tagName).toLowerCase() === "button"){
                btn = cur;
                break;
              }
              cur = cur.parentNode;
            }
          }
        }
        if(!btn) return;
        var sec = btn.getAttribute("data-section");
        if(sec){ if(window.POCT_nav) window.POCT_nav(sec); else setActiveSection(sec); }
      });
      function setDefaultDts(){
        var v = nowLocalDatetimeValue();
        var ids = ["bp_dt","ur_dt","hb_dt","bg_dt","ch_dt","bm_dt"];
        for(var i=0;i<ids.length;i++){
          var el = document.getElementById(ids[i]);
          if(el && !el.value) el.value = v;
        }
      }
      setDefaultDts();
      try{ window.__POCT_setDefaultDts = setDefaultDts; window.__POCT_ACTIVE_ROOT = root; }catch(e){}
      await cloudLoad();
      dbg('[poct] cloud loaded', { records: (__cloud.records||[]).length, patients: (__cloud.patients||[]).length, lastError: __cloud.lastError || '' });

      // Legacy localStorage migration (one-time helper):
      // If an older POCT build stored data locally, offer to migrate it to the cloud for THIS org+location.
      async function tryMigrateLegacyLocalToCloud() {
        try {
          if (!window || !window.localStorage) return;
          var cloudHasData = ((__cloud.records && __cloud.records.length) || (__cloud.patients && __cloud.patients.length));
          if (cloudHasData) return;

          var rs = null, ps = null;
          try { rs = window.localStorage.getItem(STORAGE_KEY); } catch (e1) {}
          try { ps = window.localStorage.getItem(PATIENTS_KEY); } catch (e2) {}
          if (!rs && !ps) return;

          var recs = safeJson(rs || "[]", []);
          var pats = safeJson(ps || "[]", []);
          if (!Array.isArray(recs) || recs.length === 0) return;

          var msg =
            "Legacy POCT data found in this browser (previous local-only version).\n\n" +
            "Records: " + String(recs.length) + "\n" +
            "Patients: " + String(Array.isArray(pats) ? pats.length : 0) + "\n\n" +
            "Migrate this data to the CLOUD for this location now?";

          function askConfirm() {
            return new Promise(function (resolve) {
              try {
                if (E && E.modal && typeof E.modal.show === "function") {
                  E.modal.show(
                    "Migrate local POCT data to cloud?",
                    "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>",
                    [
                      { label: "Not now", onClick: function () { try { E.modal.hide(); } catch (e) {} resolve(false); } },
                      { label: "Migrate", primary: true, onClick: function () { try { E.modal.hide(); } catch (e) {} resolve(true); } }
                    ]
                  );
                } else {
                  resolve(window.confirm(msg));
                }
              } catch (e3) {
                resolve(false);
              }
            });
          }

          var ok = await askConfirm();
          if (!ok) return;

          // Set state from legacy payload
          __cloud.records = deepClone(recs);
          if (Array.isArray(pats) && pats.length) {
            __cloud.patients = deepClone(pats);
          } else {
            // Best-effort patient list from records
            var map = {};
            for (var i = 0; i < recs.length; i++) {
              var r = recs[i] || {};
              var p = r.patient || {};
              var pid = String(p.patientId || "").trim();
              if (!pid) continue;
              var nowIso2 = nowIso();
              var seen = String(r.performedAtIso || "").trim() || nowIso2;
              var cur = map[pid];
              if (!cur) {
                map[pid] = {
                  patientId: pid,
                  name: String(p.name || ""),
                  phone: String(p.phone || ""),
                  age: (p.age === null || p.age === undefined) ? null : p.age,
                  address: String(p.address || ""),
                  createdAtIso: nowIso2,
                  updatedAtIso: nowIso2,
                  lastSeenIso: seen,
                  conflicts: []
                };
              } else {
                // update lastSeen if newer
                if (String(cur.lastSeenIso || "") < seen) cur.lastSeenIso = seen;
              }
            }
            var out = [];
            for (var k in map) out.push(map[k]);
            __cloud.patients = out;
          }

          // Push to cloud immediately
          await cloudSaveNow();

          // Remove legacy local keys after successful migrate
          try { window.localStorage.removeItem(STORAGE_KEY); } catch (e4) {}
          try { window.localStorage.removeItem(PATIENTS_KEY); } catch (e5) {}

          try { if (window.__POCT_TOAST) window.__POCT_TOAST("Migrated local POCT data to cloud", "good", ""); } catch (e6) {}
          try { dbg("[poct] legacy local data migrated to cloud", { records: (__cloud.records||[]).length, patients: (__cloud.patients||[]).length }); } catch (e7) {}
        } catch (e) {
          err("[poct] legacy migrate failed", e);
        }
      }
      await tryMigrateLegacyLocalToCloud();

      function migrateV2Once(){
        try{
          if(__cloud.migratedV2) return;
        }catch(e){}
        var all = loadRecords();
        var changed = false;
        for(var i=0;i<all.length;i++){
          var r = all[i] || {};
          if(!r.patient) continue;
          var pidBefore = String(r.patient.patientId || "");
          var pidAfter = normalizePatientId(pidBefore);
          if(pidAfter && pidAfter !== pidBefore){
            r.patient.patientId = pidAfter;
            changed = true;
          }else if(pidAfter && pidBefore && pidBefore !== pidBefore.toUpperCase()){
            r.patient.patientId = pidAfter;
            changed = true;
          }
          all[i] = r;
        }
        if(changed){
          dbg("[poct] migration: normalized patient IDs in records");
          saveRecords(all);
        }
        // Do NOT wipe patients on every load (cloud-backed). Only rebuild if patients list is empty and records exist.
        try{
          var pats = loadPatients();
          if((!pats || !pats.length) && all && all.length){
            dbg("[poct] rebuilding patients from records (patients list empty)");
            rebuildPatientsFromRecords(true);
          }
        }catch(e2){
          err("[poct] migration rebuild error", e2);
        }
        __cloud.migratedV2 = true;
      }
      migrateV2Once();
wirePatientIdInput(document.getElementById("bp_pid"), document.getElementById("bp_name"), document.getElementById("bp_phone"), document.getElementById("bp_age"), document.getElementById("bp_address"));
      wirePatientIdInput(document.getElementById("ur_pid"), document.getElementById("ur_name"), document.getElementById("ur_phone"), document.getElementById("ur_age"), document.getElementById("ur_address"));
      wirePatientIdInput(document.getElementById("hb_pid"), document.getElementById("hb_name"), document.getElementById("hb_phone"), document.getElementById("hb_age"), document.getElementById("hb_address"));
      wirePatientIdInput(document.getElementById("bg_pid"), document.getElementById("bg_name"), document.getElementById("bg_phone"), document.getElementById("bg_age"), document.getElementById("bg_address"));
      wirePatientIdInput(document.getElementById("ch_pid"), document.getElementById("ch_name"), document.getElementById("ch_phone"), document.getElementById("ch_age"), document.getElementById("ch_address"));
      wirePatientIdInput(document.getElementById("bm_pid"), document.getElementById("bm_name"), document.getElementById("bm_phone"), document.getElementById("bm_age"), document.getElementById("bm_address"));
      function fillSelect(id, options, defaultValue){
        var el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = "";
        for(var i=0;i<options.length;i++){
          var o = document.createElement("option");
          o.value = options[i];
          o.textContent = options[i];
          if(defaultValue && options[i] === defaultValue) o.selected = true;
          el.appendChild(o);
        }
      }
      function initUrineScales(){
        var semi = ["Negative","Trace","+","++","+++"];
        fillSelect("ur_leu", semi, "Negative");
        fillSelect("ur_pro", semi, "Negative");
        fillSelect("ur_bld", semi, "Negative");
        fillSelect("ur_ket", ["Negative","Trace","+","++","+++"], "Negative");
        fillSelect("ur_glu", ["Negative","Trace","+","++","+++"], "Negative");
        fillSelect("ur_nit", ["Negative","Positive"], "Negative");
        fillSelect("ur_uro", ["Normal","+","++","+++"], "Normal");
        fillSelect("ur_ph", ["5.0","5.5","6.0","6.5","7.0","7.5","8.0","8.5","9.0"], "7.0");
      }
      initUrineScales();
      function hba1cPctToMmol(pct){
        var p = Number(pct);
        if(isNaN(p)) return null;
        return Math.round((p - 2.15) * 10.929);
      }
      function hba1cMmolToPct(mmol){
        var m = Number(mmol);
        if(isNaN(m)) return null;
        var pct = (m / 10.929) + 2.15;
        return Math.round(pct * 10) / 10;
      }
      var hbPctEl = document.getElementById("hb_pct");
      var hbMmolEl = document.getElementById("hb_mmol");
      var hbLock = false;
      hbPctEl.addEventListener("input", function(){
        if(hbLock) return;
        var pct = numOrNull(hbPctEl.value);
        hbLock = true;
        if(pct === null){
          hbMmolEl.value = "";
        }else{
          var mmol = hba1cPctToMmol(pct);
          hbMmolEl.value = (mmol === null ? "" : String(mmol));
        }
        hbLock = false;
      });
      hbMmolEl.addEventListener("input", function(){
        if(hbLock) return;
        var mmol = numOrNull(hbMmolEl.value);
        hbLock = true;
        if(mmol === null){
          hbPctEl.value = "";
        }else{
          var pct = hba1cMmolToPct(mmol);
          hbPctEl.value = (pct === null ? "" : String(pct));
        }
        hbLock = false;
      });
      var chTcEl = document.getElementById("ch_tc");
      var chHdlEl = document.getElementById("ch_hdl");
      var chRatioEl = document.getElementById("ch_ratio");
      function updateChRatio(){
        var tc = numOrNull(chTcEl.value);
        var hdl = numOrNull(chHdlEl.value);
        if(tc === null || hdl === null || hdl === 0){
          chRatioEl.value = "";
          return;
        }
        var ratio = tc / hdl;
        chRatioEl.value = ratio.toFixed(2);
      }
      chTcEl.addEventListener("input", updateChRatio);
      chHdlEl.addEventListener("input", updateChRatio);
      var bmWeightEl = document.getElementById("bm_weight");
      var bmHeightEl = document.getElementById("bm_height");
      var bmBmiEl = document.getElementById("bm_bmi");
      var bmCatEl = document.getElementById("bm_cat");
      function bmiCategory(bmi){
        if(bmi === null) return "";
        if(bmi < 18.5) return "Underweight (< 18.5)";
        if(bmi < 25) return "Normal (18.5–24.9)";
        if(bmi < 30) return "Overweight (25–29.9)";
        if(bmi < 35) return "Obesity Class I (30–34.9)";
        if(bmi < 40) return "Obesity Class II (35–39.9)";
        return "Obesity Class III (≥ 40)";
      }
      function updateBmi(){
        var w = numOrNull(bmWeightEl.value);
        var hcm = numOrNull(bmHeightEl.value);
        if(w === null || hcm === null || hcm <= 0){
          bmBmiEl.value = "";
          bmCatEl.value = "";
          return;
        }
        var hm = hcm / 100.0;
        var bmi = w / (hm * hm);
        var bmiRounded = Math.round(bmi * 10) / 10;
        bmBmiEl.value = String(bmiRounded);
        bmCatEl.value = bmiCategory(bmiRounded);
      }
      bmWeightEl.addEventListener("input", updateBmi);
      bmHeightEl.addEventListener("input", updateBmi);
      function must(s){ return String(s||"").trim(); }
      function validateCommon(dtEl, nameEl, pidEl, phoneEl){
        var dt = must(dtEl.value);
        var name = must(nameEl.value);
        var pid = must(pidEl.value);
        var phone = must(phoneEl.value);
        if(!dt){ toast("Date & time is required", "warn"); return null; }
        if(!name){ toast("Patient name is required", "warn"); return null; }
        if(!pid){ toast("Patient ID is required", "warn"); return null; }
        if(!phone){ toast("Contact number is required", "warn"); return null; }
        var d = parseLocalDatetimeValue(dt);
        if(!d){ toast("Invalid date/time format", "warn"); return null; }
        return { dtLocal: dt, dtIso: toIso(d) };
      }
      function patientObj(nameEl, pidEl, phoneEl, ageEl, addrEl){
        return {
          name: must(nameEl.value),
          patientId: normalizePatientId(must(pidEl.value)),
          phone: must(phoneEl.value),
          age: numOrNull(ageEl.value),
          address: must(addrEl.value)
        };
      }
      function commonMeta(notesEl, interventionEl){
        return {
          feeDue: 0,
          notes: must(notesEl.value),
          intervention: interventionEl ? must(interventionEl.value) : ""
        };
      }
      function buildRecord(type, existingId, dtIso, dtLocal, patient, meta, results){
        return {
          id: existingId || uid(),
          testType: type,
          testLabel: testLabel(type),
          performedAtIso: dtIso,
          performedAtLocal: dtLocal, // stored as entered
          patient: patient,
          feeDue: meta.feeDue,
          notes: meta.notes,
          intervention: meta.intervention || "",
          results: results || {},
          updatedAtIso: toIso(new Date())
        };
      }
      function recordResultsAsRows(r){
        var res = (r && r.results) ? r.results : {};
        var rows = [];
        function add(k, v){
          rows.push({k:k, v:(v === null || v === undefined ? "" : String(v))});
        }
        if(r.testType === "bp"){
          add("Systolic (mmHg)", res.sys);
          add("Diastolic (mmHg)", res.dia);
          add("Pulse (bpm)", res.pulse);
          add("Arm", res.arm);
          add("Position", res.position);
        }else if(r.testType === "urine"){
          add("Leukocytes", res.leu);
          add("Nitrite", res.nit);
          add("Urobilinogen", res.uro);
          add("Protein", res.pro);
          add("pH", res.ph);
          add("Blood", res.bld);
          add("Ketone", res.ket);
          add("Glucose", res.glu);
          add("Appearance", res.appearance);
        }else if(r.testType === "hba1c"){
          add("HbA1c (%)", res.pct);
          add("HbA1c (mmol/mol)", res.mmol);
        }else if(r.testType === "bg"){
          add("Blood Glucose (mmol/L)", res.glucose);
          add("Timing", res.timing);
        }else if(r.testType === "chol"){
          add("Total Cholesterol (mmol/L)", res.tc);
          add("HDL (mmol/L)", res.hdl);
          add("LDL (mmol/L)", res.ldl);
          add("Triglycerides (mmol/L)", res.tg);
          add("TC/HDL Ratio", res.ratio);
          add("Fasting", res.fasting);
        }else if(r.testType === "bmi"){
          add("Weight (kg)", res.weight);
          add("Height (cm)", res.height);
          add("BMI", res.bmi);
          add("BMI Category", res.category);
          add("Waist (cm)", res.waist);
        }else{
          for(var k in res){
            if(Object.prototype.hasOwnProperty.call(res,k)) add(k, res[k]);
          }
        }
        var cleaned = [];
        for(var i=0;i<rows.length;i++){
          var vv = String(rows[i].v || "").trim();
          if(vv !== "" || rows[i].k === "pH") cleaned.push(rows[i]);
        }
        return cleaned;
      }
      function printRecord(id){
        var r = getById(id);
        if(!r){ toast("Record not found", "bad"); return; }
        var p = r.patient || {};
        var rows = recordResultsAsRows(r);

        var w = window.open("", "_blank");
        if(!w){
          try{
            if(E && E.modal && typeof E.modal.show === "function"){
              E.modal.show("Print", "<div style=\"white-space:pre-wrap\">Popup blocked. Allow popups and try again.</div>", [{ label: "Close", primary: true, onClick: function(){ try{ E.modal.hide(); }catch(e){} } }]);
            }else{
              toast("Popup blocked. Allow popups to print.", "warn");
            }
          }catch(e){
            toast("Popup blocked. Allow popups to print.", "warn");
          }
          return;
        }

        var html = "";
        html += "<!doctype html><html><head><meta charset='utf-8'/>";
        html += "<meta name='viewport' content='width=device-width,initial-scale=1'/>";
        html += "<title>POCT - " + esc(r.testLabel||"Result") + "</title>";
        html += "<style>";
        html += "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}";
        html += "button{position:fixed;right:14px;top:14px;padding:8px 10px;font-weight:800;}";
        html += "h1{margin:0 0 4px 0;font-size:18px;}";
        html += ".meta{font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;}";
        html += ".box{border:1px solid #ddd;border-radius:10px;padding:10px;margin-top:12px;}";
        html += ".grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}";
        html += ".k{font-size:11px;color:#555;margin-bottom:3px;}";
        html += ".v{font-size:13px;}";
        html += "table{width:100%;border-collapse:collapse;margin-top:10px;}";
        html += "th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top;text-align:left;}";
        html += "th{background:#f5f5f5;}";
        html += "@media print{button{display:none!important;} body{margin:0;}}";
        html += "</style></head><body>";
        html += "<button onclick='window.print()'>Print</button>";

        html += "<h1>" + esc(r.testLabel||"POCT") + " Result</h1>";
        html += "<div class='meta'>Date/Time: " + esc(formatDisplayDatetime(r.performedAtIso)) + "\nPrinted: " + esc(new Date().toLocaleString()) + "</div>";

        html += "<div class='box'><div class='grid'>";
        html += "<div><div class='k'>Patient Name</div><div class='v'><strong>" + esc(p.name||"") + "</strong></div></div>";
        html += "<div><div class='k'>Patient ID</div><div class='v'><strong>" + esc(p.patientId||"") + "</strong></div></div>";
        html += "<div><div class='k'>Contact Number</div><div class='v'>" + esc(p.phone||"") + "</div></div>";
        html += "<div><div class='k'>Age</div><div class='v'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</div></div>";
        html += "<div style='grid-column:1 / span 2;'><div class='k'>Address</div><div class='v'>" + esc(p.address||"") + "</div></div>";
        html += "</div></div>";

        html += "<div class='box'>";
        html += "<div class='k'>Results</div>";
        html += "<table><thead><tr><th style='width:40%'>Parameter</th><th>Value</th></tr></thead><tbody>";
        for(var i=0;i<rows.length;i++){
          html += "<tr><td>" + esc(rows[i].k) + "</td><td>" + esc(rows[i].v) + "</td></tr>";
        }
        if(rows.length === 0){
          html += "<tr><td colspan='2'>No results recorded</td></tr>";
        }
        html += "</tbody></table>";
        html += "</div>";

        if(must(r.intervention||"")){
          html += "<div class='box'><div class='k'>Intervention / Medication started</div><div class='v'>" + esc(r.intervention||"") + "</div></div>";
        }
        html += "<div class='box'><div class='k'>Notes</div><div class='v'>" + esc(r.notes||"") + "</div></div>";

        html += "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script>";
        html += "</body></html>";

        w.document.open();
        w.document.write(html);
        w.document.close();
        try{ w.focus(); }catch(e){}
      }
      function printRecordList(records, title){
        var list = Array.isArray(records) ? records.slice() : [];
        var t = String(title || "Records");

        var w = window.open("", "_blank");
        if(!w){
          try{
            if(E && E.modal && typeof E.modal.show === "function"){
              E.modal.show("Print", "<div style=\"white-space:pre-wrap\">Popup blocked. Allow popups and try again.</div>", [{ label: "Close", primary: true, onClick: function(){ try{ E.modal.hide(); }catch(e){} } }]);
            }else{
              toast("Popup blocked. Allow popups to print.", "warn");
            }
          }catch(e){
            toast("Popup blocked. Allow popups to print.", "warn");
          }
          return;
        }

        var html = "";
        html += "<!doctype html><html><head><meta charset='utf-8'/>";
        html += "<meta name='viewport' content='width=device-width,initial-scale=1'/>";
        html += "<title>POCT - " + esc(t) + "</title>";
        html += "<style>";
        html += "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}";
        html += "button{position:fixed;right:14px;top:14px;padding:8px 10px;font-weight:800;}";
        html += "h1{margin:0 0 4px 0;font-size:18px;}";
        html += ".meta{font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;}";
        html += "table{width:100%;border-collapse:collapse;margin-top:10px;}";
        html += "th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top;text-align:left;}";
        html += "th{background:#f5f5f5;}";
        html += "@media print{button{display:none!important;} body{margin:0;}}";
        html += "</style></head><body>";
        html += "<button onclick='window.print()'>Print</button>";

        html += "<h1>" + esc(t) + "</h1>";
        html += "<div class='meta'>Rows: " + esc(String(list.length)) + "\nPrinted: " + esc(new Date().toLocaleString()) + "</div>";

        html += "<table><thead><tr>";
        html += "<th>Date/Time</th><th>Test</th><th>Patient</th><th>Patient ID</th><th>Phone</th><th>Age</th><th>Results</th><th>Intervention</th><th>Notes</th>";
        html += "</tr></thead><tbody>";

        for(var i=0;i<list.length;i++){
          var r = list[i] || {};
          var p = r.patient || {};
          html += "<tr>";
          html += "<td>" + esc(formatDisplayDatetime(r.performedAtIso)) + "</td>";
          html += "<td>" + esc(r.testLabel||"") + "</td>";
          html += "<td>" + esc(p.name||"") + "</td>";
          html += "<td>" + esc(p.patientId||"") + "</td>";
          html += "<td>" + esc(p.phone||"") + "</td>";
          html += "<td>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td>" + esc(resultSummary(r)) + "</td>";
          html += "<td>" + esc(r.intervention||"") + "</td>";
          html += "<td>" + esc(r.notes||"") + "</td>";
          html += "</tr>";
        }
        if(list.length === 0){
          html += "<tr><td colspan='9'>No records.</td></tr>";
        }

        html += "</tbody></table>";
        html += "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script>";
        html += "</body></html>";

        w.document.open();
        w.document.write(html);
        w.document.close();
        try{ w.focus(); }catch(e){}
      }
      function resultSummary(r){
        var res = (r && r.results) ? r.results : {};
        if(r.testType === "bp"){
          var s = [];
          if(res.sys !== "" && res.sys !== null && res.sys !== undefined) s.push("Sys " + res.sys);
          if(res.dia !== "" && res.dia !== null && res.dia !== undefined) s.push("Dia " + res.dia);
          if(res.pulse !== "" && res.pulse !== null && res.pulse !== undefined) s.push("Pulse " + res.pulse);
          return s.join(", ");
        }
        if(r.testType === "urine"){
          return "LEU " + (res.leu||"-") + ", NIT " + (res.nit||"-") + ", PRO " + (res.pro||"-") + ", GLU " + (res.glu||"-");
        }
        if(r.testType === "hba1c"){
          var a = (res.pct!==null && res.pct!==undefined && String(res.pct).trim()!=="") ? (res.pct + "%") : "";
          var b = (res.mmol!==null && res.mmol!==undefined && String(res.mmol).trim()!=="") ? (res.mmol + " mmol/mol") : "";
          return (a && b) ? (a + " (" + b + ")") : (a || b || "");
        }
        if(r.testType === "bg"){
          return (res.glucose!==null && res.glucose!==undefined && String(res.glucose).trim()!=="" ? (res.glucose + " mmol/L") : "") + (res.timing ? (" (" + res.timing + ")") : "");
        }
        if(r.testType === "chol"){
          var parts = [];
          if(res.tc) parts.push("TC " + res.tc);
          if(res.hdl) parts.push("HDL " + res.hdl);
          if(res.ldl) parts.push("LDL " + res.ldl);
          if(res.tg) parts.push("TG " + res.tg);
          if(res.ratio) parts.push("R " + res.ratio);
          return parts.join(", ");
        }
        if(r.testType === "bmi"){
          var p2 = [];
          if(res.weight) p2.push(res.weight + "kg");
          if(res.height) p2.push(res.height + "cm");
          if(res.bmi) p2.push("BMI " + res.bmi);
          return p2.join(", ");
        }
        var ks = [];
        for(var k in res){
          if(Object.prototype.hasOwnProperty.call(res, k)){
            if(String(res[k]||"").trim()!=="") ks.push(k + ":" + res[k]);
          }
        }
        return ks.slice(0,4).join(", ");
      }
      function sortNewestFirst(a,b){
        var da = new Date(a.performedAtIso).getTime();
        var db = new Date(b.performedAtIso).getTime();
        if(isNaN(da)) da = 0;
        if(isNaN(db)) db = 0;
        return db - da;
      }
      function getAllSorted(){
        var all = loadRecords();
        all.sort(sortNewestFirst);
        return all;
      }
      function renderDashboard(){
        var all = getAllSorted();
        document.getElementById("dashTotal").value = String(all.length);
        var seen = {};
        var count = 0;
        for(var i=0;i<all.length;i++){
          var r = all[i];
          var p = r.patient || {};
          var key = "";
          if(p.patientId) key = "ID:" + lower(p.patientId);
          else if(p.phone) key = "PH:" + lower(p.phone);
          else key = "NM:" + lower(p.name||"");
          if(!seen[key]){
            seen[key] = true;
            count++;
          }
        }
        var pm = loadPatients();
        if(pm && pm.length) count = pm.length;
        document.getElementById("dashPatients").value = String(count);
        var q = lower(document.getElementById("dashSearch").value || "");
        var tbody = document.getElementById("dashTbody");
        var rows = [];
        for(var j=0;j<all.length;j++){
          var rr = all[j];
          if(q){
            if(recordSearchHaystack(rr).indexOf(q) === -1) continue;
          }
          rows.push(rr);
          if(rows.length >= 12) break;
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='9' class='muted'>No matches.</td></tr>";
          return;
        }
        var html = "";
        for(var k=0;k<rows.length;k++){
          var r2 = rows[k];
          var p2 = r2.patient || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(r2.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><span class='tag'>" + esc(r2.testLabel||"") + "</span></td>";
          html += "<td class='nowrap'><strong>" + esc(p2.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p2.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p2.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p2.age===null||p2.age===undefined?"":String(p2.age)) + "</td>";
          html += "<td class='wrap'>" + esc(resultSummary(r2)) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(r2.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='goto' data-type='" + esc(r2.testType) + "' data-id='" + esc(r2.id) + "'>✏️ Edit</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
      }
      function bindDashboardActions(){
        var tbody = document.getElementById("dashTbody");
        tbody.addEventListener("click", function(e){
          var t = e.target;
          if(t && t.nodeType === 3) t = t.parentNode; // TEXT_NODE -> element
          var btn = null;
          if(t){
            if(t.closest){
              btn = t.closest("button");
            }else{
              var cur = t;
              while(cur && cur !== tbody){
                if(cur.tagName && String(cur.tagName).toLowerCase() === "button"){ btn = cur; break; }
                cur = cur.parentNode;
              }
            }
          }
          if(!btn) return;
          var act = btn.getAttribute("data-act");
          var id = btn.getAttribute("data-id");
          if(act === "print" && id){
            printRecord(id);
            return;
          }
          if(act === "goto" && id){
            var type = btn.getAttribute("data-type");
            jumpToEdit(type, id);
            return;
          }
        });
      }
      bindDashboardActions();
      function filterByTest(type){
        var all = getAllSorted();
        var out = [];
        for(var i=0;i<all.length;i++){
          if(all[i].testType === type) out.push(all[i]);
        }
        return out;
      }
      var __PT_SELECTED_ID = null;
      function parseDateOnly(s){
        if(!s) return null;
        var d = new Date(String(s) + "T00:00:00");
        if(isNaN(d.getTime())) return null;
        return d;
      }
      function inDateRange(iso, fromDate, toDate){
        if(!iso) return true;
        var d = new Date(iso);
        if(isNaN(d.getTime())) return true;
        if(fromDate){
          var start = new Date(fromDate.getTime());
          if(d.getTime() < start.getTime()) return false;
        }
        if(toDate){
          var end = new Date(toDate.getTime());
          end.setHours(23,59,59,999);
          if(d.getTime() > end.getTime()) return false;
        }
        return true;
      }
      function getPatientRecords(pidNorm, fromDate, toDate){
        var all = getAllSorted();
        var out = [];
        for(var i=0;i<all.length;i++){
          var r = all[i] || {};
          var p = r.patient || {};
          var pid = normalizePatientId(p.patientId || "");
          if(pid !== pidNorm) continue;
          if(!inDateRange(r.performedAtIso, fromDate, toDate)) continue;
          out.push(r);
        }
        out.reverse();
        return out;
      }
      function seriesFromRecords(records, kind){
        var out = [];
        for(var i=0;i<records.length;i++){
          var r = records[i] || {};
          var res = r.results || {};
          if(kind === "hba1c"){
            if(r.testType === "hba1c"){
              // Support both current keys (pct/mmol) and older/legacy keys
              var v = numOrNull(res.pct);
              if(v===null || v===undefined) v = numOrNull(res.hba1c_pct);
              if(v===null || v===undefined) v = numOrNull(res.hba1cPct);
              if(v!==null && v!==undefined) out.push(v);
            }
          }else if(kind === "bg"){
            var tt = String(r.testType||"");
            if(tt === "bg" || tt === "bloodglucose" || tt === "blood_glucose" || tt === "glucose"){
              var vbg = numOrNull(res.glucose);
              if(vbg===null || vbg===undefined) vbg = numOrNull(res.bg);
              if(vbg===null || vbg===undefined) vbg = numOrNull(res.bloodGlucose);
              if(vbg===null || vbg===undefined) vbg = numOrNull(res.blood_glucose);
              if(vbg!==null && vbg!==undefined) out.push(vbg);
            }
          }else if(kind === "tc"){
            var tt2 = String(r.testType||"");
            if(tt2 === "chol" || tt2 === "cholesterol" || tt2 === "tc"){
              var v2 = numOrNull(res.tc);
              if(v2===null || v2===undefined) v2 = numOrNull(res.total);
              if(v2===null || v2===undefined) v2 = numOrNull(res.totalCholesterol);
              if(v2!==null && v2!==undefined) out.push(v2);
            }
          }else if(kind === "bmi"){
            if(r.testType === "bmi"){
              var v3 = numOrNull(res.bmi);
              if(v3!==null && v3!==undefined) out.push(v3);
            }
          }else if(kind === "bp_sys"){
            if(r.testType === "bp"){
              var v4 = numOrNull(res.sys);
              if(v4!==null && v4!==undefined) out.push(v4);
            }
          }else if(kind === "bp_dia"){
            if(r.testType === "bp"){
              var v5 = numOrNull(res.dia);
              if(v5!==null && v5!==undefined) out.push(v5);
            }
          }
        }
        return out;
      }

function sparkSvg(values, big){
        if(!values || values.length === 0){
          return "<span class='muted'>—</span>";
        }
        // If only one value exists, duplicate it so the chart still renders (flat line + dot).
        var vals = values;
        if(values.length === 1){
          vals = [values[0], values[0]];
        }
        var min = vals[0], max = vals[0];
        for(var i=0;i<vals.length;i++){
          var v = vals[i];
          if(v < min) min = v;
          if(v > max) max = v;
        }
        if(min === max){
          min = min - 1;
          max = max + 1;
        }
        var w = 100, h = 30, pad = 4;
        if(big){ h = 64; pad = 6; }
        var pts = [];
        for(var j=0;j<vals.length;j++){
          var x = pad + (j * (w - pad*2) / (vals.length - 1));
          var y = pad + ((max - vals[j]) * (h - pad*2) / (max - min));
          pts.push([x,y]);
        }
        var d = "";
        for(var k=0;k<pts.length;k++){
          d += (k===0 ? "M" : " L") + pts[k][0].toFixed(2) + " " + pts[k][1].toFixed(2);
        }
        var cls = big ? "spark big" : "spark";
        var axisY = (h/2).toFixed(2);
        var last = pts[pts.length-1];
        return "<svg class='" + cls + "' viewBox='0 0 " + w + " " + h + "' preserveAspectRatio='none'>"
          + "<path class='axis' d='M0 " + axisY + " L" + w + " " + axisY + "'/>"
          + "<path d='" + d + "'/>"
          + "<circle class='dot' cx='" + last[0].toFixed(2) + "' cy='" + last[1].toFixed(2) + "' r='" + (big?2.6:2.2) + "'/>"
          + "</svg>";
      }

function sparkSvgDual(values1, values2, big){
        if(!values1 || values1.length < 2) return "<span class='muted'>—</span>";
        if(!values2 || values2.length < 2) return sparkSvg(values1, big);
        var n = Math.max(values1.length, values2.length);
        function valAt(arr, idx){
          if(idx < arr.length) return arr[idx];
          return arr[arr.length-1];
        }
        var min = valAt(values1,0), max = valAt(values1,0);
        for(var i=0;i<n;i++){
          var a = valAt(values1,i);
          var b = valAt(values2,i);
          if(a < min) min = a;
          if(a > max) max = a;
          if(b < min) min = b;
          if(b > max) max = b;
        }
        if(min === max){ min = min - 1; max = max + 1; }
        var w = 100, h = 30, pad = 4;
        if(big){ h = 64; pad = 6; }
        function pathFrom(arr){
          var pts=[];
          for(var j=0;j<n;j++){
            var x = pad + (j * (w - pad*2) / (n - 1));
            var y = pad + ((max - valAt(arr,j)) * (h - pad*2) / (max - min));
            pts.push([x,y]);
          }
          var d="";
          for(var k=0;k<pts.length;k++){
            d += (k===0?"M":" L") + pts[k][0].toFixed(2) + " " + pts[k][1].toFixed(2);
          }
          return {d:d, last: pts[pts.length-1]};
        }
        var p1 = pathFrom(values1);
        var p2 = pathFrom(values2);
        var cls = big ? "spark big" : "spark";
        var axisY = (h/2).toFixed(2);
        return "<svg class='" + cls + "' viewBox='0 0 " + w + " " + h + "' preserveAspectRatio='none'>"
          + "<path class='axis' d='M0 " + axisY + " L" + w + " " + axisY + "'/>"
          + "<path d='" + p1.d + "'/>"
          + "<path class='line2' d='" + p2.d + "'/>"
          + "<circle class='dot' cx='" + p1.last[0].toFixed(2) + "' cy='" + p1.last[1].toFixed(2) + "' r='" + (big?2.6:2.2) + "'/>"
          + "<circle class='dot2' cx='" + p2.last[0].toFixed(2) + "' cy='" + p2.last[1].toFixed(2) + "' r='" + (big?2.6:2.2) + "'/>"
          + "</svg>";
      }
      function renderPatients(){
        var sec = document.getElementById("sec-patients");
        if(!sec) return;
        var q = lower(document.getElementById("pt_search").value || "");
        var fromDate = parseDateOnly(document.getElementById("pt_from").value || "");
        var toDate = parseDateOnly(document.getElementById("pt_to").value || "");
        rebuildPatientsFromRecords(false);
        var patients = loadPatients();
        var tbody = document.getElementById("pt_tbody");
        var rows = [];
        for(var i=0;i<patients.length;i++){
          var p = patients[i] || {};
          var pid = normalizePatientId(p.patientId || "");
          if(!pid) continue;
          var hit = true;
          if(q){
            var hay = lower([p.name||"", pid, p.phone||"", p.address||""].join(" | "));
            hit = hay.indexOf(q) !== -1;
            if(!hit){
              var prs = getPatientRecords(pid, fromDate, toDate);
              for(var k=prs.length-1; k>=0 && k>prs.length-8; k--){
                if(recordSearchHaystack(prs[k]).indexOf(q) !== -1){ hit = true; break; }
              }
            }
          }
          if(!hit) continue;
          var recs = getPatientRecords(pid, fromDate, toDate);
          var lastSeen = "";
          if(recs.length > 0){
            lastSeen = recs[recs.length-1].performedAtIso || "";
          }else{
            lastSeen = p.lastSeenIso || "";
            if((fromDate || toDate) && lastSeen && !inDateRange(lastSeen, fromDate, toDate)) lastSeen = "";
          }
          var sHb = seriesFromRecords(recs, "hba1c");
          var sBg = seriesFromRecords(recs, "bg");
          var sTc = seriesFromRecords(recs, "tc");
          var sBmi = seriesFromRecords(recs, "bmi");
          var sSys = seriesFromRecords(recs, "bp_sys");
          var sDia = seriesFromRecords(recs, "bp_dia");
          var flags = [];
          var ccount = (Array.isArray(p.conflicts) ? p.conflicts.length : 0);
          if(ccount > 0) flags.push("<span class='badge warn'>⚠️ " + ccount + "</span>");
          if(flags.length === 0) flags.push("<span class='badge good'>OK</span>");
          rows.push({
            patient: p,
            pid: pid,
            lastSeen: lastSeen,
            hb: sHb, bg: sBg, tc: sTc, bmi: sBmi, sys: sSys, dia: sDia,
            flagsHtml: flags.join(" ")
          });
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='12' class='muted'>No patients match the current filters.</td></tr>";
          return;
        }
        var html = "";
        for(var r=0;r<rows.length;r++){
          var row = rows[r];
          var p2 = row.patient || {};
          html += "<tr>";
          html += "<td class='nowrap'><strong>" + esc(p2.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(row.pid) + "</td>";
          html += "<td class='nowrap mono'>" + esc(p2.phone||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p2.age===null||p2.age===undefined?"":String(p2.age)) + "</td>";
          html += "<td class='nowrap mono'>" + esc(row.lastSeen ? formatDisplayDatetime(row.lastSeen) : "") + "</td>";
          html += "<td class='spark-cell'><div class='spark-cell-wrap'>" + sparkSvg(row.hb, false) + "</div></td>";
          html += "<td class='spark-cell'><div class='spark-cell-wrap'>" + sparkSvg(row.bg, false) + "</div></td>";
          html += "<td class='spark-cell'><div class='spark-cell-wrap'>" + sparkSvg(row.tc, false) + "</div></td>";
          html += "<td class='spark-cell'><div class='spark-cell-wrap'>" + sparkSvg(row.bmi, false) + "</div></td>";
          html += "<td class='spark-cell'><div class='spark-cell-wrap'>" + sparkSvgDual(row.sys, row.dia, false) + "</div></td>";
          html += "<td class='nowrap'>" + row.flagsHtml + "</td>";
          html += "<td class='nowrap'><button class='btn small' data-pt-view='" + esc(row.pid) + "'><span>🔎</span>View</button></td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
        var btns = tbody.querySelectorAll("button[data-pt-view]");
        for(var b=0;b<btns.length;b++){
          btns[b].addEventListener("click", function(){
            var pid = this.getAttribute("data-pt-view");
            openPatientDetail(pid);
          });
        }
        if(__PT_SELECTED_ID){
          var still = getPatientById(__PT_SELECTED_ID);
          if(!still){
            closePatientDetail();
          }else{
            refreshPatientDetail();
          }
        }
      }
      function openPatientDetail(pid){
        var pidNorm = normalizePatientId(pid || "");
        if(!pidNorm) return;
        __PT_SELECTED_ID = pidNorm;
        document.getElementById("pt_detail_card").style.display = "";
        refreshPatientDetail();
        try{
          document.getElementById("pt_detail_card").scrollIntoView({behavior:"smooth", block:"start"});
        }catch(e){}
      }
      function closePatientDetail(){
        __PT_SELECTED_ID = null;
        var card = document.getElementById("pt_detail_card");
        if(card) card.style.display = "none";
      }
      function refreshPatientDetail(){
        if(!__PT_SELECTED_ID) return;
        var pid = __PT_SELECTED_ID;
        var p = getPatientById(pid);
        if(!p){ closePatientDetail(); return; }
        document.getElementById("pt_detail_title").textContent = (p.name ? p.name : "Patient") + " • " + pid;
        document.getElementById("pt_detail_hint").textContent = "Patient ID: " + pid;
        document.getElementById("pt_detail_name").value = p.name || "";
        document.getElementById("pt_detail_phone").value = p.phone || "";
        document.getElementById("pt_detail_age").value = (p.age===null||p.age===undefined) ? "" : String(p.age);
        document.getElementById("pt_detail_addr").value = p.address || "";
        document.getElementById("pt_detail_pid").value = pid;
        var recs = getPatientRecords(pid, null, null); // full history for detail
        var sHb = seriesFromRecords(recs, "hba1c");
        var sBg = seriesFromRecords(recs, "bg");
        var sTc = seriesFromRecords(recs, "tc");
        var sBmi = seriesFromRecords(recs, "bmi");
        var sSys = seriesFromRecords(recs, "bp_sys");
        var sDia = seriesFromRecords(recs, "bp_dia");
        document.getElementById("pt_chart_hba1c").innerHTML = sparkSvg(sHb, true);
        var __bgEl = document.getElementById("pt_chart_bg"); if(__bgEl) __bgEl.innerHTML = sparkSvg(sBg, true);
        document.getElementById("pt_chart_tc").innerHTML = sparkSvg(sTc, true);
        document.getElementById("pt_chart_bmi").innerHTML = sparkSvg(sBmi, true);
        document.getElementById("pt_chart_bp").innerHTML = sparkSvgDual(sSys, sDia, true);
        var tbody = document.getElementById("pt_records_tbody");
        if(!recs || recs.length === 0){
          tbody.innerHTML = "<tr><td colspan='6' class='muted'>No records for this patient yet.</td></tr>";
        }else{
          var html = "";
          for(var i=recs.length-1;i>=0;i--){
            var r = recs[i];
            var res = recordSummary(r);
            html += "<tr>";
            html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(r.performedAtIso)) + "</td>";
            html += "<td class='nowrap'><span class='tag'>" + esc(r.testLabel||"") + "</span></td>";
            html += "<td>" + esc(res) + "</td>";
            html += "<td>" + (must(r.intervention||"") ? ("<span class='tag inv'>💊 " + esc(r.intervention) + "</span>") : "<span class='muted'>—</span>") + "</td>";
            html += "<td>" + (must(r.notes||"") ? esc(r.notes) : "<span class='muted'>—</span>") + "</td>";
            html += "<td class='nowrap'>"
                  + "<button class='btn small' data-edit='" + esc(r.id) + "' data-type='" + esc(r.testType) + "'><span>✏️</span>Edit</button> "
                  + "<button class='btn small' data-print='" + esc(r.id) + "'><span>🖨️</span>Print</button> "
                  + "<button class='btn danger small' data-del='" + esc(r.id) + "'><span>🗑️</span>Delete</button>"
                  + "</td>";
            html += "</tr>";
          }
          tbody.innerHTML = html;
          var edits = tbody.querySelectorAll("button[data-edit]");
          for(var e=0;e<edits.length;e++){
            edits[e].addEventListener("click", function(){
              var id = this.getAttribute("data-edit");
              var type = this.getAttribute("data-type");
              jumpToEdit(type, id);
            });
          }
          var prints = tbody.querySelectorAll("button[data-print]");
          for(var pr=0;pr<prints.length;pr++){
            prints[pr].addEventListener("click", function(){
              var id = this.getAttribute("data-print");
              printRecord(id);
            });
          }
          var dels = tbody.querySelectorAll("button[data-del]");
          for(var dl=0;dl<dels.length;dl++){
            dels[dl].addEventListener("click", function(){
              var id = this.getAttribute("data-del");
              if(!id) return;
              var r0 = getById(id);
              var label = (r0 && r0.testLabel) ? r0.testLabel : "record";
              var ok = window.confirm("Delete this " + label + " record?\n\nThis cannot be undone.");
              if(!ok) return;
              deleteRecordById(id);
              toast("Record deleted", "good");
              // Refresh everything (patients list + charts + tables)
              renderAll();
            });
          }
        }
        var cbox = document.getElementById("pt_conflicts_box");
        var c = Array.isArray(p.conflicts) ? p.conflicts : [];
        if(c.length === 0){
          cbox.innerHTML = "<span class='badge good'>No duplicate warnings for this ID</span>";
        }else{
          var h = "<div style='margin-bottom:8px;'><span class='badge warn'>⚠️ Duplicate warnings: " + c.length + "</span></div>";
          h += "<div class='muted' style='font-size:12px;'>Latest warnings (same ID, different name/phone):</div>";
          h += "<div style='margin-top:6px;display:grid;gap:6px;'>";
          for(var i2=0;i2<Math.min(5,c.length);i2++){
            var w = c[i2];
            h += "<div style='border:1px solid var(--border);border-radius:12px;padding:8px;background:rgba(255,255,255,.03)'>";
            h += "<div class='mono' style='font-size:12px;'>" + esc(w.performedAtIso ? formatDisplayDatetime(w.performedAtIso) : (w.atIso||"")) + "</div>";
            h += "<div style='font-size:12px;'>Existing: <strong>" + esc(w.existingName||"") + "</strong> (" + esc(w.existingPhone||"") + ")</div>";
            h += "<div style='font-size:12px;'>Entered: <strong>" + esc(w.enteredName||"") + "</strong> (" + esc(w.enteredPhone||"") + ")</div>";
            h += "</div>";
          }
          h += "</div>";
          cbox.innerHTML = h;
        }
      }
function renderBP(){
        var q = lower(document.getElementById("bp_search").value || "");
        var from = document.getElementById("bp_from").value || "";
        var to = document.getElementById("bp_to").value || "";
        var list = filterByTest("bp");
        var tbody = document.getElementById("bp_tbody");
        var rows = [];
        for(var i=0;i<list.length;i++){
          var r = list[i];
          if(q && recordSearchHaystack(r).indexOf(q) === -1) continue;
          if(!withinDateRange(r.performedAtIso, from, to)) continue;
          rows.push(r);
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='12' class='muted'>No BP records match.</td></tr>";
          return;
        }
        var html = "";
        for(var j=0;j<rows.length;j++){
          var rr = rows[j];
          var p = rr.patient || {};
          var res = rr.results || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(rr.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><strong>" + esc(p.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.sys||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.dia||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.pulse||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.arm||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.position||"") + "</td>";
          html += "<td class='wrap'>" + notesHtml(rr) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(rr.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='edit' data-id='" + esc(rr.id) + "'>✏️ Edit</button>";
          html += "<button class='btn danger' data-act='del' data-id='" + esc(rr.id) + "'>🗑️ Delete</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
      }
      function renderUrine(){
        var q = lower(document.getElementById("ur_search").value || "");
        var from = document.getElementById("ur_from").value || "";
        var to = document.getElementById("ur_to").value || "";
        var list = filterByTest("urine");
        var tbody = document.getElementById("ur_tbody");
        var rows = [];
        for(var i=0;i<list.length;i++){
          var r = list[i];
          if(q && recordSearchHaystack(r).indexOf(q) === -1) continue;
          if(!withinDateRange(r.performedAtIso, from, to)) continue;
          rows.push(r);
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='17' class='muted'>No urine records match.</td></tr>";
          return;
        }
        var html = "";
        for(var j=0;j<rows.length;j++){
          var rr = rows[j];
          var p = rr.patient || {};
          var res = rr.results || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(rr.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><strong>" + esc(p.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td class='nowrap'>" + esc(res.leu||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.nit||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.uro||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.pro||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.ph||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.bld||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.ket||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.glu||"") + "</td>";
          html += "<td class='wrap'>" + esc(res.appearance||"") + "</td>";
          html += "<td class='wrap'>" + notesHtml(rr) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(rr.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='edit' data-id='" + esc(rr.id) + "'>✏️ Edit</button>";
          html += "<button class='btn danger' data-act='del' data-id='" + esc(rr.id) + "'>🗑️ Delete</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
      }
      function renderHbA1c(){
        var q = lower(document.getElementById("hb_search").value || "");
        var from = document.getElementById("hb_from").value || "";
        var to = document.getElementById("hb_to").value || "";
        var list = filterByTest("hba1c");
        var tbody = document.getElementById("hb_tbody");
        var rows = [];
        for(var i=0;i<list.length;i++){
          var r = list[i];
          if(q && recordSearchHaystack(r).indexOf(q) === -1) continue;
          if(!withinDateRange(r.performedAtIso, from, to)) continue;
          rows.push(r);
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='9' class='muted'>No HbA1c records match.</td></tr>";
          return;
        }
        var html = "";
        for(var j=0;j<rows.length;j++){
          var rr = rows[j];
          var p = rr.patient || {};
          var res = rr.results || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(rr.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><strong>" + esc(p.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.pct||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.mmol||"") + "</td>";
          html += "<td class='wrap'>" + notesHtml(rr) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(rr.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='edit' data-id='" + esc(rr.id) + "'>✏️ Edit</button>";
          html += "<button class='btn danger' data-act='del' data-id='" + esc(rr.id) + "'>🗑️ Delete</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
      }
      function renderBG(){
        var q = lower(document.getElementById("bg_search").value || "");
        var from = document.getElementById("bg_from").value || "";
        var to = document.getElementById("bg_to").value || "";
        var list = filterByTest("bg");
        var tbody = document.getElementById("bg_tbody");
        var rows = [];
        for(var i=0;i<list.length;i++){
          var r = list[i];
          if(q && recordSearchHaystack(r).indexOf(q) === -1) continue;
          if(!withinDateRange(r.performedAtIso, from, to)) continue;
          rows.push(r);
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='9' class='muted'>No blood glucose records match.</td></tr>";
          return;
        }
        var html = "";
        for(var j=0;j<rows.length;j++){
          var rr = rows[j];
          var p = rr.patient || {};
          var res = rr.results || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(rr.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><strong>" + esc(p.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.glucose||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.timing||"") + "</td>";
          html += "<td class='wrap'>" + notesHtml(rr) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(rr.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='edit' data-id='" + esc(rr.id) + "'>✏️ Edit</button>";
          html += "<button class='btn danger' data-act='del' data-id='" + esc(rr.id) + "'>🗑️ Delete</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
      }
      function renderChol(){
        var q = lower(document.getElementById("ch_search").value || "");
        var from = document.getElementById("ch_from").value || "";
        var to = document.getElementById("ch_to").value || "";
        var list = filterByTest("chol");
        var tbody = document.getElementById("ch_tbody");
        var rows = [];
        for(var i=0;i<list.length;i++){
          var r = list[i];
          if(q && recordSearchHaystack(r).indexOf(q) === -1) continue;
          if(!withinDateRange(r.performedAtIso, from, to)) continue;
          rows.push(r);
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='13' class='muted'>No cholesterol records match.</td></tr>";
          return;
        }
        var html = "";
        for(var j=0;j<rows.length;j++){
          var rr = rows[j];
          var p = rr.patient || {};
          var res = rr.results || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(rr.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><strong>" + esc(p.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.tc||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.hdl||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.ldl||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.tg||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.ratio||"") + "</td>";
          html += "<td class='nowrap'>" + esc(res.fasting||"") + "</td>";
          html += "<td class='wrap'>" + notesHtml(rr) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(rr.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='edit' data-id='" + esc(rr.id) + "'>✏️ Edit</button>";
          html += "<button class='btn danger' data-act='del' data-id='" + esc(rr.id) + "'>🗑️ Delete</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
      }
      function renderBMI(){
        var q = lower(document.getElementById("bm_search").value || "");
        var from = document.getElementById("bm_from").value || "";
        var to = document.getElementById("bm_to").value || "";
        var list = filterByTest("bmi");
        var tbody = document.getElementById("bm_tbody");
        var rows = [];
        for(var i=0;i<list.length;i++){
          var r = list[i];
          if(q && recordSearchHaystack(r).indexOf(q) === -1) continue;
          if(!withinDateRange(r.performedAtIso, from, to)) continue;
          rows.push(r);
        }
        if(rows.length === 0){
          tbody.innerHTML = "<tr><td colspan='12' class='muted'>No weight/BMI records match.</td></tr>";
          return;
        }
        var html = "";
        for(var j=0;j<rows.length;j++){
          var rr = rows[j];
          var p = rr.patient || {};
          var res = rr.results || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(rr.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><strong>" + esc(p.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.weight||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.height||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.bmi||"") + "</td>";
          html += "<td class='wrap'>" + esc(res.category||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(res.waist||"") + "</td>";
          html += "<td class='wrap'>" + notesHtml(rr) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(rr.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='edit' data-id='" + esc(rr.id) + "'>✏️ Edit</button>";
          html += "<button class='btn danger' data-act='del' data-id='" + esc(rr.id) + "'>🗑️ Delete</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
      }
      function renderAllRecords(){
        var q = lower(document.getElementById("all_search").value || "");
        var type = document.getElementById("all_type").value || "";
        var sort = document.getElementById("all_sort").value || "dt_desc";
        var from = document.getElementById("all_from").value || "";
        var to = document.getElementById("all_to").value || "";
        var all = loadRecords().slice();
        var out = [];
        for(var i=0;i<all.length;i++){
          var r = all[i];
          if(type && r.testType !== type) continue;
          if(q && recordSearchHaystack(r).indexOf(q) === -1) continue;
          if(!withinDateRange(r.performedAtIso, from, to)) continue;
          out.push(r);
        }
        if(sort === "dt_desc"){
          out.sort(sortNewestFirst);
        }else if(sort === "dt_asc"){
          out.sort(function(a,b){
            var da = new Date(a.performedAtIso).getTime();
            var db = new Date(b.performedAtIso).getTime();
            if(isNaN(da)) da = 0;
            if(isNaN(db)) db = 0;
            return da - db;
          });
        }else if(sort === "name_asc"){
          out.sort(function(a,b){
            var an = lower((a.patient||{}).name||"");
            var bn = lower((b.patient||{}).name||"");
            return an.localeCompare(bn);
          });
        }else if(sort === "name_desc"){
          out.sort(function(a,b){
            var an = lower((a.patient||{}).name||"");
            var bn = lower((b.patient||{}).name||"");
            return bn.localeCompare(an);
          });
        }else{
          out.sort(sortNewestFirst);
        }
        var tbody = document.getElementById("all_tbody");
        if(out.length === 0){
          tbody.innerHTML = "<tr><td colspan='9' class='muted'>No records match.</td></tr>";
          return;
        }
        var html = "";
        for(var j=0;j<out.length;j++){
          var rr = out[j];
          var p = rr.patient || {};
          html += "<tr>";
          html += "<td class='nowrap mono'>" + esc(formatDisplayDatetime(rr.performedAtIso)) + "</td>";
          html += "<td class='nowrap'><span class='tag'>" + esc(rr.testLabel||"") + "</span></td>";
          html += "<td class='nowrap'><strong>" + esc(p.name||"") + "</strong></td>";
          html += "<td class='nowrap mono'>" + esc(p.patientId||"") + "</td>";
          html += "<td class='nowrap mono'>" + esc(p.phone||"") + "</td>";
          html += "<td class='nowrap'>" + esc(p.age===null||p.age===undefined?"":String(p.age)) + "</td>";
          html += "<td class='wrap'>" + esc(resultSummary(rr)) + "</td>";
          html += "<td class='wrap'>" + notesHtml(rr) + "</td>";
          html += "<td class='td-actions nowrap'>";
          html += "<button class='btn' data-act='print' data-id='" + esc(rr.id) + "'>🖨️ Print</button>";
          html += "<button class='btn' data-act='edit' data-type='" + esc(rr.testType) + "' data-id='" + esc(rr.id) + "'>✏️ Edit</button>";
          html += "<button class='btn danger' data-act='del' data-id='" + esc(rr.id) + "'>🗑️ Delete</button>";
          html += "</td>";
          html += "</tr>";
        }
        tbody.innerHTML = html;
        window.__POCT_ALL_CURRENT = out;
      }
      function renderAll(){
        renderDashboard();
        renderPatients();
        renderBP();
        renderUrine();
        renderHbA1c();
        renderBG();
        renderChol();
        renderBMI();
        renderAllRecords();
      }
      function jumpToEdit(type, id){
        if(!type || !id) return;
        if(type === "bp"){ setActiveSection("sec-bp"); loadBPIntoForm(id); return; }
        if(type === "urine"){ setActiveSection("sec-urine"); loadUrineIntoForm(id); return; }
        if(type === "hba1c"){ setActiveSection("sec-hba1c"); loadHbIntoForm(id); return; }
        if(type === "bg"){ setActiveSection("sec-bg"); loadBgIntoForm(id); return; }
        if(type === "chol"){ setActiveSection("sec-chol"); loadChIntoForm(id); return; }
        if(type === "bmi"){ setActiveSection("sec-bmi"); loadBmIntoForm(id); return; }
      }
      var bpEls = {
        id: document.getElementById("bp_record_id"),
        dt: document.getElementById("bp_dt"),
        name: document.getElementById("bp_name"),
        pid: document.getElementById("bp_pid"),
        phone: document.getElementById("bp_phone"),
        age: document.getElementById("bp_age"),
        address: document.getElementById("bp_address"),
        notes: document.getElementById("bp_notes"),
        intervention: document.getElementById("bp_intervention"),
        sys: document.getElementById("bp_sys"),
        dia: document.getElementById("bp_dia"),
        pulse: document.getElementById("bp_pulse"),
        arm: document.getElementById("bp_arm"),
        pos: document.getElementById("bp_pos")
      };
      function clearBPForm(){
        bpEls.id.value = "";
        bpEls.dt.value = nowLocalDatetimeValue();
        bpEls.name.value = "";
        bpEls.pid.value = "";
        bpEls.phone.value = "";
        bpEls.age.value = "";
        bpEls.address.value = "";
        bpEls.notes.value = "";
        bpEls.intervention.value = "";
        bpEls.sys.value = "";
        bpEls.dia.value = "";
        bpEls.pulse.value = "";
        bpEls.arm.selectedIndex = 0;
        bpEls.pos.selectedIndex = 0;
      }
      function loadBPIntoForm(id){
        var r = getById(id);
        if(!r || r.testType !== "bp"){ toast("Not a BP record", "warn"); return; }
        var p = r.patient || {};
        var res = r.results || {};
        bpEls.id.value = r.id;
        bpEls.dt.value = (r.performedAtLocal && r.performedAtLocal.indexOf("T")>=0) ? r.performedAtLocal : nowLocalDatetimeValue();
        bpEls.name.value = p.name || "";
        bpEls.pid.value = p.patientId || "";
        bpEls.phone.value = p.phone || "";
        bpEls.age.value = (p.age===null||p.age===undefined) ? "" : String(p.age);
        bpEls.address.value = p.address || "";
        bpEls.intervention.value = r.intervention || "";
        bpEls.notes.value = r.notes || "";
        bpEls.sys.value = res.sys || "";
        bpEls.dia.value = res.dia || "";
        bpEls.pulse.value = res.pulse || "";
        bpEls.arm.value = res.arm || "Left";
        bpEls.pos.value = res.position || "Sitting";
        toast("Loaded BP record for editing", "good");
      }
      document.getElementById("bp_save").addEventListener("click", function(){
        var ok = validateCommon(bpEls.dt, bpEls.name, bpEls.pid, bpEls.phone);
        if(!ok) return;
        var patient = patientObj(bpEls.name, bpEls.pid, bpEls.phone, bpEls.age, bpEls.address);
        var meta = commonMeta(bpEls.notes, bpEls.intervention);
        var sys = numOrNull(bpEls.sys.value);
        var dia = numOrNull(bpEls.dia.value);
        var pulse = numOrNull(bpEls.pulse.value);
        if(sys === null || dia === null){
          toast("Systolic and diastolic are required", "warn");
          return;
        }
        var results = {
          sys: sys,
          dia: dia,
          pulse: (pulse === null ? "" : pulse),
          arm: must(bpEls.arm.value),
          position: must(bpEls.pos.value)
        };
        var rec = buildRecord("bp", must(bpEls.id.value), ok.dtIso, ok.dtLocal, patient, meta, results);
        upsertRecord(rec);
        toast("Blood pressure saved", "good", "Stored locally in your browser");
        clearBPForm();
        renderAll();
      });
      document.getElementById("bp_clear").addEventListener("click", function(){
        clearBPForm();
        toast("BP form cleared", "good");
      });
      var urEls = {
        id: document.getElementById("ur_record_id"),
        dt: document.getElementById("ur_dt"),
        name: document.getElementById("ur_name"),
        pid: document.getElementById("ur_pid"),
        phone: document.getElementById("ur_phone"),
        age: document.getElementById("ur_age"),
        address: document.getElementById("ur_address"),
        notes: document.getElementById("ur_notes"),
        intervention: document.getElementById("ur_intervention"),
        leu: document.getElementById("ur_leu"),
        nit: document.getElementById("ur_nit"),
        uro: document.getElementById("ur_uro"),
        pro: document.getElementById("ur_pro"),
        ph: document.getElementById("ur_ph"),
        bld: document.getElementById("ur_bld"),
        ket: document.getElementById("ur_ket"),
        glu: document.getElementById("ur_glu"),
        appearance: document.getElementById("ur_appearance")
      };
      function clearUrineForm(){
        urEls.id.value = "";
        urEls.dt.value = nowLocalDatetimeValue();
        urEls.name.value = "";
        urEls.pid.value = "";
        urEls.phone.value = "";
        urEls.age.value = "";
        urEls.address.value = "";
        urEls.notes.value = "";
        urEls.intervention.value = "";
        urEls.leu.value = "";
        urEls.nit.value = "";
        urEls.uro.value = "";
        urEls.pro.value = "";
        initUrineScales();
        urEls.appearance.value = "";
      }
      function loadUrineIntoForm(id){
        var r = getById(id);
        if(!r || r.testType !== "urine"){ toast("Not a urine record", "warn"); return; }
        var p = r.patient || {};
        var res = r.results || {};
        urEls.id.value = r.id;
        urEls.dt.value = (r.performedAtLocal && r.performedAtLocal.indexOf("T")>=0) ? r.performedAtLocal : nowLocalDatetimeValue();
        urEls.name.value = p.name || "";
        urEls.pid.value = p.patientId || "";
        urEls.phone.value = p.phone || "";
        urEls.age.value = (p.age===null||p.age===undefined) ? "" : String(p.age);
        urEls.address.value = p.address || "";
        urEls.intervention.value = r.intervention || "";
        urEls.notes.value = r.notes || "";
        urEls.leu.value = res.leu || "";
        urEls.nit.value = res.nit || "";
        urEls.uro.value = res.uro || "";
        urEls.pro.value = res.pro || "";
        urEls.ph.value = res.ph || "7.0";
        urEls.bld.value = res.bld || "Negative";
        urEls.ket.value = res.ket || "Negative";
        urEls.glu.value = res.glu || "Negative";
        urEls.appearance.value = res.appearance || "";
        toast("Loaded urine record for editing", "good");
      }
      document.getElementById("ur_save").addEventListener("click", function(){
        var ok = validateCommon(urEls.dt, urEls.name, urEls.pid, urEls.phone);
        if(!ok) return;
        var patient = patientObj(urEls.name, urEls.pid, urEls.phone, urEls.age, urEls.address);
        var meta = commonMeta(urEls.notes, urEls.intervention);
        var results = {
          leu: must(urEls.leu.value),
          nit: must(urEls.nit.value),
          uro: must(urEls.uro.value),
          pro: must(urEls.pro.value),
          ph: must(urEls.ph.value),
          bld: must(urEls.bld.value),
          ket: must(urEls.ket.value),
          glu: must(urEls.glu.value),
          appearance: must(urEls.appearance.value)
        };
        var any = false;
        for(var k in results){
          if(Object.prototype.hasOwnProperty.call(results,k)){
            if(String(results[k]||"").trim() !== ""){ any = true; break; }
          }
        }
        if(!any){
          toast("Enter at least one urine parameter before saving", "warn");
          return;
        }
        var rec = buildRecord("urine", must(urEls.id.value), ok.dtIso, ok.dtLocal, patient, meta, results);
        upsertRecord(rec);
        toast("Urine test saved", "good", "Stored locally in your browser");
        clearUrineForm();
        renderAll();
      });
      document.getElementById("ur_clear").addEventListener("click", function(){
        clearUrineForm();
        toast("Urine form cleared", "good");
      });
      var hbEls = {
        id: document.getElementById("hb_record_id"),
        dt: document.getElementById("hb_dt"),
        name: document.getElementById("hb_name"),
        pid: document.getElementById("hb_pid"),
        phone: document.getElementById("hb_phone"),
        age: document.getElementById("hb_age"),
        address: document.getElementById("hb_address"),
        notes: document.getElementById("hb_notes"),
        intervention: document.getElementById("hb_intervention"),
        pct: document.getElementById("hb_pct"),
        mmol: document.getElementById("hb_mmol")
      };
      function clearHbForm(){
        hbEls.id.value = "";
        hbEls.dt.value = nowLocalDatetimeValue();
        hbEls.name.value = "";
        hbEls.pid.value = "";
        hbEls.phone.value = "";
        hbEls.age.value = "";
        hbEls.address.value = "";
        hbEls.notes.value = "";
        hbEls.intervention.value = "";
        hbEls.pct.value = "";
        hbEls.mmol.value = "";
      }
      function loadHbIntoForm(id){
        var r = getById(id);
        if(!r || r.testType !== "hba1c"){ toast("Not an HbA1c record", "warn"); return; }
        var p = r.patient || {};
        var res = r.results || {};
        hbEls.id.value = r.id;
        hbEls.dt.value = (r.performedAtLocal && r.performedAtLocal.indexOf("T")>=0) ? r.performedAtLocal : nowLocalDatetimeValue();
        hbEls.name.value = p.name || "";
        hbEls.pid.value = p.patientId || "";
        hbEls.phone.value = p.phone || "";
        hbEls.age.value = (p.age===null||p.age===undefined) ? "" : String(p.age);
        hbEls.address.value = p.address || "";
        hbEls.intervention.value = r.intervention || "";
        hbEls.notes.value = r.notes || "";
        hbLock = true;
        hbEls.pct.value = (res.pct===null||res.pct===undefined) ? "" : String(res.pct);
        hbEls.mmol.value = (res.mmol===null||res.mmol===undefined) ? "" : String(res.mmol);
        hbLock = false;
        toast("Loaded HbA1c record for editing", "good");
      }
      document.getElementById("hb_save").addEventListener("click", function(){
        var ok = validateCommon(hbEls.dt, hbEls.name, hbEls.pid, hbEls.phone);
        if(!ok) return;
        var patient = patientObj(hbEls.name, hbEls.pid, hbEls.phone, hbEls.age, hbEls.address);
        var meta = commonMeta(hbEls.notes, hbEls.intervention);
        var pct = numOrNull(hbEls.pct.value);
        var mmol = numOrNull(hbEls.mmol.value);
        if(pct === null && mmol === null){
          toast("Enter HbA1c % or mmol/mol", "warn");
          return;
        }
        if(pct !== null && (mmol === null || String(hbEls.mmol.value).trim()==="")){
          mmol = hba1cPctToMmol(pct);
        }
        if(mmol !== null && (pct === null || String(hbEls.pct.value).trim()==="")){
          pct = hba1cMmolToPct(mmol);
        }
        var results = {
          pct: (pct === null ? "" : pct),
          mmol: (mmol === null ? "" : mmol)
        };
        var rec = buildRecord("hba1c", must(hbEls.id.value), ok.dtIso, ok.dtLocal, patient, meta, results);
        upsertRecord(rec);
        toast("HbA1c saved", "good", "Stored locally in your browser");
        clearHbForm();
        renderAll();
      });
      document.getElementById("hb_clear").addEventListener("click", function(){
        clearHbForm();
        toast("HbA1c form cleared", "good");
      });
      var bgEls = {
        id: document.getElementById("bg_record_id"),
        dt: document.getElementById("bg_dt"),
        name: document.getElementById("bg_name"),
        pid: document.getElementById("bg_pid"),
        phone: document.getElementById("bg_phone"),
        age: document.getElementById("bg_age"),
        address: document.getElementById("bg_address"),
        notes: document.getElementById("bg_notes"),
        intervention: document.getElementById("bg_intervention"),
        glucose: document.getElementById("bg_glucose"),
        timing: document.getElementById("bg_timing")
      };
      function clearBgForm(){
        bgEls.id.value = "";
        bgEls.dt.value = nowLocalDatetimeValue();
        bgEls.name.value = "";
        bgEls.pid.value = "";
        bgEls.phone.value = "";
        bgEls.age.value = "";
        bgEls.address.value = "";
        bgEls.notes.value = "";
        bgEls.intervention.value = "";
        bgEls.glucose.value = "";
        bgEls.timing.value = "Random";
      }
      function loadBgIntoForm(id){
        var r = getById(id);
        if(!r || r.testType !== "bg"){ toast("Not a blood glucose record", "warn"); return; }
        var p = r.patient || {};
        var res = r.results || {};
        bgEls.id.value = r.id;
        bgEls.dt.value = (r.performedAtLocal && r.performedAtLocal.indexOf("T")>=0) ? r.performedAtLocal : nowLocalDatetimeValue();
        bgEls.name.value = p.name || "";
        bgEls.pid.value = p.patientId || "";
        bgEls.phone.value = p.phone || "";
        bgEls.age.value = (p.age===null||p.age===undefined) ? "" : String(p.age);
        bgEls.address.value = p.address || "";
        bgEls.intervention.value = r.intervention || "";
        bgEls.notes.value = r.notes || "";
        bgEls.glucose.value = (res.glucose===null||res.glucose===undefined) ? "" : String(res.glucose);
        bgEls.timing.value = res.timing || "Random";
        toast("Loaded blood glucose record for editing", "good");
      }
      document.getElementById("bg_save").addEventListener("click", function(){
        var ok = validateCommon(bgEls.dt, bgEls.name, bgEls.pid, bgEls.phone);
        if(!ok) return;
        var patient = patientObj(bgEls.name, bgEls.pid, bgEls.phone, bgEls.age, bgEls.address);
        var meta = commonMeta(bgEls.notes, bgEls.intervention);
        var glucose = numOrNull(bgEls.glucose.value);
        if(glucose === null){
          toast("Enter blood glucose value", "warn");
          return;
        }
        var results = {
          glucose: glucose,
          timing: must(bgEls.timing.value)
        };
        var rec = buildRecord("bg", must(bgEls.id.value), ok.dtIso, ok.dtLocal, patient, meta, results);
        upsertRecord(rec);
        toast("Blood glucose saved", "good", "Stored locally in your browser");
        clearBgForm();
        renderAll();
      });
      document.getElementById("bg_clear").addEventListener("click", function(){
        clearBgForm();
        toast("Blood glucose form cleared", "good");
      });
      var chEls = {
        id: document.getElementById("ch_record_id"),
        dt: document.getElementById("ch_dt"),
        name: document.getElementById("ch_name"),
        pid: document.getElementById("ch_pid"),
        phone: document.getElementById("ch_phone"),
        age: document.getElementById("ch_age"),
        address: document.getElementById("ch_address"),
        notes: document.getElementById("ch_notes"),
        intervention: document.getElementById("ch_intervention"),
        tc: document.getElementById("ch_tc"),
        hdl: document.getElementById("ch_hdl"),
        ldl: document.getElementById("ch_ldl"),
        tg: document.getElementById("ch_tg"),
        ratio: document.getElementById("ch_ratio"),
        fasting: document.getElementById("ch_fasting")
      };
      function clearChForm(){
        chEls.id.value = "";
        chEls.dt.value = nowLocalDatetimeValue();
        chEls.name.value = "";
        chEls.pid.value = "";
        chEls.phone.value = "";
        chEls.age.value = "";
        chEls.address.value = "";
        chEls.notes.value = "";
        chEls.intervention.value = "";
        chEls.tc.value = "";
        chEls.hdl.value = "";
        chEls.ldl.value = "";
        chEls.tg.value = "";
        chEls.ratio.value = "";
        chEls.fasting.value = "";
      }
      function loadChIntoForm(id){
        var r = getById(id);
        if(!r || r.testType !== "chol"){ toast("Not a cholesterol record", "warn"); return; }
        var p = r.patient || {};
        var res = r.results || {};
        chEls.id.value = r.id;
        chEls.dt.value = (r.performedAtLocal && r.performedAtLocal.indexOf("T")>=0) ? r.performedAtLocal : nowLocalDatetimeValue();
        chEls.name.value = p.name || "";
        chEls.pid.value = p.patientId || "";
        chEls.phone.value = p.phone || "";
        chEls.age.value = (p.age===null||p.age===undefined) ? "" : String(p.age);
        chEls.address.value = p.address || "";
        chEls.intervention.value = r.intervention || "";
        chEls.notes.value = r.notes || "";
        chEls.tc.value = res.tc || "";
        chEls.hdl.value = res.hdl || "";
        chEls.ldl.value = res.ldl || "";
        chEls.tg.value = res.tg || "";
        chEls.ratio.value = res.ratio || "";
        chEls.fasting.value = res.fasting || "";
        toast("Loaded cholesterol record for editing", "good");
      }
      document.getElementById("ch_save").addEventListener("click", function(){
        var ok = validateCommon(chEls.dt, chEls.name, chEls.pid, chEls.phone);
        if(!ok) return;
        var patient = patientObj(chEls.name, chEls.pid, chEls.phone, chEls.age, chEls.address);
        var meta = commonMeta(chEls.notes, chEls.intervention);
        var tc = numOrNull(chEls.tc.value);
        var hdl = numOrNull(chEls.hdl.value);
        var ldl = numOrNull(chEls.ldl.value);
        var tg = numOrNull(chEls.tg.value);
        if(tc === null && hdl === null && ldl === null && tg === null){
          toast("Enter at least one cholesterol value before saving", "warn");
          return;
        }
        var ratio = "";
        if(tc !== null && hdl !== null && hdl !== 0){
          ratio = (tc/hdl).toFixed(2);
          chEls.ratio.value = ratio;
        }
        var results = {
          tc: (tc === null ? "" : tc),
          hdl: (hdl === null ? "" : hdl),
          ldl: (ldl === null ? "" : ldl),
          tg: (tg === null ? "" : tg),
          ratio: must(ratio || chEls.ratio.value),
          fasting: must(chEls.fasting.value)
        };
        var rec = buildRecord("chol", must(chEls.id.value), ok.dtIso, ok.dtLocal, patient, meta, results);
        upsertRecord(rec);
        toast("Cholesterol saved", "good", "Stored locally in your browser");
        clearChForm();
        renderAll();
      });
      document.getElementById("ch_clear").addEventListener("click", function(){
        clearChForm();
        toast("Cholesterol form cleared", "good");
      });
      var bmEls = {
        id: document.getElementById("bm_record_id"),
        dt: document.getElementById("bm_dt"),
        name: document.getElementById("bm_name"),
        pid: document.getElementById("bm_pid"),
        phone: document.getElementById("bm_phone"),
        age: document.getElementById("bm_age"),
        address: document.getElementById("bm_address"),
        notes: document.getElementById("bm_notes"),
        intervention: document.getElementById("bm_intervention"),
        weight: document.getElementById("bm_weight"),
        height: document.getElementById("bm_height"),
        bmi: document.getElementById("bm_bmi"),
        cat: document.getElementById("bm_cat"),
        waist: document.getElementById("bm_waist")
      };
      function clearBmForm(){
        bmEls.id.value = "";
        bmEls.dt.value = nowLocalDatetimeValue();
        bmEls.name.value = "";
        bmEls.pid.value = "";
        bmEls.phone.value = "";
        bmEls.age.value = "";
        bmEls.address.value = "";
        bmEls.notes.value = "";
        bmEls.intervention.value = "";
        bmEls.weight.value = "";
        bmEls.height.value = "";
        bmEls.bmi.value = "";
        bmEls.cat.value = "";
        bmEls.waist.value = "";
      }
      function loadBmIntoForm(id){
        var r = getById(id);
        if(!r || r.testType !== "bmi"){ toast("Not a weight/BMI record", "warn"); return; }
        var p = r.patient || {};
        var res = r.results || {};
        bmEls.id.value = r.id;
        bmEls.dt.value = (r.performedAtLocal && r.performedAtLocal.indexOf("T")>=0) ? r.performedAtLocal : nowLocalDatetimeValue();
        bmEls.name.value = p.name || "";
        bmEls.pid.value = p.patientId || "";
        bmEls.phone.value = p.phone || "";
        bmEls.age.value = (p.age===null||p.age===undefined) ? "" : String(p.age);
        bmEls.address.value = p.address || "";
        bmEls.intervention.value = r.intervention || "";
        bmEls.notes.value = r.notes || "";
        bmEls.weight.value = res.weight || "";
        bmEls.height.value = res.height || "";
        updateBmi();
        bmEls.waist.value = res.waist || "";
        toast("Loaded weight/BMI record for editing", "good");
      }
      document.getElementById("bm_save").addEventListener("click", function(){
        var ok = validateCommon(bmEls.dt, bmEls.name, bmEls.pid, bmEls.phone);
        if(!ok) return;
        var patient = patientObj(bmEls.name, bmEls.pid, bmEls.phone, bmEls.age, bmEls.address);
        var meta = commonMeta(bmEls.notes, bmEls.intervention);
        var w = numOrNull(bmEls.weight.value);
        var h = numOrNull(bmEls.height.value);
        if(w === null || h === null){
          toast("Weight and height are required", "warn");
          return;
        }
        updateBmi();
        var bmiVal = must(bmEls.bmi.value);
        var catVal = must(bmEls.cat.value);
        var results = {
          weight: w,
          height: h,
          bmi: bmiVal,
          category: catVal,
          waist: (numOrNull(bmEls.waist.value) === null ? "" : numOrNull(bmEls.waist.value))
        };
        var rec = buildRecord("bmi", must(bmEls.id.value), ok.dtIso, ok.dtLocal, patient, meta, results);
        upsertRecord(rec);
        toast("Weight/BMI saved", "good", "Stored locally in your browser");
        clearBmForm();
        renderAll();
      });
      document.getElementById("bm_clear").addEventListener("click", function(){
        clearBmForm();
        toast("Weight/BMI form cleared", "good");
      });
      function bindTableActions(tbodyId, type){
        var tbody = document.getElementById(tbodyId);
        tbody.addEventListener("click", function(e){
          var t = e.target;
          if(t && t.nodeType === 3) t = t.parentNode; // TEXT_NODE -> element
          var btn = null;
          if(t){
            if(t.closest){
              btn = t.closest("button");
            }else{
              var cur = t;
              while(cur && cur !== tbody){
                if(cur.tagName && String(cur.tagName).toLowerCase() === "button"){ btn = cur; break; }
                cur = cur.parentNode;
              }
            }
          }
          if(!btn) return;
          var act = btn.getAttribute("data-act");
          var id = btn.getAttribute("data-id");
          if(!id) return;
          if(act === "print"){
            printRecord(id);
            return;
          }
          if(act === "edit"){
            if(type === "bp") loadBPIntoForm(id);
            if(type === "urine") loadUrineIntoForm(id);
            if(type === "hba1c") loadHbIntoForm(id);
            if(type === "bg") loadBgIntoForm(id);
            if(type === "chol") loadChIntoForm(id);
            if(type === "bmi") loadBmIntoForm(id);
            return;
          }
          if(act === "del"){
            var r = getById(id);
            var label = (r && r.testLabel) ? r.testLabel : "record";
            var ok = window.confirm("Delete this " + label + " record?\n\nThis cannot be undone.");
            if(!ok) return;
            deleteRecordById(id);
            toast("Record deleted", "good");
            renderAll();
            return;
          }
        });
      }
      bindTableActions("bp_tbody", "bp");
      bindTableActions("ur_tbody", "urine");
      bindTableActions("hb_tbody", "hba1c");
      bindTableActions("bg_tbody", "bg");
      bindTableActions("ch_tbody", "chol");
      bindTableActions("bm_tbody", "bmi");
      document.getElementById("all_tbody").addEventListener("click", function(e){
        var t = e.target;
          if(t && t.nodeType === 3) t = t.parentNode; // TEXT_NODE -> element
          var btn = null;
          if(t){
            if(t.closest){
              btn = t.closest("button");
            }else{
              var cur = t;
              while(cur && cur !== this){
                if(cur.tagName && String(cur.tagName).toLowerCase() === "button"){ btn = cur; break; }
                cur = cur.parentNode;
              }
            }
          }
        if(!btn) return;
        var act = btn.getAttribute("data-act");
        var id = btn.getAttribute("data-id");
        if(!id) return;
        if(act === "print"){
          printRecord(id);
          return;
        }
        if(act === "edit"){
          var t = btn.getAttribute("data-type");
          jumpToEdit(t, id);
          return;
        }
        if(act === "del"){
          var r = getById(id);
          var label = (r && r.testLabel) ? r.testLabel : "record";
          var ok = window.confirm("Delete this " + label + " record?\n\nThis cannot be undone.");
          if(!ok) return;
          deleteRecordById(id);
          toast("Record deleted", "good");
          renderAll();
          return;
        }
      });
      function bindInputRerender(ids){
        for(var i=0;i<ids.length;i++){
          var el = document.getElementById(ids[i]);
          if(!el) continue;
          el.addEventListener("input", function(){ renderAll(); });
          el.addEventListener("change", function(){ renderAll(); });
        }
      }
      bindInputRerender([
        "dashSearch",
        "pt_search","pt_from","pt_to",
        "bp_search","bp_from","bp_to",
        "ur_search","ur_from","ur_to",
        "hb_search","hb_from","hb_to",
        "bg_search","bg_from","bg_to",
        "ch_search","ch_from","ch_to",
        "bm_search","bm_from","bm_to",
        "all_search","all_type","all_sort","all_from","all_to"
      ]);
      function downloadText(filename, text){
        var blob = new Blob([text], {type:"application/json;charset=utf-8"});
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 500);
      }
      var __btnExport = document.getElementById("btnExport");
      if(__btnExport) __btnExport.addEventListener("click", function(){
        var all = loadRecords();
        var patients = loadPatients();
        var payload = {
          exportedAtIso: toIso(new Date()),
          storageKey: STORAGE_KEY,
          patientsKey: PATIENTS_KEY,
          version: 2,
          records: all,
          patients: patients
        };
        downloadText("poct_export_" + new Date().toISOString().slice(0,10) + ".json", JSON.stringify(payload, null, 2));
        toast("Exported JSON", "good", "Saved a .json file");
      });
      var __importFile = document.getElementById("importFile");
      if(__importFile) __importFile.addEventListener("change", function(e){
        var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        if(!file) return;
        var reader = new FileReader();
        reader.onload = function(){
          var raw = String(reader.result || "");
          var obj = safeJsonParse(raw, null);
          if(!obj){
            toast("Import failed: invalid JSON", "bad");
            return;
          }
          var recs = null;
          if(Array.isArray(obj)) recs = obj;
          else if(obj && Array.isArray(obj.records)) recs = obj.records;
          if(!recs){
            toast("Import failed: no records array found", "bad");
            return;
          }
          var cleaned = [];
          for(var i=0;i<recs.length;i++){
            var r = recs[i];
            if(!r || typeof r !== "object") continue;
            if(!r.id) r.id = uid();
            if(!r.testType) continue;
            if(!r.testLabel) r.testLabel = testLabel(r.testType);
            if(!r.performedAtIso){
              if(r.performedAtLocal){
                var d = parseLocalDatetimeValue(r.performedAtLocal);
                r.performedAtIso = d ? toIso(d) : toIso(new Date());
              }else{
                r.performedAtIso = toIso(new Date());
              }
            }
            if(!r.patient) r.patient = {name:"", patientId:"", phone:"", age:null, address:""};
            r.patient = normalizePatientInPlace(r.patient);
            if(r.intervention === null || r.intervention === undefined) r.intervention = "";
            if(!r.results) r.results = {};
            if(r.feeDue === null || r.feeDue === undefined) r.feeDue = 0;
            cleaned.push(r);
          }
          var ok = window.confirm("Import will REPLACE the current cloud data for this location.\n\nProceed?");
          if(!ok) return;
          saveRecords(cleaned);
          if(obj && Array.isArray(obj.patients)){
            var pats = obj.patients;
            var pm = {};
            for(var pi=0;pi<pats.length;pi++){
              var p0 = pats[pi] || {};
              var pid0 = normalizePatientId(p0.patientId || "");
              if(!pid0) continue;
              pm[pid0] = {
                patientId: pid0,
                name: must(p0.name || ""),
                phone: must(p0.phone || ""),
                age: (p0.age!==null && p0.age!==undefined) ? p0.age : null,
                address: must(p0.address || ""),
                createdAtIso: p0.createdAtIso || toIso(new Date()),
                updatedAtIso: p0.updatedAtIso || toIso(new Date()),
                lastSeenIso: p0.lastSeenIso || "",
                conflicts: Array.isArray(p0.conflicts) ? p0.conflicts : []
              };
            }
            savePatients(mapToPatients(pm));
          }else{
            savePatients([]);
            rebuildPatientsFromRecords(true);
          }
          __cloud.migratedV2 = true;
          toast("Import complete", "good", "Loaded " + cleaned.length + " records");
          e.target.value = "";
          renderAll();
        };
        reader.readAsText(file);
      });
      var __btnWipe = document.getElementById("btnWipe");
      if(__btnWipe) __btnWipe.addEventListener("click", function(){
        var ok = window.confirm("Wipe ALL POCT cloud data for this location?\n\nThis will permanently delete all saved records & patients for this location.");
        if(!ok) return;
        cloudWipe();
        toast("Cloud data wiped", "good");
        clearBPForm();
        clearUrineForm();
        clearHbForm();
        clearBgForm();
        clearChForm();
        clearBmForm();
        setDefaultDts();
        renderAll();
      });
      document.getElementById("pt_close").addEventListener("click", function(){
        closePatientDetail();
      });
      document.getElementById("pt_save").addEventListener("click", function(){
        if(!__PT_SELECTED_ID) return;
        var pid = __PT_SELECTED_ID;
        var p = getPatientById(pid);
        if(!p) return;
        var name = must(document.getElementById("pt_detail_name").value);
        var phone = must(document.getElementById("pt_detail_phone").value);
        var ageRaw = document.getElementById("pt_detail_age").value;
        var age = (ageRaw === "" || ageRaw === null || ageRaw === undefined) ? null : (Number(ageRaw) || null);
        var addr = must(document.getElementById("pt_detail_addr").value);
        var all = loadPatients();
        var map = patientsToMap(all);
        var existing = map[pid];
        if(!existing) existing = {patientId: pid, conflicts: []};
        existing.name = name;
        existing.phone = phone;
        existing.age = age;
        existing.address = addr;
        existing.updatedAtIso = toIso(new Date());
        if(!existing.createdAtIso) existing.createdAtIso = existing.updatedAtIso;
        map[pid] = existing;
        savePatients(mapToPatients(map));
        toast("Patient saved", "good", pid);
        renderPatients();
      });
      document.getElementById("all_print_list").addEventListener("click", function(){
        var list = window.__POCT_ALL_CURRENT || [];
        printRecordList(list, "POCT Records (filtered list)");
      });
      function toCsvValue(v){
        var s = String(v === null || v === undefined ? "" : v);
        s = s.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
        var needs = (s.indexOf(",")>=0 || s.indexOf('"')>=0 || s.indexOf("\n")>=0);
        if(needs){
          s = '"' + s.replace(/"/g,'""') + '"';
        }
        return s;
      }
      document.getElementById("all_export_csv").addEventListener("click", function(){
        var list = window.__POCT_ALL_CURRENT || [];
        var headers = [
          "DateTime","Test","PatientName","PatientID","Phone","Age","Address","Intervention","Notes",
          "ResultsSummary"
        ];
        var lines = [];
        lines.push(headers.join(","));
        for(var i=0;i<list.length;i++){
          var r = list[i];
          var p = r.patient || {};
          var row = [
            formatDisplayDatetime(r.performedAtIso),
            r.testLabel || "",
            p.name || "",
            p.patientId || "",
            p.phone || "",
            (p.age===null||p.age===undefined) ? "" : String(p.age),
            p.address || "",
            r.intervention || "",
            r.notes || "",
            resultSummary(r)
          ];
          for(var j=0;j<row.length;j++) row[j] = toCsvValue(row[j]);
          lines.push(row.join(","));
        }
        var csv = lines.join("\n");
        var blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "poct_records_filtered_" + new Date().toISOString().slice(0,10) + ".csv";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 500);
        toast("Exported CSV", "good", "Current filtered list exported");
      });
      (function(){
        var h = "";
        try{ h = (window.location.hash || "").replace(/^#/, ""); }catch(e){}
        if(h && document.getElementById(h)){
          setActiveSection(h);
        }else{
          setActiveSection("sec-dashboard");
        }
      })();
      if(!window.__POCT_KEYDOWN_INSTALLED){window.__POCT_KEYDOWN_INSTALLED=true;document.addEventListener("keydown", function(e){
        try{ if(!(window.__POCT_ACTIVE_ROOT && document.body.contains(window.__POCT_ACTIVE_ROOT))) return; }catch(err){}
        if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f"){
          var active = (window.__POCT_ACTIVE_ROOT?window.__POCT_ACTIVE_ROOT.querySelector(".section.active"):document.querySelector(".section.active"));
          if(!active) return;
          var search = active.querySelector("input[id$='_search'], #dashSearch, #all_search");
          if(search){
            e.preventDefault();
            search.focus();
            try{ search.select(); }catch(err){}
          }
        }
      });}
      if(!window.__POCT_FOCUS_INSTALLED){window.__POCT_FOCUS_INSTALLED=true;window.addEventListener("focus", function(){try{ if(window.__POCT_setDefaultDts) window.__POCT_setDefaultDts(); }catch(e){} });}
      try{ window.__POCT_TOAST = toast; window.__POCT_ACTIVE_ROOT = root; }catch(e){}
      window.POCT = {
        storageKey: STORAGE_KEY,
        loadRecords: loadRecords,
        saveRecords: saveRecords,
        printRecord: printRecord
      };
    
}


  async function render(ctx) {
    ensurePoctStyles();

    var mount = ctx.mount;
    mount.innerHTML = `<div class="poct-root" id="poct-root">${POCT_HTML}</div>`;

    var root = mount.querySelector("#poct-root") || mount;

    // Boot runtime (cloud-backed storage; no localStorage usage here)
    try {
      await poctRuntime(root);
    } catch (e) {
      try {
        E.error("[poct] render/runtime failed:", e);
      } catch (e2) {}
      // Fail safe: show error in-module without breaking shell
      var msg = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : e);
      mount.innerHTML =
        "<div style='padding:16px;max-width:920px;margin:0 auto;color:var(--text,#e9eef7)'>" +
        "<h2 style='margin:0 0 10px 0'>POCT</h2>" +
        "<div style='white-space:pre-wrap;opacity:.9'>Failed to load POCT module.\n\n" + E.escapeHtml(msg) + "</div>" +
        "</div>";
    }
  }

  E.registerModule({
    id: "poct",
    title: "POCT",
    order: 23,
    icon: "🧪",
    render: render,
  });
})();
