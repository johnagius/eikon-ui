/* ============================================================
   EIKON — Shift Management Module  (modules.shifts.js)
   Drop alongside other modules.*.js files.
   Add to index.html BEFORE main.js:
     .then(function(){ return loadScript(withParams("./modules.shifts.js")); })
   ============================================================ */
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.shifts.js)");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c];
    });
  }

  /* ── Malta Employment Law Reference (editable, auto-year) ───── */
  // Defaults can be overridden via Settings → Malta Employment Law Reference.
  // Overrides are stored under: S.settings.maltaLaw
  var MALTA_DEFAULT = {
    annualLeaveHours: { 2023:208, 2024:240, 2025:224, 2026:216, 2027:216 },
    sickLeavePaidHours:     80,   // 10 days × 8h, employer pays
    sickLeaveHalfPayHours:  80,   // additional 10 days at half pay
    urgentFamilyLeaveHours: 32,   // updated Jan 2025 (was 15h)
    maxWeeklyHours:         48,   // EU Working Time Directive
    fullTimeWeeklyHours:    40,
    yearData: {
      2025: { publicHolidays: 14, colaWeekly: 0,    minWageWeekly: 0,      miscarriageLeaveDays: 0 },
      2026: { publicHolidays: 14, colaWeekly: 4.66, minWageWeekly: 226.44, miscarriageLeaveDays: 7 }
    }
  };

  var MALTA = JSON.parse(JSON.stringify(MALTA_DEFAULT));

  function lastKnownYear(map, yr) {
    if (!map) return yr;
    var keys = Object.keys(map).map(function(k){return parseInt(k,10);}).filter(function(n){return !isNaN(n);}).sort(function(a,b){return a-b;});
    if (!keys.length) return yr;
    var best = keys[0];
    for (var i=0;i<keys.length;i++){ if(keys[i] <= yr) best = keys[i]; }
    return best;
  }

  function setMaltaFromSettings() {
    try {
      var cfg = S && S.settings && S.settings.maltaLaw;
      if (!cfg || typeof cfg !== "object") { MALTA = JSON.parse(JSON.stringify(MALTA_DEFAULT)); return; }

      // Start from defaults then overlay user config.
      MALTA = JSON.parse(JSON.stringify(MALTA_DEFAULT));
      if (cfg.annualLeaveHours && typeof cfg.annualLeaveHours === "object") {
        Object.keys(cfg.annualLeaveHours).forEach(function(y){ MALTA.annualLeaveHours[y] = cfg.annualLeaveHours[y]; });
      }
      ["sickLeavePaidHours","sickLeaveHalfPayHours","urgentFamilyLeaveHours","maxWeeklyHours","fullTimeWeeklyHours"].forEach(function(k){
        if (cfg[k] != null && cfg[k] !== "") MALTA[k] = cfg[k];
      });
      if (cfg.yearData && typeof cfg.yearData === "object") {
        MALTA.yearData = MALTA.yearData || {};
        Object.keys(cfg.yearData).forEach(function(y){
          MALTA.yearData[y] = Object.assign({}, MALTA.yearData[y] || {}, cfg.yearData[y] || {});
        });
      }
    } catch(e) { MALTA = JSON.parse(JSON.stringify(MALTA_DEFAULT)); }
  }

  function maltaYear(yr) {
    var y = String(yr);
    var yd = MALTA.yearData || {};
    if (yd[y]) return yd[y];
    var lk = lastKnownYear(yd, yr);
    return yd[String(lk)] || {};
  }

  function calcEntitlement(emp) {
    var yr = new Date().getFullYear();
    var lk = lastKnownYear(MALTA.annualLeaveHours, yr);
    var base = MALTA.annualLeaveHours[yr] || MALTA.annualLeaveHours[lk] || 216;
    var ratio = emp.employment_type === "fulltime" ? 1 :
                Math.min((parseFloat(emp.contracted_hours) || 20) / (parseFloat(MALTA.fullTimeWeeklyHours)||40), 1);
    return {
      annual:       Math.round(base * ratio),
      sick:         Math.round((parseFloat(MALTA.sickLeavePaidHours)||80) * ratio),
      urgentFamily: Math.round((parseFloat(MALTA.urgentFamilyLeaveHours)||32) * ratio)
    };
  }

  /* ── State ─────────────────────────────────────────────────── */
  var S = {
    tab: "calendar",
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    staff:        [],
    shifts:       [],
    leaves:       [],
    openingHours: { "default": { open:"07:30", close:"19:30", closed:false }, openSaturday:true, openSunday:false, weekends:false, overrides:{} },
    settings:     { pharmacistRequired:true, minPharmacists:1, maltaLaw:null },
    _ls: "eikon_shifts_v2"
  };

  /* ── localStorage helpers (demo/fallback) ───────────────────── */
  function lsGet() {
    try { var r = localStorage.getItem(S._ls); return r ? JSON.parse(r) : {}; } catch(e){ return {}; }
  }
  function lsPut(d) { try { localStorage.setItem(S._ls, JSON.stringify(d)); } catch(e){} }
  function lsSync() {
    var d = lsGet();
    d.staff = S.staff; d.shifts = S.shifts; d.leaves = S.leaves;
    d.openingHours = S.openingHours; d.settings = S.settings;
    lsPut(d);
  }
  function lsNextId() {
    var d = lsGet(); d._id = (d._id||0)+1; lsPut(d); return d._id;
  }

  async function loadAll() {
    try {
      var [a,b,c,d,e] = await Promise.all([
        E.apiFetch("/shifts/staff?include_inactive=1",       {method:"GET"}),
        E.apiFetch("/shifts/assignments?year="+S.year+"&month="+(S.month+1), {method:"GET"}),
        E.apiFetch("/shifts/leaves?year="+S.year,            {method:"GET"}),
        E.apiFetch("/shifts/opening-hours",                   {method:"GET"}),
        E.apiFetch("/shifts/settings",                        {method:"GET"})
      ]);
      S.staff        = a.staff        || [];
      S.shifts       = b.shifts       || [];
      S.leaves       = c.leaves       || [];
      S.openingHours = d.hours        || S.openingHours;
      S.settings     = e.settings     || S.settings;
      normalizeOpeningHours();
      setMaltaFromSettings();
    } catch(err) {
      E.warn && E.warn("[shifts] API unavailable, using localStorage:", err && err.message);
      var ls = lsGet();
      S.staff        = ls.staff        || S.staff;
      S.shifts       = ls.shifts       || S.shifts;
      S.leaves       = ls.leaves       || S.leaves;
      S.openingHours = ls.openingHours || S.openingHours;
      S.settings     = ls.settings     || S.settings;
      normalizeOpeningHours();
      setMaltaFromSettings();
    }
  }

  function normalizeOpeningHours() {
    var oh = S.openingHours || {};
    if (!oh["default"]) oh["default"] = { open:"07:30", close:"19:30", closed:false };
    if (!oh.overrides) oh.overrides = {};
    if (typeof oh.weekends === "boolean") {
      if (oh.openSaturday == null) oh.openSaturday = oh.weekends;
      if (oh.openSunday == null) oh.openSunday = oh.weekends;
    }
    if (oh.openSaturday == null) oh.openSaturday = true;
    if (oh.openSunday == null) oh.openSunday = false;
    // Keep legacy field for backwards compatibility
    if (oh.weekends == null) oh.weekends = (oh.openSaturday && oh.openSunday);
    S.openingHours = oh;
  }

  async function loadMonth() {
    try {
      var r = await E.apiFetch("/shifts/assignments?year="+S.year+"&month="+(S.month+1), {method:"GET"});
      S.shifts = r.shifts || [];
    } catch(e) { /* use cached */ }
  }

  function apiOp(path, opts, onOk, merge) {
    var o = opts || {};
    try {
      var method = String(o.method || "GET").toUpperCase();
      o.headers = Object.assign({}, (o.headers || {}));

      // Force debug header for write operations to shifts endpoints (worker logs)
      if (method !== "GET" && String(path || "").indexOf("/shifts/") === 0) {
        if (!o.headers["X-Eikon-Debug"] && !o.headers["x-eikon-debug"]) o.headers["X-Eikon-Debug"] = "1";
      }

      console.groupCollapsed("[shifts][apiOp] " + method + " " + path);
      try { console.log("opts:", o); } catch (e1) {}
      console.groupEnd();
    } catch (e0) {}

    E.apiFetch(path, o)
      .then(function(r){
        try { console.log("[shifts][apiOp] OK", path, r); } catch (e2) {}
        merge && merge(r);
        lsSync();
        onOk && onOk(r);
      })
      .catch(function(err){
        try {
          console.error("[shifts][apiOp] ERR", path, err);
          if (err && err.bodyJson) console.error("[shifts][apiOp] bodyJson", err.bodyJson);
          if (err && err.bodyText) console.error("[shifts][apiOp] bodyText", err.bodyText);
        } catch (e3) {}
        // Only toast on writes (avoid noisy GET failures)
        try {
          var m = String((o && o.method) || "GET").toUpperCase();
          if (m !== "GET") toast("API error: " + (err && err.message ? err.message : "unknown"), "error");
        } catch (e4) {}
        merge && merge({ ok:false, error: (err && err.message) ? err.message : "error" });
        lsSync();
        onOk && onOk({ ok:false, error: (err && err.message) ? err.message : "error" });
      });
  }

  /* ── Date/time helpers ──────────────────────────────────────── */
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var DSHORT  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function ymd(y,m,d) { return y+"-"+pad(m+1)+"-"+pad(d); }
  function pad(n) { return String(n).padStart(2,"0"); }
  function dim(y,m) { return new Date(y,m+1,0).getDate(); }
  function dow(y,m,d) { return new Date(y,m,d).getDay(); }
  function t2m(t) { if(!t)return 0; var p=t.split(":"); return +p[0]*60+(+p[1]||0); }
  function m2t(m) { return pad(Math.floor(m/60))+":"+pad(m%60); }
  function addD(s,n) {
    var dt = new Date(s); dt.setDate(dt.getDate()+n);
    return dt.getFullYear()+"-"+pad(dt.getMonth()+1)+"-"+pad(dt.getDate());
  }
  function wdCount(s,e) {
    var n=0, dt=new Date(s), end=new Date(e);
    while(dt<=end){ var wd=dt.getDay(); if(wd!==0&&wd!==6)n++; dt.setDate(dt.getDate()+1); }
    return n;
  }

  var PH = [
    "2026-01-01","2026-02-10","2026-03-19","2026-03-31",
    "2026-05-01","2026-06-07","2026-06-29","2026-08-15",
    "2026-09-08","2026-09-21","2026-12-08","2026-12-13","2026-12-25",
    "2025-01-01","2025-02-10","2025-03-19","2025-04-18",
    "2025-05-01","2025-06-07","2025-06-29","2025-08-15",
    "2025-09-08","2025-09-21","2025-12-08","2025-12-13","2025-12-25"
  ];
  function isPH(d) { return PH.indexOf(d)>=0; }

  /* ── Staff helpers ──────────────────────────────────────────── */
  var DESIG = {
    pharmacist:"Pharmacist", locum:"Locum Pharmacist", assistant:"Pharmacy Assistant",
    dispenser:"Dispenser", cashier:"Cashier", manager:"Manager", cleaner:"Cleaner", other:"Other"
  };
  var DCOLOR = {
    pharmacist:"#5aa2ff", locum:"#a78bfa", assistant:"#43d17a",
    dispenser:"#fb923c", cashier:"#f59e0b", manager:"#38bdf8", cleaner:"#94a3b8", other:"#64748b"
  };
  function dc(d){ return DCOLOR[d]||"#64748b"; }
  function dl(d){ return DESIG[d]||d||"Other"; }

  function emp(id) { return S.staff.find(function(s){ return s.id===id; })||null; }
  function actStaff() { return S.staff.filter(function(s){ return s.is_active!==0; }); }
  function pharmStaff() { return actStaff().filter(function(s){ return s.designation==="pharmacist"||s.designation==="locum"; }); }

  /* ── Opening hours ──────────────────────────────────────────── */
  function ohFor(ds) {
    var ov = (S.openingHours.overrides||{})[ds];
    if (ov) return ov;

    // normalize (in case settings were loaded after module init)
    if (!S.openingHours || !S.openingHours["default"]) normalizeOpeningHours();

    var d = new Date(ds).getDay(); // 0 Sun .. 6 Sat
    var satOpen = (S.openingHours.openSaturday != null) ? !!S.openingHours.openSaturday : !!S.openingHours.weekends;
    var sunOpen = (S.openingHours.openSunday   != null) ? !!S.openingHours.openSunday   : !!S.openingHours.weekends;

    if (d === 6 && !satOpen) return { open: (S.openingHours["default"]&&S.openingHours["default"].open)||"07:30", close:(S.openingHours["default"]&&S.openingHours["default"].close)||"19:30", closed:true };
    if (d === 0 && !sunOpen) return { open: (S.openingHours["default"]&&S.openingHours["default"].open)||"07:30", close:(S.openingHours["default"]&&S.openingHours["default"].close)||"19:30", closed:true };

    return S.openingHours["default"] || {open:"07:30",close:"19:30",closed:false};
  }

  /* ── Coverage check ─────────────────────────────────────────── */
  function checkCov(ds) {
    var oh = ohFor(ds);
    if (oh.closed) return { ok:true, issues:[], gaps:[], open:oh.open, close:oh.close };

    var min = parseInt(S.settings.minPharmacists, 10) || 1;
    var need = !!S.settings.pharmacistRequired;

    // Build on-leave lookup for the day
    var onLeave = {};
    S.leaves.filter(function(l){ return l.status==="approved" && l.start_date<=ds && l.end_date>=ds; })
            .forEach(function(l){ onLeave[l.staff_id] = true; });

    // Collect pharmacist/locum intervals (clamped to opening hours)
    var openM = t2m(oh.open || "07:30");
    var closeM = t2m(oh.close || "19:30");
    if (closeM <= openM) return { ok:true, issues:[], gaps:[], open:oh.open, close:oh.close };

    var events = [];
    var dayShifts = S.shifts.filter(function(s){ return s.shift_date === ds; });

    dayShifts.forEach(function(s){
      if (onLeave[s.staff_id]) return;
      var e = emp(s.staff_id);
      var isPh = (e && (e.designation==="pharmacist" || e.designation==="locum")) || (s.role_override === "pharmacist");
      if (!isPh) return;
      var st = Math.max(openM, t2m(s.start_time));
      var et = Math.min(closeM, t2m(s.end_time));
      if (et <= st) return;
      events.push({t:st, d:+1});
      events.push({t:et, d:-1});
    });

    // If nothing scheduled, whole day is a gap when coverage required
    if (!events.length) {
      var gaps0 = need ? [{start:openM, end:closeM, count:0}] : [];
      var issues0 = need ? ["No pharmacist coverage: " + m2t(openM) + "–" + m2t(closeM)] : [];
      return { ok: issues0.length===0, issues: issues0, gaps: gaps0, open:oh.open, close:oh.close };
    }

    // Sweep line to compute gaps with count < min
    events.sort(function(a,b){ return a.t - b.t || b.d - a.d; }); // starts before ends at same time
    var gaps = [];
    var count = 0;
    var cur = openM;

    // Apply any events that start at opening time
    var i=0;
    while(i<events.length && events[i].t <= openM){ count += events[i].d; i++; }

    while (cur < closeM) {
      var nextT = (i < events.length) ? Math.min(events[i].t, closeM) : closeM;
      if (nextT > cur) {
        if (need && count < min) gaps.push({ start: cur, end: nextT, count: count });
        cur = nextT;
      }
      while (i < events.length && events[i].t === cur) { count += events[i].d; i++; }
      if (i >= events.length && cur >= closeM) break;
      if (i >= events.length && cur < closeM) {
        // tail segment
        if (need && count < min) gaps.push({ start: cur, end: closeM, count: count });
        break;
      }
    }

    var issues = [];
    if (need && gaps.length) {
      gaps.slice(0,3).forEach(function(g){
        issues.push("Pharmacist gap: " + m2t(g.start) + "–" + m2t(g.end));
      });
      if (gaps.length > 3) issues.push("+" + (gaps.length-3) + " more gap(s)");
    }

    return { ok: issues.length===0, issues: issues, gaps:gaps, open:oh.open, close:oh.close, min:min };
  }

  /* ── Leave balance ──────────────────────────────────────────── */
  function bal(id) {
    var e=emp(id); if(!e) return null;
    var ent=calcEntitlement(e); var yr=new Date().getFullYear();
    var usedA=0, usedS=0;
    S.leaves.filter(function(l){ return l.staff_id===id&&(l.status==="approved"||l.status==="pending"); })
            .forEach(function(l){
              var y=parseInt((l.start_date||"").split("-")[0]);
              if(y!==yr) return;
              if(l.leave_type==="sick") usedS+=+l.hours_requested||0;
              else usedA+=+l.hours_requested||0;
            });
    return {
      annualEnt: ent.annual, annualUsed: usedA, annualLeft: Math.max(0,ent.annual-usedA),
      sickEnt:   ent.sick,   sickUsed:   usedS, sickLeft:   Math.max(0,ent.sick-usedS),
      ufEnt:     ent.urgentFamily
    };
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  var _tt=null;
  function toast(msg,type){
    var el=document.getElementById("sh-toast"); if(el)el.remove();
    var t=document.createElement("div"); t.id="sh-toast";
    t.style.cssText="position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 18px;border-radius:12px;font-weight:700;font-size:13px;max-width:340px;pointer-events:none;";
    if(type==="error"){t.style.background="rgba(255,90,122,.18)";t.style.border="1px solid rgba(255,90,122,.5)";t.style.color="#ff5a7a";}
    else{t.style.background="rgba(67,209,122,.15)";t.style.border="1px solid rgba(67,209,122,.4)";t.style.color="#43d17a";}
    t.textContent=msg; document.body.appendChild(t);
    if(_tt)clearTimeout(_tt);
    _tt=setTimeout(function(){if(t.parentNode){t.style.opacity="0";setTimeout(function(){t.remove();},300);}},3500);
  }

  /* ══════════════════════════════════════════════════════════════
     VIEW: STAFF
  ══════════════════════════════════════════════════════════════ */
  function vStaff(m) {
    m.innerHTML =
      '<div class="eikon-card">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
      '<div style="font-weight:900;font-size:15px;">👥 Employee Roster</div>' +
      '<button class="eikon-btn primary" id="sh-add-emp">+ Add Employee</button></div>' +
      '<div class="eikon-table-wrap"><table class="eikon-table"><thead><tr>' +
      '<th>Name</th><th>Role</th><th>Type</th><th>Hrs/wk</th><th>Contact</th>' +
      '<th>Annual Leave</th><th>Sick Left</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody id="sh-etbody"></tbody></table></div></div>';

    E.q("#sh-add-emp",m).onclick=function(){ empModal(null,m); };
    renderEmpRows(m);
  }

  function renderEmpRows(m) {
    var tb = E.q("#sh-etbody",m); if(!tb) return;
    tb.innerHTML="";
    var all = S.staff.slice().sort(function(a,b){ return (a.full_name||"").localeCompare(b.full_name||""); });
    if(!all.length){ tb.innerHTML='<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;">No staff yet. Click "+ Add Employee".</td></tr>'; return; }
    all.forEach(function(e){
      var b=bal(e.id);
      var col=dc(e.designation);
      var tr=document.createElement("tr"); tr.style.opacity=e.is_active===0?"0.4":"1";
      tr.innerHTML=
        '<td><b>'+esc(e.full_name||"")+'</b></td>'+
        '<td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+col+';margin-right:5px;"></span>'+esc(dl(e.designation))+'</td>'+
        '<td><span class="eikon-pill" style="font-size:11px;">'+(e.employment_type==="fulltime"?"Full-Time":"Part-Time")+'</span></td>'+
        '<td>'+(e.contracted_hours||"—")+'h</td>'+
        '<td style="font-size:12px;color:var(--muted);">'+esc(e.email||"")+(e.phone?"<br>"+esc(e.phone):"")+'</td>'+
        '<td>'+(b?'<span style="color:'+(b.annualLeft<24?"var(--danger)":"var(--ok)")+'">'+b.annualLeft+'h / '+b.annualEnt+'h</span>':"—")+'</td>'+
        '<td>'+(b?b.sickLeft+'h':"—")+'</td>'+
        '<td><span class="eikon-pill" style="font-size:11px;'+(e.is_active===0?"color:var(--danger);border-color:rgba(255,90,122,.4);":"color:var(--ok);border-color:rgba(67,209,122,.4);")+'">'+(e.is_active===0?"Inactive":"Active")+'</span></td>'+
        '<td></td>';
      var act=tr.querySelectorAll("td")[8];
      var eb=document.createElement("button"); eb.className="eikon-btn"; eb.textContent="Edit";
      eb.onclick=function(){ empModal(e,m); };
      var tb2=document.createElement("button"); tb2.className="eikon-btn "+(e.is_active===0?"primary":"danger"); tb2.style.marginLeft="6px";
      tb2.textContent=e.is_active===0?"Activate":"Deactivate";
      tb2.onclick=function(){ toggleActive(e,function(){renderEmpRows(m);}); };
      act.appendChild(eb); act.appendChild(tb2); tb.appendChild(tr);
    });
  }

  function empModal(e, mountRef) {
    var edit = !!e;
    setMaltaFromSettings();

    var yrNow = new Date().getFullYear();
    var lk = lastKnownYear(MALTA.annualLeaveHours, yrNow);
    var alFT = MALTA.annualLeaveHours[yrNow] || MALTA.annualLeaveHours[lk] || 216;

    var patState = getPatternState(e);
    try { console.log("[shifts][patterns] loaded staffId=", (e&&e.id), "patterns=", (patState.patterns||[]).length, "provisionalId=", patState.provisionalId); } catch(e0) {}

    var body =
      '<div class="eikon-row">'+
      '<div class="eikon-field" style="flex:1;min-width:200px;"><div class="eikon-label">Full Name</div>'+
      '<input class="eikon-input" id="se-name" type="text" value="'+esc(e&&e.full_name||"")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Designation</div>'+
      '<select class="eikon-select" id="se-desig">'+
      Object.keys(DESIG).map(function(k){ return '<option value="'+k+'"'+(e&&e.designation===k?" selected":"")+'>'+DESIG[k]+'</option>'; }).join("")+
      '</select></div></div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
      '<div class="eikon-field"><div class="eikon-label">Employment Type</div>'+
      '<select class="eikon-select" id="se-type">'+
      '<option value="fulltime"'+(e&&e.employment_type==="fulltime"?" selected":"")+'>Full-Time ('+(MALTA.fullTimeWeeklyHours||40)+'h/wk — Malta '+yrNow+': '+alFT+'h leave)</option>'+
      '<option value="parttime"'+(e&&e.employment_type==="parttime"?" selected":"")+'>Part-Time (pro-rata)</option>'+
      '</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Contracted h/wk</div>'+
      '<input class="eikon-input" id="se-hrs" type="number" min="1" max="'+(MALTA.maxWeeklyHours||48)+'" value="'+(e&&e.contracted_hours||40)+'" style="min-width:80px;"/></div></div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
      '<div class="eikon-field" style="flex:1;"><div class="eikon-label">Email</div>'+
      '<input class="eikon-input" id="se-email" type="email" value="'+esc(e&&e.email||"")+'"/></div>'+
      '<div class="eikon-field" style="flex:1;"><div class="eikon-label">Phone</div>'+
      '<input class="eikon-input" id="se-phone" type="tel" value="'+esc(e&&e.phone||"")+'"/></div></div>'+
      '<div class="eikon-field" style="margin-top:10px;"><div class="eikon-label">Registration No. (Pharmacists)</div>'+
      '<input class="eikon-input" id="se-reg" type="text" value="'+esc(e&&e.registration_number||"")+'" placeholder="e.g. PH-1234"/></div>'+
      '<div style="margin-top:12px;padding:10px;background:rgba(90,162,255,.07);border:1px solid rgba(90,162,255,.2);border-radius:10px;font-size:12px;color:var(--muted);">'+
      '📋 <b>Malta '+yrNow+':</b> FT='+alFT+'h annual leave. PT=pro-rata. Sick='+(MALTA.sickLeavePaidHours||80)+'h paid + '+(MALTA.sickLeaveHalfPayHours||80)+'h ½ pay. Urgent family='+(MALTA.urgentFamilyLeaveHours||32)+'h/yr. Max '+(MALTA.maxWeeklyHours||48)+'h/wk.</div>'+

      '<div style="margin-top:14px;padding:12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:12px;">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">'+
      '<div style="font-weight:900;">🗓 Weekly Patterns</div>'+
      '<button class="eikon-btn primary" id="se-addpat" style="font-size:12px;padding:6px 10px;">+ New Pattern</button>'+
      '</div>'+
      '<div style="margin-top:8px;font-size:11px;color:var(--muted);">Create weekly templates and apply them across date ranges, or apply a week directly from the calendar.</div>'+
      (edit ? '' : '<div style="margin-top:8px;font-size:11px;color:var(--muted);">Save the employee first to apply patterns to dates.</div>')+
      '<div id="se-patlist" style="margin-top:10px;">'+renderPatternList(patState)+'</div>'+
      '</div>';

    E.modal.show(edit?"Edit Employee":"Add Employee", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:edit?"Save":"Add Employee", primary:true, onClick:function(){
        var p={
          full_name:      E.q("#se-name").value.trim(),
          designation:    E.q("#se-desig").value,
          employment_type:E.q("#se-type").value,
          contracted_hours:parseFloat(E.q("#se-hrs").value)||40,
          email:          E.q("#se-email").value.trim(),
          phone:          E.q("#se-phone").value.trim(),
          registration_number: E.q("#se-reg").value.trim(),
          is_active:1,
          patterns_json:  JSON.stringify({patterns: patState.patterns || [], provisionalId: patState.provisionalId || null})
        };
        if(!p.full_name){toast("Name required","error");return;}
        saveEmp(edit?e.id:null, p, function(){
          E.modal.hide();
          renderEmpRows(mountRef);
          toast(edit?"Employee updated.":"Employee added.");
        });
      }}
    ]);

    // Wire pattern manager
    setTimeout(function(){
      var list = document.getElementById("se-patlist");
      if (!list) return;

      // ---- PATTERN AUTO-PERSIST (so "Save pattern" actually saves) ----
      var _patSaveT = null;
      var _patLastToast = 0;

      // sandbox-safe delete confirm (no window.confirm)
      var _patDel = { id:null, until:0 };
      function confirmDeletePattern(id){
        var now = Date.now();
        if (_patDel.id === id && now < _patDel.until) { _patDel.id = null; _patDel.until = 0; return true; }
        _patDel.id = id;
        _patDel.until = now + 5000;
        toast("Click Delete again to confirm.", "warn");
        setTimeout(function(){ try{ if(_patDel.id===id && Date.now()>=_patDel.until) _patDel.id=null; } catch(e){} }, 5200);
        return false;
      }


      function buildEmpPayloadForPersist() {
        // Build a payload that satisfies worker validation (full_name required)
        return {
          full_name:      (E.q("#se-name") && E.q("#se-name").value || (e && e.full_name) || "").trim(),
          designation:    (E.q("#se-desig") && E.q("#se-desig").value) || (e && e.designation) || "other",
          employment_type:(E.q("#se-type") && E.q("#se-type").value) || (e && e.employment_type) || "fulltime",
          contracted_hours: parseFloat((E.q("#se-hrs") && E.q("#se-hrs").value) || (e && e.contracted_hours) || 40) || 40,
          email:          (E.q("#se-email") && E.q("#se-email").value || (e && e.email) || "").trim(),
          phone:          (E.q("#se-phone") && E.q("#se-phone").value || (e && e.phone) || "").trim(),
          registration_number: (E.q("#se-reg") && E.q("#se-reg").value || (e && e.registration_number) || "").trim(),
          is_active:      (e && e.is_active===0) ? 0 : 1,
          patterns_json:  JSON.stringify({ patterns: patState.patterns || [], provisionalId: patState.provisionalId || null })
        };
      }

      function schedulePersistPatterns(reason) {
        if (!edit || !e || !e.id) return; // new employee cannot persist yet
        clearTimeout(_patSaveT);
        _patSaveT = setTimeout(function(){
          try {
            var payload = buildEmpPayloadForPersist();
            console.groupCollapsed("[shifts][patterns] persist -> " + reason + " (staffId=" + e.id + ")");
            console.log("patterns:", (patState.patterns||[]).length, "provisionalId:", patState.provisionalId);
            console.log("payload.patterns_json:", payload.patterns_json);
            console.groupEnd();
            saveEmp(e.id, payload, function(r){
              console.log("[shifts][patterns] persist <-", r);
              // small anti-spam toast (max once per 4s)
              var now = Date.now();
              if (now - _patLastToast > 4000) { _patLastToast = now; toast("Patterns saved."); }
            });
          } catch (ex) {
            console.error("[shifts][patterns] persist exception", ex);
          }
        }, 450);
      }


      function rerender(){
        list.innerHTML = renderPatternList(patState);
        wire();
      }

      function wire(){
        // provisional selection
        list.querySelectorAll("input[name='se-provisional']").forEach(function(r){
          r.onchange=function(){
            patState.provisionalId = r.value;
            schedulePersistPatterns("provisional-change");
            rerender();
          };
        });

        list.querySelectorAll("[data-pat-edit]").forEach(function(btn){
          btn.onclick=function(){
            var id=btn.getAttribute("data-pat-edit");
            var p=findPattern(patState, id);
            patternEditorModal(p, function(upd){
              if(!upd) return;
              if(p){
                Object.assign(p, upd);
              } else {
                patState.patterns.push(upd);
              }
              if(!patState.provisionalId) patState.provisionalId = upd.id;
              schedulePersistPatterns("pattern-edit");
              rerender();
            });
          };
        });

        list.querySelectorAll("[data-pat-del]").forEach(function(btn){
          btn.onclick=function(){
            var id=btn.getAttribute("data-pat-del");
            if(!confirmDeletePattern(id)) return;
            patState.patterns = patState.patterns.filter(function(x){return x.id!==id;});
            if(patState.provisionalId===id) patState.provisionalId = patState.patterns[0]?patState.patterns[0].id:null;
            schedulePersistPatterns("pattern-delete");
            rerender();
          };
        });

        list.querySelectorAll("[data-pat-apply]").forEach(function(btn){
          btn.onclick=function(){
            if(!edit){ toast("Save the employee first.","error"); return; }
            var id=btn.getAttribute("data-pat-apply");
            var p=findPattern(patState, id);
            if(!p){ toast("Pattern not found","error"); return; }
            applyPatternModal(e, p, function(){
              // refresh calendar if currently visible later
            });
          };
        });
      }

      var addBtn = document.getElementById("se-addpat");
      if (addBtn) addBtn.onclick=function(){
        patternEditorModal(null, function(upd){
          if(!upd) return;
          patState.patterns.push(upd);
          if(!patState.provisionalId) patState.provisionalId = upd.id;
          schedulePersistPatterns("pattern-add");
          rerender();
        });
      };

      wire();
    }, 60);
  }

  // ── Patterns (stored in staff.patterns_json) ───────────────────

  function getPatternState(staffObj) {
    var out = { patterns:[], provisionalId:null };
    if (!staffObj) return out;
    try {
      var raw = staffObj.patterns_json;
      if (!raw) return out;
      var o = JSON.parse(raw);
      if (o && typeof o==="object") {
        if (Array.isArray(o.patterns)) out.patterns = o.patterns;
        if (o.provisionalId) out.provisionalId = o.provisionalId;
      }
    } catch(e){}
    out.patterns = (out.patterns||[]).map(normalizePattern);
    if (!out.provisionalId && out.patterns[0]) out.provisionalId = out.patterns[0].id;
    return out;
  }

  
  function parseBool(v){
    try{
      if (v === true || v === 1) return true;
      if (v === false || v === 0 || v == null) return false;
      if (typeof v === "string") {
        var s = v.trim().toLowerCase();
        if (!s) return false;
        if (s === "true" || s === "1" || s === "yes" || s === "y" || s === "on") return true;
        if (s === "false" || s === "0" || s === "no" || s === "n" || s === "off") return false;
      }
      return !!v;
    } catch(e){ return !!v; }
  }

  function isOffEntry(e){
    e = e && typeof e==="object" ? e : {};
    if (parseBool(e.off)) return true;
    var st = String(e.start || e.start_time || "").trim();
    var et = String(e.end || e.end_time || "").trim();
    return (!st || !et);
  }

