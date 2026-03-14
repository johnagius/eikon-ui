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
    expandedOrderId: null,
    expandedItems: [],
    _mount: null
  };

  // ─── API ────────────────────────────────────────────────────────────────
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
  function apiAddToOrderDiary(itemName, supplier) {
    var today = new Date();
    var dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    return E.apiFetch("/order-diary/entries", {
      method: "POST",
      body: JSON.stringify({ order_date: dateStr, item_name: itemName, supplier: supplier, qty: 1, status: "pending" })
    });
  }

  // ─── Sort/Filter ────────────────────────────────────────────────────────
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
    html += "</select></div>";

    if (!state.filtered.length) {
      html += "<div style='text-align:center;padding:40px;color:var(--muted);'>No products found.</div>";
      return html;
    }

    var sk = state.sort.key;
    var sd = state.sort.dir;

    var cols = [
      { key: "supplier_name", label: "Supplier" },
      { key: "stock_code", label: "Stock Code" },
      { key: "barcode", label: "Barcode" },
      { key: "description", label: "Description" },
      { key: "cost_excl_vat", label: "Cost Excl", num: true },
      { key: "vat_rate", label: "VAT%", num: true },
      { key: "retail_price", label: "Retail", num: true },
      { key: "profit_margin", label: "Margin%", num: true },
      { key: "out_of_stock", label: "Status" }
    ];

    html += "<div class='si-table-wrap'><table class='si-table'><thead><tr>";
    cols.forEach(function (col) {
      var active = sk === col.key;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      html += "<th class='" + (col.num ? "num" : "") + "' data-sort-key='" + col.key + "' style='cursor:pointer;'>" + esc(col.label) + arrow + "</th>";
    });
    html += "<th>Order</th></tr></thead><tbody>";

    state.filtered.forEach(function (row) {
      var oos = row.out_of_stock ? 1 : 0;
      var rowStyle = oos ? "opacity:0.5;" : "";
      var mc = profitMarginColor(row.profit_margin);
      var inCart = state.cart[row.id];

      html += "<tr style='" + rowStyle + "'>" +
        "<td>" + esc(row.supplier_name) + "</td>" +
        "<td>" + esc(row.stock_code) + "</td>" +
        "<td>" + esc(row.barcode) + "</td>" +
        "<td>" + esc(row.description) + "</td>" +
        "<td class='num'>\u20ac" + fmt2(row.cost_excl_vat) + "</td>" +
        "<td class='num'>" + (Number(row.vat_rate) || 0) + "%</td>" +
        "<td class='num'>\u20ac" + fmt2(row.retail_price) + "</td>" +
        "<td class='num'><span style='background:" + mc + "22;color:" + mc + ";padding:2px 8px;border-radius:6px;font-weight:700;font-size:11px;'>" +
          fmt2(row.profit_margin) + "% (" + profitMarginLabel(row.profit_margin) + ")</span></td>" +
        "<td>" + (oos ? "<span style='color:#ff5a7a;font-weight:700;font-size:11px;'>Out of Stock</span>" : "<span style='color:#43d17a;font-size:11px;'>In Stock</span>") + "</td>" +
        "<td style='white-space:nowrap;'>" +
          (oos ? "" :
            "<input type='number' class='si-qty-input' data-cart-id='" + row.id + "' value='" + (inCart ? inCart.qty : 1) + "' min='1' style='width:48px;'>" +
            "<button class='eikon-btn si-add-cart' data-cart-id='" + row.id + "' style='font-size:10px;padding:3px 8px;margin-left:4px;'>" + (inCart ? "\u2713 In Cart" : "+ Cart") + "</button>") +
          "<button class='eikon-btn si-add-diary' data-diary-desc='" + esc(row.description) + "' data-diary-sup='" + esc(row.supplier_name) + "' style='font-size:10px;padding:3px 6px;margin-left:4px;' title='Add to Order Diary'>+ Diary</button>" +
        "</td>" +
      "</tr>";
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

      group.items.forEach(function (item) {
        var lineTotal = round2(item.qty * (item.product.cost_excl_vat || 0));
        total += lineTotal;
        html += "<div class='si-cart-item'>" +
          "<span>" + esc(item.product.description) + " x" + item.qty + "</span>" +
          "<span>\u20ac" + fmt2(lineTotal) + "</span>" +
          "<button class='si-cart-remove' data-remove-id='" + item.product.id + "' title='Remove'>\u2715</button>" +
        "</div>";
      });

      html += "<div style='text-align:right;font-weight:700;font-size:12px;margin:6px 0;'>Total: \u20ac" + fmt2(total) + "</div>" +
        "<button class='eikon-btn sp-btn-primary si-commit-btn' data-commit-supplier='" + esc(supName) + "'>Commit Order to " + esc(supName) + "</button>" +
      "</div>";
    }

    html += "<button class='eikon-btn si-clear-cart' style='opacity:.65;margin-top:8px;'>Clear Cart</button></div>";
    return html;
  }

  function renderOrders() {
    if (!state.orders.length) {
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

    var html = "<div class='si-table-wrap'><table class='si-table'><thead><tr>";
    cols.forEach(function (col) {
      var active = sk === col.key;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      html += "<th data-order-sort-key='" + col.key + "' style='cursor:pointer;'>" + esc(col.label) + arrow + "</th>";
    });
    html += "<th>Actions</th></tr></thead><tbody>";

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

  function renderOrderItems(order) {
    var items = state.expandedItems;
    if (!items.length) return "<div style='padding:12px;color:var(--muted);'>Loading\u2026</div>";

    var html = "<div style='padding:12px;background:rgba(255,255,255,.02);border-radius:8px;'>" +
      "<table style='width:100%;border-collapse:collapse;font-size:12px;'><thead><tr>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Description</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Barcode</th>" +
      "<th style='text-align:right;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Qty</th>" +
      "<th style='text-align:right;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Cost</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Status</th>" +
      "</tr></thead><tbody>";

    items.forEach(function (item) {
      var unavail = item.unavailable ? 1 : 0;
      var rowStyle = unavail ? "text-decoration:line-through;opacity:0.5;" : "";
      html += "<tr style='" + rowStyle + "'>" +
        "<td style='padding:6px;'>" + esc(item.description) + "</td>" +
        "<td style='padding:6px;'>" + esc(item.barcode) + "</td>" +
        "<td style='padding:6px;text-align:right;'>" + (item.qty_requested || 0) + "</td>" +
        "<td style='padding:6px;text-align:right;'>\u20ac" + fmt2(item.cost_excl_vat) + "</td>" +
        "<td style='padding:6px;'>" + (unavail ?
          "<span style='color:#ff5a7a;font-weight:700;'>Unavailable</span>" :
          "<span style='color:#43d17a;'>Available</span>") + "</td>" +
      "</tr>";
    });

    html += "</tbody></table>";

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

    // Add to cart
    mount.querySelectorAll(".si-add-cart").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-cart-id"));
        var product = state.products.find(function (p) { return p.id === id; });
        if (!product) return;
        var qtyInput = mount.querySelector("input.si-qty-input[data-cart-id='" + id + "']");
        var qty = qtyInput ? Math.max(1, parseInt(qtyInput.value, 10) || 1) : 1;

        if (state.cart[id]) {
          delete state.cart[id];
        } else {
          state.cart[id] = { product: product, qty: qty };
        }
        renderAll(mount);
      });
    });

    // Qty input change
    mount.querySelectorAll(".si-qty-input").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var id = Number(inp.getAttribute("data-cart-id"));
        if (state.cart[id]) {
          state.cart[id].qty = Math.max(1, parseInt(inp.value, 10) || 1);
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
        renderAll(mount);
      });
    });

    // Clear cart
    var clearBtn = mount.querySelector(".si-clear-cart");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        state.cart = {};
        renderAll(mount);
      });
    }

    // Commit order
    mount.querySelectorAll(".si-commit-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var supName = btn.getAttribute("data-commit-supplier");
        var groups = cartBySupplier();
        var group = groups[supName];
        if (!group || !group.items.length) return;

        btn.disabled = true;
        btn.textContent = "Sending\u2026";

        var orderItems = group.items.map(function (ci) {
          return {
            product_id: ci.product.id,
            description: ci.product.description,
            barcode: ci.product.barcode || "",
            stock_code: ci.product.stock_code || "",
            qty_requested: ci.qty,
            cost_excl_vat: ci.product.cost_excl_vat || 0,
            vat_rate: ci.product.vat_rate || 18,
            retail_price: ci.product.retail_price || 0
          };
        });

        apiCreateOrder({
          supplier_location_id: group.supplier_location_id,
          supplier_name: supName,
          items: orderItems,
          notes: ""
        })
        .then(function (resp) {
          toast("good", "Order Sent", "Order #" + resp.id + " sent to " + supName);
          // Remove committed items from cart
          group.items.forEach(function (ci) { delete state.cart[ci.product.id]; });
          renderAll(mount);
        })
        .catch(function (err) {
          toast("bad", "Error", err.message || "Failed to send order");
          btn.disabled = false;
          btn.textContent = "Commit Order to " + supName;
        });
      });
    });
  }

  function wireOrders(mount) {
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

    // Expand order
    mount.querySelectorAll("[data-expand-order]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var orderId = Number(btn.getAttribute("data-expand-order"));
        if (state.expandedOrderId === orderId) {
          state.expandedOrderId = null;
          state.expandedItems = [];
          renderAll(mount);
        } else {
          state.expandedOrderId = orderId;
          state.expandedItems = [];
          renderAll(mount);
          apiOrderDetail(orderId).then(function (resp) {
            state.expandedItems = resp.items || [];
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
      var resp = await apiSentOrders("");
      state.orders = resp.entries || [];
      state.expandedOrderId = null;
      state.expandedItems = [];
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
      ".si-table-wrap { overflow-x:auto; max-height:55vh; border:1px solid rgba(255,255,255,.08); border-radius:10px; }",
      ".si-table { width:100%; border-collapse:collapse; font-size:12px; }",
      ".si-table th { position:sticky; top:0; background:rgba(15,22,34,.98); padding:8px 6px; text-align:left; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:rgba(233,238,247,.6); border-bottom:1px solid rgba(255,255,255,.10); white-space:nowrap; user-select:none; }",
      ".si-table th:hover { color:rgba(233,238,247,.9); }",
      ".si-table th.num, .si-table td.num { text-align:right; }",
      ".si-table td { padding:6px; border-bottom:1px solid rgba(255,255,255,.05); white-space:nowrap; }",
      ".si-table tr:hover { background:rgba(90,162,255,.06); }",
      ".si-qty-input { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:inherit; padding:3px 4px; border-radius:4px; font-size:11px; text-align:center; }",
      ".si-cart-panel { margin-top:16px; padding:14px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:10px; }",
      ".si-cart-group { margin-bottom:14px; padding:10px; background:rgba(255,255,255,.02); border-radius:8px; }",
      ".si-cart-item { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:4px 0; font-size:12px; }",
      ".si-cart-remove { background:none; border:none; color:rgba(255,255,255,.3); cursor:pointer; font-size:12px; }",
      ".si-cart-remove:hover { color:#ff5a7a; }"
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

      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:1400px;margin:0 auto;">' +
        '  <div style="font-weight:900;font-size:18px;margin-bottom:16px;">Supplier Inventory</div>' +
        '  <div id="si-content"></div>' +
        '</div>';

      await refreshData(ctx.mount);
    }
  });
})();
