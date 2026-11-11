/* Stock transfers between your group's pharmacies, new layout: what needs you first (requests to answer, stock to
   send, deliveries to confirm), then your offers, what others offer, and your requests. Same endpoints and the same
   workflow as the classic screen (offer → request → accept → dispatched → delivered). Tap one of your offers to send it
   to Returns, offer it to every pharmacy (Scarce stock) or remove it; withdraw a request still waiting for an answer.
   Each is the classic screen's own call (place-on-returns, place-on-scarce-stock, DELETE item, DELETE request), the
   removals after one plain question. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, items: [], loading: false, error: "", busy: false, err: "", offering: null, asking: null, open: null, ask: "", askErr: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var ST = { pending: "Waiting for an answer", accepted: "Accepted, to be sent", dispatched: "On its way", delivered: "Delivered", rejected: "Declined", cancelled: "Withdrawn" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function nice(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : ""; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function left(it) { return it.remaining_quantity != null ? Number(it.remaining_quantity) : Number(it.quantity_available || 0); }
  function itemLine(it) {
    var a = []; if (it.batch) a.push("Batch " + it.batch); if (it.expiry_date) a.push("Expires " + nice(it.expiry_date)); a.push(left(it) + " left");
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
      "@media (max-width:600px){.trf{padding:4px 16px 0}.trf h1{font-size:32px}.trf-row .t{flex-basis:100%}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".trf-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.trf-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".trf-quiet .trf-btn{margin-top:12px;display:block}" +
      "@media (max-width:600px){.trf-btn,.trf-btn.s{height:44px;border-radius:22px}}" +
      // round 2: what can be done with your own offer, and withdrawing a request, in place.
      ".trf-name{border:0;background:none;padding:0;margin:-10px 0 0;font:inherit;color:inherit;text-align:left;cursor:pointer;min-height:44px;display:flex;align-items:center}.trf-name:hover b,.trf-name:focus-visible b{text-decoration:underline}" +
      ".trf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      ".trf-more{flex-basis:100%;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:4px 0 0}.trf-more p{flex-basis:100%;margin:0;font-size:15px;font-weight:600}.trf-more small{flex-basis:100%;font-size:12.5px;color:var(--muted)}" +
      ".trf-more .sp{flex:1}.trf-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.trf-btn.dd{background:#B42318;border-color:#B42318;color:#fff}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .trf-btn.d,html[data-ui2]:not([data-ui2-visit]) .trf-btn.r{color:#FF7A72;border-color:#FF7A72}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/stock-transfers/items?open=1", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load transfers");
      S.items = (r.items || []).filter(function (it) { return !it.is_closed; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load transfers"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
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
    var h = '<div class="trf"><button class="trf-back" data-act="back">' + esc(E.ui2BackLabel("trfreg")) + '</button>' +
      '<div class="trf-top"><div><h1>Transfers</h1><p class="trf-sub">Stock moving between your pharmacies.</p></div>' + (S.offering ? "" : '<button class="trf-btn p" data-act="offer">Offer an item</button>') + "</div>";
    if (S.offering) {
      var o = S.offering;
      h += '<form class="trf-form sf-form sf-new" id="trf-offer" autocomplete="off"><label><span>Item</span><input name="item_description" value="' + esc(o.item_description || "") + '" placeholder="e.g. Augmentin 1g"></label>' +
        '<label><span>Quantity</span><input name="quantity_available" inputmode="numeric" value="' + esc(o.quantity_available || "") + '"></label>' +
        '<label><span>Batch</span><input name="batch" value="' + esc(o.batch || "") + '" placeholder="Optional"></label>' +
        '<label><span>Expires</span><input name="expiry_date" type="date" min="' + today() + '" value="' + esc(o.expiry_date || "") + '"></label>' +
        (S.err ? '<div class="trf-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="trf-btn" data-act="offer-cancel">Cancel</button><button type="submit" class="trf-btn p"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "Saving…" : "Offer to the group") + "</button></div></form>";
    }
    if (S.loading && !S.items.length) h += '<div class="trf-quiet">Opening transfers…</div>';
    else if (S.error) h += '<div class="trf-quiet" role="alert">' + esc(S.error) + '<button class="trf-btn" data-act="retry">Try again</button></div>';
    else {
      var tk = tasks(), mine = S.items.filter(function (it) { return it.mine_owner; }), others = S.items.filter(function (it) { return !it.mine_owner && !it._expired && left(it) > 0; });
      var myReqs = []; S.items.forEach(function (it) { (it.requests || []).forEach(function (rq) { if (rq.mine) myReqs.push({ it: it, rq: rq }); }); });
      if (tk.length) h += '<div class="trf-lab">Needs you <b>' + tk.length + '</b></div><div class="trf-list">' + tk.map(function (t) {
        return '<div class="trf-row need"><div class="t"><b>' + esc(t.it.item_description) + "</b><span>" + esc(t.text) + (t.rq.note ? " · " + esc(t.rq.note) : "") + "</span></div>" +
          t.acts.map(function (a) { return '<button class="trf-btn ' + a[2] + '" data-act="' + a[0] + '" data-rq="' + t.rq.id + '"' + (S.busy ? " disabled" : "") + ">" + a[1] + "</button>"; }).join("") + "</div>";
      }).join("") + "</div>";
      h += '<div class="trf-lab">Your offers <b>' + mine.length + '</b></div>' + (mine.length ? '<div class="trf-list">' + mine.map(function (it) {
        var pend = (it.requests || []).filter(function (r) { return r.status === "pending"; }).length;
        var placed = [it.placed_on_returns ? "On Returns" : "", it.placed_on_scarce_stock ? "Offered to every pharmacy" : ""].filter(Boolean).join(" · ");
        return '<div class="trf-row"><div class="t"><button type="button" class="trf-name" data-act="more" data-id="' + it.id + '" aria-expanded="' + (S.open === it.id) + '"><span class="trf-sr">More for </span><b>' + esc(it.item_description) + "</b></button><span>" + esc(itemLine(it) + (placed ? " · " + placed : "") + (it._expired ? " · Expired" : "")) + "</span></div>" + (pend ? '<span class="trf-pill wait">' + pend + " asking</span>" : '<span class="trf-pill">Offered</span>') + (S.open === it.id ? moreHtml(it) : "") + "</div>";
      }).join("") + "</div>" : '<div class="trf-quiet" style="margin-top:0">Nothing offered. Offer stock you can spare so another pharmacy in the group can use it.</div>');
      h += '<div class="trf-lab">From other pharmacies <b>' + others.length + '</b></div>' + (others.length ? '<div class="trf-list">' + others.map(function (it) {
        var asked = (it.requests || []).some(function (r) { return r.mine && (r.status === "pending" || r.status === "accepted" || r.status === "dispatched"); });
        var row = '<div class="trf-row"><div class="t"><b>' + esc(it.item_description) + "</b><span>" + esc((it.location_name || "") + " · " + itemLine(it)) + "</span></div>" +
          (asked ? '<span class="trf-pill go">Asked</span>' : S.asking === it.id ? "" : '<button class="trf-btn" data-act="ask" data-id="' + it.id + '">Ask for it</button>');
        if (S.asking === it.id) row += '<form class="trf-in sf-form" id="trf-ask" autocomplete="off"><label><span>How many</span><input name="quantity_requested" inputmode="numeric" value="' + esc((S.askDraft || {}).quantity_requested || "") + '" placeholder="Up to ' + left(it) + '"></label>' +
          '<label><span>Note</span><input name="note" value="' + esc((S.askDraft || {}).note || "") + '" placeholder="Optional"></label>' + (S.err ? '<div class="trf-err" role="alert">' + esc(S.err) + "</div>" : "") +
          '<div class="acts"><button type="button" class="trf-btn" data-act="ask-cancel">Cancel</button><button type="submit" class="trf-btn p"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "Sending…" : "Ask") + "</button></div></form>";
        return row + "</div>";
      }).join("") + "</div>" : '<div class="trf-quiet" style="margin-top:0">No other pharmacy in your group is offering stock right now.</div>');
      if (myReqs.length) h += '<div class="trf-lab">Your requests <b>' + myReqs.length + '</b></div><div class="trf-list">' + myReqs.map(function (x) {
        var wd = x.rq.status === "pending", asking = S.ask === "wd:" + x.rq.id;
        return '<div class="trf-row"><div class="t"><b>' + esc(x.it.item_description) + "</b><span>" + esc(x.rq.quantity_requested + " from " + (x.it.location_name || "another pharmacy")) + '</span></div><span class="trf-pill' + (x.rq.status === "dispatched" || x.rq.status === "accepted" ? " go" : x.rq.status === "pending" ? " wait" : "") + '">' + esc(ST[x.rq.status] || x.rq.status) + "</span>" +
          (wd && !asking ? '<button class="trf-btn r" data-act="wd" data-rq="' + x.rq.id + '"' + (S.busy ? " disabled" : "") + ' aria-label="' + esc("Withdraw your request for " + x.it.item_description) + '">Withdraw…</button>' : "") +
          (asking ? '<div class="trf-more"><p id="trf-ask-' + x.rq.id + '">Withdraw your request for ' + esc(x.rq.quantity_requested + " " + x.it.item_description) + "?</p>" + (S.askErr ? '<div class="trf-err" role="alert" style="padding:0;flex-basis:100%">' + esc(S.askErr) + "</div>" : "") +
            '<span class="sp"></span><button class="trf-btn" data-act="ask-cancel" data-rq="' + x.rq.id + '">Keep it</button><button class="trf-btn dd" data-act="wd-go" data-rq="' + x.rq.id + '" aria-describedby="trf-ask-' + x.rq.id + '"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "Withdrawing…" : "Withdraw request") + "</button></div>" : "") + "</div>";
      }).join("") + "</div>";
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Tap one of your offers to send it to Returns, offer it to every pharmacy or remove it. Finished transfers are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    bind(m);
  }

  // Your offer, opened: the classic detail panel's buttons for the owner (Place on Returns, Place on Scarce Stock when
  // not expired, Remove from Transfer), each shown only when the classic shows it. Remove asks first.
  function moreHtml(it) {
    if (S.ask === "remove") return '<div class="trf-more"><p id="trf-ask-it">Remove ' + esc(it.item_description) + " from transfers? Requests still waiting are cancelled. If it was sent to Returns or Scarce stock from here, it comes off there too.</p>" +
      (S.askErr ? '<div class="trf-err" role="alert" style="padding:0;flex-basis:100%">' + esc(S.askErr) + "</div>" : "") +
      '<span class="sp"></span><button class="trf-btn" data-act="ask-cancel">Keep it</button><button class="trf-btn dd" data-act="remove-go" data-id="' + it.id + '" aria-describedby="trf-ask-it"' + (S.busy ? " disabled" : "") + ">" + (S.busy ? "Removing…" : "Remove offer") + "</button></div>";
    var b = [];
    if (!it.placed_on_returns) b.push('<button class="trf-btn" data-act="to-returns" data-id="' + it.id + '"' + (S.busy ? " disabled" : "") + ">Send to Returns</button>");
    if (!it.placed_on_scarce_stock && !it._expired) b.push('<button class="trf-btn" data-act="to-scarce" data-id="' + it.id + '"' + (S.busy ? " disabled" : "") + ">Offer to every pharmacy</button>");
    return '<div class="trf-more">' + b.join("") + '<span class="sp"></span><button class="trf-btn d" data-act="remove" data-id="' + it.id + '"' + (S.busy ? " disabled" : "") + ">Remove…</button>" +
      (S.askErr ? '<div class="trf-err" role="alert" style="padding:0;flex-basis:100%">' + esc(S.askErr) + "</div>" : "") +
      (!it.placed_on_scarce_stock && !it._expired ? "<small>Offer to every pharmacy lists it in Scarce stock, for pharmacies outside your group too.</small>" : "") + "</div>";
  }
  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), rq = b.getAttribute("data-rq");
        if (a === "back") window.location.hash = E.ui2BackHash("trfreg");
        else if (a === "retry") load();
        else if (a === "offer") { S.offering = {}; S.err = ""; paint(); focusSoon("#trf-offer [name=item_description]"); }
        else if (a === "offer-cancel") { S.offering = null; S.err = ""; paint(); focusSoon('[data-act="offer"]'); }
        else if (a === "ask") { S.asking = Number(b.getAttribute("data-id")); S.askDraft = null; S.err = ""; paint(); focusSoon("#trf-ask [name=quantity_requested]"); }
        else if (a === "ask-cancel") { var was = S.asking; S.asking = null; S.err = ""; paint(); focusSoon('[data-act="ask"][data-id="' + was + '"]'); }
        else if (a === "accept" || a === "reject" || a === "dispatch" || a === "deliver") step(rq, a);
        else if (a === "more") { var id = Number(b.getAttribute("data-id")); S.open = S.open === id ? null : id; S.ask = ""; S.askErr = ""; paint(); focusSoon('[data-act="more"][data-id="' + id + '"]'); }
        else if (a === "remove") { S.ask = "remove"; S.askErr = ""; paint(); focusSoon('[data-act="ask-cancel"]'); }
        else if (a === "wd") { S.ask = "wd:" + rq; S.askErr = ""; paint(); focusSoon('[data-act="ask-cancel"][data-rq="' + rq + '"]'); }
        else if (a === "ask-cancel") { var was = S.ask; S.ask = ""; S.askErr = ""; paint(); focusSoon(was === "remove" ? '[data-act="remove"]' : '[data-act="wd"][data-rq="' + rq + '"]'); }
        else if (a === "remove-go") removeItem(Number(b.getAttribute("data-id")));
        else if (a === "wd-go") withdraw(rq);
        else if (a === "to-returns" || a === "to-scarce") place(Number(b.getAttribute("data-id")), a);
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "trfreg"); } catch (e) {} E.openClassic("stocktransfers"); }
      });
    });
    var fo = m.querySelector("#trf-offer"); if (fo) fo.addEventListener("submit", function (ev) { ev.preventDefault(); offer(fo); });
    var fa = m.querySelector("#trf-ask"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); ask(fa); });
    // Escape closes the open form (what is typed in it is dropped, as with Cancel) and puts you back where you were.
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
    m.querySelectorAll(".trf-more").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; ev.preventDefault(); var c = f.querySelector('[data-act="ask-cancel"]'); if (c) return c.click(); var id = S.open; S.open = null; paint(); focusSoon('[data-act="more"][data-id="' + id + '"]'); }); });
  }
  function focusSoon(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }, 30); } // never away from a field the person went to meanwhile
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
  // A one-way call that answers ok or not; a lost answer is checked by reading the list again (`done` says whether it happened).
  async function call(path, method, done) {
    try { var r = await E.apiFetch(path, { method: method }); if (!r || !r.ok) throw new Error((r && r.error) || "Failed"); return r; }
    catch (x) {
      if (x && x.network) { try { var l = await E.apiFetch("/stock-transfers/items?open=1", { method: "GET" }); if (l && l.ok && done(l.items || [])) return { ok: true }; } catch (y) {} }
      throw x;
    }
  }
  // Remove from Transfer: the classic DELETE /stock-transfers/items/:id (no body).
  async function removeItem(id) {
    var it = S.items.find(function (x) { return x.id === id; }); if (!it || S.busy) return;
    S.busy = true; S.askErr = ""; paint();
    try { await call("/stock-transfers/items/" + encodeURIComponent(id), "DELETE", function (items) { return !items.some(function (x) { return x.id === id && !x.is_closed; }); }); }
    catch (x) { S.busy = false; S.askErr = E.saveFailText(x).replace(/^Not saved/, "Not removed"); paint(); return focusSoon('[data-act="remove-go"]'); }
    S.busy = false; S.open = null; S.ask = ""; E.toast("Removed · " + it.item_description, "success");
    await load(); focusSoon('[data-act="offer"]');
  }
  // Cancel a pending request: the classic DELETE /stock-transfers/requests/:id (no body).
  async function withdraw(rq) {
    if (S.busy) return;
    S.busy = true; S.askErr = ""; paint();
    var gone = function (items) { return !items.some(function (it) { return (it.requests || []).some(function (r) { return String(r.id) === String(rq) && r.status === "pending"; }); }); };
    try { await call("/stock-transfers/requests/" + encodeURIComponent(rq), "DELETE", gone); }
    catch (x) { S.busy = false; S.askErr = E.saveFailText(x).replace(/^Not saved/, "Not withdrawn"); paint(); return focusSoon('[data-act="wd-go"][data-rq="' + rq + '"]'); }
    S.busy = false; S.ask = ""; E.toast("Request withdrawn", "success");
    await load(); focusSoon('[data-act="offer"]');
  }
  // Place on Returns / Place on Scarce Stock: the classic POST, no body.
  async function place(id, what) {
    var it = S.items.find(function (x) { return x.id === id; }); if (!it || S.busy) return;
    var key = what === "to-returns" ? "placed_on_returns" : "placed_on_scarce_stock";
    S.busy = true; S.askErr = ""; paint();
    try {
      var r;
      try { r = await E.apiFetch("/stock-transfers/items/" + encodeURIComponent(id) + (what === "to-returns" ? "/place-on-returns" : "/place-on-scarce-stock"), { method: "POST" }); if (!r || !r.ok) throw new Error((r && r.error) || "Failed"); }
      catch (x) { var ok = false; if (x && x.network) { try { var l = await E.apiFetch("/stock-transfers/items?open=1", { method: "GET" }); ok = !!(l && l.ok) && (l.items || []).some(function (y) { return y.id === id && y[key]; }); } catch (y) {} } if (!ok) throw x; } // never twice: it would make a second return
    } catch (x) { S.busy = false; S.askErr = E.saveFailText(x); paint(); return focusSoon('[data-act="' + what + '"][data-id="' + id + '"]'); }
    S.busy = false; E.toast(what === "to-returns" ? "Sent to Returns · " + it.item_description : "Offered to every pharmacy · " + it.item_description, "success");
    await load(); focusSoon('[data-act="more"][data-id="' + id + '"]');
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
    render: function (ctx) { S.mount = ctx && ctx.mount; S.offering = null; S.asking = null; S.err = ""; S.open = null; S.ask = ""; S.askErr = ""; S.busy = false; css(); paint(); return E.takeOpenForm("trfreg", S.mount, load(), { btn: "[data-act=offer]", form: "#trf-offer" } /* q5-2: a half-typed form comes back */, null); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("trfreg") < 0) E.UI2_DESTINATIONS.push("trfreg");
  if (E.UI2_PARENT) E.UI2_PARENT.trfreg = "stock";
})();
