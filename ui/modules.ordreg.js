/* Customer orders, new layout: what is waiting, by when it is needed (late first), with the customer's number to call
   and one tap when it is ready; a new order in a few fields. Same endpoints as the classic screen; the order update keeps
   fields it is not sent (UPDATE-AUDIT.md: PARTIAL), so "Ready" sends only that. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, saving: false, err: "", q: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function shiftMonth(k) { var d = new Date(); d = new Date(d.getFullYear(), d.getMonth() + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function daysUntil(s) { var p = String(s).split("-"); var t = new Date(); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function when(s) { if (!s) return ""; var n = daysUntil(s); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; var p = s.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1]; }

  function css() {
    if (document.getElementById("eikon-ordreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-ordreg-css";
    st.textContent =
      ".ord{max-width:880px;margin:0 auto}" +
      ".ord-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".ord-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".ord h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.ord-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".ord-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".ord-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.ord-btn:disabled{opacity:.55;cursor:default}" +
      ".ord-q{width:100%;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 12px;outline:0;margin-top:16px}" +
      ".ord-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.ord-lab b{color:var(--text)}" +
      ".ord-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".ord-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:.5px solid var(--border);border-left:3px solid transparent}.ord-row:first-child{border-top:0}" +
      ".ord-row.late{border-left-color:var(--danger)}.ord-row.soon{border-left-color:#C98A12}.ord-row.hi .t b::after{content:' · urgent';color:var(--danger);font-weight:600;font-size:13px}" +
      ".ord-row .t{flex:1;min-width:0}.ord-row b{display:block;font-size:15px;font-weight:600}.ord-row span{display:block;font-size:12.5px;color:var(--muted)}.ord-row .it{color:var(--text);font-size:14px;margin-top:2px}" +
      ".ord-row a{color:var(--accent);text-decoration:none}" +
      ".ord-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".ord-pill.late{background:rgba(215,38,28,.12);color:var(--danger)}.ord-pill.soon{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.ord-pill.done{background:rgba(10,143,106,.12);color:var(--accent)}" +
      ".ord-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".ord-form label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 16px;border-top:.5px solid var(--border)}.ord-form label:first-child{border-top:0}" +
      ".ord-form label>span{flex:0 0 96px;font-size:15px}.ord-form input,.ord-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".ord-form .acts{display:flex;gap:8px;padding:10px 16px;justify-content:flex-end}" +
      ".ord-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
      ".ord-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.ord{padding:4px 16px 0}.ord h1{font-size:32px}.ord-row{flex-wrap:wrap;row-gap:8px}.ord-row .t{flex-basis:100%}.ord-row .ord-btn{margin-left:auto}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var rows = null;
      // One call for the last six months where the server supports a range; otherwise month by month (three months).
      try {
        var r = await E.apiFetch("/client-orders/entries?from=" + shiftMonth(-5) + "-01&to=" + shiftMonth(1) + "-01", { method: "GET" });
        if (r && r.ok) rows = r.entries || [];
      } catch (e0) { rows = null; }
      if (!rows) {
        var res = await Promise.all([0, -1, -2].map(function (k) { return E.apiFetch("/client-orders/entries?month=" + shiftMonth(k), { method: "GET" }); }));
        rows = [].concat.apply([], res.map(function (x) { return (x && x.entries) || []; }));
      }
      var seen = {}; S.entries = rows.filter(function (e) { return seen[e.id] ? false : (seen[e.id] = 1); });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load orders"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function rowHtml(e, done) {
    var need = e.needed_by || e.pick_up_date || e.pickup_date || "", n = need ? daysUntil(need) : 99;
    var cls = done ? "" : n < 0 ? "late" : n <= 1 ? "soon" : "";
    var phone = e.client_phone || e.contact || "";
    var sub = []; if (phone) sub.push('<a href="tel:' + esc(String(phone).replace(/\s+/g, "")) + '">' + esc(phone) + "</a>");
    if (Number(e.deposit_amount || e.deposit) > 0) sub.push("Deposit €" + esc(e.deposit_amount || e.deposit)); if (e.notes) sub.push(esc(e.notes));
    var pill = done ? "Ready " + when(String(e.fulfilled_at || "").slice(0, 10)) : need ? (n < 0 ? "Late · needed " + when(need) : "Needed " + when(need)) : "No date";
    return '<div class="ord-row ' + cls + (Number(e.priority) === 1 && !done ? " hi" : "") + '"><div class="t"><b>' + esc(e.client_name) + '</b><div class="it">' + esc(e.items_text || e.items || "") + "</div><span>" + sub.join(" · ") + "</span></div>" +
      '<span class="ord-pill ' + (done ? "done" : cls) + '">' + esc(pill) + "</span>" +
      (done ? "" : '<button class="ord-btn p" data-act="ready" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Ready") + "</button>") + "</div>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "ordreg") return; // left before a reply came back: do not draw over the next screen
    var h = '<div class="ord"><button class="ord-back" data-act="back">‹ Customers</button>' +
      '<div class="ord-top"><div><h1>Orders</h1><p class="ord-sub">What customers are waiting for, by when they need it.</p></div>' + (S.adding ? "" : '<button class="ord-btn p" data-act="add">New order</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="ord-form" id="ord-add" autocomplete="off">' +
        '<label><span>Customer</span><input name="client_name" value="' + esc(a.client_name || "") + '" placeholder="Name and surname"></label>' +
        '<label><span>Phone</span><input name="contact" type="tel" value="' + esc(a.contact || "") + '" placeholder="Optional"></label>' +
        '<label><span>Items</span><input name="items" value="' + esc(a.items || "") + '" placeholder="e.g. Augmentin 625 x14"></label>' +
        '<label><span>Needed by</span><input name="needed_by" type="date" min="' + esc(today()) + '" value="' + esc(a.needed_by || "") + '"></label>' +
        '<label><span>Pick up</span><input name="pick_up_date" type="date" min="' + esc(today()) + '" value="' + esc(a.pick_up_date || "") + '"><em style="font-style:normal;color:var(--muted);font-size:13px">Empty: same day</em></label>' +
        '<label><span>Deposit €</span><input name="deposit" inputmode="decimal" value="' + esc(a.deposit || "") + '" placeholder="Optional"></label>' +
        '<label><span>Priority</span><select name="priority"><option value="2">Normal</option><option value="1"' + (String(a.priority) === "1" ? " selected" : "") + '>Urgent</option><option value="3"' + (String(a.priority) === "3" ? " selected" : "") + ">Low</option></select></label>" +
        '<label><span>Notes</span><input name="notes" value="' + esc(a.notes || "") + '" placeholder="Optional"></label>' +
        (S.err ? '<div class="ord-err">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="ord-btn" data-act="add-cancel">Cancel</button><button type="submit" class="ord-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Add order") + "</button></div></form>";
    }
    var q = S.q.trim().toLowerCase(), match = function (e) { return !q || [e.client_name, e.items_text, e.items, e.client_phone, e.contact, e.notes].some(function (v) { return String(v || "").toLowerCase().indexOf(q) >= 0; }); };
    var open = S.entries.filter(function (e) { return !Number(e.fulfilled) && match(e); }).sort(function (a, b) { return String(a.needed_by || "9") < String(b.needed_by || "9") ? -1 : String(a.needed_by || "9") > String(b.needed_by || "9") ? 1 : Number(a.priority) - Number(b.priority); });
    var week = ymd(new Date(Date.now() - 7 * 86400000));
    var done = S.entries.filter(function (e) { return Number(e.fulfilled) && String(e.fulfilled_at || "").slice(0, 10) >= week && match(e); }).sort(function (a, b) { return String(a.fulfilled_at) < String(b.fulfilled_at) ? 1 : -1; });
    if (S.entries.length > 8) h += '<input class="ord-q" id="ord-q" type="search" placeholder="Search customer, phone or item" value="' + esc(S.q) + '">';
    if (S.loading && !S.entries.length) h += '<div class="ord-quiet">Opening orders…</div>';
    else if (S.error) h += '<div class="ord-quiet">' + esc(S.error) + "</div>";
    else {
      h += open.length ? '<div class="ord-lab">Waiting <b>' + open.length + '</b></div><div class="ord-list">' + open.map(function (e) { return rowHtml(e, false); }).join("") + "</div>" : '<div class="ord-quiet">' + (q ? "Nothing waiting matches “" + esc(S.q) + "”." : "No customer is waiting for an order.") + "</div>";
      if (done.length) h += '<div class="ord-lab">Ready in the last week <b>' + done.length + '</b></div><div class="ord-list">' + done.map(function (e) { return rowHtml(e, true); }).join("") + "</div>";
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changing an order, follow-ups, deleting and older orders are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#customers";
        else if (a === "add") { S.adding = {}; S.err = ""; paint(); setTimeout(function () { var f = m.querySelector("[name=client_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "add-cancel") { S.adding = null; S.err = ""; paint(); }
        else if (a === "ready") ready(Number(b.getAttribute("data-id")));
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "ordreg"); } catch (e) {} E.openClassic("clientorders"); }
      });
    });
    var qi = m.querySelector("#ord-q"); if (qi) qi.addEventListener("input", function () { var pos = qi.selectionStart; S.q = qi.value; paint(); var q2 = S.mount.querySelector("#ord-q"); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} } });
    var f = m.querySelector("#ord-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); add(f); });
  }

  async function ready(id) {
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e || S.busy[id]) return;
    S.busy[id] = true; paint();
    try {
      var r = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify({ fulfilled: true }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast(e.client_name + "'s order is ready", "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy[id] = false; return load();
  }

  async function add(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { order_date: today(), client_name: v("client_name"), contact: v("contact"), items: v("items"), needed_by: v("needed_by"), pick_up_date: v("pick_up_date") || v("needed_by"), deposit: v("deposit"), priority: Number(v("priority") || 2), notes: v("notes") };
    // The server reads client_phone, pickup_date and deposit_amount; the names above alone were dropped (phone, pick-up date and deposit came back empty).
    body.client_phone = body.contact; body.pickup_date = body.pick_up_date; body.deposit_amount = body.deposit;
    S.adding = Object.assign({}, body, { pick_up_date: v("pick_up_date") }); S.err = "";
    if (!body.client_name) S.err = "Write the customer's name. Nothing was saved.";
    else if (!body.items) S.err = "Write what they ordered. Nothing was saved.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(body.needed_by)) S.err = "Choose when it is needed. Nothing was saved.";
    else if (body.deposit && !(Number(body.deposit) >= 0)) S.err = "The deposit should be a number. Nothing was saved.";
    if (S.err) return paint();
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/client-orders/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Order added for " + body.client_name, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "ordreg", title: "Orders", order: 3, icon: "◎", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("ordreg") < 0) E.UI2_DESTINATIONS.push("ordreg");
  if (E.UI2_PARENT) E.UI2_PARENT.ordreg = "customers";
})();
