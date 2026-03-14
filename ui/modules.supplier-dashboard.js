(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  }

  var _autoInterval = null;

  function injectStyles() {
    if (document.getElementById("sdash-styles")) return;
    var style = document.createElement("style");
    style.id = "sdash-styles";
    style.textContent =
      "@keyframes sdash-flash-red{0%,100%{background:rgba(255,90,122,.05);}50%{background:rgba(255,90,122,.18);}}";
    document.head.appendChild(style);
  }

  async function renderDashboard(mount) {
    var content = mount.querySelector("#sdash-content");
    if (!content) return;

    try {
      var productsResp = await E.apiFetch("/supplier-products/entries", { method: "GET" });
      var products = productsResp.entries || [];
      var uniqueMap = {};
      var oosMap = {};
      products.forEach(function (p) {
        var key = (p.description || "").toLowerCase().trim();
        uniqueMap[key] = true;
        if (p.out_of_stock) oosMap[key] = true;
      });
      var totalProducts = Object.keys(uniqueMap).length;
      var outOfStock = Object.keys(oosMap).length;
      var inStock = totalProducts - outOfStock;

      var ordersResp = await E.apiFetch("/supplier-orders/received", { method: "GET" });
      var orders = ordersResp.entries || [];
      var pendingOrders = orders.filter(function (o) { return o.status === "pending"; }).length;
      var shippedOrders = orders.filter(function (o) { return o.status === "shipped"; }).length;

      var feedbackResp = await E.apiFetch("/supplier-orders/feedback", { method: "GET" });
      var feedbacks = feedbackResp.entries || [];
      var unresolvedCount = 0;
      for (var i = 0; i < feedbacks.length; i++) {
        if (!feedbacks[i].resolution_status) unresolvedCount++;
      }

      var flashStyle = unresolvedCount > 0 ? "animation:sdash-flash-red 1.5s ease-in-out infinite;" : "";

      content.innerHTML =
        '<div class="eikon-card" style="text-align:center;padding:20px;cursor:pointer;" id="sdash-products">' +
        '  <div style="font-size:32px;margin-bottom:8px;">\uD83D\uDCE6</div>' +
        '  <div style="font-size:28px;font-weight:900;">' + totalProducts + '</div>' +
        '  <div style="color:var(--muted);font-size:13px;">Total Products</div>' +
        '  <div style="margin-top:8px;font-size:12px;">' +
        '    <span style="color:#43d17a;">' + inStock + ' in stock</span>' +
        (outOfStock ? ' &middot; <span style="color:#ff5a7a;">' + outOfStock + ' out of stock</span>' : '') +
        '  </div>' +
        '</div>' +
        '<div class="eikon-card" style="text-align:center;padding:20px;cursor:pointer;" id="sdash-orders">' +
        '  <div style="font-size:32px;margin-bottom:8px;">\uD83D\uDCCB</div>' +
        '  <div style="font-size:28px;font-weight:900;">' + pendingOrders + '</div>' +
        '  <div style="color:var(--muted);font-size:13px;">Pending Orders</div>' +
        '  <div style="margin-top:8px;font-size:12px;">' +
        (shippedOrders ? '<span style="color:#5aa2ff;">' + shippedOrders + ' shipped</span>' : '<span style="color:var(--muted);">No shipped orders</span>') +
        '  </div>' +
        '</div>' +
        '<div class="eikon-card" style="text-align:center;padding:20px;cursor:pointer;' + flashStyle + '" id="sdash-feedback">' +
        '  <div style="font-size:32px;margin-bottom:8px;">\u26A0\uFE0F</div>' +
        '  <div style="font-size:28px;font-weight:900;">' + unresolvedCount + '</div>' +
        '  <div style="color:var(--muted);font-size:13px;">Unresolved Feedbacks</div>' +
        '</div>';

      var productsCard = mount.querySelector("#sdash-products");
      var ordersCard = mount.querySelector("#sdash-orders");
      var feedbackCard = mount.querySelector("#sdash-feedback");
      if (productsCard) productsCard.addEventListener("click", function () { window.location.hash = "#supplier-products"; });
      if (ordersCard) ordersCard.addEventListener("click", function () { window.location.hash = "#supplier-received-orders"; });
      if (feedbackCard) feedbackCard.addEventListener("click", function () { window.location.hash = "#supplier-order-feedback"; });
    } catch (err) {
      content.innerHTML = '<div class="eikon-card" style="text-align:center;padding:20px;color:#ff5a7a;">Failed to load dashboard data</div>';
    }
  }

  E.registerModule({
    id: "supplier-dashboard",
    title: "Supplier Dashboard",
    icon: "\uD83D\uDE9A",
    order: 1,
    section: "supplier",
    render: async function (ctx) {
      injectStyles();
      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:900px;margin:20px auto;">' +
        '  <div style="font-weight:900;font-size:20px;margin-bottom:16px;">\uD83D\uDE9A Supplier Dashboard</div>' +
        '  <div id="sdash-content" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;">' +
        '    <div class="eikon-card" style="text-align:center;padding:20px;opacity:.6;">Loading\u2026</div>' +
        '  </div>' +
        '</div>';

      await renderDashboard(ctx.mount);

      // 30s auto-refresh
      if (_autoInterval) clearInterval(_autoInterval);
      _autoInterval = setInterval(function () {
        if (E.state.activeModuleId !== "supplier-dashboard") return;
        renderDashboard(ctx.mount);
      }, 30000);

      var onHashChange = function () {
        if (E.state.activeModuleId !== "supplier-dashboard" || E.getHashModuleId() !== "supplier-dashboard") {
          clearInterval(_autoInterval);
          _autoInterval = null;
          window.removeEventListener("hashchange", onHashChange);
        }
      };
      window.addEventListener("hashchange", onHashChange);
    }
  });
})();
