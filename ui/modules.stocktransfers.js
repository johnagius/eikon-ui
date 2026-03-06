/* ui/modules.stocktransfers.js
   Eikon — Stock Transfers module (UI)

   Transfer stock between pharmacies within the same organisation.
   Items can be placed for transfer, requested by other pharmacies,
   and tracked through a confirmation workflow.

   Endpoints (Cloudflare Worker):
   GET    /stock-transfers/items
   POST   /stock-transfers/items
   PUT    /stock-transfers/items/:id
   DELETE /stock-transfers/items/:id

   POST   /stock-transfers/items/:id/requests
   PUT    /stock-transfers/requests/:id
   DELETE /stock-transfers/requests/:id

   POST   /stock-transfers/requests/:id/accept
   POST   /stock-transfers/requests/:id/reject
   POST   /stock-transfers/requests/:id/confirm-dispatch
   POST   /stock-transfers/requests/:id/confirm-delivery

   Workflow:
   1. Pharmacy A places item for transfer (status: open)
   2. Pharmacy B requests a transfer (request status: pending)
   3. Pharmacy A accepts request (request status: accepted)
   4. Pharmacy A confirms dispatch (request status: dispatched)
   5. Pharmacy B confirms delivery (request status: delivered)
   6. Quantity on original item reduced accordingly

   Rules:
   - Expired items cannot be transferred (auto-detected, greyed, closed)
   - Partial quantities allowed
   - Items can be placed onto Returns or Scarce Stock modules
   - Removing from transfer also removes from Returns/Scarce Stock if placed via transfer
   - Only pharmacies within the same organisation can see each other's items
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ────────────────────────────────────────────
  // Utilities
  // ────────────────────────────────────────────
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }

  function pad2(n) { n = String(n); return n.length === 1 ? "0" + n : n; }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmtDmy(ymd) {
    var s = String(ymd || "").trim();
    if (!isYmd(s)) return s || "";
    return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
  }

  function isExpired(ymd) {
    if (!isYmd(ymd)) return false;
    return ymd < todayYmd();
  }

  function api(method, path, body) {
    return E.apiFetch(path, { method: method, body: body ? JSON.stringify(body) : undefined });
  }

  // ────────────────────────────────────────────
  // Toast (self-contained)
  // ────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById("st-style")) return;
    var st = document.createElement("style");
    st.id = "st-style";
    st.textContent =
      ".st-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(520px,calc(100vw - 28px));}" +
      ".st-toast{border:1px solid rgba(255,255,255,.12);background:rgba(12,16,24,.92);backdrop-filter:blur(10px);border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);}" +
      ".st-toast .t-title{font-weight:900;margin:0 0 2px 0;font-size:13px;}" +
      ".st-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".st-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".st-toast.bad{border-color:rgba(255,90,122,.35);}" +
      ".st-toast.warn{border-color:rgba(255,200,90,.35);}" +

      /* Table & row styles */
      ".st-row-selected{background:rgba(58,160,255,.10)!important;}" +
      ".st-row-selected td{border-bottom-color:rgba(58,160,255,.22)!important;}" +
      ".st-row-expired{opacity:.55;}" +
      ".st-row-expired td{text-decoration:line-through;}" +
      ".st-mini{font-size:12px;opacity:.85;}" +
      ".st-panel{border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:14px;padding:12px;}" +
      ".st-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;}" +
      "@media (max-width: 860px){.st-split{grid-template-columns:1fr;}}" +
      ".st-badge{display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;line-height:1.2;}" +
      ".st-badge-open{background:rgba(90,162,255,.15);border:1px solid rgba(90,162,255,.3);color:rgba(90,162,255,.95);}" +
      ".st-badge-pending{background:rgba(255,200,90,.15);border:1px solid rgba(255,200,90,.3);color:rgba(255,200,90,.95);}" +
      ".st-badge-accepted{background:rgba(90,162,255,.15);border:1px solid rgba(90,162,255,.3);color:rgba(90,162,255,.95);}" +
      ".st-badge-dispatched{background:rgba(160,120,255,.15);border:1px solid rgba(160,120,255,.3);color:rgba(160,120,255,.95);}" +
      ".st-badge-delivered{background:rgba(67,209,122,.15);border:1px solid rgba(67,209,122,.3);color:rgba(67,209,122,.95);}" +
      ".st-badge-rejected{background:rgba(255,90,122,.15);border:1px solid rgba(255,90,122,.3);color:rgba(255,90,122,.95);}" +
      ".st-badge-closed{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.6);}" +
      ".st-badge-expired{background:rgba(255,90,122,.12);border:1px solid rgba(255,90,122,.25);color:rgba(255,90,122,.85);}" +

      /* Flash animation for pending items */
      "@keyframes st-flash{0%,100%{background:rgba(255,200,90,.18);box-shadow:inset 0 0 0 2px rgba(255,200,90,.4)}50%{background:rgba(255,200,90,.04);box-shadow:none}}" +
      ".st-flash-row{animation:st-flash 1.4s ease-in-out infinite}" +

      /* Nested requests table */
      ".st-req-table{width:100%;border-collapse:collapse;margin:6px 0 0 0;}" +
      ".st-req-table th,.st-req-table td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;font-size:12px;}" +
      ".st-req-table th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.2px;}" +

      /* Tabs */
      ".st-tabs{display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:14px;}" +
      ".st-tab{padding:10px 18px;font-size:13px;font-weight:800;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;opacity:.7;user-select:none;}" +
      ".st-tab:hover{opacity:.9;}" +
      ".st-tab.active{border-bottom-color:var(--accent);opacity:1;}" +

      /* Action button groups */
      ".st-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}" +
      ".st-actions .eikon-btn{font-size:12px;padding:6px 10px;}";
    document.head.appendChild(st);
  }

  function toast(kind, title, msg) {
    ensureStyles();
    var wrap = document.getElementById("st-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "st-toast-wrap";
      wrap.className = "st-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "st-toast " + (kind || "");
    t.innerHTML = "<div class='t-title'>" + esc(title || "") + "</div><div class='t-msg'>" + esc(msg || "") + "</div>";
    wrap.appendChild(t);
    setTimeout(function () {
      try { wrap.removeChild(t); } catch (e) {}
      if (wrap.childNodes.length === 0) { try { wrap.parentNode.removeChild(wrap); } catch (e2) {} }
    }, 3200);
  }

  function modalError(title, err) {
    var msg = (err && (err.message || err.error)) ? (err.message || err.error) : String(err || "Error");
    E.modal.show(title || "Error", "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
  }

  // ────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────
  var state = {
    tab: "available",        // "available" | "incoming"
    q: "",
    filterOpen: true,        // true = open only, false = include closed
    items: [],               // all items (available for transfer)
    filtered: [],
    selectedId: null,
    busy: false,
    expandedIds: {},         // items with requests expanded
    refreshTimer: null
  };

  var REFRESH_INTERVAL = 30000; // 30s auto-refresh

  // ────────────────────────────────────────────
  // Data helpers
  // ────────────────────────────────────────────
  function statusBadge(status) {
    var s = norm(status) || "open";
    var map = {
      "open": "Open",
      "pending": "Pending",
      "accepted": "Accepted",
      "dispatched": "Dispatched",
      "delivered": "Delivered",
      "rejected": "Rejected",
      "closed": "Closed",
      "expired": "Expired"
    };
    var label = map[s] || s;
    return '<span class="st-badge st-badge-' + esc(s) + '">' + esc(label) + '</span>';
  }

  function applyFilter() {
    var q = norm(state.q);
    var list = state.items.slice();

    // Tab filter
    if (state.tab === "available") {
      // Items from ALL pharmacies that are open for transfer (including mine)
    } else {
      // "incoming" — requests made TO my items or requests I've made
    }

    // Open/closed filter
    if (state.filterOpen) {
      list = list.filter(function (item) {
        return !item.is_closed;
      });
    }

    // Search
    if (q) {
      list = list.filter(function (item) {
        var blob = [
          item.item_description, item.batch, item.expiry_date,
          String(item.quantity_available), item.org_name, item.location_name,
          item.close_reason
        ].join(" ").toLowerCase();
        return blob.indexOf(q) !== -1;
      });
    }

    state.filtered = list;
  }

  // ────────────────────────────────────────────
  // API calls
  // ────────────────────────────────────────────
  async function doRefresh() {
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("GET", "/stock-transfers/items?ts=" + Date.now());
      if (!res || !res.ok) throw new Error((res && res.error) || "Load failed");
      state.items = (res.items || []).map(function (item) {
        // Auto-detect expired items
        if (item.expiry_date && isExpired(item.expiry_date) && !item.is_closed) {
          item._expired = true;
        } else {
          item._expired = false;
        }
        return item;
      });
      applyFilter();
      renderContent();
    } catch (e) {
      modalError("Refresh failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  function setBusyUI(on) {
    var b = document.getElementById("st-busy");
    if (b) b.textContent = on ? "Working…" : "";
    ["st-refresh", "st-new", "st-print"].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.disabled = !!on;
    });
  }

  async function doCreate(body) {
    state.busy = true;
    setBusyUI(true);
    try {
      if (!body.item_description || !String(body.item_description).trim()) {
        toast("warn", "Description required", "Please enter an item description.");
        return;
      }
      if (body.expiry_date && isExpired(body.expiry_date)) {
        toast("warn", "Item expired", "Expired items cannot be placed for transfer.");
        return;
      }
      var qty = parseInt(body.quantity_available, 10);
      if (!qty || qty < 1) {
        toast("warn", "Quantity required", "Please enter a valid quantity (at least 1).");
        return;
      }
      body.quantity_available = qty;

      var res = await api("POST", "/stock-transfers/items", body);
      if (!res || !res.ok) throw new Error((res && res.error) || "Create failed");
      toast("good", "Created", "Item placed for transfer.");
      await doRefresh();
    } catch (e) {
      modalError("Create failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  async function doUpdate(id, body) {
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("PUT", "/stock-transfers/items/" + encodeURIComponent(id), body);
      if (!res || !res.ok) throw new Error((res && res.error) || "Update failed");
      toast("good", "Updated", "Transfer item updated.");
      await doRefresh();
    } catch (e) {
      modalError("Update failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  async function doDeleteItem(id) {
    E.modal.show(
      "Remove from transfer?",
      "<div style='white-space:pre-wrap'>This will remove the item from the transfer list.\n\nIf this item was also placed on Returns or Scarce Stock via the transfer module, it will be removed from those modules as well.\n\nAny pending requests will be cancelled.</div>",
      [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Remove",
          danger: true,
          primary: true,
          onClick: function () {
            E.modal.hide();
            (async function () {
              state.busy = true;
              setBusyUI(true);
              try {
                var res = await api("DELETE", "/stock-transfers/items/" + encodeURIComponent(id));
                if (!res || !res.ok) throw new Error((res && res.error) || "Delete failed");
                toast("good", "Removed", "Item removed from transfer.");
                state.selectedId = null;
                await doRefresh();
              } catch (e) {
                modalError("Delete failed", e);
              } finally {
                state.busy = false;
                setBusyUI(false);
              }
            })();
          }
        }
      ]
    );
  }

  // --- Request operations ---
  async function doRequestTransfer(itemId) {
    var item = findItem(itemId);
    if (!item) return;

    var remaining = (item.remaining_quantity != null) ? item.remaining_quantity : item.quantity_available;

    var body =
      '<div style="margin-bottom:12px;">Request transfer of <b>' + esc(item.item_description) + '</b> from <b>' + esc(item.location_name) + '</b></div>' +
      '<div class="eikon-field" style="margin-bottom:12px;">' +
        '<div class="eikon-label">Quantity (available: ' + esc(remaining) + ')</div>' +
        '<input id="st-req-qty" class="eikon-input" type="number" min="1" max="' + esc(remaining) + '" value="' + esc(remaining) + '" style="max-width:160px;">' +
      '</div>' +
      '<div class="eikon-field">' +
        '<div class="eikon-label">Note (optional — visible to both parties only)</div>' +
        '<input id="st-req-note" class="eikon-input" placeholder="Any notes…">' +
      '</div>';

    E.modal.show("Request Transfer", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Request",
        primary: true,
        onClick: function () {
          var qty = parseInt((document.getElementById("st-req-qty") || {}).value, 10);
          var note = String((document.getElementById("st-req-note") || {}).value || "").trim();
          if (!qty || qty < 1) { toast("warn", "Invalid quantity", "Enter at least 1."); return; }
          if (qty > remaining) { toast("warn", "Too many", "Only " + remaining + " available."); return; }
          E.modal.hide();
          (async function () {
            state.busy = true;
            setBusyUI(true);
            try {
              var res = await api("POST", "/stock-transfers/items/" + encodeURIComponent(itemId) + "/requests", {
                quantity_requested: qty,
                note: note
              });
              if (!res || !res.ok) throw new Error((res && res.error) || "Request failed");
              toast("good", "Requested", "Transfer request submitted.");
              await doRefresh();
            } catch (e) {
              modalError("Request failed", e);
            } finally {
              state.busy = false;
              setBusyUI(false);
            }
          })();
        }
      }
    ]);
  }

  async function doAcceptRequest(requestId) {
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("POST", "/stock-transfers/requests/" + encodeURIComponent(requestId) + "/accept");
      if (!res || !res.ok) throw new Error((res && res.error) || "Accept failed");
      toast("good", "Accepted", "Transfer request accepted.");
      await doRefresh();
    } catch (e) {
      modalError("Accept failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  async function doRejectRequest(requestId) {
    E.modal.show(
      "Reject transfer request?",
      "<div>This will reject the transfer request. The requesting pharmacy will be notified.</div>",
      [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Reject",
          danger: true,
          primary: true,
          onClick: function () {
            E.modal.hide();
            (async function () {
              state.busy = true;
              setBusyUI(true);
              try {
                var res = await api("POST", "/stock-transfers/requests/" + encodeURIComponent(requestId) + "/reject");
                if (!res || !res.ok) throw new Error((res && res.error) || "Reject failed");
                toast("good", "Rejected", "Transfer request rejected.");
                await doRefresh();
              } catch (e) {
                modalError("Reject failed", e);
              } finally {
                state.busy = false;
                setBusyUI(false);
              }
            })();
          }
        }
      ]
    );
  }

  async function doConfirmDispatch(requestId) {
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("POST", "/stock-transfers/requests/" + encodeURIComponent(requestId) + "/confirm-dispatch");
      if (!res || !res.ok) throw new Error((res && res.error) || "Dispatch failed");
      toast("good", "Dispatched", "Transfer marked as dispatched.");
      await doRefresh();
    } catch (e) {
      modalError("Dispatch failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  async function doConfirmDelivery(requestId) {
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("POST", "/stock-transfers/requests/" + encodeURIComponent(requestId) + "/confirm-delivery");
      if (!res || !res.ok) throw new Error((res && res.error) || "Confirm failed");
      toast("good", "Received", "Delivery confirmed. Quantity updated.");
      await doRefresh();
    } catch (e) {
      modalError("Confirm failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  async function doDeleteRequest(requestId) {
    E.modal.show(
      "Cancel transfer request?",
      "<div>This will cancel your transfer request.</div>",
      [
        { label: "Keep", onClick: function () { E.modal.hide(); } },
        {
          label: "Cancel Request",
          danger: true,
          primary: true,
          onClick: function () {
            E.modal.hide();
            (async function () {
              state.busy = true;
              setBusyUI(true);
              try {
                var res = await api("DELETE", "/stock-transfers/requests/" + encodeURIComponent(requestId));
                if (!res || !res.ok) throw new Error((res && res.error) || "Delete failed");
                toast("good", "Cancelled", "Transfer request cancelled.");
                await doRefresh();
              } catch (e) {
                modalError("Delete failed", e);
              } finally {
                state.busy = false;
                setBusyUI(false);
              }
            })();
          }
        }
      ]
    );
  }

  // --- Cross-module placement ---
  async function doPlaceOnReturns(itemId) {
    var item = findItem(itemId);
    if (!item) return;
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("POST", "/stock-transfers/items/" + encodeURIComponent(itemId) + "/place-on-returns");
      if (!res || !res.ok) throw new Error((res && res.error) || "Failed");
      toast("good", "Done", "Item placed on Returns module.");
      await doRefresh();
    } catch (e) {
      modalError("Place on Returns failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  async function doPlaceOnScarceStock(itemId) {
    var item = findItem(itemId);
    if (!item) return;
    if (item._expired || (item.expiry_date && isExpired(item.expiry_date))) {
      toast("warn", "Cannot place", "Expired items cannot be placed on Scarce Stock.");
      return;
    }
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("POST", "/stock-transfers/items/" + encodeURIComponent(itemId) + "/place-on-scarce-stock");
      if (!res || !res.ok) throw new Error((res && res.error) || "Failed");
      toast("good", "Done", "Item placed on Scarce Stock (Available).");
      await doRefresh();
    } catch (e) {
      modalError("Place on Scarce Stock failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (String(state.items[i].id) === String(id)) return state.items[i];
    }
    return null;
  }

  // ────────────────────────────────────────────
  // Rendering
  // ────────────────────────────────────────────
  function renderContent() {
    if (state.tab === "available") {
      renderAvailableTab();
    } else {
      renderIncomingTab();
    }
  }

  function renderAvailableTab() {
    var tbody = document.getElementById("st-tbody");
    var count = document.getElementById("st-count");
    if (!tbody) return;

    applyFilter();
    var list = state.filtered;
    if (count) count.textContent = String(list.length);

    tbody.innerHTML = "";
    if (!list.length) {
      tbody.innerHTML = "<tr><td colspan='7' style='opacity:.75;text-align:center;padding:18px;'>No items available for transfer.</td></tr>";
      return;
    }

    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var expired = item._expired || (item.expiry_date && isExpired(item.expiry_date));
        var remaining = (item.remaining_quantity != null) ? item.remaining_quantity : item.quantity_available;
        var requests = Array.isArray(item.requests) ? item.requests : [];
        var hasPending = false;
        for (var r = 0; r < requests.length; r++) {
          var rs = norm(requests[r].status);
          if (rs === "pending" || rs === "accepted" || rs === "dispatched") {
            hasPending = true;
            break;
          }
        }

        var trClass = "";
        if (expired) trClass = "st-row-expired";
        else if (state.selectedId && String(item.id) === String(state.selectedId)) trClass = "st-row-selected";
        else if (hasPending && item.mine_owner) trClass = "st-flash-row";

        var tr = document.createElement("tr");
        tr.className = trClass;
        tr.style.cursor = "pointer";

        var statusHtml;
        if (expired) {
          statusHtml = statusBadge("expired");
        } else if (item.is_closed) {
          statusHtml = statusBadge("closed");
        } else {
          statusHtml = statusBadge("open");
        }

        var reqCount = requests.length;
        var reqInfo = reqCount ? (reqCount + " request" + (reqCount > 1 ? "s" : "")) : "—";

        tr.innerHTML =
          "<td style='white-space:nowrap;'>" + esc(fmtDmy(item.entry_date)) + "</td>" +
          "<td><b>" + esc(item.item_description || "") + "</b>" +
            "<div class='st-mini'>" + esc(item.org_name || "") + " — " + esc(item.location_name || "") + "</div>" +
          "</td>" +
          "<td>" + esc(item.batch || "—") + "</td>" +
          "<td>" + (item.expiry_date ? esc(fmtDmy(item.expiry_date)) : "—") + "</td>" +
          "<td style='text-align:center;font-weight:800;'>" + esc(remaining) + " / " + esc(item.quantity_available) + "</td>" +
          "<td style='text-align:center;'>" + statusHtml + "</td>" +
          "<td style='text-align:center;'>" + esc(reqInfo) + "</td>";

        tr.addEventListener("click", function () {
          state.selectedId = (state.selectedId === String(item.id)) ? null : String(item.id);
          renderContent();
        });

        tbody.appendChild(tr);

        // Expanded detail row for selected item
        if (state.selectedId && String(item.id) === String(state.selectedId)) {
          var detTr = document.createElement("tr");
          detTr.innerHTML = "<td colspan='7' style='padding:0;'>" + renderItemDetail(item) + "</td>";
          tbody.appendChild(detTr);
        }
      })(list[i]);
    }
  }

  function renderIncomingTab() {
    // Show items where I have requests (sent or received)
    var tbody = document.getElementById("st-tbody");
    var count = document.getElementById("st-count");
    if (!tbody) return;

    // Filter to items that have requests involving me
    var list = state.items.filter(function (item) {
      var requests = Array.isArray(item.requests) ? item.requests : [];
      // Show if I own the item and have requests, or if I have a request on this item
      if (item.mine_owner && requests.length > 0) return true;
      for (var r = 0; r < requests.length; r++) {
        if (requests[r].mine) return true;
      }
      return false;
    });

    // Apply search
    var q = norm(state.q);
    if (q) {
      list = list.filter(function (item) {
        var blob = [
          item.item_description, item.batch, item.expiry_date,
          String(item.quantity_available), item.org_name, item.location_name
        ].join(" ").toLowerCase();
        return blob.indexOf(q) !== -1;
      });
    }

    if (count) count.textContent = String(list.length);

    tbody.innerHTML = "";
    if (!list.length) {
      tbody.innerHTML = "<tr><td colspan='7' style='opacity:.75;text-align:center;padding:18px;'>No transfer requests.</td></tr>";
      return;
    }

    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var requests = Array.isArray(item.requests) ? item.requests : [];
        var hasPendingForMe = false;
        var hasUnconfirmed = false;
        for (var r = 0; r < requests.length; r++) {
          var rs = norm(requests[r].status);
          if (item.mine_owner && rs === "pending") hasPendingForMe = true;
          if (requests[r].mine && rs === "dispatched") hasUnconfirmed = true;
        }

        var trClass = "";
        if (hasPendingForMe || hasUnconfirmed) trClass = "st-flash-row";
        else if (state.selectedId && String(item.id) === String(state.selectedId)) trClass = "st-row-selected";

        var tr = document.createElement("tr");
        tr.className = trClass;
        tr.style.cursor = "pointer";

        var remaining = (item.remaining_quantity != null) ? item.remaining_quantity : item.quantity_available;

        var direction = item.mine_owner ? "Outgoing" : "Incoming";
        var dirBadge = item.mine_owner
          ? '<span class="st-badge" style="background:rgba(255,165,0,.15);border:1px solid rgba(255,165,0,.3);color:rgba(255,200,100,.95);">Outgoing</span>'
          : '<span class="st-badge" style="background:rgba(67,209,122,.15);border:1px solid rgba(67,209,122,.3);color:rgba(67,209,122,.95);">Incoming</span>';

        tr.innerHTML =
          "<td style='white-space:nowrap;'>" + esc(fmtDmy(item.entry_date)) + "</td>" +
          "<td><b>" + esc(item.item_description || "") + "</b>" +
            "<div class='st-mini'>" + esc(item.org_name || "") + " — " + esc(item.location_name || "") + "</div>" +
          "</td>" +
          "<td>" + esc(item.batch || "—") + "</td>" +
          "<td>" + (item.expiry_date ? esc(fmtDmy(item.expiry_date)) : "—") + "</td>" +
          "<td style='text-align:center;font-weight:800;'>" + esc(remaining) + " / " + esc(item.quantity_available) + "</td>" +
          "<td style='text-align:center;'>" + dirBadge + "</td>" +
          "<td style='text-align:center;'>" + esc(requests.length) + " request(s)</td>";

        tr.addEventListener("click", function () {
          state.selectedId = (state.selectedId === String(item.id)) ? null : String(item.id);
          renderContent();
        });

        tbody.appendChild(tr);

        // Expanded detail
        if (state.selectedId && String(item.id) === String(state.selectedId)) {
          var detTr = document.createElement("tr");
          detTr.innerHTML = "<td colspan='7' style='padding:0;'>" + renderItemDetail(item) + "</td>";
          tbody.appendChild(detTr);
        }
      })(list[i]);
    }
  }

  function renderItemDetail(item) {
    var expired = item._expired || (item.expiry_date && isExpired(item.expiry_date));
    var remaining = (item.remaining_quantity != null) ? item.remaining_quantity : item.quantity_available;
    var requests = Array.isArray(item.requests) ? item.requests : [];

    var html = '<div class="st-panel" style="margin:8px 12px 12px 12px;">';

    // Item info
    html += '<div style="font-weight:900;margin-bottom:8px;">Transfer Details</div>';
    html += '<div class="st-split">';
    html += '<div>';
    html += '<div class="st-mini"><b>Item:</b> ' + esc(item.item_description) + '</div>';
    html += '<div class="st-mini"><b>From:</b> ' + esc(item.org_name || "") + ' — ' + esc(item.location_name || "") + '</div>';
    html += '<div class="st-mini"><b>Date listed:</b> ' + esc(fmtDmy(item.entry_date)) + '</div>';
    if (item.batch) html += '<div class="st-mini"><b>Batch:</b> ' + esc(item.batch) + '</div>';
    if (item.expiry_date) html += '<div class="st-mini"><b>Expiry:</b> ' + esc(fmtDmy(item.expiry_date)) + (expired ? ' <span style="color:var(--danger);font-weight:800;">EXPIRED</span>' : '') + '</div>';
    html += '</div>';
    html += '<div>';
    html += '<div class="st-mini"><b>Original qty:</b> ' + esc(item.quantity_available) + '</div>';
    html += '<div class="st-mini"><b>Remaining:</b> ' + esc(remaining) + '</div>';
    html += '<div class="st-mini"><b>Total requested:</b> ' + esc(item.total_requested || 0) + '</div>';
    if (item.is_closed) html += '<div class="st-mini"><b>Status:</b> Closed' + (item.close_reason ? ' — ' + esc(item.close_reason) : '') + '</div>';
    if (expired) html += '<div class="st-mini" style="color:var(--danger);font-weight:800;">This item is expired and cannot be transferred.</div>';
    if (item.source_module) html += '<div class="st-mini"><b>Source:</b> ' + esc(item.source_module) + '</div>';
    if (item.placed_on_returns) html += '<div class="st-mini" style="color:var(--muted);">Placed on Returns</div>';
    if (item.placed_on_scarce_stock) html += '<div class="st-mini" style="color:var(--muted);">Placed on Scarce Stock</div>';
    html += '</div>';
    html += '</div>';

    // Action buttons (for item owner)
    if (item.mine_owner && !item.is_closed && !expired) {
      html += '<div class="st-actions" style="margin-top:10px;">';
      if (!item.placed_on_returns) {
        html += '<button class="eikon-btn" data-action="st-place-returns" data-id="' + esc(item.id) + '">Place on Returns</button>';
      }
      if (!item.placed_on_scarce_stock) {
        html += '<button class="eikon-btn" data-action="st-place-scarce" data-id="' + esc(item.id) + '">Place on Scarce Stock</button>';
      }
      html += '<button class="eikon-btn danger" data-action="st-delete-item" data-id="' + esc(item.id) + '">Remove from Transfer</button>';
      html += '</div>';
    }
    // Expired item: can still place on returns (but not scarce stock)
    if (item.mine_owner && expired) {
      html += '<div class="st-actions" style="margin-top:10px;">';
      if (!item.placed_on_returns) {
        html += '<button class="eikon-btn" data-action="st-place-returns" data-id="' + esc(item.id) + '">Place on Returns</button>';
      }
      html += '<button class="eikon-btn danger" data-action="st-delete-item" data-id="' + esc(item.id) + '">Remove from Transfer</button>';
      html += '</div>';
    }

    // Request transfer button (for non-owners, if item is open and not expired)
    if (!item.mine_owner && !item.is_closed && !expired && remaining > 0) {
      html += '<div class="st-actions" style="margin-top:10px;">';
      html += '<button class="eikon-btn primary" data-action="st-request" data-id="' + esc(item.id) + '">Request Transfer</button>';
      html += '</div>';
    }

    // Requests table
    if (requests.length) {
      html += '<div style="font-weight:900;margin:14px 0 6px 0;">Requests (' + requests.length + ')</div>';
      html += '<table class="st-req-table">';
      html += '<thead><tr><th>Pharmacy</th><th>Qty</th><th>Status</th><th>Note</th><th>Actions</th></tr></thead>';
      html += '<tbody>';

      for (var r = 0; r < requests.length; r++) {
        var req = requests[r];
        var rs = norm(req.status);

        html += '<tr>';
        html += '<td>' + esc(req.requester_display || "—") + '</td>';
        html += '<td style="font-weight:800;">' + esc(req.quantity_requested) + '</td>';
        html += '<td>' + statusBadge(req.status) + '</td>';
        html += '<td class="st-mini">' + esc(req.note || "—") + '</td>';
        html += '<td>';

        // Actions based on role and status
        if (item.mine_owner) {
          // I'm the item owner
          if (rs === "pending") {
            html += '<button class="eikon-btn primary" style="font-size:11px;padding:4px 8px;" data-action="st-accept-req" data-id="' + esc(req.id) + '">Accept</button> ';
            html += '<button class="eikon-btn danger" style="font-size:11px;padding:4px 8px;" data-action="st-reject-req" data-id="' + esc(req.id) + '">Reject</button>';
          } else if (rs === "accepted") {
            html += '<button class="eikon-btn primary" style="font-size:11px;padding:4px 8px;" data-action="st-dispatch" data-id="' + esc(req.id) + '">Confirm Dispatch</button>';
          } else if (rs === "dispatched") {
            html += '<span class="st-mini">Waiting for delivery confirmation</span>';
          } else if (rs === "delivered") {
            html += '<span class="st-mini" style="color:var(--ok);">Complete</span>';
          }
        } else if (req.mine) {
          // I'm the requester
          if (rs === "pending") {
            html += '<button class="eikon-btn danger" style="font-size:11px;padding:4px 8px;" data-action="st-cancel-req" data-id="' + esc(req.id) + '">Cancel</button>';
          } else if (rs === "dispatched") {
            html += '<button class="eikon-btn primary" style="font-size:11px;padding:4px 8px;" data-action="st-confirm-delivery" data-id="' + esc(req.id) + '">Confirm Received</button>';
          } else if (rs === "delivered") {
            html += '<span class="st-mini" style="color:var(--ok);">Complete</span>';
          }
        }

        html += '</td>';
        html += '</tr>';
      }

      html += '</tbody></table>';
    } else if (!item.mine_owner) {
      html += '<div class="st-mini" style="margin-top:10px;opacity:.6;">No requests yet.</div>';
    }

    html += '</div>';
    return html;
  }

  // ────────────────────────────────────────────
  // New item modal
  // ────────────────────────────────────────────
  function showNewItemModal() {
    var body =
      '<div style="display:flex;flex-direction:column;gap:12px;">' +
        '<div class="eikon-field">' +
          '<div class="eikon-label">Item Description *</div>' +
          '<input id="st-new-desc" class="eikon-input" placeholder="e.g. Paracetamol 500mg Tablets">' +
        '</div>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
          '<div class="eikon-field" style="flex:1;min-width:140px;">' +
            '<div class="eikon-label">Batch (optional)</div>' +
            '<input id="st-new-batch" class="eikon-input" placeholder="Batch no.">' +
          '</div>' +
          '<div class="eikon-field" style="flex:1;min-width:160px;">' +
            '<div class="eikon-label">Expiry Date (optional)</div>' +
            '<input id="st-new-expiry" class="eikon-input" type="date">' +
          '</div>' +
          '<div class="eikon-field" style="min-width:120px;">' +
            '<div class="eikon-label">Quantity *</div>' +
            '<input id="st-new-qty" class="eikon-input" type="number" min="1" value="1">' +
          '</div>' +
        '</div>' +
      '</div>';

    E.modal.show("Place Item for Transfer", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Place for Transfer",
        primary: true,
        onClick: function () {
          var desc = String((document.getElementById("st-new-desc") || {}).value || "").trim();
          var batch = String((document.getElementById("st-new-batch") || {}).value || "").trim();
          var expiry = String((document.getElementById("st-new-expiry") || {}).value || "").trim();
          var qty = parseInt((document.getElementById("st-new-qty") || {}).value, 10);

          if (!desc) { toast("warn", "Required", "Item description is required."); return; }
          if (expiry && isExpired(expiry)) { toast("warn", "Expired", "Expired items cannot be placed for transfer."); return; }
          if (!qty || qty < 1) { toast("warn", "Quantity", "Enter a valid quantity."); return; }

          E.modal.hide();
          doCreate({
            entry_date: todayYmd(),
            item_description: desc,
            batch: batch,
            expiry_date: expiry,
            quantity_available: qty
          });
        }
      }
    ]);
  }

  // ────────────────────────────────────────────
  // Print
  // ────────────────────────────────────────────
  function openPrintWindow() {
    applyFilter();
    var list = state.filtered || [];

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show("Print", "<div>Popup blocked. Allow popups and try again.</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]);
      return;
    }

    function safe(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    var rowsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var remaining = (item.remaining_quantity != null) ? item.remaining_quantity : item.quantity_available;
      var expired = item._expired || (item.expiry_date && isExpired(item.expiry_date));

      rowsHtml += "<tr" + (expired ? " style='opacity:.5;text-decoration:line-through;'" : "") + ">" +
        "<td>" + safe(fmtDmy(item.entry_date)) + "</td>" +
        "<td><b>" + safe(item.item_description || "") + "</b><div style='font-size:10px;opacity:.7;'>" + safe(item.org_name || "") + " — " + safe(item.location_name || "") + "</div></td>" +
        "<td>" + safe(item.batch || "") + "</td>" +
        "<td>" + safe(item.expiry_date ? fmtDmy(item.expiry_date) : "") + "</td>" +
        "<td>" + safe(remaining) + " / " + safe(item.quantity_available) + "</td>" +
        "<td>" + safe(expired ? "Expired" : (item.is_closed ? "Closed" : "Open")) + "</td>" +
        "</tr>";
    }

    var title = "Stock Transfers — " + (state.tab === "available" ? "Available" : "Incoming Requests");
    var html =
      "<!doctype html><html><head><meta charset='utf-8'/><title>" + safe(title) + "</title>" +
      "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}" +
      "h1{font-size:18px;margin:0 0 6px;}.sub{font-size:12px;opacity:.8;margin:0 0 14px;}" +
      "table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:8px;font-size:12px;text-align:left;}" +
      "th{background:#f5f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.3px;}" +
      "@media print{body{margin:10mm;}}</style></head><body>" +
      "<h1>" + safe(title) + "</h1>" +
      "<div class='sub'>Printed: " + safe(new Date().toLocaleString()) + "</div>" +
      "<table><thead><tr><th>Date</th><th>Description</th><th>Batch</th><th>Expiry</th><th>Qty (Rem/Total)</th><th>Status</th></tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody></table>" +
      "<script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // ────────────────────────────────────────────
  // Event delegation
  // ────────────────────────────────────────────
  function wireActions(mount) {
    mount.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      var id = btn.getAttribute("data-id");

      switch (action) {
        case "st-request":
          doRequestTransfer(id);
          break;
        case "st-accept-req":
          doAcceptRequest(id);
          break;
        case "st-reject-req":
          doRejectRequest(id);
          break;
        case "st-dispatch":
          doConfirmDispatch(id);
          break;
        case "st-confirm-delivery":
          doConfirmDelivery(id);
          break;
        case "st-cancel-req":
          doDeleteRequest(id);
          break;
        case "st-delete-item":
          doDeleteItem(id);
          break;
        case "st-place-returns":
          doPlaceOnReturns(id);
          break;
        case "st-place-scarce":
          doPlaceOnScarceStock(id);
          break;
      }
    });
  }

  // ────────────────────────────────────────────
  // Main render
  // ────────────────────────────────────────────
  function render(ctx) {
    var mount = ctx.mount;
    ensureStyles();

    mount.innerHTML =
      '<div class="eikon-card">' +
        '<div class="eikon-row" style="align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<span class="eikon-pill" style="font-weight:900;">🔄 Stock Transfers</span>' +

          '<div class="eikon-field" style="flex:1;min-width:260px;">' +
            '<div class="eikon-label">Search</div>' +
            '<input id="st-search" class="eikon-input" placeholder="Search items…" value="' + esc(state.q) + '">' +
          '</div>' +

          '<div class="eikon-field">' +
            '<div class="eikon-label">Filter</div>' +
            '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">' +
              '<input id="st-filter-open" type="checkbox"' + (state.filterOpen ? ' checked' : '') + '> Open only' +
            '</label>' +
          '</div>' +

          '<div class="eikon-field" style="margin-left:auto;min-width:260px;">' +
            '<div class="eikon-label">Actions</div>' +
            '<div class="eikon-row" style="gap:10px;flex-wrap:wrap;">' +
              '<button id="st-refresh" class="eikon-btn">Refresh</button>' +
              '<button id="st-print" class="eikon-btn">Print</button>' +
              '<button id="st-new" class="eikon-btn primary">Place for Transfer</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="st-busy" class="st-mini" style="margin-top:10px;min-height:16px;"></div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="st-tabs">' +
          '<div class="st-tab' + (state.tab === "available" ? " active" : "") + '" data-tab="available">Available for Transfer</div>' +
          '<div class="st-tab' + (state.tab === "incoming" ? " active" : "") + '" data-tab="incoming">Transfer Requests</div>' +
        '</div>' +

        '<div class="eikon-row" style="align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="font-weight:900;">' + (state.tab === "available" ? "Items Available" : "My Transfer Requests") + '</div>' +
          '<div class="eikon-pill" style="margin-left:auto;">Shown: <span id="st-count">0</span></div>' +
        '</div>' +
        '<div class="eikon-table-wrap">' +
          '<table class="eikon-table" style="min-width:800px;">' +
            '<thead><tr>' +
              '<th style="width:100px;">Date</th>' +
              '<th>Description</th>' +
              '<th style="width:100px;">Batch</th>' +
              '<th style="width:100px;">Expiry</th>' +
              '<th style="width:110px;text-align:center;">Qty</th>' +
              '<th style="width:100px;text-align:center;">Status</th>' +
              '<th style="width:100px;text-align:center;">Requests</th>' +
            '</tr></thead>' +
            '<tbody id="st-tbody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    // Wire controls
    var searchEl = document.getElementById("st-search");
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        state.q = String(searchEl.value || "");
        renderContent();
      });
    }

    var filterEl = document.getElementById("st-filter-open");
    if (filterEl) {
      filterEl.addEventListener("change", function () {
        state.filterOpen = !!filterEl.checked;
        renderContent();
      });
    }

    document.getElementById("st-refresh").addEventListener("click", function () { doRefresh(); });
    document.getElementById("st-print").addEventListener("click", function () { openPrintWindow(); });
    document.getElementById("st-new").addEventListener("click", function () { showNewItemModal(); });

    // Tab switching
    var tabs = mount.querySelectorAll(".st-tab");
    for (var t = 0; t < tabs.length; t++) {
      tabs[t].addEventListener("click", function () {
        state.tab = this.getAttribute("data-tab") || "available";
        state.selectedId = null;
        // Re-render tabs and content
        var allTabs = mount.querySelectorAll(".st-tab");
        for (var i = 0; i < allTabs.length; i++) {
          allTabs[i].classList.toggle("active", allTabs[i].getAttribute("data-tab") === state.tab);
        }
        var heading = mount.querySelector(".eikon-card:last-child .eikon-row > div:first-child");
        if (heading) heading.textContent = state.tab === "available" ? "Items Available" : "My Transfer Requests";
        renderContent();
      });
    }

    // Event delegation for dynamic buttons
    wireActions(mount);

    // Initial load
    renderContent();
    doRefresh();

    // Auto-refresh
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {
      if (!state.busy) doRefresh();
    }, REFRESH_INTERVAL);
  }

  function destroy() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  // ────────────────────────────────────────────
  // Register
  // ────────────────────────────────────────────
  E.registerModule({
    id: "stocktransfers",
    title: "Stock Transfers",
    order: 245,
    icon: "🔄",
    render: render,
    destroy: destroy
  });

})();
