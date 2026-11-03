/* Stock transfers between your group's pharmacies, new layout: what needs you first (requests to answer, stock to
   send, deliveries to confirm), then your offers, what others offer, and your requests. Same endpoints and the same
   workflow as the classic screen (offer → request → accept → dispatched → delivered). Removing items, returns and
   scarce-stock hand-offs stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, items: [], loading: false, error: "", busy: false, err: "", offering: null, asking: null };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var ST = { pending: "Waiting for an answer", accepted: "Accepted, to be sent", dispatched: "On its way", delivered: "Delivered", rejected: "Declined", cancelled: "Withdrawn" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function nice(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : ""; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function left(it) { return it.remaining_quantity != null ? Number(it.remaining_quantity) : Number(it.quantity_available || 0); }
  function itemLine(it) {
    var a = []; if (it.batch) a.push("Batch " + it.batch); if (it.expiry_date) a.push("Exp " + nice(it.expiry_date)); a.push(left(it) + " left");
    return a.join(" · ");
  }

  function css() {
    if (document.getElementById("eikon-trfreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-trfreg-css";
    st.textContent =
      ".trf{max-width:880px;margin:0 auto}" +
      ".trf-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".trf-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".trf h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.trf-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".trf-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".trf-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.trf-btn.r{color:var(--danger)}.trf-btn:disabled{opacity:.55;cursor:default}" +
      ".trf-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.trf-lab b{color:var(--text)}" +
      ".trf-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".trf-row{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:.5px solid var(--border);flex-wrap:wrap}.trf-row:first-child{border-top:0}" +
      ".trf-row.need{border-left:3px solid #C98A12}" +
      ".trf-row .t{flex:1;min-width:200px}.trf-row b{display:block;font-size:15px;font-weight:600}.trf-row span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".trf-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".trf-pill.go{background:rgba(10,143,106,.12);color:var(--accent)}.trf-pill.wait{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}" +
      ".trf-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}.trf-in{flex-basis:100%;border-radius:10px;background:rgba(118,118,128,.07);padding:4px 0}" +
      ".trf-form label,.trf-in label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.trf-form label:first-child,.trf-in label:first-child{border-top:0}" +
      ".trf-form label>span,.trf-in label>span{flex:0 0 90px;font-size:15px}.trf-form input,.trf-in input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".trf-form .acts,.trf-in .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}" +
      ".trf-err{color:var(--danger);font-size:13px;padding:2px 14px 4px}" +
      ".trf-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.trf{padding:4px 16px 0}.trf h1{font-size:32px}.trf-row .t{flex-basis:100%}}";
    document.head.appendChild(st);
  }

  async function load() {
    S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/stock-transfers/items?open=1", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load transfers");
      S.items = (r.items || []).filter(function (it) { return !it.is_closed; });
    } catch (e) { S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load transfers"); }
    S.loading = false; paint();
  }

  // Everything that waits for this pharmacy, with the one action that moves it on.
  function tasks() {
    var out = [];
    S.items.forEach(function (it) {
      (it.requests || []).forEach(function (rq) {
        if (it.mine_owner && rq.status === "pending") out.push({ it: it, rq: rq, text: rq.requester_display + " asks for " + rq.quantity_requested, acts: [["accept", "Accept", "p"], ["reject", "Decline", "r"]] });
        else if (it.mine_owner && rq.status === "accepted") out.push({ it: it, rq: rq, text: "Send " + rq.quantity_requested + " to " + rq.requester_display, acts: [["dispatch", "Mark sent", "p"]] });
        else if (rq.mine && rq.status === "dispatched") out.push({ it: it, rq: rq, text: rq.quantity_requested + " on its way from " + (it.location_name || "another pharmacy"), acts: [["deliver", "Mark received", "p"]] });
      });
    });
    return out;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "trfreg") return; // left before a reply came back: do not draw over the next screen
    var h = '<div class="trf"><button class="trf-back" data-act="back">‹ Stock</button>' +
      '<div class="trf-top"><div><h1>Transfers</h1><p class="trf-sub">Stock moving between your pharmacies.</p></div>' + (S.offering ? "" : '<button class="trf-btn p" data-act="offer">Offer an item</button>') + "</div>";
    if (S.offering) {
      var o = S.offering;
      h += '<form class="trf-form" id="trf-offer" autocomplete="off"><label><span>Item</span><input name="item_description" value="' + esc(o.item_description || "") + '" placeholder="e.g. Augmentin 1g"></label>' +
        '<label><span>Quantity</span><input name="quantity_available" inputmode="numeric" value="' + esc(o.quantity_available || "") + '"></label>' +
        '<label><span>Batch</span><input name="batch" value="' + esc(o.batch || "") + '" placeholder="Optional"></label>' +
        '<label><span>Expires</span><input name="expiry_date" type="date" value="' + esc(o.expiry_date || "") + '"></label>' +
        (S.err ? '<div class="trf-err">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="trf-btn" data-act="offer-cancel">Cancel</button><button type="submit" class="trf-btn p"' + (S.busy ? " disabled" : "") + '>Offer to the group</button></div></form>';
    }
    if (S.loading && !S.items.length) h += '<div class="trf-quiet">Opening transfers…</div>';
    else if (S.error) h += '<div class="trf-quiet">' + esc(S.error) + "</div>";
    else {
      var tk = tasks(), mine = S.items.filter(function (it) { return it.mine_owner; }), others = S.items.filter(function (it) { return !it.mine_owner && !it._expired && left(it) > 0; });
      var myReqs = []; S.items.forEach(function (it) { (it.requests || []).forEach(function (rq) { if (rq.mine) myReqs.push({ it: it, rq: rq }); }); });
      if (tk.length) h += '<div class="trf-lab">Needs you <b>' + tk.length + '</b></div><div class="trf-list">' + tk.map(function (t) {
        return '<div class="trf-row need"><div class="t"><b>' + esc(t.it.item_description) + "</b><span>" + esc(t.text) + (t.rq.note ? " · " + esc(t.rq.note) : "") + "</span></div>" +
          t.acts.map(function (a) { return '<button class="trf-btn ' + a[2] + '" data-act="' + a[0] + '" data-rq="' + t.rq.id + '"' + (S.busy ? " disabled" : "") + ">" + a[1] + "</button>"; }).join("") + "</div>";
      }).join("") + "</div>";
      h += '<div class="trf-lab">Your offers <b>' + mine.length + '</b></div>' + (mine.length ? '<div class="trf-list">' + mine.map(function (it) {
        var pend = (it.requests || []).filter(function (r) { return r.status === "pending"; }).length;
        return '<div class="trf-row"><div class="t"><b>' + esc(it.item_description) + "</b><span>" + esc(itemLine(it)) + "</span></div>" + (pend ? '<span class="trf-pill wait">' + pend + " asking</span>" : '<span class="trf-pill">Offered</span>') + "</div>";
      }).join("") + "</div>" : '<div class="trf-quiet" style="margin-top:0">Nothing offered. Offer stock you can spare so another pharmacy in the group can use it.</div>');
      h += '<div class="trf-lab">From other pharmacies <b>' + others.length + '</b></div>' + (others.length ? '<div class="trf-list">' + others.map(function (it) {
        var asked = (it.requests || []).some(function (r) { return r.mine && (r.status === "pending" || r.status === "accepted" || r.status === "dispatched"); });
        var row = '<div class="trf-row"><div class="t"><b>' + esc(it.item_description) + "</b><span>" + esc((it.location_name || "") + " · " + itemLine(it)) + "</span></div>" +
          (asked ? '<span class="trf-pill go">Asked</span>' : S.asking === it.id ? "" : '<button class="trf-btn" data-act="ask" data-id="' + it.id + '">Ask for it</button>');
        if (S.asking === it.id) row += '<form class="trf-in" id="trf-ask" autocomplete="off"><label><span>How many</span><input name="quantity_requested" inputmode="numeric" value="' + esc((S.askDraft || {}).quantity_requested || "") + '" placeholder="Up to ' + left(it) + '"></label>' +
          '<label><span>Note</span><input name="note" value="' + esc((S.askDraft || {}).note || "") + '" placeholder="Optional"></label>' + (S.err ? '<div class="trf-err">' + esc(S.err) + "</div>" : "") +
          '<div class="acts"><button type="button" class="trf-btn" data-act="ask-cancel">Cancel</button><button type="submit" class="trf-btn p"' + (S.busy ? " disabled" : "") + ">Ask</button></div></form>";
        return row + "</div>";
      }).join("") + "</div>" : '<div class="trf-quiet" style="margin-top:0">No other pharmacy in your group is offering stock right now.</div>');
      if (myReqs.length) h += '<div class="trf-lab">Your requests <b>' + myReqs.length + '</b></div><div class="trf-list">' + myReqs.map(function (x) {
        return '<div class="trf-row"><div class="t"><b>' + esc(x.it.item_description) + "</b><span>" + esc(x.rq.quantity_requested + " from " + (x.it.location_name || "another pharmacy")) + '</span></div><span class="trf-pill' + (x.rq.status === "dispatched" || x.rq.status === "accepted" ? " go" : x.rq.status === "pending" ? " wait" : "") + '">' + esc(ST[x.rq.status] || x.rq.status) + "</span></div>";
      }).join("") + "</div>";
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Removing an offer, sending it to Returns or to Scarce stock, and older transfers are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    bind(m);
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), rq = b.getAttribute("data-rq");
        if (a === "back") window.location.hash = "#stock";
        else if (a === "offer") { S.offering = {}; S.err = ""; paint(); }
        else if (a === "offer-cancel") { S.offering = null; S.err = ""; paint(); }
        else if (a === "ask") { S.asking = Number(b.getAttribute("data-id")); S.askDraft = null; S.err = ""; paint(); }
        else if (a === "ask-cancel") { S.asking = null; S.err = ""; paint(); }
        else if (a === "accept" || a === "reject" || a === "dispatch" || a === "deliver") step(rq, a);
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "trfreg"); } catch (e) {} E.openClassic("stocktransfers"); }
      });
    });
    var fo = m.querySelector("#trf-offer"); if (fo) fo.addEventListener("submit", function (ev) { ev.preventDefault(); offer(fo); });
    var fa = m.querySelector("#trf-ask"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); ask(fa); });
  }
  var val = function (f, n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };

  async function run(fn, okText) {
    S.busy = true; S.err = ""; paint();
    try { await fn(); if (okText) E.toast(okText, "success"); S.busy = false; return true; }
    catch (e) { S.err = E.saveFailText(e); E.toast(S.err, "error"); S.busy = false; paint(); return false; }
  }
  async function step(rq, a) {
    var path = { accept: "/accept", reject: "/reject", dispatch: "/confirm-dispatch", deliver: "/confirm-delivery" }[a];
    if (a === "reject" && !window.confirm("Decline this request?")) return;
    var done = await run(async function () { var r = await E.apiFetch("/stock-transfers/requests/" + encodeURIComponent(rq) + path, { method: "POST", body: "{}" }); if (!r || !r.ok) throw new Error((r && r.error) || "Failed"); },
      { accept: "Accepted", reject: "Declined", dispatch: "Marked as sent", deliver: "Marked as received" }[a]);
    if (done) load();
  }
  async function offer(f) {
    var body = { entry_date: today(), item_description: val(f, "item_description"), quantity_available: Math.round(Number(val(f, "quantity_available"))), batch: val(f, "batch"), expiry_date: val(f, "expiry_date") };
    S.offering = body; S.err = "";
    if (!body.item_description) S.err = "Write the item. Nothing was saved.";
    else if (!(body.quantity_available >= 1)) S.err = "Write how many. Nothing was saved.";
    else if (body.expiry_date && body.expiry_date < today()) S.err = "Expired stock can't be offered. Nothing was saved.";
    if (S.err) return paint();
    var done = await run(async function () { var r = await E.apiFetch("/stock-transfers/items", { method: "POST", body: JSON.stringify(body) }); if (!r || !r.ok) throw new Error((r && r.error) || "Failed"); }, "Offered to the group");
    if (done) { S.offering = null; load(); }
  }
  async function ask(f) {
    var it = S.items.find(function (x) { return x.id === S.asking; }); if (!it) return;
    var qty = Math.round(Number(val(f, "quantity_requested")));
    S.askDraft = { quantity_requested: val(f, "quantity_requested"), note: val(f, "note") }; S.err = "";
    if (!(qty >= 1)) S.err = "Write how many. Nothing was sent.";
    else if (qty > left(it)) S.err = "Only " + left(it) + " left. Nothing was sent.";
    if (S.err) return paint();
    var done = await run(async function () { var r = await E.apiFetch("/stock-transfers/items/" + encodeURIComponent(it.id) + "/requests", { method: "POST", body: JSON.stringify({ quantity_requested: qty, note: S.askDraft.note }) }); if (!r || !r.ok) throw new Error((r && r.error) || "Failed"); }, "Asked " + (it.location_name || "the pharmacy"));
    if (done) { S.asking = null; load(); }
  }

  E.registerModule({
    id: "trfreg", title: "Transfers", order: 3, icon: "⇄", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.offering = null; S.asking = null; S.err = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("trfreg") < 0) E.UI2_DESTINATIONS.push("trfreg");
  if (E.UI2_PARENT) E.UI2_PARENT.trfreg = "stock";
})();
