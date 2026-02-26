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

  /* ── Malta Employment Law Constants 2025-2026 ──────────────── */
  var MALTA = {
    annualLeaveHours: { 2023:208, 2024:240, 2025:224, 2026:216, 2027:216 },
    sickLeavePaidHours:     80,   // 10 days × 8h, employer pays
    sickLeaveHalfPayHours:  80,   // additional 10 days at half pay
    urgentFamilyLeaveHours: 32,   // updated Jan 2025 (was 15h)
    maxWeeklyHours:         48,   // EU Working Time Directive
    fullTimeWeeklyHours:    40,
    publicHolidays2026:     14,
    phWeekdays2026:         11,
    phWeekend2026:           3,
    minWageWeekly2026:    226.44  // 221.78 + 4.66 COLA
  };

  function calcEntitlement(emp) {
    var yr = new Date().getFullYear();
    var base = MALTA.annualLeaveHours[yr] || 216;
    var ratio = emp.employment_type === "fulltime" ? 1 :
                Math.min((parseFloat(emp.contracted_hours) || 20) / MALTA.fullTimeWeeklyHours, 1);
    return {
      annual:       Math.round(base * ratio),
      sick:         Math.round(MALTA.sickLeavePaidHours * ratio),
      urgentFamily: Math.round(MALTA.urgentFamilyLeaveHours * ratio)
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
    openingHours: { "default": { open:"09:00", close:"18:00", closed:false }, weekends:false, overrides:{} },
    settings:     { pharmacistRequired:true, minPharmacists:1 },
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
    } catch(err) {
      E.warn && E.warn("[shifts] API unavailable, using localStorage:", err && err.message);
      var ls = lsGet();
      S.staff        = ls.staff        || S.staff;
      S.shifts       = ls.shifts       || S.shifts;
      S.leaves       = ls.leaves       || S.leaves;
      S.openingHours = ls.openingHours || S.openingHours;
      S.settings     = ls.settings     || S.settings;
    }
  }

  async function loadMonth() {
    try {
      var r = await E.apiFetch("/shifts/assignments?year="+S.year+"&month="+(S.month+1), {method:"GET"});
      S.shifts = r.shifts || [];
    } catch(e) { /* use cached */ }
  }

  function apiOp(path, opts, onOk, merge) {
    E.apiFetch(path, opts)
      .then(function(r){ merge && merge(r); lsSync(); onOk && onOk(r); })
      .catch(function(){ merge && merge({}); lsSync(); onOk && onOk({}); });
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
    var d = new Date(ds).getDay();
    if ((d===0||d===6) && !S.openingHours.weekends) return { open:"09:00", close:"18:00", closed:true };
    return S.openingHours["default"]||{open:"09:00",close:"18:00",closed:false};
  }

  /* ── Coverage check ─────────────────────────────────────────── */
  function checkCov(ds) {
    var oh=ohFor(ds); if(oh.closed) return {ok:true,issues:[]};
    var onLeave={};
    S.leaves.filter(function(l){ return l.status==="approved"&&l.start_date<=ds&&l.end_date>=ds; })
            .forEach(function(l){ onLeave[l.staff_id]=true; });
    var phOnDuty = S.shifts.filter(function(s){
      if(s.shift_date!==ds) return false;
      if(onLeave[s.staff_id]) return false;
      var e=emp(s.staff_id);
      return e&&(e.designation==="pharmacist"||e.designation==="locum"||s.role_override==="pharmacist");
    });
    var issues = [];
    if(S.settings.pharmacistRequired && phOnDuty.length < (S.settings.minPharmacists||1))
      issues.push("No pharmacist coverage on "+ds);
    return {ok:issues.length===0, issues:issues};
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
    var edit=!!e;
    var body=
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
      '<option value="fulltime"'+(e&&e.employment_type==="fulltime"?" selected":"")+'>Full-Time (40h/wk — Malta 2026: 216h leave)</option>'+
      '<option value="parttime"'+(e&&e.employment_type==="parttime"?" selected":"")+'>Part-Time (pro-rata)</option>'+
      '</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Contracted h/wk</div>'+
      '<input class="eikon-input" id="se-hrs" type="number" min="1" max="48" value="'+(e&&e.contracted_hours||40)+'" style="min-width:80px;"/></div></div>'+
      '<div class="eikon-row" style="margin-top:10px;">'+
      '<div class="eikon-field" style="flex:1;"><div class="eikon-label">Email</div>'+
      '<input class="eikon-input" id="se-email" type="email" value="'+esc(e&&e.email||"")+'"/></div>'+
      '<div class="eikon-field" style="flex:1;"><div class="eikon-label">Phone</div>'+
      '<input class="eikon-input" id="se-phone" type="tel" value="'+esc(e&&e.phone||"")+'"/></div></div>'+
      '<div class="eikon-field" style="margin-top:10px;"><div class="eikon-label">Registration No. (Pharmacists)</div>'+
      '<input class="eikon-input" id="se-reg" type="text" value="'+esc(e&&e.registration_number||"")+'" placeholder="e.g. PH-1234"/></div>'+
      '<div style="margin-top:12px;padding:10px;background:rgba(90,162,255,.07);border:1px solid rgba(90,162,255,.2);border-radius:10px;font-size:12px;color:var(--muted);">'+
      '📋 <b>Malta 2026:</b> FT=216h annual leave. PT=pro-rata. Sick=80h paid+80h ½ pay. Urgent family=32h/yr. Max 48h/wk.</div>';
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
          is_active:1
        };
        if(!p.full_name){toast("Name required","error");return;}
        saveEmp(edit?e.id:null, p, function(){ E.modal.hide(); renderEmpRows(mountRef); toast(edit?"Employee updated.":"Employee added."); });
      }}
    ]);
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
    var def = S.openingHours["default"]||{open:"09:00",close:"18:00",closed:false};
    var ov  = S.openingHours.overrides||{};
    var ovRows = Object.keys(ov).sort().map(function(d){
      var v=ov[d];
      return '<tr><td>'+esc(d)+'</td>'+
        '<td>'+(v.closed?'<span style="color:var(--danger)">Closed</span>':esc(v.open)+"–"+esc(v.close))+'</td>'+
        '<td>'+esc(v.note||"—")+'</td>'+
        '<td><button class="eikon-btn danger sh-rm-ov" data-d="'+esc(d)+'" style="font-size:11px;padding:5px 8px;">Remove</button></td></tr>';
    }).join("")||'<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:14px;">No overrides.</td></tr>';

    m.innerHTML=
      '<div style="display:flex;flex-direction:column;gap:14px;">'+
      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:12px;">🕐 Default Opening Hours</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Open</div><input class="eikon-input" id="ss-open" type="time" value="'+esc(def.open||"09:00")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Close</div><input class="eikon-input" id="ss-close" type="time" value="'+esc(def.close||"18:00")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Weekends</div>'+
      '<select class="eikon-select" id="ss-wknd">'+
      '<option value="0"'+(S.openingHours.weekends?"":" selected")+'>Closed</option>'+
      '<option value="1"'+(S.openingHours.weekends?" selected":"")+'>Open</option>'+
      '</select></div></div>'+
      '<div style="margin-top:12px;"><button class="eikon-btn primary" id="ss-savehours">Save Hours</button></div></div>'+

      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:4px;">📅 Exceptional Day Overrides</div>'+
      '<div class="eikon-help" style="margin-bottom:12px;">Override hours for a specific date (public holiday, half day, emergency).</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Date</div><input class="eikon-input" id="ss-ovd" type="date"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">Type</div>'+
      '<select class="eikon-select" id="ss-ovt"><option value="custom">Custom Hours</option><option value="closed">Fully Closed</option></select></div>'+
      '<div class="eikon-field" id="ss-ovta"><div class="eikon-label">Open</div><input class="eikon-input" id="ss-ovo" type="time" value="09:00"/></div>'+
      '<div class="eikon-field" id="ss-ovtb"><div class="eikon-label">Close</div><input class="eikon-input" id="ss-ovc" type="time" value="13:00"/></div>'+
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
      '<option value="1"'+(S.settings.pharmacistRequired?" selected":"")+'>Yes — Alert when no pharmacist scheduled</option>'+
      '<option value="0"'+(S.settings.pharmacistRequired?"":" selected")+'>No — Informational</option>'+
      '</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Min Pharmacists On Duty</div>'+
      '<input class="eikon-input" id="ss-mph" type="number" min="1" max="5" value="'+(S.settings.minPharmacists||1)+'" style="min-width:80px;"/></div>'+
      '</div>'+
      '<div style="margin-top:12px;"><button class="eikon-btn primary" id="ss-saverules">Save Rules</button></div></div>'+

      '<div class="eikon-card">'+
      '<div style="font-weight:900;font-size:15px;margin-bottom:10px;">📋 Malta Employment Law Reference 2026</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;">'+
      rcard("Annual Leave FT 2026","216h (27 days)","#5aa2ff")+
      rcard("Annual Leave FT 2025","224h (28 days)","#5aa2ff")+
      rcard("Annual Leave FT 2024","240h (30 days)","#5aa2ff")+
      rcard("Sick Leave Paid","80h (10 days)","#fb923c")+
      rcard("Sick Leave ½ Pay","80h (10 days)","#fb923c")+
      rcard("Urgent Family Leave","32h / year (2025+)","#43d17a")+
      rcard("Maternity Leave","18 weeks","#f472b6")+
      rcard("Paternity Leave","10 working days","#38bdf8")+
      rcard("Parental Leave","4 months (2 paid)","#a78bfa")+
      rcard("Miscarriage Leave","7 calendar days (2026+)","#94a3b8")+
      rcard("Max Weekly Hours","48h (EU WTD)","#ff5a7a")+
      rcard("COLA 2026","€4.66/week","#43d17a")+
      rcard("Min Wage 2026","€226.44/wk","#43d17a")+
      rcard("Part-time Leave","Pro-rata (avg hrs / 40)","#64748b")+
      '</div></div></div>';

    var ovType = E.q("#ss-ovt",m);
    ovType.onchange=function(){
      var c=ovType.value==="custom";
      E.q("#ss-ovta",m).style.display=c?"":"none";
      E.q("#ss-ovtb",m).style.display=c?"":"none";
    };

    E.q("#ss-savehours",m).onclick=function(){
      S.openingHours["default"]={open:E.q("#ss-open",m).value, close:E.q("#ss-close",m).value, closed:false};
      S.openingHours.weekends=E.q("#ss-wknd",m).value==="1";
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

    m.querySelectorAll(".sh-rm-ov").forEach(function(btn){
      btn.onclick=function(){
        var d=btn.getAttribute("data-d"); delete S.openingHours.overrides[d];
        apiOp("/shifts/opening-hours",{method:"PUT",body:JSON.stringify(S.openingHours)},function(){toast("Override removed."); vSettings(m);});
      };
    });
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
    for(var r=0;r<6;r++){
      var row="<tr>"; var anyReal=false;
      for(var c=0;c<7;c++,cellDay++){
        if(cellDay<1||cellDay>days){
          row+='<td style="background:rgba(0,0,0,.12);height:84px;"></td>';
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
            return '<div style="font-size:10px;padding:2px 5px;border-radius:5px;margin-top:2px;background:'+col+'1a;border:1px solid '+col+'55;color:'+col+';'+extra+'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" title="'+esc(e.full_name)+(lv?" (on leave)":"")+'">'+esc(e.full_name.split(" ")[0])+(s.start_time?" "+s.start_time.slice(0,5):"")+'</div>';
          }).join("");
          var lvPills=Object.keys(onLeaveMap).filter(function(sid){
            return !dayShifts.some(function(s){return s.staff_id==sid;});
          }).map(function(sid){
            var e=emp(+sid); if(!e)return"";
            return '<div style="font-size:10px;padding:2px 5px;border-radius:5px;margin-top:2px;background:rgba(255,90,122,.12);border:1px solid rgba(255,90,122,.3);color:var(--danger);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">🏖'+esc(e.full_name.split(" ")[0])+'</div>';
          }).join("");
          row+='<td style="vertical-align:top;padding:6px;background:'+bg+';border:1px solid '+bc+';cursor:pointer;height:84px;width:14.28%;position:relative;" data-date="'+ds+'">'+
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px;">'+
            '<span style="font-weight:700;font-size:13px;color:'+(isWknd?"var(--muted)":"var(--text)")+';">'+cellDay+'</span>'+
            (ph?'<span style="font-size:9px;background:rgba(90,162,255,.2);color:var(--accent);border-radius:3px;padding:1px 3px;">PH</span>':"")+'</div>'+
            '<div style="font-size:9px;color:var(--muted);margin-bottom:2px;">'+(oh.closed?"CLOSED":(oh.open||"")+"–"+(oh.close||""))+'</div>'+
            (!cov.ok&&!oh.closed?'<div style="font-size:9px;color:var(--danger);font-weight:700;">⚠ No pharm.</div>':"")+
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
      '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;min-width:560px;">'+
      '<thead><tr>'+DSHORT.map(function(d){return '<th style="text-align:center;padding:8px;font-size:12px;color:var(--muted);">'+d+'</th>';}).join("")+'</tr></thead>'+
      '<tbody>'+cells+'</tbody></table></div>'+
      '<div style="margin-top:8px;font-size:11px;color:var(--muted);">💡 Click any day to manage shifts. <span style="color:var(--danger)">Red border</span> = missing pharmacist. <span style="color:var(--accent)">PH</span> = Public Holiday.</div>'+
      '</div>';

    E.q("#sh-cp",m).onclick=function(){ S.month--; if(S.month<0){S.month=11;S.year--;} loadMonth().then(function(){vCalendar(m);}); };
    E.q("#sh-cn",m).onclick=function(){ S.month++; if(S.month>11){S.month=0;S.year++;} loadMonth().then(function(){vCalendar(m);}); };
    E.q("#sh-ct",m).onclick=function(){ var n=new Date(); S.year=n.getFullYear(); S.month=n.getMonth(); loadMonth().then(function(){vCalendar(m);}); };

    m.querySelectorAll("td[data-date]").forEach(function(td){
      td.onclick=function(){ dayModal(td.getAttribute("data-date"), function(){vCalendar(m);}); };
    });
  }

  function dayModal(ds, onSave) {
    var oh=ohFor(ds);
    var dayShifts=S.shifts.filter(function(s){return s.shift_date===ds;});
    var dayLeaves=S.leaves.filter(function(l){return l.status==="approved"&&l.start_date<=ds&&l.end_date>=ds;});
    var onLeaveMap={}; dayLeaves.forEach(function(l){onLeaveMap[l.staff_id]=l;});
    var cov=checkCov(ds);
    var ph=isPH(ds);
    var allPharm=pharmStaff();
    var pharmOnDuty=dayShifts.filter(function(s){ return !onLeaveMap[s.staff_id] && (function(e){ return e&&(e.designation==="pharmacist"||e.designation==="locum"); })(emp(s.staff_id)); });
    var staffOpts=actStaff().map(function(s){ return '<option value="'+s.id+'">'+esc(s.full_name)+' ('+esc(dl(s.designation))+')</option>'; }).join("");

    var covBanner="";
    if(S.settings.pharmacistRequired && pharmOnDuty.length===0 && !oh.closed){
      var alts=allPharm.filter(function(p){ return !dayShifts.some(function(s){return s.staff_id===p.id;}); });
      var locumAvail=actStaff().some(function(s){return s.designation==="locum";});
      covBanner='<div style="padding:8px 10px;background:rgba(255,90,122,.1);border:1px solid rgba(255,90,122,.35);border-radius:8px;font-size:12px;margin-bottom:10px;">'+
        '⚠️ <b>No pharmacist coverage!</b> '+(alts.length?" Assign: "+alts.slice(0,2).map(function(a){return esc(a.full_name);}).join(", ")+".":(locumAvail?" Assign available locum.":" Consider booking a locum."))+'</div>';
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

    var body=
      '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">'+esc(ds)+
      (ph?' <span style="color:var(--accent);font-weight:700;">— Public Holiday</span>':"")+
      ' | '+(oh.closed?'<span style="color:var(--danger)">CLOSED</span>':esc(oh.open||"")+'–'+esc(oh.close||""))+'</div>'+
      covBanner+lvRow+
      '<div style="font-weight:700;margin-bottom:8px;">Current Shifts</div>'+
      '<div id="dm-shifts">'+shiftRows+'</div>'+
      '<hr style="border-color:var(--border);margin:12px 0;"/>'+
      '<div style="font-weight:700;margin-bottom:8px;">Add Shift</div>'+
      '<div class="eikon-row">'+
      '<div class="eikon-field"><div class="eikon-label">Employee</div><select class="eikon-select" id="dm-emp">'+staffOpts+'</select></div>'+
      '<div class="eikon-field"><div class="eikon-label">Start</div><input class="eikon-input" id="dm-st" type="time" value="'+(oh.open||"09:00")+'"/></div>'+
      '<div class="eikon-field"><div class="eikon-label">End</div><input class="eikon-input" id="dm-et" type="time" value="'+(oh.close||"18:00")+'"/></div>'+
      '</div>'+
      '<div class="eikon-field" style="margin-top:8px;"><div class="eikon-label">Notes</div><input class="eikon-input" id="dm-nt" type="text" placeholder="optional"/></div>';

    E.modal.show("Shifts — "+ds, body, [
      {label:"Close", onClick:function(){E.modal.hide();}},
      {label:"Add Shift", primary:true, onClick:function(){
        var sid=parseInt(E.q("#dm-emp").value);
        var st=E.q("#dm-st").value; var et=E.q("#dm-et").value;
        if(!sid||!st||!et){toast("Fill all fields","error");return;}
        if(t2m(et)<=t2m(st)){toast("End must be after start","error");return;}
        var p={staff_id:sid,shift_date:ds,start_time:st,end_time:et,notes:E.q("#dm-nt").value.trim()};
        p.id=lsNextId(); S.shifts.push(p);
        apiOp("/shifts/assignments",{method:"POST",body:JSON.stringify(p)},function(r){ if(r.shift_id)p.id=r.shift_id; E.modal.hide(); toast("Shift added."); onSave&&onSave(); });
      }}
    ]);

    setTimeout(function(){
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
