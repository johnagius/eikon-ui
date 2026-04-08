(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  /* ── helpers ──────────────────────────────────────────────────────────── */
  function esc(s) { return E.escapeHtml(String(s || "")); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function todayYmd() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return days[d.getDay()] + ", " + d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }
  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function dateKey(iso) {
    if (!iso) return "";
    return iso.substring(0, 10);
  }
  function formatPrice(p) {
    return (parseFloat(p) || 0).toFixed(2);
  }

  /* ── Damerau-Levenshtein + search (reuse from orders module) ─────── */
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
      var coverage = matched / tokens.length;
      var score;
      if (matched === tokens.length) { score = totalScore / tokens.length; }
      else if (coverage >= 0.5 && tokens.length >= 2) { score = (totalScore / tokens.length) * coverage * 0.3; }
      else continue;
      if (name.indexOf(q) >= 0) score += 3.0;
      score -= name.length * 0.0003;
      results.push({ product: p, score: score });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 15);
  }

  /* ── state ───────────────────────────────────────────────────────────── */
  var S = {
    changes: [],
    catalogCache: null,
    mount: null,
    user: null
  };

  /* ── API ─────────────────────────────────────────────────────────────── */
  function loadChanges() {
    return E.apiFetch("/cherubino/price-changes?limit=200", { method: "GET" })
      .then(function (r) { S.changes = r.changes || []; })
      .catch(function () { S.changes = []; });
  }

  function createChange(productName, oldPrice, newPrice) {
    return E.apiFetch("/cherubino/price-changes", {
      method: "POST",
      body: JSON.stringify({ product_name: productName, old_price: oldPrice, new_price: newPrice })
    });
  }

  function checkChange(id) {
    return E.apiFetch("/cherubino/price-changes/" + id + "/check", { method: "POST" });
  }

  function uncheckChange(id) {
    return E.apiFetch("/cherubino/price-changes/" + id + "/check", { method: "DELETE" });
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
    if (document.getElementById("cp-styles")) return;
    var st = document.createElement("style");
    st.id = "cp-styles";
    st.textContent =
      '.cp-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;}' +
      '.cp-list{max-height:calc(100vh - 130px);overflow-y:auto;}' +
      '.cp-day-header{padding:10px 0;font-weight:900;font-size:14px;border-bottom:2px solid var(--border);margin-bottom:10px;margin-top:18px;color:var(--muted);}' +
      '.cp-day-header:first-child{margin-top:0;}' +
      '.cp-card{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:rgba(255,255,255,.02);flex-wrap:wrap;}' +
      '.cp-product{font-weight:700;font-size:13px;flex:1;min-width:200px;}' +
      '.cp-prices{display:flex;align-items:center;gap:6px;font-size:13px;min-width:180px;}' +
      '.cp-old{text-decoration:line-through;color:var(--muted);}' +
      '.cp-arrow-up{color:#22c55e;font-weight:900;}' +
      '.cp-arrow-down{color:#ef4444;font-weight:900;}' +
      '.cp-new{font-weight:800;}' +
      '.cp-meta{font-size:11px;color:var(--muted);min-width:150px;}' +
      '.cp-checks{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;}' +
      '.cp-check-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;}' +
      '.cp-check-done{background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3);}' +
      '.cp-check-pending{background:rgba(255,255,255,.04);color:var(--muted);border:1px solid var(--border);}' +
      '.cp-my-check{cursor:pointer;}' +
      '.cp-my-check:hover{opacity:.8;}' +
      '.cp-empty{padding:30px;color:var(--muted);font-size:13px;text-align:center;}' +
      '.cp-search-results{max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;}' +
      '.cp-search-item{padding:10px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;}' +
      '.cp-search-item:last-child{border-bottom:none;}' +
      '.cp-search-item:hover{background:rgba(90,162,255,.1);}' +
      '.cp-search-price{font-size:12px;color:var(--muted);}';
    document.head.appendChild(st);
  }

  /* ── rendering ───────────────────────────────────────────────────────── */
  function priceDirection(oldP, newP) {
    var o = parseFloat(oldP) || 0, n = parseFloat(newP) || 0;
    if (n > o) return '<span class="cp-arrow-up">&#9650;</span>';
    if (n < o) return '<span class="cp-arrow-down">&#9660;</span>';
    return '<span style="color:var(--muted);">=</span>';
  }

  function renderChangeCard(c) {
    var myLocId = S.user ? Number(S.user.location_id) : -1;
    var isAdmin = S.user && Number(S.user.location_id) >= 600;
    var checks = c.checks || [];

    // Build check pills — show all locations' status
    var myChecked = checks.some(function (ch) { return Number(ch.location_id) === myLocId; });
    var checkHtml = '<div class="cp-checks">';

    // My location check (clickable for pharmacies)
    if (!isAdmin) {
      checkHtml += '<span class="cp-check-pill cp-my-check ' + (myChecked ? 'cp-check-done' : 'cp-check-pending') + '" data-check-id="' + c.id + '" data-checked="' + (myChecked ? '1' : '0') + '">' +
        (myChecked ? '&#10003; Checked' : 'Mark checked') + '</span>';
    }

    // Show all location check statuses
    checks.forEach(function (ch) {
      checkHtml += '<span class="cp-check-pill cp-check-done" title="Checked by ' + esc(ch.checked_by_name) + ' at ' + esc(ch.checked_at) + '">' +
        '&#10003; ' + esc(ch.location_name) + '</span>';
    });
    checkHtml += '</div>';

    return '<div class="cp-card">' +
      '<div class="cp-product">' + esc(c.product_name) + '</div>' +
      '<div class="cp-prices">' +
        '<span class="cp-old">&euro;' + formatPrice(c.old_price) + '</span> ' +
        priceDirection(c.old_price, c.new_price) + ' ' +
        '<span class="cp-new">&euro;' + formatPrice(c.new_price) + '</span>' +
      '</div>' +
      '<div class="cp-meta">by ' + esc(c.changed_by_name) + ' (' + esc(c.location_name) + ')<br/>' + formatTime(c.created_at) + '</div>' +
      checkHtml +
      '</div>';
  }

  function renderAll() {
    var mount = S.mount;
    if (!mount) return;

    var html = '';

    // Toolbar
    html += '<div class="cp-toolbar">' +
      '<button class="eikon-btn primary" id="cp-add-btn" style="font-size:12px;padding:8px 14px;">+ New Price Change</button>' +
      '<button class="eikon-btn" id="cp-refresh" style="margin-left:auto;font-size:11px;padding:5px 10px;">Refresh</button>' +
      '</div>';

    // List grouped by date
    html += '<div class="cp-list">';
    if (!S.changes.length) {
      html += '<div class="cp-empty">No price changes recorded yet.</div>';
    } else {
      var currentDay = "";
      S.changes.forEach(function (c) {
        var day = dateKey(c.created_at);
        if (day !== currentDay) {
          currentDay = day;
          html += '<div class="cp-day-header">' + formatDate(c.created_at) + '</div>';
        }
        html += renderChangeCard(c);
      });
    }
    html += '</div>';

    mount.innerHTML = html;
    wireEvents();
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  function wireEvents() {
    var addBtn = document.getElementById("cp-add-btn");
    var refreshBtn = document.getElementById("cp-refresh");

    if (addBtn) addBtn.onclick = function () { openAddModal(); };
    if (refreshBtn) refreshBtn.onclick = function () { refresh(); };

    // Check/uncheck pills
    var pills = S.mount.querySelectorAll("[data-check-id]");
    pills.forEach(function (pill) {
      pill.onclick = function () {
        var id = pill.getAttribute("data-check-id");
        var isChecked = pill.getAttribute("data-checked") === "1";
        (isChecked ? uncheckChange(id) : checkChange(id))
          .then(function () { refresh(); })
          .catch(function (err) {
            if (E.toast) E.toast((err && err.message) || "Failed", "error");
          });
      };
    });
  }

  function toast(msg, type) {
    if (E.toast) E.toast(msg, type);
  }

  function refresh() {
    loadChanges().then(function () { renderAll(); });
  }

  /* ── add price change modal ──────────────────────────────────────────── */
  function openAddModal() {
    var body =
      '<div class="eikon-field"><div class="eikon-label" style="font-size:13px;margin-bottom:6px;">Search Product</div>' +
      '<div style="position:relative;">' +
      '<input class="eikon-input" id="cp-search" type="text" placeholder="Type to search catalog..." autocomplete="off" style="width:100%;font-size:15px;padding:10px 12px;"/>' +
      '<div id="cp-suggest" class="cp-search-results" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:10;max-height:320px;background:var(--card-bg,#0f1622);"></div>' +
      '</div>' +
      '</div>' +
      '<div id="cp-edit-section" style="display:none;margin-top:14px;">' +
      '<div style="font-weight:800;font-size:14px;margin-bottom:8px;" id="cp-selected-name"></div>' +
      '<div class="eikon-row" style="gap:14px;">' +
      '<div class="eikon-field"><div class="eikon-label">Current Price (&euro;)</div>' +
      '<input class="eikon-input" id="cp-old-price" type="number" step="0.01" min="0" style="width:100px;font-size:14px;padding:8px;" readonly/></div>' +
      '<div class="eikon-field"><div class="eikon-label">New Price (&euro;)</div>' +
      '<input class="eikon-input" id="cp-new-price" type="number" step="0.01" min="0" style="width:100px;font-size:14px;padding:8px;"/></div>' +
      '</div></div>';

    E.modal.show("New Price Change", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Save Price Change", primary: true, onClick: function () { submitPriceChange(); } }
    ]);

    loadCatalog();

    setTimeout(function () {
      var searchEl = document.getElementById("cp-search");
      var suggestEl = document.getElementById("cp-suggest");
      if (!searchEl || !suggestEl) return;

      searchEl.focus();

      var searchT = null;
      searchEl.oninput = function () {
        clearTimeout(searchT);
        searchT = setTimeout(function () {
          var q = (searchEl.value || "").trim().toLowerCase();
          if (q.length < 2) { suggestEl.style.display = "none"; suggestEl.innerHTML = ""; return; }
          loadCatalog().then(function (products) {
            var matches = searchCatalog(products, q);
            if (!matches.length) {
              suggestEl.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:12px;text-align:center;">No products found.</div>';
            } else {
              suggestEl.innerHTML = matches.map(function (m) {
                var p = m.product;
                return '<div class="cp-search-item" data-pname="' + esc(p.name) + '" data-pprice="' + (parseFloat(p.price) || 0) + '">' +
                  '<span>' + esc(p.name) + '</span>' +
                  '<span class="cp-search-price">&euro;' + formatPrice(p.price) + '</span>' +
                  '</div>';
              }).join("");
              suggestEl.querySelectorAll(".cp-search-item").forEach(function (el) {
                el.onclick = function () {
                  selectProduct(el.getAttribute("data-pname"), parseFloat(el.getAttribute("data-pprice")) || 0);
                  suggestEl.style.display = "none";
                  searchEl.value = "";
                };
              });
            }
            suggestEl.style.display = "";
          });
        }, 150);
      };
    }, 50);
  }

  function selectProduct(name, currentPrice) {
    var editSection = document.getElementById("cp-edit-section");
    var nameEl = document.getElementById("cp-selected-name");
    var oldPriceEl = document.getElementById("cp-old-price");
    var newPriceEl = document.getElementById("cp-new-price");
    if (!editSection || !nameEl || !oldPriceEl || !newPriceEl) return;

    editSection.style.display = "";
    nameEl.textContent = name;
    nameEl.setAttribute("data-product", name);
    oldPriceEl.value = formatPrice(currentPrice);
    newPriceEl.value = "";
    newPriceEl.focus();
  }

  function submitPriceChange() {
    var nameEl = document.getElementById("cp-selected-name");
    var oldPriceEl = document.getElementById("cp-old-price");
    var newPriceEl = document.getElementById("cp-new-price");
    if (!nameEl || !oldPriceEl || !newPriceEl) return;

    var productName = nameEl.getAttribute("data-product") || nameEl.textContent;
    var oldPrice = parseFloat(oldPriceEl.value) || 0;
    var newPrice = parseFloat(newPriceEl.value);

    if (!productName) { toast("Select a product first.", "error"); return; }
    if (isNaN(newPrice) || newPrice < 0) { toast("Enter a valid new price.", "error"); return; }
    if (newPrice === oldPrice) { toast("New price is the same as current.", "error"); return; }

    createChange(productName, oldPrice, newPrice)
      .then(function () {
        E.modal.hide();
        toast("Price change recorded.");
        refresh();
      })
      .catch(function (err) {
        toast("Failed: " + ((err && err.message) || "error"), "error");
      });
  }

  /* ── auto-refresh ────────────────────────────────────────────────────── */
  var _autoRefreshTimer = null;
  function startAutoRefresh() {
    stopAutoRefresh();
    _autoRefreshTimer = setInterval(function () {
      if (S.mount && E.state.activeModuleId === "cherubino-prices") refresh();
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
    S.mount.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading price changes...</div>';
    await loadChanges();
    renderAll();
    startAutoRefresh();
  }

  /* ── register ────────────────────────────────────────────────────────── */
  E.registerModule({
    id: "cherubino-prices",
    title: "Price Changes",
    order: 901,
    icon: "\uD83C\uDFE5",
    render: render,
    destroy: function () { stopAutoRefresh(); S.mount = null; }
  });

})();