function normalizePattern(p) {
    p = p && typeof p==="object" ? p : {};
    var id = String(p.id || ("pat_"+Math.random().toString(16).slice(2)));
    var name = String(p.name || "Pattern");
    var week = Array.isArray(p.week) ? p.week.slice(0,7) : [];
    while (week.length < 7) week.push({off:true});
    week = week.map(function(d){
      d = d && typeof d==="object" ? d : {};
      var off = isOffEntry(d);
      var st = String(d.start || d.start_time || "").trim();
      var et = String(d.end || d.end_time || "").trim();
      var ro = String(d.role_override||"").trim();
      return off ? {off:true} : {off:false, start:st, end:et, role_override:ro};
    });
    return { id:id, name:name, week:week, createdAt: p.createdAt || Date.now() };
  }

  function findPattern(state, id){
    return (state.patterns||[]).find(function(p){return p.id===id;}) || null;
  }

  function renderPatternList(state) {
    var pats = (state.patterns||[]);
    if (!pats.length) {
      return '<div style="padding:10px;border:1px dashed var(--border);border-radius:10px;color:var(--muted);font-size:12px;">No patterns yet.</div>';
    }
    return pats.map(function(p){
      var isProv = state.provisionalId === p.id;
      return ''+
        '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:rgba(255,255,255,.02);">'+
        '<div style="padding-top:2px;"><input type="radio" name="se-provisional" value="'+esc(p.id)+'" '+(isProv?'checked':'')+' title="Provisional (default)"/></div>'+
        '<div style="flex:1;">'+
          '<div style="font-weight:800;">'+esc(p.name)+' '+(isProv?'<span class="eikon-pill" style="font-size:10px;margin-left:6px;">Provisional</span>':"")+'</div>'+
          '<div style="margin-top:4px;font-size:11px;color:var(--muted);line-height:1.35;">'+esc(patternSummary(p))+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">'+
          '<button class="eikon-btn" data-pat-edit="'+esc(p.id)+'" style="font-size:11px;padding:5px 8px;">Edit</button>'+
          '<button class="eikon-btn" data-pat-apply="'+esc(p.id)+'" style="font-size:11px;padding:5px 8px;">Apply</button>'+
          '<button class="eikon-btn danger" data-pat-del="'+esc(p.id)+'" style="font-size:11px;padding:5px 8px;">Delete</button>'+
        '</div>'+
        '</div>';
    }).join("");
  }

  function patternSummary(p) {
    var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    var uiOrder = [1,2,3,4,5,6,0]; // Mon..Sun
    var parts = uiOrder.map(function(d){
      var x = (p.week||[])[d] || {off:true};
      if (x.off || !x.start || !x.end) return DAYS[d]+": off";
      return DAYS[d]+": "+x.start+"–"+x.end;
    });
    return parts.join(" • ");
  }

  function patternEditorModal(existing, onDone) {
    var p = normalizePattern(existing || {});
    var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    var uiOrder = [1,2,3,4,5,6,0]; // Mon..Sun

    var rows = uiOrder.map(function(d){
      var x = p.week[d] || {off:true};
      var off = isOffEntry(x);
      return ''+
        '<tr>'+
          '<td style="padding:6px 8px;font-weight:700;">'+DAYS[d]+'</td>'+
          '<td style="padding:6px 8px;"><label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);"><input type="checkbox" id="pe-off-'+d+'" '+(off?'checked':'')+'/> Off</label></td>'+
          '<td style="padding:6px 8px;"><input class="eikon-input" id="pe-st-'+d+'" type="time" value="'+esc(off?"":(x.start||""))+'" style="min-width:110px;"/></td>'+
          '<td style="padding:6px 8px;"><input class="eikon-input" id="pe-et-'+d+'" type="time" value="'+esc(off?"":(x.end||""))+'" style="min-width:110px;"/></td>'+
        '</tr>';
    }).join("");

    var body =
      '<div class="eikon-field"><div class="eikon-label">Pattern Name</div>'+
      '<input class="eikon-input" id="pe-name" type="text" value="'+esc(existing?existing.name:p.name)+'"/></div>'+
      '<div class="eikon-table-wrap" style="margin-top:10px;"><table class="eikon-table">'+
      '<thead><tr><th>Day</th><th>Off</th><th>Start</th><th>End</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>'+
      '<div style="margin-top:8px;font-size:11px;color:var(--muted);">Tip: leave Start/End empty for days off.</div>';

    E.modal.show(existing?"Edit Pattern":"New Pattern", body, [
      {label:"Cancel", onClick:function(){E.modal.hide(); onDone && onDone(null);}},
      {label:"Save Pattern", primary:true, onClick:function(){
        var name = E.q("#pe-name").value.trim() || "Pattern";
        var week = [];
        for (var d=0; d<7; d++){
          var off = !!E.q("#pe-off-"+d).checked;
          var st = (E.q("#pe-st-"+d).value||"").trim();
          var et = (E.q("#pe-et-"+d).value||"").trim();
          if (off || !st || !et) week[d] = {off:true};
          else {
            if (t2m(et) <= t2m(st)) { toast(DAYS[d]+": end must be after start","error"); return; }
            week[d] = {off:false, start:st, end:et};
          }
        }
        var out = { id: p.id, name:name, week:week, createdAt: existing&&existing.createdAt || Date.now() };
        E.modal.hide();
        onDone && onDone(out);
      }}
    ]);

    // pe-auto-off-sync: make Off checkbox reflect time inputs (sandbox-safe, no browser confirm))
    setTimeout(function(){
      try{
        for (var d=0; d<7; d++){
          (function(di){
            var offEl = document.getElementById("pe-off-"+di);
            var stEl  = document.getElementById("pe-st-"+di);
            var etEl  = document.getElementById("pe-et-"+di);
            if(!offEl || !stEl || !etEl) return;

            function sync(){
              var off = !!offEl.checked;
              stEl.disabled = off;
              etEl.disabled = off;
              if(off){ stEl.value=""; etEl.value=""; }
            }

            offEl.onchange = function(){ sync(); };

            function bump(){
              if ((stEl.value||"").trim() || (etEl.value||"").trim()){
                offEl.checked = false;
                stEl.disabled = false;
                etEl.disabled = false;
              }
            }
            stEl.oninput = bump;
            etEl.oninput = bump;

            // initial state
            if(offEl.checked){ stEl.disabled = true; etEl.disabled = true; }
          })(d);
        }
      } catch(e) { console.error("[shifts][patterns] pe sync error", e); }
    }, 30);

  }

  function applyPatternModal(staffObj, pattern, done) {
    var today = new Date();
    var year = today.getFullYear();
    var tds = year+"-"+pad(today.getMonth()+1)+"-"+pad(today.getDate());
    var startOfYear = year+"-01-01";
    var endOfYear = year+"-12-31";

    var body =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Apply <b>'+esc(pattern.name)+'</b> for <b>'+esc(staffObj.full_name)+'</b>.</div>'+
      '<div class="eikon-row">'+
        '<div class="eikon-field"><div class="eikon-label">Range</div>'+
          '<select class="eikon-select" id="ap-range">'+
            '<option value="today">From today ('+esc(tds)+') → end of year</option>'+
            '<option value="fullyear">Full year ('+esc(startOfYear)+' → '+esc(endOfYear)+')</option>'+
            '<option value="custom">Custom range</option>'+
          '</select></div>'+
        '<div class="eikon-field"><div class="eikon-label">Start</div><input class="eikon-input" id="ap-start" type="date" value="'+esc(tds)+'"/></div>'+
        '<div class="eikon-field"><div class="eikon-label">End</div><input class="eikon-input" id="ap-end" type="date" value="'+esc(endOfYear)+'"/></div>'+
      '</div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
        '<div class="eikon-field"><div class="eikon-label">Mode</div>'+
          '<select class="eikon-select" id="ap-mode">'+
            '<option value="overwrite">Overwrite existing shifts in range</option>'+
            '<option value="fill">Fill empty days only (keep existing)</option>'+
          '</select></div>'+
      '</div>'+
      '<div id="ap-owarn" style="margin-top:10px;padding:10px;border:1px solid rgba(255,90,122,.45);border-radius:10px;background:rgba(255,90,122,.06);font-size:11px;color:var(--text);display:none;">'+
      '<div style="font-weight:800;margin-bottom:6px;">Overwrite confirmation</div>'+
      '<label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="ap-oconf"/> I understand this will overwrite shifts in the selected range.</label>'+
      '</div>'+
      '<div style="margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.02);font-size:11px;color:var(--muted);">'+
      '<b>Overwrite</b> clears this employee’s shifts in the selected date range and re-applies the pattern. <b>Fill</b> only adds shifts to days where the employee has no shift.</div>';

    E.modal.show("Apply Weekly Pattern", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Apply", primary:true, onClick:function(){
        var range = E.q("#ap-range").value;
        var start = (range==="today") ? tds : (range==="fullyear" ? startOfYear : E.q("#ap-start").value);
        var end   = (range==="today") ? endOfYear : (range==="fullyear" ? endOfYear : E.q("#ap-end").value);
        var mode  = E.q("#ap-mode").value;
        if(!start || !end){ toast("Select dates","error"); return; }
        if(end < start){ toast("End must be after start","error"); return; }
        if (mode==="overwrite") {
          var c = E.q("#ap-oconf");
          if (!c || !c.checked) { toast("Please confirm overwrite.","error"); return; }
        }

        apiOp("/shifts/apply-pattern", {method:"POST", body: JSON.stringify({
          staff_id: staffObj.id,
          start_date: start,
          end_date: end,
          mode: mode,
          pattern: { week: pattern.week }
        })}, function(r){
          E.modal.hide();
          toast("Applied. Inserted: "+(r&&r.inserted!=null?r.inserted:"")+"");
          loadMonth().then(function(){ done && done(); });
        });
      }}
    ]);

    setTimeout(function(){
      var sel = document.getElementById("ap-range");
      var st = document.getElementById("ap-start");
      var en = document.getElementById("ap-end");
      if(!sel||!st||!en) return;

      sel.onchange=function(){
        var custom = sel.value==="custom";
        st.disabled = !custom;
        en.disabled = !custom;

        if(sel.value==="today"){ st.value = tds; en.value = endOfYear; }
        else if(sel.value==="fullyear"){ st.value = startOfYear; en.value = endOfYear; }
      };
      sel.onchange();
      try{
        var modeSel = document.getElementById("ap-mode");
        var ow = document.getElementById("ap-owarn");
        var oc = document.getElementById("ap-oconf");
        function syncOverwriteConfirm(){
          if(!modeSel || !ow) return;
          var isOw = String(modeSel.value||"") === "overwrite";
          ow.style.display = isOw ? "block" : "none";
          if(!isOw && oc) oc.checked = false;
        }
        if(modeSel) modeSel.onchange = syncOverwriteConfirm;
        syncOverwriteConfirm();
      } catch(e) { console.error("[shifts][patterns] ap overwrite sync error", e); }

    }, 30);
  }
