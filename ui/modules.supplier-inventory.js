/* ui/modules.supplier-inventory.js
   Eikon - Pharmacy Supplier Inventory module
   Browse supplier products, build orders, track sent orders.

   Endpoints (Worker):
     GET  /supplier-products/inventory?q=...&supplier=...
     POST /supplier-orders
     GET  /supplier-orders/sent?status=...
     GET  /supplier-orders/:id
     PUT  /supplier-orders/:id  (mark as received)
     POST /order-diary/entries  (add to order diary)
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.supplier-inventory.js)");

  var LP = "[EIKON][supplier-inventory]";
  function log() { try { console.log.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }
  function warn() { try { console.warn.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }

  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fmt2(n) { return round2(n).toFixed(2); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }

  function profitMarginColor(pct) {
    var p = Number(pct) || 0;
    if (!isFinite(p) || p <= 0) return "#ff5a7a";
    if (p >= 35) return "#43d17a";
    if (p <= 20) return "#ff5a7a";
    return "hsl(" + Math.round((p - 20) / 15 * 120) + ",88%,52%)";
  }
  function profitMarginLabel(pct) {
    var p = Number(pct) || 0;
    return p >= 35 ? "Good" : p >= 20 ? "OK" : "Poor";
  }

  function fmtDate(s) {
    if (!s) return "";
    var d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function toast(kind, title, msg) {
    var el = document.createElement("div");
    el.className = "od-toast od-toast-" + kind;
    el.innerHTML = "<strong>" + esc(title) + ":</strong> " + esc(msg);
    document.body.appendChild(el);
    setTimeout(function () {
      el.classList.add("od-toast-exit");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
    }, 3200);
  }

  // ─── Column Visibility ──────────────────────────────────────────────────
  var SI_COLUMNS = [
    { key: "supplier_name", label: "Supplier" },
    { key: "stock_code", label: "Stock Code" },
    { key: "barcode", label: "Barcode" },
    { key: "description", label: "Description" },
    { key: "cost_excl_vat", label: "Cost Excl", num: true },
    { key: "vat_rate", label: "VAT%", num: true },
    { key: "deal", label: "Deal" },
    { key: "retail_price", label: "Retail", num: true },
    { key: "profit_margin", label: "Margin%", num: true },
    { key: "out_of_stock", label: "Status" }
  ];
  var SI_DEFAULT_HIDDEN = ["stock_code", "barcode", "vat_rate"];
  var SI_ALWAYS_VISIBLE = ["description", "out_of_stock", "supplier_name"];

  function loadHiddenCols() {
    try { var v = JSON.parse(localStorage.getItem("eikon_si_hidden_cols")); return Array.isArray(v) ? v : SI_DEFAULT_HIDDEN.slice(); }
    catch (e) { return SI_DEFAULT_HIDDEN.slice(); }
  }
  function saveHiddenCols(arr) {
    try { localStorage.setItem("eikon_si_hidden_cols", JSON.stringify(arr)); } catch (e) {}
  }
  function getVisibleColumns() {
    return SI_COLUMNS.filter(function (c) { return state.hiddenCols.indexOf(c.key) === -1; });
  }

  function showColumnSettings() {
    var body = "<div style='text-align:left;font-size:14px;'>" +
      "<p style='margin:0 0 10px;'>Choose which columns to show:</p>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:6px;'>";
    SI_COLUMNS.forEach(function (col) {
      var alwaysOn = SI_ALWAYS_VISIBLE.indexOf(col.key) !== -1;
      var visible = alwaysOn || state.hiddenCols.indexOf(col.key) === -1;
      body += "<label style='display:flex;align-items:center;gap:6px;cursor:" + (alwaysOn ? "default" : "pointer") + ";'>" +
        "<input type='checkbox' data-col-key='" + col.key + "'" +
        (visible ? " checked" : "") + (alwaysOn ? " disabled" : "") + ">" +
        "<span>" + esc(col.label) + "</span></label>";
    });
    body += "</div></div>";

    E.modal.show("Column Settings", body, [
      { label: "Save", primary: true, onClick: function () {
        var hidden = [];
        SI_COLUMNS.forEach(function (col) {
          if (SI_ALWAYS_VISIBLE.indexOf(col.key) !== -1) return;
          var cb = document.querySelector("input[data-col-key='" + col.key + "']");
          if (cb && !cb.checked) hidden.push(col.key);
        });
        state.hiddenCols = hidden;
        saveHiddenCols(hidden);
        E.modal.hide();
        if (state._mount) renderAll(state._mount);
      }},
      { label: "Cancel", onClick: function () { E.modal.hide(); } }
    ]);
  }

  // ─── State ──────────────────────────────────────────────────────────────
  var state = {
    tab: "inventory", // "inventory" | "orders"
    products: [],
    filtered: [],
    suppliers: [],
    sort: { key: "description", dir: "asc" },
    queries: { keyword: "", supplier: "" },
    cart: {}, // { productId: { product, qty } }
    orders: [],
    orderSort: { key: "created_at", dir: "desc" },
    orderStatusFilter: "",
    expandedOrderId: null,
    expandedItems: [],
    expandedFeedbacks: [],
    hiddenCols: [],
    expirySettings: { expiry_red_months: 6, expiry_yellow_months: 12 },
    _mount: null
  };

  // ─── API ────────────────────────────────────────────────────────────────
  function apiGetExpirySettings() {
    return E.apiFetch("/supplier-products/inventory-settings", { method: "GET" });
  }
  function apiSaveExpirySettings(settings) {
    return E.apiFetch("/supplier-products/inventory-settings", {
      method: "PUT", body: JSON.stringify(settings)
    });
  }
  function apiInventory(q, supplier) {
    var qs = [];
    if (q) qs.push("q=" + encodeURIComponent(q));
    if (supplier) qs.push("supplier=" + encodeURIComponent(supplier));
    return E.apiFetch("/supplier-products/inventory" + (qs.length ? "?" + qs.join("&") : ""), { method: "GET" });
  }
  function apiCreateOrder(data) {
    return E.apiFetch("/supplier-orders", { method: "POST", body: JSON.stringify(data) });
  }
  function apiSentOrders(status) {
    var qs = status ? "?status=" + encodeURIComponent(status) : "";
    return E.apiFetch("/supplier-orders/sent" + qs, { method: "GET" });
  }
  function apiOrderDetail(id) {
    return E.apiFetch("/supplier-orders/" + id, { method: "GET" });
  }
  function apiUpdateOrder(id, data) {
    return E.apiFetch("/supplier-orders/" + id, { method: "PUT", body: JSON.stringify(data) });
  }
  function apiGetCartDraft() {
    return E.apiFetch("/supplier-orders/cart-draft", { method: "GET" });
  }
  function apiSaveCartDraft(cart) {
    return E.apiFetch("/supplier-orders/cart-draft", {
      method: "PUT", body: JSON.stringify({ cart: cart })
    });
  }
  function apiDeleteCartDraft() {
    return E.apiFetch("/supplier-orders/cart-draft", { method: "DELETE" });
  }

  var _draftSaveTimer = null;
  function scheduleDraftSave() {
    clearTimeout(_draftSaveTimer);
    _draftSaveTimer = setTimeout(function () {
      var minimal = {};
      for (var k in state.cart) {
        if (!Object.prototype.hasOwnProperty.call(state.cart, k)) continue;
        minimal[k] = { product_id: state.cart[k].product.id, qty: state.cart[k].qty };
      }
      if (Object.keys(minimal).length === 0) {
        apiDeleteCartDraft().catch(function () {});
      } else {
        apiSaveCartDraft(minimal).catch(function () {});
      }
    }, 1000);
  }

  function apiAddToOrderDiary(itemName, supplier) {
    var today = new Date();
    var dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    return E.apiFetch("/order-diary/entries", {
      method: "POST",
      body: JSON.stringify({ order_date: dateStr, item_name: itemName, supplier: supplier, qty: 1, status: "pending" })
    });
  }

  // ─── Sort/Filter ────────────────────────────────────────────────────────
  function parseExpiryDate(v) {
    if (!v) return null;
    var n = Number(v);
    // Excel serial date
    if (!isNaN(n) && n > 0 && n < 100000 && String(v) === String(n)) {
      var d = new Date((n - 25569) * 86400000);
      return isNaN(d.getTime()) ? null : d;
    }
    // Try parsing as date string (DD/MM/YYYY or YYYY-MM-DD or other)
    var parts = String(v).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (parts) {
      var dt = new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]));
      return isNaN(dt.getTime()) ? null : dt;
    }
    var d2 = new Date(v);
    return isNaN(d2.getTime()) ? null : d2;
  }

  function toYmd(dateStr) {
    if (!dateStr) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    var d = parseExpiryDate(dateStr);
    if (!d) return "";
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function getSortVal(row, key) {
    var v = row[key];
    if (key === "cost_excl_vat" || key === "retail_price" || key === "profit_margin" || key === "vat_rate") return Number(v) || 0;
    if (key === "out_of_stock") return v ? 1 : 0;
    return norm(v);
  }

  function applyFilter() {
    var kw = norm(state.queries.keyword);
    var sup = state.queries.supplier;
    state.filtered = state.products.filter(function (r) {
      if (sup && r.supplier_name !== sup) return false;
      if (kw) {
        return norm(r.description).includes(kw) ||
               norm(r.barcode).includes(kw) ||
               norm(r.stock_code).includes(kw) ||
               norm(r.supplier_name).includes(kw);
      }
      return true;
    });

    var sk = state.sort.key;
    var sd = state.sort.dir === "asc" ? 1 : -1;
    if (sk) {
      state.filtered.sort(function (a, b) {
        var va = getSortVal(a, sk), vb = getSortVal(b, sk);
        if (va < vb) return -sd;
        if (va > vb) return sd;
        return 0;
      });
    }

    // Extract unique supplier names
    var supMap = {};
    state.products.forEach(function (p) { if (p.supplier_name) supMap[p.supplier_name] = true; });
    state.suppliers = Object.keys(supMap).sort();
  }

  // ─── Cart helpers ───────────────────────────────────────────────────────
  function cartCount() {
    var count = 0;
    for (var k in state.cart) { if (Object.prototype.hasOwnProperty.call(state.cart, k)) count++; }
    return count;
  }

  function cartBySupplier() {
    var groups = {};
    for (var k in state.cart) {
      if (!Object.prototype.hasOwnProperty.call(state.cart, k)) continue;
      var item = state.cart[k];
      var sup = item.product.supplier_name || "Unknown";
      if (!groups[sup]) groups[sup] = { supplier_name: sup, supplier_location_id: item.product.location_id, items: [] };
      groups[sup].items.push(item);
    }
    return groups;
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  function renderTabs() {
    return "<div class='si-tabs'>" +
      "<button class='si-tab" + (state.tab === "inventory" ? " si-tab-active" : "") + "' id='si-tab-inventory'>Inventory</button>" +
      "<button class='si-tab" + (state.tab === "orders" ? " si-tab-active" : "") + "' id='si-tab-orders'>My Orders</button>" +
      (cartCount() > 0 ? "<span class='si-cart-badge'>" + cartCount() + " in cart</span>" : "") +
    "</div>";
  }

  function renderInventory() {
    var html = "<div class='si-toolbar'>" +
      "<input type='text' id='si-search' class='eikon-input' placeholder='Search products\u2026' value='" + esc(state.queries.keyword) + "' style='width:220px;'>" +
      "<select id='si-supplier-filter' class='eikon-input' style='width:180px;'>" +
        "<option value=''>All Suppliers</option>";
    state.suppliers.forEach(function (s) {
      html += "<option value='" + esc(s) + "'" + (state.queries.supplier === s ? " selected" : "") + ">" + esc(s) + "</option>";
    });
    html += "</select>" +
      "<button class='eikon-btn' id='si-btn-colsettings' title='Column Settings' style='margin-left:auto;'>\u2699</button>" +
    "</div>" +
    "<div class='si-expiry-bar'>" +
      "<span style='font-size:11px;color:rgba(233,238,247,.5);'>Expiry warning:</span> " +
      "<span class='si-expiry-chip si-expiry-red-chip'>" +
        "<input type='number' id='si-expiry-red' value='" + (state.expirySettings.expiry_red_months || 6) + "' min='1' max='36' class='si-expiry-input'> months" +
      "</span> " +
      "<span class='si-expiry-chip si-expiry-yellow-chip'>" +
        "<input type='number' id='si-expiry-yellow' value='" + (state.expirySettings.expiry_yellow_months || 12) + "' min='1' max='60' class='si-expiry-input'> months" +
      "</span>" +
    "</div>";

    if (!state.filtered.length) {
      html += "<div style='text-align:center;padding:40px;color:var(--muted);'>No products found.</div>";
      return html;
    }

    var sk = state.sort.key;
    var sd = state.sort.dir;
    var visCols = getVisibleColumns();

    html += "<div class='si-table-wrap'><table class='si-table'><thead><tr>";
    visCols.forEach(function (col) {
      var sortKey = col.key === "deal" ? "" : col.key;
      var active = sortKey && sk === sortKey;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      html += "<th class='" + (col.num ? "num" : "") + "'" +
        (sortKey ? " data-sort-key='" + sortKey + "' style='cursor:pointer;'" : "") + ">" +
        esc(col.label) + arrow + "</th>";
    });
    html += "<th>Order</th></tr></thead><tbody>";

    state.filtered.forEach(function (row) {
      var oos = row.out_of_stock ? 1 : 0;
      var rowStyle = oos ? "opacity:0.5;" : "";
      var mc = profitMarginColor(row.profit_margin);
      var inCart = state.cart[row.id];

      // Deal detection
      var qp = Number(row.qty_purchased) || 1;
      var qf = Number(row.qty_free) || 0;
      var hasDeal = qp > 1 || qf > 0;
      var minQty = hasDeal ? qp : 1;
      var stepQty = hasDeal ? qp : 1;
      var defaultQty = inCart ? inCart.qty : minQty;

      // Expiry warning shading
      var expiryBg = "";
      if (row.expiry_date && !oos) {
        var expDate = parseExpiryDate(row.expiry_date);
        if (expDate) {
          var diffMs = expDate.getTime() - Date.now();
          var diffMonths = diffMs / (30.44 * 24 * 60 * 60 * 1000);
          if (diffMonths <= (state.expirySettings.expiry_red_months || 6)) {
            expiryBg = "background:rgba(255,90,122,.12);";
          } else if (diffMonths <= (state.expirySettings.expiry_yellow_months || 12)) {
            expiryBg = "background:rgba(255,200,50,.10);";
          }
        }
      }

      html += "<tr style='" + rowStyle + expiryBg + "'>";

      visCols.forEach(function (col) {
        if (col.key === "supplier_name") {
          html += "<td>" + esc(row.supplier_name) + "</td>";
        } else if (col.key === "stock_code") {
          html += "<td>" + esc(row.stock_code) + "</td>";
        } else if (col.key === "barcode") {
          html += "<td>" + esc(row.barcode) + "</td>";
        } else if (col.key === "description") {
          html += "<td>" + esc(row.description) + "</td>";
        } else if (col.key === "cost_excl_vat") {
          html += "<td class='num'>\u20ac" + fmt2(row.cost_excl_vat) + "</td>";
        } else if (col.key === "vat_rate") {
          html += "<td class='num'>" + (Number(row.vat_rate) || 0) + "%</td>";
        } else if (col.key === "deal") {
          var discPct = Number(row.discount_pct) || 0;
          var dealParts = [];
          if (hasDeal) dealParts.push("Buy " + qp + (qf > 0 ? " + " + qf + " Free" : ""));
          if (discPct > 0) dealParts.push(discPct + "% off");
          if (dealParts.length > 0) {
            html += "<td><span style='font-size:11px;font-weight:700;color:#5aa2ff;'>" + dealParts.join(" \u00b7 ") + "</span></td>";
          } else {
            html += "<td></td>";
          }
        } else if (col.key === "retail_price") {
          html += "<td class='num'>\u20ac" + fmt2(row.retail_price) + "</td>";
        } else if (col.key === "profit_margin") {
          html += "<td class='num'><span style='background:" + mc + "22;color:" + mc + ";padding:2px 8px;border-radius:6px;font-weight:700;font-size:11px;'>" +
            fmt2(row.profit_margin) + "% (" + profitMarginLabel(row.profit_margin) + ")</span></td>";
        } else if (col.key === "out_of_stock") {
          html += "<td>" + (oos ? "<span style='color:#ff5a7a;font-weight:700;font-size:11px;'>Out of Stock</span>" : "<span style='color:#43d17a;font-size:11px;'>In Stock</span>") + "</td>";
        } else {
          html += "<td>" + esc(row[col.key] || "") + "</td>";
        }
      });

      // Order column (always visible)
      html += "<td style='white-space:nowrap;'>" +
        (oos ? "" :
          "<input type='number' class='si-qty-input' data-cart-id='" + row.id + "' value='" + defaultQty + "' min='" + minQty + "' step='" + stepQty + "' style='width:52px;'>" +
          "<button class='eikon-btn si-add-cart' data-cart-id='" + row.id + "' style='font-size:10px;padding:3px 8px;margin-left:4px;'>" + (inCart ? "\u2713 In Cart" : "+ Cart") + "</button>") +
        "<button class='eikon-btn si-add-diary' data-diary-desc='" + esc(row.description) + "' data-diary-sup='" + esc(row.supplier_name) + "' style='font-size:10px;padding:3px 6px;margin-left:4px;' title='Add to Order Diary'>+ Diary</button>" +
      "</td></tr>";
    });

    html += "</tbody></table></div>";
    html += "<div style='font-size:12px;color:var(--muted);padding:6px;'>" + state.filtered.length + " product" + (state.filtered.length !== 1 ? "s" : "") + "</div>";

    // Cart panel
    if (cartCount() > 0) {
      html += renderCartPanel();
    }

    return html;
  }

  function renderCartPanel() {
    var groups = cartBySupplier();
    var html = "<div class='si-cart-panel'>" +
      "<div style='font-weight:700;font-size:14px;margin-bottom:10px;'>Cart (" + cartCount() + " items)</div>";

    for (var supName in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, supName)) continue;
      var group = groups[supName];
      var total = 0;

      html += "<div class='si-cart-group'>" +
        "<div style='font-weight:600;font-size:12px;margin-bottom:6px;'>" + esc(supName) + "</div>";

      var totalCost = 0;
      var totalRetail = 0;

      html += "<div style='max-height:240px;overflow-y:auto;'>" +
        "<table class='si-cart-table'>" +
        "<thead><tr>" +
          "<th style='text-align:left;'>Product</th>" +
          "<th style='width:36px;text-align:right;'>Qty</th>" +
          "<th style='width:36px;text-align:right;'>Free</th>" +
          "<th style='width:44px;text-align:right;'>Disc%</th>" +
          "<th style='width:70px;text-align:right;'>Cost</th>" +
          "<th style='width:24px;'></th>" +
        "</tr></thead><tbody>";
      group.items.forEach(function (item) {
        var qp = Number(item.product.qty_purchased) || 1;
        var qf = Number(item.product.qty_free) || 0;
        var hasDeal = qp > 1 || qf > 0;
        var freeQty = hasDeal ? Math.floor(item.qty / qp) * qf : 0;
        var totalQtyReceived = item.qty + freeQty;
        var discPct = Number(item.product.discount_pct) || 0;

        var lineCost = round2(item.qty * (item.product.cost_excl_vat || 0));
        var lineRetail = round2(totalQtyReceived * (item.product.retail_price || 0));
        totalCost += lineCost;
        totalRetail += lineRetail;

        html += "<tr>" +
          "<td>" + esc(item.product.description) + "</td>" +
          "<td style='text-align:right;'><input type='number' class='eikon-input si-cart-qty' " +
            "data-cart-qty-id='" + item.product.id + "' value='" + item.qty + "' min='1'" +
            (hasDeal ? " step='" + qp + "'" : "") +
            " style='width:50px;text-align:right;padding:2px 4px;font-size:11px;'></td>" +
          "<td style='text-align:right;'>" + (freeQty > 0 ? "+" + freeQty : "-") + "</td>" +
          "<td style='text-align:right;'>" + (discPct > 0 ? fmt2(discPct) + "%" : "-") + "</td>" +
          "<td style='text-align:right;'>\u20ac" + fmt2(lineCost) + "</td>" +
          "<td><button class='si-cart-remove' data-remove-id='" + item.product.id + "' title='Remove'>\u2715</button></td>" +
        "</tr>";
      });
      html += "</tbody></table></div>";

      var totalProfit = round2(totalRetail - totalCost);
      var profitMarginPct = totalRetail > 0 ? round2((totalProfit / totalRetail) * 100) : 0;
      var mc = profitMarginColor(profitMarginPct);

      html += "<div style='text-align:right;font-size:12px;margin:6px 0;border-top:1px solid rgba(255,255,255,.08);padding-top:6px;'>" +
        "<div style='font-weight:700;'>Total Cost: \u20ac" + fmt2(totalCost) + "</div>" +
        "<div style='margin-top:2px;'>Profit: \u20ac" + fmt2(totalProfit) +
        " &middot; <span style='color:" + mc + ";font-weight:700;'>" + fmt2(profitMarginPct) + "%</span></div>" +
      "</div>" +
        "<textarea class='eikon-input si-order-notes' data-notes-supplier='" + esc(supName) + "' " +
          "placeholder='Order notes (e.g. delivery instructions)...' " +
          "style='width:100%;height:36px;margin-bottom:6px;font-size:11px;resize:vertical;'></textarea>" +
        "<button class='eikon-btn sp-btn-primary si-commit-btn' data-commit-supplier='" + esc(supName) + "'>Commit Order to " + esc(supName) + "</button>" +
      "</div>";
    }

    html += "<button class='eikon-btn si-clear-cart' style='opacity:.65;margin-top:8px;'>Clear Cart</button></div>";
    return html;
  }

  function renderOrders() {
    var hasDrafts = Object.keys(state.cart).length > 0;
    if (!state.orders.length && !hasDrafts) {
      return "<div style='text-align:center;padding:40px;color:var(--muted);'>No orders placed yet.</div>";
    }

    var sk = state.orderSort.key;
    var sd = state.orderSort.dir;

    var cols = [
      { key: "id", label: "Order #" },
      { key: "supplier_name", label: "Supplier" },
      { key: "created_at", label: "Date" },
      { key: "item_count", label: "Items" },
      { key: "status", label: "Status" }
    ];

    var sf = state.orderStatusFilter;
    var html = "<div style='margin-bottom:8px;'>" +
      "<select id='si-order-status-filter' class='eikon-input' style='width:150px;font-size:12px;'>" +
        "<option value=''" + (sf === "" ? " selected" : "") + ">All Statuses</option>" +
        "<option value='pending'" + (sf === "pending" ? " selected" : "") + ">Pending</option>" +
        "<option value='shipped'" + (sf === "shipped" ? " selected" : "") + ">Shipped</option>" +
        "<option value='received'" + (sf === "received" ? " selected" : "") + ">Received</option>" +
      "</select></div>";

    html += "<div class='si-table-wrap'><table class='si-table'><thead><tr>";
    cols.forEach(function (col) {
      var active = sk === col.key;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      html += "<th data-order-sort-key='" + col.key + "' style='cursor:pointer;'>" + esc(col.label) + arrow + "</th>";
    });
    html += "<th>Actions</th></tr></thead><tbody>";

    // Draft orders from cart
    if (hasDrafts) {
      var groups = cartBySupplier();
      for (var supName in groups) {
        if (!Object.prototype.hasOwnProperty.call(groups, supName)) continue;
        var grp = groups[supName];
        html += "<tr style='background:rgba(255,175,50,.05);'>" +
          "<td><span style='color:var(--muted);'>Draft</span></td>" +
          "<td>" + esc(supName) + "</td>" +
          "<td>Now</td>" +
          "<td>" + grp.items.length + "</td>" +
          "<td><span style='display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(255,175,50,.2);color:#ffaf32;'>Draft</span></td>" +
          "<td style='white-space:nowrap;'>" +
            "<button class='eikon-btn si-draft-continue' data-draft-supplier='" + esc(supName) + "' style='font-size:11px;padding:3px 10px;'>Continue</button> " +
            "<button class='eikon-btn si-draft-delete' data-draft-supplier='" + esc(supName) + "' style='font-size:11px;padding:3px 10px;color:#ff5a7a;'>Delete</button>" +
          "</td>" +
        "</tr>";
      }
    }

    state.orders.forEach(function (order) {
      var isExpanded = state.expandedOrderId === order.id;
      var statusColors = {
        pending: { bg: "rgba(255,175,50,.15)", fg: "#ffaf32" },
        confirmed: { bg: "rgba(90,162,255,.15)", fg: "#5aa2ff" },
        shipped: { bg: "rgba(90,162,255,.15)", fg: "#5aa2ff" },
        received: { bg: "rgba(67,209,122,.15)", fg: "#43d17a" }
      };
      var sc = statusColors[order.status] || statusColors.pending;
      var statusLabel = order.status ? order.status.charAt(0).toUpperCase() + order.status.slice(1) : "Unknown";

      html += "<tr class='" + (isExpanded ? "sro-expanded" : "") + "' data-order-view='" + order.id + "'>" +
        "<td>#" + order.id + "</td>" +
        "<td>" + esc(order.supplier_name) + "</td>" +
        "<td>" + fmtDate(order.created_at) + "</td>" +
        "<td>" + (order.item_count || 0) + "</td>" +
        "<td><span style='display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;" +
          "background:" + sc.bg + ";color:" + sc.fg + ";'>" + esc(statusLabel) + "</span></td>" +
        "<td>" +
          "<button class='eikon-btn' data-expand-order='" + order.id + "' style='font-size:11px;padding:3px 10px;'>" + (isExpanded ? "Collapse" : "View") + "</button>" +
        "</td>" +
      "</tr>";

      if (isExpanded) {
        html += "<tr><td colspan='6'>" + renderOrderItems(order) + "</td></tr>";
      }
    });

    html += "</tbody></table></div>";
    return html;
  }

  var PROBLEM_TYPES = ["Not Received", "Wrong Pick", "Damaged", "Short Quantity", "Other"];

  function renderOrderItems(order) {
    var items = state.expandedItems;
    if (!items.length) return "<div style='padding:12px;color:var(--muted);'>Loading\u2026</div>";

    // Build feedback lookup by item id
    var fbByItem = {};
    (state.expandedFeedbacks || []).forEach(function (fb) {
      fbByItem[fb.order_item_id] = fb;
    });

    var canReport = order.status === "shipped" || order.status === "received";
    var thStyle = "text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);";

    var html = "<div style='padding:12px;background:rgba(255,255,255,.02);border-radius:8px;'>";

    // Supplier notes and delivery date
    if (order.supplier_notes) {
      html += "<div style='margin-bottom:8px;font-size:12px;padding:6px 8px;background:rgba(90,162,255,.08);border-radius:6px;'>" +
        "<b>Supplier:</b> " + esc(order.supplier_notes) + "</div>";
    }
    if (order.scheduled_delivery_date) {
      html += "<div style='margin-bottom:8px;font-size:12px;color:rgba(233,238,247,.7);'>" +
        "<b>Expected delivery:</b> " + esc(order.scheduled_delivery_date) + "</div>";
    }

    html += "<table style='width:100%;border-collapse:collapse;font-size:12px;'><thead><tr>" +
      "<th style='" + thStyle + "'>Description</th>" +
      "<th style='" + thStyle + "'>Barcode</th>" +
      "<th style='" + thStyle + "text-align:right;'>Qty</th>" +
      "<th style='" + thStyle + "text-align:right;'>Cost</th>" +
      "<th style='" + thStyle + "'>Status</th>" +
      (canReport ? "<th style='" + thStyle + "'>Report Problem</th>" : "") +
      "</tr></thead><tbody>";

    items.forEach(function (item) {
      var unavail = item.unavailable ? 1 : 0;
      var existingFb = fbByItem[item.id];
      var rowStyle = unavail ? "text-decoration:line-through;opacity:0.5;" : "";
      if (existingFb && !unavail) rowStyle += "background:rgba(255,90,122,.08);";
      var qtyLabel = (item.qty_requested || 0) + (item.qty_free ? "+" + item.qty_free : "");
      var qtyExtra = "";
      if (!unavail && item.qty_confirmed !== undefined && item.qty_confirmed !== null && Number(item.qty_confirmed) !== Number(item.qty_requested) && (order.status === "shipped" || order.status === "received")) {
        qtyExtra = " <span style='color:#ffaf32;font-size:10px;'>(" + item.qty_confirmed + " confirmed)</span>";
      }
      var descExtra = "";
      if (item.notes && !unavail) descExtra = "<div style='font-size:10px;color:var(--muted);'>" + esc(item.notes) + "</div>";
      html += "<tr style='" + rowStyle + "'>" +
        "<td style='padding:6px;'>" + esc(item.description) + descExtra + "</td>" +
        "<td style='padding:6px;'>" + esc(item.barcode) + "</td>" +
        "<td style='padding:6px;text-align:right;'>" + qtyLabel + qtyExtra + "</td>" +
        "<td style='padding:6px;text-align:right;'>\u20ac" + fmt2(item.cost_excl_vat) + "</td>" +
        "<td style='padding:6px;'>" + (unavail ?
          "<span style='color:#ff5a7a;font-weight:700;'>Unavailable</span>" :
          "<span style='color:#43d17a;'>Available</span>") + "</td>";

      if (canReport) {
        if (existingFb) {
          // Show existing feedback badge
          var pColors = { "Not Received": "#ff5a7a", "Wrong Pick": "#e8c840", "Damaged": "#ff5a7a", "Short Quantity": "#ffaf32", "Other": "#5aa2ff" };
          var pc = pColors[existingFb.problem_type] || "#ff5a7a";
          var resHtml = "";
          if (existingFb.resolution_status) {
            var rColors = { "Acknowledged": "#5aa2ff", "Replacement Sent": "#43d17a", "Credit Issued": "#43d17a", "Disputed": "#ffaf32", "Resolved": "#43d17a" };
            var rc = rColors[existingFb.resolution_status] || "#5aa2ff";
            resHtml = "<div style='font-size:10px;margin-top:2px;'><span style='padding:1px 6px;border-radius:4px;background:" + rc + "22;color:" + rc + ";font-weight:600;'>" + esc(existingFb.resolution_status) + "</span></div>";
            if (existingFb.supplier_notes) resHtml += "<div style='font-size:10px;color:var(--muted);margin-top:1px;'>Supplier: " + esc(existingFb.supplier_notes) + "</div>";
          }
          html += "<td style='padding:6px;'><span style='display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;" +
            "background:" + pc + "22;color:" + pc + ";'>" + esc(existingFb.problem_type) + "</span>" +
            (existingFb.notes ? "<div style='font-size:10px;color:var(--muted);margin-top:2px;'>" + esc(existingFb.notes) + "</div>" : "") +
            resHtml + "</td>";
        } else if (!unavail) {
          html += "<td style='padding:6px;'>" +
            "<select class='eikon-input si-problem-select' data-feedback-item='" + item.id + "' " +
              "data-fb-desc='" + esc(item.description) + "' " +
              "data-fb-batch='" + esc(item.batch || "") + "' " +
              "data-fb-expiry='" + esc(item.expiry_date || "") + "' " +
              "data-fb-qty='" + qtyLabel + "' " +
              "data-fb-supplier='" + esc(order.supplier_name) + "' " +
              "style='font-size:11px;padding:2px 4px;width:130px;'>" +
              "<option value=''>-- Select --</option>";
          PROBLEM_TYPES.forEach(function (pt) {
            html += "<option value='" + esc(pt) + "'>" + esc(pt) + "</option>";
          });
          html += "</select></td>";
        } else {
          html += "<td style='padding:6px;'></td>";
        }
      }

      html += "</tr>";
    });

    html += "</tbody></table>";

    // Order summary footer
    var totalQty = 0, totalFree = 0, totalCost = 0;
    items.forEach(function (item) {
      if (item.unavailable) return;
      totalQty += Number(item.qty_requested) || 0;
      totalFree += Number(item.qty_free) || 0;
      totalCost += (Number(item.qty_requested) || 0) * (Number(item.cost_excl_vat) || 0);
    });
    html += "<div style='margin-top:8px;padding:8px 6px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(233,238,247,.7);display:flex;gap:16px;flex-wrap:wrap;'>" +
      "<span><b>Total Items:</b> " + totalQty + (totalFree > 0 ? " (+" + totalFree + " free)" : "") + "</span>" +
      "<span><b>Total Cost Excl:</b> \u20ac" + fmt2(totalCost) + "</span>" +
    "</div>";

    if (order.status === "shipped") {
      html += "<div style='margin-top:12px;'>" +
        "<button class='eikon-btn sp-btn-primary' data-receive-order='" + order.id + "'>Mark as Received</button>" +
      "</div>";
    }

    html += "</div>";
    return html;
  }

  // ─── Main render ────────────────────────────────────────────────────────
  function renderAll(mount) {
    var content = mount.querySelector("#si-content");
    if (!content) return;

    var html = renderTabs();

    if (state.tab === "inventory") {
      html += renderInventory();
    } else {
      html += renderOrders();
    }

    content.innerHTML = html;
    wireAll(mount);
  }

  function wireAll(mount) {
    // Tab switching
    var tabInv = mount.querySelector("#si-tab-inventory");
    var tabOrd = mount.querySelector("#si-tab-orders");
    if (tabInv) tabInv.addEventListener("click", function () {
      state.tab = "inventory";
      renderAll(mount);
    });
    if (tabOrd) tabOrd.addEventListener("click", function () {
      state.tab = "orders";
      loadOrders(mount);
    });

    if (state.tab === "inventory") {
      wireInventory(mount);
    } else {
      wireOrders(mount);
    }
  }

  function wireInventory(mount) {
    // Column settings
    var colBtn = mount.querySelector("#si-btn-colsettings");
    if (colBtn) { colBtn.addEventListener("click", function () { showColumnSettings(); }); }

    // Search
    var searchInput = mount.querySelector("#si-search");
    if (searchInput) {
      var debounce = null;
      searchInput.addEventListener("input", function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          state.queries.keyword = searchInput.value;
          applyFilter();
          renderAll(mount);
        }, 200);
      });
    }

    // Supplier filter
    var supFilter = mount.querySelector("#si-supplier-filter");
    if (supFilter) {
      supFilter.addEventListener("change", function () {
        state.queries.supplier = supFilter.value;
        applyFilter();
        renderAll(mount);
      });
    }

    // Expiry settings
    var expiryRedInput = mount.querySelector("#si-expiry-red");
    var expiryYellowInput = mount.querySelector("#si-expiry-yellow");
    var expiryDebounce = null;
    function onExpiryChange() {
      clearTimeout(expiryDebounce);
      expiryDebounce = setTimeout(function () {
        var red = Number(expiryRedInput && expiryRedInput.value) || 6;
        var yellow = Number(expiryYellowInput && expiryYellowInput.value) || 12;
        state.expirySettings = { expiry_red_months: red, expiry_yellow_months: yellow };
        apiSaveExpirySettings(state.expirySettings);
        renderAll(mount);
      }, 600);
    }
    if (expiryRedInput) expiryRedInput.addEventListener("input", onExpiryChange);
    if (expiryYellowInput) expiryYellowInput.addEventListener("input", onExpiryChange);

    // Sort headers
    mount.querySelectorAll("[data-sort-key]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort-key");
        if (state.sort.key === key) {
          state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort.key = key;
          state.sort.dir = "asc";
        }
        applyFilter();
        renderAll(mount);
      });
    });

    // Add to cart (with deal qty enforcement)
    mount.querySelectorAll(".si-add-cart").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-cart-id"));
        var product = state.products.find(function (p) { return p.id === id; });
        if (!product) return;
        var qtyInput = mount.querySelector("input.si-qty-input[data-cart-id='" + id + "']");
        var qp = Number(product.qty_purchased) || 1;
        var hasDeal = qp > 1 || Number(product.qty_free) > 0;
        var qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : (hasDeal ? qp : 1);

        // Snap to valid deal multiple
        if (hasDeal && qty % qp !== 0) {
          qty = Math.max(qp, Math.round(qty / qp) * qp);
          if (qtyInput) qtyInput.value = qty;
        }

        if (state.cart[id]) {
          delete state.cart[id];
          scheduleDraftSave();
          renderAll(mount);
        } else {
          // Check expiry warning before adding
          var expWarn = null;
          if (product.expiry_date) {
            var expD = parseExpiryDate(product.expiry_date);
            if (expD) {
              var daysLeft = Math.ceil((expD.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
              var monthsLeft = daysLeft / 30.44;
              if (monthsLeft <= (state.expirySettings.expiry_red_months || 6)) {
                expWarn = { level: "red", days: daysLeft, date: expD };
              } else if (monthsLeft <= (state.expirySettings.expiry_yellow_months || 12)) {
                expWarn = { level: "yellow", days: daysLeft, date: expD };
              }
            }
          }
          if (expWarn) {
            var warnColor = expWarn.level === "red" ? "#ff5a7a" : "#e8c840";
            var expDateStr = expWarn.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
            E.modal.show("Expiry Warning",
              "<div style='line-height:1.7;'>" +
                "<b style='color:" + warnColor + ";'>" + esc(product.description) + "</b><br>" +
                "Expiry date: <b>" + expDateStr + "</b><br>" +
                "Days remaining: <b style='color:" + warnColor + ";'>" + expWarn.days + " days</b><br><br>" +
                (expWarn.level === "red"
                  ? "<span style='color:#ff5a7a;font-weight:700;'>This product is expiring very soon.</span>"
                  : "<span style='color:#e8c840;font-weight:700;'>This product is approaching expiry.</span>") +
                "<br><br>Do you still want to add it to your cart?" +
              "</div>",
              [
                { label: "Cancel", onClick: function () { E.modal.hide(); } },
                { label: "Add Anyway", primary: true, onClick: function () {
                  E.modal.hide();
                  state.cart[id] = { product: product, qty: qty };
                  scheduleDraftSave();
                  renderAll(mount);
                }}
              ]
            );
          } else {
            state.cart[id] = { product: product, qty: qty };
            scheduleDraftSave();
            renderAll(mount);
          }
        }
      });
    });

    // Qty input change (with deal qty snapping)
    mount.querySelectorAll(".si-qty-input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var id = Number(inp.getAttribute("data-cart-id"));
        var qty = Math.max(1, parseInt(inp.value, 10) || 1);

        // Find the product for deal checking
        var product = state.cart[id] ? state.cart[id].product : state.products.find(function (p) { return p.id === id; });
        if (product) {
          var qp = Number(product.qty_purchased) || 1;
          var hasDeal = qp > 1 || Number(product.qty_free) > 0;
          if (hasDeal && qty % qp !== 0) {
            qty = Math.max(qp, Math.round(qty / qp) * qp);
            inp.value = qty;
          }
        }

        if (state.cart[id]) {
          state.cart[id].qty = qty;
          scheduleDraftSave();
        }
      });
    });

    // Add to Order Diary
    mount.querySelectorAll(".si-add-diary").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var desc = btn.getAttribute("data-diary-desc");
        var sup = btn.getAttribute("data-diary-sup");
        btn.disabled = true;
        apiAddToOrderDiary(desc, sup)
          .then(function () { toast("good", "Added", "Added to Order Diary: " + desc); btn.disabled = false; })
          .catch(function (err) { toast("bad", "Error", err.message || "Failed"); btn.disabled = false; });
      });
    });

    // Cart remove
    mount.querySelectorAll(".si-cart-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-remove-id"));
        delete state.cart[id];
        scheduleDraftSave();
        renderAll(mount);
      });
    });

    // Inline cart qty edit
    mount.querySelectorAll(".si-cart-qty").forEach(function (input) {
      input.addEventListener("change", function () {
        var id = Number(input.getAttribute("data-cart-qty-id"));
        var cartItem = state.cart[id];
        if (!cartItem) return;
        var newQty = Math.max(1, parseInt(input.value, 10) || 1);
        var qp = Number(cartItem.product.qty_purchased) || 1;
        var qf = Number(cartItem.product.qty_free) || 0;
        var hasDeal = qp > 1 || qf > 0;
        if (hasDeal && newQty % qp !== 0) {
          newQty = Math.max(qp, Math.round(newQty / qp) * qp);
        }
        cartItem.qty = newQty;
        scheduleDraftSave();
        renderAll(mount);
      });
    });

    // Clear cart
    var clearBtn = mount.querySelector(".si-clear-cart");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        state.cart = {};
        scheduleDraftSave();
        renderAll(mount);
      });
    }

    // Commit order (with deal validation)
    mount.querySelectorAll(".si-commit-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var supName = btn.getAttribute("data-commit-supplier");
        var groups = cartBySupplier();
        var group = groups[supName];
        if (!group || !group.items.length) return;

        // Validate deal quantities
        var invalid = group.items.filter(function (ci) {
          var qp = Number(ci.product.qty_purchased) || 1;
          var hasDeal = qp > 1 || Number(ci.product.qty_free) > 0;
          return hasDeal && ci.qty % qp !== 0;
        });
        if (invalid.length) {
          toast("bad", "Invalid Qty", "Quantities must be multiples of the deal amount for: " + invalid.map(function (ci) { return ci.product.description; }).join(", "));
          return;
        }

        btn.disabled = true;
        btn.textContent = "Preparing\u2026";

        var orderItems = group.items.map(function (ci) {
          var qp = Number(ci.product.qty_purchased) || 1;
          var qf = Number(ci.product.qty_free) || 0;
          var hasDeal = qp > 1 || qf > 0;
          var freeQty = hasDeal ? Math.floor(ci.qty / qp) * qf : 0;
          return {
            product_id: ci.product.id,
            description: ci.product.description,
            barcode: ci.product.barcode || "",
            stock_code: ci.product.stock_code || "",
            qty_requested: ci.qty,
            qty_free_included: freeQty,
            qty_free: freeQty,
            cost_excl_vat: ci.product.cost_excl_vat || 0,
            vat_rate: ci.product.vat_rate || 18,
            retail_price: ci.product.retail_price || 0,
            batch: ci.product.batch || "",
            expiry_date: ci.product.expiry_date || "",
            discount_pct: ci.product.discount_pct || 0,
            discount_euro: ci.product.discount_euro || 0
          };
        });

        // Read order notes from DOM
        var notesEl = mount.querySelector("textarea.si-order-notes[data-notes-supplier='" + supName.replace(/'/g, "\\'") + "']");
        var orderNotes = notesEl ? notesEl.value.trim() : "";

        // Calculate totals for confirmation
        var confirmTotal = 0;
        var confirmRows = "";
        group.items.forEach(function (ci) {
          var qp = Number(ci.product.qty_purchased) || 1;
          var qf = Number(ci.product.qty_free) || 0;
          var hasDeal = qp > 1 || qf > 0;
          var freeQty = hasDeal ? Math.floor(ci.qty / qp) * qf : 0;
          var lineCost = round2(ci.qty * (ci.product.cost_excl_vat || 0));
          confirmTotal += lineCost;
          confirmRows += "<tr>" +
            "<td style='padding:3px 6px;'>" + esc(ci.product.description) + "</td>" +
            "<td style='padding:3px 6px;text-align:right;'>" + ci.qty + "</td>" +
            "<td style='padding:3px 6px;text-align:right;'>" + (freeQty > 0 ? "+" + freeQty : "-") + "</td>" +
            "<td style='padding:3px 6px;text-align:right;'>\u20ac" + fmt2(lineCost) + "</td>" +
          "</tr>";
        });

        var confirmHtml = "<div style='max-height:300px;overflow-y:auto;'>" +
          "<table style='width:100%;font-size:12px;border-collapse:collapse;'>" +
          "<thead><tr><th style='text-align:left;padding:3px 6px;'>Product</th>" +
          "<th style='text-align:right;padding:3px 6px;'>Qty</th>" +
          "<th style='text-align:right;padding:3px 6px;'>Free</th>" +
          "<th style='text-align:right;padding:3px 6px;'>Cost</th></tr></thead><tbody>" +
          confirmRows + "</tbody></table></div>" +
          "<div style='margin-top:8px;font-weight:700;text-align:right;font-size:13px;'>Total: \u20ac" + fmt2(confirmTotal) + "</div>" +
          (orderNotes ? "<div style='margin-top:6px;font-size:11px;color:var(--muted);'>Notes: " + esc(orderNotes) + "</div>" : "");

        E.modal.show("Confirm Order to " + supName, confirmHtml, [
          { label: "Cancel", onClick: function () {
            E.modal.hide();
            btn.disabled = false;
            btn.textContent = "Commit Order to " + supName;
          }},
          { label: "Confirm & Send", primary: true, onClick: function () {
            E.modal.hide();
            btn.textContent = "Sending\u2026";
            sendOrder();
          }}
        ]);

        function sendOrder() {
          apiCreateOrder({
            supplier_location_id: group.supplier_location_id,
            supplier_name: supName,
            items: orderItems,
            notes: orderNotes
          })
          .then(function (resp) {
            toast("good", "Order Sent", "Order #" + resp.id + " sent to " + supName);
            group.items.forEach(function (ci) { delete state.cart[ci.product.id]; });
            scheduleDraftSave();
            renderAll(mount);
          })
          .catch(function (err) {
            toast("bad", "Error", err.message || "Failed to send order");
            btn.disabled = false;
            btn.textContent = "Commit Order to " + supName;
          });
        }
      });
    });
  }

  function wireOrders(mount) {
    // Draft continue
    mount.querySelectorAll(".si-draft-continue").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.tab = "inventory";
        renderAll(mount);
      });
    });

    // Draft delete
    mount.querySelectorAll(".si-draft-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var supName = btn.getAttribute("data-draft-supplier");
        var groups = cartBySupplier();
        var grp = groups[supName];
        if (grp) {
          grp.items.forEach(function (ci) { delete state.cart[ci.product.id]; });
        }
        scheduleDraftSave();
        renderAll(mount);
      });
    });

    // Sort headers
    mount.querySelectorAll("[data-order-sort-key]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-order-sort-key");
        if (state.orderSort.key === key) {
          state.orderSort.dir = state.orderSort.dir === "asc" ? "desc" : "asc";
        } else {
          state.orderSort.key = key;
          state.orderSort.dir = "asc";
        }
        sortOrders();
        renderAll(mount);
      });
    });

    // Order status filter
    var statusFilter = mount.querySelector("#si-order-status-filter");
    if (statusFilter) {
      statusFilter.addEventListener("change", function () {
        state.orderStatusFilter = statusFilter.value;
        loadOrders(mount);
      });
    }

    // Expand order
    mount.querySelectorAll("[data-expand-order]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var orderId = Number(btn.getAttribute("data-expand-order"));
        if (state.expandedOrderId === orderId) {
          state.expandedOrderId = null;
          state.expandedItems = [];
          state.expandedFeedbacks = [];
          renderAll(mount);
        } else {
          state.expandedOrderId = orderId;
          state.expandedItems = [];
          state.expandedFeedbacks = [];
          renderAll(mount);
          apiOrderDetail(orderId).then(function (resp) {
            state.expandedItems = resp.items || [];
            state.expandedFeedbacks = resp.feedbacks || [];
            renderAll(mount);
          }).catch(function (err) { toast("bad", "Error", "Failed to load order"); warn(err); });
        }
      });
    });

    // Mark as received
    mount.querySelectorAll("[data-receive-order]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var orderId = Number(btn.getAttribute("data-receive-order"));
        btn.disabled = true;
        apiUpdateOrder(orderId, { status: "received" })
          .then(function () {
            toast("good", "Received", "Order #" + orderId + " marked as received");
            return loadOrders(mount);
          })
          .catch(function (err) { toast("bad", "Error", err.message || "Failed"); btn.disabled = false; });
      });
    });

    // Report problem (feedback)
    mount.querySelectorAll(".si-problem-select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var problemType = sel.value;
        if (!problemType) return;
        var itemId = Number(sel.getAttribute("data-feedback-item"));
        var desc = sel.getAttribute("data-fb-desc") || "";
        var batch = sel.getAttribute("data-fb-batch") || "";
        var expiryDate = sel.getAttribute("data-fb-expiry") || "";
        var qtyLabel = sel.getAttribute("data-fb-qty") || "";
        var supplierName = sel.getAttribute("data-fb-supplier") || "";

        E.modal.show("Report Problem",
          "<div style='line-height:1.7;'>" +
            "<b>" + esc(desc) + "</b><br>" +
            "Problem: <b style='color:#ff5a7a;'>" + esc(problemType) + "</b><br><br>" +
            "<label style='font-size:12px;color:rgba(233,238,247,.6);'>Additional notes (optional):</label><br>" +
            "<textarea id='si-feedback-notes' class='eikon-input' style='width:100%;height:60px;margin-top:4px;' placeholder='Describe the issue...'></textarea>" +
          "</div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); sel.value = ""; } },
            { label: "Submit Report", primary: true, onClick: function () {
              var notes = (document.getElementById("si-feedback-notes") || {}).value || "";
              E.modal.hide();

              E.apiFetch("/supplier-orders/items/" + itemId + "/feedback", {
                method: "POST",
                body: JSON.stringify({ problem_type: problemType, notes: notes })
              }).then(function () {
                toast("good", "Reported", "Problem reported for " + desc);

                // Re-fetch order detail to refresh feedback badges
                if (state.expandedOrderId) {
                  apiOrderDetail(state.expandedOrderId).then(function (resp) {
                    state.expandedItems = resp.items || [];
                    state.expandedFeedbacks = resp.feedbacks || [];
                    renderAll(mount);
                  }).catch(function () {});
                }

                // Ask to add to returns
                var today = new Date();
                var dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
                E.modal.show("Add to Returns?",
                  "<div style='line-height:1.7;'>" +
                    "Would you like to add <b>" + esc(desc) + "</b> to the Returns section?<br><br>" +
                    "<span style='font-size:12px;color:rgba(233,238,247,.5);'>" +
                      "Supplier: " + esc(supplierName) + "<br>" +
                      (batch ? "Batch: " + esc(batch) + "<br>" : "") +
                      (expiryDate ? "Expiry: " + esc(expiryDate) + "<br>" : "") +
                      "Qty: " + esc(qtyLabel) + "<br>" +
                      "Remarks: " + esc(problemType) + (notes ? " - " + esc(notes) : "") +
                    "</span>" +
                  "</div>",
                  [
                    { label: "No", onClick: function () { E.modal.hide(); } },
                    { label: "Add to Returns", primary: true, onClick: function () {
                      E.modal.hide();
                      E.apiFetch("/returns/entries", {
                        method: "POST",
                        body: JSON.stringify({
                          entry_date: dateStr,
                          description: desc,
                          supplier: supplierName,
                          batch: batch,
                          expiry: toYmd(expiryDate),
                          quantity: qtyLabel,
                          remarks: problemType + (notes ? " - " + notes : ""),
                          damaged: problemType === "Damaged" ? 1 : 0
                        })
                      }).then(function () {
                        toast("good", "Added", desc + " added to Returns");
                      }).catch(function (err) {
                        toast("bad", "Error", err.message || "Failed to add to Returns");
                      });
                    }}
                  ]
                );
              }).catch(function (err) {
                toast("bad", "Error", err.message || "Failed to submit report");
              });

              sel.value = "";
            }}
          ]
        );
      });
    });
  }

  function sortOrders() {
    var sk = state.orderSort.key;
    var sd = state.orderSort.dir === "asc" ? 1 : -1;
    state.orders.sort(function (a, b) {
      var va = a[sk], vb = b[sk];
      if (sk === "item_count") { va = Number(va) || 0; vb = Number(vb) || 0; }
      else { va = String(va || "").toLowerCase(); vb = String(vb || "").toLowerCase(); }
      if (va < vb) return -sd;
      if (va > vb) return sd;
      return 0;
    });
  }

  async function loadOrders(mount) {
    try {
      var resp = await apiSentOrders(state.orderStatusFilter || "");
      state.orders = resp.entries || [];
      state.expandedOrderId = null;
      state.expandedItems = [];
      state.expandedFeedbacks = [];
      sortOrders();
      renderAll(mount);
    } catch (err) {
      warn("Failed to load orders", err);
    }
  }

  async function refreshData(mount) {
    try {
      var resp = await apiInventory("", "");
      state.products = resp.entries || [];
      // Load expiry settings from cloud
      try {
        var settingsResp = await apiGetExpirySettings();
        if (settingsResp && settingsResp.settings) {
          state.expirySettings = {
            expiry_red_months: Number(settingsResp.settings.expiry_red_months) || 6,
            expiry_yellow_months: Number(settingsResp.settings.expiry_yellow_months) || 12
          };
        }
      } catch (e) { /* use defaults */ }
      // Load cart draft from cloud
      try {
        var draftResp = await apiGetCartDraft();
        var draftCart = draftResp.cart || {};
        var hydrated = {};
        for (var dk in draftCart) {
          if (!Object.prototype.hasOwnProperty.call(draftCart, dk)) continue;
          var draftItem = draftCart[dk];
          var prod = state.products.find(function (p) { return p.id === draftItem.product_id; });
          if (prod) {
            hydrated[dk] = { product: prod, qty: draftItem.qty || 1 };
          }
        }
        state.cart = hydrated;
      } catch (e) { /* use empty cart */ }
      applyFilter();
      renderAll(mount);
    } catch (err) {
      warn("Failed to load inventory", err);
      toast("bad", "Error", "Failed to load supplier inventory");
    }
  }

  // ─── CSS ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("si-styles")) return;
    var style = document.createElement("style");
    style.id = "si-styles";
    style.textContent = [
      ".si-tabs { display:flex; gap:4px; align-items:center; margin-bottom:14px; border-bottom:1px solid rgba(255,255,255,.08); padding-bottom:8px; }",
      ".si-tab { background:none; border:none; color:var(--muted); padding:8px 16px; cursor:pointer; font-size:13px; font-weight:600; border-radius:8px 8px 0 0; }",
      ".si-tab:hover { color:rgba(233,238,247,.9); }",
      ".si-tab-active { color:#5aa2ff; border-bottom:2px solid #5aa2ff; }",
      ".si-cart-badge { margin-left:auto; background:rgba(90,162,255,.2); color:#5aa2ff; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:700; }",
      ".si-toolbar { display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }",
      ".si-table-wrap { overflow:auto; max-height:386px; border:1px solid rgba(255,255,255,.08); border-radius:10px; }",
      ".si-table { width:100%; border-collapse:collapse; font-size:12px; }",
      ".si-table th { position:sticky; top:0; background:rgba(15,22,34,.98); padding:8px 6px; text-align:left; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:rgba(233,238,247,.6); border-bottom:1px solid rgba(255,255,255,.10); white-space:nowrap; user-select:none; }",
      ".si-table th:hover { color:rgba(233,238,247,.9); }",
      ".si-table th.num, .si-table td.num { text-align:right; }",
      ".si-table td { padding:6px; border-bottom:1px solid rgba(255,255,255,.05); white-space:nowrap; }",
      ".si-table tr:hover { background:rgba(90,162,255,.06); }",
      ".si-qty-input { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:inherit; padding:3px 4px; border-radius:4px; font-size:11px; text-align:center; }",
      ".si-cart-panel { margin-top:16px; padding:14px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:10px; }",
      ".si-cart-group { margin-bottom:14px; padding:10px; background:rgba(255,255,255,.02); border-radius:8px; }",
      ".si-cart-table { width:100%; border-collapse:collapse; font-size:12px; }",
      ".si-cart-table th { padding:2px 4px; font-size:10px; font-weight:600; color:rgba(233,238,247,.45); text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid rgba(255,255,255,.06); }",
      ".si-cart-table td { padding:3px 4px; border-bottom:1px solid rgba(255,255,255,.03); white-space:nowrap; }",
      ".si-cart-remove { background:none; border:none; color:rgba(255,255,255,.3); cursor:pointer; font-size:12px; }",
      ".si-cart-remove:hover { color:#ff5a7a; }",
      ".si-expiry-bar { display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:12px; }",
      ".si-expiry-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:600; }",
      ".si-expiry-red-chip { background:rgba(255,90,122,.12); color:#ff5a7a; }",
      ".si-expiry-yellow-chip { background:rgba(255,200,50,.10); color:#e8c840; }",
      ".si-expiry-input { width:42px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); color:inherit; padding:2px 4px; border-radius:4px; font-size:11px; text-align:center; }"
    ].join("\n");
    document.head.appendChild(style);
  }

  E.registerModule({
    id: "supplier-inventory",
    title: "Supplier Inventory",
    icon: "\uD83C\uDFED",
    order: 35,
    section: "pharmacy",
    render: async function (ctx) {
      injectStyles();
      state._mount = ctx.mount;
      state.tab = "inventory";
      state.cart = {};
      state.expandedOrderId = null;
      state.expandedItems = [];
      state.expandedFeedbacks = [];
      state.hiddenCols = loadHiddenCols();

      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:1400px;margin:0 auto;">' +
        '  <div style="font-weight:900;font-size:18px;margin-bottom:16px;">Supplier Inventory</div>' +
        '  <div id="si-content"></div>' +
        '</div>';

      await refreshData(ctx.mount);

      // 30s auto-update
      if (state._autoInterval) clearInterval(state._autoInterval);
      state._autoInterval = setInterval(function () {
        if (E.state.activeModuleId !== "supplier-inventory") return;
        if (state.tab === "orders") {
          // Preserve expansion state
          var prevExpanded = state.expandedOrderId;
          var prevItems = state.expandedItems;
          var prevFeedbacks = state.expandedFeedbacks;
          apiSentOrders("").then(function (resp) {
            if (E.state.activeModuleId !== "supplier-inventory") return;
            state.orders = resp.entries || [];
            state.expandedOrderId = prevExpanded;
            state.expandedFeedbacks = prevFeedbacks;
            state.expandedItems = prevItems;
            sortOrders();
            renderAll(ctx.mount);
          }).catch(function () {});
        } else {
          apiInventory(state.queries.keyword, state.queries.supplier).then(function (resp) {
            if (E.state.activeModuleId !== "supplier-inventory") return;
            state.products = resp.entries || [];
            applyFilter();
            renderAll(ctx.mount);
          }).catch(function () {});
        }
      }, 30000);

      // Clean up on module switch
      var onHashChange = function () {
        if (E.state.activeModuleId !== "supplier-inventory" || E.getHashModuleId() !== "supplier-inventory") {
          clearInterval(state._autoInterval);
          state._autoInterval = null;
          window.removeEventListener("hashchange", onHashChange);
        }
      };
      window.addEventListener("hashchange", onHashChange);
    }
  });
})();
