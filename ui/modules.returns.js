(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // ----------------------------
  // Helpers
  // ----------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  function ymd(d) {
    if (!(d instanceof Date)) d = new Date(d);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function ym(d) {
    if (!(d instanceof Date)) d = new Date(d);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }
  function fmtDmyFromYmd(s) {
    var x = String(s || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
    return x.slice(8, 10) + "/" + x.slice(5, 7) + "/" + x.slice(0, 4);
  }
  function to01(v) { return v ? 1 : 0; }
  function from01(v) { return String(v) === "1" || v === 1 || v === true; }

  // Very small toast (so we don't depend on other modules)
  function ensureToastStyles() {
    if (document.getElementById("re-toast-style")) return;
    var st = document.createElement("style");
    st.id = "re-toast-style";
    st.textContent =
      ".re-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(520px,calc(100vw - 28px));}" +
      ".re-toast{border:1px solid rgba(255,255,255,.12);background:rgba(12,16,24,.92);backdrop-filter:blur(10px);border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);}" +
      ".re-toast .t-title{font-weight:900;margin:0 0 2px 0;font-size:13px;}" +
      ".re-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".re-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".re-toast.bad{border-color:rgba(255,90,122,.35);}" +
      ".re-toast.warn{border-color:rgba(255,200,90,.35);}" +
      ".re-row-selected{background:rgba(58,160,255,.10)!important;}" +
      ".re-row-selected td{border-bottom-color:rgba(58,160,255,.22)!important;}" +
      ".re-panel{border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:14px;padding:12px;}" +".re-check{display:flex;gap:10px;align-items:center;margin:8px 0;}" +".re-check input{transform:scale(1.05);}" +
      ".re-mini{font-size:12px;opacity:.85;}" +
      ".re-suggest{display:none;flex-wrap:wrap;gap:8px;margin-top:8px;}" +
      ".re-suggest.show{display:flex;}" +
      ".re-chip{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);border-radius:999px;padding:6px 10px;font-size:12px;cursor:pointer;user-select:none;}" +
      ".re-chip:hover{background:rgba(255,255,255,.08);}" +
      ".re-split{display:grid;grid-template-columns:1fr 1fr;gap:12px;}" +
      "@media (max-width: 860px){.re-split{grid-template-columns:1fr;}}";
    document.head.appendChild(st);
  }
  function toast(kind, title, msg) {
    ensureToastStyles();
    var wrap = document.getElementById("re-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "re-toast-wrap";
      wrap.className = "re-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "re-toast " + (kind || "");
    t.innerHTML = "<div class='t-title'>" + esc(title || "") + "</div><div class='t-msg'>" + esc(msg || "") + "</div>";
    wrap.appendChild(t);
    setTimeout(function () {
      try { wrap.removeChild(t); } catch (e) {}
      if (wrap.childNodes.length === 0) { try { wrap.parentNode.removeChild(wrap); } catch (e2) {} }
    }, 3200);
  }

  function api(method, path, body) {
    return E.apiFetch(path, { method: method, body: body ? JSON.stringify(body) : undefined });
  }

  function modalError(title, err) {
    var msg = (err && (err.message || err.error)) ? (err.message || err.error) : String(err || "Error");
    E.modal.show(title || "Error", "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
  }

  // ----------------------------
  // State
  // ----------------------------
  var state = {
    month: ym(new Date()),
    q: "",
    rows: [],
    filtered: [],
    selectedId: null,
    selected: null,
    busy: false
  };

  var REMARKS = [
    "Wrong Pick",
    "Expiring soon",
    "Damaged",
    "Wrong quantity",
    "Received late",
    "Duplicate order"
  ];

  function normalizeRow(r) {
    r = r || {};
    return {
      id: r.id,
      entry_date: String(r.entry_date || ""),
      description: String(r.description || ""),
      expiry: String(r.expiry || ""),
      batch: String(r.batch || ""),
      quantity: String(r.quantity || ""),
      supplier: String(r.supplier || ""),
      invoice_number: String(r.invoice_number || ""),
      remarks: String(r.remarks || ""),
      location_stored: String(r.location_stored || ""),
      return_arranged: from01(r.return_arranged),
      handed_over: from01(r.handed_over),
      collection_note_received: from01(r.collection_note_received),
      credit_note_received: from01(r.credit_note_received)
    };
  }

  function applyFilter() {
    var q = String(state.q || "").trim().toLowerCase();
    if (!q) {
      state.filtered = state.rows.slice();
      return;
    }
    state.filtered = state.rows.filter(function (r) {
      var blob = [
        r.entry_date, r.description, r.expiry, r.batch, r.quantity, r.supplier,
        r.invoice_number, r.remarks, r.location_stored
      ].join(" ").toLowerCase();
      return blob.indexOf(q) !== -1;
    });
  }

  function setSelected(row) {
    if (!row) {
      state.selectedId = null;
      state.selected = null;
      return;
    }
    var r = normalizeRow(row);
    state.selectedId = r.id || null;
    state.selected = r;
  }

  function readForm() {
    function v(id) { var n = document.getElementById(id); return n ? String(n.value || "").trim() : ""; }
    function c(id) { var n = document.getElementById(id); return !!(n && n.checked); }

    return {
      entry_date: v("re-date"),
      description: v("re-desc"),
      expiry: v("re-expiry"),
      batch: v("re-batch"),
      quantity: v("re-qty"),
      supplier: v("re-supplier"),
      invoice_number: v("re-invoice"),
      remarks: v("re-remarks"),
      location_stored: v("re-location"),
      return_arranged: to01(c("re-return-arranged")),
      handed_over: to01(c("re-handed-over")),
      collection_note_received: to01(c("re-collection-note")),
      credit_note_received: to01(c("re-credit-note"))
    };
  }

  function fillForm(row) {
    row = normalizeRow(row || {});
    var map = {
      "re-date": row.entry_date || ymd(new Date()),
      "re-desc": row.description || "",
      "re-expiry": row.expiry || "",
      "re-batch": row.batch || "",
      "re-qty": row.quantity || "",
      "re-supplier": row.supplier || "",
      "re-invoice": row.invoice_number || "",
      "re-remarks": row.remarks || "",
      "re-location": row.location_stored || ""
    };
    Object.keys(map).forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.value = map[id];
    });

    var cb = [
      ["re-return-arranged", row.return_arranged],
      ["re-handed-over", row.handed_over],
      ["re-collection-note", row.collection_note_received],
      ["re-credit-note", row.credit_note_received]
    ];
    cb.forEach(function (p) {
      var n = document.getElementById(p[0]);
      if (n) n.checked = !!p[1];
    });

    var meta = document.getElementById("re-sel-meta");
    if (meta) {
      if (row && row.id) {
        var flags = [];
        if (row.return_arranged) flags.push("Return arranged");
        if (row.handed_over) flags.push("Handed over");
        if (row.collection_note_received) flags.push("Collection note");
        if (row.credit_note_received) flags.push("Credit note");
        meta.textContent = "Selected ID: " + row.id + (flags.length ? (" • " + flags.join(" • ")) : "");
      } else {
        meta.textContent = "New entry (not saved yet)";
      }
    }
  }

  async function doRefresh() {
    state.busy = true;
    setBusyUI(true);
    try {
      var month = String(state.month || "").trim();
      var res = await api("GET", "/returns/entries?month=" + encodeURIComponent(month));
      if (!res || !res.ok) throw new Error((res && res.error) || "Load failed");
      state.rows = (res.entries || []).map(normalizeRow);
      applyFilter();

      // Preserve selection if possible
      var sel = null;
      if (state.selectedId) {
        for (var i = 0; i < state.rows.length; i++) {
          if (String(state.rows[i].id) === String(state.selectedId)) { sel = state.rows[i]; break; }
        }
      }
      if (sel) setSelected(sel);
      renderTable();
      renderSelection();
    } catch (e) {
      modalError("Refresh failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  function setBusyUI(on) {
    var b = document.getElementById("re-busy");
    if (b) b.textContent = on ? "Working…" : "";
    var ids = ["re-refresh", "re-print", "re-new", "re-save", "re-delete"];
    ids.forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.disabled = !!on;
    });
  }

  async function doSave() {
    var body = readForm();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.entry_date || "")) {
      toast("warn", "Check date", "Please enter a valid date.");
      return;
    }
    if (!String(body.description || "").trim()) {
      toast("warn", "Description required", "Please enter a description.");
      return;
    }
    if (body.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(body.expiry)) {
      toast("warn", "Check expiry", "Expiry must be a date (YYYY-MM-DD) or empty.");
      return;
    }

    state.busy = true;
    setBusyUI(true);
    try {
      if (state.selectedId) {
        var resU = await api("PUT", "/returns/entries/" + encodeURIComponent(state.selectedId), body);
        if (!resU || !resU.ok) throw new Error((resU && resU.error) || "Update failed");
        toast("good", "Saved", "Return updated.");
      } else {
        var resC = await api("POST", "/returns/entries", body);
        if (!resC || !resC.ok) throw new Error((resC && resC.error) || "Create failed");
        toast("good", "Saved", "Return created.");
        state.selectedId = resC.id || null;
      }
      await doRefresh();
    } catch (e) {
      modalError("Save failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  function doDelete() {
    if (!state.selectedId) {
      toast("warn", "No selection", "Select a row to delete.");
      return;
    }
    var id = state.selectedId;
    E.modal.show(
      "Delete return?",
      "<div style='white-space:pre-wrap'>This will permanently delete the selected return entry.\n\nID: " + esc(id) + "</div>",
      [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Delete",
          danger: true,
          primary: true,
          onClick: function () {
            E.modal.hide();
            (async function () {
              state.busy = true;
              setBusyUI(true);
              try {
                var resD = await api("DELETE", "/returns/entries/" + encodeURIComponent(id));
                if (!resD || !resD.ok) throw new Error((resD && resD.error) || "Delete failed");
                toast("good", "Deleted", "Entry deleted.");
                setSelected(null);
                fillForm({ entry_date: ymd(new Date()) });
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

  function openPrintWindow(entries, monthYm, queryText) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var ymVal = String(monthYm || "").trim();
    var q = String(queryText || "").trim();

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show(
        "Print",
        "<div style='white-space:pre-wrap'>Popup blocked. Allow popups and try again.</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
      );
      return;
    }

    function safe(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\'/g, "&#39;");
    }

    var rowsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var flags = [];
      if (from01(r.return_arranged)) flags.push("Return arranged");
      if (from01(r.handed_over)) flags.push("Handed over");
      if (from01(r.collection_note_received)) flags.push("Collection note");
      if (from01(r.credit_note_received)) flags.push("Credit note");
      rowsHtml +=
        "<tr>" +
          "<td>" + safe(fmtDmyFromYmd(r.entry_date || "")) + "</td>" +
          "<td><b>" + safe(r.description || "") + "</b><div style='opacity:.75;font-size:11px'>" +
            (r.quantity ? ("Qty: " + safe(r.quantity) + " • ") : "") +
            (r.supplier ? ("Supplier: " + safe(r.supplier) + " • ") : "") +
            "ID: " + safe(r.id || "") +
          "</div></td>" +
          "<td>" + safe(r.expiry || "") + "</td>" +
          "<td>" + safe(r.batch || "") + "</td>" +
          "<td>" + safe(r.invoice_number || "") + "</td>" +
          "<td>" + safe(r.remarks || "") + "</td>" +
          "<td>" + safe(r.location_stored || "") + "</td>" +
          "<td>" + safe(flags.join(" • ")) + "</td>" +
        "</tr>";
    }

    var title = "Returns" + (ymVal ? (" — " + ymVal) : "");
    var subtitle = [];
    if (q) subtitle.push("Search: " + q);
    subtitle.push("Printed: " + new Date().toLocaleString());

    var html =
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<title>" + safe(title) + "</title>" +
      "<style>" +
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}" +
        "h1{font-size:18px;margin:0 0 6px 0;}" +
        ".sub{font-size:12px;opacity:.8;margin:0 0 14px 0;}" +
        "table{width:100%;border-collapse:collapse;}" +
        "th,td{border:1px solid #ddd;padding:8px;vertical-align:top;font-size:12px;text-align:left;}" +
        "th{background:#f5f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.3px;}" +
        "@media print{body{margin:10mm;} }" +
      "</style></head><body>" +
      "<h1>" + safe(title) + "</h1>" +
      "<div class='sub'>" + safe(subtitle.join(" • ")) + "</div>" +
      "<table><thead><tr>" +
        "<th>Date</th><th>Description</th><th>Expiry</th><th>Batch</th><th>Invoice #</th><th>Remarks</th><th>Location stored</th><th>Checklist</th>" +
      "</tr></thead><tbody>" + rowsHtml + "</tbody></table>" +
      "<script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function renderSelection() {
    var sel = state.selected || { entry_date: ymd(new Date()) };
    fillForm(sel);
    // Update selected highlight
    renderTable();
  }

  function renderTable() {
    var tbody = document.getElementById("re-tbody");
    var count = document.getElementById("re-count");
    if (!tbody) return;

    applyFilter();
    var list = state.filtered || [];
    if (count) count.textContent = String(list.length || 0);

    tbody.innerHTML = "";
    if (!list.length) {
      var tr0 = document.createElement("tr");
      tr0.innerHTML = "<td colspan='2' style='opacity:.75'>No entries.</td>";
      tbody.appendChild(tr0);
      return;
    }

    for (var i = 0; i < list.length; i++) {
      (function () {
        var r = list[i];
        var tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        if (state.selectedId && String(r.id) === String(state.selectedId)) tr.classList.add("re-row-selected");
        tr.addEventListener("click", function () {
          setSelected(r);
          renderSelection();
        });

        var meta = [];
        if (r.quantity) meta.push("Qty: " + r.quantity);
        if (r.supplier) meta.push("Supplier: " + r.supplier);
        if (r.invoice_number) meta.push("Inv: " + r.invoice_number);

        tr.innerHTML =
          "<td style='white-space:nowrap'>" + esc(fmtDmyFromYmd(r.entry_date || "")) + "</td>" +
          "<td><b>" + esc(r.description || "") + "</b>" +
            (meta.length ? ("<div class='re-mini'>" + esc(meta.join(" • ")) + "</div>") : "") +
          "</td>";
        tbody.appendChild(tr);
      })();
    }
  }

  function wireRemarksSuggest() {
    var input = document.getElementById("re-remarks");
    var box = document.getElementById("re-suggest");
    if (!input || !box) return;

    function show() { box.classList.add("show"); }
    function hide() { box.classList.remove("show"); }

    input.addEventListener("focus", show);
    input.addEventListener("click", show);
    input.addEventListener("blur", function () { setTimeout(hide, 120); });

    // Build chips
    box.innerHTML = "";
    REMARKS.forEach(function (t) {
      var b = document.createElement("div");
      b.className = "re-chip";
      b.textContent = t;
      b.addEventListener("mousedown", function (e) {
        // prevent blur
        e.preventDefault();
      });
      b.addEventListener("click", function () {
        input.value = t;
        input.focus();
      });
      box.appendChild(b);
    });
  }

  function render(ctx) {
    var mount = ctx.mount;
    ensureToastStyles();

    mount.innerHTML =
      '<div class="eikon-card">' +
        '<div class="eikon-row" style="align-items:center;gap:12px;flex-wrap:wrap;">' +
          '<span class="eikon-pill" style="font-weight:900;">↩️ Returns</span>' +

          '<div class="eikon-field" style="min-width:200px;">' +
            '<div class="eikon-label">Month</div>' +
            '<input id="re-month" class="eikon-input" type="month" value="' + esc(state.month) + '">' +
          '</div>' +

          '<div class="eikon-field" style="flex:1;min-width:260px;">' +
            '<div class="eikon-label">Search</div>' +
            '<input id="re-search" class="eikon-input" placeholder="Search as you type…" value="' + esc(state.q) + '">' +
          '</div>' +

          '<div class="eikon-field" style="margin-left:auto;min-width:260px;">' +
            '<div class="eikon-label">Actions</div>' +
            '<div class="eikon-row" style="gap:10px;flex-wrap:wrap;">' +
              '<button id="re-refresh" class="eikon-btn">Refresh</button>' +
              '<button id="re-print" class="eikon-btn">Print</button>' +
              '<button id="re-new" class="eikon-btn primary">New</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="re-busy" class="re-mini" style="margin-top:10px;min-height:16px;"></div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="re-panel">' +
          '<div style="font-weight:900;margin:0 0 6px 0;">Details</div>' +
          '<div id="re-sel-meta" class="re-mini">Select a row, or press New.</div>' +
          '<div style="height:10px;"></div>' +

          '<div class="re-split">' +
            '<div>' +
              '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;">' +
                '<div class="eikon-field" style="min-width:160px;">' +
                  '<div class="eikon-label">Date</div>' +
                  '<input id="re-date" class="eikon-input" type="date" value="' + esc(ymd(new Date())) + '">' +
                '</div>' +
                '<div class="eikon-field" style="flex:1;min-width:240px;">' +
                  '<div class="eikon-label">Description</div>' +
                  '<input id="re-desc" class="eikon-input" placeholder="e.g. Item name / reason">' +
                '</div>' +
              '</div>' +

              '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;margin-top:12px;">' +
                '<div class="eikon-field" style="min-width:160px;">' +
                  '<div class="eikon-label">Expiry</div>' +
                  '<input id="re-expiry" class="eikon-input" type="date" value="">' +
                '</div>' +
                '<div class="eikon-field" style="min-width:180px;">' +
                  '<div class="eikon-label">Batch</div>' +
                  '<input id="re-batch" class="eikon-input" placeholder="Batch">' +
                '</div>' +
                '<div class="eikon-field" style="min-width:140px;">' +
                  '<div class="eikon-label">Quantity</div>' +
                  '<input id="re-qty" class="eikon-input" placeholder="Qty">' +
                '</div>' +
              '</div>' +

              '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;margin-top:12px;">' +
                '<div class="eikon-field" style="min-width:220px;flex:1;">' +
                  '<div class="eikon-label">Supplier</div>' +
                  '<input id="re-supplier" class="eikon-input" placeholder="Supplier">' +
                '</div>' +
                '<div class="eikon-field" style="min-width:220px;flex:1;">' +
                  '<div class="eikon-label">Invoice Number</div>' +
                  '<input id="re-invoice" class="eikon-input" placeholder="Invoice #">' +
                '</div>' +
              '</div>' +

              '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;margin-top:12px;align-items:flex-start;">' +
                '<div class="eikon-field" style="flex:1;min-width:280px;">' +
                  '<div class="eikon-label">Remarks</div>' +
                  '<input id="re-remarks" class="eikon-input" placeholder="Click for suggestions…">' +
                  '<div id="re-suggest" class="re-suggest"></div>' +
                '</div>' +
              '</div>' +

              '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;margin-top:12px;">' +
                '<div class="eikon-field" style="flex:1;min-width:280px;">' +
                  '<div class="eikon-label">Location stored</div>' +
                  '<input id="re-location" class="eikon-input" placeholder="e.g. Shelves / Back room / Fridge">' +
                '</div>' +
              '</div>' +
            '</div>' +

            '<div>' +
              '<div style="font-weight:900;margin-bottom:8px;">Checklist</div>' +
              '<label class="re-check"><input id="re-return-arranged" type="checkbox"> Return arranged</label>' +
              '<label class="re-check"><input id="re-handed-over" type="checkbox"> Handed over</label>' +
              '<label class="re-check"><input id="re-collection-note" type="checkbox"> Collection note received</label>' +
              '<label class="re-check"><input id="re-credit-note" type="checkbox"> Credit note received</label>' +

              '<div style="height:12px;"></div>' +
              '<div class="eikon-row" style="gap:10px;flex-wrap:wrap;">' +
                '<button id="re-save" class="eikon-btn primary">Save</button>' +
                '<button id="re-delete" class="eikon-btn danger">Delete</button>' +
              '</div>' +
              '<div class="re-mini" style="margin-top:10px;opacity:.75;">Tip: keep the table clean and use Details to view/edit.</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="eikon-row" style="align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
          '<div style="font-weight:900;">Entries</div>' +
          '<div class="eikon-pill" style="margin-left:auto;">Shown: <span id="re-count">0</span></div>' +
        '</div>' +
        '<div class="eikon-table-wrap">' +
          '<table class="eikon-table" style="min-width:620px;">' +
            '<thead><tr><th style="width:140px;">Date</th><th>Description</th></tr></thead>' +
            '<tbody id="re-tbody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    // Wire controls
    var monthEl = document.getElementById("re-month");
    if (monthEl) {
      monthEl.addEventListener("change", function () {
        state.month = String(monthEl.value || "").trim() || ym(new Date());
        doRefresh();
      });
    }

    var searchEl = document.getElementById("re-search");
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        state.q = String(searchEl.value || "");
        applyFilter();
        renderTable();
      });
    }

    var btnRefresh = document.getElementById("re-refresh");
    if (btnRefresh) btnRefresh.addEventListener("click", function () { doRefresh(); });

    var btnPrint = document.getElementById("re-print");
    if (btnPrint) btnPrint.addEventListener("click", function () {
      applyFilter();
      openPrintWindow(state.filtered || [], state.month, state.q);
    });

    var btnNew = document.getElementById("re-new");
    if (btnNew) btnNew.addEventListener("click", function () {
      setSelected({ entry_date: ymd(new Date()) });
      fillForm(state.selected);
      renderTable();
    });

    var btnSave = document.getElementById("re-save");
    if (btnSave) btnSave.addEventListener("click", function () { doSave(); });

    var btnDelete = document.getElementById("re-delete");
    if (btnDelete) btnDelete.addEventListener("click", function () { doDelete(); });

    wireRemarksSuggest();

    // Initial form state
    fillForm(state.selected || { entry_date: ymd(new Date()) });
    renderTable();

    doRefresh();
  }

  E.registerModule({
    id: "returns",
    title: "Returns",
    order: 240,
    icon: "↩️",
    render: render
  });

})();