function saveEmp(id, p, cb) {
    if(id){ var ix=S.staff.findIndex(function(s){return s.id===id;}); if(ix>=0)Object.assign(S.staff[ix],p); }
    else { p.id=lsNextId(); S.staff.push(p); }
    apiOp(id?"/shifts/staff/"+id:"/shifts/staff", {method:id?"PUT":"POST",body:JSON.stringify(p)}, cb);
  }

  function toggleActive(e,cb){
    e.is_active=e.is_active===0?1:0;
    saveEmp(e.id, Object.assign({},e), cb);
  }

  /* ══════════════════════════════════════════════════════════════
     VIEW: SETTINGS
  ══════════════════════════════════════════════════════════════ */
  function vSettings(m) {
    normalizeOpeningHours();
    setMaltaFromSettings();

    var def = S.openingHours["default"]||{open:"07:30",close:"19:30",closed:false};
    var ov  = S.openingHours.overrides||{};
    var ovRows = Object.keys(ov).sort().map(function(d){
      var v=ov[d];
      return '<tr><td>'+esc(d)+'</td>'+
        '<td>'+(v.closed?'<span style="color:var(--danger)">Closed</span>':esc(v.open)+"–"+esc(v.close))+'</td>'+
        '<td>'+esc(v.note||"—")+'</td>'+
        '<td><button class="eikon-btn danger sh-rm-ov" data-d="'+esc(d)+'" style="font-size:11px;padding:5px 8px;">Remove</button></td></tr>';
    }).join("")||'<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:14px;">No overrides.</td></tr>';

    var satOpen = (S.openingHours.openSaturday != null) ? !!S.openingHours.openSaturday : !!S.openingHours.weekends;
    var sunOpen = (S.openingHours.openSunday   != null) ? !!S.openingHours.openSunday   : !!S.openingHours.weekends;

    var yrNow = new Date().getFullYear();

    m.innerHTML=
      '<div style="display:flex;flex-direction:column;gap:14px;">'+
      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:12px;">🕐 Default Opening Hours</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Open</div><input class="eikon-input" id="ss-open" type="time" value="'+esc(def.open||"07:30")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Close</div><input class="eikon-input" id="ss-close" type="time" value="'+esc(def.close||"19:30")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Saturday</div>'+
      '<select class="eikon-select" id="ss-sat">'+
      '<option value="1"'+(satOpen?' selected':'')+'>Open</option>'+
      '<option value="0"'+(!satOpen?' selected':'')+'>Closed</option>'+
      '</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Sunday</div>'+
      '<select class="eikon-select" id="ss-sun">'+
      '<option value="1"'+(sunOpen?' selected':'')+'>Open</option>'+
      '<option value="0"'+(!sunOpen?' selected':'')+'>Closed</option>'+
      '</select></div>'+
      '</div>'+
      '<div style="margin-top:12px;"><button class="eikon-btn primary" id="ss-savehours">Save Hours</button></div></div>'+

      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:4px;">📅 Exceptional Day Overrides</div>'+
      '<div class="eikon-help" style="margin-bottom:12px;">Override hours for a specific date (public holiday, half day, emergency).</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Date</div><input class="eikon-input" id="ss-ovd" type="date"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Type</div>'+
      '<select class="eikon-select" id="ss-ovt"><option value="custom">Custom Hours</option><option value="closed">Fully Closed</option></select></div>'+
      '<div class="eikon-field" id="ss-ovta"><div class="eikon-label">Open</div><input class="eikon-input" id="ss-ovo" type="time" value="'+esc(def.open||"07:30")+'"/></div>'+
      '<div class="eikon-field" id="ss-ovtb"><div class="eikon-label">Close</div><input class="eikon-input" id="ss-ovc" type="time" value="'+esc(def.close||"19:30")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Note</div><input class="eikon-input" id="ss-ovn" type="text" placeholder="e.g. Half day"/></div>'+
      '</div>'+
      '<div style="margin-top:10px;"><button class="eikon-btn primary" id="ss-addov">Add Override</button></div>'+
      '<div class="eikon-table-wrap" style="margin-top:12px;"><table class="eikon-table"><thead><tr><th>Date</th><th>Hours</th><th>Note</th><th></th></tr></thead>'+
      '<tbody id="ss-ovtbody">'+ovRows+'</tbody></table></div></div>'+

      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:12px;">⚙️ Coverage Rules</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Require Pharmacist Coverage</div>'+
      '<select class="eikon-select" id="ss-rph">'+
      '<option value="1"'+(S.settings.pharmacistRequired?" selected":"")+'>Yes — Alert on uncovered hours</option>'+
      '<option value="0"'+(S.settings.pharmacistRequired?"":" selected")+'>No — Informational</option>'+
      '</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Min Pharmacists On Duty</div>'+
      '<input class="eikon-input" id="ss-mph" type="number" min="1" max="5" value="'+(S.settings.minPharmacists||1)+'" style="min-width:80px;"/></div>'+
      '</div>'+
      '<div style="margin-top:12px;"><button class="eikon-btn primary" id="ss-saverules">Save Rules</button></div></div>'+

      maltaRefHTML(yrNow) +

      '</div>';

    var ovType = E.q("#ss-ovt",m);
    ovType.onchange=function(){
      var c=ovType.value==="custom";
      E.q("#ss-ovta",m).style.display=c?"":"none";
      E.q("#ss-ovtb",m).style.display=c?"":"none";
    };

    E.q("#ss-savehours",m).onclick=function(){
      S.openingHours["default"]={open:E.q("#ss-open",m).value, close:E.q("#ss-close",m).value, closed:false};
      S.openingHours.openSaturday = E.q("#ss-sat",m).value==="1";
      S.openingHours.openSunday   = E.q("#ss-sun",m).value==="1";
      // legacy
      S.openingHours.weekends = (S.openingHours.openSaturday && S.openingHours.openSunday);
      apiOp("/shifts/opening-hours",{method:"PUT",body:JSON.stringify(S.openingHours)},function(){toast("Opening hours saved.");});
    };

    E.q("#ss-addov",m).onclick=function(){
      var d=E.q("#ss-ovd",m).value; if(!d){toast("Select a date","error");return;}
      var cl=E.q("#ss-ovt",m).value==="closed";
      S.openingHours.overrides[d]=cl
        ?{closed:true,note:E.q("#ss-ovn",m).value.trim()}
        :{open:E.q("#ss-ovo",m).value,close:E.q("#ss-ovc",m).value,closed:false,note:E.q("#ss-ovn",m).value.trim()};
      apiOp("/shifts/opening-hours",{method:"PUT",body:JSON.stringify(S.openingHours)},function(){toast("Override added."); vSettings(m);});
    };

    E.q("#ss-saverules",m).onclick=function(){
      S.settings.pharmacistRequired=E.q("#ss-rph",m).value==="1";
      S.settings.minPharmacists=parseInt(E.q("#ss-mph",m).value)||1;
      apiOp("/shifts/settings",{method:"PUT",body:JSON.stringify(S.settings)},function(){toast("Rules saved.");});
    };

    var eb = E.q("#ss-editmalta", m);
    if (eb) eb.onclick=function(){ maltaLawModal(yrNow, function(){ vSettings(m); }); };

    m.querySelectorAll(".sh-rm-ov").forEach(function(btn){
      btn.onclick=function(){
        var d=btn.getAttribute("data-d"); delete S.openingHours.overrides[d];
        apiOp("/shifts/opening-hours",{method:"PUT",body:JSON.stringify(S.openingHours)},function(){toast("Override removed."); vSettings(m);});
      };
    });
  }

  function maltaRefHTML(yrNow) {
    var yd = maltaYear(yrNow);
    var alNow = MALTA.annualLeaveHours[yrNow] || MALTA.annualLeaveHours[lastKnownYear(MALTA.annualLeaveHours, yrNow)] || 216;

    // show current year + previous 2 years if present
    var yrs=[yrNow, yrNow-1, yrNow-2].filter(function(y){ return MALTA.annualLeaveHours[y]!=null; });

    var cards = '';
    cards += yrs.map(function(y){
      return rcard("Annual Leave FT "+y, String(MALTA.annualLeaveHours[y])+"h", "#5aa2ff");
    }).join("");

    cards += rcard("Sick Leave Paid",""+(MALTA.sickLeavePaidHours||80)+"h (10 days)","#fb923c");
    cards += rcard("Sick Leave ½ Pay",""+(MALTA.sickLeaveHalfPayHours||80)+"h (10 days)","#fb923c");
    cards += rcard("Urgent Family Leave",""+(MALTA.urgentFamilyLeaveHours||32)+"h / year","#43d17a");
    cards += rcard("Maternity Leave","18 weeks","#f472b6");
    cards += rcard("Paternity Leave","10 working days","#38bdf8");
    cards += rcard("Parental Leave","4 months (2 paid)","#a78bfa");
    if (yd.miscarriageLeaveDays) cards += rcard("Miscarriage Leave",""+yd.miscarriageLeaveDays+" calendar days","#94a3b8");
    cards += rcard("Max Weekly Hours",""+(MALTA.maxWeeklyHours||48)+"h (EU WTD)","#ff5a7a");
    if (yd.colaWeekly) cards += rcard("COLA "+yrNow,"€"+Number(yd.colaWeekly).toFixed(2)+"/week","#43d17a");
    if (yd.minWageWeekly) cards += rcard("Min Wage "+yrNow,"€"+Number(yd.minWageWeekly).toFixed(2)+"/wk","#43d17a");
    cards += rcard("Part-time Leave","Pro-rata (avg hrs / 40)","#64748b");

    return ''+
      '<div class="eikon-card">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'+
      '<div style="font-weight:900;font-size:15px;">📋 Malta Employment Law Reference '+yrNow+'</div>'+
      '<button class="eikon-btn" id="ss-editmalta" style="font-size:12px;padding:6px 10px;">Edit</button>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;">'+cards+'</div>'+
      '<div style="margin-top:10px;font-size:11px;color:var(--muted);">These figures are a reference. Edit to match the current year and your internal policy.</div>'+
      '</div>';
  }

  function maltaLawModal(yrNow, done) {
    setMaltaFromSettings();
    var ySel = yrNow;
    var cfg = (S.settings.maltaLaw && typeof S.settings.maltaLaw==="object") ? S.settings.maltaLaw : {};
    var yd = Object.assign({}, maltaYear(ySel));
    var al = (cfg.annualLeaveHours && cfg.annualLeaveHours[ySel]!=null) ? cfg.annualLeaveHours[ySel] : (MALTA.annualLeaveHours[ySel] || MALTA.annualLeaveHours[lastKnownYear(MALTA.annualLeaveHours, ySel)] || 216);

    var years = [];
    for (var y=yrNow-2; y<=yrNow+2; y++) years.push(y);

    var body =
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Year</div>'+
      '<select class="eikon-select" id="ml-year">'+years.map(function(y){ return '<option value="'+y+'"'+(y===ySel?' selected':'')+'>'+y+'</option>'; }).join("")+'</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Annual Leave FT (hours)</div>'+
      '<input class="eikon-input" id="ml-al" type="number" min="0" value="'+esc(al)+'" style="min-width:110px;"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Public Holidays (count)</div>'+
      '<input class="eikon-input" id="ml-ph" type="number" min="0" value="'+esc(yd.publicHolidays||"")+'" style="min-width:110px;"/></div>'+
      '</div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
      '<div class="eikon-field"><div class="eikon-label">COLA (€/week)</div>'+
      '<input class="eikon-input" id="ml-cola" type="number" step="0.01" min="0" value="'+esc(yd.colaWeekly||"")+'" style="min-width:110px;"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Min Wage (€/week)</div>'+
      '<input class="eikon-input" id="ml-mw" type="number" step="0.01" min="0" value="'+esc(yd.minWageWeekly||"")+'" style="min-width:110px;"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Miscarriage Leave (days)</div>'+
      '<input class="eikon-input" id="ml-ml" type="number" min="0" value="'+esc(yd.miscarriageLeaveDays||"")+'" style="min-width:110px;"/></div>'+
      '</div>'+
      '<hr style="border-color:var(--border);margin:12px 0;"/>'+
      '<div style="font-weight:800;margin-bottom:8px;">Core values</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Sick paid (hours)</div><input class="eikon-input" id="ml-sp" type="number" min="0" value="'+esc(MALTA.sickLeavePaidHours||80)+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Sick ½ pay (hours)</div><input class="eikon-input" id="ml-sh" type="number" min="0" value="'+esc(MALTA.sickLeaveHalfPayHours||80)+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Urgent family (hours)</div><input class="eikon-input" id="ml-uf" type="number" min="0" value="'+esc(MALTA.urgentFamilyLeaveHours||32)+'"/></div>'+
      '</div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
      '<div class="eikon-field"><div class="eikon-label">Full-time week (hours)</div><input class="eikon-input" id="ml-ft" type="number" min="1" max="48" value="'+esc(MALTA.fullTimeWeeklyHours||40)+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Max weekly (hours)</div><input class="eikon-input" id="ml-mx" type="number" min="1" max="80" value="'+esc(MALTA.maxWeeklyHours||48)+'"/></div>'+
      '</div>';

    E.modal.show("Malta Employment Law Reference", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Save", primary:true, onClick:function(){
        var y = parseInt(E.q("#ml-year").value,10) || yrNow;
        var next = (S.settings.maltaLaw && typeof S.settings.maltaLaw==="object") ? JSON.parse(JSON.stringify(S.settings.maltaLaw)) : {};
        if (!next.annualLeaveHours) next.annualLeaveHours = {};
        if (!next.yearData) next.yearData = {};

        next.annualLeaveHours[y] = parseInt(E.q("#ml-al").value,10) || 0;

        next.yearData[y] = Object.assign({}, next.yearData[y]||{}, {
          publicHolidays: parseInt(E.q("#ml-ph").value,10) || 0,
          colaWeekly: parseFloat(E.q("#ml-cola").value) || 0,
          minWageWeekly: parseFloat(E.q("#ml-mw").value) || 0,
          miscarriageLeaveDays: parseInt(E.q("#ml-ml").value,10) || 0
        });

        next.sickLeavePaidHours = parseInt(E.q("#ml-sp").value,10) || 0;
        next.sickLeaveHalfPayHours = parseInt(E.q("#ml-sh").value,10) || 0;
        next.urgentFamilyLeaveHours = parseInt(E.q("#ml-uf").value,10) || 0;
        next.fullTimeWeeklyHours = parseInt(E.q("#ml-ft").value,10) || 40;
        next.maxWeeklyHours = parseInt(E.q("#ml-mx").value,10) || 48;

        S.settings.maltaLaw = next;
        apiOp("/shifts/settings",{method:"PUT",body:JSON.stringify(S.settings)},function(){
          setMaltaFromSettings();
          toast("Malta reference saved.");
          E.modal.hide();
          done && done();
        });
      }}
    ]);
  }
