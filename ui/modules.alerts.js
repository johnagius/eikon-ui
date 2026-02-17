(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // ----------------------------
  // Small helpers (match style used in other modules)
  // ----------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") n.className = String(v || "");
      else if (k === "text") n.textContent = String(v == null ? "" : v);
      else if (k === "html") n.innerHTML = String(v == null ? "" : v);
      else if (k === "style") n.setAttribute("style", String(v || ""));
      else if (k === "value") n.value = String(v == null ? "" : v);
      else if (k === "type") n.type = String(v || "");
      else if (k === "placeholder") n.placeholder = String(v || "");
      else if (k === "disabled") n.disabled = !!v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, String(v));
    });
    if (Array.isArray(kids)) {
      kids.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") n.appendChild(document.createTextNode(c));
        else n.appendChild(c);
      });
    }
    return n;
  }

  var toastInstalled = false;
  function ensureToastStyles() {
    if (toastInstalled) return;
    toastInstalled = true;
    var st = document.createElement("style");
    st.type = "text/css";
    st.textContent =
      ".eikon-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".eikon-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);}" +
      ".eikon-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
      ".eikon-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".eikon-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".eikon-toast.bad{border-color:rgba(255,90,122,.35);}" +
      ".eikon-toast.warn{border-color:rgba(255,200,90,.35);}" +
      ".al-two-col{display:grid;grid-template-columns:1fr 320px;gap:14px;align-items:start;}" +
      ".al-panel{border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:14px;padding:12px;}" +
      ".al-check{display:flex;gap:10px;align-items:center;margin:8px 0;}" +
      ".al-check input{transform:scale(1.05);}" +
      ".al-mini{font-size:12px;opacity:.85;}" +
      "@media (max-width: 860px){.al-two-col{grid-template-columns:1fr;}.al-panel{order:2;}}";
    document.head.appendChild(st);
  }

  function toast(title, message, kind, ms) {
    ensureToastStyles();
    var wrap = document.getElementById("eikon-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "eikon-toast-wrap";
      wrap.className = "eikon-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = el("div", { class: "eikon-toast " + (kind || "") });
    t.appendChild(el("div", { class: "t-title", text: title || "Info" }));
    t.appendChild(el("div", { class: "t-msg", text: message || "" }));
    wrap.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, (typeof ms === "number" ? ms : 2600));
  }

  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function (resolve) {
      E.modal.show(
        title || "Confirm",
        '<div class="eikon-help" style="white-space:pre-wrap;">' + esc(bodyText || "") + "</div>",
        [
          { label: cancelLabel || "Cancel", onClick: function () { E.modal.hide(); resolve(false); } },
          { label: okLabel || "OK", primary: true, onClick: function () { E.modal.hide(); resolve(true); } }
        ]
      );
    });
  }

  function ymNow() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }
  function todayYmd() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function bool01(v) { return v ? 1 : 0; }
  function asBool(v) { return !!(v === 1 || v === "1" || v === true); }

  // ----------------------------
  // API
  // ----------------------------
  async function apiList(month) {
    var m = String(month || "").trim();
    var q = "/alerts/entries" + (m ? ("?month=" + encodeURIComponent(m)) : "");
    return await E.apiFetch(q, { method: "GET" });
  }
  async function apiCreate(payload) {
    return await E.apiFetch("/alerts/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  async function apiUpdate(id, payload) {
    return await E.apiFetch("/alerts/entries/" + encodeURIComponent(String(id)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  async function apiDelete(id) {
    return await E.apiFetch("/alerts/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
  }

  // ----------------------------
  // Modal (Add/Edit)
  // ----------------------------
  function openEditModal(entry, onSaved) {
    ensureToastStyles();

    var isEdit = !!(entry && entry.id);
    var id = isEdit ? entry.id : null;

    // defaults
    var data = entry || {};
    var entry_date = data.entry_date || todayYmd();
    var alert_type = (data.alert_type || "recall");
    var status = (data.status || "open");
    var item_name = data.item_name || "";
    var batch = data.batch || "";
    var expiry = data.expiry || "";
    var quantity = data.quantity || "";
    var reason = data.reason || "";
    var storage_location = (data.storage_location || "room");
    var supplier = data.supplier || "";
    var notes = data.notes || "";

    var team_informed = asBool(data.team_informed);
    var supplier_informed = asBool(data.supplier_informed);
    var authorities_informed = asBool(data.authorities_informed);
    var return_arranged = asBool(data.return_arranged);
    var handed_over = asBool(data.handed_over);
    var collection_note_received = asBool(data.collection_note_received);
    var credit_note_received = asBool(data.credit_note_received);

    var html =
      '<div class="al-two-col">' +
        '<div>' +
          '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;">' +

            '<div class="eikon-field" style="min-width:180px;flex:1;">' +
              '<div class="eikon-label">Date</div>' +
              '<input id="al-date" class="eikon-input" type="date" value="' + esc(entry_date) + '">' +
            "</div>" +

            '<div class="eikon-field" style="min-width:180px;flex:1;">' +
              '<div class="eikon-label">Type</div>' +
              '<select id="al-type" class="eikon-input">' +
                '<option value="recall"' + (alert_type === "recall" ? " selected" : "") + ">Recall</option>" +
                '<option value="quarantine"' + (alert_type === "quarantine" ? " selected" : "") + ">Quarantine</option>" +
              "</select>" +
            "</div>" +

            '<div class="eikon-field" style="min-width:200px;flex:1;">' +
              '<div class="eikon-label">Status</div>' +
              '<select id="al-status" class="eikon-input">' +
                '<option value="open"' + (status === "open" ? " selected" : "") + ">Open</option>" +
                '<option value="in_progress"' + (status === "in_progress" ? " selected" : "") + ">In progress</option>" +
                '<option value="closed"' + (status === "closed" ? " selected" : "") + ">Closed</option>" +
              "</select>" +
            "</div>" +

          "</div>" +

          '<div style="height:10px;"></div>' +

          '<div class="eikon-field">' +
            '<div class="eikon-label">Item name</div>' +
            '<input id="al-item" class="eikon-input" type="text" placeholder="Item name" value="' + esc(item_name) + '">' +
          "</div>" +

          '<div style="height:10px;"></div>' +

          '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;">' +

            '<div class="eikon-field" style="min-width:180px;flex:1;">' +
              '<div class="eikon-label">Batch (optional)</div>' +
              '<input id="al-batch" class="eikon-input" type="text" placeholder="Batch" value="' + esc(batch) + '">' +
            "</div>" +

            '<div class="eikon-field" style="min-width:180px;flex:1;">' +
              '<div class="eikon-label">Expiry (optional)</div>' +
              '<input id="al-expiry" class="eikon-input" type="date" value="' + esc(expiry) + '">' +
            "</div>" +

            '<div class="eikon-field" style="min-width:180px;flex:1;">' +
              '<div class="eikon-label">Quantity (optional)</div>' +
              '<input id="al-qty" class="eikon-input" type="text" placeholder="e.g. 2 boxes / 20 tabs" value="' + esc(quantity) + '">' +
            "</div>" +

          "</div>" +

          '<div style="height:10px;"></div>' +

          '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;">' +
            '<div class="eikon-field" style="min-width:220px;flex:1;">' +
              '<div class="eikon-label">Room / Fridge</div>' +
              '<select id="al-store" class="eikon-input">' +
                '<option value="room"' + (storage_location === "room" ? " selected" : "") + ">Room</option>" +
                '<option value="fridge"' + (storage_location === "fridge" ? " selected" : "") + ">Fridge</option>" +
              "</select>" +
            "</div>" +
            '<div class="eikon-field" style="min-width:220px;flex:2;">' +
              '<div class="eikon-label">Supplier (optional)</div>' +
              '<input id="al-supplier" class="eikon-input" type="text" placeholder="Supplier" value="' + esc(supplier) + '">' +
            "</div>" +
          "</div>" +

          '<div style="height:10px;"></div>' +

          '<div class="eikon-field">' +
            '<div class="eikon-label">Reason (optional)</div>' +
            '<textarea id="al-reason" class="eikon-input" rows="3" placeholder="Reason (optional)">' + esc(reason) + "</textarea>" +
          "</div>" +

          '<div style="height:10px;"></div>' +

          '<div class="eikon-field">' +
            '<div class="eikon-label">Notes (optional)</div>' +
            '<textarea id="al-notes" class="eikon-input" rows="3" placeholder="Any extra notes…">' + esc(notes) + "</textarea>" +
          "</div>" +
        "</div>" +

        '<div class="al-panel">' +
          '<div style="font-weight:900;margin-bottom:6px;">Actions</div>' +
          '<div class="al-mini">These are the checkboxes you requested (kept off the table so no horizontal scrolling).</div>' +
          '<div style="height:10px;"></div>' +

          '<label class="al-check"><input id="al-team" type="checkbox"' + (team_informed ? " checked" : "") + '> Team informed</label>' +
          '<label class="al-check"><input id="al-suppinf" type="checkbox"' + (supplier_informed ? " checked" : "") + '> Supplier informed</label>' +
          '<label class="al-check"><input id="al-auth" type="checkbox"' + (authorities_informed ? " checked" : "") + '> Authorities informed</label>' +
          '<div style="height:6px;"></div>' +
          '<label class="al-check"><input id="al-return" type="checkbox"' + (return_arranged ? " checked" : "") + '> Return arranged</label>' +
          '<label class="al-check"><input id="al-handover" type="checkbox"' + (handed_over ? " checked" : "") + '> Handed over</label>' +
          '<label class="al-check"><input id="al-cnote" type="checkbox"' + (collection_note_received ? " checked" : "") + '> Collection note received</label>' +
          '<label class="al-check"><input id="al-credit" type="checkbox"' + (credit_note_received ? " checked" : "") + '> Credit note received</label>' +
        "</div>" +
      "</div>";

    E.modal.show(isEdit ? "Edit Alert" : "Add Alert", html, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: async function () {
          try {
            var payload = {
              entry_date: String(E.q("#al-date").value || "").trim(),
              alert_type: String(E.q("#al-type").value || "").trim(),
              status: String(E.q("#al-status").value || "").trim(),
              item_name: String(E.q("#al-item").value || "").trim(),
              batch: String(E.q("#al-batch").value || "").trim(),
              expiry: String(E.q("#al-expiry").value || "").trim(),
              quantity: String(E.q("#al-qty").value || "").trim(),
              reason: String(E.q("#al-reason").value || "").trim(),
              storage_location: String(E.q("#al-store").value || "").trim(),
              supplier: String(E.q("#al-supplier").value || "").trim(),
              notes: String(E.q("#al-notes").value || "").trim(),

              team_informed: bool01(E.q("#al-team").checked),
              supplier_informed: bool01(E.q("#al-suppinf").checked),
              authorities_informed: bool01(E.q("#al-auth").checked),
              return_arranged: bool01(E.q("#al-return").checked),
              handed_over: bool01(E.q("#al-handover").checked),
              collection_note_received: bool01(E.q("#al-cnote").checked),
              credit_note_received: bool01(E.q("#al-credit").checked)
            };

            if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.entry_date)) {
              toast("Invalid", "Date is required.", "warn");
              return;
            }
            if (!payload.item_name) {
              toast("Invalid", "Item name is required.", "warn");
              return;
            }
            if (payload.alert_type !== "recall" && payload.alert_type !== "quarantine") {
              toast("Invalid", "Type must be Recall or Quarantine.", "warn");
              return;
            }
            if (payload.status !== "open" && payload.status !== "in_progress" && payload.status !== "closed") {
              toast("Invalid", "Status is invalid.", "warn");
              return;
            }
            if (payload.storage_location !== "room" && payload.storage_location !== "fridge") {
              toast("Invalid", "Room/Fridge is required.", "warn");
              return;
            }

            if (isEdit) await apiUpdate(id, payload);
            else await apiCreate(payload);

            E.modal.hide();
            toast("Saved", "Alert saved to cloud.", "good");
            if (typeof onSaved === "function") onSaved();
          } catch (e) {
            toast("Save failed", (e && (e.message || e.bodyText)) ? (e.message || e.bodyText) : "Error", "bad", 4200);
          }
        }
      }
    ]);
  }

  // ----------------------------
  // Render list
  // ----------------------------
  var state = { month: ymNow(), entries: [] };

  function renderTable(tbody, entries) {
    tbody.innerHTML = "";
    if (!entries || !entries.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 10;
      td0.className = "eikon-help";
      td0.textContent = "No alerts for this month.";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      return;
    }

    entries.forEach(function (r) {
      var tr = document.createElement("tr");

      function tdTxt(t) {
        var td = document.createElement("td");
        td.textContent = (t == null ? "" : String(t));
        return td;
      }

      var typeLabel = (r.alert_type === "quarantine" ? "Quarantine" : "Recall");
      var statusLabel =
        (r.status === "in_progress" ? "In progress" : (r.status === "closed" ? "Closed" : "Open"));

      tr.appendChild(tdTxt(r.entry_date || ""));
      tr.appendChild(tdTxt(typeLabel));
      tr.appendChild(tdTxt(statusLabel));
      tr.appendChild(tdTxt(r.item_name || ""));
      tr.appendChild(tdTxt(r.batch || ""));
      tr.appendChild(tdTxt(r.expiry || ""));
      tr.appendChild(tdTxt(r.quantity || ""));
      tr.appendChild(tdTxt((r.storage_location === "fridge") ? "Fridge" : "Room"));
      tr.appendChild(tdTxt(r.supplier || ""));

      var tdA = document.createElement("td");
      tdA.style.whiteSpace = "nowrap";

      var btnEdit = el("button", { class: "eikon-btn", text: "Edit" });
      btnEdit.addEventListener("click", function () {
        openEditModal(r, function () {
          // reload
          refresh().catch(function () {});
        });
      });

      var btnDel = el("button", { class: "eikon-btn danger", text: "Delete" });
      btnDel.addEventListener("click", async function () {
        var ok = await modalConfirm(
          "Delete alert",
          "Delete this alert?\n\n" + (r.item_name || "") + " (" + (r.entry_date || "") + ")",
          "Delete",
          "Cancel"
        );
        if (!ok) return;
        try {
          await apiDelete(r.id);
          toast("Deleted", "Alert removed.", "good");
          await refresh();
        } catch (e) {
          toast("Delete failed", (e && (e.message || e.bodyText)) ? (e.message || e.bodyText) : "Error", "bad", 4200);
        }
      });

      tdA.appendChild(btnEdit);
      tdA.appendChild(document.createTextNode(" "));
      tdA.appendChild(btnDel);
      tr.appendChild(tdA);

      tbody.appendChild(tr);
    });
  }

  async function refresh() {
    var month = state.month;
    var r = await apiList(month);
    var list = (r && r.entries) ? r.entries : [];
    // sort newest first
    list.sort(function (a, b) {
      var da = String(a.entry_date || "");
      var db = String(b.entry_date || "");
      if (da !== db) return (da < db ? 1 : -1);
      return Number(b.id || 0) - Number(a.id || 0);
    });
    state.entries = list;
    return list;
  }

  async function render(ctx) {
    var mount = ctx.mount;
    ensureToastStyles();

    var month = state.month || ymNow();
    state.month = month;

    mount.innerHTML =
      '<div class="eikon-card">' +
        '<div class="eikon-row" style="align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<span class="eikon-pill" style="font-weight:900;">⚠️ Alerts</span>' +

          '<div class="eikon-field" style="min-width:180px;">' +
            '<div class="eikon-label">Month</div>' +
            '<input id="al-month" class="eikon-input" type="month" value="' + esc(month) + '">' +
          "</div>" +

          '<div class="eikon-field" style="margin-left:auto;">' +
            '<div class="eikon-label">Actions</div>' +
            '<div class="eikon-row" style="gap:10px;">' +
              '<button id="al-refresh" class="eikon-btn">Refresh</button>' +
              '<button id="al-add" class="eikon-btn primary">Add Alert</button>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="eikon-help" style="margin-top:10px;">Checklists are inside Add/Edit (side panel) to avoid wide tables.</div>' +
      "</div>" +

      '<div style="height:12px;"></div>' +

      '<div class="eikon-card">' +
        '<div class="eikon-table-wrap">' +
          '<table class="eikon-table">' +
            "<thead><tr>" +
              "<th>Date</th>" +
              "<th>Type</th>" +
              "<th>Status</th>" +
              "<th>Item</th>" +
              "<th>Batch</th>" +
              "<th>Expiry</th>" +
              "<th>Qty</th>" +
              "<th>Room/Fridge</th>" +
              "<th>Supplier</th>" +
              "<th></th>" +
            "</tr></thead>" +
            '<tbody id="al-tbody"></tbody>' +
          "</table>" +
        "</div>" +
      "</div>";

    var monthInput = E.q("#al-month", mount);
    var refreshBtn = E.q("#al-refresh", mount);
    var addBtn = E.q("#al-add", mount);
    var tbody = E.q("#al-tbody", mount);

    async function doRefresh() {
      state.month = String(monthInput.value || ymNow()).trim();
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Loading...";
      try {
        var list = await refresh();
        renderTable(tbody, list);
      } catch (e) {
        toast("Load failed", (e && (e.message || e.bodyText)) ? (e.message || e.bodyText) : "Error", "bad", 4200);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh";
      }
    }

    monthInput.addEventListener("change", function () { doRefresh().catch(function () {}); });
    refreshBtn.addEventListener("click", function () { doRefresh().catch(function () {}); });
    addBtn.addEventListener("click", function () {
      openEditModal(null, function () { doRefresh().catch(function () {}); });
    });

    await doRefresh();
  }

  E.registerModule({
    id: "alerts",
    title: "Alerts",
    order: 15,
    icon: "⚠️",
    render: render
  });

})();
