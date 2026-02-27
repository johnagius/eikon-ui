/* ui/modules.ddastocktakes.js
   Eikon - DDA Stock Takes module (UI) with editable grid

   Endpoints (Cloudflare Worker):
   - GET    /dda-stocktakes/stocktakes
   - POST   /dda-stocktakes/stocktakes
   - GET    /dda-stocktakes/stocktakes/:id
   - PUT    /dda-stocktakes/stocktakes/:id              { closed: 1|0 }
   - POST   /dda-stocktakes/stocktakes/:id/items
   - PUT    /dda-stocktakes/items/:itemId
   - DELETE /dda-stocktakes/items/:itemId
   - GET    /dda-stocktakes/stocktakes/:id/report/html  (print)
*/
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") node.className = String(v || "");
      else if (k === "text") node.textContent = String(v == null ? "" : v);
      else if (k === "html") node.innerHTML = String(v == null ? "" : v);
      else if (k === "value") node.value = String(v == null ? "" : v);
      else if (k === "type") node.type = String(v || "");
      else if (k === "placeholder") node.placeholder = String(v || "");
      else if (k === "disabled") node.disabled = !!v;
      else if (k === "style") node.setAttribute("style", String(v || ""));
      else node.setAttribute(k, String(v));
    });
    if (Array.isArray(children)) {
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  // Toast
  var toastInstalled = false;
  function ensureToastStyles() {
    if (toastInstalled) return;
    toastInstalled = true;
    var st = document.createElement("style");
    st.type = "text/css";
    st.textContent =
      ".eikon-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".eikon-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);}"+
      ".eikon-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}"+
      ".eikon-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}"+
      ".eikon-toast.good{border-color:rgba(67,209,122,.35);}"+
      ".eikon-toast.bad{border-color:rgba(255,90,122,.35);}"+
      ".eikon-toast.warn{border-color:rgba(255,200,90,.35);}"+
      ".eikon-slim-input{min-width:120px;}" +
      ".eikon-grid-input{width:100%;box-sizing:border-box;}" +
      ".eikon-grid-actions{display:flex;gap:8px;flex-wrap:wrap;}" +
      "";
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
    var ttl = (typeof ms === "number" ? ms : 2600);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, ttl);
  }

  function fmtTs(s) {
    var str = String(s || "");
    if (!str) return "";
    if (str.indexOf("T") >= 0) return str.replace("T", " ").replace("Z", "").slice(0, 19);
    return str.slice(0, 19);
  }

  async function apiGet(path) { return await E.apiFetch(path, { method: "GET" }); }
  async function apiPost(path, bodyObj) {
    return await E.apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj || {}) });
  }
  async function apiPut(path, bodyObj) {
    return await E.apiFetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyObj || {}) });
  }
  async function apiDelete(path) { return await E.apiFetch(path, { method: "DELETE" }); }

  // ✅ Printing method updated to match modules.temperature.js (Blob -> objectURL -> open)
  function openPrintTabWithHtml(html) {
    var blob = new Blob([String(html || "")], { type: "text/html" });
    var url = URL.createObjectURL(blob);

    var w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }

    if (!w) {
      try {
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e2) {}
    }

    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
  }

  async function printReportHtml(url) {
    try {
      // Endpoint returns HTML; E.apiFetch returns {ok:true,text:"..."} for non-JSON
      var resp = await apiGet(url);
      var html = (resp && typeof resp.text === "string") ? resp.text : "";
      if (!html) throw new Error("Empty report");
      openPrintTabWithHtml(html);
    } catch (e) {
      toast("Print", "Could not generate printable report.\n" + String(e && (e.message || e.bodyText || e)), "bad", 5200);
    }
  }

  async function render(mount) {
    mount.innerHTML = "";

    var state = {
      stocktakes: [],
      selectedId: null,
      selected: null, // { ok, stocktake, items }
      editingId: null,
      editDraft: null // {item_name, dosage, qty_tablets}
    };

    var headerCard = el("div", { class: "eikon-card" });
    var bodyCard = el("div", { class: "eikon-card" });
    var itemsWrap = el("div", {});

    var stocktakeSelect = el("select", { class: "eikon-select eikon-slim-input" });

    var btnNew = el("button", { class: "eikon-btn primary", text: "New Stock Take" });
    var btnRefresh = el("button", { class: "eikon-btn", text: "Refresh" });
    var btnClose = el("button", { class: "eikon-btn", text: "Save & Close" });
    var btnPrint = el("button", { class: "eikon-btn", text: "Print Selected" });

    var metaLine = el("div", { class: "eikon-help", text: "" });

    headerCard.appendChild(
      el("div", { class: "eikon-row" }, [
        el("div", { class: "eikon-field" }, [
          el("div", { class: "eikon-label", text: "Select Stock Take" }),
          stocktakeSelect
        ]),
        btnNew,
        btnRefresh,
        btnClose,
        btnPrint
      ])
    );
    headerCard.appendChild(el("div", { style: "margin-top:8px;" }, [metaLine]));
    headerCard.appendChild(el("div", {
      class: "eikon-help",
      style: "margin-top:8px;",
      text:
        "Create stock takes with an automatic date/time. Add items (Name, Dosage, Quantity of Tablets). " +
        "You can edit later, and print any stock take from the dropdown."
    }));

    bodyCard.appendChild(itemsWrap);
    mount.appendChild(headerCard);
    mount.appendChild(bodyCard);

    // Add item row
    var inName = el("input", { class: "eikon-input", placeholder: "Name" });
    var inDosage = el("input", { class: "eikon-input", placeholder: "Dosage (e.g. 10mg)" });
    var inQty = el("input", { class: "eikon-input eikon-slim-input", placeholder: "Qty tablets", type: "number" });
    var btnAdd = el("button", { class: "eikon-btn primary", text: "Add Item" });

    function validateAdd() {
      var name = (inName.value || "").trim();
      var dosage = (inDosage.value || "").trim();
      var qty = (inQty.value || "").trim();
      var qtyNum = qty === "" ? null : Number(qty);
      if (!name) return { ok: false, msg: "Name is required." };
      if (qtyNum == null || !Number.isFinite(qtyNum) || qtyNum < 0) return { ok: false, msg: "Quantity must be a number (>= 0)." };
      return { ok: true, item_name: name, dosage: dosage, qty_tablets: Math.floor(qtyNum) };
    }

    function startEdit(item) {
      state.editingId = String(item.id);
      state.editDraft = {
        item_name: String(item.item_name || ""),
        dosage: String(item.dosage || ""),
        qty_tablets: (item.qty_tablets == null ? "" : String(item.qty_tablets))
      };
      renderItems();
    }

    function cancelEdit() {
      state.editingId = null;
      state.editDraft = null;
      renderItems();
    }

    function validateDraft() {
      var d = state.editDraft || {};
      var name = String(d.item_name || "").trim();
      var dosage = String(d.dosage || "").trim();
      var qtyStr = String(d.qty_tablets == null ? "" : d.qty_tablets).trim();
      var qtyNum = qtyStr === "" ? null : Number(qtyStr);
      if (!name) return { ok: false, msg: "Name is required." };
      if (qtyNum == null || !Number.isFinite(qtyNum) || qtyNum < 0) return { ok: false, msg: "Quantity must be a number (>= 0)." };
      return { ok: true, item_name: name, dosage: dosage, qty_tablets: Math.floor(qtyNum) };
    }

    async function saveEdit(itemId) {
      var v = validateDraft();
      if (!v.ok) return toast("Validation", v.msg, "warn", 3400);
      try {
        await apiPut("/dda-stocktakes/items/" + encodeURIComponent(itemId), v);
        toast("Saved", "Item updated.", "good");
        state.editingId = null;
        state.editDraft = null;
        await loadSelected(state.selectedId);
      } catch (e) {
        toast("Save failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    }

    async function deleteItem(itemId, itemName) {
      try {
        // Simple confirm (no modal dependency)
        var ok = window.confirm("Delete this item?\n\n" + (itemName || ""));
        if (!ok) return;
        await apiDelete("/dda-stocktakes/items/" + encodeURIComponent(itemId));
        toast("Deleted", "Item removed.", "good");
        if (state.editingId === String(itemId)) {
          state.editingId = null;
          state.editDraft = null;
        }
        await loadSelected(state.selectedId);
      } catch (e) {
        toast("Delete failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    }

    function renderItems() {
      itemsWrap.innerHTML = "";

      if (!state.selectedId) {
        metaLine.textContent = "";
        itemsWrap.appendChild(el("div", { class: "eikon-help", text: "No stock take selected. Create a new one to begin." }));
        return;
      }
      if (!state.selected) {
        itemsWrap.appendChild(el("div", { class: "eikon-help", text: "Loading stock take…" }));
        return;
      }

      var st = state.selected.stocktake;
      var items = state.selected.items || [];

      var closed = !!st.closed_at;
      metaLine.textContent =
        "Created: " + fmtTs(st.created_at) +
        (closed ? (" • Closed: " + fmtTs(st.closed_at)) : " • Not closed");

      // Add row
      var addRow = el("div", { class: "eikon-row", style: "margin-bottom:10px;" }, [
        el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Name" }), inName]),
        el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Dosage" }), inDosage]),
        el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Quantity of Tablets" }), inQty]),
        btnAdd
      ]);
      itemsWrap.appendChild(addRow);

      if (!items.length) {
        itemsWrap.appendChild(el("div", { class: "eikon-help", text: "No items yet. Add your first item above." }));
        return;
      }

      var table = el("table", { class: "eikon-table" });
      var thead = el("thead", {});
      var trh = el("tr", {});
      ["Name", "Dosage", "Qty Tablets", "Actions"].forEach(function (h) {
        trh.appendChild(el("th", { text: h }));
      });
      thead.appendChild(trh);
      table.appendChild(thead);

      var tbody = el("tbody", {});
      items.forEach(function (it) {
        var isEditing = (state.editingId === String(it.id));
        var tr = el("tr", {});

        if (!isEditing) {
          tr.appendChild(el("td", { text: it.item_name || "" }));
          tr.appendChild(el("td", { text: it.dosage || "" }));
          tr.appendChild(el("td", { text: String(it.qty_tablets == null ? "" : it.qty_tablets) }));

          var tdA = el("td", {});
          var wrap = el("div", { class: "eikon-grid-actions" });

          var bEdit = el("button", { class: "eikon-btn", text: "Edit" });
          var bDel = el("button", { class: "eikon-btn danger", text: "Delete" });

          bEdit.addEventListener("click", function () { startEdit(it); });
          bDel.addEventListener("click", function () { deleteItem(it.id, it.item_name); });

          wrap.appendChild(bEdit);
          wrap.appendChild(bDel);
          tdA.appendChild(wrap);
          tr.appendChild(tdA);
        } else {
          // Editable cells
          var d = state.editDraft || {};
          var nameInput = el("input", { class: "eikon-input eikon-grid-input", value: d.item_name || "" });
          var dosageInput = el("input", { class: "eikon-input eikon-grid-input", value: d.dosage || "" });
          var qtyInput = el("input", { class: "eikon-input eikon-grid-input", type: "number", value: String(d.qty_tablets == null ? "" : d.qty_tablets) });

          nameInput.addEventListener("input", function () { state.editDraft.item_name = nameInput.value; });
          dosageInput.addEventListener("input", function () { state.editDraft.dosage = dosageInput.value; });
          qtyInput.addEventListener("input", function () { state.editDraft.qty_tablets = qtyInput.value; });

          // Enter to save (when focused in row)
          function onKey(e) {
            if (e.key === "Enter") saveEdit(it.id);
            if (e.key === "Escape") cancelEdit();
          }
          nameInput.addEventListener("keydown", onKey);
          dosageInput.addEventListener("keydown", onKey);
          qtyInput.addEventListener("keydown", onKey);

          tr.appendChild(el("td", {}, [nameInput]));
          tr.appendChild(el("td", {}, [dosageInput]));
          tr.appendChild(el("td", {}, [qtyInput]));

          var tdAct = el("td", {});
          var wrap2 = el("div", { class: "eikon-grid-actions" });

          var bSave = el("button", { class: "eikon-btn primary", text: "Save" });
          var bCancel = el("button", { class: "eikon-btn", text: "Cancel" });
          var bDel2 = el("button", { class: "eikon-btn danger", text: "Delete" });

          bSave.addEventListener("click", function () { saveEdit(it.id); });
          bCancel.addEventListener("click", function () { cancelEdit(); });
          bDel2.addEventListener("click", function () { deleteItem(it.id, it.item_name); });

          wrap2.appendChild(bSave);
          wrap2.appendChild(bCancel);
          wrap2.appendChild(bDel2);
          tdAct.appendChild(wrap2);
          tr.appendChild(tdAct);

          // Focus first input
          setTimeout(function () { try { nameInput.focus(); nameInput.select(); } catch (e) {} }, 0);
        }

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      itemsWrap.appendChild(el("div", { class: "eikon-table-wrap" }, [table]));
    }

    async function loadList(selectIdIfMissing) {
      try {
        var out = await apiGet("/dda-stocktakes/stocktakes");
        state.stocktakes = out.stocktakes || [];
        stocktakeSelect.innerHTML = "";

        if (!state.stocktakes.length) {
          stocktakeSelect.appendChild(el("option", { value: "", text: "No stock takes yet" }));
          state.selectedId = null;
          state.selected = null;
          state.editingId = null;
          state.editDraft = null;
          renderItems();
          return;
        }

        state.stocktakes.forEach(function (st) {
          var label = fmtTs(st.created_at) + (st.closed_at ? " (closed)" : "");
          stocktakeSelect.appendChild(el("option", { value: String(st.id), text: label }));
        });

        if (state.selectedId && state.stocktakes.some(function (x) { return String(x.id) === String(state.selectedId); })) {
          stocktakeSelect.value = String(state.selectedId);
        } else {
          var pick = selectIdIfMissing ? String(selectIdIfMissing) : String(state.stocktakes[0].id);
          state.selectedId = pick;
          stocktakeSelect.value = pick;
        }
        await loadSelected(state.selectedId);
      } catch (e) {
        toast("Load failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    }

    async function loadSelected(id) {
      if (!id) {
        state.selectedId = null;
        state.selected = null;
        state.editingId = null;
        state.editDraft = null;
        renderItems();
        return;
      }
      try {
        state.selectedId = String(id);
        state.selected = null;
        state.editingId = null;
        state.editDraft = null;
        renderItems();
        var out = await apiGet("/dda-stocktakes/stocktakes/" + encodeURIComponent(id));
        state.selected = out || null;
        renderItems();
      } catch (e) {
        toast("Load failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    }

    stocktakeSelect.addEventListener("change", function () {
      var v = (stocktakeSelect.value || "").trim();
      if (!v) return;
      loadSelected(v);
    });

    btnRefresh.addEventListener("click", async function () {
      await loadList(state.selectedId);
    });

    btnNew.addEventListener("click", async function () {
      try {
        var out = await apiPost("/dda-stocktakes/stocktakes", {});
        if (!out || !out.ok || !out.stocktake_id) throw new Error("Create failed");
        toast("Created", "New stock take created.", "good");
        await loadList(String(out.stocktake_id));
      } catch (e) {
        toast("Create failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    });

    btnClose.addEventListener("click", async function () {
      if (!state.selectedId) return toast("Close", "No stock take selected.", "warn", 3200);
      try {
        await apiPut("/dda-stocktakes/stocktakes/" + encodeURIComponent(state.selectedId), { closed: 1 });
        toast("Closed", "Stock take saved & closed (you can still edit later).", "good", 3600);
        await loadSelected(state.selectedId);
        await loadList(state.selectedId);
      } catch (e) {
        toast("Close failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    });

    // ✅ Only changed: printing now fetches HTML then opens Blob tab (temperature-style)
    btnPrint.addEventListener("click", async function () {
      if (!state.selectedId) return toast("Print", "No stock take selected.", "warn", 3200);
      var url = "/dda-stocktakes/stocktakes/" + encodeURIComponent(state.selectedId) + "/report/html";
      await printReportHtml(url);
    });

    btnAdd.addEventListener("click", async function () {
      if (!state.selectedId) return toast("Add item", "Create/select a stock take first.", "warn", 3400);

      var v = validateAdd();
      if (!v.ok) return toast("Validation", v.msg, "warn", 3400);

      try {
        await apiPost("/dda-stocktakes/stocktakes/" + encodeURIComponent(state.selectedId) + "/items", {
          item_name: v.item_name,
          dosage: v.dosage,
          qty_tablets: v.qty_tablets
        });
        inName.value = "";
        inDosage.value = "";
        inQty.value = "";
        inName.focus();
        toast("Added", "Item added.", "good");
        await loadSelected(state.selectedId);
      } catch (e) {
        toast("Add failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    });

    // Initial load
    await loadList(null);
  }

  E.registerModule({
    id: "dda_stocktakes",
    title: "DDA Stock Takes",
    icon: "📦",
    order: 50,
    render: async function (ctx) {
      await render(ctx.mount);
    }
  });
})();