function rcard(l,v,c){
    return '<div style="padding:10px 12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;">'+
      '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">'+esc(l)+'</div>'+
      '<div style="font-weight:700;color:'+c+';">'+esc(v)+'</div></div>';
  }

  /* ══════════════════════════════════════════════════════════════
     VIEW: CALENDAR
  ══════════════════════════════════════════════════════════════ */
  function vCalendar(m) {
    var y=S.year, mo=S.month, days=dim(y,mo);
    var firstDow=dow(y,mo,1);
    var cells="";
    var cellDay=1-firstDow;

    function dateFromCellDay(n){
      var dt=new Date(y,mo,n);
      return dt.getFullYear()+"-"+pad(dt.getMonth()+1)+"-"+pad(dt.getDate());
    }
    function addDaysYMD(ds, n){
      var dt=new Date(ds); dt.setDate(dt.getDate()+n);
      return dt.getFullYear()+"-"+pad(dt.getMonth()+1)+"-"+pad(dt.getDate());
    }

    for(var r=0;r<6;r++){
      var rowStartCell = cellDay; // Sunday for this row
      var ws = dateFromCellDay(rowStartCell);
      var we = addDaysYMD(ws, 6);

      var row='<tr>';
      var anyReal=false;

      // Week action column
      row += '<td style="background:rgba(0,0,0,.04);border:1px solid var(--border);vertical-align:top;padding:6px;width:70px;min-width:70px;">'+
             '<button class="eikon-btn sh-week-apply" data-ws="'+esc(ws)+'" data-we="'+esc(we)+'" style="font-size:11px;padding:6px 8px;width:100%;">↻ Pattern</button>'+
             '<div style="margin-top:6px;font-size:9px;color:var(--muted);text-align:center;">'+esc(ws.slice(5))+'–'+esc(we.slice(5))+'</div>'+
             '</td>';

      for(var c=0;c<7;c++,cellDay++){
        if(cellDay<1||cellDay>days){
          row+='<td style="background:rgba(0,0,0,.12);height:84px;border:1px solid var(--border);"></td>';
        } else {
          anyReal=true;
          var ds=ymd(y,mo,cellDay);
          var oh=ohFor(ds);
          var ph=isPH(ds);
          var cov=checkCov(ds);
          var dayShifts=S.shifts.filter(function(s){return s.shift_date===ds;});
          var dayLeaves=S.leaves.filter(function(l){return l.status==="approved"&&l.start_date<=ds&&l.end_date>=ds;});
          var onLeaveMap={};
          dayLeaves.forEach(function(l){onLeaveMap[l.staff_id]=l;});
          var bg=ph?"rgba(90,162,255,.06)":oh.closed?"rgba(0,0,0,.18)":"rgba(255,255,255,.02)";
          var bc=(!oh.closed&&!cov.ok)?"rgba(255,90,122,.6)":"var(--border)";
          var wd=new Date(ds).getDay(); var isWknd=wd===0||wd===6;

          var pills=dayShifts.map(function(s){
            var e=emp(s.staff_id); if(!e)return"";
            var lv=onLeaveMap[s.staff_id];
            var col=dc(e.designation);
            var extra=lv?"opacity:0.35;text-decoration:line-through;":"";
            return '<div style="font-size:10px;padding:2px 5px;border-radius:5px;margin-top:2px;background:'+col+'1a;border:1px solid '+col+'55;color:'+col+';'+extra+'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="'+esc(e.full_name)+(lv?" (on leave)":"")+'">'+esc((e.full_name||"").split(" ")[0])+(s.start_time?" "+s.start_time.slice(0,5):"")+'</div>';
          }).join("");

          var lvPills=Object.keys(onLeaveMap).filter(function(sid){
            return !dayShifts.some(function(s){return s.staff_id==sid;});
          }).map(function(sid){
            var e=emp(+sid); if(!e)return"";
            return '<div style="font-size:10px;padding:2px 5px;border-radius:5px;margin-top:2px;background:rgba(255,90,122,.12);border:1px solid rgba(255,90,122,.3);color:var(--danger);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">🏖'+esc((e.full_name||"").split(" ")[0])+'</div>';
          }).join("");

          var warn = (!cov.ok && !oh.closed) ? (cov.gaps && cov.gaps.length && (cov.gaps[0].start===t2m(oh.open||"") && cov.gaps[0].end===t2m(oh.close||"")) ? "⚠ No pharm." : "⚠ Pharm gap") : "";

          row+='<td style="vertical-align:top;padding:6px;background:'+bg+';border:1px solid '+bc+';cursor:pointer;height:84px;width:14.28%;position:relative;" data-date="'+ds+'">'+
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px;">'+
            '<span style="font-weight:700;font-size:13px;color:'+(isWknd?"var(--muted)":"var(--text)")+';">'+cellDay+'</span>'+
            (ph?'<span style="font-size:9px;background:rgba(90,162,255,.2);color:var(--accent);border-radius:3px;padding:1px 3px;">PH</span>':"")+'</div>'+
            '<div style="font-size:9px;color:var(--muted);margin-bottom:2px;">'+(oh.closed?"CLOSED":(oh.open||"")+"–"+(oh.close||""))+'</div>'+
            (warn?'<div style="font-size:9px;color:var(--danger);font-weight:700;">'+warn+'</div>':"")+
            pills+lvPills+'</td>';
        }
      }
      row+="</tr>";
      if(anyReal||r<5) cells+=row;
    }

    m.innerHTML=
      '<div class="eikon-card">'+
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">'+
      '<button class="eikon-btn" id="sh-cp">◀</button>'+
      '<div style="font-weight:900;font-size:17px;min-width:180px;text-align:center;">'+MONTHS[mo]+" "+y+'</div>'+
      '<button class="eikon-btn" id="sh-cn">▶</button>'+
      '<button class="eikon-btn" id="sh-ct">Today</button>'+
      '<div style="flex:1;"></div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11px;">'+
      Object.keys(DESIG).slice(0,5).map(function(k){
        return '<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:'+dc(k)+';display:inline-block;"></span>'+DESIG[k]+'</span>';
      }).join("")+'</div></div>'+
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:640px;">'+
      '<thead><tr><th style="text-align:center;padding:8px;font-size:12px;color:var(--muted);">Week</th>'+DSHORT.map(function(d){return '<th style="text-align:center;padding:8px;font-size:12px;color:var(--muted);">'+d+'</th>';}).join("")+'</tr></thead>'+
      '<tbody>'+cells+'</tbody></table></div>'+
      '<div style="margin-top:8px;font-size:11px;color:var(--muted);">💡 Click any day to manage shifts. <span style="color:var(--danger)">Red border</span> = pharmacist uncovered hours. <span style="color:var(--accent)">PH</span> = Public Holiday.</div>'+
      '</div>';

    E.q("#sh-cp",m).onclick=function(){ S.month--; if(S.month<0){S.month=11;S.year--;} loadMonth().then(function(){vCalendar(m);}); };
    E.q("#sh-cn",m).onclick=function(){ S.month++; if(S.month>11){S.month=0;S.year++;} loadMonth().then(function(){vCalendar(m);}); };
    E.q("#sh-ct",m).onclick=function(){ var n=new Date(); S.year=n.getFullYear(); S.month=n.getMonth(); loadMonth().then(function(){vCalendar(m);}); };

    m.querySelectorAll("td[data-date]").forEach(function(td){
      td.onclick=function(){ dayModal(td.getAttribute("data-date"), function(){vCalendar(m);}); };
    });

    m.querySelectorAll(".sh-week-apply").forEach(function(btn){
      btn.onclick=function(ev){
        ev && ev.stopPropagation();
        weekApplyModal(btn.getAttribute("data-ws"), btn.getAttribute("data-we"), function(){
          loadMonth().then(function(){vCalendar(m);});
        });
      };
    });
  }function dayModal(ds, onSave) {
    var oh=ohFor(ds);
    var dayShifts=S.shifts.filter(function(s){return s.shift_date===ds;});
    var dayLeaves=S.leaves.filter(function(l){return l.status==="approved"&&l.start_date<=ds&&l.end_date>=ds;});
    var onLeaveMap={}; dayLeaves.forEach(function(l){onLeaveMap[l.staff_id]=l;});
    var cov=checkCov(ds);
    var ph=isPH(ds);
    var allPharm=pharmStaff();

    var staffOpts=actStaff().map(function(s){ return '<option value="'+s.id+'">'+esc(s.full_name)+' ('+esc(dl(s.designation))+')</option>'; }).join("");

    // Coverage banner (supports partial gaps)
    var covBanner="";
    if(S.settings.pharmacistRequired && !cov.ok && !oh.closed){
      var gapTxt = (cov.gaps||[]).slice(0,4).map(function(g){ return m2t(g.start)+"–"+m2t(g.end); }).join(", ");
      var alts=allPharm.filter(function(p){ return !dayShifts.some(function(s){return s.staff_id===p.id;}); });
      var hint = alts.length ? (" Assign: "+alts.slice(0,3).map(function(a){return esc(a.full_name);}).join(", ")+".") : "";
      covBanner='<div style="padding:8px 10px;background:rgba(255,90,122,.1);border:1px solid rgba(255,90,122,.35);border-radius:8px;font-size:12px;margin-bottom:10px;">'+
        '⚠️ <b>Pharmacist uncovered hours:</b> '+esc(gapTxt||"")+hint+'</div>';
    }

    var shiftRows=dayShifts.length
      ? dayShifts.map(function(s){
          var e=emp(s.staff_id); var lv=onLeaveMap[s.staff_id]; var col=dc(e&&e.designation);
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-left:3px solid '+col+';border-radius:8px;margin-bottom:6px;">'+
            '<span style="flex:1;font-size:13px;">'+esc(e?e.full_name:"?")+' <span style="color:var(--muted);font-size:11px;">'+esc(s.start_time||"")+'–'+esc(s.end_time||"")+'</span>'+
            (lv?'<span style="color:var(--danger);font-size:11px;margin-left:6px;">⚠ On leave</span>':"")+'</span>'+
            '<button class="eikon-btn" style="font-size:11px;padding:5px 8px;" data-edit-sh="'+s.id+'">Edit</button>'+
            '<button class="eikon-btn danger" style="font-size:11px;padding:5px 8px;" data-del-sh="'+s.id+'">✕</button></div>';
        }).join("")
      : '<div style="color:var(--muted);font-size:12px;padding:6px 0;">No shifts assigned yet.</div>';

    var lvRow=dayLeaves.length
      ? '<div style="margin-bottom:10px;">'+dayLeaves.map(function(l){ var e=emp(l.staff_id); return '<span class="eikon-pill" style="font-size:11px;color:var(--danger);border-color:rgba(255,90,122,.4);">🏖 '+esc(e?e.full_name:"?")+'</span> '; }).join("")+'</div>':"";

    var defaultSt = oh.open||"07:30";
    var defaultEt = oh.close||"19:30";

    var body=
      '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">'+esc(ds)+
      (ph?' <span style="color:var(--accent);font-weight:700;">— Public Holiday</span>':"")+
      ' | '+(oh.closed?'<span style="color:var(--danger)">CLOSED</span>':esc(oh.open||"")+'–'+esc(oh.close||""))+'</div>'+
      covBanner+lvRow+
      '<div style="font-weight:700;margin-bottom:8px;">Current Shifts</div>'+
      '<div id="dm-shifts">'+shiftRows+'</div>'+
      '<hr style="border-color:var(--border);margin:12px 0;"/>'+
      '<div style="font-weight:700;margin-bottom:8px;">Add Shift</div>'+
      (oh.closed?'<div style="padding:10px;border:1px solid var(--border);border-radius:10px;color:var(--muted);font-size:12px;">This day is marked as closed in Opening Hours.</div>':(
        '<div class="eikon-row">'+
        '<div class="eikon-field"><div class="eikon-label">Employee</div><select class="eikon-select" id="dm-emp">'+staffOpts+'</select></div>'+
        '<div class="eikon-field"><div class="eikon-label">Start</div><input class="eikon-input" id="dm-st" type="time" value="'+esc(defaultSt)+'"/></div>'+
        '<div class="eikon-field"><div class="eikon-label">End</div><input class="eikon-input" id="dm-et" type="time" value="'+esc(defaultEt)+'"/></div>'+
        '</div>'+
        '<div class="eikon-field" style="margin-top:8px;"><div class="eikon-label">Notes</div><input class="eikon-input" id="dm-nt" type="text" placeholder="optional"/></div>'+
        (S.settings.pharmacistRequired && cov.gaps && cov.gaps.length ? '<div style="margin-top:8px;font-size:11px;color:var(--muted);">Suggestion: cover '+esc(m2t(cov.gaps[0].start))+'–'+esc(m2t(cov.gaps[0].end))+' (uncovered).</div>':"")
      ));

    E.modal.show("Shifts — "+ds, body, [
      {label:"Close", onClick:function(){E.modal.hide();}},
      {label:"Add Shift", primary:true, onClick:function(){
        if(oh.closed){ E.modal.hide(); return; }
        var sid=parseInt(E.q("#dm-emp").value);
        var st=E.q("#dm-st").value; var et=E.q("#dm-et").value;
        if(!sid||!st||!et){toast("Fill all fields","error");return;}
        if(t2m(et)<=t2m(st)){toast("End must be after start","error");return;}
        var p={staff_id:sid,shift_date:ds,start_time:st,end_time:et,notes:E.q("#dm-nt").value.trim()};
        p.id=lsNextId(); S.shifts.push(p);
        apiOp("/shifts/assignments",{method:"POST",body:JSON.stringify(p)},function(r){
          if(r.shift_id)p.id=r.shift_id;
          E.modal.hide();
          toast("Shift added.");
          onSave&&onSave();
        });
      }}
    ]);

    setTimeout(function(){
      // Suggest uncovered times for pharmacists/locums
      function applyGapSuggestionIfPharm(){
        var empSel = document.getElementById("dm-emp");
        if(!empSel) return;
        var sid = parseInt(empSel.value,10);
        var e = emp(sid);
        if(!e) return;
        var isPh = (e.designation==="pharmacist" || e.designation==="locum");
        if(isPh && cov.gaps && cov.gaps.length){
          var stEl = document.getElementById("dm-st");
          var etEl = document.getElementById("dm-et");
          if(stEl && etEl){
            stEl.value = m2t(cov.gaps[0].start);
            etEl.value = m2t(cov.gaps[0].end);
          }
        }
      }
      var empSel = document.getElementById("dm-emp");
      if(empSel) empSel.onchange = applyGapSuggestionIfPharm;
      applyGapSuggestionIfPharm();

      document.querySelectorAll("[data-del-sh]").forEach(function(btn){
        btn.onclick=function(){
          var id=parseInt(btn.getAttribute("data-del-sh"));
          S.shifts=S.shifts.filter(function(s){return s.id!==id;});
          apiOp("/shifts/assignments/"+id,{method:"DELETE"},function(){ lsSync(); E.modal.hide(); toast("Shift removed."); onSave&&onSave(); });
        };
      });
      document.querySelectorAll("[data-edit-sh]").forEach(function(btn){
        btn.onclick=function(){
          var id=parseInt(btn.getAttribute("data-edit-sh"));
          var sh=S.shifts.find(function(s){return s.id===id;});
          if(!sh) return;
          var e2=emp(sh.staff_id);
          E.modal.hide();
          singleShiftModal(e2, ds, sh, onSave);
        };
      });
    },80);
  }
  function weekApplyModal(ws, we, done) {
    var staff = actStaff();
    if (!staff.length) { toast("No staff available","error"); return; }

    // helpers
    function weekDates(start) {
      var out=[]; for(var i=0;i<7;i++) out.push(addD(start,i));
      return out;
    }

    var staffOpts = staff.map(function(s){ return '<option value="'+s.id+'">'+esc(s.full_name)+' ('+esc(dl(s.designation))+')</option>'; }).join("");

    var body =
      '<div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Apply a weekly pattern for <b>'+esc(ws)+'</b> to <b>'+esc(we)+'</b>.</div>'+
      '<div class="eikon-row">'+
        '<div class="eikon-field"><div class="eikon-label">Employee</div><select class="eikon-select" id="wa-emp">'+staffOpts+'</select></div>'+
        '<div class="eikon-field"><div class="eikon-label">Start from</div><select class="eikon-select" id="wa-pat"></select></div>'+
        '<div class="eikon-field"><div class="eikon-label">Mode</div>'+
          '<select class="eikon-select" id="wa-mode"><option value="overwrite">Overwrite</option><option value="fill">Fill empty only</option></select>'+
        '</div>'+
      '</div>'+
      '<div id="wa-owarn" style="margin-top:10px;padding:10px;border:1px solid rgba(255,90,122,.45);border-radius:10px;background:rgba(255,90,122,.06);font-size:11px;color:var(--text);display:none;">'+
      '<div style="font-weight:800;margin-bottom:6px;">Overwrite confirmation</div>'+
      '<label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="wa-oconf"/> I understand this will overwrite shifts in this week.</label>'+
      '</div>'+
      '<div id="wa-week" style="margin-top:10px;"></div>'+
      '<div style="margin-top:10px;font-size:11px;color:var(--muted);">'+
      'This will also save the confirmed week as a new pattern for the employee.</div>';

    E.modal.show("Apply Pattern — Week", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Apply", primary:true, onClick:function(){
        var sid = parseInt(E.q("#wa-emp").value,10);
        var e = emp(sid);
        if(!e){ toast("Select employee","error"); return; }

        var mode = E.q("#wa-mode").value;
        if (mode==="overwrite") {
          var c = E.q("#wa-oconf");
          if (!c || !c.checked) { toast("Please confirm overwrite.","error"); return; }
        }

        // Collect dates payload
        var ds = weekDates(ws);
        var dates = [];
        for (var i=0;i<ds.length;i++){
          var off = !!E.q("#wa-off-"+i).checked;
          var st = (E.q("#wa-st-"+i).value||"").trim();
          var et = (E.q("#wa-et-"+i).value||"").trim();
          if (off || !st || !et) continue;
          if (t2m(et) <= t2m(st)) { toast(ds[i]+": end must be after start","error"); return; }
          dates.push({ date: ds[i], start_time: st, end_time: et });
        }

        apiOp("/shifts/apply-pattern", {method:"POST", body: JSON.stringify({
          staff_id: sid,
          start_date: ws,
          end_date: we,
          mode: mode,
          dates: dates
        })}, function(r){
          // Save as new pattern (always)
          var pState = getPatternState(e);
          var week = [];
          for (var d=0; d<7; d++) week[d] = {off:true};
          for (var i=0;i<ds.length;i++){
            var dt = new Date(ds[i]);
            var dow2 = dt.getDay();
            var off2 = !!E.q("#wa-off-"+i).checked;
            var st2 = (E.q("#wa-st-"+i).value||"").trim();
            var et2 = (E.q("#wa-et-"+i).value||"").trim();
            if (off2 || !st2 || !et2) week[dow2] = {off:true};
            else week[dow2] = {off:false, start: st2, end: et2};
          }
          var newPat = normalizePattern({ id:"pat_"+Date.now()+"_"+Math.random().toString(16).slice(2), name:"Week "+ws, week:week, createdAt: Date.now() });
          pState.patterns.push(newPat);

          // persist staff with updated patterns_json
          var payload = Object.assign({}, e, {
            patterns_json: JSON.stringify({patterns: pState.patterns, provisionalId: pState.provisionalId || null})
          });
          saveEmp(e.id, payload, function(){
            E.modal.hide();
            toast("Applied. Inserted: "+(r&&r.inserted!=null?r.inserted:"")+"");
            done && done();
          });
        });
      }}
    ]);

    setTimeout(function(){
      var empSel = document.getElementById("wa-emp");
      var patSel = document.getElementById("wa-pat");
      var weekWrap = document.getElementById("wa-week");
      if(!empSel || !patSel || !weekWrap) return;

      function renderWeekFromPattern(pattern) {
        var ds = weekDates(ws);
        var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        var rows = ds.map(function(dateStr, i){
          var d = new Date(dateStr).getDay();
          var entry = (pattern && pattern.week && pattern.week[d]) ? pattern.week[d] : {off:true};
          var off = isOffEntry(entry);
          return ''+
            '<tr>'+
              '<td style="padding:6px 8px;font-weight:700;white-space:nowrap;">'+DAYS[d]+' <span style="color:var(--muted);font-weight:600;">'+esc(dateStr.slice(5))+'</span></td>'+
              '<td style="padding:6px 8px;"><label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);"><input type="checkbox" id="wa-off-'+i+'" '+(off?'checked':'')+'/> Off</label></td>'+
              '<td style="padding:6px 8px;"><input class="eikon-input" id="wa-st-'+i+'" type="time" value="'+esc(off?"":(entry.start||""))+'" style="min-width:110px;"/></td>'+
              '<td style="padding:6px 8px;"><input class="eikon-input" id="wa-et-'+i+'" type="time" value="'+esc(off?"":(entry.end||""))+'" style="min-width:110px;"/></td>'+
            '</tr>';
        }).join("");

        weekWrap.innerHTML =
          '<div class="eikon-table-wrap"><table class="eikon-table">'+
          '<thead><tr><th>Day</th><th>Off</th><th>Start</th><th>End</th></tr></thead>'+
          '<tbody>'+rows+'</tbody></table></div>';

        // wa-auto-off-sync: Off checkbox reflects time inputs
        ds.forEach(function(_, i){
          var offEl = document.getElementById("wa-off-"+i);
          var stEl  = document.getElementById("wa-st-"+i);
          var etEl  = document.getElementById("wa-et-"+i);
          if(!offEl || !stEl || !etEl) return;

          function sync(){
            var off = !!offEl.checked;
            stEl.disabled = off;
            etEl.disabled = off;
            if(off){ stEl.value=""; etEl.value=""; }
          }

          offEl.onchange = sync;

          function bump(){
            if ((stEl.value||"").trim() || (etEl.value||"").trim()){
              offEl.checked = false;
              stEl.disabled = false;
              etEl.disabled = false;
            }
          }
          stEl.oninput = bump;
          etEl.oninput = bump;

          // initial
          sync();
        });
      }

      function refreshPatternChoices() {
        var sid = parseInt(empSel.value,10);
        var e = emp(sid);
        var st = getPatternState(e);
        var pats = st.patterns || [];
        var prov = st.provisionalId;
        if (!pats.length) {
          // offer blank
          patSel.innerHTML = '<option value="__blank">Blank</option>';
          renderWeekFromPattern(null);
          return;
        }
        patSel.innerHTML = pats.map(function(p){
          return '<option value="'+esc(p.id)+'"'+(p.id===prov?' selected':'')+'>'+esc(p.name)+(p.id===prov?' (provisional)':'')+'</option>';
        }).join("");
        var selPat = findPattern(st, patSel.value) || findPattern(st, prov) || pats[0];
        renderWeekFromPattern(selPat);
      }

      empSel.onchange = refreshPatternChoices;
      patSel.onchange = refreshPatternChoices;
      refreshPatternChoices();
      try{
        var modeSel = document.getElementById("wa-mode");
        var ow = document.getElementById("wa-owarn");
        var oc = document.getElementById("wa-oconf");
        function syncOverwriteConfirm(){
          if(!modeSel || !ow) return;
          var isOw = String(modeSel.value||"") === "overwrite";
          ow.style.display = isOw ? "block" : "none";
          if(!isOw && oc) oc.checked = false;
        }
        if(modeSel) modeSel.onchange = syncOverwriteConfirm;
        syncOverwriteConfirm();
      } catch(e) { console.error("[shifts][weekApply] overwrite sync error", e); }

    }, 50);
  }

