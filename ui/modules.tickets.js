(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ------------------------------------------------------------
  // Debug helpers
  // ------------------------------------------------------------
  function log()  { E.log.apply(E,  ["[tickets]"].concat([].slice.call(arguments))); }
  function dbg()  { E.dbg.apply(E,  ["[tickets]"].concat([].slice.call(arguments))); }
  function warn() { E.warn.apply(E, ["[tickets]"].concat([].slice.call(arguments))); }
  function err()  { E.error.apply(E,["[tickets]"].concat([].slice.call(arguments))); }

  // ------------------------------------------------------------
  // Utility helpers
  // ------------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function escHtml(s) { return esc(s); }
  function norm(s)    { return String(s == null ? "" : s).toLowerCase().trim(); }

  function pad2(n) { return String(n).padStart(2,"0"); }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
  }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s||"")); }
  function fmtDmyFromYmd(s) {
    if (!isYmd(s)) return s || "";
    var p = s.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function fmtTs(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return pad2(d.getDate()) + "/" + pad2(d.getMonth()+1) + "/" + d.getFullYear() +
             " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    } catch(e) { return iso; }
  }

  function validEmail(s) {
    var v = String(s||"").trim();
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function rowSearchBlob(r) {
    var notesText = "";
    try {
      var arr = typeof r.notes_log === "string" ? JSON.parse(r.notes_log) : (Array.isArray(r.notes_log) ? r.notes_log : []);
      notesText = arr.map(function(n){ return norm(n.text); }).join(" ");
    } catch(e){}
    return (
      norm(r.ticket_id)   + " | " + norm(r.open_date)    + " | " +
      norm(r.client_name) + " | " + norm(r.phone)        + " | " +
      norm(r.email)       + " | " + norm(r.category)     + " | " +
      norm(r.issue)       + " | " + norm(r.assigned_to)  + " | " +
      norm(r.status)      + " | " + norm(r.followup_date)+ " | " +
      notesText
    );
  }

  // ------------------------------------------------------------
  // Category persistence (localStorage)
  // ------------------------------------------------------------
  var CATS_KEY  = "eikon_tickets_cats_v1";
  var STAFF_KEY = "eikon_tickets_staff_v1";

  var DEFAULT_CATS  = ["Billing", "Prescription", "Product Complaint", "Delivery", "General Enquiry"];
  var DEFAULT_STAFF = ["John Agius"];

  function loadCats() {
    try {
      var raw = window.localStorage.getItem(CATS_KEY);
      if (!raw) return DEFAULT_CATS.slice();
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : DEFAULT_CATS.slice();
    } catch(e) { return DEFAULT_CATS.slice(); }
  }
  function saveCats(arr) {
    try { window.localStorage.setItem(CATS_KEY, JSON.stringify(arr||[])); } catch(e){}
  }
  function addCat(name) {
    var arr = loadCats();
    var n = String(name||"").trim();
    if (!n) return arr;
    if (arr.map(function(c){return norm(c);}).indexOf(norm(n)) >= 0) return arr;
    arr.push(n);
    saveCats(arr);
    return arr;
  }

  function loadStaff() {
    try {
      var raw = window.localStorage.getItem(STAFF_KEY);
      if (!raw) return DEFAULT_STAFF.slice();
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : DEFAULT_STAFF.slice();
    } catch(e) { return DEFAULT_STAFF.slice(); }
  }
  function saveStaff(arr) {
    try { window.localStorage.setItem(STAFF_KEY, JSON.stringify(arr||[])); } catch(e){}
  }
  function addStaff(name) {
    var arr = loadStaff();
    var n = String(name||"").trim();
    if (!n) return arr;
    if (arr.map(function(s){return norm(s);}).indexOf(norm(n)) >= 0) return arr;
    arr.push(n);
    saveStaff(arr);
    return arr;
  }

  // ------------------------------------------------------------
  // Ticket ID generator
  // ------------------------------------------------------------
  var TKID_KEY = "eikon_tickets_seq_v1";
  function nextTicketId() {
    try {
      var raw = window.localStorage.getItem(TKID_KEY);
      var seq = raw ? (parseInt(raw,10)||0) : 0;
      seq++;
      window.localStorage.setItem(TKID_KEY, String(seq));
      return "TKT-" + String(seq).padStart(5,"0");
    } catch(e) {
      return "TKT-" + String(Date.now()).slice(-5);
    }
  }

  // ------------------------------------------------------------
  // Toasts + modal helpers
  // ------------------------------------------------------------
  var toastInstalled = false;
  function ensureToastStyles() {
    if (toastInstalled) return;
    toastInstalled = true;
    var st = document.createElement("style");
    st.textContent =
      ".eikon-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".eikon-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);}" +
      ".eikon-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
      ".eikon-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".eikon-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".eikon-toast.bad{border-color:rgba(255,90,122,.35);}";
    document.head.appendChild(st);
  }
  function toast(title, message, kind, ms) {
    ensureToastStyles();
    var wrap = document.getElementById("eikon-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "eikon-toast-wrap";
      wrap.className = "eikon-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "eikon-toast " + (kind||"");
    var ti = document.createElement("div"); ti.className = "t-title"; ti.textContent = title||"Info";
    var tm = document.createElement("div"); tm.className = "t-msg";   tm.textContent = message||"";
    t.appendChild(ti); t.appendChild(tm);
    wrap.appendChild(t);
    setTimeout(function(){ try{t.remove();}catch(e){} }, typeof ms==="number"?ms:2600);
  }
  function modalError(title, e) {
    var msg = (e && e.message) ? e.message : String(e||"Unknown error");
    try {
      E.modal.show(title||"Error", "<div style='white-space:pre-wrap;font-size:13px;color:rgba(255,90,122,.9);'>"+esc(msg)+"</div>",
        [{label:"Close", primary:true, onClick:function(){E.modal.hide();}}]);
    } catch(e2){ toast(title||"Error", msg, "bad"); }
  }
  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function(resolve){
      try {
        E.modal.show(title||"Confirm","<div class='eikon-mini'>"+esc(bodyText||"")+"</div>",[
          {label:cancelLabel||"Cancel", onClick:function(){E.modal.hide();resolve(false);}},
          {label:okLabel||"OK", danger:true, onClick:function(){E.modal.hide();resolve(true);}}
        ]);
      } catch(e){ resolve(window.confirm(bodyText||"Are you sure?")); }
    });
  }

  // ------------------------------------------------------------
  // Local fallback storage
  // ------------------------------------------------------------
  var LS_KEY      = "eikon_tickets_v1";
  var LS_PREF_KEY = "eikon_tickets_pref_allow500";

  function lsRead() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return {seq:0, entries:[]};
      var obj = JSON.parse(raw);
      if (!obj||typeof obj!=="object") return {seq:0, entries:[]};
      if (!Array.isArray(obj.entries)) obj.entries = [];
      if (typeof obj.seq!=="number") obj.seq = 0;
      return obj;
    } catch(e){ return {seq:0, entries:[]}; }
  }
  function lsWrite(obj) {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(obj||{seq:0,entries:[]})); } catch(e){}
  }
  function localList()   { return lsRead().entries.slice(); }
  function localCreate(payload) {
    var db = lsRead();
    db.seq = (Number(db.seq)||0)+1;
    var id = "L"+String(Date.now())+"_"+String(db.seq);
    var row = Object.assign({}, payload, {id:id});
    db.entries.unshift(row);
    lsWrite(db);
    return {ok:true, id:id};
  }
  function localUpdate(id, payload) {
    var db = lsRead();
    var sid = String(id);
    for (var i=0;i<db.entries.length;i++) {
      if (String(db.entries[i].id)===sid) {
        db.entries[i] = Object.assign({}, db.entries[i], payload);
        lsWrite(db); return {ok:true};
      }
    }
    return {ok:false, error:"Not found"};
  }
  function localDelete(id) {
    var db = lsRead();
    db.entries = db.entries.filter(function(r){return String(r.id)!==String(id);});
    lsWrite(db); return {ok:true};
  }

  function getAllow500Fallback() {
    try {
      var url = new URL(window.location.href);
      var qp = (url.searchParams.get("tk_allow500")||"").trim();
      if (qp==="1"||qp.toLowerCase()==="true") return true;
      if (qp==="0"||qp.toLowerCase()==="false") return false;
    } catch(e){}
    try { return String(window.localStorage.getItem(LS_PREF_KEY)||"")==="1"; } catch(e2){ return false; }
  }
  function shouldFallback(e, allow500) {
    var st = e&&typeof e.status==="number"?e.status:null;
    if (st===401||st===403) return false;
    if (st===404) return true;
    if (!st) return true;
    if (st>=500) return !!allow500;
    return false;
  }

  // ------------------------------------------------------------
  // API wrapper
  // ------------------------------------------------------------
  var reqSeq = 0;
  async function apiFetch(path, options, tag) {
    reqSeq++;
    var reqId = "TK#"+String(reqSeq)+"-"+String(Date.now());
    var method = (options&&options.method)?String(options.method).toUpperCase():"GET";
    dbg("[tickets]",reqId,"->",method,path);
    var t0 = Date.now();
    try {
      var out = await E.apiFetch(path, options||{});
      dbg("[tickets]",reqId,"<- OK",String(Date.now()-t0)+"ms");
      return out;
    } catch(e) {
      err("[tickets]",reqId,"<- FAIL",{status:e&&e.status,message:e&&e.message});
      throw e;
    }
  }

  async function apiList() {
    var allow500 = getAllow500Fallback();
    try {
      var resp = await apiFetch("/client-tickets/entries",{method:"GET"},"list");
      var entries = Array.isArray(resp)?resp:(resp&&Array.isArray(resp.entries)?resp.entries:[]);
      return {mode:"api", entries:entries};
    } catch(e) {
      if (shouldFallback(e,allow500)) {
        warn("[tickets] apiList fallback to local",{status:e&&e.status});
        return {mode:"local", entries:localList()};
      }
      throw e;
    }
  }
  async function apiCreate(payload) {
    var allow500 = getAllow500Fallback();
    try {
      var resp = await apiFetch("/client-tickets/entries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)},"create");
      return resp;
    } catch(e) {
      if (shouldFallback(e,allow500)) { warn("[tickets] create fallback"); return localCreate(payload); }
      throw e;
    }
  }
  async function apiUpdate(id, payload) {
    var allow500 = getAllow500Fallback();
    try {
      var resp = await apiFetch("/client-tickets/entries/"+encodeURIComponent(String(id)),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)},"update");
      return resp;
    } catch(e) {
      if (shouldFallback(e,allow500)) { warn("[tickets] update fallback"); return localUpdate(id,payload); }
      throw e;
    }
  }
  async function apiDelete(id) {
    var allow500 = getAllow500Fallback();
    try {
      var resp = await apiFetch("/client-tickets/entries/"+encodeURIComponent(String(id)),{method:"DELETE"},"delete");
      return resp;
    } catch(e) {
      if (shouldFallback(e,allow500)) { warn("[tickets] delete fallback"); return localDelete(id); }
      throw e;
    }
  }

  // ------------------------------------------------------------
  // Data mapping + validation
  // ------------------------------------------------------------
  function parseNotesLog(raw) {
    if (Array.isArray(raw)) return raw;
    try {
      var arr = JSON.parse(String(raw||"[]"));
      return Array.isArray(arr)?arr:[];
    } catch(e){ return []; }
  }

  function mapApiRow(r) {
    r = r||{};
    return {
      id:           r.id!=null ? r.id : null,
      ticket_id:    String(r.ticket_id||"").trim(),
      open_date:    String(r.open_date||"").trim(),
      client_name:  String(r.client_name||"").trim(),
      phone:        String(r.phone||"").trim(),
      email:        String(r.email||"").trim(),
      category:     String(r.category||"").trim(),
      priority:     Number(r.priority||2),
      status:       String(r.status||"Open").trim(),
      issue:        String(r.issue||"").trim(),
      assigned_to:  String(r.assigned_to||"").trim(),
      followup_date:String(r.followup_date||"").trim(),
      notes_log:    JSON.stringify(parseNotesLog(r.notes_log)),
      resolved:     !!(r.resolved),
      resolved_at:  String(r.resolved_at||"").trim()
    };
  }

  function validateAndBuild(p) {
    var name = String(p.client_name||"").trim();
    if (!name) throw new Error("Client name is required.");
    var issue = String(p.issue||"").trim();
    if (!issue) throw new Error("Issue description is required.");
    var cat = String(p.category||"").trim();
    if (!cat) throw new Error("Category is required.");
    var pr = Number(p.priority||2);
    if (pr!==1&&pr!==2&&pr!==3) pr=2;
    if (p.email && !validEmail(p.email)) throw new Error("Invalid email address.");
    var status = String(p.status||"Open").trim();
    var validStatuses = ["Open","In Progress","Awaiting Client","Resolved","Closed"];
    if (validStatuses.indexOf(status)<0) status="Open";
    return {
      ticket_id:    String(p.ticket_id||"").trim(),
      open_date:    isYmd(p.open_date)?p.open_date:todayYmd(),
      client_name:  name,
      phone:        String(p.phone||"").trim(),
      email:        String(p.email||"").trim(),
      category:     cat,
      priority:     pr,
      status:       status,
      issue:        issue,
      assigned_to:  String(p.assigned_to||"").trim(),
      followup_date:isYmd(p.followup_date)?p.followup_date:"",
      notes_log:    typeof p.notes_log==="string"?p.notes_log:JSON.stringify(parseNotesLog(p.notes_log)),
      resolved:     (status==="Resolved"||status==="Closed"),
      resolved_at:  String(p.resolved_at||"").trim()
    };
  }

  // ------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------
  var tkStyleInstalled = false;
  function ensureStyles() {
    if (tkStyleInstalled) return;
    tkStyleInstalled = true;
    var st = document.createElement("style");
    st.id = "eikon-tickets-style";
    st.textContent =
      ".tk-wrap{max-width:1400px;margin:0 auto;padding:16px;}" +
      ".tk-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px;}" +
      ".tk-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".tk-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +
      ".tk-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +
      ".tk-actions{display:flex;gap:10px;align-items:flex-end;}" +
      ".tk-field{display:flex;flex-direction:column;gap:4px;}" +
      ".tk-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +

      // Cards
      ".tk-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:12px;" +
      "background:var(--panel,rgba(16,24,36,.66));box-shadow:0 18px 50px rgba(0,0,0,.38);" +
      "backdrop-filter:blur(10px);}" +
      ".tk-card+.tk-card{margin-top:12px;}" +
      ".tk-card-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".tk-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      ".tk-card-head .meta{font-size:12px;color:var(--muted,rgba(233,238,247,.68));font-weight:800;}" +
      ".tk-card-head .right{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:flex-end;}" +

      // Table
      ".tk-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.18);}" +
      ".tk-table{width:max-content;min-width:100%;border-collapse:collapse;table-layout:auto;color:var(--text,#e9eef7);}" +
      ".tk-table th,.tk-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:8px 10px;font-size:12px;vertical-align:middle;overflow-wrap:normal;word-break:normal;}" +
      ".tk-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:1000;text-align:left;cursor:pointer;user-select:none;white-space:nowrap;}" +
      ".tk-table th.noclick{cursor:default;}" +
      ".tk-table tbody tr:hover{background:rgba(255,255,255,.04);cursor:pointer;}" +
      ".tk-row-sel{background:rgba(58,160,255,.10)!important;outline:1px solid rgba(58,160,255,.25);}" +
      ".tk-row-sel:hover{background:rgba(58,160,255,.12)!important;}" +

      // Sort
      ".tk-sort{display:inline-flex;gap:6px;align-items:center;}" +
      ".tk-sort .car{opacity:.55;font-size:11px;}" +
      ".tk-sort.on .car{opacity:1;}" +

      // Priority badges — 1=red, 2=orange, 3=green
      ".tk-pr{display:inline-flex;align-items:center;gap:7px;font-weight:900;font-size:12px;}" +
      ".tk-dot{width:10px;height:10px;border-radius:999px;display:inline-block;flex-shrink:0;border:1px solid rgba(255,255,255,.18);}" +
      ".tk-dot.p1{background:rgba(255,90,122,.95);}" +
      ".tk-dot.p2{background:rgba(255,157,67,.95);}" +
      ".tk-dot.p3{background:rgba(67,209,122,.95);}" +

      // Status chips
      ".tk-status{display:inline-block;font-size:11px;font-weight:900;padding:3px 9px;border-radius:999px;letter-spacing:.3px;white-space:nowrap;}" +
      ".tk-status.s-open{background:rgba(58,160,255,.18);border:1px solid rgba(58,160,255,.38);color:#7dc8ff;}" +
      ".tk-status.s-inprogress{background:rgba(255,157,67,.16);border:1px solid rgba(255,157,67,.38);color:#ffbe7d;}" +
      ".tk-status.s-awaiting{background:rgba(255,204,90,.14);border:1px solid rgba(255,204,90,.35);color:#ffd97a;}" +
      ".tk-status.s-resolved{background:rgba(67,209,122,.16);border:1px solid rgba(67,209,122,.35);color:#6de0a0;}" +
      ".tk-status.s-closed{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:rgba(233,238,247,.55);}" +

      // Selected panel
      ".tk-selected{margin-bottom:12px;}" +
      ".tk-sel-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px;}" +
      ".tk-kv{border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(10,16,24,.22);padding:10px;}" +
      ".tk-kv .k{font-size:10px;font-weight:1000;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;}" +
      ".tk-kv .v{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;word-break:break-word;}" +
      ".tk-kv.wide{grid-column:1/-1;}" +
      ".tk-kv.half{grid-column:span 2;}" +

      // Notes log timeline
      ".tk-notes-log{border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(10,16,24,.22);padding:12px;}" +
      ".tk-notes-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;}" +
      ".tk-notes-head .nl{font-size:10px;font-weight:1000;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.8px;}" +
      ".tk-note-entry{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);margin-bottom:6px;}" +
      ".tk-note-entry:last-child{margin-bottom:0;}" +
      ".tk-note-meta{display:flex;gap:10px;align-items:center;font-size:10px;color:var(--muted,rgba(233,238,247,.55));font-weight:800;}" +
      ".tk-note-author{color:rgba(90,162,255,.9);}" +
      ".tk-note-text{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;word-break:break-word;line-height:1.5;}" +
      ".tk-notes-empty{font-size:12px;color:var(--muted,rgba(233,238,247,.45));font-style:italic;padding:4px 0;}" +

      // Selected actions
      ".tk-sel-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:flex-end;margin-top:10px;}" +
      ".tk-sel-actions .eikon-btn{min-width:100px;}" +

      // Mode badge
      ".tk-mode{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:900;color:rgba(233,238,247,.78);}" +
      ".tk-badge{font-size:11px;font-weight:1000;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(10,16,24,.35);}" +
      ".tk-badge.local{border-color:rgba(255,200,90,.28);}" +
      ".tk-badge.err{border-color:rgba(255,90,122,.35);}" +

      // Modal form inputs
      "#tk-open-date,#tk-client,#tk-phone,#tk-email,#tk-assigned,#tk-followup,#tk-new-cat,#tk-new-staff{" +
      "width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "transition:border-color 120ms,box-shadow 120ms,background 120ms;" +
      "}" +
      "#tk-open-date,#tk-followup{color-scheme:dark;}" +
      "#tk-issue,#tk-add-note-text{" +
      "width:100%;min-height:80px;resize:vertical;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "transition:border-color 120ms,box-shadow 120ms,background 120ms;" +
      "}" +
      "#tk-category,#tk-priority,#tk-status{" +
      "width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;color-scheme:dark;" +
      "}" +
      "#tk-open-date:focus,#tk-client:focus,#tk-phone:focus,#tk-email:focus,#tk-assigned:focus," +
      "#tk-followup:focus,#tk-issue:focus,#tk-new-cat:focus,#tk-add-note-text:focus,#tk-new-staff:focus{" +
      "border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);" +
      "}" +
      "#tk-new-cat-wrap,#tk-new-staff-wrap{margin-top:8px;}" +

      // Clamp
      ".tk-clamp{max-width:260px;}" +
      ".tk-clamp-inner{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}" +

      // Search
      "#tk-search-open,#tk-search-resolved{color-scheme:dark;width:100%;padding:9px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;}" +
      "#tk-search-open:focus,#tk-search-resolved:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);}" +

      "@media(max-width:980px){.tk-sel-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.tk-kv.wide{grid-column:1/-1;}.tk-kv.half{grid-column:1/-1;}}" +
      "@media(max-width:600px){.tk-sel-grid{grid-template-columns:1fr;}.tk-kv.wide,.tk-kv.half{grid-column:1/-1;}.tk-sel-actions{justify-content:stretch;}.tk-sel-actions .eikon-btn{flex:1;}}" +
      "@media(max-width:920px){.tk-wrap{padding:12px;}.tk-controls{width:100%;}}";

    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Priority badge builder
  // ------------------------------------------------------------
  function prBadge(priority) {
    var p = Number(priority||2);
    if (p!==1&&p!==2&&p!==3) p=2;
    var wrap = document.createElement("span"); wrap.className = "tk-pr";
    var dot  = document.createElement("span"); dot.className  = "tk-dot "+(p===1?"p1":p===2?"p2":"p3");
    var txt  = document.createElement("span"); txt.textContent = String(p)+" — "+(p===1?"High":p===2?"Medium":"Low");
    wrap.appendChild(dot); wrap.appendChild(txt);
    return wrap;
  }

  function statusCls(s) {
    var map = {"Open":"s-open","In Progress":"s-inprogress","Awaiting Client":"s-awaiting","Resolved":"s-resolved","Closed":"s-closed"};
    return map[s]||"s-open";
  }
  function statusBadge(s) {
    var span = document.createElement("span");
    span.className = "tk-status "+statusCls(s||"Open");
    span.textContent = s||"Open";
    return span;
  }

  // ------------------------------------------------------------
  // Category & status helpers for dropdowns
  // ------------------------------------------------------------
  function buildCatOptions(selected) {
    var cats = loadCats();
    var html = "";
    cats.forEach(function(c){ html += "<option value='"+esc(c)+"'"+(norm(c)===norm(selected)?" selected":"")+">"+(esc(c))+"</option>"; });
    html += "<option value='__new__'"+(selected==="__new__"?" selected":"")+">\u2795 Add new category\u2026</option>";
    return html;
  }
  function buildStaffOptions(selected) {
    var staff = loadStaff();
    var html = "<option value=''>\u2014 Unassigned \u2014</option>";
    staff.forEach(function(s){ html += "<option value='"+esc(s)+"'"+(norm(s)===norm(selected)?" selected":"")+">"+(esc(s))+"</option>"; });
    html += "<option value='__new__'"+(selected==="__new__"?" selected":"")+">\u2795 Add new staff\u2026</option>";
    return html;
  }
  function buildStatusOptions(selected) {
    var statuses = ["Open","In Progress","Awaiting Client","Resolved","Closed"];
    return statuses.map(function(s){ return "<option value='"+esc(s)+"'"+(s===selected?" selected":"")+">"+esc(s)+"</option>"; }).join("");
  }

  // ------------------------------------------------------------
  // Sorting
  // ------------------------------------------------------------
  function cmp(a,b){ if(a<b)return -1; if(a>b)return 1; return 0; }
  function getSortVal(r,key) {
    var v = r?r[key]:"";
    if (key==="priority") return Number(v||2);
    if (key==="resolved") return r&&r.resolved?1:0;
    if (key==="open_date"||key==="followup_date") return String(v||"");
    return norm(v);
  }
  function sortList(list, sortState) {
    var key = sortState&&sortState.key?String(sortState.key):"open_date";
    var dir = sortState&&sortState.dir?String(sortState.dir):"desc";
    var mul = dir==="desc"?-1:1;
    list.sort(function(ra,rb){
      var a = getSortVal(ra,key), b = getSortVal(rb,key);
      var c = 0;
      if (key==="priority"||key==="resolved") c = cmp(Number(a||0),Number(b||0));
      else c = cmp(String(a||""),String(b||""));
      if (c!==0) return c*mul;
      var ia=String((ra&&ra.id)||""), ib=String((rb&&rb.id)||"");
      if (ia<ib) return 1; if (ia>ib) return -1; return 0;
    });
    return list;
  }

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  var state = {
    entries: [],
    mode: "api",
    lastError: null,
    queryOpen: "",
    queryResolved: "",
    sortOpen:     {key:"priority", dir:"asc"},
    sortResolved: {key:"open_date", dir:"desc"},
    filteredOpen:     [],
    filteredResolved: [],
    selectedId: null,
    refresh: null,
    renderSelectedPanel: null
  };

  var COLS_OPEN = [
    {key:"ticket_id",  label:"Ticket #"},
    {key:"open_date",  label:"Date"},
    {key:"client_name",label:"Client"},
    {key:"phone",      label:"Phone"},
    {key:"category",   label:"Category"},
    {key:"priority",   label:"Priority"},
    {key:"status",     label:"Status"},
    {key:"assigned_to",label:"Assigned To"},
    {key:"followup_date",label:"Follow-up"}
  ];
  var COLS_RES = COLS_OPEN.slice();

  // ------------------------------------------------------------
  // Filter & sort
  // ------------------------------------------------------------
  function applyFilterSplitSort() {
    var all = Array.isArray(state.entries)?state.entries.slice():[];
    var open=[], resolved=[];
    for (var i=0;i<all.length;i++) {
      var r = all[i]||{};
      if (r.resolved||r.status==="Resolved"||r.status==="Closed") resolved.push(r);
      else open.push(r);
    }
    var qo = norm(state.queryOpen), qr = norm(state.queryResolved);
    if (qo) open     = open.filter(function(r){return rowSearchBlob(r).indexOf(qo)>=0;});
    if (qr) resolved = resolved.filter(function(r){return rowSearchBlob(r).indexOf(qr)>=0;});
    sortList(open,     state.sortOpen);
    sortList(resolved, state.sortResolved);
    state.filteredOpen     = open;
    state.filteredResolved = resolved;
  }

  // ------------------------------------------------------------
  // Table row builder
  // ------------------------------------------------------------
  function buildTableRow(entry, opts) {
    var tr = document.createElement("tr");
    tr.setAttribute("data-id", String(entry&&entry.id!=null?entry.id:""));
    tr.tabIndex = 0;
    if (state.selectedId && entry && String(entry.id)===String(state.selectedId)) {
      tr.classList.add("tk-row-sel");
    }
    function td(text, cls, titleTxt) {
      var cell = document.createElement("td");
      if (cls) cell.className = cls;
      if (titleTxt) cell.title = titleTxt;
      if (cls&&cls.indexOf("tk-clamp")>=0) {
        var inner = document.createElement("div"); inner.className="tk-clamp-inner"; inner.textContent=text; cell.appendChild(inner);
      } else { cell.textContent = text; }
      return cell;
    }
    tr.appendChild(td(entry.ticket_id||"",  "", entry.ticket_id||""));
    tr.appendChild(td(fmtDmyFromYmd(entry.open_date||""), "", entry.open_date||""));
    tr.appendChild(td(entry.client_name||"","",entry.client_name||""));
    tr.appendChild(td(entry.phone||"",       "",entry.phone||""));
    tr.appendChild(td(entry.category||"",    "",entry.category||""));

    var tdPr = document.createElement("td"); tdPr.appendChild(prBadge(entry.priority)); tr.appendChild(tdPr);
    var tdSt = document.createElement("td"); tdSt.appendChild(statusBadge(entry.status)); tr.appendChild(tdSt);

    tr.appendChild(td(entry.assigned_to||"—","",entry.assigned_to||""));
    tr.appendChild(td(entry.followup_date?fmtDmyFromYmd(entry.followup_date):"—","",entry.followup_date||""));

    function selectRow() {
      if (!entry||entry.id==null) return;
      state.selectedId = String(entry.id);
      try { if (typeof opts.onSelect==="function") opts.onSelect(entry); } catch(e){}
    }
    tr.addEventListener("click", function(){selectRow();});
    tr.addEventListener("keydown",function(ev){
      var k=ev&&(ev.key||ev.keyCode);
      if (k==="Enter"||k===" "||k===13||k===32){ev.preventDefault();selectRow();}
    });
    return tr;
  }

  // ------------------------------------------------------------
  // Render table
  // ------------------------------------------------------------
  function renderTable(tbodyEl, list) {
    tbodyEl.innerHTML = "";
    for (var i=0;i<list.length;i++) {
      (function(entry){
        var tr = buildTableRow(entry, {
          onSelect: function(){ if (typeof state.renderSelectedPanel==="function") state.renderSelectedPanel(); }
        });
        tbodyEl.appendChild(tr);
      })(list[i]);
    }
  }

  function rerender() {
    try {
      applyFilterSplitSort();
      var tbodyO = document.getElementById("tk-tbody-open");
      var tbodyR = document.getElementById("tk-tbody-resolved");
      var countO = document.getElementById("tk-count-open");
      var countR = document.getElementById("tk-count-resolved");
      if (tbodyO) renderTable(tbodyO, state.filteredOpen);
      if (tbodyR) renderTable(tbodyR, state.filteredResolved);
      var totalO=0, totalR=0;
      (state.entries||[]).forEach(function(r){
        if (r&&(r.resolved||r.status==="Resolved"||r.status==="Closed")) totalR++; else totalO++;
      });
      if (countO) countO.textContent = "Showing "+String((state.filteredOpen||[]).length)+" / "+String(totalO);
      if (countR) countR.textContent = "Showing "+String((state.filteredResolved||[]).length)+" / "+String(totalR);
      try { if (typeof state.renderSelectedPanel==="function") state.renderSelectedPanel(); } catch(e2){}
    } catch(e){ try{err("[tickets] rerender failed",{message:e&&e.message?e.message:String(e)});}catch(e2){} }
  }

  // ------------------------------------------------------------
  // Sort headers
  // ------------------------------------------------------------
  function setSort(thEls, sortState) {
    for (var i=0;i<thEls.length;i++) {
      var th=thEls[i]; var key=th.getAttribute("data-key")||"";
      if (!key) continue;
      var wrap=th.querySelector(".tk-sort"); if (!wrap) continue;
      if (sortState.key===key) { wrap.classList.add("on"); var car=wrap.querySelector(".car"); if(car) car.textContent=(sortState.dir==="desc"?"▼":"▲"); }
      else { wrap.classList.remove("on"); var car2=wrap.querySelector(".car"); if(car2) car2.textContent=""; }
    }
  }
  function wireSortableHeaders(tableEl, which) {
    var ths = tableEl.querySelectorAll("th[data-key]");
    ths.forEach(function(th){
      var key=th.getAttribute("data-key"); if(!key) return;
      th.addEventListener("click", function(){
        var s = which==="resolved"?state.sortResolved:state.sortOpen;
        if (s.key===key) s.dir=(s.dir==="asc"?"desc":"asc"); else {s.key=key;s.dir="asc";}
        applyFilterSplitSort();
        var tbodyO=document.getElementById("tk-tbody-open"), tbodyR=document.getElementById("tk-tbody-resolved");
        if (tbodyO) renderTable(tbodyO,state.filteredOpen);
        if (tbodyR) renderTable(tbodyR,state.filteredResolved);
        var tableO=document.getElementById("tk-table-open"), tableR=document.getElementById("tk-table-resolved");
        if (tableO) setSort(tableO.querySelectorAll("th[data-key]"), state.sortOpen);
        if (tableR) setSort(tableR.querySelectorAll("th[data-key]"), state.sortResolved);
        try{if(typeof state.renderSelectedPanel==="function")state.renderSelectedPanel();}catch(e){}
      });
    });
  }
  function thHtml(col){ return "<span class='tk-sort'><span>"+esc(col.label)+"</span><span class='car'></span></span>"; }

  // ------------------------------------------------------------
  // Print
  // ------------------------------------------------------------
  function openPrintWindow(entries, title, queryText) {
    var list = Array.isArray(entries)?entries.slice():[];
    var t = String(title||"Client Tickets").trim();
    var q = String(queryText||"").trim();

    var w = window.open("","_blank");
    if (!w) {
      try { E.modal.show("Print","<div style='white-space:pre-wrap;'>Popup blocked. Allow popups and try again.</div>",
        [{label:"Close",primary:true,onClick:function(){E.modal.hide();}}]); } catch(e){}
      return;
    }

    function safe(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
    function prText(p){ var n=Number(p||2); if(n===1)return "1 — High"; if(n===3)return "3 — Low"; return "2 — Medium"; }
    function notesText(raw) {
      var arr = parseNotesLog(raw);
      if (!arr.length) return "—";
      return arr.map(function(n){ return "["+fmtTs(n.ts)+"] "+(n.author?n.author+": ":"")+String(n.text||""); }).join("\n");
    }

    var rowsHtml="";
    for (var i=0;i<list.length;i++) {
      var r=list[i]||{};
      rowsHtml +=
        "<tr>"+
        "<td>"+safe(r.ticket_id||"")+"</td>"+
        "<td>"+safe(fmtDmyFromYmd(r.open_date||""))+"</td>"+
        "<td>"+safe(r.client_name||"")+"</td>"+
        "<td>"+safe(r.phone||"")+"</td>"+
        "<td>"+safe(r.email||"")+"</td>"+
        "<td>"+safe(r.category||"")+"</td>"+
        "<td>"+safe(prText(r.priority))+"</td>"+
        "<td>"+safe(r.status||"")+"</td>"+
        "<td>"+safe(r.assigned_to||"")+"</td>"+
        "<td>"+safe(r.followup_date?fmtDmyFromYmd(r.followup_date):"—")+"</td>"+
        "<td style='max-width:220px;'>"+safe(r.issue||"")+"</td>"+
        "<td style='max-width:280px;white-space:pre-wrap;'>"+safe(notesText(r.notes_log))+"</td>"+
        "</tr>";
    }

    var html =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>"+safe(t)+"</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;font-size:12px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;font-size:13px;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      "h1{margin:0 0 4px 0;font-size:18px;}" +
      ".meta{font-size:11px;color:#555;margin-top:4px;white-space:pre-wrap;margin-bottom:10px;}" +
      "table{width:100%;border-collapse:collapse;}" +
      "th,td{border:1px solid #ddd;padding:5px 7px;font-size:11px;vertical-align:top;}" +
      "th{background:#f0f2f5;text-align:left;font-weight:800;}" +
      "tr:nth-child(even){background:#fafbfc;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button>" +
      "<h1>"+safe(t)+"</h1>" +
      "<div class='meta'>Rows: "+safe(String(list.length))+(q?"\nSearch: "+safe(q):"")+"\nPrinted: "+safe(new Date().toLocaleString())+"</div>" +
      "<table><thead><tr>" +
      "<th>Ticket #</th><th>Date</th><th>Client</th><th>Phone</th><th>Email</th><th>Category</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>Follow-up</th><th>Issue</th><th>Notes Log</th>" +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script>" +
      "</body></html>";

    w.document.open(); w.document.write(html); w.document.close();
  }

  // Print single ticket (detail print)
  function printSingleTicket(entry) {
    if (!entry) return;
    var w = window.open("","_blank");
    if (!w) { try{E.modal.show("Print","<div>Popup blocked.</div>",[{label:"Close",primary:true,onClick:function(){E.modal.hide();}}]);}catch(e){} return; }
    function safe(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
    function prText(p){ var n=Number(p||2); if(n===1)return "1 — High"; if(n===3)return "3 — Low"; return "2 — Medium"; }
    var notes = parseNotesLog(entry.notes_log);
    var notesHtml = notes.length ? notes.map(function(n){
      return "<div style='border:1px solid #e2e4e8;border-radius:6px;padding:8px;margin-bottom:6px;'>" +
             "<div style='font-size:10px;color:#888;margin-bottom:4px;'>"+safe(fmtTs(n.ts))+(n.author?" · "+safe(n.author):"")+"</div>" +
             "<div style='font-size:12px;white-space:pre-wrap;'>"+safe(n.text||"")+"</div></div>";
    }).join("") : "<p style='color:#888;font-style:italic;font-size:12px;'>No notes recorded.</p>";

    var html =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<title>"+safe(entry.ticket_id||"Ticket")+"</title>" +
      "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111;max-width:700px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;}" +
      ".hdr{border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:16px;}" +
      ".tid{font-size:22px;font-weight:900;} .tsub{font-size:12px;color:#666;margin-top:4px;}" +
      ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}" +
      ".kv{border:1px solid #e2e4e8;border-radius:8px;padding:10px;}" +
      ".kv .k{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}" +
      ".kv .v{font-size:12px;}" +
      ".issue-box{border:1px solid #e2e4e8;border-radius:8px;padding:12px;margin-bottom:14px;}" +
      ".issue-box .lbl{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}" +
      ".issue-box .txt{font-size:13px;white-space:pre-wrap;}" +
      "h3{margin:0 0 10px 0;font-size:14px;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button>" +
      "<div class='hdr'><div class='tid'>"+safe(entry.ticket_id||"—")+"</div>" +
      "<div class='tsub'>Opened: "+safe(fmtDmyFromYmd(entry.open_date||""))+" · Status: "+safe(entry.status||"")+" · Priority: "+safe(prText(entry.priority))+"</div></div>" +
      "<div class='grid'>" +
      "<div class='kv'><div class='k'>Client</div><div class='v'>"+safe(entry.client_name||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Phone</div><div class='v'>"+safe(entry.phone||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Email</div><div class='v'>"+safe(entry.email||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Category</div><div class='v'>"+safe(entry.category||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Assigned To</div><div class='v'>"+safe(entry.assigned_to||"—")+"</div></div>" +
      "<div class='kv'><div class='k'>Follow-up Date</div><div class='v'>"+safe(entry.followup_date?fmtDmyFromYmd(entry.followup_date):"—")+"</div></div>" +
      "</div>" +
      "<div class='issue-box'><div class='lbl'>Issue Description</div><div class='txt'>"+safe(entry.issue||"—")+"</div></div>" +
      "<h3>Notes Log ("+String(notes.length)+" entr"+(notes.length===1?"y":"ies")+")</h3>" +
      notesHtml +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script>" +
      "</body></html>";

    w.document.open(); w.document.write(html); w.document.close();
  }

  // ------------------------------------------------------------
  // Modal: New / Edit ticket
  // ------------------------------------------------------------
  function openTicketModal(opts) {
    var mode = opts&&opts.mode?String(opts.mode):"new";
    var row  = (opts&&opts.entry)?opts.entry:{};
    var isEdit = mode==="edit";

    var initial = {
      ticket_id:    String(row.ticket_id||"").trim(),
      open_date:    isYmd(row.open_date)?row.open_date:todayYmd(),
      client_name:  String(row.client_name||"").trim(),
      phone:        String(row.phone||"").trim(),
      email:        String(row.email||"").trim(),
      category:     String(row.category||"").trim(),
      priority:     Number(row.priority||2),
      status:       String(row.status||"Open").trim(),
      issue:        String(row.issue||"").trim(),
      assigned_to:  String(row.assigned_to||"").trim(),
      followup_date:isYmd(row.followup_date)?row.followup_date:"",
      notes_log:    typeof row.notes_log==="string"?row.notes_log:JSON.stringify(parseNotesLog(row.notes_log)),
      resolved:     !!row.resolved,
      resolved_at:  String(row.resolved_at||"").trim()
    };
    if (!(initial.priority===1||initial.priority===2||initial.priority===3)) initial.priority=2;

    var body =
      "<div class='eikon-field'><div class='eikon-label'>Date Opened</div><input id='tk-open-date' type='date' value='"+esc(initial.open_date)+"'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Client Name &amp; Surname</div><input id='tk-client' type='text' value='"+esc(initial.client_name)+"' placeholder='e.g. Maria Camilleri'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Phone</div><input id='tk-phone' type='tel' value='"+esc(initial.phone)+"' placeholder='e.g. 7900 0000'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Email (optional)</div><input id='tk-email' type='email' value='"+esc(initial.email)+"' placeholder='e.g. client@email.com'></div>" +

      "<div class='eikon-field'><div class='eikon-label'>Category</div>" +
      "<select id='tk-category'>"+buildCatOptions(initial.category)+"</select>" +
      "<div id='tk-new-cat-wrap' style='display:"+(initial.category==="__new__"?"block":"none")+";'>" +
      "<input id='tk-new-cat' type='text' placeholder='Type new category name…'></div></div>" +

      "<div class='eikon-field'><div class='eikon-label'>Priority</div>" +
      "<select id='tk-priority'>" +
      "<option value='1'"+(initial.priority===1?" selected":"")+">1 — High (Red)</option>" +
      "<option value='2'"+(initial.priority===2?" selected":"")+">2 — Medium (Orange)</option>" +
      "<option value='3'"+(initial.priority===3?" selected":"")+">3 — Low (Green)</option>" +
      "</select></div>" +

      "<div class='eikon-field'><div class='eikon-label'>Status</div>" +
      "<select id='tk-status'>"+buildStatusOptions(initial.status)+"</select></div>" +

      "<div class='eikon-field'><div class='eikon-label'>Issue Description</div>" +
      "<textarea id='tk-issue' placeholder='Describe the client's issue…'>"+esc(initial.issue)+"</textarea></div>" +

      "<div class='eikon-field'><div class='eikon-label'>Assigned To</div>" +
      "<select id='tk-assigned'>"+buildStaffOptions(initial.assigned_to)+"</select>" +
      "<div id='tk-new-staff-wrap' style='display:"+(initial.assigned_to==="__new__"?"block":"none")+";'>" +
      "<input id='tk-new-staff' type='text' placeholder='Type staff name…'></div></div>" +

      "<div class='eikon-field'><div class='eikon-label'>Follow-up Date (optional)</div>" +
      "<input id='tk-followup' type='date' value='"+esc(initial.followup_date)+"'></div>";

    E.modal.show(isEdit?"Edit Ticket":"New Ticket", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:isEdit?"Save Changes":"Create Ticket", primary:true, onClick:function(){
        (async function(){
          try {
            // Handle new category
            var catEl = E.q("#tk-category");
            var catVal = (catEl?catEl.value:"").trim();
            if (catVal==="__new__") {
              var ncEl = E.q("#tk-new-cat");
              var nc = (ncEl?ncEl.value:"").trim();
              if (!nc) { toast("Category required","Please type a category name.","bad"); return; }
              addCat(nc);
              catVal = nc;
            }
            // Handle new staff
            var staffEl = E.q("#tk-assigned");
            var staffVal = (staffEl?staffEl.value:"").trim();
            if (staffVal==="__new__") {
              var nsEl = E.q("#tk-new-staff");
              var ns = (nsEl?nsEl.value:"").trim();
              if (!ns) { toast("Staff required","Please type the staff member's name.","bad"); return; }
              addStaff(ns);
              staffVal = ns;
            }
            var statusEl = E.q("#tk-status");
            var statusVal = statusEl?statusEl.value:"Open";
            var isResolved = (statusVal==="Resolved"||statusVal==="Closed");
            var resolvedAt = initial.resolved_at;
            if (isResolved && !resolvedAt) resolvedAt = new Date().toISOString();
            if (!isResolved) resolvedAt = "";

            var payloadUi = validateAndBuild({
              ticket_id:    isEdit?initial.ticket_id:nextTicketId(),
              open_date:    (E.q("#tk-open-date")?E.q("#tk-open-date").value:"").trim(),
              client_name:  (E.q("#tk-client")?E.q("#tk-client").value:"").trim(),
              phone:        (E.q("#tk-phone")?E.q("#tk-phone").value:"").trim(),
              email:        (E.q("#tk-email")?E.q("#tk-email").value:"").trim(),
              category:     catVal,
              priority:     Number((E.q("#tk-priority")?E.q("#tk-priority").value:"2").trim()),
              status:       statusVal,
              issue:        (E.q("#tk-issue")?E.q("#tk-issue").value:"").trim(),
              assigned_to:  staffVal,
              followup_date:(E.q("#tk-followup")?E.q("#tk-followup").value:"").trim(),
              notes_log:    initial.notes_log,
              resolved:     isResolved,
              resolved_at:  resolvedAt
            });

            if (isEdit) await apiUpdate(row.id, payloadUi);
            else await apiCreate(payloadUi);

            E.modal.hide();
            if (typeof state.refresh==="function") state.refresh();
          } catch(e){ modalError("Save failed", e); }
        })();
      }}
    ]);

    // Wire category dropdown change
    try {
      var catSel = E.q("#tk-category");
      var newCatWrap = E.q("#tk-new-cat-wrap");
      if (catSel && newCatWrap) {
        catSel.addEventListener("change", function(){
          newCatWrap.style.display = catSel.value==="__new__"?"block":"none";
          if (catSel.value!=="__new__") { var nc=E.q("#tk-new-cat"); if(nc) nc.value=""; }
        });
      }
      var staffSel = E.q("#tk-assigned");
      var newStaffWrap = E.q("#tk-new-staff-wrap");
      if (staffSel && newStaffWrap) {
        staffSel.addEventListener("change", function(){
          newStaffWrap.style.display = staffSel.value==="__new__"?"block":"none";
          if (staffSel.value!=="__new__") { var ns=E.q("#tk-new-staff"); if(ns) ns.value=""; }
        });
      }
    } catch(e){}
  }

  // ------------------------------------------------------------
  // Modal: Add Note
  // ------------------------------------------------------------
  function openAddNoteModal(entry, onSaved) {
    if (!entry) return;
    var body =
      "<div class='eikon-field'><div class='eikon-label'>Note</div>" +
      "<textarea id='tk-add-note-text' placeholder='Type your note…' style='min-height:100px;'></textarea></div>";

    E.modal.show("Add Note — "+esc(entry.ticket_id||entry.client_name||"Ticket"), body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Add Note", primary:true, onClick:function(){
        (async function(){
          try {
            var textEl = E.q("#tk-add-note-text");
            var text = textEl?(textEl.value||"").trim():"";
            if (!text) { toast("Note required","Please type a note.","bad"); return; }

            // Get current user name if available
            var author = "";
            try { author = (E.state&&E.state.user&&E.state.user.display_name)?E.state.user.display_name:""; } catch(e){}

            var existingNotes = parseNotesLog(entry.notes_log);
            existingNotes.push({ts:new Date().toISOString(), author:author, text:text});

            var updatedEntry = Object.assign({}, entry, {
              notes_log: JSON.stringify(existingNotes)
            });

            // Build full payload (keep all existing fields)
            var payload = validateAndBuild(updatedEntry);
            await apiUpdate(entry.id, payload);

            // Update in-memory state
            for (var i=0;i<state.entries.length;i++) {
              if (String(state.entries[i].id)===String(entry.id)) {
                state.entries[i].notes_log = JSON.stringify(existingNotes);
                break;
              }
            }

            E.modal.hide();
            rerender();
            toast("Note Added","Note saved successfully.","good");
            if (typeof onSaved==="function") onSaved();
          } catch(e){ modalError("Failed to add note",e); }
        })();
      }}
    ]);
    try { var ta=E.q("#tk-add-note-text"); if(ta) setTimeout(function(){try{ta.focus();}catch(e){}},80); } catch(e){}
  }

  // ------------------------------------------------------------
  // Delete
  // ------------------------------------------------------------
  function openConfirmDelete(entry) {
    if (!entry||!entry.id) return;
    var body = "<div style='white-space:pre-wrap;font-size:13px;'>" +
      "This will permanently delete the ticket.\n\n" +
      "Ticket: "+esc(entry.ticket_id||"")+" · "+esc(entry.client_name||"")+"\n" +
      "Issue: "+esc(String(entry.issue||"").slice(0,180))+(String(entry.issue||"").length>180?"…":"")+"</div>";
    E.modal.show("Delete ticket?", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Delete", danger:true, onClick:function(){
        (async function(){
          try {
            await apiDelete(entry.id);
            state.selectedId = null;
            E.modal.hide();
            if (typeof state.refresh==="function") state.refresh();
          } catch(e){ modalError("Delete failed",e); }
        })();
      }}
    ]);
  }

  // ------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------
  async function render(ctx) {
    ensureStyles();

    var mount = ctx.mount;

    function thsHtml(cols) {
      return cols.map(function(c){return "<th data-key='"+esc(c.key)+"'>"+thHtml(c)+"</th>";}).join("");
    }

    mount.innerHTML =
      "<div class='tk-wrap'>" +

      // Header
      "<div class='tk-head'>" +
      "  <div><h2 class='tk-title'>🎟 Client Tickets</h2>" +
      "    <div class='tk-sub'>Log and track client issues. Click a row to view details, notes, and actions.</div>" +
      "  </div>" +
      "  <div class='tk-controls'>" +
      "    <div class='tk-mode'><span class='tk-badge' id='tk-mode-badge'>Loading…</span></div>" +
      "    <div class='tk-actions'>" +
      "      <button id='tk-new' class='eikon-btn' type='button'>New Ticket</button>" +
      "      <button id='tk-refresh' class='eikon-btn' type='button'>Refresh</button>" +
      "    </div>" +
      "  </div>" +
      "</div>" +

      // Selected / detail panel
      "<div class='tk-card tk-selected' id='tk-selected' style='margin-bottom:12px;'>" +
      "  <div class='tk-card-head'>" +
      "    <div><h3>Selected Ticket</h3>" +
      "      <div class='meta' id='tk-selected-meta'>Click a row to view full details and notes.</div>" +
      "    </div>" +
      "    <div class='tk-sel-actions'>" +
      "      <button id='tk-sel-add-note' class='eikon-btn' type='button' disabled>Add Note</button>" +
      "      <button id='tk-sel-edit'     class='eikon-btn' type='button' disabled>Edit</button>" +
      "      <button id='tk-sel-del'      class='eikon-btn' type='button' disabled>Delete</button>" +
      "      <button id='tk-sel-print'    class='eikon-btn' type='button' disabled>Print Ticket</button>" +
      "      <button id='tk-sel-resolve'  class='eikon-btn' type='button' disabled>Mark Resolved</button>" +
      "    </div>" +
      "  </div>" +
      "  <div id='tk-sel-content'></div>" +
      "</div>" +

      // Open tickets
      "<div class='tk-card' id='tk-card-open'>" +
      "  <div class='tk-card-head'>" +
      "    <div><h3>Open Tickets</h3><div class='meta' id='tk-count-open'>Loading…</div></div>" +
      "    <div class='right'>" +
      "      <div class='tk-field' style='min-width:280px;max-width:400px;flex:1;'>" +
      "        <label>Search open</label>" +
      "        <input id='tk-search-open' type='text' value='"+esc(state.queryOpen||"")+"' placeholder='Search tickets…'>" +
      "      </div>" +
      "      <button id='tk-print-open' class='eikon-btn' type='button'>Print</button>" +
      "    </div>" +
      "  </div>" +
      "  <div class='tk-table-wrap'>" +
      "    <table class='tk-table' id='tk-table-open'>" +
      "      <thead><tr>"+thsHtml(COLS_OPEN)+"</tr></thead>" +
      "      <tbody id='tk-tbody-open'></tbody>" +
      "    </table>" +
      "  </div>" +
      "</div>" +

      // Resolved tickets
      "<div class='tk-card' id='tk-card-resolved'>" +
      "  <div class='tk-card-head'>" +
      "    <div><h3>Resolved &amp; Closed Tickets</h3><div class='meta' id='tk-count-resolved'>Loading…</div></div>" +
      "    <div class='right'>" +
      "      <div class='tk-field' style='min-width:280px;max-width:400px;flex:1;'>" +
      "        <label>Search resolved</label>" +
      "        <input id='tk-search-resolved' type='text' value='"+esc(state.queryResolved||"")+"' placeholder='Search tickets…'>" +
      "      </div>" +
      "      <button id='tk-print-resolved' class='eikon-btn' type='button'>Print</button>" +
      "    </div>" +
      "  </div>" +
      "  <div class='tk-table-wrap'>" +
      "    <table class='tk-table' id='tk-table-resolved'>" +
      "      <thead><tr>"+thsHtml(COLS_RES)+"</tr></thead>" +
      "      <tbody id='tk-tbody-resolved'></tbody>" +
      "    </table>" +
      "  </div>" +
      "</div>" +

      "</div>";

    // DOM refs
    var badge       = E.q("#tk-mode-badge", mount);
    var btnNew      = E.q("#tk-new", mount);
    var btnRefresh  = E.q("#tk-refresh", mount);
    var searchO     = E.q("#tk-search-open", mount);
    var searchR     = E.q("#tk-search-resolved", mount);
    var btnPrintO   = E.q("#tk-print-open", mount);
    var btnPrintR   = E.q("#tk-print-resolved", mount);
    var tbodyO      = E.q("#tk-tbody-open", mount);
    var tbodyR      = E.q("#tk-tbody-resolved", mount);
    var countO      = E.q("#tk-count-open", mount);
    var countR      = E.q("#tk-count-resolved", mount);
    var tableO      = E.q("#tk-table-open", mount);
    var tableR      = E.q("#tk-table-resolved", mount);
    var selMeta     = E.q("#tk-selected-meta", mount);
    var selContent  = E.q("#tk-sel-content", mount);
    var selBtnNote  = E.q("#tk-sel-add-note", mount);
    var selBtnEdit  = E.q("#tk-sel-edit", mount);
    var selBtnDel   = E.q("#tk-sel-del", mount);
    var selBtnPrint = E.q("#tk-sel-print", mount);
    var selBtnResolve = E.q("#tk-sel-resolve", mount);

    // Update mode badge
    function updateBadge() {
      if (!badge) return;
      if (state.mode==="local") { badge.textContent="Local mode (no API yet)"; badge.className="tk-badge local"; }
      else if (state.mode==="api_error") { badge.textContent="API error"; badge.className="tk-badge err"; }
      else { badge.textContent="Online"; badge.className="tk-badge"; }
    }

    // Render selected panel
    state.renderSelectedPanel = function() {
      try {
        var id = state.selectedId?String(state.selectedId):"";
        var entry = null;
        if (id) {
          for (var i=0;i<(state.entries||[]).length;i++) {
            if (state.entries[i]&&String(state.entries[i].id)===id){entry=state.entries[i];break;}
          }
        }

        selContent.innerHTML = "";

        // Highlight selected row across both tables
        var allRows = mount.querySelectorAll(".tk-table tbody tr");
        allRows.forEach(function(r){ r.classList.remove("tk-row-sel"); });
        if (id) {
          var sel = mount.querySelector(".tk-table tbody tr[data-id='"+id+"']");
          if (sel) sel.classList.add("tk-row-sel");
        }

        if (!entry) {
          selMeta.textContent = "Click a row to view full details and notes.";
          [selBtnNote,selBtnEdit,selBtnDel,selBtnPrint,selBtnResolve].forEach(function(b){if(b)b.disabled=true;});
          if (selBtnResolve) selBtnResolve.textContent="Mark Resolved";
          return;
        }

        selMeta.textContent = entry.ticket_id + " · " + entry.client_name + " · " + (entry.status||"Open");

        // KV grid
        var grid = document.createElement("div"); grid.className="tk-sel-grid";

        function kv(label, val, cls) {
          var wrap=document.createElement("div"); wrap.className="tk-kv"+(cls?" "+cls:"");
          var k=document.createElement("div");k.className="k";k.textContent=label;
          var v=document.createElement("div");v.className="v";
          if (val&&val.nodeType) { v.appendChild(val); }
          else { v.textContent=(val==null||String(val).trim()===""?"—":String(val)); }
          wrap.appendChild(k);wrap.appendChild(v);
          return wrap;
        }

        grid.appendChild(kv("Ticket ID",     entry.ticket_id||""));
        grid.appendChild(kv("Date Opened",   fmtDmyFromYmd(entry.open_date||"")));
        grid.appendChild(kv("Phone",         entry.phone||""));
        grid.appendChild(kv("Email",         entry.email||""));
        grid.appendChild(kv("Category",      entry.category||""));
        var prEl=document.createElement("span");prEl.appendChild(prBadge(entry.priority));
        grid.appendChild(kv("Priority",      prEl));
        var stEl=document.createElement("span");stEl.appendChild(statusBadge(entry.status));
        grid.appendChild(kv("Status",        stEl));
        grid.appendChild(kv("Assigned To",   entry.assigned_to||""));
        grid.appendChild(kv("Follow-up",     entry.followup_date?fmtDmyFromYmd(entry.followup_date):""));
        if (entry.resolved_at) grid.appendChild(kv("Resolved At", fmtTs(entry.resolved_at)));

        var issueKv = kv("Issue Description", entry.issue||"", "wide");
        grid.appendChild(issueKv);

        selContent.appendChild(grid);

        // Notes log
        var notesWrap = document.createElement("div"); notesWrap.className="tk-notes-log";
        var notesHead = document.createElement("div"); notesHead.className="tk-notes-head";
        var notesLbl  = document.createElement("span"); notesLbl.className="nl";
        var notes = parseNotesLog(entry.notes_log);
        notesLbl.textContent = "Notes Log (" + String(notes.length) + " entr"+(notes.length===1?"y":"ies")+")";
        notesHead.appendChild(notesLbl);
        notesWrap.appendChild(notesHead);

        if (!notes.length) {
          var empty=document.createElement("div"); empty.className="tk-notes-empty"; empty.textContent="No notes yet. Use 'Add Note' to log updates.";
          notesWrap.appendChild(empty);
        } else {
          // Most recent first
          var sorted = notes.slice().sort(function(a,b){ return (b.ts||"").localeCompare(a.ts||""); });
          sorted.forEach(function(n){
            var entry_wrap=document.createElement("div"); entry_wrap.className="tk-note-entry";
            var meta=document.createElement("div"); meta.className="tk-note-meta";
            var tsSpan=document.createElement("span"); tsSpan.textContent=fmtTs(n.ts||"");
            meta.appendChild(tsSpan);
            if (n.author) {
              var authSpan=document.createElement("span"); authSpan.className="tk-note-author"; authSpan.textContent=n.author;
              meta.appendChild(authSpan);
            }
            var txt=document.createElement("div"); txt.className="tk-note-text"; txt.textContent=n.text||"";
            entry_wrap.appendChild(meta); entry_wrap.appendChild(txt);
            notesWrap.appendChild(entry_wrap);
          });
        }
        selContent.appendChild(notesWrap);

        // Enable action buttons
        [selBtnNote,selBtnEdit,selBtnDel,selBtnPrint,selBtnResolve].forEach(function(b){if(b)b.disabled=false;});
        var isResolved = entry.resolved||entry.status==="Resolved"||entry.status==="Closed";
        if (selBtnResolve) selBtnResolve.textContent = isResolved ? "Reopen Ticket" : "Mark Resolved";

      } catch(e){ try{err("[tickets] renderSelectedPanel failed",{message:e&&e.message?e.message:String(e)});}catch(e2){} }
    };

    // Refresh from API
    async function refresh() {
      try {
        countO.textContent="Loading…"; countR.textContent="Loading…";
        var res = await apiList();
        state.mode = res.mode||"api";
        state.lastError = res.lastError||null;

        var raw = Array.isArray(res.entries)?res.entries:[];
        var entries = raw.map(function(r){
          var m = mapApiRow(r||{});
          if (!isYmd(m.open_date)) m.open_date=todayYmd();
          if (!(m.priority===1||m.priority===2||m.priority===3)) m.priority=2;
          var validSt=["Open","In Progress","Awaiting Client","Resolved","Closed"];
          if (validSt.indexOf(m.status)<0) m.status="Open";
          return m;
        });

        state.entries = entries;

        var totalO=0, totalR=0;
        entries.forEach(function(r){if(r&&(r.resolved||r.status==="Resolved"||r.status==="Closed"))totalR++;else totalO++;});

        applyFilterSplitSort();
        renderTable(tbodyO, state.filteredOpen);
        renderTable(tbodyR, state.filteredResolved);

        countO.textContent="Showing "+String(state.filteredOpen.length)+" / "+String(totalO);
        countR.textContent="Showing "+String(state.filteredResolved.length)+" / "+String(totalR);

        updateBadge();
        setSort(tableO.querySelectorAll("th[data-key]"), state.sortOpen);
        setSort(tableR.querySelectorAll("th[data-key]"), state.sortResolved);
        try{if(typeof state.renderSelectedPanel==="function")state.renderSelectedPanel();}catch(eS){}
      } catch(e) {
        err("[tickets] refresh failed",{status:e&&e.status,message:e&&e.message});
        state.mode="api_error"; state.lastError=e||null;
        updateBadge();
        countO.textContent="Failed to load"; countR.textContent="Failed to load";
        modalError("Client Tickets",e);
      }
    }
    state.refresh = refresh;

    // Helpers for selected-panel actions
    function getSelectedEntry() {
      var id = state.selectedId?String(state.selectedId):"";
      if (!id) return null;
      for (var i=0;i<(state.entries||[]).length;i++) {
        if (state.entries[i]&&String(state.entries[i].id)===id) return state.entries[i];
      }
      return null;
    }

    // Event listeners
    btnNew.addEventListener("click", function(){
      openTicketModal({mode:"new", entry:{open_date:todayYmd(),priority:2,status:"Open"}});
    });
    btnRefresh.addEventListener("click", function(){ refresh(); });

    selBtnNote.addEventListener("click", function(){
      var e=getSelectedEntry(); if(!e) return;
      openAddNoteModal(e, function(){
        if (typeof state.renderSelectedPanel==="function") state.renderSelectedPanel();
      });
    });
    selBtnEdit.addEventListener("click", function(){
      var e=getSelectedEntry(); if(!e) return;
      openTicketModal({mode:"edit", entry:e});
    });
    selBtnDel.addEventListener("click", function(){
      var e=getSelectedEntry(); if(!e) return;
      openConfirmDelete(e);
    });
    selBtnPrint.addEventListener("click", function(){
      var e=getSelectedEntry(); if(!e) return;
      try { printSingleTicket(e); } catch(ex){ modalError("Print",ex); }
    });
    selBtnResolve.addEventListener("click", function(){
      var entry=getSelectedEntry(); if(!entry) return;
      (async function(){
        try {
          var isResolved = entry.resolved||entry.status==="Resolved"||entry.status==="Closed";
          var newStatus  = isResolved?"Open":"Resolved";
          var resolvedAt = isResolved?"":(entry.resolved_at||new Date().toISOString());
          var payload = validateAndBuild(Object.assign({},entry,{
            status: newStatus, resolved: !isResolved, resolved_at: resolvedAt
          }));
          await apiUpdate(entry.id, payload);
          entry.status    = newStatus;
          entry.resolved  = !isResolved;
          entry.resolved_at = resolvedAt;
          rerender();
          toast(isResolved?"Ticket Reopened":"Ticket Resolved", entry.ticket_id, "good");
        } catch(e){ modalError("Update failed",e); }
      })();
    });

    searchO.addEventListener("input", function(){
      state.queryOpen = String(searchO.value||"");
      applyFilterSplitSort(); renderTable(tbodyO,state.filteredOpen);
      var to=0; state.entries.forEach(function(r){if(r&&!(r.resolved||r.status==="Resolved"||r.status==="Closed"))to++;});
      countO.textContent="Showing "+String(state.filteredOpen.length)+" / "+String(to);
      try{if(typeof state.renderSelectedPanel==="function")state.renderSelectedPanel();}catch(e){}
    });
    searchR.addEventListener("input", function(){
      state.queryResolved = String(searchR.value||"");
      applyFilterSplitSort(); renderTable(tbodyR,state.filteredResolved);
      var tr=0; state.entries.forEach(function(r){if(r&&(r.resolved||r.status==="Resolved"||r.status==="Closed"))tr++;});
      countR.textContent="Showing "+String(state.filteredResolved.length)+" / "+String(tr);
      try{if(typeof state.renderSelectedPanel==="function")state.renderSelectedPanel();}catch(e){}
    });

    btnPrintO.addEventListener("click", function(){
      try{openPrintWindow(state.filteredOpen||[],"Client Tickets — Open",state.queryOpen||"");}
      catch(e){modalError("Print",e);}
    });
    btnPrintR.addEventListener("click", function(){
      try{openPrintWindow(state.filteredResolved||[],"Client Tickets — Resolved",state.queryResolved||"");}
      catch(e){modalError("Print",e);}
    });

    wireSortableHeaders(tableO,"open");
    wireSortableHeaders(tableR,"resolved");

    await refresh();
  }

  // ------------------------------------------------------------
  // Register
  // ------------------------------------------------------------
  E.registerModule({
    id:     "tickets",
    title:  "Client Tickets",
    order:  18,
    icon:   "🎟",
    render: render
  });

})();
