/* ui/modules.supplier-products.js
   Eikon - Supplier Products module (UI) — file upload, table, inline edit, out-of-stock

   Endpoints (Worker):
     GET    /supplier-products/entries           → list supplier's products
     POST   /supplier-products/entries           → create product
     PUT    /supplier-products/entries/:id        → update product
     DELETE /supplier-products/entries/:id        → delete product
     POST   /supplier-products/bulk-import       → bulk import (full replace)
     PUT    /supplier-products/entries/:id/stock-status → toggle out-of-stock
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.supplier-products.js)");

  var LP = "[EIKON][supplier-products]";
  function log() { try { console.log.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }
  function warn() { try { console.warn.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }

  // ─── Tiny utilities ───────────────────────────────────────────────────────
  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fmt2(n) { return round2(n).toFixed(2); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }

  // ─── Calculations (same as quotations) ──────────────────────────────────
  function recalcItem(f) {
    var vat = Number(f.vat_rate);
    if (vat !== 0 && vat !== 5 && vat !== 18) vat = 18;
    var mult = 1 + vat / 100;
    var excl = Math.max(0, Number(f.cost_excl_vat) || 0);
    var incl = Math.max(0, Number(f.cost_incl_vat) || 0);
    var discPct = Math.max(0, Number(f.discount_pct) || 0);
    var discEuro = Math.max(0, Number(f.discount_euro) || 0);
    var qty = Math.max(1, Math.round(Number(f.qty_purchased) || 1));
    var free = Math.max(0, Math.round(Number(f.qty_free) || 0));
    var retail = Math.max(0, Number(f.retail_price) || 0);
    var le = f._lastEdited || "";

    if (le === "total_incl") {
      var tiv = Math.max(0, Number(f.total_incl_vat) || 0);
      var effInclUnit = qty > 0 ? tiv / qty : 0;
      var effExclUnit = vat === 0 ? effInclUnit : (mult > 0 ? round2(effInclUnit / mult) : 0);
      excl = round2(effExclUnit + discEuro);
      incl = vat === 0 ? excl : round2(excl * mult);
      discPct = excl > 0 ? round2(discEuro / excl * 100) : 0;
    } else if (vat === 0) {
      if (le === "cost_excl" || le === "vat") incl = excl;
      else excl = incl;
    } else {
      if (le === "cost_excl" || le === "vat") incl = round2(excl * mult);
      else excl = round2(incl / mult);
    }

    if (le === "discount_pct") {
      discEuro = excl > 0 ? round2(excl * discPct / 100) : 0;
    } else if (le === "discount_euro") {
      discPct = excl > 0 ? round2(discEuro / excl * 100) : 0;
    }
    if (discEuro > excl) { discEuro = excl; discPct = 100; }
    if (discPct > 100) { discPct = 100; discEuro = excl; }

    var effExcl = Math.max(0, excl - discEuro);
    var effIncl = vat === 0 ? effExcl : round2(effExcl * mult);
    var totalInclVat = round2(effIncl * qty);
    var totalRetail = round2(retail * (qty + free));
    var profit = round2(totalRetail - effExcl * qty);
    var margin = totalRetail > 0 ? round2(profit / totalRetail * 100) : 0;

    return {
      cost_excl_vat: round2(excl), cost_incl_vat: round2(incl),
      discount_pct: round2(discPct), discount_euro: round2(discEuro),
      total_incl_vat: totalInclVat, profit: profit, profit_margin: margin
    };
  }

  function profitMarginColor(pct) {
    var p = Number(pct) || 0;
    if (!isFinite(p) || p <= 0) return "#ff5a7a";
    if (p >= 35) return "#43d17a";
    if (p <= 20) return "#ff5a7a";
    return "hsl(" + Math.round((p - 20) / 15 * 120) + ",88%,52%)";
  }
  function profitMarginLabel(pct) {
    var p = Number(pct) || 0;
    return p >= 35 ? "Good" : p >= 20 ? "OK" : "Poor";
  }

  // ─── State ──────────────────────────────────────────────────────────────
  var state = {
    products: [],
    filtered: [],
    sort: { key: "description", dir: "asc" },
    queries: { keyword: "" },
    selectedIds: {},
    loading: false,
    view: "table", // "table" | "upload" | "preview"
    previewRows: null,
    previewErrors: [],
    _user: null,
    _mount: null
  };

  // ─── API ────────────────────────────────────────────────────────────────
  function apiList() {
    return E.apiFetch("/supplier-products/entries", { method: "GET" });
  }
  function apiCreate(payload) {
    return E.apiFetch("/supplier-products/entries", { method: "POST", body: JSON.stringify(payload) });
  }
  function apiUpdate(id, payload) {
    return E.apiFetch("/supplier-products/entries/" + id, { method: "PUT", body: JSON.stringify(payload) });
  }
  function apiDelete(id) {
    return E.apiFetch("/supplier-products/entries/" + id, { method: "DELETE" });
  }
  function apiBulkImport(rows) {
    return E.apiFetch("/supplier-products/bulk-import", {
      method: "POST",
      body: JSON.stringify({ rows: rows })
    });
  }
  function apiToggleStock(id, outOfStock) {
    return E.apiFetch("/supplier-products/entries/" + id + "/stock-status", {
      method: "PUT", body: JSON.stringify({ out_of_stock: outOfStock })
    });
  }

  // ─── Toast ──────────────────────────────────────────────────────────────
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

  // ─── File Parsing ───────────────────────────────────────────────────────
  var EXPECTED_HEADERS = {
    "stock code":        "stock_code",
    "stockcode":         "stock_code",
    "barcode":           "barcode",
    "description":       "description",
    "cost excl vat":     "cost_excl_vat",
    "cost excl":         "cost_excl_vat",
    "costexclvat":       "cost_excl_vat",
    "cost incl vat":     "cost_incl_vat",
    "cost incl":         "cost_incl_vat",
    "costinclvat":       "cost_incl_vat",
    "vat":               "vat_rate",
    "vat rate":          "vat_rate",
    "vat %":             "vat_rate",
    "discount (%)":      "discount_pct",
    "discount %":        "discount_pct",
    "disc%":             "discount_pct",
    "discount pct":      "discount_pct",
    "discount (\u20ac)": "discount_euro",
    "discount \u20ac":   "discount_euro",
    "disc\u20ac":        "discount_euro",
    "discount euro":     "discount_euro",
    "quantity purchased": "qty_purchased",
    "qty purchased":     "qty_purchased",
    "qty":               "qty_purchased",
    "quantity":          "qty_purchased",
    "quantity free":     "qty_free",
    "qty free":          "qty_free",
    "free":              "qty_free",
    "batch":             "batch",
    "batch no":          "batch",
    "batch number":      "batch",
    "expiry date":       "expiry_date",
    "expiry":            "expiry_date",
    "exp date":          "expiry_date",
    "retail price":      "retail_price",
    "retail":            "retail_price",
    "rrp":               "retail_price"
  };

  function mapHeaders(headerRow) {
    var mapping = {};
    for (var i = 0; i < headerRow.length; i++) {
      var raw = norm(headerRow[i]).replace(/[^a-z0-9\u20ac%\s]/g, "").trim();
      if (EXPECTED_HEADERS[raw]) {
        mapping[i] = EXPECTED_HEADERS[raw];
      }
    }
    return mapping;
  }

  function parseFile(file, cb) {
    if (!window.XLSX) {
      cb(null, "SheetJS library not loaded. Please reload the page.");
      return;
    }

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var jsonRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (jsonRows.length < 2) { cb(null, "File has no data rows."); return; }

        // First row is headers
        var headerCells = jsonRows[0].map(function (c) { return String(c); });
        var colMap = mapHeaders(headerCells);

        // Check compulsory headers are mapped
        var mappedFields = {};
        for (var k in colMap) { if (Object.prototype.hasOwnProperty.call(colMap, k)) mappedFields[colMap[k]] = true; }
        var missing = [];
        if (!mappedFields.description) missing.push("Description");
        if (!mappedFields.cost_excl_vat) missing.push("Cost Excl Vat");
        if (!mappedFields.vat_rate) missing.push("VAT");
        if (!mappedFields.retail_price) missing.push("Retail Price");
        if (missing.length) {
          cb(null, "Could not find required columns: " + missing.join(", ") +
            ". Found headers: " + headerCells.join(", "));
          return;
        }

        var rows = [];
        var errors = [];
        var advisoryNeeded = false;

        for (var r = 1; r < jsonRows.length; r++) {
          var raw = jsonRows[r];
          if (!raw || !raw.length) continue;

          var obj = {};
          for (var ci in colMap) {
            if (Object.prototype.hasOwnProperty.call(colMap, ci)) {
              obj[colMap[ci]] = raw[ci] !== undefined ? raw[ci] : "";
            }
          }

          // Required field validation
          var desc = String(obj.description || "").trim();
          if (!desc) { errors.push("Row " + r + ": Description is empty"); continue; }
          var costExcl = Number(obj.cost_excl_vat) || 0;
          if (costExcl <= 0) { errors.push("Row " + r + ": Cost Excl Vat is missing or zero"); continue; }
          var vatRate = Number(obj.vat_rate) || 0;
          if (vatRate !== 0 && vatRate !== 5 && vatRate !== 18) vatRate = 18;
          var retailPrice = Number(obj.retail_price) || 0;
          if (retailPrice <= 0) { errors.push("Row " + r + ": Retail Price is missing or zero"); continue; }

          // Auto-calculations
          var costInclVat = Number(obj.cost_incl_vat) || 0;
          if (!costInclVat) costInclVat = round2(costExcl * (1 + vatRate / 100));

          var discPct = Number(obj.discount_pct) || 0;
          var discEuro = Number(obj.discount_euro) || 0;
          if (!discPct && !discEuro) {
            discPct = 0; discEuro = 0;
          } else if (discPct && !discEuro) {
            discEuro = round2(costExcl * discPct / 100);
          } else if (!discPct && discEuro) {
            discPct = costExcl > 0 ? round2(discEuro / costExcl * 100) : 0;
          }

          var qtyPurchased = Math.round(Number(obj.qty_purchased) || 0);
          var qtyFree = Math.round(Number(obj.qty_free) || 0);
          if (!qtyPurchased && !qtyFree) {
            qtyPurchased = 1; qtyFree = 0;
          } else if (qtyPurchased && !qtyFree) {
            qtyFree = 0;
          } else if (!qtyPurchased) {
            qtyPurchased = 1;
          }

          var batch = String(obj.batch || "").trim();
          var expiryDate = String(obj.expiry_date || "").trim();
          var stockCode = String(obj.stock_code || "").trim();
          var barcode = String(obj.barcode || "").trim();

          if (!barcode || !batch || !expiryDate) advisoryNeeded = true;

          var rowData = {
            stock_code: stockCode, barcode: barcode, description: desc,
            cost_excl_vat: costExcl, cost_incl_vat: costInclVat, vat_rate: vatRate,
            discount_pct: discPct, discount_euro: discEuro,
            qty_purchased: qtyPurchased, qty_free: qtyFree,
            batch: batch, expiry_date: expiryDate,
            retail_price: retailPrice
          };

          var calc = recalcItem(rowData);
          rowData.cost_excl_vat = calc.cost_excl_vat;
          rowData.cost_incl_vat = calc.cost_incl_vat;
          rowData.discount_pct = calc.discount_pct;
          rowData.discount_euro = calc.discount_euro;
          rowData.total_incl_vat = calc.total_incl_vat;
          rowData.profit = calc.profit;
          rowData.profit_margin = calc.profit_margin;

          rows.push(rowData);
        }

        cb({ rows: rows, errors: errors, advisoryNeeded: advisoryNeeded });
      } catch (ex) {
        warn("Parse error", ex);
        cb(null, "Failed to parse file: " + (ex.message || ex));
      }
    };
    reader.onerror = function () { cb(null, "Failed to read file."); };
    reader.readAsArrayBuffer(file);
  }

  // ─── Sort helper ────────────────────────────────────────────────────────
  function getSortVal(row, key) {
    var v = row[key];
    if (key === "qty_purchased" || key === "qty_free" || key === "vat_rate" ||
        key === "cost_excl_vat" || key === "cost_incl_vat" ||
        key === "discount_pct" || key === "discount_euro" ||
        key === "total_incl_vat" || key === "retail_price" ||
        key === "profit" || key === "profit_margin") {
      return Number(v) || 0;
    }
    if (key === "out_of_stock") return v ? 1 : 0;
    return norm(v);
  }

  function applyFilter() {
    var kw = norm(state.queries.keyword);
    state.filtered = state.products.filter(function (r) {
      if (kw) {
        return norm(r.description).includes(kw) ||
               norm(r.barcode).includes(kw) ||
               norm(r.stock_code).includes(kw) ||
               norm(r.batch).includes(kw);
      }
      return true;
    });
    // Sort
    var sk = state.sort.key;
    var sd = state.sort.dir === "asc" ? 1 : -1;
    if (sk) {
      state.filtered.sort(function (a, b) {
        var va = getSortVal(a, sk), vb = getSortVal(b, sk);
        if (va < vb) return -sd;
        if (va > vb) return sd;
        return 0;
      });
    }
  }

  // ─── Table Columns ──────────────────────────────────────────────────────
  var COLUMNS = [
    { key: "stock_code",    label: "Stock Code",  type: "text",   w: "80px" },
    { key: "barcode",       label: "Barcode",     type: "text",   w: "100px" },
    { key: "description",   label: "Description", type: "text",   w: "200px" },
    { key: "cost_excl_vat", label: "Cost Excl",   type: "number", w: "80px", num: true },
    { key: "cost_incl_vat", label: "Cost Incl",   type: "number", w: "80px", num: true },
    { key: "vat_rate",      label: "VAT%",        type: "vat",    w: "56px", num: true },
    { key: "discount_pct",  label: "Disc%",       type: "number", w: "60px", num: true },
    { key: "discount_euro", label: "Disc\u20ac",  type: "number", w: "60px", num: true },
    { key: "qty_purchased", label: "Qty",         type: "int",    w: "48px", num: true },
    { key: "qty_free",      label: "Free",        type: "int",    w: "48px", num: true },
    { key: "batch",         label: "Batch",       type: "text",   w: "80px" },
    { key: "expiry_date",   label: "Expiry",      type: "text",   w: "90px" },
    { key: "retail_price",  label: "Retail",      type: "number", w: "72px", num: true },
    { key: "profit",        label: "Profit",      type: "ro",     w: "72px", num: true },
    { key: "profit_margin", label: "Margin%",     type: "margin", w: "100px", num: true },
    { key: "out_of_stock",  label: "Status",      type: "stock",  w: "100px" }
  ];

  // ─── Render Helpers ─────────────────────────────────────────────────────

  // ─── Download Template ──────────────────────────────────────────────────
  var TEMPLATE_HEADERS = [
    "Stock Code", "Barcode", "Description", "Cost Excl Vat", "Cost Incl Vat",
    "VAT", "Discount (%)", "Discount (\u20ac)", "Quantity Purchased",
    "Quantity Free", "Batch", "Expiry Date", "Retail Price"
  ];

  function downloadTemplate(format) {
    try {
      if (format === "csv") {
        // Generate CSV natively — no SheetJS dependency
        var csvLine = TEMPLATE_HEADERS.map(function (h) {
          return '"' + h.replace(/"/g, '""') + '"';
        }).join(",") + "\n";
        var blob = new Blob([csvLine], { type: "text/csv;charset=utf-8;" });
        triggerDownload(blob, "product-template.csv");
      } else {
        // XLSX via SheetJS (requires full build; mini doesn't support XLSX write)
        if (!window.XLSX) { toast("bad", "Error", "SheetJS library not loaded. Please reload the page."); return; }
        var ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
        ws["!cols"] = TEMPLATE_HEADERS.map(function (h) { return { wch: Math.max(h.length + 2, 14) }; });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Products");
        XLSX.writeFile(wb, "product-template.xlsx");
      }
    } catch (ex) {
      warn("Template download failed", ex);
      // Fallback: download CSV if XLSX fails
      if (format !== "csv") {
        toast("warn", "Notice", "XLSX not supported — downloading CSV instead");
        downloadTemplate("csv");
      } else {
        toast("bad", "Error", "Template download failed: " + (ex.message || ex));
      }
    }
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function renderToolbar(mount) {
    return "<div class='sp-toolbar'>" +
      "<div class='sp-toolbar-left'>" +
        "<input type='text' id='sp-search' class='eikon-input' placeholder='Search products\u2026' " +
          "value='" + esc(state.queries.keyword) + "' style='width:240px;'>" +
      "</div>" +
      "<div class='sp-toolbar-right'>" +
        "<button class='eikon-btn' id='sp-btn-template-csv' title='Download CSV template'>Download Template</button>" +
        "<button class='eikon-btn' id='sp-btn-template-xlsx' title='Download XLSX template' style='opacity:.7;font-size:11px;'>XLSX</button>" +
        "<button class='eikon-btn' id='sp-btn-add'>+ Add Product</button>" +
        "<button class='eikon-btn' id='sp-btn-import'>Import File</button>" +
      "</div>" +
    "</div>";
  }

  function renderUploadArea() {
    return "<div class='sp-upload-area' id='sp-upload-area'>" +
      "<div class='sp-upload-zone' id='sp-upload-zone'>" +
        "<div style='font-size:36px;margin-bottom:12px;'>📂</div>" +
        "<div style='font-weight:700;font-size:15px;margin-bottom:6px;'>Drop your file here or click to browse</div>" +
        "<div style='color:var(--muted);font-size:12px;'>Accepts .csv, .xls, .xlsx</div>" +
        "<input type='file' id='sp-file-input' accept='.csv,.xls,.xlsx' style='display:none;'>" +
      "</div>" +
      "<div style='margin-top:8px;'>" +
        "<button class='eikon-btn' id='sp-upload-cancel' style='opacity:.65;'>Cancel</button>" +
      "</div>" +
    "</div>";
  }

  function renderPreviewTable(rows, errors) {
    var html = "<div class='sp-preview-section'>" +
      "<h3 style='margin:0 0 8px;font-size:15px;'>Review Before Uploading</h3>" +
      "<div style='color:var(--muted);font-size:12px;margin-bottom:10px;'>Review and edit the parsed data. Fix any mistakes, then click <b>Confirm &amp; Upload</b>.</div>";

    if (state._advisoryNeeded) {
      html += "<div class='sp-advisory'>" +
        "We recommend filling in <b>barcodes</b>, <b>batch numbers</b>, and <b>expiry dates</b> for better traceability." +
      "</div>";
    }

    if (errors.length) {
      html += "<div class='sp-errors'>" +
        "<b>Skipped rows:</b><br>" + errors.map(function (e) { return esc(e); }).join("<br>") +
      "</div>";
    }

    if (!rows.length) {
      html += "<div style='padding:12px;'>No valid rows. Check your file and try again.</div>" +
        "<button class='eikon-btn' id='sp-pv-cancel'>Back</button></div>";
      return html;
    }

    html += "<div class='sp-preview-table-wrap'><table class='sp-preview-table'><thead><tr><th></th>";
    var pvCols = ["stock_code","barcode","description","cost_excl_vat","cost_incl_vat","vat_rate",
      "discount_pct","discount_euro","qty_purchased","qty_free","batch","expiry_date","retail_price","profit","profit_margin"];
    var pvLabels = { stock_code:"Stock Code", barcode:"Barcode", description:"Description",
      cost_excl_vat:"Cost Excl", cost_incl_vat:"Cost Incl", vat_rate:"VAT%",
      discount_pct:"Disc%", discount_euro:"Disc\u20ac", qty_purchased:"Qty", qty_free:"Free",
      batch:"Batch", expiry_date:"Expiry", retail_price:"Retail", profit:"Profit", profit_margin:"Margin%" };
    pvCols.forEach(function (c) { html += "<th>" + pvLabels[c] + "</th>"; });
    html += "</tr></thead><tbody>";

    rows.forEach(function (row, ri) {
      var mc = profitMarginColor(row.profit_margin);
      var pid = "sp-pv-" + ri + "-";

      function inp(field, type, w, rawVal) {
        var v = rawVal !== undefined ? rawVal : String(row[field] !== undefined ? row[field] : "");
        return "<input id='" + pid + field + "' class='sp-pv-input' type='" + type + "'" +
          " style='width:" + w + ";' data-ri='" + ri + "' data-field='" + field + "' value='" + esc(v) + "'>";
      }

      function vatSel(field) {
        var v = Number(row[field]) || 0;
        return "<select id='" + pid + field + "' class='sp-pv-input' style='width:56px;'" +
          " data-ri='" + ri + "' data-field='" + field + "'>" +
          "<option value='0'" + (v === 0 ? " selected" : "") + ">0%</option>" +
          "<option value='5'" + (v === 5 ? " selected" : "") + ">5%</option>" +
          "<option value='18'" + (v === 18 ? " selected" : "") + ">18%</option>" +
          "</select>";
      }

      html += "<tr data-ri='" + ri + "'>" +
        "<td><button class='sp-pv-del' data-del-ri='" + ri + "' title='Delete row'>\u2715</button></td>" +
        "<td>" + inp("stock_code", "text", "76px") + "</td>" +
        "<td>" + inp("barcode", "text", "86px") + "</td>" +
        "<td>" + inp("description", "text", "154px") + "</td>" +
        "<td>" + inp("cost_excl_vat", "number", "72px", fmt2(row.cost_excl_vat)) + "</td>" +
        "<td>" + inp("cost_incl_vat", "number", "72px", fmt2(row.cost_incl_vat)) + "</td>" +
        "<td>" + vatSel("vat_rate") + "</td>" +
        "<td>" + inp("discount_pct", "number", "54px", fmt2(row.discount_pct)) + "</td>" +
        "<td>" + inp("discount_euro", "number", "54px", fmt2(row.discount_euro)) + "</td>" +
        "<td>" + inp("qty_purchased", "number", "48px") + "</td>" +
        "<td>" + inp("qty_free", "number", "44px") + "</td>" +
        "<td>" + inp("batch", "text", "76px") + "</td>" +
        "<td>" + inp("expiry_date", "text", "86px") + "</td>" +
        "<td>" + inp("retail_price", "number", "64px", fmt2(row.retail_price)) + "</td>" +
        "<td><span id='" + pid + "profit' class='sp-pv-ro'>\u20ac" + fmt2(row.profit) + "</span></td>" +
        "<td><span id='" + pid + "profit_margin' class='sp-pv-ro' style='color:" + mc + ";'>" +
          fmt2(row.profit_margin) + "% (" + profitMarginLabel(row.profit_margin) + ")</span></td>" +
      "</tr>";
    });

    html += "</tbody></table></div>" +
      "<div class='sp-preview-footer'>" +
        "<button class='eikon-btn' id='sp-pv-add-row'>+ Add Row</button>" +
        "<button class='eikon-btn sp-btn-primary' id='sp-pv-confirm'>Confirm &amp; Upload (" + rows.length + " row" + (rows.length !== 1 ? "s" : "") + ")</button>" +
        "<button class='eikon-btn' id='sp-pv-cancel' style='opacity:.65;'>Cancel</button>" +
        "<div id='sp-pv-status' style='flex:1;'></div>" +
      "</div></div>";

    return html;
  }

  function renderProductTable() {
    var rows = state.filtered;
    if (!rows.length) {
      return "<div class='sp-empty'>" +
        "<div style='font-size:36px;margin-bottom:12px;'>📦</div>" +
        "<div style='font-weight:700;'>No products yet</div>" +
        "<div style='color:var(--muted);margin-top:4px;'>Upload a file or add products manually to get started.</div>" +
      "</div>";
    }

    var sk = state.sort.key;
    var sd = state.sort.dir;

    var html = "<div class='sp-table-wrap'><table class='sp-table'><thead><tr>";
    COLUMNS.forEach(function (col) {
      var active = sk === col.key;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      html += "<th class='" + (col.num ? "num" : "") + "' data-sort-key='" + col.key + "' style='cursor:pointer;'>" +
        esc(col.label) + arrow + "</th>";
    });
    html += "</tr></thead><tbody>";

    rows.forEach(function (row) {
      var oos = row.out_of_stock ? 1 : 0;
      var rowStyle = oos ? "opacity:0.5;" : "";
      html += "<tr data-id='" + row.id + "' style='" + rowStyle + "'>";

      COLUMNS.forEach(function (col) {
        if (col.type === "margin") {
          var mc = profitMarginColor(row.profit_margin);
          html += "<td class='num'><span class='sp-margin-cell' style='background:" + mc + "22;color:" + mc + ";'>" +
            fmt2(row.profit_margin) + "% (" + profitMarginLabel(row.profit_margin) + ")</span></td>";
        } else if (col.type === "ro") {
          html += "<td class='num'>\u20ac" + fmt2(row[col.key]) + "</td>";
        } else if (col.type === "stock") {
          var label = oos ? "Out of Stock" : "In Stock";
          var btnClass = oos ? "sp-stock-btn sp-stock-oos" : "sp-stock-btn sp-stock-in";
          html += "<td><button class='" + btnClass + "' data-stock-id='" + row.id + "' data-stock-val='" + (oos ? "0" : "1") + "'>" + label + "</button></td>";
        } else if (col.type === "vat") {
          html += "<td class='num'>" + (Number(row.vat_rate) || 0) + "%</td>";
        } else if (col.type === "number") {
          html += "<td class='num' data-edit-id='" + row.id + "' data-edit-field='" + col.key + "'>" +
            "\u20ac" + fmt2(row[col.key]) + "</td>";
        } else if (col.type === "int") {
          html += "<td class='num' data-edit-id='" + row.id + "' data-edit-field='" + col.key + "'>" +
            (Number(row[col.key]) || 0) + "</td>";
        } else {
          html += "<td data-edit-id='" + row.id + "' data-edit-field='" + col.key + "'>" + esc(row[col.key] || "") + "</td>";
        }
      });

      html += "<td><button class='sp-del-btn' data-del-id='" + row.id + "' title='Delete'>\u2715</button></td>";
      html += "</tr>";
    });

    html += "</tbody></table></div>";
    html += "<div class='sp-table-footer'>" + rows.length + " product" + (rows.length !== 1 ? "s" : "") + "</div>";
    return html;
  }

  // ─── Main render ────────────────────────────────────────────────────────
  function renderAll(mount) {
    var content = mount.querySelector("#sp-content");
    if (!content) return;

    if (state.view === "upload") {
      content.innerHTML = renderUploadArea();
      wireUpload(mount);
      return;
    }

    if (state.view === "preview") {
      content.innerHTML = renderPreviewTable(state.previewRows || [], state.previewErrors || []);
      wirePreview(mount);
      return;
    }

    // Default: table view
    content.innerHTML = renderToolbar(mount) + renderProductTable();
    wireTable(mount);
  }

  // ─── Wire: Upload ──────────────────────────────────────────────────────
  function wireUpload(mount) {
    var zone = mount.querySelector("#sp-upload-zone");
    var fileInput = mount.querySelector("#sp-file-input");
    var cancelBtn = mount.querySelector("#sp-upload-cancel");

    if (zone) {
      zone.addEventListener("click", function () { if (fileInput) fileInput.click(); });
      zone.addEventListener("dragover", function (e) { e.preventDefault(); zone.classList.add("sp-drag-over"); });
      zone.addEventListener("dragleave", function () { zone.classList.remove("sp-drag-over"); });
      zone.addEventListener("drop", function (e) {
        e.preventDefault(); zone.classList.remove("sp-drag-over");
        var files = e.dataTransfer.files;
        if (files.length) handleFile(files[0], mount);
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        if (fileInput.files.length) handleFile(fileInput.files[0], mount);
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        state.view = "table";
        renderAll(mount);
      });
    }
  }

  function handleFile(file, mount) {
    var zone = mount.querySelector("#sp-upload-zone");
    if (zone) zone.innerHTML = "<div style='padding:20px;'>Parsing file\u2026</div>";

    parseFile(file, function (result, error) {
      if (error) {
        toast("bad", "Parse Error", error);
        state.view = "table";
        renderAll(mount);
        return;
      }

      state.previewRows = result.rows;
      state.previewErrors = result.errors;
      state._advisoryNeeded = result.advisoryNeeded;
      state.view = "preview";
      renderAll(mount);
    });
  }

  // ─── Wire: Preview ─────────────────────────────────────────────────────
  function wirePreview(mount) {
    var wrap = mount.querySelector("#sp-content");
    if (!wrap) return;

    // Input/change → recalculate row
    function handleFieldChange(e) {
      var el = e.target;
      var riStr = el.getAttribute("data-ri");
      var field = el.getAttribute("data-field");
      if (riStr === null || !field || !state.previewRows) return;
      var ri = Number(riStr);
      var row = state.previewRows[ri];
      if (!row) return;

      var val = el.value;
      if (field === "qty_purchased") { row[field] = Math.max(1, parseInt(val, 10) || 1); }
      else if (field === "qty_free") { row[field] = Math.max(0, parseInt(val, 10) || 0); }
      else if (field === "vat_rate" || field === "cost_excl_vat" || field === "cost_incl_vat" ||
               field === "discount_pct" || field === "discount_euro" ||
               field === "total_incl_vat" || field === "retail_price") {
        row[field] = Number(val) || 0;
      } else {
        row[field] = val || "";
      }

      var leMap = {
        cost_excl_vat: "cost_excl", cost_incl_vat: "cost_incl",
        discount_pct: "discount_pct", discount_euro: "discount_euro",
        vat_rate: "vat", qty_purchased: "qty", qty_free: "qty",
        retail_price: "retail", total_incl_vat: "total_incl"
      };
      var le = leMap[field] || "cost_excl";

      var calc = recalcItem({
        vat_rate: row.vat_rate, cost_excl_vat: row.cost_excl_vat, cost_incl_vat: row.cost_incl_vat,
        discount_pct: row.discount_pct, discount_euro: row.discount_euro,
        qty_purchased: row.qty_purchased, qty_free: row.qty_free,
        retail_price: row.retail_price, total_incl_vat: row.total_incl_vat, _lastEdited: le
      });
      for (var k in calc) { if (Object.prototype.hasOwnProperty.call(calc, k)) row[k] = calc[k]; }

      var pid = "sp-pv-" + ri + "-";
      var activeId = document.activeElement ? document.activeElement.id : "";

      function setCell(f, displayVal) {
        var eid = pid + f;
        if (activeId === eid) return;
        var cel = document.getElementById(eid);
        if (!cel) return;
        if (cel.tagName === "INPUT" || cel.tagName === "SELECT") cel.value = displayVal;
        else cel.textContent = displayVal;
      }

      setCell("cost_excl_vat", fmt2(row.cost_excl_vat));
      setCell("cost_incl_vat", fmt2(row.cost_incl_vat));
      setCell("discount_pct", fmt2(row.discount_pct));
      setCell("discount_euro", fmt2(row.discount_euro));

      var profitEl = document.getElementById(pid + "profit");
      var marginEl = document.getElementById(pid + "profit_margin");
      if (profitEl) profitEl.textContent = "\u20ac" + fmt2(row.profit);
      if (marginEl) {
        var mc2 = profitMarginColor(row.profit_margin);
        marginEl.style.color = mc2;
        marginEl.textContent = fmt2(row.profit_margin) + "% (" + profitMarginLabel(row.profit_margin) + ")";
      }
    }

    wrap.addEventListener("input", handleFieldChange);
    wrap.addEventListener("change", handleFieldChange);

    wrap.addEventListener("click", function (e) {
      var btn = e.target;

      if (btn.hasAttribute("data-del-ri")) {
        var ri = Number(btn.getAttribute("data-del-ri"));
        if (state.previewRows) { state.previewRows.splice(ri, 1); renderAll(mount); }
        return;
      }

      if (btn.id === "sp-pv-add-row") {
        if (!state.previewRows) state.previewRows = [];
        state.previewRows.push({
          stock_code: "", barcode: "", description: "", cost_excl_vat: 0, cost_incl_vat: 0,
          vat_rate: 18, discount_pct: 0, discount_euro: 0, qty_purchased: 1, qty_free: 0,
          batch: "", expiry_date: "", retail_price: 0, profit: 0, profit_margin: 0
        });
        renderAll(mount);
        return;
      }

      if (btn.id === "sp-pv-confirm") {
        var rows = state.previewRows || [];

        var errs = [];
        rows.forEach(function (r, i) {
          if (!String(r.description || "").trim()) errs.push("Row " + (i + 1) + ": Description is required");
          if ((Number(r.cost_excl_vat) || 0) <= 0) errs.push("Row " + (i + 1) + ": Cost Excl Vat is required");
          if ((Number(r.retail_price) || 0) <= 0) errs.push("Row " + (i + 1) + ": Retail Price is required");
        });
        if (errs.length) {
          var statusEl = wrap.querySelector("#sp-pv-status");
          if (statusEl) statusEl.innerHTML = "<div style='color:#ff5a7a;'>" + errs.map(function (e) { return esc(e); }).join("<br>") + "</div>";
          return;
        }

        btn.disabled = true;
        btn.textContent = "Uploading\u2026";
        apiBulkImport(rows)
          .then(function (resp) {
            toast("good", "Import Complete", resp.imported + " products imported" + (resp.changes ? ", " + resp.changes + " stock changes logged" : ""));
            state.previewRows = null;
            state.previewErrors = [];
            state.view = "table";
            return refreshData(mount);
          })
          .catch(function (err) {
            toast("bad", "Import Failed", err.message || "Unknown error");
            btn.disabled = false;
            btn.textContent = "Confirm & Upload";
          });
        return;
      }

      if (btn.id === "sp-pv-cancel") {
        state.previewRows = null;
        state.previewErrors = [];
        state.view = "table";
        renderAll(mount);
        return;
      }
    });
  }

  // ─── Wire: Product Table ───────────────────────────────────────────────
  function wireTable(mount) {
    // Search
    var searchInput = mount.querySelector("#sp-search");
    if (searchInput) {
      var debounce = null;
      searchInput.addEventListener("input", function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () {
          state.queries.keyword = searchInput.value;
          applyFilter();
          renderAll(mount);
        }, 200);
      });
    }

    // Download template buttons
    var tmplXlsx = mount.querySelector("#sp-btn-template-xlsx");
    if (tmplXlsx) { tmplXlsx.addEventListener("click", function () { downloadTemplate("xlsx"); }); }
    var tmplCsv = mount.querySelector("#sp-btn-template-csv");
    if (tmplCsv) { tmplCsv.addEventListener("click", function () { downloadTemplate("csv"); }); }

    // Import button
    var importBtn = mount.querySelector("#sp-btn-import");
    if (importBtn) {
      importBtn.addEventListener("click", function () {
        state.view = "upload";
        renderAll(mount);
      });
    }

    // Add product button
    var addBtn = mount.querySelector("#sp-btn-add");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        showAddEditModal(null, mount);
      });
    }

    // Sort headers
    var headers = mount.querySelectorAll("[data-sort-key]");
    headers.forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort-key");
        if (state.sort.key === key) {
          state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort.key = key;
          state.sort.dir = "asc";
        }
        applyFilter();
        renderAll(mount);
      });
    });

    // Stock toggle
    mount.querySelectorAll("[data-stock-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-stock-id"));
        var newVal = btn.getAttribute("data-stock-val") === "1";
        btn.disabled = true;
        apiToggleStock(id, newVal)
          .then(function () {
            toast("good", "Updated", newVal ? "Marked as out of stock" : "Marked as back in stock");
            return refreshData(mount);
          })
          .catch(function (err) { toast("bad", "Error", err.message || "Failed"); btn.disabled = false; });
      });
    });

    // Delete buttons
    mount.querySelectorAll("[data-del-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.getAttribute("data-del-id"));
        var row = state.products.find(function (r) { return r.id === id; });
        E.modal.show("Delete Product?",
          "<div>Delete: <b>" + esc(row ? row.description : "") + "</b></div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); } },
            { label: "Delete", primary: true, danger: true, onClick: function () {
              apiDelete(id)
                .then(function () { E.modal.hide(); toast("good", "Deleted", "Product removed"); return refreshData(mount); })
                .catch(function (err) { toast("bad", "Error", err.message || "Failed"); });
            }}
          ]
        );
      });
    });

    // Inline editing: double-click cell to edit
    mount.querySelectorAll("[data-edit-id]").forEach(function (td) {
      td.addEventListener("dblclick", function () {
        var id = Number(td.getAttribute("data-edit-id"));
        var field = td.getAttribute("data-edit-field");
        var row = state.products.find(function (r) { return r.id === id; });
        if (!row) return;

        var currentVal = row[field] !== undefined ? row[field] : "";
        var input = document.createElement("input");
        input.type = "text";
        input.value = currentVal;
        input.className = "sp-inline-edit";
        input.style.width = "100%";
        td.innerHTML = "";
        td.appendChild(input);
        input.focus();
        input.select();

        function save() {
          var newVal = input.value;
          var payload = {};
          payload[field] = newVal;

          // If numeric field, recalc
          var numFields = ["cost_excl_vat","cost_incl_vat","discount_pct","discount_euro",
            "qty_purchased","qty_free","retail_price","vat_rate"];
          if (numFields.indexOf(field) !== -1) {
            payload[field] = Number(newVal) || 0;
          }

          apiUpdate(id, payload)
            .then(function () { return refreshData(mount); })
            .catch(function (err) { toast("bad", "Error", err.message || "Save failed"); renderAll(mount); });
        }

        input.addEventListener("blur", save);
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { input.removeEventListener("blur", save); save(); }
          if (e.key === "Escape") { renderAll(mount); }
        });
      });
    });
  }

  // ─── Add/Edit Modal ────────────────────────────────────────────────────
  function showAddEditModal(existingRow, mount) {
    var isEdit = !!existingRow;
    var r = existingRow || {
      stock_code: "", barcode: "", description: "", cost_excl_vat: 0, cost_incl_vat: 0,
      vat_rate: 18, discount_pct: 0, discount_euro: 0, qty_purchased: 1, qty_free: 0,
      batch: "", expiry_date: "", retail_price: 0
    };

    function field(label, id, val, type) {
      type = type || "text";
      return "<div class='sp-modal-field'>" +
        "<label>" + esc(label) + "</label>" +
        "<input type='" + type + "' id='sp-m-" + id + "' class='eikon-input' value='" + esc(val) + "'>" +
      "</div>";
    }

    var body =
      "<div class='sp-modal-grid'>" +
        field("Description *", "description", r.description) +
        field("Stock Code", "stock_code", r.stock_code) +
        field("Barcode", "barcode", r.barcode) +
        field("Cost Excl VAT *", "cost_excl_vat", fmt2(r.cost_excl_vat), "number") +
        field("Cost Incl VAT", "cost_incl_vat", fmt2(r.cost_incl_vat), "number") +
        "<div class='sp-modal-field'><label>VAT Rate *</label>" +
          "<select id='sp-m-vat_rate' class='eikon-input'>" +
            "<option value='0'" + (r.vat_rate === 0 ? " selected" : "") + ">0%</option>" +
            "<option value='5'" + (r.vat_rate === 5 ? " selected" : "") + ">5%</option>" +
            "<option value='18'" + (Number(r.vat_rate) === 18 ? " selected" : "") + ">18%</option>" +
          "</select></div>" +
        field("Discount %", "discount_pct", fmt2(r.discount_pct), "number") +
        field("Discount \u20ac", "discount_euro", fmt2(r.discount_euro), "number") +
        field("Qty Purchased", "qty_purchased", r.qty_purchased || 1, "number") +
        field("Qty Free", "qty_free", r.qty_free || 0, "number") +
        field("Batch", "batch", r.batch) +
        field("Expiry Date", "expiry_date", r.expiry_date) +
        field("Retail Price *", "retail_price", fmt2(r.retail_price), "number") +
      "</div>";

    E.modal.show(isEdit ? "Edit Product" : "Add Product", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: isEdit ? "Save" : "Add", primary: true, onClick: function () {
        var getVal = function (id) { var el = document.getElementById("sp-m-" + id); return el ? el.value : ""; };
        var payload = {
          description: getVal("description"),
          stock_code: getVal("stock_code"),
          barcode: getVal("barcode"),
          cost_excl_vat: Number(getVal("cost_excl_vat")) || 0,
          cost_incl_vat: Number(getVal("cost_incl_vat")) || 0,
          vat_rate: Number(getVal("vat_rate")) || 18,
          discount_pct: Number(getVal("discount_pct")) || 0,
          discount_euro: Number(getVal("discount_euro")) || 0,
          qty_purchased: parseInt(getVal("qty_purchased"), 10) || 1,
          qty_free: parseInt(getVal("qty_free"), 10) || 0,
          batch: getVal("batch"),
          expiry_date: getVal("expiry_date"),
          retail_price: Number(getVal("retail_price")) || 0
        };

        if (!payload.description.trim()) { toast("bad", "Error", "Description is required"); return; }
        if (payload.cost_excl_vat <= 0) { toast("bad", "Error", "Cost Excl VAT is required"); return; }
        if (payload.retail_price <= 0) { toast("bad", "Error", "Retail Price is required"); return; }

        var p = isEdit ? apiUpdate(r.id, payload) : apiCreate(payload);
        p.then(function () {
          E.modal.hide();
          toast("good", isEdit ? "Updated" : "Added", payload.description);
          return refreshData(mount);
        }).catch(function (err) { toast("bad", "Error", err.message || "Failed"); });
      }}
    ]);
  }

  // ─── Refresh data ──────────────────────────────────────────────────────
  async function refreshData(mount) {
    try {
      var resp = await apiList();
      state.products = resp.entries || [];
      applyFilter();
      renderAll(mount);
    } catch (err) {
      warn("Failed to load products", err);
      toast("bad", "Error", "Failed to load products");
    }
  }

  // ─── CSS ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("sp-styles")) return;
    var style = document.createElement("style");
    style.id = "sp-styles";
    style.textContent = [
      ".sp-toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; gap:8px; flex-wrap:wrap; }",
      ".sp-toolbar-left { display:flex; gap:8px; align-items:center; }",
      ".sp-toolbar-right { display:flex; gap:8px; align-items:center; }",
      ".sp-table-wrap { overflow-x:auto; max-height:70vh; border:1px solid rgba(255,255,255,.08); border-radius:10px; }",
      ".sp-table { width:100%; border-collapse:collapse; font-size:12px; }",
      ".sp-table th { position:sticky; top:0; background:rgba(15,22,34,.98); padding:8px 6px; text-align:left; font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:.03em; color:rgba(233,238,247,.6); border-bottom:1px solid rgba(255,255,255,.10); white-space:nowrap; user-select:none; }",
      ".sp-table th:hover { color:rgba(233,238,247,.9); }",
      ".sp-table th.num, .sp-table td.num { text-align:right; }",
      ".sp-table td { padding:6px; border-bottom:1px solid rgba(255,255,255,.05); white-space:nowrap; }",
      ".sp-table tr:hover { background:rgba(90,162,255,.06); }",
      ".sp-margin-cell { padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px; }",
      ".sp-stock-btn { padding:3px 10px; border-radius:6px; border:none; font-size:11px; font-weight:700; cursor:pointer; }",
      ".sp-stock-in { background:rgba(67,209,122,.15); color:#43d17a; }",
      ".sp-stock-oos { background:rgba(255,90,122,.15); color:#ff5a7a; }",
      ".sp-del-btn { background:none; border:none; color:rgba(255,255,255,.3); cursor:pointer; font-size:14px; }",
      ".sp-del-btn:hover { color:#ff5a7a; }",
      ".sp-table-footer { padding:8px 6px; font-size:12px; color:var(--muted); }",
      ".sp-empty { text-align:center; padding:60px 20px; }",
      ".sp-inline-edit { background:rgba(255,255,255,.08); border:1px solid rgba(90,162,255,.4); color:inherit; padding:2px 4px; border-radius:4px; font-size:12px; }",
      ".sp-upload-area { padding:20px; }",
      ".sp-upload-zone { border:2px dashed rgba(255,255,255,.15); border-radius:14px; padding:40px 20px; text-align:center; cursor:pointer; transition:border-color .2s; }",
      ".sp-upload-zone:hover, .sp-upload-zone.sp-drag-over { border-color:rgba(90,162,255,.5); background:rgba(90,162,255,.04); }",
      ".sp-preview-section { padding:12px; }",
      ".sp-preview-table-wrap { overflow:auto; max-height:55vh; border:1px solid rgba(255,255,255,.08); border-radius:10px; margin-bottom:12px; }",
      ".sp-preview-table { width:100%; border-collapse:collapse; font-size:11px; }",
      ".sp-preview-table th { position:sticky; top:0; background:rgba(15,22,34,.98); padding:6px 4px; font-size:10px; text-transform:uppercase; color:rgba(233,238,247,.6); border-bottom:1px solid rgba(255,255,255,.10); white-space:nowrap; }",
      ".sp-preview-table td { padding:3px 2px; border-bottom:1px solid rgba(255,255,255,.04); }",
      ".sp-pv-input { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12); color:inherit; padding:3px 4px; border-radius:4px; font-size:11px; }",
      ".sp-pv-ro { font-size:11px; }",
      ".sp-pv-del { background:none; border:none; color:rgba(255,255,255,.3); cursor:pointer; }",
      ".sp-pv-del:hover { color:#ff5a7a; }",
      ".sp-preview-footer { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }",
      ".sp-btn-primary { background:rgba(90,162,255,.2) !important; color:#5aa2ff !important; font-weight:700 !important; }",
      ".sp-advisory { background:rgba(255,175,50,.1); border:1px solid rgba(255,175,50,.25); border-radius:8px; padding:10px 14px; margin-bottom:12px; font-size:12px; color:#ffaf32; }",
      ".sp-errors { background:rgba(255,90,122,.08); border:1px solid rgba(255,90,122,.2); border-radius:8px; padding:10px 14px; margin-bottom:12px; font-size:12px; color:#ff5a7a; }",
      ".sp-modal-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }",
      ".sp-modal-field { display:flex; flex-direction:column; gap:3px; }",
      ".sp-modal-field label { font-size:11px; font-weight:600; color:rgba(233,238,247,.6); }"
    ].join("\n");
    document.head.appendChild(style);
  }

  // ─── Module Registration ───────────────────────────────────────────────
  E.registerModule({
    id: "supplier-products",
    title: "Product List",
    icon: "\uD83D\uDCE6",
    order: 10,
    section: "supplier",
    render: async function (ctx) {
      injectStyles();
      state._mount = ctx.mount;
      state._user = ctx.user;
      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:1400px;margin:0 auto;">' +
        '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '    <div style="font-weight:900;font-size:18px;">Product List</div>' +
        '  </div>' +
        '  <div id="sp-content"></div>' +
        '</div>';

      state.view = "table";
      await refreshData(ctx.mount);
    }
  });
})();