function singleShiftModal(e2, ds, existing, onSave) {
    var oh=ohFor(ds);
    var body=
      '<div style="margin-bottom:10px;font-size:13px;"><b>'+esc(e2?e2.full_name:"?")+' — '+esc(ds)+'</b></div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Start</div><input class="eikon-input" id="ssm-st" type="time" value="'+(existing&&existing.start_time||oh.open||"09:00")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">End</div><input class="eikon-input" id="ssm-et" type="time" value="'+(existing&&existing.end_time||oh.close||"18:00")+'"/></div>'+
      '</div>'+
      '<div class="eikon-field" style="margin-top:8px;"><div class="eikon-label">Notes</div><input class="eikon-input" id="ssm-nt" type="text" value="'+(existing&&existing.notes||"")+'"/></div>';
    var actions=[{label:"Cancel",onClick:function(){E.modal.hide();}}];
    if(existing) actions.push({label:"Remove",danger:true,onClick:function(){
      S.shifts=S.shifts.filter(function(s){return s.id!==existing.id;});
      apiOp("/shifts/assignments/"+existing.id,{method:"DELETE"},function(){ E.modal.hide(); toast("Removed."); onSave&&onSave(); });
    }});
    actions.push({label:existing?"Update":"Add Shift",primary:true,onClick:function(){
      var st=E.q("#ssm-st").value; var et=E.q("#ssm-et").value;
      if(!st||!et){toast("Fill times","error");return;}
      if(t2m(et)<=t2m(st)){toast("End must be after start","error");return;}
      if(existing){ Object.assign(existing,{start_time:st,end_time:et,notes:E.q("#ssm-nt").value.trim()});
        apiOp("/shifts/assignments/"+existing.id,{method:"PUT",body:JSON.stringify(existing)},function(){ E.modal.hide(); toast("Updated."); onSave&&onSave(); });
      } else {
        var p={staff_id:e2.id,shift_date:ds,start_time:st,end_time:et,notes:E.q("#ssm-nt").value.trim()};
        p.id=lsNextId(); S.shifts.push(p);
        apiOp("/shifts/assignments",{method:"POST",body:JSON.stringify(p)},function(r){ if(r.shift_id)p.id=r.shift_id; E.modal.hide(); toast("Shift added."); onSave&&onSave(); });
      }
    }});
    E.modal.show((existing?"Edit":"Assign")+" Shift",body,actions);
  }

  /* ══════════════════════════════════════════════════════════════
     VIEW: SCHEDULE GRID
  ══════════════════════════════════════════════════════════════ */
  function vSchedule(m) {
    var y=S.year, mo=S.month, days=dim(y,mo);
    var all=actStaff();
    var hdr='<th style="min-width:130px;position:sticky;left:0;background:var(--panel2);z-index:1;">Employee</th>';
    for(var d=1;d<=days;d++){
      var ds=ymd(y,mo,d); var wd=new Date(ds).getDay(); var wk=wd===0||wd===6; var ph=isPH(ds);
      hdr+='<th style="text-align:center;font-size:11px;min-width:44px;'+(wk?"color:var(--muted)":"")+'">';
      hdr+=DSHORT[wd]+'<br><b>'+d+'</b>'+(ph?'<br><span style="color:var(--accent);font-size:9px;">PH</span>':'')+' </th>';
    }
    var rows="";
    if(!all.length){ rows='<tr><td colspan="'+(days+1)+'" style="text-align:center;color:var(--muted);padding:20px;">No active staff. Add employees first.</td></tr>'; }
    else all.forEach(function(e){
      var col=dc(e.designation);
      var cells='<td style="font-size:12px;font-weight:700;white-space:nowrap;padding:8px;border-right:1px solid var(--border);position:sticky;left:0;background:var(--panel);z-index:1;">'+
        '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+col+';margin-right:5px;vertical-align:middle;"></span>'+
        esc(e.full_name)+'<br><span style="font-size:10px;color:var(--muted);font-weight:400;">'+esc(dl(e.designation))+'</span></td>';
      for(var d2=1;d2<=days;d2++){
        var ds2=ymd(y,mo,d2); var oh=ohFor(ds2);
        var sh=S.shifts.find(function(s){return s.staff_id===e.id&&s.shift_date===ds2;});
        var lv=S.leaves.find(function(l){return l.staff_id===e.id&&l.status==="approved"&&l.start_date<=ds2&&l.end_date>=ds2;});
        var wd2=new Date(ds2).getDay(); var wk2=wd2===0||wd2===6;
        var bg=oh.closed?"rgba(0,0,0,.15)":wk2?"rgba(0,0,0,.06)":"transparent";
        var ct="";
        if(lv) ct='<div style="font-size:10px;color:var(--danger);text-align:center;font-weight:700;">🏖<br>Leave</div>';
        else if(sh) ct='<div style="font-size:10px;text-align:center;color:'+col+';font-weight:700;">'+(sh.start_time||"").slice(0,5)+'<br>'+(sh.end_time||"").slice(0,5)+'</div>';
        cells+='<td style="background:'+bg+';text-align:center;border:1px solid rgba(255,255,255,.03);cursor:pointer;vertical-align:middle;padding:3px;" data-empid="'+e.id+'" data-ds="'+ds2+'">'+ct+'</td>';
      }
      rows+="<tr>"+cells+"</tr>";
    });

    m.innerHTML=
      '<div class="eikon-card">'+
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">'+
      '<div style="font-weight:900;font-size:15px;">📋 Monthly Schedule — '+MONTHS[mo]+' '+y+'</div>'+
      '<div style="flex:1;"></div>'+
      '<button class="eikon-btn" id="sh-sgp">◀</button>'+
      '<button class="eikon-btn" id="sh-sgn">▶</button>'+
      '</div>'+
      '<div class="eikon-table-wrap">'+
      '<table class="eikon-table" style="min-width:'+(days*44+160)+'px;"><thead><tr>'+hdr+'</tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div>'+
      '<div style="margin-top:8px;font-size:11px;color:var(--muted);">Click any cell to assign/edit shifts for that employee on that day.</div>'+
      '</div>';

    E.q("#sh-sgp",m).onclick=function(){ S.month--; if(S.month<0){S.month=11;S.year--;} loadMonth().then(function(){vSchedule(m);}); };
    E.q("#sh-sgn",m).onclick=function(){ S.month++; if(S.month>11){S.month=0;S.year++;} loadMonth().then(function(){vSchedule(m);}); };

    m.querySelectorAll("td[data-empid]").forEach(function(td){
      td.onclick=function(){
        var eid=parseInt(td.getAttribute("data-empid")), ds=td.getAttribute("data-ds");
        var e2=emp(eid); if(!e2)return;
        var sh=S.shifts.find(function(s){return s.staff_id===eid&&s.shift_date===ds;});
        singleShiftModal(e2, ds, sh||null, function(){vSchedule(m);});
      };
    });
  }

  /* ══════════════════════════════════════════════════════════════
     VIEW: LEAVE
  ══════════════════════════════════════════════════════════════ */
  function vLeave(m) {
    var pending=S.leaves.filter(function(l){return l.status==="pending";});
    var history=S.leaves.filter(function(l){return l.status!=="pending";}).slice().reverse().slice(0,50);
    var staffOpts=actStaff().map(function(s){return '<option value="'+s.id+'">'+esc(s.full_name)+'</option>';}).join("");

    m.innerHTML=
      '<div style="display:flex;flex-direction:column;gap:14px;">'+
      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:12px;">📝 Submit Leave Request</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Employee</div><select class="eikon-select" id="sl-emp">'+staffOpts+'</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Leave Type</div>'+
      '<select class="eikon-select" id="sl-type">'+
      '<option value="annual">Annual Leave</option>'+
      '<option value="sick">Sick Leave</option>'+
      '<option value="urgent_family">Urgent Family (force majeure)</option>'+
      '<option value="maternity">Maternity Leave</option>'+
      '<option value="paternity">Paternity Leave</option>'+
      '<option value="parental">Parental Leave</option>'+
      '<option value="miscarriage">Miscarriage Leave</option>'+
      '<option value="other">Other</option>'+
      '</select></div></div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
      '<div class="eikon-field"><div class="eikon-label">Start Date</div><input class="eikon-input" id="sl-sd" type="date"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Start Time <span style="font-size:10px;color:var(--muted);">(partial day)</span></div><input class="eikon-input" id="sl-st" type="time" placeholder="leave blank = full day"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">End Date</div><input class="eikon-input" id="sl-ed" type="date"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">End Time <span style="font-size:10px;color:var(--muted);">(partial day)</span></div><input class="eikon-input" id="sl-et" type="time" placeholder="leave blank = full day"/></div>'+
      '</div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
      '<div class="eikon-field" style="flex:1;"><div class="eikon-label">Reason</div><input class="eikon-input" id="sl-rsn" type="text" placeholder="Optional"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">&nbsp;</div><button class="eikon-btn primary" id="sl-submit">Submit Request</button></div>'+
      '</div>'+
      '<div id="sl-balinfo" style="margin-top:10px;"></div>'+
      '</div>'+

      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:10px;">⏳ Pending — '+(pending.length)+' request'+(pending.length!==1?"s":"")+'</div>'+
      '<div class="eikon-table-wrap"><table class="eikon-table"><thead><tr>'+
      '<th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Hours</th><th>Reason</th><th>Coverage</th><th>Actions</th>'+
      '</tr></thead><tbody id="sl-ptb">'+
      (pending.length?pending.map(function(l){return lvRow(l,true);}).join(""):'<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:16px;">No pending requests.</td></tr>')+
      '</tbody></table></div></div>'+

      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:10px;">📋 Leave History</div>'+
      '<div class="eikon-table-wrap"><table class="eikon-table"><thead><tr>'+
      '<th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Hours</th><th>Reason</th><th>Coverage</th><th>Status</th>'+
      '</tr></thead><tbody>'+
      (history.length?history.map(function(l){return lvRow(l,false);}).join(""):'<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:16px;">No history yet.</td></tr>')+
      '</tbody></table></div></div></div>';

    function showBal(){
      var id=parseInt(E.q("#sl-emp",m).value); var b=bal(id); if(!b)return;
      E.q("#sl-balinfo",m).innerHTML=
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
        bb("Annual Leave",b.annualUsed+"h used / "+b.annualLeft+"h left",b.annualLeft<24?"#ff5a7a":"#43d17a")+
        bb("Sick Leave",b.sickUsed+"h used / "+b.sickLeft+"h left","#fb923c")+
        bb("Urgent Family",b.ufEnt+"h/yr","#a78bfa")+
        '</div>';
    }
    E.q("#sl-emp",m).onchange=function(){showBal();};
    showBal();

    E.q("#sl-submit",m).onclick=function(){submitLeave(m);};

    setTimeout(function(){
      m.querySelectorAll("[data-lv-app]").forEach(function(btn){
        btn.onclick=function(){ approveLeave(parseInt(btn.getAttribute("data-lv-app")),function(){vLeave(m);}); };
      });
      m.querySelectorAll("[data-lv-rej]").forEach(function(btn){
        btn.onclick=function(){ rejectLeave(parseInt(btn.getAttribute("data-lv-rej")),function(){vLeave(m);}); };
      });
    },60);
  }

  function bb(l,v,c){
    return '<div style="padding:8px 12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;">'+
      '<div style="font-size:11px;color:var(--muted);">'+esc(l)+'</div>'+
      '<div style="font-weight:700;color:'+c+';font-size:13px;">'+esc(v)+'</div></div>';
  }

  function lvRow(l, showAct){
    var e2=emp(l.staff_id);
    var nm=e2?e2.full_name:"?";
    var partial=(l.start_time||l.end_time)?" ("+(l.start_time||"")+"–"+(l.end_time||"")+")":"";
    var covHtml="";
    if(e2&&(e2.designation==="pharmacist")&&l.status==="pending"){
      var alts=pharmStaff().filter(function(p){return p.id!==e2.id;});
      var locAvail=actStaff().some(function(s){return s.designation==="locum";});
      if(alts.length) covHtml='<span style="color:var(--ok);font-size:11px;">✓ '+alts.length+' alt pharmacist</span>';
      else if(locAvail) covHtml='<span style="color:#fb923c;font-size:11px;">⚠ Locum available</span>';
      else covHtml='<span style="color:var(--danger);font-size:11px;font-weight:700;">⚠ Book a locum!</span>';
    }
    var stCol=l.status==="approved"?"var(--ok)":l.status==="rejected"?"var(--danger)":"#f59e0b";
    var actTd=showAct
      ?'<td><button class="eikon-btn primary" style="font-size:11px;padding:5px 8px;" data-lv-app="'+l.id+'">✓ Approve</button> <button class="eikon-btn danger" style="font-size:11px;padding:5px 8px;" data-lv-rej="'+l.id+'">✗ Reject</button></td>'
      :'<td><b style="color:'+stCol+';font-size:12px;">'+esc(l.status.toUpperCase())+'</b></td>';
    return '<tr>'+
      '<td><b>'+esc(nm)+'</b></td>'+
      '<td><span class="eikon-pill" style="font-size:11px;">'+esc(l.leave_type||"")+'</span></td>'+
      '<td>'+esc(l.start_date||"")+'</td>'+
      '<td>'+esc(l.end_date||"")+esc(partial)+'</td>'+
      '<td>'+esc(String(l.hours_requested||"—"))+'h</td>'+
      '<td style="font-size:12px;color:var(--muted);max-width:100px;">'+esc(l.reason||"—")+'</td>'+
      '<td>'+covHtml+'</td>'+actTd+'</tr>';
  }

  function submitLeave(m){
    var sid=parseInt(E.q("#sl-emp",m).value);
    var lt=E.q("#sl-type",m).value;
    var sd=E.q("#sl-sd",m).value; if(!sd){toast("Start date required","error");return;}
    var st=E.q("#sl-st",m).value;
    var ed=E.q("#sl-ed",m).value||sd;
    var et=E.q("#sl-et",m).value;
    var rsn=E.q("#sl-rsn",m).value.trim();
    var hrs=0;
    if(st&&et){ hrs=(t2m(et)-t2m(st))/60; }
    else { hrs=wdCount(sd,ed)*8; }
    var b=bal(sid);
    if(b&&lt==="annual"&&hrs>b.annualLeft){ toast("Warning: Exceeds remaining annual leave ("+b.annualLeft+"h)","error"); }
    var p={staff_id:sid,leave_type:lt,start_date:sd,start_time:st||null,end_date:ed,end_time:et||null,hours_requested:Math.max(0,+hrs.toFixed(1)),reason:rsn,status:"pending"};
    p.id=lsNextId(); S.leaves.push(p);
    apiOp("/shifts/leaves",{method:"POST",body:JSON.stringify(p)},function(r){ if(r.leave_id)p.id=r.leave_id; toast("Leave request submitted."); vLeave(m); });
  }

  function approveLeave(id, cb){
    var l=S.leaves.find(function(x){return x.id===id;}); if(!l)return;
    var e2=emp(l.staff_id);
    var isPharm=e2&&e2.designation==="pharmacist";
    var alts=isPharm?pharmStaff().filter(function(p){return p.id!==e2.id;}):[];
    var locAvail=actStaff().some(function(s){return s.designation==="locum";});

    function doApprove(){
      l.status="approved"; adjustShifts(l);
      apiOp("/shifts/leaves/"+id+"/approve",{method:"POST"},function(){ toast("Leave approved."); cb&&cb(); });
    }
    if(isPharm&&alts.length===0&&!locAvail){
      E.modal.show("⚠ Coverage Gap",
        '<div class="eikon-alert">Approving this leave creates a pharmacist coverage gap with no alternative pharmacist or locum in the team. Consider booking a locum.</div>',
        [{label:"Cancel",onClick:function(){E.modal.hide();}},{label:"Approve Anyway",danger:true,onClick:function(){E.modal.hide();doApprove();}}]);
    } else if(isPharm&&alts.length===0&&locAvail){
      E.modal.show("Locum Required",
        '<div style="padding:10px;background:rgba(247,144,9,.1);border:1px solid rgba(247,144,9,.4);border-radius:8px;font-size:13px;">A locum is in your team. Please ensure a locum shift is assigned for these dates.</div>',
        [{label:"Cancel",onClick:function(){E.modal.hide();}},{label:"Approve & Schedule Locum",primary:true,onClick:function(){E.modal.hide();doApprove();}}]);
    } else { doApprove(); }
  }

  function rejectLeave(id,cb){
    var l=S.leaves.find(function(x){return x.id===id;}); if(!l)return;
    l.status="rejected";
    apiOp("/shifts/leaves/"+id+"/reject",{method:"POST"},function(){ toast("Leave rejected."); cb&&cb(); });
  }

  function adjustShifts(l){
    S.shifts.forEach(function(s){
      if(s.staff_id!==l.staff_id) return;
      if(s.shift_date<l.start_date||s.shift_date>l.end_date) return;
      if(!l.start_time&&!l.end_time){ s._leaveRemove=true; return; }
      // Partial day adjustment
      if(l.start_time){ var shEnd=t2m(l.start_time); if(t2m(s.start_time)<shEnd) s.end_time=l.start_time; }
      if(l.end_time){ var shSt=t2m(l.end_time); if(t2m(s.end_time)>shSt) s.start_time=l.end_time; }
    });
    S.shifts=S.shifts.filter(function(s){return !s._leaveRemove;});
    lsSync();
  }

  /* ══════════════════════════════════════════════════════════════
     VIEW: INTEGRATION (iCal / Google Calendar)
  ══════════════════════════════════════════════════════════════ */
  function vIntegration(m){
    var ical=buildICal();
    m.innerHTML=
      '<div style="display:flex;flex-direction:column;gap:14px;">'+
      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:8px;">📆 Google Calendar & iCal Export</div>'+
      '<div class="eikon-help" style="margin-bottom:14px;">Export your schedule as an .ics file to import into Google Calendar, Outlook, or Apple Calendar. For a live feed, host the .ics at a public URL and subscribe via webcal:// in Google Calendar.</div>'+
      '<div class="eikon-row" style="margin-bottom:14px;">'+
      '<div class="eikon-field"><div class="eikon-label">Filter Employee</div>'+
      '<select class="eikon-select" id="si-emp">'+
      '<option value="">All Staff</option>'+
      actStaff().map(function(s){return '<option value="'+s.id+'">'+esc(s.full_name)+'</option>';}).join("")+
      '</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Month Filter</div>'+
      '<input class="eikon-input" id="si-month" type="month" value="'+S.year+"-"+pad(S.month+1)+'"/></div>'+
      '</div>'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap;">'+
      '<a id="si-dl" href="#" download="eikon-shifts.ics" class="eikon-btn primary">⬇ Download .ics</a>'+
      '<button class="eikon-btn" id="si-copy">📋 Copy webcal:// Instructions</button>'+
      '</div>'+
      '<div id="si-hint" style="margin-top:10px;"></div>'+
      '</div>'+
      '<div class="eikon-card">'+
      '<div style="font-weight:900;margin-bottom:10px;">Step-by-Step: Google Calendar</div>'+
      '<div style="font-size:13px;color:var(--muted);line-height:2;padding-left:4px;">'+
      '1. Click <b>Download .ics</b> above.<br>'+
      '2. Open <b>Google Calendar</b> → click the <b>⚙ Settings gear</b>.<br>'+
      '3. Choose <b>Import & Export</b> → <b>Import</b>.<br>'+
      '4. Select the downloaded .ics file → click Import.<br>'+
      '<br>For a <b>live updating calendar</b>:<br>'+
      '5. Host the .ics file at a public URL (e.g. yoursite.com/shifts.ics).<br>'+
      '6. In Google Calendar → <b>Other calendars</b> → <b>+ From URL</b>.<br>'+
      '7. Enter the URL. Google refreshes it every ~12-24 hours.<br>'+
      '</div></div>'+
      '<div class="eikon-card">'+
      '<div style="font-weight:900;margin-bottom:10px;">iCal Preview</div>'+
      '<pre id="si-preview" style="background:rgba(0,0,0,.3);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;color:var(--muted);"></pre>'+
      '</div></div>';

    function refresh(){
      var mv=(E.q("#si-month",m).value||"").split("-");
      var yr=mv.length===2?parseInt(mv[0]):S.year;
      var mo2=mv.length===2?parseInt(mv[1])-1:S.month;
      var eid=parseInt(E.q("#si-emp",m).value)||null;
      var ic=buildICal(yr,mo2,eid);
      var blob=new Blob([ic],{type:"text/calendar;charset=utf-8"});
      E.q("#si-dl",m).href=URL.createObjectURL(blob);
      E.q("#si-preview",m).textContent=ic.slice(0,1800)+(ic.length>1800?"…":"");
    }
    refresh();
    E.q("#si-emp",m).onchange=refresh;
    E.q("#si-month",m).onchange=refresh;
    E.q("#si-copy",m).onclick=function(){
      E.q("#si-hint",m).innerHTML='<div style="padding:10px;background:rgba(90,162,255,.1);border:1px solid rgba(90,162,255,.3);border-radius:8px;font-size:12px;">'+
        '💡 To create a live webcal:// link: host the .ics file at a public HTTPS URL, then replace <code>https://</code> with <code>webcal://</code>. Paste that link in Google Calendar → Other calendars → From URL.</div>';
    };
  }

  function buildICal(yr,mo2,empFilter){
    var y=yr!==undefined?yr:S.year, mo=mo2!==undefined?mo2:S.month;
    var lines=[
      "BEGIN:VCALENDAR","VERSION:2.0",
      "PRODID:-//Eikon Pharmacy//ShiftMgmt//EN",
      "CALSCALE:GREGORIAN","METHOD:PUBLISH",
      "X-WR-CALNAME:Eikon Pharmacy Shifts",
      "X-WR-TIMEZONE:Europe/Malta"
    ];
    S.shifts.forEach(function(s){
      var dt=s.shift_date||""; var p=dt.split("-");
      if(p.length!==3)return;
      if(+p[0]!==y||+p[1]-1!==mo)return;
      if(empFilter&&s.staff_id!==empFilter)return;
      var e2=emp(s.staff_id); var nm=e2?e2.full_name:"Staff";
      var dsStart=p[0]+p[1]+p[2]+"T"+(s.start_time||"09:00").replace(":","")+"00";
      var dsEnd=p[0]+p[1]+p[2]+"T"+(s.end_time||"18:00").replace(":","")+"00";
      lines.push("BEGIN:VEVENT","UID:eikon-sh-"+s.id+"@pharmacy.mt",
        "DTSTAMP:"+new Date().toISOString().replace(/[-:]/g,"").slice(0,15)+"Z",
        "DTSTART;TZID=Europe/Malta:"+dsStart,
        "DTEND;TZID=Europe/Malta:"+dsEnd,
        "SUMMARY:"+icalEsc(nm+(e2?" ("+dl(e2.designation)+")" : "")),
        "DESCRIPTION:"+icalEsc((s.start_time||"")+"–"+(s.end_time||"")+(s.notes?" | "+s.notes:"")),
        "END:VEVENT");
    });
    S.leaves.filter(function(l){return l.status==="approved";}).forEach(function(l){
      var e2=emp(l.staff_id); var nm=e2?e2.full_name:"Staff";
      lines.push("BEGIN:VEVENT","UID:eikon-lv-"+l.id+"@pharmacy.mt",
        "DTSTAMP:"+new Date().toISOString().replace(/[-:]/g,"").slice(0,15)+"Z",
        "DTSTART;VALUE=DATE:"+l.start_date.replace(/-/g,""),
        "DTEND;VALUE=DATE:"+addD(l.end_date,1).replace(/-/g,""),
        "SUMMARY:"+icalEsc(nm+" — "+l.leave_type+" leave"),
        "DESCRIPTION:"+icalEsc((l.reason||l.leave_type)+" | "+l.hours_requested+"h"),
        "TRANSP:TRANSPARENT","END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function icalEsc(s){ return String(s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n"); }

  /* ══════════════════════════════════════════════════════════════
     MAIN RENDER
  ══════════════════════════════════════════════════════════════ */
  async function render(ctx) {
    var mount=ctx.mount;
    E.dbg&&E.dbg("[shifts] render()");
    mount.innerHTML='<div style="padding:20px;color:var(--muted);">Loading shift data…</div>';
    try { await loadAll(); } catch(e){ E.warn&&E.warn("[shifts]",e); }

    function go(){
      var TABS=[
        {id:"calendar",    label:"📅 Calendar"},
        {id:"schedule",    label:"📋 Schedule"},
        {id:"staff",       label:"👥 Staff"},
        {id:"leave",       label:"🏖 Leave"},
        {id:"integration", label:"🔗 Integration"},
        {id:"settings",    label:"⚙️ Settings"}
      ];
      var tabBar=TABS.map(function(t){
        return '<button class="eikon-btn'+(t.id===S.tab?" primary":"")+'" data-tab="'+t.id+'" style="font-size:12px;padding:7px 11px;">'+t.label+'</button>';
      }).join("");

      // Today coverage banner
      var tn=new Date(); var tds=tn.getFullYear()+"-"+pad(tn.getMonth()+1)+"-"+pad(tn.getDate());
      var tc=checkCov(tds);
      var banner=(!tc.ok)?'<div style="margin-bottom:10px;padding:10px 14px;background:rgba(255,90,122,.12);border:1px solid rgba(255,90,122,.4);border-radius:10px;font-size:13px;font-weight:700;color:var(--danger);">⚠️ '+esc(tc.issues.join(" | "))+'</div>':"";

      mount.innerHTML=banner+
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;" id="sh-tabbar">'+tabBar+'</div>'+
        '<div id="sh-content"></div>';

      mount.querySelectorAll("[data-tab]").forEach(function(btn){
        btn.onclick=function(){ S.tab=btn.getAttribute("data-tab"); go(); };
      });

      var c=E.q("#sh-content",mount);
      if(S.tab==="calendar")    vCalendar(c);
      else if(S.tab==="schedule")    vSchedule(c);
      else if(S.tab==="staff")       vStaff(c);
      else if(S.tab==="leave")       vLeave(c);
      else if(S.tab==="integration") vIntegration(c);
      else if(S.tab==="settings")    vSettings(c);
    }
    go();
    E.dbg&&E.dbg("[shifts] render() done");
  }

  E.registerModule({
    id:    "shifts",
    title: "Shifts",
    order: 3,
    icon:  "📅",
    render: render
  });

  E.dbg&&E.dbg("[shifts] module loaded");
})();
