/* Emergency POS, new layout: the fallback till for when the main POS is down. Find a product (name or barcode, Enter adds
   it), the basket (quantity, remove), the total with the VAT it includes, take the payment (cash with change, card or
   other, the classic's 0–10 % discount), then the day's sales with their totals, by payment method; a sale can be voided.
   Same endpoints, the same sale body and the same sums as the classic screen (copied from modules.emergencypos.js, which
   exposes nothing to share): cartTotals, round2/round3, the line totals, parseGs1, the item mapping and the offline queue.
   The basket, the queue and the product list live under the classic screen's own localStorage keys, so a sale queued in
   either screen is sent once: the server keeps one sale per offline_id, and a sale is only taken off the queue when the
   server has it. A sale is put on the queue before it is sent (as the classic does), so closing the tab mid-save never
   loses it. If the server refuses it (not a lost connection), the screen looks for it in the day's list: there, it is
   saved; not there, it comes off the queue and the basket stays as it was, and pressing Take again sends the same
   offline_id, so a retry can never make a second sale. A lost connection queues the sale, as in the classic screen.
   Scanning with the camera, photo search, a barcode per line, importing and clearing the product list and printing the
   day's receipts stay in the classic screen. A pharmacy with no product list imports it here, with the classic's own
   reading of the file and the same upload (batches, retries, the first batch replacing the list). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var LS = { CART: "eikon_epos_cart", PENDING: "eikon_epos_pending", CATALOG: "eikon_epos_catalog" }; // the classic screen's keys
  var HITS = 8;
  var S = {
    mount: null, catalog: [], catLoading: false, catNote: "", cart: [], payment: { method: "cash", tendered: "" }, discount: 0,
    q: "", sales: [], date: "", salesLoading: false, salesErr: "", salesSeq: 0, saving: false, err: "", attempt: null, inflight: {},
    syncing: false, syncErr: "", done: null, askClear: false, voidId: null, voidReason: "", voiding: false, voidErr: "", open: null, said: "",
    imp: { busy: false, msg: "", err: "" }, month: "", days: [], daysSeq: 0, daysLoading: false, daysErr: ""
  };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function eur(n) { return "€" + fmt2(n); }
  function show(n) { return E.eur ? E.eur(Number(n) || 0) : eur(n); } // on screen only (thousands comma); never in a sale body

  // ---- the classic screen's helpers and sums, unchanged (modules.emergencypos.js) ----
  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayYmd() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function fmt2(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
  function uid() { return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function lsGet(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // GS1 / FMD DataMatrix (what a scanner types into the search box), as the classic screen reads it
  function parseGs1(raw) {
    if (!raw) return null;
    var s = String(raw);
    s = s.replace(/^\][a-zA-Z]\d/, "");
    if (s.indexOf("(") >= 0) {
      var norm_s = "", re = /\((\d{2,4})\)([^(]*)/g, m, first = true;
      while ((m = re.exec(s)) !== null) { if (!first) norm_s += "\x1d"; norm_s += m[1] + m[2]; first = false; }
      if (norm_s) s = norm_s;
    }
    var GS = "\x1d";
    var result = { gtin: null, expiry: null, batch: null, serial: null, raw: raw };
    var pos = 0;
    while (pos < s.length) {
      if (s[pos] === GS) { pos++; continue; }
      var ai2 = s.substr(pos, 2);
      if (ai2 === "01" && s.length >= pos + 2 + 14) { result.gtin = s.substr(pos + 2, 14); pos += 16; continue; }
      if (ai2 === "17" && s.length >= pos + 2 + 6) { var exp = s.substr(pos + 2, 6); result.expiry = "20" + exp.slice(0, 2) + "-" + exp.slice(2, 4) + "-" + exp.slice(4, 6); pos += 8; continue; }
      if (ai2 === "10") { pos += 2; var end10 = s.indexOf(GS, pos); if (end10 < 0) end10 = s.length; result.batch = s.slice(pos, end10).slice(0, 20); pos = end10; continue; }
      if (ai2 === "21") { pos += 2; var end21 = s.indexOf(GS, pos); if (end21 < 0) end21 = s.length; result.serial = s.slice(pos, end21).slice(0, 20); pos = end21; continue; }
      if (ai2 === "30" && s.length >= pos + 10) { pos += 10; continue; }
      var nextGs = s.indexOf(GS, pos + 2);
      if (nextGs < 0) break;
      pos = nextGs;
    }
    return (result.gtin || result.batch || result.serial) ? result : null;
  }

  function cartTotals() {
    var subtotal = 0, vatTotal = 0;
    S.cart.forEach(function (line) {
      var lineTotal = round2(line.qty * line.product.price);
      subtotal = round2(subtotal + lineTotal);
      var vatRate = Number(line.product.vat_rate) || 0;
      if (vatRate > 0) {
        var vatPart = round2(lineTotal - lineTotal / (1 + vatRate / 100));
        vatTotal = round2(vatTotal + vatPart);
      }
    });
    var discPct = Math.min(10, Math.max(0, Number(S.discount) || 0));
    var discountAmt = round2(subtotal * discPct / 100);
    var total = round2(subtotal - discountAmt);
    vatTotal = round2(vatTotal * (1 - discPct / 100)); // VAT is part of the price; a discount reduces it in proportion
    return { subtotal: subtotal, vatTotal: vatTotal, discountPct: discPct, discountAmt: discountAmt, total: total };
  }
  function fmtQty(q) { q = Number(q) || 0; if (q === Math.floor(q)) return String(q); return q.toFixed(3).replace(/0+$/, ""); }
  function parseFraction(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (s.indexOf("/") >= 0) { var parts = s.split("/"); var num = parseFloat(parts[0]); var den = parseFloat(parts[1]); if (isNaN(num) || isNaN(den) || den === 0) return null; return num / den; }
    var val = parseFloat(s);
    return isNaN(val) ? null : val;
  }
  function addToCart(product, qty, fmdInfo) {
    qty = Math.max(0.001, parseFloat(qty) || 1);
    var existing = null;
    for (var i = 0; i < S.cart.length; i++) { if (S.cart[i].product.barcode === product.barcode) { existing = S.cart[i]; break; } }
    if (existing && !fmdInfo) existing.qty = round3(existing.qty + qty);
    else S.cart.push({ id: uid(), product: product, qty: qty, fmdInfo: fmdInfo || null });
    saveCart();
  }
  function lineById(id) { for (var i = 0; i < S.cart.length; i++) if (S.cart[i].id === id) return S.cart[i]; return null; }
  function setQty(id, q) { var l = lineById(id); if (l) l.qty = round3(Math.max(0.001, q)); saveCart(); }
  function changeQty(id, delta) { var l = lineById(id); if (l) l.qty = round3(Math.max(0.001, l.qty + delta)); saveCart(); }
  function removeFromCart(id) { S.cart = S.cart.filter(function (l) { return l.id !== id; }); saveCart(); }
  function clearCart() { S.cart = []; S.payment = { method: "cash", tendered: "" }; S.discount = 0; saveCart(); }
  function saveCart() { lsSet(LS.CART, { cart: S.cart, payment: S.payment, discount: S.discount }); }
  function loadCart() {
    var saved = lsGet(LS.CART);
    if (saved && Array.isArray(saved.cart)) {
      S.cart = saved.cart;
      S.payment = saved.payment || { method: "cash", tendered: "" };
      S.discount = Math.min(10, Math.max(0, Number(saved.discount) || 0));
    } else { S.cart = []; S.payment = { method: "cash", tendered: "" }; S.discount = 0; }
  }
  function findProduct(barcode) {
    var b = norm(barcode); if (!b) return null;
    for (var i = 0; i < S.catalog.length; i++) { var pb = norm(S.catalog[i].barcode); if (pb && pb === b) return S.catalog[i]; }
    return null;
  }
  function filteredCatalog() {
    var q = norm(S.q); if (!q) return S.catalog;
    return S.catalog.filter(function (p) { return norm(p.name).indexOf(q) >= 0 || norm(p.barcode).indexOf(q) >= 0 || norm(p.category).indexOf(q) >= 0; });
  }

  // ---- the offline queue: always read fresh, so the classic screen's additions are never written over ----
  function pending() { var v = lsGet(LS.PENDING); return Array.isArray(v) ? v : []; }
  function addPending(sale) { var l = pending(); l.push(sale); lsSet(LS.PENDING, l); }
  function removePending(ids) { var drop = {}; ids.forEach(function (i) { drop[i] = 1; }); lsSet(LS.PENDING, pending().filter(function (s) { return !drop[s.offline_id]; })); }

  // ---- server ----
  async function loadCatalog() { // the classic screen's paging, and its copy on this device when the server cannot be reached
    S.catLoading = true; S.catNote = "";
    try {
      var all = [], offset = 0, limit = 2000;
      while (true) {
        var resp = await E.apiFetch("/emergency-pos/catalog?limit=" + limit + "&offset=" + offset, { method: "GET" });
        if (resp && Array.isArray(resp.products)) {
          all = all.concat(resp.products);
          if (resp.next_offset != null && resp.products.length > 0) { offset = resp.next_offset; continue; }
        }
        break;
      }
      if (all.length) { S.catalog = all; lsSet(LS.CATALOG, all); }
      else S.catalog = [];
      emptyNote(!all.length);
    } catch (e) {
      var cached = lsGet(LS.CATALOG);
      if (cached && cached.length) { S.catalog = cached; S.catNote = "The server cannot be reached: using the product list saved on this device."; }
      else S.catNote = "The product list could not be read. Check the connection and open this screen again.";
    }
    S.catLoading = false;
  }
  async function loadSales() {
    var seq = ++S.salesSeq, date = S.date; if (!date) { S.sales = []; S.salesLoading = false; return; } S.salesLoading = true; S.salesErr = "";
    try {
      var r = await E.apiFetch("/emergency-pos/sales?date=" + encodeURIComponent(date), { method: "GET" });
      if (seq !== S.salesSeq) return;
      S.sales = (r && Array.isArray(r.sales)) ? r.sales : [];
    } catch (e) { if (seq !== S.salesSeq) return; S.salesErr = e && e.network ? "The sales cannot be read: no connection." : "The sales could not be read: " + String((e && e.message) || e); }
    S.salesLoading = false;
    E.whenFormIdle(S.mount, paint);
  }
  async function loadDays() {
    var seq = ++S.daysSeq, ym = S.month; S.daysLoading = true; S.daysErr = "";
    try {
      var r = await E.apiFetch("/emergency-pos/days?month=" + encodeURIComponent(ym), { method: "GET" });
      if (seq !== S.daysSeq) return;
      S.days = (r && Array.isArray(r.days)) ? r.days : [];
    } catch (e) { if (seq !== S.daysSeq) return; S.days = []; if (e && Number(e.status) === 404) { S.daysOff = true; S.daysLoading = false; return E.whenFormIdle(S.mount, paint); } S.daysErr = e && e.network ? "The month cannot be read: no connection." : "The month could not be read: " + String((e && e.message) || e); }
    S.daysLoading = false;
    E.whenFormIdle(S.mount, paint);
  }
  async function syncPending() {
    if (S.syncing) return;
    var list = pending().filter(function (s) { return s && s.offline_id && !S.inflight[s.offline_id]; });
    if (!list.length) return;
    S.syncing = true; S.syncErr = ""; paint();
    try {
      var r = await E.apiFetch("/emergency-pos/sales/sync", { method: "POST", body: JSON.stringify({ sales: list }) });
      if (r && Array.isArray(r.results)) {
        var okIds = r.results.filter(function (x) { return x && x.ok; }).map(function (x) { return x.offline_id; });
        removePending(okIds);
        if (okIds.length) E.toast(okIds.length === 1 ? "1 waiting sale sent to the server." : okIds.length + " waiting sales sent to the server.", "success");
        if (okIds.length < list.length) S.syncErr = (list.length - okIds.length) + " could not be sent; they stay on this device.";
      }
    } catch (e) { S.syncErr = e && e.network ? "Still no connection. The sales stay on this device and go when it is back." : "Not sent: " + String((e && e.message) || e) + ". They stay on this device."; }
    S.syncing = false;
    paint();
    loadSales();
  }
  async function landed(sale) { // the server refused the sale: is it there after all?
    try {
      var r = await E.apiFetch("/emergency-pos/sales?date=" + encodeURIComponent(sale.sale_date), { method: "GET", retry: false });
      return ((r && r.sales) || []).some(function (s) { return s && s.offline_id === sale.offline_id; });
    } catch (e) { return null; }
  }

  function sig() { return JSON.stringify([S.cart.map(function (l) { return [l.id, l.qty, l.product.barcode, l.product.price, l.product.vat_rate, l.scannedBarcode || "", l.fmdInfo || null]; }), S.discount, S.payment.method, S.payment.tendered]); }

  async function take() {
    if (S.saving) return;
    keep();
    S.err = ""; S.askClear = false;
    if (!S.cart.length) { S.err = "The basket is empty. Add a product first."; return paint(); }
    var tots = cartTotals();
    var payMethod = S.payment.method || "cash";
    var tendered = parseFloat(S.payment.tendered) || 0;
    var change = payMethod === "cash" ? round2(tendered - tots.total) : 0;
    if (payMethod === "cash" && tendered + 0.005 < tots.total) {
      S.err = (tendered > 0 ? "€" + tendered.toFixed(2) + " is less than the total, €" + tots.total.toFixed(2) + "." : "Write the cash the customer handed over, or press Exact.") + " Nothing was saved.";
      paint(); return focus('[data-k="tendered"]');
    }
    var s0 = sig();
    if (!S.attempt || S.attempt.sig !== s0 || S.attempt.sale_date !== todayYmd()) // the same basket keeps its offline_id, so a retry is the same sale
      S.attempt = { sig: s0, offline_id: uid(), sale_date: todayYmd(), receipt_no: "R-" + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14) };
    var a = S.attempt;
    var items = S.cart.map(function (l) { // the classic screen's lines, unchanged
      var effectiveBarcode = l.scannedBarcode || l.product.barcode;
      if (l.fmdInfo && l.fmdInfo.gtin && !l.scannedBarcode) effectiveBarcode = l.fmdInfo.gtin;
      return { barcode: effectiveBarcode, name: l.product.name, qty: l.qty, price: l.product.price, vat_rate: l.product.vat_rate, line_total: round2(l.qty * l.product.price), fmd: l.fmdInfo || null };
    });
    var sale = {
      offline_id: a.offline_id, sale_date: a.sale_date, receipt_no: a.receipt_no, items: items,
      subtotal: tots.subtotal, vat_total: tots.vatTotal, discount_pct: tots.discountPct, discount_amt: tots.discountAmt, total: tots.total,
      payment_method: payMethod, amount_tendered: payMethod === "cash" ? tendered : null, change_given: payMethod === "cash" ? change : null, notes: ""
    };
    S.saving = true; S.inflight[sale.offline_id] = 1; paint();
    // As the classic screen: the sale goes on the queue first and the stored basket is emptied, so a tab closed now still sends it, once
    addPending(sale);
    lsSet(LS.CART, { cart: [], payment: { method: "cash", tendered: "" }, discount: 0 });
    var outcome = null, failure = null;
    try {
      var r = await E.apiFetch("/emergency-pos/sales", { method: "POST", body: JSON.stringify(sale) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      outcome = "saved";
    } catch (x) {
      if (x && x.network) outcome = "queued"; // no answer: it stays on the queue and is sent when the connection is back
      else if (await landed(sale)) outcome = "saved";
      else { outcome = "failed"; failure = x; }
    }
    delete S.inflight[sale.offline_id];
    if (outcome === "failed") {
      removePending([sale.offline_id]); saveCart(); // not on the server: off the queue, and the basket back as it was
      S.saving = false; S.err = E.saveFailText(failure) + " The basket is kept: press Take again.";
      paint(); return;
    }
    if (outcome === "saved") removePending([sale.offline_id]);
    S.cart = []; S.payment = { method: "cash", tendered: "" }; S.discount = 0; saveCart(); S.attempt = null; S.saving = false;
    if (S.date !== todayYmd()) { var wasMonth = S.month; S.date = todayYmd(); S.month = S.date.slice(0, 7); S.open = null; S.voidId = null; S.sales = []; if (wasMonth !== S.month) { S.days = []; loadDays(); } } // the register shows the day the sale went to
    S.done = { total: sale.total, change: sale.change_given, method: payMethod, receipt: sale.receipt_no, queued: outcome === "queued" };
    S.said = (outcome === "queued" ? "No connection: sale of " : "Sale saved: ") + eur(sale.total) + (payMethod === "cash" ? ", change " + eur(change) : "") + (outcome === "queued" ? ", waiting on this device." : ".");
    E.toast(S.said, outcome === "queued" ? "warning" : "success");
    S.q = ""; paint();
    var dn = window.matchMedia && window.matchMedia("(max-width:600px)").matches && S.mount.querySelector("[data-done]");
    if (dn) { dn.focus({ preventScroll: true }); dn.scrollIntoView({ block: "center" }); } else focus("#epr-q"); // a phone shows the change to hand back; a counter keeps the scanner box ready
    loadSales();
  }

  async function doVoid(id) {
    if (S.voiding) return;
    keep();
    S.voiding = true; S.voidErr = ""; paint();
    try {
      await E.apiFetch("/emergency-pos/sales/" + id, { method: "DELETE", body: JSON.stringify({ reason: S.voidReason || "" }) }); // the classic screen's body
      S.voidId = null; S.voidReason = ""; E.toast("Sale voided.", "success");
    } catch (x) { S.voidErr = E.saveFailText(x).replace(/^Not saved/, "Not voided"); }
    S.voiding = false; paint(); loadSales();
  }

  // ---- drawing ----
  function css() {
    if (document.getElementById("eikon-eposreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-eposreg-css";
    st.textContent =
      ".epr{max-width:880px;margin:0 auto;padding-bottom:8px}" +
      ".epr [hidden]{display:none!important}" +
      ".epr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 12px 0 0;min-height:44px;margin:-8px 0 2px;cursor:pointer}" +
      ".epr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.epr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".epr h2{font-size:17px;font-weight:700;margin:0;letter-spacing:-.01em}" +
      ".epr :is(button,input,select){font:inherit}" +
      ".epr-btn{font-size:14px;font-weight:600;height:36px;padding:0 15px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".epr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.epr-btn:disabled{opacity:.55;cursor:default}" +
      ".epr-btn.red{color:var(--danger)}.epr-btn.big{height:48px;border-radius:14px;font-size:17px;padding:0 18px}" +
      ".epr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      ".epr-wait{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px;padding:12px 14px;border-radius:12px;background:var(--warn-soft,rgba(201,138,18,.13));color:var(--text);font-size:14px}" +
      ".epr-wait b{color:var(--warn,#8A5A08)}.epr-wait .t{flex:1;min-width:200px}" +
      ".epr-grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:18px;align-items:start;margin-top:16px}" +
      ".epr-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px}" +
      ".epr-find{padding:14px}.epr-q{width:100%;box-sizing:border-box;height:46px;border-radius:12px;border:1px solid var(--border);background:var(--bg,transparent);color:var(--text);font-size:17px;padding:0 14px;outline:0}" +
      ".epr-q:focus{border-color:var(--accent)}" +
      ".epr-hits{margin-top:10px;border-top:.5px solid var(--border)}" +
      ".epr-hit{display:flex;width:100%;align-items:center;gap:12px;text-align:left;border:0;border-bottom:.5px solid var(--border);background:none;color:var(--text);padding:11px 4px;cursor:pointer;min-height:48px}" +
      ".epr-hit:hover,.epr-hit.on{background:rgba(118,118,128,.1)}.epr-hit .t{flex:1;min-width:0}.epr-hit b{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".epr-hit span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".epr-hit em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums;font-size:15px}" +
      ".epr-hint{font-size:13px;color:var(--muted);padding:10px 4px 2px}" +
      ".epr-bask{padding:14px 14px 16px;position:sticky;top:12px}" +
      ".epr-bh{display:flex;justify-content:space-between;align-items:center;gap:8px}.epr-bh small{color:var(--muted);font-size:13px}" +
      ".epr-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 10px;padding:10px 0;border-bottom:.5px solid var(--border)}" +
      ".epr-line .n{min-width:0}.epr-line .n b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.epr-line .n span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".epr-line .lt{font-weight:600;font-variant-numeric:tabular-nums;font-size:15px;text-align:right}" +
      ".epr-qty{display:flex;align-items:center;gap:6px;grid-column:1/-1}" +
      ".epr-qty button{width:36px;height:36px;border-radius:18px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:18px;line-height:1;cursor:pointer}.epr-qty button:disabled{opacity:.4;cursor:default}" +
      ".epr-qty input{width:64px;height:36px;box-sizing:border-box;text-align:center;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text);font-size:16px;font-variant-numeric:tabular-nums}" +
      ".epr-qty input:focus{border-color:var(--accent);outline:0}.epr-qty .x{margin-left:auto;width:auto;padding:0 12px;font-size:14px;font-weight:600;color:var(--danger)}" +
      ".epr-empty{color:var(--muted);font-size:14px;padding:18px 0 8px}" +
      ".epr-tot{margin-top:10px;font-size:14px}.epr-tot div{display:flex;justify-content:space-between;padding:3px 0;font-variant-numeric:tabular-nums}.epr-tot .m{color:var(--muted)}" +
      ".epr-big{display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;padding-top:8px;border-top:1px solid var(--border)}" +
      ".epr-big span{font-size:15px;font-weight:600}.epr-big b{font-size:38px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}" +
      ".epr-pay{margin-top:12px}.epr-seg{display:flex;gap:6px}.epr-seg button{flex:1;height:40px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:15px;font-weight:600;cursor:pointer}" +
      ".epr-seg button.on{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".epr-f{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}.epr-f>label{flex:0 0 112px;font-size:15px}" +
      ".epr-f input{flex:1;min-width:90px;height:40px;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text);font-size:17px;padding:0 10px;font-variant-numeric:tabular-nums}" +
      ".epr-f input:focus{border-color:var(--accent);outline:0}" +
      ".epr-chg{display:flex;justify-content:space-between;margin-top:10px;font-size:15px;font-variant-numeric:tabular-nums}.epr-chg b{font-size:20px}" +
      ".epr-err{color:var(--danger);font-size:13.5px;margin-top:10px}" +
      ".epr-acts{display:flex;gap:8px;margin-top:14px}.epr-acts .p{flex:1}" +
      ".epr-done{margin-top:12px;padding:12px 14px;border-radius:12px;background:var(--ok-soft,rgba(28,138,91,.12));font-size:14px}.epr-done b{font-variant-numeric:tabular-nums}" +
      ".epr-done .c{display:block;font-size:24px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}" +
      ".epr-done.q{background:var(--warn-soft,rgba(201,138,18,.13))}" +
      ".epr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:26px 2px 8px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".epr-lab input{font-size:16px;letter-spacing:0;text-transform:none;font-weight:500;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:10px;height:36px;padding:0 10px}" +
      ".epr-sum{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.epr-sum div{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;min-width:0}" +
      ".epr-sum small{display:block;font-size:12px;color:var(--muted)}.epr-sum b{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}.epr-sum .tt{grid-column:span 1}" +
      ".epr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:10px}" +
      ".epr-s{border-top:.5px solid var(--border)}.epr-s:first-child{border-top:0}" +
      ".epr-sr2{display:flex;align-items:center;gap:10px;padding:10px 14px}" +
      ".epr-sb{flex:1;min-width:0;display:flex;align-items:center;gap:12px;text-align:left;border:0;background:none;color:var(--text);padding:2px 0;cursor:pointer}" +
      ".epr-sb .t{flex:1;min-width:0}.epr-sb b{font-size:15px;font-weight:600}.epr-sb span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".epr-sb em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums;font-size:15px}" +
      ".epr-s.vd .epr-sb em{text-decoration:line-through;color:var(--muted)}.epr-vd{font-size:12.5px;font-weight:600;color:var(--danger)}" +
      ".epr-det{padding:0 14px 12px;font-size:13.5px}.epr-det div{display:flex;justify-content:space-between;gap:12px;padding:2px 0;font-variant-numeric:tabular-nums}.epr-det .m{color:var(--muted)}" +
      ".epr-vbox{padding:0 14px 12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}.epr-vbox input{flex:1;min-width:160px;height:36px;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text);font-size:15px;padding:0 10px}" +
      ".epr-vbox input:focus{border-color:var(--accent);outline:0}.epr-vbox .q{flex-basis:100%;font-size:14px}" +
      ".epr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:18px;color:var(--muted);margin-top:10px;font-size:14px}" +
      ".epr-today{display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:0 16px;border-radius:22px;min-height:44px;background:var(--panel2);border:1px solid var(--border);font-size:14px;color:var(--muted);text-decoration:none;box-sizing:border-box}" +
      ".epr-today b{color:var(--text);font-size:17px;font-variant-numeric:tabular-nums}" +
      ".epr-picks{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:10px}" +
      ".epr-pick{display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:4px;min-height:64px;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text);text-align:left;cursor:pointer}" +
      ".epr-pick:hover{border-color:var(--accent)}.epr-pick b{font-size:14.5px;font-weight:600;line-height:1.25;overflow-wrap:anywhere}.epr-pick em{font-style:normal;font-size:14px;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".epr-picks-l{font-size:12.5px;color:var(--muted);margin:12px 4px 0}" +
      ".epr-notes{display:flex;gap:6px;margin-top:8px}.epr-notes button{flex:1;height:40px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:15px;font-weight:600;cursor:pointer;font-variant-numeric:tabular-nums}" +
      ".epr-done h3{margin:0;font-size:20px;font-weight:800;letter-spacing:-.01em}.epr-done p{margin:4px 0 0}" +
      ".epr-done .c{font-size:34px}" +
      ".epr-sum1{margin:4px 4px 0;font-size:14px;color:var(--muted);line-height:1.6}.epr-sum1 b{color:var(--text);font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}" +
      ".epr-month{display:flex;justify-content:space-between;align-items:baseline;margin:12px 2px 8px;font-size:14px;color:var(--muted)}.epr-month b{font-size:20px;color:var(--text);font-variant-numeric:tabular-nums}" +
      ".epr-days{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}.epr-day{border-top:.5px solid var(--border)}.epr-day:first-child{border-top:0}" +
      ".epr-dayb{display:flex;width:100%;align-items:center;gap:12px;text-align:left;border:0;background:none;color:var(--text);padding:12px 16px;min-height:52px;cursor:pointer}" +
      ".epr-dayb .t{flex:1;min-width:0}.epr-dayb b{display:block;font-size:15px;font-weight:600}.epr-dayb .t span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}.epr-dayb em{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums;font-size:16px}" +
      ".epr-dayb:hover{background:rgba(118,118,128,.08)}.epr-day.on>.epr-dayb{background:rgba(118,118,128,.1)}.epr-dayin{padding:4px 12px 14px}" +
      ".epr-note{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}" +
      ".epr :focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:2px}" +
      "@media (max-width:900px){.epr-grid{grid-template-columns:minmax(0,1fr)}.epr-bask{position:static}.epr-sum{grid-template-columns:repeat(2,minmax(0,1fr))}.epr-sum .tt{grid-column:1/-1}}" +
      "@media (max-width:600px){.epr{padding:4px 16px 0}.epr h1{font-size:30px}.epr-f>label{flex-basis:100%}.epr-big b{font-size:34px}" +
      ".epr-btn,.epr-seg button,.epr-f input,.epr-lab input{min-height:44px}.epr-qty button{width:44px;height:44px;border-radius:22px}.epr-qty input{height:44px}.epr-qty .x{width:auto}.epr-notes button{min-height:44px}.epr-pick{min-height:72px}.epr-picks{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .epr-seg button.on{color:#00160E}" +
      "html[data-ui2]:not([data-ui2-visit]) :is(.epr-err,.epr-btn.red,.epr-qty .x,.epr-vd){color:#FF7A72}" +
      "html[data-ui2]:not([data-ui2-visit]) .epr-wait b{color:#FFB340}html[data-ui2]:not([data-ui2-visit]) .epr-hit:hover{background:rgba(118,118,128,.2)}}";
    document.head.appendChild(st);
  }

  function hitsHtml() {
    if (S.catLoading && !S.catalog.length) return '<div class="epr-hint">Opening the product list…</div>';
    if (!S.catalog.length) return importHtml();
    var list = filteredCatalog();
    if (!S.q) return '<div class="epr-hint">' + S.catalog.length + " products. Type a name or a barcode, or scan into this box, then Enter.</div>" + picksHtml();
    if (!list.length) return '<div class="epr-hint">No product matches “' + esc(S.q) + "”.</div>";
    return list.slice(0, HITS).map(function (p, i) {
      return '<button type="button" class="epr-hit' + (i === 0 ? " on" : "") + '" data-act="add" data-i="' + i + '" data-k="hit:' + i + '"><div class="t"><b>' + esc(p.name) + "</b><span>" +
        esc([p.barcode && !/^NOBAR-/.test(p.barcode) ? p.barcode : "", p.category, Number(p.vat_rate) ? "VAT " + p.vat_rate + "%" : ""].filter(Boolean).join(" · ") || " ") + "</span></div><em>" + eur(p.price) + "</em></button>";
    }).join("") + (list.length > HITS ? '<div class="epr-hint">' + HITS + " of " + list.length + ". Type more to narrow it.</div>" : "");
  }

  function basketHtml() {
    var t = cartTotals(), n = S.cart.length;
    var h = '<section class="epr-card epr-bask" aria-labelledby="epr-bh"><div class="epr-bh"><h2 id="epr-bh">Basket</h2><small>' + (n ? n + (n === 1 ? " line" : " lines") : "") + "</small></div>";
    if (!n) h += '<div class="epr-empty">' + (S.done ? "Ready for the next customer." : "Nothing yet. Find a product to add it.") + "</div>";
    S.cart.forEach(function (l) {
      var f = l.fmdInfo, sub = [eur(l.product.price) + " each"];
      if (f && f.batch) sub.push("Batch " + f.batch); if (f && f.expiry) sub.push("Exp " + f.expiry);
      h += '<div class="epr-line"><div class="n"><b>' + esc(l.product.name) + "</b><span>" + esc(sub.join(" · ")) + '</span></div><div class="lt">' + eur(l.qty * l.product.price) + "</div>" +
        '<div class="epr-qty"><button type="button" data-act="dec" data-id="' + esc(l.id) + '" data-k="dec:' + esc(l.id) + '" aria-label="One less ' + esc(l.product.name) + '"' + (l.qty > 1 ? "" : " disabled") + ">−</button>" +
        '<input data-k="qty:' + esc(l.id) + '" data-id="' + esc(l.id) + '" inputmode="decimal" autocomplete="off" value="' + esc(fmtQty(l.qty)) + '" aria-label="Quantity of ' + esc(l.product.name) + ' (a fraction like 1/6 works)">' +
        '<button type="button" data-act="inc" data-id="' + esc(l.id) + '" data-k="inc:' + esc(l.id) + '" aria-label="One more ' + esc(l.product.name) + '">+</button>' +
        '<button type="button" class="x" data-act="rm" data-id="' + esc(l.id) + '" data-k="rm:' + esc(l.id) + '" aria-label="Remove ' + esc(l.product.name) + '">Remove</button></div></div>';
    });
    if (!n) { // nothing to pay for yet: no totals or payment buttons, just the last sale's change if there was one
      if (S.done) h += doneHtml();
      return h + "</section>";
    }
    h += '<div class="epr-tot"><div class="m"><span>Subtotal</span><span data-b="sub">' + eur(t.subtotal) + "</span></div>" +
      '<div class="m" data-b="discrow"' + (t.discountAmt > 0 ? "" : " hidden") + '><span data-b="disclab">Discount ' + t.discountPct + '%</span><span data-b="disc">−' + eur(t.discountAmt) + "</span></div>" +
      '<div class="m"><span>VAT included</span><span data-b="vat">' + eur(t.vatTotal) + "</span></div></div>" +
      '<div class="epr-big"><span>Total</span><b data-b="total">' + eur(t.total) + "</b></div>";
    var cash = S.payment.method === "cash";
    h += '<form class="epr-pay" id="epr-pay" autocomplete="off"><div class="epr-seg" role="group" aria-label="Payment">' +
      [["cash", "Cash"], ["card", "Card"], ["other", "Other"]].map(function (m) { return '<button type="button" data-act="method" data-m="' + m[0] + '" data-k="m:' + m[0] + '" class="' + (S.payment.method === m[0] ? "on" : "") + '" aria-pressed="' + (S.payment.method === m[0]) + '">' + m[1] + "</button>"; }).join("") + "</div>";
    if (cash) h += '<div class="epr-f"><label for="epr-tend">Cash handed €</label><input id="epr-tend" data-k="tendered" inputmode="decimal" placeholder="0.00" value="' + esc(S.payment.tendered) + '"><button type="button" class="epr-btn" data-act="exact" data-k="exact">Exact</button></div>' +
      notesHtml(t.total) +
      '<div class="epr-chg"><span>Change</span><b data-b="change">' + eur(Math.max(0, round2((parseFloat(S.payment.tendered) || 0) - t.total))) + "</b></div>";
    h += '<div class="epr-f"><label for="epr-disc">Discount %</label><input id="epr-disc" data-k="discount" inputmode="decimal" placeholder="0, up to 10" value="' + esc(S.discount ? String(S.discount) : "") + '"></div>';
    if (S.err) h += '<div class="epr-err" role="alert">' + esc(S.err) + "</div>";
    if (S.askClear) h += '<div class="epr-err" role="alert">Empty the basket? Every line is removed.</div><div class="epr-acts"><button type="button" class="epr-btn" data-act="clear-no" data-k="clear-no">Keep it</button><button type="button" class="epr-btn red" data-act="clear-yes" data-k="clear-yes">Empty the basket</button></div>';
    else h += '<div class="epr-acts">' + (n ? '<button type="button" class="epr-btn big" data-act="clear" data-k="clear">Clear</button>' : "") +
      '<button type="submit" class="epr-btn big p" data-k="take"' + (S.saving || !n ? " disabled" : "") + '><span data-b="take">' + (S.saving ? "Saving…" : "Take " + eur(t.total)) + "</span></button></div>";
    h += "</form>";
    return h + "</section>";
  }
  function doneHtml() { // the sale just taken, with the change to hand back
    var d = S.done;
    return '<div class="epr-done' + (d.queued ? " q" : "") + '" data-done data-k="done" tabindex="-1">' + (d.queued ? "<h3>Sale kept on this device</h3><p>No connection. The sale of <b>" + eur(d.total) + "</b> waits here and is sent when the connection is back.</p>" : "<h3>Sale saved</h3><p><b>" + eur(d.total) + "</b> " + esc(d.method) + " · " + esc(d.receipt) + "</p>") +
      (d.method === "cash" && d.change != null ? '<span class="c">Change ' + eur(d.change) + "</span>" : "") + "</div>";
  }

  // Notes the customer may hand over: the next ones at or above the total, one tap fills the cash handed.
  function notesHtml(total) {
    var l = [5, 10, 20, 50, 100].filter(function (n) { return n + 0.005 >= total && n > total + 0.005; }).slice(0, 3);
    if (!l.length) return "";
    return '<div class="epr-notes" role="group" aria-label="Cash handed, one tap">' + l.map(function (n) { return '<button type="button" data-act="note" data-n="' + n + '" data-k="note:' + n + '">€' + n + "</button>"; }).join("") + "</div>";
  }
  // Big buttons for what sells most today (from today's list, already read), or the whole list when it is short.
  function picks() {
    if (S.q || !S.catalog.length) return { l: [] };
    var tally = {}, order = [];
    if (S.date === todayYmd()) S.sales.forEach(function (s) { if (s.voided === 1) return; itemsOf(s).forEach(function (x) { var k = norm(x.barcode); if (!k) return; if (!tally[k]) { tally[k] = 0; order.push(k); } tally[k] += 1; }); });
    var out = order.sort(function (a, b) { return tally[b] - tally[a]; }).map(function (k) { return findProduct(k); }).filter(Boolean).slice(0, 6);
    if (out.length) return { l: out, say: "Sold most today, tap to add" };
    return { l: S.catalog.length <= 12 ? S.catalog.slice() : [], say: "Tap to add" };
  }
  function picksHtml() {
    var r = picks(), l = r.l; if (!l || !l.length) return "";
    return '<div class="epr-picks-l" id="epr-picks-l">' + r.say + '</div><div class="epr-picks" role="group" aria-labelledby="epr-picks-l">' +
      l.map(function (p) { return '<button type="button" class="epr-pick" data-act="pick" data-bc="' + esc(p.barcode) + '" data-k="pick:' + esc(p.barcode) + '"><b>' + esc(p.name) + "</b><em>" + eur(p.price) + "</em></button>"; }).join("") + "</div>";
  }
  function todayLine() {
    var t = todayYmd(), tot = 0, n = 0;
    if (S.date === t) {
      if (S.salesErr || (!S.sales.length && S.salesLoading)) return "";
      var live = S.sales.filter(function (s) { return s.voided !== 1; }); n = live.length; tot = live.reduce(function (a, s) { return a + (Number(s.total) || 0); }, 0);
    } else { // another day is open: today's row of the month read, when it is this month
      if (!E.months.isNow(S.month) || S.daysLoading) return "";
      (S.days || []).forEach(function (d) { if (d.sale_date === t) { n = Number(d.sales) || 0; tot = Number(d.total) || 0; } });
    }
    return '<a class="epr-today" href="#epr-day-l" data-act="to-sales">Today so far <b data-b="todaytop">' + show(tot) + "</b> " + n + (n === 1 ? " sale" : " sales") + "</a>";
  }

  function itemsOf(s) { try { var a = JSON.parse(s.items_json || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function hm(ts) { // the server writes UTC ("2026-11-03 09:12:00"); shown in local time
    var s = String(ts || ""); if (!s) return ""; var d = new Date(/T|Z/.test(s) ? s : s.replace(" ", "T") + "Z"); if (isNaN(d.getTime())) return "";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  // The register: the month bar, then a row per day with sales (today first, always there), each with its total;
  // the open day shows its totals by payment and its sales. Day totals come from one grouped read per month
  // (/emergency-pos/days); the open day's own numbers are added from its list, as before.
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function dayName(d) { // "Today · Mon 9 Nov", "Tuesday 3 November"
    var p = String(d).split("-"), w = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])), DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    if (d === todayYmd()) return "Today · " + DAY[w.getDay()].slice(0, 3) + " " + Number(p[2]) + " " + MON[Number(p[1]) - 1].slice(0, 3);
    return DAY[w.getDay()] + " " + Number(p[2]) + " " + MON[Number(p[1]) - 1];
  }
  function salesHtml() {
    if (S.daysOff) { // a server without the month read: one day at a time, as before
      return '<div class="epr-lab"><span id="epr-day-l" tabindex="-1">' + (S.date === todayYmd() ? esc(dayName(S.date)) : "Sales on " + esc(dayName(S.date))) + '</span><label><span class="epr-sr">Day</span><input type="date" id="epr-day" data-k="day" max="' + esc(todayYmd()) + '" value="' + esc(S.date) + '"></label></div>' + dayBody();
    }
    var h = '<div class="epr-lab"><span id="epr-day-l" tabindex="-1">Sales by day</span></div>' + E.months.bar(S.month, { label: "Emergency POS sales", print: false });
    var days = (S.days || []).slice(), t = todayYmd();
    if (S.date && S.date.slice(0, 7) === S.month) { // the open day's row from its own list (fresh after each sale)
      var live = S.sales.filter(function (x) { return x.voided !== 1; }), row = null;
      days.forEach(function (d) { if (d.sale_date === S.date) row = d; });
      if (!row) { row = { sale_date: S.date }; days.push(row); }
      if (!S.salesLoading || S.sales.length) { row.sales = live.length; row.total = live.reduce(function (a, x) { return a + (Number(x.total) || 0); }, 0); row.voided = S.sales.length - live.length; }
    }
    if (E.months.isNow(S.month) && !days.some(function (d) { return d.sale_date === t; })) days.push({ sale_date: t, sales: 0, total: 0 });
    days.sort(function (a, b) { return String(b.sale_date).localeCompare(String(a.sale_date)); });
    if (S.daysErr && !days.length) return h + '<div class="epr-quiet">' + esc(S.daysErr) + ' <button type="button" class="epr-btn" data-act="reload-days">Try again</button></div>';
    if (S.daysLoading && !days.length) return h + '<div class="epr-quiet">Opening the month…</div>';
    if (!days.length) return h + '<div class="epr-quiet" data-empty>' + esc(E.months.empty(S.month)) + "</div>";
    var mt = days.reduce(function (a, d) { return a + (Number(d.total) || 0); }, 0), mn = days.reduce(function (a, d) { return a + (Number(d.sales) || 0); }, 0);
    h += '<div class="epr-month"><span>' + esc(MON[Number(S.month.slice(5)) - 1]) + ", " + mn + (mn === 1 ? " sale" : " sales") + '</span><b data-b="monthtotal">' + show(mt) + "</b></div>";
    h += '<div class="epr-days">' + days.map(function (d) {
      var open = d.sale_date === S.date, n = Number(d.sales) || 0;
      return '<div class="epr-day' + (open ? " on" : "") + '"><button type="button" class="epr-dayb" data-act="day" data-d="' + esc(d.sale_date) + '" data-k="day:' + esc(d.sale_date) + '" aria-expanded="' + open + '"><span class="t"><b>' + esc(dayName(d.sale_date)) + "</b><span>" + (n ? n + (n === 1 ? " sale" : " sales") : "No sales") + (Number(d.voided) ? " · " + d.voided + " voided" : "") + "</span></span><em" + (open ? ' data-b="daytotal"' : "") + ">" + show(d.total) + "</em></button>" +
        (open ? '<div class="epr-dayin">' + dayBody() + "</div>" : "") + "</div>";
    }).join("") + "</div>";
    return h;
  }
  function dayBody() {
    var h = "";
    if (S.salesErr) return h + '<div class="epr-quiet">' + esc(S.salesErr) + ' <button type="button" class="epr-btn" data-act="reload">Try again</button></div>';
    if (S.salesLoading && !S.sales.length) return h + '<div class="epr-quiet">Opening the sales…</div>';
    if (!S.sales.length) return h + '<div class="epr-quiet">' + (S.date === todayYmd() ? "No sales yet today." : "No sales on this day.") + "</div>"; // no row of €0.00 boxes
    var live = S.sales.filter(function (s) { return s.voided !== 1; });
    var sum = function (l, k) { return l.reduce(function (t, s) { return t + (Number(s[k]) || 0); }, 0); }; // as the classic day report adds them
    var by = function (m) { return sum(live.filter(function (s) { return String(s.payment_method || "") === m; }), "total"); };
    h += '<p class="epr-sum1">' + (S.daysOff ? 'Total <b data-b="daytotal">' + show(sum(live, "total")) + "</b> · " : "") + 'Cash <b data-b="daycash">' + show(by("cash")) + '</b> · card <b data-b="daycard">' + show(by("card")) + '</b> · other <b data-b="dayother">' + show(by("other")) + '</b> · VAT included <b data-b="dayvat">' + show(sum(live, "vat_total")) + "</b></p>";
    h += '<div class="epr-list">' + S.sales.map(function (s) {
      var it = itemsOf(s), vd = s.voided === 1, open = S.open === s.id;
      var names = it.slice(0, 3).map(function (x) { return x.name; }).join(", ") + (it.length > 3 ? " +" + (it.length - 3) + " more" : "");
      var r = '<div class="epr-s' + (vd ? " vd" : "") + '"><div class="epr-sr2"><button type="button" class="epr-sb" data-act="open" data-id="' + s.id + '" data-k="open:' + s.id + '" aria-expanded="' + open + '"><div class="t"><b>' + esc(hm(s.created_at)) + " · " + esc(s.payment_method || "") + "</b><span>" + esc(names || s.receipt_no) + "</span></div><em>" + eur(s.total) + "</em></button>" +
        (vd ? '<span class="epr-vd">Voided</span>' : (S.voidId === s.id ? "" : '<button type="button" class="epr-btn" data-act="void" data-id="' + s.id + '" data-k="void:' + s.id + '" aria-label="Void sale ' + esc(s.receipt_no) + '">Void</button>')) + "</div>";
      if (open) {
        r += '<div class="epr-det">' + it.map(function (x) { return "<div><span>" + esc(fmtQty(x.qty) + " × " + x.name) + "</span><span>" + eur(x.line_total) + "</span></div>"; }).join("") +
          '<div class="m"><span>Subtotal</span><span>' + eur(s.subtotal) + '</span></div><div class="m"><span>VAT included</span><span>' + eur(s.vat_total) + "</span></div><div><b>Total</b><b>" + eur(s.total) + "</b></div>" +
          (s.payment_method === "cash" && s.amount_tendered != null ? '<div class="m"><span>Cash handed · change</span><span>' + eur(s.amount_tendered) + " · " + eur(s.change_given) + "</span></div>" : "") +
          '<div class="m"><span>Receipt</span><span>' + esc(s.receipt_no) + "</span></div>" + (s.notes ? '<div class="m"><span>Note</span><span>' + esc(s.notes) + "</span></div>" : "") +
          (vd && s.voided_reason ? '<div class="m"><span>Why voided</span><span>' + esc(s.voided_reason) + "</span></div>" : "") + "</div>";
      }
      if (S.voidId === s.id && !vd) {
        r += '<div class="epr-vbox"><span class="q">Void this sale of ' + eur(s.total) + "? It stays in the list, crossed out, and is left out of the totals.</span>" +
          '<label class="epr-sr" for="epr-vr">Reason</label><input id="epr-vr" data-k="void-reason" placeholder="Reason, e.g. rung up twice" value="' + esc(S.voidReason) + '">' +
          '<button type="button" class="epr-btn" data-act="void-no" data-k="void-no">Keep</button><button type="button" class="epr-btn red" data-act="void-yes" data-id="' + s.id + '" data-k="void-yes"' + (S.voiding ? " disabled" : "") + ">" + (S.voiding ? "Voiding…" : "Void sale") + "</button>" +
          (S.voidErr ? '<span class="epr-err" role="alert" style="flex-basis:100%;margin:0">' + esc(S.voidErr) + "</span>" : "") + "</div>";
      }
      return r + "</div>";
    }).join("") + "</div>";
    return h;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "eposreg") return; // left before a reply came back: do not draw over the next screen
    var wait = pending(), waitTot = wait.reduce(function (t, s) { return t + (Number(s && s.total) || 0); }, 0);
    var h = '<div class="epr"><button class="epr-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("eposreg")) + '</button>' +
      '<h1>Emergency POS</h1><p class="epr-sub">Sell when the main till is down. A sale with no connection waits on this device and is sent when it is back.</p>' + todayLine();
    if (wait.length) h += '<div class="epr-wait" role="status"><div class="t"><b>' + wait.length + (wait.length === 1 ? " sale" : " sales") + " waiting to send</b> (" + eur(waitTot) + "). They send by themselves when the connection is back." + (S.syncErr ? " " + esc(S.syncErr) : "") + "</div>" +
      '<button type="button" class="epr-btn" data-act="sync" data-k="sync"' + (S.syncing ? " disabled" : "") + ">" + (S.syncing ? "Sending…" : "Send now") + "</button></div>";
    if (S.catNote) h += '<div class="epr-wait" role="status"><div class="t">' + esc(S.catNote) + "</div></div>";
    h += '<div class="epr-grid"><section class="epr-card epr-find" aria-label="Find a product"><label class="epr-sr" for="epr-q">Find a product by name or barcode</label>' +
      '<input type="search" id="epr-q" class="epr-q" data-k="q" placeholder="Name or barcode, then Enter" autocomplete="off" value="' + esc(S.q) + '" aria-controls="epr-hits">' +
      '<div class="epr-hits" id="epr-hits">' + hitsHtml() + "</div></section>" + basketHtml() + "</div>";
    h += salesHtml();
    h += '<p class="epr-note">Camera scanning, photo search, a barcode per line, a new or cleared product list and the day’s receipts are in the <a href="#" data-act="classic">classic screen</a>.</p>' +
      '<div class="epr-sr" role="status" aria-live="polite" id="epr-said">' + esc(S.said) + "</div></div>";
    var ae = document.activeElement, back = ae && m.contains(ae) && ae.getAttribute ? ae.getAttribute("data-k") : null, caret = null;
    if (back) try { caret = typeof ae.selectionStart === "number" ? ae.selectionStart : null; } catch (e) { caret = null; }
    m.innerHTML = h;
    if (back) { var again = m.querySelector('[data-k="' + back + '"]'); if (again && !again.disabled) { again.focus(); if (caret != null) try { again.setSelectionRange(caret, caret); } catch (e) {} } else if (/^(dec|inc|rm|clear)/.test(back)) { var q = m.querySelector("#epr-q"); if (q) q.focus(); } } // a redraw keeps your place
    wire(m);
  }

  // ---- the product list, imported here (the classic Catalog tab's import, unchanged) ----
  // Today lists "Add your products" for a pharmacy whose Emergency POS was opened and had no products.
  function emptyKey() { return "eikon_epos_empty:" + (((E.state && E.state.user) || {}).location_id || ""); }
  function emptyNote(on) { try { if (on) localStorage.setItem(emptyKey(), "1"); else localStorage.removeItem(emptyKey()); } catch (e) {} }
  function importHtml() {
    var I = S.imp;
    return '<div class="epr-hint"><b>To sell, import the product list once.</b> An Excel or CSV file: one column with the product name, and, if you have them, barcode, price, VAT, category and unit.</div>' +
      '<div class="epr-hint" role="status" id="epr-imp-said">' + esc(I.msg) + "</div>" + (I.err ? '<div class="epr-err" role="alert">' + esc(I.err) + "</div>" : "") +
      '<div style="padding:8px 4px 4px"><button type="button" class="epr-btn p" data-act="import" data-k="import"' + (I.busy ? " disabled" : "") + ">" + (I.busy ? "Importing…" : "Import the product list") + "</button></div>";
  }
  function impSay(t) { S.imp.msg = t; var el = S.mount && S.mount.querySelector("#epr-imp-said"); if (el) el.textContent = t; }
  function pickFile() {
    if (S.imp.busy) return;
    var input = document.createElement("input"); input.type = "file"; input.accept = ".xlsx,.xls,.csv"; input.style.display = "none";
    input.addEventListener("change", function () { var file = input.files && input.files[0]; input.remove(); if (file) importFile(file); });
    document.body.appendChild(input); input.click();
  }
  async function importFile(file) {
    var I = S.imp; I.busy = true; I.err = ""; I.msg = "Reading " + file.name + "…"; paint();
    try {
      var XLSX = await E.loadVendor("xlsx");
      var data = await new Promise(function (ok, no) { var r = new FileReader(); r.onload = function (ev) { ok(ev.target.result); }; r.onerror = function () { no(new Error("The file could not be read. Choose it again.")); }; r.readAsArrayBuffer(file); });
      var wb = XLSX.read(data, { type: "array" }), ws = wb.Sheets[wb.SheetNames[0]], rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rows.length) throw new Error("The file has no rows. Check it is the product list and choose it again.");
      var m = mapRows(rows); if (m.err) throw new Error(m.err);
      if (!m.products.length) throw new Error("No row has a product name. Check the file and choose it again.");
      await upload(m.products, file);
      I.busy = false; I.msg = ""; E.toast("Product list imported: " + m.products.length + (m.products.length === 1 ? " product" : " products"), "success");
      await loadCatalog(); paint(); focus("#epr-q");
    } catch (e) {
      I.busy = false; I.msg = ""; I.err = (e && e.status) || (e && e.network) ? E.saveFailText(e) + " The list may be only partly in: import the file again." : String((e && e.message) || e);
      paint(); focus('[data-k="import"]');
    }
  }
  // The classic's column guess, placeholder barcode and rows, unchanged (modules.emergencypos.js mapXlsxRows).
  function mapRows(rows) {
    var keys = Object.keys(rows[0]), headers = keys.map(function (h) { return norm(h); });
    function pick(c) { for (var i = 0; i < c.length; i++) for (var j = 0; j < headers.length; j++) if (headers[j].indexOf(c[i]) >= 0) return keys[j]; return null; }
    var colBarcode = pick(["barcode", "ean", "gtin", "code", "sku", "ref"]), colName = pick(["name", "description", "product", "item", "desc"]), colPrice = pick(["retail", "price", "sell", "sale"]),
      colVat = pick(["vat", "tax"]), colCategory = pick(["category", "cat", "group", "dept"]), colUnit = pick(["unit", "pack", "size", "uom"]);
    if (!colName) return { err: "No column with the product name was found. The columns are: " + keys.join(", ") + ". Name one of them Name or Description and import it again." };
    function toBarcode(v) { if (v == null) return ""; if (typeof v === "number") { if (!isFinite(v)) return ""; return String(Math.trunc(v)); } return String(v).trim(); }
    function pseudoBarcode(name, idx) { var base = String(name || "").trim(); if (!base) base = "ITEM"; var h = 0; for (var i = 0; i < base.length; i++) { h = ((h << 5) - h) + base.charCodeAt(i); h |= 0; } h = Math.abs(h); return "NOBAR-" + String(h) + "-" + String(idx + 1); }
    return { products: rows.map(function (r, idx) {
      var b = colBarcode ? toBarcode(r[colBarcode]) : ""; if (!b) b = pseudoBarcode(r[colName], idx);
      return { barcode: b, name: String(r[colName] || "").trim(), price: parseFloat(r[colPrice] || 0) || 0, vat_rate: parseFloat(r[colVat] || 0) || 0,
        category: colCategory ? String(r[colCategory] || "").trim() : "", unit: colUnit ? String(r[colUnit] || "").trim() : "" };
    }).filter(function (p) { return p.name && p.barcode; }) };
  }
  // The classic upload, unchanged: batches of 250 (halved on a 503 or a worker limit, never under 50), up to six tries
  // each, the first batch replacing the list (wipe), with the same file name, total and batch number in each body.
  async function upload(products, file) {
    var batchSize = 250, minBatchSize = 50, yieldMs = 40, total = products.length, done = 0;
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    if (!total) return;
    impSay("Sending 0 of " + total + "…");
    while (done < total) {
      var end = Math.min(total, done + batchSize), chunk = products.slice(done, end), offset = done, file_name = (file && file.name) ? file.name : "", chunk_index = Math.floor(offset / batchSize) + 1;
      var attempt = 0, lastErr = null;
      while (attempt < 6) {
        try {
          var resp = await E.apiFetch("/emergency-pos/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ products: chunk, wipe: (offset === 0), file_name: file_name, total_rows: total, chunk_index: chunk_index }) });
          if (resp && resp.ok) { done += chunk.length; impSay("Sending " + done + " of " + total + "…"); await sleep(yieldMs); break; }
          throw new Error("Upload failed: unexpected response");
        } catch (err) {
          lastErr = err;
          var st = err && err.status ? Number(err.status) : 0, bt = String((err && (err.bodyText || err.message)) || ""), looksLike1102 = bt.indexOf("Worker exceeded resource limits") >= 0 || bt.indexOf("1102") >= 0;
          var retryable = !st || st === 429 || st === 503 || (st >= 500 && st < 600) || looksLike1102;
          if (!retryable) break;
          if (st === 503 || looksLike1102) { var newSize = Math.max(minBatchSize, Math.floor(batchSize / 2)); if (newSize < batchSize) { batchSize = newSize; end = Math.min(total, done + batchSize); chunk = products.slice(done, end); } }
          attempt += 1; if (attempt >= 6) break;
          var wait2 = Math.min(8000, 500 * Math.pow(2, attempt));
          impSay("The server did not take it. Trying again (" + attempt + " of 5)…"); await sleep(wait2);
        }
      }
      if (done < end) throw lastErr || new Error("Upload failed.");
    }
  }

  // Just the numbers, while typing (no redraw under the fingers)
  function drawTotals() {
    var m = S.mount; if (!m) return;
    var t = cartTotals(), set = function (k, v) { var el = m.querySelector('[data-b="' + k + '"]'); if (el) el.textContent = v; };
    set("sub", eur(t.subtotal)); set("vat", eur(t.vatTotal)); set("total", eur(t.total)); set("disc", "−" + eur(t.discountAmt)); set("disclab", "Discount " + t.discountPct + "%");
    var dr = m.querySelector('[data-b="discrow"]'); if (dr) dr.hidden = !(t.discountAmt > 0);
    set("change", eur(Math.max(0, round2((parseFloat(S.payment.tendered) || 0) - t.total))));
    if (!S.saving) set("take", "Take " + eur(t.total));
  }
  function drawHits() { var el = S.mount && S.mount.querySelector("#epr-hits"); if (el) { el.innerHTML = hitsHtml(); wireHits(el); } }

  function focus(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); if (x && !(document.activeElement && document.activeElement !== document.body && S.mount.contains(document.activeElement) && document.activeElement.matches("input:not(#epr-q)"))) x.focus(); }, 30); }

  function keep() {
    var m = S.mount; if (!m) return;
    var t = m.querySelector('[data-k="tendered"]'); if (t) S.payment.tendered = money(t.value);
    var d = m.querySelector('[data-k="discount"]'); if (d) S.discount = disc(d.value);
    var v = m.querySelector('[data-k="void-reason"]'); if (v) S.voidReason = v.value;
    var q = m.querySelector("#epr-q"); if (q) S.q = q.value;
  }
  function money(raw) { return String(raw || "").replace(/[€\s]/g, "").replace(",", "."); } // a comma, as some keyboards type it; read with parseFloat like the classic
  function disc(raw) { var v = parseFloat(money(raw)) || 0; if (v > 10) v = 10; if (v < 0) v = 0; return v; } // the classic's 0–10 %

  function addHit(i) {
    if (S.saving) return;
    var list = filteredCatalog(), p = list[i]; if (!p) return;
    addToCart(p, 1, null); added(p);
  }
  function added(p) {
    S.q = ""; S.err = ""; S.done = null; S.askClear = false;
    S.said = "Added " + p.name + ". Total " + eur(cartTotals().total) + ".";
    paint(); var q = S.mount.querySelector("#epr-q"); if (q) q.focus();
  }
  function enter() { // a scanned or typed barcode first (as the classic screen's Enter), else the first match
    var raw = String(S.q || "").trim(); if (!raw || S.saving) return;
    var gs1 = parseGs1(raw), product = null;
    if (gs1 && gs1.gtin) product = findProduct(gs1.gtin) || findProduct(gs1.gtin.replace(/^0+/, ""));
    if (!product) product = findProduct(raw);
    if (product) { addToCart(product, 1, gs1); return added(product); }
    var list = filteredCatalog();
    if (list.length) { addToCart(list[0], 1, null); return added(list[0]); }
    S.said = "No product matches " + raw + "."; var sd = S.mount.querySelector("#epr-said"); if (sd) sd.textContent = S.said;
  }

  function wireHits(root) {
    root.querySelectorAll("[data-act=import]").forEach(function (b) { b.addEventListener("click", pickFile); });
    root.querySelectorAll("[data-act=add]").forEach(function (b) {
      b.addEventListener("click", function () { addHit(Number(b.getAttribute("data-i"))); });
      b.addEventListener("keydown", function (ev) {
        var all = Array.prototype.slice.call(root.querySelectorAll("[data-act=add]")), i = all.indexOf(b);
        if (ev.key === "ArrowDown" && all[i + 1]) { ev.preventDefault(); all[i + 1].focus(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); (all[i - 1] || S.mount.querySelector("#epr-q")).focus(); }
      });
    });
    root.querySelectorAll("[data-act=classic]").forEach(function (a) { a.addEventListener("click", classic); });
    root.querySelectorAll("[data-act=pick]").forEach(function (b) { b.addEventListener("click", function () { if (S.saving) return; var p = findProduct(b.getAttribute("data-bc")); if (p) { addToCart(p, 1, null); added(p); } }); });
  }
  function classic(ev) { if (ev) ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "eposreg"); } catch (x) {} E.openClassic("emergency-pos"); }

  function wire(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      var act = b.getAttribute("data-act"); if (act === "add" || act === "pick") return;
      b.addEventListener("click", function (ev) {
        var id = b.getAttribute("data-id");
        if (S.saving && /^(inc|dec|rm|method|exact|note|clear|clear-yes)$/.test(act)) return; // the basket being saved is not changed under it
        if (act === "back") window.location.hash = E.ui2BackHash("eposreg");
        else if (act === "classic") classic(ev);
        else if (act === "inc") { keep(); changeQty(id, 1); S.err = ""; paint(); }
        else if (act === "dec") { keep(); var l = lineById(id); if (l && l.qty > 1) changeQty(id, -1); S.err = ""; paint(); }
        else if (act === "rm") { keep(); removeFromCart(id); S.err = ""; paint(); }
        else if (act === "method") { keep(); S.payment.method = b.getAttribute("data-m"); saveCart(); S.err = ""; paint(); if (S.payment.method === "cash") focus('[data-k="tendered"]'); }
        else if (act === "note") { keep(); S.payment.tendered = fmt2(Number(b.getAttribute("data-n"))); saveCart(); S.err = ""; paint(); focus('[data-k="take"]'); }
        else if (act === "to-sales") {
          ev.preventDefault();
          if (S.date !== todayYmd()) { S.date = todayYmd(); S.open = null; S.voidId = null; S.sales = []; paint(); loadSales(); }
          var dl = S.mount.querySelector("#epr-day-l"); if (dl) { dl.scrollIntoView({ block: "start" }); dl.focus(); }
        }
        else if (act === "exact") { keep(); S.payment.tendered = fmt2(cartTotals().total); saveCart(); S.err = ""; paint(); }
        else if (act === "clear") { keep(); S.askClear = true; paint(); focus('[data-k="clear-no"]'); }
        else if (act === "clear-no") { S.askClear = false; paint(); focus("#epr-q"); }
        else if (act === "clear-yes") { S.askClear = false; clearCart(); S.err = ""; S.attempt = null; paint(); focus("#epr-q"); }
        else if (act === "sync") syncPending();
        else if (act === "reload") loadSales();
        else if (act === "reload-days") loadDays();
        else if (act === "day") { keep(); var dd = b.getAttribute("data-d"); S.open = null; S.voidId = null; if (S.date === dd) { S.date = ""; S.sales = []; paint(); } else { S.date = dd; S.sales = []; paint(); loadSales(); } }
        else if (act === "open") { keep(); S.open = S.open === Number(id) ? null : Number(id); paint(); }
        else if (act === "void") { keep(); S.voidId = Number(id); S.voidReason = ""; S.voidErr = ""; paint(); focus("#epr-vr"); }
        else if (act === "void-no") { var vid = S.voidId; S.voidId = null; S.voidErr = ""; paint(); focus('[data-k="void:' + vid + '"]'); }
        else if (act === "void-yes") doVoid(Number(id));
      });
    });
    wireHits(m.querySelector("#epr-hits"));
    var q = m.querySelector("#epr-q");
    if (q) {
      q.addEventListener("input", function () { S.q = q.value; clearTimeout(S.qT); S.qT = setTimeout(drawHits, 60); });
      q.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); clearTimeout(S.qT); S.q = q.value; enter(); }
        else if (ev.key === "ArrowDown") { var f = m.querySelector("#epr-hits [data-act=add]"); if (f) { ev.preventDefault(); clearTimeout(S.qT); S.q = q.value; drawHits(); f = m.querySelector("#epr-hits [data-act=add]"); if (f) f.focus(); } }
        else if (ev.key === "Escape" && q.value) { ev.preventDefault(); ev.stopPropagation(); q.value = ""; S.q = ""; drawHits(); }
      });
    }
    m.querySelectorAll('.epr-qty input[data-id]').forEach(function (inp) {
      var apply = function () {
        var id = inp.getAttribute("data-id"), l = lineById(id); if (!l || S.saving) return;
        var v = parseFraction(inp.value);
        if (v === null || v <= 0) { inp.value = fmtQty(l.qty); S.said = "Quantity not changed: write a number like 2, 0.5 or 1/6."; var sd = m.querySelector("#epr-said"); if (sd) sd.textContent = S.said; return; }
        if (round3(Math.max(0.001, v)) === l.qty) { inp.value = fmtQty(l.qty); return; }
        keep(); setQty(id, v); S.err = ""; paint();
      };
      inp.addEventListener("change", apply);
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); apply(); } });
    });
    var t = m.querySelector('[data-k="tendered"]');
    if (t) t.addEventListener("input", function () { S.payment.tendered = money(t.value); saveCart(); drawTotals(); });
    var d = m.querySelector('[data-k="discount"]');
    if (d) {
      d.addEventListener("input", function () { S.discount = disc(d.value); saveCart(); drawTotals(); });
      d.addEventListener("change", function () { S.discount = disc(d.value); if (parseFloat(money(d.value)) > 10) d.value = "10"; saveCart(); drawTotals(); });
    }
    var f = m.querySelector("#epr-pay"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); take(); });
    var day = m.querySelector("#epr-day");
    if (day) day.addEventListener("change", function () { if (!/^\d{4}-\d{2}-\d{2}$/.test(day.value)) return; S.date = day.value; S.open = null; S.voidId = null; S.sales = []; paint(); loadSales(); });
    E.months.wire(m, { month: function () { return S.month; }, paint: function () { paint(); },
      go: function (ym) { S.month = ym; S.days = []; S.open = null; S.voidId = null; S.sales = []; S.date = E.months.isNow(ym) ? todayYmd() : ""; paint(); loadDays(); loadSales(); } });
    var vr = m.querySelector("#epr-vr");
    if (vr) vr.addEventListener("input", function () { S.voidReason = vr.value; });
    if (vr) vr.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doVoid(S.voidId); } });
  }

  // Escape: closes what is open (void, clear), otherwise back to its tab (the basket stays on this device)
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape" || ev.defaultPrevented || !E.state || E.state.activeModuleId !== "eposreg" || !S.mount) return;
    if (document.querySelector(".eikon-modal-overlay:not([style*='none'])")) return;
    if (S.voidId != null) { var vid = S.voidId; S.voidId = null; S.voidErr = ""; paint(); focus('[data-k="void:' + vid + '"]'); return; }
    if (S.askClear) { S.askClear = false; paint(); focus("#epr-q"); return; }
    window.location.hash = E.ui2BackHash("eposreg");
  });
  // Back online while the screen is open: send what waits
  window.addEventListener("online", function () { if (E.state && E.state.activeModuleId === "eposreg") syncPending(); });

  async function load() {
    S.salesLoading = true; paint();
    await Promise.all([loadCatalog().then(function () { E.whenFormIdle(S.mount, paint); }), loadSales(), loadDays()]);
    if (pending().length) syncPending(); // as the classic screen does when it opens
  }

  E.registerModule({
    id: "eposreg", title: "Emergency POS", order: 3, icon: "€", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.date = todayYmd(); S.month = S.date.slice(0, 7); S.days = []; S.daysErr = ""; E.months.reset(); S.q = ""; S.err = ""; S.done = null; S.askClear = false; S.voidId = null; S.voidErr = ""; S.open = null; S.said = ""; S.syncErr = "";
      if (!S.saving) { loadCart(); S.attempt = null; }
      if (!S.catalog.length) { var c = lsGet(LS.CATALOG); if (Array.isArray(c)) S.catalog = c; } // something to search at once; the server's list follows
      css(); paint(); focus("#epr-q"); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("eposreg") < 0) E.UI2_DESTINATIONS.push("eposreg");
  if (E.UI2_PARENT) E.UI2_PARENT.eposreg = "money";
})();
