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
    statusFilter: "",
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
  function apiToggleProductStock(productId, outOfStock) {
    return E.apiFetch("/supplier-products/entries/" + productId + "/stock-status", {
      method: "PUT", body: JSON.stringify({ out_of_stock: outOfStock ? 1 : 0 })
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

    // Apply status filter
    var displayed = state.statusFilter
      ? state.filtered.filter(function (o) { return o.status === state.statusFilter; })
      : state.filtered;

    var sf = state.statusFilter;
    var filterHtml = "<div style='margin-bottom:8px;'>" +
      "<select id='sro-status-filter' class='eikon-input' style='width:150px;font-size:12px;'>" +
        "<option value=''" + (sf === "" ? " selected" : "") + ">All Statuses</option>" +
        "<option value='pending'" + (sf === "pending" ? " selected" : "") + ">Pending</option>" +
        "<option value='shipped'" + (sf === "shipped" ? " selected" : "") + ">Shipped</option>" +
        "<option value='received'" + (sf === "received" ? " selected" : "") + ">Received</option>" +
      "</select></div>";

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

    var html = filterHtml + "<div class='sro-table-wrap'><table class='sro-table'><thead><tr>";
    cols.forEach(function (col) {
      var active = sk === col.key;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      html += "<th data-sort-key='" + col.key + "' style='cursor:pointer;'>" + esc(col.label) + arrow + "</th>";
    });
    html += "<th>Actions</th></tr></thead><tbody>";

    displayed.forEach(function (order) {
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
      "<th>Description</th><th>Barcode</th><th>Stock Code</th><th>Qty</th><th>Free</th><th>Disc%</th><th>Cost Excl</th><th>Line Total</th><th>Status</th>" +
      (isPending ? "<th>Actions</th>" : "") +
      "</tr></thead><tbody>";

    var totalQty = 0, totalFree = 0, totalCostExcl = 0, totalCostIncl = 0, totalRetail = 0;

    items.forEach(function (item) {
      var unavail = item.unavailable ? 1 : 0;
      var rowStyle = unavail ? "text-decoration:line-through;opacity:0.5;" : "";
      var qtyFree = Number(item.qty_free) || 0;
      var discPct = Number(item.discount_pct) || 0;
      var qtyReq = Number(item.qty_requested) || 0;
      var costExcl = Number(item.cost_excl_vat) || 0;
      var vatRate = Number(item.vat_rate) || 0;
      var retailPrice = Number(item.retail_price) || 0;
      var lineTotal = qtyReq * costExcl;

      if (!unavail) {
        totalQty += qtyReq;
        totalFree += qtyFree;
        totalCostExcl += lineTotal;
        totalCostIncl += lineTotal * (1 + vatRate / 100);
        totalRetail += (qtyReq + qtyFree) * retailPrice;
      }

      // Show adjusted qty indicator
      var qtyDisplay = String(qtyReq);
      var qtyConf = item.qty_confirmed;
      if (!unavail && qtyConf !== undefined && qtyConf !== null && Number(qtyConf) !== qtyReq && Number(qtyConf) > 0) {
        qtyDisplay += " <span style='color:#ffaf32;font-size:11px;'>(" + qtyConf + " confirmed)</span>";
      }
      var descExtra = (item.notes && !unavail) ? "<div style='font-size:10px;color:var(--muted);'>" + esc(item.notes) + "</div>" : "";

      html += "<tr style='" + rowStyle + "'>" +
        "<td>" + esc(item.description) + descExtra + "</td>" +
        "<td>" + esc(item.barcode) + "</td>" +
        "<td>" + esc(item.stock_code) + "</td>" +
        "<td>" + qtyDisplay + "</td>" +
        "<td>" + (qtyFree > 0 ? "+" + qtyFree : "-") + "</td>" +
        "<td>" + (discPct > 0 ? fmt2(discPct) + "%" : "-") + "</td>" +
        "<td>\u20ac" + fmt2(costExcl) + "</td>" +
        "<td>\u20ac" + fmt2(lineTotal) + "</td>" +
        "<td>" + (unavail ? "<span style='color:#ff5a7a;font-weight:700;'>Unavailable</span>" : "<span style='color:#43d17a;'>Available</span>") + "</td>";

      if (isPending) {
        html += "<td style='white-space:nowrap;'>" +
          "<button class='eikon-btn sro-unavail-btn' data-item-id='" + item.id + "' data-unavail='" + (unavail ? "0" : "1") + "'" +
          " data-product-id='" + (item.product_id || "") + "'" +
          " data-item-desc='" + esc(item.description) + "'>" +
          (unavail ? "Available" : "Unavailable") + "</button>" +
          (!unavail ? " <button class='eikon-btn sro-adjust-qty-btn' data-adjust-item='" + item.id + "'" +
            " data-item-qty='" + qtyReq + "' data-item-desc='" + esc(item.description) + "'>Adjust Qty</button>" : "") +
          "</td>";
      }
      html += "</tr>";
    });

    html += "</tbody></table>";

    // Order summary
    var totalProfit = totalRetail - totalCostIncl;
    var profitPct = totalRetail > 0 ? (totalProfit / totalRetail) * 100 : 0;
    var mc = profitPct >= 25 ? "#43d17a" : profitPct >= 15 ? "#e8c840" : "#ff5a7a";

    html += "<div style='margin-top:8px;padding:8px 6px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(233,238,247,.7);display:flex;gap:16px;flex-wrap:wrap;'>" +
      "<span><b>Total Items:</b> " + totalQty + (totalFree > 0 ? " (+" + totalFree + " free)" : "") + "</span>" +
      "<span><b>Cost Excl:</b> \u20ac" + fmt2(totalCostExcl) + "</span>" +
      "<span><b>Cost Incl VAT:</b> \u20ac" + fmt2(totalCostIncl) + "</span>" +
      "<span><b>Profit Margin:</b> <span style='color:" + mc + ";font-weight:700;'>" + fmt2(profitPct) + "%</span></span>" +
    "</div>";

    if (isPending) {
      html += "<div style='margin-top:12px;display:flex;flex-direction:column;gap:6px;max-width:400px;'>" +
        "<textarea class='eikon-input sro-supplier-notes' placeholder='Notes for pharmacy (optional)...' " +
          "style='width:100%;height:36px;font-size:11px;resize:vertical;'>" + esc(order.supplier_notes || "") + "</textarea>" +
        "<div style='display:flex;gap:8px;align-items:center;'>" +
          "<label style='font-size:11px;color:rgba(233,238,247,.6);white-space:nowrap;'>Delivery date:</label>" +
          "<input type='date' class='eikon-input sro-delivery-date' value='" + esc(order.scheduled_delivery_date || "") + "' " +
            "style='font-size:11px;flex:1;'>" +
        "</div>" +
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

    // Status filter
    var statusFilterEl = mount.querySelector("#sro-status-filter");
    if (statusFilterEl) {
      statusFilterEl.addEventListener("change", function () {
        state.statusFilter = statusFilterEl.value;
        renderAll(mount);
      });
    }

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
        var productId = btn.getAttribute("data-product-id") || "";
        var itemDesc = btn.getAttribute("data-item-desc") || "";
        btn.disabled = true;

        apiMarkItemUnavailable(itemId, unavail, "")
          .then(function () {
            return apiOrderDetail(state.expandedOrderId);
          })
          .then(function (resp) {
            state.expandedItems = resp.items || [];
            renderAll(mount);

            // If marking as unavailable and we have a product_id, ask about out-of-stock
            if (unavail && productId) {
              E.modal.show("Mark as Out of Stock?",
                "<div style='line-height:1.6;'>You marked <b>" + esc(itemDesc) + "</b> as unavailable on this order." +
                "<br><br>Would you also like to mark it as <b>Out of Stock</b> on your product list? " +
                "This will notify pharmacy users that this item is currently unavailable.</div>",
                [
                  { label: "No, just this order", onClick: function () { E.modal.hide(); } },
                  { label: "Yes, mark Out of Stock", primary: true, onClick: function () {
                    apiToggleProductStock(productId, true)
                      .then(function () {
                        E.modal.hide();
                        toast("good", "Updated", esc(itemDesc) + " marked as out of stock on your product list");
                      })
                      .catch(function (err) {
                        E.modal.hide();
                        toast("bad", "Error", err.message || "Failed to update product stock status");
                      });
                  }}
                ]
              );
            }
          })
          .catch(function (err) { toast("bad", "Error", err.message || "Failed"); btn.disabled = false; });
      });
    });

    // Adjust qty (partial fulfillment)
    mount.querySelectorAll(".sro-adjust-qty-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var itemId = Number(btn.getAttribute("data-adjust-item"));
        var qtyReq = Number(btn.getAttribute("data-item-qty"));
        var itemDesc = btn.getAttribute("data-item-desc") || "";
        E.modal.show("Adjust Quantity",
          "<div style='line-height:1.6;'>Requested: <b>" + qtyReq + "</b> of <b>" + esc(itemDesc) + "</b><br><br>" +
          "<label style='font-size:12px;'>Qty you can supply:</label><br>" +
          "<input type='number' id='sro-adj-qty' class='eikon-input' min='0' max='" + qtyReq + "' value='" + qtyReq + "' style='width:80px;margin-top:4px;'><br><br>" +
          "<label style='font-size:12px;'>Note (optional):</label><br>" +
          "<input type='text' id='sro-adj-note' class='eikon-input' placeholder='e.g. Substituted with...' style='width:100%;margin-top:4px;'>" +
          "</div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); } },
            { label: "Confirm", primary: true, onClick: function () {
              var adjQty = Math.max(0, parseInt((document.getElementById("sro-adj-qty") || {}).value, 10) || 0);
              var adjNote = ((document.getElementById("sro-adj-note") || {}).value || "").trim();
              E.modal.hide();
              var item = state.expandedItems.find(function (i) { return i.id === itemId; });
              if (item) {
                item.qty_confirmed = adjQty;
                if (adjNote) item.notes = adjNote;
              }
              renderAll(mount);
            }}
          ]
        );
      });
    });

    // Ship order
    mount.querySelectorAll("[data-ship-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var orderId = Number(btn.getAttribute("data-ship-id"));
        // Read supplier notes and delivery date from DOM
        var supNotesEl = mount.querySelector(".sro-supplier-notes");
        var delivDateEl = mount.querySelector(".sro-delivery-date");
        var supplierNotes = supNotesEl ? supNotesEl.value.trim() : "";
        var deliveryDate = delivDateEl ? delivDateEl.value.trim() : "";

        E.modal.show("Ship Order #" + orderId + "?",
          "<div>This will mark the order as shipped and notify the pharmacy.<br>Items marked as unavailable will be visible to the pharmacy.</div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); } },
            { label: "Ship Order", primary: true, onClick: function () {
              var itemUpdates = state.expandedItems.map(function (item) {
                return {
                  id: item.id,
                  unavailable: item.unavailable,
                  qty_confirmed: item.unavailable ? 0 : (item.qty_confirmed !== undefined ? item.qty_confirmed : item.qty_requested),
                  notes: item.notes || ""
                };
              });
              apiConfirmOrder(orderId, {
                status: "shipped",
                items: itemUpdates,
                supplier_notes: supplierNotes,
                scheduled_delivery_date: deliveryDate
              })
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

      // 30s auto-update
      if (state._autoInterval) clearInterval(state._autoInterval);
      state._autoInterval = setInterval(function () {
        if (E.state.activeModuleId !== "supplier-received-orders") return;
        var prevExpanded = state.expandedOrderId;
        var prevItems = state.expandedItems;
        apiListReceived().then(function (resp) {
          if (E.state.activeModuleId !== "supplier-received-orders") return;
          state.orders = resp.entries || [];
          state.expandedOrderId = prevExpanded;
          state.expandedItems = prevItems;
          applySort();
          renderAll(ctx.mount);
        }).catch(function () {});
      }, 30000);

      var onHashChange = function () {
        if (E.state.activeModuleId !== "supplier-received-orders" || E.getHashModuleId() !== "supplier-received-orders") {
          clearInterval(state._autoInterval);
          state._autoInterval = null;
          window.removeEventListener("hashchange", onHashChange);
        }
      };
      window.addEventListener("hashchange", onHashChange);
    }
  });
})();
