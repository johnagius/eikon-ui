
/* ui/modules.otcmindmap.js
   Eikon – OTC Mindmap (GitHub split-data edition)

   Keeps the module code small and loads product graph data from static JSON files.
   Recommended hosting:
   - Keep this JS file in your repo
   - Keep the productmap-data folder in the same repo/site
   - Serve both from the same origin for best speed and no CORS hassle
*/
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  var DATA_BASE = (window.EIKON_PRODUCTMAP_BASE || "").replace(/\/$/, "");
  function asset(path) { return (DATA_BASE ? DATA_BASE + "/" : "") + path.replace(/^\//, ""); }

  var LINK_TYPES = {
    symptom:   { label: "Symptoms",  color: "#ffcc66", icon: "🩺", dash: false },
    similar:   { label: "Similar",   color: "#4ea1ff", icon: "🔗", dash: [6, 4] },
    complement:{ label: "Complements", color: "#2ee59d", icon: "➕", dash: false },
    usecase:   { label: "Use cases", color: "#b98eff", icon: "🧩", dash: [8, 3] },
    bundle:    { label: "Bundles",   color: "#24d7d7", icon: "📦", dash: [5, 3] },
    guardrail: { label: "Guardrails",color: "#ff6b9d", icon: "⚠️", dash: [4, 4] }
  };

  var NODE_COLORS = {
    product: { fill: "#0f3329", stroke: "#2ee59d", text: "#a0f0cc" },
    symptom: { fill: "#3a2e10", stroke: "#ffcc66", text: "#ffe6a0" },
    usecase: { fill: "#2a1a3a", stroke: "#b98eff", text: "#d9c4ff" },
    bundle:  { fill: "#0a3240", stroke: "#24d7d7", text: "#baf3ff" }
  };

  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return; stylesDone = true;
    var s = document.createElement("style"); s.id = "eikon-otcmindmap-style-gh";
    s.textContent = [
      ".om{--ac:#4ea1ff;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.04);--pnl2:rgba(255,255,255,.06);--bd:rgba(255,255,255,.10);--bd2:rgba(255,255,255,.16);--r:14px;--r2:10px;--txt:#e8eefc;--mut:rgba(170,183,214,.72);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--txt);margin:-14px;min-height:calc(100vh - 56px);background:radial-gradient(1200px 600px at 10% 8%,rgba(78,161,255,.10),transparent 60%),radial-gradient(900px 500px at 88% 15%,rgba(124,108,255,.07),transparent 55%)}",
      ".om *{box-sizing:border-box}",
      ".om .om-wrap{display:flex;height:calc(100vh - 56px);overflow:hidden}",
      ".om .om-main{flex:1;display:flex;flex-direction:column;min-width:0}",
      ".om .om-panel{width:300px;flex-shrink:0;border-left:1px solid var(--bd);background:rgba(11,18,32,.6);backdrop-filter:blur(10px);display:flex;flex-direction:column;overflow:hidden;transition:width .2s}",
      ".om .om-panel.collapsed{width:0;border-left:none;overflow:hidden}",
      ".om .om-topbar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--bd);background:rgba(11,18,32,.5);backdrop-filter:blur(6px);flex-shrink:0}",
      ".om .om-topbar h2{margin:0;font-size:16px;font-weight:900;letter-spacing:.3px;white-space:nowrap;display:flex;align-items:center;gap:8px}",
      ".om .om-search{flex:1;min-width:0;max-width:460px;position:relative}",
      ".om .om-search input{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.28);color:var(--txt);padding:9px 14px 9px 36px;border-radius:var(--r2);outline:none;font-size:13px}",
      ".om .om-search .search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--mut);font-size:14px;pointer-events:none}",
      ".om .om-search .om-dd{position:absolute;top:100%;left:0;right:0;margin-top:4px;background:linear-gradient(165deg,#1a2640,#141e30);border:1px solid var(--bd2);border-radius:var(--r2);max-height:280px;overflow-y:auto;box-shadow:0 12px 36px rgba(0,0,0,.5);z-index:100;display:none}",
      ".om .om-search .om-dd.open{display:block}",
      ".om .om-dd-item{padding:12px 14px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;transition:background .08s,border-color .08s}",
      ".om .om-dd-item:hover,.om .om-dd-item.hl{background:rgba(78,161,255,.30);border-left-color:#4ea1ff;color:#fff}",
      ".om .om-dd-item .dd-type{font-size:10px;padding:2px 7px;border-radius:6px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;flex-shrink:0}",
      ".om .om-dd-item .dd-type.product{background:rgba(46,229,157,.15);color:#6af0be}",
      ".om .om-dd-item .dd-type.symptom{background:rgba(255,204,102,.15);color:#ffcc66}",
      ".om .om-dd-item .dd-type.usecase{background:rgba(185,142,255,.15);color:#d9c4ff}",
      ".om .om-dd-item .dd-type.bundle{background:rgba(36,215,215,.15);color:#baf3ff}",
      ".om .om-topbar-actions{display:flex;gap:6px;flex-shrink:0;align-items:center}",
      ".om .om-btn{border:1px solid var(--bd);background:var(--pnl2);color:var(--txt);padding:7px 12px;border-radius:var(--r2);cursor:pointer;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}",
      ".om .om-btn:hover{background:rgba(255,255,255,.08);border-color:var(--bd2)}",
      ".om .om-btn.sm{padding:5px 8px;font-size:11px;border-radius:8px}",
      ".om .om-canvas-wrap{flex:1;position:relative;overflow:hidden;cursor:grab}",
      ".om .om-canvas-wrap:active{cursor:grabbing}",
      ".om .om-canvas-wrap canvas{display:block;width:100%;height:100%}",
      ".om .om-stats{display:flex;gap:14px;padding:6px 16px;border-top:1px solid var(--bd);font-size:11px;color:var(--mut);flex-shrink:0;align-items:center;background:rgba(11,18,32,.4)}",
      ".om .om-stats span{display:flex;align-items:center;gap:4px}",
      ".om .om-stats .dot{width:7px;height:7px;border-radius:999px;display:inline-block}",
      ".om .om-panel-hd{padding:12px 14px;border-bottom:1px solid var(--bd)}",
      ".om .om-panel-hd h3{margin:0;font-size:13px;font-weight:800;display:flex;align-items:center;gap:7px}",
      ".om .om-panel-actions{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bd);flex-wrap:wrap}",
      ".om .om-panel-body{overflow:auto;flex:1;padding:8px 10px 14px}",
      ".om .om-lg{border:1px solid var(--bd);border-radius:12px;background:var(--pnl);overflow:hidden;margin-bottom:10px}",
      ".om .om-lg-hd{display:flex;align-items:center;gap:8px;padding:9px 10px;cursor:pointer;background:rgba(255,255,255,.02)}",
      ".om .om-lg-hd .lg-arrow{font-size:10px;transition:transform .15s;color:var(--mut)}",
      ".om .om-lg-hd .lg-arrow.open{transform:rotate(90deg)}",
      ".om .om-lg-hd .lg-icon{width:18px;text-align:center}",
      ".om .om-lg-hd .lg-label{font-size:12px;font-weight:800;flex:1}",
      ".om .om-lg-hd .lg-count{font-size:11px;color:var(--mut);font-weight:800;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.05)}",
      ".om .om-lg-bd{display:none;padding:8px}",
      ".om .om-lg-bd.open{display:block}",
      ".om .om-li{display:flex;align-items:flex-start;gap:8px;padding:7px 6px;border-radius:8px}",
      ".om .om-li:hover{background:rgba(255,255,255,.04)}",
      ".om .om-li input{margin-top:2px}",
      ".om .om-li .li-label{flex:1;font-size:12px;line-height:1.3;cursor:pointer;color:#dbe7ff}",
      ".om .om-legend{position:absolute;left:14px;bottom:14px;display:flex;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--bd);border-radius:999px;background:rgba(11,18,32,.55);backdrop-filter:blur(10px);z-index:3}",
      ".om .om-legend span{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mut)}",
      ".om .om-legend .ld{width:9px;height:9px;border-radius:999px;display:inline-block}",
      ".om .om-zoom{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;gap:8px;z-index:3}",
      ".om .om-zoom button{width:34px;height:34px;border-radius:10px;border:1px solid var(--bd);background:rgba(11,18,32,.65);color:var(--txt);font-size:18px;cursor:pointer;backdrop-filter:blur(6px)}",
      ".om .om-tooltip{position:absolute;z-index:6;pointer-events:none;display:none;padding:10px 12px;border:1px solid var(--bd2);border-radius:12px;background:rgba(11,18,32,.9);backdrop-filter:blur(10px);min-width:220px;max-width:280px;box-shadow:0 12px 30px rgba(0,0,0,.45)}",
      ".om .om-tooltip.show{display:block}",
      ".om .om-tooltip .tt-name{font-size:13px;font-weight:800;margin-bottom:4px;line-height:1.3}",
      ".om .om-tooltip .tt-type{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.4px;padding:3px 6px;border-radius:6px;margin-right:6px;vertical-align:middle}",
      ".om .om-tooltip .tt-links{font-size:11px;color:var(--mut)}",
      ".om .om-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--mut);text-align:center;padding:30px}",
      ".om .om-empty .big-icon{font-size:44px;opacity:.85}",
      ".om .om-empty .msg{font-size:18px;font-weight:900;color:var(--txt)}",
      ".om .om-empty .sub{max-width:560px;font-size:13px;line-height:1.45}",
      /* --- new styles for controls, item lists --- */
      ".om .om-controls{padding:10px 12px;border-bottom:1px solid var(--bd);display:flex;flex-direction:column;gap:10px}",
      ".om .om-ctrl-row{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--mut)}",
      ".om .om-ctrl-row label{font-weight:700;min-width:50px;flex-shrink:0}",
      ".om .om-ctrl-row input[type=range]{flex:1;accent-color:var(--ac);height:4px;cursor:pointer}",
      ".om .om-ctrl-row input[type=number]{width:52px;border:1px solid var(--bd);background:rgba(0,0,0,.28);color:var(--txt);padding:4px 6px;border-radius:6px;font-size:11px;text-align:center}",
      ".om .om-ctrl-row .ctrl-val{min-width:30px;text-align:right;font-weight:800;color:var(--txt);font-size:11px}",
      ".om .om-ctrl-row input[type=checkbox]{accent-color:var(--ac);cursor:pointer}",
      ".om .om-item-list{border:1px solid var(--bd);border-radius:12px;background:var(--pnl);overflow:hidden;margin-bottom:10px}",
      ".om .om-item-list-hd{display:flex;align-items:center;gap:8px;padding:9px 10px;background:rgba(255,255,255,.02);font-size:12px;font-weight:800}",
      ".om .om-item-list-hd .il-icon{width:18px;text-align:center}",
      ".om .om-item-list-hd .il-count{font-size:11px;color:var(--mut);font-weight:800;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.05);margin-left:auto}",
      ".om .om-item-list-bd{max-height:160px;overflow-y:auto;padding:4px 8px 8px}",
      ".om .om-item-row{display:flex;align-items:center;gap:8px;padding:6px 6px;border-radius:8px;font-size:12px;cursor:pointer;transition:background .1s}",
      ".om .om-item-row:hover{background:rgba(255,255,255,.06)}",
      ".om .om-item-row .ir-score{font-size:10px;font-weight:800;padding:2px 6px;border-radius:6px;flex-shrink:0}",
      ".om .om-item-row .ir-label{flex:1;color:#dbe7ff;line-height:1.3}",
      ".om .om-item-row .ir-reason{font-size:10px;color:var(--mut);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "@media (max-width: 980px){.om .om-panel{width:260px}.om .om-search{max-width:none}}"
    ].join("");
    document.head.appendChild(s);
  }

  var mount, cvs, ctx2d, W=0, H=0, dpr=1, panelEl, tooltipEl, searchInput, ddEl;
  var cam={x:0,y:0,zoom:1}, graph={nodes:[],links:[]}, nodeMap={}, rootNodeId=null;
  var panelCollapsed=false, hoveredNode=null, dragNode=null, panStart=null;
  var animId=0, ALPHA=0.15, settled=false, visibleEdges={}, groupOpen={};
  var manifest=null, searchIndex=null, cache=new Map();
  var currentData=null, scoreThreshold=50, itemLimit=20, itemLimitEnabled=true;

  function fetchJson(path) {
    return fetch(asset(path), { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error("Failed to load " + path + " (" + r.status + ")");
      return r.json();
    });
  }

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    return fetchJson("productmap-data/manifest.json").then(function (m) { manifest = m; return m; });
  }

  function loadSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    return fetchJson("productmap-data/search-index.json").then(function (idx) { searchIndex = idx; return idx; });
  }

  function loadNeighborhood(centerId) {
    var parts = String(centerId || "").split(":");
    var type = parts[0], refId = parts[1];
    var key = type + ":" + refId;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    var typePath = type === "product" ? "product" : (type === "symptom" ? "symptom" : (type === "usecase" ? "usecase" : "bundle"));
    return fetchJson("productmap-data/neighbours/" + typePath + "/" + refId + ".json").then(function (data) {
      cache.set(key, data); return data;
    });
  }

  function filterGraphData(data) {
    var filteredLinks = data.links.slice();

    // Filter by score threshold
    if (scoreThreshold > 0) {
      filteredLinks = filteredLinks.filter(function (l) {
        return l.score == null || l.score >= scoreThreshold;
      });
    }

    // Sort by score descending for item limit
    filteredLinks.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });

    // Apply item limit (limits total connections, not nodes)
    if (itemLimitEnabled && itemLimit > 0 && filteredLinks.length > itemLimit) {
      filteredLinks = filteredLinks.slice(0, itemLimit);
    }

    // Collect referenced node IDs
    var nodeIds = {};
    nodeIds[data.centerId] = true;
    for (var i = 0; i < filteredLinks.length; i++) {
      nodeIds[filteredLinks[i].source] = true;
      nodeIds[filteredLinks[i].target] = true;
    }

    var filteredNodes = data.nodes.filter(function (n) { return nodeIds[n.id]; });
    return { nodes: filteredNodes, links: filteredLinks, centerId: data.centerId };
  }

  function applyFiltersAndBuild() {
    if (!currentData) return;
    var filtered = filterGraphData(currentData);
    rootNodeId = filtered.centerId;
    graph = { nodes: filtered.nodes.map(function (n) { return Object.assign({}, n); }), links: filtered.links.slice() };
    rebuildNodeMap();
    initPhysics();
    setVisibleFromGraph();
    ALPHA = 0.25; settled = false;
    rebuildPanel();
    updateStats();
  }

  function rebuildNodeMap() {
    nodeMap = {};
    for (var i = 0; i < graph.nodes.length; i++) nodeMap[graph.nodes[i].id] = graph.nodes[i];
  }
  function nodeById(id) { return nodeMap[id] || null; }

  function buildGraph(centerId) {
    return loadNeighborhood(centerId).then(function (data) {
      currentData = data;
      // Collapse all link groups after search
      for (var key in groupOpen) groupOpen[key] = false;
      applyFiltersAndBuild();
      return data;
    });
  }

  function initPhysics() {
    for (var i = 0; i < graph.nodes.length; i++) {
      var nd = graph.nodes[i];
      var isRoot = nd.id === rootNodeId;
      nd.radius = isRoot ? 22 : (nd.nodeType === "product" ? 18 : 15);
      if (typeof nd.x !== "number") {
        var ang = (Math.PI * 2 * i) / Math.max(1, graph.nodes.length);
        var dist = isRoot ? 0 : 140 + (i % 6) * 28;
        nd.x = Math.cos(ang) * dist;
        nd.y = Math.sin(ang) * dist;
      }
      nd.vx = nd.vx || 0; nd.vy = nd.vy || 0; nd.pinned = false;
    }
  }

  function setVisibleFromGraph() {
    visibleEdges = {};
    for (var i = 0; i < graph.links.length; i++) visibleEdges[graph.links[i].key] = true;
  }

  function tickPhysics() {
    if (settled || graph.nodes.length === 0) return;
    ALPHA *= 0.985;
    if (ALPHA < 0.005) { settled = true; return; }
    var repulse = 3500 * ALPHA;
    for (var i = 0; i < graph.nodes.length; i++) {
      var a = graph.nodes[i];
      for (var j = i + 1; j < graph.nodes.length; j++) {
        var b = graph.nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var d2 = dx*dx + dy*dy + 0.01;
        var dist = Math.sqrt(d2);
        var minD = (a.radius + b.radius + 24);
        if (dist < minD) {
          var push = (minD - dist) * 0.02 * ALPHA;
          var ux = dx / dist, uy = dy / dist;
          if (!a.pinned) { a.vx += ux * push; a.vy += uy * push; }
          if (!b.pinned) { b.vx -= ux * push; b.vy -= uy * push; }
        }
        var force = repulse / d2;
        var ux2 = dx / dist, uy2 = dy / dist;
        if (!a.pinned) { a.vx += ux2 * force; a.vy += uy2 * force; }
        if (!b.pinned) { b.vx -= ux2 * force; b.vy -= uy2 * force; }
      }
    }
    for (var k = 0; k < graph.links.length; k++) {
      var e = graph.links[k];
      if (!visibleEdges[e.key]) continue;
      var s = nodeById(e.source), t = nodeById(e.target);
      if (!s || !t) continue;
      var dx3 = t.x - s.x, dy3 = t.y - s.y;
      var dist3 = Math.max(1, Math.sqrt(dx3*dx3 + dy3*dy3));
      var ideal = e.rel === "guardrail" ? 180 : (e.rel === "symptom" ? 150 : 170);
      var spring = (dist3 - ideal) * 0.0035 * ALPHA;
      var ux3 = dx3 / dist3, uy3 = dy3 / dist3;
      if (!s.pinned) { s.vx += ux3 * spring; s.vy += uy3 * spring; }
      if (!t.pinned) { t.vx -= ux3 * spring; t.vy -= uy3 * spring; }
    }
    for (var n = 0; n < graph.nodes.length; n++) {
      var nd = graph.nodes[n];
      if (nd.id === rootNodeId && !nd.pinned) {
        nd.vx += (-nd.x) * 0.0025 * ALPHA;
        nd.vy += (-nd.y) * 0.0025 * ALPHA;
      }
      if (!nd.pinned) {
        nd.vx *= 0.9; nd.vy *= 0.9;
        nd.x += nd.vx; nd.y += nd.vy;
      }
    }
  }

  function render() {
    if (!ctx2d) return;
    tickPhysics();
    ctx2d.setTransform(1,0,0,1,0,0);
    ctx2d.clearRect(0,0,cvs.width,cvs.height);
    ctx2d.scale(dpr,dpr);
    ctx2d.translate(W/2 + cam.x, H/2 + cam.y);
    ctx2d.scale(cam.zoom, cam.zoom);

    for (var i = 0; i < graph.links.length; i++) {
      var e = graph.links[i];
      if (!visibleEdges[e.key]) continue;
      var s = nodeById(e.source), t = nodeById(e.target);
      if (!s || !t) continue;
      var lt = LINK_TYPES[e.rel] || LINK_TYPES.similar;
      ctx2d.beginPath();
      ctx2d.strokeStyle = lt.color + "66";
      ctx2d.lineWidth = 1.6;
      if (lt.dash) ctx2d.setLineDash(lt.dash); else ctx2d.setLineDash([]);
      if (hoveredNode && (e.source === hoveredNode.id || e.target === hoveredNode.id)) {
        ctx2d.strokeStyle = lt.color + "dd";
        ctx2d.lineWidth = 2.5;
      }
      ctx2d.moveTo(s.x, s.y); ctx2d.lineTo(t.x, t.y); ctx2d.stroke(); ctx2d.setLineDash([]);
    }

    for (var j = 0; j < graph.nodes.length; j++) {
      var nd = graph.nodes[j];
      var nc = NODE_COLORS[nd.nodeType] || NODE_COLORS.product;
      var r = nd.radius || 16;
      var isHovered = hoveredNode && hoveredNode.id === nd.id;
      var isRoot = nd.id === rootNodeId;

      if (isRoot || isHovered) {
        ctx2d.beginPath();
        var grad = ctx2d.createRadialGradient(nd.x, nd.y, r * 0.5, nd.x, nd.y, r * 2.5);
        grad.addColorStop(0, nc.stroke + "40"); grad.addColorStop(1, nc.stroke + "00");
        ctx2d.fillStyle = grad; ctx2d.arc(nd.x, nd.y, r * 2.5, 0, Math.PI * 2); ctx2d.fill();
      }

      ctx2d.beginPath();
      ctx2d.arc(nd.x, nd.y, r, 0, Math.PI * 2);
      ctx2d.fillStyle = isHovered ? nc.stroke + "30" : nc.fill; ctx2d.fill();
      ctx2d.strokeStyle = isHovered ? nc.stroke : nc.stroke + "88";
      ctx2d.lineWidth = isRoot ? 3 : (isHovered ? 2.5 : 1.5); ctx2d.stroke();

      var fontSize = r < 18 ? 9 : (r < 22 ? 10 : 11);
      ctx2d.font = (isRoot ? "800 " : "600 ") + fontSize + "px system-ui,-apple-system,sans-serif";
      ctx2d.fillStyle = isHovered ? "#fff" : nc.text;
      ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";

      var words = String(nd.label || "").split(/\s+/), lines = [], line = "", maxW = r * 3;
      for (var w = 0; w < words.length; w++) {
        var test = line ? line + " " + words[w] : words[w];
        if (ctx2d.measureText(test).width > maxW && line) { lines.push(line); line = words[w]; } else line = test;
      }
      if (line) lines.push(line);
      var lh = fontSize + 2;
      var startY = nd.y + r + 10 + (lines.length > 1 ? 0 : lh / 2) - (lines.length * lh / 2);
      for (var l = 0; l < lines.length; l++) {
        ctx2d.fillStyle = "rgba(0,0,0,.6)"; ctx2d.fillText(lines[l], nd.x + 1, startY + l * lh + 1);
        ctx2d.fillStyle = isHovered ? "#fff" : nc.text; ctx2d.fillText(lines[l], nd.x, startY + l * lh);
      }
      var icon = nd.nodeType === "product" ? "💊" : (nd.nodeType === "symptom" ? "🩺" : (nd.nodeType === "usecase" ? "🧩" : "📦"));
      ctx2d.font = (r * 0.68) + "px serif"; ctx2d.fillText(icon, nd.x, nd.y);
    }

    animId = requestAnimationFrame(render);
  }

  function screenToWorld(sx, sy) {
    return { x: (sx - W / 2 - cam.x) / cam.zoom, y: (sy - H / 2 - cam.y) / cam.zoom };
  }
  function hitTest(sx, sy) {
    var w = screenToWorld(sx, sy), best = null, bestDist = Infinity;
    for (var i = 0; i < graph.nodes.length; i++) {
      var nd = graph.nodes[i];
      var dx = nd.x - w.x, dy = nd.y - w.y, d = Math.sqrt(dx*dx + dy*dy);
      if (d < nd.radius + 6 && d < bestDist) { best = nd; bestDist = d; }
    }
    return best;
  }

  function updateTooltip(sx, sy) {
    if (!tooltipEl) return;
    if (!hoveredNode) { tooltipEl.classList.remove("show"); return; }
    var nd = hoveredNode;
    var out = 0;
    for (var i = 0; i < graph.links.length; i++) if (graph.links[i].source === nd.id || graph.links[i].target === nd.id) out++;
    var typeBg = { product:"rgba(46,229,157,.15)", symptom:"rgba(255,204,102,.15)", usecase:"rgba(185,142,255,.15)", bundle:"rgba(36,215,215,.15)" };
    var typeColor = { product:"#6af0be", symptom:"#ffcc66", usecase:"#d9c4ff", bundle:"#baf3ff" };
    tooltipEl.innerHTML =
      '<div class="tt-name"><span class="tt-type" style="background:' + (typeBg[nd.nodeType] || "var(--pnl2)") + ';color:' + (typeColor[nd.nodeType] || "var(--txt)") + '">' + esc(nd.nodeType) + '</span> ' + esc(nd.label) + '</div>' +
      '<div class="tt-links">' + out + ' connection' + (out !== 1 ? 's' : '') + ' · double-click to open its neighborhood</div>';
    tooltipEl.classList.add("show");
    tooltipEl.style.left = clamp(sx + 14, 0, W - 260) + "px";
    tooltipEl.style.top = clamp(sy - 10, 0, H - 84) + "px";
  }

  function bindCanvas() {
    if (!cvs) return;
    cvs.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      var rect = cvs.getBoundingClientRect(), sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      var nd = hitTest(sx, sy);
      if (nd) { dragNode = nd; nd.pinned = true; ALPHA = 0.25; settled = false; }
      else panStart = { mx: ev.clientX, my: ev.clientY, cx: cam.x, cy: cam.y };
      ev.preventDefault();
    });
    window.addEventListener("pointermove", function (ev) {
      if (dragNode) {
        var rect = cvs.getBoundingClientRect(), w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
        dragNode.x = w.x; dragNode.y = w.y; dragNode.vx = 0; dragNode.vy = 0; ALPHA = 0.1; settled = false; return;
      }
      if (panStart) { cam.x = panStart.cx + (ev.clientX - panStart.mx); cam.y = panStart.cy + (ev.clientY - panStart.my); return; }
      var rect2 = cvs.getBoundingClientRect(), nd2 = hitTest(ev.clientX - rect2.left, ev.clientY - rect2.top);
      if (nd2 !== hoveredNode) { hoveredNode = nd2; updateTooltip(ev.clientX - rect2.left, ev.clientY - rect2.top); }
    });
    window.addEventListener("pointerup", function () {
      if (dragNode) { dragNode.pinned = false; dragNode = null; }
      panStart = null;
    });
    cvs.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var factor = ev.deltaY < 0 ? 1.1 : 0.9;
      cam.zoom = clamp(cam.zoom * factor, 0.15, 4);
    }, { passive: false });
    cvs.addEventListener("dblclick", function (ev) {
      var rect = cvs.getBoundingClientRect(), nd = hitTest(ev.clientX - rect.left, ev.clientY - rect.top);
      if (nd) buildGraph(nd.id);
    });
  }

  function rebuildPanel() {
    if (!panelEl) return;
    var body = panelEl.querySelector(".om-panel-body");
    if (!body) return;
    body.innerHTML = "";

    if (!graph.links.length) {
      body.innerHTML = '<div style="padding:20px 14px;color:var(--mut);font-size:12px;text-align:center;">Search for a product, symptom, use case, or bundle to see its neighborhood</div>';
      return;
    }

    /* --- Link toggle groups --- */
    var groups = {};
    for (var i = 0; i < graph.links.length; i++) {
      var e = graph.links[i];
      if (!groups[e.rel]) groups[e.rel] = [];
      groups[e.rel].push(e);
    }

    var order = ["similar", "complement", "symptom", "usecase", "bundle", "guardrail"];
    for (var oi = 0; oi < order.length; oi++) {
      var rel = order[oi];
      if (!groups[rel] || groups[rel].length === 0) continue;
      var lt = LINK_TYPES[rel];
      var isOpen = groupOpen[rel] === true; // default collapsed after search
      var grp = document.createElement("div");
      grp.className = "om-lg";

      var hd = document.createElement("div");
      hd.className = "om-lg-hd";
      var allOn = groups[rel].every(function (e) { return visibleEdges[e.key]; });
      hd.innerHTML =
        '<span class="lg-arrow ' + (isOpen ? "open" : "") + '">▶</span>' +
        '<span class="lg-icon">' + lt.icon + '</span>' +
        '<span class="lg-label" style="color:' + lt.color + '">' + lt.label + '</span>' +
        '<span class="lg-count">' + groups[rel].length + '</span>' +
        '<input type="checkbox" class="lg-check" ' + (allOn ? "checked" : "") + ' title="Toggle all">';

      (function (rel2, grp2, hd2) {
        hd2.addEventListener("click", function (ev) {
          if (ev.target.type === "checkbox") return;
          groupOpen[rel2] = !groupOpen[rel2];
          var bd = grp2.querySelector(".om-lg-bd");
          var arrow = hd2.querySelector(".lg-arrow");
          if (bd) bd.classList.toggle("open");
          if (arrow) arrow.classList.toggle("open");
        });
        var gCb = hd2.querySelector(".lg-check");
        gCb.addEventListener("change", function () {
          var on = gCb.checked;
          var items = grp2.querySelectorAll(".om-li input");
          for (var x = 0; x < items.length; x++) items[x].checked = on;
          for (var y = 0; y < groups[rel2].length; y++) visibleEdges[groups[rel2][y].key] = on;
          ALPHA = 0.1; settled = false; updateStats();
        });
      })(rel, grp, hd);

      grp.appendChild(hd);
      var bd = document.createElement("div");
      bd.className = "om-lg-bd" + (isOpen ? " open" : "");

      for (var j = 0; j < groups[rel].length; j++) {
        var edge = groups[rel][j];
        var sNode = nodeById(edge.source), tNode = nodeById(edge.target);
        var label = (sNode ? sNode.label : "?") + " ↔ " + (tNode ? tNode.label : "?") + (edge.label ? " — " + edge.label : "");
        var li = document.createElement("div");
        li.className = "om-li";
        li.innerHTML = '<input type="checkbox" ' + (visibleEdges[edge.key] ? "checked" : "") + '><span class="li-label" title="' + esc(label) + '">' + esc(label) + '</span>';
        (function (ekey, li2) {
          var cb = li2.querySelector("input");
          cb.addEventListener("change", function () {
            visibleEdges[ekey] = cb.checked;
            var grpEl = li2.closest(".om-lg");
            if (grpEl) {
              var all = grpEl.querySelectorAll(".om-li input"), allChecked = true;
              for (var x = 0; x < all.length; x++) if (!all[x].checked) { allChecked = false; break; }
              var gCb = grpEl.querySelector(".lg-check"); if (gCb) gCb.checked = allChecked;
            }
            ALPHA = 0.1; settled = false; updateStats();
          });
          li2.querySelector(".li-label").addEventListener("click", function () {
            cb.checked = !cb.checked; cb.dispatchEvent(new Event("change"));
          });
        })(edge.key, li);
        bd.appendChild(li);
      }

      grp.appendChild(bd);
      body.appendChild(grp);
    }

    /* --- Similar Items list --- */
    buildItemList(body, "similar", "🔗", "Similar Items", "#4ea1ff");

    /* --- Complementary Items list --- */
    buildItemList(body, "complement", "➕", "Complementary Items", "#2ee59d");
  }

  function buildItemList(container, relType, icon, title, color) {
    if (!currentData) return;
    var items = [];
    var centerId = currentData.centerId;
    for (var i = 0; i < currentData.links.length; i++) {
      var l = currentData.links[i];
      if (l.rel !== relType) continue;
      var otherId = l.source === centerId ? l.target : l.source;
      // Find node data
      var nd = null;
      for (var j = 0; j < currentData.nodes.length; j++) {
        if (currentData.nodes[j].id === otherId) { nd = currentData.nodes[j]; break; }
      }
      if (nd) items.push({ node: nd, score: l.score || 0, label: l.label || "" });
    }
    if (items.length === 0) return;

    // Sort by score descending
    items.sort(function (a, b) { return b.score - a.score; });

    var wrap = document.createElement("div");
    wrap.className = "om-item-list";
    wrap.innerHTML =
      '<div class="om-item-list-hd">' +
        '<span class="il-icon">' + icon + '</span>' +
        '<span style="color:' + color + '">' + esc(title) + '</span>' +
        '<span class="il-count">' + items.length + '</span>' +
      '</div>';

    var bd = document.createElement("div");
    bd.className = "om-item-list-bd";

    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var row = document.createElement("div");
      row.className = "om-item-row";
      row.innerHTML =
        '<span class="ir-score" style="background:' + color + '22;color:' + color + '">' + it.score + '</span>' +
        '<span class="ir-label">' + esc(it.node.label) + '</span>' +
        (it.label ? '<span class="ir-reason" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' : '');
      (function (nodeId) {
        row.addEventListener("click", function () { buildGraph(nodeId); });
      })(it.node.id);
      bd.appendChild(row);
    }

    wrap.appendChild(bd);
    container.appendChild(wrap);
  }

  function setAllEdges(on) {
    for (var key in visibleEdges) visibleEdges[key] = on;
    rebuildPanel(); ALPHA = 0.1; settled = false; updateStats();
  }

  function collapseAllGroups() {
    for (var key in groupOpen) groupOpen[key] = false;
    rebuildPanel();
  }

  function expandAllGroups() {
    var order = ["similar", "complement", "symptom", "usecase", "bundle", "guardrail"];
    for (var i = 0; i < order.length; i++) groupOpen[order[i]] = true;
    rebuildPanel();
  }

  function updateStats() {
    var statsEl = mount && mount.querySelector(".om-stats");
    if (!statsEl) return;
    var counts = { product:0, symptom:0, usecase:0, bundle:0 };
    for (var i = 0; i < graph.nodes.length; i++) {
      var t = graph.nodes[i].nodeType;
      if (counts[t] !== undefined) counts[t]++;
    }
    var vis=0, tot=0;
    for (var k in visibleEdges) { tot++; if (visibleEdges[k]) vis++; }
    statsEl.innerHTML =
      '<span><span class="dot" style="background:#2ee59d"></span>' + counts.product + ' products</span>' +
      '<span><span class="dot" style="background:#ffcc66"></span>' + counts.symptom + ' symptoms</span>' +
      '<span><span class="dot" style="background:#b98eff"></span>' + counts.usecase + ' use cases</span>' +
      '<span><span class="dot" style="background:#24d7d7"></span>' + counts.bundle + ' bundles</span>' +
      '<span style="margin-left:auto">' + vis + '/' + tot + ' links visible</span>';
  }

  function doSearch(q) {
    q = norm(q);
    if (!q || !searchIndex) return [];
    var words = q.split(/\s+/).filter(Boolean);
    var results = [];
    for (var i = 0; i < searchIndex.length; i++) {
      var it = searchIndex[i];
      var hay = norm(it.label + " " + (it.searchText || ""));
      var score = 0;
      if (norm(it.label) === q) score = 120;
      else if (norm(it.label).indexOf(q) === 0) score = 100;
      else if (hay.indexOf(q) >= 0) score = 80;
      else {
        var matched = 0;
        for (var w = 0; w < words.length; w++) if (hay.indexOf(words[w]) >= 0) matched++;
        if (matched > 0) score = 40 + (matched / words.length) * 30;
      }
      if (score > 0) results.push({ item: it, score: score + (it.priority || 0) * 0.01 });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 20);
  }

  function showDropdown(results) {
    if (!ddEl) return;
    if (!results.length) { ddEl.classList.remove("open"); return; }
    ddEl.innerHTML = "";
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var item = document.createElement("div");
      item.className = "om-dd-item";
      item.setAttribute("data-idx", i);
      item.innerHTML = '<span class="dd-type ' + esc(r.item.nodeType) + '">' + esc(r.item.nodeType) + '</span><span>' + esc(r.item.label) + '</span>';
      (function (nodeId, label) {
        item.addEventListener("click", function () {
          buildGraph(nodeId);
          ddEl.classList.remove("open");
          if (searchInput) searchInput.value = label;
        });
      })(r.item.id, r.item.label);
      ddEl.appendChild(item);
    }
    ddEl.classList.add("open");
  }

  function resize() {
    if (!cvs) return;
    var wrap = cvs.parentElement; if (!wrap) return;
    dpr = window.devicePixelRatio || 1; W = wrap.clientWidth; H = wrap.clientHeight;
    cvs.width = W * dpr; cvs.height = H * dpr; cvs.style.width = W + "px"; cvs.style.height = H + "px";
    ctx2d = cvs.getContext("2d");
  }

  function renderEmptyState(wrap) {
    if (!wrap) return;
    var el = document.createElement("div");
    el.className = "om-empty";
    el.innerHTML =
      '<div class="big-icon">🧠</div>' +
      '<div class="msg">OTC Mindmap</div>' +
      '<div class="sub">Search for a product, symptom, use case, or bundle. This version keeps the module small and loads graph neighborhoods from static JSON files.</div>';
    wrap.appendChild(el);
    var orig = buildGraph;
    buildGraph = function (id) {
      if (el.parentNode) el.parentNode.removeChild(el);
      buildGraph = orig;
      return orig(id);
    };
  }

  function updateControlsDisplay() {
    if (!panelEl) return;
    var scoreVal = panelEl.querySelector(".om-score-val");
    if (scoreVal) scoreVal.textContent = scoreThreshold;
    var limitInput = panelEl.querySelector(".om-limit-input");
    if (limitInput) limitInput.disabled = !itemLimitEnabled;
  }

  async function renderModule(moduleCtx) {
    mount = moduleCtx.mount; mount.innerHTML = ""; ensureStyles();
    if (animId) { cancelAnimationFrame(animId); animId = 0; }

    var root = document.createElement("div");
    root.className = "om";
    root.innerHTML =
      '<div class="om-wrap">' +
        '<div class="om-main">' +
          '<div class="om-topbar">' +
            '<h2>🧠 OTC Mindmap</h2>' +
            '<div class="om-search">' +
              '<span class="search-icon">🔍</span>' +
              '<input type="text" placeholder="Search products, symptoms, use cases, bundles…" autocomplete="off" spellcheck="false">' +
              '<div class="om-dd"></div>' +
            '</div>' +
            '<div class="om-topbar-actions">' +
              '<button class="om-btn sm om-btn-fit" title="Fit to screen">⤢ Fit</button>' +
              '<button class="om-btn sm om-btn-panel" title="Toggle link panel">☰</button>' +
            '</div>' +
          '</div>' +
          '<div class="om-canvas-wrap">' +
            '<canvas></canvas>' +
            '<div class="om-tooltip"></div>' +
            '<div class="om-legend">' +
              '<span><span class="ld" style="background:#2ee59d"></span>Product</span>' +
              '<span><span class="ld" style="background:#ffcc66"></span>Symptom</span>' +
              '<span><span class="ld" style="background:#b98eff"></span>Use case</span>' +
              '<span><span class="ld" style="background:#24d7d7"></span>Bundle</span>' +
            '</div>' +
            '<div class="om-zoom">' +
              '<button class="om-zoom-in" title="Zoom in">+</button>' +
              '<button class="om-zoom-out" title="Zoom out">−</button>' +
            '</div>' +
          '</div>' +
          '<div class="om-stats"></div>' +
        '</div>' +
        '<div class="om-panel">' +
          '<div class="om-panel-hd"><h3>🔗 Links</h3></div>' +
          '<div class="om-controls">' +
            '<div class="om-ctrl-row">' +
              '<label>Score ≥</label>' +
              '<input type="range" class="om-score-slider" min="0" max="100" step="1" value="' + scoreThreshold + '">' +
              '<span class="ctrl-val om-score-val">' + scoreThreshold + '</span>' +
            '</div>' +
            '<div class="om-ctrl-row">' +
              '<label>Limit</label>' +
              '<input type="checkbox" class="om-limit-check" ' + (itemLimitEnabled ? "checked" : "") + ' title="Enable item limit">' +
              '<input type="number" class="om-limit-input" min="1" max="500" value="' + itemLimit + '"' + (itemLimitEnabled ? "" : " disabled") + '>' +
              '<span style="color:var(--mut);font-size:10px">items max</span>' +
            '</div>' +
          '</div>' +
          '<div class="om-panel-actions">' +
            '<button class="om-btn sm om-ca">Collapse All</button>' +
            '<button class="om-btn sm om-ea">Expand All</button>' +
            '<button class="om-btn sm om-sa">Select All</button>' +
            '<button class="om-btn sm om-ua">Unselect All</button>' +
          '</div>' +
          '<div class="om-panel-body"></div>' +
        '</div>' +
      '</div>';
    mount.appendChild(root);

    cvs = root.querySelector("canvas");
    panelEl = root.querySelector(".om-panel");
    tooltipEl = root.querySelector(".om-tooltip");
    searchInput = root.querySelector(".om-search input");
    ddEl = root.querySelector(".om-dd");

    await loadManifest();
    await loadSearchIndex();

    resize();
    window.addEventListener("resize", resize);
    bindCanvas();

    /* --- Score slider --- */
    var scoreSlider = root.querySelector(".om-score-slider");
    scoreSlider.addEventListener("input", function () {
      scoreThreshold = parseInt(scoreSlider.value, 10);
      var scoreVal = root.querySelector(".om-score-val");
      if (scoreVal) scoreVal.textContent = scoreThreshold;
      if (currentData) applyFiltersAndBuild();
    });

    /* --- Item limit controls --- */
    var limitCheck = root.querySelector(".om-limit-check");
    var limitInput = root.querySelector(".om-limit-input");
    limitCheck.addEventListener("change", function () {
      itemLimitEnabled = limitCheck.checked;
      limitInput.disabled = !itemLimitEnabled;
      if (currentData) applyFiltersAndBuild();
    });
    limitInput.addEventListener("change", function () {
      var v = parseInt(limitInput.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 500) v = 500;
      limitInput.value = v;
      itemLimit = v;
      if (currentData) applyFiltersAndBuild();
    });

    /* --- Search --- */
    var searchTimer = null;
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var q = searchInput.value.trim();
        if (q.length < 2) { ddEl.classList.remove("open"); return; }
        showDropdown(doSearch(q));
      }, 100);
    });
    searchInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") ddEl.classList.remove("open");
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        var items = ddEl.querySelectorAll(".om-dd-item");
        if (!items.length) return;
        var cur = ddEl.querySelector(".om-dd-item.hl");
        var idx = -1;
        if (cur) { idx = parseInt(cur.getAttribute("data-idx"), 10); cur.classList.remove("hl"); }
        idx = ev.key === "ArrowDown" ? idx + 1 : idx - 1;
        if (idx < 0) idx = items.length - 1;
        if (idx >= items.length) idx = 0;
        items[idx].classList.add("hl");
        items[idx].scrollIntoView({ block: "nearest" });
      }
      if (ev.key === "Enter") {
        var hl = ddEl.querySelector(".om-dd-item.hl");
        if (hl) { hl.click(); return; }
        var q = searchInput.value.trim(), results = doSearch(q);
        if (results.length) {
          buildGraph(results[0].item.id);
          ddEl.classList.remove("open");
          searchInput.value = results[0].item.label;
        }
      }
    });
    document.addEventListener("click", function (ev) {
      if (ddEl && !ddEl.contains(ev.target) && ev.target !== searchInput) ddEl.classList.remove("open");
    });
    root.querySelector(".om-btn-panel").addEventListener("click", function () {
      panelCollapsed = !panelCollapsed;
      panelEl.classList.toggle("collapsed", panelCollapsed);
      setTimeout(resize, 220);
    });
    root.querySelector(".om-btn-fit").addEventListener("click", function () {
      if (!graph.nodes.length) return;
      var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      for (var i=0;i<graph.nodes.length;i++) {
        var nd=graph.nodes[i];
        if (nd.x<minX) minX=nd.x; if (nd.x>maxX) maxX=nd.x;
        if (nd.y<minY) minY=nd.y; if (nd.y>maxY) maxY=nd.y;
      }
      var gw=maxX-minX+100, gh=maxY-minY+100;
      var zoom=Math.min(W/gw,H/gh,2);
      cam.zoom=clamp(zoom*0.85,0.15,4);
      cam.x=-(minX+maxX)/2*cam.zoom; cam.y=-(minY+maxY)/2*cam.zoom;
    });
    root.querySelector(".om-zoom-in").addEventListener("click", function () { cam.zoom = clamp(cam.zoom*1.25,0.15,4); });
    root.querySelector(".om-zoom-out").addEventListener("click", function () { cam.zoom = clamp(cam.zoom*0.8,0.15,4); });
    root.querySelector(".om-sa").addEventListener("click", function () { setAllEdges(true); });
    root.querySelector(".om-ua").addEventListener("click", function () { setAllEdges(false); });
    root.querySelector(".om-ca").addEventListener("click", function () { collapseAllGroups(); });
    root.querySelector(".om-ea").addEventListener("click", function () { expandAllGroups(); });

    graph = { nodes: [], links: [] }; rebuildNodeMap(); rebuildPanel(); updateStats();
    animId = requestAnimationFrame(render);
    renderEmptyState(root.querySelector(".om-canvas-wrap"));
  }

  E.registerModule({
    id: "otcmindmap",
    title: "OTC Mindmap",
    icon: "🧠",
    order: 71,
    render: renderModule
  });
})();
