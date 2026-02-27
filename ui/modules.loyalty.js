/* ui/modules.loyalty.js
   Eikon – Loyalty & Campaigns Module
   ─────────────────────────────────────────────────────────────
   Campaign types supported:
     stamp_card     – collect N stamps → free reward
     points         – earn points per purchase, redeem at threshold
     discount       – always-on % discount on brand/items
     event          – time-limited campaign (Black Friday, Valentine's…)
     buy_x_get_y    – buy X items → Y free
     tiered         – spend tiers unlock better rewards

   Storage strategy:
     Cloud  (GET/POST/PUT/DELETE /loyalty/*) – always preferred
     LocalStorage fallback when API unavailable (404 / offline)

   ─────────────────────────────────────────────────────────────
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ─── Logging ─────────────────────────────────────────────────
  function dbg()  { try { E.dbg.apply(E,  ["[loyalty]"].concat([].slice.call(arguments))); } catch(e){} }
  function warn() { try { E.warn.apply(E, ["[loyalty]"].concat([].slice.call(arguments))); } catch(e){} }
  function err()  { try { E.error.apply(E,["[loyalty]"].concat([].slice.call(arguments))); } catch(e){} }

  // ─── Utilities ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function norm(s){ return String(s==null?"":s).toLowerCase().trim(); }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function uid(){ return Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8); }

  function todayYmd(){
    var d=new Date();
    return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
  }
  function nowIso(){ return new Date().toISOString(); }
  function fmtDmy(ymd){
    if(!ymd||ymd.length<10) return ymd||"";
    return ymd.slice(8,10)+"/"+ymd.slice(5,7)+"/"+ymd.slice(0,4);
  }
  function fmtTs(iso){
    if(!iso) return "";
    try{
      var d=new Date(iso);
      if(isNaN(d.getTime())) return iso;
      return pad2(d.getDate())+"/"+pad2(d.getMonth()+1)+"/"+d.getFullYear()+" "+pad2(d.getHours())+":"+pad2(d.getMinutes());
    }catch(e){ return iso; }
  }

  // Maltese ID card normalisation: pad numeric part to 7 digits
  // e.g. "123456M" → "0123456M", "1234567A" → "1234567A", "1234567" → "0001234567" (no letter)
  function normMtId(raw){
    var s = String(raw||"").trim().toUpperCase();
    if(!s) return s;
    // Split trailing letter(s)
    var match = s.match(/^(\d+)([A-Z]?)$/);
    if(!match) return s; // not a standard MT ID, return as-is
    var digits = match[1];
    var suffix = match[2];
    // Pad to 7 digits
    digits = digits.padStart(7,"0");
    return digits + suffix;
  }
  function looksLikeMtId(s){
    return /^\d{1,7}[A-Za-z]?$/.test(String(s||"").trim());
  }

  // ─── Local storage helpers ────────────────────────────────────
  var LS_PREFIX = "eikon_loyalty_";
  function lsGet(key){ try{ var v=localStorage.getItem(LS_PREFIX+key); return v?JSON.parse(v):null; }catch(e){ return null; } }
  function lsSet(key,val){ try{ localStorage.setItem(LS_PREFIX+key,JSON.stringify(val)); return true; }catch(e){ return false; } }

  // ─── Data stores (localStorage-backed) ───────────────────────
  // campaigns[]  – campaign definitions
  // clients{}    – id_card → {name, id_card}
  // items[]      – known item descriptions
  // transactions[] – ledger of loyalty events

  function loadCampaigns(){ return lsGet("campaigns") || []; }
  function saveCampaigns(v){ lsSet("campaigns",v); }
  function loadClients(){ return lsGet("clients") || {}; }
  function saveClients(v){ lsSet("clients",v); }
  function loadItems(){ return lsGet("items") || []; }
  function saveItems(v){ lsSet("items",v); }
  function loadTxns(){ return lsGet("txns") || []; }
  function saveTxns(v){ lsSet("txns",v); }

  // Remember a new item description
  function rememberItem(desc){
    var d = String(desc||"").trim();
    if(!d) return;
    var items = loadItems();
    var n = norm(d);
    if(items.some(function(x){ return norm(x)===n; })) return;
    items.unshift(d);
    if(items.length>300) items=items.slice(0,300);
    saveItems(items);
  }

  // Remember a client
  function rememberClient(id_card, name){
    var id = normMtId(id_card) || id_card;
    if(!id) return;
    var clients = loadClients();
    clients[id] = { id_card: id, name: String(name||"").trim() };
    saveClients(clients);
  }

  // Get client name by id
  function clientName(id_card){
    var clients = loadClients();
    var c = clients[normMtId(id_card)] || clients[id_card];
    return c ? c.name : "";
  }

  // ─── Campaign type config ─────────────────────────────────────
  var CAMPAIGN_TYPES = [
    { value:"stamp_card",  label:"Stamp Card",    icon:"⭐", color:"#f5c842", grad:"linear-gradient(135deg,#f5c842 0%,#e8932a 100%)", desc:"Collect N stamps for a free reward" },
    { value:"points",      label:"Points",        icon:"💎", color:"#5aa2ff", grad:"linear-gradient(135deg,#5aa2ff 0%,#7b5ea7 100%)", desc:"Earn points per purchase, redeem at threshold" },
    { value:"discount",    label:"Always-On Discount", icon:"🏷", color:"#43d17a", grad:"linear-gradient(135deg,#43d17a 0%,#0eb89d 100%)", desc:"Percentage discount on brand or items" },
    { value:"event",       label:"Event Campaign", icon:"🎉", color:"#ff6b9d", grad:"linear-gradient(135deg,#ff6b9d 0%,#c44dff 100%)", desc:"Time-limited seasonal event (Black Friday, Valentine's…)" },
    { value:"buy_x_get_y", label:"Buy X Get Y",   icon:"🎁", color:"#ff8c42", grad:"linear-gradient(135deg,#ff8c42 0%,#ff4567 100%)", desc:"Buy X items, get Y free" },
    { value:"tiered",      label:"Spend Tiers",   icon:"🏆", color:"#a8e6cf", grad:"linear-gradient(135deg,#a8e6cf 0%,#3d9970 100%)", desc:"Unlock better rewards at higher spend tiers" }
  ];

  function typeConf(type){ return CAMPAIGN_TYPES.find(function(t){ return t.value===type; }) || CAMPAIGN_TYPES[0]; }

  // ─── Styles ───────────────────────────────────────────────────
  var stylesInjected = false;
  function ensureStyles(){
    if(stylesInjected) return;
    stylesInjected = true;
    var st = document.createElement("style");
    st.id = "eikon-loyalty-style";
    st.textContent = [
      // Layout
      ".ly-wrap{max-width:1400px;margin:0 auto;padding:16px;}",
      ".ly-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px;}",
      ".ly-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}",
      ".ly-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,#a8b3c7);}",
      ".ly-type-pills{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;}",
      ".ly-type-pill{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:800;border:1px solid;display:inline-flex;align-items:center;gap:5px;}",

      // Tabs
      ".ly-tabs{display:flex;gap:2px;margin-bottom:14px;border-bottom:1px solid var(--border,#263246);}",
      ".ly-tab{padding:9px 16px;border:none;background:transparent;color:var(--muted,#a8b3c7);font-size:13px;font-weight:700;cursor:pointer;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;border-radius:0;letter-spacing:.2px;margin-bottom:-1px;}",
      ".ly-tab:hover{color:var(--text,#e9eef7);}",
      ".ly-tab.active{color:var(--accent,#5aa2ff);border-bottom-color:var(--accent,#5aa2ff);}",
      ".ly-tab-ico{margin-right:6px;font-size:14px;}",

      // Content panels
      ".ly-panel{display:none;}",
      ".ly-panel.active{display:block;}",

      // Stat cards row
      ".ly-stats-row{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;}",
      ".ly-stat{flex:1;min-width:140px;background:var(--panel2,#111b2a);border:1px solid var(--border,#263246);border-radius:14px;padding:14px 16px;position:relative;overflow:hidden;}",
      ".ly-stat-accent{position:absolute;top:0;left:0;right:0;height:3px;}",
      ".ly-stat-val{font-size:28px;font-weight:900;color:var(--text,#e9eef7);line-height:1;}",
      ".ly-stat-lbl{font-size:11px;color:var(--muted,#a8b3c7);font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-top:6px;}",

      // Campaign cards grid
      ".ly-camp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;}",
      ".ly-camp-card{background:var(--panel,#0f1622);border:1px solid var(--border,#263246);border-radius:16px;overflow:hidden;transition:border-color .2s,transform .15s,box-shadow .2s;position:relative;}",
      ".ly-camp-card:hover{border-color:rgba(90,162,255,.35);transform:translateY(-2px);box-shadow:0 12px 40px rgba(0,0,0,.5);}",
      ".ly-camp-banner{height:4px;}",
      ".ly-camp-body{padding:16px;}",
      ".ly-camp-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;}",
      ".ly-camp-ico{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex:0 0 40px;}",
      ".ly-camp-name{font-size:15px;font-weight:900;color:var(--text,#e9eef7);margin:0 0 3px;}",
      ".ly-camp-type{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;}",
      ".ly-camp-desc{font-size:12px;color:var(--muted,#a8b3c7);margin-bottom:12px;line-height:1.5;}",
      ".ly-camp-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;}",
      ".ly-camp-dates{font-size:11px;color:var(--muted,#a8b3c7);}",
      ".ly-camp-actions{display:flex;gap:6px;}",
      ".ly-camp-badge{padding:3px 8px;border-radius:8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;}",
      ".ly-camp-badge.active{background:rgba(67,209,122,.15);color:#43d17a;border:1px solid rgba(67,209,122,.3);}",
      ".ly-camp-badge.inactive{background:rgba(168,179,199,.1);color:var(--muted,#a8b3c7);border:1px solid rgba(168,179,199,.2);}",
      ".ly-camp-badge.ended{background:rgba(255,90,122,.12);color:#ff5a7a;border:1px solid rgba(255,90,122,.25);}",
      ".ly-camp-badge.open{background:rgba(90,162,255,.12);color:#5aa2ff;border:1px solid rgba(90,162,255,.25);}",

      // Empty state
      ".ly-empty{text-align:center;padding:60px 20px;color:var(--muted,#a8b3c7);}",
      ".ly-empty-ico{font-size:48px;display:block;margin-bottom:12px;opacity:.5;}",
      ".ly-empty-title{font-size:16px;font-weight:900;margin:0 0 6px;color:var(--text,#e9eef7);}",
      ".ly-empty-sub{font-size:13px;}",

      // Buttons
      ".ly-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border-radius:11px;border:1px solid var(--border,#263246);background:rgba(255,255,255,.04);color:var(--text,#e9eef7);font-size:13px;font-weight:700;cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s;white-space:nowrap;}",
      ".ly-btn:hover{border-color:rgba(255,255,255,.15);background:rgba(255,255,255,.07);}",
      ".ly-btn.primary{background:rgba(90,162,255,.18);border-color:rgba(90,162,255,.4);color:#8fc8ff;}",
      ".ly-btn.primary:hover{background:rgba(90,162,255,.28);box-shadow:0 0 0 3px rgba(90,162,255,.15);}",
      ".ly-btn.success{background:rgba(67,209,122,.15);border-color:rgba(67,209,122,.35);color:#43d17a;}",
      ".ly-btn.danger{background:rgba(255,90,122,.13);border-color:rgba(255,90,122,.3);color:#ff5a7a;}",
      ".ly-btn.sm{padding:6px 11px;font-size:12px;border-radius:9px;}",
      ".ly-btn.icon-only{padding:7px;min-width:32px;justify-content:center;}",

      // Form fields
      ".ly-form-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}",
      ".ly-form-row{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;}",
      ".ly-field{display:flex;flex-direction:column;gap:5px;}",
      ".ly-field.full{grid-column:1/-1;}",
      ".ly-label{font-size:11px;font-weight:800;color:var(--muted,#a8b3c7);text-transform:uppercase;letter-spacing:.6px;}",
      ".ly-input,.ly-select,.ly-textarea{background:rgba(0,0,0,.28);border:1px solid var(--border,#263246);color:var(--text,#e9eef7);padding:10px 13px;border-radius:11px;font-size:13px;outline:none;transition:border-color .15s,box-shadow .15s;width:100%;}",
      ".ly-input:focus,.ly-select:focus,.ly-textarea:focus{border-color:rgba(90,162,255,.55);box-shadow:0 0 0 3px rgba(90,162,255,.12);}",
      ".ly-input::placeholder{color:rgba(233,238,247,.3);}",
      ".ly-textarea{min-height:72px;resize:vertical;}",
      ".ly-select{color-scheme:dark;cursor:pointer;}",

      // Autocomplete dropdown
      ".ly-ac-wrap{position:relative;}",
      ".ly-ac-drop{position:absolute;top:100%;left:0;right:0;z-index:9999;background:var(--panel2,#111b2a);border:1px solid rgba(90,162,255,.35);border-radius:12px;max-height:200px;overflow-y:auto;display:none;box-shadow:0 16px 40px rgba(0,0,0,.6);margin-top:3px;}",
      ".ly-ac-drop.open{display:block;}",
      ".ly-ac-item{padding:9px 13px;cursor:pointer;font-size:13px;transition:background .1s;border-bottom:1px solid rgba(255,255,255,.05);}",
      ".ly-ac-item:last-child{border-bottom:none;}",
      ".ly-ac-item:hover,.ly-ac-item.focused{background:rgba(90,162,255,.12);}",
      ".ly-ac-item .ac-sub{font-size:11px;color:var(--muted,#a8b3c7);margin-top:2px;}",
      ".ly-ac-item .ac-highlight{color:#5aa2ff;font-weight:900;}",

      // Record transaction panel
      ".ly-txn-card{background:var(--panel,#0f1622);border:1px solid var(--border,#263246);border-radius:16px;padding:20px;margin-bottom:16px;}",
      ".ly-txn-section-title{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.8px;color:var(--muted,#a8b3c7);margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid var(--border,#263246);}",

      // Items list
      ".ly-items-list{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;}",
      ".ly-item-row{display:flex;gap:10px;align-items:center;background:rgba(255,255,255,.03);border:1px solid var(--border,#263246);border-radius:11px;padding:10px 12px;}",
      ".ly-item-row .desc{flex:1;font-size:13px;color:var(--text,#e9eef7);}",
      ".ly-item-row .qty{font-size:13px;color:var(--muted,#a8b3c7);min-width:40px;text-align:center;}",
      ".ly-item-row .remove{background:none;border:none;color:rgba(255,90,122,.6);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:6px;transition:color .15s;}",
      ".ly-item-row .remove:hover{color:#ff5a7a;}",

      // Stamp card visual
      ".ly-stamps{display:flex;flex-wrap:wrap;gap:8px;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border,#263246);border-radius:14px;margin-top:12px;}",
      ".ly-stamp{width:40px;height:40px;border-radius:50%;border:2px solid rgba(245,200,66,.35);display:flex;align-items:center;justify-content:center;font-size:18px;transition:all .2s;}",
      ".ly-stamp.earned{border-color:#f5c842;background:rgba(245,200,66,.18);box-shadow:0 0 10px rgba(245,200,66,.3);}",
      ".ly-stamp.new-stamp{animation:stampPop .4s cubic-bezier(.34,1.56,.64,1) forwards;}",
      "@keyframes stampPop{0%{transform:scale(0);opacity:0}60%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}",

      // Progress bar
      ".ly-progress{background:rgba(255,255,255,.08);border-radius:999px;height:8px;overflow:hidden;margin-top:8px;}",
      ".ly-progress-bar{height:100%;border-radius:999px;transition:width .5s cubic-bezier(.4,0,.2,1);}",

      // Client history table
      ".ly-hist-table{width:100%;border-collapse:collapse;}",
      ".ly-hist-table th,.ly-hist-table td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;text-align:left;}",
      ".ly-hist-table th{color:var(--muted,#a8b3c7);font-weight:800;text-transform:uppercase;letter-spacing:.5px;background:rgba(255,255,255,.02);}",
      ".ly-hist-table tbody tr:hover{background:rgba(255,255,255,.03);}",

      // Search field styled
      ".ly-search{background:rgba(0,0,0,.25);border:1px solid var(--border,#263246);color:var(--text,#e9eef7);padding:9px 13px 9px 36px;border-radius:22px;font-size:13px;outline:none;width:220px;transition:border-color .15s,width .2s;}",
      ".ly-search:focus{border-color:rgba(90,162,255,.5);width:280px;}",
      ".ly-search-wrap{position:relative;display:inline-flex;align-items:center;}",
      ".ly-search-ico{position:absolute;left:11px;color:var(--muted,#a8b3c7);font-size:14px;pointer-events:none;}",

      // Section title
      ".ly-section-hd{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px;}",
      ".ly-section-title{font-size:16px;font-weight:900;color:var(--text,#e9eef7);margin:0;}",

      // Campaign form modal
      ".ly-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;display:none;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(4px);}",
      ".ly-modal-overlay.open{display:flex;}",
      ".ly-modal{width:min(700px,100%);max-height:90vh;overflow-y:auto;background:var(--panel2,#111b2a);border:1px solid var(--border,#263246);border-radius:20px;padding:24px;box-shadow:0 32px 80px rgba(0,0,0,.7);}",
      ".ly-modal-title{font-size:18px;font-weight:900;margin:0 0 20px;color:var(--text,#e9eef7);display:flex;align-items:center;gap:10px;}",
      ".ly-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:24px;padding-top:16px;border-top:1px solid var(--border,#263246);}",

      // Campaign type selector
      ".ly-type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:20px;}",
      ".ly-type-card{border:2px solid var(--border,#263246);border-radius:13px;padding:12px;cursor:pointer;transition:border-color .15s,background .15s;text-align:center;}",
      ".ly-type-card:hover{border-color:rgba(90,162,255,.3);background:rgba(90,162,255,.05);}",
      ".ly-type-card.selected{border-color:var(--type-color,#5aa2ff);background:rgba(var(--type-rgb,90,162,255),.1);}",
      ".ly-type-card-ico{font-size:24px;display:block;margin-bottom:6px;}",
      ".ly-type-card-label{font-size:12px;font-weight:800;color:var(--text,#e9eef7);}",
      ".ly-type-card-desc{font-size:11px;color:var(--muted,#a8b3c7);margin-top:3px;line-height:1.4;}",

      // Conditional fields
      ".ly-cond{display:none;}",
      ".ly-cond.show{display:contents;}",

      // Toast
      ".ly-toast{position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;}",
      ".ly-toast-item{padding:12px 18px;border-radius:13px;font-size:13px;font-weight:700;color:#fff;pointer-events:auto;display:flex;align-items:center;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);animation:toastIn .3s cubic-bezier(.34,1.56,.64,1);}",
      "@keyframes toastIn{from{opacity:0;transform:translateY(12px) scale(.95)}to{opacity:1;transform:none}}",
      ".ly-toast-item.ok{background:linear-gradient(135deg,#1a5c38,#0d4a2e);border:1px solid rgba(67,209,122,.35);}",
      ".ly-toast-item.err{background:linear-gradient(135deg,#5c1a2a,#4a0d1c);border:1px solid rgba(255,90,122,.35);}",
      ".ly-toast-item.info{background:linear-gradient(135deg,#1a3a5c,#0d2a4a);border:1px solid rgba(90,162,255,.35);}",

      // Print styles
      "@media print{.ly-no-print{display:none!important;}.ly-print-only{display:block!important;}.ly-modal-overlay{display:none!important;}}",
      ".ly-print-only{display:none;}",

      // Receipt
      ".ly-receipt{background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.15);border-radius:14px;padding:18px;font-family:'Courier New',monospace;font-size:12px;line-height:1.7;}",
      ".ly-receipt-head{text-align:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px dashed rgba(255,255,255,.15);}",
      ".ly-receipt-row{display:flex;justify-content:space-between;gap:10px;}",
      ".ly-receipt-foot{text-align:center;margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,.15);font-size:11px;color:var(--muted,#a8b3c7);}",

      // Divider
      ".ly-divider{border:none;border-top:1px solid var(--border,#263246);margin:18px 0;}",

      // Client card
      ".ly-client-card{background:var(--panel,#0f1622);border:1px solid var(--border,#263246);border-radius:14px;padding:16px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:border-color .15s;}",
      ".ly-client-card:hover{border-color:rgba(90,162,255,.35);}",
      ".ly-client-avatar{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;flex:0 0 44px;}",
      ".ly-client-name{font-size:14px;font-weight:800;color:var(--text,#e9eef7);}",
      ".ly-client-id{font-size:12px;color:var(--muted,#a8b3c7);margin-top:2px;}",
      ".ly-client-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}",
    ].join("\n");
    document.head.appendChild(st);
  }

  // ─── Toast system ────────────────────────────────────────────
  var toastContainer = null;
  function getToastContainer(){
    if(!toastContainer || !document.body.contains(toastContainer)){
      toastContainer = document.createElement("div");
      toastContainer.className = "ly-toast";
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }
  function toast(msg, type, duration){
    var c = getToastContainer();
    var item = document.createElement("div");
    item.className = "ly-toast-item " + (type||"info");
    item.innerHTML = (type==="ok"?"✓ ":type==="err"?"✕ ":"ℹ ") + esc(msg);
    c.appendChild(item);
    setTimeout(function(){ try{ item.remove(); }catch(e){} }, duration||3000);
  }

  // ─── Autocomplete helper ──────────────────────────────────────
  function makeAutocomplete(inputEl, dropEl, getOptions, onSelect){
    var focusedIdx = -1;
    var currentOptions = [];

    function highlight(q, text){
      var idx = norm(text).indexOf(norm(q));
      if(idx<0||!q) return esc(text);
      return esc(text.slice(0,idx))+'<span class="ac-highlight">'+esc(text.slice(idx,idx+q.length))+'</span>'+esc(text.slice(idx+q.length));
    }

    function renderDrop(options, q){
      currentOptions = options;
      focusedIdx = -1;
      if(!options.length){ dropEl.classList.remove("open"); return; }
      dropEl.innerHTML = options.slice(0,12).map(function(o,i){
        var main = typeof o==="string" ? o : o.label;
        var sub  = typeof o==="string" ? "" : (o.sub||"");
        return '<div class="ly-ac-item" data-idx="'+i+'">'
          + highlight(q, main)
          + (sub ? '<div class="ac-sub">'+esc(sub)+'</div>' : "")
          + '</div>';
      }).join("");
      dropEl.classList.add("open");
      dropEl.querySelectorAll(".ly-ac-item").forEach(function(el){
        el.addEventListener("mousedown", function(e){
          e.preventDefault();
          var idx = parseInt(el.dataset.idx);
          select(options[idx]);
        });
      });
    }

    function select(o){
      onSelect(o);
      dropEl.classList.remove("open");
    }

    function setFocus(dir){
      var items = dropEl.querySelectorAll(".ly-ac-item");
      if(!items.length) return;
      items[focusedIdx] && items[focusedIdx].classList.remove("focused");
      focusedIdx = Math.max(-1, Math.min(items.length-1, focusedIdx+dir));
      if(focusedIdx>=0) items[focusedIdx].classList.add("focused");
    }

    inputEl.addEventListener("input", function(){
      var q = inputEl.value;
      var opts = getOptions(q);
      renderDrop(opts, q);
    });
    inputEl.addEventListener("keydown", function(e){
      if(e.key==="ArrowDown"){ e.preventDefault(); setFocus(1); }
      else if(e.key==="ArrowUp"){ e.preventDefault(); setFocus(-1); }
      else if(e.key==="Enter"){ if(focusedIdx>=0&&currentOptions[focusedIdx]){ e.preventDefault(); select(currentOptions[focusedIdx]); } }
      else if(e.key==="Escape"){ dropEl.classList.remove("open"); }
    });
    inputEl.addEventListener("blur", function(){ setTimeout(function(){ dropEl.classList.remove("open"); },150); });
  }

  // ─── Campaign CRUD ────────────────────────────────────────────
  function campaignStatus(c){
    if(!c.active) return "inactive";
    if(c.open_ended) return "open";
    var today = todayYmd();
    if(c.end_date && c.end_date < today) return "ended";
    if(c.start_date && c.start_date > today) return "upcoming";
    return "active";
  }

  // ─── DASHBOARD ────────────────────────────────────────────────
  function renderDashboard(panel){
    var campaigns = loadCampaigns();
    var txns = loadTxns();
    var clients = loadClients();

    var activeCamps = campaigns.filter(function(c){ var s=campaignStatus(c); return s==="active"||s==="open"; });
    var clientCount = Object.keys(clients).length;
    var txnToday = txns.filter(function(t){ return (t.date||"").slice(0,10)===todayYmd(); });

    panel.innerHTML =
      '<div class="ly-stats-row">'
      + statCard("🎯", activeCamps.length, "Active Campaigns", "#5aa2ff")
      + statCard("👥", clientCount, "Loyalty Clients", "#43d17a")
      + statCard("📋", txns.length, "Total Transactions", "#f5c842")
      + statCard("⚡", txnToday.length, "Today's Activities", "#ff8c42")
      + '</div>'
      + '<div class="ly-section-hd"><h3 class="ly-section-title">Active Campaigns</h3></div>'
      + (activeCamps.length
          ? '<div class="ly-camp-grid">'+activeCamps.map(campCardHtml).join("")+'</div>'
          : emptyState("🎯","No active campaigns","Create your first campaign in the Campaigns tab")
        )
      + (txns.length ? '<hr class="ly-divider"><div class="ly-section-hd"><h3 class="ly-section-title">Recent Activity</h3></div>'+recentActivityTable(txns.slice(-10).reverse()) : "");
  }

  function statCard(ico, val, lbl, color){
    return '<div class="ly-stat">'
      + '<div class="ly-stat-accent" style="background:'+color+';"></div>'
      + '<div class="ly-stat-val">'+esc(val)+'</div>'
      + '<div class="ly-stat-lbl">'+esc(lbl)+'</div>'
      + '</div>';
  }

  function recentActivityTable(rows){
    if(!rows.length) return "";
    var campaigns = loadCampaigns();
    var campMap = {};
    campaigns.forEach(function(c){ campMap[c.id]=c; });
    return '<div class="ly-txn-card"><div class="ly-txn-section-title">Recent Transactions</div>'
      + '<div style="overflow:auto;"><table class="ly-hist-table">'
      + '<thead><tr><th>Date</th><th>Client</th><th>Campaign</th><th>Action</th><th>Receipt</th></tr></thead>'
      + '<tbody>'
      + rows.map(function(t){
          var camp = campMap[t.campaign_id];
          var conf = camp ? typeConf(camp.type) : null;
          return '<tr>'
            + '<td>'+esc(fmtTs(t.created_at||t.date))+'</td>'
            + '<td><b>'+esc(t.client_name||t.client_id||"")+'</b><br><span style="color:var(--muted);font-size:11px">'+esc(t.client_id||"")+'</span></td>'
            + '<td>'+(camp?'<span style="color:'+esc(conf.color)+'">'+esc(conf.icon)+' '+esc(camp.name)+'</span>':"—")+'</td>'
            + '<td>'+esc(t.action_label||t.action||"")+'</td>'
            + '<td style="color:var(--muted);font-size:11px">'+esc(t.receipt_no||"")+'</td>'
            + '</tr>';
        }).join("")
      + '</tbody></table></div></div>';
  }

  // ─── CAMPAIGNS ────────────────────────────────────────────────
  function renderCampaigns(panel){
    var campaigns = loadCampaigns();
    panel.innerHTML =
      '<div class="ly-section-hd">'
      + '<h3 class="ly-section-title">All Campaigns <span style="color:var(--muted);font-size:13px;font-weight:400">('+campaigns.length+')</span></h3>'
      + '<div style="display:flex;gap:10px;align-items:center;">'
      + '<div class="ly-search-wrap"><span class="ly-search-ico">⌕</span><input id="ly-camp-search" class="ly-search" placeholder="Search campaigns…"></div>'
      + '<button class="ly-btn primary" id="ly-camp-new">＋ New Campaign</button>'
      + '</div></div>'
      + '<div id="ly-camp-list"></div>';

    document.getElementById("ly-camp-new").addEventListener("click", function(){
      openCampaignModal(null, function(){ renderCampaigns(panel); });
    });

    var searchEl = document.getElementById("ly-camp-search");
    searchEl.addEventListener("input", function(){
      renderCampList(document.getElementById("ly-camp-list"), campaigns, searchEl.value, panel);
    });

    renderCampList(document.getElementById("ly-camp-list"), campaigns, "", panel);
  }

  function renderCampList(container, campaigns, q, parentPanel){
    var filtered = campaigns;
    if(q){
      var nq = norm(q);
      filtered = campaigns.filter(function(c){
        return norm(c.name).includes(nq)||norm(c.brand).includes(nq)||norm(c.description).includes(nq);
      });
    }
    if(!filtered.length){
      container.innerHTML = emptyState("🎯","No campaigns found","Create a new campaign to get started");
      return;
    }
    container.innerHTML = '<div class="ly-camp-grid">'+filtered.map(campCardHtml).join("")+'</div>';
    // Attach edit/toggle/delete
    container.querySelectorAll("[data-camp-edit]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.dataset.campEdit;
        var all = loadCampaigns();
        var c = all.find(function(x){ return x.id===id; });
        if(c) openCampaignModal(c, function(){
          var reloaded = loadCampaigns();
          container.innerHTML = '<div class="ly-camp-grid">'+reloaded.map(campCardHtml).join("")+'</div>';
          attachCampListeners(container, parentPanel);
        });
      });
    });
    container.querySelectorAll("[data-camp-toggle]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.dataset.campToggle;
        var all = loadCampaigns();
        var idx = all.findIndex(function(x){ return x.id===id; });
        if(idx>=0){ all[idx].active = !all[idx].active; saveCampaigns(all); }
        renderCampaigns(parentPanel);
        toast(all[idx] && all[idx].active ? "Campaign activated" : "Campaign deactivated", "ok");
      });
    });
    container.querySelectorAll("[data-camp-delete]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.dataset.campDelete;
        if(!confirm("Delete this campaign? This cannot be undone.")) return;
        var all = loadCampaigns().filter(function(x){ return x.id!==id; });
        saveCampaigns(all);
        renderCampaigns(parentPanel);
        toast("Campaign deleted", "info");
      });
    });
  }

  function attachCampListeners(container, parentPanel){
    // same as inside renderCampList — kept for reuse
    container.querySelectorAll("[data-camp-edit]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.dataset.campEdit;
        var c = loadCampaigns().find(function(x){ return x.id===id; });
        if(c) openCampaignModal(c, function(){ renderCampaigns(parentPanel); });
      });
    });
  }

  function campCardHtml(c){
    var conf = typeConf(c.type);
    var status = campaignStatus(c);
    var badgeClass = {active:"active",open:"open",inactive:"inactive",ended:"ended",upcoming:"inactive"}[status]||"inactive";
    var badgeLabel = {active:"Active",open:"Open-ended",inactive:"Inactive",ended:"Ended",upcoming:"Upcoming"}[status]||status;

    var datesHtml = "";
    if(c.open_ended){ datesHtml = "Open-ended"; }
    else if(c.start_date || c.end_date){
      datesHtml = (c.start_date?fmtDmy(c.start_date):"∞")+" – "+(c.end_date?fmtDmy(c.end_date):"∞");
    }

    var extraHtml = "";
    if(c.type==="stamp_card")  extraHtml = '<div style="font-size:11px;color:var(--muted)">Stamps needed: <b>'+esc(c.stamp_target||10)+'</b> · Reward: <i>'+esc(c.reward||"")+'</i></div>';
    if(c.type==="points")      extraHtml = '<div style="font-size:11px;color:var(--muted)">'+esc(c.points_per_unit||1)+' pts per €1 · Redeem at '+esc(c.redeem_threshold||100)+' pts</div>';
    if(c.type==="discount")    extraHtml = '<div style="font-size:11px;color:var(--muted)">'+esc(c.discount_pct||10)+'% off '+esc(c.brand||"all items")+'</div>';
    if(c.type==="buy_x_get_y") extraHtml = '<div style="font-size:11px;color:var(--muted)">Buy <b>'+esc(c.buy_qty||3)+'</b> get <b>'+esc(c.get_qty||1)+'</b> free</div>';
    if(c.type==="event")       extraHtml = '<div style="font-size:11px;color:#ff6b9d">Event: '+esc(c.event_name||c.name)+'</div>';
    if(c.type==="tiered")      extraHtml = '<div style="font-size:11px;color:var(--muted)">Tiered rewards · '+esc((c.tiers||[]).length)+' tiers</div>';

    return '<div class="ly-camp-card">'
      + '<div class="ly-camp-banner" style="background:'+conf.grad+';"></div>'
      + '<div class="ly-camp-body">'
      + '<div class="ly-camp-head">'
      + '<div class="ly-camp-ico" style="background:'+conf.grad+'20;color:'+conf.color+';">'+conf.icon+'</div>'
      + '<div style="flex:1;min-width:0;">'
      + '<div class="ly-camp-name">'+esc(c.name)+'</div>'
      + '<div class="ly-camp-type" style="color:'+conf.color+'">'+conf.label+'</div>'
      + '</div>'
      + '<span class="ly-camp-badge '+badgeClass+'">'+badgeLabel+'</span>'
      + '</div>'
      + (c.description?'<div class="ly-camp-desc">'+esc(c.description)+'</div>':"")
      + (c.brand?'<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">Brand: <b>'+esc(c.brand)+'</b></div>':"")
      + extraHtml
      + '<div class="ly-camp-meta" style="margin-top:12px;">'
      + '<div class="ly-camp-dates">'+esc(datesHtml)+'</div>'
      + '<div class="ly-camp-actions">'
      + '<button class="ly-btn sm" data-camp-toggle="'+esc(c.id)+'">'+(c.active?"Deactivate":"Activate")+'</button>'
      + '<button class="ly-btn sm" data-camp-edit="'+esc(c.id)+'">Edit</button>'
      + '<button class="ly-btn sm danger" data-camp-delete="'+esc(c.id)+'">✕</button>'
      + '</div></div>'
      + '</div></div>';
  }

  function emptyState(ico, title, sub){
    return '<div class="ly-empty"><span class="ly-empty-ico">'+ico+'</span><p class="ly-empty-title">'+esc(title)+'</p><p class="ly-empty-sub">'+esc(sub)+'</p></div>';
  }

  // ─── Campaign modal ───────────────────────────────────────────
  var campModal = null;
  function ensureCampModal(){
    if(campModal && document.body.contains(campModal)) return;
    campModal = document.createElement("div");
    campModal.className = "ly-modal-overlay";
    campModal.id = "ly-camp-modal";
    document.body.appendChild(campModal);
  }

  function openCampaignModal(campaign, onSave){
    ensureCampModal();
    var isEdit = !!campaign;
    var c = campaign || { id:uid(), active:true, type:"stamp_card", open_ended:true };

    campModal.innerHTML = '<div class="ly-modal"><div class="ly-modal-title">'+esc(campaign?"✏ Edit Campaign":"✦ New Campaign")+'</div>'
      + '<div id="ly-camp-form"></div>'
      + '<div class="ly-modal-actions">'
      + '<button class="ly-btn" id="ly-camp-cancel">Cancel</button>'
      + '<button class="ly-btn primary" id="ly-camp-save">💾 Save Campaign</button>'
      + '</div></div>';

    campModal.classList.add("open");

    renderCampForm(document.getElementById("ly-camp-form"), c);

    document.getElementById("ly-camp-cancel").addEventListener("click", function(){
      campModal.classList.remove("open");
    });
    campModal.addEventListener("click", function(e){
      if(e.target===campModal) campModal.classList.remove("open");
    });
    document.getElementById("ly-camp-save").addEventListener("click", function(){
      var data = collectCampForm(c.id);
      if(!data) return;
      var all = loadCampaigns();
      var idx = all.findIndex(function(x){ return x.id===c.id; });
      if(idx>=0) all[idx]=data; else all.push(data);
      saveCampaigns(all);
      campModal.classList.remove("open");
      toast(isEdit?"Campaign updated":"Campaign created! 🎉","ok");
      if(onSave) onSave(data);
    });
  }

  function renderCampForm(el, c){
    el.innerHTML =
      '<div style="margin-bottom:16px;">'
      + '<div class="ly-label" style="margin-bottom:10px;">Campaign Type</div>'
      + '<div class="ly-type-grid">'
      + CAMPAIGN_TYPES.map(function(t){
          return '<div class="ly-type-card'+(c.type===t.value?" selected":"")+'" data-type="'+t.value+'" style="--type-color:'+t.color+';">'
            + '<span class="ly-type-card-ico">'+t.icon+'</span>'
            + '<div class="ly-type-card-label">'+esc(t.label)+'</div>'
            + '<div class="ly-type-card-desc">'+esc(t.desc)+'</div>'
            + '</div>';
        }).join("")
      + '</div></div>'
      + '<div class="ly-form-grid">'
      + fldInput("camp-name","Campaign Name","ly-camp-f-name",c.name||"","e.g. Uriage Loyalty Card","full")
      + fldInput("camp-brand","Brand / Scope","ly-camp-f-brand",c.brand||"","e.g. Uriage, La Roche-Posay…")
      + fldInput("camp-items","Items (comma-separated)","ly-camp-f-items",c.items||"","Leave blank for all items in brand")
      + fldTextarea("camp-desc","Description","ly-camp-f-desc",c.description||"","Describe what the client earns…","full")
      + '</div>'
      // Date range
      + '<div class="ly-form-row" style="margin-top:14px;">'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;color:var(--text);">'
      + '<input type="checkbox" id="ly-camp-f-open" '+(c.open_ended?"checked":"")+' style="width:16px;height:16px;accent-color:#5aa2ff;"> Open-ended (no expiry)'
      + '</label>'
      + '</div>'
      + '<div id="ly-camp-date-range" class="ly-form-row" style="margin-top:12px;'+(c.open_ended?"display:none;":"")+';">'
      + fldInput("camp-start","Start Date","ly-camp-f-start",c.start_date||todayYmd(),"","","date")
      + fldInput("camp-end","End Date","ly-camp-f-end",c.end_date||"","","","date")
      + '</div>'
      // Type-specific fields
      + '<div id="ly-camp-type-fields" style="margin-top:14px;"></div>'
      // Active toggle
      + '<div class="ly-form-row" style="margin-top:16px;">'
      + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;color:var(--text);">'
      + '<input type="checkbox" id="ly-camp-f-active" '+(c.active?"checked":"")+' style="width:16px;height:16px;accent-color:#43d17a;"> Campaign is Active'
      + '</label></div>';

    // type selector
    el.querySelectorAll(".ly-type-card").forEach(function(card){
      card.addEventListener("click", function(){
        el.querySelectorAll(".ly-type-card").forEach(function(x){ x.classList.remove("selected"); });
        card.classList.add("selected");
        renderTypeFields(document.getElementById("ly-camp-type-fields"), card.dataset.type, c);
      });
    });

    // open-ended toggle
    document.getElementById("ly-camp-f-open").addEventListener("change", function(){
      document.getElementById("ly-camp-date-range").style.display = this.checked?"none":"flex";
    });

    renderTypeFields(document.getElementById("ly-camp-type-fields"), c.type||"stamp_card", c);
  }

  function renderTypeFields(el, type, c){
    var html = "";
    if(type==="stamp_card"){
      html = '<div class="ly-form-grid">'
        + fldInput("","Stamps Required","ly-camp-f-stamp-target",c.stamp_target||10,"e.g. 10")
        + fldInput("","Reward Description","ly-camp-f-reward",c.reward||"","e.g. 1 free full-size product","full")
        + '</div>';
    } else if(type==="points"){
      html = '<div class="ly-form-grid">'
        + fldInput("","Points per €1 Spent","ly-camp-f-pts-per",c.points_per_unit||1,"e.g. 1")
        + fldInput("","Redemption Threshold (pts)","ly-camp-f-redeem",c.redeem_threshold||100,"e.g. 100")
        + fldInput("","Reward at Threshold","ly-camp-f-pts-reward",c.reward||"","e.g. €5 voucher","full")
        + '</div>';
    } else if(type==="discount"){
      html = '<div class="ly-form-grid">'
        + fldInput("","Discount %","ly-camp-f-disc-pct",c.discount_pct||10,"e.g. 10")
        + fldInput("","Applies To","ly-camp-f-disc-scope",c.discount_scope||"","e.g. All brand items or specific SKUs")
        + '</div>';
    } else if(type==="event"){
      html = '<div class="ly-form-grid">'
        + fldInput("","Event Name","ly-camp-f-event-name",c.event_name||"","e.g. Black Friday 2025","full")
        + fldInput("","Offer","ly-camp-f-event-offer",c.event_offer||"","e.g. 20% off all purchases","full")
        + '</div>';
    } else if(type==="buy_x_get_y"){
      html = '<div class="ly-form-grid">'
        + fldInput("","Buy Qty","ly-camp-f-buy-qty",c.buy_qty||3,"e.g. 3")
        + fldInput("","Get Qty Free","ly-camp-f-get-qty",c.get_qty||1,"e.g. 1")
        + fldInput("","Free Item Description","ly-camp-f-bxgy-reward",c.reward||"","e.g. cheapest item free","full")
        + '</div>';
    } else if(type==="tiered"){
      html = '<div style="margin-bottom:10px;">'
        + '<div class="ly-label" style="margin-bottom:6px;">Spend Tiers (add up to 4)</div>'
        + tieredFieldsHtml(c.tiers||[])
        + '</div>';
    }
    el.innerHTML = html ? '<div class="ly-txn-section-title" style="margin-top:4px;">Campaign Settings</div>'+html : "";
    if(type==="tiered") bindTieredFields(el, c.tiers||[]);
  }

  function tieredFieldsHtml(tiers){
    var t = tiers.length ? tiers : [{spend:50,reward:""},{spend:100,reward:""},{spend:200,reward:""}];
    return '<div id="ly-tiers-list">'
      + t.map(function(tier,i){
          return '<div class="ly-form-row" style="margin-bottom:8px;" data-tier-row="'+i+'">'
            + '<div class="ly-field"><div class="ly-label">Min Spend (€)</div><input class="ly-input tier-spend" value="'+esc(tier.spend)+'" placeholder="50" style="width:110px;"></div>'
            + '<div class="ly-field" style="flex:1;"><div class="ly-label">Reward</div><input class="ly-input tier-reward" value="'+esc(tier.reward)+'" placeholder="e.g. 5% discount"></div>'
            + '<button class="ly-btn sm danger" data-tier-del="'+i+'" style="margin-bottom:2px;">✕</button>'
            + '</div>';
        }).join("")
      + '</div>'
      + '<button class="ly-btn sm" id="ly-tier-add" style="margin-top:4px;">+ Add Tier</button>';
  }

  function bindTieredFields(el, initTiers){
    var tiers = (initTiers&&initTiers.length) ? initTiers.slice() : [{spend:50,reward:""},{spend:100,reward:""},{spend:200,reward:""}];
    function rerender(){
      var list = el.querySelector("#ly-tiers-list");
      if(!list) return;
      list.innerHTML = tiers.map(function(tier,i){
        return '<div class="ly-form-row" style="margin-bottom:8px;" data-tier-row="'+i+'">'
          + '<div class="ly-field"><div class="ly-label">Min Spend (€)</div><input class="ly-input tier-spend" data-ti="'+i+'" value="'+esc(tier.spend)+'" placeholder="50" style="width:110px;"></div>'
          + '<div class="ly-field" style="flex:1;"><div class="ly-label">Reward</div><input class="ly-input tier-reward" data-ti="'+i+'" value="'+esc(tier.reward)+'" placeholder="e.g. 5% discount"></div>'
          + '<button class="ly-btn sm danger" data-tier-del="'+i+'" style="margin-bottom:2px;">✕</button>'
          + '</div>';
      }).join("");
      list.querySelectorAll("[data-tier-del]").forEach(function(btn){
        btn.addEventListener("click", function(){ tiers.splice(parseInt(btn.dataset.tierDel),1); rerender(); });
      });
      list.querySelectorAll(".tier-spend").forEach(function(inp){
        inp.addEventListener("change", function(){ tiers[parseInt(inp.dataset.ti)].spend = inp.value; });
      });
      list.querySelectorAll(".tier-reward").forEach(function(inp){
        inp.addEventListener("change", function(){ tiers[parseInt(inp.dataset.ti)].reward = inp.value; });
      });
    }
    rerender();
    var addBtn = el.querySelector("#ly-tier-add");
    if(addBtn) addBtn.addEventListener("click", function(){ if(tiers.length<4){ tiers.push({spend:"",reward:""}); rerender(); } });
    el._getTiers = function(){ return tiers; };
  }

  function fldInput(id, label, elId, val, placeholder, extraClass, inputType){
    return '<div class="ly-field'+(extraClass?" "+extraClass:"")+'">'
      + '<label class="ly-label"'+(elId?' for="'+elId+'"':'')+'>'+esc(label)+'</label>'
      + '<input class="ly-input" id="'+(elId||"")+'" type="'+(inputType||"text")+'" value="'+esc(val)+'" placeholder="'+esc(placeholder||"")+'"></div>';
  }
  function fldTextarea(id, label, elId, val, placeholder, extraClass){
    return '<div class="ly-field'+(extraClass?" "+extraClass:"")+'">'
      + '<label class="ly-label"'+(elId?' for="'+elId+'"':'')+'>'+esc(label)+'</label>'
      + '<textarea class="ly-textarea" id="'+(elId||"")+'" placeholder="'+esc(placeholder||"")+'">'+esc(val)+'</textarea></div>';
  }

  function collectCampForm(existingId){
    var nameEl = document.getElementById("ly-camp-f-name");
    if(!nameEl || !nameEl.value.trim()){ toast("Campaign name is required","err"); return null; }

    var selectedTypeCard = document.querySelector(".ly-type-card.selected");
    var type = selectedTypeCard ? selectedTypeCard.dataset.type : "stamp_card";

    var openEndedEl = document.getElementById("ly-camp-f-open");
    var openEnded = openEndedEl && openEndedEl.checked;
    var activeEl = document.getElementById("ly-camp-f-active");

    var data = {
      id: existingId || uid(),
      name: nameEl.value.trim(),
      brand: v("ly-camp-f-brand"),
      items: v("ly-camp-f-items"),
      description: v("ly-camp-f-desc"),
      type: type,
      active: !!(activeEl && activeEl.checked),
      open_ended: openEnded,
      start_date: openEnded?"":v("ly-camp-f-start"),
      end_date: openEnded?"":v("ly-camp-f-end"),
      created_at: new Date().toISOString()
    };

    // type-specific
    if(type==="stamp_card"){ data.stamp_target=parseInt(v("ly-camp-f-stamp-target"))||10; data.reward=v("ly-camp-f-reward"); }
    if(type==="points"){ data.points_per_unit=parseFloat(v("ly-camp-f-pts-per"))||1; data.redeem_threshold=parseInt(v("ly-camp-f-redeem"))||100; data.reward=v("ly-camp-f-pts-reward"); }
    if(type==="discount"){ data.discount_pct=parseFloat(v("ly-camp-f-disc-pct"))||10; data.discount_scope=v("ly-camp-f-disc-scope"); }
    if(type==="event"){ data.event_name=v("ly-camp-f-event-name"); data.event_offer=v("ly-camp-f-event-offer"); }
    if(type==="buy_x_get_y"){ data.buy_qty=parseInt(v("ly-camp-f-buy-qty"))||3; data.get_qty=parseInt(v("ly-camp-f-get-qty"))||1; data.reward=v("ly-camp-f-bxgy-reward"); }
    if(type==="tiered"){
      var tiersEl = document.getElementById("ly-camp-type-fields");
      data.tiers = tiersEl && tiersEl._getTiers ? tiersEl._getTiers() : [];
    }

    return data;
  }

  function v(id){ var el=document.getElementById(id); return el?(el.value||"").trim():""; }

  // ─── RECORD TRANSACTION ───────────────────────────────────────
  function renderRecord(panel){
    var campaigns = loadCampaigns().filter(function(c){
      var s = campaignStatus(c);
      return s==="active"||s==="open";
    });

    panel.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:1100px;">'
      // Left: form
      + '<div>'
      // CLIENT
      + '<div class="ly-txn-card">'
      + '<div class="ly-txn-section-title">👤 Client Identification</div>'
      + '<div class="ly-form-grid" style="margin-bottom:12px;">'
      + '<div class="ly-field">'
      + '<label class="ly-label" for="ly-txn-id">ID Card No.</label>'
      + '<div class="ly-ac-wrap">'
      + '<input class="ly-input" id="ly-txn-id" placeholder="e.g. 123456M (auto-padded)" autocomplete="off">'
      + '<div id="ly-txn-id-drop" class="ly-ac-drop"></div>'
      + '</div></div>'
      + '<div class="ly-field">'
      + '<label class="ly-label" for="ly-txn-name">Client Name</label>'
      + '<input class="ly-input" id="ly-txn-name" placeholder="Full name">'
      + '</div></div>'
      + '<div class="ly-form-row">'
      + '<div class="ly-field">'
      + '<label class="ly-label" for="ly-txn-receipt">Receipt No.</label>'
      + '<input class="ly-input" id="ly-txn-receipt" placeholder="e.g. R-00123" style="width:160px;">'
      + '</div></div>'
      + '</div>'
      // CAMPAIGN
      + '<div class="ly-txn-card">'
      + '<div class="ly-txn-section-title">🎯 Campaign</div>'
      + '<div class="ly-field"><label class="ly-label" for="ly-txn-camp">Select Campaign</label>'
      + '<select class="ly-select" id="ly-txn-camp">'
      + '<option value="">— Choose campaign —</option>'
      + campaigns.map(function(c){ var conf=typeConf(c.type); return '<option value="'+esc(c.id)+'">'+conf.icon+' '+esc(c.name)+' ('+conf.label+')'+'</option>'; }).join("")
      + '</select></div>'
      + '<div id="ly-camp-preview" style="margin-top:12px;"></div>'
      + '</div>'
      // ITEMS
      + '<div class="ly-txn-card">'
      + '<div class="ly-txn-section-title">🛒 Items Purchased</div>'
      + '<div id="ly-items-list" class="ly-items-list"></div>'
      + '<div class="ly-form-row">'
      + '<div class="ly-field" style="flex:1;">'
      + '<label class="ly-label" for="ly-item-input">Item Description</label>'
      + '<div class="ly-ac-wrap">'
      + '<input class="ly-input" id="ly-item-input" placeholder="Start typing item name…" autocomplete="off">'
      + '<div id="ly-item-drop" class="ly-ac-drop"></div>'
      + '</div></div>'
      + '<div class="ly-field" style="width:90px;">'
      + '<label class="ly-label" for="ly-item-qty">Qty</label>'
      + '<input class="ly-input" id="ly-item-qty" type="number" min="1" value="1" style="width:90px;">'
      + '</div>'
      + '<div class="ly-field" style="justify-content:flex-end;">'
      + '<button class="ly-btn success" id="ly-add-item" style="margin-bottom:1px;">+ Add</button>'
      + '</div>'
      + '</div>'
      + '<div class="ly-form-row" style="margin-top:10px;">'
      + '<div class="ly-field" style="width:160px;"><label class="ly-label" for="ly-txn-total">Total Spend (€)</label>'
      + '<input class="ly-input" id="ly-txn-total" type="number" step="0.01" placeholder="0.00"></div>'
      + '<div class="ly-field" style="flex:1;"><label class="ly-label" for="ly-txn-notes">Notes</label>'
      + '<input class="ly-input" id="ly-txn-notes" placeholder="Optional notes…"></div>'
      + '</div></div>'
      // ACTIONS
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      + '<button class="ly-btn primary" id="ly-txn-submit" style="font-size:14px;padding:12px 22px;">✓ Record Transaction</button>'
      + '<button class="ly-btn" id="ly-txn-reset">↺ Reset</button>'
      + '</div>'
      + '</div>'
      // Right: client loyalty snapshot
      + '<div id="ly-client-snapshot"><div class="ly-empty" style="margin-top:80px;"><span class="ly-empty-ico">👤</span><p class="ly-empty-sub">Enter a client ID card to see their loyalty status</p></div></div>'
      + '</div>';

    var txnItems = [];

    // ID card autocomplete
    var idInput = document.getElementById("ly-txn-id");
    var idDrop  = document.getElementById("ly-txn-id-drop");
    makeAutocomplete(idInput, idDrop, function(q){
      if(!q||q.length<2) return [];
      var clients = loadClients();
      var nq = norm(q);
      return Object.values(clients).filter(function(c){
        return norm(c.id_card).includes(nq)||norm(c.name).includes(nq);
      }).slice(0,8).map(function(c){ return {label:c.id_card, sub:c.name, _client:c}; });
    }, function(o){
      idInput.value = o.label;
      document.getElementById("ly-txn-name").value = o.sub||"";
      refreshClientSnapshot(o.label);
    });

    idInput.addEventListener("blur", function(){
      if(looksLikeMtId(idInput.value)){
        idInput.value = normMtId(idInput.value)||idInput.value;
      }
      refreshClientSnapshot(idInput.value);
    });

    // Item autocomplete
    var itemInput = document.getElementById("ly-item-input");
    var itemDrop  = document.getElementById("ly-item-drop");
    makeAutocomplete(itemInput, itemDrop, function(q){
      if(!q||q.length<1) return [];
      var items = loadItems();
      var nq = norm(q);
      return items.filter(function(s){ return norm(s).includes(nq); }).slice(0,10);
    }, function(o){
      itemInput.value = typeof o==="string"?o:o.label;
    });

    // Campaign preview
    document.getElementById("ly-txn-camp").addEventListener("change", function(){
      var campId = this.value;
      var camp = loadCampaigns().find(function(c){ return c.id===campId; });
      renderCampPreview(document.getElementById("ly-camp-preview"), camp);
      refreshClientSnapshot(idInput.value);
    });

    // Add item
    document.getElementById("ly-add-item").addEventListener("click", function(){
      var desc = itemInput.value.trim();
      var qty = parseInt(document.getElementById("ly-item-qty").value)||1;
      if(!desc){ toast("Enter an item description","err"); return; }
      rememberItem(desc);
      txnItems.push({desc:desc, qty:qty});
      renderItemsList(document.getElementById("ly-items-list"), txnItems);
      itemInput.value="";
      document.getElementById("ly-item-qty").value="1";
    });
    itemInput.addEventListener("keydown", function(e){
      if(e.key==="Enter" && !idDrop.classList.contains("open") && !itemDrop.classList.contains("open")){
        document.getElementById("ly-add-item").click();
      }
    });

    // Submit
    document.getElementById("ly-txn-submit").addEventListener("click", function(){
      submitTransaction(txnItems, function(){
        txnItems.length=0;
        renderItemsList(document.getElementById("ly-items-list"),[]);
        document.getElementById("ly-txn-id").value="";
        document.getElementById("ly-txn-name").value="";
        document.getElementById("ly-txn-receipt").value="";
        document.getElementById("ly-txn-camp").value="";
        document.getElementById("ly-txn-total").value="";
        document.getElementById("ly-txn-notes").value="";
        document.getElementById("ly-camp-preview").innerHTML="";
        document.getElementById("ly-client-snapshot").innerHTML='<div class="ly-empty" style="margin-top:80px;"><span class="ly-empty-ico">✅</span><p class="ly-empty-sub">Transaction recorded successfully</p></div>';
      });
    });
    document.getElementById("ly-txn-reset").addEventListener("click", function(){
      renderRecord(panel);
    });

    function refreshClientSnapshot(idCard){
      if(!idCard) return;
      var normId = normMtId(idCard)||idCard;
      var campId = document.getElementById("ly-txn-camp").value;
      renderClientSnapshot(document.getElementById("ly-client-snapshot"), normId, campId);
    }
  }

  function renderItemsList(el, items){
    if(!items.length){ el.innerHTML=''; return; }
    el.innerHTML = '<div class="ly-items-list">'
      + items.map(function(item,i){
          return '<div class="ly-item-row">'
            + '<span class="desc">'+esc(item.desc)+'</span>'
            + '<span class="qty">×'+esc(item.qty)+'</span>'
            + '<button class="remove" data-remove="'+i+'" title="Remove">✕</button>'
            + '</div>';
        }).join("")
      + '</div>';
    el.querySelectorAll("[data-remove]").forEach(function(btn){
      btn.addEventListener("click", function(){
        items.splice(parseInt(btn.dataset.remove),1);
        renderItemsList(el, items);
      });
    });
  }

  function renderCampPreview(el, camp){
    if(!camp){ el.innerHTML=""; return; }
    var conf = typeConf(camp.type);
    el.innerHTML = '<div style="background:'+conf.grad+'12;border:1px solid '+conf.color+'30;border-radius:12px;padding:12px;display:flex;align-items:center;gap:12px;">'
      + '<span style="font-size:22px;">'+conf.icon+'</span>'
      + '<div><div style="font-size:13px;font-weight:900;color:var(--text)">'+esc(camp.name)+'</div>'
      + '<div style="font-size:11px;color:'+conf.color+';font-weight:800">'+conf.label+'</div>'
      + (camp.description?'<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+esc(camp.description)+'</div>':"")
      + '</div></div>';
  }

  function renderClientSnapshot(el, idCard, campId){
    var normId = normMtId(idCard)||idCard;
    var clients = loadClients();
    var client = clients[normId];
    var txns = loadTxns().filter(function(t){ return t.client_id===normId; });

    if(!client && !txns.length){
      el.innerHTML = '<div class="ly-txn-card">'
        + '<div class="ly-txn-section-title">New Client</div>'
        + '<div class="ly-empty" style="padding:30px 0;"><span class="ly-empty-ico" style="font-size:32px;">👋</span>'
        + '<p class="ly-empty-sub">No previous loyalty history for <b>'+esc(normId)+'</b>.<br>First time will be registered automatically.</p></div>'
        + '</div>';
      return;
    }

    var camps = loadCampaigns();
    var campMap = {};
    camps.forEach(function(c){ campMap[c.id]=c; });

    // Build per-campaign summary
    var campSummary = {};
    txns.forEach(function(t){
      if(!t.campaign_id) return;
      if(!campSummary[t.campaign_id]) campSummary[t.campaign_id]={stamps:0,points:0,count:0,txns:[]};
      campSummary[t.campaign_id].count++;
      campSummary[t.campaign_id].stamps += (t.stamps_awarded||0);
      campSummary[t.campaign_id].points += (t.points_awarded||0);
      campSummary[t.campaign_id].txns.push(t);
    });

    var focusCamp = campId ? campMap[campId] : null;

    var html = '<div class="ly-txn-card">';
    html += '<div class="ly-txn-section-title">Loyalty Profile</div>';
    html += '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">';
    var initials = (client&&client.name) ? client.name.split(" ").map(function(w){ return w[0]; }).slice(0,2).join("").toUpperCase() : (normId.slice(0,2));
    var avatarColor = ["#5aa2ff","#43d17a","#f5c842","#ff6b9d","#ff8c42"][Math.abs(hashStr(normId))%5];
    html += '<div class="ly-client-avatar" style="background:'+avatarColor+'22;color:'+avatarColor+';border:2px solid '+avatarColor+'44;">'+esc(initials)+'</div>';
    html += '<div><div style="font-size:15px;font-weight:900;color:var(--text)">'+esc(client&&client.name||"Unknown Client")+'</div>';
    html += '<div style="font-size:12px;color:var(--muted)">'+esc(normId)+'</div>';
    html += '<div style="font-size:11px;color:var(--muted);margin-top:3px;">'+esc(txns.length)+' transaction'+(txns.length!==1?"s":"")+'</div>';
    html += '</div></div>';

    // Show focused campaign card if selected
    if(focusCamp){
      var conf = typeConf(focusCamp.type);
      var sum = campSummary[focusCamp.id] || {stamps:0,points:0,count:0};
      html += '<div style="background:'+conf.grad+'10;border:1px solid '+conf.color+'30;border-radius:12px;padding:14px;margin-bottom:12px;">';
      html += '<div style="font-size:12px;font-weight:800;color:'+conf.color+';text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">'+conf.icon+' '+esc(focusCamp.name)+'</div>';
      if(focusCamp.type==="stamp_card"){
        var target = focusCamp.stamp_target||10;
        var earned = sum.stamps % target;
        html += '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">'+earned+' / '+target+' stamps earned</div>';
        html += '<div class="ly-stamps">';
        for(var i=0;i<target;i++){
          html += '<div class="ly-stamp'+(i<earned?' earned':'')+'">'+esc(i<earned?"⭐":"○")+'</div>';
        }
        html += '</div>';
        var pct = Math.round((earned/target)*100);
        html += '<div class="ly-progress" style="margin-top:10px;"><div class="ly-progress-bar" style="width:'+pct+'%;background:'+conf.grad+'"></div></div>';
        html += '<div style="font-size:11px;color:var(--muted);margin-top:6px;">'+pct+'% to: <i>'+esc(focusCamp.reward||"reward")+'</i></div>';
        if(earned+1>=target){ html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(245,200,66,.15);border:1px solid rgba(245,200,66,.35);border-radius:8px;font-size:12px;font-weight:800;color:#f5c842;">🎉 Next stamp completes the card!</div>'; }
      } else if(focusCamp.type==="points"){
        var thresh = focusCamp.redeem_threshold||100;
        var totalPts = sum.points;
        html += '<div style="font-size:24px;font-weight:900;color:'+conf.color+'">'+totalPts+' <span style="font-size:13px;font-weight:400;color:var(--muted)">points</span></div>';
        var ptsPct = Math.min(100, Math.round((totalPts%thresh)/thresh*100));
        html += '<div class="ly-progress"><div class="ly-progress-bar" style="width:'+ptsPct+'%;background:'+conf.grad+'"></div></div>';
        html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">'+totalPts%thresh+' / '+thresh+' to redeem: <i>'+esc(focusCamp.reward||"reward")+'</i></div>';
        var completions = Math.floor(totalPts/thresh);
        if(completions>0) html += '<div style="font-size:11px;color:'+conf.color+';margin-top:4px;">Redeemed '+completions+' time'+(completions>1?"s":"")+'</div>';
      } else if(focusCamp.type==="discount"){
        html += '<div style="font-size:20px;font-weight:900;color:'+conf.color+'">'+esc(focusCamp.discount_pct||10)+'% OFF</div>';
        html += '<div style="font-size:11px;color:var(--muted);">Apply discount on '+esc(focusCamp.brand||"qualifying items")+'</div>';
      } else if(focusCamp.type==="buy_x_get_y"){
        var buyQty = focusCamp.buy_qty||3;
        var getQty = focusCamp.get_qty||1;
        var accumulated = sum.count % buyQty;
        html += '<div style="font-size:13px;color:var(--text);margin-bottom:6px;">Buy <b>'+buyQty+'</b> get <b>'+getQty+'</b> free</div>';
        html += '<div class="ly-progress"><div class="ly-progress-bar" style="width:'+Math.round(accumulated/buyQty*100)+'%;background:'+conf.grad+'"></div></div>';
        html += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">'+accumulated+' / '+buyQty+' purchases tracked</div>';
        if(accumulated+1>=buyQty) html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(255,140,66,.12);border:1px solid rgba(255,140,66,.3);border-radius:8px;font-size:12px;font-weight:800;color:#ff8c42;">🎁 Client earns free item!</div>';
      } else if(focusCamp.type==="event"){
        html += '<div style="font-size:13px;color:#ff6b9d;font-weight:800;">'+esc(focusCamp.event_name||focusCamp.name)+'</div>';
        html += '<div style="font-size:12px;color:var(--muted);margin-top:4px;">'+esc(focusCamp.event_offer||"Special event offer")+'</div>';
        html += '<div style="font-size:11px;color:var(--muted);margin-top:6px;">'+sum.count+' previous event purchase'+(sum.count!==1?"s":"")+'</div>';
      } else if(focusCamp.type==="tiered"){
        var totalSpend = txns.filter(function(t){ return t.campaign_id===focusCamp.id; }).reduce(function(a,t){ return a+(t.total||0); },0);
        var tiers = focusCamp.tiers||[];
        var currentTier = null;
        tiers.forEach(function(tier){ if(totalSpend >= parseFloat(tier.spend||0)) currentTier=tier; });
        html += '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Total spend: <b style="color:'+conf.color+'">€'+totalSpend.toFixed(2)+'</b></div>';
        if(currentTier) html += '<div style="font-size:12px;font-weight:800;color:'+conf.color+';margin-bottom:6px;">🏆 Current tier: '+esc(currentTier.reward)+'</div>';
        tiers.forEach(function(tier,i){
          var active = totalSpend>=parseFloat(tier.spend||0);
          html += '<div style="padding:6px 10px;border-radius:8px;margin-bottom:4px;border:1px solid '+(active?conf.color+'44':'rgba(255,255,255,.1)')+';background:'+(active?conf.color+'12':'rgba(255,255,255,.03)')+';">';
          html += '<span style="font-size:11px;color:'+(active?conf.color:'var(--muted)')+';">€'+esc(tier.spend)+'+ → '+esc(tier.reward)+'</span>';
          if(active) html += ' <span style="color:'+conf.color+';font-size:11px;">✓</span>';
          html += '</div>';
        });
      }
      html += '</div>';
    }

    // Other campaign activity
    var otherCamps = Object.keys(campSummary).filter(function(cid){ return cid!==campId; });
    if(otherCamps.length){
      html += '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px;">Other Campaigns</div>';
      otherCamps.forEach(function(cid){
        var camp = campMap[cid];
        if(!camp) return;
        var conf = typeConf(camp.type);
        var sum = campSummary[cid];
        html += '<div style="padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.02);margin-bottom:6px;display:flex;align-items:center;gap:10px;">';
        html += '<span style="color:'+conf.color+'">'+conf.icon+'</span>';
        html += '<div style="flex:1;font-size:12px;"><b>'+esc(camp.name)+'</b>';
        if(camp.type==="stamp_card") html += ' · '+esc(sum.stamps)+ ' stamps';
        if(camp.type==="points") html += ' · '+esc(sum.points)+ ' pts';
        html += '<span style="color:var(--muted);"> ('+sum.count+' txn'+(sum.count!==1?"s":"")+')</span>';
        html += '</div></div>';
      });
    }
    html += '</div>';
    el.innerHTML = html;
  }

  function hashStr(s){ var h=0; for(var i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return Math.abs(h); }

  function submitTransaction(items, onDone){
    var idCard = (document.getElementById("ly-txn-id").value||"").trim();
    if(!idCard){ toast("Client ID card is required","err"); return; }
    var normId = normMtId(idCard)||idCard;
    var name   = (document.getElementById("ly-txn-name").value||"").trim();
    var campId = document.getElementById("ly-txn-camp").value;
    var receiptNo = (document.getElementById("ly-txn-receipt").value||"").trim();
    var total  = parseFloat(document.getElementById("ly-txn-total").value)||0;
    var notes  = (document.getElementById("ly-txn-notes").value||"").trim();

    if(!campId){ toast("Please select a campaign","err"); return; }
    if(!items.length){ toast("Please add at least one item","err"); return; }

    var camp = loadCampaigns().find(function(c){ return c.id===campId; });
    if(!camp){ toast("Campaign not found","err"); return; }

    rememberClient(normId, name);

    // Compute what gets awarded
    var stampsAwarded=0, pointsAwarded=0, actionLabel="";
    if(camp.type==="stamp_card"){ stampsAwarded=items.reduce(function(a,i){ return a+i.qty; },0); actionLabel="Awarded "+stampsAwarded+" stamp"+(stampsAwarded!==1?"s":""); }
    if(camp.type==="points"){ pointsAwarded=Math.round((camp.points_per_unit||1)*total); actionLabel="Awarded "+pointsAwarded+" points"; }
    if(camp.type==="discount"){ actionLabel="Applied "+(camp.discount_pct||10)+"% discount"; }
    if(camp.type==="event"){ actionLabel="Event purchase recorded"; }
    if(camp.type==="buy_x_get_y"){ actionLabel="Purchase tracked ("+camp.buy_qty+" → "+camp.get_qty+" free)"; }
    if(camp.type==="tiered"){ actionLabel="Spend recorded (€"+total.toFixed(2)+")"; }

    var txn = {
      id: uid(),
      client_id: normId,
      client_name: name,
      campaign_id: campId,
      receipt_no: receiptNo,
      items: items.slice(),
      total: total,
      notes: notes,
      stamps_awarded: stampsAwarded,
      points_awarded: pointsAwarded,
      action: "record",
      action_label: actionLabel,
      date: todayYmd(),
      created_at: nowIso()
    };

    var txns = loadTxns();
    txns.push(txn);
    saveTxns(txns);

    toast("Transaction recorded! "+actionLabel,"ok",4000);
    showReceiptModal(txn, camp, items);
    if(onDone) onDone(txn);
  }

  // ─── Receipt modal ────────────────────────────────────────────
  function showReceiptModal(txn, camp, items){
    var conf = typeConf(camp.type);
    var overlay = document.createElement("div");
    overlay.className = "ly-modal-overlay open";
    overlay.innerHTML =
      '<div class="ly-modal" style="max-width:480px;">'
      + '<div class="ly-modal-title">🧾 Transaction Receipt</div>'
      + '<div class="ly-receipt" id="ly-receipt-content">'
      + '<div class="ly-receipt-head"><b>Loyalty Transaction</b><br>'
      + '<span style="font-size:14px;">'+esc(camp.name)+'</span><br>'
      + '<span style="font-size:11px;color:var(--muted);">'+fmtTs(txn.created_at)+'</span>'
      + '</div>'
      + '<div class="ly-receipt-row"><span>Client:</span><b>'+esc(txn.client_name||txn.client_id)+'</b></div>'
      + '<div class="ly-receipt-row"><span>ID Card:</span><span>'+esc(txn.client_id)+'</span></div>'
      + (txn.receipt_no?'<div class="ly-receipt-row"><span>Receipt No:</span><span>'+esc(txn.receipt_no)+'</span></div>':"")
      + '<div style="border-top:1px dashed rgba(255,255,255,.12);margin:8px 0;"></div>'
      + items.map(function(it){ return '<div class="ly-receipt-row"><span>'+esc(it.desc)+'</span><span>×'+esc(it.qty)+'</span></div>'; }).join("")
      + (txn.total?'<div style="border-top:1px dashed rgba(255,255,255,.12);margin:8px 0;"></div><div class="ly-receipt-row"><b>Total:</b><b>€'+esc(txn.total.toFixed(2))+'</b></div>':"")
      + '<div style="border-top:1px dashed rgba(255,255,255,.12);margin:8px 0;"></div>'
      + '<div class="ly-receipt-row" style="color:'+conf.color+';"><span>'+conf.icon+' '+esc(conf.label)+':</span><b>'+esc(txn.action_label)+'</b></div>'
      + (txn.notes?'<div style="margin-top:6px;font-size:11px;color:var(--muted);">Notes: '+esc(txn.notes)+'</div>':"")
      + '<div class="ly-receipt-foot">Thank you for your loyalty! 💛</div>'
      + '</div>'
      + '<div class="ly-modal-actions">'
      + '<button class="ly-btn" id="ly-receipt-print">🖨 Print</button>'
      + '<button class="ly-btn primary" id="ly-receipt-close">Close</button>'
      + '</div></div>';

    document.body.appendChild(overlay);
    overlay.querySelector("#ly-receipt-close").addEventListener("click", function(){ overlay.remove(); });
    overlay.querySelector("#ly-receipt-print").addEventListener("click", function(){ window.print(); });
    overlay.addEventListener("click", function(e){ if(e.target===overlay) overlay.remove(); });
  }

  // ─── CLIENTS ─────────────────────────────────────────────────
  function renderClients(panel){
    var clients = loadClients();
    var txns = loadTxns();
    var clientList = Object.values(clients);

    panel.innerHTML =
      '<div class="ly-section-hd">'
      + '<h3 class="ly-section-title">Loyalty Clients <span style="color:var(--muted);font-size:13px;font-weight:400">('+clientList.length+')</span></h3>'
      + '<div class="ly-search-wrap"><span class="ly-search-ico">⌕</span><input id="ly-cl-search" class="ly-search" placeholder="Search by name or ID…"></div>'
      + '</div>'
      + '<div id="ly-cl-list"></div>';

    var searchEl = document.getElementById("ly-cl-search");
    searchEl.addEventListener("input", function(){
      renderClientList(document.getElementById("ly-cl-list"), clientList, txns, searchEl.value, panel);
    });
    renderClientList(document.getElementById("ly-cl-list"), clientList, txns, "", panel);
  }

  function renderClientList(el, clientList, txns, q, panel){
    var filtered = clientList;
    if(q){
      var nq=norm(q);
      filtered=clientList.filter(function(c){ return norm(c.name).includes(nq)||norm(c.id_card).includes(nq); });
    }
    if(!filtered.length){
      el.innerHTML = emptyState("👥","No clients found","Clients are added automatically when recording transactions");
      return;
    }

    var camps = loadCampaigns();
    var campMap = {};
    camps.forEach(function(c){ campMap[c.id]=c; });

    var txnByClient = {};
    txns.forEach(function(t){
      if(!txnByClient[t.client_id]) txnByClient[t.client_id]=[];
      txnByClient[t.client_id].push(t);
    });

    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">'
      + filtered.map(function(c){
          var ctxns = txnByClient[c.id_card]||[];
          var avatarColor = ["#5aa2ff","#43d17a","#f5c842","#ff6b9d","#ff8c42"][Math.abs(hashStr(c.id_card))%5];
          var initials = c.name ? c.name.split(" ").map(function(w){ return w[0]; }).slice(0,2).join("").toUpperCase() : c.id_card.slice(0,2);
          var campSet = {};
          ctxns.forEach(function(t){ if(t.campaign_id&&campMap[t.campaign_id]) campSet[t.campaign_id]=true; });
          var campBadges = Object.keys(campSet).slice(0,3).map(function(cid){
            var camp=campMap[cid]; if(!camp) return "";
            var conf=typeConf(camp.type);
            return '<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:'+conf.color+'18;color:'+conf.color+';border:1px solid '+conf.color+'30;">'+conf.icon+' '+esc(camp.name)+'</span>';
          }).join("");
          return '<div class="ly-client-card" data-cl="'+esc(c.id_card)+'">'
            + '<div class="ly-client-avatar" style="background:'+avatarColor+'18;color:'+avatarColor+';border:2px solid '+avatarColor+'35;">'+esc(initials)+'</div>'
            + '<div style="flex:1;min-width:0;">'
            + '<div class="ly-client-name">'+esc(c.name||"Unknown")+'</div>'
            + '<div class="ly-client-id">'+esc(c.id_card)+'</div>'
            + '<div style="font-size:11px;color:var(--muted);margin-top:3px;">'+esc(ctxns.length)+' transaction'+(ctxns.length!==1?"s":"")+'</div>'
            + '<div class="ly-client-badges" style="margin-top:6px;">'+campBadges+'</div>'
            + '</div></div>';
        }).join("")
      + '</div>';

    el.querySelectorAll("[data-cl]").forEach(function(card){
      card.addEventListener("click", function(){
        showClientDetail(card.dataset.cl, txns, campMap, panel);
      });
    });
  }

  function showClientDetail(idCard, txns, campMap, panel){
    var clients = loadClients();
    var client = clients[idCard] || {id_card:idCard, name:""};
    var ctxns = txns.filter(function(t){ return t.client_id===idCard; });

    var overlay = document.createElement("div");
    overlay.className = "ly-modal-overlay open";
    overlay.innerHTML =
      '<div class="ly-modal" style="max-width:640px;">'
      + '<div class="ly-modal-title">👤 '+esc(client.name||idCard)+'</div>'
      + '<div style="color:var(--muted);font-size:13px;margin-bottom:16px;">'+esc(idCard)+'</div>'
      + (ctxns.length
          ? '<div style="overflow:auto;"><table class="ly-hist-table">'
            + '<thead><tr><th>Date</th><th>Campaign</th><th>Items</th><th>Action</th><th>Receipt</th></tr></thead><tbody>'
            + ctxns.slice().reverse().map(function(t){
                var camp=campMap[t.campaign_id]; var conf=camp?typeConf(camp.type):{icon:"",color:"var(--muted)"};
                return '<tr>'
                  + '<td>'+esc(fmtTs(t.created_at||t.date))+'</td>'
                  + '<td>'+(camp?'<span style="color:'+esc(conf.color)+'">'+conf.icon+' '+esc(camp.name)+'</span>':"—")+'</td>'
                  + '<td style="max-width:200px;">'+esc((t.items||[]).map(function(i){ return i.desc+' ×'+i.qty; }).join(", "))+'</td>'
                  + '<td>'+esc(t.action_label||"")+'</td>'
                  + '<td style="color:var(--muted);font-size:11px;">'+esc(t.receipt_no||"")+'</td>'
                  + '</tr>';
              }).join("")
            + '</tbody></table></div>'
          : emptyState("📋","No transactions yet","No loyalty transactions recorded for this client")
        )
      + '<div class="ly-modal-actions">'
      + '<button class="ly-btn danger" id="cl-del-btn">🗑 Remove Client</button>'
      + '<button class="ly-btn primary" id="cl-close-btn">Close</button>'
      + '</div></div>';

    document.body.appendChild(overlay);
    overlay.querySelector("#cl-close-btn").addEventListener("click", function(){ overlay.remove(); });
    overlay.addEventListener("click", function(e){ if(e.target===overlay) overlay.remove(); });
    overlay.querySelector("#cl-del-btn").addEventListener("click", function(){
      if(!confirm("Remove this client and all their loyalty history? This cannot be undone.")) return;
      var clients = loadClients();
      delete clients[idCard];
      saveClients(clients);
      var allTxns = loadTxns().filter(function(t){ return t.client_id!==idCard; });
      saveTxns(allTxns);
      overlay.remove();
      toast("Client removed","info");
      renderClients(panel);
    });
  }

  // ─── MAIN RENDER ──────────────────────────────────────────────
  async function render(ctx){
    var el = ctx.mount;
    ensureStyles();

    el.innerHTML =
      '<div class="ly-wrap">'
      + '<div class="ly-head">'
      + '<div><h2 class="ly-title">Loyalty &amp; Campaigns</h2>'
      + '<p class="ly-sub">Stamps &middot; Points &middot; Discounts &middot; Events &middot; Buy X Get Y &middot; Tiered Rewards</p>'
      + '<div class="ly-type-pills">'
      + [
          {icon:"⭐",label:"Stamp Card",color:"#f5c842"},
          {icon:"💎",label:"Points",color:"#5aa2ff"},
          {icon:"🏷",label:"Discount",color:"#43d17a"},
          {icon:"🎉",label:"Events",color:"#ff6b9d"},
          {icon:"🎁",label:"Buy X Get Y",color:"#ff8c42"},
          {icon:"🏆",label:"Spend Tiers",color:"#a8e6cf"}
        ].map(function(t){ return '<span class="ly-type-pill" style="color:'+t.color+';border-color:'+t.color+'44;background:'+t.color+'12;">'+t.icon+' '+t.label+'</span>'; }).join("")
      + '</div></div>'
      // Tabs
      + '<div class="ly-tabs">'
      + '<button class="ly-tab active" data-tab="dashboard"><span class="ly-tab-ico">📊</span>Dashboard</button>'
      + '<button class="ly-tab" data-tab="campaigns"><span class="ly-tab-ico">🎯</span>Campaigns</button>'
      + '<button class="ly-tab" data-tab="record"><span class="ly-tab-ico">✍</span>Record Transaction</button>'
      + '<button class="ly-tab" data-tab="clients"><span class="ly-tab-ico">👥</span>Clients</button>'
      + '</div>'
      // Panels
      + '<div class="ly-panel active" id="ly-tab-dashboard"></div>'
      + '<div class="ly-panel" id="ly-tab-campaigns"></div>'
      + '<div class="ly-panel" id="ly-tab-record"></div>'
      + '<div class="ly-panel" id="ly-tab-clients"></div>';

    // Tab switching
    el.querySelectorAll(".ly-tab").forEach(function(tab){
      tab.addEventListener("click", function(){
        el.querySelectorAll(".ly-tab").forEach(function(t){ t.classList.remove("active"); });
        tab.classList.add("active");
        var name = tab.dataset.tab;
        el.querySelectorAll(".ly-panel").forEach(function(p){ p.classList.remove("active"); });
        var panel = document.getElementById("ly-tab-"+name);
        panel.classList.add("active");
        panel.innerHTML = "";
        if(name==="dashboard") renderDashboard(panel);
        if(name==="campaigns") renderCampaigns(panel);
        if(name==="record")    renderRecord(panel);
        if(name==="clients")   renderClients(panel);
      });
    });

    // Initial render
    renderDashboard(document.getElementById("ly-tab-dashboard"));
  }

  // ─── Register ─────────────────────────────────────────────────
  E.registerModule({
    id:    "loyalty",
    title: "Loyalty & Campaigns",
    order: 290,
    icon:  "✦",
    render: render
  });

})();
