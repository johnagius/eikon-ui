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
  function log()  { try { console.log.apply(console,  [LP].concat([].slice.call(arguments))); } catch(e){} }
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

  // ─── Similarity (trigram + Jaccard + Levenshtein) — same as quotations ────
  var SIMILARITY_THRESHOLD = 0.60;

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
    var na=norm(a),nb=norm(b);
    if (na===nb) return 1.0;
    if (!na||!nb) return 0;
    var trig=trigramSimilarity(na,nb), jac=jaccardSimilarity(na,nb), edit=0;
    if (Math.max(na.length,nb.length)<=60) {
      var maxLen=Math.max(na.length,nb.length);
      edit=maxLen>0?1-levenshtein(na,nb)/maxLen:1;
    }
    return Math.max(trig,jac,edit);
  }
  function findSimilarInQuotations(typed, quotations) {
    if (!typed||typed.length<2||!quotations||!quotations.length) return [];
    var seen=Object.create(null), results=[];
    quotations.forEach(function(row) {
      var d=String(row.item_description||"").trim();
      if (!d||seen[d]) return;
      seen[d]=1;
      var sim=descSimilarity(typed,d);
      if (sim>=SIMILARITY_THRESHOLD) results.push({row:row, sim:sim});
    });
    results.sort(function(a,b){return b.sim-a.sim;});
    return results.slice(0,6).map(function(r){return r.row;});
  }

  // ─── State ────────────────────────────────────────────────────────────────
  var state = {
    date:       todayYmd(),
    entries:    [],
    quotations: null,       // fetched once per modal open
    loading:    false,
    _mount:     null
  };

  // ─── API wrappers ─────────────────────────────────────────────────────────
  function apiList(date)        { return E.apiFetch("/order-diary/entries?date="+encodeURIComponent(date), {method:"GET"}); }
  function apiCreate(p)         { return E.apiFetch("/order-diary/entries", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}); }
  function apiUpdate(id,p)      { return E.apiFetch("/order-diary/entries/"+id, {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}); }
  function apiDelete(id)        { return E.apiFetch("/order-diary/entries/"+id, {method:"DELETE"}); }
  function apiItems(q)          { return E.apiFetch("/order-diary/items?q="+encodeURIComponent(q||""), {method:"GET"}); }
  function apiCarryOver(fd,td)  { return E.apiFetch("/order-diary/carry-over", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from_date:fd,to_date:td})}); }
  function apiQuotations()      { return E.apiFetch("/quotations/entries", {method:"GET"}); }

  // ─── Styles ───────────────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById("od-styles")) return;
    var st = document.createElement("style");
    st.id = "od-styles";
    st.textContent =
      // Layout
      ".od-wrap{max-width:960px;margin:0 auto;padding:16px 12px 32px;}" +
      ".od-head{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:18px;}" +
      ".od-title{font-size:22px;font-weight:900;color:#e9eef7;letter-spacing:-.3px;flex:0 0 auto;}" +
      ".od-title span{color:#5aa2ff;}" +
      ".od-head-spacer{flex:1;}" +
      ".od-nav{display:flex;align-items:center;gap:6px;}" +
      ".od-date-label{font-size:13px;font-weight:700;color:#e9eef7;min-width:220px;text-align:center;}" +
      ".od-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 13px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#e9eef7;font-size:12px;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap;}" +
      ".od-btn:hover{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22);}" +
      ".od-btn.primary{background:rgba(58,160,255,.18);border-color:rgba(58,160,255,.45);color:#5aa2ff;}" +
      ".od-btn.primary:hover{background:rgba(58,160,255,.28);}" +
      ".od-btn.ok{background:rgba(67,209,122,.12);border-color:rgba(67,209,122,.35);color:#43d17a;}" +
      ".od-btn.ok:hover{background:rgba(67,209,122,.22);}" +
      ".od-btn.danger{background:rgba(255,90,122,.10);border-color:rgba(255,90,122,.30);color:#ff5a7a;}" +
      ".od-btn.danger:hover{background:rgba(255,90,122,.20);}" +
      ".od-btn.warn{background:rgba(255,175,50,.10);border-color:rgba(255,175,50,.30);color:#ffaf32;}" +
      ".od-btn.warn:hover{background:rgba(255,175,50,.20);}" +
      ".od-btn.sm{padding:4px 9px;font-size:11px;border-radius:6px;}" +
      ".od-btn:disabled{opacity:.4;cursor:not-allowed;}" +

      // Stat bar
      ".od-stat-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}" +
      ".od-stat{display:flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-size:12px;color:rgba(233,238,247,.7);}" +
      ".od-stat strong{font-size:16px;font-weight:900;color:#e9eef7;}" +
      ".od-stat.ok strong{color:#43d17a;}" +
      ".od-stat.danger strong{color:#ff5a7a;}" +
      ".od-stat.warn strong{color:#ffaf32;}" +
      ".od-stat.accent strong{color:#5aa2ff;}" +

      // Empty state
      ".od-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px 24px;text-align:center;gap:12px;}" +
      ".od-empty-icon{font-size:48px;opacity:.35;}" +
      ".od-empty-title{font-size:17px;font-weight:800;color:rgba(233,238,247,.6);}" +
      ".od-empty-sub{font-size:13px;color:rgba(233,238,247,.4);}" +

      // Supplier cards
      ".od-cards{display:flex;flex-direction:column;gap:14px;}" +
      ".od-card{background:rgba(15,22,34,.85);border:1px solid rgba(255,255,255,.08);border-left:3px solid #5aa2ff;border-radius:14px;overflow:hidden;}" +
      ".od-card-head{display:flex;align-items:center;gap:10px;padding:12px 16px 10px;background:rgba(0,0,0,.18);border-bottom:1px solid rgba(255,255,255,.06);}" +
      ".od-card-supplier{font-size:14px;font-weight:900;color:#e9eef7;flex:1;}" +
      ".od-card-supplier.unassigned{color:rgba(233,238,247,.45);font-style:italic;}" +
      ".od-card-count{font-size:11px;color:rgba(233,238,247,.4);}" +
      ".od-card-body{padding:2px 0 8px;}" +

      // Item rows
      ".od-item{display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.04);transition:background .12s;}" +
      ".od-item:last-child{border-bottom:none;}" +
      ".od-item:hover{background:rgba(255,255,255,.025);}" +
      ".od-item-main{flex:1;min-width:0;}" +
      ".od-item-name{font-size:13px;font-weight:700;color:#e9eef7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".od-item-meta{font-size:11px;color:rgba(233,238,247,.45);margin-top:1px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}" +
      ".od-carried-badge{display:inline-flex;align-items:center;gap:3px;font-size:10px;background:rgba(255,175,50,.12);border:1px solid rgba(255,175,50,.28);color:#ffaf32;border-radius:4px;padding:1px 5px;}" +
      ".od-qty-badge{font-size:13px;font-weight:900;color:#5aa2ff;white-space:nowrap;min-width:36px;text-align:right;}" +

      // Status pill
      ".od-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;}" +
      ".od-pill.pending{background:rgba(233,238,247,.07);color:rgba(233,238,247,.5);border:1px solid rgba(255,255,255,.10);}" +
      ".od-pill.received{background:rgba(67,209,122,.12);color:#43d17a;border:1px solid rgba(67,209,122,.30);}" +
      ".od-pill.not_received{background:rgba(255,90,122,.10);color:#ff5a7a;border:1px solid rgba(255,90,122,.25);}" +
      ".od-pill.wrong_pick{background:rgba(255,175,50,.10);color:#ffaf32;border:1px solid rgba(255,175,50,.25);}" +

      // Item actions
      ".od-item-actions{display:flex;gap:4px;flex-wrap:wrap;}" +

      // Card footer
      ".od-card-footer{display:flex;gap:8px;padding:10px 16px 12px;align-items:center;border-top:1px solid rgba(255,255,255,.05);}" +

      // Actions bar (floating)
      ".od-actions-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;}" +

      // Autocomplete
      ".od-sug-wrap{position:relative;}" +
      ".od-sug-list{position:absolute;left:0;right:0;top:calc(100% + 4px);background:rgba(10,15,24,.97);border:1px solid rgba(58,160,255,.35);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.55);z-index:9999;overflow:hidden;max-height:220px;overflow-y:auto;}" +
      ".od-sug-item{padding:8px 12px;cursor:pointer;display:flex;align-items:baseline;gap:8px;border-bottom:1px solid rgba(255,255,255,.05);transition:background .1s;}" +
      ".od-sug-item:last-child{border-bottom:none;}" +
      ".od-sug-item:hover,.od-sug-item.active{background:rgba(58,160,255,.14);}" +
      ".od-sug-name{font-size:13px;font-weight:700;color:#e9eef7;flex:1;}" +
      ".od-sug-meta{font-size:11px;color:rgba(233,238,247,.45);white-space:nowrap;}" +

      // Quotation hints
      ".od-qt-section{margin-top:14px;}" +
      ".od-qt-label{font-size:11px;font-weight:800;color:#5aa2ff;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;}" +
      ".od-qt-table{width:100%;border-collapse:collapse;font-size:11px;}" +
      ".od-qt-table th{text-align:left;color:rgba(233,238,247,.45);font-weight:700;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.08);font-size:10px;text-transform:uppercase;letter-spacing:.4px;}" +
      ".od-qt-table td{padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.04);color:#e9eef7;}" +
      ".od-qt-table tr:last-child td{border-bottom:none;}" +
      ".od-qt-table tr{cursor:pointer;transition:background .1s;}" +
      ".od-qt-table tr:hover{background:rgba(58,160,255,.08);}" +
      ".od-qt-none{font-size:11px;color:rgba(233,238,247,.35);padding:6px 0;}" +

      // Modal form
      ".od-field{margin-bottom:14px;}" +
      ".od-label{display:block;font-size:12px;font-weight:700;color:rgba(233,238,247,.6);margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;}" +
      ".od-input{width:100%;background:rgba(10,16,24,.7);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e9eef7;padding:9px 12px;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;transition:border-color .15s,box-shadow .15s;}" +
      ".od-input:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.12);}" +
      ".od-input.sm{padding:6px 10px;font-size:12px;}" +
      ".od-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}" +
      "@media(max-width:500px){.od-row2{grid-template-columns:1fr;}}" +

      // Wrong pick modal
      ".od-wp-info{background:rgba(255,175,50,.06);border:1px solid rgba(255,175,50,.22);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:rgba(233,238,247,.75);line-height:1.5;}" +

      // Loading
      ".od-loading{display:flex;align-items:center;justify-content:center;padding:60px 24px;gap:10px;color:rgba(233,238,247,.45);font-size:13px;}" +

      // Print (media query — clean white print)
      "@media print{" +
        "body{background:#fff!important;color:#111!important;}" +
        ".od-print-only{display:block!important;}" +
        ".od-no-print{display:none!important;}" +
      "}" +
      ".od-print-only{display:none;}";

    document.head.appendChild(st);
  }

  // ─── Toast ────────────────────────────────────────────────────────────────
  function ensureToastStyles() {
    if (document.getElementById("od-toast-style")) return;
    var st = document.createElement("style");
    st.id = "od-toast-style";
    st.textContent =
      ".od-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:8px;max-width:min(440px,calc(100vw - 28px));pointer-events:none;}" +
      ".od-toast{border:1px solid rgba(255,255,255,.12);background:rgba(12,16,24,.95);backdrop-filter:blur(12px);border-radius:12px;padding:10px 14px;box-shadow:0 8px 24px rgba(0,0,0,.4);}" +
      ".od-toast .t-t{font-weight:800;font-size:13px;margin:0 0 2px;}" +
      ".od-toast .t-m{margin:0;font-size:12px;opacity:.85;}" +
      ".od-toast.good{border-color:rgba(67,209,122,.4);}" +
      ".od-toast.bad{border-color:rgba(255,90,122,.4);}" +
      ".od-toast.info{border-color:rgba(58,160,255,.4);}";
    document.head.appendChild(st);
  }
  function toast(kind, title, msg) {
    ensureToastStyles();
    var wrap = document.getElementById("od-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "od-toast-wrap";
      wrap.className = "od-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "od-toast " + (kind||"");
    t.innerHTML = "<p class='t-t'>" + esc(title||"") + "</p>" + (msg ? "<p class='t-m'>"+esc(msg)+"</p>" : "");
    wrap.appendChild(t);
    setTimeout(function(){
      try { wrap.removeChild(t); } catch(e){}
      if (!wrap.childNodes.length) try { wrap.parentNode.removeChild(wrap); } catch(e2){}
    }, 3200);
  }

  // ─── Loading / Render plumbing ────────────────────────────────────────────
  function getMountEl() {
    return state._mount || document.getElementById("od-mount");
  }

  function setMountHtml(html) {
    var el = getMountEl();
    if (el) el.innerHTML = html;
  }

  async function loadEntries() {
    state.loading = true;
    setMountHtml("<div class='od-loading'>⏳ Loading entries…</div>");
    try {
      var res = await apiList(state.date);
      state.entries = (res && res.entries) || [];
    } catch(e) {
      warn("loadEntries failed", e);
      state.entries = [];
      toast("bad", "Failed to load", String(e && e.message || e));
    }
    state.loading = false;
    renderMain();
  }

  // ─── Stats computation ────────────────────────────────────────────────────
  function computeStats(entries) {
    var total=entries.length, received=0, not_received=0, wrong_pick=0, pending=0;
    entries.forEach(function(e) {
      if (e.status==="received")     received++;
      else if (e.status==="not_received") not_received++;
      else if (e.status==="wrong_pick")   wrong_pick++;
      else pending++;
    });
    return {total:total, received:received, not_received:not_received, wrong_pick:wrong_pick, pending:pending};
  }

  // ─── Build supplier groups ────────────────────────────────────────────────
  function buildSupplierGroups(entries) {
    var groups = Object.create(null), order = [];
    entries.forEach(function(e) {
      var key = (e.supplier||"").trim() || "__none__";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(e);
    });
    return { groups:groups, order:order };
  }

  // ─── Status pill HTML ─────────────────────────────────────────────────────
  function pillHtml(status) {
    var map = {
      pending:       { icon:"⏳", label:"Pending" },
      received:      { icon:"✓",  label:"Received" },
      not_received:  { icon:"✗",  label:"Not Received" },
      wrong_pick:    { icon:"⚠",  label:"Wrong Pick" }
    };
    var info = map[status] || map.pending;
    return "<span class='od-pill "+esc(status)+"'>"+info.icon+" "+info.label+"</span>";
  }

  // ─── Main render ─────────────────────────────────────────────────────────
  function renderMain() {
    var entries = state.entries;
    var stats = computeStats(entries);
    var sg = buildSupplierGroups(entries);
    var outstanding = stats.pending + stats.not_received + stats.wrong_pick;
    var nextDate = addDays(state.date, 1);
    var isToday = state.date === todayYmd();

    var html = "<div class='od-wrap'>";

    // ── Header
    html += "<div class='od-head'>" +
      "<div class='od-title'>📦 Order <span>Diary</span></div>" +
      "<div class='od-head-spacer'></div>" +
      "<div class='od-nav'>" +
        "<button class='od-btn sm' data-nav='-1'>◀</button>" +
        "<div class='od-date-label'>" + esc(fmtDateLong(state.date)) + "</div>" +
        "<button class='od-btn sm' data-nav='1'>▶</button>" +
        "<button class='od-btn sm primary' data-nav='0'>Today</button>" +
      "</div>" +
    "</div>";

    // ── Stat bar
    html += "<div class='od-stat-bar'>" +
      "<div class='od-stat accent'><strong>" + stats.total + "</strong> Total Items</div>" +
      "<div class='od-stat ok'><strong>" + stats.received + "</strong> Received</div>" +
      "<div class='od-stat warn'><strong>" + stats.pending + "</strong> Pending</div>" +
      "<div class='od-stat danger'><strong>" + stats.not_received + "</strong> Not Received</div>" +
      (stats.wrong_pick > 0 ? "<div class='od-stat warn'><strong>" + stats.wrong_pick + "</strong> Wrong Pick</div>" : "") +
    "</div>";

    // ── Action bar
    html += "<div class='od-actions-bar'>" +
      "<button class='od-btn primary' id='od-add-btn'>＋ Add Item</button>" +
      "<button class='od-btn' id='od-print-btn'>🖨 Print</button>" +
      (outstanding > 0 ? "<button class='od-btn warn' id='od-carry-btn'>↩ Carry Over " + outstanding + " Outstanding</button>" : "") +
    "</div>";

    // ── Cards or empty
    if (!entries.length) {
      html += "<div class='od-empty'>" +
        "<div class='od-empty-icon'>📦</div>" +
        "<div class='od-empty-title'>No items for " + esc(fmtDateShort(state.date)) + "</div>" +
        "<div class='od-empty-sub'>Click <strong>Add Item</strong> to start building today's order.</div>" +
      "</div>";
    } else {
      html += "<div class='od-cards'>";
      sg.order.forEach(function(key) {
        var items = sg.groups[key];
        var displaySupplier = key === "__none__" ? "" : key;
        html += renderSupplierCard(displaySupplier, items);
      });
      html += "</div>";
    }

    html += "</div>";

    setMountHtml(html);
    wireMainEvents();
  }

  // ─── Supplier card ────────────────────────────────────────────────────────
  function renderSupplierCard(supplier, items) {
    var isUnassigned = !supplier;
    var cardColor = isUnassigned ? "rgba(255,255,255,.08)" : "#5aa2ff";
    var html = "<div class='od-card' style='border-left-color:" + cardColor + ";'>";

    html += "<div class='od-card-head'>" +
      "<div class='od-card-supplier" + (isUnassigned ? " unassigned" : "") + "'>" +
        (isUnassigned ? "⬜ Unassigned" : "🏭 " + esc(supplier)) +
      "</div>" +
      "<div class='od-card-count'>" + items.length + " item" + (items.length===1?"":"s") + "</div>" +
    "</div>";

    html += "<div class='od-card-body'>";
    items.forEach(function(entry) {
      html += renderItemRow(entry);
    });
    html += "</div>";

    html += "<div class='od-card-footer'>" +
      "<button class='od-btn sm' data-copy-supplier='" + esc(JSON.stringify(supplier)) + "' " +
        "data-copy-items='" + esc(JSON.stringify(items.map(function(e){return{name:e.item_name,qty:e.qty};}))) + "'>📋 Copy for Email</button>" +
    "</div>";

    html += "</div>";
    return html;
  }

  function renderItemRow(entry) {
    var noteDot = entry.notes ? " <span title='" + esc(entry.notes) + "' style='color:#5aa2ff;cursor:default;'>•</span>" : "";
    var carriedBadge = entry.carried_from_id ? "<span class='od-carried-badge'>↩ Carried</span>" : "";

    var html = "<div class='od-item' data-id='" + entry.id + "'>" +
      "<div class='od-item-main'>" +
        "<div class='od-item-name'>" + esc(entry.item_name) + noteDot + "</div>" +
        "<div class='od-item-meta'>" +
          pillHtml(entry.status) +
          (carriedBadge) +
        "</div>" +
      "</div>" +
      "<div class='od-qty-badge'>×" + esc(entry.qty) + "</div>" +
      "<div class='od-item-actions'>";

    if (entry.status !== "received") {
      html += "<button class='od-btn sm ok' data-status-id='" + entry.id + "' data-status='received' title='Mark as Received'>✓</button>";
    }
    if (entry.status !== "not_received") {
      html += "<button class='od-btn sm danger' data-status-id='" + entry.id + "' data-status='not_received' title='Not Received'>✗</button>";
    }
    html += "<button class='od-btn sm warn' data-wrongpick-id='" + entry.id + "' title='Wrong Pick'>⚠</button>";
    html += "<button class='od-btn sm' data-edit-id='" + entry.id + "' title='Edit'>✏</button>";
    html += "<button class='od-btn sm danger' data-del-id='" + entry.id + "' title='Delete'>🗑</button>";

    html += "</div></div>";
    return html;
  }

  // ─── Wire main events ─────────────────────────────────────────────────────
  function wireMainEvents() {
    var mount = getMountEl();
    if (!mount) return;

    // Date navigation
    mount.querySelectorAll("[data-nav]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var v = parseInt(btn.getAttribute("data-nav"), 10);
        if (v === 0) state.date = todayYmd();
        else state.date = addDays(state.date, v);
        loadEntries();
      });
    });

    // Add item
    var addBtn = mount.querySelector("#od-add-btn");
    if (addBtn) addBtn.addEventListener("click", function() { openItemModal(null); });

    // Print
    var printBtn = mount.querySelector("#od-print-btn");
    if (printBtn) printBtn.addEventListener("click", openPrintWindow);

    // Carry over
    var carryBtn = mount.querySelector("#od-carry-btn");
    if (carryBtn) carryBtn.addEventListener("click", doCarryOver);

    // Status buttons
    mount.querySelectorAll("[data-status-id]").forEach(function(btn) {
      btn.addEventListener("click", function(ev) {
        ev.stopPropagation();
        var id = parseInt(btn.getAttribute("data-status-id"), 10);
        var status = btn.getAttribute("data-status");
        setStatus(id, status);
      });
    });

    // Wrong pick
    mount.querySelectorAll("[data-wrongpick-id]").forEach(function(btn) {
      btn.addEventListener("click", function(ev) {
        ev.stopPropagation();
        var id = parseInt(btn.getAttribute("data-wrongpick-id"), 10);
        var entry = state.entries.find(function(e){return e.id===id;});
        if (entry) openWrongPickModal(entry);
      });
    });

    // Edit
    mount.querySelectorAll("[data-edit-id]").forEach(function(btn) {
      btn.addEventListener("click", function(ev) {
        ev.stopPropagation();
        var id = parseInt(btn.getAttribute("data-edit-id"), 10);
        var entry = state.entries.find(function(e){return e.id===id;});
        if (entry) openItemModal(entry);
      });
    });

    // Delete
    mount.querySelectorAll("[data-del-id]").forEach(function(btn) {
      btn.addEventListener("click", function(ev) {
        ev.stopPropagation();
        var id = parseInt(btn.getAttribute("data-del-id"), 10);
        var entry = state.entries.find(function(e){return e.id===id;});
        if (!entry) return;
        E.modal.show("Delete Item",
          "<p style='margin:0 0 4px;font-size:14px;'>Remove <strong>" + esc(entry.item_name) + "</strong> from today's order?</p>" +
          "<p style='margin:0;font-size:12px;opacity:.6;'>This cannot be undone.</p>",
          [
            { label:"Delete", primary:true, onClick: async function() {
                E.modal.hide();
                try {
                  await apiDelete(id);
                  state.entries = state.entries.filter(function(e){return e.id!==id;});
                  renderMain();
                  toast("good","Deleted","Item removed from order.");
                } catch(err) { toast("bad","Error",String(err&&err.message||err)); }
              }
            },
            { label:"Cancel", onClick: function(){ E.modal.hide(); } }
          ]
        );
      });
    });

    // Copy for email
    mount.querySelectorAll("[data-copy-supplier]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var supplier = JSON.parse(btn.getAttribute("data-copy-supplier") || '""');
        var items    = JSON.parse(btn.getAttribute("data-copy-items") || "[]");
        copySupplierGroup(supplier, items);
      });
    });
  }

  // ─── Set status ───────────────────────────────────────────────────────────
  async function setStatus(id, status) {
    try {
      await apiUpdate(id, { status: status });
      var entry = state.entries.find(function(e){return e.id===id;});
      if (entry) entry.status = status;
      renderMain();
    } catch(e) {
      toast("bad","Error",String(e&&e.message||e));
    }
  }

  // ─── Copy for email ───────────────────────────────────────────────────────
  function copySupplierGroup(supplier, items) {
    var label = supplier || "Unassigned";
    var lines = ["Order for " + label + " — " + fmtDateShort(state.date) + ":"];
    items.forEach(function(item) {
      lines.push("• " + item.name + " × " + item.qty);
    });
    var text = lines.join("\n");
    try {
      navigator.clipboard.writeText(text).then(function() {
        toast("good","Copied", "Order for " + label + " copied to clipboard.");
      }).catch(function() { fallbackCopy(text, label); });
    } catch(e) { fallbackCopy(text, label); }
  }
  function fallbackCopy(text, label) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("good","Copied","Order for " + (label||"supplier") + " copied to clipboard.");
    } catch(e) {
      toast("bad","Copy failed","Please copy manually.");
    }
    document.body.removeChild(ta);
  }

  // ─── Carry Over ───────────────────────────────────────────────────────────
  function doCarryOver() {
    var fromDate = state.date;
    var toDate = addDays(fromDate, 1);
    var outstanding = state.entries.filter(function(e){
      return e.status === "pending" || e.status === "not_received" || e.status === "wrong_pick";
    });
    E.modal.show("Carry Over Outstanding Items",
      "<p style='margin:0 0 8px;font-size:14px;'>Carry <strong>" + outstanding.length + " outstanding item" +
        (outstanding.length===1?"":"s") + "</strong> to <strong>" + esc(fmtDateShort(toDate)) + "</strong>?</p>" +
      "<p style='margin:0;font-size:12px;opacity:.65;'>This creates new pending entries for tomorrow's order. Duplicates are skipped automatically.</p>",
      [
        { label:"Carry Over", primary:true, onClick: async function() {
            E.modal.hide();
            try {
              var res = await apiCarryOver(fromDate, toDate);
              toast("good","Carried Over",
                res.carried + " item" + (res.carried===1?"":"s") + " added to " + fmtDateShort(toDate));
              state.date = toDate;
              await loadEntries();
            } catch(err) { toast("bad","Error",String(err&&err.message||err)); }
          }
        },
        { label:"Cancel", onClick: function(){ E.modal.hide(); } }
      ]
    );
  }

  // ─── Add / Edit Item Modal ─────────────────────────────────────────────────
  var _sugTimer = null;
  var _qtTimer  = null;
  var _cachedQuotations = null;

  function openItemModal(entry) {
    var isEdit = !!entry;
    var modalTitle = isEdit ? "Edit Order Item" : "Add Order Item";

    // Prefetch quotations in background
    if (!_cachedQuotations) {
      apiQuotations().then(function(r) {
        _cachedQuotations = (r && r.entries) || [];
      }).catch(function(){});
    }

    var formHtml =
      "<div style='min-width:min(480px,90vw);'>" +

      "<div class='od-field od-sug-wrap'>" +
        "<label class='od-label'>Item Name *</label>" +
        "<input id='od-f-name' class='od-input' placeholder='e.g. Panadol 500mg' autocomplete='off' " +
          "value='" + esc(isEdit ? entry.item_name : "") + "'>" +
        "<div id='od-f-name-sug' class='od-sug-list' style='display:none;'></div>" +
      "</div>" +

      "<div class='od-row2'>" +
        "<div class='od-field'>" +
          "<label class='od-label'>Quantity</label>" +
          "<input id='od-f-qty' class='od-input' type='number' min='1' value='" + esc(isEdit ? entry.qty : 1) + "'>" +
        "</div>" +
        "<div class='od-field od-sug-wrap'>" +
          "<label class='od-label'>Supplier</label>" +
          "<input id='od-f-supplier' class='od-input' placeholder='e.g. Alliance Healthcare' autocomplete='off' " +
            "value='" + esc(isEdit ? entry.supplier : "") + "'>" +
          "<div id='od-f-supplier-sug' class='od-sug-list' style='display:none;'></div>" +
        "</div>" +
      "</div>" +

      "<div class='od-field'>" +
        "<label class='od-label'>Notes (optional)</label>" +
        "<input id='od-f-notes' class='od-input' placeholder='Any additional notes…' " +
          "value='" + esc(isEdit ? entry.notes : "") + "'>" +
      "</div>" +

      "<div id='od-qt-section' class='od-qt-section'>" +
        "<div class='od-qt-label'>💡 Quotation Hints</div>" +
        "<div id='od-qt-body' class='od-qt-none'>Start typing an item name to see related quotations.</div>" +
      "</div>" +

      "</div>";

    E.modal.show(modalTitle, formHtml, [
      {
        label: isEdit ? "Save Changes" : "Add Item",
        primary: true,
        onClick: async function() {
          var nameEl     = document.getElementById("od-f-name");
          var qtyEl      = document.getElementById("od-f-qty");
          var supplierEl = document.getElementById("od-f-supplier");
          var notesEl    = document.getElementById("od-f-notes");
          if (!nameEl) return;

          var itemName = (nameEl.value||"").trim();
          var qty      = Math.max(1, parseInt(qtyEl&&qtyEl.value||1, 10)||1);
          var supplier = (supplierEl&&supplierEl.value||"").trim();
          var notes    = (notesEl&&notesEl.value||"").trim();

          if (!itemName) { nameEl.focus(); toast("bad","Required","Item name is required."); return; }

          try {
            if (isEdit) {
              await apiUpdate(entry.id, { item_name:itemName, qty:qty, supplier:supplier, notes:notes });
              var idx = state.entries.findIndex(function(e){return e.id===entry.id;});
              if (idx>=0) Object.assign(state.entries[idx], {item_name:itemName, qty:qty, supplier:supplier, notes:notes});
              toast("good","Saved","Item updated.");
            } else {
              var res = await apiCreate({ order_date:state.date, item_name:itemName, qty:qty, supplier:supplier, notes:notes });
              state.entries.push({
                id:res.id, order_date:state.date, item_name:itemName, qty:qty,
                supplier:supplier, notes:notes, status:"pending", carried_from_id:null
              });
              toast("good","Added", itemName + " added to order.");
            }
            E.modal.hide();
            renderMain();
          } catch(err) {
            toast("bad","Error",String(err&&err.message||err));
          }
        }
      },
      { label:"Cancel", onClick: function(){ E.modal.hide(); } }
    ]);

    // Wire autocomplete after modal DOM inserted
    setTimeout(function() { wireModalAutocomplete(isEdit); }, 60);
  }

  function wireModalAutocomplete(isEdit) {
    var nameEl     = document.getElementById("od-f-name");
    var supplierEl = document.getElementById("od-f-supplier");
    var nameSug    = document.getElementById("od-f-name-sug");
    var supSug     = document.getElementById("od-f-supplier-sug");
    var qtBody     = document.getElementById("od-qt-body");
    if (!nameEl || !supplierEl) return;

    // Close dropdowns on outside click
    document.addEventListener("click", function onDocClick(ev) {
      if (!nameEl.contains(ev.target) && nameSug && !nameSug.contains(ev.target)) {
        if (nameSug) nameSug.style.display = "none";
      }
      if (!supplierEl.contains(ev.target) && supSug && !supSug.contains(ev.target)) {
        if (supSug) supSug.style.display = "none";
      }
    }, { once:false, capture:false });

    // Item name autocomplete
    nameEl.addEventListener("input", function() {
      var typed = (nameEl.value||"").trim();
      clearTimeout(_sugTimer);
      _sugTimer = setTimeout(function() { fetchItemSuggestions(typed, nameSug, supplierEl); }, 250);

      // Quotation hints
      clearTimeout(_qtTimer);
      _qtTimer = setTimeout(function() { updateQtHints(typed, qtBody); }, 350);
    });

    // Supplier autocomplete
    supplierEl.addEventListener("input", function() {
      var typed = (supplierEl.value||"").trim().toLowerCase();
      clearTimeout(_sugTimer);
      _sugTimer = setTimeout(function() { showSupplierSuggestions(typed, supSug); }, 200);
    });

    // If editing, trigger hint update immediately
    if (isEdit && nameEl.value) {
      updateQtHints(nameEl.value, qtBody);
    }
  }

  function fetchItemSuggestions(typed, sugEl, supplierEl) {
    if (!typed || typed.length < 2) { if (sugEl) sugEl.style.display = "none"; return; }
    apiItems(typed).then(function(res) {
      var items = (res && res.items) || [];
      if (!items.length) { sugEl.style.display = "none"; return; }
      var html = "";
      items.forEach(function(item) {
        html += "<div class='od-sug-item' data-name='" + esc(item.item_name) + "' data-supplier='" + esc(item.preferred_supplier||"") + "'>" +
          "<span class='od-sug-name'>" + esc(item.item_name) + "</span>" +
          "<span class='od-sug-meta'>" +
            (item.preferred_supplier ? "📦 "+esc(item.preferred_supplier)+" · " : "") +
            "×"+item.use_count +
          "</span>" +
        "</div>";
      });
      sugEl.innerHTML = html;
      sugEl.style.display = "";
      sugEl.querySelectorAll(".od-sug-item").forEach(function(el) {
        el.addEventListener("mousedown", function(ev) {
          ev.preventDefault();
          var nameInput = document.getElementById("od-f-name");
          if (nameInput) nameInput.value = el.getAttribute("data-name");
          var sup = el.getAttribute("data-supplier") || "";
          if (sup && supplierEl) supplierEl.value = sup;
          sugEl.style.display = "none";
          updateQtHints(el.getAttribute("data-name"), document.getElementById("od-qt-body"));
        });
      });
    }).catch(function(){});
  }

  function showSupplierSuggestions(typed, supSug) {
    if (!supSug) return;
    // Collect all unique suppliers from current entries
    var seen = Object.create(null), all = [];
    state.entries.forEach(function(e) { if (e.supplier) seen[e.supplier.toLowerCase()] = e.supplier; });
    Object.keys(seen).forEach(function(k) { all.push(seen[k]); });
    var filtered = typed ? all.filter(function(s){return s.toLowerCase().includes(typed);}) : all;
    if (!filtered.length) { supSug.style.display = "none"; return; }
    var html = "";
    filtered.forEach(function(s) {
      html += "<div class='od-sug-item' data-val='" + esc(s) + "'><span class='od-sug-name'>" + esc(s) + "</span></div>";
    });
    supSug.innerHTML = html;
    supSug.style.display = "";
    supSug.querySelectorAll(".od-sug-item").forEach(function(el) {
      el.addEventListener("mousedown", function(ev) {
        ev.preventDefault();
        var supInput = document.getElementById("od-f-supplier");
        if (supInput) supInput.value = el.getAttribute("data-val") || "";
        supSug.style.display = "none";
      });
    });
  }

  function updateQtHints(typed, qtBody) {
    if (!qtBody) return;
    if (!typed || typed.length < 2) {
      qtBody.innerHTML = "<div class='od-qt-none'>Start typing an item name to see related quotations.</div>";
      return;
    }
    var quotations = _cachedQuotations || [];
    if (!quotations.length) {
      qtBody.innerHTML = "<div class='od-qt-none'>Loading quotations…</div>";
      apiQuotations().then(function(r) {
        _cachedQuotations = (r && r.entries) || [];
        updateQtHints(typed, document.getElementById("od-qt-body"));
      }).catch(function(){});
      return;
    }
    var matches = findSimilarInQuotations(typed, quotations);
    if (!matches.length) {
      qtBody.innerHTML = "<div class='od-qt-none'>No similar quotations found.</div>";
      return;
    }
    var html = "<table class='od-qt-table'><thead><tr>" +
      "<th>Description</th><th>Supplier</th><th style='text-align:right;'>Cost Excl.</th><th>Date</th>" +
    "</tr></thead><tbody>";
    matches.forEach(function(row) {
      html += "<tr data-supplier='" + esc(row.supplier||"") + "'>" +
        "<td>" + esc(row.item_description||"") + "</td>" +
        "<td>" + esc(row.supplier||"—") + "</td>" +
        "<td style='text-align:right;'>€" + esc(Number(row.cost_excl_vat||0).toFixed(2)) + "</td>" +
        "<td>" + esc(fmtDateShort(row.quote_date||"")) + "</td>" +
      "</tr>";
    });
    html += "</tbody></table>";
    qtBody.innerHTML = html;

    // Clicking a quotation row prefills the supplier
    qtBody.querySelectorAll("tr[data-supplier]").forEach(function(tr) {
      tr.addEventListener("click", function() {
        var sup = tr.getAttribute("data-supplier");
        var supInput = document.getElementById("od-f-supplier");
        if (sup && supInput) supInput.value = sup;
      });
    });
  }

  // ─── Wrong Pick Modal ─────────────────────────────────────────────────────
  function openWrongPickModal(entry) {
    var today = todayYmd();
    var formHtml =
      "<div style='min-width:min(460px,90vw);'>" +
      "<div class='od-wp-info'>⚠ <strong>Wrong Pick</strong> — The supplier provided the wrong product. " +
        "This will mark the order item and pre-fill a return entry in the Returns module.</div>" +

      "<div class='od-field'>" +
        "<label class='od-label'>Description *</label>" +
        "<input id='od-wp-desc' class='od-input' value='" + esc(entry.item_name) + "'>" +
      "</div>" +

      "<div class='od-row2'>" +
        "<div class='od-field'>" +
          "<label class='od-label'>Quantity</label>" +
          "<input id='od-wp-qty' class='od-input sm' value='" + esc(entry.qty) + "'>" +
        "</div>" +
        "<div class='od-field'>" +
          "<label class='od-label'>Supplier</label>" +
          "<input id='od-wp-supplier' class='od-input sm' value='" + esc(entry.supplier) + "'>" +
        "</div>" +
      "</div>" +

      "<div class='od-row2'>" +
        "<div class='od-field'>" +
          "<label class='od-label'>Batch (if known)</label>" +
          "<input id='od-wp-batch' class='od-input sm' placeholder='Optional'>" +
        "</div>" +
        "<div class='od-field'>" +
          "<label class='od-label'>Invoice No.</label>" +
          "<input id='od-wp-invoice' class='od-input sm' placeholder='Optional'>" +
        "</div>" +
      "</div>" +

      "<div class='od-field'>" +
        "<label class='od-label'>Remarks</label>" +
        "<input id='od-wp-remarks' class='od-input' placeholder='e.g. Wrong strength delivered' " +
          "value='Wrong pick received — ordered on " + esc(fmtDateShort(entry.order_date||state.date)) + "'>" +
      "</div>" +

      "</div>";

    E.modal.show("Wrong Pick — Log Return", formHtml, [
      {
        label: "Log Return & Mark Item",
        primary: true,
        onClick: async function() {
          var desc     = (document.getElementById("od-wp-desc")    && document.getElementById("od-wp-desc").value    || "").trim();
          var qty      = (document.getElementById("od-wp-qty")     && document.getElementById("od-wp-qty").value     || "").trim();
          var supplier = (document.getElementById("od-wp-supplier") && document.getElementById("od-wp-supplier").value || "").trim();
          var batch    = (document.getElementById("od-wp-batch")   && document.getElementById("od-wp-batch").value   || "").trim();
          var invoice  = (document.getElementById("od-wp-invoice") && document.getElementById("od-wp-invoice").value || "").trim();
          var remarks  = (document.getElementById("od-wp-remarks") && document.getElementById("od-wp-remarks").value || "").trim();

          if (!desc) { toast("bad","Required","Description is required."); return; }

          try {
            // 1. Create return entry
            await E.apiFetch("/returns/entries", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entry_date:      today,
                description:     desc,
                quantity:        String(qty),
                supplier:        supplier,
                batch:           batch,
                invoice_number:  invoice,
                remarks:         remarks,
                return_arranged: 0, handed_over: 0,
                collection_note_received: 0, credit_note_received: 0
              })
            });

            // 2. Mark order item as wrong_pick
            await apiUpdate(entry.id, { status: "wrong_pick" });
            var idx = state.entries.findIndex(function(e){return e.id===entry.id;});
            if (idx >= 0) state.entries[idx].status = "wrong_pick";

            E.modal.hide();
            renderMain();
            toast("good","Return Logged",
              "Wrong pick recorded in Returns module. Item marked as ⚠ Wrong Pick.");
          } catch(err) {
            toast("bad","Error",String(err && err.message || err));
          }
        }
      },
      { label:"Cancel", onClick: function(){ E.modal.hide(); } }
    ]);
  }

  // ─── Print ────────────────────────────────────────────────────────────────
  function openPrintWindow() {
    var entries = state.entries;
    var sg = buildSupplierGroups(entries);
    var stats = computeStats(entries);
    var dateStr = fmtDateLong(state.date);

    var html = "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
      "<title>Order Diary – " + esc(fmtDateShort(state.date)) + "</title>" +
      "<style>" +
        "* { box-sizing: border-box; margin: 0; padding: 0; }" +
        "body { font-family: system-ui, Arial, sans-serif; color: #111; background: #fff; padding: 24px; font-size: 13px; }" +
        "h1 { font-size: 20px; font-weight: 900; margin-bottom: 4px; }" +
        ".date { font-size: 13px; color: #555; margin-bottom: 14px; }" +
        ".stats { display: flex; gap: 18px; margin-bottom: 20px; font-size: 12px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 12px; }" +
        ".stats strong { font-size: 16px; color: #111; }" +
        ".supplier-section { margin-bottom: 22px; page-break-inside: avoid; }" +
        ".supplier-title { font-size: 14px; font-weight: 800; padding: 6px 0; border-bottom: 2px solid #222; margin-bottom: 8px; }" +
        "table { width: 100%; border-collapse: collapse; }" +
        "th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #777; border-bottom: 1px solid #ddd; padding: 4px 6px; }" +
        "td { padding: 6px 6px; border-bottom: 1px solid #eee; vertical-align: middle; }" +
        "tr:last-child td { border-bottom: none; }" +
        ".status-received { color: #1a7a3a; font-weight: 700; }" +
        ".status-not_received { color: #c00; font-weight: 700; }" +
        ".status-wrong_pick { color: #b06000; font-weight: 700; }" +
        ".status-pending { color: #888; }" +
        ".carried { font-size: 10px; background: #fff3cd; color: #805500; padding: 1px 5px; border-radius: 4px; margin-left: 4px; }" +
        "@media print { .no-print { display: none; } }" +
      "</style></head><body>" +

      "<button class='no-print' onclick='window.print()' style='position:fixed;top:12px;right:12px;padding:8px 16px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;'>🖨 Print</button>" +

      "<h1>📦 Order Diary</h1>" +
      "<div class='date'>" + esc(dateStr) + "</div>" +
      "<div class='stats'>" +
        "<div><strong>" + stats.total + "</strong> Total</div>" +
        "<div><strong>" + stats.received + "</strong> Received</div>" +
        "<div><strong>" + stats.pending + "</strong> Pending</div>" +
        "<div><strong>" + stats.not_received + "</strong> Not Received</div>" +
        (stats.wrong_pick ? "<div><strong>" + stats.wrong_pick + "</strong> Wrong Pick</div>" : "") +
      "</div>";

    sg.order.forEach(function(key) {
      var items = sg.groups[key];
      var displaySupplier = key === "__none__" ? "Unassigned" : key;
      html += "<div class='supplier-section'>" +
        "<div class='supplier-title'>" + esc(displaySupplier) + " <span style='font-weight:400;font-size:12px;color:#555;'>(" + items.length + " item" + (items.length===1?"":"s") + ")</span></div>" +
        "<table><thead><tr><th>Item</th><th>Qty</th><th>Notes</th><th>Status</th></tr></thead><tbody>";

      items.forEach(function(e) {
        var statusText = {received:"✓ Received", not_received:"✗ Not Received", wrong_pick:"⚠ Wrong Pick", pending:"Pending"}[e.status] || "Pending";
        html += "<tr>" +
          "<td>" + esc(e.item_name) + (e.carried_from_id ? "<span class='carried'>↩ Carried</span>" : "") + "</td>" +
          "<td>" + esc(e.qty) + "</td>" +
          "<td style='color:#666;'>" + esc(e.notes||"") + "</td>" +
          "<td class='status-" + esc(e.status) + "'>" + esc(statusText) + "</td>" +
        "</tr>";
      });

      html += "</tbody></table></div>";
    });

    html += "</body></html>";

    var win = window.open("", "_blank", "width=860,height=700");
    if (!win) { toast("bad","Blocked","Allow pop-ups to print."); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(function(){ try { win.print(); } catch(e){} }, 400);
  }

  // ─── Module entry point ───────────────────────────────────────────────────
  function render(ctx) {
    ensureStyles();
    _cachedQuotations = null; // reset on module mount

    var container = ctx && ctx.el ? ctx.el : document.getElementById("eikon-module-view");
    if (!container) { warn("No mount element"); return; }

    container.innerHTML = "<div id='od-mount'></div>";
    state._mount = container.querySelector("#od-mount");

    // Reset date to today when switching to this module
    state.date = todayYmd();
    loadEntries();
  }

  // ─── Register ─────────────────────────────────────────────────────────────
  E.registerModule({
    id:     "order-diary",
    title:  "Order Diary",
    order:  208,
    icon:   "📦",
    render: render
  });

})();
