/* Customer orders, new layout: what is waiting, by when it is needed (late first), with the customer's number to call
   and one tap when it is ready; a new order in a few fields. Same endpoints as the classic screen; the order update keeps
   fields it is not sent (UPDATE-AUDIT.md: PARTIAL), so "Ready" and "Not ready" send only that.
   Open an order to change it: the order is read again from the server and sent whole, with only what was changed
   different, under the classic screen's names (both the screen's and the server's: client_phone, items_text,
   pickup_date, deposit_amount). "Done" lists the orders already ready, six months at a time. Delete is for the
   pharmacist only: the reason is written on the order first, so the audit's copy of the deleted order carries it.
   After a new order, the classic screen's question follows in place: put its items in the order diary (one diary
   line per line of items, for the order's day, with an optional supplier: the classic promptAddToOrderDiary call). */
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
  // Quick days under a date field (b4-4): Today · Tomorrow · the working day after (a Sunday is skipped). A tap only
  // writes that date into the field, exactly as typing it would; nothing is chosen until one is tapped.
  function dayChips(name, cur, what) {
    var h = "", d = new Date(), n = 0, WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (var i = 0; n < 3 && i < 8; i++, d.setDate(d.getDate() + 1)) {
      if (i > 0 && d.getDay() === 0) continue;
      var v = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      h += '<button type="button" data-day="' + n++ + '" data-ymd="' + v + '" aria-pressed="' + (cur === v) + '">' + (i === 0 ? "Today" : i === 1 ? "Tomorrow" : WD[d.getDay()] + " " + d.getDate()) + "</button>";
    }
    return '<div class="q44-days" role="group" aria-label="' + esc(what) + ', in one tap" data-for="' + name + '">' + h + "</div>";
  }
  function wireDays(form) {
    if (form) form.querySelectorAll(".q44-days").forEach(function (g) {
      var el = form.querySelector('[name="' + g.getAttribute("data-for") + '"]'); if (!el) return;
      var sync = function () { g.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-ymd") === el.value)); }); };
      g.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("button[data-ymd]"); if (!b || el.disabled) return; el.value = b.getAttribute("data-ymd"); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); sync(); });
      el.addEventListener("input", sync); el.addEventListener("change", sync);
    });
  }
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
      ".ord-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
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
      // Quality pass (2026-11-03): sentence-case headings, figures that line up, errors beside their fields, a skeleton
      // while loading, and 44 px targets on a phone.
      ".ord-lab{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none}.ord-list,.ord-lab b,.ord-pill{font-variant-numeric:tabular-nums}" +
      ".ord-form label{flex-wrap:wrap}.ord-ferr{flex-basis:100%;margin:-6px 0 8px 108px;color:var(--danger);font-size:13px;font-weight:500}" +
      ".ord-form label>.ord-hint{flex:0 1 auto;color:var(--muted);font-size:13px;white-space:nowrap}" +
      ".ord-ph{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-basis:100%;padding:8px 10px;border-radius:10px;background:rgba(201,138,18,.10)}.ord-ph label{font-size:14px;font-weight:600}" +
      ".ord-ph input{flex:1;min-width:140px;height:36px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 10px}" +
      ".ord-skel{display:block;height:58px;border-top:.5px solid var(--border);background:linear-gradient(90deg,rgba(118,118,128,.06),rgba(118,118,128,.14),rgba(118,118,128,.06));background-size:200% 100%;animation:ordsk 1.2s linear infinite}.ord-skel:first-child{border-top:0}" +
      "@keyframes ordsk{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.ord-skel{animation:none}}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .ord-ferr{color:#FF7A72}}" + // 5:1 on the tinted row being typed in
      // The order diary offer after a new order (b4-5).
      ".ord-dia{border-color:var(--accent)}.ord-dia .ord-meta{color:var(--text);font-size:14.5px;padding:8px 16px 4px}" +
      ".ord-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (max-width:600px){.ord{padding:4px 16px 0}.ord h1{font-size:32px}.ord-row{flex-wrap:wrap;row-gap:8px}.ord-row .t{flex-basis:100%}.ord-row .ord-btn{margin-left:auto}" +
      ".ord-btn,.ord-tabs button{height:44px;border-radius:22px}.ord-tabs button{border-radius:9px}.ord-ferr{margin-left:0}.ord-form label>span{flex-basis:88px}.ord-form label>.ord-hint{flex-basis:100%;white-space:normal;margin:-8px 0 8px 100px}.ord-q{height:44px;font-size:16px}.ord-ph input{height:44px}}";
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
    S.doneLoading = true; S.doneError = ""; paint(); // a refresh keeps the list on screen until the new one is in (no flash)
    var from = shiftMonth(-(back + PAGE_MONTHS - 1)) + "-01", to = shiftMonth(more ? -back + 1 : 1) + "-01";
    try {
      var rows = null;
      try { var r = await E.apiFetch("/client-orders/entries?from=" + from + "&to=" + to + "&fulfilled=1", { method: "GET" }); if (r && r.ok) rows = r.entries || []; } catch (e0) { if (e0 && e0.network) throw e0; rows = null; }
      if (!rows) { // a server without ranges: the same months one by one
        var ms = []; for (var k = 0; k < PAGE_MONTHS; k++) ms.push(shiftMonth(-(back + k)));
        var res = await Promise.all(ms.map(function (mo) { return E.apiFetch("/client-orders/entries?month=" + mo + "&fulfilled=1", { method: "GET" }); }));
        rows = [].concat.apply([], res.map(function (x) { return (x && x.entries) || []; }));
      }
      var base = more ? S.done : [], seen = {}; base.forEach(function (e) { seen[e.id] = 1; });
      S.done = base.concat(rows.filter(function (e) { return Number(e.fulfilled) && !seen[e.id] && (seen[e.id] = 1); }))
        .sort(function (a, b) { return String(a.fulfilled_at || a.order_date) < String(b.fulfilled_at || b.order_date) ? 1 : -1; });
      S.doneBack = back;
    } catch (e) { S.doneError = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load orders"); }
    S.doneLoading = false; E.whenFormIdle(S.mount, paint);
  }

  // A field the last save refused: marked, its reason written under it, read out with it (aria-describedby).
  function inv(map, k) { return map && map[k] ? ' aria-invalid="true" aria-describedby="ord-e-' + k + '"' : ""; }
  function ferr(map, k) { return map && map[k] ? '<small class="ord-ferr" id="ord-e-' + k + '">' + esc(map[k]) + "</small>" : ""; }
  // Every problem at once: each field says its own, and one line sums them up for a screen reader.
  function sumUp(fe, verb) { var ks = Object.keys(fe); return ks.length ? ks.map(function (k) { return fe[k]; }).join(" ") + " Nothing was " + (verb || "saved") + "." : ""; }

  function rowHtml(e, done) {
    var need = e.needed_by || e.pick_up_date || e.pickup_date || "", n = need ? daysUntil(need) : 99;
    var cls = done ? "" : n < 0 ? "late" : n <= 1 ? "soon" : "";
    var phone = e.client_phone || e.contact || "";
    var sub = []; if (phone) sub.push('<a href="tel:' + esc(String(phone).replace(/\s+/g, "")) + '">' + esc(phone) + "</a>");
    if (e.order_code) sub.push("Code " + esc(e.order_code));
    if (Number(e.deposit_amount || e.deposit) > 0) sub.push("Deposit €" + esc(money2(e.deposit_amount || e.deposit) || (e.deposit_amount || e.deposit)));
    var fu = FOLLOW.filter(function (f) { return f[0] && f[0] === e.follow_up_status; })[0]; if (fu) sub.push(esc(fu[1]));
    if (e.notes) sub.push(esc(e.notes));
    var pill = done ? "Ready " + when(String(e.fulfilled_at || "").slice(0, 10)) : need ? (n < 0 ? "Late · needed " + when(need) : "Needed " + when(need)) : "No date";
    var open = S.editing === e.id, ask = S.askPhone === e.id;
    var btn = ask ? "" : done ? '<button class="ord-btn" data-act="unready" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ' aria-label="' + esc("Not ready: " + e.client_name + "'s order is waiting again") + '">' + (S.busy[e.id] ? "Saving…" : "Not ready") + "</button>"
      : '<button class="ord-btn p" data-act="ready" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ' aria-label="' + esc("Ready: " + e.client_name + "'s order is in") + '">' + (S.busy[e.id] ? "Saving…" : "Ready") + "</button>";
    var h = '<div class="ord-row ' + cls + (Number(e.priority) === 1 && !done ? " hi" : "") + '"' + (ask ? ' style="flex-wrap:wrap"' : "") + '><div class="t"><button type="button" class="ord-name" data-act="open" data-id="' + e.id + '" aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + esc("Open the order for " + e.client_name) + '"><b>' + esc(e.client_name) + '</b><div class="it">' + esc(e.items_text || e.items || "") + "</div></button><span>" + sub.join(" · ") + "</span></div>" +
      '<span class="ord-pill ' + (done ? "done" : cls) + '">' + esc(pill) + "</span>" + btn;
    // An order saved without a phone cannot be changed (the server needs one): the phone is asked for here, in the row.
    if (ask) h += '<form class="ord-ph" id="ord-ph" data-id="' + e.id + '" autocomplete="off"><label for="ord-ph-in">Phone, to mark it ' + (S.askOn ? "ready" : "waiting") + '</label>' +
      '<input id="ord-ph-in" name="ph" type="tel" inputmode="tel" value="' + esc(S.phDraft || "") + '"' + (S.phErr ? ' aria-invalid="true" aria-describedby="ord-ph-err"' : "") + ">" +
      '<button type="submit" class="ord-btn p"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.askOn ? "Mark ready" : "Not ready") + '</button><button type="button" class="ord-btn" data-act="ph-cancel">Cancel</button>' +
      (S.phErr ? '<small class="ord-ferr" id="ord-ph-err" role="alert" style="margin:0">' + esc(S.phErr) + "</small>" : "") + "</form>";
    h += "</div>";
    if (open) h += editHtml(e);
    return h;
  }

  function editHtml(e) {
    var a = S.edit || {}, fe = S.efe || {}, f = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '"' + (extra || "") + inv(fe, k) + ">" + ferr(fe, k) + "</label>"; };
    var h = '<div class="ord-ed"><form class="ord-form" id="ord-edit" autocomplete="off" aria-label="' + esc("Change the order for " + e.client_name) + '">' +
      f("client_name", "Customer", ' placeholder="Name and surname"') + f("contact", "Phone", ' type="tel" inputmode="tel" placeholder="Needed to save a change"') + f("alternate", "Other phone", ' type="tel" inputmode="tel" placeholder="Optional"') +
      f("email", "Email", ' type="email" inputmode="email" autocapitalize="off" placeholder="Optional"') + f("address", "Address", ' placeholder="Optional"') +
      '<label><span>Items</span><textarea name="items" rows="2"' + inv(fe, "items") + ">" + esc(a.items || "") + "</textarea>" + ferr(fe, "items") + "</label>" +
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

  function keepEdit() { // what is typed in the open order (and in a phone asked for in a row) survives a redraw
    var ph = S.mount && S.mount.querySelector("#ord-ph-in"); if (ph) S.phDraft = String(ph.value || "");
    var sp = S.mount && S.mount.querySelector("#ord-diary [name=supplier]"); if (sp && S.diary && !S.diary.saving) S.diary.supplier = String(sp.value || "");
    var f = S.mount && S.mount.querySelector("#ord-edit"); if (!f || !S.edit) return;
    EDIT.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.edit[k] = String(el.value || ""); });
    var r = f.querySelector("[name=del_reason]"); if (r) S.delReason = String(r.value || "");
  }
  function keepAdd() { // and in the new order
    var f = S.mount && S.mount.querySelector("#ord-add"); if (!f || !S.adding) return;
    ["client_name", "id_card", "contact", "items", "needed_by", "pick_up_date", "deposit", "priority", "notes"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || ""); });
  }

  // The classic screen's next question after a new order: its items into the order diary, for the order's day.
  function diaryHtml() {
    var d = S.diary, one = d.lines.length === 1;
    return '<form class="ord-form ord-dia" id="ord-diary" autocomplete="off" aria-label="Order diary">' +
      '<div class="ord-meta">Put ' + (one ? "“" + esc(d.lines[0]) + "”" : d.lines.length + " items") + " in the order diary for " + esc(d.date === today() ? "today" : dmy(d.date)) + "?</div>" +
      '<label><span>Supplier</span><input name="supplier" value="' + esc(d.supplier || "") + '" placeholder="Optional, e.g. PharmaCo"></label>' +
      (d.err ? '<div class="ord-err" role="alert">' + esc(d.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="ord-btn" data-act="diary-no">Not now</button><button type="submit" class="ord-btn p"' + (d.saving ? " disabled" : "") + ">" + (d.saving ? "Adding…" : "Add to diary") + "</button></div></form>";
  }
  // Opened from a customer's page (modules.customers.js, BACKLOG4 item 1): who it is for stays in sight at the top, the
  // person is filled into the empty fields only, and focus goes to the first required field still empty.
  var CARRY = { client_name: "name", id_card: "id_card", contact: "phone" }, NEEDED = ["client_name", "items", "needed_by"];
  function carryLine() { var p = S.carry && S.carry.person; return p ? '<div class="ord-meta" style="padding:10px 16px 8px">From Customers: <b>' + esc(p.name) + "</b>" + (p.id_card ? " · ID card " + esc(p.id_card) : "") + "</div>" : ""; }
  function fillCarry() {
    var f = S.mount && S.mount.querySelector("#ord-add"), p = S.carry && S.carry.person; if (!f || !p) return;
    var want = {}; Object.keys(CARRY).forEach(function (k) { want[k] = p[CARRY[k]]; });
    E.fillEmpty(f, want).forEach(function (k) { S.adding[k] = want[k]; });
    var go = function () { if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#ord-add")) return; var g = S.mount && S.mount.querySelector("#ord-add"); if (!g) return; var el = NEEDED.map(function (k) { return g.querySelector("[name=" + k + "]"); }).filter(function (x) { return x && !String(x.value || "").trim(); })[0] || g.querySelector("[type=submit]"); if (el) el.focus(); };
    go(); setTimeout(go, 30); // and again after the screen settles, unless the person is already in the form
  }
  function onlyCarried() { // nothing typed beyond what came from the customer's page
    var a = S.adding || {}, p = (S.carry && S.carry.person) || {};
    return ["client_name", "id_card", "contact", "items", "needed_by", "pick_up_date", "deposit", "notes"].every(function (k) { var v = String(a[k] || "").trim(); return !v || (CARRY[k] && v === String(p[CARRY[k]] || "").trim()); });
  }
  // Cancel (or Escape with nothing typed) on a form opened from a customer's page goes back to that person.
  function closeAdd() { var h = S.carry; S.carry = null; S.adding = null; S.err = ""; S.fe = {}; if (h && E.customerReturn && E.customerReturn(h)) return; paint(); focusOn(".ord-top [data-act=add]"); }

  function addHtml() {
    var a = S.adding, fe = S.fe || {};
    var f = function (k, label, extra, after) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + inv(fe, k) + ">" + (after || "") + ferr(fe, k) + "</label>"; };
    return '<form class="ord-form" id="ord-add" autocomplete="off" aria-label="New order">' + carryLine() +
      f("client_name", "Customer", ' placeholder="Name and surname" autocapitalize="words"') +
      // not part of the order (the orders table has no ID card): it is checked against the person and kept on their details
      f("id_card", "ID card", ' placeholder="Optional, kept on their details" autocapitalize="characters"') +
      f("contact", "Phone", ' type="tel" inputmode="tel" placeholder="To call when it is in"') +
      f("items", "Items", ' placeholder="e.g. Augmentin 625 x14"') +
      f("needed_by", "Needed by", ' type="date" min="' + esc(today()) + '"') + dayChips("needed_by", a.needed_by, "Needed by") +
      f("pick_up_date", "Pick up", ' type="date" min="' + esc(today()) + '" aria-describedby="ord-pu-hint"', '<span class="ord-hint" id="ord-pu-hint">Leave empty if they collect the same day</span>') +
      f("deposit", "Deposit €", ' inputmode="decimal" placeholder="Optional"') +
      '<label><span>Priority</span><select name="priority"><option value="2">Normal</option><option value="1"' + (String(a.priority) === "1" ? " selected" : "") + '>Urgent</option><option value="3"' + (String(a.priority) === "3" ? " selected" : "") + ">Low</option></select></label>" +
      f("notes", "Notes", ' placeholder="Optional"') +
      (S.err ? '<div class="ord-err" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="ord-btn" data-act="add-cancel">Cancel</button><button type="submit" class="ord-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save order") + "</button></div></form>";
  }

  function matchOf() { var q = S.q.trim().toLowerCase(); return function (e) { return !q || [e.client_name, e.items_text, e.items, e.client_phone, e.contact, e.notes, e.order_code].some(function (v) { return String(v || "").toLowerCase().indexOf(q) >= 0; }); }; }
  function skel(what) { return '<div class="ord-list" aria-busy="true" style="margin-top:16px"><span class="ord-sr" role="status">Opening ' + what + '</span><i class="ord-skel"></i><i class="ord-skel"></i><i class="ord-skel"></i></div>'; }
  function trouble(msg) { return '<div class="ord-quiet" role="alert">' + esc(msg) + ' <button type="button" class="ord-btn" data-act="retry" style="margin-left:6px">Try again</button></div>'; }

  // The lists (what a search changes): redrawn on their own while typing, so the search box is never rebuilt.
  function resultsHtml() {
    var h = "", q = S.q.trim(), match = matchOf();
    if (S.view === "done") {
      var dn = S.done.filter(match);
      if (S.doneLoading && !S.done.length) h += skel("orders made ready");
      else if (S.doneError && !S.done.length) h += trouble(S.doneError);
      else {
        var since = shiftMonth(-(S.doneBack + PAGE_MONTHS - 1));
        h += dn.length ? '<div class="ord-lab">Ready · ordered since ' + esc(MON[Number(since.slice(5)) - 1] + " " + since.slice(0, 4)) + " <b>" + dn.length + '</b></div><div class="ord-list">' + dn.map(function (e) { return rowHtml(e, true); }).join("") + "</div>"
          : '<div class="ord-quiet">' + (q ? "No order done matches “" + esc(q) + "” in these months." : "No order was made ready in these months.") + "</div>";
        if (S.doneError) h += '<div class="ord-err" role="alert">' + esc(S.doneError) + "</div>";
        if (S.doneBack + PAGE_MONTHS < 48) h += '<div class="ord-more"><button class="ord-btn" data-act="older"' + (S.doneLoading ? " disabled" : "") + ">" + (S.doneLoading ? "Opening…" : "Older orders") + "</button></div>";
      }
      return h;
    }
    var open = S.entries.filter(function (e) { return !Number(e.fulfilled) && match(e); }).sort(function (a, b) { return String(a.needed_by || "9") < String(b.needed_by || "9") ? -1 : String(a.needed_by || "9") > String(b.needed_by || "9") ? 1 : Number(a.priority) - Number(b.priority); });
    var week = ymd(new Date(Date.now() - 7 * 86400000));
    var done = S.entries.filter(function (e) { return Number(e.fulfilled) && String(e.fulfilled_at || "").slice(0, 10) >= week && match(e); }).sort(function (a, b) { return String(a.fulfilled_at) < String(b.fulfilled_at) ? 1 : -1; });
    if (S.loading && !S.entries.length) return skel("orders");
    if (S.error) return trouble(S.error);
    var late = open.filter(function (e) { return e.needed_by && daysUntil(e.needed_by) < 0; }).length;
    h += open.length ? '<div class="ord-lab">Waiting <b>' + open.length + "</b>" + (late ? '<span style="color:var(--danger)">· ' + late + " late</span>" : "") + '</div><div class="ord-list">' + open.map(function (e) { return rowHtml(e, false); }).join("") + "</div>"
      : '<div class="ord-quiet">' + (q ? "Nothing waiting matches “" + esc(q) + "”." + (done.length ? "" : " Try a shorter part of the name, or the phone number.") : "No customer is waiting for an order. When someone asks for something you do not have, press New order.") + "</div>";
    if (done.length) h += '<div class="ord-lab">Ready in the last week <b>' + done.length + '</b></div><div class="ord-list">' + done.map(function (e) { return rowHtml(e, true); }).join("") + "</div>";
    return h;
  }

  function html() {
    var h = '<div class="ord"><button class="ord-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("ordreg") : "‹ Customers") + "</button>" +
      '<div class="ord-top"><div><h1>Orders</h1><p class="ord-sub">What customers are waiting for, by when they need it.</p></div>' + (S.adding ? "" : '<button class="ord-btn p" data-act="add">New order</button>') + "</div>";
    if (S.adding) h += addHtml();
    if (S.diary) h += diaryHtml();
    h += '<div class="ord-tabs" role="group" aria-label="Which orders"><button type="button" data-act="view-open" aria-pressed="' + (S.view === "open") + '">Waiting</button><button type="button" data-act="view-done" aria-pressed="' + (S.view === "done") + '">Done</button></div>';
    var many = S.view === "done" ? S.done.length > 8 : S.entries.length > 8;
    if (many || S.q) h += '<input class="ord-q" aria-label="Search orders" id="ord-q" type="search" autocomplete="off" placeholder="Search customer, phone or item" value="' + esc(S.q) + '">';
    h += '<div id="ord-res">' + resultsHtml() + "</div>";
    h += E.months.history("ordreg", E.months.preset("orders", { paint: function () { E.repaintKeepingFocus(S.mount, paint); }, dep: function () { return S.loading ? undefined : S.entries; } })); // every order of a month, and its printout (eikon.months.js)
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Taking a deleted order\'s items off the order diary is in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    return h;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "ordreg") return; // left before a reply came back: do not draw over the next screen
    if (!S.editSaving) keepEdit();
    if (!S.saving) keepAdd();
    var ae = document.activeElement, backTo = ae && m.contains(ae) && ae.closest && ae.closest("#ord-edit") && ae.name ? ae.name : "";
    m.innerHTML = html();
    E.months.wireHistory(m, "ordreg");
    if (backTo) { var again = m.querySelector("#ord-edit [name=" + backTo + "]"); if (again) again.focus(); }
    bind(m);
  }
  // A search: only the lists change.
  function paintResults() {
    var m = S.mount, box = m && m.querySelector("#ord-res"); if (!box) return paint();
    keepEdit(); box.innerHTML = resultsHtml(); bind(box);
  }
  function focusOn(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }); } // never away from a field the person went to meanwhile
  function addEmpty() { var a = S.adding || {}; return !["client_name", "id_card", "contact", "items", "needed_by", "pick_up_date", "deposit", "notes"].some(function (k) { return String(a[k] || "").trim(); }); }
  function editUnchanged() { var a = S.edit || {}, o = S.orig || {}; return EDIT.every(function (k) { return String(a[k] == null ? "" : a[k]).trim() === String(o[k] == null ? "" : o[k]).trim(); }); }
  function closeEdit() { var id = S.editing; S.editing = null; S.edit = null; S.editErr = ""; S.efe = {}; S.del = null; paint(); if (id) focusOn('[data-act=open][data-id="' + id + '"]'); }

  function bind(root) {
    var m = S.mount;
    root.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("ordreg") : "#customers";
        else if (a === "add") { S.carry = null; S.adding = {}; S.err = ""; S.fe = {}; paint(); E.focusSoon(function () { return m.querySelector("#ord-add [name=client_name]"); }, 30); }
        else if (a === "add-cancel") closeAdd();
        else if (a === "ready") ready(id, true);
        else if (a === "unready") ready(id, false);
        else if (a === "ph-cancel") { var pid = S.askPhone; S.askPhone = null; S.phErr = ""; S.phDraft = ""; paint(); focusOn('[data-act=' + (S.askOn ? "ready" : "unready") + '][data-id="' + pid + '"]'); }
        else if (a === "retry") reloadAll();
        else if (a === "open") openEdit(id);
        else if (a === "edit-cancel") closeEdit();
        else if (a === "del") { keepEdit(); S.del = S.editing; S.delReason = ""; S.editErr = ""; paint(); var r = m.querySelector("#ord-edit [name=del_reason]"); if (r) r.focus(); }
        else if (a === "del-cancel") { keepEdit(); S.del = null; S.editErr = ""; paint(); focusOn("#ord-edit [data-act=del]"); }
        else if (a === "del-go") remove();
        else if (a === "view-open") { S.view = "open"; S.editing = null; S.edit = null; S.del = null; S.askPhone = null; paint(); focusOn("[data-act=view-open]"); }
        else if (a === "view-done") { S.view = "done"; S.editing = null; S.edit = null; S.del = null; S.askPhone = null; if (!S.done.length) loadDone(false); else paint(); focusOn("[data-act=view-done]"); }
        else if (a === "older") loadDone(true);
        else if (a === "diary-no") { S.diary = null; paint(); focusOn(".ord-top [data-act=add]"); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "ordreg"); } catch (e) {} E.openClassic("clientorders"); }
      });
    });
    var qi = root.querySelector("#ord-q");
    if (qi) {
      qi.addEventListener("input", function () { S.q = qi.value; paintResults(); });
      qi.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && qi.value) { ev.preventDefault(); qi.value = ""; S.q = ""; paintResults(); } });
    }
    var f = root.querySelector("#ord-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(f); });
      wireDays(f);
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !document.querySelector(".epp-list:not([hidden])")) { keepAdd(); if (addEmpty() || (S.carry && onlyCarried())) { ev.preventDefault(); closeAdd(); } } }); // Escape closes an empty form; typing is never thrown away
    }
    if (f && E.personPick) E.personPick.attach({ key: "ordreg", form: f, fields: { id: "id_card", name: "client_name", phone: "contact" },
      local: function () { return S.entries.map(function (e) { return { name: e.client_name, phone: e.client_phone || e.contact, address: e.client_address, date: String(e.order_date || "").slice(0, 10), from: "order" }; }); } });
    var fd = root.querySelector("#ord-diary");
    if (fd) {
      fd.addEventListener("submit", function (ev) { ev.preventDefault(); toDiary(); });
      fd.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && S.diary && !S.diary.saving) { ev.preventDefault(); S.diary = null; paint(); focusOn(".ord-top [data-act=add]"); } });
    }
    var fe = root.querySelector("#ord-edit");
    if (fe) {
      fe.addEventListener("submit", function (ev) { ev.preventDefault(); if (S.del) return; saveEdit(); });
      fe.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.editSaving) { keepEdit(); if (S.del) { ev.preventDefault(); S.del = null; S.editErr = ""; paint(); focusOn("#ord-edit [data-act=del]"); } else if (editUnchanged()) { ev.preventDefault(); closeEdit(); } } });
    }
    var fp = root.querySelector("#ord-ph");
    if (fp) {
      fp.addEventListener("submit", function (ev) { ev.preventDefault(); var ph = String((fp.querySelector("#ord-ph-in") || {}).value || "").trim(); if (!ph) { S.phErr = "Write the customer's phone. Nothing was saved."; paint(); focusOn("#ord-ph-in"); return; } ready(Number(fp.getAttribute("data-id")), S.askOn, ph); });
      fp.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); var b = fp.querySelector("[data-act=ph-cancel]"); if (b) b.click(); } });
    }
    // A field marked wrong is unmarked as soon as it is typed in (no redraw).
    root.querySelectorAll("form").forEach(function (fm) { fm.addEventListener("input", function (ev) { var el = ev.target; if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); var n = el.name, map = fm.id === "ord-add" ? S.fe : S.efe; if (map && n) delete map[n]; var s = el.parentNode && el.parentNode.querySelector(".ord-ferr"); if (s) s.remove(); } }); });
  }

  function openEdit(id) {
    if (S.editing === id) { keepEdit(); if (!editUnchanged()) { var sv = S.mount.querySelector("#ord-edit [type=submit]"); if (sv) sv.focus(); return; } return closeEdit(); } // a second tap closes it, unless something was typed
    var e = findOrder(id); if (!e) return;
    S.editing = id; S.edit = uiOf(e); S.edit.priority = String(S.edit.priority); S.editErr = ""; S.efe = {}; S.del = null; S.orig = uiOf(e); S.askPhone = null;
    paint(); var f = S.mount.querySelector("#ord-edit [name=client_name]"); if (f) f.focus();
  }

  // Save the open order: read it again, change only what was edited here, send it whole (the classic body).
  async function saveEdit() {
    if (S.editSaving || !S.editing) return;
    keepEdit();
    var id = S.editing, a = S.edit, o = S.orig || {};
    a.deposit = String(a.deposit || "").trim().replace(/^(\d+),(\d{1,2})$/, "$1.$2"); // a decimal comma, as some keyboards type it
    var t = function (k) { return String(a[k] == null ? "" : a[k]).trim(); };
    var fe = {};
    if (!t("client_name")) fe.client_name = "Write the customer's name.";
    if (!t("contact")) fe.contact = "Write the customer's phone: an order cannot be changed without one.";
    if (t("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t("email"))) fe.email = "Check the email: it should look like name@example.com.";
    if (!t("items")) fe.items = "Write what they ordered.";
    if (!isYmd(t("order_date"))) fe.order_date = "Choose the day it was ordered.";
    if (!isYmd(t("needed_by"))) fe.needed_by = "Choose when it is needed.";
    if (t("pick_up_date") && !isYmd(t("pick_up_date"))) fe.pick_up_date = "Choose the pick-up day, or leave it empty.";
    if (money2(t("deposit")) === null) fe.deposit = "Write the deposit as an amount, e.g. 20.00.";
    S.efe = fe; S.editErr = sumUp(fe);
    if (S.editErr) { paint(); var k0 = Object.keys(fe)[0]; focusOn("#ord-edit [name=" + k0 + "]"); return; }
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
    function ok() { E.toast(a.client_name + "'s order is saved", "success"); S.editing = null; S.edit = null; S.editSaving = false; S.editErr = ""; S.efe = {}; }
    S.editSaving = false; await reloadAll(); focusOn('[data-act=open][data-id="' + id + '"]');
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

  // The classic call, line by line (POST /order-diary/entries { order_date, item_name, qty: 1, supplier, notes: "" }).
  // A line whose answer was lost counts as added when the diary for that day now has it (E.postOnce); a failure keeps
  // the lines still to add, and the supplier, for Try again.
  async function toDiary() {
    var d = S.diary; if (!d || d.saving) return;
    keepEdit(); d.saving = true; d.err = ""; paint();
    var supplier = String(d.supplier || "").trim(), n = d.lines.length;
    try {
      while (d.lines.length) {
        var line = d.lines[0];
        await E.postOnce("/order-diary/entries", { order_date: d.date, item_name: line, qty: 1, supplier: supplier, notes: "" },
          { list: async function () { var r = await E.apiFetch("/order-diary/entries?date=" + encodeURIComponent(d.date), { method: "GET" }); return (r && r.entries) || []; },
            same: function (x) { return String(x.item_name || "").trim() === line; } });
        d.lines.shift();
      }
      S.diary = null; E.toast(n === 1 ? "Added to the order diary" : n + " items added to the order diary", "success");
    } catch (x) { d.saving = false; d.err = E.saveFailText(x); paint(); return focusOn("#ord-diary [type=submit]"); }
    paint(); focusOn(".ord-top [data-act=add]");
  }

  function reloadAll() { var p = load(); return S.view === "done" ? Promise.all([p, loadDone(false)]) : p; }

  async function ready(id, on, ph) {
    var e = findOrder(id); if (!e || S.busy[id]) return;
    // The server refuses any change to an order without client_phone (creating one does not need it), so an order saved
    // with no phone, or one whose phone this screen dropped before 3 Nov, could never be marked ready: the row asks for
    // the phone in place (no pop-up) and sends it with the change.
    var body = { fulfilled: on };
    if (!String(e.client_phone || e.contact || "").trim()) {
      if (!ph) { S.askPhone = id; S.askOn = on; S.phErr = ""; S.phDraft = ""; paint(); var pin = S.mount && S.mount.querySelector("#ord-ph-in"); if (pin) pin.focus(); return; } // at once: the tap opened it
      body.client_phone = ph; body.contact = ph;
    }
    S.busy[id] = true; S.phErr = ""; paint();
    try {
      var r = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast(on ? e.client_name + "'s order is ready" : e.client_name + "'s order is waiting again", "success"); S.askPhone = null; S.phDraft = "";
    } catch (x) {
      var now = null; if (x && x.network) { try { now = await reread(id, e.order_date); } catch (e2) { now = null; } }
      if (now && !!Number(now.fulfilled) === on) { E.toast(on ? e.client_name + "'s order is ready" : e.client_name + "'s order is waiting again", "success"); S.askPhone = null; S.phDraft = ""; }
      else { var why = E.saveFailText(x); if (S.askPhone === id) S.phErr = why; E.toast(why, "error"); }
    }
    S.busy[id] = false; await reloadAll();
    focusOn('[data-act=open][data-id="' + id + '"]'); // the order keeps the focus, wherever its row went (Waiting or Ready)
  }

  async function add(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var dep = v("deposit").replace(/^(\d+),(\d{1,2})$/, "$1.$2"); // a decimal comma, as some keyboards type it
    var body = { order_date: today(), client_name: v("client_name"), contact: v("contact"), items: v("items"), needed_by: v("needed_by"), pick_up_date: v("pick_up_date") || v("needed_by"), deposit: dep, priority: Number(v("priority") || 2), notes: v("notes") };
    // The server reads client_phone, pickup_date and deposit_amount; the names above alone were dropped (phone, pick-up date and deposit came back empty).
    body.client_phone = body.contact; body.pickup_date = body.pick_up_date; body.deposit_amount = body.deposit;
    var idc = E.people ? E.people.normIdCard(v("id_card")) : v("id_card");
    S.adding = Object.assign({}, body, { pick_up_date: v("pick_up_date"), id_card: v("id_card"), priority: String(body.priority) }); S.err = "";
    var fe = {};
    if (!body.client_name) fe.client_name = "Write the customer's name.";
    if (!body.items) fe.items = "Write what they ordered.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.needed_by)) fe.needed_by = "Choose when it is needed.";
    if (body.deposit && !(Number(body.deposit) >= 0)) fe.deposit = "Write the deposit as an amount, e.g. 10.00.";
    S.fe = fe; S.err = sumUp(fe);
    if (S.err) { paint(); focusOn("#ord-add [name=" + Object.keys(fe)[0] + "]"); return; }
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
      var r = await E.apiFetch("/client-orders/entries", { method: "POST", body: JSON.stringify(body) }).catch(E.landedOk); // lost answer, but in the list: saved (item 8)
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; S.carry = null; S.fe = {}; E.toast("Saved · order for " + body.client_name, "success"); S.justAdded = true;
      var lines = String(body.items || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); // the classic splitItemLines
      S.diary = lines.length ? { lines: lines, date: body.order_date, supplier: "", err: "", saving: false } : null;
      if (E.linkPerson) E.linkPerson({ name: body.client_name, phone: body.contact, id_card: idc }, "register:orders", asked); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; await load();
    if (S.justAdded) { S.justAdded = false; focusOn(".ord-top [data-act=add]"); } // the next order is one key away
  }

  E.registerModule({
    id: "ordreg", title: "Orders", order: 3, icon: "◎", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.editing = null; S.edit = null; S.del = null; S.editErr = ""; S.editSaving = false; S.view = "open"; S.done = [];
      S.fe = {}; S.efe = {}; S.err = ""; S.askPhone = null; S.phErr = ""; S.phDraft = ""; S.diary = null;
      // From the search (eikon.search.js): show the order that was chosen or scanned (its code, or the customer's name).
      // That filter is for this visit only: the next visit opens on every order again.
      if (S.qFromSearch) { S.q = ""; S.qFromSearch = false; }
      try { var go = JSON.parse(sessionStorage.getItem("eikon_ordreg_q") || "null"); sessionStorage.removeItem("eikon_ordreg_q"); if (go && go.q && Date.now() - (go.at || 0) < 60000) { S.q = String(go.q); S.qFromSearch = true; } } catch (e) {}
      // From a customer's page: a new order for them, or (from the count of their orders) their orders.
      var hand = E.takeCustomerHandoff ? E.takeCustomerHandoff("ordreg") : null;
      S.carry = hand && hand.mode === "new" ? hand : null;
      if (hand && hand.mode === "find") { S.q = String(hand.person.name); S.qFromSearch = true; }
      if (S.carry) S.adding = {};
      css(); paint(); if (S.carry) fillCarry(); if (E.onReconnect) E.onReconnect(load); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("ordreg") < 0) E.UI2_DESTINATIONS.push("ordreg");
  if (E.UI2_PARENT) E.UI2_PARENT.ordreg = "customers";
})();
