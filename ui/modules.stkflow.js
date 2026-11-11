/* ============================================================
   EIKON — Stock, one ordering flow  (modules.stkflow.js, d-stock)
   The Stock tab opens on the day's work instead of a list of screens:
     To order          everything that needs ordering, grouped by supplier, with the best price known from Price check:
                       order diary lines still open on ANY day (not one day at a time), lines that did not come or came
                       wrong, and what is waiting to be put on an order (customer orders, recalled stock to replace, what
                       you asked other pharmacies for). "Mark ordered" per supplier; "Copy list" for the phone or e-mail.
     On order          what was ordered, per supplier and when; "Arrived" ticks a line off (the order diary's own
                       Received), "Not in" sends it back to To order. Customers whose item is in are listed to be told,
                       with Ready (the Orders screen's own call) and a hook for messaging (E.stockFlow below).
     Short or at risk  open recalls and quarantines, near expiry, returns waiting on the supplier, what you are short
                       of; each with its next step one tap away.
   Saved bodies are the classic screens' own: POST /order-diary/entries { order_date, item_name, qty, supplier, notes },
   PUT /order-diary/entries/:id { status } (Received, Not received, Undo) and the classic Edit Item body
   { item_name, qty, supplier, notes }, PUT /client-orders/entries/:id { fulfilled: true }. The ordered marks and the
   links between a diary line and what it is for are kept by the new additive /stock-flow routes (worker: STOCK FLOW);
   on a server without them the tab still shows every open line, and arrivals are ticked under To order.
   Everything read is this pharmacy's own (the server fences each list to the signed-in pharmacy); prices may come from
   the other pharmacies of the same group, as Price check's own "All our pharmacies" does, and say so.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var DAYS_BACK = 60, KEEP_MS = 30000;
  var S = { mount: null, view: "", at: 0, loading: false, error: "", noFlow: false, open: [], received: [], quotes: [], orders: [], alerts: [], nex: [], rets: [], needs: [],
    part: {}, busy: {}, done: null, adding: null, addErr: "", saving: false, sug: null, sugErr: "", pick: null, pickErr: "", seen: null, all: null };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var VIEWS = [["order", "To order"], ["coming", "On order"], ["risk", "Short or at risk"]];
  var ALERT_STEPS = [["team_informed", "tell the team"], ["supplier_informed", "tell the supplier"], ["authorities_informed", "tell the authorities"], ["return_arranged", "arrange the return"], ["handed_over", "hand it over"], ["collection_note_received", "get the collection note"], ["credit_note_received", "get the credit note"]];
  var RET_STEPS = [["return_arranged", "Arrange it"], ["handed_over", "Hand it over"], ["collection_note_received", "Collection note"], ["credit_note_received", "Credit note"]];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function today() { return E.maltaYmd ? E.maltaYmd() : new Date().toISOString().slice(0, 10); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function shift(s, n) { var p = String(s).split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function daysUntil(s) { if (!isYmd(s)) return null; var p = s.split("-"), t = today().split("-"); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+t[0], +t[1] - 1, +t[2])) / 86400000); }
  function dm(s) { if (!isYmd(s)) return ""; var n = daysUntil(s); if (n === 0) return "today"; if (n === -1) return "yesterday"; if (n === 1) return "tomorrow"; var p = s.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1] + (p[0] === today().slice(0, 4) ? "" : " " + p[0]); }
  function eur(n) { return "€" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function low(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function fold(s) { return E.people && E.people.foldMt ? E.people.foldMt(String(s || "")) : low(s); }
  function words(s) { return fold(s).replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean); }
  function key(s) { return words(s).join(" "); }
  function supKey(s) { return low(s).replace(/\s+/g, " "); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function linesOf(t) { return String(t || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); } // the classic splitItemLines
  function orderId(o) { return Number(o.id || o.entry_id); }

  // The same item, said the same way or with one word more ("Ventolin inhaler" / "Ventolin inhaler 100mcg"): strict on
  // purpose, so a price or a customer is never put on the wrong line.
  function sameItem(a, b) {
    var x = words(a), y = words(b); if (!x.length || !y.length) return false;
    if (x.join(" ") === y.join(" ")) return true;
    var s = x.length <= y.length ? x : y, l = s === x ? y : x; if (s.length < 2 || l.length - s.length > 1) return false;
    return s.every(function (w) { return l.indexOf(w) >= 0; });
  }
  // Price check's "real cost of one unit": discount and free stock counted (modules.qtreg.js calc).
  function unit(q) {
    var excl = Math.max(0, Number(q.cost_excl_vat) || 0), disc = Math.max(0, Number(q.discount_euro) || 0), buy = Math.max(1, Math.round(Number(q.qty_purchased) || 1)), free = Math.max(0, Math.round(Number(q.qty_free) || 0));
    return Math.max(0, excl - disc) * buy / (buy + free);
  }
  var priceMemo = {};
  // { best: quote, unit, bySup: { supKey: unit } } for an item name, or null when Price check has nothing for it.
  function priceFor(name) {
    var k = key(name); if (!k) return null; if (k in priceMemo) return priceMemo[k];
    var best = null, bu = 0, bySup = {};
    S.quotes.forEach(function (q) {
      if (!String(q.supplier || "").trim() || !(Number(q.cost_excl_vat) > 0) || !sameItem(name, q.item_description)) return;
      var u = unit(q), sk = supKey(q.supplier);
      if (!(sk in bySup) || u < bySup[sk].unit) bySup[sk] = { unit: u, q: q };
      if (!best || u < bu) { best = q; bu = u; }
    });
    return (priceMemo[k] = best ? { best: best, unit: bu, bySup: bySup } : null);
  }
  function isMyLoc(q) { var u = E.state && E.state.user; return !u || q.location_id == null || Number(q.location_id) === Number(u.location_id); }

  // ---- reading -----------------------------------------------------------------------------------------------
  async function get(path, pick) { var r = await E.apiFetch(path, { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load"); return pick(r); }
  function monthOf(k) { var t = today().split("-"); var d = new Date(+t[0], +t[1] - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  // The order diary's open lines: one call to the stock-flow route; a server without it is read day by day (two weeks).
  async function loadFlow() {
    try {
      var r = await E.apiFetch("/stock-flow/open?from=" + shift(today(), -DAYS_BACK), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the order diary");
      S.noFlow = false; S.open = r.open || []; S.received = r.received || []; return;
    } catch (x) { if (!(x && x.status === 404)) throw x; }
    S.noFlow = true;
    var days = []; for (var i = 0; i < 14; i++) days.push(shift(today(), -i));
    var all = await Promise.all(days.map(function (d) { return get("/order-diary/entries?date=" + d, function (r) { return r.entries || []; }).catch(function () { return []; }); }));
    var rows = [].concat.apply([], all), carried = {}; rows.forEach(function (e) { if (e.carried_from_id) carried[e.carried_from_id] = 1; });
    S.open = rows.filter(function (e) { return ["pending", "not_received", "wrong_pick"].indexOf(e.status) >= 0 && !carried[e.id]; }).map(function (e) { e.links = []; return e; });
    S.received = rows.filter(function (e) { return e.status === "received" && daysUntil(e.order_date) >= -7; }).map(function (e) { e.links = []; return e; });
  }
  // Customer orders of the last six months in one call; a server without ranges month by month (three), as Orders does.
  async function loadOrders() {
    try { return await get("/client-orders/entries?from=" + monthOf(-5) + "-01&to=" + monthOf(1) + "-01", function (r) { return r.entries || []; }); }
    catch (x) { if (x && x.network) throw x; }
    var res = await Promise.all([0, -1, -2].map(function (k) { return get("/client-orders/entries?month=" + monthOf(k), function (r) { return r.entries || []; }); }));
    var seen = {}; return [].concat.apply([], res).filter(function (o) { var id = orderId(o); return seen[id] ? false : (seen[id] = 1); });
  }
  async function load(force) {
    if (S.loading || (!force && S.at && Date.now() - S.at < KEEP_MS)) return paint();
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; if (!S.at) paint(); // a refresh keeps the screen as it is (and anything being typed) until the lists are in
    var parts = {
      flow: loadFlow(),
      quotes: get("/quotations/entries?all_org=1", function (r) { return r.entries || []; }),
      orders: loadOrders(),
      alerts: get("/alerts/entries", function (r) { return r.entries || []; }),
      nex: get("/near-expiry/entries", function (r) { return r.entries || []; }),
      rets: get("/returns/entries?open=1", function (r) { return r.entries || []; }),
      needs: get("/scarce-stock/needs?open=1", function (r) { return r.needs || []; })
    };
    var names = Object.keys(parts), res = await Promise.all(names.map(function (n) { return parts[n].then(function (v) { return { ok: true, v: v }; }, function (x) { return { ok: false, x: x }; }); }));
    var failed = [];
    names.forEach(function (n, i) {
      S.part[n] = res[i].ok;
      if (!res[i].ok) { failed.push(res[i].x); return; }
      if (n !== "flow") S[n] = res[i].v;
    });
    priceMemo = {}; compute();
    if (!res[0].ok && !keepView) { var x = res[0].x; S.error = x && x.network ? "Can't reach the server. Try again in a moment." : String((x && (x.message || x)) || "Could not load the order diary"); }
    S.loading = false; S.at = Date.now();
    if (S.mount) E.whenFormIdle(S.mount, paint);
  }

  // ---- what is where ---------------------------------------------------------------------------------------------
  function openOrders() { return S.orders.filter(function (o) { return !Number(o.fulfilled); }); }
  function linked(line, source) { return (line.links || []).filter(function (l) { return l.source === source; }).map(function (l) { return Number(l.source_id); }); }
  // Which customer order each diary line is for, worked out once per load:
  //   linked here (Add to order below): sure;
  //   put in the diary from the Orders screen (its "Add to diary": a line for that order's day naming the same item,
  //   one line per item of the order): taken as that order's, one order per line, oldest order first.
  // S.cus[diary id] = [{ o, sure }]; S.covered["order id:item n"] when an order's item is on a line.
  function compute() {
    var lines = S.open.concat(S.received), byOrder = {}, taken = {};
    S.cus = {}; S.covered = {};
    var open = openOrders().slice().sort(function (a, b) { return orderId(a) - orderId(b); });
    open.forEach(function (o) { byOrder[orderId(o)] = o; });
    lines.forEach(function (l) {
      linked(l, "order").forEach(function (id) {
        var o = byOrder[id]; if (!o) return; taken[l.id] = 1;
        (S.cus[l.id] = S.cus[l.id] || []).push({ o: o, sure: true });
        var its = linesOf(o.items_text || o.items); its.forEach(function (t, i) { if (its.length === 1 || sameItem(t, l.item_name)) S.covered[id + ":" + i] = 1; });
      });
    });
    open.forEach(function (o) {
      var id = orderId(o), od = String(o.order_date || "").slice(0, 10);
      linesOf(o.items_text || o.items).forEach(function (t, i) {
        if (S.covered[id + ":" + i]) return;
        var hit = lines.find(function (l) { return !taken[l.id] && String(l.first_date || l.order_date || "") === od && sameItem(t, l.item_name); });
        if (!hit) return; taken[hit.id] = 1; S.covered[id + ":" + i] = 1; (S.cus[hit.id] = S.cus[hit.id] || []).push({ o: o, sure: false });
      });
    });
  }
  function customersOf(line) { return (S.cus && S.cus[line.id]) || []; }
  function rowCustomers(row) { var out = []; row.lines.forEach(function (l) { customersOf(l).forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); }); }); return out; }
  // One row per item and supplier: the same thing written on several days is ordered once, with the quantities added.
  function itemRows(lines) {
    var m = {}, out = [];
    lines.forEach(function (l) { var k = key(l.item_name) + "|" + supKey(l.supplier); if (!m[k]) { m[k] = { id: l.id, ids: [], lines: [], item_name: l.item_name, supplier: l.supplier, qty: 0 }; out.push(m[k]); } var r = m[k]; r.ids.push(l.id); r.lines.push(l); r.qty += Number(l.qty) || 0; });
    return out;
  }
  function onOrder(l) { return !S.noFlow && !!l.ordered_at && l.status === "pending"; }
  function toOrderLines() { return S.open.filter(function (l) { return !onOrder(l); }); }
  function onOrderLines() { return S.open.filter(onOrder); }
  // Waiting to be put on an order: open customer orders (last 60 days) with an item line no diary line covers; open
  // recalls not yet replaced; what this pharmacy asked other pharmacies for.
  function suggestions() {
    var lines = S.open.concat(S.received), out = [], from = shift(today(), -DAYS_BACK);
    openOrders().forEach(function (o) {
      if (String(o.order_date || "") < from) return;
      linesOf(o.items_text || o.items).forEach(function (t, i) { if (!S.covered[orderId(o) + ":" + i]) out.push({ k: "order:" + orderId(o) + ":" + i, kind: "order", id: orderId(o), item: t, qty: 1, who: o.client_name, need: o.needed_by || o.pickup_date || "", note: "" }); });
    });
    S.alerts.forEach(function (a) {
      if (a.status === "closed" || a.alert_type === "quarantine") return;
      if (lines.some(function (l) { return linked(l, "alert").indexOf(Number(a.id)) >= 0; })) return;
      var q = parseInt(String(a.quantity || "1"), 10); out.push({ k: "alert:" + a.id, kind: "alert", id: Number(a.id), item: a.item_name, qty: q > 0 ? q : 1, sup: a.supplier || "", batch: a.batch || "" });
    });
    S.needs.forEach(function (n) {
      if (!n.mine_owner || Number(n.is_closed)) return;
      if (lines.some(function (l) { return linked(l, "need").indexOf(Number(n.id)) >= 0; })) return;
      var q = Number(n.remaining_quantity != null ? n.remaining_quantity : n.quantity_needed) || 1; out.push({ k: "need:" + n.id, kind: "need", id: Number(n.id), item: n.item_name, qty: q > 0 ? q : 1, need: n.needed_by || "" });
    });
    var late = function (s) { return s.need || "9999"; };
    return out.sort(function (a, b) { return late(a) < late(b) ? -1 : late(a) > late(b) ? 1 : 0; }); // the most urgent first
  }
  // Customers whose item is in (a line received in the last week) and whose order is not marked ready yet.
  function toTell() {
    var out = [], seen = {};
    S.received.forEach(function (l) {
      customersOf(l).forEach(function (c) { var id = orderId(c.o); if (seen[id]) return; seen[id] = 1; out.push({ o: c.o, line: l, sure: c.sure }); });
    });
    return out;
  }
  function riskLists() {
    var alerts = S.alerts.filter(function (a) { return a.status !== "closed"; });
    var nex = S.nex.filter(function (e) { var n = daysUntil(String(e.expiry_date || "").slice(0, 10)); return !e.return_id && n != null && n <= 31; }).sort(function (a, b) { return String(a.expiry_date) < String(b.expiry_date) ? -1 : 1; });
    var rets = S.rets.filter(function (r) { return !Number(r.credit_note_received) && !Number(r.supplier_refused) && !Number(r.damaged); }).sort(function (a, b) { return String(a.entry_date) < String(b.entry_date) ? -1 : 1; });
    var needs = S.needs.filter(function (n) { return n.mine_owner && !Number(n.is_closed); });
    return { alerts: alerts, nex: nex, rets: rets, needs: needs, count: alerts.length + nex.length + rets.length + needs.length };
  }
  function groups(lines) {
    var g = {}, order = [];
    lines.forEach(function (l) { var name = String(l.supplier || "").trim(), k = supKey(name) || "~none"; if (!g[k]) { g[k] = { k: k, name: name || "", lines: [] }; order.push(k); } g[k].lines.push(l); });
    order.sort(function (a, b) { return a === "~none" ? -1 : b === "~none" ? 1 : a.localeCompare(b); });
    return order.map(function (k) { return g[k]; });
  }
  function knownSuppliers() {
    var seen = {}, out = [];
    S.open.concat(S.received).map(function (l) { return l.supplier; }).concat(S.quotes.map(function (q) { return q.supplier; })).forEach(function (s) { s = String(s || "").trim(); if (s && !seen[low(s)]) { seen[low(s)] = 1; out.push(s); } });
    return out.sort(function (a, b) { return a.localeCompare(b); }).slice(0, 80);
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  function css() {
    if (document.getElementById("eikon-stkflow-css")) return;
    var st = document.createElement("style"); st.id = "eikon-stkflow-css";
    st.textContent =
      ".stk{margin-top:14px}.stk-seg{display:flex;gap:2px;padding:2px;border-radius:12px;background:rgba(118,118,128,.12);max-width:560px}" +
      ".stk-seg button{flex:1;font:inherit;font-size:14px;font-weight:600;min-height:40px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".stk-seg button[aria-pressed=true]{background:var(--panel2);box-shadow:0 1px 3px rgba(0,0,0,.14)}.stk-seg b{font-variant-numeric:tabular-nums;font-weight:700;margin-left:4px;color:var(--text)}" +
      ".stk-seg button[aria-pressed=true] b{color:var(--text)}" +
      ".stk-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:16px 2px 4px}.stk-head p{margin:0;color:var(--muted);font-size:14.5px}" +
      ".stk-btn{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".stk-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.stk-btn:disabled{opacity:.55;cursor:default}.stk-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".stk-btn.s{min-height:32px;padding:0 11px;font-size:13px;border-radius:16px}.stk-btn.q{border-color:transparent;background:transparent;color:var(--accent);padding:0 6px}" +
      ".stk-h{font-size:13px;font-weight:600;color:var(--muted);margin:20px 2px 7px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}.stk-h b{color:var(--text);font-variant-numeric:tabular-nums}.stk-h h2{font:inherit;color:inherit;margin:0}.stk-h h2 b{margin-left:4px}" +
      ".stk-w{font-style:normal;font-weight:600;color:var(--danger)}" + // SH4: the one word that is wrong, not the whole line
      ".stk-all-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin:0 0 10px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}.stk-all-box p{margin:0;font-size:14px;flex:1 1 260px}.stk-all-box .acts{display:flex;gap:8px}" +
      ".stk-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:12px}" +
      ".stk-ch{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-bottom:.5px solid var(--border);background:rgba(118,118,128,.05)}" +
      ".stk-ch h3{margin:0;font-size:16px;font-weight:700;flex:1;min-width:120px}.stk-ch h3 span{display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-top:1px}.stk-ch .a{display:flex;gap:6px;flex-wrap:wrap}" +
      ".stk-row{display:flex;gap:10px;align-items:center;padding:10px 14px;border-top:.5px solid var(--border);flex-wrap:wrap}.stk-row:first-child,.stk-ch+.stk-row{border-top:0}" +
      ".stk-row .t{flex:1;min-width:170px}.stk-row .t b{font-size:15px;font-weight:600}.stk-row .t i{font-style:normal;font-variant-numeric:tabular-nums;font-weight:600;color:var(--muted);margin-left:4px}" +
      ".stk-row .t span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}.stk-row .t span.w{color:var(--danger)}.stk-row .a{display:flex;gap:6px;flex-wrap:wrap;align-items:center}" +
      ".stk-pr{font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted);text-align:right;min-width:92px}.stk-pr b{color:var(--text);font-weight:600}.stk-pr .ok{color:var(--ok,#1C8A5B);font-weight:600}" +
      ".stk-cheap{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text);background:rgba(201,138,18,.12);border-radius:8px;padding:3px 4px 3px 8px;flex-basis:100%;justify-content:space-between}" +
      ".stk-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--muted);white-space:nowrap}.stk-pill.bad{background:rgba(215,38,28,.12);color:var(--danger)}.stk-pill.warn{background:rgba(201,138,18,.16);color:#8A5A00}.stk-pill.ok{background:rgba(28,138,91,.14);color:var(--ok,#1C8A5B)}" +
      ".stk-tell{border-color:var(--accent)}.stk-tell .stk-ch{background:rgba(10,143,106,.08)}" +
      ".stk-form{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:10px 14px;border-top:.5px solid var(--border);background:rgba(118,118,128,.05)}" +
      ".stk-form label{display:flex;flex-direction:column;gap:3px;font-size:12.5px;font-weight:600;color:var(--muted);flex:1;min-width:120px}.stk-form label.n{flex:0 0 84px;min-width:0}" +
      ".stk-form input{font:inherit;font-size:16px;height:40px;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--text);padding:0 10px;width:100%}" +
      ".stk-form .acts{display:flex;gap:8px}.stk-err{color:var(--danger);font-size:13px;flex-basis:100%;margin:0}" +
      ".stk-addf{background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin:10px 0 4px}.stk-addf .stk-form{border-top:0;background:transparent}" +
      ".stk-done{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:8px 8px 8px 14px;border-radius:12px;background:rgba(28,138,91,.10);font-size:14px}" +
      ".stk-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:18px;color:var(--muted);margin-top:12px;font-size:14.5px}.stk-quiet .stk-btn{margin-top:10px}" +
      ".stk-note{font-size:12.5px;color:var(--muted);margin:6px 2px 0}" +
      ".stk-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      ".stk-row a{color:var(--accent);text-decoration:none}.stk-row a:hover{text-decoration:underline}" +
      ".stk-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:0 16px;align-items:start}" +
      ".stk-skel{height:46px;border-top:.5px solid var(--border);background:linear-gradient(90deg,rgba(118,118,128,.06),rgba(118,118,128,.14),rgba(118,118,128,.06));background-size:200% 100%;animation:stksk 1.2s linear infinite}.stk-skel:first-child{border-top:0}" +
      "@keyframes stksk{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.stk-skel{animation:none}}" +
      ".hub[data-hub=stock] .stk-all{font-size:19px;font-weight:700;letter-spacing:-.015em;text-transform:none;color:var(--text);margin:30px 2px 0}" +
      "@media (max-width:600px){.stk-seg button{min-height:44px;font-size:13.5px;padding:0 6px}.stk-btn,.stk-btn.s{min-height:44px;border-radius:22px}.stk-row .t{min-width:100%}.stk-pr{text-align:left}.stk-row[data-sug]{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;row-gap:2px}.stk-row[data-sug] .t{min-width:0}.stk-row[data-sug] .stk-pr{grid-column:1;grid-row:2;min-width:0}.stk-row[data-sug] .a{grid-column:2;grid-row:1/span 2}.stk-ch h3{min-width:100%}}" +
      "@media (prefers-color-scheme:dark){html:not([data-theme=light]) .stk-pill.warn{color:#F2C063}}";
    document.head.appendChild(st);
  }

  function btn(act, label, attrs, cls) { return '<button type="button" class="stk-btn' + (cls ? " " + cls : "") + '" data-act="' + act + '"' + (attrs || "") + ">" + label + "</button>"; }
  function busyAttr(k) { return S.busy[k] ? " disabled" : ""; }
  function forWhom(row) {
    var cs = rowCustomers(row); if (!cs.length) return "";
    var n = cs.map(function (c) { return c.o.client_name; }); return "for " + (n.length > 2 ? n.slice(0, 2).join(", ") + " and " + (n.length - 2) + " more" : n.join(" and "));
  }
  function whyLine(row) {
    var bits = [], f = forWhom(row), ls = row.lines, any = function (fn) { return ls.some(fn); };
    var nr = ls.filter(function (l) { return l.status === "not_received"; }).length, wp = ls.filter(function (l) { return l.status === "wrong_pick"; }).length;
    if (wp) bits.push({ w: ls.length > 1 ? wp + " came wrong" : "came wrong" }); if (nr) bits.push({ w: ls.length > 1 ? nr + " did not come" : "did not come" }); // only these words in red
    if (f) bits.push(f); if (any(function (l) { return linked(l, "alert").length; })) bits.push("replaces recalled stock"); if (any(function (l) { return linked(l, "need").length; })) bits.push("you are short of it");
    ls.forEach(function (l) { if (l.notes && bits.indexOf(l.notes) < 0) bits.push(l.notes); });
    var first = ls.reduce(function (m, l) { var d = String(l.first_date || l.order_date || ""); return !m || d < m ? d : m; }, ""), since = daysUntil(first);
    if (ls.length > 1) bits.push(ls.length + " diary lines" + (since < 0 ? " since " + dm(first) : ""));
    else if (since != null && since < 0) bits.push("in the diary since " + dm(first));
    return bits;
  }
  function priceHtml(l, choose) {
    var p = priceFor(l.item_name); if (!p) return "";
    var sk = supKey(l.supplier), mine = sk && p.bySup[sk], bestSup = String(p.best.supplier || "").trim(), cheapest = mine && mine.unit <= p.unit + 0.004;
    var from = isMyLoc(p.best) ? "" : " (" + (p.best.location_name || "another of your pharmacies") + ")";
    if (choose || !sk) return '<div class="stk-pr"><b>' + eur(p.unit) + "</b> each at " + esc(bestSup) + esc(from) + "</div>";
    var h = '<div class="stk-pr">' + (mine ? "<b>" + eur(mine.unit) + "</b> each" + (cheapest ? ' <span class="ok">· cheapest</span>' : "") : "") + "</div>";
    var worth = !mine || (mine.unit - p.unit >= 0.10 && mine.unit - p.unit >= mine.unit * 0.05); // a real saving, not cents
    if (!cheapest && worth && supKey(bestSup) !== sk) {
      var save = mine ? " (" + eur(mine.unit - p.unit) + " less each)" : "";
      h += '<div class="stk-cheap"><span>Cheaper at <b>' + esc(bestSup) + "</b>: " + eur(p.unit) + esc(save + from) + "</span>" + btn("move", "Order from " + esc(bestSup), ' data-id="' + l.id + '" data-sup="' + esc(bestSup) + '" aria-label="' + esc("Order " + l.item_name + " from " + bestSup) + '"' + busyAttr("l" + l.id), "s") + "</div>";
    }
    return h;
  }
  function lineRow(l, mode) {
    if (!l.lines) l = itemRows([l])[0];
    var why = whyLine(l), warn = mode === "order";
    var sub = why.map(function (b) { return typeof b === "string" ? esc(b) : warn ? '<em class="stk-w">' + esc(b.w) + "</em>" : esc(b.w); }).join(" · ");
    var h = '<div class="stk-row" data-line="' + l.id + '"><div class="t"><b>' + esc(l.item_name) + "</b> <i>× " + esc(l.qty) + "</i>" + (sub ? "<span>" + sub + "</span>" : "") + "</div>";
    var none = !String(l.supplier || "").trim();
    if (mode === "order") {
      h += priceHtml(l, none);
      if (none) { var p = priceFor(l.item_name), bs = p ? String(p.best.supplier || "").trim() : ""; h += '<div class="a">' + (bs ? btn("move", "Order from " + esc(bs), ' data-id="' + l.id + '" data-sup="' + esc(bs) + '"' + busyAttr("l" + l.id), "s") : "") + btn("pick", bs ? "Another supplier" : "Choose supplier", ' data-id="' + l.id + '" aria-expanded="' + (S.pick === l.id ? "true" : "false") + '"', bs ? "s q" : "s") + "</div>"; }
      else if (S.noFlow) h += '<div class="a">' + btn("arrived", S.busy["l" + l.id] ? "Saving…" : "Arrived", ' data-id="' + l.id + '" data-ids="' + l.ids.join(",") + '" aria-label="' + esc("Arrived: " + l.item_name) + '"' + busyAttr("l" + l.id), "s") + "</div>";
    } else if (mode === "coming") {
      h += '<div class="a">' + btn("arrived", S.busy["l" + l.id] ? "Saving…" : "Arrived", ' data-id="' + l.id + '" data-ids="' + l.ids.join(",") + '" aria-label="' + esc("Arrived: " + l.item_name) + '"' + busyAttr("l" + l.id), "s") + btn("notin", "Not in", ' data-id="' + l.id + '" data-ids="' + l.ids.join(",") + '" aria-label="' + esc("Not in: " + l.item_name) + '"' + busyAttr("l" + l.id), "s q") + "</div>";
    } else if (mode === "got") {
      h += '<div class="a">' + btn("unarrive", "Undo", ' data-id="' + l.id + '" aria-label="' + esc("Undo arrived: " + l.item_name) + '"' + busyAttr("l" + l.id), "s q") + "</div>";
    }
    h += "</div>";
    if (S.pick === l.id) h += pickForm(l);
    return h;
  }
  function pickForm(l) {
    return '<form class="stk-form" id="stk-pick" autocomplete="off" aria-label="' + esc("Supplier for " + l.item_name) + '"><label>Supplier<input name="supplier" list="stk-sups" value="' + esc(S.pickVal || "") + '"></label>' +
      (S.pickErr ? '<p class="stk-err" role="alert">' + esc(S.pickErr) + "</p>" : "") +
      '<div class="acts">' + btn("pick-cancel", "Cancel") + '<button type="submit" class="stk-btn p"' + busyAttr("l" + l.id) + ">" + (S.busy["l" + l.id] ? "Saving…" : "Save") + "</button></div></form>";
  }
  function supDatalist() { return '<datalist id="stk-sups">' + knownSuppliers().map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>"; }

  function tellHtml() {
    var list = toTell(); if (!list.length) return "";
    var h = '<section class="stk-card stk-tell" aria-labelledby="stk-tell-h"><div class="stk-ch"><h3 id="stk-tell-h">In for customers: tell them<span>' + plural(list.length, "customer is", "customers are") + " waiting to hear their order is in.</span></h3></div>";
    var pg = E.listPage.take("stk:tell", list, { first: 3, idOf: function (c) { return orderId(c.o); } });
    pg.rows.forEach(function (c) {
      var o = c.o, id = orderId(o), ph = String(o.client_phone || o.contact || "").trim();
      h += '<div class="stk-row"><div class="t"><b>' + esc(o.client_name) + "</b><span>" + esc((c.line.item_name) + " is in" + (c.sure ? "" : " (their order: " + linesOf(o.items_text || o.items).join(", ") + ")")) + (ph ? ' · <a href="tel:' + esc(ph.replace(/[^\d+]/g, "")) + '">' + esc(ph) + "</a>" : "") + "</span></div><div class=\"a\">" +
        (E.stockFlow.tell ? btn("message", "Send a message", ' data-oid="' + id + '"', "s") : "") +
        (ph ? btn("ready", S.busy["o" + id] ? "Saving…" : "Ready", ' data-oid="' + id + '" aria-label="' + esc("Ready: " + o.client_name + "'s order is in") + '"' + busyAttr("o" + id), "s") : btn("open-order", "Open the order", ' data-oid="' + id + '"', "s")) + "</div></div>";
    });
    return h + (pg.left ? '<div class="stk-row">' + E.listPage.moreHtml("stk:tell", pg, "stk-btn s q").replace('<div class="q5-8-morebox">', "").replace(/<\/div>$/, "") + "</div>" : "") + "</section>";
  }

  function orderView() {
    var lines = toOrderLines(), sug = suggestions(), gs = groups(lines), h = "";
    var sups = gs.filter(function (g) { return g.k !== "~none"; }).length, forCus = lines.filter(function (l) { return customersOf(l).length; }).length, nRows = gs.reduce(function (n, g) { return n + itemRows(g.lines).length; }, 0);
    h += '<div class="stk-head"><p>' + (lines.length ? plural(nRows, "item", "items") + " to order" + (sups ? " from " + plural(sups, "supplier", "suppliers") : "") + (forCus ? " · " + forCus + " for customers" : "") : "Nothing left to order.") + "</p>" + (S.adding ? "" : btn("add", "Add an item", "", "p")) + "</div>";
    if (S.adding) h += addForm();
    if (sug.length) {
      // SH3: the eight most urgent, the rest one tap away; "Add all" puts every one on today's order as its own row's Add would
      h += '<div class="stk-h"><h2>Waiting to be put on an order <b>' + sug.length + "</b></h2>" + (sug.length > 1 && !S.all ? btn("all", "Add all " + sug.length + " to today's order", "", "s q") : "") + "</div>";
      if (S.all) h += allBox(sug);
      var pg = E.listPage.take("stk:sug", sug, { first: 8, idOf: function (s) { return s.k; } });
      h += '<div class="stk-card">' + pg.rows.map(sugRow).join("") + "</div>" + E.listPage.moreHtml("stk:sug", pg, "stk-btn");
    }
    gs.forEach(function (g) {
      var none = g.k === "~none", ids = g.lines.map(function (l) { return l.id; }).join(","), cheap = 0;
      g.lines.forEach(function (l) { var p = priceFor(l.item_name); if (p && p.bySup[g.k] && p.bySup[g.k].unit <= p.unit + 0.004) cheap++; });
      h += '<section class="stk-card" aria-labelledby="stk-g-' + esc(g.k.replace(/[^a-z0-9]/g, "-")) + '"><div class="stk-ch"><h3 id="stk-g-' + esc(g.k.replace(/[^a-z0-9]/g, "-")) + '">' + (none ? "Choose a supplier" : esc(g.name)) +
        "<span>" + plural(itemRows(g.lines).length, "item", "items") + (cheap ? " · cheapest on " + cheap + " lines" : "") + "</span></h3>" +
        (none ? "" : '<div class="a">' + btn("copy", "Copy list", ' data-sup="' + esc(g.k) + '" aria-label="' + esc("Copy the list for " + g.name) + '"', "s") + (S.noFlow ? "" : btn("ordered", S.busy["g" + g.k] ? "Saving…" : "Mark ordered", ' data-sup="' + esc(g.k) + '" data-ids="' + ids + '" aria-label="' + esc("Mark ordered from " + g.name) + '"' + busyAttr("g" + g.k), "s p")) + "</div>") + "</div>";
      var pg = E.listPage.take("stk:o:" + g.k, itemRows(g.lines), {});
      h += pg.rows.map(function (l) { return lineRow(l, "order"); }).join("") + "</section>" + E.listPage.moreHtml("stk:o:" + g.k, pg, "stk-btn");
    });
    if (!lines.length && !sug.length) h += '<div class="stk-quiet">Nothing to order. Items added to the order diary, customer orders, recalls to replace and what you are short of come here.</div>';
    if (S.noFlow) h += '<p class="stk-note">Marking what was ordered comes with the next server update: until then tick arrivals here. Lines from the last two weeks are shown.</p>';
    return h;
  }
  function sugRow(s) {
    // SH4: the line itself in grey; only "late" is red, and only when it is (Orders says it the same way)
    var late = s.need && daysUntil(s.need) < 0, when = s.need ? (s.kind === "order" ? "needed " : "needed by ") + dm(s.need) : "";
    var sub = esc(s.kind === "order" ? "Customer order: " + s.who : s.kind === "alert" ? "Recalled" + (s.batch ? " batch " + s.batch : "") + ": replace it" : "You are short of it") +
      (when ? " · " + (late ? '<em class="stk-w">Late</em>, ' : "") + esc(when) : "");
    var h = '<div class="stk-row" data-sug="' + esc(s.k) + '"><div class="t"><b>' + esc(s.item) + "</b><i>× " + esc(s.qty) + "</i><span>" + sub + "</span></div>" + priceHtml({ item_name: s.item, supplier: "" }, true) +
      '<div class="a">' + btn("sug", "Add to order", ' data-k="' + esc(s.k) + '" aria-expanded="' + !!(S.sug && S.sug.k === s.k) + '" aria-label="' + esc("Add to order: " + s.item) + '"', "s") + "</div></div>";
    if (S.sug && S.sug.k === s.k) {
      var v = S.sug;
      h += '<form class="stk-form" id="stk-sug" autocomplete="off" aria-label="' + esc("Add " + s.item + " to the order") + '"><label class="n">How many<input name="qty" inputmode="numeric" value="' + esc(v.qty) + '"></label><label>Supplier<input name="supplier" list="stk-sups" value="' + esc(v.supplier) + '" placeholder="Optional"></label>' +
        (S.sugErr ? '<p class="stk-err" role="alert">' + esc(S.sugErr) + "</p>" : "") +
        '<div class="acts">' + btn("sug-cancel", "Cancel") + '<button type="submit" class="stk-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Adding…" : "Add to today's order") + "</button></div></form>";
    }
    return h;
  }
  // Add all: says what will happen, then the same body each row's Add to order sends with what it offers (its quantity,
  // the supplier it names or the cheapest one Price check knows), one after the other.
  function allBox(sug) {
    var a = S.all, n = sug.length;
    if (a.running) return '<div class="stk-done" role="status"><span>Adding ' + a.done + " of " + a.total + " to today's order…</span></div>";
    return '<div class="stk-all-box" role="group" aria-labelledby="stk-all-q"><p id="stk-all-q">Put all ' + n + " on today's order, each with its own quantity and the supplier shown? You can change a line afterwards.</p>" +
      (a.err ? '<p class="stk-err" role="alert">' + esc(a.err) + "</p>" : "") +
      '<div class="acts">' + btn("all-cancel", "Cancel") + btn("all-go", "Add " + n, "", "p") + "</div></div>";
  }
  function addForm() {
    var a = S.adding;
    return '<div class="stk-addf"><form class="stk-form" id="stk-add" autocomplete="off" aria-label="Add an item to order"><label>Item<input name="item_name" value="' + esc(a.item_name || "") + '" placeholder="e.g. Augmentin 625 x14"></label><label class="n">How many<input name="qty" inputmode="numeric" value="' + esc(a.qty || "1") + '"></label>' +
      '<label>Supplier<input name="supplier" list="stk-sups" value="' + esc(a.supplier || "") + '" placeholder="Optional"></label><label>Note<input name="notes" value="' + esc(a.notes || "") + '" placeholder="Optional, e.g. for Mrs Borg"></label>' +
      (S.addErr ? '<p class="stk-err" role="alert">' + esc(S.addErr) + "</p>" : "") +
      '<div class="acts">' + btn("add-cancel", "Cancel") + '<button type="submit" class="stk-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Add to today") + "</button></div></form></div>";
  }
  function comingView() {
    var lines = onOrderLines(), gs = groups(lines), h = "";
    if (S.noFlow) return '<div class="stk-quiet">Marking what was ordered comes with the next server update. Until then, tick what arrives under To order.</div>';
    h += '<div class="stk-head"><p>' + (lines.length ? plural(gs.reduce(function (n, g) { return n + itemRows(g.lines).length; }, 0), "item", "items") + " on order from " + plural(gs.length, "supplier", "suppliers") : "Nothing on order.") + "</p></div>";
    gs.forEach(function (g) {
      var first = g.lines.reduce(function (m, l) { return !m || String(l.ordered_at) < m ? String(l.ordered_at) : m; }, ""), who = g.lines[0].ordered_by_name, ids = g.lines.map(function (l) { return l.id; }).join(",");
      h += '<section class="stk-card" aria-labelledby="stk-c-' + esc(g.k.replace(/[^a-z0-9]/g, "-")) + '"><div class="stk-ch"><h3 id="stk-c-' + esc(g.k.replace(/[^a-z0-9]/g, "-")) + '">' + esc(g.name || "No supplier") + "<span>" + esc(plural(itemRows(g.lines).length, "item", "items") + " · ordered " + when(first) + (who ? " by " + who : "")) + "</span></h3>" +
        '<div class="a">' + btn("unorder", "Not ordered after all", ' data-sup="' + esc(g.k) + '" data-ids="' + ids + '"' + busyAttr("g" + g.k), "s q") + btn("allin", S.busy["g" + g.k] ? "Saving…" : "All arrived", ' data-sup="' + esc(g.k) + '" data-ids="' + ids + '" aria-label="' + esc("All arrived from " + (g.name || "no supplier")) + '"' + busyAttr("g" + g.k), "s p") + "</div></div>";
      var pg = E.listPage.take("stk:c:" + g.k, itemRows(g.lines), {});
      h += pg.rows.map(function (l) { return lineRow(l, "coming"); }).join("") + "</section>" + E.listPage.moreHtml("stk:c:" + g.k, pg, "stk-btn");
    });
    if (!lines.length) h += '<div class="stk-quiet">When you mark a supplier\'s list as ordered under To order, it waits here until it arrives.</div>';
    var got = S.received.slice().sort(function (a, b) { return String(a.updated_at) < String(b.updated_at) ? 1 : -1; });
    if (got.length) {
      var pg2 = E.listPage.take("stk:got", got, {});
      h += '<h2 class="stk-h">Arrived in the last week <b>' + got.length + '</b></h2><div class="stk-card">' + pg2.rows.map(function (l) { return lineRow(l, "got"); }).join("") + "</div>" + E.listPage.moreHtml("stk:got", pg2, "stk-btn");
    }
    return h;
  }
  function when(dt) {
    var s = String(dt || ""); if (!s) return "";
    var d = new Date(s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")); if (isNaN(d)) return dm(s.slice(0, 10));
    var ymd = E.maltaYmd ? E.maltaYmd(d) : s.slice(0, 10), t = "";
    try { t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Malta" }); } catch (e) { t = s.slice(11, 16); }
    return dm(ymd) + " " + t;
  }
  function riskView() {
    var r = riskLists(), h = "";
    h += '<div class="stk-head"><p>' + (r.count ? plural(r.count, "thing needs", "things need") + " you." : "Nothing short or at risk.") + "</p></div>";
    var cols = "";
    // Recalls and quarantines
    if (r.alerts.length) {
      cols += '<section class="stk-card" aria-labelledby="stk-r-al"><div class="stk-ch"><h3 id="stk-r-al">Recalls and quarantines<span>' + plural(r.alerts.length, "open", "open") + "</span></h3></div>";
      r.alerts.slice(0, 8).forEach(function (a) {
        var next = null; ALERT_STEPS.some(function (s) { if (!Number(a[s[0]])) { next = s[1]; return true; } return false; });
        var replaced = S.open.concat(S.received).some(function (l) { return linked(l, "alert").indexOf(Number(a.id)) >= 0; });
        cols += '<div class="stk-row"><div class="t"><b>' + esc(a.item_name) + "</b>" + '<span>' + esc([a.alert_type === "quarantine" ? "Quarantine" : "Recall", a.batch ? "batch " + a.batch : "", a.quantity ? a.quantity + " in stock" : "", replaced ? "replacement ordered" : "", next ? "next: " + next : "every step done: close it"].filter(Boolean).join(" · ")) + "</span></div>" +
          '<div class="a">' + (a.alert_type !== "quarantine" && !replaced ? btn("replace", "Order a replacement", ' data-id="' + a.id + '"', "s q") : "") + btn("land", "Open", ' data-to="alertreg" data-id="' + a.id + '" data-sel="[data-act=tick][data-id=&quot;' + a.id + '&quot;]:not(.on)" aria-label="' + esc("Open the alert for " + a.item_name) + '"', "s") + "</div></div>";
      });
      cols += (r.alerts.length > 8 ? '<div class="stk-row">' + btn("go", "See all " + r.alerts.length, ' data-to="alertreg"', "s q") + "</div>" : "") + "</section>";
    }
    // Near expiry: expired, then within a month
    if (r.nex.length) {
      var expired = r.nex.filter(function (e) { return daysUntil(String(e.expiry_date).slice(0, 10)) < 0; }).length;
      cols += '<section class="stk-card" aria-labelledby="stk-r-nx"><div class="stk-ch"><h3 id="stk-r-nx">Near expiry<span>' + esc((expired ? expired + " expired · " : "") + plural(r.nex.length - expired, "within a month", "within a month")) + "</span></h3></div>";
      r.nex.slice(0, 8).forEach(function (e) {
        var n = daysUntil(String(e.expiry_date).slice(0, 10)), pill = n < 0 ? '<span class="stk-pill bad">Expired ' + esc(dm(String(e.expiry_date).slice(0, 10))) + "</span>" : '<span class="stk-pill warn">' + (n === 0 ? "Expires today" : "In " + plural(n, "day", "days")) + "</span>";
        cols += '<div class="stk-row"><div class="t"><b>' + esc(e.product_name) + "</b><span>" + esc([e.location, e.scarce_stock_offer_id ? "offered to other pharmacies" : ""].filter(Boolean).join(" · ") || "Expiry " + dm(String(e.expiry_date).slice(0, 10))) + "</span></div>" +
          '<div class="a">' + pill + btn("land", "Send back", ' data-to="nexreg" data-id="' + e.id + '" data-sel="[data-act=ret][data-id=&quot;' + e.id + '&quot;]" data-click="1" aria-label="' + esc("Send back " + e.product_name) + '"', "s") + "</div></div>";
      });
      cols += (r.nex.length > 8 ? '<div class="stk-row">' + btn("go", "See all " + r.nex.length, ' data-to="nexreg"', "s q") + "</div>" : "") + "</section>";
    }
    // Returns waiting on the supplier
    if (r.rets.length) {
      var oldest = r.rets[0];
      cols += '<section class="stk-card" aria-labelledby="stk-r-rt"><div class="stk-ch"><h3 id="stk-r-rt">Returns waiting<span>' + esc(plural(r.rets.length, "return", "returns") + " without a credit note · oldest " + dm(oldest.entry_date)) + "</span></h3></div>";
      r.rets.slice(0, 6).forEach(function (e) {
        var nx = null; RET_STEPS.some(function (s) { if (!Number(e[s[0]])) { nx = s; return true; } return false; });
        cols += '<div class="stk-row"><div class="t"><b>' + esc(e.description) + "</b><span>" + esc([e.supplier, e.quantity ? "× " + e.quantity : "", "since " + dm(e.entry_date)].filter(Boolean).join(" · ")) + "</span></div>" +
          '<div class="a">' + (nx ? btn("land", "Next: " + esc(nx[1].toLowerCase()), ' data-to="retreg" data-id="' + e.id + '" data-sel="[data-act=step][data-id=&quot;' + e.id + '&quot;]" aria-label="' + esc("Next step for " + e.description + ": " + nx[1]) + '"', "s") : "") + "</div></div>";
      });
      cols += (r.rets.length > 6 ? '<div class="stk-row">' + btn("go", "See all " + r.rets.length, ' data-to="retreg"', "s q") + "</div>" : "") + "</section>";
    }
    // What you are short of (asked other pharmacies for)
    if (r.needs.length) {
      cols += '<section class="stk-card" aria-labelledby="stk-r-nd"><div class="stk-ch"><h3 id="stk-r-nd">You are short of<span>Asked other pharmacies</span></h3></div>';
      r.needs.slice(0, 6).forEach(function (n) {
        var offers = (n.offers || []).filter(function (o) { return !o.accepted; }).length;
        cols += '<div class="stk-row"><div class="t"><b>' + esc(n.item_name) + "</b><span>" + esc([n.needed_by ? "needed by " + dm(n.needed_by) : "", offers ? plural(offers, "offer", "offers") + " to answer" : "no offer yet"].filter(Boolean).join(" · ")) + "</span></div>" +
          '<div class="a">' + btn("land", offers ? "See offers" : "Open", ' data-to="ssreg" data-id="' + n.id + '" data-sel=""', "s") + "</div></div>";
      });
      cols += "</section>";
    }
    if (cols) h += '<div class="stk-cols">' + cols + "</div>";
    else h += '<div class="stk-quiet">No open recalls, nothing expiring within a month, no returns waiting and nothing you are short of.</div>';
    var miss = ["alerts", "nex", "rets", "needs"].filter(function (k) { return S.part[k] === false; });
    if (miss.length) h += '<p class="stk-note" role="status">Some lists could not be read just now. ' + btn("retry", "Try again", "", "s q") + "</p>";
    return h;
  }

  function counts() {
    var sug = suggestions().length, rows = function (ls) { return groups(ls).reduce(function (n, g) { return n + itemRows(g.lines).length; }, 0); };
    return { order: rows(toOrderLines()) + sug, coming: S.noFlow ? 0 : rows(onOrderLines()), risk: riskLists().count };
  }
  function paint() {
    var m = S.mount; if (!m || !document.body.contains(m) || E.state.activeModuleId !== "stock") return;
    if (S.adding && !S.saving) keepAdd();
    if (S.sug && !S.saving) keepSug();
    var h = "";
    if (!S.at && (S.loading || !S.error)) {
      h = '<div class="stk-seg" role="group" aria-label="Stock work">' + VIEWS.map(function (v) { return '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (S.view === v[0]) + '">' + v[1] + "</button>"; }).join("") + "</div>" +
        '<div class="stk-card" style="margin-top:16px" role="status" aria-busy="true"><span class="stk-sr">Opening what to order</span><div class="stk-skel"></div><div class="stk-skel"></div><div class="stk-skel"></div><div class="stk-skel"></div></div>';
    } else if (S.error && !S.at) {
      h = '<div class="stk-quiet" role="alert">' + esc(S.error) + "<br>" + btn("retry", "Try again") + "</div>";
    } else {
      var c = counts();
      h = '<div class="stk-seg" role="group" aria-label="Stock work">' + VIEWS.map(function (v) { return '<button type="button" data-view="' + v[0] + '" aria-pressed="' + (S.view === v[0]) + '">' + v[1] + (c[v[0]] ? " <b>" + c[v[0]] + "</b>" : "") + "</button>"; }).join("") + "</div>";
      if (S.error) h += '<div class="stk-quiet" role="alert">' + esc(S.error) + "<br>" + btn("retry", "Try again") + "</div>";
      if (S.done) h += '<div class="stk-done" role="status"><span>' + esc(S.done.text) + "</span>" + (S.done.undo ? btn("undo", "Undo", "", "s q") : "") + "</div>";
      if (S.view !== "risk") h += tellHtml();
      h += S.view === "coming" ? comingView() : S.view === "risk" ? riskView() : orderView();
      h += supDatalist();
    }
    var ae = document.activeElement, fk = ae && m.contains(ae) && E.focusKey ? E.focusKey(ae) : "";
    m.innerHTML = h;
    if (fk) { var again = null; try { again = m.querySelector(fk); } catch (e) {} if (again && !again.disabled) again.focus({ preventScroll: true }); }
    wire(m);
  }
  function keepAdd() { var f = S.mount && S.mount.querySelector("#stk-add"); if (!f || !S.adding) return; ["item_name", "qty", "supplier", "notes"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || ""); }); }
  function keepSug() { var f = S.mount && S.mount.querySelector("#stk-sug"); if (!f || !S.sug) return; ["qty", "supplier"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.sug[k] = String(el.value || ""); }); }
  function focusOn(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }, 0); }
  function setView(v) { S.view = v; try { localStorage.setItem("eikon_stk_view", v); } catch (e) {} S.done = null; S.sug = null; S.pick = null; if (S.all && !S.all.running) S.all = null; paint(); focusOn('[data-view="' + v + '"]'); }

  function wire(m) {
    m.querySelectorAll("[data-view]").forEach(function (b) { b.addEventListener("click", function () { setView(b.getAttribute("data-view")); }); });
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id")), oid = Number(b.getAttribute("data-oid"));
        if (a === "retry") { S.at = 0; load(true); }
        else if (a === "add") { S.adding = { qty: "1" }; S.addErr = ""; paint(); focusOn("#stk-add [name=item_name]"); }
        else if (a === "add-cancel") { S.adding = null; S.addErr = ""; paint(); focusOn("[data-act=add]"); }
        else if (a === "sug") { var k = b.getAttribute("data-k"); if (S.sug && S.sug.k === k) { S.sug = null; paint(); return focusOn('[data-act=sug][data-k="' + k + '"]'); } var s = suggestions().find(function (x) { return x.k === k; }); if (!s) return; var p = priceFor(s.item); S.sug = { k: k, qty: String(s.qty || 1), supplier: s.sup || (p ? String(p.best.supplier || "").trim() : "") }; S.sugErr = ""; paint(); focusOn("#stk-sug [name=supplier]"); }
        else if (a === "all") { S.all = {}; S.sug = null; paint(); focusOn("[data-act=all-go]"); }
        else if (a === "all-cancel") { S.all = null; paint(); focusOn("[data-act=all]"); }
        else if (a === "all-go") addAll();
        else if (a === "sug-cancel") { var k2 = S.sug && S.sug.k; S.sug = null; S.sugErr = ""; paint(); focusOn('[data-act=sug][data-k="' + k2 + '"]'); }
        else if (a === "pick") { if (S.pick === id) { S.pick = null; paint(); return focusOn('[data-act=pick][data-id="' + id + '"]'); } S.pick = id; S.pickVal = ""; S.pickErr = ""; paint(); focusOn("#stk-pick [name=supplier]"); }
        else if (a === "pick-cancel") { var pid = S.pick; S.pick = null; paint(); focusOn('[data-act=pick][data-id="' + pid + '"]'); }
        else if (a === "move") moveTo(id, b.getAttribute("data-sup"));
        else if (a === "ordered") markOrdered(b.getAttribute("data-sup"), ids(b), false);
        else if (a === "unorder") markOrdered(b.getAttribute("data-sup"), ids(b), true);
        else if (a === "copy") copyList(b.getAttribute("data-sup"), b);
        else if (a === "arrived") setStatus(ids(b), "received");
        else if (a === "notin") setStatus(ids(b), "not_received");
        else if (a === "unarrive") setStatus([id], "pending");
        else if (a === "allin") setStatus(ids(b), "received", b.getAttribute("data-sup"));
        else if (a === "ready") ready(oid);
        else if (a === "open-order" || a === "message") { var o = S.orders.find(function (x) { return orderId(x) === oid; }); if (!o) return; if (a === "message") { try { E.stockFlow.tell(tellOf(o)); } catch (e) {} return; } if (E.customerHandoff) E.customerHandoff("ordreg", "open", { name: o.client_name, phone: o.client_phone || "" }, "", oid); window.location.hash = "#ordreg"; }
        else if (a === "replace") replace(id);
        else if (a === "undo") undo();
        else if (a === "land") { ev.preventDefault(); E.stockLand.go(b.getAttribute("data-to"), b.getAttribute("data-sel"), b.getAttribute("data-click") === "1"); }
        else if (a === "go") window.location.hash = "#" + b.getAttribute("data-to");
        else if (a === "q58-more") { /* E.listPage's own button */ var nid = E.listPage.more(b.getAttribute("data-key")); paint(); }
      });
    });
    var fa = m.querySelector("#stk-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
    var fs = m.querySelector("#stk-sug"); if (fs) fs.addEventListener("submit", function (ev) { ev.preventDefault(); addSug(); });
    var fp = m.querySelector("#stk-pick"); if (fp) fp.addEventListener("submit", function (ev) { ev.preventDefault(); keepPick(); moveTo(S.pick, S.pickVal, true); });
    var ab = m.querySelector(".stk-all-box"); if (ab) ab.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); var c = ab.querySelector("[data-act=all-cancel]"); if (c) c.click(); } });
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
  }
  function keepPick() { var f = S.mount && S.mount.querySelector("#stk-pick [name=supplier]"); if (f) S.pickVal = String(f.value || "").trim(); }
  function ids(b) { return String(b.getAttribute("data-ids") || "").split(",").map(Number).filter(function (n) { return n > 0; }); }
  function lineById(id) { return S.open.concat(S.received).find(function (l) { return l.id === id; }) || null; }
  function tellOf(o) { return { client_order_id: orderId(o), client_name: o.client_name, client_phone: String(o.client_phone || o.contact || ""), items: String(o.items_text || o.items || "") }; }

  // ---- saving ------------------------------------------------------------------------------------------------------
  function api(method, path, body) { return E.apiFetch(path, { method: method, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || "Save failed"); return r; }); }
  function diaryList(day) { return E.apiFetch("/order-diary/entries?date=" + encodeURIComponent(day), { method: "GET" }).then(function (r) { return (r && r.entries) || []; }); }
  // A diary line for today: the classic Add body, once (E.postOnce looks in today's list when an answer is lost).
  async function newLine(item, qty, supplier, notes) {
    var body = { order_date: today(), item_name: item, qty: qty, supplier: supplier, notes: notes };
    var r = await E.postOnce("/order-diary/entries", body, { list: function () { return diaryList(body.order_date); },
      same: function (e) { return String(e.item_name).trim().toLowerCase() === item.toLowerCase() && Number(e.qty) === qty && String(e.supplier || "").trim().toLowerCase() === supplier.toLowerCase(); } });
    if (r && r.id) return r.id;
    var rows = await diaryList(body.order_date), hit = rows.filter(function (e) { return String(e.item_name).trim().toLowerCase() === item.toLowerCase() && Number(e.qty) === qty; }).pop(); // the answer was lost: the line in the list
    return hit ? hit.id : null;
  }
  function wholeQty(s) { s = String(s == null ? "" : s).trim() || "1"; return /^\d+$/.test(s) && Number(s) >= 1 ? Number(s) : NaN; }
  async function add() {
    if (S.saving) return; keepAdd();
    var a = S.adding, item = String(a.item_name || "").trim(), qty = wholeQty(a.qty); S.addErr = "";
    if (!item) S.addErr = "Write the item. Nothing was saved."; else if (!(qty >= 1)) S.addErr = "Write how many (a whole number). Nothing was saved.";
    if (S.addErr) { paint(); return focusOn("#stk-add [name=" + (item ? "qty" : "item_name") + "]"); }
    S.saving = true; paint();
    try { await newLine(item, qty, String(a.supplier || "").trim(), String(a.notes || "").trim()); E.toast("Added " + item + " × " + qty, "success"); S.adding = { qty: "1", supplier: String(a.supplier || "").trim() }; S.done = { text: "Added " + item + " × " + qty + " to today's order diary." }; } // ready for the next item, same supplier
    catch (x) { S.addErr = E.saveFailText(x); }
    S.saving = false; var f = S.mount && S.mount.querySelector("#stk-add"); if (f && !S.addErr) { f.remove(); paint(); focusOn("#stk-add [name=item_name]"); } // the form is cleared at once (drawn from what is kept); the lists follow when it is left
    await load(true); focusOn("#stk-add [name=" + (S.addErr ? "item_name" : "item_name") + "]");
  }
  async function addSug() {
    if (S.saving || !S.sug) return; keepSug();
    var s = suggestions().find(function (x) { return x.k === S.sug.k; }); if (!s) { S.sug = null; return paint(); }
    var qty = wholeQty(S.sug.qty), sup = String(S.sug.supplier || "").trim(); S.sugErr = "";
    if (!(qty >= 1)) { S.sugErr = "Write how many (a whole number). Nothing was saved."; paint(); return focusOn("#stk-sug [name=qty]"); }
    S.saving = true; paint();
    try {
      var id = await newLine(s.item, qty, sup, ""); // notes stay empty, as the Orders screen's "Add to diary": what it is for is in the link
      if (id && !S.noFlow) await api("POST", "/stock-flow/links", { diary_id: id, source: s.kind, source_id: s.id }).catch(function () {});
      S.sug = null; S.done = { text: s.item + " × " + qty + " is on today's order" + (sup ? " for " + sup : "") + "." };
    } catch (x) { S.sugErr = E.saveFailText(x); }
    S.saving = false; await load(true);
    if (!S.sugErr) focusOn("[data-act=sug],[data-act=ordered],[data-act=add]");
  }
  async function addAll() {
    if (S.saving || !S.all || S.all.running) return;
    var list = suggestions(); if (!list.length) { S.all = null; return paint(); }
    S.saving = true; S.all = { running: true, done: 0, total: list.length }; paint();
    var err = "";
    for (var i = 0; i < list.length; i++) {
      var s = list[i], p = priceFor(s.item), sup = String(s.sup || (p ? String(p.best.supplier || "").trim() : "")).trim(), qty = wholeQty(s.qty) || 1;
      try {
        var id = await newLine(s.item, qty, sup, ""); // the row's own Add to order with what it offers
        if (id && !S.noFlow) await api("POST", "/stock-flow/links", { diary_id: id, source: s.kind, source_id: s.id }).catch(function () {});
        S.all.done = i + 1; paint();
      } catch (x) { err = E.saveFailText(x); break; }
    }
    var done = S.all.done; S.saving = false;
    S.all = err ? { err: "Added " + done + " of " + list.length + ". " + err + " The rest are still here." } : null;
    S.done = done ? { text: plural(done, "item is", "items are") + " on today's order. Mark each supplier's list ordered when you send it." } : null;
    await load(true); focusOn(err ? "[data-act=all-go]" : "[data-act=ordered], [data-act=add]");
  }
  async function replace(alertId) {
    var a = S.alerts.find(function (x) { return Number(x.id) === alertId; }); if (!a) return;
    S.view = "order"; try { localStorage.setItem("eikon_stk_view", "order"); } catch (e) {}
    var k = "alert:" + alertId, p = priceFor(a.item_name), q = parseInt(String(a.quantity || "1"), 10);
    S.sug = { k: k, qty: String(q > 0 ? q : 1), supplier: a.supplier || (p ? String(p.best.supplier || "").trim() : "") }; S.sugErr = "";
    E.listPage.reveal("stk", k); paint(); focusOn("#stk-sug [name=qty]");
  }
  // A row's supplier: the classic Edit Item body with only the supplier changed, for each diary line of the row.
  async function moveTo(id, sup, fromPick) {
    var l = lineById(id); sup = String(sup || "").trim(); if (!l) return;
    if (!sup) { S.pickErr = "Write the supplier. Nothing was saved."; paint(); return focusOn("#stk-pick [name=supplier]"); }
    if (S.busy["l" + id]) return; S.busy["l" + id] = true; paint();
    var row = itemRows(toOrderLines()).find(function (r) { return r.ids.indexOf(id) >= 0; }), all = row ? row.lines : [l];
    try {
      for (var i = 0; i < all.length; i++) { var x = all[i]; await api("PUT", "/order-diary/entries/" + x.id, { item_name: String(x.item_name || "").trim(), qty: Number(x.qty), supplier: sup, notes: String(x.notes || "").trim() }); }
      S.pick = null; E.toast(l.item_name + " now from " + sup, "success");
    }
    catch (x) { var t = E.saveFailText(x); if (fromPick) S.pickErr = t; else E.toast(t, "error"); }
    S.busy["l" + id] = false; await load(true); focusOn('[data-line="' + id + '"] button, [data-act=ordered]');
  }
  async function markOrdered(sk, list, undoIt) {
    if (!list.length || S.busy["g" + sk]) return;
    S.busy["g" + sk] = true; paint();
    var name = (S.open.find(function (l) { return list.indexOf(l.id) >= 0; }) || {}).supplier || "";
    try {
      if (!undoIt) { // a line that did not come or came wrong is ordered again: back to waiting (the classic Undo), then marked
        var again = S.open.filter(function (l) { return list.indexOf(l.id) >= 0 && l.status !== "pending"; });
        for (var i = 0; i < again.length; i++) await api("PUT", "/order-diary/entries/" + again[i].id, { status: "pending" });
      }
      await api("POST", "/stock-flow/ordered" + (undoIt ? "/undo" : ""), undoIt ? { diary_ids: list } : { diary_ids: list, supplier: String(name).trim() });
      S.done = undoIt ? { text: name + ": back to To order." } : { text: name + ": " + plural(list.length, "item", "items") + " marked ordered. They wait under On order until they arrive.", undo: { kind: "ordered", ids: list, sup: sk } };
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy["g" + sk] = false; await load(true);
    focusOn(undoIt ? '[data-view="coming"]' : ".stk-done [data-act=undo]");
  }
  // Arrived / Not in / Undo: the order diary's own status change, line by line (the classic "Mark all received" too).
  async function setStatus(list, status, sk) {
    var bk = sk ? "g" + sk : "l" + list[0]; if (S.busy[bk]) return;
    S.busy[bk] = true; paint();
    var before = toTell().map(function (c) { return orderId(c.o); }), ok = [];
    try { for (var i = 0; i < list.length; i++) { await api("PUT", "/order-diary/entries/" + list[i], { status: status }); ok.push(list[i]); } }
    catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy[bk] = false;
    var names = ok.map(function (id) { var l = lineById(id); return l ? l.item_name : ""; }).filter(Boolean);
    if (ok.length && status === "received") S.done = { text: (names.length === 1 ? names[0] + " arrived." : plural(names.length, "item", "items") + " arrived."), undo: { kind: "status", ids: ok, to: "pending" } };
    else if (ok.length && status === "not_received") S.done = { text: names[0] + " did not come: it is back under To order.", undo: { kind: "status", ids: ok, to: "pending" } };
    else if (ok.length) S.done = { text: "Undone." };
    await load(true);
    if (ok.length && status === "received") {
      var fresh = toTell().filter(function (c) { return before.indexOf(orderId(c.o)) < 0; });
      if (fresh.length) {
        S.done.text += " " + (fresh.length === 1 ? fresh[0].o.client_name + " is waiting for it: tell them." : fresh.length + " customers are waiting for these: tell them.");
        paint();
        compute(); var detail = { lines: ok.map(lineById).filter(Boolean).map(function (l) { return { diary_id: l.id, item_name: l.item_name, qty: l.qty, supplier: l.supplier }; }), customers: fresh.map(function (c) { return tellOf(c.o); }) };
        hooks.forEach(function (fn) { try { fn(detail); } catch (e) {} });
        try { window.dispatchEvent(new CustomEvent("eikon:stock-arrived", { detail: detail })); } catch (e) {}
      }
    }
    focusOn(".stk-tell [data-act=ready], .stk-tell [data-act=open-order], .stk-done [data-act=undo], [data-act=arrived]");
  }
  async function ready(oid) {
    var o = S.orders.find(function (x) { return orderId(x) === oid; }); if (!o || S.busy["o" + oid]) return;
    S.busy["o" + oid] = true; paint();
    try { await api("PUT", "/client-orders/entries/" + oid, { fulfilled: true }); E.toast(o.client_name + "'s order is ready", "success"); S.done = { text: o.client_name + "'s order is marked ready." }; } // only that, as the Orders screen's Ready
    catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy["o" + oid] = false; await load(true); focusOn(".stk-tell [data-act=ready], .stk-done");
  }
  async function undo() {
    var u = S.done && S.done.undo; if (!u) return;
    S.done = null;
    if (u.kind === "ordered") return markOrdered(u.sup, u.ids, true);
    if (u.kind === "status") return setStatus(u.ids, u.to);
  }
  function copyList(sk, b) {
    var lines = toOrderLines().filter(function (l) { return (supKey(l.supplier) || "~none") === sk; }); if (!lines.length) return;
    var pharm = (E.state && E.state.user && (E.state.user.location_name || E.state.user.org_name)) || "";
    var text = "Order" + (pharm ? " from " + pharm : "") + " — " + (lines[0].supplier || "") + "\n" + lines.map(function (l) { return l.item_name + " × " + l.qty; }).join("\n");
    var done = function () { E.toast("Copied " + plural(lines.length, "line", "lines") + " for " + lines[0].supplier, "success"); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); }); return; } } catch (e) {}
    fallbackCopy(text); done();
  }
  function fallbackCopy(text) { var t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(t); }

  // ---- landing on a row in another Stock screen ---------------------------------------------------------------------
  // "Send back", "Open", "Next: …" go to the screen that owns the thing and put focus on that very row's button (and,
  // for Send back, open its form): the screen calls E.stockLand.apply(id, mount) once its list is in.
  var LAND = "eikon_stk_land";
  E.stockLand = {
    go: function (to, sel, click) { try { sessionStorage.setItem(LAND, JSON.stringify({ to: to, sel: sel || "", click: !!click, at: Date.now() })); } catch (e) {} window.location.hash = "#" + to; },
    apply: function (screen, mount) {
      var w = null; try { w = JSON.parse(sessionStorage.getItem(LAND) || "null"); } catch (e) { w = null; }
      if (!w || w.to !== screen) return; try { sessionStorage.removeItem(LAND); } catch (e) {}
      if (!w.sel || Date.now() - (w.at || 0) > 20000 || !mount) return;
      var since = Date.now(), from = document.activeElement, t0 = Date.now();
      (function look() {
        if (!document.body.contains(mount) || E.state.activeModuleId !== screen) return;
        var el = null; try { el = mount.querySelector(w.sel); } catch (e) { return; }
        if (!el) { if (Date.now() - t0 < 4000) setTimeout(look, 60); return; }
        try { el.scrollIntoView({ block: "center" }); } catch (e) {}
        if (w.click && !(E.personSince && E.personSince(since))) { el.click(); return; }
        E.focusIfIdle(el, since, from);
        // the screen puts focus on its heading as it opens from a hub: once that has happened, the row's button again
        [150, 450].forEach(function (ms) { setTimeout(function () { var a = document.activeElement; if (el.isConnected && a !== el && (!a || a === document.body || a.tagName === "H1") && !(E.personSince && E.personSince(since + 1))) E.focusIfIdle(el, since, a); }, ms); });
      })();
    }
  };

  // ---- the hook for Customers & messaging ---------------------------------------------------------------------------
  // E.stockFlow.onArrived(fn): fn({ lines: [{ diary_id, item_name, qty, supplier }], customers: [{ client_order_id,
  //   client_name, client_phone, items }] }) after lines are marked arrived and customers are waiting for them (also
  //   sent as the window event "eikon:stock-arrived").
  // E.stockFlow.waiting(): a promise of the customers whose item is in and whose order is not ready yet (same shape).
  // E.stockFlow.tell = function (customer) { ... }: set by messaging; a "Send a message" button then appears beside Ready.
  var hooks = [];
  E.stockFlow = {
    render: function (slot) {
      css(); S.mount = slot;
      if (!S.view) { var v = ""; try { v = localStorage.getItem("eikon_stk_view") || ""; } catch (e) {} S.view = VIEWS.some(function (x) { return x[0] === v; }) ? v : "order"; }
      if (!S.seen) { S.seen = 1; E.listPage.reset && E.listPage.reset("stk"); }
      paint(); return load(false);
    },
    reload: function () { return load(true); }, // the screen stays as it is (and what is typed) until the lists are in
    onArrived: function (fn) { if (typeof fn === "function") hooks.push(fn); return function () { hooks = hooks.filter(function (f) { return f !== fn; }); }; },
    waiting: function () { return (S.at && Date.now() - S.at < KEEP_MS ? Promise.resolve() : load(true)).then(function () { return toTell().map(function (c) { return Object.assign(tellOf(c.o), { item_name: c.line.item_name, diary_id: c.line.id }); }); }); },
    tell: null,
    _test: { sameItem: sameItem, priceFor: function (n, quotes) { S.quotes = quotes; priceMemo = {}; return priceFor(n); } }
  };
  if (E.tellStockHook) E.tellStockHook(); // Tell the customer (eikon.tell.js) fills E.stockFlow.tell
  // The hub was drawn before this file arrived: draw the flow into it now.
  try { var slot = document.getElementById("stk-slot"); if (slot && E.state && E.state.activeModuleId === "stock") E.stockFlow.render(slot); } catch (e) {}
})();
