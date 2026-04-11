(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  /* ── helpers ──────────────────────────────────────────────────────────── */
  function esc(s) { return E.escapeHtml(String(s || "")); }

  /* ── state ───────────────────────────────────────────────────────────── */
  var S = {
    items: [],
    mount: null,
    user: null,
    filterText: "",
    isAdmin: false
  };

  /* ── API ─────────────────────────────────────────────────────────────── */
  function loadItems() {
    var q = (S.filterText || "").trim();
    var url = "/cherubino/short-expiry" + (q ? "?q=" + encodeURIComponent(q) : "");
    return E.apiFetch(url, { method: "GET" })
      .then(function (r) { S.items = r.items || []; })
      .catch(function () { S.items = []; });
  }

  function placeOrder(itemId, quantity) {
    return E.apiFetch("/cherubino/short-expiry/order", {
      method: "POST",
      body: JSON.stringify({ item_id: itemId, quantity: quantity })
    });
  }

  function removeOrder(itemId) {
    return E.apiFetch("/cherubino/short-expiry/order/" + itemId, { method: "DELETE" });
  }

  function uploadBatch(items, wipe) {
    return E.apiFetch("/cherubino/short-expiry/upload", {
      method: "POST",
      body: JSON.stringify({ items: items, wipe: wipe })
    });
  }

  /* ── file parsing ────────────────────────────────────────────────────── */
  function parseFile(file, onDone) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        // Map columns and filter WSL only
        var items = [];
        rows.forEach(function (r) {
          var locCode = String(r.loc_code || r.LOC_CODE || r.Loc_Code || "").trim().toUpperCase();
          // Filter: only rows where loc_code contains "WSL"
          if (locCode.indexOf("WSL") < 0) return;

          var stkCode = String(r.stk_code || r.STK_CODE || r.Stk_Code || "").trim();
          var stkDesc = String(r.stk_desc || r.STK_DESC || r.Stk_Desc || "").trim();
          var ref = String(r.ref || r.REF || r.Ref || "").trim();
          var qty = parseInt(r.qty || r.QTY || r.Qty) || 0;

          if (!stkDesc) return;

          // Parse ref: "SN0131|2026/06" → batch="SN0131", expiry="2026/06"
          var batch = "", expiry = "";
          if (ref.indexOf("|") >= 0) {
            var parts = ref.split("|");
            batch = parts[0].trim();
            expiry = parts[1] ? parts[1].trim() : "";
          } else {
            // If no pipe, treat the whole thing as expiry if it looks like a date
            if (/\d{4}\/\d{2}/.test(ref)) expiry = ref;
            else batch = ref;
          }

          items.push({
            stk_code: stkCode,
            stk_desc: stkDesc,
            batch: batch,
            expiry: expiry,
            qty: qty,
            loc_code: locCode
          });
        });

        onDone(null, items);
      } catch (err) {
        onDone(err, null);
      }
    };
    reader.onerror = function () { onDone(new Error("Failed to read file"), null); };
    reader.readAsArrayBuffer(file);
  }

  async function doUpload(items) {
    var batchSize = 500;
    var total = items.length;
    var done = 0;
    var statusEl = document.getElementById("se-upload-status");

    while (done < total) {
      var chunk = items.slice(done, done + batchSize);
      var isFirst = done === 0;
      if (statusEl) statusEl.textContent = "Uploading " + done + " / " + total + "...";
      try {
        await uploadBatch(chunk, isFirst);
        done += chunk.length;
      } catch (err) {
        if (statusEl) statusEl.textContent = "Error at row " + done + ": " + ((err && err.message) || "failed");
        return;
      }
    }
    if (statusEl) statusEl.textContent = "Upload complete: " + done + " items.";
    toast("Uploaded " + done + " items.");
    refresh();
  }

  /* ── styles ──────────────────────────────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById("se-styles")) return;
    var st = document.createElement("style");
    st.id = "se-styles";
    st.textContent =
      '.se-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}' +
      '.se-filter{flex:1;min-width:200px;font-size:13px;padding:8px 12px;}' +
      '.se-upload-area{margin-bottom:16px;padding:14px;border:2px dashed var(--border);border-radius:12px;text-align:center;background:rgba(255,255,255,.02);}' +
      '.se-upload-area input[type="file"]{display:none;}' +
      '.se-table-wrap{overflow-x:auto;max-height:calc(100vh - 200px);overflow-y:auto;}' +
      '.se-table{width:100%;border-collapse:collapse;font-size:12px;}' +
      '.se-table th{position:sticky;top:0;text-align:left;padding:8px 10px;background:var(--panel2);border-bottom:2px solid var(--border);font-weight:700;font-size:11px;color:var(--muted);z-index:2;}' +
      '.se-table td{padding:7px 10px;border-bottom:1px solid var(--border);}' +
      '.se-table tr:hover{background:rgba(255,255,255,.03);}' +
      '.se-expiry-warn{color:#ef4444;font-weight:700;}' +
      '.se-expiry-ok{color:var(--muted);}' +
      '.se-orders-row{background:rgba(90,162,255,.04);font-size:11px;color:var(--muted);}' +
      '.se-orders-row td{padding:4px 10px 4px 30px;border-bottom:1px solid var(--border);}' +
      '.se-order-loc{display:inline-block;margin-right:12px;}' +
      '.se-order-input{width:60px;font-size:12px;padding:4px 6px;text-align:center;}' +
      '.se-count{font-size:11px;color:var(--muted);}' +
      '.se-empty{padding:30px;color:var(--muted);font-size:13px;text-align:center;}' +
      '@media print{' +
      '  .eikon-sidebar,.eikon-topbar,.eikon-nav,.se-toolbar,.se-upload-area{display:none !important;}' +
      '  .eikon-main{margin:0 !important;padding:10px !important;}' +
      '  body{background:#fff !important;color:#000 !important;}' +
      '  .se-table th{background:#f0f0f0 !important;color:#000 !important;position:static !important;}' +
      '  .se-table td{color:#000 !important;border-color:#ccc !important;}' +
      '  .se-table-wrap{max-height:none !important;overflow:visible !important;}' +
      '  .se-orders-row{background:#f8f8ff !important;}' +
      '  .se-orders-row td{color:#333 !important;}' +
      '}';
    document.head.appendChild(st);
  }

  /* ── rendering ───────────────────────────────────────────────────────── */
  function expiryClass(exp) {
    if (!exp) return "se-expiry-ok";
    // Parse "2026/06" or "2026-06" to check if soon
    var parts = exp.replace(/\//g, "-").split("-");
    if (parts.length >= 2) {
      var expDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 28);
      var now = new Date();
      var diffMs = expDate - now;
      var diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
      if (diffMonths <= 3) return "se-expiry-warn";
    }
    return "se-expiry-ok";
  }

  function renderTable() {
    var items = S.items;
    if (!items.length) return '<div class="se-empty">' + (S.filterText ? 'No items match "' + esc(S.filterText) + '".' : 'No items uploaded yet.') + '</div>';

    var myLocId = S.user ? Number(S.user.location_id) : -1;
    var html = '<div class="se-table-wrap"><table class="se-table">';
    html += '<thead><tr><th>Code</th><th>Description</th><th>Batch</th><th>Expiry</th><th>WSL Qty</th>';
    if (!S.isAdmin) html += '<th>Order</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function (item) {
      var myOrder = null;
      (item.orders || []).forEach(function (o) {
        if (Number(o.location_id) === myLocId) myOrder = o;
      });

      html += '<tr>';
      html += '<td>' + esc(item.stk_code) + '</td>';
      html += '<td style="font-weight:600;">' + esc(item.stk_desc) + '</td>';
      html += '<td>' + esc(item.batch) + '</td>';
      html += '<td class="' + expiryClass(item.expiry) + '">' + esc(item.expiry) + '</td>';
      html += '<td style="text-align:center;font-weight:700;">' + item.qty + '</td>';

      if (!S.isAdmin) {
        if (myOrder) {
          html += '<td style="white-space:nowrap;">' +
            '<input class="eikon-input se-order-input" type="number" min="1" value="' + myOrder.quantity + '" data-item-id="' + item.id + '" data-action="update"/>' +
            ' <span class="se-order-remove" data-item-id="' + item.id + '" style="cursor:pointer;color:rgba(255,90,122,.7);font-size:14px;" title="Remove order">&#x2715;</span>' +
            '</td>';
        } else {
          html += '<td><button class="eikon-btn primary" data-item-id="' + item.id + '" data-action="order" style="font-size:11px;padding:4px 10px;">Order</button></td>';
        }
      }
      html += '</tr>';

      // Admin: show per-location orders under each item
      if (S.isAdmin && item.orders && item.orders.length) {
        html += '<tr class="se-orders-row"><td colspan="5" style="padding-left:30px;">';
        var totalOrdered = 0;
        item.orders.forEach(function (o) {
          totalOrdered += o.quantity;
          html += '<span class="se-order-loc"><b>' + esc(o.location_name) + '</b>: x' + o.quantity + '</span>';
        });
        html += '<span class="se-order-loc" style="font-weight:700;">Total ordered: x' + totalOrdered + '</span>';
        html += '</td></tr>';
      }
    });

    html += '</tbody></table></div>';
    return html;
  }

  function renderAll() {
    var mount = S.mount;
    if (!mount) return;
    var html = '';

    // Toolbar
    html += '<div class="se-toolbar">';
    if (S.isAdmin) {
      html += '<button class="eikon-btn primary" id="se-upload-btn" style="font-size:12px;padding:8px 14px;">Upload File</button>';
      html += '<button class="eikon-btn" id="se-print-btn" style="font-size:12px;padding:8px 14px;">Print Report</button>';
    }
    html += '<input class="eikon-input se-filter" id="se-filter" type="text" placeholder="Search by product, code, or batch..." value="' + esc(S.filterText) + '"/>';
    html += '<span class="se-count" id="se-count">' + S.items.length + ' items</span>';
    html += '<button class="eikon-btn" id="se-refresh" style="font-size:11px;padding:5px 10px;">Refresh</button>';
    html += '</div>';

    // Upload area (admin only, hidden by default)
    if (S.isAdmin) {
      html += '<div class="se-upload-area" id="se-upload-area" style="display:none;">' +
        '<div style="margin-bottom:8px;font-weight:700;">Upload CSV, XLS, or XLSX file</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Only rows with loc_code containing WSL will be imported. This replaces all existing data.</div>' +
        '<label class="eikon-btn primary" style="cursor:pointer;font-size:12px;padding:8px 14px;">' +
        'Choose File <input type="file" id="se-file-input" accept=".csv,.xls,.xlsx"/>' +
        '</label>' +
        '<div id="se-upload-status" style="margin-top:8px;font-size:12px;color:var(--muted);"></div>' +
        '</div>';
    }

    // Table
    html += renderTable();

    mount.innerHTML = html;
    wireEvents();
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  function wireEvents() {
    var refreshBtn = document.getElementById("se-refresh");
    var filterEl = document.getElementById("se-filter");
    var uploadBtn = document.getElementById("se-upload-btn");
    var uploadArea = document.getElementById("se-upload-area");
    var fileInput = document.getElementById("se-file-input");
    var printBtn = document.getElementById("se-print-btn");

    if (refreshBtn) refreshBtn.onclick = function () { refresh(); };
    if (printBtn) printBtn.onclick = function () { window.print(); };

    // Filter
    if (filterEl) {
      var filterT = null;
      filterEl.oninput = function () {
        clearTimeout(filterT);
        filterT = setTimeout(function () {
          S.filterText = filterEl.value;
          refresh();
        }, 300);
      };
    }

    // Upload toggle
    if (uploadBtn && uploadArea) {
      uploadBtn.onclick = function () {
        uploadArea.style.display = uploadArea.style.display === "none" ? "" : "none";
      };
    }

    // File input
    if (fileInput) {
      fileInput.onchange = function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var statusEl = document.getElementById("se-upload-status");
        if (statusEl) statusEl.textContent = "Parsing file...";
        parseFile(file, function (err, items) {
          if (err) {
            if (statusEl) statusEl.textContent = "Parse error: " + ((err && err.message) || "failed");
            return;
          }
          if (!items || !items.length) {
            if (statusEl) statusEl.textContent = "No valid rows found (filtered to WSL/DEP loc_code).";
            return;
          }
          if (statusEl) statusEl.textContent = "Parsed " + items.length + " rows. Uploading...";
          doUpload(items);
        });
      };
    }

    // Order buttons (pharmacy)
    if (!S.isAdmin) {
      S.mount.querySelectorAll("[data-action='order']").forEach(function (btn) {
        btn.onclick = function () {
          var itemId = btn.getAttribute("data-item-id");
          placeOrder(itemId, 1).then(function () { toast("Ordered."); refresh(); })
            .catch(function (err) { toast((err && err.message) || "Failed", "error"); });
        };
      });

      S.mount.querySelectorAll("[data-action='update']").forEach(function (inp) {
        var debounce = null;
        inp.onchange = function () {
          clearTimeout(debounce);
          var itemId = inp.getAttribute("data-item-id");
          var qty = parseInt(inp.value) || 1;
          debounce = setTimeout(function () {
            placeOrder(itemId, qty).then(function () { toast("Updated."); })
              .catch(function (err) { toast((err && err.message) || "Failed", "error"); });
          }, 300);
        };
      });

      S.mount.querySelectorAll(".se-order-remove").forEach(function (btn) {
        btn.onclick = function () {
          var itemId = btn.getAttribute("data-item-id");
          removeOrder(itemId).then(function () { toast("Order removed."); refresh(); })
            .catch(function (err) { toast((err && err.message) || "Failed", "error"); });
        };
      });
    }
  }

  function toast(msg, type) {
    if (E.toast) E.toast(msg, type);
  }

  function refresh() {
    loadItems().then(function () { renderAll(); });
  }

  /* ── auto-refresh ────────────────────────────────────────────────────── */
  var _autoRefreshTimer = null;
  function startAutoRefresh() {
    stopAutoRefresh();
    _autoRefreshTimer = setInterval(function () {
      if (S.mount && E.state.activeModuleId === "cherubino-shortexpiry") refresh();
      else stopAutoRefresh();
    }, 5 * 60 * 1000);
  }
  function stopAutoRefresh() {
    if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  }

  /* ── main render ─────────────────────────────────────────────────────── */
  async function render(ctx) {
    S.mount = ctx.mount;
    S.user = ctx.user;
    S.isAdmin = S.user && Number(S.user.location_id) >= 600;
    S.filterText = "";
    ensureStyles();
    S.mount.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading...</div>';
    await loadItems();
    renderAll();
    startAutoRefresh();
  }

  /* ── register ────────────────────────────────────────────────────────── */
  E.registerModule({
    id: "cherubino-shortexpiry",
    title: "Warehouse Short Expiry",
    order: 902,
    icon: "\uD83C\uDFE5",
    render: render,
    destroy: function () { stopAutoRefresh(); S.mount = null; }
  });

})();
