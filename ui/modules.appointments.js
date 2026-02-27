(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  function log()  { E.log.apply(E,  ["[appt]"].concat([].slice.call(arguments))); }
  function warn() { E.warn.apply(E, ["[appt]"].concat([].slice.call(arguments))); }
  function err()  { E.error.apply(E,["[appt]"].concat([].slice.call(arguments))); }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function pad2(n) { return String(n).padStart(2,"0"); }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
  }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s||"")); }
  function fmtDmy(s) {
    if (!isYmd(s)) return s || "";
    var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0];
  }
  function fmtTs(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso); if (isNaN(d.getTime())) return iso;
      return pad2(d.getDate())+"/"+pad2(d.getMonth()+1)+"/"+d.getFullYear()+" "+pad2(d.getHours())+":"+pad2(d.getMinutes());
    } catch(e){ return iso; }
  }
  function ymdAddDays(ymd, n) {
    var d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
  }
  function dayOfWeek(ymd) { // 0=Sun, 1=Mon…6=Sat
    return new Date(ymd + "T12:00:00").getDay();
  }
  function dayName(ymd) {
    var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return days[dayOfWeek(ymd)] || "";
  }
  function fmtMoney(v) {
    var n = parseFloat(v) || 0;
    return "€" + n.toFixed(2);
  }
  function generateToken() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var t = "";
    for (var i = 0; i < 4; i++) t += chars[Math.floor(Math.random() * chars.length)];
    return t;
  }
  function timeToMins(t) {
    if (!t) return 0;
    var parts = String(t).split(":");
    return (parseInt(parts[0],10)||0)*60 + (parseInt(parts[1],10)||0);
  }
  function minsToTime(m) {
    var h = Math.floor(m/60), mn = m%60;
    return pad2(h) + ":" + pad2(mn);
  }

  // ── Toast & Modal helpers ──────────────────────────────────────────────────
  var toastInstalled = false;
  function ensureToastStyles() {
    if (toastInstalled) return; toastInstalled = true;
    var st = document.createElement("style"); st.textContent =
      ".ap-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".ap-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);}" +
      ".ap-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
      ".ap-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".ap-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".ap-toast.bad{border-color:rgba(255,90,122,.35);}";
    document.head.appendChild(st);
  }
  function toast(title, message, kind, ms) {
    ensureToastStyles();
    var wrap = document.getElementById("ap-toast-wrap");
    if (!wrap) { wrap=document.createElement("div"); wrap.id="ap-toast-wrap"; wrap.className="ap-toast-wrap"; document.body.appendChild(wrap); }
    var t=document.createElement("div"); t.className="ap-toast "+(kind||"");
    var ti=document.createElement("div"); ti.className="t-title"; ti.textContent=title||"Info";
    var tm=document.createElement("div"); tm.className="t-msg";   tm.textContent=message||"";
    t.appendChild(ti); t.appendChild(tm); wrap.appendChild(t);
    setTimeout(function(){ try{t.remove();}catch(e){} }, typeof ms==="number"?ms:2600);
  }
  function modalError(title, e) {
    var msg=(e&&e.message)?e.message:String(e||"Unknown error");
    try { E.modal.show(title||"Error","<div style='white-space:pre-wrap;font-size:13px;color:rgba(255,90,122,.9);'>"+esc(msg)+"</div>",
      [{label:"Close",primary:true,onClick:function(){E.modal.hide();}}]); } catch(e2){ toast(title||"Error",msg,"bad"); }
  }
  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function(resolve){
      try { E.modal.show(title||"Confirm","<div class='eikon-mini'>"+esc(bodyText||"")+"</div>",[
        {label:cancelLabel||"Cancel",onClick:function(){E.modal.hide();resolve(false);}},
        {label:okLabel||"OK",danger:true,onClick:function(){E.modal.hide();resolve(true);}}
      ]); } catch(e){ resolve(window.confirm(bodyText||"Are you sure?")); }
    });
  }

  // ── localStorage: Doctors ─────────────────────────────────────────────────
  var LS_DOCTORS  = "eikon_appt_doctors_v1";
  var LS_CLINICS  = "eikon_appt_clinics_v1";
  var LS_SCHEDS   = "eikon_appt_schedules_v1";
  var LS_APPTS    = "eikon_appt_entries_v1";
  var LS_WAITLIST = "eikon_appt_waitlist_v1";
  var LS_SEQ      = "eikon_appt_seq_v1";

  function lsGet(key) {
    try { var r=window.localStorage.getItem(key); return r?JSON.parse(r):null; } catch(e){return null;}
  }
  function lsSet(key,val) {
    try { window.localStorage.setItem(key,JSON.stringify(val)); } catch(e){}
  }

  // Sequence IDs
  function nextId(prefix, seqKey) {
    try {
      var raw=window.localStorage.getItem(seqKey||LS_SEQ+prefix);
      var seq=raw?(parseInt(raw,10)||0):0; seq++;
      window.localStorage.setItem(seqKey||LS_SEQ+prefix, String(seq));
      return prefix+String(seq).padStart(5,"0");
    } catch(e){ return prefix+String(Date.now()).slice(-5); }
  }

  // Doctors CRUD
  function loadDoctors() { return lsGet(LS_DOCTORS)||[]; }
  function saveDoctors(arr) { lsSet(LS_DOCTORS, arr); }
  function createDoctor(d) {
    var arr=loadDoctors();
    var id="DR-"+String(Date.now()).slice(-6);
    arr.push(Object.assign({id:id,createdAt:new Date().toISOString()},d));
    saveDoctors(arr); return id;
  }
  function updateDoctor(id,d) {
    var arr=loadDoctors();
    for(var i=0;i<arr.length;i++) if(arr[i].id===id){ arr[i]=Object.assign({},arr[i],d); break; }
    saveDoctors(arr);
  }
  function deleteDoctor(id) {
    saveDoctors(loadDoctors().filter(function(d){return d.id!==id;}));
  }
  function doctorById(id) { return loadDoctors().filter(function(d){return d.id===id;})[0]||null; }

  // Clinics CRUD
  function loadClinics() { return lsGet(LS_CLINICS)||[]; }
  function saveClinics(arr) { lsSet(LS_CLINICS, arr); }
  function createClinic(c) {
    var arr=loadClinics();
    var id="CL-"+String(Date.now()).slice(-6);
    arr.push(Object.assign({id:id,createdAt:new Date().toISOString()},c));
    saveClinics(arr); return id;
  }
  function updateClinic(id,c) {
    var arr=loadClinics();
    for(var i=0;i<arr.length;i++) if(arr[i].id===id){ arr[i]=Object.assign({},arr[i],c); break; }
    saveClinics(arr);
  }
  function deleteClinic(id) {
    saveClinics(loadClinics().filter(function(c){return c.id!==id;}));
  }
  function clinicById(id) { return loadClinics().filter(function(c){return c.id===id;})[0]||null; }

  // Schedules CRUD
  function loadSchedules() { return lsGet(LS_SCHEDS)||[]; }
  function saveSchedules(arr) { lsSet(LS_SCHEDS, arr); }
  function createSchedule(s) {
    var arr=loadSchedules();
    var id="SCH-"+String(Date.now()).slice(-6);
    arr.push(Object.assign({id:id,createdAt:new Date().toISOString()},s));
    saveSchedules(arr); return id;
  }
  function updateSchedule(id,s) {
    var arr=loadSchedules();
    for(var i=0;i<arr.length;i++) if(arr[i].id===id){ arr[i]=Object.assign({},arr[i],s); break; }
    saveSchedules(arr);
  }
  function deleteSchedule(id) {
    saveSchedules(loadSchedules().filter(function(s){return s.id!==id;}));
  }
  // Check if a doctor is scheduled on a given date (returns matching schedule or null)
  function getSchedulesForDate(ymd) {
    var dow = dayOfWeek(ymd);
    return loadSchedules().filter(function(s){
      if (s.cancelled) return false;
      if (s.isOneOff) return s.date === ymd;
      // Recurring
      if (Number(s.dayOfWeek) !== dow) return false;
      if (s.validFrom && ymd < s.validFrom) return false;
      if (s.validUntil && ymd > s.validUntil) return false;
      return true;
    });
  }

  // Appointments CRUD
  function loadAppts() { return lsGet(LS_APPTS)||[]; }
  function saveAppts(arr) { lsSet(LS_APPTS, arr); }
  function createAppt(a) {
    var arr=loadAppts();
    var id=nextId("APT-","eikon_appt_seq_apt");
    var token=generateToken();
    arr.push(Object.assign({id:id,token:token,createdAt:new Date().toISOString()},a));
    saveAppts(arr); return {id:id,token:token};
  }
  function updateAppt(id,a) {
    var arr=loadAppts();
    for(var i=0;i<arr.length;i++) if(String(arr[i].id)===String(id)){ arr[i]=Object.assign({},arr[i],a,{updatedAt:new Date().toISOString()}); break; }
    saveAppts(arr);
  }
  function deleteAppt(id) {
    saveAppts(loadAppts().filter(function(a){return String(a.id)!==String(id);}));
  }
  function apptById(id) { return loadAppts().filter(function(a){return String(a.id)===String(id);})[0]||null; }
  function apptsForDate(ymd) {
    return loadAppts().filter(function(a){return a.date===ymd;}).sort(function(a,b){
      return timeToMins(a.time) - timeToMins(b.time);
    });
  }

  // Waiting list CRUD
  function loadWaitlist() { return lsGet(LS_WAITLIST)||[]; }
  function saveWaitlist(arr) { lsSet(LS_WAITLIST, arr); }
  function createWaitlistEntry(w) {
    var arr=loadWaitlist();
    var id=nextId("WL-","eikon_appt_seq_wl");
    arr.unshift(Object.assign({id:id,status:"Waiting",addedDate:todayYmd(),createdAt:new Date().toISOString()},w));
    saveWaitlist(arr); return id;
  }
  function updateWaitlistEntry(id,w) {
    var arr=loadWaitlist();
    for(var i=0;i<arr.length;i++) if(String(arr[i].id)===String(id)){ arr[i]=Object.assign({},arr[i],w); break; }
    saveWaitlist(arr);
  }
  function deleteWaitlistEntry(id) {
    saveWaitlist(loadWaitlist().filter(function(w){return String(w.id)!==String(id);}));
  }

  // ── Compute total ─────────────────────────────────────────────────────────
  function computeTotal(a) {
    return (parseFloat(a.doctorFee)||0) + (parseFloat(a.clinicFee)||0) + (parseFloat(a.medicinesCost)||0);
  }

  // ── Status helpers ────────────────────────────────────────────────────────
  var APPT_STATUSES = ["Scheduled","Confirmed","Completed","Cancelled","No Show"];
  var WL_STATUSES   = ["Waiting","Promoted","Cancelled"];

  function statusClass(s) {
    var map = {
      "Scheduled":  "ap-s-scheduled",
      "Confirmed":  "ap-s-confirmed",
      "Completed":  "ap-s-completed",
      "Cancelled":  "ap-s-cancelled",
      "No Show":    "ap-s-noshow",
      "Waiting":    "ap-s-waiting",
      "Promoted":   "ap-s-promoted"
    };
    return map[s] || "ap-s-scheduled";
  }
  function statusBadge(s) {
    var span = document.createElement("span");
    span.className = "ap-status " + statusClass(s);
    span.textContent = s || "Scheduled";
    return span;
  }

  // ── CSS Styles ────────────────────────────────────────────────────────────
  var apStyleInstalled = false;
  function ensureStyles() {
    if (apStyleInstalled) return; apStyleInstalled = true;
    var st = document.createElement("style"); st.id = "eikon-appt-style";
    st.textContent =
      // Layout
      ".ap-wrap{max-width:1400px;margin:0 auto;padding:16px;}" +
      ".ap-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px;}" +
      ".ap-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +
      ".ap-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;}" +

      // Cards
      ".ap-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:12px;" +
      "background:var(--panel,rgba(16,24,36,.66));box-shadow:0 18px 50px rgba(0,0,0,.38);" +
      "backdrop-filter:blur(10px);margin-bottom:12px;}" +
      ".ap-card-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".ap-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      ".ap-card-head .meta{font-size:12px;color:var(--muted,rgba(233,238,247,.68));font-weight:800;}" +
      ".ap-card-head .right{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}" +

      // View tabs
      ".ap-tabs{display:flex;gap:4px;background:rgba(10,16,24,.4);border-radius:12px;padding:4px;border:1px solid rgba(255,255,255,.08);}" +
      ".ap-tab{font-size:12px;font-weight:900;padding:6px 14px;border-radius:9px;cursor:pointer;border:none;background:transparent;color:rgba(233,238,247,.6);transition:all 120ms;}" +
      ".ap-tab:hover{background:rgba(255,255,255,.06);color:rgba(233,238,247,.9);}" +
      ".ap-tab.active{background:rgba(58,160,255,.22);color:#7dc8ff;border:1px solid rgba(58,160,255,.35);}" +

      // Day navigator
      ".ap-nav{display:flex;align-items:center;gap:8px;}" +
      ".ap-nav-btn{font-size:15px;font-weight:900;padding:6px 10px;border-radius:9px;cursor:pointer;border:1px solid rgba(255,255,255,.10);background:rgba(10,16,24,.5);color:var(--text,#e9eef7);transition:all 100ms;}" +
      ".ap-nav-btn:hover{background:rgba(255,255,255,.07);}" +
      ".ap-nav-date{font-size:14px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-nav-sub{font-size:11px;color:var(--muted,rgba(233,238,247,.6));margin-top:2px;}" +
      ".ap-date-input{color-scheme:dark;padding:7px 10px;border:1px solid rgba(255,255,255,.10);border-radius:10px;background:rgba(10,16,24,.6);color:var(--text,#e9eef7);font-size:12px;outline:none;}" +
      ".ap-date-input:focus{border-color:rgba(58,160,255,.55);}" +

      // Day view grid
      ".ap-day-grid{display:grid;gap:8px;}" +
      ".ap-day-slot{border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px 12px;" +
      "background:rgba(10,16,24,.22);display:grid;grid-template-columns:80px 1fr auto;gap:10px;align-items:center;" +
      "cursor:pointer;transition:background 100ms;}" +
      ".ap-day-slot:hover{background:rgba(255,255,255,.04);}" +
      ".ap-day-slot.status-Cancelled{opacity:.55;}" +
      ".ap-day-slot.status-Completed{opacity:.7;}" +
      ".ap-slot-time{font-size:13px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-slot-sub{font-size:10px;color:var(--muted,rgba(233,238,247,.55));margin-top:2px;}" +
      ".ap-slot-patient{font-size:13px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-slot-detail{font-size:11px;color:var(--muted,rgba(233,238,247,.65));margin-top:2px;}" +
      ".ap-slot-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;}" +
      ".ap-slot-total{font-size:12px;font-weight:900;color:rgba(67,209,122,.9);}" +
      ".ap-day-empty{text-align:center;padding:32px;color:var(--muted,rgba(233,238,247,.45));font-size:13px;font-style:italic;}" +
      ".ap-sched-bar{border:1px solid rgba(58,160,255,.2);background:rgba(58,160,255,.06);border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:11px;color:rgba(90,162,255,.85);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}" +
      ".ap-sched-bar strong{font-weight:900;}" +

      // Table
      ".ap-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.18);}" +
      ".ap-table{width:max-content;min-width:100%;border-collapse:collapse;color:var(--text,#e9eef7);}" +
      ".ap-table th,.ap-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:8px 10px;font-size:12px;vertical-align:middle;}" +
      ".ap-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:1000;text-align:left;cursor:pointer;user-select:none;white-space:nowrap;}" +
      ".ap-table th.noclick{cursor:default;}" +
      ".ap-table tbody tr:hover{background:rgba(255,255,255,.04);cursor:pointer;}" +
      ".ap-row-sel{background:rgba(58,160,255,.10)!important;outline:1px solid rgba(58,160,255,.25);}" +

      // Status chips
      ".ap-status{display:inline-block;font-size:11px;font-weight:900;padding:3px 9px;border-radius:999px;letter-spacing:.3px;white-space:nowrap;}" +
      ".ap-s-scheduled{background:rgba(58,160,255,.18);border:1px solid rgba(58,160,255,.38);color:#7dc8ff;}" +
      ".ap-s-confirmed{background:rgba(67,209,122,.16);border:1px solid rgba(67,209,122,.35);color:#6de0a0;}" +
      ".ap-s-completed{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:rgba(233,238,247,.55);}" +
      ".ap-s-cancelled{background:rgba(255,90,122,.14);border:1px solid rgba(255,90,122,.32);color:#ff8ca4;}" +
      ".ap-s-noshow{background:rgba(255,157,67,.14);border:1px solid rgba(255,157,67,.32);color:#ffbe7d;}" +
      ".ap-s-waiting{background:rgba(204,148,255,.14);border:1px solid rgba(204,148,255,.32);color:#d4a0ff;}" +
      ".ap-s-promoted{background:rgba(67,209,122,.16);border:1px solid rgba(67,209,122,.35);color:#6de0a0;}" +

      // Selected detail panel
      ".ap-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px;}" +
      ".ap-kv{border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(10,16,24,.22);padding:9px 11px;}" +
      ".ap-kv .k{font-size:10px;font-weight:1000;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;}" +
      ".ap-kv .v{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;word-break:break-word;}" +
      ".ap-kv.wide{grid-column:1/-1;}" +
      ".ap-kv.half{grid-column:span 2;}" +
      ".ap-kv.fee{border-color:rgba(67,209,122,.2);}" +
      ".ap-kv.total{border-color:rgba(67,209,122,.4);background:rgba(67,209,122,.05);}" +
      ".ap-kv.total .v{font-size:15px;font-weight:900;color:rgba(67,209,122,.95);}" +
      ".ap-token-box{font-family:monospace;font-size:18px;font-weight:900;letter-spacing:4px;color:#7dc8ff;background:rgba(58,160,255,.1);border-radius:8px;padding:3px 10px;display:inline-block;}" +

      // Detail sel panel actions
      ".ap-sel-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;}" +

      // Medicines box
      ".ap-meds{border:1px solid rgba(255,200,90,.15);border-radius:12px;background:rgba(255,200,90,.04);padding:10px;}" +
      ".ap-meds .meds-lbl{font-size:10px;font-weight:1000;text-transform:uppercase;letter-spacing:.8px;color:rgba(255,200,90,.7);margin-bottom:5px;}" +
      ".ap-meds .meds-txt{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;}" +

      // Filters bar
      ".ap-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:10px;}" +
      ".ap-filter-field{display:flex;flex-direction:column;gap:3px;}" +
      ".ap-filter-field label{font-size:11px;font-weight:900;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.5px;}" +

      // Inputs/selects common
      ".ap-input,.ap-select,.ap-textarea{padding:9px 11px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:10px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;font-size:13px;" +
      "transition:border-color 120ms,box-shadow 120ms;}" +
      ".ap-input:focus,.ap-select:focus,.ap-textarea:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.18);}" +
      ".ap-select{color-scheme:dark;}" +
      ".ap-textarea{min-height:70px;resize:vertical;width:100%;}" +
      ".ap-input[type=date]{color-scheme:dark;}" +
      ".ap-fee-row{display:flex;gap:8px;align-items:center;}" +
      ".ap-fee-row .ap-input{max-width:130px;}" +
      ".ap-total-preview{font-size:13px;font-weight:900;color:rgba(67,209,122,.9);padding:8px 12px;border:1px solid rgba(67,209,122,.25);border-radius:10px;background:rgba(67,209,122,.06);}" +

      // Settings management grids
      ".ap-mgmt-grid{display:grid;gap:6px;}" +
      ".ap-mgmt-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(10,16,24,.2);}" +
      ".ap-mgmt-row .mgmt-name{flex:1;font-size:13px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-mgmt-row .mgmt-sub{font-size:11px;color:var(--muted,rgba(233,238,247,.55));}" +
      ".ap-mgmt-row .mgmt-actions{display:flex;gap:6px;}" +
      ".ap-add-btn{font-size:12px;font-weight:900;padding:6px 14px;border-radius:9px;cursor:pointer;border:1px dashed rgba(255,255,255,.2);background:transparent;color:rgba(233,238,247,.6);transition:all 100ms;}" +
      ".ap-add-btn:hover{border-color:rgba(58,160,255,.4);color:#7dc8ff;background:rgba(58,160,255,.08);}" +

      // Modal form helpers
      ".ap-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
      ".ap-form-grid .eikon-field{margin:0;}" +
      ".ap-form-full{grid-column:1/-1;}" +
      ".ap-form-section{font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.8px;color:var(--muted,rgba(233,238,247,.55));border-top:1px solid rgba(255,255,255,.08);padding-top:10px;margin-top:4px;}" +
      ".ap-form-fee-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}" +

      // Waiting list count badge
      ".ap-wl-badge{font-size:11px;font-weight:900;padding:2px 8px;border-radius:999px;background:rgba(204,148,255,.18);border:1px solid rgba(204,148,255,.32);color:#d4a0ff;}" +

      // Sort indicator
      ".ap-sort{display:inline-flex;gap:5px;align-items:center;}" +
      ".ap-sort .car{opacity:.45;font-size:10px;}" +
      ".ap-sort.on .car{opacity:1;}" +

      // Schedule repeat indicator
      ".ap-repeat-tag{font-size:10px;font-weight:900;padding:2px 7px;border-radius:999px;background:rgba(58,160,255,.15);border:1px solid rgba(58,160,255,.3);color:#7dc8ff;display:inline-block;}" +

      // Responsive
      "@media(max-width:980px){.ap-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.ap-kv.wide{grid-column:1/-1;}.ap-kv.half{grid-column:1/-1;}}" +
      "@media(max-width:600px){.ap-detail-grid{grid-template-columns:1fr;}.ap-form-grid{grid-template-columns:1fr;}.ap-form-fee-grid{grid-template-columns:1fr;}}" +
      "@media(max-width:920px){.ap-wrap{padding:10px;}}";
    document.head.appendChild(st);
  }

  // ── Dropdown builders ────────────────────────────────────────────────────
  function buildDoctorOptions(selected, allowEmpty) {
    var docs = loadDoctors();
    var html = allowEmpty ? "<option value=''>— Any Doctor —</option>" : "<option value=''>— Select Doctor —</option>";
    docs.forEach(function(d){
      html += "<option value='"+esc(d.id)+"'"+(d.id===selected?" selected":"")+">"+esc(d.name)+(d.specialty?" ("+esc(d.specialty)+")":"")+("</option>");
    });
    return html;
  }
  function buildClinicOptions(selected, allowEmpty) {
    var clinics = loadClinics();
    var html = allowEmpty ? "<option value=''>— Any Clinic —</option>" : "<option value=''>— Select Clinic —</option>";
    clinics.forEach(function(c){
      html += "<option value='"+esc(c.id)+"'"+(c.id===selected?" selected":"")+">"+esc(c.name)+(c.locality?" – "+esc(c.locality):"")+("</option>");
    });
    return html;
  }
  function buildStatusOptions(selected, statuses) {
    return statuses.map(function(s){
      return "<option value='"+esc(s)+"'"+(s===selected?" selected":"")+">"+esc(s)+"</option>";
    }).join("");
  }
  function buildDowOptions(selected) {
    var days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return days.map(function(d,i){
      return "<option value='"+i+"'"+(String(i)===String(selected)?" selected":"")+">"+d+"</option>";
    }).join("");
  }

  // ── Print Functions ───────────────────────────────────────────────────────
  function printApptList(list, title, filterDesc) {
    var w = window.open("","_blank");
    if (!w) { toast("Print","Popup blocked — allow popups and try again.","bad"); return; }
    function safe(s){ return esc(s); }
    var rowsHtml="";
    list.forEach(function(a){
      var dr=doctorById(a.doctorId); var cl=clinicById(a.clinicId);
      rowsHtml +=
        "<tr>"+
        "<td>"+safe(a.id)+"</td>"+
        "<td>"+safe(fmtDmy(a.date))+"</td>"+
        "<td>"+safe(a.time||"")+"</td>"+
        "<td>"+safe(a.patientName)+"</td>"+
        "<td>"+safe(a.patientIdCard||"")+"</td>"+
        "<td>"+safe(a.patientPhone||"")+"</td>"+
        "<td>"+safe(dr?dr.name:"")+"</td>"+
        "<td>"+safe(cl?cl.name:"")+"</td>"+
        "<td>"+safe(a.status||"Scheduled")+"</td>"+
        "<td style='text-align:right;'>€"+safe((parseFloat(a.doctorFee)||0).toFixed(2))+"</td>"+
        "<td style='text-align:right;'>€"+safe((parseFloat(a.clinicFee)||0).toFixed(2))+"</td>"+
        "<td style='text-align:right;'>€"+safe((parseFloat(a.medicinesCost)||0).toFixed(2))+"</td>"+
        "<td style='text-align:right;font-weight:bold;'>€"+safe((computeTotal(a)).toFixed(2))+"</td>"+
        "</tr>";
    });
    var totals = list.reduce(function(acc,a){
      acc.doc += parseFloat(a.doctorFee)||0;
      acc.cl  += parseFloat(a.clinicFee)||0;
      acc.med += parseFloat(a.medicinesCost)||0;
      acc.tot += computeTotal(a);
      return acc;
    },{doc:0,cl:0,med:0,tot:0});
    var html =
      "<!doctype html><html><head><meta charset='utf-8'><title>"+safe(title)+"</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;font-size:12px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;font-size:13px;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      "h1{margin:0 0 4px 0;font-size:18px;} .meta{font-size:11px;color:#555;margin-bottom:12px;}" +
      "table{width:100%;border-collapse:collapse;}" +
      "th,td{border:1px solid #ddd;padding:5px 7px;font-size:11px;vertical-align:top;}" +
      "th{background:#f0f2f5;text-align:left;font-weight:800;}" +
      "tr:nth-child(even){background:#fafbfc;}" +
      "tfoot td{font-weight:800;background:#e8edf3;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button>" +
      "<h1>"+safe(title)+"</h1>" +
      "<div class='meta'>Records: "+list.length+(filterDesc?" · "+safe(filterDesc):"")+" · Printed: "+new Date().toLocaleString()+"</div>" +
      "<table><thead><tr>" +
      "<th>ID</th><th>Date</th><th>Time</th><th>Patient</th><th>ID Card</th><th>Phone</th><th>Doctor</th><th>Clinic</th><th>Status</th><th>Dr Fee</th><th>Clinic Fee</th><th>Meds</th><th>Total</th>" +
      "</tr></thead><tbody>" + rowsHtml + "</tbody>" +
      "<tfoot><tr><td colspan='9' style='text-align:right;'>TOTALS</td>" +
      "<td style='text-align:right;'>€"+totals.doc.toFixed(2)+"</td>" +
      "<td style='text-align:right;'>€"+totals.cl.toFixed(2)+"</td>" +
      "<td style='text-align:right;'>€"+totals.med.toFixed(2)+"</td>" +
      "<td style='text-align:right;'>€"+totals.tot.toFixed(2)+"</td>" +
      "</tr></tfoot>" +
      "</table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script>" +
      "</body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  function printSingleAppt(a) {
    if (!a) return;
    var w = window.open("","_blank");
    if (!w) { toast("Print","Popup blocked.","bad"); return; }
    function safe(s){ return esc(s); }
    var dr=doctorById(a.doctorId); var cl=clinicById(a.clinicId);
    var meds = String(a.medicines||"").trim();
    var html =
      "<!doctype html><html><head><meta charset='utf-8'><title>"+safe(a.id||"Appointment")+"</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111;max-width:700px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;}" +
      ".hdr{border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start;}" +
      ".aid{font-size:22px;font-weight:900;} .asub{font-size:12px;color:#666;margin-top:4px;}" +
      ".token-box{font-family:monospace;font-size:20px;font-weight:900;letter-spacing:4px;background:#e8f0ff;border:1px solid #b8c8f0;border-radius:8px;padding:4px 12px;}" +
      ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}" +
      ".kv{border:1px solid #e2e4e8;border-radius:8px;padding:10px;}" +
      ".kv.wide{grid-column:1/-1;} .kv.half{grid-column:span 2;}" +
      ".kv .k{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}" +
      ".kv .v{font-size:12px;}" +
      ".fee-row{display:flex;gap:10px;margin-bottom:14px;}" +
      ".fee-box{flex:1;border:1px solid #e2e4e8;border-radius:8px;padding:10px;}" +
      ".fee-box.total{border-color:#2a8;background:#f0fff4;}" +
      ".fee-box .fk{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}" +
      ".fee-box .fv{font-size:14px;font-weight:900;}" +
      ".fee-box.total .fv{color:#1a7a50;font-size:17px;}" +
      ".meds-box{border:1px solid #f0c060;border-radius:8px;padding:12px;margin-bottom:14px;}" +
      ".meds-box .mk{font-size:10px;font-weight:800;color:#a07000;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}" +
      ".meds-box .mv{font-size:12px;white-space:pre-wrap;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button>" +
      "<div class='hdr'>" +
      "<div><div class='aid'>"+safe(a.id||"—")+"</div>" +
      "<div class='asub'>"+safe(fmtDmy(a.date))+" at "+safe(a.time||"—")+" · "+safe(a.status||"Scheduled")+"</div></div>" +
      "<div><div style='font-size:10px;color:#888;margin-bottom:3px;'>PATIENT TOKEN</div><div class='token-box'>"+safe(a.token||"—")+"</div></div>" +
      "</div>" +
      "<div class='grid'>" +
      "<div class='kv half'><div class='k'>Patient</div><div class='v'>"+safe(a.patientName||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>ID Card</div><div class='v'>"+safe(a.patientIdCard||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Phone</div><div class='v'>"+safe(a.patientPhone||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Doctor</div><div class='v'>"+safe(dr?dr.name:"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Clinic</div><div class='v'>"+safe(cl?cl.name:"—")+(cl&&cl.locality?" · "+safe(cl.locality):"")+"</div></div>" +
      "<div class='kv'><div class='k'>Duration</div><div class='v'>"+safe(a.durationMins||"—")+" min</div></div>" +
      (a.notes?"<div class='kv wide'><div class='k'>Notes</div><div class='v'>"+safe(a.notes)+"</div></div>":"")+
      "</div>" +
      "<div class='fee-row'>" +
      "<div class='fee-box'><div class='fk'>Doctor Fee</div><div class='fv'>€"+safe((parseFloat(a.doctorFee)||0).toFixed(2))+"</div></div>" +
      "<div class='fee-box'><div class='fk'>Clinic Fee</div><div class='fv'>€"+safe((parseFloat(a.clinicFee)||0).toFixed(2))+"</div></div>" +
      "<div class='fee-box'><div class='fk'>Medicines</div><div class='fv'>€"+safe((parseFloat(a.medicinesCost)||0).toFixed(2))+"</div></div>" +
      "<div class='fee-box total'><div class='fk'>Total Due</div><div class='fv'>€"+safe((computeTotal(a)).toFixed(2))+"</div></div>" +
      "</div>" +
      (meds?"<div class='meds-box'><div class='mk'>Medicines / Items</div><div class='mv'>"+safe(meds)+"</div></div>":"")+
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script>" +
      "</body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  function printWaitlist(list) {
    var w = window.open("","_blank");
    if (!w) { toast("Print","Popup blocked.","bad"); return; }
    function safe(s){ return esc(s); }
    var rowsHtml="";
    list.forEach(function(wl){
      var dr=doctorById(wl.doctorId); var cl=clinicById(wl.clinicId);
      rowsHtml +=
        "<tr>"+
        "<td>"+safe(wl.id)+"</td>"+
        "<td>"+safe(wl.patientName||"")+"</td>"+
        "<td>"+safe(wl.patientIdCard||"")+"</td>"+
        "<td>"+safe(wl.patientPhone||"")+"</td>"+
        "<td>"+safe(dr?dr.name:"Any")+"</td>"+
        "<td>"+safe(cl?cl.name:"Any")+"</td>"+
        "<td>"+safe(wl.preferredDates||"")+"</td>"+
        "<td>"+safe(wl.flexibility||"")+"</td>"+
        "<td>"+safe(fmtDmy(wl.addedDate||""))+"</td>"+
        "<td>"+safe(wl.status||"Waiting")+"</td>"+
        "<td>"+safe(wl.notes||"")+"</td>"+
        "</tr>";
    });
    var html =
      "<!doctype html><html><head><meta charset='utf-8'><title>Waiting List</title>" +
      "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;font-size:12px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      "h1{margin:0 0 4px 0;font-size:18px;}.meta{font-size:11px;color:#555;margin-bottom:12px;}" +
      "table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:5px 7px;font-size:11px;}" +
      "th{background:#f0f2f5;font-weight:800;text-align:left;}tr:nth-child(even){background:#fafbfc;}" +
      "@media print{button{display:none!important;}}</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button>" +
      "<h1>Waiting List</h1>" +
      "<div class='meta'>Records: "+list.length+" · Printed: "+new Date().toLocaleString()+"</div>" +
      "<table><thead><tr><th>ID</th><th>Patient</th><th>ID Card</th><th>Phone</th><th>Doctor Pref.</th><th>Clinic Pref.</th><th>Preferred Dates</th><th>Flexibility</th><th>Added</th><th>Status</th><th>Notes</th></tr></thead><tbody>" +
      rowsHtml + "</tbody></table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script>" +
      "</body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ── Modals: Doctor management ────────────────────────────────────────────
  function openDoctorsModal(onDone) {
    function renderBody() {
      var docs = loadDoctors();
      var rows = docs.length ? docs.map(function(d){
        return "<div class='ap-mgmt-row' data-id='"+esc(d.id)+"'>" +
          "<div><div class='mgmt-name'>"+esc(d.name)+"</div>" +
          "<div class='mgmt-sub'>"+esc(d.specialty||"General")+" · Fee: "+esc(fmtMoney(d.defaultFee||0))+"</div></div>" +
          "<div class='mgmt-actions'>" +
          "<button class='eikon-btn ap-dr-edit' data-id='"+esc(d.id)+"' type='button'>Edit</button>" +
          "<button class='eikon-btn ap-dr-del'  data-id='"+esc(d.id)+"' type='button' style='color:rgba(255,90,122,.85);'>Delete</button>" +
          "</div></div>";
      }).join("") : "<div style='font-size:12px;color:rgba(233,238,247,.45);padding:8px 0;'>No doctors yet. Add one below.</div>";

      return "<div class='ap-mgmt-grid' id='ap-dr-list'>"+rows+"</div>"+
        "<button class='ap-add-btn' id='ap-dr-add' type='button' style='margin-top:10px;width:100%;'>＋ Add New Doctor</button>";
    }

    function showDrForm(existing) {
      var isEdit = !!existing;
      var d = existing || {};
      var body =
        "<div class='eikon-field'><div class='eikon-label'>Full Name (with title)</div><input class='ap-input' id='ap-drmod-name' type='text' value='"+esc(d.name||"")+"' placeholder='e.g. Dr. Joseph Borg'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Specialty</div><input class='ap-input' id='ap-drmod-spec' type='text' value='"+esc(d.specialty||"")+"' placeholder='e.g. General Practice, Cardiology'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Phone</div><input class='ap-input' id='ap-drmod-phone' type='tel' value='"+esc(d.phone||"")+"' placeholder='e.g. 2100 0000'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Default Patient Fee (€)</div><input class='ap-input' id='ap-drmod-fee' type='number' step='0.01' min='0' value='"+esc(d.defaultFee!=null?d.defaultFee:"")+"' placeholder='e.g. 25.00'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Notes (optional)</div><textarea class='ap-textarea' id='ap-drmod-notes'>"+esc(d.notes||"")+"</textarea></div>";
      E.modal.show(isEdit?"Edit Doctor":"Add Doctor", body, [
        {label:"Cancel", onClick:function(){openDoctorsModal(onDone);}},
        {label:isEdit?"Save Changes":"Add Doctor", primary:true, onClick:function(){
          var name = (E.q("#ap-drmod-name")||{}).value||"";
          name = name.trim();
          if (!name) { toast("Error","Doctor name is required.","bad"); return; }
          var payload = {
            name: name,
            specialty: ((E.q("#ap-drmod-spec")||{}).value||"").trim(),
            phone: ((E.q("#ap-drmod-phone")||{}).value||"").trim(),
            defaultFee: parseFloat((E.q("#ap-drmod-fee")||{}).value||"0")||0,
            notes: ((E.q("#ap-drmod-notes")||{}).value||"").trim()
          };
          if (isEdit) updateDoctor(d.id, payload); else createDoctor(payload);
          if (typeof onDone==="function") onDone();
          openDoctorsModal(onDone);
        }}
      ]);
    }

    E.modal.show("Manage Doctors", renderBody(), [
      {label:"Close", onClick:function(){E.modal.hide(); if(typeof onDone==="function") onDone();}}
    ]);

    // Wire buttons after modal renders
    setTimeout(function(){
      var list=E.q("#ap-dr-list"); var addBtn=E.q("#ap-dr-add");
      if (addBtn) addBtn.addEventListener("click", function(){ showDrForm(null); });
      if (list) {
        list.addEventListener("click", function(ev){
          var btn=ev.target; var id=btn.getAttribute("data-id");
          if (!id) return;
          if (btn.classList.contains("ap-dr-edit")) {
            var d=doctorById(id); if(d) showDrForm(d);
          }
          if (btn.classList.contains("ap-dr-del")) {
            modalConfirm("Delete Doctor","Delete this doctor and their schedules?","Delete","Cancel").then(function(ok){
              if(!ok) { openDoctorsModal(onDone); return; }
              deleteDoctor(id);
              // also delete their schedules
              saveSchedules(loadSchedules().filter(function(s){return s.doctorId!==id;}));
              if(typeof onDone==="function") onDone();
              openDoctorsModal(onDone);
            });
          }
        });
      }
    },60);
  }

  // ── Modals: Clinic management ────────────────────────────────────────────
  function openClinicsModal(onDone) {
    function renderBody() {
      var clinics = loadClinics();
      var rows = clinics.length ? clinics.map(function(c){
        return "<div class='ap-mgmt-row' data-id='"+esc(c.id)+"'>" +
          "<div><div class='mgmt-name'>"+esc(c.name)+"</div>" +
          "<div class='mgmt-sub'>"+esc(c.locality||"")+" · Clinic Fee: "+esc(fmtMoney(c.fee||0))+"</div></div>" +
          "<div class='mgmt-actions'>" +
          "<button class='eikon-btn ap-cl-edit' data-id='"+esc(c.id)+"' type='button'>Edit</button>" +
          "<button class='eikon-btn ap-cl-del'  data-id='"+esc(c.id)+"' type='button' style='color:rgba(255,90,122,.85);'>Delete</button>" +
          "</div></div>";
      }).join("") : "<div style='font-size:12px;color:rgba(233,238,247,.45);padding:8px 0;'>No clinics yet.</div>";

      return "<div class='ap-mgmt-grid' id='ap-cl-list'>"+rows+"</div>"+
        "<button class='ap-add-btn' id='ap-cl-add' type='button' style='margin-top:10px;width:100%;'>＋ Add New Clinic</button>";
    }

    function showClForm(existing) {
      var isEdit = !!existing;
      var c = existing || {};
      var body =
        "<div class='eikon-field'><div class='eikon-label'>Clinic Name</div><input class='ap-input' id='ap-clmod-name' type='text' value='"+esc(c.name||"")+"' placeholder='e.g. Sliema Medical Centre'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Locality</div><input class='ap-input' id='ap-clmod-loc' type='text' value='"+esc(c.locality||"")+"' placeholder='e.g. Sliema, Valletta'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Address</div><input class='ap-input' id='ap-clmod-addr' type='text' value='"+esc(c.address||"")+"' placeholder='e.g. Triq ix-Xatt, Sliema'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Phone</div><input class='ap-input' id='ap-clmod-phone' type='tel' value='"+esc(c.phone||"")+"' placeholder='e.g. 2134 0000'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Standard Clinic Fee (€)</div><input class='ap-input' id='ap-clmod-fee' type='number' step='0.01' min='0' value='"+esc(c.fee!=null?c.fee:"")+"' placeholder='e.g. 15.00'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Notes (optional)</div><textarea class='ap-textarea' id='ap-clmod-notes'>"+esc(c.notes||"")+"</textarea></div>";
      E.modal.show(isEdit?"Edit Clinic":"Add Clinic", body, [
        {label:"Cancel", onClick:function(){openClinicsModal(onDone);}},
        {label:isEdit?"Save Changes":"Add Clinic", primary:true, onClick:function(){
          var name = (E.q("#ap-clmod-name")||{}).value||""; name=name.trim();
          if (!name) { toast("Error","Clinic name is required.","bad"); return; }
          var payload = {
            name: name,
            locality: ((E.q("#ap-clmod-loc")||{}).value||"").trim(),
            address: ((E.q("#ap-clmod-addr")||{}).value||"").trim(),
            phone: ((E.q("#ap-clmod-phone")||{}).value||"").trim(),
            fee: parseFloat((E.q("#ap-clmod-fee")||{}).value||"0")||0,
            notes: ((E.q("#ap-clmod-notes")||{}).value||"").trim()
          };
          if (isEdit) updateClinic(c.id, payload); else createClinic(payload);
          if(typeof onDone==="function") onDone();
          openClinicsModal(onDone);
        }}
      ]);
    }

    E.modal.show("Manage Clinics", renderBody(), [
      {label:"Close", onClick:function(){E.modal.hide(); if(typeof onDone==="function") onDone();}}
    ]);
    setTimeout(function(){
      var addBtn=E.q("#ap-cl-add"); var list=E.q("#ap-cl-list");
      if(addBtn) addBtn.addEventListener("click",function(){ showClForm(null); });
      if(list) {
        list.addEventListener("click",function(ev){
          var btn=ev.target; var id=btn.getAttribute("data-id");
          if(!id) return;
          if(btn.classList.contains("ap-cl-edit")){var c=clinicById(id);if(c) showClForm(c);}
          if(btn.classList.contains("ap-cl-del")){
            modalConfirm("Delete Clinic","Delete this clinic?","Delete","Cancel").then(function(ok){
              if(!ok){openClinicsModal(onDone);return;}
              deleteClinic(id);
              if(typeof onDone==="function") onDone();
              openClinicsModal(onDone);
            });
          }
        });
      }
    },60);
  }

  // ── Modals: Schedules management ─────────────────────────────────────────
  function openSchedulesModal(onDone) {
    function renderBody() {
      var scheds = loadSchedules();
      var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      var rows = scheds.length ? scheds.map(function(s){
        var dr=doctorById(s.doctorId); var cl=clinicById(s.clinicId);
        var desc = s.isOneOff
          ? "One-off: " + fmtDmy(s.date)
          : days[Number(s.dayOfWeek)] + "s" + (s.validFrom?" from "+fmtDmy(s.validFrom):"") + (s.validUntil?" until "+fmtDmy(s.validUntil):"");
        return "<div class='ap-mgmt-row'>" +
          "<div style='flex:1'><div class='mgmt-name'>"+(dr?esc(dr.name):"Unknown Doctor")+(s.cancelled?" <span style='color:#ff8ca4;'>[Cancelled]</span>":"")+"</div>" +
          "<div class='mgmt-sub'>"+(cl?esc(cl.name):"")+" · "+esc(desc)+" · "+esc(s.startTime||"")+"–"+esc(s.endTime||"")+"</div></div>" +
          "<div class='mgmt-actions'>" +
          "<button class='eikon-btn ap-sch-toggle' data-id='"+esc(s.id)+"' type='button'>"+(s.cancelled?"Reinstate":"Cancel")+"</button>" +
          "<button class='eikon-btn ap-sch-edit'   data-id='"+esc(s.id)+"' type='button'>Edit</button>" +
          "<button class='eikon-btn ap-sch-del'    data-id='"+esc(s.id)+"' type='button' style='color:rgba(255,90,122,.85);'>Delete</button>" +
          "</div></div>";
      }).join("") : "<div style='font-size:12px;color:rgba(233,238,247,.45);padding:8px 0;'>No schedules yet.</div>";

      return "<div class='ap-mgmt-grid' id='ap-sch-list'>"+rows+"</div>"+
        "<button class='ap-add-btn' id='ap-sch-add' type='button' style='margin-top:10px;width:100%;'>＋ Add Schedule</button>";
    }

    function showSchForm(existing) {
      var isEdit = !!existing;
      var s = existing || {isOneOff:false};
      var isOneOff = !!s.isOneOff;
      var body =
        "<div class='eikon-field'><div class='eikon-label'>Doctor</div><select class='ap-select' id='ap-schmod-dr'>"+buildDoctorOptions(s.doctorId)+"</select></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Clinic</div><select class='ap-select' id='ap-schmod-cl'>"+buildClinicOptions(s.clinicId)+"</select></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Schedule Type</div>" +
        "<select class='ap-select' id='ap-schmod-type'>" +
        "<option value='recurring'"+(isOneOff?"":" selected")+">Recurring (weekly)</option>" +
        "<option value='oneoff'"+(isOneOff?" selected":"")+">One-off date</option>" +
        "</select></div>" +
        "<div id='ap-sch-recurring' style='display:"+(isOneOff?"none":"block")+"'>" +
        "<div class='eikon-field'><div class='eikon-label'>Day of Week</div><select class='ap-select' id='ap-schmod-dow'>"+buildDowOptions(s.dayOfWeek!=null?s.dayOfWeek:1)+"</select></div>" +
        "<div class='ap-form-grid'>" +
        "<div class='eikon-field'><div class='eikon-label'>Valid From (optional)</div><input class='ap-input' id='ap-schmod-from' type='date' value='"+esc(s.validFrom||"")+"'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Valid Until (optional)</div><input class='ap-input' id='ap-schmod-until' type='date' value='"+esc(s.validUntil||"")+"'></div>" +
        "</div></div>" +
        "<div id='ap-sch-oneoff' style='display:"+(isOneOff?"block":"none")+"'>" +
        "<div class='eikon-field'><div class='eikon-label'>Date</div><input class='ap-input' id='ap-schmod-date' type='date' value='"+esc(s.date||todayYmd())+"'></div>" +
        "</div>" +
        "<div class='ap-form-grid'>" +
        "<div class='eikon-field'><div class='eikon-label'>Start Time</div><input class='ap-input' id='ap-schmod-start' type='time' value='"+esc(s.startTime||"09:00")+"'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>End Time</div><input class='ap-input' id='ap-schmod-end' type='time' value='"+esc(s.endTime||"17:00")+"'></div>" +
        "</div>" +
        "<div class='eikon-field'><div class='eikon-label'>Default Slot Duration (minutes)</div><input class='ap-input' id='ap-schmod-slot' type='number' min='5' max='180' step='5' value='"+esc(s.slotDuration||30)+"'></div>";

      E.modal.show(isEdit?"Edit Schedule":"Add Schedule", body, [
        {label:"Cancel", onClick:function(){openSchedulesModal(onDone);}},
        {label:isEdit?"Save Changes":"Add Schedule", primary:true, onClick:function(){
          var drId = (E.q("#ap-schmod-dr")||{}).value||"";
          if(!drId){toast("Error","Please select a doctor.","bad");return;}
          var type = (E.q("#ap-schmod-type")||{}).value||"recurring";
          var isOO = type==="oneoff";
          var payload = {
            doctorId: drId,
            clinicId: (E.q("#ap-schmod-cl")||{}).value||"",
            isOneOff: isOO,
            startTime: (E.q("#ap-schmod-start")||{}).value||"09:00",
            endTime: (E.q("#ap-schmod-end")||{}).value||"17:00",
            slotDuration: parseInt((E.q("#ap-schmod-slot")||{}).value||"30",10)||30
          };
          if(isOO){
            payload.date = (E.q("#ap-schmod-date")||{}).value||todayYmd();
          } else {
            payload.dayOfWeek = parseInt((E.q("#ap-schmod-dow")||{}).value||"1",10);
            payload.validFrom = (E.q("#ap-schmod-from")||{}).value||"";
            payload.validUntil = (E.q("#ap-schmod-until")||{}).value||"";
          }
          if(isEdit) updateSchedule(s.id, payload); else createSchedule(payload);
          if(typeof onDone==="function") onDone();
          openSchedulesModal(onDone);
        }}
      ]);

      setTimeout(function(){
        var typeSel=E.q("#ap-schmod-type");
        var recDiv=E.q("#ap-sch-recurring");
        var ooDiv=E.q("#ap-sch-oneoff");
        if(typeSel&&recDiv&&ooDiv){
          typeSel.addEventListener("change",function(){
            var v=typeSel.value;
            recDiv.style.display=(v==="recurring"?"block":"none");
            ooDiv.style.display=(v==="oneoff"?"block":"none");
          });
        }
      },60);
    }

    E.modal.show("Manage Schedules", renderBody(), [
      {label:"Close", onClick:function(){E.modal.hide(); if(typeof onDone==="function") onDone();}}
    ]);

    setTimeout(function(){
      var addBtn=E.q("#ap-sch-add"); var list=E.q("#ap-sch-list");
      if(addBtn) addBtn.addEventListener("click",function(){showSchForm(null);});
      if(list){
        list.addEventListener("click",function(ev){
          var btn=ev.target; var id=btn.getAttribute("data-id");
          if(!id) return;
          var scheds=loadSchedules();
          var sch=scheds.filter(function(s){return s.id===id;})[0];
          if(btn.classList.contains("ap-sch-edit")){if(sch)showSchForm(sch);}
          if(btn.classList.contains("ap-sch-toggle")){
            if(sch){updateSchedule(id,{cancelled:!sch.cancelled});if(typeof onDone==="function")onDone();openSchedulesModal(onDone);}
          }
          if(btn.classList.contains("ap-sch-del")){
            modalConfirm("Delete Schedule","Remove this schedule?","Delete","Cancel").then(function(ok){
              if(!ok){openSchedulesModal(onDone);return;}
              deleteSchedule(id);
              if(typeof onDone==="function")onDone();
              openSchedulesModal(onDone);
            });
          }
        });
      }
    },60);
  }

  // ── Modal: New/Edit Appointment ────────────────────────────────────────────
  function openApptModal(opts, onSaved) {
    var isEdit = !!(opts&&opts.appt);
    var a = (opts&&opts.appt)||{};
    var prefDate = (opts&&opts.date)||todayYmd();
    var prefDoctorId = (opts&&opts.doctorId)||"";
    var prefClinicId = (opts&&opts.clinicId)||"";
    var fromWl = opts&&opts.fromWaitlist ? opts.fromWaitlist : null;

    // Pre-fill from waiting list entry
    if (fromWl) {
      a.patientName  = fromWl.patientName  || a.patientName  || "";
      a.patientIdCard= fromWl.patientIdCard|| a.patientIdCard|| "";
      a.patientPhone = fromWl.patientPhone || a.patientPhone || "";
      prefDoctorId   = fromWl.doctorId     || prefDoctorId;
      prefClinicId   = fromWl.clinicId     || prefClinicId;
    }

    var init = {
      date:         isEdit && isYmd(a.date) ? a.date : (isYmd(prefDate)?prefDate:todayYmd()),
      time:         String(a.time||"09:00"),
      durationMins: Number(a.durationMins||30),
      patientName:  String(a.patientName||""),
      patientIdCard:String(a.patientIdCard||""),
      patientPhone: String(a.patientPhone||""),
      doctorId:     String(a.doctorId||prefDoctorId||""),
      clinicId:     String(a.clinicId||prefClinicId||""),
      status:       String(a.status||"Scheduled"),
      doctorFee:    a.doctorFee!=null?Number(a.doctorFee):"",
      clinicFee:    a.clinicFee!=null?Number(a.clinicFee):"",
      medicines:    String(a.medicines||""),
      medicinesCost:a.medicinesCost!=null?Number(a.medicinesCost):"",
      notes:        String(a.notes||""),
      cancellationReason: String(a.cancellationReason||"")
    };

    var body =
      // Patient details
      "<div class='ap-form-section'>Patient Details</div>" +
      "<div class='ap-form-grid'>" +
      "<div class='eikon-field ap-form-full'><div class='eikon-label'>Patient Name &amp; Surname</div>" +
      "<input class='ap-input' id='ap-mod-patient' type='text' value='"+esc(init.patientName)+"' placeholder='e.g. Maria Camilleri' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>ID Card No.</div>" +
      "<input class='ap-input' id='ap-mod-idcard' type='text' value='"+esc(init.patientIdCard)+"' placeholder='e.g. 123456M' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Phone</div>" +
      "<input class='ap-input' id='ap-mod-phone' type='tel' value='"+esc(init.patientPhone)+"' placeholder='e.g. 7900 0000' style='width:100%;'></div>" +
      "</div>" +
      // Appointment details
      "<div class='ap-form-section' style='margin-top:10px;'>Appointment Details</div>" +
      "<div class='ap-form-grid'>" +
      "<div class='eikon-field'><div class='eikon-label'>Date</div>" +
      "<input class='ap-input' id='ap-mod-date' type='date' value='"+esc(init.date)+"' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Time</div>" +
      "<input class='ap-input' id='ap-mod-time' type='time' value='"+esc(init.time)+"' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Duration (min)</div>" +
      "<input class='ap-input' id='ap-mod-dur' type='number' min='5' max='180' step='5' value='"+esc(init.durationMins)+"' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Status</div>" +
      "<select class='ap-select' id='ap-mod-status' style='width:100%;'>"+buildStatusOptions(init.status,APPT_STATUSES)+"</select></div>" +
      "</div>" +
      "<div class='ap-form-grid' style='margin-top:8px;'>" +
      "<div class='eikon-field'><div class='eikon-label'>Doctor</div>" +
      "<select class='ap-select' id='ap-mod-dr' style='width:100%;'>"+buildDoctorOptions(init.doctorId)+"</select></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Clinic</div>" +
      "<select class='ap-select' id='ap-mod-cl' style='width:100%;'>"+buildClinicOptions(init.clinicId)+"</select></div>" +
      "</div>" +
      // Fees
      "<div class='ap-form-section' style='margin-top:10px;'>Fees &amp; Medicines</div>" +
      "<div class='ap-form-fee-grid'>" +
      "<div class='eikon-field'><div class='eikon-label'>Doctor Fee (€)</div>" +
      "<input class='ap-input' id='ap-mod-drfee' type='number' step='0.01' min='0' value='"+esc(init.doctorFee)+"' placeholder='Auto from doctor' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Clinic Fee (€)</div>" +
      "<input class='ap-input' id='ap-mod-clfee' type='number' step='0.01' min='0' value='"+esc(init.clinicFee)+"' placeholder='Auto from clinic' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Medicines Cost (€)</div>" +
      "<input class='ap-input' id='ap-mod-medfee' type='number' step='0.01' min='0' value='"+esc(init.medicinesCost)+"' placeholder='0.00' style='width:100%;'></div>" +
      "</div>" +
      "<div style='margin-top:6px;'><span class='ap-total-preview' id='ap-mod-total'>Total: calculating…</span></div>" +
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Medicines / Items Dispensed</div>" +
      "<textarea class='ap-textarea' id='ap-mod-meds' placeholder='e.g. Amoxicillin 250mg x14&#10;Paracetamol 500mg x20'>"+esc(init.medicines)+"</textarea></div>" +
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Internal Notes</div>" +
      "<textarea class='ap-textarea' id='ap-mod-notes' placeholder='Any internal notes or instructions…' style='min-height:55px;'>"+esc(init.notes)+"</textarea></div>" +
      "<div class='eikon-field' id='ap-cancel-reason-wrap' style='margin-top:8px;display:"+(init.status==="Cancelled"?"block":"none")+";'>" +
      "<div class='eikon-label'>Cancellation Reason</div>" +
      "<input class='ap-input' id='ap-mod-cancelreason' type='text' value='"+esc(init.cancellationReason)+"' placeholder='Reason for cancellation' style='width:100%;'></div>";

    E.modal.show(isEdit?"Edit Appointment":"New Appointment", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:isEdit?"Save Changes":"Create Appointment", primary:true, onClick:function(){
        try {
          var patient = ((E.q("#ap-mod-patient")||{}).value||"").trim();
          if(!patient) throw new Error("Patient name is required.");
          var date = ((E.q("#ap-mod-date")||{}).value||"").trim();
          if(!isYmd(date)) throw new Error("Please enter a valid date.");
          var time = ((E.q("#ap-mod-time")||{}).value||"").trim();
          if(!time) throw new Error("Please enter a time.");
          var drId = ((E.q("#ap-mod-dr")||{}).value||"").trim();
          if(!drId) throw new Error("Please select a doctor.");
          var df = parseFloat((E.q("#ap-mod-drfee")||{}).value||"")||0;
          var cf = parseFloat((E.q("#ap-mod-clfee")||{}).value||"")||0;
          var mf = parseFloat((E.q("#ap-mod-medfee")||{}).value||"")||0;
          var status = ((E.q("#ap-mod-status")||{}).value||"Scheduled").trim();
          var payload = {
            patientName:  patient,
            patientIdCard: ((E.q("#ap-mod-idcard")||{}).value||"").trim(),
            patientPhone:  ((E.q("#ap-mod-phone")||{}).value||"").trim(),
            doctorId: drId,
            clinicId: ((E.q("#ap-mod-cl")||{}).value||"").trim(),
            date: date,
            time: time,
            durationMins: parseInt((E.q("#ap-mod-dur")||{}).value||"30",10)||30,
            status: status,
            doctorFee: df,
            clinicFee: cf,
            medicines: ((E.q("#ap-mod-meds")||{}).value||"").trim(),
            medicinesCost: mf,
            notes: ((E.q("#ap-mod-notes")||{}).value||"").trim(),
            cancellationReason: status==="Cancelled"?((E.q("#ap-mod-cancelreason")||{}).value||"").trim():""
          };
          if(isEdit){ updateAppt(a.id, payload); toast("Saved","Appointment updated.","good"); }
          else { var res=createAppt(payload); toast("Created","Appointment "+res.id+" created. Token: "+res.token,"good"); }
          E.modal.hide();
          if(typeof onSaved==="function") onSaved();
        } catch(ex) { modalError("Validation Error", ex); }
      }}
    ]);

    // Wire: auto-fill fees when doctor/clinic changes; update total preview
    setTimeout(function(){
      function updateTotal(){
        var df=parseFloat((E.q("#ap-mod-drfee")||{}).value||"")||0;
        var cf=parseFloat((E.q("#ap-mod-clfee")||{}).value||"")||0;
        var mf=parseFloat((E.q("#ap-mod-medfee")||{}).value||"")||0;
        var totEl=E.q("#ap-mod-total");
        if(totEl) totEl.textContent="Total: €"+(df+cf+mf).toFixed(2);
      }
      function autoFillFees(){
        var drSel=E.q("#ap-mod-dr"); var clSel=E.q("#ap-mod-cl");
        var drFeeEl=E.q("#ap-mod-drfee"); var clFeeEl=E.q("#ap-mod-clfee");
        if(drSel&&drFeeEl&&!isEdit){
          var dr=doctorById(drSel.value);
          if(dr&&dr.defaultFee!=null&&drFeeEl.value==="") drFeeEl.value=dr.defaultFee;
        }
        if(clSel&&clFeeEl&&!isEdit){
          var cl=clinicById(clSel.value);
          if(cl&&cl.fee!=null&&clFeeEl.value==="") clFeeEl.value=cl.fee;
        }
        updateTotal();
      }
      var drSel=E.q("#ap-mod-dr"); var clSel=E.q("#ap-mod-cl");
      var statusSel=E.q("#ap-mod-status");
      var cancelWrap=E.q("#ap-cancel-reason-wrap");
      if(drSel) drSel.addEventListener("change",autoFillFees);
      if(clSel) clSel.addEventListener("change",function(){ var cl=clinicById(clSel.value); var cf=E.q("#ap-mod-clfee"); if(cl&&cf&&!isEdit&&cf.value==="") cf.value=cl.fee||0; updateTotal(); });
      ["#ap-mod-drfee","#ap-mod-clfee","#ap-mod-medfee"].forEach(function(id){
        var el=E.q(id); if(el) el.addEventListener("input",updateTotal);
      });
      if(statusSel&&cancelWrap){
        statusSel.addEventListener("change",function(){cancelWrap.style.display=(statusSel.value==="Cancelled"?"block":"none");});
      }
      // Initial auto-fill
      autoFillFees();
    },60);
  }

  // ── Modal: Waiting list entry ─────────────────────────────────────────────
  function openWaitlistModal(opts, onSaved) {
    var isEdit = !!(opts&&opts.entry);
    var w = (opts&&opts.entry)||{};
    var body =
      "<div class='eikon-field'><div class='eikon-label'>Patient Name &amp; Surname</div>" +
      "<input class='ap-input' id='ap-wlmod-name' type='text' value='"+esc(w.patientName||"")+"' placeholder='e.g. Maria Camilleri' style='width:100%;'></div>" +
      "<div class='ap-form-grid'>" +
      "<div class='eikon-field'><div class='eikon-label'>ID Card No.</div>" +
      "<input class='ap-input' id='ap-wlmod-id' type='text' value='"+esc(w.patientIdCard||"")+"' placeholder='e.g. 123456M' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Phone</div>" +
      "<input class='ap-input' id='ap-wlmod-phone' type='tel' value='"+esc(w.patientPhone||"")+"' placeholder='e.g. 7900 0000' style='width:100%;'></div>" +
      "</div>" +
      "<div class='ap-form-grid' style='margin-top:4px;'>" +
      "<div class='eikon-field'><div class='eikon-label'>Preferred Doctor</div>" +
      "<select class='ap-select' id='ap-wlmod-dr' style='width:100%;'>"+buildDoctorOptions(w.doctorId,"any")+"</select></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Preferred Clinic</div>" +
      "<select class='ap-select' id='ap-wlmod-cl' style='width:100%;'>"+buildClinicOptions(w.clinicId,"any")+"</select></div>" +
      "</div>" +
      "<div class='eikon-field' style='margin-top:4px;'><div class='eikon-label'>Preferred Dates / Days</div>" +
      "<input class='ap-input' id='ap-wlmod-dates' type='text' value='"+esc(w.preferredDates||"")+"' placeholder='e.g. Mondays or Tuesdays mornings, ASAP' style='width:100%;'></div>" +
      "<div class='eikon-field' style='margin-top:4px;'><div class='eikon-label'>Flexibility</div>" +
      "<select class='ap-select' id='ap-wlmod-flex' style='width:100%;'>" +
      "<option value='Flexible'"+(w.flexibility==="Flexible"||(w.flexibility===undefined&&true)?" selected":"")+">Flexible</option>" +
      "<option value='Fixed'"+(w.flexibility==="Fixed"?" selected":"")+">Fixed dates only</option>" +
      "<option value='Urgent'"+(w.flexibility==="Urgent"?" selected":"")+">Urgent – first available</option>" +
      "</select></div>" +
      (isEdit?"<div class='eikon-field' style='margin-top:4px;'><div class='eikon-label'>Status</div><select class='ap-select' id='ap-wlmod-status' style='width:100%;'>"+buildStatusOptions(w.status||"Waiting",WL_STATUSES)+"</select></div>":"")+
      "<div class='eikon-field' style='margin-top:4px;'><div class='eikon-label'>Notes</div>" +
      "<textarea class='ap-textarea' id='ap-wlmod-notes' style='min-height:55px;'>"+esc(w.notes||"")+"</textarea></div>";

    E.modal.show(isEdit?"Edit Waiting List Entry":"Add to Waiting List", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:isEdit?"Save Changes":"Add to Waiting List", primary:true, onClick:function(){
        var name = ((E.q("#ap-wlmod-name")||{}).value||"").trim();
        if(!name){toast("Error","Patient name is required.","bad");return;}
        var payload = {
          patientName:  name,
          patientIdCard: ((E.q("#ap-wlmod-id")||{}).value||"").trim(),
          patientPhone:  ((E.q("#ap-wlmod-phone")||{}).value||"").trim(),
          doctorId: ((E.q("#ap-wlmod-dr")||{}).value||"").trim(),
          clinicId: ((E.q("#ap-wlmod-cl")||{}).value||"").trim(),
          preferredDates: ((E.q("#ap-wlmod-dates")||{}).value||"").trim(),
          flexibility: ((E.q("#ap-wlmod-flex")||{}).value||"Flexible").trim(),
          notes: ((E.q("#ap-wlmod-notes")||{}).value||"").trim()
        };
        if(isEdit){
          payload.status = ((E.q("#ap-wlmod-status")||{}).value||w.status||"Waiting").trim();
          updateWaitlistEntry(w.id, payload);
          toast("Saved","Waiting list entry updated.","good");
        } else {
          createWaitlistEntry(payload);
          toast("Added","Patient added to waiting list.","good");
        }
        E.modal.hide();
        if(typeof onSaved==="function") onSaved();
      }}
    ]);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  var state = {
    view: "day",          // "day" | "list" | "waitlist"
    currentDate: todayYmd(),
    filterDoctorId: "",
    filterClinicId: "",
    filterStatus: "",
    filterDateFrom: "",
    filterDateTo: "",
    listQuery: "",
    listSort: {key:"date",dir:"asc"},
    wlQuery: "",
    wlSort: {key:"addedDate",dir:"desc"},
    selectedApptId: null,
    selectedWlId: null,
    // render callbacks set by render()
    refresh: null
  };

  // ── Sorting ───────────────────────────────────────────────────────────────
  function cmp(a,b){if(a<b)return -1;if(a>b)return 1;return 0;}
  function sortList(list,sortState,keyFn) {
    var key=sortState.key; var dir=sortState.dir; var mul=dir==="desc"?-1:1;
    return list.slice().sort(function(a,b){
      var va=keyFn?keyFn(a,key):norm(a[key]);
      var vb=keyFn?keyFn(b,key):norm(b[key]);
      return cmp(String(va),String(vb))*mul;
    });
  }

  // ── Filtered appt list ────────────────────────────────────────────────────
  function getFilteredAppts() {
    var all = loadAppts();
    var q = norm(state.listQuery);
    if(state.filterDoctorId) all=all.filter(function(a){return a.doctorId===state.filterDoctorId;});
    if(state.filterClinicId) all=all.filter(function(a){return a.clinicId===state.filterClinicId;});
    if(state.filterStatus)   all=all.filter(function(a){return a.status===state.filterStatus;});
    if(state.filterDateFrom) all=all.filter(function(a){return a.date>=state.filterDateFrom;});
    if(state.filterDateTo)   all=all.filter(function(a){return a.date<=state.filterDateTo;});
    if(q) all=all.filter(function(a){
      var dr=doctorById(a.doctorId); var cl=clinicById(a.clinicId);
      var blob=norm(a.id)+" "+norm(a.patientName)+" "+norm(a.patientIdCard)+" "+norm(a.patientPhone)+" "+
               norm(a.date)+" "+norm(a.status)+" "+norm(dr?dr.name:"")+" "+norm(cl?cl.name:"")+" "+norm(a.medicines)+" "+norm(a.notes);
      return blob.indexOf(q)>=0;
    });
    return sortList(all, state.listSort);
  }

  function getFilteredWaitlist() {
    var all=loadWaitlist();
    var q=norm(state.wlQuery);
    if(q) all=all.filter(function(w){
      var dr=doctorById(w.doctorId); var cl=clinicById(w.clinicId);
      return (norm(w.id)+" "+norm(w.patientName)+" "+norm(w.patientIdCard)+" "+norm(w.patientPhone)+" "+
              norm(dr?dr.name:"")+" "+norm(cl?cl.name:"")+" "+norm(w.status)+" "+norm(w.preferredDates)+" "+norm(w.notes)).indexOf(q)>=0;
    });
    return sortList(all, state.wlSort);
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function render(ctx) {
    ensureStyles();
    var mount = ctx.mount;

    function thHtml(label,key,sortSt){
      var on=sortSt.key===key;
      var arrow=on?(sortSt.dir==="asc"?"▲":"▼"):"⇅";
      return "<span class='ap-sort"+(on?" on":"")+"' data-key='"+esc(key)+"'>"+esc(label)+"<span class='car'>"+arrow+"</span></span>";
    }

    // ── Build markup ──────────────────────────────────────────────────────
    mount.innerHTML =
      "<div class='ap-wrap'>" +

      "<div class='ap-head'>" +
      "  <div><h2 class='ap-title'>📅 Doctors Appointments</h2>" +
      "    <div class='ap-sub'>Manage patient appointments, schedules, and waiting list.</div>" +
      "  </div>" +
      "  <div class='ap-controls'>" +
      "    <div class='ap-tabs'>" +
      "      <button class='ap-tab"+(state.view==="day"?" active":"")+"' data-view='day' type='button'>📅 Day View</button>" +
      "      <button class='ap-tab"+(state.view==="list"?" active":"")+"' data-view='list' type='button'>📋 All Appointments</button>" +
      "      <button class='ap-tab"+(state.view==="waitlist"?" active":"")+"' data-view='waitlist' type='button'>⏳ Waiting List <span class='ap-wl-badge' id='ap-wl-badge'>…</span></button>" +
      "    </div>" +
      "    <button class='eikon-btn' id='ap-new-appt' type='button'>＋ New Appointment</button>" +
      "    <button class='eikon-btn' id='ap-btn-waitlist' type='button'>＋ Waiting List</button>" +
      "    <div style='position:relative;display:inline-block;'>" +
      "      <button class='eikon-btn' id='ap-settings-btn' type='button'>⚙ Settings ▾</button>" +
      "      <div id='ap-settings-menu' style='display:none;position:absolute;right:0;top:34px;background:rgba(15,22,34,.98);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:6px;z-index:9999;min-width:170px;box-shadow:0 12px 40px rgba(0,0,0,.5);'>" +
      "        <button class='eikon-btn' id='ap-manage-doctors'  type='button' style='display:block;width:100%;text-align:left;margin:0 0 4px 0;'>👨‍⚕️ Manage Doctors</button>" +
      "        <button class='eikon-btn' id='ap-manage-clinics'  type='button' style='display:block;width:100%;text-align:left;margin:0 0 4px 0;'>🏥 Manage Clinics</button>" +
      "        <button class='eikon-btn' id='ap-manage-scheds'   type='button' style='display:block;width:100%;text-align:left;'>📆 Schedules</button>" +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</div>" +

      // ── Day View ──
      "<div id='ap-view-day' style='display:"+(state.view==="day"?"block":"none")+"'>" +
      "  <div class='ap-card'>" +
      "    <div class='ap-card-head'>" +
      "      <div style='display:flex;flex-direction:column;gap:4px;'>" +
      "        <div class='ap-nav'>" +
      "          <button class='ap-nav-btn' id='ap-day-prev' type='button'>◀</button>" +
      "          <div><div class='ap-nav-date' id='ap-day-label'></div><div class='ap-nav-sub' id='ap-day-sub'></div></div>" +
      "          <button class='ap-nav-btn' id='ap-day-next' type='button'>▶</button>" +
      "          <button class='ap-nav-btn' id='ap-day-today' type='button' style='font-size:11px;padding:5px 8px;'>Today</button>" +
      "        </div>" +
      "      </div>" +
      "      <div class='right'>" +
      "        <input class='ap-date-input' id='ap-day-picker' type='date' value='"+esc(state.currentDate)+"' title='Jump to date'>" +
      "        <select class='ap-select' id='ap-day-dr-filter' style='min-width:160px;'>"+buildDoctorOptions("","any")+"</select>" +
      "        <button class='eikon-btn' id='ap-day-print' type='button'>🖨 Print Day</button>" +
      "      </div>" +
      "    </div>" +
      "    <div id='ap-day-schedinfo'></div>" +
      "    <div id='ap-day-list' class='ap-day-grid'></div>" +
      "  </div>" +
      "  <!-- Selected appointment detail -->" +
      "  <div class='ap-card' id='ap-day-detail' style='display:none;'>" +
      "    <div class='ap-card-head'><h3 id='ap-day-detail-title'>Appointment Details</h3>" +
      "      <div class='right' id='ap-day-detail-actions'></div>" +
      "    </div>" +
      "    <div id='ap-day-detail-body'></div>" +
      "  </div>" +
      "</div>" +

      // ── List View ──
      "<div id='ap-view-list' style='display:"+(state.view==="list"?"block":"none")+"'>" +
      "  <div class='ap-card'>" +
      "    <div class='ap-card-head'>" +
      "      <div><h3>All Appointments</h3><div class='meta' id='ap-list-count'>Loading…</div></div>" +
      "      <div class='right'>" +
      "        <button class='eikon-btn' id='ap-list-print' type='button'>🖨 Print List</button>" +
      "      </div>" +
      "    </div>" +
      "    <div class='ap-filters'>" +
      "      <div class='ap-filter-field'><label>Search</label>" +
      "        <input class='ap-input' id='ap-list-search' type='text' placeholder='Patient, doctor, clinic…' value='"+esc(state.listQuery)+"' style='min-width:200px;'></div>" +
      "      <div class='ap-filter-field'><label>Doctor</label>" +
      "        <select class='ap-select' id='ap-list-dr'>"+buildDoctorOptions(state.filterDoctorId,"any")+"</select></div>" +
      "      <div class='ap-filter-field'><label>Clinic</label>" +
      "        <select class='ap-select' id='ap-list-cl'>"+buildClinicOptions(state.filterClinicId,"any")+"</select></div>" +
      "      <div class='ap-filter-field'><label>Status</label>" +
      "        <select class='ap-select' id='ap-list-status'>" +
      "          <option value=''>— All Statuses —</option>" +
      "          "+APPT_STATUSES.map(function(s){return "<option value='"+esc(s)+"'"+(s===state.filterStatus?" selected":"")+">"+esc(s)+"</option>";}).join("") +
      "        </select></div>" +
      "      <div class='ap-filter-field'><label>From</label>" +
      "        <input class='ap-input' id='ap-list-from' type='date' value='"+esc(state.filterDateFrom)+"'></div>" +
      "      <div class='ap-filter-field'><label>To</label>" +
      "        <input class='ap-input' id='ap-list-to' type='date' value='"+esc(state.filterDateTo)+"'></div>" +
      "      <button class='eikon-btn' id='ap-list-clear' type='button' style='align-self:flex-end;'>Clear</button>" +
      "    </div>" +
      "    <div class='ap-table-wrap'>" +
      "      <table class='ap-table' id='ap-list-table'>" +
      "        <thead><tr>" +
      "          <th>"+thHtml("ID","id",state.listSort)+"</th>" +
      "          <th>"+thHtml("Date","date",state.listSort)+"</th>" +
      "          <th>"+thHtml("Time","time",state.listSort)+"</th>" +
      "          <th>"+thHtml("Patient","patientName",state.listSort)+"</th>" +
      "          <th>"+thHtml("ID Card","patientIdCard",state.listSort)+"</th>" +
      "          <th>"+thHtml("Phone","patientPhone",state.listSort)+"</th>" +
      "          <th>"+thHtml("Doctor","doctorId",state.listSort)+"</th>" +
      "          <th>"+thHtml("Clinic","clinicId",state.listSort)+"</th>" +
      "          <th class='noclick'>Status</th>" +
      "          <th>"+thHtml("Total","total",state.listSort)+"</th>" +
      "        </tr></thead>" +
      "        <tbody id='ap-list-tbody'></tbody>" +
      "      </table>" +
      "    </div>" +
      "  </div>" +
      "  <!-- List selected detail -->" +
      "  <div class='ap-card' id='ap-list-detail' style='display:none;'>" +
      "    <div class='ap-card-head'><h3 id='ap-list-detail-title'>Appointment Details</h3>" +
      "      <div class='right' id='ap-list-detail-actions'></div>" +
      "    </div>" +
      "    <div id='ap-list-detail-body'></div>" +
      "  </div>" +
      "</div>" +

      // ── Waiting List View ──
      "<div id='ap-view-waitlist' style='display:"+(state.view==="waitlist"?"block":"none")+"'>" +
      "  <div class='ap-card'>" +
      "    <div class='ap-card-head'>" +
      "      <div><h3>⏳ Waiting List</h3><div class='meta' id='ap-wl-count'>Loading…</div></div>" +
      "      <div class='right'>" +
      "        <input class='ap-input' id='ap-wl-search' type='text' placeholder='Search waiting list…' value='"+esc(state.wlQuery)+"' style='min-width:200px;'>" +
      "        <button class='eikon-btn' id='ap-wl-print' type='button'>🖨 Print</button>" +
      "      </div>" +
      "    </div>" +
      "    <div class='ap-table-wrap'>" +
      "      <table class='ap-table' id='ap-wl-table'>" +
      "        <thead><tr>" +
      "          <th>"+thHtml("ID","id",state.wlSort)+"</th>" +
      "          <th>"+thHtml("Patient","patientName",state.wlSort)+"</th>" +
      "          <th>"+thHtml("ID Card","patientIdCard",state.wlSort)+"</th>" +
      "          <th>"+thHtml("Phone","patientPhone",state.wlSort)+"</th>" +
      "          <th>"+thHtml("Doctor Pref.","doctorId",state.wlSort)+"</th>" +
      "          <th>"+thHtml("Clinic Pref.","clinicId",state.wlSort)+"</th>" +
      "          <th>"+thHtml("Preferred Dates","preferredDates",state.wlSort)+"</th>" +
      "          <th>"+thHtml("Flexibility","flexibility",state.wlSort)+"</th>" +
      "          <th>"+thHtml("Added","addedDate",state.wlSort)+"</th>" +
      "          <th class='noclick'>Status</th>" +
      "        </tr></thead>" +
      "        <tbody id='ap-wl-tbody'></tbody>" +
      "      </table>" +
      "    </div>" +
      "  </div>" +
      "  <!-- WL selected detail -->" +
      "  <div class='ap-card' id='ap-wl-detail' style='display:none;'>" +
      "    <div class='ap-card-head'><h3 id='ap-wl-detail-title'>Waiting List Entry</h3>" +
      "      <div class='right' id='ap-wl-detail-actions'></div>" +
      "    </div>" +
      "    <div id='ap-wl-detail-body'></div>" +
      "  </div>" +
      "</div>" +

      "</div>";

    // ── DOM refs ──────────────────────────────────────────────────────────
    var viewDayEl      = E.q("#ap-view-day",   mount);
    var viewListEl     = E.q("#ap-view-list",  mount);
    var viewWlEl       = E.q("#ap-view-waitlist",mount);
    var wlBadge        = E.q("#ap-wl-badge",   mount);

    var dayLabel       = E.q("#ap-day-label",  mount);
    var daySub         = E.q("#ap-day-sub",    mount);
    var dayPicker      = E.q("#ap-day-picker", mount);
    var dayDrFilter    = E.q("#ap-day-dr-filter",mount);
    var dayList        = E.q("#ap-day-list",   mount);
    var daySchedInfo   = E.q("#ap-day-schedinfo",mount);
    var dayDetailCard  = E.q("#ap-day-detail", mount);
    var dayDetailTitle = E.q("#ap-day-detail-title",mount);
    var dayDetailBody  = E.q("#ap-day-detail-body",mount);
    var dayDetailActions=E.q("#ap-day-detail-actions",mount);

    var listTbody      = E.q("#ap-list-tbody",  mount);
    var listCount      = E.q("#ap-list-count",  mount);
    var listDetailCard = E.q("#ap-list-detail", mount);
    var listDetailTitle= E.q("#ap-list-detail-title",mount);
    var listDetailBody = E.q("#ap-list-detail-body",mount);
    var listDetailActions=E.q("#ap-list-detail-actions",mount);
    var listTable      = E.q("#ap-list-table",  mount);

    var wlTbody        = E.q("#ap-wl-tbody",    mount);
    var wlCount        = E.q("#ap-wl-count",    mount);
    var wlDetailCard   = E.q("#ap-wl-detail",   mount);
    var wlDetailBody   = E.q("#ap-wl-detail-body",mount);
    var wlDetailActions= E.q("#ap-wl-detail-actions",mount);

    // ── Tab switching ──────────────────────────────────────────────────────
    function switchView(v) {
      state.view=v;
      viewDayEl.style.display=  v==="day"?"block":"none";
      viewListEl.style.display= v==="list"?"block":"none";
      viewWlEl.style.display=   v==="waitlist"?"block":"none";
      mount.querySelectorAll(".ap-tab").forEach(function(t){
        t.classList.toggle("active", t.getAttribute("data-view")===v);
      });
      if(v==="day") renderDay();
      if(v==="list") renderListTable();
      if(v==="waitlist") renderWlTable();
    }
    mount.querySelectorAll(".ap-tab").forEach(function(tab){
      tab.addEventListener("click",function(){ switchView(tab.getAttribute("data-view")); });
    });

    // ── Appointment detail panel builder ─────────────────────────────────
    function buildDetailHtml(a) {
      var dr=doctorById(a.doctorId); var cl=clinicById(a.clinicId);
      var total=computeTotal(a);
      return "<div class='ap-detail-grid'>" +
        "<div class='ap-kv half'><div class='k'>Patient</div><div class='v'>"+esc(a.patientName||"—")+"</div></div>" +
        "<div class='ap-kv'><div class='k'>ID Card</div><div class='v'>"+esc(a.patientIdCard||"—")+"</div></div>" +
        "<div class='ap-kv'><div class='k'>Phone</div><div class='v'>"+esc(a.patientPhone||"—")+"</div></div>" +
        "<div class='ap-kv'><div class='k'>Date</div><div class='v'>"+esc(fmtDmy(a.date))+"</div></div>" +
        "<div class='ap-kv'><div class='k'>Time</div><div class='v'>"+esc(a.time||"—")+"</div></div>" +
        "<div class='ap-kv'><div class='k'>Duration</div><div class='v'>"+esc(a.durationMins||"—")+" min</div></div>" +
        "<div class='ap-kv'><div class='k'>Doctor</div><div class='v'>"+esc(dr?dr.name:"—")+"</div></div>" +
        "<div class='ap-kv'><div class='k'>Clinic</div><div class='v'>"+esc(cl?cl.name:"—")+(cl&&cl.locality?" · "+esc(cl.locality):"")+"</div></div>" +
        "<div class='ap-kv fee'><div class='k'>Doctor Fee</div><div class='v'>"+esc(fmtMoney(a.doctorFee||0))+"</div></div>" +
        "<div class='ap-kv fee'><div class='k'>Clinic Fee</div><div class='v'>"+esc(fmtMoney(a.clinicFee||0))+"</div></div>" +
        "<div class='ap-kv fee'><div class='k'>Medicines</div><div class='v'>"+esc(fmtMoney(a.medicinesCost||0))+"</div></div>" +
        "<div class='ap-kv total'><div class='k'>Total Due</div><div class='v'>"+esc(fmtMoney(total))+"</div></div>" +
        (a.medicines?"<div class='ap-kv wide'><div class='k'>Medicines / Items</div><div class='v'><div class='ap-meds'><div class='meds-txt'>"+esc(a.medicines)+"</div></div></div></div>":"")+
        (a.notes?"<div class='ap-kv wide'><div class='k'>Notes</div><div class='v'>"+esc(a.notes)+"</div></div>":"")+
        (a.cancellationReason?"<div class='ap-kv wide'><div class='k'>Cancellation Reason</div><div class='v' style='color:rgba(255,140,160,.9);'>"+esc(a.cancellationReason)+"</div></div>":"")+
        "<div class='ap-kv'><div class='k'>Patient Token</div><div class='v'><span class='ap-token-box'>"+esc(a.token||"—")+"</span></div></div>" +
        "<div class='ap-kv'><div class='k'>Appointment ID</div><div class='v'>"+esc(a.id||"—")+"</div></div>" +
        "<div class='ap-kv'><div class='k'>Created</div><div class='v'>"+esc(fmtTs(a.createdAt||""))+"</div></div>" +
        "</div>";
    }

    function buildDetailActions(a, detailCardEl, detailBodyEl, detailTitleEl, detailActionsEl) {
      if (!detailActionsEl) return;
      detailActionsEl.innerHTML = "";

      function mkBtn(label,cls,onClick){
        var b=document.createElement("button"); b.className="eikon-btn"+(cls?" "+cls:"");
        b.type="button"; b.textContent=label; b.addEventListener("click",onClick); return b;
      }

      detailActionsEl.appendChild(mkBtn("Edit","",(function(apptId){
        return function(){ var fresh=apptById(apptId); openApptModal({appt:fresh},function(){ refresh(); }); };
      })(a.id)));

      detailActionsEl.appendChild(mkBtn("🖨 Print","",function(){
        var fresh=apptById(a.id); printSingleAppt(fresh||a);
      }));

      // Quick status buttons
      if(a.status!=="Confirmed"&&a.status!=="Completed"&&a.status!=="Cancelled"){
        detailActionsEl.appendChild(mkBtn("✓ Confirm","",function(){
          updateAppt(a.id,{status:"Confirmed"}); toast("Updated","Appointment confirmed.","good"); refresh();
        }));
      }
      if(a.status!=="Completed"){
        detailActionsEl.appendChild(mkBtn("✔ Complete","",function(){
          updateAppt(a.id,{status:"Completed"}); toast("Updated","Appointment marked as complete.","good"); refresh();
        }));
      }
      if(a.status!=="Cancelled"){
        detailActionsEl.appendChild(mkBtn("✗ Cancel","",function(){
          modalConfirm("Cancel Appointment","Mark this appointment as cancelled?","Yes, Cancel","Keep").then(function(ok){
            if(!ok) return;
            updateAppt(a.id,{status:"Cancelled"}); toast("Cancelled","Appointment cancelled.","good"); refresh();
          });
        }));
      }
      if(a.status!=="No Show"){
        detailActionsEl.appendChild(mkBtn("No Show","",function(){
          updateAppt(a.id,{status:"No Show"}); toast("Updated","Marked as no show.","good"); refresh();
        }));
      }

      detailActionsEl.appendChild(mkBtn("Delete","",function(){
        modalConfirm("Delete Appointment","Permanently delete this appointment?","Delete","Cancel").then(function(ok){
          if(!ok) return;
          deleteAppt(a.id);
          state.selectedApptId=null;
          if(detailCardEl) detailCardEl.style.display="none";
          toast("Deleted","Appointment deleted.","good");
          refresh();
        });
      }));
    }

    function showApptDetail(a, detailCard, detailTitle, detailBody, detailActions) {
      if(!a||!detailCard) return;
      detailCard.style.display="block";
      if(detailTitle) detailTitle.textContent="Appointment — "+a.id+(a.patientName?" · "+a.patientName:"");
      if(detailBody)  detailBody.innerHTML=buildDetailHtml(a);
      buildDetailActions(a, detailCard, detailBody, detailTitle, detailActions);
    }

    // ── Day View rendering ──────────────────────────────────────────────────
    function renderDay() {
      var ymd=state.currentDate;
      if(dayLabel) dayLabel.textContent=fmtDmy(ymd)+" — "+dayName(ymd);
      if(daySub){ var isToday=(ymd===todayYmd()); daySub.textContent=isToday?"Today":""; }
      if(dayPicker) dayPicker.value=ymd;

      // Show schedules for this day
      var scheds=getSchedulesForDate(ymd);
      var drFilterId=state.filterDoctorId;
      if(drFilterId) scheds=scheds.filter(function(s){return s.doctorId===drFilterId;});

      if(daySchedInfo){
        if(scheds.length){
          daySchedInfo.innerHTML=scheds.map(function(s){
            var dr=doctorById(s.doctorId); var cl=clinicById(s.clinicId);
            var label=s.isOneOff?"One-off":"Recurring "+["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][s.dayOfWeek]+"s";
            return "<div class='ap-sched-bar'>📆 <strong>"+(dr?esc(dr.name):"Unknown")+"</strong> at "+(cl?esc(cl.name):"Unknown")+" · "+esc(s.startTime||"")+"–"+esc(s.endTime||"")+" <span class='ap-repeat-tag'>"+esc(label)+"</span></div>";
          }).join("");
        } else {
          daySchedInfo.innerHTML="<div style='font-size:11px;color:rgba(233,238,247,.35);margin-bottom:6px;font-style:italic;'>No scheduled sessions defined for this day.</div>";
        }
      }

      // Load appointments for this day
      var appts=apptsForDate(ymd);
      if(drFilterId) appts=appts.filter(function(a){return a.doctorId===drFilterId;});

      if(!dayList) return;
      dayList.innerHTML="";

      if(!appts.length){
        var emp=document.createElement("div"); emp.className="ap-day-empty";
        emp.textContent="No appointments for this day."+(scheds.length?" A session is scheduled — add appointments using ＋ New Appointment.":"");
        dayList.appendChild(emp);
      } else {
        appts.forEach(function(a){
          var dr=doctorById(a.doctorId); var cl=clinicById(a.clinicId);
          var slot=document.createElement("div");
          slot.className="ap-day-slot status-"+a.status;
          slot.setAttribute("data-id",String(a.id));
          if(state.selectedApptId&&String(a.id)===String(state.selectedApptId)) slot.style.outline="1px solid rgba(58,160,255,.5)";
          slot.innerHTML=
            "<div><div class='ap-slot-time'>"+esc(a.time||"")+"</div><div class='ap-slot-sub'>"+esc(a.durationMins||30)+" min</div></div>"+
            "<div><div class='ap-slot-patient'>"+esc(a.patientName||"—")+"</div>"+
            "<div class='ap-slot-detail'>"+(dr?esc(dr.name):"")+(cl?" · "+esc(cl.name):"")+"</div></div>"+
            "<div class='ap-slot-right'>"+
            "<span class='ap-status "+statusClass(a.status)+"'>"+esc(a.status||"Scheduled")+"</span>"+
            "<span class='ap-slot-total'>"+esc(fmtMoney(computeTotal(a)))+"</span>"+
            "</div>";
          slot.addEventListener("click",function(){
            state.selectedApptId=String(a.id);
            var fresh=apptById(a.id);
            showApptDetail(fresh||a,dayDetailCard,dayDetailTitle,dayDetailBody,dayDetailActions);
            // Scroll to detail
            if(dayDetailCard) dayDetailCard.scrollIntoView({behavior:"smooth",block:"nearest"});
          });
          dayList.appendChild(slot);
        });
      }

      // Update wl badge
      updateWlBadge();
    }

    // ── List table rendering ───────────────────────────────────────────────
    function renderListTable() {
      var filtered=getFilteredAppts();
      if(listCount) listCount.textContent="Showing "+filtered.length+" record"+(filtered.length===1?"":"s");
      if(!listTbody) return;
      listTbody.innerHTML="";

      if(!filtered.length){
        var tr=document.createElement("tr"); var td=document.createElement("td");
        td.colSpan=10; td.style.textAlign="center"; td.style.padding="24px";
        td.style.color="rgba(233,238,247,.4)"; td.style.fontStyle="italic";
        td.textContent="No appointments match the current filters.";
        tr.appendChild(td); listTbody.appendChild(tr);
      } else {
        filtered.forEach(function(a){
          var dr=doctorById(a.doctorId); var cl=clinicById(a.clinicId);
          var tr=document.createElement("tr");
          tr.setAttribute("data-id",String(a.id));
          if(state.selectedApptId&&String(a.id)===String(state.selectedApptId)) tr.classList.add("ap-row-sel");
          function td(text,cls){
            var c=document.createElement("td"); if(cls) c.className=cls;
            c.textContent=text; return c;
          }
          tr.appendChild(td(a.id||""));
          tr.appendChild(td(fmtDmy(a.date)));
          tr.appendChild(td(a.time||""));
          tr.appendChild(td(a.patientName||""));
          tr.appendChild(td(a.patientIdCard||""));
          tr.appendChild(td(a.patientPhone||""));
          tr.appendChild(td(dr?dr.name:""));
          tr.appendChild(td(cl?cl.name:""));
          var statusTd=document.createElement("td"); statusTd.appendChild(statusBadge(a.status)); tr.appendChild(statusTd);
          tr.appendChild(td(fmtMoney(computeTotal(a))));
          tr.addEventListener("click",function(){
            state.selectedApptId=String(a.id);
            var fresh=apptById(a.id);
            showApptDetail(fresh||a,listDetailCard,listDetailTitle,listDetailBody,listDetailActions);
            listTbody.querySelectorAll("tr").forEach(function(r){r.classList.remove("ap-row-sel");});
            tr.classList.add("ap-row-sel");
            if(listDetailCard) listDetailCard.scrollIntoView({behavior:"smooth",block:"nearest"});
          });
          listTbody.appendChild(tr);
        });
      }
      updateWlBadge();
    }

    // ── Waiting list rendering ─────────────────────────────────────────────
    function renderWlTable() {
      var waiting=getFilteredWaitlist();
      if(wlCount) wlCount.textContent="Showing "+waiting.length+" entr"+(waiting.length===1?"y":"ies");
      if(!wlTbody) return;
      wlTbody.innerHTML="";

      if(!waiting.length){
        var tr=document.createElement("tr"); var td=document.createElement("td");
        td.colSpan=10; td.style.textAlign="center"; td.style.padding="24px";
        td.style.color="rgba(233,238,247,.4)"; td.style.fontStyle="italic";
        td.textContent="No entries in the waiting list.";
        tr.appendChild(td); wlTbody.appendChild(tr);
      } else {
        waiting.forEach(function(w){
          var dr=doctorById(w.doctorId); var cl=clinicById(w.clinicId);
          var tr=document.createElement("tr");
          tr.setAttribute("data-id",String(w.id));
          if(state.selectedWlId&&String(w.id)===String(state.selectedWlId)) tr.classList.add("ap-row-sel");
          function td(text){
            var c=document.createElement("td"); c.textContent=text; return c;
          }
          tr.appendChild(td(w.id||""));
          tr.appendChild(td(w.patientName||""));
          tr.appendChild(td(w.patientIdCard||""));
          tr.appendChild(td(w.patientPhone||""));
          tr.appendChild(td(dr?dr.name:"Any"));
          tr.appendChild(td(cl?cl.name:"Any"));
          tr.appendChild(td(w.preferredDates||""));
          tr.appendChild(td(w.flexibility||""));
          tr.appendChild(td(fmtDmy(w.addedDate||"")));
          var statusTd=document.createElement("td"); statusTd.appendChild(statusBadge(w.status||"Waiting")); tr.appendChild(statusTd);
          tr.addEventListener("click",function(){
            state.selectedWlId=String(w.id);
            showWlDetail(w);
            wlTbody.querySelectorAll("tr").forEach(function(r){r.classList.remove("ap-row-sel");});
            tr.classList.add("ap-row-sel");
            if(wlDetailCard) wlDetailCard.scrollIntoView({behavior:"smooth",block:"nearest"});
          });
          wlTbody.appendChild(tr);
        });
      }
      updateWlBadge();
    }

    function showWlDetail(w) {
      if(!wlDetailCard) return;
      var dr=doctorById(w.doctorId); var cl=clinicById(w.clinicId);
      wlDetailCard.style.display="block";
      var titleEl=E.q("#ap-wl-detail-title",mount);
      if(titleEl) titleEl.textContent="Waiting List — "+w.id+" · "+w.patientName;
      if(wlDetailBody){
        wlDetailBody.innerHTML=
          "<div class='ap-detail-grid'>" +
          "<div class='ap-kv half'><div class='k'>Patient</div><div class='v'>"+esc(w.patientName||"—")+"</div></div>" +
          "<div class='ap-kv'><div class='k'>ID Card</div><div class='v'>"+esc(w.patientIdCard||"—")+"</div></div>" +
          "<div class='ap-kv'><div class='k'>Phone</div><div class='v'>"+esc(w.patientPhone||"—")+"</div></div>" +
          "<div class='ap-kv'><div class='k'>Doctor Pref.</div><div class='v'>"+esc(dr?dr.name:"Any")+"</div></div>" +
          "<div class='ap-kv'><div class='k'>Clinic Pref.</div><div class='v'>"+esc(cl?cl.name:"Any")+"</div></div>" +
          "<div class='ap-kv'><div class='k'>Flexibility</div><div class='v'>"+esc(w.flexibility||"—")+"</div></div>" +
          "<div class='ap-kv wide'><div class='k'>Preferred Dates / Days</div><div class='v'>"+esc(w.preferredDates||"—")+"</div></div>" +
          (w.notes?"<div class='ap-kv wide'><div class='k'>Notes</div><div class='v'>"+esc(w.notes)+"</div></div>":"")+
          "<div class='ap-kv'><div class='k'>Added</div><div class='v'>"+esc(fmtDmy(w.addedDate||""))+"</div></div>" +
          "<div class='ap-kv'><div class='k'>Status</div><div class='v'>"+esc(w.status||"Waiting")+"</div></div>" +
          (w.promotedTo?"<div class='ap-kv'><div class='k'>Promoted to</div><div class='v'>"+esc(w.promotedTo)+"</div></div>":"")+
          "</div>";
      }
      if(wlDetailActions){
        wlDetailActions.innerHTML="";
        function mkBtn(label,onClick){
          var b=document.createElement("button"); b.className="eikon-btn"; b.type="button"; b.textContent=label;
          b.addEventListener("click",onClick); return b;
        }
        wlDetailActions.appendChild(mkBtn("Edit",function(){
          var fresh=loadWaitlist().filter(function(x){return String(x.id)===String(w.id);})[0];
          openWaitlistModal({entry:fresh||w},function(){refresh();});
        }));
        if(w.status==="Waiting"){
          wlDetailActions.appendChild(mkBtn("📅 Book Appointment",function(){
            // Promote: open appt modal pre-filled from waiting list
            E.modal.hide();
            openApptModal({date:todayYmd(), fromWaitlist:w}, function(){
              // Mark as promoted
              updateWaitlistEntry(w.id,{status:"Promoted"});
              toast("Promoted","Patient moved from waiting list to appointments.","good");
              refresh();
            });
          }));
          wlDetailActions.appendChild(mkBtn("✗ Cancel",function(){
            modalConfirm("Cancel Entry","Remove this patient from the waiting list?","Yes, Cancel","Keep").then(function(ok){
              if(!ok) return;
              updateWaitlistEntry(w.id,{status:"Cancelled"});
              toast("Cancelled","Waiting list entry cancelled.","good");
              refresh();
            });
          }));
        }
        wlDetailActions.appendChild(mkBtn("Delete",function(){
          modalConfirm("Delete Entry","Permanently delete this waiting list entry?","Delete","Cancel").then(function(ok){
            if(!ok) return;
            deleteWaitlistEntry(w.id);
            state.selectedWlId=null;
            wlDetailCard.style.display="none";
            toast("Deleted","Entry deleted.","good");
            refresh();
          });
        }));
      }
    }

    // ── WL badge ──────────────────────────────────────────────────────────
    function updateWlBadge() {
      var active=loadWaitlist().filter(function(w){return w.status==="Waiting";}).length;
      if(wlBadge) wlBadge.textContent=active;
    }

    // ── Global refresh ────────────────────────────────────────────────────
    function refresh() {
      if(state.view==="day") renderDay();
      if(state.view==="list") renderListTable();
      if(state.view==="waitlist") renderWlTable();
      updateWlBadge();
    }
    state.refresh = refresh;

    // ── Day navigation ────────────────────────────────────────────────────
    var dayPrevBtn  = E.q("#ap-day-prev",  mount);
    var dayNextBtn  = E.q("#ap-day-next",  mount);
    var dayTodayBtn = E.q("#ap-day-today", mount);
    var dayPrintBtn = E.q("#ap-day-print", mount);

    if(dayPrevBtn) dayPrevBtn.addEventListener("click",function(){
      state.currentDate=ymdAddDays(state.currentDate,-1);
      state.selectedApptId=null;
      if(dayDetailCard) dayDetailCard.style.display="none";
      renderDay();
    });
    if(dayNextBtn) dayNextBtn.addEventListener("click",function(){
      state.currentDate=ymdAddDays(state.currentDate,1);
      state.selectedApptId=null;
      if(dayDetailCard) dayDetailCard.style.display="none";
      renderDay();
    });
    if(dayTodayBtn) dayTodayBtn.addEventListener("click",function(){
      state.currentDate=todayYmd();
      state.selectedApptId=null;
      if(dayDetailCard) dayDetailCard.style.display="none";
      renderDay();
    });
    if(dayPicker) dayPicker.addEventListener("change",function(){
      if(isYmd(dayPicker.value)){ state.currentDate=dayPicker.value; state.selectedApptId=null; if(dayDetailCard) dayDetailCard.style.display="none"; renderDay(); }
    });
    if(dayDrFilter) dayDrFilter.addEventListener("change",function(){
      state.filterDoctorId=dayDrFilter.value; state.selectedApptId=null; if(dayDetailCard) dayDetailCard.style.display="none"; renderDay();
    });
    if(dayPrintBtn) dayPrintBtn.addEventListener("click",function(){
      var appts=apptsForDate(state.currentDate);
      if(state.filterDoctorId) appts=appts.filter(function(a){return a.doctorId===state.filterDoctorId;});
      printApptList(appts,"Appointments — "+fmtDmy(state.currentDate)+" ("+dayName(state.currentDate)+")","Date: "+fmtDmy(state.currentDate));
    });

    // ── List filters ──────────────────────────────────────────────────────
    function onListFilter(){renderListTable();}
    var lSearch=E.q("#ap-list-search",mount); var lDr=E.q("#ap-list-dr",mount);
    var lCl=E.q("#ap-list-cl",mount); var lSt=E.q("#ap-list-status",mount);
    var lFrom=E.q("#ap-list-from",mount); var lTo=E.q("#ap-list-to",mount);
    var lClear=E.q("#ap-list-clear",mount); var lPrint=E.q("#ap-list-print",mount);
    if(lSearch) lSearch.addEventListener("input",function(){state.listQuery=lSearch.value;state.selectedApptId=null;if(listDetailCard)listDetailCard.style.display="none";onListFilter();});
    if(lDr)    lDr.addEventListener("change",function(){state.filterDoctorId=lDr.value;onListFilter();});
    if(lCl)    lCl.addEventListener("change",function(){state.filterClinicId=lCl.value;onListFilter();});
    if(lSt)    lSt.addEventListener("change",function(){state.filterStatus=lSt.value;onListFilter();});
    if(lFrom)  lFrom.addEventListener("change",function(){state.filterDateFrom=lFrom.value;onListFilter();});
    if(lTo)    lTo.addEventListener("change",function(){state.filterDateTo=lTo.value;onListFilter();});
    if(lClear) lClear.addEventListener("click",function(){
      state.listQuery=""; state.filterDoctorId=""; state.filterClinicId=""; state.filterStatus="";
      state.filterDateFrom=""; state.filterDateTo=""; state.selectedApptId=null;
      if(listDetailCard) listDetailCard.style.display="none";
      if(lSearch) lSearch.value=""; if(lDr) lDr.value=""; if(lCl) lCl.value="";
      if(lSt) lSt.value=""; if(lFrom) lFrom.value=""; if(lTo) lTo.value="";
      renderListTable();
    });
    if(lPrint) lPrint.addEventListener("click",function(){
      var filtered=getFilteredAppts();
      printApptList(filtered,"Appointments List");
    });

    // Sortable column headers — list
    if(listTable){
      listTable.querySelector("thead").addEventListener("click",function(ev){
        var el=ev.target.closest("[data-key]");
        if(!el) return;
        var key=el.getAttribute("data-key");
        if(state.listSort.key===key) state.listSort.dir=(state.listSort.dir==="asc"?"desc":"asc");
        else {state.listSort.key=key; state.listSort.dir="asc";}
        state.selectedApptId=null;
        if(listDetailCard) listDetailCard.style.display="none";
        renderListTable();
      });
    }

    // ── Waiting list interactions ─────────────────────────────────────────
    var wlSearch=E.q("#ap-wl-search",mount); var wlPrint=E.q("#ap-wl-print",mount);
    var wlTable=E.q("#ap-wl-table",mount);
    if(wlSearch) wlSearch.addEventListener("input",function(){state.wlQuery=wlSearch.value;state.selectedWlId=null;if(wlDetailCard)wlDetailCard.style.display="none";renderWlTable();});
    if(wlPrint) wlPrint.addEventListener("click",function(){printWaitlist(getFilteredWaitlist());});
    if(wlTable){
      wlTable.querySelector("thead").addEventListener("click",function(ev){
        var el=ev.target.closest("[data-key]");
        if(!el) return;
        var key=el.getAttribute("data-key");
        if(state.wlSort.key===key) state.wlSort.dir=(state.wlSort.dir==="asc"?"desc":"asc");
        else {state.wlSort.key=key; state.wlSort.dir="asc";}
        state.selectedWlId=null;
        if(wlDetailCard) wlDetailCard.style.display="none";
        renderWlTable();
      });
    }

    // ── Header buttons ────────────────────────────────────────────────────
    var btnNewAppt  = E.q("#ap-new-appt",     mount);
    var btnNewWl    = E.q("#ap-btn-waitlist",  mount);
    var settingsBtn = E.q("#ap-settings-btn",  mount);
    var settingsMenu= E.q("#ap-settings-menu", mount);

    if(btnNewAppt) btnNewAppt.addEventListener("click",function(){
      openApptModal({date:state.currentDate},function(){refresh();});
    });
    if(btnNewWl) btnNewWl.addEventListener("click",function(){
      openWaitlistModal({},function(){refresh();});
    });

    // Settings dropdown toggle
    if(settingsBtn&&settingsMenu){
      settingsBtn.addEventListener("click",function(ev){
        ev.stopPropagation();
        settingsMenu.style.display=(settingsMenu.style.display==="none"?"block":"none");
      });
      document.addEventListener("click",function(ev){
        if(settingsMenu&&!settingsMenu.contains(ev.target)&&ev.target!==settingsBtn){
          settingsMenu.style.display="none";
        }
      },{capture:false});
    }
    var btnDrs=E.q("#ap-manage-doctors",mount); var btnCls=E.q("#ap-manage-clinics",mount); var btnSch=E.q("#ap-manage-scheds",mount);
    if(btnDrs) btnDrs.addEventListener("click",function(){if(settingsMenu)settingsMenu.style.display="none"; openDoctorsModal(function(){refresh();});});
    if(btnCls) btnCls.addEventListener("click",function(){if(settingsMenu)settingsMenu.style.display="none"; openClinicsModal(function(){refresh();});});
    if(btnSch) btnSch.addEventListener("click",function(){if(settingsMenu)settingsMenu.style.display="none"; openSchedulesModal(function(){refresh();});});

    // ── Initial render ────────────────────────────────────────────────────
    renderDay();
    updateWlBadge();

    // Initial reminder if no doctors/clinics set up
    if(!loadDoctors().length && !loadClinics().length){
      setTimeout(function(){
        toast("Setup needed","Add doctors and clinics via the ⚙ Settings menu to get started.",""  ,5000);
      },800);
    }
  }

  // ── Register module ───────────────────────────────────────────────────────
  E.registerModule({
    id:    "appointments",
    title: "Appointments",
    order: 215,
    icon:  "📅",
    render: render
  });

})();
