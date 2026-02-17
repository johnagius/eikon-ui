(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // ----------------------------
  // Small helpers
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

  function pad2(n) { var v = String(n); return v.length === 1 ? "0" + v : v; }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function fmtDmyFromYmd(s) {
    var v = String(s || "").trim();
    if (!isYmd(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }

  function bool01(v) { return v ? 1 : 0; }
  function asBool(v) { return !!(v === 1 || v === "1" || v === true); }

  function yearRangeNow() {
    var y = new Date().getFullYear();
    return { fromY: y - 1, toY: y + 1, label: String(y - 1) + " – " + String(y + 1) };
  }
  function inYearRange(entry_date, range) {
    var s = String(entry_date || "").trim();
    if (!isYmd(s)) return false;
    var y = parseInt(s.slice(0, 4), 10);
    return y >= range.fromY && y <= range.toY;
  }

  // ----------------------------
  // Toast styles + toast
  // ----------------------------
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
      ".al-row-selected{background:rgba(58,160,255,.10)!important;}" +
      ".al-row-selected td{border-bottom-color:rgba(58,160,255,.22)!important;}" +
      ".al-checkbar{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;margin-top:10px;}" +
      ".al-sel-title{font-weight:900;margin:0 0 6px 0;}" +
      ".al-sel-meta{font-size:12px;opacity:.85;white-space:pre-wrap;}" +
      ".al-saving{font-size:12px;opacity:.75;margin-top:8px;min-height:16px;}" +
      ".al-sel-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}" +
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

  // ----------------------------
  // Print (same method as Daily Register)
  // ----------------------------
  function openPrintWindow(entries, rangeLabel) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var rLabel = String(rangeLabel || "").trim();

    var w = window.open("", "_blank");
    if (!w) {
      try {
        E.modal.show(
          "Print",
          "<div style='white-space:pre-wrap'>Popup blocked. Allow popups and try again.</div>",
          [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
        );
      } catch (e) {}
      return;
    }

    function safe(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
    function yesNo(v) { return (v === 1 || v === "1" || v === true) ? "Yes" : "No"; }
    function checklistLine(r) {
      return (
        "Team: " + yesNo(r.team_informed) + " | " +
        "Supplier: " + yesNo(r.supplier_informed) + " | " +
        "Authorities: " + yesNo(r.authorities_informed) + "\n" +
        "Return: " + yesNo(r.return_arranged) + " | " +
        "Handover: " + yesNo(r.handed_over) + " | " +
        "Collection: " + yesNo(r.collection_note_received) + " | " +
        "Credit: " + yesNo(r.credit_note_received)
      );
    }

    var rowsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var typeLabel = (r.alert_type === "quarantine" ? "Quarantine" : "Recall");
      var statusLabel = (r.status === "in_progress" ? "In progress" : (r.status === "closed" ? "Closed" : "Open"));

      var detailBits = [];
      if (r.batch) detailBits.push("Batch: " + r.batch);
      if (r.expiry) detailBits.push("Expiry: " + fmtDmyFromYmd(r.expiry));
      if (r.quantity) detailBits.push("Qty: " + r.quantity);

      rowsHtml +=
        "<tr>" +
        "<td>" + safe(fmtDmyFromYmd(r.entry_date || "")) + "</td>" +
        "<td>" + safe(typeLabel) + "</td>" +
        "<td>" + safe(statusLabel) + "</td>" +
        "<td><b>" + safe(r.item_name || "") + "</b>" +
          (detailBits.length ? ("<div style='opacity:.75;font-size:11px'>" + safe(detailBits.join(" | ")) + "</div>") : "") +
          (r.reason ? ("<div style='opacity:.75;font-size:11px'>Reason: " + safe(r.reason) + "</div>") : "") +
          (r.notes ? ("<div style='opacity:.75;font-size:11px'>Notes: " + safe(r.notes) + "</div>") : "") +
        "</td>" +
        "<td>" + safe((r.storage_location === "fridge") ? "Fridge" : "Room") + "</td>" +
        "<td>" + safe(r.supplier || "") + "</td>" +
        "<td style='white-space:pre-wrap'>" + safe(checklistLine(r)) + "</td>" +
        "</tr>";
    }

    var html =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>Alerts</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 10px;font-weight:800;}" +
      "table{width:100%;border-collapse:collapse;margin-top:10px;}" +
      "th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top;}" +
      "th{background:#f5f5f5;text-align:left;}" +
      ".meta{font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>Print</button>" +
      "<h1 style='margin:0 0 4px 0;font-size:18px;'>Alerts</h1>" +
      "<div class='meta'>Rows: " + safe(String(list.length)) + "\nYears: " + safe(rLabel || "-") + "\nPrinted: " + safe(new Date().toLocaleString()) + "</div>" +
      "<table><thead><tr>" +
      "<th>Date</th><th>Type</th><th>Status</th><th>Item</th><th>Room/Fridge</th><th>Supplier</th><th>Checklist</th>" +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);</script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function payloadFromEntry(r) {
    var x = r || {};
    return {
      entry_date: String(x.entry_date || "").trim(),
      alert_type: String(x.alert_type || "").trim(),
      status: String(x.status || "").trim(),
      item_name: String(x.item_name || "").trim(),
      batch: String(x.batch || "").trim(),
      expiry: String(x.expiry || "").trim(),
      quantity: String(x.quantity || "").trim(),
      reason: String(x.reason || "").trim(),
      storage_location: String(x.storage_location || "").trim(),
      supplier: String(x.supplier || "").trim(),
      notes: String(x.notes || "").trim(),
      team_informed: bool01(asBool(x.team_informed)),
      supplier_informed: bool01(asBool(x.supplier_informed)),
      authorities_informed: bool01(asBool(x.authorities_informed)),
      return_arranged: bool01(asBool(x.return_arranged)),
      handed_over: bool01(asBool(x.handed_over)),
      collection_note_received: bool01(asBool(x.collection_note_received)),
      credit_note_received: bool01(asBool(x.credit_note_received))
    };
  }

  // ----------------------------
  // API
  // ----------------------------
  async function apiList() {
    // No month param: backend returns all rows, then we filter locally to 3 years
    return await E.apiFetch("/alerts/entries", { method: "GET" });
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
          '<div class="al-mini">These are the checkboxes you requested.</div>' +
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

            if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.entry_date)) { toast("Invalid", "Date is required.", "warn"); return; }
            if (!payload.item_name) { toast("Invalid", "Item name is required.", "warn"); return; }
            if (payload.alert_type !== "recall" && payload.alert_type !== "quarantine") { toast("Invalid", "Type must be Recall or Quarantine.", "warn"); return; }
            if (payload.status !== "open" && payload.status !== "in_progress" && payload.status !== "closed") { toast("Invalid", "Status is invalid.", "warn"); return; }
            if (payload.storage_location !== "room" && payload.storage_location !== "fridge") { toast("Invalid", "Room/Fridge is required.", "warn"); return; }

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
  var state = {
    entries: [],
    selectedId: null,
    selectedEntry: null,
    _checkSaveTimer: null,
    _checkSaving: false,
    range: yearRangeNow()
  };

  function renderTable(tbody, entries, selectedId, onSelect) {
    tbody.innerHTML = "";
    if (!entries || !entries.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 10;
      td0.className = "eikon-help";
      td0.textContent = "No alerts found in this 3-year range.";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      return;
    }

    entries.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.dataset.id = String(r.id || "");
      if (selectedId && String(r.id) === String(selectedId)) tr.classList.add("al-row-selected");
      tr.addEventListener("click", function () {
        if (typeof onSelect === "function") onSelect(r);
      });

      function tdTxt(t) {
        var td = document.createElement("td");
        td.textContent = (t == null ? "" : String(t));
        return td;
      }

      var typeLabel = (r.alert_type === "quarantine" ? "Quarantine" : "Recall");
      var statusLabel = (r.status === "in_progress" ? "In progress" : (r.status === "closed" ? "Closed" : "Open"));

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
      btnEdit.addEventListener("click", function (e) {
        e.stopPropagation();
        openEditModal(r, function () { doRefresh().catch(function () {}); });
      });

      var btnDel = el("button", { class: "eikon-btn danger", text: "Delete" });
      btnDel.addEventListener("click", async function (e) {
        e.stopPropagation();
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
          await doRefresh();
        } catch (e2) {
          toast("Delete failed", (e2 && (e2.message || e2.bodyText)) ? (e2.message || e2.bodyText) : "Error", "bad", 4200);
        }
      });

      tdA.appendChild(btnEdit);
      tdA.appendChild(document.createTextNode(" "));
      tdA.appendChild(btnDel);
      tr.appendChild(tdA);

      tbody.appendChild(tr);
    });
  }

  async function loadAndFilter() {
    // Always show prev/current/next year based on today's year
    state.range = yearRangeNow();

    var resp = await apiList();
    var list = (resp && resp.entries) ? resp.entries : [];

    // filter to 3-year range
    var filtered = [];
    for (var i = 0; i < list.length; i++) {
      if (inYearRange(list[i].entry_date, state.range)) filtered.push(list[i]);
    }

    // sort newest first
    filtered.sort(function (a, b) {
      var da = String(a.entry_date || "");
      var db = String(b.entry_date || "");
      if (da !== db) return (da < db ? 1 : -1);
      return Number(b.id || 0) - Number(a.id || 0);
    });

    state.entries = filtered;
    return filtered;
  }

  async function render(ctx) {
    var mount = ctx.mount;
    ensureToastStyles();

    var range = yearRangeNow();
    state.range = range;

    mount.innerHTML =
      '<div class="eikon-card">' +
        '<div class="eikon-row" style="align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<span class="eikon-pill" style="font-weight:900;">⚠️ Alerts</span>' +

          '<div class="eikon-field" style="min-width:220px;">' +
            '<div class="eikon-label">Years shown</div>' +
            '<input id="al-years" class="eikon-input" type="text" disabled value="' + esc(range.label) + '">' +
          "</div>" +

          '<div class="eikon-field" style="margin-left:auto;">' +
            '<div class="eikon-label">Actions</div>' +
            '<div class="eikon-row" style="gap:10px;">' +
              '<button id="al-refresh" class="eikon-btn">Refresh</button>' +
              '<button id="al-print" class="eikon-btn">Print</button>' +
              '<button id="al-add" class="eikon-btn primary">Add Alert</button>' +
            "</div>" +
          "</div>" +
        "</div>" +

        '<div class="al-checkbar">' +
          '<div class="al-panel" style="width:100%;">' +
            '<div class="al-sel-title">Checklist</div>' +
            '<div id="al-sp-meta" class="al-sel-meta">Select an alert row to view/update checklist.</div>' +
            '<div style="height:8px;"></div>' +
            '<div class="eikon-row" style="gap:14px;flex-wrap:wrap;align-items:flex-start;">' +
              '<div style="min-width:240px;flex:1;">' +
                '<label class="al-check"><input id="al-sp-team" type="checkbox" disabled> Team informed</label>' +
                '<label class="al-check"><input id="al-sp-supp" type="checkbox" disabled> Supplier informed</label>' +
                '<label class="al-check"><input id="al-sp-auth" type="checkbox" disabled> Authorities informed</label>' +
                '<label class="al-check"><input id="al-sp-return" type="checkbox" disabled> Return arranged</label>' +
              '</div>' +
              '<div style="min-width:240px;flex:1;">' +
                '<label class="al-check"><input id="al-sp-handover" type="checkbox" disabled> Handed over</label>' +
                '<label class="al-check"><input id="al-sp-cnote" type="checkbox" disabled> Collection note received</label>' +
                '<label class="al-check"><input id="al-sp-credit" type="checkbox" disabled> Credit note received</label>' +
              '</div>' +
            '</div>' +
            '<div id="al-sp-saving" class="al-saving"></div>' +
            '<div class="al-sel-actions">' +
              '<button id="al-sp-edit" class="eikon-btn" type="button" disabled>Edit Selected</button>' +
              '<button id="al-sp-clear" class="eikon-btn" type="button" disabled>Clear Selection</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
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

    var yearsEl = E.q("#al-years", mount);
    var refreshBtn = E.q("#al-refresh", mount);
    var printBtn = E.q("#al-print", mount);
    var addBtn = E.q("#al-add", mount);
    var tbody = E.q("#al-tbody", mount);

    var spMeta = E.q("#al-sp-meta", mount);
    var spSaving = E.q("#al-sp-saving", mount);
    var spEditBtn = E.q("#al-sp-edit", mount);
    var spClearBtn = E.q("#al-sp-clear", mount);
    var spTeam = E.q("#al-sp-team", mount);
    var spSupp = E.q("#al-sp-supp", mount);
    var spAuth = E.q("#al-sp-auth", mount);
    var spReturn = E.q("#al-sp-return", mount);
    var spHandover = E.q("#al-sp-handover", mount);
    var spCnote = E.q("#al-sp-cnote", mount);
    var spCredit = E.q("#al-sp-credit", mount);

    function setSelected(entry) {
      state.selectedEntry = entry ? Object.assign({}, entry) : null;
      state.selectedId = entry && entry.id ? entry.id : null;

      var has = !!state.selectedEntry;
      function setEnabled(x, en) { if (x) x.disabled = !en; }

      setEnabled(spTeam, has);
      setEnabled(spSupp, has);
      setEnabled(spAuth, has);
      setEnabled(spReturn, has);
      setEnabled(spHandover, has);
      setEnabled(spCnote, has);
      setEnabled(spCredit, has);
      setEnabled(spEditBtn, has);
      setEnabled(spClearBtn, has);

      if (!has) {
        if (spMeta) spMeta.textContent = "Select an alert row to view/update checklist.";
        if (spSaving) spSaving.textContent = "";
        if (spTeam) spTeam.checked = false;
        if (spSupp) spSupp.checked = false;
        if (spAuth) spAuth.checked = false;
        if (spReturn) spReturn.checked = false;
        if (spHandover) spHandover.checked = false;
        if (spCnote) spCnote.checked = false;
        if (spCredit) spCredit.checked = false;
        highlightSelectedRow();
        return;
      }

      var r = state.selectedEntry;
      var typeLabel = (r.alert_type === "quarantine" ? "Quarantine" : "Recall");
      var statusLabel = (r.status === "in_progress" ? "In progress" : (r.status === "closed" ? "Closed" : "Open"));
      if (spMeta) spMeta.textContent =
        "Selected: " + (r.item_name || "-") + "  |  " + fmtDmyFromYmd(r.entry_date || "") + "  |  " + typeLabel + "  |  " + statusLabel;

      if (spTeam) spTeam.checked = asBool(r.team_informed);
      if (spSupp) spSupp.checked = asBool(r.supplier_informed);
      if (spAuth) spAuth.checked = asBool(r.authorities_informed);
      if (spReturn) spReturn.checked = asBool(r.return_arranged);
      if (spHandover) spHandover.checked = asBool(r.handed_over);
      if (spCnote) spCnote.checked = asBool(r.collection_note_received);
      if (spCredit) spCredit.checked = asBool(r.credit_note_received);

      if (spSaving) spSaving.textContent = "";
      highlightSelectedRow();
    }

    function highlightSelectedRow() {
      try {
        var sid = state.selectedId == null ? "" : String(state.selectedId);
        var rows = tbody ? tbody.querySelectorAll("tr") : [];
        for (var i = 0; i < rows.length; i++) {
          var tr = rows[i];
          var id = tr && tr.dataset ? String(tr.dataset.id || "") : "";
          if (sid && id === sid) tr.classList.add("al-row-selected");
          else tr.classList.remove("al-row-selected");
        }
      } catch (e) {}
    }

    async function saveChecklistNow() {
      if (!state.selectedEntry || !state.selectedId) return;
      if (state._checkSaving) return;

      if (state._checkSaveTimer) {
        try { clearTimeout(state._checkSaveTimer); } catch (e) {}
        state._checkSaveTimer = null;
      }

      state._checkSaving = true;
      if (spSaving) spSaving.textContent = "Saving…";

      try {
        var payload = payloadFromEntry(state.selectedEntry);
        await apiUpdate(state.selectedId, payload);

        for (var i = 0; i < (state.entries || []).length; i++) {
          if (String(state.entries[i].id) === String(state.selectedId)) {
            state.entries[i] = Object.assign({}, state.entries[i], state.selectedEntry);
            break;
          }
        }

        if (spSaving) spSaving.textContent = "Saved " + new Date().toLocaleTimeString();
      } catch (e) {
        var msg = (e && (e.message || e.bodyText)) ? (e.message || e.bodyText) : "Error";
        if (spSaving) spSaving.textContent = "Save failed: " + msg;
        toast("Checklist save failed", msg, "bad", 4200);
      } finally {
        state._checkSaving = false;
      }
    }

    function scheduleChecklistSave() {
      if (!state.selectedEntry || !state.selectedId) return;
      if (spSaving) spSaving.textContent = "Saving…";
      if (state._checkSaveTimer) {
        try { clearTimeout(state._checkSaveTimer); } catch (e) {}
      }
      state._checkSaveTimer = setTimeout(function () { saveChecklistNow().catch(function () {}); }, 350);
    }

    function wireChecklistCheckbox(cb, field) {
      if (!cb) return;
      cb.addEventListener("change", function () {
        if (!state.selectedEntry) return;
        state.selectedEntry[field] = cb.checked ? 1 : 0;
        scheduleChecklistSave();
      });
    }

    wireChecklistCheckbox(spTeam, "team_informed");
    wireChecklistCheckbox(spSupp, "supplier_informed");
    wireChecklistCheckbox(spAuth, "authorities_informed");
    wireChecklistCheckbox(spReturn, "return_arranged");
    wireChecklistCheckbox(spHandover, "handed_over");
    wireChecklistCheckbox(spCnote, "collection_note_received");
    wireChecklistCheckbox(spCredit, "credit_note_received");

    if (spEditBtn) spEditBtn.addEventListener("click", function () {
      if (!state.selectedEntry) return;
      openEditModal(state.selectedEntry, function () { doRefresh().catch(function () {}); });
    });
    if (spClearBtn) spClearBtn.addEventListener("click", function () { setSelected(null); });

    async function doRefresh() {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Loading...";
      try {
        var list = await loadAndFilter();

        // update years label in case year rolled over
        if (yearsEl) yearsEl.value = state.range.label;

        renderTable(tbody, list, state.selectedId, function (r) { setSelected(r); });

        // keep selection if possible
        if (state.selectedId) {
          var found = null;
          for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(state.selectedId)) { found = list[i]; break; }
          }
          if (found) setSelected(found);
          else setSelected(null);
        } else {
          setSelected(null);
        }
      } catch (e) {
        toast("Load failed", (e && (e.message || e.bodyText)) ? (e.message || e.bodyText) : "Error", "bad", 4200);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh";
      }
    }

    refreshBtn.addEventListener("click", function () { doRefresh().catch(function () {}); });

    if (printBtn) printBtn.addEventListener("click", function () {
      try { openPrintWindow(state.entries || [], (state.range && state.range.label) ? state.range.label : ""); }
      catch (e) { toast("Print failed", (e && (e.message || e.bodyText)) ? (e.message || e.bodyText) : "Error", "bad", 4200); }
    });

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
