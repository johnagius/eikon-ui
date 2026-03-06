/* ui/modules.emergencypos.js
   Eikon — Emergency Offline POS Module
   ─────────────────────────────────────────────────────────────────────────────
   Features:
   • Three tabs: POS (cart builder), Catalog (XLSX import), History (sync)
   • GS1 / FMD DataMatrix full parse: GTIN(AI01), expiry(AI17), batch(AI10), serial(AI21)
   • Camera barcode scanning via ZXing-js (loaded lazily from CDN)
   • XLSX product catalog import via SheetJS (loaded lazily from CDN)
   • Fully offline-first: cart & pending sales stored in localStorage
   • Syncs pending sales to server when connectivity returns
   ─────────────────────────────────────────────────────────────────────────────
   Endpoints used:
   GET    /emergency-pos/catalog            → list products
   POST   /emergency-pos/catalog            → batch upsert (≤500/batch)
   DELETE /emergency-pos/catalog            → clear catalog
   GET    /emergency-pos/sales?date=YMD     → list sales for date
   POST   /emergency-pos/sales              → create one sale
   DELETE /emergency-pos/sales/:id          → void sale
   POST   /emergency-pos/sales/sync         → batch sync offline queue
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  var LP = "[EIKON][epos]";
  function log()  { try { console.log.apply(console,  [LP].concat([].slice.call(arguments))); } catch(e){} }
  function warn() { try { console.warn.apply(console, [LP].concat([].slice.call(arguments))); } catch(e){} }
  function err()  { try { console.error.apply(console,[LP].concat([].slice.call(arguments))); } catch(e){} }

  // ─── Utilities ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function pad2(n){ return String(n).padStart(2,"0"); }
  function todayYmd(){
    var d=new Date();
    return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
  }
  function nowTs(){ return new Date().toISOString(); }
  function fmtTime(iso){
    if(!iso) return "";
    try{
      var d=new Date(iso);
      return pad2(d.getHours())+":"+pad2(d.getMinutes());
    }catch(e){ return ""; }
  }
  function fmt2(n){ return (Math.round((Number(n)||0)*100)/100).toFixed(2); }
  function round2(n){ return Math.round((Number(n)||0)*100)/100; }
  function round3(n){ return Math.round((Number(n)||0)*1000)/1000; }
  function uid(){
    return Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,9);
  }
  function norm(s){ return String(s==null?"":s).toLowerCase().trim(); }

  // ─── LocalStorage helpers ────────────────────────────────────────────────────
  var LS = {
    CART:    "eikon_epos_cart",
    PENDING: "eikon_epos_pending",
    CATALOG: "eikon_epos_catalog"
  };
  function lsGet(key){ try{ var v=localStorage.getItem(key); return v?JSON.parse(v):null; }catch(e){ return null; } }
  function lsSet(key,val){ try{ localStorage.setItem(key,JSON.stringify(val)); }catch(e){} }

  // ─── State ───────────────────────────────────────────────────────────────────
  var state = {
    tab: "pos",            // "pos" | "catalog" | "history"
    cart: [],              // [{id,product,qty,fmdInfo}]
    payment: { method: "cash", tendered: "" },
    discount: 0,           // discount percentage 0-10
    catalog: [],           // all active products
    catalogSearch: "",
    sales: [],             // today's sales from server
    salesDate: todayYmd(),
    pendingSales: [],      // offline queue
    scanning: false,
    zxingReader: null,
    importing: false,
    catalogSearch2: "",    // catalog tab search
    syncing: false,
    toast: null,
    toastTimer: null
  };

  // ─── GS1 / FMD DataMatrix Parser ─────────────────────────────────────────────
  // Handles:
  //   • Parenthesis notation  (01)14digit(17)YYMMDD(10)batch(21)serial
  //   • Raw GS-delimited       01<14>17<6>\x1D10<batch>\x1D21<serial>
  //   • Symbology identifiers  ]d2, ]C1 stripped automatically
  function parseGs1(raw) {
    if (!raw) return null;
    var s = String(raw);

    // Strip symbology identifier prefix (]d2, ]C1, ]e0, ]Q3 etc.)
    s = s.replace(/^\][a-zA-Z]\d/, "");

    // If parenthesis notation: convert to raw by removing parens around AIs
    // "(01)..." → "01..." but leave a GS between variable-length AIs
    if (s.indexOf("(") >= 0) {
      // Normalise: remove parens and insert GS before each AI except the first
      var norm_s = "";
      var re = /\((\d{2,4})\)([^(]*)/g;
      var m;
      var first = true;
      while ((m = re.exec(s)) !== null) {
        if (!first) norm_s += "\x1d";
        norm_s += m[1] + m[2];
        first = false;
      }
      if (norm_s) s = norm_s;
    }

    var GS = "\x1d";
    var result = { gtin: null, expiry: null, batch: null, serial: null, raw: raw };
    var pos = 0;

    while (pos < s.length) {
      if (s[pos] === GS) { pos++; continue; }

      var ai2 = s.substr(pos, 2);
      var ai3 = s.substr(pos, 3);
      var ai4 = s.substr(pos, 4);

      // AI 01 — GTIN, 14 digits fixed
      if (ai2 === "01" && s.length >= pos + 2 + 14) {
        result.gtin = s.substr(pos + 2, 14);
        pos += 16;
        continue;
      }
      // AI 17 — expiry YYMMDD, 6 digits fixed
      if (ai2 === "17" && s.length >= pos + 2 + 6) {
        var exp = s.substr(pos + 2, 6);
        result.expiry = "20" + exp.slice(0,2) + "-" + exp.slice(2,4) + "-" + exp.slice(4,6);
        pos += 8;
        continue;
      }
      // AI 10 — batch/lot, variable length (terminated by GS or end)
      if (ai2 === "10") {
        pos += 2;
        var end10 = s.indexOf(GS, pos);
        if (end10 < 0) end10 = s.length;
        result.batch = s.slice(pos, end10).slice(0, 20);
        pos = end10;
        continue;
      }
      // AI 21 — serial number, variable length
      if (ai2 === "21") {
        pos += 2;
        var end21 = s.indexOf(GS, pos);
        if (end21 < 0) end21 = s.length;
        result.serial = s.slice(pos, end21).slice(0, 20);
        pos = end21;
        continue;
      }
      // AI 30 — count, 8 digits (skip)
      if (ai2 === "30" && s.length >= pos + 10) { pos += 10; continue; }
      // AI 240 (3-digit) variable, AI 241 variable, etc. — skip via GS
      var nextGs = s.indexOf(GS, pos + 2);
      if (nextGs < 0) break;
      pos = nextGs;
    }

    return (result.gtin || result.batch || result.serial) ? result : null;
  }

  // ─── Cart helpers ─────────────────────────────────────────────────────────────
  function cartTotals() {
    var subtotal = 0, vatTotal = 0;
    state.cart.forEach(function(line) {
      var lineTotal = round2(line.qty * line.product.price);
      subtotal = round2(subtotal + lineTotal);
      var vatRate = Number(line.product.vat_rate) || 0;
      if (vatRate > 0) {
        var vatPart = round2(lineTotal - lineTotal / (1 + vatRate / 100));
        vatTotal = round2(vatTotal + vatPart);
      }
    });
    var discPct = Math.min(10, Math.max(0, Number(state.discount) || 0));
    var discountAmt = round2(subtotal * discPct / 100);
    var total = round2(subtotal - discountAmt);
    return { subtotal: subtotal, vatTotal: vatTotal, discountPct: discPct, discountAmt: discountAmt, total: total };
  }

  function fmtQty(q) {
    // Show up to 3 decimal places, but trim trailing zeros
    q = Number(q) || 0;
    if (q === Math.floor(q)) return String(q);
    return q.toFixed(3).replace(/0+$/, "");
  }

  function parseFraction(input) {
    // Accepts "1/6", "0.167", "2.5", etc.
    if (!input) return null;
    var s = String(input).trim();
    if (s.indexOf("/") >= 0) {
      var parts = s.split("/");
      var num = parseFloat(parts[0]);
      var den = parseFloat(parts[1]);
      if (isNaN(num) || isNaN(den) || den === 0) return null;
      return num / den;
    }
    var val = parseFloat(s);
    return isNaN(val) ? null : val;
  }

  function addToCart(product, qty, fmdInfo) {
    qty = Math.max(0.001, parseFloat(qty) || 1);
    var existing = null;
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].product.barcode === product.barcode) { existing = state.cart[i]; break; }
    }
    if (existing && !fmdInfo) {
      existing.qty = round3(existing.qty + qty);
    } else {
      state.cart.push({ id: uid(), product: product, qty: qty, fmdInfo: fmdInfo || null });
    }
    saveCart();
    rerenderCart();
    // Auto-expand cart on mobile when item added
    if (isMobile()) toggleCart(true);
    // Flash the cart toggle badge
    var badge = document.getElementById("epos-cart-badge");
    if (badge) {
      badge.classList.remove("epos-anim-flash");
      void badge.offsetWidth;
      badge.classList.add("epos-anim-flash");
    }
  }

  function removeFromCart(lineId) {
    state.cart = state.cart.filter(function(l){ return l.id !== lineId; });
    saveCart();
    rerenderCart();
  }

  function changeQty(lineId, delta) {
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].id === lineId) {
        state.cart[i].qty = round3(Math.max(0.001, state.cart[i].qty + delta));
        break;
      }
    }
    saveCart();
    rerenderCart();
  }

  function setQty(lineId, newQty) {
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].id === lineId) {
        state.cart[i].qty = round3(Math.max(0.001, newQty));
        break;
      }
    }
    saveCart();
    rerenderCart();
  }

  function showFractionModal(lineId) {
    var line = null;
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].id === lineId) { line = state.cart[i]; break; }
    }
    if (!line) return;
    try {
      E.modal.show("Set Quantity", "<div style='font-size:14px;'>" +
        "<div style='margin-bottom:10px;font-weight:600;'>" + esc(line.product.name) + "</div>" +
        "<div style='margin-bottom:6px;color:rgba(255,255,255,.6);font-size:12px;'>Unit price: €" + fmt2(line.product.price) + "</div>" +
        "<div style='margin-bottom:8px;font-size:13px;'>Enter quantity as a fraction (e.g. <strong>1/6</strong>) or decimal (e.g. <strong>0.167</strong>):</div>" +
        "<input id='epos-frac-input' class='epos-input' style='width:100%;font-size:18px;padding:12px;text-align:center;' placeholder='e.g. 1/6 or 0.5' value='" + fmtQty(line.qty) + "'>" +
        "<div id='epos-frac-preview' style='margin-top:8px;font-size:13px;color:#a5b4fc;text-align:center;'></div>" +
        "</div>", [
        { label: "Cancel", onClick: function(){ E.modal.hide(); } },
        { label: "Set Qty", onClick: function(){
          var inp = document.getElementById("epos-frac-input");
          var val = inp ? parseFraction(inp.value) : null;
          if (val === null || val <= 0) { showToast("Invalid quantity", "warn"); return; }
          E.modal.hide();
          setQty(lineId, val);
        }}
      ]);
      // Live preview
      setTimeout(function() {
        var inp = document.getElementById("epos-frac-input");
        var prev = document.getElementById("epos-frac-preview");
        if (inp && prev) {
          function updatePreview() {
            var val = parseFraction(inp.value);
            if (val !== null && val > 0) {
              prev.textContent = "Qty: " + fmtQty(val) + " × €" + fmt2(line.product.price) + " = €" + fmt2(round2(val * line.product.price));
              prev.style.color = "#a5b4fc";
            } else {
              prev.textContent = inp.value ? "Invalid — use format like 1/6 or 0.167" : "";
              prev.style.color = "#f87171";
            }
          }
          inp.addEventListener("input", updatePreview);
          updatePreview();
          inp.focus();
          inp.select();
        }
      }, 50);
    } catch(e) {
      // Fallback if modal unavailable
      var input = prompt("Enter quantity (fraction like 1/6 or decimal like 0.167):", fmtQty(line.qty));
      if (input === null) return;
      var val = parseFraction(input);
      if (val === null || val <= 0) { showToast("Invalid quantity", "warn"); return; }
      setQty(lineId, val);
    }
  }

  function clearCart() {
    state.cart = [];
    state.payment = { method: "cash", tendered: "" };
    state.discount = 0;
    saveCart();
  }

  function saveCart() {
    lsSet(LS.CART, { cart: state.cart, payment: state.payment, discount: state.discount });
  }

  function loadCart() {
    var saved = lsGet(LS.CART);
    if (saved && Array.isArray(saved.cart)) {
      state.cart = saved.cart;
      state.payment = saved.payment || { method: "cash", tendered: "" };
      state.discount = Math.min(10, Math.max(0, Number(saved.discount) || 0));
    }
  }

  // ─── Pending sales helpers ────────────────────────────────────────────────────
  function loadPending() {
    state.pendingSales = lsGet(LS.PENDING) || [];
  }
  function savePending() {
    lsSet(LS.PENDING, state.pendingSales);
  }
  function addPending(sale) {
    state.pendingSales.push(sale);
    savePending();
  }
  function removePending(offlineId) {
    state.pendingSales = state.pendingSales.filter(function(s){ return s.offline_id !== offlineId; });
    savePending();
  }

  // ─── API ──────────────────────────────────────────────────────────────────────
  function apiFetch(path, opts) {
    return E.apiFetch(path, opts || {});
  }

  async function apiLoadCatalog() {
    try {
      console.log("[EIKON][epos][ui] catalog GET start");
      var t0 = Date.now();
      var allProducts = [];
      var offset = 0;
      var limit = 2000;
      while (true) {
        var resp = await apiFetch("/emergency-pos/catalog?limit=" + limit + "&offset=" + offset);
        console.log("[EIKON][epos][ui] catalog GET resp", {
          ms: Date.now() - t0,
          ok: !!(resp && resp.ok),
          status: resp && resp.status,
          products: resp && Array.isArray(resp.products) ? resp.products.length : 0,
          total: resp && resp.total,
          offset: offset,
          error: resp && (resp.error || resp.message)
        });
        if (resp && Array.isArray(resp.products)) {
          allProducts = allProducts.concat(resp.products);
          if (resp.next_offset != null && resp.products.length > 0) {
            offset = resp.next_offset;
            continue;
          }
        }
        break;
      }
      if (allProducts.length) {
        state.catalog = allProducts;
        lsSet(LS.CATALOG, allProducts);
        return;
      }
    } catch(e) {
      warn("catalog load failed", e && e.message);
      try { console.warn("[EIKON][epos][ui] catalog GET exception", e && (e.stack || e.message || String(e))); } catch(_e) {}
    }
    // Fallback to cached
    var cached = lsGet(LS.CATALOG);
    if (cached) state.catalog = cached;
  }

  async function apiLoadSales(date) {
    try {
      var resp = await apiFetch("/emergency-pos/sales?date=" + encodeURIComponent(date));
      if (resp && Array.isArray(resp.sales)) {
        state.sales = resp.sales;
        return;
      }
    } catch(e) { warn("sales load failed", e && e.message); }
    state.sales = [];
  }

  async function apiSyncPending() {
    if (state.syncing) return;
    if (!state.pendingSales.length) return;
    state.syncing = true;
    updateSyncBadge();
    try {
      var resp = await apiFetch("/emergency-pos/sales/sync", {
        method: "POST",
        body: JSON.stringify({ sales: state.pendingSales })
      });
      if (resp && Array.isArray(resp.results)) {
        resp.results.forEach(function(r) {
          if (r.ok) removePending(r.offline_id);
        });
        showToast("Synced " + resp.synced + " sale(s) to server.", "ok");
      }
    } catch(e) {
      warn("sync failed", e && e.message);
      showToast("Sync failed: " + (e && e.message), "err");
    }
    state.syncing = false;
    updateSyncBadge();
  }

  function completeSale() {
    if (!state.cart.length) { showToast("Cart is empty.", "warn"); return; }
    var tots = cartTotals();
    var itemCount = state.cart.reduce(function(s,l){ return s + l.qty; }, 0);
    var summary = "<div style='font-size:14px;'>" +
      "<div style='margin-bottom:8px;'><strong>" + state.cart.length + " item(s)</strong>, qty: " + fmtQty(itemCount) + "</div>" +
      (tots.discountAmt > 0 ? "<div style='color:#f59e0b;'>Discount: " + tots.discountPct + "% (−€" + fmt2(tots.discountAmt) + ")</div>" : "") +
      "<div style='font-size:18px;font-weight:800;margin-top:4px;'>Total: €" + fmt2(tots.total) + "</div>" +
      "<div style='margin-top:4px;color:rgba(255,255,255,.6);'>" + esc(state.payment.method) + "</div>" +
      "</div>";
    try {
      E.modal.show("Complete Sale?", summary, [
        { label: "Cancel", onClick: function(){ E.modal.hide(); } },
        { label: "Confirm Sale", onClick: function(){ E.modal.hide(); doCompleteSale(); } }
      ]);
    } catch(e) {
      doCompleteSale();
    }
  }

  async function doCompleteSale() {
    if (!state.cart.length) return;
    var tots = cartTotals();
    var payMethod = state.payment.method || "cash";
    var tendered = parseFloat(state.payment.tendered) || 0;
    var change = payMethod === "cash" ? round2(tendered - tots.total) : 0;
    var saleDate = todayYmd();
    var offlineId = uid();
    var receiptNo = "R-" + new Date().toISOString().replace(/[^0-9]/g,"").slice(0,14);
    var items = state.cart.map(function(l) {
      // Use scanned barcode if available, otherwise fall back to DB barcode
      var effectiveBarcode = l.scannedBarcode || l.product.barcode;
      // If FMD was scanned, also extract GTIN as the barcode
      if (l.fmdInfo && l.fmdInfo.gtin && !l.scannedBarcode) {
        effectiveBarcode = l.fmdInfo.gtin;
      }
      return {
        barcode: effectiveBarcode,
        name: l.product.name,
        qty: l.qty,
        price: l.product.price,
        vat_rate: l.product.vat_rate,
        line_total: round2(l.qty * l.product.price),
        fmd: l.fmdInfo || null
      };
    });
    var sale = {
      offline_id: offlineId,
      sale_date: saleDate,
      receipt_no: receiptNo,
      items: items,
      subtotal: tots.subtotal,
      vat_total: tots.vatTotal,
      discount_pct: tots.discountPct,
      discount_amt: tots.discountAmt,
      total: tots.total,
      payment_method: payMethod,
      amount_tendered: payMethod === "cash" ? tendered : null,
      change_given: payMethod === "cash" ? change : null,
      notes: ""
    };

    // Optimistic: save to pending first so we never lose data
    addPending(sale);

    clearCart();
    state.discount = 0;
    rerenderPosTab();

    // Try to sync immediately
    try {
      var resp = await apiFetch("/emergency-pos/sales", {
        method: "POST",
        body: JSON.stringify(sale)
      });
      if (resp && resp.ok) {
        removePending(offlineId);
        showToast("Sale saved. Receipt: " + receiptNo, "ok");
        if (state.tab === "history") {
          await apiLoadSales(state.salesDate);
          rerenderHistoryTab();
        }
      }
    } catch(e) {
      warn("sale create failed — queued offline", e && e.message);
      showToast("Offline — sale queued for sync.", "warn");
    }

    updateSyncBadge();
  }

  // ─── Catalog import (SheetJS) ─────────────────────────────────────────────────
  var XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

  function loadSheetJs(cb) {
    if (window.XLSX) { cb(); return; }
    var s = document.createElement("script");
    s.src = XLSX_CDN;
    s.onload = function() { log("SheetJS loaded"); cb(); };
    s.onerror = function() { showToast("Failed to load XLSX library — check internet.", "err"); };
    document.head.appendChild(s);
  }

  function pickXlsx() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = function(evt) {
      var file = evt.target.files && evt.target.files[0];
      if (!file) return;
      loadSheetJs(function() { readXlsx(file); });
    };
    input.click();
  }

  function readXlsx(file) {
    state.importing = true;
    renderCatalogImportProgress(0, "Reading file…");
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var data = ev.target.result;
        var wb = window.XLSX.read(data, { type: "array" });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
        log("XLSX rows:", rows.length);
        if (!rows.length) { showToast("No rows found in XLSX.", "warn"); state.importing = false; renderCatalogTab(); return; }
        var products = mapXlsxRows(rows);
        log("Mapped products:", products.length);
        uploadProducts(products, file);
      } catch(e) {
        err("XLSX parse error", e);
        showToast("XLSX parse error: " + (e && e.message), "err");
        state.importing = false;
        renderCatalogTab();
      }
    };
    reader.onerror = function() {
      showToast("File read error.", "err");
      state.importing = false;
      renderCatalogTab();
    };
    reader.readAsArrayBuffer(file);
  }

  function mapXlsxRows(rows) {
    // Auto-detect columns by common header names
    if (!rows.length) return [];
    var headers = Object.keys(rows[0]).map(function(h){ return norm(h); });

    function pick(candidates) {
      for (var i = 0; i < candidates.length; i++) {
        for (var j = 0; j < headers.length; j++) {
          if (headers[j].indexOf(candidates[i]) >= 0) return Object.keys(rows[0])[j];
        }
      }
      return null;
    }

    var colBarcode  = pick(["barcode","ean","gtin","code","sku","ref"]);
    var colName     = pick(["name","description","product","item","desc"]);
    var colPrice    = pick(["retail","price","sell","sale"]);
    var colVat      = pick(["vat","tax"]);
    var colCategory = pick(["category","cat","group","dept"]);
    var colUnit     = pick(["unit","pack","size","uom"]);

    if (!colName) {
      showToast("Could not detect description/name column. Headers: " + Object.keys(rows[0]).join(", "), "err");
      return [];
    }

    function toBarcode(v) {
      if (v == null) return "";
      // SheetJS often parses numeric codes as Numbers; normalise without scientific notation.
      if (typeof v === "number") {
        if (!isFinite(v)) return "";
        return String(Math.trunc(v));
      }
      return String(v).trim();
    }

    function pseudoBarcode(name, idx) {
      // Deterministic placeholder barcode for rows that have no EAN/GTIN.
      // This satisfies DB NOT NULL, and allows text-search POS usage.
      // Note: barcode scanning will not match these items.
      var base = String(name || "").trim();
      if (!base) base = "ITEM";
      // Simple 32-bit hash
      var h = 0;
      for (var i = 0; i < base.length; i++) {
        h = ((h << 5) - h) + base.charCodeAt(i);
        h |= 0;
      }
      h = Math.abs(h);
      return "NOBAR-" + String(h) + "-" + String(idx + 1);
    }

    return rows.map(function(r, idx) {
      var b = colBarcode ? toBarcode(r[colBarcode]) : "";
      if (!b) b = pseudoBarcode(r[colName], idx);

      return {
        barcode:  b,
        name:     String(r[colName] || "").trim(),
        price:    parseFloat(r[colPrice] || 0) || 0,
        vat_rate: parseFloat(r[colVat] || 0) || 0,
        category: colCategory ? String(r[colCategory] || "").trim() : "",
        unit:     colUnit ? String(r[colUnit] || "").trim() : ""
      };
    }).filter(function(p){ return p.name && p.barcode; });
  }  // barcode is required by DB schema

  async function uploadProducts(products, file) {
    // Cloudflare Workers can hit CPU/resource limits (1102) if we send very large batches.
    // We therefore:
    //  - send in smaller batches (adaptive)
    //  - add short yielding delays
    //  - retry with exponential backoff on 503 / 1102
    //  - automatically reduce batch size if a 503 occurs mid-import
    var batchSize = 250;          // starting batch size (tuned for reliability)
    var minBatchSize = 50;        // never go below this
    var maxBatchSize = 500;       // upper cap (server may still choke at this)
    var yieldMs = 40;             // small delay between successful batches

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    var total = products.length;
    var done = 0;

    if (!total) return;

    // progress UI helper
    function setProgress(msg, pct) {
      var el = document.getElementById("eposUploadProgress");
      if (!el) return;
      el.textContent = msg;
      if (typeof pct === "number") el.dataset.pct = String(pct);
    }

    console.log("[EIKON][epos][ui] upload start", { total: total, batchSize: batchSize, minBatchSize: minBatchSize, maxBatchSize: maxBatchSize });
    setProgress("Uploading 0 / " + total + " …", 0);

    while (done < total) {
      // Build the current chunk (batch size may change dynamically)
      var end = Math.min(total, done + batchSize);
      var chunk = products.slice(done, end);
      var offset = done; // used for wipe/telemetry; previously undefined
      var file_name = (file && file.name) ? file.name : "";
      var chunk_index = Math.floor(offset / batchSize) + 1;

      console.log("[EIKON][epos][ui] upload chunk start", {
        done: done,
        end: end,
        size: chunk.length,
        batchSize: batchSize,
        sample: chunk[0] ? { barcode: chunk[0].barcode, name: chunk[0].name, price: chunk[0].price } : null
      });

      // Retry loop for this chunk only
      var attempt = 0;
      var lastErr = null;

      while (attempt < 6) {
        try {
          var tBatch0 = Date.now();
          console.log("[EIKON][epos][ui] upload attempt", { attempt: attempt + 1, done: done, end: end, size: chunk.length, batchSize: batchSize });
          try {
            var payloadStr = JSON.stringify({ products: chunk, wipe: (offset === 0), file_name: file_name, total_rows: total, chunk_index: chunk_index });
            console.log("[EIKON][epos][ui] upload payload", { bytes: payloadStr.length, offset: offset, chunk_index: chunk_index, wipe: (offset === 0), file_name: file_name, first: chunk[0], last: chunk[chunk.length - 1] });
          } catch(_pe) {
            console.warn("[EIKON][epos][ui] upload payload stringify failed", { err: _pe && (_pe.stack || _pe.message || String(_pe)) });
          }

          var resp = await apiFetch("/emergency-pos/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: (typeof payloadStr === "string" ? payloadStr : JSON.stringify({ products: chunk, wipe: (offset === 0), file_name: file_name, total_rows: total, chunk_index: chunk_index }))
          });

          console.log("[EIKON][epos][ui] upload resp", { ms: Date.now() - tBatch0, ok: !!(resp && resp.ok), status: resp && resp.status, inserted: resp && resp.inserted, error: resp && (resp.error || resp.message) });

          if (resp && resp.ok) {
            done += chunk.length;
            var pct = Math.round((done / total) * 100);
            setProgress("Uploading " + done + " / " + total + " … (" + pct + "%)", pct);
            // Yield a bit so the browser stays responsive and we avoid hammering the Worker.
            await sleep(yieldMs);
            break;
          }

          // If we get here, resp.ok is false
          var status = resp && resp.status ? resp.status : 0;
          var is503 = status === 503;
          var is429 = status === 429;
          var is5xx = status >= 500 && status < 600;

          // Try to detect CF worker limit (1102) in response body
          var bodyText = "";
          try { bodyText = (resp && typeof resp.text === "function") ? await resp.text() : ""; } catch (e) {}

          var looksLike1102 = bodyText && (bodyText.indexOf("Worker exceeded resource limits") >= 0 || bodyText.indexOf("1102") >= 0);

          console.warn("[EIKON][epos][ui] upload failed", { ms: Date.now() - tBatch0, status: status, looksLike1102: !!looksLike1102, body: (bodyText || "").slice(0, 500) });
          lastErr = new Error("Upload failed: HTTP " + status + (looksLike1102 ? " (CF 1102)" : "") + (bodyText ? (" | body: " + bodyText.slice(0, 200)) : ""));

          // Backoff: on 429/503/5xx, retry; otherwise stop.
          if (is429 || is503 || looksLike1102 || is5xx) {
            // If the worker is choking, reduce batch size for next try.
            if (is503 || looksLike1102) {
              var newSize = Math.max(minBatchSize, Math.floor(batchSize / 2));
              if (newSize < batchSize) {
                batchSize = newSize;
                // rebuild chunk with smaller batch
                end = Math.min(total, done + batchSize);
                chunk = products.slice(done, end);
              }
            }

            attempt += 1;
            var wait = Math.min(8000, 500 * Math.pow(2, attempt)); // cap at 8s
            setProgress("Upload retry " + attempt + "/6 … (batch " + batchSize + ", waiting " + wait + "ms)", Math.round((done / total) * 100));
            await sleep(wait);
            continue;
          }

          // Non-retryable
          throw lastErr;

        } catch (err) {
          lastErr = err;
          try { console.warn("[EIKON][epos][ui] upload exception", { attempt: attempt + 1, err: err && (err.stack || err.message || String(err)) }); } catch(_e) {}
          // Network or unexpected error; retry a few times with backoff
          attempt += 1;
          if (attempt >= 6) break;
          var wait2 = Math.min(8000, 500 * Math.pow(2, attempt));
          setProgress("Upload error, retry " + attempt + "/6 … (waiting " + wait2 + "ms)", Math.round((done / total) * 100));
          await sleep(wait2);
        }
      }

      if (done < end) {
        // Chunk ultimately failed
        throw lastErr || new Error("Upload failed.");
      }
    }

    setProgress("Upload complete: " + done + " / " + total, 100);
  }

  // ─── Camera barcode scanning ─────────────────────────────────────────────────
  // Primary: native BarcodeDetector API (Chrome/Android, Safari 16.4+)
  //   — reliably reads DataMatrix (FMD), QR, EAN-13, Code 128 etc.
  // Fallback: ZXing-js for browsers without BarcodeDetector
  var ZXING_CDN = "https://cdn.jsdelivr.net/npm/@zxing/library@0.19.2/umd/index.min.js";

  function loadZxing(cb) {
    if (window.ZXing) { cb(); return; }
    var s = document.createElement("script");
    s.src = ZXING_CDN;
    s.onload = function() { log("ZXing loaded"); cb(); };
    s.onerror = function() { showToast("Failed to load scanner library — check internet.", "err"); };
    document.head.appendChild(s);
  }

  function hasBarcodeDetector() {
    return typeof window.BarcodeDetector !== "undefined";
  }

  function handleScanResult(text, cartLineId) {
    log("Scanned:", text);
    if (cartLineId) {
      onCartBarcodeScan(cartLineId, text);
    } else {
      onBarcodeScanned(text);
    }
  }

  // ─── Image preprocessing for barcode detection ──────────────────────────────
  // Works on smaller canvas to avoid memory issues on mobile
  var SCAN_W = 640, SCAN_H = 480;

  function invertCanvas(ctx, w, h) {
    var imgData = ctx.getImageData(0, 0, w, h);
    var d = imgData.data;
    for (var i = 0; i < d.length; i += 4) {
      d[i]     = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function sharpenToBlackWhite(ctx, w, h) {
    var imgData = ctx.getImageData(0, 0, w, h);
    var d = imgData.data;
    var sum = 0;
    var grays = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      grays[p] = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      sum += grays[p];
    }
    var mean = sum / grays.length;
    for (var j = 0, q = 0; j < d.length; j += 4, q++) {
      var v = grays[q] > mean ? 255 : 0;
      d[j] = d[j+1] = d[j+2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ─── Native BarcodeDetector scanner (preferred) ────────────────────────────
  function startNativeScan(cartLineId) {
    var videoEl = document.getElementById("epos-scan-video");
    if (!videoEl) { stopScan(); return; }

    var detector;
    try {
      detector = new BarcodeDetector({
        formats: ["data_matrix", "qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"]
      });
    } catch(e) {
      try {
        detector = new BarcodeDetector({
          formats: ["data_matrix", "qr_code", "ean_13", "code_128"]
        });
      } catch(e2) {
        err("BarcodeDetector init failed", e2);
        startZxingScan(cartLineId);
        return;
      }
    }

    // Small processing canvas to avoid memory pressure on mobile
    var canvas = document.createElement("canvas");
    canvas.width = SCAN_W;
    canvas.height = SCAN_H;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var canvas2 = document.createElement("canvas");
    canvas2.width = SCAN_W;
    canvas2.height = SCAN_H;
    var ctx2 = canvas2.getContext("2d", { willReadFrequently: true });

    var stopped = false;
    var frameCount = 0;
    var scanPending = false; // prevent overlapping detect() calls

    state._nativeScanCleanup = function() { stopped = true; };

    // Force rear camera with { exact: "environment" }
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    }).catch(function() {
      // If exact rear camera fails (e.g. desktop), fall back to any camera
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
    }).then(function(stream) {
      if (stopped) { stream.getTracks().forEach(function(t){ t.stop(); }); return; }
      state._scanStream = stream;
      videoEl.srcObject = stream;
      videoEl.play();

      function drawScaled() {
        ctx.drawImage(videoEl, 0, 0, SCAN_W, SCAN_H);
      }

      function detectOn(cvs) {
        return detector.detect(cvs).then(function(barcodes) {
          return barcodes.length > 0 ? barcodes[0] : null;
        }).catch(function() { return null; });
      }

      function scanFrame() {
        if (stopped || !state.scanning || scanPending) return;
        if (videoEl.readyState < 2) {
          setTimeout(scanFrame, 100);
          return;
        }

        scanPending = true;
        drawScaled();
        frameCount++;

        // Always try normal frame
        var p1 = detectOn(canvas);

        // Alternate: every other frame try a processed version
        var p2;
        if (frameCount % 2 === 0) {
          // Inverted colours for inverted DataMatrix
          ctx2.drawImage(canvas, 0, 0);
          invertCanvas(ctx2, SCAN_W, SCAN_H);
          p2 = detectOn(canvas2);
        } else {
          // B&W threshold for noisy/low-contrast
          ctx2.drawImage(canvas, 0, 0);
          sharpenToBlackWhite(ctx2, SCAN_W, SCAN_H);
          p2 = detectOn(canvas2);
        }

        Promise.all([p1, p2]).then(function(results) {
          scanPending = false;
          if (stopped || !state.scanning) return;
          var hit = results[0] || results[1];
          if (hit) {
            log("BarcodeDetector:", hit.rawValue, "format:", hit.format);
            stopScan();
            handleScanResult(hit.rawValue, cartLineId);
          } else {
            // Throttle to ~15fps to avoid overloading mobile
            setTimeout(scanFrame, 66);
          }
        }).catch(function() {
          scanPending = false;
          if (stopped || !state.scanning) return;
          setTimeout(scanFrame, 100);
        });
      }

      setTimeout(scanFrame, 400);
    }).catch(function(e) {
      err("Camera access failed", e);
      showToast("Camera access denied: " + (e && e.message), "err");
      stopScan();
    });
  }

  // ─── ZXing fallback scanner ────────────────────────────────────────────────
  function startZxingScan(cartLineId) {
    loadZxing(function() {
      try {
        var reader = new window.ZXing.BrowserMultiFormatReader();
        state.zxingReader = reader;
        var videoEl = document.getElementById("epos-scan-video");
        if (!videoEl) { stopScan(); return; }
        reader.decodeFromVideoDevice(null, "epos-scan-video", function(result, scanErr) {
          if (result) {
            var text = result.getText();
            stopScan();
            handleScanResult(text, cartLineId);
          }
        });
      } catch(e) {
        err("ZXing init error", e);
        showToast("Scanner error: " + (e && e.message), "err");
        stopScan();
      }
    });
  }

  function startScan(cartLineId) {
    if (state.scanning) return;
    state.scanning = true;
    state._scanForCartLine = cartLineId || null;
    renderScanOverlay();

    if (hasBarcodeDetector()) {
      log("Using native BarcodeDetector (DataMatrix supported)");
      startNativeScan(cartLineId);
    } else {
      log("BarcodeDetector not available, falling back to ZXing");
      startZxingScan(cartLineId);
    }
  }

  function stopScan() {
    try {
      if (state._nativeScanCleanup) { state._nativeScanCleanup(); state._nativeScanCleanup = null; }
      if (state._scanStream) {
        state._scanStream.getTracks().forEach(function(t) { t.stop(); });
        state._scanStream = null;
      }
      if (state.zxingReader) {
        state.zxingReader.reset();
        state.zxingReader = null;
      }
    } catch(e) {}
    state.scanning = false;
    var overlay = document.getElementById("epos-scan-overlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  // ─── Photo OCR + Fuzzy Search ─────────────────────────────────────────────────
  var TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

  var STOP_WORDS = { the:1,and:1,for:1,with:1,set:1,new:1,best:1,pack:1,size:1,value:1,
    original:1,each:1,per:1,item:1,one:1,two:1,all:1,are:1,from:1,has:1,have:1,its:1 };

  function tokenize(text) {
    return String(text || "").toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(function(w){ return w.length >= 3 && !STOP_WORDS[w]; });
  }

  function fuzzyScore(ocrTokens, product) {
    var prodTokens = tokenize(product.name + " " + (product.category || ""));
    if (!prodTokens.length) return 0;
    var matched = 0;
    for (var i = 0; i < prodTokens.length; i++) {
      var pt = prodTokens[i];
      for (var j = 0; j < ocrTokens.length; j++) {
        var ot = ocrTokens[j];
        // Forgiving: match if either token starts with the other (handles truncation)
        if (ot === pt || ot.indexOf(pt) === 0 || pt.indexOf(ot) === 0) {
          matched++;
          break;
        }
      }
    }
    return matched / prodTokens.length;
  }

  function loadTesseract(cb) {
    if (window.Tesseract) { cb(); return; }
    var s = document.createElement("script");
    s.src = TESSERACT_CDN;
    s.onload = function() { log("Tesseract.js loaded"); cb(); };
    s.onerror = function() { showToast("Failed to load OCR library — check internet.", "err"); };
    document.head.appendChild(s);
  }

  var _photoStream = null;

  function startPhotoSearch() {
    if (!state.catalog.length) { showToast("Load a catalog first (Catalog tab).", "warn"); return; }

    // Build overlay
    var overlay = document.createElement("div");
    overlay.id = "epos-photo-overlay";
    overlay.className = "epos-photo-overlay";
    overlay.innerHTML =
      "<div style='display:flex;align-items:center;justify-content:space-between;width:min(520px,96vw);margin-bottom:12px;'>" +
        "<span style='color:#fff;font-size:20px;font-weight:700;'>Photo Search</span>" +
        "<button id='epos-photo-close' class='epos-overlay-btn epos-overlay-btn-cancel'>Close</button>" +
      "</div>" +
      "<video id='epos-photo-video' class='epos-photo-video' autoplay muted playsinline></video>" +
      "<canvas id='epos-photo-canvas' class='epos-photo-canvas'></canvas>" +
      "<div style='display:flex;gap:12px;margin-top:12px;width:min(520px,96vw);'>" +
        "<button id='epos-photo-capture' class='epos-overlay-btn epos-overlay-btn-primary' style='flex:1;'>Capture</button>" +
        "<button id='epos-photo-retake' class='epos-overlay-btn' style='display:none;flex:1;'>Retake</button>" +
      "</div>" +
      "<div id='epos-photo-status' style='color:rgba(255,255,255,.6);font-size:14px;min-height:22px;margin-top:8px;'></div>" +
      "<div id='epos-photo-results' style='width:min(520px,96vw);max-height:280px;overflow-y:auto;'></div>";
    document.body.appendChild(overlay);

    var videoEl   = document.getElementById("epos-photo-video");
    var canvasEl  = document.getElementById("epos-photo-canvas");
    var captureBtn= document.getElementById("epos-photo-capture");
    var retakeBtn = document.getElementById("epos-photo-retake");
    var statusEl  = document.getElementById("epos-photo-status");
    var resultsEl = document.getElementById("epos-photo-results");

    function closeOverlay() {
      if (_photoStream) { try { _photoStream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){} _photoStream = null; }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    document.getElementById("epos-photo-close").addEventListener("click", closeOverlay);

    // Start camera
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function(stream) {
        _photoStream = stream;
        videoEl.srcObject = stream;
      })
      .catch(function(e) {
        statusEl.textContent = "Camera access denied: " + (e && e.message);
      });

    captureBtn.addEventListener("click", function() {
      // Draw current video frame to canvas
      var w = videoEl.videoWidth  || 640;
      var h = videoEl.videoHeight || 480;
      canvasEl.width  = w;
      canvasEl.height = h;
      canvasEl.getContext("2d").drawImage(videoEl, 0, 0, w, h);

      // Stop video stream, show canvas
      if (_photoStream) { try { _photoStream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){} _photoStream = null; }
      videoEl.style.display = "none";
      canvasEl.style.display = "block";
      captureBtn.style.display = "none";
      retakeBtn.style.display = "";
      statusEl.innerHTML = "<span style='color:#a5b4fc;'>Analysing image… please wait</span>";
      resultsEl.innerHTML = "";

      // Run OCR
      loadTesseract(function() {
        (async function() {
          try {
            var worker = await window.Tesseract.createWorker("eng");
            var result = await worker.recognize(canvasEl);
            await worker.terminate();
            var ocrText = (result && result.data && result.data.text) ? result.data.text : "";
            log("OCR text:", ocrText.slice(0, 200));
            showPhotoResults(ocrText, statusEl, resultsEl, closeOverlay);
          } catch(e) {
            err("OCR error", e);
            statusEl.textContent = "OCR error: " + (e && e.message);
          }
        })();
      });
    });

    retakeBtn.addEventListener("click", function() {
      // Reset for another capture
      canvasEl.style.display = "none";
      videoEl.style.display = "";
      captureBtn.style.display = "";
      retakeBtn.style.display = "none";
      statusEl.textContent = "";
      resultsEl.innerHTML = "";
      // Restart camera
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
        .then(function(stream) { _photoStream = stream; videoEl.srcObject = stream; })
        .catch(function(e) { statusEl.textContent = "Camera error: " + (e && e.message); });
    });
  }

  function showPhotoResults(ocrText, statusEl, resultsEl, closeOverlay) {
    var ocrTokens = tokenize(ocrText);
    if (!ocrTokens.length) {
      statusEl.textContent = "No text detected in image — try again with better lighting.";
      return;
    }
    var preview = ocrText.replace(/\s+/g, " ").trim().slice(0, 120);
    statusEl.innerHTML = "<span style='color:rgba(255,255,255,.5);'>OCR: </span><em style='color:rgba(255,255,255,.75);'>" + esc(preview) + (ocrText.length > 120 ? "…" : "") + "</em>";

    // Score every catalog product
    var scored = state.catalog.map(function(p) {
      return { product: p, score: fuzzyScore(ocrTokens, p) };
    }).filter(function(r){ return r.score > 0; });
    scored.sort(function(a, b){ return b.score - a.score; });
    var top = scored.slice(0, 10);

    if (!top.length) {
      resultsEl.innerHTML = "<div style='color:rgba(255,255,255,.4);padding:16px;text-align:center;'>No matches found — try another angle or better lighting.</div>";
      return;
    }

    resultsEl.innerHTML = top.map(function(r) {
      var pct = Math.round(r.score * 100);
      var barW = Math.round(r.score * 100);
      return "<div class='epos-match-row' data-name='" + esc(r.product.name) + "'>" +
        "<div style='flex:1;min-width:0;'>" +
          "<div style='font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'>" + esc(r.product.name) + "</div>" +
          "<div class='epos-match-bar'><div class='epos-match-fill' style='width:" + barW + "%'></div></div>" +
          "<div style='font-size:12px;color:rgba(255,255,255,.4);'>" + pct + "% match" + (r.product.barcode ? " · " + esc(r.product.barcode) : "") + "</div>" +
        "</div>" +
        "<div style='white-space:nowrap;margin-left:12px;text-align:right;'>" +
          "<div style='font-size:15px;font-weight:700;color:#a5b4fc;'>€" + fmt2(r.product.price) + "</div>" +
          "<button class='epos-btn primary epos-match-add' data-name='" + esc(r.product.name) + "' style='margin-top:6px;padding:10px 16px;font-size:14px;'>Add</button>" +
        "</div>" +
        "</div>";
    }).join("");

    resultsEl.querySelectorAll(".epos-match-add").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var name = btn.getAttribute("data-name");
        var product = findProductByName(name);
        if (product) {
          addToCart(product, 1, null);
          showToast("Added: " + product.name, "ok");
          closeOverlay();
        }
      });
    });
  }

  function onBarcodeScanned(raw) {
    var gs1 = parseGs1(raw);
    var product = null;

    if (gs1 && gs1.gtin) {
      // Try GTIN lookup (strip leading zeros for 8/13 digit barcodes stored without padding)
      product = findProduct(gs1.gtin) || findProduct(gs1.gtin.replace(/^0+/, ""));
    }
    if (!product) {
      product = findProduct(raw);
    }

    if (product) {
      addToCart(product, 1, gs1);
      var msg = product.name;
      if (gs1 && gs1.batch) msg += " | Batch: " + gs1.batch;
      if (gs1 && gs1.expiry) msg += " | Exp: " + gs1.expiry;
      showToast("Added: " + msg, "ok");
    } else {
      var notFound = gs1 && gs1.gtin ? ("GTIN " + gs1.gtin) : raw;
      showToast("Product not found: " + notFound, "warn");
      // Still add FMD info to toast area for manual lookup
      if (gs1 && gs1.gtin) renderFmdResult(gs1);
    }
  }

  function onCartBarcodeScan(lineId, raw) {
    var gs1 = parseGs1(raw);
    var line = null;
    for (var i = 0; i < state.cart.length; i++) {
      if (String(state.cart[i].id) === String(lineId)) { line = state.cart[i]; break; }
    }
    if (!line) {
      // Cart may have been cleared/changed while scanner was open.
      // Treat as a normal scan instead of silently failing.
      log("Cart line " + lineId + " not found, treating as normal scan");
      onBarcodeScanned(raw);
      return;
    }

    // Store the scanned barcode — this overrides the DB barcode for this line
    line.scannedBarcode = raw;
    if (gs1) {
      line.fmdInfo = gs1;
      var msg = line.product.name + " — barcode set";
      if (gs1.batch) msg += " | Batch: " + gs1.batch;
      if (gs1.expiry) msg += " | Exp: " + gs1.expiry;
      showToast(msg, "ok");
    } else {
      showToast(line.product.name + " — barcode set: " + raw, "ok");
    }
    rerenderCart();
  }

  function findProduct(barcode) {
    var b = norm(barcode);
    if (!b) return null;
    for (var i = 0; i < state.catalog.length; i++) {
      var pb = norm(state.catalog[i].barcode);
      if (pb && pb === b) return state.catalog[i];  // never match products with no barcode
    }
    return null;
  }

  // ─── Code128 barcode SVG generator (subset B — ASCII 32-127) ────────────────
  var C128B = [
    "11011001100","11001101100","11001100110","10010011000","10010001100",
    "10001001100","10011001000","10011000100","10001100100","11001001000",
    "11001000100","11000100100","10110011100","10011011100","10011001110",
    "10111001100","10011101100","10011100110","11001110010","11001011100",
    "11001001110","11011100100","11001110100","11100101100","11100100110",
    "11101100100","11100110100","11100110010","11011011000","11011000110",
    "11000110110","10100011000","10001011000","10001000110","10110001000",
    "10001101000","10001100010","11010001000","11000101000","11000100010",
    "10110111000","10110001110","10001101110","10111011000","10111000110",
    "10001110110","11101110110","11010001110","11000101110","11011101000",
    "11011100010","11011101110","11101011000","11101000110","11100010110",
    "11101101000","11101100010","11100011010","11101111010","11001000010",
    "11110001010","10100110000","10100001100","10010110000","10010000110",
    "10000101100","10000100110","10110010000","10110000100","10011010000",
    "10011000010","10000110100","10000110010","11000010010","11001010000",
    "11110111010","11000010100","10001111010","10100111100","10010111100",
    "10010011110","10111100100","10011110100","10011110010","11110100100",
    "11110010100","11110010010","11011011110","11011110110","11110110110",
    "10101111000","10100011110","10001011110","10111101000","10111100010",
    "11110101000","11110100010","10111011110","10111101110","11101011110",
    "11110101110","11010000100","11010010000","11010011100","1100011101011"
  ];

  function barcodeC128Svg(text, h) {
    h = h || 40;
    if (!text) return "";
    var codes = [C128B[104]]; // START B
    var checksum = 104;
    for (var i = 0; i < text.length; i++) {
      var val = text.charCodeAt(i) - 32;
      if (val < 0 || val > 94) val = 0;
      codes.push(C128B[val]);
      checksum += val * (i + 1);
    }
    codes.push(C128B[checksum % 103]);
    codes.push(C128B[106]); // STOP
    var bits = codes.join("");
    var w = bits.length;
    var bars = "";
    for (var j = 0; j < bits.length; j++) {
      if (bits[j] === "1") bars += "<rect x='" + j + "' y='0' width='1' height='" + h + "'/>";
    }
    return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + w + " " + h + "' style='width:" + Math.round(w * 1.2) + "px;height:" + h + "px;'>" + bars + "</svg>";
  }

  // ─── FMD DataMatrix 2D code SVG for print ───────────────────────────────────
  // Generates a DataMatrix-style 2D barcode SVG from a GS1 FMD string.
  // Uses a simple Reed-Solomon-free visual encoding that preserves the full
  // data as scannable text. For true GS1 DataMatrix we reconstruct the raw
  // string with GS separators.
  function fmdRawString(fmd) {
    if (!fmd) return "";
    // Rebuild the GS1 string with FNC1/GS separators as originally scanned
    if (fmd.raw) return fmd.raw;
    var s = "";
    if (fmd.gtin)   s += "01" + fmd.gtin;
    if (fmd.expiry) {
      var exp = String(fmd.expiry).replace(/-/g, "").replace(/^20/, "");
      s += "17" + exp;
    }
    if (fmd.batch)  s += "\x1d10" + fmd.batch;
    if (fmd.serial) s += "\x1d21" + fmd.serial;
    return s;
  }

  function fmdCodeHtml(fmd) {
    if (!fmd) return "";
    // Build the GS1 string that was originally scanned
    var parts = [];
    if (fmd.gtin) parts.push("(01)" + fmd.gtin);
    if (fmd.expiry) parts.push("(17)" + fmd.expiry);
    if (fmd.batch) parts.push("(10)" + fmd.batch);
    if (fmd.serial) parts.push("(21)" + fmd.serial);
    if (!parts.length) return "";
    // Render the FMD text AND a placeholder for the 2D barcode (filled by bwip-js)
    var rawStr = fmdRawString(fmd);
    var dataAttr = rawStr ? " data-fmd-raw='" + esc(btoa(rawStr)) + "'" : "";
    return "<div style='margin-top:8px;padding:6px 8px;border:1px solid #999;border-radius:4px;background:#f8f8f8;'>" +
      "<div class='fmd-barcode-container'" + dataAttr + " style='text-align:center;margin-bottom:4px;'></div>" +
      "<div style='font-family:monospace;font-size:9px;word-break:break-all;'>" +
      "<strong>FMD:</strong> " + esc(parts.join("")) + "</div></div>";
  }

  // ─── bwip-js DataMatrix barcode renderer ────────────────────────────────────
  var BWIPJS_CDN = "https://cdn.jsdelivr.net/npm/bwip-js@4/dist/bwip-js-min.js";

  function loadBwipJs() {
    return new Promise(function(resolve, reject) {
      if (window.bwipjs) { resolve(); return; }
      var s = document.createElement("script");
      s.src = BWIPJS_CDN;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error("Failed to load bwip-js")); };
      document.head.appendChild(s);
    });
  }

  // Renders all .fmd-barcode-container elements within a root element
  // that have data-fmd-raw attributes into DataMatrix SVG barcodes
  async function renderFmdBarcodes(root) {
    var containers = root.querySelectorAll(".fmd-barcode-container[data-fmd-raw]");
    if (!containers.length) return;
    try {
      await loadBwipJs();
    } catch(e) {
      warn("bwip-js load failed", e && e.message);
      return;
    }
    containers.forEach(function(el) {
      try {
        var raw = atob(el.getAttribute("data-fmd-raw"));
        var canvas = document.createElement("canvas");
        bwipjs.toCanvas(canvas, {
          bcid: "datamatrix",
          text: raw,
          scale: 3,
          padding: 2,
          parsefnc: true
        });
        // Convert canvas to an img for cleaner rendering in receipt
        var img = document.createElement("img");
        img.src = canvas.toDataURL("image/png");
        img.style.cssText = "width:" + Math.min(canvas.width, 120) + "px;height:auto;image-rendering:pixelated;";
        el.appendChild(img);
      } catch(e) {
        warn("DataMatrix render error", e && e.message);
      }
    });
  }

  // ─── Generate day's receipts as shareable image ─────────────────────────────
  function buildReceiptsHtml() {
    var salesHtml = "";
    var dayTotal = 0;
    var dayVat = 0;
    var receiptCount = 0;

    for (var si = 0; si < state.sales.length; si++) {
      var s = state.sales[si];
      if (s.voided === 1) continue;
      receiptCount++;
      var items;
      try { items = JSON.parse(s.items_json || "[]"); } catch(e) { items = s.items || []; }

      var itemRows = "";
      for (var ii = 0; ii < items.length; ii++) {
        var it = items[ii];
        var bc = it.barcode ? barcodeC128Svg(String(it.barcode), 45) : "";
        var fmdHtml = fmdCodeHtml(it.fmd);
        itemRows += "<tr>" +
          "<td style='vertical-align:top;padding-top:14px;padding-bottom:14px;'>" +
            "<div style='font-weight:600;font-size:13px;'>" + esc(it.name) + "</div>" +
            (it.barcode ? "<div style='font-size:10px;color:#666;margin-top:2px;'>" + esc(it.barcode) + "</div>" : "") +
            fmdHtml +
          "</td>" +
          "<td style='text-align:center;vertical-align:top;width:80px;padding-top:14px;padding-bottom:14px;'>" + bc + "</td>" +
          "<td style='text-align:center;vertical-align:top;width:40px;'>" + (it.qty || 1) + "</td>" +
          "<td style='text-align:right;vertical-align:top;width:65px;'>&euro;" + fmt2(it.price || 0) + "</td>" +
          "<td style='text-align:right;vertical-align:top;width:70px;font-weight:600;'>&euro;" + fmt2(it.line_total || 0) + "</td>" +
          "</tr>";
      }

      dayTotal += Number(s.total) || 0;
      dayVat += Number(s.vat_total) || 0;

      salesHtml += "<div class='receipt-block'>" +
        "<div class='receipt-header'>" +
          "<strong>" + esc(s.receipt_no || "") + "</strong>" +
          "<span>" + esc(fmtTime(s.created_at)) + "</span>" +
          "<span>" + esc(s.payment_method || "") + "</span>" +
        "</div>" +
        "<table><thead><tr><th style='text-align:left;'>Item</th><th>Barcode</th><th>Qty</th><th style='text-align:right;'>Price</th><th style='text-align:right;'>Total</th></tr></thead><tbody>" +
        itemRows +
        "</tbody></table>" +
        "<div class='receipt-totals'>" +
          "<div><span>Subtotal</span><span>&euro;" + fmt2(s.subtotal) + "</span></div>" +
          (s.discount_pct ? "<div style='color:#b45309;'><span>Discount (" + s.discount_pct + "%)</span><span>&minus;&euro;" + fmt2(s.discount_amt || 0) + "</span></div>" : "") +
          "<div class='grand'><span>TOTAL</span><span>&euro;" + fmt2(s.total) + "</span></div>" +
        "</div>" +
        "</div>" +
        "<hr class='separator'/>";
    }

    return {
      html: salesHtml,
      dayTotal: dayTotal,
      dayVat: dayVat,
      receiptCount: receiptCount
    };
  }

  function receiptsCss() {
    return "body{font-family:'Segoe UI',system-ui,sans-serif;font-size:12px;width:680px;margin:0;padding:16px;color:#111;background:#fff;}" +
      "h1{font-size:18px;margin:0 0 2px;}" +
      ".date-line{font-size:13px;color:#555;margin-bottom:16px;}" +
      "table{width:100%;border-collapse:separate;border-spacing:0 8px;margin-bottom:6px;}" +
      "th{font-size:10px;text-transform:uppercase;color:#777;border-bottom:2px solid #333;padding:4px 6px;}" +
      "td{padding:10px 6px;border-bottom:1px solid #ddd;}" +
      ".receipt-block{margin-bottom:8px;}" +
      ".receipt-header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:12px;padding:8px 0;border-bottom:1px solid #ccc;margin-bottom:6px;}" +
      ".receipt-header strong{font-size:13px;}" +
      ".receipt-totals{text-align:right;font-size:12px;margin-top:8px;}" +
      ".receipt-totals div{display:flex;justify-content:flex-end;gap:16px;padding:2px 0;}" +
      ".receipt-totals .grand{font-weight:800;font-size:14px;border-top:2px solid #333;margin-top:4px;padding-top:4px;}" +
      "hr.separator{border:none;border-top:2px dashed #999;margin:18px 0;}" +
      ".day-summary{margin-top:12px;padding:12px;border:2px solid #333;border-radius:6px;font-size:14px;}" +
      ".day-summary div{display:flex;justify-content:space-between;padding:3px 0;}" +
      ".day-summary .grand{font-weight:800;font-size:16px;border-top:2px solid #333;margin-top:4px;padding-top:6px;}" +
      "svg{display:block;}" +
      ".fmd-barcode-container{text-align:center;margin:4px 0;}";
  }

  function buildFullReceiptDoc() {
    var data = buildReceiptsHtml();
    return "<!doctype html><html><head><meta charset='utf-8'><style>" + receiptsCss() + "</style></head><body>" +
      "<h1>Eikon Emergency POS</h1>" +
      "<div class='date-line'>Daily Sales Report &mdash; " + esc(state.salesDate) + "</div>" +
      data.html +
      "<div class='day-summary'>" +
        "<div><span>Total Sales (excl. voided)</span><span>" + data.receiptCount + " receipts</span></div>" +
        "<div class='grand'><span>GRAND TOTAL</span><span>&euro;" + fmt2(data.dayTotal) + "</span></div>" +
      "</div>" +
      "<div style='text-align:center;font-size:10px;color:#999;margin-top:12px;'>Generated by Eikon Emergency POS</div>" +
      "</body></html>";
  }

  async function renderReceiptsToBlob() {
    var htmlDoc = buildFullReceiptDoc();

    // Create offscreen iframe to render
    var iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:712px;height:100px;border:none;opacity:0;pointer-events:none;";
    document.body.appendChild(iframe);

    return new Promise(function(resolve, reject) {
      iframe.onload = function() {
        try {
          var iDoc = iframe.contentDocument || iframe.contentWindow.document;
          var body = iDoc.body;

          // Render FMD DataMatrix barcodes inside the iframe, then capture
          renderFmdBarcodes(body).then(function() {
            // Wait for images to render
            setTimeout(function() {
              var fullH = body.scrollHeight;
              var fullW = 712;
              iframe.style.height = fullH + "px";

              renderIframeToCanvas(iframe, fullW, fullH).then(function(canvas) {
                canvas.toBlob(function(blob) {
                  document.body.removeChild(iframe);
                  resolve(blob);
                }, "image/png");
              }).catch(function(e) {
                document.body.removeChild(iframe);
                reject(e);
              });
            }, 200);
          }).catch(function() {
            // Even if FMD barcodes fail, still capture the receipt
            setTimeout(function() {
              var fullH = body.scrollHeight;
              var fullW = 712;
              iframe.style.height = fullH + "px";
              renderIframeToCanvas(iframe, fullW, fullH).then(function(canvas) {
                canvas.toBlob(function(blob) {
                  document.body.removeChild(iframe);
                  resolve(blob);
                }, "image/png");
              }).catch(function(e) {
                document.body.removeChild(iframe);
                reject(e);
              });
            }, 200);
          });
        } catch(e) {
          document.body.removeChild(iframe);
          reject(e);
        }
      };
      var iDoc = iframe.contentDocument || iframe.contentWindow.document;
      iDoc.open();
      iDoc.write(htmlDoc);
      iDoc.close();
    });
  }

  function loadHtml2Canvas() {
    return new Promise(function(resolve, reject) {
      if (window.html2canvas) { resolve(window.html2canvas); return; }
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      s.onload = function() { resolve(window.html2canvas); };
      s.onerror = function() { reject(new Error("Failed to load html2canvas")); };
      document.head.appendChild(s);
    });
  }

  async function renderIframeToCanvas(iframe, w, h) {
    var iDoc = iframe.contentDocument || iframe.contentWindow.document;
    var h2c = await loadHtml2Canvas();
    return h2c(iDoc.body, {
      width: w,
      height: h,
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false
    });
  }

  async function printDayReceipts() {
    if (!state.sales.length) { showToast("No sales to print.", "warn"); return; }
    showToast("Generating receipts...", "ok");

    try {
      var blob = await renderReceiptsToBlob();
      var fileName = "receipts-" + state.salesDate + ".png";
      var file = new File([blob], fileName, { type: "image/png" });

      // Try Web Share API first (mobile share sheet)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "Day Receipts — " + state.salesDate,
            text: "Eikon Emergency POS receipts for " + state.salesDate,
            files: [file]
          });
          showToast("Shared successfully", "ok");
          return;
        } catch(e) {
          // User cancelled share or share failed — fall through to download
          if (e.name === "AbortError") return;
        }
      }

      // Fallback: direct download
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function() { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
      showToast("Receipts downloaded as " + fileName, "ok");
    } catch(e) {
      warn("Receipt generation failed", e && e.message);
      // Final fallback: open in new window for manual print/save
      try {
        var win = window.open("", "_blank", "width=720,height=900");
        if (win) {
          var html = buildFullReceiptDoc();
          // Add bwip-js for DataMatrix rendering, print button, and auto-print
          html = html.replace("</body>",
            "<script src='" + BWIPJS_CDN + "'><\/script>" +
            "<script>" +
            "window.onload=function(){" +
              "var cs=document.querySelectorAll('.fmd-barcode-container[data-fmd-raw]');" +
              "cs.forEach(function(el){try{" +
                "var raw=atob(el.getAttribute('data-fmd-raw'));" +
                "var cvs=document.createElement('canvas');" +
                "bwipjs.toCanvas(cvs,{bcid:'datamatrix',text:raw,scale:3,padding:2,parsefnc:true});" +
                "var img=document.createElement('img');" +
                "img.src=cvs.toDataURL('image/png');" +
                "img.style.cssText='width:'+Math.min(cvs.width,120)+'px;height:auto;image-rendering:pixelated;';" +
                "el.appendChild(img);" +
              "}catch(e){}});" +
              "setTimeout(function(){window.print();},300);" +
            "};<\/script>" +
            "<br><button onclick='window.print()' style='padding:12px 28px;font-size:16px;cursor:pointer;border-radius:8px;border:1px solid #ccc;font-weight:600;'>Print / Save PDF</button>" +
            "</body>"
          );
          win.document.write(html);
          win.document.close();
          showToast("Opened in new window for printing", "ok");
        } else {
          showToast("Pop-up blocked — allow pop-ups.", "warn");
        }
      } catch(e2) {
        showToast("Failed to generate receipts: " + (e2 && e2.message), "err");
      }
    }
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────
  function showToast(msg, type) {
    var container = document.getElementById("epos-toast");
    if (!container) return;
    clearTimeout(state.toastTimer);
    var color = type === "ok" ? "#22c55e" : type === "err" ? "#ef4444" : "#f59e0b";
    container.innerHTML = "<div style='background:" + color + ";color:#fff;padding:12px 18px;border-radius:12px;font-size:15px;font-weight:600;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,.4);animation:epos-slide-up .25s ease-out;'>" + esc(msg) + "</div>";
    container.style.display = "flex";
    state.toastTimer = setTimeout(function(){ if(container){ container.style.display="none"; container.innerHTML=""; } }, 4000);
  }

  function updateSyncBadge() {
    var badge = document.getElementById("epos-sync-badge");
    if (!badge) return;
    var n = state.pendingSales.length;
    badge.textContent = n ? String(n) : "";
    badge.style.display = n ? "inline-block" : "none";
  }

  // ─── CSS ─────────────────────────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById("epos-style")) return;
    // Ensure viewport meta prevents zoom on input focus
    if (!document.querySelector('meta[name="viewport"]')) {
      var meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
      document.head.appendChild(meta);
    }
    var style = document.createElement("style");
    style.id = "epos-style";
    style.textContent = [
      /* ── Base / Desktop ─────────────────────────────────────────── */
      ".epos-wrap{display:flex;flex-direction:column;height:100%;font-size:14px;-webkit-tap-highlight-color:transparent;}",
      ".epos-tabs{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.2);flex-shrink:0;}",
      ".epos-tab-btn{padding:6px 16px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);transition:background .15s;}",
      ".epos-tab-btn.active{background:rgba(99,102,241,.75);color:#fff;}",
      ".epos-tab-btn:hover:not(.active){background:rgba(255,255,255,.14);}",
      ".epos-topbar{display:flex;align-items:center;gap:8px;padding:6px 10px;flex-shrink:0;}",
      ".epos-sync-wrap{margin-left:auto;display:flex;align-items:center;gap:6px;}",
      ".epos-badge{background:#ef4444;color:#fff;border-radius:99px;padding:1px 7px;font-size:11px;font-weight:700;display:none;}",
      ".epos-body{flex:1;overflow:hidden;display:flex;}",
      /* POS tab — desktop (default) */
      ".epos-pos{display:flex;width:100%;height:100%;overflow:hidden;position:relative;}",
      ".epos-cart-panel{flex:0 0 380px;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,.08);padding:10px;}",
      ".epos-cart-scroll{flex:1;overflow-y:auto;margin-bottom:8px;}",
      ".epos-cart-empty{color:rgba(255,255,255,.35);text-align:center;padding:28px 16px;font-size:14px;line-height:1.6;}",
      ".epos-cart-line{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;}",
      ".epos-cart-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".epos-cart-fmd{font-size:10px;color:#a5b4fc;margin-top:2px;}",
      ".epos-cart-barcode{font-size:10px;color:rgba(255,255,255,.4);margin-top:1px;font-family:monospace;}",
      ".epos-cart-scan-btn{font-size:10px;padding:2px 8px;margin-top:3px;border-radius:4px;border:1px solid rgba(99,102,241,.4);background:rgba(99,102,241,.12);color:#a5b4fc;cursor:pointer;transition:background .15s;}",
      ".epos-cart-scan-btn:hover,.epos-cart-scan-btn:active{background:rgba(99,102,241,.3);}",
      ".epos-qty-btn{width:28px;height:28px;border-radius:6px;border:none;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:16px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;}",
      ".epos-qty-btn:hover{background:rgba(255,255,255,.22);}",
      ".epos-cart-qty{min-width:28px;text-align:center;font-weight:700;padding:2px 4px;border-radius:4px;border:1px dashed rgba(255,255,255,.2);}",
      ".epos-cart-qty:hover{background:rgba(99,102,241,.15);border-color:#6366f1;}",
      ".epos-cart-price{width:60px;text-align:right;white-space:nowrap;}",
      ".epos-cart-remove{width:28px;height:28px;color:rgba(255,100,100,.7);cursor:pointer;font-size:18px;line-height:1;background:none;border:none;padding:0;flex-shrink:0;display:flex;align-items:center;justify-content:center;}",
      ".epos-cart-remove:hover{color:#ef4444;}",
      ".epos-totals{padding:6px 0;border-top:1px solid rgba(255,255,255,.1);font-size:13px;}",
      ".epos-totals-row{display:flex;justify-content:space-between;padding:2px 0;}",
      ".epos-totals-row.total{font-weight:800;font-size:15px;border-top:1px solid rgba(255,255,255,.15);margin-top:4px;padding-top:5px;}",
      ".epos-payment{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);}",
      ".epos-pay-methods{display:flex;gap:4px;margin-bottom:6px;}",
      ".epos-pay-btn{flex:1;padding:5px 8px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);transition:background .15s,color .15s;}",
      ".epos-pay-btn.active{background:#6366f1;color:#fff;}",
      ".epos-tendered-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:13px;}",
      ".epos-complete-btn{padding:10px;border-radius:8px;border:none;background:#22c55e;color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s,transform .1s;}",
      ".epos-complete-btn:hover{background:#16a34a;}",
      ".epos-complete-btn:active{transform:scale(.97);}",
      ".epos-complete-btn:disabled{background:rgba(255,255,255,.08);color:rgba(255,255,255,.3);cursor:not-allowed;transform:none;}",
      ".epos-search-panel{flex:1;display:flex;flex-direction:column;padding:10px;overflow:hidden;}",
      ".epos-search-bar{display:flex;gap:6px;margin-bottom:8px;flex-shrink:0;}",
      ".epos-product-grid{flex:1;overflow-y:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;align-content:start;}",
      ".epos-product-card{padding:16px 18px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);cursor:pointer;transition:background .12s,border-color .12s,transform .1s;}",
      ".epos-product-card:hover,.epos-product-card:active{background:rgba(99,102,241,.2);border-color:rgba(99,102,241,.5);}",
      ".epos-product-card:active{transform:scale(.97);}",
      ".epos-product-card-name{font-size:15px;font-weight:600;margin-bottom:6px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}",
      ".epos-product-card-price{font-size:17px;color:#a5b4fc;font-weight:700;}",
      ".epos-product-card-barcode{font-size:11px;color:rgba(255,255,255,.35);margin-top:4px;}",
      /* ── Scan overlay ── */
      ".epos-scan-overlay{position:fixed;inset:0;background:rgba(0,0,0,.96);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;}",
      ".epos-scan-video{width:min(560px,96vw);height:min(420px,65vh);border-radius:16px;background:#000;object-fit:cover;border:2px solid rgba(99,102,241,.3);}",
      ".epos-fmd-banner{background:rgba(99,102,241,.18);border:1px solid #6366f1;border-radius:12px;padding:10px 14px;font-size:14px;margin-top:6px;}",
      /* ── Photo OCR overlay ── */
      ".epos-photo-overlay{position:fixed;inset:0;background:rgba(0,0,0,.96);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:20px 12px;gap:10px;overflow-y:auto;}",
      ".epos-photo-video{width:min(560px,96vw);height:min(380px,50vh);border-radius:16px;background:#111;object-fit:cover;border:2px solid rgba(99,102,241,.3);}",
      ".epos-photo-canvas{width:min(560px,96vw);height:min(380px,50vh);border-radius:16px;background:#111;object-fit:cover;display:none;border:2px solid rgba(34,197,94,.4);}",
      ".epos-match-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.07);cursor:pointer;transition:background .15s;border-radius:8px;}",
      ".epos-match-row:hover,.epos-match-row:active{background:rgba(255,255,255,.06);}",
      ".epos-match-bar{height:5px;background:rgba(255,255,255,.1);border-radius:99px;margin:4px 0;overflow:hidden;}",
      ".epos-match-fill{height:100%;background:linear-gradient(90deg,#6366f1,#818cf8);border-radius:99px;}",
      /* ── Overlay buttons (camera screens) ── */
      ".epos-overlay-btn{" +
        "padding:18px 32px;font-size:18px;font-weight:700;border-radius:14px;cursor:pointer;" +
        "color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);" +
        "transition:background .15s,transform .1s,box-shadow .15s;-webkit-tap-highlight-color:transparent;" +
      "}",
      ".epos-overlay-btn:active{transform:scale(.95);}",
      ".epos-overlay-btn-primary{background:linear-gradient(135deg,#6366f1,#4f46e5);border-color:transparent;box-shadow:0 4px 16px rgba(99,102,241,.4);}",
      ".epos-overlay-btn-primary:active{box-shadow:0 2px 8px rgba(99,102,241,.3);}",
      ".epos-overlay-btn-cancel{background:rgba(239,68,68,.15);color:#f87171;border-color:rgba(239,68,68,.3);}",
      ".epos-overlay-btn-cancel:active{background:rgba(239,68,68,.3);}",
      /* ── Animations ── */
      "@keyframes epos-fade-in{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}",
      "@keyframes epos-slide-up{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}",
      "@keyframes epos-pop{0%{transform:scale(.92);opacity:0;}60%{transform:scale(1.02);}100%{transform:scale(1);opacity:1;}}",
      "@keyframes epos-flash-green{0%{background:rgba(34,197,94,.2);}100%{background:transparent;}}",
      "@keyframes epos-badge-pulse{0%{transform:scale(1);}30%{transform:scale(1.25);}100%{transform:scale(1);}}",
      ".epos-anim-flash{animation:epos-badge-pulse .35s ease-out;}",
      /* Overlay open animation */
      ".epos-scan-overlay,.epos-photo-overlay{animation:epos-fade-in .2s ease-out;}",
      /* Product card tap effect */
      ".epos-product-card{position:relative;overflow:hidden;}",
      ".epos-product-card::after{content:'';position:absolute;inset:0;background:rgba(99,102,241,.15);opacity:0;transition:opacity .25s;}",
      ".epos-product-card:active::after{opacity:1;transition:opacity 0s;}",
      /* Cart line enter animation */
      ".epos-cart-line{animation:epos-slide-up .2s ease-out;}",
      /* Button press highlight */
      ".epos-btn::after,.epos-pay-btn::after,.epos-complete-btn::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.08);opacity:0;transition:opacity .2s;pointer-events:none;}",
      ".epos-btn:active::after,.epos-pay-btn:active::after,.epos-complete-btn:active::after{opacity:1;transition:opacity 0s;}",
      ".epos-btn,.epos-pay-btn,.epos-complete-btn{position:relative;overflow:hidden;}",
      /* Catalog tab */
      ".epos-catalog{padding:12px;overflow-y:auto;width:100%;}",
      ".epos-import-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;}",
      ".epos-progress{background:rgba(255,255,255,.1);border-radius:99px;height:8px;margin-top:4px;overflow:hidden;}",
      ".epos-progress-inner{height:100%;background:#6366f1;border-radius:99px;transition:width .3s;}",
      ".epos-catalog-table{width:100%;border-collapse:collapse;font-size:13px;}",
      ".epos-catalog-table th{padding:6px 8px;text-align:left;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.55);font-size:11px;font-weight:600;text-transform:uppercase;}",
      ".epos-catalog-table td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.06);}",
      /* History tab */
      ".epos-history{padding:12px;overflow-y:auto;width:100%;}",
      ".epos-history-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;}",
      ".epos-history-table{width:100%;border-collapse:collapse;font-size:13px;}",
      ".epos-history-table th{padding:6px 8px;text-align:left;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.55);font-size:11px;font-weight:600;text-transform:uppercase;}",
      ".epos-history-table td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:middle;}",
      ".epos-voided{opacity:.4;text-decoration:line-through;}",
      /* Base input & button */
      ".epos-input{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:5px 8px;color:#fff;font-size:13px;outline:none;transition:border-color .15s;}",
      ".epos-input:focus{border-color:#818cf8;box-shadow:0 0 0 2px rgba(99,102,241,.2);}",
      ".epos-btn{padding:5px 12px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:rgba(255,255,255,.1);color:#fff;transition:background .15s,transform .1s;}",
      ".epos-btn:hover{background:rgba(255,255,255,.18);}",
      ".epos-btn:active{transform:scale(.97);}",
      ".epos-btn.primary{background:linear-gradient(135deg,#6366f1,#4f46e5);box-shadow:0 2px 8px rgba(99,102,241,.3);}",
      ".epos-btn.primary:hover{background:linear-gradient(135deg,#818cf8,#6366f1);}",
      ".epos-btn.danger{background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.25);}",
      ".epos-btn.danger:hover{background:rgba(239,68,68,.3);}",
      ".epos-btn.danger:disabled{opacity:.4;cursor:not-allowed;transform:none;}",
      ".epos-btn.sm{padding:3px 8px;font-size:12px;}",
      ".epos-toast{position:fixed;bottom:18px;right:18px;z-index:10000;display:none;}",

      /* ── Cart toggle (hidden on desktop) ── */
      ".epos-cart-toggle{display:none;}",

      /* ══════════════════════════════════════════════════════════════
         MOBILE — .epos-mobile (touch devices / width < 768)
         ══════════════════════════════════════════════════════════════ */

      /* ── Tab bar ── */
      ".epos-mobile .epos-tabs{padding:8px 10px;gap:8px;}",
      ".epos-mobile .epos-tab-btn{padding:16px 8px;font-size:17px;flex:1;text-align:center;border-radius:12px;font-weight:700;}",

      /* ── POS: products on top, cart as bottom sheet ── */
      ".epos-mobile .epos-pos{flex-direction:column-reverse;}",

      /* ── Cart bottom sheet ── */
      ".epos-mobile .epos-cart-panel{" +
        "flex:none;position:fixed;left:0;right:0;bottom:0;z-index:900;" +
        "background:linear-gradient(180deg,rgba(20,22,36,.98) 0%,rgba(10,12,22,.99) 100%);" +
        "border-top:2px solid rgba(99,102,241,.45);" +
        "border-right:none;padding:0;" +
        "max-height:75vh;transition:max-height .3s cubic-bezier(.4,0,.2,1);" +
        "box-shadow:0 -8px 32px rgba(0,0,0,.5);" +
        "border-radius:20px 20px 0 0;" +
      "}",
      ".epos-mobile .epos-cart-panel.collapsed{max-height:60px;overflow:hidden;}",

      /* ── Cart toggle handle ── */
      ".epos-mobile .epos-cart-toggle{" +
        "display:flex;align-items:center;justify-content:space-between;" +
        "padding:16px 20px;cursor:pointer;min-height:60px;gap:10px;" +
      "}",
      ".epos-mobile .epos-cart-toggle::before{" +
        "content:'';position:absolute;top:8px;left:50%;transform:translateX(-50%);" +
        "width:40px;height:4px;border-radius:99px;background:rgba(255,255,255,.2);" +
      "}",
      ".epos-mobile .epos-cart-toggle-left{display:flex;align-items:center;gap:12px;font-weight:700;font-size:18px;}",
      ".epos-mobile .epos-cart-toggle-badge{" +
        "background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;border-radius:99px;" +
        "min-width:30px;height:30px;display:flex;align-items:center;justify-content:center;" +
        "font-size:14px;font-weight:800;box-shadow:0 2px 8px rgba(99,102,241,.4);" +
      "}",
      ".epos-mobile .epos-cart-toggle-chevron{font-size:22px;color:rgba(255,255,255,.45);transition:transform .25s;}",
      ".epos-mobile .epos-cart-panel:not(.collapsed) .epos-cart-toggle-chevron{transform:rotate(180deg);}",
      ".epos-mobile .epos-cart-panel.collapsed .epos-cart-inner-wrap{display:none;}",

      /* ── Cart inner content ── */
      ".epos-mobile .epos-cart-inner-wrap{padding:0 16px 20px;display:flex;flex-direction:column;overflow-y:auto;max-height:calc(75vh - 60px);}",

      /* ── Cart lines — large touch targets ── */
      ".epos-mobile .epos-cart-line{" +
        "padding:14px 0;gap:12px;font-size:16px;" +
        "border-bottom:1px solid rgba(255,255,255,.06);" +
      "}",
      ".epos-mobile .epos-cart-name{font-size:15px;font-weight:500;}",
      ".epos-mobile .epos-cart-scan-btn{font-size:12px;padding:4px 12px;margin-top:4px;}",
      ".epos-mobile .epos-qty-btn{" +
        "width:48px;height:48px;font-size:24px;border-radius:14px;" +
        "background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.25);" +
      "}",
      ".epos-mobile .epos-qty-btn:active{background:rgba(99,102,241,.35);transform:scale(.93);}",
      ".epos-mobile .epos-cart-qty{min-width:44px;font-size:18px;padding:8px 10px;border-radius:10px;}",
      ".epos-mobile .epos-cart-price{width:80px;font-size:16px;font-weight:700;}",
      ".epos-mobile .epos-cart-remove{width:48px;height:48px;font-size:26px;}",
      ".epos-mobile .epos-cart-empty{padding:20px 16px;font-size:16px;}",

      /* ── Totals ── */
      ".epos-mobile .epos-totals{padding:10px 0;font-size:15px;}",
      ".epos-mobile .epos-totals-row{padding:3px 0;}",
      ".epos-mobile .epos-totals-row.total{font-size:18px;padding-top:8px;margin-top:6px;}",

      /* ── Payment section ── */
      ".epos-mobile .epos-payment{margin-top:10px;padding-top:12px;}",
      ".epos-mobile .epos-pay-methods{gap:8px;margin-bottom:12px;}",
      ".epos-mobile .epos-pay-btn{" +
        "padding:16px 8px;font-size:17px;border-radius:14px;font-weight:700;" +
        "background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);" +
      "}",
      ".epos-mobile .epos-pay-btn.active{" +
        "background:linear-gradient(135deg,#6366f1,#4f46e5);" +
        "border-color:transparent;color:#fff;" +
        "box-shadow:0 2px 12px rgba(99,102,241,.35);" +
      "}",

      /* ── Tendered / Discount rows ── */
      ".epos-mobile .epos-tendered-row{font-size:16px;margin-bottom:10px;gap:10px;}",
      ".epos-mobile .epos-tendered-row label{font-weight:600;}",
      ".epos-mobile .epos-tendered-row .epos-input{font-size:18px;padding:12px 14px;border-radius:12px;text-align:right;}",
      ".epos-mobile #epos-change-display{font-size:15px;min-width:90px;}",

      /* ── Action buttons ── */
      ".epos-mobile .epos-cart-actions{display:flex;gap:10px;margin-top:12px;}",
      ".epos-mobile .epos-complete-btn{" +
        "padding:20px;font-size:20px;border-radius:14px;font-weight:800;" +
        "background:linear-gradient(135deg,#22c55e,#16a34a);" +
        "box-shadow:0 4px 16px rgba(34,197,94,.3);" +
        "letter-spacing:.3px;" +
      "}",
      ".epos-mobile .epos-complete-btn:active{transform:scale(.97);box-shadow:0 2px 8px rgba(34,197,94,.2);}",
      ".epos-mobile .epos-complete-btn:disabled{" +
        "background:rgba(255,255,255,.06);box-shadow:none;color:rgba(255,255,255,.25);" +
      "}",
      ".epos-mobile .epos-btn.danger{" +
        "padding:20px 12px;font-size:17px;border-radius:14px;font-weight:700;" +
      "}",

      /* ── Search panel ── */
      ".epos-mobile .epos-search-panel{flex:1;padding:12px;padding-bottom:72px;}",
      ".epos-mobile .epos-search-bar{flex-wrap:wrap;gap:10px;}",
      ".epos-mobile .epos-search-bar .epos-btn{" +
        "padding:18px 10px;font-size:18px;border-radius:14px;flex:1;min-width:0;font-weight:700;" +
      "}",
      ".epos-mobile .epos-search-bar .epos-input{" +
        "font-size:18px;padding:16px 18px;border-radius:14px;width:100%;flex:1 1 100%;" +
        "background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);" +
      "}",

      /* ── Product grid ── */
      ".epos-mobile .epos-product-grid{grid-template-columns:repeat(2,1fr);gap:10px;}",
      ".epos-mobile .epos-product-card{" +
        "padding:16px;border-radius:14px;" +
        "background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);" +
      "}",
      ".epos-mobile .epos-product-card:active{background:rgba(99,102,241,.25);border-color:rgba(99,102,241,.5);transform:scale(.97);}",
      ".epos-mobile .epos-product-card-name{font-size:14px;font-weight:600;margin-bottom:6px;-webkit-line-clamp:2;}",
      ".epos-mobile .epos-product-card-price{font-size:17px;font-weight:800;}",
      ".epos-mobile .epos-product-card-barcode{font-size:11px;margin-top:4px;}",

      /* ── Scan overlay ── */
      ".epos-mobile .epos-scan-video{width:96vw;height:72vh;border-radius:14px;}",
      ".epos-mobile .epos-scan-overlay{gap:14px;padding:14px;}",
      /* ── Photo overlay ── */
      ".epos-mobile .epos-photo-video,.epos-mobile .epos-photo-canvas{width:96vw;height:55vh;border-radius:14px;}",
      ".epos-mobile .epos-match-row{padding:16px 14px;}",
      /* ── Overlay buttons mobile ── */
      ".epos-mobile .epos-overlay-btn{padding:20px 28px;font-size:19px;border-radius:14px;}",

      /* ── FMD banner ── */
      ".epos-mobile .epos-fmd-banner{font-size:14px;padding:12px 16px;border-radius:12px;}",

      /* ── Toast ── */
      ".epos-mobile .epos-toast{bottom:72px;left:12px;right:12px;}",

      /* ── General inputs/buttons — 16px min prevents iOS zoom ── */
      ".epos-mobile .epos-input{font-size:16px;padding:14px 16px;border-radius:12px;}",
      ".epos-mobile .epos-btn{padding:14px 18px;font-size:16px;border-radius:12px;}",
      ".epos-mobile .epos-btn.sm{padding:10px 14px;font-size:15px;border-radius:10px;}",

      /* ── Catalog tab mobile ── */
      ".epos-mobile .epos-catalog{padding:12px;}",
      ".epos-mobile .epos-import-bar{gap:10px;}",
      ".epos-mobile .epos-import-bar .epos-btn{padding:14px 18px;font-size:16px;border-radius:12px;}",
      ".epos-mobile .epos-import-bar .epos-input{font-size:16px;padding:14px 16px;}",
      ".epos-mobile .epos-catalog-table{font-size:13px;}",
      ".epos-mobile .epos-catalog-table th,.epos-mobile .epos-catalog-table td{padding:8px;}",

      /* ── History tab mobile ── */
      ".epos-mobile .epos-history{padding:12px;}",
      ".epos-mobile .epos-history-bar{gap:10px;flex-wrap:wrap;}",
      ".epos-mobile .epos-history-bar .epos-btn{padding:14px 18px;font-size:16px;border-radius:12px;}",
      ".epos-mobile .epos-history-bar .epos-input{font-size:16px;padding:14px 16px;}",
      ".epos-mobile .epos-history-table{font-size:13px;}",
      ".epos-mobile .epos-history-table th,.epos-mobile .epos-history-table td{padding:8px;}",
    ].join("\n");
    document.head.appendChild(style);
  }

  // ─── Render helpers ───────────────────────────────────────────────────────────
  var _mount = null;

  function rerenderCart() {
    var el = document.getElementById("epos-cart-inner");
    if (!el) return;
    el.innerHTML = buildCartHtml();
    var el2 = document.getElementById("epos-cart-totals");
    if (el2) el2.innerHTML = buildTotalsHtml();
    bindCartEvents();
    updateChange();
    // Sync button disabled states with cart
    var completeBtn = document.getElementById("epos-complete-btn");
    if (completeBtn) completeBtn.disabled = !state.cart.length;
    var clearCartBtn = document.getElementById("epos-clear-cart-btn");
    if (clearCartBtn) clearCartBtn.disabled = !state.cart.length;
    // Update mobile cart toggle badge and total
    updateCartToggle();
  }

  function buildCartHtml() {
    if (!state.cart.length) return "<div class='epos-cart-empty'>Cart is empty<br>Scan or search products →</div>";
    return state.cart.map(function(line) {
      var fmdHtml = "";
      if (line.fmdInfo) {
        var f = line.fmdInfo;
        var parts = [];
        if (f.gtin)   parts.push("GTIN: " + esc(f.gtin));
        if (f.batch)  parts.push("Batch: " + esc(f.batch));
        if (f.expiry) parts.push("Exp: " + esc(f.expiry));
        if (f.serial) parts.push("SN: " + esc(f.serial));
        if (parts.length) fmdHtml = "<div class='epos-cart-fmd'>" + parts.join(" &bull; ") + "</div>";
      }
      // Show scanned barcode if different from DB barcode
      var barcodeHtml = "";
      var effectiveBarcode = line.scannedBarcode || (line.fmdInfo && line.fmdInfo.gtin) || line.product.barcode;
      if (effectiveBarcode) {
        barcodeHtml = "<div class='epos-cart-barcode'>" + esc(effectiveBarcode) + "</div>";
      }
      // Scan barcode button
      var scanBtnLabel = (line.scannedBarcode || line.fmdInfo) ? "Re-scan" : "Scan";
      return "<div class='epos-cart-line' data-id='" + esc(line.id) + "'>" +
        "<div style='flex:1;min-width:0'>" +
          "<div class='epos-cart-name'>" + esc(line.product.name) + "</div>" +
          barcodeHtml + fmdHtml +
          "<button class='epos-cart-scan-btn' data-action='scanbarcode' data-id='" + esc(line.id) + "'>" + scanBtnLabel + " Barcode</button>" +
        "</div>" +
        "<button class='epos-qty-btn' data-action='dec' data-id='" + esc(line.id) + "'>−</button>" +
        "<span class='epos-cart-qty' data-action='frac' data-id='" + esc(line.id) + "' style='cursor:pointer;' title='Tap to enter fraction'>" + fmtQty(line.qty) + "</span>" +
        "<button class='epos-qty-btn' data-action='inc' data-id='" + esc(line.id) + "'>+</button>" +
        "<span class='epos-cart-price'>€" + fmt2(line.qty * line.product.price) + "</span>" +
        "<button class='epos-cart-remove' data-action='remove' data-id='" + esc(line.id) + "'>×</button>" +
        "</div>";
    }).join("");
  }

  function buildTotalsHtml() {
    var t = cartTotals();
    return "<div class='epos-totals-row'><span>Subtotal</span><span>€" + fmt2(t.subtotal) + "</span></div>" +
      (t.discountAmt > 0 ? "<div class='epos-totals-row' style='color:#f59e0b;'><span>Discount (" + t.discountPct + "%)</span><span>−€" + fmt2(t.discountAmt) + "</span></div>" : "") +
      "<div class='epos-totals-row total'><span>TOTAL</span><span>€" + fmt2(t.total) + "</span></div>";
  }

  function bindCartEvents() {
    var inner = document.getElementById("epos-cart-inner");
    if (!inner) return;
    inner.querySelectorAll("[data-action]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var action = btn.getAttribute("data-action");
        var id = btn.getAttribute("data-id");
        if (action === "inc") changeQty(id, 1);
        else if (action === "dec") changeQty(id, -1);
        else if (action === "remove") removeFromCart(id);
        else if (action === "frac") showFractionModal(id);
        else if (action === "scanbarcode") startScan(id);
      });
    });
  }

  function updateChange() {
    var el = document.getElementById("epos-change-display");
    if (!el) return;
    var t = cartTotals();
    var tendered = parseFloat(state.payment.tendered) || 0;
    if (state.payment.method === "cash" && tendered > 0) {
      var change = round2(tendered - t.total);
      el.textContent = "Change: €" + fmt2(change >= 0 ? change : 0);
      el.style.color = change < 0 ? "#ef4444" : "#22c55e";
    } else {
      el.textContent = "";
    }
  }

  function filteredCatalog() {
    var q = norm(state.catalogSearch);
    if (!q) return state.catalog;
    return state.catalog.filter(function(p) {
      return norm(p.name).indexOf(q) >= 0 || norm(p.barcode).indexOf(q) >= 0 || norm(p.category).indexOf(q) >= 0;
    });
  }

  function renderFmdResult(gs1) {
    var el = document.getElementById("epos-fmd-banner");
    if (!el) return;
    if (!gs1) { el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = "<strong>FMD Scan</strong> &bull; GTIN: " + esc(gs1.gtin||"?") +
      (gs1.batch  ? " &bull; Batch: " + esc(gs1.batch)   : "") +
      (gs1.expiry ? " &bull; Expiry: " + esc(gs1.expiry) : "") +
      (gs1.serial ? " &bull; Serial: " + esc(gs1.serial) : "") +
      "<span style='color:#f87171;margin-left:8px;'>Product not in catalog</span>";
  }

  // ─── Scan overlay render ──────────────────────────────────────────────────────
  function renderScanOverlay() {
    var overlay = document.createElement("div");
    overlay.id = "epos-scan-overlay";
    overlay.className = "epos-scan-overlay";
    var title = state._scanForCartLine ? "Scan barcode for item" : "Scanning...";
    var hint = "Point camera at barcode or DataMatrix (FMD)";
    overlay.innerHTML =
      "<div style='color:#fff;font-size:20px;font-weight:700;letter-spacing:.3px;'>" + esc(title) + "</div>" +
      "<video id='epos-scan-video' class='epos-scan-video' autoplay muted playsinline></video>" +
      "<button id='epos-scan-stop' class='epos-overlay-btn epos-overlay-btn-cancel'>Cancel Scan</button>" +
      "<div style='color:rgba(255,255,255,.45);font-size:15px;'>" + esc(hint) + "</div>";
    document.body.appendChild(overlay);
    document.getElementById("epos-scan-stop").addEventListener("click", stopScan);
  }

  // ─── Catalog import progress ─────────────────────────────────────────────────
  function renderCatalogImportProgress(pct, msg) {
    var el = document.getElementById("epos-import-progress");
    if (!el) return;
    el.style.display = "";
    el.innerHTML = "<div style='font-size:12px;color:rgba(255,255,255,.6);margin-bottom:4px;'>" + esc(msg) + "</div>" +
      "<div class='epos-progress'><div class='epos-progress-inner' style='width:" + pct + "%'></div></div>";
  }

  // ─── Tab renders ─────────────────────────────────────────────────────────────
  function rerenderPosTab() {
    var el = document.getElementById("epos-pos-body");
    if (!el) return;
    el.innerHTML = buildPosTabHtml();
    bindPosTabEvents();
  }

  function isMobile() {
    // Detect mobile: touch device OR narrow viewport (GoDaddy iframe may report wider width)
    return ("ontouchstart" in window) || (navigator.maxTouchPoints > 0) || window.innerWidth < 768;
  }

  function buildPosTabHtml() {
    var products = filteredCatalog();
    var t = cartTotals();
    var mobileLimit = isMobile() ? 8 : 6;
    return "<div class='epos-pos'>" +
      /* Cart panel — on mobile this is a bottom sheet, starts EXPANDED */
      "<div class='epos-cart-panel' id='epos-cart-panel'>" +
        /* Toggle bar (visible on mobile only) */
        "<div class='epos-cart-toggle' id='epos-cart-toggle'>" +
          "<div class='epos-cart-toggle-left'>" +
            "<span class='epos-cart-toggle-badge' id='epos-cart-badge'>" + state.cart.length + "</span>" +
            "<span>Cart &bull; €<span id='epos-cart-toggle-total'>" + fmt2(t.total) + "</span></span>" +
          "</div>" +
          "<span class='epos-cart-toggle-chevron' id='epos-cart-chevron'>▲</span>" +
        "</div>" +
        /* Inner wrap (collapsible on mobile) */
        "<div class='epos-cart-inner-wrap'>" +
        "<div class='epos-cart-scroll'><div id='epos-cart-inner'>" + buildCartHtml() + "</div></div>" +
        "<div id='epos-cart-totals' class='epos-totals'>" + buildTotalsHtml() + "</div>" +
        "<div class='epos-payment'>" +
          "<div class='epos-pay-methods'>" +
            "<button class='epos-pay-btn" + (state.payment.method==="cash"?" active":"") + "' data-pay='cash'>Cash</button>" +
            "<button class='epos-pay-btn" + (state.payment.method==="card"?" active":"") + "' data-pay='card'>Card</button>" +
            "<button class='epos-pay-btn" + (state.payment.method==="other"?" active":"") + "' data-pay='other'>Other</button>" +
          "</div>" +
          "<div class='epos-tendered-row'>" +
            "<label style='flex:1'>Tendered</label>" +
            "<input id='epos-tendered' class='epos-input' type='number' step='0.01' min='0' placeholder='0.00' value='" + esc(state.payment.tendered) + "' style='width:100px;'>" +
            "<span id='epos-change-display' style='font-weight:700;min-width:90px;text-align:right;'></span>" +
          "</div>" +
          "<div class='epos-tendered-row'>" +
            "<label style='flex:1'>Discount %</label>" +
            "<input id='epos-discount' class='epos-input' type='number' step='0.1' min='0' max='10' placeholder='0' value='" + (state.discount || "") + "' style='width:80px;'>" +
          "</div>" +
          "<div class='epos-cart-actions'>" +
            "<button id='epos-clear-cart-btn' class='epos-btn danger' style='flex:1;'" + (state.cart.length ? "" : " disabled") + ">Clear</button>" +
            "<button id='epos-complete-btn' class='epos-complete-btn' style='flex:2;'" + (state.cart.length ? "" : " disabled") + ">Complete Sale</button>" +
          "</div>" +
        "</div>" +
        "</div>" + /* close epos-cart-inner-wrap */
      "</div>" +
      /* Search / product panel */
      "<div class='epos-search-panel'>" +
        "<div class='epos-search-bar'>" +
          "<button id='epos-scan-btn' class='epos-btn primary'>Scan</button>" +
          "<button id='epos-photo-btn' class='epos-btn' title='Take a photo of the product to search by text'>Photo Search</button>" +
          "<input id='epos-search-input' class='epos-input' placeholder='Search product or barcode…' style='flex:1' value='" + esc(state.catalogSearch) + "'>" +
        "</div>" +
        "<div id='epos-fmd-banner' class='epos-fmd-banner' style='display:none;margin-bottom:8px;'></div>" +
        "<div class='epos-product-grid' id='epos-product-grid'>" +
          products.slice(0, mobileLimit).map(function(p) {
            return "<div class='epos-product-card' data-pid='" + esc(p.id) + "' data-name='" + esc(p.name) + "'>" +
              "<div class='epos-product-card-name'>" + esc(p.name) + "</div>" +
              "<div class='epos-product-card-price'>€" + fmt2(p.price) + "</div>" +
              (p.barcode ? "<div class='epos-product-card-barcode'>" + esc(p.barcode) + "</div>" : "") +
              "</div>";
          }).join("") +
          (products.length > mobileLimit ? "<div style='color:rgba(255,255,255,.4);font-size:12px;padding:8px;grid-column:1/-1;'>Showing " + mobileLimit + " of " + products.length + " — narrow your search</div>" : "") +
          (state.catalog.length === 0 ? "<div style='color:rgba(255,255,255,.4);font-size:13px;padding:24px;grid-column:1/-1;text-align:center;'>No catalog loaded.<br>Go to <strong>Catalog</strong> tab to import products.</div>" : "") +
        "</div>" +
      "</div>" +
      "</div>";
  }

  function toggleCart(forceState) {
    var panel = document.getElementById("epos-cart-panel");
    if (!panel) return;
    if (typeof forceState === "boolean") {
      panel.classList.toggle("collapsed", !forceState);
    } else {
      panel.classList.toggle("collapsed");
    }
  }

  function updateCartToggle() {
    var badge = document.getElementById("epos-cart-badge");
    if (badge) badge.textContent = state.cart.length;
    var tot = document.getElementById("epos-cart-toggle-total");
    if (tot) tot.textContent = fmt2(cartTotals().total);
  }

  function bindPosTabEvents() {
    bindCartEvents();
    updateChange();

    // Cart toggle (mobile bottom sheet)
    var toggleBar = document.getElementById("epos-cart-toggle");
    if (toggleBar) {
      toggleBar.addEventListener("click", function() { toggleCart(); });
    }

    var scanBtn = document.getElementById("epos-scan-btn");
    if (scanBtn) scanBtn.addEventListener("click", startScan);

    var photoBtn = document.getElementById("epos-photo-btn");
    if (photoBtn) photoBtn.addEventListener("click", startPhotoSearch);

    var searchInput = document.getElementById("epos-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function() {
        state.catalogSearch = searchInput.value;
        var grid = document.getElementById("epos-product-grid");
        if (grid) {
          var products = filteredCatalog();
          var ml = isMobile() ? 8 : 6;
          grid.innerHTML = products.slice(0, ml).map(function(p) {
            return "<div class='epos-product-card' data-pid='" + esc(p.id) + "' data-name='" + esc(p.name) + "'>" +
              "<div class='epos-product-card-name'>" + esc(p.name) + "</div>" +
              "<div class='epos-product-card-price'>€" + fmt2(p.price) + "</div>" +
              (p.barcode ? "<div class='epos-product-card-barcode'>" + esc(p.barcode) + "</div>" : "") +
              "</div>";
          }).join("");
          if (!products.length) grid.innerHTML = "<div style='color:rgba(255,255,255,.4);font-size:13px;padding:16px;grid-column:1/-1;'>No results for \"" + esc(state.catalogSearch) + "\"</div>";
          bindProductCardEvents();
        }
      });
      // Also handle Enter in search as manual barcode lookup
      searchInput.addEventListener("keydown", function(ev) {
        if (ev.key === "Enter") {
          var val = searchInput.value.trim();
          if (val) {
            onBarcodeScanned(val);
            searchInput.value = "";
            state.catalogSearch = "";
          }
        }
      });
    }

    bindProductCardEvents();

    var payBtns = document.querySelectorAll("[data-pay]");
    payBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        state.payment.method = btn.getAttribute("data-pay");
        payBtns.forEach(function(b){ b.classList.toggle("active", b === btn); });
        saveCart();
        updateChange();
      });
    });

    var tenderedEl = document.getElementById("epos-tendered");
    if (tenderedEl) {
      tenderedEl.addEventListener("input", function() {
        state.payment.tendered = tenderedEl.value;
        saveCart();
        updateChange();
      });
    }

    var discountEl = document.getElementById("epos-discount");
    if (discountEl) {
      discountEl.addEventListener("input", function() {
        var val = parseFloat(discountEl.value) || 0;
        if (val > 10) { val = 10; discountEl.value = "10"; }
        if (val < 0) { val = 0; discountEl.value = "0"; }
        state.discount = val;
        saveCart();
        rerenderCart();
        updateChange();
      });
    }

    var clearCartBtn = document.getElementById("epos-clear-cart-btn");
    if (clearCartBtn) {
      clearCartBtn.addEventListener("click", function() {
        if (!state.cart.length) return;
        try {
          E.modal.show("Clear Cart", "<div style='font-size:14px;'>Remove all items from cart?</div>", [
            { label: "Cancel", onClick: function(){ E.modal.hide(); } },
            { label: "Clear", danger: true, onClick: function(){ E.modal.hide(); clearCart(); rerenderPosTab(); } }
          ]);
        } catch(e) {
          clearCart();
          rerenderPosTab();
        }
      });
    }

    var completeBtn = document.getElementById("epos-complete-btn");
    if (completeBtn) completeBtn.addEventListener("click", function(){ completeSale(); });
  }

  function findProductByName(name) {
    var n = norm(name);
    for (var i = 0; i < state.catalog.length; i++) {
      if (norm(state.catalog[i].name) === n) return state.catalog[i];
    }
    return null;
  }

  function bindProductCardEvents() {
    var grid = document.getElementById("epos-product-grid");
    if (!grid) return;
    grid.querySelectorAll(".epos-product-card").forEach(function(card) {
      card.addEventListener("click", function() {
        var name = card.getAttribute("data-name");
        var product = findProductByName(name);
        if (product) addToCart(product, 1, null);
      });
    });
  }

  function renderCatalogTab() {
    var el = document.getElementById("epos-tab-body");
    if (!el) return;
    var products = state.catalog;
    var q = norm(state.catalogSearch2);
    var filtered = q ? products.filter(function(p){ return norm(p.name).indexOf(q)>=0 || norm(p.barcode).indexOf(q)>=0; }) : products;

    el.innerHTML = "<div class='epos-catalog'>" +
      "<div class='epos-import-bar'>" +
        "<button id='epos-import-btn' class='epos-btn primary' " + (state.importing?"disabled":"") + ">📥 Import XLSX / CSV</button>" +
        "<span style='font-size:12px;color:rgba(255,255,255,.5);'>" + products.length + " products in catalog</span>" +
        "<input id='epos-cat-search' class='epos-input' placeholder='Search…' style='margin-left:auto;width:180px;' value='" + esc(state.catalogSearch2) + "'>" +
        (products.length ? "<button id='epos-clear-catalog-btn' class='epos-btn danger'>🗑 Clear Catalog</button>" : "") +
      "</div>" +
      "<div id='epos-import-progress' style='display:none;margin-bottom:10px;'></div>" +
      "<div style='font-size:11px;color:rgba(255,255,255,.4);margin-bottom:10px;line-height:1.6;'>" +
        "Import an Excel / CSV file with columns: <em>barcode</em>, <em>name</em>, <em>price</em>, optional: vat_rate, category, unit.<br>" +
        "Column headers are matched automatically (e.g. \"EAN\", \"Description\", \"Retail Price\")." +
      "</div>" +
      (filtered.length ? "<table class='epos-catalog-table'><thead><tr><th>Barcode</th><th>Name</th><th>Price</th><th>Category</th></tr></thead><tbody>" +
        filtered.slice(0,500).map(function(p) {
          var barcodeCell = p.barcode
            ? "<td style='font-family:monospace;font-size:12px;'>" + esc(p.barcode) + "</td>"
            : "<td style='color:rgba(255,255,255,.25);font-size:12px;'>—</td>";
          return "<tr>" + barcodeCell + "<td>" + esc(p.name) + "</td><td>€" + fmt2(p.price) + "</td><td>" + esc(p.category||"") + "</td></tr>";
        }).join("") +
        (filtered.length > 500 ? "<tr><td colspan='4' style='color:rgba(255,255,255,.4);font-size:12px;'>Showing 500 of " + filtered.length + " — narrow search</td></tr>" : "") +
        "</tbody></table>"
      : "<div style='color:rgba(255,255,255,.4);padding:24px;text-align:center;'>No products. Import an XLSX to begin.</div>") +
      "</div>";

    var importBtn = document.getElementById("epos-import-btn");
    if (importBtn) importBtn.addEventListener("click", pickXlsx);

    var clearBtn = document.getElementById("epos-clear-catalog-btn");
    if (clearBtn) clearBtn.addEventListener("click", function() {
      function doClear() {
        apiFetch("/emergency-pos/catalog", { method: "DELETE" }).then(function() {
          state.catalog = [];
          lsSet(LS.CATALOG, []);
          showToast("Catalog cleared.", "ok");
          renderCatalogTab();
        }).catch(function(e){ showToast("Clear failed: " + (e&&e.message), "err"); });
      }
      try {
        E.modal.show("Clear Catalog", "<div style='font-size:13px;'>Clear ALL products from catalog?<br>This cannot be undone.</div>", [
          { label: "Cancel", onClick: function(){ E.modal.hide(); } },
          { label: "Clear All", danger: true, onClick: function(){ E.modal.hide(); doClear(); } }
        ]);
      } catch(e) {
        // Fallback if modal unavailable
        if (window.confirm("Clear ALL products from catalog? This cannot be undone.")) doClear();
      }
    });

    var catSearch = document.getElementById("epos-cat-search");
    if (catSearch) catSearch.addEventListener("input", function() {
      state.catalogSearch2 = catSearch.value;
      renderCatalogTab();
    });
  }

  function renderHistoryTab() {
    var el = document.getElementById("epos-tab-body");
    if (!el) return;
    var pending = state.pendingSales.length;
    var isToday = state.salesDate === todayYmd();
    el.innerHTML = "<div class='epos-history'>" +
      "<div class='epos-history-bar'>" +
        "<input id='epos-history-date' class='epos-input' type='date' value='" + esc(state.salesDate) + "'>" +
        (!isToday ? "<button id='epos-history-today-btn' class='epos-btn'>Today</button>" : "") +
        (state.sales.length ? "<button id='epos-print-day-btn' class='epos-btn primary'>Print Receipts</button>" : "") +
        "<span style='margin-left:auto;'></span>" +
        (pending ? "<span style='font-size:13px;color:#f59e0b;font-weight:700;'>" + pending + " pending</span>" : "") +
      "</div>" +
      (state.sales.length ? "<table class='epos-history-table'><thead><tr><th>Time</th><th>Receipt</th><th>Items</th><th>Total</th><th>Pay</th><th></th></tr></thead><tbody>" +
        state.sales.map(function(s) {
          var items;
          try { items = JSON.parse(s.items_json); } catch(e){ items = []; }
          var itemSummary = items.slice(0,3).map(function(it){ return esc(it.name); }).join(", ") + (items.length>3?" +more":"");
          var voided = s.voided === 1;
          return "<tr" + (voided?" class='epos-voided'":"") + ">" +
            "<td style='white-space:nowrap'>" + esc(fmtTime(s.created_at)) + "</td>" +
            "<td style='font-family:monospace;font-size:12px;'>" + esc(s.receipt_no) + "</td>" +
            "<td style='max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;'>" + itemSummary + "</td>" +
            "<td>€" + fmt2(s.total) + "</td>" +
            "<td>" + esc(s.payment_method) + "</td>" +
            "<td style='white-space:nowrap;'>" +
              (voided ? "<span style='color:#f87171;font-size:11px;'>Voided</span>" :
                "<button class='epos-btn sm danger' data-void='" + s.id + "'>Void</button>") +
            "</td></tr>";
        }).join("") +
        "</tbody></table>"
      : "<div style='color:rgba(255,255,255,.4);padding:24px;text-align:center;'>No sales on " + esc(state.salesDate) + ".</div>") +
      "</div>";

    var dateEl = document.getElementById("epos-history-date");
    if (dateEl) dateEl.addEventListener("change", function() {
      state.salesDate = dateEl.value;
      apiLoadSales(state.salesDate).then(function(){ rerenderHistoryTab(); });
    });

    var todayBtn = document.getElementById("epos-history-today-btn");
    if (todayBtn) todayBtn.addEventListener("click", function() {
      state.salesDate = todayYmd();
      apiLoadSales(state.salesDate).then(function(){ rerenderHistoryTab(); });
    });

    // Print Day's Receipts button
    var printDayBtn = document.getElementById("epos-print-day-btn");
    if (printDayBtn) printDayBtn.addEventListener("click", printDayReceipts);

    // Void buttons
    el.querySelectorAll("[data-void]").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var id = Number(btn.getAttribute("data-void"));
        try {
          E.modal.show("Void Sale", "<div style='font-size:13px;'><p>Enter reason for voiding this sale:</p><input id='epos-void-reason' class='epos-input' style='width:100%;margin-top:6px;' placeholder='Reason...'></div>", [
            { label: "Cancel", onClick: function(){ E.modal.hide(); } },
            { label: "Void Sale", danger: true, onClick: function(){
              var reason = (document.getElementById("epos-void-reason")||{}).value || "";
              E.modal.hide();
              apiFetch("/emergency-pos/sales/" + id, {
                method: "DELETE",
                body: JSON.stringify({ reason: reason })
              }).then(function() {
                showToast("Sale voided.", "ok");
                apiLoadSales(state.salesDate).then(function(){ rerenderHistoryTab(); });
              }).catch(function(e){ showToast("Void failed: " + (e&&e.message), "err"); });
            }}
          ]);
        } catch(e) {
          var reason = prompt("Reason for voiding this sale:");
          if (reason === null) return;
          apiFetch("/emergency-pos/sales/" + id, {
            method: "DELETE",
            body: JSON.stringify({ reason: reason })
          }).then(function() {
            showToast("Sale voided.", "ok");
            apiLoadSales(state.salesDate).then(function(){ rerenderHistoryTab(); });
          }).catch(function(e2){ showToast("Void failed: " + (e2&&e2.message), "err"); });
        }
      });
    });
  }

  function rerenderHistoryTab() {
    if (state.tab !== "history") return;
    renderHistoryTab();
  }

  // ─── Main render ─────────────────────────────────────────────────────────────
  async function render(ctx) {
    _mount = ctx.mount;
    injectCss();
    loadCart();
    loadPending();

    // Shell
    var mobileClass = isMobile() ? " epos-mobile" : "";
    _mount.innerHTML =
      "<div class='epos-wrap" + mobileClass + "' id='epos-wrap'>" +
        "<div class='epos-tabs'>" +
          "<button class='epos-tab-btn" + (state.tab==="pos"?" active":"") + "' data-tab='pos'>POS</button>" +
          "<button class='epos-tab-btn" + (state.tab==="catalog"?" active":"") + "' data-tab='catalog'>Catalog</button>" +
          "<button class='epos-tab-btn" + (state.tab==="history"?" active":"") + "' data-tab='history'>Receipts</button>" +
          "<div class='epos-sync-wrap'>" +
            "<span id='epos-sync-badge' class='epos-badge'></span>" +
          "</div>" +
        "</div>" +
        "<div id='epos-tab-body' class='epos-body' style='overflow:hidden;'></div>" +
        "<div id='epos-toast' class='epos-toast'></div>" +
      "</div>";

    // Tab switching
    _mount.querySelectorAll(".epos-tab-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        state.tab = btn.getAttribute("data-tab");
        _mount.querySelectorAll(".epos-tab-btn").forEach(function(b){ b.classList.toggle("active", b === btn); });
        switchTab();
      });
    });

    updateSyncBadge();

    // Load catalog
    await apiLoadCatalog();

    switchTab();

    // Background: auto-sync if we have pending sales
    if (state.pendingSales.length) {
      apiSyncPending().then(function() {
        if (state.tab === "history") {
          apiLoadSales(state.salesDate).then(function(){ rerenderHistoryTab(); });
        }
      });
    }
  }

  async function switchTab() {
    var bodyEl = document.getElementById("epos-tab-body");
    if (!bodyEl) return;

    if (state.tab === "pos") {
      bodyEl.style.overflow = "hidden";
      bodyEl.innerHTML = "<div id='epos-pos-body' style='width:100%;height:100%;'></div>";
      rerenderPosTab();
    } else if (state.tab === "catalog") {
      bodyEl.style.overflow = "auto";
      bodyEl.innerHTML = "";
      renderCatalogTab();
    } else if (state.tab === "history") {
      bodyEl.style.overflow = "auto";
      bodyEl.innerHTML = "";
      await apiLoadSales(state.salesDate);
      renderHistoryTab();
    }
  }

  // ─── Module registration ──────────────────────────────────────────────────────
  E.registerModule({
    id: "emergency-pos",
    title: "Emergency POS",
    icon: "💊",
    order: 35,
    render: render
  });

})();
