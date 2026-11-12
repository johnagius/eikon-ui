/* Supplier stock, new layout (pharmacy side): what the suppliers on Eikon have in stock right now, with cost, deal,
   retail and margin, and expiry warnings at the pharmacy's own thresholds. Add a line to an order (deal lines go in
   multiples of the deal, as in the classic) or to today's order diary. The order is kept per supplier, in the same saved
   draft the classic screen uses, and sent with the classic's request. Sent orders: what each supplier did with them, and
   Mark as received once shipped (only the status is sent). Reporting a problem with an item, adding it to Returns,
   column choices, sorting and the expiry thresholds stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, view: "stock", products: [], loading: false, error: "", q: "", sup: "", inStock: false,
    red: 6, yellow: 12, cart: {}, draftOk: false, notes: {}, warnId: null, sending: null, saving: false, err: "", busy: {}, diaried: {},
    orders: [], ordLoading: false, ordError: "", ordStatus: "", ordQ: "", open: null, detail: null, detailErr: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MAX = 200;
  var ST = { pending: ["Pending", "warn"], confirmed: ["Confirmed", "info"], shipped: ["Shipped", "info"], received: ["Received", "ok"] };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function eur(n) { return "€" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function low(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function dmy(d) { return d.getDate() + " " + MON[d.getMonth()] + (d.getFullYear() === new Date().getFullYear() ? "" : " " + d.getFullYear()); }
  function when(s) { var d = new Date(String(s || "").replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(String(s || "")) || !/\d\d:\d\d/.test(String(s || "")) ? "" : "Z")); return isNaN(d) ? String(s || "") : dmy(d); }
  function supOf(p) { return p.supplier_name || "Unknown"; } // the classic's grouping
  // the classic's deal rules: a deal line is bought in multiples of "buy"; free stock comes per full multiple
  function deal(p) { var qp = Number(p.qty_purchased) || 1, qf = Number(p.qty_free) || 0; return { qp: qp, qf: qf, on: qp > 1 || qf > 0 }; }
  function snap(p, n) { var d = deal(p), q = Math.max(1, parseInt(n, 10) || 1); if (d.on && q % d.qp !== 0) q = Math.max(d.qp, Math.round(q / d.qp) * d.qp); return q; }
  function freeOf(p, q) { var d = deal(p); return d.on ? Math.floor(q / d.qp) * d.qf : 0; }
  function dealText(p) { var d = deal(p), disc = Number(p.discount_pct) || 0, bits = []; if (d.on) bits.push("Buy " + d.qp + (d.qf > 0 ? " + " + d.qf + " free" : "")); if (disc > 0) bits.push(disc + "% off"); return bits.join(" · "); }
  // the classic's expiry reading: an Excel serial day, DD/MM/YYYY, or anything Date understands
  function expDate(v) {
    if (!v) return null;
    var n = Number(v);
    if (!isNaN(n) && n > 0 && n < 100000 && String(v) === String(n)) { var d = new Date((n - 25569) * 86400000); return isNaN(d.getTime()) ? null : d; }
    var m = String(v).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) { var dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); return isNaN(dt.getTime()) ? null : dt; }
    var d2 = new Date(v); return isNaN(d2.getTime()) ? null : d2;
  }
  function expiry(p) {
    var d = expDate(p.expiry_date); if (!d) return null;
    var days = Math.ceil((d.getTime() - Date.now()) / 864e5), months = (d.getTime() - Date.now()) / (30.44 * 864e5);
    return { d: d, days: days, level: months <= S.red ? "red" : months <= S.yellow ? "yellow" : "" };
  }
  function cartCount() { return Object.keys(S.cart).length; }
  function groups() {
    var g = {}, order = [];
    Object.keys(S.cart).forEach(function (k) { var it = S.cart[k], s = supOf(it.product); if (!g[s]) { g[s] = { name: s, loc: it.product.location_id, items: [] }; order.push(s); } g[s].items.push(it); });
    return order.map(function (s) { return g[s]; });
  }

  function css() {
    if (document.getElementById("eikon-sinreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-sinreg-css";
    st.textContent =
      ".sin{max-width:880px;margin:0 auto;min-width:0}" +
      ".sin-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".sin h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.sin-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".sin-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".sin-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.sin-btn:disabled{opacity:.55;cursor:default}.sin-btn.s{height:30px;padding:0 12px;font-size:13px;border-radius:15px}" +
      ".sin-btn.red{color:var(--danger)}" +
      ".sin-seg{display:flex;gap:2px;margin-top:16px;padding:2px;border-radius:10px;background:rgba(118,118,128,.12);max-width:360px}" +
      ".sin-seg button{flex:1;min-width:0;font:inherit;font-size:14px;font-weight:600;height:32px;border:0;border-radius:8px;background:transparent;color:var(--text);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".sin-seg button[aria-pressed=true]{background:var(--panel2);box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      ".sin-bar{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap;min-width:0}" +
      ".sin-q{flex:1 1 220px;min-width:0;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".sin-sel{flex:0 1 auto;min-width:0;max-width:100%;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 10px}" +
      ".sin-sw{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)}.sin-sw input{width:20px;height:20px;accent-color:var(--accent);margin:0}" +
      ".sin-chips{display:flex;gap:6px;flex-wrap:wrap}.sin-chips button{font:inherit;font-size:13px;font-weight:600;height:30px;padding:0 12px;border-radius:15px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".sin-chips button[aria-pressed=true]{background:var(--text);border-color:var(--text);color:var(--bg,#fff)}" +
      ".sin-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;justify-content:space-between;gap:8px;min-width:0}.sin-lab b{color:var(--text)}" +
      ".sin-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;min-width:0}" +
      ".sin-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:10px 16px;border-top:.5px solid var(--border);min-width:0}.sin-row:first-child{border-top:0}" +
      ".sin-row .t{min-width:0}.sin-row .t b{font-size:15px;font-weight:600;overflow-wrap:anywhere}" +
      ".sin-row .t>span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".sin-row .n{text-align:right;white-space:nowrap}.sin-row .n em{display:block;font-style:normal;font-weight:700;font-size:16px;font-variant-numeric:tabular-nums}.sin-row .n small{font-size:12px;color:var(--muted)}" +
      ".sin-row .a{grid-column:1/-1;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;min-width:0}.sin-row .a .l{margin-right:auto;font-size:13px;color:var(--muted);min-width:0;font-variant-numeric:tabular-nums}" +
      ".sin-pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap;margin:4px 6px 0 0;background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".sin-pill.ok{background:rgba(28,138,91,.14);color:var(--ok)}.sin-pill.bad{background:rgba(215,38,28,.10);color:var(--danger)}.sin-pill.warn{background:rgba(201,138,18,.16);color:var(--warn,#8A5A08)}.sin-pill.info{background:rgba(31,95,216,.10);color:#1F4FB0}" +
      ".sin-pills{display:flex;flex-wrap:wrap}" +
      ".sin-ask{grid-column:1/-1;margin-top:8px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12);font-size:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sin-ask span{flex:1 1 180px;min-width:0}" +
      ".sin-cart{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:4px 16px 12px;margin-bottom:10px;min-width:0}" +
      ".sin-cart .h{display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:10px 0 4px;min-width:0}.sin-cart .h b{font-size:16px;font-weight:700;min-width:0;overflow-wrap:anywhere}.sin-cart .h em{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".sin-line{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:4px 10px;align-items:center;padding:8px 0;border-top:.5px solid var(--border);font-size:14px;min-width:0}" +
      ".sin-line .d{min-width:0;overflow-wrap:anywhere}.sin-line .d small{display:block;color:var(--muted);font-size:12px}.sin-line .c{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}" +
      ".sin-qty{width:64px;box-sizing:border-box;height:34px;border-radius:9px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;text-align:center;padding:0 4px}" +
      ".sin-x{grid-column:1/-1;justify-self:end}" +
      ".sin-tot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--muted);padding:8px 0;border-top:.5px solid var(--border);font-variant-numeric:tabular-nums}" +
      ".sin-notes{width:100%;box-sizing:border-box;min-height:44px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:8px 10px;resize:vertical;display:block}" +
      ".sin-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center}.sin-acts .l{margin-right:auto;font-size:13px;color:var(--muted);flex:1 1 180px;min-width:0}" +
      ".sin-err{color:var(--danger);font-size:13px;margin-top:6px}.sin-note{font-size:12.5px;color:var(--muted);margin:8px 2px 0}" +
      ".sin-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:18px;color:var(--muted);margin-top:14px}" +
      ".sin-ord{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-top:.5px solid var(--border);padding:10px 16px;cursor:pointer;min-width:0}.sin-list>.sin-ord:first-child{border-top:0}" +
      ".sin-ord .h{display:flex;justify-content:space-between;gap:10px;align-items:center;min-width:0}.sin-ord .h b{font-size:15px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".sin-ord span.s{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".sin-det{padding:4px 16px 12px;background:rgba(118,118,128,.06);min-width:0}.sin-det .m{font-size:13.5px;margin:8px 0 0;overflow-wrap:anywhere}" +
      ".sin-det .it{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;padding:8px 0;border-top:.5px solid var(--border);font-size:14px}.sin-det .it:first-of-type{border-top:0}" +
      ".sin-det .it .d{min-width:0;overflow-wrap:anywhere}.sin-det .it .d small{display:block;color:var(--muted);font-size:12px}.sin-det .it .c{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.sin-det .it.gone .d b{text-decoration:line-through;font-weight:500}" +
      ".sin-foot{font-size:12.5px;color:var(--muted);margin-top:14px}.sin-foot a{color:var(--accent)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) :is(.sin-err,.sin-btn.red,.sin-pill.bad){color:#FF7A72}html[data-ui2]:not([data-ui2-visit]) .sin-pill.info{background:rgba(100,181,255,.14);color:#64B5FF}html[data-ui2]:not([data-ui2-visit]) .sin-seg{background:rgba(118,118,128,.24)}html[data-ui2]:not([data-ui2-visit]) .sin-seg button[aria-pressed=true]{background:#636366;color:#fff}html[data-ui2]:not([data-ui2-visit]) .sin-chips button[aria-pressed=true]{background:#fff;border-color:#fff;color:#000}}" +
      "@media (max-width:600px){.sin{padding:4px 16px 0}.sin h1{font-size:32px}.sin-sel{flex:1 1 100%}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".sin-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.sin-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".sin-quiet .sin-btn{margin-top:12px;display:block}" +
      "@media (max-width:600px){.sin-btn,.sin-btn.s{height:44px;border-radius:22px}.sin-seg button{height:44px}.sin-seg{padding:2px}.sin-chips button{height:44px;border-radius:22px}.sin-qty{height:44px}.sin-q,.sin-sel{height:44px}.sin-sw{min-height:44px;display:flex;align-items:center}}";
    document.head.appendChild(st);
  }

  // ── loading ────────────────────────────────────────────────────────────
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.getShared("/supplier-products/inventory", 60000); // shared with the order diary and quotations; a minute old at most
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load supplier stock");
      S.products = (r.entries || []).slice().sort(function (a, b) { var x = low(a.description), y = low(b.description); return x < y ? -1 : x > y ? 1 : 0; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load supplier stock"); }
    S.loading = false;
    if (!S.error) await Promise.all([loadSettings(), loadDraft()]);
    E.whenFormIdle(S.mount, paint);
  }
  async function loadSettings() {
    try { var r = await E.apiFetch("/supplier-products/inventory-settings", { method: "GET" }); var s = (r && r.settings) || {}; S.red = Number(s.expiry_red_months) || 6; S.yellow = Number(s.expiry_yellow_months) || 12; } catch (e) { /* the classic's defaults */ }
  }
  async function loadDraft() {
    try {
      var r = await E.apiFetch("/supplier-orders/cart-draft", { method: "GET" }); var c = (r && r.cart) || {}, out = {};
      Object.keys(c).forEach(function (k) { var it = c[k], p = S.products.find(function (x) { return x.id === it.product_id; }); if (p) out[k] = { product: p, qty: it.qty || 1 }; });
      S.cart = out; S.draftOk = true;
    } catch (e) { S.draftOk = false; } // not read: the order stays on this screen only, so a saved one is never overwritten
  }
  var draftTimer = null;
  function saveDraft() { // the classic's draft: { cart: { id: { product_id, qty } } }, saved a second after the last change
    if (!S.draftOk) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      var minimal = {};
      Object.keys(S.cart).forEach(function (k) { minimal[k] = { product_id: S.cart[k].product.id, qty: S.cart[k].qty }; });
      E.apiFetch("/supplier-orders/cart-draft", { method: "PUT", body: JSON.stringify({ cart: minimal }) }).catch(function () {}); // an emptied order is saved empty, never deleted
    }, 1000);
  }
  async function fetchOrders(status, q) {
    var parts = []; if (status) parts.push("status=" + encodeURIComponent(status)); if (q) parts.push("q=" + encodeURIComponent(q));
    var r = await E.apiFetch("/supplier-orders/sent" + (parts.length ? "?" + parts.join("&") : ""), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load your orders");
    return r.entries || [];
  }
  async function loadOrders() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.ordLoading = true; S.ordError = ""; paint();
    var mine = S.ordStatus + "|" + S.ordQ;
    try { var rows = await fetchOrders(S.ordStatus, S.ordQ.trim()); if (mine !== S.ordStatus + "|" + S.ordQ) return; S.orders = rows; }
    catch (e) { if (!keepView) S.ordError = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load your orders"); }
    S.ordLoading = false;
    if (S.open && !S.orders.some(function (o) { return o.id === S.open; })) { S.open = null; S.detail = null; }
    E.whenFormIdle(S.mount, paint);
  }
  async function openOrder(id) {
    if (S.open === id) { S.open = null; S.detail = null; return paint(); }
    S.open = id; S.detail = null; S.detailErr = ""; S.rp = null; S.ret = null; paint();
    try { var r = await E.apiFetch("/supplier-orders/" + encodeURIComponent(String(id)), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not open the order"); if (S.open === id) S.detail = r; }
    catch (e) { if (S.open === id) S.detailErr = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not open the order"); }
    paint();
  }

  // ── drawing ────────────────────────────────────────────────────────────
  function matches(p) {
    if (S.sup && p.supplier_name !== S.sup) return false;
    if (S.inStock && p.out_of_stock) return false;
    var q = low(S.q); if (!q) return true;
    return [p.description, p.barcode, p.stock_code, p.supplier_name].some(function (v) { return low(v).indexOf(q) >= 0; });
  }
  function rowHtml(p) {
    var oos = !!p.out_of_stock, inCart = S.cart[p.id], ex = oos ? null : expiry(p), dt = dealText(p), id = p.id;
    var pills = '<span class="sin-pill ' + (oos ? "bad" : "ok") + '">' + (oos ? "Out of stock" : "In stock") + "</span>" +
      (ex && ex.level ? '<span class="sin-pill ' + (ex.level === "red" ? "bad" : "warn") + '">' + (ex.days < 0 ? "Expired " : "Expires ") + esc(dmy(ex.d)) + "</span>" : "") +
      (dt ? '<span class="sin-pill">' + esc(dt) + "</span>" : "");
    var meta = [p.supplier_name, p.stock_code ? "Code " + p.stock_code : "", p.barcode].filter(Boolean).join(" · ");
    var margin = Number(p.profit_margin);
    var h = '<div class="sin-row" data-row="' + id + '"><div class="t"><b>' + esc(p.description) + "</b><span>" + esc(meta) + '</span><div class="sin-pills">' + pills + "</div></div>" +
      '<div class="n"><em>' + eur(p.cost_excl_vat) + "</em><small>excl. VAT</small></div>" +
      '<div class="a"><span class="l">Retail ' + eur(p.retail_price) + (isFinite(margin) && (Number(p.retail_price) || 0) > 0 ? " · " + r2(margin).toFixed(0) + "% margin" : "") + "</span>" +
      '<button class="sin-btn s" data-act="diary" data-id="' + id + '" data-f="diary-' + id + '"' + (S.busy["d" + id] ? " disabled" : "") + ' aria-label="Add ' + esc(p.description) + ' to today\'s order diary">' + (S.diaried[id] ? "In diary ✓" : "Diary") + "</button>" +
      (oos ? "" : inCart ? '<button class="sin-btn s" data-act="uncart" data-id="' + id + '" data-f="cart-' + id + '" aria-label="Take ' + esc(p.description) + ' out of the order">In order ✓</button>'
        : '<button class="sin-btn s p" data-act="cart" data-id="' + id + '" data-f="cart-' + id + '" aria-label="Add ' + esc(p.description) + ' to the order">Add to order</button>') + "</div>";
    if (S.warnId === id && ex) h += '<div class="sin-ask" role="alert"><span>' + (ex.days < 0 ? "This expired on " : "This expires on ") + esc(dmy(ex.d)) + (ex.days >= 0 ? ", in " + ex.days + (ex.days === 1 ? " day" : " days") : "") + ". Add it anyway?</span>" +
      '<button class="sin-btn s" data-act="warn-no" data-f="warn-no">Cancel</button><button class="sin-btn s p" data-act="warn-yes" data-id="' + id + '" data-f="warn-yes">Add anyway</button></div>';
    return h + "</div>";
  }
  function cartHtml() {
    var gs = groups(); if (!gs.length) return "";
    var h = '<div class="sin-lab"><span>Your order</span><b>' + cartCount() + (cartCount() === 1 ? " line" : " lines") + "</b></div>";
    if (!S.draftOk) h += '<p class="sin-note">Your saved order could not be read, so this one is kept on this screen only.</p>';
    gs.forEach(function (g) {
      var cost = 0, retail = 0;
      var lines = g.items.map(function (it) {
        var p = it.product, d = deal(p), fr = freeOf(p, it.qty), lc = r2(it.qty * (Number(p.cost_excl_vat) || 0));
        cost += lc; retail += r2((it.qty + fr) * (Number(p.retail_price) || 0));
        return '<div class="sin-line"><div class="d">' + esc(p.description) + "<small>" + esc([eur(p.cost_excl_vat) + " each", d.on ? "in " + d.qp + "s" : "", fr ? "+" + fr + " free" : "", Number(p.discount_pct) > 0 ? Number(p.discount_pct) + "% off" : ""].filter(Boolean).join(" · ")) + "</small></div>" +
          '<input class="sin-qty" data-qty="' + p.id + '" data-f="qty-' + p.id + '" inputmode="numeric" value="' + esc(it.qty) + '" aria-label="How many ' + esc(p.description) + '">' +
          '<span class="c">' + eur(lc) + "</span>" +
          '<button class="sin-btn s red sin-x" data-act="remove" data-id="' + p.id + '" data-f="rm-' + p.id + '" aria-label="Remove ' + esc(p.description) + ' from the order">Remove</button></div>';
      }).join("");
      cost = r2(cost); retail = r2(retail);
      var profit = r2(retail - cost), pct = retail > 0 ? r2(profit / retail * 100) : 0, confirming = S.sending === g.name;
      h += '<div class="sin-cart" data-sup="' + esc(g.name) + '"><div class="h"><b>' + esc(g.name) + "</b><em>" + eur(cost) + "</em></div>" + lines +
        '<div class="sin-tot"><span>Cost ' + eur(cost) + " excl. VAT</span><span>Profit " + eur(profit) + " · " + pct.toFixed(0) + "% margin</span></div>" +
        '<textarea class="sin-notes" data-notes="' + esc(g.name) + '" data-f="notes-' + esc(g.name) + '" rows="2" placeholder="Note for the supplier, e.g. delivery instructions (optional)" aria-label="Note for ' + esc(g.name) + '">' + esc(S.notes[g.name] || "") + "</textarea>" +
        (confirming && S.err ? '<div class="sin-err" role="alert">' + esc(S.err) + "</div>" : "") +
        (confirming
          ? '<div class="sin-acts"><span class="l">Send ' + g.items.length + (g.items.length === 1 ? " line" : " lines") + ", " + eur(cost) + ", to " + esc(g.name) + "? They see it straight away.</span>" +
            '<button class="sin-btn" data-act="send-no" data-f="send-no"' + (S.saving ? " disabled" : "") + '>Cancel</button><button class="sin-btn p" data-act="send-yes" data-sup="' + esc(g.name) + '" data-f="send-yes"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Sending…" : "Send order") + "</button></div>"
          : '<div class="sin-acts"><button class="sin-btn p" data-act="send" data-sup="' + esc(g.name) + '" data-f="send-' + esc(g.name) + '"' + (S.sending ? " disabled" : "") + ">Send order to " + esc(g.name) + "</button></div>") + "</div>";
    });
    return h;
  }
  function stockHtml() {
    var sups = []; S.products.forEach(function (p) { if (p.supplier_name && sups.indexOf(p.supplier_name) < 0) sups.push(p.supplier_name); }); sups.sort();
    var h = cartHtml() + '<div class="sin-bar"><input class="sin-q" id="sin-q" type="search" placeholder="Item, barcode, code or supplier" aria-label="Search supplier stock" value="' + esc(S.q) + '">' +
      (sups.length > 1 ? '<select class="sin-sel" id="sin-sup" aria-label="Supplier"><option value="">All suppliers</option>' + sups.map(function (s) { return '<option value="' + esc(s) + '"' + (S.sup === s ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select>" : "") +
      '<label class="sin-sw"><input type="checkbox" id="sin-ins"' + (S.inStock ? " checked" : "") + "> In stock only</label></div>";
    if (S.loading && !S.products.length) return h + '<div class="sin-quiet">Opening supplier stock…</div>';
    if (S.error) return h + '<div class="sin-quiet" role="alert">' + esc(S.error) + '<button class="sin-btn" data-act="retry">Try again</button></div>';
    if (!S.products.length) return h + '<div class="sin-quiet">No supplier has listed stock on Eikon yet.</div>';
    var rows = S.products.filter(matches);
    if (!rows.length) return h + '<div class="sin-quiet">' + (S.q ? "Nothing matches “" + esc(S.q) + "”." : "Nothing to show with these filters.") + "</div>";
    var inS = rows.filter(function (p) { return !p.out_of_stock; }).length;
    h += '<div class="sin-lab"><span>' + (S.q || S.sup || S.inStock ? "Found" : "All lines") + "</span><b>" + rows.length + (rows.length === 1 ? " line" : " lines") + " · " + inS + " in stock</b></div>";
    h += '<div class="sin-list">' + rows.slice(0, MAX).map(rowHtml).join("") + "</div>";
    if (rows.length > MAX) h += '<p class="sin-note">Showing the first ' + MAX + " of " + rows.length + ". Search to find the rest.</p>";
    return h;
  }
  function detailHtml(o) {
    if (S.detailErr) return '<div class="sin-det"><p class="m">' + esc(S.detailErr) + "</p></div>";
    if (!S.detail) return '<div class="sin-det"><p class="m" style="color:var(--muted)">Opening…</p></div>';
    var d = S.detail, ord = d.order || o, items = d.items || [], fb = {};
    (d.feedbacks || []).forEach(function (f) { fb[f.order_item_id] = f; });
    var late = ord.status === "shipped" || ord.status === "received", q = 0, fr = 0, cost = 0;
    var h = '<div class="sin-det">' + (ord.supplier_notes ? '<p class="m"><b>Supplier:</b> ' + esc(ord.supplier_notes) + "</p>" : "") + (ord.scheduled_delivery_date ? '<p class="m"><b>Expected delivery:</b> ' + esc(niceDay(ord.scheduled_delivery_date)) + "</p>" : "") + (ord.notes ? '<p class="m"><b>Your note:</b> ' + esc(ord.notes) + "</p>" : "");
    var coming = items.filter(function (it) { return !it.unavailable; }).length; // portals (FIN, W40): "1 of 3 lines coming"
    h += '<div style="margin-top:6px">' + items.map(function (it) {
      var gone = !!it.unavailable, f = fb[it.id];
      if (!gone) { q += Number(it.qty_requested) || 0; fr += Number(it.qty_free) || 0; cost += (Number(it.qty_requested) || 0) * (Number(it.cost_excl_vat) || 0); }
      var conf = !gone && late && it.qty_confirmed !== undefined && it.qty_confirmed !== null && Number(it.qty_confirmed) !== Number(it.qty_requested) ? it.qty_confirmed + " confirmed" : "";
      var sub = [it.barcode, gone ? "" : it.notes].filter(Boolean).join(" · ");
      return '<div class="it' + (gone ? " gone" : "") + '"><div class="d"><b>' + esc(it.description) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") +
        (gone ? '<span class="sin-pill bad">Unavailable</span>' : "") + (conf ? '<span class="sin-pill warn">' + esc(conf) + "</span>" : "") +
        (f ? '<span class="sin-pill bad">Reported: ' + esc(f.problem_type) + "</span>" + (f.resolution_status ? '<span class="sin-pill">' + esc(f.resolution_status) + "</span>" : "") : "") +
        (late && !gone && !f && S.rp !== it.id ? '<button class="sin-btn s" data-act="rp" data-id="' + it.id + '" data-f="rp-' + it.id + '" aria-label="' + esc("Report a problem with " + it.description) + '">Report a problem</button>' : "") + "</div>" +
        '<div class="c">× ' + esc(it.qty_requested || 0) + (it.qty_free ? " +" + esc(it.qty_free) : "") + "<br><small style=\"color:var(--muted)\">" + eur(it.cost_excl_vat) + " each</small></div></div>" +
        (S.rp === it.id ? rpHtml(it) : "") + (S.ret && S.ret.id === it.id ? retHtml(ord) : "");
    }).join("") + "</div>";
    h += '<div class="sin-tot"><span>' + q + (q === 1 ? " item" : " items") + (fr ? " (+" + fr + " free)" : "") + (coming < items.length ? " · " + coming + " of " + items.length + " lines coming" : "") + "</span><span>Cost " + eur(cost) + " excl. VAT</span></div>";
    if (ord.status === "shipped") h += '<div class="sin-acts">' + (S.err && S.errFor === o.id ? '<span class="l sin-err" role="alert">' + esc(S.err) + "</span>" : "") + '<button class="sin-btn p" data-act="received" data-id="' + o.id + '" data-f="recv-' + o.id + '"' + (S.busy["r" + o.id] ? " disabled" : "") + ">" + (S.busy["r" + o.id] ? "Saving…" : "Mark as received") + "</button></div>";
    return h + "</div>";
  }
  // portals (FIN, W23): a problem with a delivered line, reported here with the classic Supplier Inventory's request
  // (POST …/items/:id/feedback { problem_type, notes }), then its "Add to Returns?" with the classic's returns body.
  var PROBLEMS = ["Not Received", "Wrong Pick", "Damaged", "Short Quantity", "Other"];
  function niceDay(v) { var m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return String(v || ""); var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] + " " + Number(m[3]) + " " + MON[+m[2] - 1] + (+m[1] === new Date().getFullYear() ? "" : " " + m[1]); }
  function rpHtml(it) {
    return '<form class="sin-ask" id="sin-rp" data-id="' + it.id + '" novalidate style="display:block"><label style="display:block;margin-bottom:6px">What is wrong with ' + esc(it.description) + "? " +
      '<select name="problem_type" class="sin-sel" data-f="rp-type"><option value="">Choose…</option>' + PROBLEMS.map(function (p) { return '<option value="' + esc(p) + '"' + (S.rpType === p ? " selected" : "") + ">" + esc(p.charAt(0) + p.slice(1).toLowerCase()) + "</option>"; }).join("") + "</select></label>" +
      '<label style="display:block;margin-bottom:6px">Note for the supplier <input name="notes" class="sin-sel" data-f="rp-notes" style="width:100%" placeholder="Optional, e.g. box crushed" value="' + esc(S.rpNotes || "") + '"></label>' +
      (S.rpErr ? '<span class="sin-err" role="alert" style="display:block;margin-bottom:6px">' + esc(S.rpErr) + "</span>" : "") +
      '<button type="submit" class="sin-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Sending…" : "Send report") + '</button> <button type="button" class="sin-btn" data-act="rp-no">Cancel</button></form>';
  }
  function retHtml(ord) {
    var r = S.ret;
    return '<div class="sin-ask" role="alert">Reported. Add ' + esc(r.desc) + " to Returns, for " + esc(ord.supplier_name || "the supplier") + "? " +
      '<button class="sin-btn p" data-act="ret-yes" data-f="ret-yes"' + (S.saving ? " disabled" : "") + '>Add to Returns</button><button class="sin-btn" data-act="ret-no">No</button></div>';
  }
  async function report(f) {
    if (S.saving) return;
    var id = Number(f.getAttribute("data-id")), it = ((S.detail && S.detail.items) || []).find(function (x) { return x.id === id; }); if (!it) return;
    var type = f.problem_type.value, notes = f.notes.value || "";
    S.rpType = type; S.rpNotes = notes; S.rpErr = "";
    if (!type) { S.rpErr = "Choose what is wrong. Nothing was sent."; paint(); focusLater('[data-f="rp-type"]'); return; }
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/supplier-orders/items/" + id + "/feedback", { method: "POST", body: JSON.stringify({ problem_type: type, notes: notes }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast("Problem reported for " + it.description, "success");
      S.rp = null; S.ret = { id: id, desc: it.description, type: type, notes: notes, batch: it.batch || "", expiry: it.expiry_date || "", qty: (it.qty_requested || 0) + (it.qty_free ? "+" + it.qty_free : "") };
      var d = await E.apiFetch("/supplier-orders/" + S.open, { method: "GET" }); if (d && d.ok) S.detail = d;
    } catch (x) { S.rpErr = E.saveFailText(x); }
    S.saving = false; paint(); focusLater(S.ret ? '[data-f="ret-yes"]' : '[data-f="rp-type"]');
  }
  function ymdOf(v) { // the classic's toYmd
    if (!v) return ""; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var d = expDate(v); if (!d) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  async function addReturn() {
    var r = S.ret; if (!r || S.saving) return;
    var ord = (S.detail && S.detail.order) || {};
    var body = { entry_date: today(), description: r.desc, supplier: ord.supplier_name, batch: r.batch, expiry: ymdOf(r.expiry), quantity: r.qty, remarks: r.type + (r.notes ? " - " + r.notes : ""), damaged: r.type === "Damaged" ? 1 : 0 };
    S.saving = true; paint();
    try {
      var x = await E.apiFetch("/returns/entries", { method: "POST", body: JSON.stringify(body) });
      if (!x || !x.ok) throw new Error((x && x.error) || "Save failed");
      E.toast(r.desc + " added to Returns", "success"); S.ret = null;
    } catch (e) { E.toast(E.saveFailText(e), "error"); }
    S.saving = false; paint(); focusLater('[data-act="open"][data-id="' + S.open + '"]');
  }
  function ordersHtml() {
    var h = '<div class="sin-bar"><input class="sin-q" id="sin-oq" type="search" placeholder="Supplier, order number or item" aria-label="Search your orders" value="' + esc(S.ordQ) + '"></div>' +
      '<div class="sin-bar"><div class="sin-chips" role="group" aria-label="Status">' + [["", "All"], ["pending", "Pending"], ["shipped", "Shipped"], ["received", "Received"]].map(function (c) { return '<button data-act="status" data-st="' + c[0] + '" data-f="st-' + c[0] + '" aria-pressed="' + (S.ordStatus === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</div></div>";
    if (S.ordLoading && !S.orders.length) return h + '<div class="sin-quiet">Opening your orders…</div>';
    if (S.ordError) return h + '<div class="sin-quiet" role="alert">' + esc(S.ordError) + '<button class="sin-btn" data-act="retry">Try again</button></div>';
    if (!S.orders.length) return h + '<div class="sin-quiet">' + (S.ordQ ? "No order matches “" + esc(S.ordQ) + "”." : S.ordStatus ? "No " + esc(S.ordStatus) + " orders." : "No orders sent to a supplier yet.") + "</div>";
    var shipped = S.orders.filter(function (o) { return o.status === "shipped"; }).length;
    h += '<div class="sin-lab"><span>Sent orders</span><b>' + S.orders.length + (shipped ? " · " + shipped + " on the way" : "") + '</b></div><div class="sin-list">';
    S.orders.slice(0, MAX).forEach(function (o) {
      var st = ST[o.status] || [o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1) : "Unknown", ""], open = S.open === o.id;
      h += '<button class="sin-ord" data-act="open" data-id="' + o.id + '" data-f="ord-' + o.id + '" aria-expanded="' + open + '"><span class="h"><b>#' + esc(o.id) + " · " + esc(o.supplier_name) + '</b><span class="sin-pill ' + st[1] + '" style="margin:0">' + esc(st[0]) + "</span></span>" +
        '<span class="s">' + esc([when(o.created_at), (o.item_count || 0) + ((o.item_count || 0) === 1 ? " item" : " items"), o.items_summary || ""].filter(Boolean).join(" · ")) + "</span></button>";
      if (open) h += detailHtml(o);
    });
    h += "</div>";
    if (S.orders.length > MAX) h += '<p class="sin-note">Showing the newest ' + MAX + " of " + S.orders.length + ". Search to find the rest.</p>";
    return h;
  }

  function keep() {
    var m = S.mount; if (!m) return;
    m.querySelectorAll("textarea[data-notes]").forEach(function (t) { S.notes[t.getAttribute("data-notes")] = t.value; });
  }
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "sinreg") return; // left before a reply came back: do not draw over the next screen
    keep();
    var ae = document.activeElement, fsel = "", caret = null;
    if (ae && m.contains(ae)) {
      if (ae.id) fsel = "#" + ae.id; else if (ae.getAttribute("data-f")) fsel = '[data-f="' + (window.CSS && CSS.escape ? CSS.escape(ae.getAttribute("data-f")) : ae.getAttribute("data-f")) + '"]';
      try { if (ae.selectionStart != null) caret = [ae.selectionStart, ae.selectionEnd]; } catch (x) {}
    }
    var n = cartCount();
    var h = '<div class="sin"><button class="sin-back" data-act="back">' + esc(E.ui2BackLabel("sinreg")) + '</button>' +
      "<h1>Supplier stock</h1><p class=\"sin-sub\">What suppliers have right now, at what price, and your orders to them.</p>" +
      '<div class="sin-seg" role="group" aria-label="View"><button data-act="view" data-v="stock" data-f="v-stock" aria-pressed="' + (S.view === "stock") + '">Stock' + (n ? " · " + n + " in order" : "") + '</button><button data-act="view" data-v="orders" data-f="v-orders" aria-pressed="' + (S.view === "orders") + '">Sent orders</button></div>' +
      (S.view === "stock" ? stockHtml() : ordersHtml()) +
      "</div>";
    m.innerHTML = h;
    if (fsel) { var again = m.querySelector(fsel); if (again) { again.focus(); if (caret) try { again.setSelectionRange(caret[0], caret[1]); } catch (x) {} } }
    wire(m);
  }

  var qTimer = null, oqTimer = null;
  function wire(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (act === "back") window.location.hash = E.ui2BackHash("sinreg");
        else if (act === "retry") (S.view === "orders" ? loadOrders() : load());
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "sinreg"); } catch (x) {} E.openClassic("supplier-inventory"); }
        else if (act === "view") { S.view = b.getAttribute("data-v"); S.warnId = null; S.err = ""; if (S.view === "orders") loadOrders(); else paint(); }
        else if (act === "cart") addToCart(id, false);
        else if (act === "warn-yes") addToCart(id, true);
        else if (act === "warn-no") { S.warnId = null; paint(); }
        else if (act === "uncart" || act === "remove") { delete S.cart[id]; if (S.sending && !groups().some(function (g) { return g.name === S.sending; })) S.sending = null; saveDraft(); paint(); }
        else if (act === "diary") diary(id);
        else if (act === "send") { S.sending = b.getAttribute("data-sup"); S.err = ""; paint(); focusLater('[data-f="send-yes"]'); }
        else if (act === "send-no") { S.sending = null; S.err = ""; paint(); }
        else if (act === "send-yes") send(b.getAttribute("data-sup"));
        else if (act === "status") { S.ordStatus = b.getAttribute("data-st"); S.open = null; S.detail = null; loadOrders(); }
        else if (act === "open") openOrder(id);
        else if (act === "received") received(id);
        else if (act === "rp") { S.rp = id; S.ret = null; S.rpType = ""; S.rpNotes = ""; S.rpErr = ""; paint(); focusLater('[data-f="rp-type"]'); }
        else if (act === "rp-no") { var was = S.rp; S.rp = null; S.rpErr = ""; paint(); focusLater('[data-f="rp-' + was + '"]'); }
        else if (act === "ret-yes") addReturn();
        else if (act === "ret-no") { S.ret = null; paint(); focusLater('[data-act="open"][data-id="' + S.open + '"]'); }
      });
    });
    var q = m.querySelector("#sin-q"); if (q) q.addEventListener("input", function () { S.q = q.value; clearTimeout(qTimer); qTimer = setTimeout(paint, 120); });
    var sp = m.querySelector("#sin-sup"); if (sp) sp.addEventListener("change", function () { S.sup = sp.value; paint(); });
    var ins = m.querySelector("#sin-ins"); if (ins) ins.addEventListener("change", function () { S.inStock = ins.checked; paint(); });
    var rpf = m.querySelector("#sin-rp");
    if (rpf) { rpf.addEventListener("submit", function (ev) { ev.preventDefault(); report(rpf); }); rpf.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); var was = S.rp; S.rp = null; paint(); focusLater('[data-f="rp-' + was + '"]'); } }); }
    var oq = m.querySelector("#sin-oq"); if (oq) oq.addEventListener("input", function () { S.ordQ = oq.value; clearTimeout(oqTimer); oqTimer = setTimeout(function () { S.open = null; S.detail = null; loadOrders(); }, 350); });
    m.querySelectorAll("input[data-qty]").forEach(function (inp) {
      inp.addEventListener("change", function () { var k = inp.getAttribute("data-qty"), it = S.cart[k]; if (!it) return; it.qty = snap(it.product, inp.value); saveDraft(); paint(); });
      inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") inp.blur(); });
    });
  }
  function focusLater(sel) {
    setTimeout(function () { var m = S.mount, b = m && m.querySelector(sel), a = document.activeElement; if (b && !(a && a.closest && a.closest("form")) && !(a && a.tagName === "TEXTAREA")) b.focus(); }, 30);
  }

  // ── actions ────────────────────────────────────────────────────────────
  function addToCart(id, confirmed) {
    var p = S.products.find(function (x) { return x.id === id; }); if (!p || p.out_of_stock) return;
    var ex = expiry(p);
    if (!confirmed && ex && ex.level) { S.warnId = id; paint(); focusLater('[data-f="warn-yes"]'); return; } // the classic asks first for short expiry
    S.warnId = null; S.cart[id] = { product: p, qty: snap(p, deal(p).on ? deal(p).qp : 1) };
    saveDraft(); paint(); focusLater('[data-f="cart-' + id + '"]');
  }
  async function diary(id) {
    var p = S.products.find(function (x) { return x.id === id; }); if (!p || S.busy["d" + id]) return;
    var day = today(), body = { order_date: day, item_name: p.description, supplier: p.supplier_name, qty: 1, status: "pending" }; // the classic's request
    S.busy["d" + id] = true; paint();
    try {
      await E.postOnce("/order-diary/entries", body, { list: async function () { var r = await E.apiFetch("/order-diary/entries?date=" + day, { method: "GET" }); return (r && r.entries) || []; },
        same: function (e) { return low(e.item_name) === low(body.item_name) && low(e.supplier) === low(body.supplier); } });
      S.diaried[id] = 1; E.toast("Added to today's order diary: " + p.description, "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy["d" + id] = false; paint();
  }
  async function send(name) {
    if (S.saving) return;
    keep();
    var g = groups().find(function (x) { return x.name === name; }); if (!g || !g.items.length) return;
    var bad = g.items.filter(function (it) { var d = deal(it.product); return d.on && it.qty % d.qp !== 0; });
    S.err = "";
    if (bad.length) { S.err = "Deal lines go in multiples of the deal: " + bad.map(function (it) { return it.product.description; }).join(", ") + ". Nothing was sent."; return paint(); }
    var notes = String(S.notes[name] || "").trim();
    var items = g.items.map(function (it) { // exactly the classic's line
      var p = it.product, fr = freeOf(p, it.qty);
      return { product_id: p.id, description: p.description, barcode: p.barcode || "", stock_code: p.stock_code || "", qty_requested: it.qty, qty_free_included: fr, qty_free: fr,
        cost_excl_vat: p.cost_excl_vat || 0, vat_rate: p.vat_rate || 18, retail_price: p.retail_price || 0, batch: p.batch || "", expiry_date: p.expiry_date || "",
        discount_pct: p.discount_pct || 0, discount_euro: p.discount_euro || 0 };
    });
    var body = { supplier_location_id: g.loc, supplier_name: name, items: items, notes: notes };
    S.saving = true; paint();
    try {
      var r = await E.postOnce("/supplier-orders", body, { list: function () { return fetchOrders("", ""); },
        same: function (o) { return String(o.supplier_name || "").trim() === name.trim() && Number(o.item_count) === items.length && String(o.notes || "").trim() === notes && o.status === "pending"; } });
      g.items.forEach(function (it) { delete S.cart[it.product.id]; }); delete S.notes[name]; S.sending = null;
      saveDraft();
      E.toast(r && r.id ? "Order #" + r.id + " sent to " + name : "Order sent to " + name, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; paint();
  }
  async function received(id) {
    if (S.busy["r" + id]) return;
    S.busy["r" + id] = true; S.err = ""; S.errFor = null; paint();
    try {
      var r = await E.apiFetch("/supplier-orders/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify({ status: "received" }) }); // only the status: notes and dates stay as they are
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast("Order #" + id + " marked as received", "success"); S.open = null; S.detail = null;
    } catch (x) { S.err = E.saveFailText(x); S.errFor = id; }
    S.busy["r" + id] = false;
    if (S.errFor === id) return paint();
    return loadOrders();
  }

  E.registerModule({
    id: "sinreg", title: "Supplier stock", order: 3, icon: "▦", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.view = "stock"; S.cart = {}; S.draftOk = false; S.notes = {}; S.diaried = {}; S.warnId = null; S.sending = null; S.err = ""; S.busy = {}; S.open = null; S.detail = null; S.saving = false; S.rp = null; S.ret = null;
      css(); paint(); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("sinreg") < 0) E.UI2_DESTINATIONS.push("sinreg");
  if (E.UI2_PARENT) E.UI2_PARENT.sinreg = "stock";
})();
