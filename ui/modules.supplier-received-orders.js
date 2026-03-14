/* ui/modules.supplier-received-orders.js
   Eikon - Supplier Received Orders module
   Shows orders placed by pharmacy users, allows marking items unavailable and shipping.
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.supplier-received-orders.js)");

  var LP = "[EIKON][supplier-received-orders]";
  function log() { try { console.log.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }
  function warn() { try { console.warn.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }

  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  }
  function fmt2(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
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

  var state = {
    orders: [],
    filtered: [],
    sort: { key: "created_at", dir: "desc" },
    expandedOrderId: null,
    expandedItems: [],
    _mount: null
  };

  // ─── API ────────────────────────────────────────────────────────────────
  function apiListReceived() {
    return E.apiFetch("/supplier-orders/received", { method: "GET" });
  }
  function apiOrderDetail(id) {
    return E.apiFetch("/supplier-orders/" + id, { method: "GET" });
  }
  function apiConfirmOrder(id, data) {
    return E.apiFetch("/supplier-orders/" + id + "/confirm", {
      method: "PUT", body: JSON.stringify(data)
    });
  }
  function apiMarkItemUnavailable(itemId, unavailable, notes) {
    return E.apiFetch("/supplier-orders/items/" + itemId + "/unavailable", {
      method: "PUT", body: JSON.stringify({ unavailable: unavailable, notes: notes || "" })
    });
  }

  // ─── Status helpers ─────────────────────────────────────────────────────
  function statusBadge(status) {
    var colors = {
      pending: { bg: "rgba(255,175,50,.15)", fg: "#ffaf32" },
      confirmed: { bg: "rgba(90,162,255,.15)", fg: "#5aa2ff" },
      shipped: { bg: "rgba(90,162,255,.15)", fg: "#5aa2ff" },
      received: { bg: "rgba(67,209,122,.15)", fg: "#43d17a" }
    };
    var c = colors[status] || colors.pending;
    var label = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown";
    return "<span style='display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;" +
      "background:" + c.bg + ";color:" + c.fg + ";'>" + esc(label) + "</span>";
  }

  // ─── Sort ───────────────────────────────────────────────────────────────
  function applySort() {
    var sk = state.sort.key;
    var sd = state.sort.dir === "asc" ? 1 : -1;
    state.filtered = state.orders.slice().sort(function (a, b) {
      var va = a[sk], vb = b[sk];
      if (sk === "item_count") { va = Number(va) || 0; vb = Number(vb) || 0; }
      else if (sk === "created_at") { va = va || ""; vb = vb || ""; }
      else { va = String(va || "").toLowerCase(); vb = String(vb || "").toLowerCase(); }
      if (va < vb) return -sd;
      if (va > vb) return sd;
      return 0;
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  function renderAll(mount) {
    var content = mount.querySelector("#sro-content");
    if (!content) return;

    if (!state.filtered.length) {
      content.innerHTML = "<div style='text-align:center;padding:40px;'>" +
        "<div style='font-size:36px;margin-bottom:12px;'>\uD83D\uDCCB</div>" +
        "<div style='font-weight:700;'>No orders received yet</div>" +
        "<div style='color:var(--muted);margin-top:4px;'>Orders from pharmacy users will appear here.</div>" +
      "</div>";
      return;
    }

    var sk = state.sort.key;
    var sd = state.sort.dir;

    var cols = [
      { key: "id", label: "Order #" },
      { key: "pharmacy_name", label: "Pharmacy" },
      { key: "created_at", label: "Date" },
      { key: "item_count", label: "Items" },
      { key: "status", label: "Status" }
    ];

    var html = "<div class='sro-table-wrap'><table class='sro-table'><thead><tr>";
    cols.forEach(function (col) {
      var active = sk === col.key;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      html += "<th data-sort-key='" + col.key + "' style='cursor:pointer;'>" + esc(col.label) + arrow + "</th>";
    });
    html += "<th>Actions</th></tr></thead><tbody>";

    state.filtered.forEach(function (order) {
      var isExpanded = state.expandedOrderId === order.id;
      html += "<tr class='sro-order-row" + (isExpanded ? " sro-expanded" : "") + "' data-order-id='" + order.id + "'>" +
        "<td>#" + order.id + "</td>" +
        "<td>" + esc(order.pharmacy_name || "Unknown") + "</td>" +
        "<td>" + fmtDate(order.created_at) + "</td>" +
        "<td>" + (order.item_count || 0) + "</td>" +
        "<td>" + statusBadge(order.status) + "</td>" +
        "<td>" +
          "<button class='eikon-btn sro-expand-btn' data-expand-id='" + order.id + "'>" + (isExpanded ? "Collapse" : "View") + "</button>" +
        "</td>" +
      "</tr>";

      if (isExpanded) {
        html += "<tr class='sro-detail-row'><td colspan='6'>" + renderOrderDetail(order) + "</td></tr>";
      }
    });

    html += "</tbody></table></div>";
    content.innerHTML = html;
    wireTable(mount);
  }

  function renderOrderDetail(order) {
    var items = state.expandedItems;
    if (!items.length) return "<div style='padding:12px;color:var(--muted);'>Loading items\u2026</div>";

    var isPending = order.status === "pending";

    var html = "<div class='sro-detail'>" +
      "<div style='font-weight:700;margin-bottom:8px;'>Order Items</div>" +
      (order.notes ? "<div style='margin-bottom:8px;color:var(--muted);font-size:12px;'>Notes: " + esc(order.notes) + "</div>" : "") +
      "<table class='sro-items-table'><thead><tr>" +
      "<th>Description</th><th>Barcode</th><th>Stock Code</th><th>Qty Requested</th><th>Cost Excl</th><th>Status</th>" +
      (isPending ? "<th>Actions</th>" : "") +
      "</tr></thead><tbody>";

    items.forEach(function (item) {
      var unavail = item.unavailable ? 1 : 0;
      var rowStyle = unavail ? "text-decoration:line-through;opacity:0.5;" : "";
      html += "<tr style='" + rowStyle + "'>" +
        "<td>" + esc(item.description) + "</td>" +
        "<td>" + esc(item.barcode) + "</td>" +
        "<td>" + esc(item.stock_code) + "</td>" +
        "<td>" + (item.qty_requested || 0) + "</td>" +
        "<td>\u20ac" + fmt2(item.cost_excl_vat) + "</td>" +
        "<td>" + (unavail ? "<span style='color:#ff5a7a;font-weight:700;'>Unavailable</span>" : "<span style='color:#43d17a;'>Available</span>") + "</td>";

      if (isPending) {
        html += "<td><button class='eikon-btn sro-unavail-btn' data-item-id='" + item.id + "' data-unavail='" + (unavail ? "0" : "1") + "'>" +
          (unavail ? "Mark Available" : "Mark Unavailable") + "</button></td>";
      }
      html += "</tr>";
    });

    html += "</tbody></table>";

    if (isPending) {
      html += "<div style='margin-top:12px;'>" +
        "<button class='eikon-btn sp-btn-primary sro-ship-btn' data-ship-id='" + order.id + "'>Order Shipped</button>" +
      "</div>";
    }

    html += "</div>";
    return html;
  }

  function wireTable(mount) {
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
        applySort();
        renderAll(mount);
      });
    });

    // Expand/collapse
    mount.querySelectorAll("[data-expand-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var orderId = Number(btn.getAttribute("data-expand-id"));
        if (state.expandedOrderId === orderId) {
          state.expandedOrderId = null;
          state.expandedItems = [];
          renderAll(mount);
        } else {
          state.expandedOrderId = orderId;
          state.expandedItems = [];
          renderAll(mount); // Show loading
          apiOrderDetail(orderId).then(function (resp) {
            state.expandedItems = resp.items || [];
            renderAll(mount);
          }).catch(function (err) {
            toast("bad", "Error", "Failed to load order details");
            warn(err);
          });
        }
      });
    });

    // Mark unavailable
    mount.querySelectorAll("[data-item-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var itemId = Number(btn.getAttribute("data-item-id"));
        var unavail = btn.getAttribute("data-unavail") === "1";
        btn.disabled = true;
        apiMarkItemUnavailable(itemId, unavail, "")
          .then(function () {
            // Refresh detail
            return apiOrderDetail(state.expandedOrderId);
          })
          .then(function (resp) {
            state.expandedItems = resp.items || [];
            renderAll(mount);
          })
          .catch(function (err) { toast("bad", "Error", err.message || "Failed"); btn.disabled = false; });
      });
    });

    // Ship order
    mount.querySelectorAll("[data-ship-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var orderId = Number(btn.getAttribute("data-ship-id"));
        E.modal.show("Ship Order #" + orderId + "?",
          "<div>This will mark the order as shipped and notify the pharmacy.<br>Items marked as unavailable will be visible to the pharmacy.</div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); } },
            { label: "Ship Order", primary: true, onClick: function () {
              var itemUpdates = state.expandedItems.map(function (item) {
                return { id: item.id, unavailable: item.unavailable, qty_confirmed: item.unavailable ? 0 : item.qty_requested };
              });
              apiConfirmOrder(orderId, { status: "shipped", items: itemUpdates })
                .then(function () {
                  E.modal.hide();
                  toast("good", "Shipped", "Order #" + orderId + " marked as shipped");
                  return refreshData(mount);
                })
                .catch(function (err) { toast("bad", "Error", err.message || "Failed"); });
            }}
          ]
        );
      });
    });
  }

  async function refreshData(mount) {
    try {
      var resp = await apiListReceived();
      state.orders = resp.entries || [];
      state.expandedOrderId = null;
      state.expandedItems = [];
      applySort();
      renderAll(mount);
    } catch (err) {
      warn("Failed to load orders", err);
      toast("bad", "Error", "Failed to load received orders");
    }
  }

  // ─── CSS ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("sro-styles")) return;
    var style = document.createElement("style");
    style.id = "sro-styles";
    style.textContent = [
      ".sro-table-wrap { overflow-x:auto; border:1px solid rgba(255,255,255,.08); border-radius:10px; }",
      ".sro-table { width:100%; border-collapse:collapse; font-size:13px; }",
      ".sro-table th { position:sticky; top:0; background:rgba(15,22,34,.98); padding:10px 8px; text-align:left; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:rgba(233,238,247,.6); border-bottom:1px solid rgba(255,255,255,.10); white-space:nowrap; user-select:none; }",
      ".sro-table th:hover { color:rgba(233,238,247,.9); }",
      ".sro-table td { padding:8px; border-bottom:1px solid rgba(255,255,255,.05); }",
      ".sro-order-row { cursor:pointer; }",
      ".sro-order-row:hover { background:rgba(90,162,255,.06); }",
      ".sro-expanded { background:rgba(90,162,255,.04); }",
      ".sro-detail { padding:16px; background:rgba(255,255,255,.02); border-radius:8px; }",
      ".sro-items-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }",
      ".sro-items-table th { padding:6px 8px; text-align:left; font-size:11px; color:rgba(233,238,247,.6); border-bottom:1px solid rgba(255,255,255,.08); }",
      ".sro-items-table td { padding:6px 8px; border-bottom:1px solid rgba(255,255,255,.04); }",
      ".sro-expand-btn { font-size:11px !important; padding:3px 10px !important; }",
      ".sro-unavail-btn { font-size:10px !important; padding:2px 8px !important; }",
      ".sp-btn-primary { background:rgba(90,162,255,.2) !important; color:#5aa2ff !important; font-weight:700 !important; }"
    ].join("\n");
    document.head.appendChild(style);
  }

  E.registerModule({
    id: "supplier-received-orders",
    title: "Received Orders",
    icon: "\uD83D\uDCCB",
    order: 20,
    section: "supplier",
    render: async function (ctx) {
      injectStyles();
      state._mount = ctx.mount;
      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:1200px;margin:0 auto;">' +
        '  <div style="font-weight:900;font-size:18px;margin-bottom:16px;">Received Orders</div>' +
        '  <div id="sro-content"></div>' +
        '</div>';

      await refreshData(ctx.mount);
    }
  });
})();
