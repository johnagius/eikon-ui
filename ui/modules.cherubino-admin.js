(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  /* ── helpers ──────────────────────────────────────────────────────────── */
  function esc(s) { return E.escapeHtml(String(s || "")); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function todayYmd() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(ymd, n) {
    var d = new Date(ymd + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function formatDateLabel(ymd) {
    var d = new Date(ymd + "T00:00:00");
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return days[d.getDay()] + ", " + d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }
  function minDate() { return addDays(todayYmd(), -14); }

  /* ── state ───────────────────────────────────────────────────────────── */
  var S = {
    date: todayYmd(),
    allOrders: [],
    mount: null,
    user: null
  };

  /* ── API ─────────────────────────────────────────────────────────────── */
  function loadOrders() {
    return E.apiFetch("/cherubino/orders?date=" + S.date + "&all_org=1", { method: "GET" })
      .then(function (r) { S.allOrders = r.orders || []; })
      .catch(function (err) {
        try { console.error("[cherubino-admin] load error", err); } catch (e) {}
        S.allOrders = [];
      });
  }

  function updateOrder(id, fields) {
    return E.apiFetch("/cherubino/orders/" + id, {
      method: "PUT",
      body: JSON.stringify(fields)
    });
  }

  /* ── derived data ────────────────────────────────────────────────────── */
  function ordersByLocation() {
    var byLoc = {};
    S.allOrders.forEach(function (o) {
      var key = o.location_id;
      if (!byLoc[key]) byLoc[key] = { location_name: o.location_name || ("Location " + key), orders: [] };
      byLoc[key].orders.push(o);
    });
    return byLoc;
  }

  /* ── similarity + grouping (shared logic with pharmacy module) ──────── */
  function damerauLev(a, b) {
    var la = a.length, lb = b.length;
    if (!la) return lb; if (!lb) return la;
    var d = [];
    for (var i = 0; i <= la; i++) { d[i] = [i]; }
    for (var j = 0; j <= lb; j++) { d[0][j] = j; }
    for (var i = 1; i <= la; i++) {
      for (var j = 1; j <= lb; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
        }
      }
    }
    return d[la][lb];
  }
  function maxTypos(len) { return len <= 3 ? 0 : len <= 5 ? 1 : 2; }

  function nameSimilarity(a, b) {
    if (!a || !b) return 0;
    var na = a.toLowerCase().trim(), nb = b.toLowerCase().trim();
    if (na === nb) return 1.0;
    var tokA = na.split(/[\s\-\/\(\),\.]+/).filter(function (t) { return t.length > 0; });
    var tokB = nb.split(/[\s\-\/\(\),\.]+/).filter(function (t) { return t.length > 0; });
    var setA = {}, setB = {};
    tokA.forEach(function (t) { setA[t] = 1; });
    tokB.forEach(function (t) { setB[t] = 1; });
    var inter = 0, union = 0;
    for (var k in setA) { if (setB[k]) inter++; union++; }
    for (var k in setB) { if (!setA[k]) union++; }
    var jaccard = union > 0 ? inter / union : 0;
    var fuzzyMatches = 0;
    tokA.forEach(function (ta) {
      var allowed = maxTypos(ta.length);
      for (var i = 0; i < tokB.length; i++) {
        if (ta === tokB[i]) { fuzzyMatches++; return; }
        if (allowed > 0 && damerauLev(ta, tokB[i]) <= allowed) { fuzzyMatches++; return; }
      }
    });
    var fuzzyRecall = tokA.length > 0 ? fuzzyMatches / tokA.length : 0;
    var maxLen = Math.max(na.length, nb.length);
    var dlFull = maxLen > 0 ? 1 - (damerauLev(na, nb) / maxLen) : 0;
    return Math.max(jaccard, fuzzyRecall * 0.95, dlFull);
  }

  var SIMILARITY_THRESHOLD = 0.7;

  function buildGroupedView() {
    var all = S.allOrders.slice();
    var groups = [];
    var used = {};
    for (var i = 0; i < all.length; i++) {
      if (used[i]) continue;
      var group = { name: all[i].description, items: [all[i]] };
      used[i] = true;
      for (var j = i + 1; j < all.length; j++) {
        if (used[j]) continue;
        if (nameSimilarity(group.name, all[j].description) >= SIMILARITY_THRESHOLD) {
          group.items.push(all[j]);
          used[j] = true;
        }
      }
      var locs = {};
      group.items.forEach(function (item) { locs[item.location_id] = true; });
      if (Object.keys(locs).length >= 2) groups.push(group);
    }
    return groups;
  }

  function renderGroupedView() {
    var groups = buildGroupedView();
    var html = '<div class="ca-section" style="border-color:rgba(90,162,255,.35);background:rgba(90,162,255,.04);">';
    html += '<div class="ca-section-head" style="background:rgba(90,162,255,.10);color:rgba(90,162,255,1);border-color:rgba(90,162,255,.25);">Grouped View — Items ordered by multiple locations</div>';
    if (!groups.length) {
      html += '<div class="ca-empty">No items ordered by multiple locations yet.</div>';
    } else {
      html += '<table class="ca-table">';
      html += '<thead><tr><th>Item</th><th>Qty</th><th>Locations</th><th style="text-align:center;">OOS</th><th style="text-align:center;">Ordered</th><th style="text-align:center;">Avail. WSL</th><th style="text-align:center;">Pending WSL</th></tr></thead><tbody>';
      groups.forEach(function (g, gi) {
        var totalQty = 0;
        var ids = [];
        var allOos = true, allOrdered = true, allAvail = true, allPending = true;
        var byLoc = {};
        g.items.forEach(function (item) {
          totalQty += item.quantity;
          ids.push(item.id);
          if (!item.oos) allOos = false;
          if (!item.ordered) allOrdered = false;
          if (!item.available_wsl) allAvail = false;
          if (!item.pending_wsl) allPending = false;
          var ln = item.location_name || ("Location " + item.location_id);
          if (!byLoc[ln]) byLoc[ln] = 0;
          byLoc[ln] += item.quantity;
        });
        var locDetails = [];
        for (var ln in byLoc) locDetails.push(esc(ln) + ': x' + byLoc[ln]);
        var idsAttr = esc(ids.join(","));
        html += '<tr>';
        html += '<td style="font-weight:700;">' + esc(g.name) + '</td>';
        html += '<td style="text-align:center;font-weight:700;">' + totalQty + '</td>';
        html += '<td style="font-size:11px;color:var(--muted);">' + locDetails.join(' &bull; ') + '</td>';
        html += '<td style="text-align:center;"><input type="checkbox" data-group-ids="' + idsAttr + '" data-field="oos"' + (allOos ? ' checked' : '') + '/></td>';
        html += '<td style="text-align:center;"><input type="checkbox" data-group-ids="' + idsAttr + '" data-field="ordered"' + (allOrdered ? ' checked' : '') + '/></td>';
        html += '<td style="text-align:center;"><input type="checkbox" data-group-ids="' + idsAttr + '" data-field="available_wsl"' + (allAvail ? ' checked' : '') + '/></td>';
        html += '<td style="text-align:center;"><input type="checkbox" data-group-ids="' + idsAttr + '" data-field="pending_wsl"' + (allPending ? ' checked' : '') + '/></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    return html;
  }

  /* ── styles ──────────────────────────────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById("ca-styles")) return;
    var st = document.createElement("style");
    st.id = "ca-styles";
    st.textContent =
      '.ca-date-nav{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;}' +
      '.ca-date-nav button{font-size:12px;padding:6px 12px;}' +
      '.ca-date-label{font-weight:800;font-size:14px;min-width:180px;text-align:center;}' +
      '.ca-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:16px;}' +
      '.ca-section{margin-bottom:18px;border:1px solid var(--border);border-radius:12px;overflow:hidden;}' +
      '.ca-section-head{padding:10px 14px;font-weight:800;font-size:13px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.04);}' +
      '.ca-table{width:100%;border-collapse:collapse;font-size:12px;}' +
      '.ca-table th{text-align:left;padding:8px 10px;background:rgba(255,255,255,.03);border-bottom:1px solid var(--border);font-weight:700;font-size:11px;color:var(--muted);}' +
      '.ca-table td{padding:8px 10px;border-bottom:1px solid var(--border);}' +
      '.ca-table tr:last-child td{border-bottom:none;}' +
      '.ca-table input[type="checkbox"]{cursor:pointer;width:16px;height:16px;}' +
      '.ca-empty{padding:14px;color:var(--muted);font-size:12px;text-align:center;}' +
      '.ca-summary{margin-bottom:18px;padding:14px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.02);}' +
      '.ca-summary-title{font-weight:900;font-size:14px;margin-bottom:8px;}' +
      '.ca-summary-row{display:flex;gap:20px;font-size:12px;color:var(--muted);flex-wrap:wrap;}' +
      '.ca-summary-stat{font-weight:700;color:var(--text);}' +
      '@media print {' +
      '  .eikon-sidebar, .eikon-topbar, .ca-toolbar, .ca-date-nav button, .eikon-nav { display:none !important; }' +
      '  .eikon-main { margin:0 !important; padding:10px !important; }' +
      '  .ca-section { break-inside:avoid; page-break-inside:avoid; }' +
      '  .ca-table input[type="checkbox"] { appearance:auto; -webkit-appearance:checkbox; }' +
      '  body { background:#fff !important; color:#000 !important; }' +
      '  .ca-section-head, .ca-table th { background:#f0f0f0 !important; color:#000 !important; }' +
      '  .ca-table td { color:#000 !important; border-color:#ccc !important; }' +
      '  .ca-date-label { color:#000 !important; }' +
      '  .ca-summary { border-color:#ccc !important; }' +
      '  .ca-summary-title, .ca-summary-stat { color:#000 !important; }' +
      '  .ca-summary-row { color:#333 !important; }' +
      '  .ca-section[style*="90,162,255"] { border-color:#0066cc !important; background:#f0f6ff !important; }' +
      '  .ca-section[style*="90,162,255"] .ca-section-head { background:#e0edff !important; color:#0050a0 !important; }' +
      '}';
    document.head.appendChild(st);
  }

  /* ── rendering ───────────────────────────────────────────────────────── */
  function renderCheckboxCell(order, field, label) {
    var checked = order[field] ? " checked" : "";
    return '<td style="text-align:center;"><input type="checkbox" data-id="' + order.id + '" data-field="' + field + '"' + checked + ' title="' + esc(label) + '"/></td>';
  }

  function renderTable(orders) {
    if (!orders.length) return '<div class="ca-empty">No orders for this date.</div>';
    var html = '<table class="ca-table">';
    html += '<thead><tr><th>Description</th><th>Qty</th><th style="text-align:center;">OOS</th><th style="text-align:center;">Ordered</th><th style="text-align:center;">Avail. WSL</th><th style="text-align:center;">Pending WSL</th></tr></thead>';
    html += '<tbody>';
    orders.forEach(function (o) {
      html += '<tr>';
      html += '<td style="font-weight:600;">' + esc(o.description) + '</td>';
      html += '<td style="text-align:center;">' + esc(o.quantity) + '</td>';
      html += renderCheckboxCell(o, "oos", "Out of Stock");
      html += renderCheckboxCell(o, "ordered", "Ordered");
      html += renderCheckboxCell(o, "available_wsl", "Available in Warehouse");
      html += renderCheckboxCell(o, "pending_wsl", "Pending Arrival in Warehouse");
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderSummary() {
    var total = S.allOrders.length;
    var totalQty = 0, oosCount = 0, orderedCount = 0, availCount = 0, pendingCount = 0;
    var locationSet = {};
    S.allOrders.forEach(function (o) {
      totalQty += o.quantity;
      if (o.oos) oosCount++;
      if (o.ordered) orderedCount++;
      if (o.available_wsl) availCount++;
      if (o.pending_wsl) pendingCount++;
      locationSet[o.location_id] = true;
    });
    var locCount = Object.keys(locationSet).length;

    return '<div class="ca-summary">' +
      '<div class="ca-summary-title">Summary for ' + formatDateLabel(S.date) + '</div>' +
      '<div class="ca-summary-row">' +
      '<span><span class="ca-summary-stat">' + total + '</span> items</span>' +
      '<span><span class="ca-summary-stat">' + totalQty + '</span> total qty</span>' +
      '<span><span class="ca-summary-stat">' + locCount + '</span> locations</span>' +
      '<span>OOS: <span class="ca-summary-stat">' + oosCount + '</span></span>' +
      '<span>Ordered: <span class="ca-summary-stat">' + orderedCount + '</span></span>' +
      '<span>Avail. WSL: <span class="ca-summary-stat">' + availCount + '</span></span>' +
      '<span>Pending WSL: <span class="ca-summary-stat">' + pendingCount + '</span></span>' +
      '</div></div>';
  }

  function renderAll() {
    var mount = S.mount;
    if (!mount) return;

    var today = todayYmd();
    var min = minDate();
    var prevDisabled = S.date <= min ? " disabled" : "";
    var nextDisabled = S.date >= today ? " disabled" : "";

    var html = '';

    // Date nav
    html += '<div class="ca-date-nav">' +
      '<button class="eikon-btn" id="ca-prev"' + prevDisabled + '>&laquo; Prev</button>' +
      '<div class="ca-date-label">' + formatDateLabel(S.date) + '</div>' +
      '<button class="eikon-btn" id="ca-next"' + nextDisabled + '>Next &raquo;</button>' +
      '<button class="eikon-btn primary" id="ca-today" style="margin-left:6px;">Today</button>' +
      '<button class="eikon-btn" id="ca-refresh" style="margin-left:auto;font-size:11px;padding:5px 10px;">Refresh</button>' +
      '</div>';

    // Toolbar
    html += '<div class="ca-toolbar">' +
      '<button class="eikon-btn" id="ca-print">Print Report</button>' +
      '</div>';

    // Summary
    html += renderSummary();

    // Grouped view (multi-location items)
    html += renderGroupedView();

    // Orders by location
    var byLoc = ordersByLocation();
    var keys = Object.keys(byLoc);
    if (!keys.length) {
      html += '<div class="ca-empty" style="padding:30px;">No orders from any location for this date.</div>';
    } else {
      keys.forEach(function (lid) {
        var loc = byLoc[lid];
        html += '<div class="ca-section">';
        html += '<div class="ca-section-head">' + esc(loc.location_name) + ' (' + loc.orders.length + ' items)</div>';
        html += renderTable(loc.orders);
        html += '</div>';
      });
    }

    mount.innerHTML = html;
    wireEvents();
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  function wireEvents() {
    var prevBtn = document.getElementById("ca-prev");
    var nextBtn = document.getElementById("ca-next");
    var todayBtn = document.getElementById("ca-today");
    var printBtn = document.getElementById("ca-print");

    if (prevBtn) prevBtn.onclick = function () {
      var prev = addDays(S.date, -1);
      if (prev >= minDate()) { S.date = prev; refresh(); }
    };
    if (nextBtn) nextBtn.onclick = function () {
      var next = addDays(S.date, 1);
      if (next <= todayYmd()) { S.date = next; refresh(); }
    };
    if (todayBtn) todayBtn.onclick = function () {
      S.date = todayYmd(); refresh();
    };
    if (printBtn) printBtn.onclick = function () {
      window.print();
    };
    var refreshBtn = document.getElementById("ca-refresh");
    if (refreshBtn) refreshBtn.onclick = function () { refresh(); };

    // Per-item checkbox change handlers
    var checkboxes = S.mount.querySelectorAll('input[type="checkbox"][data-id]');
    checkboxes.forEach(function (cb) {
      cb.onchange = function () {
        var orderId = cb.getAttribute("data-id");
        var field = cb.getAttribute("data-field");
        var val = cb.checked ? 1 : 0;
        var update = {};
        update[field] = val;
        updateOrder(orderId, update)
          .then(function () {
            var order = S.allOrders.find(function (o) { return String(o.id) === String(orderId); });
            if (order) order[field] = val;
            refreshSummary();
          })
          .catch(function (err) {
            cb.checked = !cb.checked;
            if (E.toast) E.toast((err && err.message) || "Failed to update", "error");
          });
      };
    });

    // Grouped checkbox change handlers — updates all items in the group
    var groupCbs = S.mount.querySelectorAll('input[type="checkbox"][data-group-ids]');
    groupCbs.forEach(function (cb) {
      cb.onchange = function () {
        var ids = cb.getAttribute("data-group-ids").split(",");
        var field = cb.getAttribute("data-field");
        var val = cb.checked ? 1 : 0;
        var update = {};
        update[field] = val;
        // Update all items in the group
        var promises = ids.map(function (id) { return updateOrder(id, update); });
        Promise.all(promises)
          .then(function () {
            ids.forEach(function (id) {
              var order = S.allOrders.find(function (o) { return String(o.id) === String(id); });
              if (order) order[field] = val;
            });
            // Also sync the per-location checkboxes for these items
            ids.forEach(function (id) {
              var perItemCb = S.mount.querySelector('input[data-id="' + id + '"][data-field="' + field + '"]');
              if (perItemCb) perItemCb.checked = !!val;
            });
            refreshSummary();
          })
          .catch(function (err) {
            cb.checked = !cb.checked;
            if (E.toast) E.toast((err && err.message) || "Failed to update group", "error");
          });
      };
    });
  }

  function refreshSummary() {
    if (!S.mount) return;
    var summaryEl = S.mount.querySelector(".ca-summary");
    if (summaryEl) {
      var tmp = document.createElement("div");
      tmp.innerHTML = renderSummary();
      summaryEl.replaceWith(tmp.firstChild);
    }
  }

  function refresh() {
    loadOrders().then(function () { renderAll(); });
  }

  /* ── auto-refresh (every 5 min while on this page) ────────────────── */
  var _autoRefreshTimer = null;
  function startAutoRefresh() {
    stopAutoRefresh();
    _autoRefreshTimer = setInterval(function () {
      // Only refresh if this module is still active
      if (S.mount && E.state.activeModuleId === "cherubino-admin") refresh();
      else stopAutoRefresh();
    }, 5 * 60 * 1000);
  }
  function stopAutoRefresh() {
    if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  }

  /* ── main render ─────────────────────────────────────────────────────── */
  async function render(ctx) {
    S.mount = ctx.mount;
    S.user = ctx.user;
    ensureStyles();
    S.mount.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading orders...</div>';
    await loadOrders();
    renderAll();
    startAutoRefresh();
  }

  /* ── register ────────────────────────────────────────────────────────── */
  E.registerModule({
    id: "cherubino-admin",
    title: "Cherubino Orders",
    order: 10,
    icon: "\uD83C\uDFE5",
    render: render,
    destroy: function () { stopAutoRefresh(); S.mount = null; }
  });

})();
