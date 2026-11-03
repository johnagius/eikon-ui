/* Customer orders, new layout: what is waiting, by when it is needed (late first), with the customer's number to call
   and one tap when it is ready; a new order in a few fields. Same endpoints as the classic screen; the order update keeps
   fields it is not sent (UPDATE-AUDIT.md: PARTIAL), so "Ready" and "Not ready" send only that.
   Open an order to change it: the order is read again from the server and sent whole, with only what was changed
   different, under the classic screen's names (both the screen's and the server's: client_phone, items_text,
   pickup_date, deposit_amount). "Done" lists the orders already ready, six months at a time. Delete is for the
   pharmacist only: the reason is written on the order first, so the audit's copy of the deleted order carries it. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, saving: false, err: "", q: "",
    view: "open", done: [], doneBack: 0, doneLoading: false, doneError: "", editing: null, edit: null, editErr: "", editSaving: false, del: null };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // the classic screen's follow-up list (modules.clientorders.js FOLLOW_UP_OPTIONS): same values are stored
  var FOLLOW = [["", "None"], ["called", "Called"], ["not_wanted", "Not wanted"], ["not_available", "Not available"], ["called_no_answer", "Called, no answer"], ["wrong_number", "Wrong number"]];
  var EDIT = ["order_date", "client_name", "contact", "alternate", "email", "address", "items", "needed_by", "pick_up_date", "deposit", "priority", "follow_up_status", "notes"];
  var PAGE_MONTHS = 6;

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function shiftMonth(k) { var d = new Date(); d = new Date(d.getFullYear(), d.getMonth() + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function daysUntil(s) { var p = String(s).split("-"); var t = new Date(); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function when(s) { if (!s) return ""; var n = daysUntil(s); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; var p = s.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1]; }
  function monthOf(ymdS, k) { var p = String(ymdS).split("-"); var d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function dmy(s) { return isYmd(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : String(s || ""); }
  function money2(s) { var v = String(s == null ? "" : s).trim(); if (!v) return ""; v = v.replace(/,/g, ""); var n = Number(v); if (!isFinite(n) || n < 0) return null; return (Math.round(n * 100) / 100).toFixed(2); } // classic parseMoney2
  function isAdmin() { var u = E.state && E.state.user; return !!(u && u.role === "admin"); } // the server lets staff delete too: this screen keeps it to the pharmacist
  function findOrder(id) { return S.entries.concat(S.done).find(function (x) { return x.id === id; }) || null; }
  // The order as the classic screen holds it (mapApiRowToUi + openOrderModal's initial values), from a server row.
  function uiOf(r) {
    var dep = r.deposit != null ? r.deposit : r.deposit_amount;
    return { order_date: String(r.order_date || r.entry_date || "").trim(), client_name: String(r.client_name || "").trim(), address: String(r.address != null ? r.address : r.client_address || "").trim(),
      contact: String(r.contact != null ? r.contact : r.client_phone || "").trim(), alternate: String(r.alternate != null ? r.alternate : r.client_alt_phone || "").trim(), email: String(r.email != null ? r.email : r.client_email || "").trim(),
      items: String(r.items != null ? r.items : r.items_text || "").trim(), priority: [1, 2, 3].indexOf(Number(r.priority)) >= 0 ? Number(r.priority) : 2,
      needed_by: String(r.needed_by || "").trim(), pick_up_date: String(r.pick_up_date || r.pickup_date || "").trim(), deposit: dep == null ? "" : String(dep).trim(), notes: String(r.notes || "").trim(),
      fulfilled: !!Number(r.fulfilled), fulfilled_at: String(r.fulfilled_at || "").trim(), follow_up_status: String(r.follow_up_status || "").trim(), order_code: String(r.order_code || "").trim() };
  }
  // The classic screen's PUT body (validatePayload + toApiPayload): the screen's names and the server's, both.
  function bodyOf(u) {
    var fa = u.fulfilled ? (u.fulfilled_at || new Date().toISOString()) : "";
    return { order_date: u.order_date, client_name: u.client_name, address: u.address, contact: u.contact, alternate: u.alternate, email: u.email, items: u.items, priority: u.priority,
      needed_by: u.needed_by, pick_up_date: u.pick_up_date, deposit: money2(u.deposit) || "", notes: u.notes, fulfilled: u.fulfilled, fulfilled_at: fa, follow_up_status: u.follow_up_status, order_code: u.order_code,
      client_address: u.address, client_phone: u.contact, client_alt_phone: u.alternate, client_email: u.email, items_text: u.items, pickup_date: u.pick_up_date, deposit_amount: money2(u.deposit) || "" };
  }
  // Read one order again from the server (there is no single-order read: its month is listed). null when it is gone.
  async function reread(id, orderDate) {
    var mo = isYmd(orderDate) ? orderDate.slice(0, 7) : shiftMonth(0);
    var r = await E.apiFetch("/client-orders/entries?month=" + mo, { method: "GET" });
    var hit = ((r && r.entries) || []).find(function (x) { return x.id === id; });
    if (hit) return hit;
    var r2 = await E.apiFetch("/client-orders/entries?from=" + shiftMonth(-35) + "-01&to=" + shiftMonth(12) + "-01", { method: "GET" }).catch(function () { return null; }); // its date was changed elsewhere
    return ((r2 && r2.entries) || []).find(function (x) { return x.id === id; }) || null;
  }
  // A change whose answer was lost: it counts as saved only when the order now holds what was sent.
  async function landed(id, body) {
    try {
      var now = await reread(id, body.order_date); if (!now) return false;
      var u = uiOf(now);
      return ["order_date", "client_name", "contact", "items", "needed_by", "pick_up_date", "notes", "follow_up_status", "address", "alternate", "email"].every(function (k) { return String(u[k] || "") === String(body[k] || ""); }) &&
        Number(u.priority) === Number(body.priority) && !!u.fulfilled === !!body.fulfilled && (money2(u.deposit) || "0.00") === (money2(body.deposit) || "0.00");
    } catch (e) { return false; }
  }

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
      ".ord-tabs{display:inline-flex;gap:2px;padding:2px;border-radius:10px;background:rgba(118,118,128,.12);margin-top:16px}.ord-tabs button{font:inherit;font-size:14px;font-weight:600;height:30px;padding:0 14px;border:0;border-radius:8px;background:transparent;color:var(--text);cursor:pointer}.ord-tabs button[aria-pressed=true]{background:var(--panel2);box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      ".ord-name{border:0;background:none;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer}.ord-name:hover b,.ord-name:focus-visible b{text-decoration:underline}" +
      ".ord-ed{border-top:.5px solid var(--border);background:rgba(118,118,128,.05);padding:4px 0}.ord-ed .ord-form{margin:6px 12px 8px;background:var(--panel2)}" +
      ".ord-form textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0;resize:vertical;min-height:44px}" +
      ".ord-form .acts.l{justify-content:space-between}.ord-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.ord-btn.dd{background:#B42318;border-color:#B42318;color:#fff}" +
      ".ord-meta{font-size:12.5px;color:var(--muted);padding:6px 16px 2px}" +
      ".ord-more{display:flex;justify-content:center;margin-top:12px}" +
      // Wide screens (CSS only): when there are both a Waiting and a Ready list, they stand side by side.
      "@media (min-width:1200px){.ord:has(.ord-lab~.ord-lab){max-width:1180px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:20px;align-items:start;grid-auto-flow:row dense}" +
      ".ord:has(.ord-lab~.ord-lab)>*{grid-column:1/-1}.ord:has(.ord-lab~.ord-lab)>.ord-lab,.ord:has(.ord-lab~.ord-lab)>.ord-list,.ord:has(.ord-lab~.ord-lab)>.ord-quiet:has(+.ord-lab){grid-column:1}" +
      ".ord:has(.ord-lab~.ord-lab)>:is(.ord-list,.ord-quiet)~.ord-lab,.ord:has(.ord-lab~.ord-lab)>:is(.ord-list,.ord-quiet)~.ord-lab+.ord-list{grid-column:2}" +
      ".ord:has(.ord-lab~.ord-lab)>.ord-quiet:has(+.ord-lab){margin-top:0}.ord:has(.ord-lab~.ord-lab)>.ord-back{justify-self:start}}" +
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

  // Done: orders already ready, newest first, six months a page (the server's from/to range with fulfilled=1).
  async function loadDone(more) {
    if (S.doneLoading) return;
    var back = more ? S.doneBack + PAGE_MONTHS : 0;
    S.doneLoading = true; S.doneError = ""; if (!more) S.done = []; paint();
    var from = shiftMonth(-(back + PAGE_MONTHS - 1)) + "-01", to = shiftMonth(more ? -back + 1 : 1) + "-01";
    try {
      var rows = null;
      try { var r = await E.apiFetch("/client-orders/entries?from=" + from + "&to=" + to + "&fulfilled=1", { method: "GET" }); if (r && r.ok) rows = r.entries || []; } catch (e0) { if (e0 && e0.network) throw e0; rows = null; }
      if (!rows) { // a server without ranges: the same months one by one
        var ms = []; for (var k = 0; k < PAGE_MONTHS; k++) ms.push(shiftMonth(-(back + k)));
        var res = await Promise.all(ms.map(function (mo) { return E.apiFetch("/client-orders/entries?month=" + mo + "&fulfilled=1", { method: "GET" }); }));
        rows = [].concat.apply([], res.map(function (x) { return (x && x.entries) || []; }));
      }
      var seen = {}; S.done.forEach(function (e) { seen[e.id] = 1; });
      S.done = S.done.concat(rows.filter(function (e) { return Number(e.fulfilled) && !seen[e.id] && (seen[e.id] = 1); }))
        .sort(function (a, b) { return String(a.fulfilled_at || a.order_date) < String(b.fulfilled_at || b.order_date) ? 1 : -1; });
      S.doneBack = back;
    } catch (e) { S.doneError = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load orders"); }
    S.doneLoading = false; E.whenFormIdle(S.mount, paint);
  }

  function rowHtml(e, done) {
    var need = e.needed_by || e.pick_up_date || e.pickup_date || "", n = need ? daysUntil(need) : 99;
    var cls = done ? "" : n < 0 ? "late" : n <= 1 ? "soon" : "";
    var phone = e.client_phone || e.contact || "";
    var sub = []; if (phone) sub.push('<a href="tel:' + esc(String(phone).replace(/\s+/g, "")) + '">' + esc(phone) + "</a>");
    if (e.order_code) sub.push("Code " + esc(e.order_code));
    if (Number(e.deposit_amount || e.deposit) > 0) sub.push("Deposit €" + esc(e.deposit_amount || e.deposit));
    var fu = FOLLOW.filter(function (f) { return f[0] && f[0] === e.follow_up_status; })[0]; if (fu) sub.push(esc(fu[1]));
    if (e.notes) sub.push(esc(e.notes));
    var pill = done ? "Ready " + when(String(e.fulfilled_at || "").slice(0, 10)) : need ? (n < 0 ? "Late · needed " + when(need) : "Needed " + when(need)) : "No date";
    var open = S.editing === e.id;
    var h = '<div class="ord-row ' + cls + (Number(e.priority) === 1 && !done ? " hi" : "") + '"><div class="t"><button type="button" class="ord-name" data-act="open" data-id="' + e.id + '" aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + esc("Open the order for " + e.client_name) + '"><b>' + esc(e.client_name) + '</b><div class="it">' + esc(e.items_text || e.items || "") + "</div></button><span>" + sub.join(" · ") + "</span></div>" +
      '<span class="ord-pill ' + (done ? "done" : cls) + '">' + esc(pill) + "</span>" +
      (done ? '<button class="ord-btn" data-act="unready" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Not ready") + "</button>"
        : '<button class="ord-btn p" data-act="ready" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Ready") + "</button>") + "</div>";
    if (open) h += editHtml(e);
    return h;
  }

  function editHtml(e) {
    var a = S.edit || {}, f = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '"' + (extra || "") + "></label>"; };
    var h = '<div class="ord-ed"><form class="ord-form" id="ord-edit" autocomplete="off" aria-label="' + esc("Change the order for " + e.client_name) + '">' +
      f("client_name", "Customer", ' placeholder="Name and surname"') + f("contact", "Phone", ' type="tel" placeholder="Needed to save a change"') + f("alternate", "Other phone", ' type="tel" placeholder="Optional"') +
      f("email", "Email", ' type="email" placeholder="Optional"') + f("address", "Address", ' placeholder="Optional"') +
      '<label><span>Items</span><textarea name="items" rows="2">' + esc(a.items || "") + "</textarea></label>" +
      f("order_date", "Ordered", ' type="date"') + f("needed_by", "Needed by", ' type="date"') + f("pick_up_date", "Pick up", ' type="date"') + f("deposit", "Deposit €", ' inputmode="decimal" placeholder="Optional"') +
      '<label><span>Priority</span><select name="priority"><option value="1"' + (String(a.priority) === "1" ? " selected" : "") + '>Urgent</option><option value="2"' + (String(a.priority) === "2" ? " selected" : "") + '>Normal</option><option value="3"' + (String(a.priority) === "3" ? " selected" : "") + ">Low</option></select></label>" +
      '<label><span>Follow-up</span><select name="follow_up_status">' + FOLLOW.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === (a.follow_up_status || "") ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>Notes</span><textarea name="notes" rows="2" placeholder="What was said, e.g. Called, coming Friday">' + esc(a.notes || "") + "</textarea></label>" +
      (e.order_code ? '<div class="ord-meta">Order code ' + esc(e.order_code) + (e.created_at ? " · recorded " + esc(dmy(String(e.created_at).slice(0, 10))) : "") + "</div>" : "") +
      (S.editErr ? '<div class="ord-err" role="alert">' + esc(S.editErr) + "</div>" : "");
    if (S.del === e.id) {
      h += '<label><span>Why delete</span><input name="del_reason" value="' + esc(S.delReason || "") + '" placeholder="e.g. Entered twice"></label>' +
        '<div class="ord-meta">This removes the order for good. The reason is written on it first, so it stays in the audit.</div>' +
        '<div class="acts"><button type="button" class="ord-btn" data-act="del-cancel">Keep it</button><button type="button" class="ord-btn dd" data-act="del-go"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Deleting…" : "Delete order") + "</button></div>";
    } else {
      h += '<div class="acts l">' + (isAdmin() ? '<button type="button" class="ord-btn d" data-act="del">Delete…</button>' : "<span></span>") +
        '<span style="display:flex;gap:8px"><button type="button" class="ord-btn" data-act="edit-cancel">Close</button><button type="submit" class="ord-btn p"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Saving…" : "Save changes") + "</button></span></div>";
    }
    return h + "</form></div>";
  }

  function keepEdit() { // what is typed in the open order survives a redraw
    var f = S.mount && S.mount.querySelector("#ord-edit"); if (!f || !S.edit) return;
    EDIT.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.edit[k] = String(el.value || ""); });
    var r = f.querySelector("[name=del_reason]"); if (r) S.delReason = String(r.value || "");
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "ordreg") return; // left before a reply came back: do not draw over the next screen
    if (S.edit && !S.editSaving) keepEdit();
    var h = '<div class="ord"><button class="ord-back" data-act="back">‹ Customers</button>' +
      '<div class="ord-top"><div><h1>Orders</h1><p class="ord-sub">What customers are waiting for, by when they need it.</p></div>' + (S.adding ? "" : '<button class="ord-btn p" data-act="add">New order</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="ord-form" id="ord-add" autocomplete="off">' +
        '<label><span>Customer</span><input name="client_name" value="' + esc(a.client_name || "") + '" placeholder="Name and surname"></label>' +
        // not part of the order (the orders table has no ID card): it is checked against the person and kept on their details
        '<label><span>ID card</span><input name="id_card" value="' + esc(a.id_card || "") + '" placeholder="Optional, kept on their details" autocapitalize="characters"></label>' +
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
    var q = S.q.trim().toLowerCase(), match = function (e) { return !q || [e.client_name, e.items_text, e.items, e.client_phone, e.contact, e.notes, e.order_code].some(function (v) { return String(v || "").toLowerCase().indexOf(q) >= 0; }); };
    h += '<div class="ord-tabs" role="group" aria-label="Which orders"><button type="button" data-act="view-open" aria-pressed="' + (S.view === "open") + '">Waiting</button><button type="button" data-act="view-done" aria-pressed="' + (S.view === "done") + '">Done</button></div>';
    if (S.view === "done") {
      var dn = S.done.filter(match);
      if (S.done.length > 8 || S.q) h += '<input class="ord-q" aria-label="Search orders" id="ord-q" type="search" placeholder="Search customer, phone or item" value="' + esc(S.q) + '">';
      if (S.doneLoading && !S.done.length) h += '<div class="ord-quiet">Opening orders…</div>';
      else if (S.doneError && !S.done.length) h += '<div class="ord-quiet">' + esc(S.doneError) + "</div>";
      else {
        h += dn.length ? '<div class="ord-lab">Ready · ordered since ' + esc(MON[Number(shiftMonth(-(S.doneBack + PAGE_MONTHS - 1)).slice(5)) - 1] + " " + shiftMonth(-(S.doneBack + PAGE_MONTHS - 1)).slice(0, 4)) + " <b>" + dn.length + '</b></div><div class="ord-list">' + dn.map(function (e) { return rowHtml(e, true); }).join("") + "</div>"
          : '<div class="ord-quiet">' + (q ? "No order done matches “" + esc(S.q) + "” in these months." : "No order was made ready in these months.") + "</div>";
        if (S.doneError) h += '<div class="ord-err" role="alert">' + esc(S.doneError) + "</div>";
        if (S.doneBack + PAGE_MONTHS < 48) h += '<div class="ord-more"><button class="ord-btn" data-act="older"' + (S.doneLoading ? " disabled" : "") + ">" + (S.doneLoading ? "Opening…" : "Older orders") + "</button></div>";
      }
    } else {
      var open = S.entries.filter(function (e) { return !Number(e.fulfilled) && match(e); }).sort(function (a, b) { return String(a.needed_by || "9") < String(b.needed_by || "9") ? -1 : String(a.needed_by || "9") > String(b.needed_by || "9") ? 1 : Number(a.priority) - Number(b.priority); });
      var week = ymd(new Date(Date.now() - 7 * 86400000));
      var done = S.entries.filter(function (e) { return Number(e.fulfilled) && String(e.fulfilled_at || "").slice(0, 10) >= week && match(e); }).sort(function (a, b) { return String(a.fulfilled_at) < String(b.fulfilled_at) ? 1 : -1; });
      if (S.entries.length > 8 || S.q) h += '<input class="ord-q" aria-label="Search orders" id="ord-q" type="search" placeholder="Search customer, phone or item" value="' + esc(S.q) + '">';
      if (S.loading && !S.entries.length) h += '<div class="ord-quiet">Opening orders…</div>';
      else if (S.error) h += '<div class="ord-quiet">' + esc(S.error) + "</div>";
      else {
        h += open.length ? '<div class="ord-lab">Waiting <b>' + open.length + '</b></div><div class="ord-list">' + open.map(function (e) { return rowHtml(e, false); }).join("") + "</div>" : '<div class="ord-quiet">' + (q ? "Nothing waiting matches “" + esc(S.q) + "”." : "No customer is waiting for an order.") + "</div>";
        if (done.length) h += '<div class="ord-lab">Ready in the last week <b>' + done.length + '</b></div><div class="ord-list">' + done.map(function (e) { return rowHtml(e, true); }).join("") + "</div>";
      }
    }
    h += E.months.history("ordreg", E.months.preset("orders", { paint: function () { paint(); }, dep: function () { return S.loading ? undefined : S.entries; } })); // every order of a month, and its printout (eikon.months.js)
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Adding orders to the order diary is in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, backTo = ae && m.contains(ae) && ae.closest && ae.closest("#ord-edit") && ae.name ? ae.name : "";
    m.innerHTML = h;
    E.months.wireHistory(m, "ordreg");
    if (backTo) { var again = m.querySelector("#ord-edit [name=" + backTo + "]"); if (again) again.focus(); }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = "#customers";
        else if (a === "add") { S.adding = {}; S.err = ""; paint(); setTimeout(function () { var f = m.querySelector("[name=client_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "add-cancel") { S.adding = null; S.err = ""; paint(); }
        else if (a === "ready") ready(id, true);
        else if (a === "unready") ready(id, false);
        else if (a === "open") openEdit(id);
        else if (a === "edit-cancel") { S.editing = null; S.edit = null; S.editErr = ""; S.del = null; paint(); }
        else if (a === "del") { keepEdit(); S.del = S.editing; S.delReason = ""; S.editErr = ""; paint(); var r = m.querySelector("#ord-edit [name=del_reason]"); if (r) r.focus(); }
        else if (a === "del-cancel") { keepEdit(); S.del = null; S.editErr = ""; paint(); }
        else if (a === "del-go") remove();
        else if (a === "view-open") { S.view = "open"; S.editing = null; S.edit = null; S.del = null; paint(); }
        else if (a === "view-done") { S.view = "done"; S.editing = null; S.edit = null; S.del = null; if (!S.done.length) loadDone(false); else paint(); }
        else if (a === "older") loadDone(true);
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "ordreg"); } catch (e) {} E.openClassic("clientorders"); }
      });
    });
    var qi = m.querySelector("#ord-q"); if (qi) qi.addEventListener("input", function () { var pos = qi.selectionStart; S.q = qi.value; paint(); var q2 = S.mount.querySelector("#ord-q"); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} } });
    var f = m.querySelector("#ord-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); add(f); });
    if (f && E.personPick) E.personPick.attach({ key: "ordreg", form: f, fields: { id: "id_card", name: "client_name", phone: "contact" },
      local: function () { return S.entries.map(function (e) { return { name: e.client_name, phone: e.client_phone || e.contact, address: e.client_address, date: String(e.order_date || "").slice(0, 10), from: "order" }; }); } });
    var fe = m.querySelector("#ord-edit"); if (fe) fe.addEventListener("submit", function (ev) { ev.preventDefault(); if (S.del) return; saveEdit(); });
  }

  function openEdit(id) {
    if (S.editing === id) { S.editing = null; S.edit = null; S.del = null; S.editErr = ""; return paint(); }
    var e = findOrder(id); if (!e) return;
    S.editing = id; S.edit = uiOf(e); S.edit.priority = String(S.edit.priority); S.editErr = ""; S.del = null; S.orig = uiOf(e);
    paint(); var f = S.mount.querySelector("#ord-edit [name=client_name]"); if (f) f.focus();
  }

  // Save the open order: read it again, change only what was edited here, send it whole (the classic body).
  async function saveEdit() {
    if (S.editSaving || !S.editing) return;
    keepEdit();
    var id = S.editing, a = S.edit, o = S.orig || {};
    a.deposit = String(a.deposit || "").trim().replace(/^(\d+),(\d{1,2})$/, "$1.$2"); // a decimal comma, as some keyboards type it
    var t = function (k) { return String(a[k] == null ? "" : a[k]).trim(); };
    S.editErr = "";
    if (!t("client_name")) S.editErr = "Write the customer's name. Nothing was saved.";
    else if (!t("contact")) S.editErr = "Write the customer's phone: an order cannot be changed without one. Nothing was saved.";
    else if (!t("items")) S.editErr = "Write what they ordered. Nothing was saved.";
    else if (!isYmd(t("order_date"))) S.editErr = "Choose the day it was ordered. Nothing was saved.";
    else if (!isYmd(t("needed_by"))) S.editErr = "Choose when it is needed. Nothing was saved.";
    else if (t("pick_up_date") && !isYmd(t("pick_up_date"))) S.editErr = "Choose the pick-up day, or leave it empty. Nothing was saved.";
    else if (money2(t("deposit")) === null) S.editErr = "The deposit should be an amount, e.g. 20.00. Nothing was saved.";
    else if (t("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t("email"))) S.editErr = "The email does not look right. Nothing was saved.";
    if (S.editErr) return paint();
    S.editSaving = true; paint();
    var body = null;
    try {
      var fresh = await reread(id, o.order_date);
      if (!fresh) throw new Error("This order is no longer in the register (deleted elsewhere?)");
      var u = uiOf(fresh);
      EDIT.forEach(function (k) { var v = k === "priority" ? Number(a[k]) : t(k); if (String(v) !== String(k === "priority" ? Number(o[k]) : String(o[k] == null ? "" : o[k]).trim())) u[k] = v; }); // only what changed here
      if (!u.pick_up_date) u.pick_up_date = u.needed_by;
      if (u.follow_up_status === "called_no_answer" && o.follow_up_status !== "called_no_answer") { // as the classic screen does
        var sfx = " — Called " + dmy(today()) + " no answer"; if (u.notes.indexOf(sfx) < 0) u.notes = u.notes ? u.notes + sfx : sfx.trim();
      }
      body = bodyOf(u);
      var r = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      ok();
    } catch (x) {
      if (x && x.network && body && await landed(id, body)) ok();
      else { S.editErr = E.saveFailText(x); S.editSaving = false; return paint(); }
    }
    function ok() { E.toast(a.client_name + "'s order is saved", "success"); S.editing = null; S.edit = null; S.editSaving = false; S.editErr = ""; }
    S.editSaving = false; return reloadAll();
  }

  // Delete (pharmacist only): the reason is written on the order (the classic body), then the order is deleted.
  async function remove() {
    if (S.editSaving || !S.editing || !isAdmin()) return;
    keepEdit();
    var id = S.editing, reason = String(S.delReason || "").trim();
    if (!reason) { S.editErr = "Write why it is being deleted. Nothing was deleted."; paint(); var r0 = S.mount.querySelector("#ord-edit [name=del_reason]"); if (r0) r0.focus(); return; }
    S.editSaving = true; S.editErr = ""; paint();
    try {
      var fresh = await reread(id, (S.orig || {}).order_date);
      if (fresh) {
        var u = uiOf(fresh), who = ((E.state.user || {}).full_name || "").trim();
        if (u.contact) { // the server refuses a change without a phone: then only the audit's copy remains, without the reason
          var line = "Deleted " + dmy(today()) + (who ? " by " + who : "") + ": " + reason;
          u.notes = u.notes ? u.notes + "\n" + line : line; if (!u.pick_up_date) u.pick_up_date = u.needed_by;
          var r1 = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(bodyOf(u)) });
          if (!r1 || !r1.ok) throw new Error((r1 && r1.error) || "Could not write the reason");
        }
        var r2 = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "DELETE" }); // the classic screen's call
        if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Delete failed");
      }
      E.toast("Order deleted", "success"); S.editing = null; S.edit = null; S.del = null;
    } catch (x) {
      var gone = false; if (x && x.network) { try { gone = !(await reread(id, (S.orig || {}).order_date)); } catch (e2) { gone = false; } }
      if (gone) { E.toast("Order deleted", "success"); S.editing = null; S.edit = null; S.del = null; }
      else { S.editErr = E.saveFailText(x).replace(/^Not saved/, "Not deleted"); S.editSaving = false; return paint(); }
    }
    S.editSaving = false; return reloadAll();
  }

  function reloadAll() { var p = load(); if (S.view === "done") loadDone(false); return p; }

  async function ready(id, on) {
    var e = findOrder(id); if (!e || S.busy[id]) return;
    // The server refuses any change to an order without client_phone (creating one does not need it), so an order saved
    // with no phone, or one whose phone this screen dropped before 3 Nov, could never be marked ready: ask for it and send it.
    var body = { fulfilled: on };
    if (!String(e.client_phone || e.contact || "").trim()) {
      var ph = String(window.prompt("This order has no phone number, and it cannot be " + (on ? "marked ready" : "changed") + " without one. Customer's phone:", "") || "").trim();
      if (!ph) return;
      body.client_phone = ph; body.contact = ph;
    }
    S.busy[id] = true; paint();
    try {
      var r = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast(on ? e.client_name + "'s order is ready" : e.client_name + "'s order is waiting again", "success");
    } catch (x) {
      var now = null; if (x && x.network) { try { now = await reread(id, e.order_date); } catch (e2) { now = null; } }
      if (now && !!Number(now.fulfilled) === on) E.toast(on ? e.client_name + "'s order is ready" : e.client_name + "'s order is waiting again", "success");
      else E.toast(E.saveFailText(x), "error");
    }
    S.busy[id] = false; return reloadAll();
  }

  async function add(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { order_date: today(), client_name: v("client_name"), contact: v("contact"), items: v("items"), needed_by: v("needed_by"), pick_up_date: v("pick_up_date") || v("needed_by"), deposit: v("deposit"), priority: Number(v("priority") || 2), notes: v("notes") };
    // The server reads client_phone, pickup_date and deposit_amount; the names above alone were dropped (phone, pick-up date and deposit came back empty).
    body.client_phone = body.contact; body.pickup_date = body.pick_up_date; body.deposit_amount = body.deposit;
    var idc = E.people ? E.people.normIdCard(v("id_card")) : v("id_card");
    S.adding = Object.assign({}, body, { pick_up_date: v("pick_up_date"), id_card: v("id_card") }); S.err = "";
    if (!body.client_name) S.err = "Write the customer's name. Nothing was saved.";
    else if (!body.items) S.err = "Write what they ordered. Nothing was saved.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(body.needed_by)) S.err = "Choose when it is needed. Nothing was saved.";
    else if (body.deposit && !(Number(body.deposit) >= 0)) S.err = "The deposit should be a number. Nothing was saved.";
    if (S.err) return paint();
    // an ID card typed here and the person (E.people.confirmPerson): asked before the order is saved; Go back keeps the form
    var asked = null;
    if (idc && E.people && E.people.confirmPerson) {
      S.saving = true; paint();
      asked = await E.people.confirmPerson({ name: body.client_name, id_card: idc, phone: body.contact }, { key: "ordreg", record: "order" });
      S.saving = false;
      if (asked.action !== "save") {
        if (asked.action === "fill") S.adding[asked.field === "name" ? "client_name" : "id_card"] = asked.value;
        paint(); var back = S.mount && S.mount.querySelector("#ord-add [name=" + (asked.field === "name" ? "client_name" : "id_card") + "]"); if (back) back.focus();
        return;
      }
    }
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/client-orders/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Order added for " + body.client_name, "success");
      if (E.linkPerson) E.linkPerson({ name: body.client_name, phone: body.contact, id_card: idc }, "register:orders", asked); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "ordreg", title: "Orders", order: 3, icon: "◎", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.editing = null; S.edit = null; S.del = null; S.editErr = ""; S.editSaving = false; S.view = "open"; S.done = [];
      // From the search (eikon.search.js): show the order that was chosen or scanned (its code, or the customer's name).
      // That filter is for this visit only: the next visit opens on every order again.
      if (S.qFromSearch) { S.q = ""; S.qFromSearch = false; }
      try { var go = JSON.parse(sessionStorage.getItem("eikon_ordreg_q") || "null"); sessionStorage.removeItem("eikon_ordreg_q"); if (go && go.q && Date.now() - (go.at || 0) < 60000) { S.q = String(go.q); S.qFromSearch = true; } } catch (e) {}
      css(); paint(); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("ordreg") < 0) E.UI2_DESTINATIONS.push("ordreg");
  if (E.UI2_PARENT) E.UI2_PARENT.ordreg = "customers";
})();
