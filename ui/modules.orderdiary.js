/* ui/modules.orderdiary.js
   Eikon – Order Diary module

   Endpoints (Worker):
     GET    /order-diary/entries?date=YYYY-MM-DD   → list entries for date
     POST   /order-diary/entries                   → create entry
     PUT    /order-diary/entries/:id               → update entry
     DELETE /order-diary/entries/:id               → delete entry
     GET    /order-diary/items?q=text              → autocomplete item history
     POST   /order-diary/carry-over                → carry outstanding to next date
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.orderdiary.js)");

  var LP = "[EIKON][orderdiary]";
  function warn() { try { console.warn.apply(console, [LP].concat([].slice.call(arguments))); } catch(e){} }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch(e) {
      return String(s == null ? "" : s)
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    }
  }
  function pad2(n) { return String(n).padStart(2,"0"); }
  function toYmd(d) { return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  function todayYmd() { return toYmd(new Date()); }
  function addDays(ymd, n) {
    var d = new Date(ymd + "T00:00:00");
    d.setDate(d.getDate() + n);
    return toYmd(d);
  }
  function fmtDateLong(ymd) {
    if (!ymd) return "";
    var d = new Date(ymd + "T00:00:00");
    return d.toLocaleDateString("en-IE", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  }
  function fmtDateShort(ymd) {
    if (!ymd) return "";
    return ymd.slice(8,10)+"/"+ymd.slice(5,7)+"/"+ymd.slice(0,4);
  }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }

  // ─── Similarity ────────────────────────────────────────────────────────────
  // Improved over quotations module: adds substring containment and token-recall
  // so that "Clotrimazolum" matches "CLOTRIMAZOLUM CREAM BY 200G HASCO".
  var SIMILARITY_THRESHOLD = 0.55; // slightly relaxed for autocomplete suggestions

  function tokenize(s) {
    return String(s||"").toLowerCase()
      .replace(/([a-z])(\d)/g,"$1 $2").replace(/(\d)([a-z])/g,"$1 $2")
      .replace(/[^a-z0-9]/g," ").split(/\s+/).filter(Boolean);
  }
  function trigramSet(s) {
    var set = Object.create(null);
    var p = "  "+s+" ";
    for (var i=0;i<p.length-2;i++) { var t=p.slice(i,i+3); set[t]=(set[t]||0)+1; }
    return set;
  }
  function trigramSimilarity(a,b) {
    var sa=trigramSet(a), sb=trigramSet(b), inter=0, totalA=0, totalB=0, k;
    for (k in sa) { totalA+=sa[k]; if(sb[k]) inter+=Math.min(sa[k],sb[k]); }
    for (k in sb) { totalB+=sb[k]; }
    var total=totalA+totalB;
    return total>0?(2*inter)/total:0;
  }
  function jaccardSimilarity(a,b) {
    var ta=tokenize(a), tb=tokenize(b);
    if (!ta.length&&!tb.length) return 1;
    if (!ta.length||!tb.length) return 0;
    var setA=Object.create(null), inter=0;
    for (var i=0;i<ta.length;i++) setA[ta[i]]=1;
    for (var j=0;j<tb.length;j++) { if(setA[tb[j]]) inter++; }
    return inter/(ta.length+tb.length-inter);
  }
  function levenshtein(a,b) {
    var m=a.length,n=b.length,dp=[],i,j;
    for (i=0;i<=m;i++) dp[i]=[i];
    for (j=0;j<=n;j++) dp[0][j]=j;
    for (i=1;i<=m;i++) for (j=1;j<=n;j++)
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
  }

  function descSimilarity(a,b) {
    var na=norm(a), nb=norm(b);
    if (na===nb) return 1.0;
    if (!na||!nb) return 0;

    // 1. Substring containment: "clotrimazolum" ⊂ "clotrimazolum cream by 200g hasco"
    if (nb.indexOf(na)>=0 || na.indexOf(nb)>=0) {
      var shorter=Math.min(na.length,nb.length);
      var longer=Math.max(na.length,nb.length);
      // At least 0.72, rising toward 1.0 as strings approach same length
      return Math.max(0.72, shorter/longer);
    }

    // 2. Token recall: typed tokens are all (or mostly) found verbatim in target
    var ta=tokenize(na), tb=tokenize(nb);
    if (ta.length>0 && tb.length>0) {
      var tbSet=Object.create(null);
      tb.forEach(function(t){ tbSet[t]=1; });
      var found=0;
      ta.forEach(function(t){ if(tbSet[t]) found++; });
      var recall=found/ta.length;
      if (recall>=0.9) return 0.82+0.12*recall;  // 0.82–0.94
      if (recall>=0.5) return 0.58+0.24*recall;  // 0.58–0.70
    }

    // 3. Classic: trigram + Jaccard + Levenshtein (best of three)
    var trig=trigramSimilarity(na,nb);
    var jac=jaccardSimilarity(na,nb);
    var edit=0;
    var maxLen=Math.max(na.length,nb.length);
    if (maxLen>0&&maxLen<=60) edit=1-levenshtein(na,nb)/maxLen;
    return Math.max(trig,jac,edit);
  }

  // Find matching quotation rows for a typed query (used for hints + autocomplete)
  function findQuotationMatches(typed, quotations, limit) {
    if (!typed||typed.length<2||!quotations||!quotations.length) return [];
    var ntypes=norm(typed);
    var typedTokens=tokenize(ntypes).filter(function(t){return t.length>=3;});
    var seen=Object.create(null), results=[];

    quotations.forEach(function(row) {
      var d=String(row.item_description||"").trim();
      if (!d) return;
      var nd=norm(d);
      var key=nd+"|"+norm(row.supplier||"");
      if (seen[key]) return;

      // Fast token-in-description check (catches "clotrimazolum" in long desc)
      var hasToken=typedTokens.length>0&&typedTokens.some(function(t){return nd.indexOf(t)>=0;});
      var sim=hasToken ? Math.max(0.70, descSimilarity(typed,d)) : descSimilarity(typed,d);
      if (sim>=SIMILARITY_THRESHOLD) {
        seen[key]=1;
        results.push({row:row, sim:sim});
      }
    });
    results.sort(function(a,b){return b.sim-a.sim;});
    return results.slice(0,limit||8).map(function(r){return r.row;});
  }

  // ─── State ────────────────────────────────────────────────────────────────
  var state = {
    date:           todayYmd(),
    entries:        [],
    filterSupplier: null,     // null = show all, "__none__" = unassigned
    searchText:     "",       // free-text filter for table rows
    user:           null,     // stored from ctx.user on render
    loading:        false,
    _mount:         null
  };

  // Quotations cache (prefetched on module mount)
  var _quotations = null;
  var _quotationsLoading = false;

  function prefetchQuotations() {
    if (_quotations!==null||_quotationsLoading) return;
    _quotationsLoading=true;
    E.apiFetch("/quotations/entries",{method:"GET"}).then(function(r){
      _quotations=(r&&r.entries)||[];
      _quotationsLoading=false;
    }).catch(function(){ _quotations=[]; _quotationsLoading=false; });
  }

  // ─── API wrappers ─────────────────────────────────────────────────────────
  function apiList(date)      { return E.apiFetch("/order-diary/entries?date="+encodeURIComponent(date),{method:"GET"}); }
  function apiCreate(p)       { return E.apiFetch("/order-diary/entries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}); }
  function apiUpdate(id,p)    { return E.apiFetch("/order-diary/entries/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}); }
  function apiDelete(id)      { return E.apiFetch("/order-diary/entries/"+id,{method:"DELETE"}); }
  function apiItems(q)        { return E.apiFetch("/order-diary/items?q="+encodeURIComponent(q||""),{method:"GET"}); }
  function apiCarryOver(f,t)  { return E.apiFetch("/order-diary/carry-over",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from_date:f,to_date:t})}); }

  // ─── Styles ───────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById("od-styles")) return;
    var st=document.createElement("style");
    st.id="od-styles";
    st.textContent=
      // Outer wrap
      ".od-wrap{max-width:1040px;margin:0 auto;padding:14px 12px 32px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e9eef7;}" +

      // Header row
      ".od-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;}" +
      ".od-title{font-size:19px;font-weight:900;letter-spacing:-.3px;color:#e9eef7;}" +
      ".od-title span{color:#5aa2ff;}" +
      ".od-head-spacer{flex:1;}" +
      ".od-nav{display:flex;align-items:center;gap:5px;}" +
      ".od-date-label{font-size:12px;font-weight:700;color:#e9eef7;min-width:200px;text-align:center;}" +

      // Buttons
      ".od-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:7px;border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.05);color:#e9eef7;font-size:11px;font-weight:700;cursor:pointer;transition:background .13s,border-color .13s;white-space:nowrap;line-height:1.4;}" +
      ".od-btn:hover{background:rgba(255,255,255,.09);}" +
      ".od-btn.primary{background:rgba(58,160,255,.16);border-color:rgba(58,160,255,.40);color:#5aa2ff;}" +
      ".od-btn.primary:hover{background:rgba(58,160,255,.26);}" +
      ".od-btn.ok{background:rgba(67,209,122,.11);border-color:rgba(67,209,122,.32);color:#43d17a;}" +
      ".od-btn.ok:hover{background:rgba(67,209,122,.20);}" +
      ".od-btn.danger{background:rgba(255,90,122,.09);border-color:rgba(255,90,122,.28);color:#ff5a7a;}" +
      ".od-btn.danger:hover{background:rgba(255,90,122,.18);}" +
      ".od-btn.warn{background:rgba(255,175,50,.09);border-color:rgba(255,175,50,.28);color:#ffaf32;}" +
      ".od-btn.warn:hover{background:rgba(255,175,50,.18);}" +
      ".od-btn:disabled{opacity:.35;cursor:not-allowed;}" +

      // Stat bar
      ".od-stat-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}" +
      ".od-stat{display:flex;align-items:center;gap:5px;padding:5px 11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px;font-size:11px;color:rgba(233,238,247,.65);}" +
      ".od-stat strong{font-size:15px;font-weight:900;color:#e9eef7;}" +
      ".od-stat.ok strong{color:#43d17a;}" +
      ".od-stat.warn strong{color:#ffaf32;}" +
      ".od-stat.danger strong{color:#ff5a7a;}" +
      ".od-stat.accent strong{color:#5aa2ff;}" +

      // Supplier filter tabs
      ".od-filter-bar{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;align-items:center;}" +
      ".od-filter-label{font-size:10px;font-weight:800;color:rgba(233,238,247,.35);text-transform:uppercase;letter-spacing:.5px;margin-right:2px;}" +
      ".od-filter-tab{padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.10);background:transparent;color:rgba(233,238,247,.55);font-size:11px;font-weight:700;cursor:pointer;transition:all .12s;}" +
      ".od-filter-tab:hover{background:rgba(255,255,255,.06);color:#e9eef7;}" +
      ".od-filter-tab.active{background:rgba(58,160,255,.16);border-color:rgba(58,160,255,.40);color:#5aa2ff;}" +

      // Quick-add form
      ".od-quick-add{display:flex;gap:7px;align-items:stretch;margin-bottom:12px;}" +
      ".od-qa-name-wrap{position:relative;flex:2;min-width:0;}" +
      ".od-qa-sup-wrap{position:relative;flex:1;min-width:0;}" +
      ".od-qa-input{width:100%;background:rgba(10,16,24,.70);border:1px solid rgba(255,255,255,.13);border-radius:8px;color:#e9eef7;padding:7px 11px;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .14s,box-shadow .14s;}" +
      ".od-qa-input:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 2px rgba(58,160,255,.12);}" +
      ".od-qa-input::placeholder{color:rgba(233,238,247,.28);}" +
      ".od-qa-qty{width:64px;background:rgba(10,16,24,.70);border:1px solid rgba(255,255,255,.13);border-radius:8px;color:#e9eef7;padding:7px 8px;font-size:13px;font-weight:700;outline:none;text-align:center;font-family:inherit;transition:border-color .14s;}" +
      ".od-qa-qty:focus{border-color:rgba(58,160,255,.55);}" +
      ".od-qa-add{padding:7px 16px;background:rgba(58,160,255,.20);border:1px solid rgba(58,160,255,.45);border-radius:8px;color:#5aa2ff;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;transition:background .13s;}" +
      ".od-qa-add:hover{background:rgba(58,160,255,.32);}" +
      ".od-qa-add:disabled{opacity:.4;cursor:not-allowed;}" +

      // Autocomplete dropdown
      ".od-sug-list{position:absolute;left:0;right:0;top:calc(100% + 3px);background:rgba(10,15,24,.98);border:1px solid rgba(58,160,255,.32);border-radius:9px;box-shadow:0 8px 28px rgba(0,0,0,.55);z-index:9999;overflow:hidden;max-height:260px;overflow-y:auto;}" +
      ".od-sug-section{font-size:9px;font-weight:900;color:rgba(58,160,255,.65);text-transform:uppercase;letter-spacing:.7px;padding:5px 11px 3px;border-bottom:1px solid rgba(255,255,255,.05);}" +
      ".od-sug-item{padding:6px 11px;cursor:pointer;display:flex;align-items:baseline;gap:8px;border-bottom:1px solid rgba(255,255,255,.04);transition:background .09s;}" +
      ".od-sug-item:last-child{border-bottom:none;}" +
      ".od-sug-item:hover,.od-sug-item.hov{background:rgba(58,160,255,.13);}" +
      ".od-sug-name{font-size:12px;font-weight:700;color:#e9eef7;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".od-sug-meta{font-size:10px;color:rgba(233,238,247,.42);white-space:nowrap;flex-shrink:0;}" +
      ".od-sug-cost{color:#43d17a;font-weight:700;}" +

      // Main table
      ".od-table-wrap{border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;}" +
      ".od-table-scroll{height:calc(100vh - 360px);min-height:150px;overflow-y:auto;}" +
      ".od-table{width:100%;border-collapse:collapse;font-size:12px;}" +
      ".od-table thead th{position:sticky;top:0;z-index:3;background:rgba(10,15,24,.98);color:rgba(233,238,247,.45);font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:800;padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.10);text-align:left;white-space:nowrap;}" +
      ".od-table thead th.r{text-align:right;}" +
      ".od-table td{padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle;}" +
      ".od-table tbody tr:last-child td{border-bottom:none;}" +
      ".od-table tbody tr:hover td{background:rgba(255,255,255,.022);}" +

      // Supplier group row
      ".od-group-row td{background:rgba(58,160,255,.04);border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);padding:5px 10px;}" +
      ".od-group-row.first td{border-top:none;}" +
      ".od-group-inner{display:flex;align-items:center;gap:8px;}" +
      ".od-group-name{font-size:12px;font-weight:900;}" +
      ".od-group-count{font-size:10px;color:rgba(233,238,247,.35);}" +

      // Item name cell
      ".od-cell-name{font-size:12px;font-weight:600;color:#e9eef7;}" +
      ".od-cell-note{font-size:10px;color:rgba(233,238,247,.38);font-style:italic;margin-top:1px;}" +
      ".od-carried-badge{font-size:9px;background:rgba(255,175,50,.12);border:1px solid rgba(255,175,50,.28);color:#ffaf32;border-radius:3px;padding:0 4px;margin-left:5px;vertical-align:middle;}" +

      // Status pill
      ".od-pill{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap;}" +
      ".od-pill.pending{background:rgba(233,238,247,.06);color:rgba(233,238,247,.45);border:1px solid rgba(255,255,255,.09);}" +
      ".od-pill.received{background:rgba(67,209,122,.11);color:#43d17a;border:1px solid rgba(67,209,122,.28);}" +
      ".od-pill.not_received{background:rgba(255,90,122,.10);color:#ff5a7a;border:1px solid rgba(255,90,122,.24);}" +
      ".od-pill.wrong_pick{background:rgba(255,175,50,.10);color:#ffaf32;border:1px solid rgba(255,175,50,.24);}" +

      // Action icon buttons
      ".od-ia{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:5px;border:1px solid transparent;cursor:pointer;font-size:12px;transition:background .1s;background:transparent;}" +
      ".od-ia.recv{border-color:rgba(67,209,122,.28);color:#43d17a;}" +
      ".od-ia.recv:hover{background:rgba(67,209,122,.18);}" +
      ".od-ia.nrecv{border-color:rgba(255,90,122,.25);color:#ff5a7a;}" +
      ".od-ia.nrecv:hover{background:rgba(255,90,122,.16);}" +
      ".od-ia.wpick{border-color:rgba(255,175,50,.25);color:#ffaf32;}" +
      ".od-ia.wpick:hover{background:rgba(255,175,50,.16);}" +
      ".od-ia.edit{border-color:rgba(255,255,255,.11);color:rgba(233,238,247,.55);}" +
      ".od-ia.edit:hover{background:rgba(255,255,255,.08);color:#e9eef7;}" +
      ".od-ia.del{border-color:rgba(255,90,122,.18);color:rgba(255,90,122,.55);}" +
      ".od-ia.del:hover{background:rgba(255,90,122,.14);color:#ff5a7a;}" +
      ".od-actions-cell{display:flex;gap:3px;align-items:center;justify-content:flex-end;}" +

      // Action bar (above table)
      ".od-action-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;}" +
      ".od-search-wrap{flex:1;min-width:160px;max-width:280px;}" +
      ".od-search-input{width:100%;background:rgba(10,16,24,.70);border:1px solid rgba(255,255,255,.13);border-radius:8px;color:#e9eef7;padding:5px 10px;font-size:12px;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .14s;}" +
      ".od-search-input:focus{border-color:rgba(58,160,255,.55);}" +
      ".od-search-input::placeholder{color:rgba(233,238,247,.28);}" +

      // Empty state
      ".od-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;gap:10px;}" +
      ".od-empty-icon{font-size:44px;opacity:.3;}" +
      ".od-empty-title{font-size:16px;font-weight:800;color:rgba(233,238,247,.55);}" +
      ".od-empty-sub{font-size:12px;color:rgba(233,238,247,.35);}" +

      // Loading
      ".od-loading{display:flex;align-items:center;justify-content:center;padding:52px 24px;font-size:13px;color:rgba(233,238,247,.4);gap:8px;}" +

      // Modal / form
      ".od-field{margin-bottom:12px;}" +
      ".od-label{display:block;font-size:11px;font-weight:800;color:rgba(233,238,247,.55);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px;}" +
      ".od-input{width:100%;background:rgba(10,16,24,.70);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e9eef7;padding:8px 11px;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .14s,box-shadow .14s;}" +
      ".od-input:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 2px rgba(58,160,255,.12);}" +
      ".od-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
      "@media(max-width:480px){.od-row2{grid-template-columns:1fr;}}" +

      // Quotation hints in edit modal
      ".od-qt-wrap{margin-top:12px;}" +
      ".od-qt-label{font-size:10px;font-weight:900;color:#5aa2ff;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px;}" +
      ".od-qt-table{width:100%;border-collapse:collapse;font-size:11px;}" +
      ".od-qt-table th{color:rgba(233,238,247,.40);font-weight:700;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.08);font-size:10px;text-transform:uppercase;letter-spacing:.3px;text-align:left;}" +
      ".od-qt-table td{padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.04);}" +
      ".od-qt-table tr:last-child td{border-bottom:none;}" +
      ".od-qt-table tbody tr{cursor:pointer;transition:background .09s;}" +
      ".od-qt-table tbody tr:hover{background:rgba(58,160,255,.08);}" +
      ".od-qt-none{font-size:11px;color:rgba(233,238,247,.30);padding:5px 0;}" +

      // Wrong pick modal
      ".od-wp-info{background:rgba(255,175,50,.06);border:1px solid rgba(255,175,50,.22);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:rgba(233,238,247,.72);line-height:1.5;}" +

      "@media print{.od-no-print{display:none!important;}}" +

      // ── Status flash animations
      "@keyframes od-flash-ok  {0%{background:rgba(67,209,122,.28)}70%{background:rgba(67,209,122,.08)}100%{background:transparent}}" +
      "@keyframes od-flash-bad {0%{background:rgba(255,90,122,.24)}70%{background:rgba(255,90,122,.07)}100%{background:transparent}}" +
      "@keyframes od-flash-warn{0%{background:rgba(255,175,50,.22)}70%{background:rgba(255,175,50,.07)}100%{background:transparent}}" +
      ".od-flash-ok   td{animation:od-flash-ok   .85s ease-out forwards}" +
      ".od-flash-bad  td{animation:od-flash-bad  .85s ease-out forwards}" +
      ".od-flash-warn td{animation:od-flash-warn .85s ease-out forwards}" +

      // ── Qty inline edit
      ".od-qty-cell{text-align:right;font-weight:700;color:#5aa2ff;cursor:pointer;user-select:none;}" +
      ".od-qty-val{border-bottom:1px dotted rgba(90,162,255,.35);padding-bottom:1px;}" +
      ".od-qty-cell:hover .od-qty-val{border-bottom-color:rgba(90,162,255,.75);}" +
      ".od-qty-inline{width:52px;background:rgba(10,16,24,.90);border:1px solid rgba(58,160,255,.60);border-radius:5px;color:#5aa2ff;font-weight:700;font-size:12px;text-align:center;padding:2px 4px;outline:none;font-family:inherit;box-shadow:0 0 0 2px rgba(58,160,255,.15);}" +

      // ── Richer empty state
      ".od-empty-tips{display:flex;gap:7px;flex-wrap:wrap;justify-content:center;margin-top:14px;}" +
      ".od-empty-tip{display:flex;align-items:center;gap:6px;padding:5px 10px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:8px;font-size:11px;color:rgba(233,238,247,.42);}" +
      ".od-empty-tip kbd{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;color:rgba(233,238,247,.65);font-family:inherit;}" +

      // ── Mark All Received button (ok variant, smaller)
      ".od-btn.ok-sm{padding:3px 9px;font-size:10px;background:rgba(67,209,122,.10);border-color:rgba(67,209,122,.32);color:#43d17a;}" +
      ".od-btn.ok-sm:hover{background:rgba(67,209,122,.20);}";

    document.head.appendChild(st);
  }

  // ─── Toast ────────────────────────────────────────────────────────────────
  function ensureToastHost() {
    if (document.getElementById("od-toast-wrap")) return;
    var st=document.createElement("style");
    st.textContent=
      ".od-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:7px;max-width:min(420px,calc(100vw - 28px));pointer-events:none;}" +
      ".od-toast{border:1px solid rgba(255,255,255,.11);background:rgba(11,15,22,.97);backdrop-filter:blur(12px);border-radius:11px;padding:9px 13px;box-shadow:0 8px 22px rgba(0,0,0,.42);}" +
      ".od-toast .t-t{font-weight:800;font-size:12px;margin:0 0 1px;color:#e9eef7;}" +
      ".od-toast .t-m{margin:0;font-size:11px;opacity:.80;color:#e9eef7;}" +
      ".od-toast.good{border-color:rgba(67,209,122,.38);}" +
      ".od-toast.bad{border-color:rgba(255,90,122,.38);}" +
      ".od-toast.info{border-color:rgba(58,160,255,.38);}";
    document.head.appendChild(st);
    var wrap=document.createElement("div");
    wrap.id="od-toast-wrap"; wrap.className="od-toast-wrap";
    document.body.appendChild(wrap);
  }
  function toast(kind,title,msg) {
    ensureToastHost();
    var wrap=document.getElementById("od-toast-wrap");
    var t=document.createElement("div");
    t.className="od-toast "+(kind||"");
    t.innerHTML="<p class='t-t'>"+esc(title||"")+"</p>"+(msg?"<p class='t-m'>"+esc(msg)+"</p>":"");
    wrap.appendChild(t);
    setTimeout(function(){ try{wrap.removeChild(t);}catch(e){} },3200);
  }

  // ─── Mount helpers ────────────────────────────────────────────────────────
  function getMountEl() { return state._mount||document.getElementById("od-mount"); }
  function setMountHtml(html) { var el=getMountEl(); if(el) el.innerHTML=html; }

  async function loadEntries() {
    state.loading=true;
    setMountHtml("<div class='od-loading'>⏳ Loading…</div>");
    try {
      var res=await apiList(state.date);
      state.entries=(res&&res.entries)||[];
    } catch(e) {
      warn("load failed",e); state.entries=[];
      toast("bad","Failed to load",String(e&&e.message||e));
    }
    state.loading=false;
    renderMain();
  }

  // ─── Compute stats + group ────────────────────────────────────────────────
  function computeStats(entries) {
    var r={total:0,received:0,not_received:0,wrong_pick:0,pending:0};
    entries.forEach(function(e){
      r.total++;
      if(e.status==="received")      r.received++;
      else if(e.status==="not_received") r.not_received++;
      else if(e.status==="wrong_pick")   r.wrong_pick++;
      else r.pending++;
    });
    return r;
  }

  function buildSupplierGroups(entries) {
    var groups=Object.create(null), order=[];
    entries.forEach(function(e){
      var key=(e.supplier||"").trim()||"__none__";
      if(!groups[key]){groups[key]=[];order.push(key);}
      groups[key].push(e);
    });
    return {groups:groups,order:order};
  }

  // ─── Supplier colour palette ──────────────────────────────────────────────
  var _SUPP_PALETTE = [
    {border:"rgba(90,162,255,.60)",  bg:"rgba(58,130,255,.07)",  text:"#5aa2ff"},
    {border:"rgba(67,209,122,.55)",  bg:"rgba(67,209,122,.06)",  text:"#43d17a"},
    {border:"rgba(255,175,50,.55)",  bg:"rgba(255,175,50,.06)",  text:"#ffaf32"},
    {border:"rgba(200,120,255,.55)", bg:"rgba(180,100,255,.06)", text:"#c87aff"},
    {border:"rgba(255,100,160,.50)", bg:"rgba(255,90,140,.05)",  text:"#ff64a0"},
    {border:"rgba(50,210,200,.50)",  bg:"rgba(50,210,200,.05)",  text:"#32d2c8"},
    {border:"rgba(255,150,80,.50)",  bg:"rgba(255,150,80,.05)",  text:"#ff9650"},
    {border:"rgba(140,220,255,.50)", bg:"rgba(120,200,255,.05)", text:"#8cdcff"},
  ];
  function supplierColor(key) {
    if (!key || key === "__none__") return null;
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return _SUPP_PALETTE[h % _SUPP_PALETTE.length];
  }

  function profitColor(pct) {
    var p=Number(pct)||0;
    if(!isFinite(p)||p<=0) return "#ff5a7a";
    if(p>=35) return "#43d17a";
    if(p<=20) return "#ff5a7a";
    return "hsl("+Math.round((p-20)/15*120)+",88%,52%)";
  }

  function pillHtml(status) {
    var m={pending:{i:"⏳",l:"Pending"},received:{i:"✓",l:"Received"},not_received:{i:"✗",l:"Not Received"},wrong_pick:{i:"⚠",l:"Wrong Pick"}};
    var v=m[status]||m.pending;
    return "<span class='od-pill "+esc(status)+"'>"+v.i+" "+v.l+"</span>";
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  function renderMain() {
    var entries=state.entries;
    var stats=computeStats(entries);
    var outstanding=stats.pending+stats.not_received+stats.wrong_pick;

    // Collect all unique suppliers for filter tabs
    var allSG=buildSupplierGroups(entries);

    // Apply supplier filter
    var visible=state.filterSupplier===null ? entries :
      entries.filter(function(e){
        var k=(e.supplier||"").trim()||"__none__";
        return k===state.filterSupplier;
      });
    // Apply search text filter
    if (state.searchText) {
      var _st=norm(state.searchText);
      visible=visible.filter(function(e){ return norm(e.item_name).indexOf(_st)>=0; });
    }
    var visSG=buildSupplierGroups(visible);

    var html="<div class='od-wrap'>";

    // Header
    html+="<div class='od-head'>"+
      "<div class='od-title'>📦 Order <span>Diary</span></div>"+
      "<div class='od-head-spacer'></div>"+
      "<div class='od-nav'>"+
        "<button class='od-btn' data-nav='-1'>◀</button>"+
        "<div class='od-date-label'>"+esc(fmtDateLong(state.date))+"</div>"+
        "<button class='od-btn' data-nav='1'>▶</button>"+
        "<button class='od-btn primary' data-nav='0'>Today</button>"+
      "</div>"+
    "</div>";

    // Stat bar
    html+="<div class='od-stat-bar'>"+
      "<div class='od-stat accent'><strong>"+stats.total+"</strong> Total</div>"+
      "<div class='od-stat ok'><strong>"+stats.received+"</strong> Received</div>"+
      "<div class='od-stat warn'><strong>"+stats.pending+"</strong> Pending</div>"+
      "<div class='od-stat danger'><strong>"+stats.not_received+"</strong> Not Received</div>"+
      (stats.wrong_pick?"<div class='od-stat warn'><strong>"+stats.wrong_pick+"</strong> Wrong Pick</div>":"")+
    "</div>";

    // Action bar
    html+="<div class='od-action-bar'>"+
      "<button class='od-btn' id='od-print-btn'>🖨 Print</button>"+
      (outstanding?"<button class='od-btn warn' id='od-carry-btn'>↩ Carry Over "+outstanding+"</button>":"")+
      "<div class='od-search-wrap'>"+
        "<input id='od-search' class='od-search-input' type='text' "+
          "placeholder='🔍 Search items…' autocomplete='off' value='"+esc(state.searchText||"")+"'>"+
      "</div>"+
    "</div>";

    // Quick-add form (always visible at top)
    html+=
      "<div class='od-quick-add'>"+
        "<div class='od-qa-name-wrap'>"+
          "<input id='od-qa-name' class='od-qa-input' type='text' placeholder='Item name — type &amp; press Enter to add' autocomplete='off'>"+
          "<div id='od-qa-name-sug' class='od-sug-list' style='display:none'></div>"+
        "</div>"+
        "<input id='od-qa-qty' class='od-qa-qty' type='number' min='1' value='1' title='Quantity (scroll to adjust)'>"+
        "<div class='od-qa-sup-wrap'>"+
          "<input id='od-qa-sup' class='od-qa-input' type='text' placeholder='Supplier' autocomplete='off'>"+
          "<div id='od-qa-sup-sug' class='od-sug-list' style='display:none'></div>"+
        "</div>"+
        "<button id='od-qa-add' class='od-qa-add'>＋ Add</button>"+
      "</div>";

    // Filter tabs (only when entries exist)
    if (entries.length) {
      html+="<div class='od-filter-bar'>"+
        "<span class='od-filter-label'>Filter:</span>"+
        "<button class='od-filter-tab"+(state.filterSupplier===null?" active":"")+"' data-filter=''>All ("+entries.length+")</button>";
      allSG.order.forEach(function(k){
        var disp=k==="__none__"?"Unassigned":k;
        var active=state.filterSupplier===k?" active":"";
        html+="<button class='od-filter-tab"+active+"' data-filter='"+esc(k)+"'>"+esc(disp)+" ("+allSG.groups[k].length+")</button>";
      });
      html+="</div>";
    }

    // Table or empty
    if (!entries.length) {
      var _isToday=state.date===todayYmd();
      html+=
        "<div class='od-empty'>"+
          "<div class='od-empty-icon'>📦</div>"+
          "<div class='od-empty-title'>No orders for "+esc(fmtDateShort(state.date))+"</div>"+
          "<div class='od-empty-sub'>"+(_isToday
            ?"Type an item name above and press <kbd style='background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.16);border-radius:4px;padding:1px 6px;font-size:10px;font-family:inherit;color:rgba(233,238,247,.7);'>Enter</kbd> to add your first item."
            :"Navigate with the arrows to reach today, or browse past orders.")+
          "</div>"+
          "<div class='od-empty-tips'>"+
            "<div class='od-empty-tip'><kbd>Enter</kbd> Add item instantly</div>"+
            "<div class='od-empty-tip'><kbd>↑ ↓</kbd> Navigate suggestions</div>"+
            "<div class='od-empty-tip'><kbd>Scroll</kbd> on Qty to adjust</div>"+
            "<div class='od-empty-tip'><kbd>Click Qty</kbd> to edit inline</div>"+
            "<div class='od-empty-tip'><kbd>✓ All</kbd> Mark supplier received</div>"+
          "</div>"+
        "</div>";
    } else if (!visible.length) {
      html+="<div class='od-empty'><div class='od-empty-title'>No items for selected filter.</div></div>";
    } else {
      html+="<div class='od-table-wrap'><div class='od-table-scroll'>"+
        "<table class='od-table'><thead><tr>"+
          "<th style='width:100%'>Item</th>"+
          "<th class='r' style='min-width:44px'>Qty</th>"+
          "<th style='min-width:110px'>Status</th>"+
          "<th class='r' style='min-width:130px'>Actions</th>"+
        "</tr></thead><tbody>";

      visSG.order.forEach(function(key,gi) {
        var items=visSG.groups[key];
        var dispSupplier=key==="__none__"?"":key;
        var suppLabel=key==="__none__"?"⬜ Unassigned":"🏭 "+key;
        var firstClass=gi===0?" first":"";
        var sc=supplierColor(key);
        var headerBg=sc?"background:"+sc.bg+";border-left:3px solid "+sc.border+";":"";
        var nameStyle=sc?"color:"+sc.text+";":"";
        var unrecvCount=items.filter(function(e){return e.status!=="received";}).length;

        // Supplier group header row
        html+="<tr class='od-group-row"+firstClass+"'>"+
          "<td colspan='4' style='"+headerBg+"'>"+
            "<div class='od-group-inner'>"+
              "<span class='od-group-name' style='"+nameStyle+"'>"+esc(suppLabel)+"</span>"+
              "<span class='od-group-count'>"+items.length+" item"+(items.length===1?"":"s")+"</span>"+
              (unrecvCount?"<button class='od-btn ok-sm' style='margin-left:auto;' "+
                "data-mark-all-supplier='"+esc(key)+"'>✓ All Received ("+unrecvCount+")</button>":
                "<span style='margin-left:auto'></span>")+
              "<button class='od-btn' data-copy-supplier='"+esc(key)+"'>📋 Copy for Email</button>"+
            "</div>"+
          "</td>"+
        "</tr>";

        // Item rows
        items.forEach(function(entry) {
          var rowBorder=sc?"border-left:3px solid "+sc.border+";":"";
          html+="<tr data-entry-id='"+entry.id+"'>"+
            "<td style='"+rowBorder+"'>"+
              "<div class='od-cell-name'>"+esc(entry.item_name)+
                (entry.carried_from_id?"<span class='od-carried-badge'>↩ Carried</span>":"")+
              "</div>"+
              (entry.notes?"<div class='od-cell-note'>"+esc(entry.notes)+"</div>":"")+
            "</td>"+
            "<td class='od-qty-cell' data-qid='"+entry.id+"' data-qty='"+esc(entry.qty)+"' title='Click to edit quantity'><span class='od-qty-val'>"+esc(entry.qty)+"</span></td>"+
            "<td>"+pillHtml(entry.status)+"</td>"+
            "<td><div class='od-actions-cell'>"+
              (entry.status!=="received"?    "<button class='od-ia recv'  data-sid='"+entry.id+"' data-s='received'      title='Received'>✓</button>":"<span class='od-ia'></span>")+
              (entry.status!=="not_received"?"<button class='od-ia nrecv' data-sid='"+entry.id+"' data-s='not_received'  title='Not Received'>✗</button>":"<span class='od-ia'></span>")+
              "<button class='od-ia wpick' data-wpid='"+entry.id+"' title='Wrong Pick'>⚠</button>"+
              "<button class='od-ia edit'  data-eid='"+entry.id+"'  title='Edit'>✏</button>"+
              "<button class='od-ia del'   data-did='"+entry.id+"'  title='Delete'>🗑</button>"+
            "</div></td>"+
          "</tr>";
        });
      });

      html+="</tbody></table></div></div>";
    }

    html+="</div>";
    setMountHtml(html);
    wireMainEvents();
    wireInlineAdd();
  }

  // ─── Wire main events ─────────────────────────────────────────────────────
  function wireMainEvents() {
    var m=getMountEl(); if(!m) return;

    // Date nav
    m.querySelectorAll("[data-nav]").forEach(function(btn){
      btn.addEventListener("click",function(){
        var v=parseInt(btn.getAttribute("data-nav"),10);
        if(v===0) state.date=todayYmd();
        else state.date=addDays(state.date,v);
        state.filterSupplier=null;
        state.searchText="";
        loadEntries();
      });
    });

    // Print
    var pb=m.querySelector("#od-print-btn");
    if(pb) pb.addEventListener("click",openPrintWindow);

    // Carry over
    var cb=m.querySelector("#od-carry-btn");
    if(cb) cb.addEventListener("click",doCarryOver);

    // Search input
    var searchEl=m.querySelector("#od-search");
    if (searchEl) {
      searchEl.addEventListener("input",function(){
        state.searchText=(searchEl.value||"").trim();
        renderMain();
        // Restore focus and cursor after re-render
        setTimeout(function(){
          var el=document.getElementById("od-search");
          if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}
        },0);
      });
    }

    // Filter tabs
    m.querySelectorAll("[data-filter]").forEach(function(btn){
      btn.addEventListener("click",function(){
        var v=btn.getAttribute("data-filter");
        state.filterSupplier=v===""?null:v;
        renderMain();
      });
    });

    // Mark all received for supplier group
    m.querySelectorAll("[data-mark-all-supplier]").forEach(function(btn){
      btn.addEventListener("click",function(){
        var key=btn.getAttribute("data-mark-all-supplier");
        var sg=buildSupplierGroups(state.entries);
        var pending=(sg.groups[key]||[]).filter(function(e){return e.status!=="received";});
        if(!pending.length) return;
        btn.disabled=true;
        Promise.all(pending.map(function(e){
          return apiUpdate(e.id,{status:"received"}).then(function(){ e.status="received"; });
        })).then(function(){
          renderMain();
          toast("good","All Received",pending.length+" item"+(pending.length===1?"":"s")+" marked received.");
        }).catch(function(err){
          toast("bad","Error",String(err&&err.message||err));
          renderMain();
        });
      });
    });

    // Copy for email (supplier group)
    m.querySelectorAll("[data-copy-supplier]").forEach(function(btn){
      btn.addEventListener("click",function(){
        var key=btn.getAttribute("data-copy-supplier");
        var sg=buildSupplierGroups(state.entries);
        var items=sg.groups[key]||[];
        var dispSupplier=key==="__none__"?"":key;
        copySupplierGroup(dispSupplier,items);
      });
    });

    // Status toggle buttons
    m.querySelectorAll("[data-sid]").forEach(function(btn){
      btn.addEventListener("click",function(ev){
        ev.stopPropagation();
        setStatus(parseInt(btn.getAttribute("data-sid"),10), btn.getAttribute("data-s"));
      });
    });

    // Wrong pick
    m.querySelectorAll("[data-wpid]").forEach(function(btn){
      btn.addEventListener("click",function(ev){
        ev.stopPropagation();
        var id=parseInt(btn.getAttribute("data-wpid"),10);
        var entry=state.entries.find(function(e){return e.id===id;});
        if(entry) openWrongPickModal(entry);
      });
    });

    // Edit
    m.querySelectorAll("[data-eid]").forEach(function(btn){
      btn.addEventListener("click",function(ev){
        ev.stopPropagation();
        var id=parseInt(btn.getAttribute("data-eid"),10);
        var entry=state.entries.find(function(e){return e.id===id;});
        if(entry) openEditModal(entry);
      });
    });

    // Qty inline edit
    m.querySelectorAll(".od-qty-cell").forEach(function(cell){
      cell.addEventListener("click",function(){
        var id=parseInt(cell.getAttribute("data-qid"),10);
        var origQty=parseInt(cell.getAttribute("data-qty"),10)||1;
        cell.innerHTML="<input class='od-qty-inline' type='number' min='1' value='"+origQty+"'>";
        var inp=cell.querySelector(".od-qty-inline");
        inp.focus(); inp.select();
        var saved=false;
        function saveQty(){
          if(saved) return; saved=true;
          var newQty=Math.max(1,parseInt(inp.value||"1",10)||1);
          if(newQty===origQty){renderMain();return;}
          apiUpdate(id,{qty:newQty}).then(function(){
            var e=state.entries.find(function(e){return e.id===id;});
            if(e) e.qty=newQty;
            renderMain();
            flashRow(id,"od-flash-ok");
          }).catch(function(err){
            toast("bad","Error",String(err&&err.message||err));
            renderMain();
          });
        }
        inp.addEventListener("keydown",function(ev){
          if(ev.key==="Enter"){ev.preventDefault();saveQty();}
          else if(ev.key==="Escape"){renderMain();}
        });
        inp.addEventListener("blur",function(){saveQty();});
        inp.addEventListener("wheel",function(ev){
          ev.preventDefault();
          var v=parseInt(inp.value||"1",10)||1;
          inp.value=Math.max(1,v+(ev.deltaY<0?1:-1));
        },{passive:false});
      });
    });

    // Delete
    m.querySelectorAll("[data-did]").forEach(function(btn){
      btn.addEventListener("click",function(ev){
        ev.stopPropagation();
        var id=parseInt(btn.getAttribute("data-did"),10);
        var entry=state.entries.find(function(e){return e.id===id;});
        if(!entry) return;
        E.modal.show("Delete Item",
          "<p style='margin:0 0 4px;font-size:14px;'>Remove <strong>"+esc(entry.item_name)+"</strong>?</p>"+
          "<p style='margin:0;font-size:12px;opacity:.55;'>Cannot be undone.</p>",
          [{label:"Delete",primary:true,onClick:async function(){
            E.modal.hide();
            try{
              await apiDelete(id);
              state.entries=state.entries.filter(function(e){return e.id!==id;});
              renderMain();
              toast("good","Deleted",entry.item_name+" removed.");
            }catch(err){toast("bad","Error",String(err&&err.message||err));}
          }},{label:"Cancel",onClick:function(){E.modal.hide();}}]
        );
      });
    });
  }

  // ─── Inline quick-add wiring ──────────────────────────────────────────────
  var _qaSugTimer=null, _qaSupSugTimer=null;
  var _nameSugIdx=-1, _supSugIdx=-1;

  function wireInlineAdd() {
    var nameEl  = document.getElementById("od-qa-name");
    var qtyEl   = document.getElementById("od-qa-qty");
    var supEl   = document.getElementById("od-qa-sup");
    var nameSug = document.getElementById("od-qa-name-sug");
    var supSug  = document.getElementById("od-qa-sup-sug");
    var addBtn  = document.getElementById("od-qa-add");
    if(!nameEl||!qtyEl||!supEl||!addBtn) return;

    // ── Item name autocomplete (history + quotations merged)
    nameEl.addEventListener("input",function(){
      clearTimeout(_qaSugTimer);
      _nameSugIdx=-1;
      var typed=(nameEl.value||"").trim();
      if(typed.length<2){hideSug(nameSug);return;}
      _qaSugTimer=setTimeout(function(){fetchMergedSuggestions(typed,nameSug,supEl);},220);
    });
    nameEl.addEventListener("blur",function(){setTimeout(function(){hideSug(nameSug);_nameSugIdx=-1;},180);});

    // ── Name keyboard navigation
    nameEl.addEventListener("keydown",function(ev){
      var open=nameSug.style.display!=="none"&&nameSug.querySelectorAll(".od-sug-item").length>0;
      if(ev.key==="ArrowDown"){
        if(!open) return;
        ev.preventDefault();
        _nameSugIdx=Math.min(_nameSugIdx+1,nameSug.querySelectorAll(".od-sug-item").length-1);
        updateSugHighlight(nameSug,_nameSugIdx);
      } else if(ev.key==="ArrowUp"){
        if(!open) return;
        ev.preventDefault();
        _nameSugIdx=Math.max(_nameSugIdx-1,-1);
        updateSugHighlight(nameSug,_nameSugIdx);
      } else if(ev.key==="Enter"){
        ev.preventDefault();
        if(open&&_nameSugIdx>=0){
          var hi=nameSug.querySelectorAll(".od-sug-item")[_nameSugIdx];
          if(hi){ hi.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); _nameSugIdx=-1; }
        } else {
          quickSubmit(nameEl,qtyEl,supEl,addBtn);
        }
      } else if(ev.key==="Escape"){
        hideSug(nameSug); _nameSugIdx=-1;
      }
    });

    // ── Supplier autocomplete
    supEl.addEventListener("input",function(){
      clearTimeout(_qaSupSugTimer);
      _supSugIdx=-1;
      var typed=(supEl.value||"").trim().toLowerCase();
      _qaSupSugTimer=setTimeout(function(){fetchSupplierSuggestions(typed,supSug,supEl);},200);
    });
    supEl.addEventListener("blur",function(){setTimeout(function(){hideSug(supSug);_supSugIdx=-1;},180);});

    // ── Supplier keyboard navigation
    supEl.addEventListener("keydown",function(ev){
      var open=supSug.style.display!=="none"&&supSug.querySelectorAll(".od-sug-item").length>0;
      if(ev.key==="ArrowDown"){
        if(!open) return;
        ev.preventDefault();
        _supSugIdx=Math.min(_supSugIdx+1,supSug.querySelectorAll(".od-sug-item").length-1);
        updateSugHighlight(supSug,_supSugIdx);
      } else if(ev.key==="ArrowUp"){
        if(!open) return;
        ev.preventDefault();
        _supSugIdx=Math.max(_supSugIdx-1,-1);
        updateSugHighlight(supSug,_supSugIdx);
      } else if(ev.key==="Enter"){
        ev.preventDefault();
        if(open&&_supSugIdx>=0){
          var hi=supSug.querySelectorAll(".od-sug-item")[_supSugIdx];
          if(hi){ hi.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); _supSugIdx=-1; }
        } else {
          quickSubmit(nameEl,qtyEl,supEl,addBtn);
        }
      } else if(ev.key==="Escape"){
        hideSug(supSug); _supSugIdx=-1;
      }
    });

    // ── Scroll wheel on qty
    qtyEl.addEventListener("wheel",function(ev){
      ev.preventDefault();
      var v=parseInt(qtyEl.value||1,10)||1;
      qtyEl.value=Math.max(1,v+(ev.deltaY<0?1:-1));
    },{passive:false});

    // ── Enter on qty submits
    qtyEl.addEventListener("keydown",function(ev){
      if(ev.key==="Enter"){ev.preventDefault();quickSubmit(nameEl,qtyEl,supEl,addBtn);}
    });
    addBtn.addEventListener("click",function(){quickSubmit(nameEl,qtyEl,supEl,addBtn);});
  }

  function hideSug(el) { if(el){el.style.display="none";el.innerHTML="";} }

  function updateSugHighlight(sugEl, idx) {
    var items=sugEl.querySelectorAll(".od-sug-item");
    items.forEach(function(el,i){ el.classList.toggle("hov",i===idx); });
    if(idx>=0&&items[idx]) items[idx].scrollIntoView({block:"nearest"});
  }

  function buildSugHtml(items, onSelect) {
    // items: [{name, meta, metaHtml, section, cost}]
    var html="", curSection="";
    items.forEach(function(item,idx){
      if(item.section&&item.section!==curSection){
        curSection=item.section;
        html+="<div class='od-sug-section'>"+esc(curSection)+"</div>";
      }
      var metaPart=item.metaHtml||
        (item.meta?"<span class='od-sug-meta"+(item.cost?" od-sug-cost":"")+"'>"+esc(item.meta)+"</span>":"");
      html+="<div class='od-sug-item' data-idx='"+idx+"'>"+
        "<span class='od-sug-name'>"+esc(item.name)+"</span>"+
        metaPart+
      "</div>";
    });
    return html;
  }

  function fetchMergedSuggestions(typed, sugEl, supEl) {
    // Fetch history items and merge with quotation description matches
    Promise.all([
      apiItems(typed).catch(function(){return {items:[]};}),
      Promise.resolve(_quotations) // use cached; prefetch handles loading
    ]).then(function(results) {
      var historyItems=(results[0]&&results[0].items)||[];
      var quotations=results[1]||[];

      var merged=[];

      // Section 1: history
      if(historyItems.length){
        historyItems.forEach(function(h){
          merged.push({
            section:"Your History",
            name: h.item_name,
            meta: (h.preferred_supplier?"📦 "+h.preferred_supplier+" · ":"")+"×"+h.use_count,
            fillName: h.item_name,
            fillSupplier: h.preferred_supplier||""
          });
        });
      }

      // Section 2: quotation descriptions
      var qtMatches=findQuotationMatches(typed, quotations, 6);
      // Deduplicate against history names
      var historyNames=Object.create(null);
      historyItems.forEach(function(h){historyNames[norm(h.item_name)]=1;});

      qtMatches.forEach(function(row){
        var d=String(row.item_description||"").trim();
        if(!d) return;
        // If same as something in history (by description similarity) skip
        if(historyNames[norm(d)]) return;

        var margin=Number(row.profit_margin||0);
        var qtyFree=Number(row.qty_free||0);
        var discPct=Number(row.discount_pct||0);
        var costExcl=row.cost_excl_vat?Number(row.cost_excl_vat):null;
        var costIncl=row.cost_incl_vat?Number(row.cost_incl_vat):null;

        // Build rich meta HTML
        var parts=[];
        if(row.supplier) parts.push("<span style='color:rgba(233,238,247,.55)'>"+esc(row.supplier)+"</span>");
        if(costExcl!=null) parts.push("<span style='color:#43d17a'>€"+costExcl.toFixed(2)+"</span>");
        if(margin>0) parts.push("<span style='color:"+profitColor(margin)+";font-weight:800'>"+Math.round(margin)+"%</span>");
        if(qtyFree>0) parts.push("<span style='color:#5aa2ff'>+"+qtyFree+" free</span>");
        if(discPct>0) parts.push("<span style='color:#ffaf32'>"+Math.round(discPct)+"% disc</span>");
        var metaHtml=parts.length?
          "<span class='od-sug-meta' style='display:flex;gap:5px;align-items:center;'>"+parts.join(" ")+"</span>":"";

        merged.push({
          section:"From Quotations",
          name: d,
          metaHtml: metaHtml,
          fillName: d,
          fillSupplier: row.supplier||""
        });
      });

      if(!merged.length){hideSug(sugEl);return;}

      var html=buildSugHtml(merged);
      sugEl.innerHTML=html;
      sugEl.style.display="";

      sugEl.querySelectorAll(".od-sug-item").forEach(function(el){
        el.addEventListener("mousedown",function(ev){
          ev.preventDefault();
          var idx=parseInt(el.getAttribute("data-idx"),10);
          var item=merged[idx];
          var nameEl=document.getElementById("od-qa-name");
          if(nameEl) nameEl.value=item.fillName;
          if(item.fillSupplier&&supEl&&!supEl.value) supEl.value=item.fillSupplier;
          hideSug(sugEl);
          // Update qty hint from quotation
          var qtyEl=document.getElementById("od-qa-qty");
          if(qtyEl&&parseInt(qtyEl.value,10)<1) qtyEl.value=1;
          if(nameEl) nameEl.focus();
        });
      });
    }).catch(function(){hideSug(sugEl);});
  }

  function fetchSupplierSuggestions(typed, supSug, supEl) {
    var seen=Object.create(null), all=[];
    state.entries.forEach(function(e){ if(e.supplier&&!seen[e.supplier]){seen[e.supplier]=1;all.push(e.supplier);} });
    var filtered=typed?all.filter(function(s){return s.toLowerCase().indexOf(typed)>=0;}):all;
    if(!filtered.length){hideSug(supSug);return;}
    var html="";
    filtered.forEach(function(s){
      html+="<div class='od-sug-item' data-sup='"+esc(s)+"'><span class='od-sug-name'>"+esc(s)+"</span></div>";
    });
    supSug.innerHTML=html;
    supSug.style.display="";
    supSug.querySelectorAll(".od-sug-item").forEach(function(el){
      el.addEventListener("mousedown",function(ev){
        ev.preventDefault();
        supEl.value=el.getAttribute("data-sup")||"";
        hideSug(supSug);
      });
    });
  }

  async function quickSubmit(nameEl, qtyEl, supEl, addBtn) {
    var itemName=(nameEl.value||"").trim();
    if(!itemName) { nameEl.focus(); return; }
    var qty=Math.max(1,parseInt(qtyEl.value||1,10)||1);
    var supplier=(supEl.value||"").trim();

    addBtn.disabled=true;
    try {
      var res=await apiCreate({order_date:state.date, item_name:itemName, qty:qty, supplier:supplier, notes:""});
      state.entries.push({
        id:res.id, order_date:state.date, item_name:itemName, qty:qty,
        supplier:supplier, notes:"", status:"pending", carried_from_id:null
      });
      // Clear name, reset qty, keep supplier, refocus name
      nameEl.value="";
      qtyEl.value="1";
      hideSug(document.getElementById("od-qa-name-sug"));
      renderMain();
      // Refocus the name input after re-render
      setTimeout(function(){
        var n=document.getElementById("od-qa-name");
        if(n) n.focus();
      },30);
    } catch(err) {
      toast("bad","Error",String(err&&err.message||err));
    } finally {
      addBtn.disabled=false;
    }
  }

  // ─── Set status ───────────────────────────────────────────────────────────
  function flashRow(id, flashClass) {
    setTimeout(function(){
      var m=getMountEl();
      var row=m&&m.querySelector("tr[data-entry-id='"+id+"']");
      if(row){ row.classList.add(flashClass); setTimeout(function(){row.classList.remove(flashClass);},900); }
    },10);
  }

  async function setStatus(id,status) {
    try {
      await apiUpdate(id,{status:status});
      var e=state.entries.find(function(e){return e.id===id;});
      if(e) e.status=status;
      renderMain();
      var fc=status==="received"?"od-flash-ok":status==="not_received"?"od-flash-bad":"od-flash-warn";
      flashRow(id,fc);
    } catch(err){ toast("bad","Error",String(err&&err.message||err)); }
  }

  // ─── Copy for email ───────────────────────────────────────────────────────
  function copySupplierGroup(supplier, items) {
    var location=(state.user&&(state.user.location_name||state.user.org_name))||"";
    var suppLabel=supplier||"Unassigned Supplier";
    var dateStr=fmtDateShort(state.date);

    var lines=[];
    if(location) lines.push("From: "+location);
    lines.push("Order for "+suppLabel+" — "+dateStr+":");
    lines.push("");
    items.forEach(function(item){
      lines.push("• "+item.item_name+" × "+item.qty+(item.notes?" ("+item.notes+")":""));
    });
    var text=lines.join("\n");

    var p=navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject();
    p.then(function(){ toast("good","Copied","Order for "+suppLabel+" copied to clipboard."); })
     .catch(function(){
       var ta=document.createElement("textarea");
       ta.value=text; ta.style.cssText="position:fixed;opacity:0;top:0;left:0;";
       document.body.appendChild(ta); ta.select();
       try{ document.execCommand("copy"); toast("good","Copied","Order copied."); }
       catch(e){ toast("bad","Copy failed","Copy manually."); }
       document.body.removeChild(ta);
     });
  }

  // ─── Carry Over ───────────────────────────────────────────────────────────
  function doCarryOver() {
    var outstanding=state.entries.filter(function(e){
      return e.status==="pending"||e.status==="not_received"||e.status==="wrong_pick";
    });
    var toDate=addDays(state.date,1);
    E.modal.show("Carry Over Outstanding Items",
      "<p style='margin:0 0 8px;font-size:14px;'>Carry <strong>"+outstanding.length+" outstanding item"+
        (outstanding.length===1?"":"s")+"</strong> to <strong>"+esc(fmtDateShort(toDate))+"</strong>?</p>"+
      "<p style='margin:0;font-size:12px;opacity:.55;'>Duplicates are skipped automatically.</p>",
      [{label:"Carry Over",primary:true,onClick:async function(){
        E.modal.hide();
        try{
          var res=await apiCarryOver(state.date,toDate);
          toast("good","Carried",res.carried+" item"+(res.carried===1?"":"s")+" → "+fmtDateShort(toDate));
          state.date=toDate; state.filterSupplier=null;
          await loadEntries();
        }catch(err){toast("bad","Error",String(err&&err.message||err));}
      }},{label:"Cancel",onClick:function(){E.modal.hide();}}]
    );
  }

  // ─── Print ────────────────────────────────────────────────────────────────
  function openPrintWindow() {
    var sg=buildSupplierGroups(state.entries);
    var stats=computeStats(state.entries);
    var location=(state.user&&(state.user.location_name||state.user.org_name))||"";
    var dateStr=fmtDateLong(state.date);

    var sections="";
    sg.order.forEach(function(key){
      var items=sg.groups[key];
      var disp=key==="__none__"?"Unassigned":key;
      sections+="<div class='section'>"+
        "<h2>"+esc(disp)+" <span class='count'>("+items.length+" item"+(items.length===1?"":"s")+")</span></h2>"+
        "<table><thead><tr><th>Item</th><th style='text-align:center'>Qty</th><th>Notes</th><th>Status</th></tr></thead><tbody>";
      items.forEach(function(e){
        var st={received:"✓ Received",not_received:"✗ Not Received",wrong_pick:"⚠ Wrong Pick",pending:"Pending"}[e.status]||"Pending";
        sections+="<tr class='s-"+esc(e.status)+"'>"+
          "<td>"+esc(e.item_name)+(e.carried_from_id?" <em class='carried'>(carried)</em>":"")+
            (e.notes?"<br><small>"+esc(e.notes)+"</small>":"")+"</td>"+
          "<td style='text-align:center;font-weight:700;'>"+esc(e.qty)+"</td>"+
          "<td></td>"+
          "<td><span class='badge s-"+esc(e.status)+"'>"+esc(st)+"</span></td>"+
        "</tr>";
      });
      sections+="</tbody></table></div>";
    });

    var html="<!DOCTYPE html><html><head><meta charset='utf-8'>"+
      "<title>Order Diary – "+esc(fmtDateShort(state.date))+"</title>"+
      "<style>"+
      "*{box-sizing:border-box;margin:0;padding:0;}"+
      "body{font-family:system-ui,Arial,sans-serif;color:#111;background:#fff;padding:20px 24px;font-size:13px;}"+
      "h1{font-size:18px;font-weight:900;margin-bottom:2px;}"+
      ".meta{font-size:12px;color:#555;margin-bottom:8px;}"+
      ".stats{display:flex;gap:16px;font-size:12px;color:#555;padding:8px 0;border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin-bottom:18px;}"+
      ".stats strong{font-size:15px;color:#111;}"+
      ".section{margin-bottom:20px;page-break-inside:avoid;}"+
      "h2{font-size:13px;font-weight:800;border-bottom:2px solid #222;padding-bottom:4px;margin-bottom:7px;}"+
      ".count{font-weight:400;font-size:11px;color:#555;}"+
      "table{width:100%;border-collapse:collapse;}"+
      "th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#777;border-bottom:1px solid #ddd;padding:3px 6px;}"+
      "td{padding:5px 6px;border-bottom:1px solid #eee;vertical-align:middle;}"+
      "tr:last-child td{border-bottom:none;}"+
      ".badge{border-radius:3px;padding:1px 6px;font-size:10px;font-weight:700;}"+
      ".badge.s-received{background:#d1fae5;color:#065f46;}"+
      ".badge.s-not_received{background:#fee2e2;color:#991b1b;}"+
      ".badge.s-wrong_pick{background:#fef3c7;color:#92400e;}"+
      ".badge.s-pending{background:#f3f4f6;color:#6b7280;}"+
      ".carried{font-size:10px;color:#999;}"+
      "small{color:#777;}"+
      ".no-print{position:fixed;top:12px;right:12px;}"+
      "@media print{.no-print{display:none;}}"+
      "</style></head><body>"+
      "<button class='no-print' onclick='window.print()' style='padding:7px 14px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;'>🖨 Print</button>"+
      "<h1>📦 Order Diary</h1>"+
      "<div class='meta'>"+esc(dateStr)+(location?" &nbsp;·&nbsp; "+esc(location):"")+"</div>"+
      "<div class='stats'>"+
        "<div><strong>"+stats.total+"</strong> Total</div>"+
        "<div><strong>"+stats.received+"</strong> Received</div>"+
        "<div><strong>"+stats.pending+"</strong> Pending</div>"+
        "<div><strong>"+stats.not_received+"</strong> Not Received</div>"+
        (stats.wrong_pick?"<div><strong>"+stats.wrong_pick+"</strong> Wrong Pick</div>":"")+
      "</div>"+sections+"</body></html>";

    var win=window.open("","_blank","width=860,height=700");
    if(!win){toast("bad","Blocked","Allow pop-ups to print.");return;}
    win.document.write(html);
    win.document.close();
    setTimeout(function(){try{win.print();}catch(e){}},400);
  }

  // ─── Edit modal ───────────────────────────────────────────────────────────
  var _editSugTimer=null, _editQtTimer=null;

  function openEditModal(entry) {
    // Prefetch quotations if not done
    if(!_quotations&&!_quotationsLoading) prefetchQuotations();

    var formHtml=
      "<div style='min-width:min(460px,90vw);'>"+
      "<div class='od-field' style='position:relative;'>"+
        "<label class='od-label'>Item Name *</label>"+
        "<input id='od-e-name' class='od-input' value='"+esc(entry.item_name)+"' autocomplete='off'>"+
        "<div id='od-e-name-sug' class='od-sug-list' style='display:none;position:absolute;'></div>"+
      "</div>"+
      "<div class='od-row2'>"+
        "<div class='od-field'>"+
          "<label class='od-label'>Quantity</label>"+
          "<input id='od-e-qty' class='od-input' type='number' min='1' value='"+esc(entry.qty)+"'>"+
        "</div>"+
        "<div class='od-field' style='position:relative;'>"+
          "<label class='od-label'>Supplier</label>"+
          "<input id='od-e-sup' class='od-input' value='"+esc(entry.supplier)+"' autocomplete='off'>"+
          "<div id='od-e-sup-sug' class='od-sug-list' style='display:none;position:absolute;'></div>"+
        "</div>"+
      "</div>"+
      "<div class='od-field'>"+
        "<label class='od-label'>Notes</label>"+
        "<input id='od-e-notes' class='od-input' value='"+esc(entry.notes)+"' placeholder='Optional'>"+
      "</div>"+
      "<div class='od-qt-wrap'>"+
        "<div class='od-qt-label'>💡 Quotation Hints</div>"+
        "<div id='od-e-qt-body' class='od-qt-none'>Type an item name to see related quotations.</div>"+
      "</div>"+
      "</div>";

    E.modal.show("Edit Item",formHtml,[
      {label:"Save Changes",primary:true,onClick:async function(){
        var n=(document.getElementById("od-e-name")&&document.getElementById("od-e-name").value||"").trim();
        var q=Math.max(1,parseInt((document.getElementById("od-e-qty")&&document.getElementById("od-e-qty").value)||1,10)||1);
        var s=(document.getElementById("od-e-sup")&&document.getElementById("od-e-sup").value||"").trim();
        var nt=(document.getElementById("od-e-notes")&&document.getElementById("od-e-notes").value||"").trim();
        if(!n){toast("bad","Required","Item name required.");return;}
        try{
          await apiUpdate(entry.id,{item_name:n,qty:q,supplier:s,notes:nt});
          var idx=state.entries.findIndex(function(e){return e.id===entry.id;});
          if(idx>=0) Object.assign(state.entries[idx],{item_name:n,qty:q,supplier:s,notes:nt});
          E.modal.hide(); renderMain(); toast("good","Saved","Item updated.");
        }catch(err){toast("bad","Error",String(err&&err.message||err));}
      }},
      {label:"Cancel",onClick:function(){E.modal.hide();}}
    ]);

    setTimeout(function(){
      var nameEl=document.getElementById("od-e-name");
      var nameSug=document.getElementById("od-e-name-sug");
      var supEl=document.getElementById("od-e-sup");
      var supSug=document.getElementById("od-e-sup-sug");
      var qtBody=document.getElementById("od-e-qt-body");
      if(!nameEl) return;

      nameEl.addEventListener("input",function(){
        var typed=(nameEl.value||"").trim();
        clearTimeout(_editSugTimer);
        _editSugTimer=setTimeout(function(){fetchMergedSuggestions(typed,nameSug,supEl);},220);
        clearTimeout(_editQtTimer);
        _editQtTimer=setTimeout(function(){updateQtHints(typed,qtBody,supEl);},350);
      });
      nameEl.addEventListener("blur",function(){setTimeout(function(){hideSug(nameSug);},180);});
      supEl.addEventListener("input",function(){
        clearTimeout(_editSugTimer);
        _editSugTimer=setTimeout(function(){fetchSupplierSuggestions((supEl.value||"").trim().toLowerCase(),supSug,supEl);},200);
      });
      supEl.addEventListener("blur",function(){setTimeout(function(){hideSug(supSug);},180);});

      // Trigger hints immediately for existing value
      if(nameEl.value.trim().length>=2) updateQtHints(nameEl.value.trim(),qtBody,supEl);
      nameEl.focus();
    },60);
  }

  function updateQtHints(typed, qtBody, supEl) {
    if(!qtBody) return;
    if(!typed||typed.length<2){
      qtBody.innerHTML="<div class='od-qt-none'>Type an item name to see related quotations.</div>";
      return;
    }
    var quotations=_quotations||[];
    if(!quotations.length&&!_quotationsLoading){
      prefetchQuotations();
      qtBody.innerHTML="<div class='od-qt-none'>Loading quotations…</div>";
      return;
    }
    var matches=findQuotationMatches(typed,quotations,5);
    if(!matches.length){
      qtBody.innerHTML="<div class='od-qt-none'>No similar quotations found.</div>";
      return;
    }
    var html="<table class='od-qt-table'><thead><tr>"+
      "<th>Description</th><th>Supplier</th><th style='text-align:right'>Cost Excl.</th>"+
      "<th style='text-align:right'>Margin</th><th>Extras</th><th>Date</th>"+
    "</tr></thead><tbody>";
    matches.forEach(function(row){
      var margin=Number(row.profit_margin||0);
      var qtyFree=Number(row.qty_free||0);
      var discPct=Number(row.discount_pct||0);
      var marginCell=margin>0
        ? "<td style='text-align:right;font-weight:800;color:"+profitColor(margin)+"'>"+Math.round(margin)+"%</td>"
        : "<td style='text-align:right;color:rgba(233,238,247,.25)'>—</td>";
      var extras=[];
      if(qtyFree>0) extras.push("<span style='color:#5aa2ff;font-size:10px'>+"+qtyFree+" free</span>");
      if(discPct>0) extras.push("<span style='color:#ffaf32;font-size:10px'>"+Math.round(discPct)+"% disc</span>");
      html+="<tr data-s='"+esc(row.supplier||"")+"'>"+
        "<td>"+esc(row.item_description||"")+"</td>"+
        "<td>"+esc(row.supplier||"—")+"</td>"+
        "<td style='text-align:right'>€"+esc(Number(row.cost_excl_vat||0).toFixed(2))+"</td>"+
        marginCell+
        "<td>"+(extras.join(" ")||"—")+"</td>"+
        "<td>"+esc(fmtDateShort(row.quote_date||""))+"</td>"+
      "</tr>";
    });
    html+="</tbody></table>";
    qtBody.innerHTML=html;
    qtBody.querySelectorAll("tr[data-s]").forEach(function(tr){
      tr.addEventListener("click",function(){
        var s=tr.getAttribute("data-s");
        if(s&&supEl&&!supEl.value) supEl.value=s;
      });
    });
  }

  // ─── Wrong Pick modal ─────────────────────────────────────────────────────
  function openWrongPickModal(entry) {
    var today=todayYmd();
    var formHtml=
      "<div style='min-width:min(440px,90vw);'>"+
      "<div class='od-wp-info'>⚠ <strong>Wrong Pick</strong> — The supplier delivered the wrong product. "+
        "This logs a return entry and marks the item as Wrong Pick so you can continue the order.</div>"+
      "<div class='od-field'><label class='od-label'>Description *</label>"+
        "<input id='od-wp-desc' class='od-input' value='"+esc(entry.item_name)+"'></div>"+
      "<div class='od-row2'>"+
        "<div class='od-field'><label class='od-label'>Quantity</label>"+
          "<input id='od-wp-qty' class='od-input' value='"+esc(entry.qty)+"'></div>"+
        "<div class='od-field'><label class='od-label'>Supplier</label>"+
          "<input id='od-wp-sup' class='od-input' value='"+esc(entry.supplier)+"'></div>"+
      "</div>"+
      "<div class='od-row2'>"+
        "<div class='od-field'><label class='od-label'>Batch (if known)</label>"+
          "<input id='od-wp-batch' class='od-input' placeholder='Optional'></div>"+
        "<div class='od-field'><label class='od-label'>Invoice No.</label>"+
          "<input id='od-wp-inv' class='od-input' placeholder='Optional'></div>"+
      "</div>"+
      "<div class='od-field'><label class='od-label'>Remarks</label>"+
        "<input id='od-wp-rem' class='od-input' value='Wrong pick received — ordered "+esc(fmtDateShort(entry.order_date||state.date))+"'></div>"+
      "</div>";

    E.modal.show("Wrong Pick — Log Return",formHtml,[
      {label:"Log Return & Mark Item",primary:true,onClick:async function(){
        var desc=((document.getElementById("od-wp-desc")||{}).value||"").trim();
        var qty=((document.getElementById("od-wp-qty")||{}).value||"").trim();
        var sup=((document.getElementById("od-wp-sup")||{}).value||"").trim();
        var batch=((document.getElementById("od-wp-batch")||{}).value||"").trim();
        var inv=((document.getElementById("od-wp-inv")||{}).value||"").trim();
        var rem=((document.getElementById("od-wp-rem")||{}).value||"").trim();
        if(!desc){toast("bad","Required","Description is required.");return;}
        try{
          await E.apiFetch("/returns/entries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
            entry_date:today, description:desc, quantity:String(qty),
            supplier:sup, batch:batch, invoice_number:inv, remarks:rem,
            return_arranged:0, handed_over:0, collection_note_received:0, credit_note_received:0
          })});
          await apiUpdate(entry.id,{status:"wrong_pick"});
          var idx=state.entries.findIndex(function(e){return e.id===entry.id;});
          if(idx>=0) state.entries[idx].status="wrong_pick";
          E.modal.hide(); renderMain();
          flashRow(entry.id,"od-flash-warn");
          toast("good","Return Logged","Wrong pick recorded. Item marked ⚠.");
        }catch(err){toast("bad","Error",String(err&&err.message||err));}
      }},
      {label:"Cancel",onClick:function(){E.modal.hide();}}
    ]);
    setTimeout(function(){
      var d=document.getElementById("od-wp-desc");
      if(d) d.focus();
    },60);
  }

  // ─── Module entry point ───────────────────────────────────────────────────
  function render(ctx) {
    ensureStyles();
    _quotations=null; _quotationsLoading=false; // reset cache on mount

    // Store user for location name in copy/print
    state.user=(ctx&&ctx.user)||null;

    var container=(ctx&&ctx.mount)||(ctx&&ctx.el)||(ctx&&ctx.container)
      ||document.getElementById("eikon-module-view");
    if(!container){warn("No mount element");return;}

    container.innerHTML="<div id='od-mount'></div>";
    state._mount=container.querySelector("#od-mount");
    state.date=todayYmd();
    state.filterSupplier=null;

    // Prefetch quotations immediately in background
    prefetchQuotations();

    loadEntries();
  }

  // ─── Register ─────────────────────────────────────────────────────────────
  E.registerModule({
    id:    "order-diary",
    title: "Order Diary",
    order: 208,
    icon:  "📦",
    render: render
  });

})();
