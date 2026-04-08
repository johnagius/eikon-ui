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

  /* ── ngram similarity (bigram Dice coefficient) ──────────────────────── */
  function bigrams(str) {
    var s = String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    var bg = {};
    for (var i = 0; i < s.length - 1; i++) {
      var pair = s.charAt(i) + s.charAt(i + 1);
      bg[pair] = (bg[pair] || 0) + 1;
    }
    return bg;
  }

  function ngramScore(a, b) {
    if (!a || !b) return 0;
    var bgA = bigrams(a), bgB = bigrams(b);
    var intersection = 0, totalA = 0, totalB = 0;
    var k;
    for (k in bgA) totalA += bgA[k];
    for (k in bgB) totalB += bgB[k];
    if (!totalA || !totalB) return 0;
    for (k in bgA) {
      if (bgB[k]) intersection += Math.min(bgA[k], bgB[k]);
    }
    return (2 * intersection) / (totalA + totalB);
  }

  var SIMILARITY_THRESHOLD = 0.7;

  /* ── Jaro-Winkler similarity (state of the art for name matching) ──── */
  function jaroSimilarity(s1, s2) {
    if (s1 === s2) return 1;
    var len1 = s1.length, len2 = s2.length;
    if (!len1 || !len2) return 0;
    var matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
    var s1m = new Array(len1), s2m = new Array(len2);
    var matches = 0, transpositions = 0;
    for (var i = 0; i < len1; i++) {
      var lo = Math.max(0, i - matchDist), hi = Math.min(i + matchDist + 1, len2);
      for (var j = lo; j < hi; j++) {
        if (s2m[j] || s1.charAt(i) !== s2.charAt(j)) continue;
        s1m[i] = true; s2m[j] = true; matches++; break;
      }
    }
    if (!matches) return 0;
    var k = 0;
    for (var i = 0; i < len1; i++) {
      if (!s1m[i]) continue;
      while (!s2m[k]) k++;
      if (s1.charAt(i) !== s2.charAt(k)) transpositions++;
      k++;
    }
    return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  }

  function jaroWinkler(s1, s2) {
    var j = jaroSimilarity(s1, s2);
    if (j <= 0) return 0;
    var prefix = 0;
    for (var i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
      if (s1.charAt(i) === s2.charAt(i)) prefix++;
      else break;
    }
    return j + prefix * 0.1 * (1 - j);
  }

  /* ── Damerau-Levenshtein distance (gold standard for typo detection) ── */
  function damerauLev(a, b) {
    var la = a.length, lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
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

  /* ── catalog search (Algolia/Typesense-style) ────────────────────────── */
  function scoreToken(tok, nameWords, name, barcode) {
    // 1. Word-prefix match (highest priority — this is what users expect)
    for (var w = 0; w < nameWords.length; w++) {
      if (nameWords[w].indexOf(tok) === 0) {
        return 3.0 + tok.length / nameWords[w].length;
      }
    }
    // 2. Substring anywhere in name
    if (name.indexOf(tok) >= 0) return 2.0;
    // 3. Barcode match
    if (barcode.indexOf(tok) >= 0) return 2.5;
    // 4. Fuzzy prefix — edit distance on word prefixes (typo tolerance)
    var allowed = maxTypos(tok.length);
    if (allowed > 0) {
      var best = 0;
      for (var w = 0; w < nameWords.length; w++) {
        var word = nameWords[w];
        // Compare against prefix of similar length
        var pre = word.substring(0, Math.min(tok.length + 1, word.length));
        var dist = damerauLev(tok, pre);
        if (dist <= allowed) {
          var s = 1.5 - dist * 0.4;
          if (s > best) best = s;
        }
        // Also compare against full short words
        if (word.length <= tok.length + 2) {
          dist = damerauLev(tok, word);
          if (dist <= allowed) {
            var s = 1.5 - dist * 0.4;
            if (s > best) best = s;
          }
        }
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

      var coverage = matched / tokens.length;
      var score;
      if (matched === tokens.length) {
        score = totalScore / tokens.length;
      } else if (coverage >= 0.5 && tokens.length >= 2) {
        score = (totalScore / tokens.length) * coverage * 0.3;
      } else {
        continue;
      }

      if (name.indexOf(q) >= 0) score += 3.0;
      score -= name.length * 0.0003;
      results.push({ product: p, score: score });
    }

    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 15);
  }

  /* ── state ───────────────────────────────────────────────────────────── */
  var S = {
    date: todayYmd(),
    allOrders: [],
    catalogCache: null,
    mount: null,
    user: null
  };

  /* ── API helpers ─────────────────────────────────────────────────────── */
  function loadOrders() {
    return E.apiFetch("/cherubino/orders?date=" + S.date + "&all_org=1", { method: "GET" })
      .then(function (r) { S.allOrders = r.orders || []; })
      .catch(function (err) {
        E.error && E.error("[cherubino-orders] load error", err);
        S.allOrders = [];
      });
  }

  function addOrder(description, quantity) {
    return E.apiFetch("/cherubino/orders", {
      method: "POST",
      body: JSON.stringify({ description: description, quantity: quantity, order_date: S.date })
    });
  }

  function deleteOrder(id) {
    return E.apiFetch("/cherubino/orders/" + id, { method: "DELETE" });
  }

  function loadCatalog() {
    if (S.catalogCache !== null && S.catalogCache.length > 0) return Promise.resolve(S.catalogCache);
    // Check cached catalog (only use if non-empty)
    try {
      var cached = JSON.parse(window.localStorage.getItem("eikon_cherubino_catalog") || "null");
      if (cached && cached.length) { S.catalogCache = cached; return Promise.resolve(cached); }
    } catch (e) {}
    // Fetch all pages
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

  /* ── derived data ────────────────────────────────────────────────────── */
  function myOrders() {
    var lid = S.user ? Number(S.user.location_id) : -1;
    return S.allOrders.filter(function (o) { return Number(o.location_id) === lid; });
  }
  function otherOrders() {
    var lid = S.user ? Number(S.user.location_id) : -1;
    return S.allOrders.filter(function (o) { return Number(o.location_id) !== lid; });
  }
  function otherLocationGroups() {
    var others = otherOrders();
    var byLoc = {};
    others.forEach(function (o) {
      var key = o.location_id;
      if (!byLoc[key]) byLoc[key] = { location_name: o.location_name || ("Location " + key), orders: [] };
      byLoc[key].orders.push(o);
    });
    return byLoc;
  }

  /* ── grouping for right panel ────────────────────────────────────────── */
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
        if (ngramScore(group.name, all[j].description) >= SIMILARITY_THRESHOLD) {
          group.items.push(all[j]);
          used[j] = true;
        }
      }
      groups.push(group);
    }
    return groups;
  }

  /* ── styles ──────────────────────────────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById("co-styles")) return;
    var st = document.createElement("style");
    st.id = "co-styles";
    st.textContent =
      '.co-wrap{display:flex;gap:16px;height:calc(100vh - 100px);overflow:hidden;}' +
      '.co-left{flex:2;overflow-y:auto;padding-right:8px;}' +
      '.co-right{flex:1;overflow-y:auto;border-left:1px solid var(--border);padding-left:16px;}' +
      '.co-date-nav{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;}' +
      '.co-date-nav button{font-size:12px;padding:6px 12px;}' +
      '.co-date-label{font-weight:800;font-size:14px;min-width:180px;text-align:center;}' +
      '.co-section{margin-bottom:18px;border:1px solid var(--border);border-radius:12px;overflow:hidden;}' +
      '.co-section-my{border-color:rgba(90,162,255,.45);background:rgba(90,162,255,.06);}' +
      '.co-section-other{background:rgba(255,255,255,.02);}' +
      '.co-section-head{padding:10px 14px;font-weight:800;font-size:13px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}' +
      '.co-section-my .co-section-head{background:rgba(90,162,255,.10);color:rgba(90,162,255,1);border-color:rgba(90,162,255,.25);}' +
      '.co-section-other .co-section-head{background:rgba(255,255,255,.04);}' +
      '.co-item{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px;}' +
      '.co-item:last-child{border-bottom:none;}' +
      '.co-item-desc{flex:1;font-weight:600;}' +
      '.co-item-qty{min-width:40px;text-align:center;font-weight:700;color:var(--muted);}' +
      '.co-item-cb{display:flex;gap:8px;align-items:center;font-size:11px;color:var(--muted);}' +
      '.co-item-cb label{display:flex;align-items:center;gap:3px;cursor:default;}' +
      '.co-item-cb input{pointer-events:none;opacity:.5;}' +
      '.co-item-del{cursor:pointer;color:rgba(255,90,122,.7);font-size:14px;padding:2px 4px;}' +
      '.co-item-del:hover{color:rgba(255,90,122,1);}' +
      '.co-empty{padding:14px;color:var(--muted);font-size:12px;text-align:center;}' +
      '.co-group-card{border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:10px;background:rgba(255,255,255,.02);}' +
      '.co-group-name{font-weight:800;font-size:13px;margin-bottom:6px;}' +
      '.co-group-total{font-size:12px;color:var(--muted);margin-bottom:4px;}' +
      '.co-group-loc{font-size:11px;color:var(--muted);line-height:1.5;}' +
      '.co-group-status{display:flex;gap:8px;margin-top:6px;font-size:10px;color:var(--muted);}' +
      '.co-group-status span{display:flex;align-items:center;gap:2px;}' +
      '.co-right-title{font-weight:900;font-size:14px;margin-bottom:12px;}' +
      '.co-search-input{width:100%;margin-bottom:8px;}' +
      '.co-search-results{max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;}' +
      '.co-search-item{padding:8px 10px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border);}' +
      '.co-search-item:last-child{border-bottom:none;}' +
      '.co-search-item:hover{background:rgba(90,162,255,.1);}' +
      '.co-sim-match{margin-top:8px;padding:10px;border:1px solid rgba(255,180,50,.4);border-radius:8px;background:rgba(255,180,50,.06);font-size:12px;}' +
      '.co-sim-match b{color:rgba(255,180,50,1);}';
    document.head.appendChild(st);
  }

  /* ── rendering ───────────────────────────────────────────────────────── */
  function renderCheckboxes(o) {
    return '<div class="co-item-cb">' +
      '<label><input type="checkbox" ' + (o.oos ? "checked" : "") + ' disabled/> OOS</label>' +
      '<label><input type="checkbox" ' + (o.ordered ? "checked" : "") + ' disabled/> Ordered</label>' +
      '<label><input type="checkbox" ' + (o.available_wsl ? "checked" : "") + ' disabled/> Avail. WSL</label>' +
      '<label><input type="checkbox" ' + (o.pending_wsl ? "checked" : "") + ' disabled/> Pending WSL</label>' +
      '</div>';
  }

  function renderItem(o, canDelete) {
    return '<div class="co-item">' +
      '<div class="co-item-desc">' + esc(o.description) + '</div>' +
      '<div class="co-item-qty">x' + esc(o.quantity) + '</div>' +
      renderCheckboxes(o) +
      (canDelete ? '<span class="co-item-del" data-del="' + o.id + '" title="Remove">&#x2715;</span>' : '') +
      '</div>';
  }

  function renderLeftPanel() {
    var my = myOrders();
    var locName = S.user ? (S.user.location_name || "My Pharmacy") : "My Pharmacy";
    var html = '';

    // Add item button
    html += '<div style="margin-bottom:12px;"><button class="eikon-btn primary" id="co-add-btn" style="font-size:12px;padding:8px 14px;">+ Add Item</button></div>';

    // My pharmacy section
    html += '<div class="co-section co-section-my">';
    html += '<div class="co-section-head">' + esc(locName) + ' <span style="font-size:11px;font-weight:400;opacity:.7;">(Your pharmacy)</span></div>';
    if (!my.length) {
      html += '<div class="co-empty">No items ordered for this date.</div>';
    } else {
      my.forEach(function (o) { html += renderItem(o, true); });
    }
    html += '</div>';

    // Other locations
    var others = otherLocationGroups();
    var keys = Object.keys(others);
    if (keys.length) {
      keys.forEach(function (lid) {
        var loc = others[lid];
        html += '<div class="co-section co-section-other">';
        html += '<div class="co-section-head">' + esc(loc.location_name) + '</div>';
        loc.orders.forEach(function (o) { html += renderItem(o, false); });
        html += '</div>';
      });
    }
    return html;
  }

  function renderRightPanel() {
    var groups = buildGroupedView();
    var html = '<div class="co-right-title">Grouped View</div>';
    if (!groups.length) {
      html += '<div class="co-empty">No orders to group.</div>';
      return html;
    }
    groups.forEach(function (g) {
      var totalQty = 0;
      var byLoc = {};
      var anyOos = false, anyOrdered = false, anyAvail = false, anyPending = false;
      g.items.forEach(function (item) {
        totalQty += item.quantity;
        var ln = item.location_name || ("Location " + item.location_id);
        if (!byLoc[ln]) byLoc[ln] = 0;
        byLoc[ln] += item.quantity;
        if (item.oos) anyOos = true;
        if (item.ordered) anyOrdered = true;
        if (item.available_wsl) anyAvail = true;
        if (item.pending_wsl) anyPending = true;
      });
      html += '<div class="co-group-card">';
      html += '<div class="co-group-name">' + esc(g.name) + '</div>';
      html += '<div class="co-group-total">Total: x' + totalQty + ' across ' + Object.keys(byLoc).length + ' location' + (Object.keys(byLoc).length > 1 ? "s" : "") + '</div>';
      var locLines = [];
      for (var ln in byLoc) locLines.push(esc(ln) + ': x' + byLoc[ln]);
      html += '<div class="co-group-loc">' + locLines.join('<br/>') + '</div>';
      html += '<div class="co-group-status">';
      if (anyOos) html += '<span>OOS</span>';
      if (anyOrdered) html += '<span>Ordered</span>';
      if (anyAvail) html += '<span>Avail. WSL</span>';
      if (anyPending) html += '<span>Pending WSL</span>';
      html += '</div>';
      html += '</div>';
    });
    return html;
  }

  function renderAll() {
    var mount = S.mount;
    if (!mount) return;

    var today = todayYmd();
    var min = minDate();
    var prevDisabled = S.date <= min ? " disabled" : "";
    var nextDisabled = S.date >= today ? " disabled" : "";

    mount.innerHTML =
      '<div class="co-date-nav">' +
      '<button class="eikon-btn" id="co-prev"' + prevDisabled + '>&laquo; Prev</button>' +
      '<div class="co-date-label">' + formatDateLabel(S.date) + '</div>' +
      '<button class="eikon-btn" id="co-next"' + nextDisabled + '>Next &raquo;</button>' +
      '<button class="eikon-btn primary" id="co-today" style="margin-left:6px;">Today</button>' +
      '</div>' +
      '<div class="co-wrap">' +
      '<div class="co-left" id="co-left">' + renderLeftPanel() + '</div>' +
      '<div class="co-right" id="co-right">' + renderRightPanel() + '</div>' +
      '</div>';

    wireEvents();
  }

  /* ── event wiring ────────────────────────────────────────────────────── */
  function wireEvents() {
    var prevBtn = document.getElementById("co-prev");
    var nextBtn = document.getElementById("co-next");
    var todayBtn = document.getElementById("co-today");
    var addBtn = document.getElementById("co-add-btn");

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
    if (addBtn) addBtn.onclick = function () { openAddModal(); };

    // Delete buttons
    var dels = document.querySelectorAll("[data-del]");
    dels.forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-del");
        if (!_delConfirm.id || _delConfirm.id !== id || Date.now() > _delConfirm.until) {
          _delConfirm = { id: id, until: Date.now() + 4000 };
          toast("Click again to confirm delete.", "warn");
          return;
        }
        _delConfirm = {};
        deleteOrder(id).then(function () { toast("Item removed."); refresh(); })
          .catch(function () { toast("Failed to delete.", "error"); });
      };
    });
  }
  var _delConfirm = {};

  function toast(msg, type) {
    if (E.toast) E.toast(msg, type);
    else if (type === "error") E.error && E.error("[cherubino-orders]", msg);
  }

  function refresh() {
    loadOrders().then(function () { renderAll(); });
  }

  /* ── add item modal ──────────────────────────────────────────────────── */
  function openAddModal() {
    var body =
      '<div class="eikon-field"><div class="eikon-label">Item Description</div>' +
      '<div style="position:relative;">' +
      '<input class="eikon-input" id="co-add-desc" type="text" placeholder="Type to search catalog or enter custom name..." autocomplete="off" style="width:100%;"/>' +
      '<div id="co-suggest" class="co-search-results" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:10;max-height:220px;background:var(--card-bg,#0f1622);"></div>' +
      '</div>' +
      '<div style="margin-top:4px;font-size:11px;color:var(--muted);">Start typing to see suggestions from the product catalog.</div>' +
      '</div>' +
      '<div class="eikon-field" style="margin-top:10px;"><div class="eikon-label">Quantity</div>' +
      '<input class="eikon-input" id="co-add-qty" type="number" min="1" value="1" style="width:80px;"/></div>';

    E.modal.show("Add Order Item", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Add", primary: true, onClick: function () { submitAdd(); } }
    ]);

    // Pre-load catalog in background
    loadCatalog().then(function (p) {
      try { console.log("[cherubino-orders] catalog loaded:", (p || []).length, "products"); } catch(e){}
    });

    // Wire autosuggest on the single input
    setTimeout(function () {
      var descEl = document.getElementById("co-add-desc");
      var suggestEl = document.getElementById("co-suggest");
      if (!descEl || !suggestEl) return;

      var searchT = null;
      descEl.oninput = function () {
        clearTimeout(searchT);
        searchT = setTimeout(function () {
          var q = (descEl.value || "").trim().toLowerCase();
          if (q.length < 2) { suggestEl.style.display = "none"; suggestEl.innerHTML = ""; return; }
          loadCatalog().then(function (products) {
            var matches = searchCatalog(products, q);
            if (!matches.length) {
              suggestEl.innerHTML = '<div class="co-empty">No catalog matches. You can still type a custom name.</div>';
            } else {
              suggestEl.innerHTML = matches.map(function (m) {
                var p = m.product;
                return '<div class="co-search-item" data-pname="' + esc(p.name) + '">' + esc(p.name) +
                  (p.barcode ? ' <span style="color:var(--muted);font-size:10px;">(' + esc(p.barcode) + ')</span>' : '') + '</div>';
              }).join("");
              suggestEl.querySelectorAll(".co-search-item").forEach(function (el) {
                el.onclick = function () {
                  descEl.value = el.getAttribute("data-pname");
                  suggestEl.style.display = "none";
                };
              });
            }
            suggestEl.style.display = "";
          });
        }, 150);
      };

      // Hide suggestions when clicking outside
      document.addEventListener("click", function handler(e) {
        if (!descEl.contains(e.target) && !suggestEl.contains(e.target)) {
          suggestEl.style.display = "none";
        }
      });
    }, 50);
  }

  function submitAdd() {
    var descEl = document.getElementById("co-add-desc");
    var qtyEl = document.getElementById("co-add-qty");
    if (!descEl || !qtyEl) return;

    var desc = descEl.value.trim();
    var qty = parseInt(qtyEl.value) || 1;
    if (!desc) { toast("Description required.", "error"); return; }

    // Step 1: Check for similar items in OTHER locations' orders
    var othersItems = otherOrders();
    var bestOtherMatch = null;
    var bestOtherScore = 0;
    othersItems.forEach(function (o) {
      var score = ngramScore(desc, o.description);
      if (score >= SIMILARITY_THRESHOLD && score > bestOtherScore) {
        bestOtherScore = score;
        bestOtherMatch = o;
      }
    });

    if (bestOtherMatch) {
      showSimilarityModal(desc, qty, bestOtherMatch);
      return;
    }

    // Step 2: Check for duplicates in OWN orders
    checkDuplicateAndSave(desc, qty);
  }

  function showSimilarityModal(desc, qty, matchedOrder) {
    var body =
      '<div style="font-size:13px;margin-bottom:10px;">A similar item was found in another location\'s order:</div>' +
      '<div class="co-sim-match">' +
      '<b>' + esc(matchedOrder.description) + '</b><br/>' +
      '<span style="font-size:11px;">Ordered by ' + esc(matchedOrder.location_name) + ' (x' + matchedOrder.quantity + ')</span>' +
      '</div>' +
      '<div style="margin-top:12px;font-size:12px;">Use <b>"' + esc(matchedOrder.description) + '"</b> as the item name for better grouping?</div>';

    E.modal.show("Similar Item Found", body, [
      { label: "No, keep my name", onClick: function () {
        E.modal.hide();
        checkDuplicateAndSave(desc, qty);
      }},
      { label: "Yes, use this name", primary: true, onClick: function () {
        E.modal.hide();
        checkDuplicateAndSave(matchedOrder.description, qty);
      }}
    ]);
  }

  function checkDuplicateAndSave(desc, qty) {
    var mine = myOrders();
    var bestDup = null;
    var bestDupScore = 0;
    mine.forEach(function (o) {
      var score = ngramScore(desc, o.description);
      if (score >= SIMILARITY_THRESHOLD && score > bestDupScore) {
        bestDupScore = score;
        bestDup = o;
      }
    });

    if (bestDup) {
      showDuplicateModal(desc, qty, bestDup);
      return;
    }

    doSave(desc, qty);
  }

  function showDuplicateModal(desc, qty, existingOrder) {
    var body =
      '<div style="font-size:13px;margin-bottom:10px;">This looks similar to an item already in your order:</div>' +
      '<div class="co-sim-match">' +
      '<b>' + esc(existingOrder.description) + '</b> (x' + existingOrder.quantity + ')' +
      '</div>' +
      '<div style="margin-top:12px;font-size:12px;">Is this a duplicate?</div>';

    E.modal.show("Possible Duplicate", body, [
      { label: "No, it's different", onClick: function () {
        E.modal.hide();
        doSave(desc, qty);
      }},
      { label: "Yes, it's a duplicate", danger: true, onClick: function () {
        E.modal.hide();
        toast("Duplicate prevented.");
      }}
    ]);
  }

  function doSave(desc, qty) {
    addOrder(desc, qty)
      .then(function () {
        E.modal.hide();
        toast("Item added.");
        refresh();
      })
      .catch(function (err) {
        toast("Failed to add: " + (err && err.message || "error"), "error");
      });
  }

  /* ── main render ─────────────────────────────────────────────────────── */
  async function render(ctx) {
    S.mount = ctx.mount;
    S.user = ctx.user;
    ensureStyles();
    S.mount.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading orders...</div>';
    await loadOrders();
    renderAll();
  }

  /* ── register ────────────────────────────────────────────────────────── */
  E.registerModule({
    id: "cherubino-orders",
    title: "Orders",
    order: 900,
    icon: "\uD83C\uDFE5",
    render: render
  });

})();
