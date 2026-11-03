/* Quotations, new layout: "who is cheapest for this?". Search an item; quotes are grouped by item with the real cost of
   one unit (discount and free stock counted), retail price and margin, the cheapest marked Best. A switch includes the
   quotes of every pharmacy in the group. Record a quote: the unit cost and the margin show as you type; the server
   works out the stored totals with the same formula. Editing and deleting stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], all: false, q: "", loading: false, error: "", adding: null, saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // The year is left out when it is this year (3 Nov), kept otherwise (4 Mar 2027): rows stay on fewer lines on a phone.
  function dm(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + (Number(p[0]) === new Date().getFullYear() ? "" : " " + p[0]) : ""; }
  function eur(n) { return "€" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function num(raw) { var s = String(raw == null ? "" : raw).replace(/[€%\s]/g, "").replace(",", "."); return s === "" ? null : (/^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN); }
  function low(s) { return String(s || "").trim().toLowerCase(); }
  // the server's formula (computeItemProfitFields): profit on cost excl. VAT, retail counted on bought + free
  function calc(f) {
    var excl = Math.max(0, Number(f.cost_excl_vat) || 0), disc = Math.max(0, Number(f.discount_euro) || 0), buy = Math.max(1, Math.round(Number(f.qty_purchased) || 1)), free = Math.max(0, Math.round(Number(f.qty_free) || 0)), retail = Math.max(0, Number(f.retail_price) || 0);
    var eff = Math.max(0, excl - disc), unit = eff * buy / (buy + free), totalRetail = retail * (buy + free), profit = totalRetail - eff * buy;
    return { unit: unit, margin: totalRetail > 0 ? profit / totalRetail * 100 : null, deal: free ? buy + "+" + free : "" };
  }

  function css() {
    if (document.getElementById("eikon-qtreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-qtreg-css";
    st.textContent =
      ".qtr{max-width:880px;margin:0 auto}" +
      ".qtr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".qtr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".qtr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.qtr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".qtr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".qtr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.qtr-btn:disabled{opacity:.55;cursor:default}" +
      ".qtr-bar{display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap}.qtr-q{flex:1;min-width:200px;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".qtr-sw{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)}.qtr-sw input{width:20px;height:20px;accent-color:var(--accent)}" +
      ".qtr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;justify-content:space-between;gap:8px}.qtr-lab b{color:var(--text);text-transform:none;letter-spacing:0;font-size:14px}" +
      ".qtr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".qtr-row{display:flex;gap:12px;align-items:center;padding:10px 16px;border-top:.5px solid var(--border)}.qtr-row:first-child{border-top:0}" +
      ".qtr-row .t{flex:1;min-width:0}.qtr-row b{font-size:15px;font-weight:600}.qtr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}" +
      ".qtr-row .n{text-align:right}.qtr-row .n em{display:block;font-style:normal;font-weight:700;font-size:16px;font-variant-numeric:tabular-nums}.qtr-row .n small{font-size:12px;color:var(--muted)}" +
      ".qtr-best{font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(28,138,91,.16);color:var(--ok);margin-left:6px}" +
      ".qtr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".qtr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.qtr-form label:first-child{border-top:0}" +
      ".qtr-form label>span{flex:0 0 118px;font-size:15px}.qtr-form input,.qtr-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".qtr-prev{display:flex;justify-content:space-between;padding:10px 14px;border-top:.5px solid var(--border);font-size:14px}.qtr-prev b{font-variant-numeric:tabular-nums}" +
      ".qtr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}.qtr-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".qtr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.qtr{padding:4px 16px 0}.qtr h1{font-size:32px}.qtr-form label>span{flex-basis:104px}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".qtr-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.qtr-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".qtr-quiet .qtr-btn{margin-top:12px;display:block}" +
      "@media (max-width:600px){.qtr-btn,.qtr-btn.s{height:44px;border-radius:22px}.qtr-q{height:44px}.qtr-sw{min-height:44px;display:flex;align-items:center}}";
    document.head.appendChild(st);
  }

  async function fetchList(all) { var r = await E.apiFetch("/quotations/entries" + (all ? "?all_org=1" : ""), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load quotations"); return r.entries || []; }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { S.entries = await fetchList(S.all); } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load quotations"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function rowHtml(e, best) {
    var c = calc(e), sub = [e.supplier || "No supplier", dm(e.quote_date)]; if (c.deal) sub.splice(1, 0, c.deal + " deal"); if (S.all && e.location_name) sub.push(e.location_name);
    return '<div class="qtr-row"><div class="t"><b>' + esc(e.supplier || "No supplier") + "</b>" + (best ? '<i class="qtr-best" style="font-style:normal">Best</i>' : "") + "<span>" + esc(sub.slice(1).join(" · ")) + (e.notes ? " · " + esc(e.notes) : "") + '</span></div><div class="n"><em>' + eur(c.unit) + "</em><small>a unit" + (c.margin != null ? " · " + Math.round(c.margin) + "% margin" : "") + "</small></div></div>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "qtreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep();
    var qi = m.querySelector("#qtr-q"); if (qi) S.q = qi.value;
    var h = '<div class="qtr"><button class="qtr-back" data-act="back">' + esc(E.ui2BackLabel("qtreg")) + '</button>' +
      '<div class="qtr-top"><div><h1>Price check</h1><p class="qtr-sub">Supplier quotes, cheapest first, with your margin.</p></div>' + (S.adding ? "" : '<button class="qtr-btn p" data-act="add">New quote</button>') + "</div>";
    if (S.adding) h += formHtml();
    h += '<div class="qtr-bar"><input class="qtr-q" id="qtr-q" type="search" aria-label="Search quotes" placeholder="Item, barcode or supplier" value="' + esc(S.q) + '"><label class="qtr-sw"><input type="checkbox" id="qtr-all"' + (S.all ? " checked" : "") + "> All our pharmacies</label></div>";
    h += '<div id="qtr-res">' + listHtml() + "</div>";
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changing or deleting a quote is in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) ? (ae.id === "qtr-q" ? "#qtr-q" : ae.name ? "[name=" + ae.name + "]" : "") : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("qtreg");
        else if (act === "retry") load();
        else if (act === "add") { S.adding = { quote_date: today(), vat_rate: "18", qty_purchased: "1", qty_free: "0", item_description: S.q || "" }; S.err = ""; paint(true); setTimeout(function () { var f = m.querySelector("[name=item_description]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); setTimeout(function () { var b = m.querySelector('[data-act="add"]'); if (b) b.focus(); }, 30); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "qtreg"); } catch (x) {} E.openClassic("quotations"); }
      });
    });
    var qn = m.querySelector("#qtr-q"); if (qn) qn.addEventListener("input", function () { S.q = qn.value; var res = m.querySelector("#qtr-res"); if (res) { res.innerHTML = listHtml(); res.querySelectorAll('[data-act="retry"]').forEach(function (b) { b.addEventListener("click", function () { load(); }); }); } });
    var al = m.querySelector("#qtr-all"); if (al) al.addEventListener("change", function () { S.all = al.checked; S.entries = []; load(); });
    // Escape closes the open form (what is typed in it is dropped, as with Cancel) and puts you back where you were.
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
    var f = m.querySelector("#qtr-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      f.addEventListener("input", function () { keep(); var pv = m.querySelector("#qtr-prev"); if (pv) pv.innerHTML = previewHtml(); });
    }
  }
  // The quotes alone: searching redraws only this, never the box being typed in.
  function listHtml() {
    var h = "";
    if (S.loading && !S.entries.length) h += '<div class="qtr-quiet" aria-busy="true">Opening quotations…</div>';
    else if (S.error) h += '<div class="qtr-quiet" role="alert">' + esc(S.error) + '<button class="qtr-btn" data-act="retry">Try again</button></div>';
    else {
      var q = low(S.q), rows = S.entries.filter(function (e) { return !q || [e.item_description, e.barcode, e.stock_code, e.supplier].some(function (v) { return low(v).indexOf(q) >= 0; }); });
      var groups = {}, order = [];
      rows.forEach(function (e) { var k = low(e.item_description); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(e); });
      var shown = order.slice(0, q ? 60 : 15);
      if (!shown.length) h += '<div class="qtr-quiet">' + (q ? "No quote for “" + esc(S.q) + "” yet." : "No quotations yet.") + "</div>";
      if (!q && order.length) h += '<p style="font-size:13px;color:var(--muted);margin:12px 2px 0">The latest items. Search to compare suppliers for one item.</p>';
      shown.forEach(function (k) {
        var g = groups[k].slice().sort(function (a, b) { return calc(a).unit - calc(b).unit || String(b.quote_date).localeCompare(String(a.quote_date)); });
        h += '<div class="qtr-lab"><b>' + esc(g[0].item_description) + "</b><span>" + g.length + (g.length === 1 ? " quote" : " quotes") + '</span></div><div class="qtr-list">' + g.map(function (e, i) { return rowHtml(e, i === 0 && g.length > 1 && calc(e).unit < calc(g[1]).unit); }).join("") + "</div>";
      });
    }
    return h;
  }
  function previewHtml() {
    var a = S.adding || {}, ok = [a.cost_excl_vat, a.retail_price].every(function (v) { var n = num(v); return n != null && !isNaN(n); });
    if (num(a.cost_excl_vat) == null || isNaN(num(a.cost_excl_vat))) return "<span>One unit costs</span><b>—</b>";
    var c = calc({ cost_excl_vat: num(a.cost_excl_vat), discount_euro: num(a.discount_euro) || 0, qty_purchased: num(a.qty_purchased) || 1, qty_free: num(a.qty_free) || 0, retail_price: ok ? num(a.retail_price) : 0 });
    return "<span>One unit costs</span><b>" + eur(c.unit) + (ok && c.margin != null ? " · " + Math.round(c.margin) + "% margin" : "") + "</b>";
  }
  function formHtml() {
    var a = S.adding, fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + "></label>"; };
    var items = []; var seen = {}; S.entries.forEach(function (e) { var k = low(e.item_description); if (k && !seen[k]) { seen[k] = 1; items.push(e.item_description); } });
    var sups = []; seen = {}; S.entries.forEach(function (e) { var k = low(e.supplier); if (k && !seen[k]) { seen[k] = 1; sups.push(e.supplier); } });
    return '<form class="qtr-form" id="qtr-add" autocomplete="off">' + fld("item_description", "Item", ' list="qtr-items" placeholder="e.g. Panadol 500mg x24"') + fld("supplier", "Supplier", ' list="qtr-sups"') +
      '<label><span>VAT</span><select name="vat_rate">' + ["18", "5", "0"].map(function (v) { return '<option value="' + v + '"' + (String(a.vat_rate) === v ? " selected" : "") + ">" + v + "%</option>"; }).join("") + "</select></label>" +
      fld("cost_excl_vat", "Cost € (no VAT)", ' inputmode="decimal" placeholder="Per unit"') + fld("discount_euro", "Discount €", ' inputmode="decimal" placeholder="Per unit, optional"') +
      fld("qty_purchased", "Buy", ' inputmode="numeric"') + fld("qty_free", "Free", ' inputmode="numeric" placeholder="e.g. 2 for a 10+2 deal"') + fld("retail_price", "Retail € each", ' inputmode="decimal" placeholder="Optional"') +
      fld("barcode", "Barcode", ' placeholder="Optional" inputmode="numeric"') +
      '<div class="qtr-prev" id="qtr-prev">' + previewHtml() + "</div>" + (S.err ? '<div class="qtr-err" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="qtr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="qtr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save quote") + "</button></div>" +
      '<datalist id="qtr-items">' + items.slice(0, 300).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + '</datalist><datalist id="qtr-sups">' + sups.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
  }
  function keep() {
    var f = S.mount && S.mount.querySelector("#qtr-add"); if (!f || !S.adding) return;
    ["item_description", "supplier", "vat_rate", "cost_excl_vat", "discount_euro", "qty_purchased", "qty_free", "retail_price", "barcode"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding, cost = num(a.cost_excl_vat), disc = num(a.discount_euro), buy = num(a.qty_purchased), free = num(a.qty_free), retail = num(a.retail_price); S.err = "";
    if (!a.item_description) S.err = "Write the item. Nothing was saved.";
    else if (cost == null || isNaN(cost)) S.err = "Write the cost of one unit without VAT, e.g. 2.40. Nothing was saved.";
    else if (disc != null && (isNaN(disc) || disc > cost)) S.err = "The discount must be a number no bigger than the cost. Nothing was saved.";
    else if (buy == null || isNaN(buy) || buy < 1 || buy % 1) S.err = "Write how many you buy (a whole number). Nothing was saved.";
    else if (free != null && (isNaN(free) || free % 1)) S.err = "Free stock must be a whole number. Nothing was saved.";
    else if (retail != null && isNaN(retail)) S.err = "The retail price must be a number. Nothing was saved.";
    if (S.err) return paint(true);
    var vat = Number(a.vat_rate) || 0, body = { quote_date: today(), item_description: a.item_description, supplier: a.supplier || "", barcode: a.barcode || "", stock_code: "",
      vat_rate: vat, cost_excl_vat: cost, cost_incl_vat: Math.round(cost * (1 + vat / 100) * 100) / 100, discount_euro: disc || 0, discount_pct: cost > 0 && disc ? Math.round(disc / cost * 10000) / 100 : 0,
      qty_purchased: buy, qty_free: free || 0, retail_price: retail || 0, notes: "" };
    S.saving = true; paint(true);
    try {
      await E.postOnce("/quotations/entries", body, { list: function () { return fetchList(false); },
        same: function (e) { return e.quote_date === body.quote_date && low(e.item_description) === low(body.item_description) && low(e.supplier) === low(body.supplier) && Math.abs((Number(e.cost_excl_vat) || 0) - cost) < 0.005; } });
      S.q = body.item_description; S.adding = null; E.toast("Saved · quote for " + body.item_description + " · " + eur(calc(body).unit) + " a unit", "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "qtreg", title: "Price check", order: 3, icon: "€", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.err = ""; S.q = ""; css(); paint(); return E.takeOpenForm("qtreg", S.mount, load(), { btn: "[data-act=add]", form: "#qtr-add" }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("qtreg") < 0) E.UI2_DESTINATIONS.push("qtreg");
  if (E.UI2_PARENT) E.UI2_PARENT.qtreg = "stock";
})();
