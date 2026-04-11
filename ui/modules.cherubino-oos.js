(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  /* ── helpers ──────────────────────────────────────────────────────────── */
  function esc(s) { return E.escapeHtml(String(s || "")); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  /* ── DL search (same as orders/prices modules) ──────────────────────── */
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

  function scoreToken(tok, nameWords, name, barcode) {
    for (var w = 0; w < nameWords.length; w++) {
      if (nameWords[w].indexOf(tok) === 0) return 3.0 + tok.length / nameWords[w].length;
    }
    if (name.indexOf(tok) >= 0) return 2.0;
    if (barcode.indexOf(tok) >= 0) return 2.5;
    var allowed = maxTypos(tok.length);
    if (allowed > 0) {
      var best = 0;
      for (var w = 0; w < nameWords.length; w++) {
        var word = nameWords[w];
        var pre = word.substring(0, Math.min(tok.length + 1, word.length));
        var dist = damerauLev(tok, pre);
        if (dist <= allowed) { var s = 1.5 - dist * 0.4; if (s > best) best = s; }
        if (word.length <= tok.length + 2) { dist = damerauLev(tok, word); if (dist <= allowed) { var s = 1.5 - dist * 0.4; if (s > best) best = s; } }
      }
      if (best > 0) return best;
    }
    return 0;
  }

  function searchCatalog(products, query) {
    var q = query.toLowerCase().trim();
    if (!q) return [];
    var tokens = q.split(/\s+/).filter(function (t) { return t.length > 0; });
    var results = [];
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var name = (p.name || "").toLowerCase();
      var barcode = (p.barcode || "").toLowerCase();
      var nameWords = name.split(/[\s\-\/\(\),\.]+/).filter(function (w) { return w.length > 0; });
      var totalScore = 0, matched = 0;
      for (var t = 0; t < tokens.length; t++) {
        var ts = scoreToken(tokens[t], nameWords, name, barcode);
        if (ts > 0) { totalScore += ts; matched++; }
      }
      if (matched === 0) continue;
      var score;
      if (matched === tokens.length) { score = totalScore / tokens.length; }
      else if (matched / tokens.length >= 0.5 && tokens.length >= 2) { score = (totalScore / tokens.length) * (matched / tokens.length) * 0.3; }
      else continue;
      if (name.indexOf(q) >= 0) score += 3.0;
      score -= name.length * 0.0003;
      results.push({ product: p, score: score });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 15);
  }

  /* ── similarity for duplicate detection ──────────────────────────────── */
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

  /* ── state ───────────────────────────────────────────────────────────── */
  var S = {
    items: [],
    catalogCache: null,
    mount: null,
    user: null,
    filterText: "",
    sortBy: "date",
    sortDir: "desc",
    isAdmin: false
  };

  /* ── API ─────────────────────────────────────────────────────────────── */
  function loadItems() {
    return E.apiFetch("/cherubino/oos", { method: "GET" })
      .then(function (r) { S.items = r.items || []; })
      .catch(function () { S.items = []; });
  }

  function createOos(description) {
    return E.apiFetch("/cherubino/oos", { method: "POST", body: JSON.stringify({ description: description }) });
  }

  function deleteOos(id) {
    return E.apiFetch("/cherubino/oos/" + id, { method: "DELETE" });
  }

  function updateOos(id, action) {
    return E.apiFetch("/cherubino/oos/" + id, { method: "PUT", body: JSON.stringify({ action: action }) });
  }

  function loadCatalog() {
    if (S.catalogCache !== null && S.catalogCache.length > 0) return Promise.resolve(S.catalogCache);
    try {
      var cached = JSON.parse(window.localStorage.getItem("eikon_cherubino_catalog") || "null");
      if (cached && cached.length > 0 && cached.length !== 2000) { S.catalogCache = cached; return Promise.resolve(cached); }
    } catch (e) {}
    var all = [];
    function fetchPage(offset) {
      return E.apiFetch("/emergency-pos/catalog?limit=2000&offset=" + offset + "&all_org=1&fallback_org=3&fallback_location=3", { method: "GET" })
        .then(function (r) {
          var products = r.products || [];
          all = all.concat(products);
          if (r.next_offset && products.length > 0) return fetchPage(r.next_offset);
          S.catalogCache = all;
          try { window.localStorage.setItem("eikon_cherubino_catalog", JSON.stringify(all)); } catch (e) {}
          return all;
        });
    }
    return fetchPage(0).catch(function () { S.catalogCache = []; return []; });
  }

  /* ── styles ──────────────────────────────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById("oos-styles")) return;
    var st = document.createElement("style");
    st.id = "oos-styles";
    st.textContent =
      '.oos-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}' +
      '.oos-filter{flex:1;min-width:200px;font-size:13px;padding:8px 12px;}' +
      '.oos-count{font-size:11px;color:var(--muted);}' +
      '.oos-table-wrap{overflow-x:auto;max-height:calc(100vh - 160px);overflow-y:auto;}' +
      '.oos-table{width:100%;border-collapse:collapse;font-size:12px;}' +
      '.oos-table th{position:sticky;top:0;text-align:left;padding:8px 12px;background:var(--panel2);border-bottom:2px solid var(--border);font-weight:700;font-size:11px;color:var(--muted);z-index:2;cursor:pointer;user-select:none;}' +
      '.oos-table th:hover{color:var(--text);}' +
      '.oos-table th .oos-sort{margin-left:4px;font-size:10px;}' +
      '.oos-table td{padding:8px 12px;border-bottom:1px solid var(--border);}' +
      '.oos-table tr:hover{background:rgba(255,255,255,.03);}' +
      '.oos-del{cursor:pointer;color:rgba(255,90,122,.7);font-size:14px;padding:2px 4px;}' +
      '.oos-del:hover{color:rgba(255,90,122,1);}' +
      '.oos-empty{padding:30px;color:var(--muted);font-size:13px;text-align:center;}' +
      '.oos-suggest{max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;}' +
      '.oos-suggest-item{padding:10px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border);}' +
      '.oos-suggest-item:last-child{border-bottom:none;}' +
      '.oos-suggest-item:hover{background:rgba(90,162,255,.1);}' +
      '.oos-sim-warn{margin-top:8px;padding:10px;border:1px solid rgba(255,180,50,.4);border-radius:8px;background:rgba(255,180,50,.06);font-size:12px;}' +
      '.oos-status-pill{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;margin-left:6px;}' +
      '.oos-st-active{background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.3);}' +
      '.oos-st-pending{background:rgba(255,180,50,.12);color:#f59e0b;border:1px solid rgba(255,180,50,.3);}' +
      '.oos-st-back{background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.3);}' +
      '.oos-st-removal{background:rgba(168,85,247,.12);color:#a855f7;border:1px solid rgba(168,85,247,.3);}' +
      '.oos-pharmacy-row{background:rgba(255,180,50,.04);}' +
      '.oos-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;}' +
      '.oos-act-btn{font-size:10px;padding:3px 8px;cursor:pointer;}' +
      '@media print{' +
      '  .eikon-sidebar,.eikon-topbar,.eikon-nav,.oos-toolbar{display:none !important;}' +
      '  .eikon-main{margin:0 !important;padding:10px !important;}' +
      '  body{background:#fff !important;color:#000 !important;}' +
      '  .oos-table th{background:#f0f0f0 !important;color:#000 !important;position:static !important;}' +
      '  .oos-table td{color:#000 !important;border-color:#ccc !important;}' +
      '  .oos-table-wrap{max-height:none !important;overflow:visible !important;}' +
      '  .oos-del{display:none !important;}' +
      '}';
    document.head.appendChild(st);
  }

  /* ── sorting + filtering ─────────────────────────────────────────────── */
  function sortedFiltered() {
    var list = S.items.slice();
    var q = (S.filterText || "").toLowerCase().trim();
    if (q) {
      list = list.filter(function (it) { return (it.description || "").toLowerCase().indexOf(q) >= 0; });
    }
    var key = S.sortBy;
    var dir = S.sortDir === "asc" ? 1 : -1;
    list.sort(function (a, b) {
      var va = key === "date" ? (a.created_at || "") : (a.description || "").toLowerCase();
      var vb = key === "date" ? (b.created_at || "") : (b.description || "").toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return list;
  }

  function sortArrow(col) {
    if (S.sortBy !== col) return '';
    return '<span class="oos-sort">' + (S.sortDir === "asc" ? "&#9650;" : "&#9660;") + '</span>';
  }

  /* ── rendering ───────────────────────────────────────────────────────── */
  function statusPill(status) {
    var labels = { active: "OOS", pending: "Pending Approval", back_in_stock: "Back in Stock?", removal_requested: "Removal Requested" };
    var cls = { active: "oos-st-active", pending: "oos-st-pending", back_in_stock: "oos-st-back", removal_requested: "oos-st-removal" };
    return '<span class="oos-status-pill ' + (cls[status] || "oos-st-active") + '">' + (labels[status] || status) + '</span>';
  }

  function renderActions(item) {
    var myLocId = S.user ? Number(S.user.location_id) : -1;
    var isMyPharmacyItem = item.source === "pharmacy" && Number(item.source_location_id) === myLocId;
    var html = '<div class="oos-actions">';

    if (S.isAdmin) {
      // Admin actions
      if (item.status === "pending") {
        html += '<button class="eikon-btn primary oos-act-btn" data-action="approve" data-id="' + item.id + '">Approve</button>';
        html += '<button class="eikon-btn danger oos-act-btn" data-action="reject" data-id="' + item.id + '">Reject</button>';
      } else if (item.status === "back_in_stock") {
        html += '<button class="eikon-btn primary oos-act-btn" data-action="approve_back_in_stock" data-id="' + item.id + '">Confirm &amp; Remove</button>';
        html += '<button class="eikon-btn oos-act-btn" data-action="reject" data-id="' + item.id + '">Keep OOS</button>';
      } else if (item.status === "removal_requested") {
        html += '<button class="eikon-btn primary oos-act-btn" data-action="approve_back_in_stock" data-id="' + item.id + '">Approve Removal</button>';
        html += '<button class="eikon-btn oos-act-btn" data-action="reject_removal" data-id="' + item.id + '">Deny</button>';
      }
      html += '<span class="oos-del" data-del="' + item.id + '" title="Delete">&#x2715;</span>';
    } else {
      // Pharmacy actions
      if (item.source === "admin" || (item.source === "pharmacy" && item.status === "active")) {
        // Admin-owned or approved item: pharmacy can mark back in stock or request removal
        if (item.status === "active") {
          html += '<button class="eikon-btn oos-act-btn" data-action="mark_back_in_stock" data-id="' + item.id + '">Back in Stock</button>';
        } else if (item.status === "back_in_stock") {
          html += '<span style="font-size:10px;color:#22c55e;">Awaiting admin confirmation</span>';
        } else if (item.status === "removal_requested") {
          html += '<span style="font-size:10px;color:#a855f7;">Removal requested</span>';
        }
      } else if (isMyPharmacyItem && item.status === "pending") {
        // My own pending item: I can delete it
        html += '<span class="oos-del" data-del="' + item.id + '" title="Remove">&#x2715;</span>';
      } else if (item.status === "pending") {
        html += '<span style="font-size:10px;color:#f59e0b;">Pending admin approval</span>';
      }
    }

    html += '</div>';
    return html;
  }

  function renderTable() {
    var items = sortedFiltered();
    if (!items.length) return '<div class="oos-empty">' + (S.filterText ? 'No items match "' + esc(S.filterText) + '".' : 'No out of stock items listed.') + '</div>';

    var html = '<div class="oos-table-wrap"><table class="oos-table">';
    html += '<thead><tr>';
    html += '<th data-sort="desc">Description' + sortArrow("desc") + '</th>';
    html += '<th>Status</th>';
    html += '<th data-sort="date">Date Added' + sortArrow("date") + '</th>';
    html += '<th>Source</th>';
    html += '<th>Actions</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function (item) {
      var isPharmacyItem = item.source === "pharmacy" && item.status !== "active";
      html += '<tr class="' + (isPharmacyItem ? 'oos-pharmacy-row' : '') + '">';
      html += '<td style="font-weight:600;">' + esc(item.description) + '</td>';
      html += '<td>' + statusPill(item.status) + '</td>';
      html += '<td>' + formatDate(item.created_at) + '</td>';
      html += '<td style="font-size:11px;color:var(--muted);">' + (item.source === "admin" ? "Admin" : esc(item.source_location_name || "Pharmacy")) + '</td>';
      html += '<td>' + renderActions(item) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  function renderAll() {
    var mount = S.mount;
    if (!mount) return;
    var html = '';

    html += '<div class="oos-toolbar">';
    html += '<button class="eikon-btn primary" id="oos-add-btn" style="font-size:12px;padding:8px 14px;">+ Add OOS Item</button>';
    html += '<button class="eikon-btn" id="oos-print-btn" style="font-size:12px;padding:8px 14px;">Print</button>';
    html += '<input class="eikon-input oos-filter" id="oos-filter" type="text" placeholder="Search OOS list..." value="' + esc(S.filterText) + '"/>';
    html += '<span class="oos-count">' + S.items.length + ' items</span>';
    html += '<button class="eikon-btn" id="oos-refresh" style="font-size:11px;padding:5px 10px;">Refresh</button>';
    html += '</div>';

    html += renderTable();

    mount.innerHTML = html;
    wireEvents();
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  var _delConfirm = {};

  function wireEvents() {
    var addBtn = document.getElementById("oos-add-btn");
    var printBtn = document.getElementById("oos-print-btn");
    var refreshBtn = document.getElementById("oos-refresh");
    var filterEl = document.getElementById("oos-filter");

    if (addBtn) addBtn.onclick = function () { openAddModal(); };
    if (printBtn) printBtn.onclick = function () { window.print(); };
    if (refreshBtn) refreshBtn.onclick = function () { refresh(); };

    // Filter
    if (filterEl) {
      var filterT = null;
      filterEl.oninput = function () {
        clearTimeout(filterT);
        filterT = setTimeout(function () {
          S.filterText = filterEl.value;
          renderAll();
          var el = document.getElementById("oos-filter");
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, 200);
      };
    }

    // Sortable headers
    S.mount.querySelectorAll("[data-sort]").forEach(function (th) {
      th.onclick = function () {
        var col = th.getAttribute("data-sort");
        if (S.sortBy === col) S.sortDir = S.sortDir === "asc" ? "desc" : "asc";
        else { S.sortBy = col; S.sortDir = col === "date" ? "desc" : "asc"; }
        renderAll();
      };
    });

    // Action buttons (approve, reject, mark_back_in_stock, etc.)
    S.mount.querySelectorAll("[data-action][data-id]").forEach(function (btn) {
      btn.onclick = function () {
        var action = btn.getAttribute("data-action");
        var id = btn.getAttribute("data-id");
        if (action === "reject_removal") {
          // Reject removal = set back to active
          updateOos(id, "approve").then(function () { toast("Item kept on OOS list."); refresh(); })
            .catch(function (err) { toast((err && err.message) || "Failed", "error"); });
          return;
        }
        updateOos(id, action).then(function () {
          var msgs = { approve: "Approved.", reject: "Rejected.", approve_back_in_stock: "Removed from OOS list.", mark_back_in_stock: "Marked as back in stock. Pending admin confirmation.", request_removal: "Removal requested." };
          toast(msgs[action] || "Updated.");
          refresh();
        }).catch(function (err) { toast((err && err.message) || "Failed", "error"); });
      };
    });

    // Delete buttons
    S.mount.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-del");
        if (!_delConfirm.id || _delConfirm.id !== id || Date.now() > _delConfirm.until) {
          _delConfirm = { id: id, until: Date.now() + 4000 };
          toast("Click again to confirm removal.", "warn");
          return;
        }
        _delConfirm = {};
        deleteOos(id).then(function () { toast("Removed."); refresh(); })
          .catch(function (err) { toast((err && err.message) || "Failed", "error"); });
      };
    });
  }

  function toast(msg, type) { if (E.toast) E.toast(msg, type); }

  function refresh() { loadItems().then(function () { renderAll(); }); }

  /* ── add OOS modal ───────────────────────────────────────────────────── */
  function openAddModal() {
    var body =
      '<div class="eikon-field"><div class="eikon-label" style="font-size:13px;margin-bottom:6px;">Item Description</div>' +
      '<div style="position:relative;">' +
      '<input class="eikon-input" id="oos-add-desc" type="text" placeholder="Type to search catalog or enter custom name..." autocomplete="off" style="width:100%;font-size:15px;padding:10px 12px;"/>' +
      '<div id="oos-suggest" class="oos-suggest" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:10;max-height:320px;background:var(--card-bg,#0f1622);"></div>' +
      '</div>' +
      '<div style="margin-top:4px;font-size:11px;color:var(--muted);">Search catalog or type a custom product name.</div>' +
      '</div>';

    E.modal.show("Add Out of Stock Item", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Add to OOS List", primary: true, onClick: function () { submitOos(); } }
    ]);

    loadCatalog();

    setTimeout(function () {
      var descEl = document.getElementById("oos-add-desc");
      var suggestEl = document.getElementById("oos-suggest");
      if (!descEl || !suggestEl) return;
      descEl.focus();

      var searchT = null;
      descEl.oninput = function () {
        clearTimeout(searchT);
        searchT = setTimeout(function () {
          var q = (descEl.value || "").trim().toLowerCase();
          if (q.length < 2) { suggestEl.style.display = "none"; suggestEl.innerHTML = ""; return; }
          loadCatalog().then(function (products) {
            var matches = searchCatalog(products, q);
            var rawName = (descEl.value || "").trim();
            var html = '<div class="oos-suggest-item" data-pname="' + esc(rawName) + '" style="background:rgba(90,162,255,.06);font-weight:600;">' +
              'Use: "' + esc(rawName) + '"</div>';
            if (matches.length) {
              html += matches.map(function (m) {
                return '<div class="oos-suggest-item" data-pname="' + esc(m.product.name) + '">' + esc(m.product.name) + '</div>';
              }).join("");
            }
            suggestEl.innerHTML = html;
            suggestEl.querySelectorAll(".oos-suggest-item").forEach(function (el) {
              el.onclick = function () {
                descEl.value = el.getAttribute("data-pname");
                suggestEl.style.display = "none";
              };
            });
            suggestEl.style.display = "";
          });
        }, 150);
      };

      document.addEventListener("click", function handler(e) {
        if (!descEl.contains(e.target) && !suggestEl.contains(e.target)) suggestEl.style.display = "none";
      });
    }, 50);
  }

  function submitOos() {
    var descEl = document.getElementById("oos-add-desc");
    if (!descEl) return;
    var desc = descEl.value.trim();
    if (!desc) { toast("Description required.", "error"); return; }

    // Check for exact duplicate in OOS list
    var exactDup = S.items.find(function (it) { return it.description.toLowerCase() === desc.toLowerCase(); });
    if (exactDup) {
      toast("This item is already on the OOS list.", "error");
      return;
    }

    // Check for similar items in OOS list
    var bestMatch = null, bestScore = 0;
    S.items.forEach(function (it) {
      var score = nameSimilarity(desc, it.description);
      if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
        bestScore = score;
        bestMatch = it;
      }
    });

    if (bestMatch) {
      showDuplicateWarning(desc, bestMatch);
      return;
    }

    // Check catalog for similar items (suggest proper name)
    loadCatalog().then(function (products) {
      var bestCat = null, bestCatScore = 0;
      products.forEach(function (p) {
        var score = nameSimilarity(desc, p.name);
        if (score >= SIMILARITY_THRESHOLD && score > bestCatScore) {
          bestCatScore = score;
          bestCat = p;
        }
      });

      if (bestCat && bestCat.name.toLowerCase() !== desc.toLowerCase()) {
        showCatalogSuggestion(desc, bestCat.name);
      } else {
        doSaveOos(desc);
      }
    });
  }

  function showDuplicateWarning(desc, existing) {
    E.modal.show("Possible Duplicate",
      '<div style="font-size:13px;margin-bottom:10px;">This looks similar to an item already on the OOS list:</div>' +
      '<div class="oos-sim-warn"><b>' + esc(existing.description) + '</b><br/>' +
      '<span style="font-size:11px;">Added ' + formatDate(existing.created_at) + '</span></div>' +
      '<div style="margin-top:12px;font-size:13px;">Is this a different item?</div>',
      [
        { label: "No, it's the same", danger: true, onClick: function () { E.modal.hide(); toast("Duplicate prevented."); } },
        { label: "Yes, add anyway", onClick: function () { E.modal.hide(); doSaveOos(desc); } }
      ]);
  }

  function showCatalogSuggestion(desc, catalogName) {
    E.modal.show("Similar Catalog Item Found",
      '<div style="font-size:13px;margin-bottom:10px;">A similar product exists in the catalog:</div>' +
      '<div class="oos-sim-warn"><b>' + esc(catalogName) + '</b></div>' +
      '<div style="margin-top:12px;font-size:13px;">Use the catalog name for consistency?</div>',
      [
        { label: "No, keep my name", onClick: function () { E.modal.hide(); doSaveOos(desc); } },
        { label: "Yes, use catalog name", primary: true, onClick: function () { E.modal.hide(); doSaveOos(catalogName); } }
      ]);
  }

  function doSaveOos(desc) {
    createOos(desc)
      .then(function () { E.modal.hide(); toast("Added to OOS list."); refresh(); })
      .catch(function (err) { toast("Failed: " + ((err && err.message) || "error"), "error"); });
  }

  /* ── auto-refresh ────────────────────────────────────────────────────── */
  var _autoRefreshTimer = null;
  function startAutoRefresh() {
    stopAutoRefresh();
    _autoRefreshTimer = setInterval(function () {
      if (S.mount && E.state.activeModuleId === "cherubino-oos") refresh();
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
    S.isAdmin = S.user && Number(S.user.location_id) >= 600;
    S.filterText = "";
    S.sortBy = "date";
    S.sortDir = "desc";
    ensureStyles();
    S.mount.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading...</div>';
    await loadItems();
    renderAll();
    startAutoRefresh();
  }

  E.registerModule({
    id: "cherubino-oos",
    title: "OOS List",
    order: 903,
    icon: "\uD83C\uDFE5",
    render: render,
    destroy: function () { stopAutoRefresh(); S.mount = null; }
  });

})();
