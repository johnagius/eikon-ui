(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ------------------------------------------------------------
  // Debug helpers
  // ------------------------------------------------------------
  function log()  { E.log.apply(E,  ["[deliveries]"].concat([].slice.call(arguments))); }
  function dbg()  { E.dbg.apply(E,  ["[deliveries]"].concat([].slice.call(arguments))); }
  function warn() { E.warn.apply(E, ["[deliveries]"].concat([].slice.call(arguments))); }
  function err()  { E.error.apply(E,["[deliveries]"].concat([].slice.call(arguments))); }

  // ------------------------------------------------------------
  // Utility helpers
  // ------------------------------------------------------------
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

  var ACTIVE_STATUSES    = ["Scheduled","Dispatched","Out for Delivery"];
  var COMPLETED_STATUSES = ["Delivered"];
  var FAILED_STATUSES    = ["Failed","Returned","Cancelled"];
  var ALL_STATUSES       = ACTIVE_STATUSES.concat(COMPLETED_STATUSES).concat(FAILED_STATUSES);

  function isActive(r)    { return ACTIVE_STATUSES.indexOf(r&&r.status||"") >= 0; }
  function isCompleted(r) { return COMPLETED_STATUSES.indexOf(r&&r.status||"") >= 0; }
  function isFailed(r)    { return FAILED_STATUSES.indexOf(r&&r.status||"") >= 0; }

  // ------------------------------------------------------------
  // JSON array field parsers
  // ------------------------------------------------------------
  function parseJsonArr(raw) {
    if (Array.isArray(raw)) return raw;
    try {
      var arr = JSON.parse(String(raw||"[]"));
      return Array.isArray(arr) ? arr : [];
    } catch(e) { return []; }
  }
  function parseItems(raw)      { return parseJsonArr(raw); }
  function parseDeliveryLog(raw){ return parseJsonArr(raw); }

  // Search blob
  function rowSearchBlob(r) {
    var logText = "";
    try {
      var arr = parseDeliveryLog(r.delivery_log);
      logText = arr.map(function(n){ return norm(n.text); }).join(" ");
    } catch(e){}
    return (
      norm(r.delivery_id)      + " | " + norm(r.order_date)       + " | " +
      norm(r.client_name)      + " | " + norm(r.phone)            + " | " +
      norm(r.delivery_address) + " | " + norm(r.delivery_method)  + " | " +
      norm(r.assigned_driver)  + " | " + norm(r.tracking_number)  + " | " +
      norm(r.status)           + " | " + norm(r.ticket_ref)       + " | " +
      logText
    );
  }

  // ------------------------------------------------------------
  // Persistence: drivers / staff
  // ------------------------------------------------------------
  var DRIVERS_KEY = "eikon_deliveries_drivers_v1";
  var DEFAULT_DRIVERS = ["Kevin Mifsud"];

  function loadDrivers() {
    try {
      var raw = window.localStorage.getItem(DRIVERS_KEY);
      if (!raw) return DEFAULT_DRIVERS.slice();
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : DEFAULT_DRIVERS.slice();
    } catch(e) { return DEFAULT_DRIVERS.slice(); }
  }
  function saveDrivers(arr) {
    try { window.localStorage.setItem(DRIVERS_KEY, JSON.stringify(arr||[])); } catch(e){}
  }
  function addDriver(name) {
    var arr = loadDrivers();
    var n = String(name||"").trim();
    if (!n) return arr;
    if (arr.map(function(d){return norm(d);}).indexOf(norm(n)) >= 0) return arr;
    arr.push(n);
    saveDrivers(arr);
    return arr;
  }

  // ------------------------------------------------------------
  // Delivery ID generator
  // ------------------------------------------------------------
  var DELID_KEY = "eikon_deliveries_seq_v1";
  function nextDeliveryId() {
    try {
      var raw = window.localStorage.getItem(DELID_KEY);
      var seq = raw ? (parseInt(raw,10)||0) : 0;
      seq++;
      window.localStorage.setItem(DELID_KEY, String(seq));
      return "DEL-" + String(seq).padStart(5,"0");
    } catch(e) {
      return "DEL-" + String(Date.now()).slice(-5);
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
      E.modal.show(title||"Error",
        "<div style='white-space:pre-wrap;font-size:13px;color:rgba(255,90,122,.9);'>"+esc(msg)+"</div>",
        [{label:"Close", primary:true, onClick:function(){E.modal.hide();}}]);
    } catch(e2){ toast(title||"Error", msg, "bad"); }
  }

  // ------------------------------------------------------------
  // Local fallback storage
  // ------------------------------------------------------------
  var LS_KEY      = "eikon_deliveries_v1";
  var LS_PREF_KEY = "eikon_deliveries_pref_allow500";

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
      var qp = (url.searchParams.get("dv_allow500")||"").trim();
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
  async function apiFetch(path, options) {
    reqSeq++;
    var reqId = "DV#"+String(reqSeq)+"-"+String(Date.now());
    var method = (options&&options.method)?String(options.method).toUpperCase():"GET";
    dbg(reqId,"->",method,path);
    var t0 = Date.now();
    try {
      var out = await E.apiFetch(path, options||{});
      dbg(reqId,"<- OK",String(Date.now()-t0)+"ms");
      return out;
    } catch(e) {
      err(reqId,"<- FAIL",{status:e&&e.status,message:e&&e.message});
      throw e;
    }
  }

  async function apiList() {
    var allow500 = getAllow500Fallback();
    try {
      var resp = await apiFetch("/client-deliveries/entries",{method:"GET"});
      var entries = Array.isArray(resp)?resp:(resp&&Array.isArray(resp.entries)?resp.entries:[]);
      return {mode:"api", entries:entries};
    } catch(e) {
      if (shouldFallback(e,allow500)) {
        warn("apiList fallback to local",{status:e&&e.status});
        return {mode:"local", entries:localList()};
      }
      throw e;
    }
  }
  async function apiCreate(payload) {
    var allow500 = getAllow500Fallback();
    try {
      return await apiFetch("/client-deliveries/entries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    } catch(e) {
      if (shouldFallback(e,allow500)) { warn("create fallback"); return localCreate(payload); }
      throw e;
    }
  }
  async function apiUpdate(id, payload) {
    var allow500 = getAllow500Fallback();
    try {
      return await apiFetch("/client-deliveries/entries/"+encodeURIComponent(String(id)),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    } catch(e) {
      if (shouldFallback(e,allow500)) { warn("update fallback"); return localUpdate(id,payload); }
      throw e;
    }
  }
  async function apiDelete(id) {
    var allow500 = getAllow500Fallback();
    try {
      return await apiFetch("/client-deliveries/entries/"+encodeURIComponent(String(id)),{method:"DELETE"});
    } catch(e) {
      if (shouldFallback(e,allow500)) { warn("delete fallback"); return localDelete(id); }
      throw e;
    }
  }

  // ------------------------------------------------------------
  // Data mapping + validation
  // ------------------------------------------------------------
  function mapApiRow(r) {
    r = r||{};
    return {
      id:                   r.id != null ? r.id : null,
      delivery_id:          String(r.delivery_id||"").trim(),
      order_date:           String(r.order_date||"").trim(),
      scheduled_date:       String(r.scheduled_date||"").trim(),
      scheduled_time_slot:  String(r.scheduled_time_slot||"").trim(),
      actual_delivery_date: String(r.actual_delivery_date||"").trim(),
      actual_delivery_time: String(r.actual_delivery_time||"").trim(),
      client_name:          String(r.client_name||"").trim(),
      phone:                String(r.phone||"").trim(),
      email:                String(r.email||"").trim(),
      delivery_address:     String(r.delivery_address||"").trim(),
      address_notes:        String(r.address_notes||"").trim(),
      id_doc_ref:           String(r.id_doc_ref||"").trim(),
      delivery_method:      String(r.delivery_method||"In-house Driver").trim(),
      priority:             Number(r.priority||2),
      assigned_driver:      String(r.assigned_driver||"").trim(),
      tracking_number:      String(r.tracking_number||"").trim(),
      status:               String(r.status||"Scheduled").trim(),
      signature_required:   !!(r.signature_required),
      signature_obtained:   !!(r.signature_obtained),
      recipient_name:       String(r.recipient_name||"").trim(),
      proof_of_delivery:    String(r.proof_of_delivery||"").trim(),
      delivery_attempts:    Number(r.delivery_attempts||0),
      failure_reason:       String(r.failure_reason||"").trim(),
      contains_controlled:  !!(r.contains_controlled),
      cold_chain_required:  !!(r.cold_chain_required),
      ticket_ref:           String(r.ticket_ref||"").trim(),
      items:                JSON.stringify(parseItems(r.items)),
      delivery_log:         JSON.stringify(parseDeliveryLog(r.delivery_log)),
      internal_notes:       String(r.internal_notes||"").trim()
    };
  }

  function validateAndBuild(p) {
    var name = String(p.client_name||"").trim();
    if (!name) throw new Error("Client name is required.");
    var addr = String(p.delivery_address||"").trim();
    if (!addr) throw new Error("Delivery address is required.");
    var phone = String(p.phone||"").trim();
    if (!phone) throw new Error("Phone number is required.");
    var pr = Number(p.priority||2);
    if (pr!==1&&pr!==2&&pr!==3) pr=2;
    var method = String(p.delivery_method||"In-house Driver").trim();
    var validMethods = ["In-house Driver","Courier","Collection"];
    if (validMethods.indexOf(method)<0) method="In-house Driver";
    var status = String(p.status||"Scheduled").trim();
    if (ALL_STATUSES.indexOf(status)<0) status="Scheduled";
    var items = parseItems(p.items);
    // auto-flag controlled drugs
    var controlled = !!(p.contains_controlled) || items.some(function(i){ return i&&i.schedule==="CD"; });
    return {
      delivery_id:          String(p.delivery_id||"").trim(),
      order_date:           isYmd(p.order_date)?p.order_date:todayYmd(),
      scheduled_date:       isYmd(p.scheduled_date)?p.scheduled_date:"",
      scheduled_time_slot:  String(p.scheduled_time_slot||"").trim(),
      actual_delivery_date: isYmd(p.actual_delivery_date)?p.actual_delivery_date:"",
      actual_delivery_time: String(p.actual_delivery_time||"").trim(),
      client_name:          name,
      phone:                phone,
      email:                String(p.email||"").trim(),
      delivery_address:     addr,
      address_notes:        String(p.address_notes||"").trim(),
      id_doc_ref:           String(p.id_doc_ref||"").trim(),
      delivery_method:      method,
      priority:             pr,
      assigned_driver:      String(p.assigned_driver||"").trim(),
      tracking_number:      String(p.tracking_number||"").trim(),
      status:               status,
      signature_required:   !!(p.signature_required),
      signature_obtained:   !!(p.signature_obtained),
      recipient_name:       String(p.recipient_name||"").trim(),
      proof_of_delivery:    String(p.proof_of_delivery||"").trim(),
      delivery_attempts:    Number(p.delivery_attempts||0),
      failure_reason:       String(p.failure_reason||"").trim(),
      contains_controlled:  controlled,
      cold_chain_required:  !!(p.cold_chain_required),
      ticket_ref:           String(p.ticket_ref||"").trim(),
      items:                typeof p.items==="string"?p.items:JSON.stringify(items),
      delivery_log:         typeof p.delivery_log==="string"?p.delivery_log:JSON.stringify(parseDeliveryLog(p.delivery_log)),
      internal_notes:       String(p.internal_notes||"").trim()
    };
  }

  // ------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------
  var dvStyleInstalled = false;
  function ensureStyles() {
    if (dvStyleInstalled) return;
    dvStyleInstalled = true;
    var st = document.createElement("style");
    st.id = "eikon-deliveries-style";
    st.textContent =

      // Layout
      ".dv-wrap{max-width:1420px;margin:0 auto;padding:16px;}" +
      ".dv-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px;}" +
      ".dv-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".dv-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +
      ".dv-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +
      ".dv-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}" +

      // Stats
      ".dv-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px;}" +
      ".dv-stat{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;padding:12px 14px;" +
      "background:var(--panel,rgba(16,24,36,.66));backdrop-filter:blur(12px);position:relative;overflow:hidden;}" +
      ".dv-stat::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--stat-color,rgba(58,160,255,.8));opacity:.7;}" +
      ".dv-stat .s-val{font-size:26px;font-weight:900;color:var(--text,#e9eef7);font-family:'JetBrains Mono',monospace;line-height:1;margin-bottom:4px;}" +
      ".dv-stat .s-lbl{font-size:10px;font-weight:700;color:var(--muted,rgba(233,238,247,.55));text-transform:uppercase;letter-spacing:.8px;}" +
      ".dv-stat .s-icon{position:absolute;right:12px;top:12px;font-size:18px;opacity:.25;}" +

      // Card
      ".dv-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:12px;" +
      "background:var(--panel,rgba(16,24,36,.66));backdrop-filter:blur(12px);box-shadow:0 20px 60px rgba(0,0,0,.38);margin-bottom:12px;}" +
      ".dv-card-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".dv-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      ".dv-card-head .meta{font-size:12px;color:var(--muted,rgba(233,238,247,.68));font-weight:800;}" +
      ".dv-card-head .right{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +

      // Table
      ".dv-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(8,14,23,.25);}" +
      ".dv-table{width:max-content;min-width:100%;border-collapse:collapse;color:var(--text,#e9eef7);}" +
      ".dv-table th,.dv-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:8px 10px;font-size:12px;vertical-align:middle;white-space:nowrap;}" +
      ".dv-table th{background:rgba(10,16,28,.9);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.55));text-transform:uppercase;letter-spacing:.7px;font-weight:1000;text-align:left;font-size:10px;cursor:pointer;user-select:none;}" +
      ".dv-table th.noclick{cursor:default;}" +
      ".dv-table tbody tr{transition:background 80ms;cursor:pointer;}" +
      ".dv-table tbody tr:hover{background:rgba(255,255,255,.04);}" +
      ".dv-row-sel{background:rgba(58,160,255,.10)!important;outline:1px solid rgba(58,160,255,.22);}" +
      ".dv-row-sel:hover{background:rgba(58,160,255,.12)!important;}" +

      // Sort
      ".dv-sort{display:inline-flex;gap:5px;align-items:center;}" +
      ".dv-sort .car{opacity:.5;font-size:10px;}" +
      ".dv-sort.on .car{opacity:1;}" +

      // Status chips
      ".dv-chip{display:inline-block;font-size:10px;font-weight:900;padding:3px 9px;border-radius:999px;letter-spacing:.3px;white-space:nowrap;}" +
      ".dv-chip.scheduled{background:rgba(58,160,255,.15);border:1px solid rgba(58,160,255,.35);color:#7dc8ff;}" +
      ".dv-chip.dispatched{background:rgba(255,157,67,.14);border:1px solid rgba(255,157,67,.38);color:#ffbe7d;}" +
      ".dv-chip.outfordelivery{background:rgba(255,157,67,.18);border:1px solid rgba(255,157,67,.42);color:#ffc870;}" +
      ".dv-chip.delivered{background:rgba(67,209,122,.14);border:1px solid rgba(67,209,122,.32);color:#6de0a0;}" +
      ".dv-chip.failed{background:rgba(255,90,122,.12);border:1px solid rgba(255,90,122,.32);color:#ff8fa5;}" +
      ".dv-chip.returned{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:rgba(220,231,245,.55);}" +
      ".dv-chip.cancelled{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:rgba(220,231,245,.55);}" +
      ".dv-chip.collection{background:rgba(156,132,255,.13);border:1px solid rgba(156,132,255,.32);color:#c9bcff;}" +
      ".dv-chip.courier{background:rgba(255,157,67,.12);border:1px solid rgba(255,157,67,.3);color:#ffbe7d;}" +
      ".dv-chip.inhouse{background:rgba(58,160,255,.12);border:1px solid rgba(58,160,255,.28);color:#7dc8ff;}" +

      // Priority badge
      ".dv-pr{display:inline-flex;align-items:center;gap:7px;font-weight:900;font-size:12px;}" +
      ".dv-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0;border:1px solid rgba(255,255,255,.18);}" +
      ".dv-dot.p1{background:rgba(255,90,122,.95);}" +
      ".dv-dot.p2{background:rgba(255,157,67,.95);}" +
      ".dv-dot.p3{background:rgba(67,209,122,.95);}" +

      // Attempt badge
      ".dv-att{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:10px;font-weight:900;font-family:'JetBrains Mono',monospace;}" +
      ".dv-att.a0,.dv-att.a1{background:rgba(67,209,122,.18);color:#6de0a0;border:1px solid rgba(67,209,122,.3);}" +
      ".dv-att.a2{background:rgba(255,157,67,.15);color:#ffbe7d;border:1px solid rgba(255,157,67,.3);}" +
      ".dv-att.a3{background:rgba(255,90,122,.13);color:#ff8fa5;border:1px solid rgba(255,90,122,.3);}" +

      // Proof badges
      ".dv-proof{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:900;padding:3px 8px;border-radius:999px;}" +
      ".dv-proof.yes{background:rgba(67,209,122,.13);border:1px solid rgba(67,209,122,.28);color:#6de0a0;}" +
      ".dv-proof.no{background:rgba(255,90,122,.10);border:1px solid rgba(255,90,122,.22);color:#ff8fa5;}" +

      // Mode badge
      ".dv-mode-badge{font-size:11px;font-weight:1000;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(10,16,24,.35);color:var(--muted,rgba(233,238,247,.78));}" +
      ".dv-mode-badge.local{border-color:rgba(255,200,90,.28);}" +
      ".dv-mode-badge.err{border-color:rgba(255,90,122,.35);}" +

      // Tabs
      ".dv-tabs{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;}" +
      ".dv-tab{padding:6px 14px;border-radius:8px;border:1px solid var(--line,rgba(255,255,255,.10));background:transparent;" +
      "color:var(--muted,rgba(233,238,247,.55));font-family:inherit;font-size:12px;font-weight:800;cursor:pointer;transition:all 120ms;}" +
      ".dv-tab.active{background:rgba(58,160,255,.15);border-color:rgba(58,160,255,.38);color:#7dc8ff;}" +
      ".dv-tab:hover:not(.active){background:rgba(255,255,255,.05);color:var(--text,#e9eef7);}" +

      // Selected panel
      ".dv-sel-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px;}" +
      ".dv-kv{border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(8,14,23,.28);padding:10px 12px;}" +
      ".dv-kv .k{font-size:10px;font-weight:1000;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;}" +
      ".dv-kv .v{font-size:12px;color:var(--text,#e9eef7);word-break:break-word;white-space:pre-wrap;}" +
      ".dv-kv.wide{grid-column:1/-1;}" +
      ".dv-kv.half{grid-column:span 2;}" +

      // Items list
      ".dv-items{display:flex;flex-direction:column;gap:5px;}" +
      ".dv-item-row{display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(255,255,255,.04);" +
      "border:1px solid rgba(255,255,255,.07);border-radius:8px;font-size:12px;}" +
      ".dv-item-qty{font-family:'JetBrains Mono',monospace;font-size:11px;color:#7dc8ff;font-weight:700;min-width:28px;}" +
      ".dv-item-name{flex:1;}" +
      ".dv-item-meta{font-size:10px;color:var(--muted,rgba(233,238,247,.5));font-family:'JetBrains Mono',monospace;}" +

      // Delivery log timeline
      ".dv-log-wrap{border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(8,14,23,.22);padding:12px;}" +
      ".dv-log-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;}" +
      ".dv-log-lbl{font-size:10px;font-weight:1000;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.8px;}" +
      ".dv-log-entry{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:10px;" +
      "background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);margin-bottom:6px;}" +
      ".dv-log-entry:last-child{margin-bottom:0;}" +
      ".dv-log-meta{display:flex;gap:10px;align-items:center;font-size:10px;color:var(--muted,rgba(233,238,247,.55));font-weight:800;}" +
      ".dv-log-author{color:rgba(90,162,255,.9);}" +
      ".dv-log-text{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;word-break:break-word;line-height:1.5;}" +
      ".dv-log-empty{font-size:12px;color:var(--muted,rgba(233,238,247,.45));font-style:italic;padding:4px 0;}" +

      // Selected actions
      ".dv-sel-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;}" +

      // Mono
      ".dv-mono{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted,rgba(233,238,247,.55));}" +

      // Flag chip
      ".dv-flag{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:900;padding:3px 8px;border-radius:999px;}" +
      ".dv-flag.cd{background:rgba(255,90,122,.12);border:1px solid rgba(255,90,122,.28);color:#ff8fa5;}" +
      ".dv-flag.cold{background:rgba(58,160,255,.12);border:1px solid rgba(58,160,255,.28);color:#7dc8ff;}" +
      ".dv-flag.sig{background:rgba(156,132,255,.12);border:1px solid rgba(156,132,255,.28);color:#c9bcff;}" +

      // Form inputs
      ".dv-wrap #dv-order-date,.dv-wrap #dv-sched-date,.dv-wrap #dv-sched-time,.dv-wrap #dv-client,.dv-wrap #dv-phone," +
      ".dv-wrap #dv-email,.dv-wrap #dv-address,.dv-wrap #dv-addr-notes,.dv-wrap #dv-id-doc,.dv-wrap #dv-tracking," +
      ".dv-wrap #dv-driver-input,.dv-wrap #dv-ticket-ref,.dv-wrap #dv-recipient,.dv-wrap #dv-internal-notes," +
      ".dv-wrap #dv-proof,.dv-wrap #dv-fail-reason,.dv-wrap #dv-log-text,.dv-wrap #dv-new-driver{" +
      "width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "transition:border-color 120ms,box-shadow 120ms;font-family:inherit;font-size:13px;}" +
      ".dv-wrap #dv-order-date,.dv-wrap #dv-sched-date{color-scheme:dark;}" +
      ".dv-wrap #dv-address,.dv-wrap #dv-addr-notes,.dv-wrap #dv-internal-notes,.dv-wrap #dv-proof,.dv-wrap #dv-fail-reason,.dv-wrap #dv-log-text{min-height:70px;resize:vertical;}" +
      ".dv-wrap #dv-method,.dv-wrap #dv-priority,.dv-wrap #dv-status,.dv-wrap #dv-driver-select{" +
      "width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;color-scheme:dark;font-family:inherit;font-size:13px;}" +
      ".dv-wrap input:focus,.dv-wrap select:focus,.dv-wrap textarea:focus{" +
      "border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);}" +
      ".dv-wrap #dv-new-driver-wrap{margin-top:8px;}" +

      // Items editor
      ".dv-items-editor{display:flex;flex-direction:column;gap:6px;}" +
      ".dv-item-edit-row{display:grid;grid-template-columns:1fr 60px 90px 80px 100px 28px;gap:6px;align-items:center;}" +
      ".dv-item-edit-row input,.dv-item-edit-row select{" +
      "padding:7px 10px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:8px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;font-family:inherit;font-size:12px;color-scheme:dark;}" +
      ".dv-item-edit-row input:focus,.dv-item-edit-row select:focus{border-color:rgba(58,160,255,.45);}" +
      ".dv-item-del-btn{background:rgba(255,90,122,.12);border:1px solid rgba(255,90,122,.25);color:#ff8fa5;border-radius:6px;cursor:pointer;font-weight:900;font-size:14px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;}" +
      ".dv-item-del-btn:hover{background:rgba(255,90,122,.2);}" +
      ".dv-item-add-btn{margin-top:4px;}" +

      // Search
      ".dv-wrap #dv-search-active,.dv-wrap #dv-search-completed,.dv-wrap #dv-search-failed{" +
      "color-scheme:dark;padding:9px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;min-width:240px;font-family:inherit;font-size:12px;}" +
      ".dv-wrap #dv-search-active:focus,.dv-wrap #dv-search-completed:focus,.dv-wrap #dv-search-failed:focus{" +
      "border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);}" +

      // Responsive
      "@media(max-width:1100px){.dv-stats{grid-template-columns:repeat(3,1fr);}}" +
      "@media(max-width:760px){.dv-stats{grid-template-columns:repeat(2,1fr);}.dv-sel-grid{grid-template-columns:repeat(2,1fr);}}" +
      "@media(max-width:600px){.dv-sel-grid{grid-template-columns:1fr;}.dv-kv.wide,.dv-kv.half{grid-column:1/-1;}}" +
      "@media(max-width:920px){.dv-wrap{padding:12px;}}";

    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Badge helpers
  // ------------------------------------------------------------
  function statusCls(s) {
    var map = {
      "Scheduled":"scheduled","Dispatched":"dispatched","Out for Delivery":"outfordelivery",
      "Delivered":"delivered","Failed":"failed","Returned":"returned","Cancelled":"cancelled"
    };
    return map[s]||"scheduled";
  }
  function statusBadge(s) {
    var span = document.createElement("span");
    span.className = "dv-chip "+statusCls(s||"Scheduled");
    span.textContent = s||"Scheduled";
    return span;
  }

  function methodBadge(m) {
    var span = document.createElement("span");
    var cls = m==="Courier"?"courier":m==="Collection"?"collection":"inhouse";
    span.className = "dv-chip "+cls;
    span.textContent = m||"In-house Driver";
    return span;
  }

  function prBadge(priority) {
    var p = Number(priority||2);
    if (p!==1&&p!==2&&p!==3) p=2;
    var wrap=document.createElement("span"); wrap.className="dv-pr";
    var dot=document.createElement("span");  dot.className="dv-dot p"+p;
    var txt=document.createElement("span");  txt.textContent=(p===1?"Urgent":p===2?"Standard":"Flexible");
    wrap.appendChild(dot); wrap.appendChild(txt);
    return wrap;
  }

  function attBadge(n) {
    var span=document.createElement("span");
    var a=Number(n||0);
    var cls = a>=3?"a3":a>=2?"a2":"a1";
    span.className="dv-att "+cls;
    span.textContent=String(a);
    return span;
  }

  // ------------------------------------------------------------
  // Sorting
  // ------------------------------------------------------------
  function cmp(a,b){ if(a<b)return -1; if(a>b)return 1; return 0; }
  function getSortVal(r,key) {
    var v = r?r[key]:"";
    if (key==="priority") return Number(v||2);
    if (key==="delivery_attempts") return Number(v||0);
    if (key==="order_date"||key==="scheduled_date") return String(v||"");
    return norm(v);
  }
  function sortList(list, sortState) {
    var key = sortState&&sortState.key?String(sortState.key):"order_date";
    var dir = sortState&&sortState.dir?String(sortState.dir):"desc";
    var mul = dir==="desc"?-1:1;
    list.sort(function(ra,rb){
      var a=getSortVal(ra,key), b=getSortVal(rb,key);
      var c=0;
      if (key==="priority"||key==="delivery_attempts") c=cmp(Number(a||0),Number(b||0));
      else c=cmp(String(a||""),String(b||""));
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
    entries:     [],
    mode:        "api",
    lastError:   null,
    tab:         "active",
    queryActive:    "",
    queryCompleted: "",
    queryFailed:    "",
    sortActive:    {key:"priority", dir:"asc"},
    sortCompleted: {key:"actual_delivery_date", dir:"desc"},
    sortFailed:    {key:"order_date", dir:"desc"},
    filteredActive:    [],
    filteredCompleted: [],
    filteredFailed:    [],
    selectedId:  null,
    refresh:     null,
    renderSelectedPanel: null
  };

  // ------------------------------------------------------------
  // Filter + sort
  // ------------------------------------------------------------
  function applyFilterSplitSort() {
    var all = Array.isArray(state.entries)?state.entries.slice():[];
    var active=[], completed=[], failed=[];
    for (var i=0;i<all.length;i++) {
      var r=all[i]||{};
      if (isActive(r))    active.push(r);
      else if (isFailed(r)) failed.push(r);
      else if (isCompleted(r)) completed.push(r);
    }
    var qa=norm(state.queryActive), qc=norm(state.queryCompleted), qf=norm(state.queryFailed);
    if (qa) active    = active.filter(function(r){return rowSearchBlob(r).indexOf(qa)>=0;});
    if (qc) completed = completed.filter(function(r){return rowSearchBlob(r).indexOf(qc)>=0;});
    if (qf) failed    = failed.filter(function(r){return rowSearchBlob(r).indexOf(qf)>=0;});
    sortList(active,    state.sortActive);
    sortList(completed, state.sortCompleted);
    sortList(failed,    state.sortFailed);
    state.filteredActive    = active;
    state.filteredCompleted = completed;
    state.filteredFailed    = failed;
  }

  // ------------------------------------------------------------
  // Table columns
  // ------------------------------------------------------------
  var COLS_ACTIVE = [
    {key:"delivery_id",      label:"Del #"},
    {key:"order_date",       label:"Order Date"},
    {key:"scheduled_date",   label:"Scheduled"},
    {key:"client_name",      label:"Client"},
    {key:"phone",            label:"Phone"},
    {key:"delivery_method",  label:"Method"},
    {key:"priority",         label:"Priority"},
    {key:"status",           label:"Status"},
    {key:"assigned_driver",  label:"Driver / Carrier"},
    {key:"delivery_attempts",label:"Attempts"},
    {key:"tracking_number",  label:"Tracking"}
  ];
  var COLS_COMPLETED = [
    {key:"delivery_id",           label:"Del #"},
    {key:"order_date",            label:"Order Date"},
    {key:"actual_delivery_date",  label:"Delivered"},
    {key:"client_name",           label:"Client"},
    {key:"delivery_method",       label:"Method"},
    {key:"status",                label:"Status"},
    {key:"assigned_driver",       label:"Driver / Carrier"},
    {key:"signature_obtained",    label:"Signature"},
    {key:"recipient_name",        label:"Recipient"}
  ];
  var COLS_FAILED = [
    {key:"delivery_id",       label:"Del #"},
    {key:"order_date",        label:"Order Date"},
    {key:"client_name",       label:"Client"},
    {key:"status",            label:"Status"},
    {key:"delivery_attempts", label:"Attempts"},
    {key:"failure_reason",    label:"Failure Reason"},
    {key:"assigned_driver",   label:"Driver / Carrier"}
  ];

  // ------------------------------------------------------------
  // Table row builder
  // ------------------------------------------------------------
  function buildTableRow(entry, which) {
    var tr = document.createElement("tr");
    tr.setAttribute("data-id", String(entry&&entry.id!=null?entry.id:""));
    tr.tabIndex = 0;
    if (state.selectedId && entry && String(entry.id)===String(state.selectedId)) {
      tr.classList.add("dv-row-sel");
    }

    function td(content, cls, title) {
      var cell = document.createElement("td");
      if (cls) cell.className = cls;
      if (title) cell.title = title;
      if (typeof content === "string" || typeof content === "number") {
        cell.textContent = String(content);
      } else if (content && content.nodeType) {
        cell.appendChild(content);
      }
      return cell;
    }

    if (which==="active") {
      tr.appendChild(td(entry.delivery_id||""));
      tr.appendChild(td(fmtDmyFromYmd(entry.order_date||"")));
      // scheduled with time slot
      var schedCell = document.createElement("td");
      var schedMain = document.createElement("span"); schedMain.textContent = fmtDmyFromYmd(entry.scheduled_date||"");
      schedCell.appendChild(schedMain);
      if (entry.scheduled_time_slot) {
        var schedSub=document.createElement("span");
        schedSub.style.cssText="color:var(--muted,rgba(233,238,247,.5));font-size:10px;margin-left:5px;";
        schedSub.textContent=entry.scheduled_time_slot;
        schedCell.appendChild(schedSub);
      }
      tr.appendChild(schedCell);
      // client with flags
      var clientCell=document.createElement("td");
      var clientName=document.createElement("strong"); clientName.textContent=entry.client_name||"";
      clientCell.appendChild(clientName);
      if (entry.contains_controlled) { var cdSpan=document.createElement("span"); cdSpan.textContent=" 🔐"; clientCell.appendChild(cdSpan); }
      if (entry.cold_chain_required) { var ccSpan=document.createElement("span"); ccSpan.textContent=" ❄️"; clientCell.appendChild(ccSpan); }
      tr.appendChild(clientCell);
      tr.appendChild(td(entry.phone||""));
      var methCell=document.createElement("td"); methCell.appendChild(methodBadge(entry.delivery_method)); tr.appendChild(methCell);
      var prCell=document.createElement("td"); prCell.appendChild(prBadge(entry.priority)); tr.appendChild(prCell);
      var stCell=document.createElement("td"); stCell.appendChild(statusBadge(entry.status)); tr.appendChild(stCell);
      // driver
      var driverCell=document.createElement("td");
      if (!entry.assigned_driver) {
        var unassigned=document.createElement("span"); unassigned.style.cssText="color:rgba(255,90,122,.7);";
        unassigned.textContent="Unassigned"; driverCell.appendChild(unassigned);
      } else { driverCell.textContent=entry.assigned_driver; }
      tr.appendChild(driverCell);
      var attCell=document.createElement("td"); attCell.appendChild(attBadge(entry.delivery_attempts)); tr.appendChild(attCell);
      var trackCell=document.createElement("td");
      if (entry.tracking_number) {
        var mono=document.createElement("span"); mono.className="dv-mono"; mono.textContent=entry.tracking_number;
        trackCell.appendChild(mono);
      } else { trackCell.textContent="—"; }
      tr.appendChild(trackCell);

    } else if (which==="completed") {
      tr.appendChild(td(entry.delivery_id||""));
      tr.appendChild(td(fmtDmyFromYmd(entry.order_date||"")));
      var delCell=document.createElement("td");
      delCell.textContent=fmtDmyFromYmd(entry.actual_delivery_date||"");
      if (entry.actual_delivery_time) {
        var timeSpan=document.createElement("span"); timeSpan.className="dv-mono"; timeSpan.style.marginLeft="5px";
        timeSpan.textContent=entry.actual_delivery_time; delCell.appendChild(timeSpan);
      }
      tr.appendChild(delCell);
      tr.appendChild(td(entry.client_name||""));
      var methCell2=document.createElement("td"); methCell2.appendChild(methodBadge(entry.delivery_method)); tr.appendChild(methCell2);
      var stCell2=document.createElement("td"); stCell2.appendChild(statusBadge(entry.status)); tr.appendChild(stCell2);
      tr.appendChild(td(entry.assigned_driver||"—"));
      var sigCell=document.createElement("td");
      if (entry.signature_obtained) {
        var sigYes=document.createElement("span"); sigYes.className="dv-proof yes"; sigYes.textContent="✓ Obtained"; sigCell.appendChild(sigYes);
      } else if (entry.signature_required) {
        var sigNo=document.createElement("span"); sigNo.className="dv-proof no"; sigNo.textContent="✗ Missing"; sigCell.appendChild(sigNo);
      } else {
        sigCell.textContent="—";
      }
      tr.appendChild(sigCell);
      tr.appendChild(td(entry.recipient_name||"—"));

    } else if (which==="failed") {
      tr.appendChild(td(entry.delivery_id||""));
      tr.appendChild(td(fmtDmyFromYmd(entry.order_date||"")));
      tr.appendChild(td(entry.client_name||""));
      var stCell3=document.createElement("td"); stCell3.appendChild(statusBadge(entry.status)); tr.appendChild(stCell3);
      var attCell3=document.createElement("td"); attCell3.appendChild(attBadge(entry.delivery_attempts)); tr.appendChild(attCell3);
      var frCell=document.createElement("td");
      frCell.style.cssText="max-width:220px;white-space:normal;color:rgba(255,157,67,.9);font-size:11px;";
      frCell.textContent=entry.failure_reason||"—";
      tr.appendChild(frCell);
      tr.appendChild(td(entry.assigned_driver||"—"));
    }

    function selectRow() {
      if (!entry||entry.id==null) return;
      state.selectedId = String(entry.id);
      if (typeof state.renderSelectedPanel==="function") state.renderSelectedPanel();
    }
    tr.addEventListener("click", function(){ selectRow(); });
    tr.addEventListener("keydown", function(ev){
      var k=ev&&(ev.key||ev.keyCode);
      if (k==="Enter"||k===" "||k===13||k===32){ ev.preventDefault(); selectRow(); }
    });
    return tr;
  }

  function renderTable(tbodyEl, list, which) {
    tbodyEl.innerHTML = "";
    for (var i=0;i<list.length;i++) {
      tbodyEl.appendChild(buildTableRow(list[i], which));
    }
  }

  // ------------------------------------------------------------
  // Sort headers
  // ------------------------------------------------------------
  function thHtml(col) {
    return "<span class='dv-sort'><span>"+esc(col.label)+"</span><span class='car'></span></span>";
  }
  function updateSortHeaders(tableEl, sortState) {
    if (!tableEl) return;
    var ths = tableEl.querySelectorAll("th[data-key]");
    ths.forEach(function(th){
      var key=th.getAttribute("data-key")||"";
      var wrap=th.querySelector(".dv-sort"); if (!wrap) return;
      if (sortState.key===key) {
        wrap.classList.add("on");
        var car=wrap.querySelector(".car"); if(car) car.textContent=(sortState.dir==="desc"?"▼":"▲");
      } else {
        wrap.classList.remove("on");
        var car2=wrap.querySelector(".car"); if(car2) car2.textContent="";
      }
    });
  }
  function wireSortableHeaders(tableEl, which) {
    if (!tableEl) return;
    var ths = tableEl.querySelectorAll("th[data-key]");
    ths.forEach(function(th){
      var key=th.getAttribute("data-key"); if(!key) return;
      th.addEventListener("click", function(){
        var s = which==="completed"?state.sortCompleted:which==="failed"?state.sortFailed:state.sortActive;
        if (s.key===key) s.dir=(s.dir==="asc"?"desc":"asc"); else {s.key=key;s.dir="asc";}
        rerender();
      });
    });
  }

  // ------------------------------------------------------------
  // Rerender
  // ------------------------------------------------------------
  function rerender(mount) {
    var m = mount || document;
    try {
      applyFilterSplitSort();

      var tbodyA = m.querySelector("#dv-tbody-active");
      var tbodyC = m.querySelector("#dv-tbody-completed");
      var tbodyF = m.querySelector("#dv-tbody-failed");
      if (tbodyA) renderTable(tbodyA, state.filteredActive,    "active");
      if (tbodyC) renderTable(tbodyC, state.filteredCompleted, "completed");
      if (tbodyF) renderTable(tbodyF, state.filteredFailed,    "failed");

      // Counts
      var totalA=0, totalC=0, totalF=0;
      (state.entries||[]).forEach(function(r){
        if (isCompleted(r)) totalC++;
        else if (isFailed(r)) totalF++;
        else totalA++;
      });
      var countA=m.querySelector("#dv-count-active");
      var countC=m.querySelector("#dv-count-completed");
      var countF=m.querySelector("#dv-count-failed");
      if (countA) countA.textContent="Showing "+String(state.filteredActive.length)+" / "+String(totalA);
      if (countC) countC.textContent=String(state.filteredCompleted.length)+" of "+String(totalC)+" records";
      if (countF) countF.textContent=String(state.filteredFailed.length)+" of "+String(totalF)+" records";

      // Stats
      var statsEl=m.querySelector("#dv-stats");
      if (statsEl) renderStats(statsEl);

      // Sort headers
      var tableA=m.querySelector("#dv-table-active");
      var tableC=m.querySelector("#dv-table-completed");
      var tableF=m.querySelector("#dv-table-failed");
      if (tableA) updateSortHeaders(tableA, state.sortActive);
      if (tableC) updateSortHeaders(tableC, state.sortCompleted);
      if (tableF) updateSortHeaders(tableF, state.sortFailed);

      try { if (typeof state.renderSelectedPanel==="function") state.renderSelectedPanel(); } catch(e2){}
    } catch(e) {
      try{err("rerender failed",{message:e&&e.message?e.message:String(e)});}catch(e2){}
    }
  }

  // ------------------------------------------------------------
  // Stats bar
  // ------------------------------------------------------------
  function renderStats(el) {
    var all = state.entries||[];
    var activeCount    = all.filter(isActive).length;
    var urgentCount    = all.filter(function(r){return r&&r.priority===1&&isActive(r);}).length;
    var deliveredCount = all.filter(isCompleted).length;
    var failedCount    = all.filter(isFailed).length;
    var totalCount     = all.length;

    var stats = [
      {val:activeCount,    lbl:"Active Deliveries",    icon:"🚚", color:"rgba(58,160,255,.8)"},
      {val:urgentCount,    lbl:"Urgent (Priority 1)",  icon:"🔴", color:"rgba(255,90,122,.8)"},
      {val:deliveredCount, lbl:"Delivered",             icon:"✅", color:"rgba(67,209,122,.8)"},
      {val:failedCount,    lbl:"Failed / Returned",     icon:"⚠️", color:"rgba(255,157,67,.8)"},
      {val:totalCount,     lbl:"Total Records",         icon:"📦", color:"rgba(156,132,255,.8)"}
    ];

    el.innerHTML = stats.map(function(s){
      return "<div class='dv-stat' style='--stat-color:"+s.color+"'>" +
        "<div class='s-icon'>"+s.icon+"</div>" +
        "<div class='s-val'>"+s.val+"</div>" +
        "<div class='s-lbl'>"+esc(s.lbl)+"</div>" +
        "</div>";
    }).join("");
  }

  // ------------------------------------------------------------
  // Tab switching
  // ------------------------------------------------------------
  function setTab(tab, mount) {
    state.tab = tab;
    var m = mount||document;
    var panes = ["active","completed","failed"];
    panes.forEach(function(p){
      var el=m.querySelector("#dv-pane-"+p);
      if (el) el.style.display=(p===tab?"block":"none");
    });
    var tabs = m.querySelectorAll(".dv-tab");
    var tabIds = ["active","completed","failed"];
    tabs.forEach(function(t,i){
      t.classList.toggle("active", tabIds[i]===tab);
    });
  }

  // ------------------------------------------------------------
  // Selected panel
  // ------------------------------------------------------------
  function buildSelectedPanel(entry, mount) {
    var m = mount||document;
    var selContent  = m.querySelector("#dv-sel-content");
    var selMeta     = m.querySelector("#dv-sel-meta");
    var selBtnNote  = m.querySelector("#dv-sel-add-note");
    var selBtnEdit  = m.querySelector("#dv-sel-edit");
    var selBtnDel   = m.querySelector("#dv-sel-del");
    var selBtnPrint = m.querySelector("#dv-sel-print");
    var selBtnDeliv = m.querySelector("#dv-sel-deliver");
    var selBtnFail  = m.querySelector("#dv-sel-fail");

    // Highlight rows
    var allRows = m.querySelectorAll(".dv-table tbody tr");
    allRows.forEach(function(r){ r.classList.remove("dv-row-sel"); });
    if (entry) {
      var selRow = m.querySelector(".dv-table tbody tr[data-id='"+String(entry.id)+"']");
      if (selRow) selRow.classList.add("dv-row-sel");
    }

    if (!entry) {
      if (selContent) selContent.innerHTML = "<div style='color:var(--muted,rgba(233,238,247,.45));font-size:12px;font-style:italic;padding:6px 0;'>Click a row to view full details, items, and delivery log.</div>";
      if (selMeta) selMeta.textContent = "Click a row to view full details, items, and delivery log.";
      [selBtnNote,selBtnEdit,selBtnDel,selBtnPrint,selBtnDeliv,selBtnFail].forEach(function(b){if(b)b.disabled=true;});
      return;
    }

    if (selMeta) selMeta.textContent = entry.delivery_id + " · " + entry.client_name + " · " + (entry.status||"");
    [selBtnNote,selBtnEdit,selBtnDel,selBtnPrint,selBtnDeliv,selBtnFail].forEach(function(b){if(b)b.disabled=false;});

    // disable deliver/fail based on status
    if (selBtnDeliv) selBtnDeliv.disabled = isCompleted(entry)||isFailed(entry);
    if (selBtnFail)  selBtnFail.disabled  = isCompleted(entry)||isFailed(entry);

    var grid = document.createElement("div"); grid.className="dv-sel-grid";

    function kv(label, content, cls) {
      var wrap=document.createElement("div"); wrap.className="dv-kv"+(cls?" "+cls:"");
      var k=document.createElement("div"); k.className="k"; k.textContent=label;
      var v=document.createElement("div"); v.className="v";
      if (content&&content.nodeType) { v.appendChild(content); }
      else { v.textContent=(content==null||String(content).trim()===""?"—":String(content)); }
      wrap.appendChild(k); wrap.appendChild(v);
      return wrap;
    }
    function kvHtml(label, html, cls) {
      var wrap=document.createElement("div"); wrap.className="dv-kv"+(cls?" "+cls:"");
      var k=document.createElement("div"); k.className="k"; k.textContent=label;
      var v=document.createElement("div"); v.className="v"; v.innerHTML=html;
      wrap.appendChild(k); wrap.appendChild(v);
      return wrap;
    }

    grid.appendChild(kv("Delivery ID",    entry.delivery_id||""));
    grid.appendChild(kv("Order Date",     fmtDmyFromYmd(entry.order_date||"")));
    grid.appendChild(kv("Scheduled",      fmtDmyFromYmd(entry.scheduled_date||"")+(entry.scheduled_time_slot?" · "+entry.scheduled_time_slot:"")));
    var deliveredVal = entry.actual_delivery_date ? fmtDmyFromYmd(entry.actual_delivery_date)+(entry.actual_delivery_time?" "+entry.actual_delivery_time:"") : "—";
    grid.appendChild(kv("Delivered",      deliveredVal));
    grid.appendChild(kv("Client",         entry.client_name||""));
    grid.appendChild(kv("Phone",          entry.phone||""));
    grid.appendChild(kv("Email",          entry.email||""));
    grid.appendChild(kv("Ticket Ref",     entry.ticket_ref||""));

    var methWrap=document.createElement("span"); methWrap.appendChild(methodBadge(entry.delivery_method)); grid.appendChild(kv("Method", methWrap));
    var prWrap=document.createElement("span"); prWrap.appendChild(prBadge(entry.priority)); grid.appendChild(kv("Priority", prWrap));
    var stWrap=document.createElement("span"); stWrap.appendChild(statusBadge(entry.status)); grid.appendChild(kv("Status", stWrap));
    var attWrap=document.createElement("span"); attWrap.appendChild(attBadge(entry.delivery_attempts)); grid.appendChild(kv("Attempts", attWrap));

    grid.appendChild(kv("Driver / Carrier", entry.assigned_driver||"Unassigned"));

    if (entry.tracking_number) {
      var trackSpan=document.createElement("span"); trackSpan.className="dv-mono"; trackSpan.textContent=entry.tracking_number;
      grid.appendChild(kv("Tracking #", trackSpan));
    }

    // Signature
    var sigEl;
    if (entry.signature_obtained) {
      sigEl=document.createElement("span"); sigEl.className="dv-proof yes"; sigEl.textContent="✓ Obtained";
    } else if (entry.signature_required) {
      sigEl=document.createElement("span"); sigEl.className="dv-proof no"; sigEl.textContent="✗ Not yet";
    } else {
      sigEl=document.createElement("span"); sigEl.style.cssText="font-style:italic;color:var(--muted,rgba(233,238,247,.5));"; sigEl.textContent="Not required";
    }
    grid.appendChild(kv("Signature", sigEl));
    grid.appendChild(kv("Recipient", entry.recipient_name||""));

    // Flags
    var flags=[];
    if (entry.contains_controlled) flags.push({cls:"cd", text:"🔐 Controlled Drug"});
    if (entry.cold_chain_required) flags.push({cls:"cold", text:"❄️ Cold Chain"});
    if (entry.signature_required)  flags.push({cls:"sig", text:"✍ Sig Required"});
    if (flags.length) {
      var flagsWrap=document.createElement("div"); flagsWrap.style.cssText="display:flex;gap:6px;flex-wrap:wrap;";
      flags.forEach(function(f){
        var fb=document.createElement("span"); fb.className="dv-flag "+f.cls; fb.textContent=f.text;
        flagsWrap.appendChild(fb);
      });
      grid.appendChild(kv("Flags", flagsWrap, "half"));
    }

    // Address (wide)
    var addrWrap=document.createElement("div"); addrWrap.className="dv-kv wide";
    var addrK=document.createElement("div"); addrK.className="k"; addrK.textContent="Delivery Address";
    var addrV=document.createElement("div"); addrV.className="v";
    addrV.textContent=entry.delivery_address||"";
    if (entry.address_notes) {
      var anSpan=document.createElement("div"); anSpan.style.cssText="color:var(--muted,rgba(233,238,247,.5));font-size:11px;margin-top:4px;";
      anSpan.textContent=entry.address_notes; addrV.appendChild(anSpan);
    }
    addrWrap.appendChild(addrK); addrWrap.appendChild(addrV);
    grid.appendChild(addrWrap);

    if (entry.proof_of_delivery) grid.appendChild(kv("Proof of Delivery", entry.proof_of_delivery, "wide"));
    if (entry.failure_reason) {
      var frKv=kv("Failure Reason", entry.failure_reason, "wide");
      frKv.querySelector(".k").style.color="rgba(255,157,67,.8)";
      frKv.querySelector(".v").style.color="rgba(255,157,67,.9)";
      grid.appendChild(frKv);
    }
    if (entry.internal_notes) {
      var inKv=kv("Internal Notes", entry.internal_notes, "wide");
      inKv.querySelector(".v").style.color="var(--muted,rgba(233,238,247,.55))";
      grid.appendChild(inKv);
    }

    selContent.innerHTML="";
    selContent.appendChild(grid);

    // Items
    var items = parseItems(entry.items);
    var itemsBlock = document.createElement("div");
    itemsBlock.className="dv-kv";
    itemsBlock.style.marginBottom="10px";
    var itemsK=document.createElement("div"); itemsK.className="k"; itemsK.textContent="Items ("+items.length+")";
    var itemsV=document.createElement("div"); itemsV.className="v"; itemsV.style.marginTop="6px";
    if (!items.length) {
      var noItems=document.createElement("em"); noItems.style.cssText="color:var(--muted);font-size:12px;"; noItems.textContent="No items recorded.";
      itemsV.appendChild(noItems);
    } else {
      var itemsList=document.createElement("div"); itemsList.className="dv-items";
      var schedColors={"CD":"rgba(255,90,122,.9)","POM":"rgba(255,157,67,.9)","P":"rgba(58,160,255,.9)","OTC":"rgba(67,209,122,.9)"};
      items.forEach(function(it){
        var row=document.createElement("div"); row.className="dv-item-row";
        var qty=document.createElement("span"); qty.className="dv-item-qty"; qty.textContent="×"+(it.qty||1);
        var name=document.createElement("span"); name.className="dv-item-name"; name.textContent=it.name||"";
        var sched=document.createElement("span"); sched.className="dv-item-meta";
        sched.style.color=schedColors[it.schedule]||schedColors["OTC"];
        sched.textContent=it.schedule||"";
        var batch=document.createElement("span"); batch.className="dv-item-meta"; batch.textContent=it.batch_ref||"";
        var exp=document.createElement("span"); exp.className="dv-item-meta"; exp.textContent=it.expiry?"Exp "+it.expiry:"";
        row.appendChild(qty); row.appendChild(name); row.appendChild(sched);
        if (it.batch_ref) row.appendChild(batch);
        if (it.expiry)    row.appendChild(exp);
        itemsList.appendChild(row);
      });
      itemsV.appendChild(itemsList);
    }
    itemsBlock.appendChild(itemsK); itemsBlock.appendChild(itemsV);
    selContent.appendChild(itemsBlock);

    // Delivery log
    var logEntries = parseDeliveryLog(entry.delivery_log);
    var logBlock = document.createElement("div"); logBlock.className="dv-log-wrap";
    var logHead = document.createElement("div"); logHead.className="dv-log-head";
    var logLbl  = document.createElement("span"); logLbl.className="dv-log-lbl";
    logLbl.textContent = "Delivery Log ("+logEntries.length+" entr"+(logEntries.length===1?"y":"ies")+")";
    logHead.appendChild(logLbl);
    logBlock.appendChild(logHead);

    if (!logEntries.length) {
      var emptyLog=document.createElement("div"); emptyLog.className="dv-log-empty";
      emptyLog.textContent="No log entries yet. Use 'Add Log Entry' to record updates.";
      logBlock.appendChild(emptyLog);
    } else {
      var sortedLog = logEntries.slice().sort(function(a,b){return (b.ts||"").localeCompare(a.ts||"");});
      sortedLog.forEach(function(n){
        var entry_wrap=document.createElement("div"); entry_wrap.className="dv-log-entry";
        var meta=document.createElement("div"); meta.className="dv-log-meta";
        var tsSpan=document.createElement("span"); tsSpan.textContent=fmtTs(n.ts||""); meta.appendChild(tsSpan);
        if (n.author) {
          var auth=document.createElement("span"); auth.className="dv-log-author"; auth.textContent=n.author;
          meta.appendChild(auth);
        }
        var txt=document.createElement("div"); txt.className="dv-log-text"; txt.textContent=n.text||"";
        entry_wrap.appendChild(meta); entry_wrap.appendChild(txt);
        logBlock.appendChild(entry_wrap);
      });
    }
    selContent.appendChild(logBlock);
  }

  // ------------------------------------------------------------
  // Print
  // ------------------------------------------------------------
  function printTable(list, title, query) {
    var w = window.open("","_blank");
    if (!w) {
      try{E.modal.show("Print","<div>Popup blocked. Please allow popups and try again.</div>",
        [{label:"Close",primary:true,onClick:function(){E.modal.hide();}}]);}catch(e){}
      return;
    }
    function safe(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
    var rowsHtml="";
    list.forEach(function(r){
      var items=parseItems(r.items).map(function(i){return (i.qty||1)+"× "+safe(i.name||"");}).join(", ");
      rowsHtml+="<tr>"+
        "<td>"+safe(r.delivery_id||"")+"</td>"+
        "<td>"+safe(fmtDmyFromYmd(r.order_date||""))+"</td>"+
        "<td>"+safe(fmtDmyFromYmd(r.scheduled_date||"")+(r.scheduled_time_slot?" "+r.scheduled_time_slot:""))+"</td>"+
        "<td>"+safe(r.client_name||"")+"</td>"+
        "<td>"+safe(r.phone||"")+"</td>"+
        "<td>"+safe(r.delivery_method||"")+"</td>"+
        "<td>"+safe(r.assigned_driver||"")+"</td>"+
        "<td>"+safe(r.status||"")+"</td>"+
        "<td>"+safe(r.delivery_address||"")+"</td>"+
        "<td>"+safe(items)+"</td>"+
        "</tr>";
    });
    var html="<!doctype html><html><head><meta charset='utf-8'><title>"+safe(title||"Deliveries")+"</title>"+
      "<style>body{font-family:system-ui,-apple-system,Arial,sans-serif;margin:18px;color:#111;font-size:12px;}"+
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;}"+
      "h1{margin:0 0 4px;font-size:18px;}.meta{font-size:11px;color:#555;margin-bottom:10px;}"+
      "table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:5px 7px;font-size:11px;vertical-align:top;}"+
      "th{background:#f0f2f5;font-weight:800;text-align:left;}tr:nth-child(even){background:#fafbfc;}"+
      "@media print{button{display:none!important;}}</style></head><body>"+
      "<button onclick='window.print()'>🖨 Print</button>"+
      "<h1>"+safe(title||"Deliveries")+"</h1>"+
      "<div class='meta'>Rows: "+safe(String(list.length))+(query?"  ·  Search: "+safe(query):"")+"  ·  Printed: "+safe(new Date().toLocaleString())+"</div>"+
      "<table><thead><tr><th>Del #</th><th>Order Date</th><th>Scheduled</th><th>Client</th><th>Phone</th><th>Method</th><th>Driver</th><th>Status</th><th>Address</th><th>Items</th></tr></thead>"+
      "<tbody>"+rowsHtml+"</tbody></table>"+
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script></body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  function printSingleDelivery(entry) {
    if (!entry) return;
    var w=window.open("","_blank");
    if (!w) return;
    function safe(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
    var items=parseItems(entry.items);
    var itemsHtml=items.map(function(it){
      return "<tr><td>"+safe(it.qty||1)+"</td><td>"+safe(it.name||"")+"</td>"+
        "<td>"+safe(it.schedule||"")+"</td><td>"+safe(it.batch_ref||"")+"</td><td>"+safe(it.expiry||"")+"</td></tr>";
    }).join("");
    var logEntries=parseDeliveryLog(entry.delivery_log);
    var logHtml=logEntries.length?logEntries.slice().reverse().map(function(n){
      return "<div style='border:1px solid #e2e4e8;border-radius:6px;padding:8px;margin-bottom:6px;'>"+
        "<div style='font-size:10px;color:#888;margin-bottom:4px;'>"+safe(fmtTs(n.ts||""))+(n.author?" · "+safe(n.author):"")+
        "</div><div style='font-size:12px;'>"+safe(n.text||"")+"</div></div>";
    }).join("") : "<p style='color:#888;font-style:italic;font-size:12px;'>No log entries.</p>";
    var html="<!doctype html><html><head><meta charset='utf-8'><title>"+safe(entry.delivery_id||"Delivery")+"</title>"+
      "<style>body{font-family:system-ui,-apple-system,Arial,sans-serif;margin:24px;color:#111;max-width:700px;}"+
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;}"+
      ".hdr{border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:16px;}"+
      ".did{font-size:22px;font-weight:900;}.dsub{font-size:12px;color:#666;margin-top:4px;}"+
      ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}"+
      ".kv{border:1px solid #e2e4e8;border-radius:8px;padding:10px;}"+
      ".kv .k{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}"+
      ".kv .v{font-size:12px;}.wide{grid-column:1/-1;}"+
      "h3{margin:0 0 8px;font-size:14px;}"+
      "table{width:100%;border-collapse:collapse;margin-bottom:14px;}"+
      "th,td{border:1px solid #e2e4e8;padding:5px 8px;font-size:11px;text-align:left;}"+
      "th{background:#f5f5f5;font-weight:800;}"+
      "@media print{button{display:none!important;}}</style></head><body>"+
      "<button onclick='window.print()'>🖨 Print</button>"+
      "<div class='hdr'><div class='did'>"+safe(entry.delivery_id||"—")+"</div>"+
      "<div class='dsub'>"+safe(entry.client_name||"")+" · "+safe(fmtDmyFromYmd(entry.scheduled_date||""))+(entry.scheduled_time_slot?" "+safe(entry.scheduled_time_slot):"")+" · Status: "+safe(entry.status||"")+"</div></div>"+
      "<div class='grid'>"+
      "<div class='kv'><div class='k'>Client</div><div class='v'>"+safe(entry.client_name||"—")+"</div></div>"+
      "<div class='kv'><div class='k'>Phone</div><div class='v'>"+safe(entry.phone||"—")+"</div></div>"+
      "<div class='kv'><div class='k'>Method</div><div class='v'>"+safe(entry.delivery_method||"—")+"</div></div>"+
      "<div class='kv'><div class='k'>Driver / Carrier</div><div class='v'>"+safe(entry.assigned_driver||"—")+"</div></div>"+
      "<div class='kv'><div class='k'>Priority</div><div class='v'>"+(entry.priority===1?"Urgent":entry.priority===2?"Standard":"Flexible")+"</div></div>"+
      "<div class='kv'><div class='k'>Tracking #</div><div class='v'>"+safe(entry.tracking_number||"—")+"</div></div>"+
      "<div class='kv wide'><div class='k'>Delivery Address</div><div class='v'>"+safe(entry.delivery_address||"—")+(entry.address_notes?"<br><small style='color:#888;'>"+safe(entry.address_notes)+"</small>":"")+"</div></div>"+
      (entry.proof_of_delivery?"<div class='kv wide'><div class='k'>Proof of Delivery</div><div class='v'>"+safe(entry.proof_of_delivery)+"</div></div>":"")+
      (entry.failure_reason?"<div class='kv wide'><div class='k'>Failure Reason</div><div class='v'>"+safe(entry.failure_reason)+"</div></div>":"")+
      "</div>"+
      "<h3>Items ("+items.length+")</h3>"+
      "<table><thead><tr><th>Qty</th><th>Name</th><th>Schedule</th><th>Batch Ref</th><th>Expiry</th></tr></thead><tbody>"+itemsHtml+"</tbody></table>"+
      "<h3>Delivery Log ("+logEntries.length+" entr"+(logEntries.length===1?"y":"ies")+")</h3>"+
      logHtml+
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script></body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ------------------------------------------------------------
  // Items editor (for modal)
  // ------------------------------------------------------------
  var itemEditorState = [];

  function buildItemsEditor(containerId, initialItems) {
    itemEditorState = (initialItems||[]).map(function(it){return Object.assign({},it);});
    renderItemsEditor(containerId);
  }

  function renderItemsEditor(containerId) {
    var container = E.q("#"+containerId);
    if (!container) return;
    container.innerHTML = "";
    var wrap = document.createElement("div"); wrap.className="dv-items-editor";

    // Header row labels
    var hdr=document.createElement("div"); hdr.className="dv-item-edit-row";
    hdr.style.cssText="font-size:10px;font-weight:900;color:var(--muted,rgba(233,238,247,.55));text-transform:uppercase;letter-spacing:.6px;";
    ["Name","Qty","Schedule","Batch Ref","Expiry",""].forEach(function(l){
      var s=document.createElement("span"); s.textContent=l; hdr.appendChild(s);
    });
    wrap.appendChild(hdr);

    itemEditorState.forEach(function(item, idx) {
      var row=document.createElement("div"); row.className="dv-item-edit-row";

      var nameIn=document.createElement("input"); nameIn.type="text"; nameIn.placeholder="Item name";
      nameIn.value=esc(item.name||"");
      nameIn.addEventListener("input",function(){ itemEditorState[idx].name=nameIn.value; });

      var qtyIn=document.createElement("input"); qtyIn.type="number"; qtyIn.min="1"; qtyIn.placeholder="1";
      qtyIn.value=String(item.qty||1);
      qtyIn.addEventListener("input",function(){ itemEditorState[idx].qty=parseInt(qtyIn.value||"1",10)||1; });

      var schedSel=document.createElement("select");
      ["OTC","P","POM","CD"].forEach(function(s){
        var opt=document.createElement("option"); opt.value=s; opt.textContent=s;
        if (s===(item.schedule||"OTC")) opt.selected=true;
        schedSel.appendChild(opt);
      });
      schedSel.addEventListener("change",function(){ itemEditorState[idx].schedule=schedSel.value; });

      var batchIn=document.createElement("input"); batchIn.type="text"; batchIn.placeholder="e.g. BTH-1234";
      batchIn.value=esc(item.batch_ref||"");
      batchIn.addEventListener("input",function(){ itemEditorState[idx].batch_ref=batchIn.value; });

      var expiryIn=document.createElement("input"); expiryIn.type="month"; expiryIn.placeholder="YYYY-MM";
      expiryIn.value=item.expiry||""; expiryIn.style.colorScheme="dark";
      expiryIn.addEventListener("input",function(){ itemEditorState[idx].expiry=expiryIn.value; });

      var delBtn=document.createElement("button"); delBtn.type="button"; delBtn.className="dv-item-del-btn"; delBtn.textContent="×";
      delBtn.addEventListener("click",function(){ itemEditorState.splice(idx,1); renderItemsEditor(containerId); });

      row.appendChild(nameIn); row.appendChild(qtyIn); row.appendChild(schedSel);
      row.appendChild(batchIn); row.appendChild(expiryIn); row.appendChild(delBtn);
      wrap.appendChild(row);
    });

    var addBtn=document.createElement("button"); addBtn.type="button"; addBtn.className="eikon-btn dv-item-add-btn";
    addBtn.textContent="+ Add Item";
    addBtn.addEventListener("click",function(){
      itemEditorState.push({name:"",qty:1,schedule:"OTC",batch_ref:"",expiry:""});
      renderItemsEditor(containerId);
    });
    wrap.appendChild(addBtn);
    container.appendChild(wrap);
  }

  // ------------------------------------------------------------
  // Map helpers (Leaflet + OpenStreetMap + Nominatim)
  // ------------------------------------------------------------
  var dvMap = null;
  var dvMapMarker = null;
  var dvMapGeoTimer = null;
  var dvMapLeafletReady = false;

  function dvMapCleanup() {
    try {
      if (dvMapGeoTimer) { clearTimeout(dvMapGeoTimer); dvMapGeoTimer = null; }
      if (dvMap) { dvMap.remove(); dvMap = null; }
      dvMapMarker = null;
    } catch(e) {}
  }

  function dvMapEnsureLeaflet(cb) {
    if (dvMapLeafletReady && window.L) { cb(); return; }
    // Load Leaflet CSS
    if (!document.getElementById("leaflet-css")) {
      var lnk = document.createElement("link");
      lnk.id = "leaflet-css";
      lnk.rel = "stylesheet";
      lnk.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      lnk.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
      lnk.crossOrigin = "";
      document.head.appendChild(lnk);
    }
    // Load Leaflet JS if not present
    if (window.L) { dvMapLeafletReady = true; cb(); return; }
    var s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV/XN/sp8=";
    s.crossOrigin = "";
    s.onload = function() { dvMapLeafletReady = true; cb(); };
    s.onerror = function() { warn("Leaflet failed to load"); };
    document.head.appendChild(s);
  }

  function dvMapInit(initialAddr) {
    dvMapEnsureLeaflet(function() {
      // Small delay to ensure modal DOM is painted
      setTimeout(function() {
        try {
          var el = document.getElementById("dv-map-el");
          if (!el) return;
          dvMapCleanup();

          // Default to Malta centre
          dvMap = window.L.map("dv-map-el", { zoomControl: true, attributionControl: true }).setView([35.9375, 14.3754], 11);
          window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19
          }).addTo(dvMap);

          // Wire address textarea
          var addrEl = document.getElementById("dv-address");
          if (addrEl) {
            addrEl.addEventListener("input", function() {
              if (dvMapGeoTimer) clearTimeout(dvMapGeoTimer);
              var v = (addrEl.value || "").trim();
              if (!v || v.length < 6) { dvMapSetStatus(""); return; }
              dvMapSetStatus("Searching…");
              dvMapGeoTimer = setTimeout(function() { dvMapGeocode(v); }, 800);
            });
          }

          // Geocode initial address if present
          if (initialAddr && initialAddr.trim().length > 5) {
            dvMapSetStatus("Searching…");
            dvMapGeoTimer = setTimeout(function() { dvMapGeocode(initialAddr.trim()); }, 400);
          }
        } catch(ex) { warn("map setup error", ex); }
      }, 120);
    });
  }

  function dvMapSetStatus(msg) {
    var el = document.getElementById("dv-map-status");
    if (el) el.textContent = msg || "";
  }

  function dvMapSetResult(label) {
    var el = document.getElementById("dv-map-result");
    if (!el) return;
    if (label) { el.textContent = "✓ " + label; el.style.display = "block"; }
    else { el.textContent = ""; el.style.display = "none"; }
  }

  async function dvMapGeocode(addr) {
    try {
      var q = encodeURIComponent(addr + ", Malta");
      var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + q;
      var resp = await fetch(url, { headers: { "Accept-Language": "en", "User-Agent": "Eikon-Pharmacy/1.0" } });
      if (!resp.ok) throw new Error("Nominatim " + resp.status);
      var data = await resp.json();
      if (!data || !data.length) {
        dvMapSetStatus("Address not found — check spelling.");
        dvMapSetResult("");
        return;
      }
      var r = data[0];
      var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
      dvMapSetStatus("");
      dvMapSetResult(r.display_name);

      if (!dvMap) return;
      dvMap.setView([lat, lng], 17);

      if (dvMapMarker) {
        dvMapMarker.setLatLng([lat, lng]);
      } else {
        dvMapMarker = window.L.marker([lat, lng]).addTo(dvMap);
      }
      dvMapMarker.bindPopup("<strong style='font-size:12px;'>"+addr+"</strong>").openPopup();
    } catch(ex) {
      dvMapSetStatus("Map lookup failed.");
      warn("geocode error", ex);
    }
  }

  // ------------------------------------------------------------
  // Modal: New / Edit delivery
  // ------------------------------------------------------------
  function openDeliveryModal(opts) {
    var mode  = opts&&opts.mode?String(opts.mode):"new";
    var row   = (opts&&opts.entry)?opts.entry:{};
    var isEdit = mode==="edit";

    var initial = {
      delivery_id:         String(row.delivery_id||"").trim(),
      order_date:          isYmd(row.order_date)?row.order_date:todayYmd(),
      scheduled_date:      isYmd(row.scheduled_date)?row.scheduled_date:"",
      scheduled_time_slot: String(row.scheduled_time_slot||"").trim(),
      client_name:         String(row.client_name||"").trim(),
      phone:               String(row.phone||"").trim(),
      email:               String(row.email||"").trim(),
      delivery_address:    String(row.delivery_address||"").trim(),
      address_notes:       String(row.address_notes||"").trim(),
      id_doc_ref:          String(row.id_doc_ref||"").trim(),
      delivery_method:     String(row.delivery_method||"In-house Driver").trim(),
      priority:            Number(row.priority||2),
      assigned_driver:     String(row.assigned_driver||"").trim(),
      tracking_number:     String(row.tracking_number||"").trim(),
      status:              String(row.status||"Scheduled").trim(),
      signature_required:  !!(row.signature_required),
      cold_chain_required: !!(row.cold_chain_required),
      ticket_ref:          String(row.ticket_ref||"").trim(),
      internal_notes:      String(row.internal_notes||"").trim(),
      items:               typeof row.items==="string"?row.items:JSON.stringify(parseItems(row.items)),
      delivery_log:        typeof row.delivery_log==="string"?row.delivery_log:JSON.stringify(parseDeliveryLog(row.delivery_log)),
      // edit-only outcome fields
      actual_delivery_date:String(row.actual_delivery_date||"").trim(),
      actual_delivery_time:String(row.actual_delivery_time||"").trim(),
      signature_obtained:  !!(row.signature_obtained),
      recipient_name:      String(row.recipient_name||"").trim(),
      proof_of_delivery:   String(row.proof_of_delivery||"").trim(),
      failure_reason:      String(row.failure_reason||"").trim(),
      delivery_attempts:   Number(row.delivery_attempts||0)
    };
    if (!(initial.priority===1||initial.priority===2||initial.priority===3)) initial.priority=2;

    function buildDriverOptions(selected) {
      var drivers = loadDrivers();
      var html = "<option value=''>— Unassigned —</option>";
      drivers.forEach(function(d){
        html += "<option value='"+esc(d)+"'"+(norm(d)===norm(selected)?" selected":"")+">"+esc(d)+"</option>";
      });
      html += "<option value='__new__'"+(selected==="__new__"?" selected":"")+">✚ Add new driver…</option>";
      return html;
    }

    function buildStatusOptions(selected) {
      return ALL_STATUSES.map(function(s){
        return "<option value='"+esc(s)+"'"+(s===selected?" selected":"")+">"+esc(s)+"</option>";
      }).join("");
    }

    var formHtml =
      "<div class='eikon-field'><div class='eikon-label'>Order Date</div><input id='dv-order-date' type='date' value='"+esc(initial.order_date)+"'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Client Name &amp; Surname</div><input id='dv-client' type='text' value='"+esc(initial.client_name)+"' placeholder='e.g. Maria Camilleri'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Phone</div><input id='dv-phone' type='tel' value='"+esc(initial.phone)+"' placeholder='e.g. 7900 0000'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Email (optional)</div><input id='dv-email' type='email' value='"+esc(initial.email)+"' placeholder='e.g. client@email.com'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Delivery Address</div><textarea id='dv-address' placeholder='Full delivery address…'>"+esc(initial.delivery_address)+"</textarea></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Address Notes (optional)</div><input id='dv-addr-notes' type='text' value='"+esc(initial.address_notes)+"' placeholder='Buzzer codes, access instructions…'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Delivery Method</div><select id='dv-method'>"+
        "<option value='In-house Driver'"+(initial.delivery_method==="In-house Driver"?" selected":"")+">In-house Driver</option>"+
        "<option value='Courier'"+(initial.delivery_method==="Courier"?" selected":"")+">Courier</option>"+
        "<option value='Collection'"+(initial.delivery_method==="Collection"?" selected":"")+">Collection</option>"+
      "</select></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Priority</div><select id='dv-priority'>"+
        "<option value='1'"+(initial.priority===1?" selected":"")+">1 — Urgent (same-day)</option>"+
        "<option value='2'"+(initial.priority===2?" selected":"")+">2 — Standard</option>"+
        "<option value='3'"+(initial.priority===3?" selected":"")+">3 — Flexible</option>"+
      "</select></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Status</div><select id='dv-status'>"+buildStatusOptions(initial.status)+"</select></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Scheduled Date</div><input id='dv-sched-date' type='date' value='"+esc(initial.scheduled_date)+"'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Time Slot (optional)</div><input id='dv-sched-time' type='text' value='"+esc(initial.scheduled_time_slot)+"' placeholder='e.g. 09:00–12:00, Afternoon'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Driver / Carrier</div><select id='dv-driver-select'>"+buildDriverOptions(initial.assigned_driver)+"</select>"+
        "<div id='dv-new-driver-wrap' style='display:"+(initial.assigned_driver==="__new__"?"block":"none")+"'><input id='dv-new-driver' type='text' placeholder='Type driver name…'></div>"+
      "</div>" +
      "<div class='eikon-field'><div class='eikon-label'>Tracking Number (Courier only)</div><input id='dv-tracking' type='text' value='"+esc(initial.tracking_number)+"' placeholder='e.g. DHL-1234567890'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Ticket Reference (optional)</div><input id='dv-ticket-ref' type='text' value='"+esc(initial.ticket_ref)+"' placeholder='e.g. TKT-00012'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Flags</div>"+
        "<label style='display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:6px;'>"+
          "<input type='checkbox' id='dv-cold-chain'"+(initial.cold_chain_required?" checked":"")+"> ❄️ Cold Chain Required</label>"+
        "<label style='display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;'>"+
          "<input type='checkbox' id='dv-sig-req'"+(initial.signature_required?" checked":"")+"> ✍ Signature Required</label>"+
      "</div>" +
      "<div class='eikon-field'><div class='eikon-label'>Items</div><div id='dv-items-editor-container'></div></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Internal Notes (not printed on client label)</div><textarea id='dv-internal-notes' placeholder='Staff notes…'>"+esc(initial.internal_notes)+"</textarea></div>";

    var mapHtml =
      "<div style='display:flex;flex-direction:column;height:100%;gap:8px;'>" +
      "  <div style='font-size:10px;font-weight:900;color:rgba(233,238,247,.5);text-transform:uppercase;letter-spacing:.8px;'>📍 Address Preview</div>" +
      "  <div id='dv-map-el' style='flex:1;min-height:300px;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:rgba(10,16,24,.6);'></div>" +
      "  <div id='dv-map-status' style='font-size:11px;color:rgba(233,238,247,.45);min-height:16px;font-style:italic;'></div>" +
      "  <div id='dv-map-result' style='font-size:11px;color:rgba(67,209,122,.8);background:rgba(67,209,122,.08);border:1px solid rgba(67,209,122,.18);border-radius:8px;padding:7px 10px;display:none;'></div>" +
      "</div>";

    var body =
      "<div style='display:flex;gap:20px;align-items:stretch;'>" +
      "  <div style='flex:0 0 400px;max-height:72vh;overflow-y:auto;overflow-x:hidden;padding-right:6px;'>" + formHtml + "</div>" +
      "  <div style='flex:1;min-width:260px;'>" + mapHtml + "</div>" +
      "</div>";

    E.modal.show(isEdit?"Edit Delivery":"New Delivery", body, [
      {label:"Cancel", onClick:function(){E.modal.hide(); dvMapCleanup();}},
      {label:isEdit?"Save Changes":"Create Delivery", primary:true, onClick:function(){
        (async function(){
          try {
            var driverSel = E.q("#dv-driver-select");
            var driverVal = (driverSel?driverSel.value:"").trim();
            if (driverVal==="__new__") {
              var ndEl=E.q("#dv-new-driver");
              var nd=(ndEl?ndEl.value:"").trim();
              if (!nd) { toast("Driver required","Please type the driver's name.","bad"); return; }
              addDriver(nd);
              driverVal=nd;
            }

            var items = itemEditorState.filter(function(it){ return it&&String(it.name||"").trim(); });

            var payloadUi = validateAndBuild({
              delivery_id:         isEdit?initial.delivery_id:nextDeliveryId(),
              order_date:          (E.q("#dv-order-date")?E.q("#dv-order-date").value:"").trim(),
              scheduled_date:      (E.q("#dv-sched-date")?E.q("#dv-sched-date").value:"").trim(),
              scheduled_time_slot: (E.q("#dv-sched-time")?E.q("#dv-sched-time").value:"").trim(),
              actual_delivery_date:initial.actual_delivery_date,
              actual_delivery_time:initial.actual_delivery_time,
              client_name:         (E.q("#dv-client")?E.q("#dv-client").value:"").trim(),
              phone:               (E.q("#dv-phone")?E.q("#dv-phone").value:"").trim(),
              email:               (E.q("#dv-email")?E.q("#dv-email").value:"").trim(),
              delivery_address:    (E.q("#dv-address")?E.q("#dv-address").value:"").trim(),
              address_notes:       (E.q("#dv-addr-notes")?E.q("#dv-addr-notes").value:"").trim(),
              delivery_method:     (E.q("#dv-method")?E.q("#dv-method").value:"In-house Driver"),
              priority:            Number((E.q("#dv-priority")?E.q("#dv-priority").value:"2").trim()),
              status:              (E.q("#dv-status")?E.q("#dv-status").value:"Scheduled"),
              assigned_driver:     driverVal,
              tracking_number:     (E.q("#dv-tracking")?E.q("#dv-tracking").value:"").trim(),
              ticket_ref:          (E.q("#dv-ticket-ref")?E.q("#dv-ticket-ref").value:"").trim(),
              cold_chain_required: !!(E.q("#dv-cold-chain")&&E.q("#dv-cold-chain").checked),
              signature_required:  !!(E.q("#dv-sig-req")&&E.q("#dv-sig-req").checked),
              signature_obtained:  initial.signature_obtained,
              recipient_name:      initial.recipient_name,
              proof_of_delivery:   initial.proof_of_delivery,
              delivery_attempts:   initial.delivery_attempts,
              failure_reason:      initial.failure_reason,
              id_doc_ref:          (E.q("#dv-id-doc")?E.q("#dv-id-doc").value:"").trim(),
              internal_notes:      (E.q("#dv-internal-notes")?E.q("#dv-internal-notes").value:"").trim(),
              items:               JSON.stringify(items),
              delivery_log:        initial.delivery_log
            });

            if (isEdit) await apiUpdate(row.id, payloadUi);
            else await apiCreate(payloadUi);

            dvMapCleanup();
            E.modal.hide();
            if (typeof state.refresh==="function") state.refresh();
          } catch(e){ modalError("Save failed",e); }
        })();
      }}
    ]);

    // Wire driver dropdown
    try {
      var drvSel=E.q("#dv-driver-select");
      var drvWrap=E.q("#dv-new-driver-wrap");
      if (drvSel&&drvWrap) {
        drvSel.addEventListener("change",function(){
          drvWrap.style.display=drvSel.value==="__new__"?"block":"none";
          if (drvSel.value!=="__new__"){ var nd=E.q("#dv-new-driver"); if(nd) nd.value=""; }
        });
      }
    } catch(e){}

    // Build items editor after modal is shown
    try { buildItemsEditor("dv-items-editor-container", parseItems(initial.items)); } catch(e){}

    // Initialise map
    try { dvMapInit(initial.delivery_address); } catch(e){ warn("map init failed",e); }
  }

  // ------------------------------------------------------------
  // Modal: Add Log Entry
  // ------------------------------------------------------------
  function openAddLogModal(entry, onSaved) {
    if (!entry) return;
    var body =
      "<div class='eikon-field'><div class='eikon-label'>Log Entry</div>"+
      "<textarea id='dv-log-text' placeholder='e.g. Attempted delivery — no answer. Will retry tomorrow.' style='min-height:100px;'></textarea></div>";

    E.modal.show("Add Log Entry — "+esc(entry.delivery_id||entry.client_name||"Delivery"), body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Add Entry", primary:true, onClick:function(){
        (async function(){
          try {
            var textEl=E.q("#dv-log-text");
            var text=(textEl?(textEl.value||"").trim():"");
            if (!text) { toast("Text required","Please type a log entry.","bad"); return; }
            var author="";
            try { author=(E.state&&E.state.user&&E.state.user.display_name)?E.state.user.display_name:""; } catch(e){}
            var existing=parseDeliveryLog(entry.delivery_log);
            existing.push({ts:new Date().toISOString(), author:author, text:text});
            var updated=Object.assign({},entry,{delivery_log:JSON.stringify(existing)});
            var payload=validateAndBuild(updated);
            await apiUpdate(entry.id, payload);
            // update in-memory
            for (var i=0;i<state.entries.length;i++){
              if (String(state.entries[i].id)===String(entry.id)){
                state.entries[i].delivery_log=JSON.stringify(existing); break;
              }
            }
            E.modal.hide();
            rerender();
            toast("Log Entry Added","Saved successfully.","good");
            if (typeof onSaved==="function") onSaved();
          } catch(e){ modalError("Failed to add log entry",e); }
        })();
      }}
    ]);
    try { var ta=E.q("#dv-log-text"); if(ta) setTimeout(function(){try{ta.focus();}catch(e){}},80); } catch(e){}
  }

  // ------------------------------------------------------------
  // Modal: Mark Delivered
  // ------------------------------------------------------------
  function openMarkDeliveredModal(entry, onSaved) {
    if (!entry) return;
    var today=todayYmd();
    var body =
      "<div class='eikon-field'><div class='eikon-label'>Actual Delivery Date</div><input id='dv-act-date' type='date' value='"+esc(today)+"'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Delivery Time</div><input id='dv-act-time' type='time' value='' style='color-scheme:dark;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Recipient Name</div><input id='dv-recipient' type='text' value='"+esc(entry.client_name||"")+"' placeholder='Name of person who received the parcel'></div>" +
      (entry.signature_required?"<div class='eikon-field'><label style='display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;'><input type='checkbox' id='dv-sig-obtained'> ✍ Signature Obtained</label></div>":"") +
      "<div class='eikon-field'><div class='eikon-label'>Proof of Delivery (optional)</div><textarea id='dv-proof' placeholder='e.g. Signature obtained. Left at door. Collected by neighbour at no.12.'></textarea></div>";

    E.modal.show("Mark as Delivered — "+esc(entry.delivery_id), body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"✅ Confirm Delivered", primary:true, onClick:function(){
        (async function(){
          try {
            var actDate=(E.q("#dv-act-date")?E.q("#dv-act-date").value:"").trim();
            var actTime=(E.q("#dv-act-time")?E.q("#dv-act-time").value:"").trim();
            var recipient=(E.q("#dv-recipient")?E.q("#dv-recipient").value:"").trim();
            var sigObtained=!!(entry.signature_required&&E.q("#dv-sig-obtained")&&E.q("#dv-sig-obtained").checked);
            var proof=(E.q("#dv-proof")?E.q("#dv-proof").value:"").trim();
            var author="";
            try{author=(E.state&&E.state.user&&E.state.user.display_name)?E.state.user.display_name:"";}catch(e){}
            var existing=parseDeliveryLog(entry.delivery_log);
            existing.push({ts:new Date().toISOString(),author:author,text:"Marked as Delivered."+(proof?" "+proof:"")});
            var updated=Object.assign({},entry,{
              status:"Delivered",
              actual_delivery_date:actDate||today,
              actual_delivery_time:actTime,
              recipient_name:recipient,
              signature_obtained:sigObtained,
              proof_of_delivery:proof,
              delivery_attempts:Math.max(1,Number(entry.delivery_attempts||0)),
              delivery_log:JSON.stringify(existing)
            });
            var payload=validateAndBuild(updated);
            await apiUpdate(entry.id,payload);
            // update in-memory
            for(var i=0;i<state.entries.length;i++){
              if(String(state.entries[i].id)===String(entry.id)){
                Object.assign(state.entries[i],payload); break;
              }
            }
            E.modal.hide();
            rerender();
            toast("Delivery Confirmed",entry.delivery_id+" marked as Delivered.","good");
            if(typeof onSaved==="function") onSaved();
          } catch(e){modalError("Update failed",e);}
        })();
      }}
    ]);
  }

  // ------------------------------------------------------------
  // Modal: Mark Failed
  // ------------------------------------------------------------
  function openMarkFailedModal(entry, onSaved) {
    if (!entry) return;
    var attempts=Number(entry.delivery_attempts||0)+1;
    var isLastAttempt=attempts>=3;
    var body =
      "<div class='eikon-field'><div class='eikon-label'>Failure Reason</div>"+
      "<input id='dv-fail-reason' type='text' value='' placeholder='e.g. Not home, Wrong address, Refused'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Attempt number after this</div>"+
      "<strong style='font-size:14px;'>"+attempts+"</strong>" +
      (isLastAttempt?"<div style='margin-top:8px;font-size:12px;color:rgba(255,157,67,.9);'>⚠️ This is attempt 3. Status will be set to <strong>Returned</strong> and item returned to pharmacy.</div>":"")+"</div>";

    E.modal.show("Mark as Failed — "+esc(entry.delivery_id), body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Record Failed Attempt", danger:true, onClick:function(){
        (async function(){
          try{
            var reason=(E.q("#dv-fail-reason")?E.q("#dv-fail-reason").value:"").trim();
            if (!reason){toast("Reason required","Please enter a failure reason.","bad");return;}
            var author="";
            try{author=(E.state&&E.state.user&&E.state.user.display_name)?E.state.user.display_name:"";}catch(e){}
            var existing=parseDeliveryLog(entry.delivery_log);
            existing.push({ts:new Date().toISOString(),author:author,text:"Attempt "+attempts+" — Failed: "+reason});
            var newStatus=isLastAttempt?"Returned":"Failed";
            var updated=Object.assign({},entry,{
              status:newStatus,
              delivery_attempts:attempts,
              failure_reason:reason,
              delivery_log:JSON.stringify(existing)
            });
            var payload=validateAndBuild(updated);
            await apiUpdate(entry.id,payload);
            for(var i=0;i<state.entries.length;i++){
              if(String(state.entries[i].id)===String(entry.id)){
                Object.assign(state.entries[i],payload); break;
              }
            }
            E.modal.hide();
            rerender();
            toast(isLastAttempt?"Returned":"Failed Attempt",entry.delivery_id+" — Attempt "+attempts,(isLastAttempt?"":"bad"));
            if(typeof onSaved==="function") onSaved();
          } catch(e){modalError("Update failed",e);}
        })();
      }}
    ]);
  }

  // ------------------------------------------------------------
  // Delete
  // ------------------------------------------------------------
  function openConfirmDelete(entry) {
    if (!entry||!entry.id) return;
    var body="<div style='white-space:pre-wrap;font-size:13px;'>This will permanently delete the delivery record.\n\n"+
      "Delivery: "+esc(entry.delivery_id||"")+" · "+esc(entry.client_name||"")+"\nStatus: "+esc(entry.status||"")+"</div>";
    E.modal.show("Delete delivery?", body, [
      {label:"Cancel", onClick:function(){E.modal.hide();}},
      {label:"Delete", danger:true, onClick:function(){
        (async function(){
          try{
            await apiDelete(entry.id);
            state.selectedId=null;
            E.modal.hide();
            if(typeof state.refresh==="function") state.refresh();
          } catch(e){modalError("Delete failed",e);}
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
      return cols.map(function(c){
        return "<th data-key='"+esc(c.key)+"'>"+
          "<span class='dv-sort'><span>"+esc(c.label)+"</span><span class='car'></span></span></th>";
      }).join("");
    }

    mount.innerHTML =
      "<div class='dv-wrap'>" +

      // Header
      "<div class='dv-head'>" +
      "  <div><h2 class='dv-title'>🚚 Client Deliveries</h2>" +
      "    <div class='dv-sub'>Track every delivery from dispatch to doorstep. Click a row to view full details, items, and delivery log.</div>" +
      "  </div>" +
      "  <div class='dv-controls'>" +
      "    <span class='dv-mode-badge' id='dv-mode-badge'>Loading…</span>" +
      "    <div class='dv-actions'>" +
      "      <button id='dv-btn-new' class='eikon-btn' type='button'>+ New Delivery</button>" +
      "      <button id='dv-btn-refresh' class='eikon-btn' type='button'>↻ Refresh</button>" +
      "    </div>" +
      "  </div>" +
      "</div>" +

      // Stats
      "<div class='dv-stats' id='dv-stats'></div>" +

      // Selected panel
      "<div class='dv-card' id='dv-selected' style='margin-bottom:12px;'>" +
      "  <div class='dv-card-head'>" +
      "    <div><h3>Selected Delivery</h3>" +
      "      <div class='meta' id='dv-sel-meta'>Click any row below to view full details, items, and delivery log.</div>" +
      "    </div>" +
      "    <div class='dv-sel-actions'>" +
      "      <button id='dv-sel-add-note' class='eikon-btn' type='button' disabled>+ Add Log Entry</button>" +
      "      <button id='dv-sel-edit'     class='eikon-btn' type='button' disabled>Edit</button>" +
      "      <button id='dv-sel-deliver'  class='eikon-btn' type='button' disabled>✅ Mark Delivered</button>" +
      "      <button id='dv-sel-fail'     class='eikon-btn' type='button' disabled>✗ Mark Failed</button>" +
      "      <button id='dv-sel-print'    class='eikon-btn' type='button' disabled>🖨 Print</button>" +
      "      <button id='dv-sel-del'      class='eikon-btn' type='button' disabled>Delete</button>" +
      "    </div>" +
      "  </div>" +
      "  <div id='dv-sel-content'></div>" +
      "</div>" +

      // Tabs
      "<div class='dv-tabs'>" +
      "  <button class='dv-tab active' data-tab='active'>Active Deliveries</button>" +
      "  <button class='dv-tab' data-tab='completed'>Completed</button>" +
      "  <button class='dv-tab' data-tab='failed'>Failed / Returned</button>" +
      "</div>" +

      // Active table
      "<div class='dv-card' id='dv-pane-active'>" +
      "  <div class='dv-card-head'>" +
      "    <div><h3>Active Deliveries</h3><div class='meta' id='dv-count-active'>Loading…</div></div>" +
      "    <div class='right'>" +
      "      <input id='dv-search-active' type='text' value='"+esc(state.queryActive||"")+"' placeholder='Search deliveries…'>" +
      "      <button id='dv-print-active' class='eikon-btn' type='button'>🖨 Print</button>" +
      "    </div>" +
      "  </div>" +
      "  <div class='dv-table-wrap'>" +
      "    <table class='dv-table' id='dv-table-active'>" +
      "      <thead><tr>"+thsHtml(COLS_ACTIVE)+"</tr></thead>" +
      "      <tbody id='dv-tbody-active'></tbody>" +
      "    </table>" +
      "  </div>" +
      "</div>" +

      // Completed table
      "<div class='dv-card' id='dv-pane-completed' style='display:none;'>" +
      "  <div class='dv-card-head'>" +
      "    <div><h3>Completed Deliveries</h3><div class='meta' id='dv-count-completed'>—</div></div>" +
      "    <div class='right'>" +
      "      <input id='dv-search-completed' type='text' value='"+esc(state.queryCompleted||"")+"' placeholder='Search completed…'>" +
      "      <button id='dv-print-completed' class='eikon-btn' type='button'>🖨 Print</button>" +
      "    </div>" +
      "  </div>" +
      "  <div class='dv-table-wrap'>" +
      "    <table class='dv-table' id='dv-table-completed'>" +
      "      <thead><tr>"+thsHtml(COLS_COMPLETED)+"</tr></thead>" +
      "      <tbody id='dv-tbody-completed'></tbody>" +
      "    </table>" +
      "  </div>" +
      "</div>" +

      // Failed table
      "<div class='dv-card' id='dv-pane-failed' style='display:none;'>" +
      "  <div class='dv-card-head'>" +
      "    <div><h3>Failed / Returned</h3><div class='meta' id='dv-count-failed'>—</div></div>" +
      "    <div class='right'>" +
      "      <input id='dv-search-failed' type='text' value='"+esc(state.queryFailed||"")+"' placeholder='Search…'>" +
      "      <button id='dv-print-failed' class='eikon-btn' type='button'>🖨 Print</button>" +
      "    </div>" +
      "  </div>" +
      "  <div class='dv-table-wrap'>" +
      "    <table class='dv-table' id='dv-table-failed'>" +
      "      <thead><tr>"+thsHtml(COLS_FAILED)+"</tr></thead>" +
      "      <tbody id='dv-tbody-failed'></tbody>" +
      "    </table>" +
      "  </div>" +
      "</div>" +

      "</div>"; // dv-wrap

    // DOM refs
    var badge        = E.q("#dv-mode-badge", mount);
    var btnNew       = E.q("#dv-btn-new", mount);
    var btnRefresh   = E.q("#dv-btn-refresh", mount);
    var searchA      = E.q("#dv-search-active", mount);
    var searchC      = E.q("#dv-search-completed", mount);
    var searchF      = E.q("#dv-search-failed", mount);
    var btnPrintA    = E.q("#dv-print-active", mount);
    var btnPrintC    = E.q("#dv-print-completed", mount);
    var btnPrintF    = E.q("#dv-print-failed", mount);
    var selBtnNote   = E.q("#dv-sel-add-note", mount);
    var selBtnEdit   = E.q("#dv-sel-edit", mount);
    var selBtnDel    = E.q("#dv-sel-del", mount);
    var selBtnPrint  = E.q("#dv-sel-print", mount);
    var selBtnDeliv  = E.q("#dv-sel-deliver", mount);
    var selBtnFail   = E.q("#dv-sel-fail", mount);
    var tableA       = E.q("#dv-table-active", mount);
    var tableC       = E.q("#dv-table-completed", mount);
    var tableF       = E.q("#dv-table-failed", mount);

    // Update mode badge
    function updateBadge() {
      if (!badge) return;
      if (state.mode==="local") { badge.textContent="Local mode (no API yet)"; badge.className="dv-mode-badge local"; }
      else if (state.mode==="api_error") { badge.textContent="API error"; badge.className="dv-mode-badge err"; }
      else { badge.textContent="● Online"; badge.className="dv-mode-badge"; }
    }

    // Render selected panel
    state.renderSelectedPanel = function() {
      var id=state.selectedId?String(state.selectedId):"";
      var entry=null;
      if (id) {
        for (var i=0;i<(state.entries||[]).length;i++){
          if (state.entries[i]&&String(state.entries[i].id)===id){entry=state.entries[i];break;}
        }
      }
      buildSelectedPanel(entry, mount);
    };

    // Helper
    function getSelectedEntry() {
      var id=state.selectedId?String(state.selectedId):"";
      if (!id) return null;
      for (var i=0;i<(state.entries||[]).length;i++){
        if (state.entries[i]&&String(state.entries[i].id)===id) return state.entries[i];
      }
      return null;
    }

    // Refresh
    async function refresh() {
      try {
        var cA=E.q("#dv-count-active",mount); if(cA) cA.textContent="Loading…";
        var res=await apiList();
        state.mode=res.mode||"api";
        var raw=Array.isArray(res.entries)?res.entries:[];
        state.entries=raw.map(function(r){
          var m=mapApiRow(r||{});
          if (!isYmd(m.order_date)) m.order_date=todayYmd();
          if (!(m.priority===1||m.priority===2||m.priority===3)) m.priority=2;
          if (ALL_STATUSES.indexOf(m.status)<0) m.status="Scheduled";
          return m;
        });
        updateBadge();
        rerender(mount);
        wireSortableHeaders(tableA,"active");
        wireSortableHeaders(tableC,"completed");
        wireSortableHeaders(tableF,"failed");
      } catch(e) {
        err("refresh failed",{status:e&&e.status,message:e&&e.message});
        state.mode="api_error"; state.lastError=e||null;
        updateBadge();
        var cA2=E.q("#dv-count-active",mount); if(cA2) cA2.textContent="Failed to load";
        modalError("Client Deliveries",e);
      }
    }
    state.refresh = refresh;

    // Event: tabs
    mount.querySelectorAll(".dv-tab").forEach(function(t){
      t.addEventListener("click",function(){ setTab(t.getAttribute("data-tab"),mount); });
    });

    // Event: new delivery
    btnNew.addEventListener("click",function(){
      openDeliveryModal({mode:"new", entry:{order_date:todayYmd(),priority:2,status:"Scheduled"}});
    });

    // Event: refresh
    btnRefresh.addEventListener("click",function(){ refresh(); });

    // Event: add log
    selBtnNote.addEventListener("click",function(){
      var e=getSelectedEntry(); if(!e) return;
      openAddLogModal(e,function(){ if(typeof state.renderSelectedPanel==="function") state.renderSelectedPanel(); });
    });

    // Event: edit
    selBtnEdit.addEventListener("click",function(){
      var e=getSelectedEntry(); if(!e) return;
      openDeliveryModal({mode:"edit",entry:e});
    });

    // Event: delete
    selBtnDel.addEventListener("click",function(){
      var e=getSelectedEntry(); if(!e) return;
      openConfirmDelete(e);
    });

    // Event: print single
    selBtnPrint.addEventListener("click",function(){
      var e=getSelectedEntry(); if(!e) return;
      try{printSingleDelivery(e);}catch(ex){modalError("Print",ex);}
    });

    // Event: mark delivered
    selBtnDeliv.addEventListener("click",function(){
      var e=getSelectedEntry(); if(!e) return;
      openMarkDeliveredModal(e,function(){ if(typeof state.renderSelectedPanel==="function") state.renderSelectedPanel(); });
    });

    // Event: mark failed
    selBtnFail.addEventListener("click",function(){
      var e=getSelectedEntry(); if(!e) return;
      openMarkFailedModal(e,function(){ if(typeof state.renderSelectedPanel==="function") state.renderSelectedPanel(); });
    });

    // Event: search
    function makeSearchHandler(queryKey, tbodyId, filteredKey, countId, which) {
      return function(){
        var el = mount.querySelector(queryKey==="queryActive"?"#dv-search-active":queryKey==="queryCompleted"?"#dv-search-completed":"#dv-search-failed");
        state[queryKey]=String(el?el.value||"":"");
        applyFilterSplitSort();
        var tbody=mount.querySelector("#"+tbodyId);
        if (tbody) renderTable(tbody,state[filteredKey],which);
        var total=0;
        state.entries.forEach(function(r){
          if (which==="active"&&isActive(r)) total++;
          else if (which==="completed"&&isCompleted(r)) total++;
          else if (which==="failed"&&isFailed(r)) total++;
        });
        var cEl=E.q("#"+countId,mount);
        if (cEl) cEl.textContent="Showing "+String(state[filteredKey].length)+" / "+String(total);
        try{if(typeof state.renderSelectedPanel==="function") state.renderSelectedPanel();}catch(e){}
      };
    }

    if (searchA) searchA.addEventListener("input",function(){
      state.queryActive=String(searchA.value||"");
      applyFilterSplitSort();
      var tbody=E.q("#dv-tbody-active",mount); if(tbody) renderTable(tbody,state.filteredActive,"active");
      var total=state.entries.filter(isActive).length;
      var cEl=E.q("#dv-count-active",mount); if(cEl) cEl.textContent="Showing "+state.filteredActive.length+" / "+total;
      try{if(typeof state.renderSelectedPanel==="function") state.renderSelectedPanel();}catch(e){}
    });

    if (searchC) searchC.addEventListener("input",function(){
      state.queryCompleted=String(searchC.value||"");
      applyFilterSplitSort();
      var tbody=E.q("#dv-tbody-completed",mount); if(tbody) renderTable(tbody,state.filteredCompleted,"completed");
      var total=state.entries.filter(isCompleted).length;
      var cEl=E.q("#dv-count-completed",mount); if(cEl) cEl.textContent=state.filteredCompleted.length+" of "+total+" records";
      try{if(typeof state.renderSelectedPanel==="function") state.renderSelectedPanel();}catch(e){}
    });

    if (searchF) searchF.addEventListener("input",function(){
      state.queryFailed=String(searchF.value||"");
      applyFilterSplitSort();
      var tbody=E.q("#dv-tbody-failed",mount); if(tbody) renderTable(tbody,state.filteredFailed,"failed");
      var total=state.entries.filter(isFailed).length;
      var cEl=E.q("#dv-count-failed",mount); if(cEl) cEl.textContent=state.filteredFailed.length+" of "+total+" records";
      try{if(typeof state.renderSelectedPanel==="function") state.renderSelectedPanel();}catch(e){}
    });

    // Event: print tables
    if (btnPrintA) btnPrintA.addEventListener("click",function(){
      try{printTable(state.filteredActive,"Client Deliveries — Active",state.queryActive);}catch(e){modalError("Print",e);}
    });
    if (btnPrintC) btnPrintC.addEventListener("click",function(){
      try{printTable(state.filteredCompleted,"Client Deliveries — Completed",state.queryCompleted);}catch(e){modalError("Print",e);}
    });
    if (btnPrintF) btnPrintF.addEventListener("click",function(){
      try{printTable(state.filteredFailed,"Client Deliveries — Failed/Returned",state.queryFailed);}catch(e){modalError("Print",e);}
    });

    await refresh();
  }

  // ------------------------------------------------------------
  // Register
  // ------------------------------------------------------------
  E.registerModule({
    id:     "deliveries",
    title:  "Client Deliveries",
    order:  19,
    icon:   "🚚",
    render: render
  });

})();
