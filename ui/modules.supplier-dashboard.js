(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  }

  E.registerModule({
    id: "supplier-dashboard",
    title: "Supplier Dashboard",
    icon: "\uD83D\uDE9A",
    order: 1,
    section: "supplier",
    render: async function (ctx) {
      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:900px;margin:20px auto;">' +
        '  <div style="font-weight:900;font-size:20px;margin-bottom:16px;">\uD83D\uDE9A Supplier Dashboard</div>' +
        '  <div id="sdash-content" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
        '    <div class="eikon-card" style="text-align:center;padding:20px;opacity:.6;">Loading\u2026</div>' +
        '  </div>' +
        '</div>';

      var content = ctx.mount.querySelector("#sdash-content");

      try {
        var productsResp = await E.apiFetch("/supplier-products/entries", { method: "GET" });
        var products = productsResp.entries || [];
        var totalProducts = products.length;
        var outOfStock = products.filter(function (p) { return p.out_of_stock; }).length;
        var inStock = totalProducts - outOfStock;

        var ordersResp = await E.apiFetch("/supplier-orders/received", { method: "GET" });
        var orders = ordersResp.entries || [];
        var pendingOrders = orders.filter(function (o) { return o.status === "pending"; }).length;
        var shippedOrders = orders.filter(function (o) { return o.status === "shipped"; }).length;

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
          '</div>';

        var productsCard = ctx.mount.querySelector("#sdash-products");
        var ordersCard = ctx.mount.querySelector("#sdash-orders");
        if (productsCard) productsCard.addEventListener("click", function () { window.location.hash = "#supplier-products"; });
        if (ordersCard) ordersCard.addEventListener("click", function () { window.location.hash = "#supplier-received-orders"; });
      } catch (err) {
        content.innerHTML = '<div class="eikon-card" style="text-align:center;padding:20px;color:#ff5a7a;">Failed to load dashboard data</div>';
      }
    }
  });
})();
