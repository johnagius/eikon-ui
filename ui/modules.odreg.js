/* Order diary, new layout: what to order today, grouped by supplier, with what came in. Each item: Received, Not
   received or Wrong pick (only the status is sent; the update keeps every other field). Add an item (names used before
   are offered with their usual supplier); carry what is still outstanding to the next day (the server skips items it
   already carried). Tap an item to change it (the classic Edit Item body: item_name, qty, supplier, notes) or, for the
   pharmacist, delete it (the classic DELETE, after one plain question). Printing the day's list stays in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, day: "", entries: [], items: [], loading: false, error: "", busy: {}, adding: null, saving: false, err: "", editing: null, edit: null, orig: null, editErr: "", editSaving: false, del: false };
  var DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var ST = { pending: ["Waiting", ""], received: ["Received", "ok"], not_received: ["Not received", "bad"], wrong_pick: ["Wrong pick", "bad"] };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function shift(s, n) { var p = s.split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); d.setDate(d.getDate() + n); return ymd(d); }
  function label(s) { if (s === today()) return "Today"; if (s === shift(today(), 1)) return "Tomorrow"; if (s === shift(today(), -1)) return "Yesterday"; var p = s.split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); return DAY[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; }
  function isAdmin() { var u = E.state && E.state.user; return !!(u && u.role === "admin"); } // the server lets staff delete too: this screen keeps it to the pharmacist, as the other rebuilt screens do
  function outstanding(e) { return e.status === "pending" || e.status === "not_received" || e.status === "wrong_pick"; }

  function css() {
    if (document.getElementById("eikon-odreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-odreg-css";
    st.textContent =
      ".odr{max-width:880px;margin:0 auto}" +
      ".odr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".odr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".odr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.odr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".odr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".odr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.odr-btn:disabled{opacity:.55;cursor:default}.odr-btn.s{height:30px;padding:0 10px;font-size:13px;border-radius:15px}" +
      ".odr-nav{display:flex;align-items:center;gap:8px;margin-top:16px}.odr-nav b{flex:1;text-align:center;font-size:15px;font-weight:600}" +
      ".odr-nav button{font:inherit;font-size:20px;line-height:1;width:36px;height:36px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}.odr-nav .now{font-size:13px;font-weight:600;width:auto;padding:0 12px}" +
      ".odr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;justify-content:space-between}.odr-lab b{color:var(--text)}" +
      ".odr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".odr-row{display:flex;gap:10px;align-items:center;padding:10px 14px;border-top:.5px solid var(--border);flex-wrap:wrap}.odr-row:first-child{border-top:0}" +
      ".odr-row .t{flex:1;min-width:150px}.odr-row b{font-size:15px;font-weight:600}.odr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}.odr-row .q{font-variant-numeric:tabular-nums;font-weight:600;color:var(--muted);margin-left:4px}" +
      ".odr-row .a{display:flex;gap:6px;flex-wrap:wrap}.odr-row.done b{color:var(--muted)}" +
      ".odr-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--muted);white-space:nowrap}.odr-pill.ok{background:rgba(28,138,91,.16);color:var(--ok)}.odr-pill.bad{background:rgba(215,38,28,.12);color:var(--danger)}" +
      ".odr-carry{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:10px 14px;border-radius:12px;background:rgba(201,138,18,.10);font-size:14px;flex-wrap:wrap}" +
      ".odr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".odr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.odr-form label:first-child{border-top:0}" +
      ".odr-form label>span{flex:0 0 96px;font-size:15px}.odr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".odr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}.odr-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".odr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.odr{padding:4px 16px 0}.odr h1{font-size:32px}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".odr-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.odr-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".odr-quiet .odr-btn{margin-top:12px;display:block}" +
      "@media (max-width:600px){.odr-btn,.odr-btn.s{height:44px;border-radius:22px}.odr-nav button{width:44px;height:44px}.odr-nav button.now{width:auto}}" +
      // b4-6a: an item opens to be changed in place; delete asks once.
      ".odr-name{border:0;background:none;padding:4px 0;margin:-4px 0;font:inherit;color:inherit;text-align:left;cursor:pointer;min-height:44px}.odr-name:hover b,.odr-name:focus-visible b{text-decoration:underline}" +
      ".odr-name,.odr-form input{font-feature-settings:\"calt\" 0}" +
      ".odr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      ".odr-ed{border-top:.5px solid var(--border);background:rgba(118,118,128,.05);padding:4px 0}.odr-ed .odr-form{margin:6px 12px 8px;background:var(--panel2)}" +
      ".odr-form .acts.l{justify-content:space-between}.odr-form .acts.l span{display:flex;gap:8px}.odr-ask{padding:10px 14px 2px;font-size:15px;font-weight:600}" +
      ".odr-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.odr-btn.dd{background:#B42318;border-color:#B42318;color:#fff}";
    document.head.appendChild(st);
  }

  async function list(day) { var r = await E.apiFetch("/order-diary/entries?date=" + encodeURIComponent(day), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the order diary"); return r.entries || []; }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var both = await Promise.all([list(S.day), list(shift(S.day, 1)).catch(function () { return []; })]);
      S.entries = both[0]; S.carried = {}; both[1].forEach(function (e) { if (e.carried_from_id) S.carried[e.carried_from_id] = 1; }); // what has already gone forward
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the order diary"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  async function loadItems() {
    try { var r = await E.apiFetch("/order-diary/items", { method: "GET" }); S.items = (r && r.ok && r.items) || []; } catch (e) { S.items = []; }
    var dl = S.mount && S.mount.querySelector("#odr-items"); if (dl) dl.innerHTML = S.items.map(function (i) { return '<option value="' + esc(i.item_name) + '">'; }).join("");
    var ds = S.mount && S.mount.querySelector("#odr-sups"); if (ds) ds.innerHTML = supList().map(function (s) { return '<option value="' + esc(s) + '">'; }).join(""); // the list only: no redraw under a tap
  }

  function rowHtml(e) {
    var st = ST[e.status] || ST.pending, done = e.status === "received";
    var h = '<div class="odr-row' + (done ? " done" : "") + '"><div class="t"><button type="button" class="odr-name" data-act="open" data-id="' + e.id + '" aria-expanded="' + (S.editing === e.id) + '"><span class="odr-sr">Change </span><b>' + esc(e.item_name) + '</b><i class="q" style="font-style:normal">× ' + esc(e.qty) + "</i></button>" + (e.notes || e.carried_from_id ? "<span>" + esc([e.carried_from_id ? "Carried over" : "", e.notes || ""].filter(Boolean).join(" · ")) + "</span>" : "") + "</div>";
    if (e.status === "pending") h += '<div class="a"><button class="odr-btn s p" data-st="received" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + '>Received</button><button class="odr-btn s" data-st="not_received" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + '>Not received</button><button class="odr-btn s" data-st="wrong_pick" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">Wrong pick</button></div>";
    else h += '<span class="odr-pill ' + st[1] + '">' + st[0] + '</span><button class="odr-btn s" data-st="pending" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">Undo</button>";
    return h + "</div>" + (S.editing === e.id ? editHtml(e) : "");
  }
  // The open item: the classic Edit Item's four fields; Save changes sends exactly them. Delete… is the pharmacist's.
  function editHtml(e) {
    var a = S.edit || {}, fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '"' + (extra || "") + "></label>"; };
    var h = '<div class="odr-ed"><form class="odr-form" id="odr-edit" autocomplete="off" aria-label="' + esc("Change " + e.item_name) + '">' +
      fld("item_name", "Item", ' list="odr-items"') + fld("qty", "How many", ' inputmode="numeric"') + fld("supplier", "Supplier", ' list="odr-sups" placeholder="Optional"') + fld("notes", "Note", ' placeholder="Optional, e.g. for Mrs Borg"') +
      (S.editErr ? '<div class="odr-err" role="alert">' + esc(S.editErr) + "</div>" : "");
    if (S.del) h += '<p class="odr-ask" id="odr-ask">Delete this item from the order diary? This cannot be undone.</p>' +
      '<div class="acts"><button type="button" class="odr-btn" data-act="del-cancel">Keep it</button><button type="button" class="odr-btn dd" data-act="del-go" aria-describedby="odr-ask"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Deleting…" : "Delete item") + "</button></div>";
    else h += '<div class="acts l">' + (isAdmin() ? '<button type="button" class="odr-btn d" data-act="del">Delete…</button>' : "<i></i>") +
      '<span><button type="button" class="odr-btn" data-act="edit-cancel">Close</button><button type="submit" class="odr-btn p"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Saving…" : "Save changes") + "</button></span></div>";
    return h + "</form></div>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "odreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    if (S.editing && !S.editSaving && !fromState) keepEdit();
    var h = '<div class="odr"><button class="odr-back" data-act="back">' + esc(E.ui2BackLabel("odreg")) + '</button>' +
      '<div class="odr-top"><div><h1>Order diary</h1><p class="odr-sub">What to order, by supplier, and what came in.</p></div>' + (S.adding ? "" : '<button class="odr-btn p" data-act="add">Add an item</button>') + "</div>" +
      '<div class="odr-nav"><button data-act="prev" aria-label="Day before">‹</button><b>' + esc(label(S.day)) + "</b>" + (S.day === today() ? "" : '<button class="now" data-act="today">Today</button>') + '<button data-act="next" aria-label="Day after">›</button></div>';
    if (S.adding) {
      var a = S.adding, fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + "></label>"; };
      h += '<form class="odr-form" id="odr-add" autocomplete="off">' + fld("item_name", "Item", ' list="odr-items" placeholder="e.g. Augmentin 625 x14"') + fld("qty", "How many", ' inputmode="numeric" placeholder="1"') + fld("supplier", "Supplier", ' list="odr-sups" placeholder="Optional"') + fld("notes", "Note", ' placeholder="Optional, e.g. for Mrs Borg"') +
        (S.err ? '<div class="odr-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="odr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="odr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Add to " + esc(label(S.day).toLowerCase() === "today" ? "today" : label(S.day))) + "</button></div></form>";
    }
    if (S.loading && !S.entries.length) h += '<div class="odr-quiet">Opening the order diary…</div>';
    else if (S.error) h += '<div class="odr-quiet" role="alert">' + esc(S.error) + '<button class="odr-btn" data-act="retry">Try again</button></div>';
    else if (!S.entries.length) h += '<div class="odr-quiet">Nothing in the order diary for ' + esc(label(S.day).toLowerCase() === "today" ? "today" : label(S.day)) + ".</div>";
    else {
      var nextName = label(shift(S.day, 1)).toLowerCase() === "tomorrow" ? "tomorrow" : label(shift(S.day, 1));
      var open = S.entries.filter(outstanding), notYet = open.filter(function (e) { return !(S.carried || {})[e.id]; });
      if (notYet.length && S.day <= today()) h += '<div class="odr-carry"><span><b>' + notYet.length + "</b> still outstanding.</span>" + '<button class="odr-btn s" data-act="carry"' + (S.saving ? " disabled" : "") + ">Carry to " + esc(nextName) + "</button></div>";
      else if (open.length && S.day <= today()) h += '<div class="odr-carry" style="background:rgba(28,138,91,.10)"><span>' + open.length + (open.length === 1 ? " outstanding item is" : " outstanding items are") + " on " + esc(nextName) + "'s list.</span></div>";
      var groups = {}, order = [];
      S.entries.forEach(function (e) { var k = String(e.supplier || "").trim() || "No supplier"; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(e); });
      order.sort(function (x, y) { return x === "No supplier" ? 1 : y === "No supplier" ? -1 : x.localeCompare(y); });
      order.forEach(function (k) {
        var g = groups[k], left = g.filter(function (e) { return e.status === "pending"; }).length;
        h += '<div class="odr-lab"><span>' + esc(k) + "</span><b>" + (left ? left + " waiting" : "All in") + '</b></div><div class="odr-list">' + g.map(rowHtml).join("") + "</div>";
      });
    }
    if (S.adding || S.editing) h += '<datalist id="odr-items">' + S.items.map(function (i) { return '<option value="' + esc(i.item_name) + '">'; }).join("") + '</datalist><datalist id="odr-sups">' + supList().map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>"; // one copy for both forms
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">' + (S.entries.length ? "Tap an item to change it. " : "") + 'Printing the day\'s list is in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, fm = ae && m.contains(ae) && ae.name && ae.closest ? ae.closest("form") : null, sel = fm ? (fm.id ? "#" + fm.id + " " : "") + "[name=" + ae.name + "]" : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) again.focus(); }
    applyRefocus();
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("odreg");
        else if (act === "retry") load();
        else if (act === "prev" || act === "next" || act === "today") { S.day = act === "today" ? today() : shift(S.day, act === "next" ? 1 : -1); S.entries = []; S.adding = null; S.editing = null; S.edit = null; S.del = false; load(); }
        else if (act === "open") openEdit(Number(b.getAttribute("data-id")));
        else if (act === "edit-cancel") closeEdit();
        else if (act === "del") { keepEdit(); S.del = true; S.editErr = ""; paint(true); focusOn("#odr-edit [data-act=del-cancel]"); }
        else if (act === "del-cancel") { keepEdit(); S.del = false; S.editErr = ""; paint(true); focusOn("#odr-edit [data-act=del]"); }
        else if (act === "del-go") remove();
        else if (act === "add") { S.adding = { qty: "1" }; S.err = ""; paint(true); if (!S.items.length) loadItems(); setTimeout(function () { var f = m.querySelector("#odr-add [name=item_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); setTimeout(function () { var b = m.querySelector('[data-act="add"]'); if (b) b.focus(); }, 30); }
        else if (act === "carry") carry();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "odreg"); } catch (x) {} E.openClassic("order-diary"); }
      });
    });
    m.querySelectorAll("[data-st]").forEach(function (b) { b.addEventListener("click", function () { setStatus(Number(b.getAttribute("data-id")), b.getAttribute("data-st")); }); });
    // Escape closes the open form (what is typed in it is dropped, as with Cancel) and puts you back where you were.
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
    var fe = m.querySelector("#odr-edit"); if (fe) fe.addEventListener("submit", function (ev) { ev.preventDefault(); saveEdit(); });
    var f = m.querySelector("#odr-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      var it = f.querySelector("[name=item_name]"); if (it) it.addEventListener("blur", function () { if (!S.adding || !f.isConnected) return; keep(); var hit = S.items.find(function (i) { return String(i.item_name).toLowerCase() === String(S.adding.item_name || "").toLowerCase(); }); if (hit && hit.preferred_supplier && !S.adding.supplier && E.fillEmpty(f, { supplier: hit.preferred_supplier }).length) S.adding.supplier = hit.preferred_supplier; }); // in place: a redraw as the field is left with Tab lost the next field. Escape or Cancel removes the form while the field has focus: the blur that follows finds it closed (S.adding null) and does nothing
    }
  }
  // Suppliers already used (today's list, then the usual supplier of items ordered before), for the Supplier field.
  function supList() { var seen = {}, out = []; S.entries.map(function (e) { return e.supplier; }).concat(S.items.map(function (i) { return i.preferred_supplier; })).forEach(function (s) { s = String(s || "").trim(); if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = 1; out.push(s); } }); return out.slice(0, 60); }
  // After a one-tap save the list is redrawn: a keyboard user stays on that item (the same button, or the one now in its place).
  // Later redraws (the month list arriving) keep it there for a few seconds, unless focus has moved on by then.
  function refocus(sel) { S.refocus = { sel: sel, until: Date.now() + 4000 }; applyRefocus(); }
  function applyRefocus() { var r = S.refocus, a = document.activeElement; if (!r || Date.now() > r.until || !S.mount || (a && a !== document.body)) return; var b = null; r.sel.forEach(function (q) { if (!b && q) b = S.mount.querySelector(q); }); if (b && !b.disabled) b.focus(); }
  function focusOn(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }, 0); } // never from a field the person went to meanwhile
  function keepEdit() {
    var f = S.mount && S.mount.querySelector("#odr-edit"); if (!f || !S.edit) return;
    ["item_name", "qty", "supplier", "notes"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.edit[k] = String(el.value || ""); });
  }
  function editOf(e) { return { item_name: String(e.item_name || ""), qty: String(e.qty == null ? "" : e.qty), supplier: String(e.supplier || ""), notes: String(e.notes || "") }; }
  function editUnchanged() { var a = S.edit || {}, o = S.orig || {}; return ["item_name", "qty", "supplier", "notes"].every(function (k) { return String(a[k] || "").trim() === String(o[k] || "").trim(); }); }
  function openEdit(id) {
    if (S.editing === id) { keepEdit(); if (!editUnchanged()) { focusOn("#odr-edit [type=submit]"); return; } return closeEdit(); } // a second tap closes it, unless something was typed
    if (S.editing) { keepEdit(); if (!editUnchanged()) { focusOn("#odr-edit [type=submit]"); return; } } // another item: the open one has unsaved changes, keep them in view
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e) return;
    S.editing = id; S.edit = editOf(e); S.orig = editOf(e); S.editErr = ""; S.del = false;
    paint(true); if (!S.items.length) loadItems(); focusOn("#odr-edit [name=item_name]");
  }
  function closeEdit() { var id = S.editing; S.editing = null; S.edit = null; S.editErr = ""; S.del = false; paint(true); if (id) focusOn('[data-act=open][data-id="' + id + '"]'); }
  function keep() {
    var f = S.mount && S.mount.querySelector("#odr-add"); if (!f || !S.adding) return;
    ["item_name", "qty", "supplier", "notes"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }

  async function setStatus(id, status) {
    if (S.busy[id]) return;
    S.busy[id] = true; paint();
    try {
      var r = await E.apiFetch("/order-diary/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify({ status: status }) }); // only the status: the update keeps the rest
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy[id] = false; await load(); refocus(['[data-id="' + id + '"]']);
  }
  // Save changes: the classic Edit Item's call, PUT { item_name, qty, supplier, notes } (trimmed, qty a whole number).
  async function saveEdit() {
    if (S.editSaving || !S.editing) return;
    keepEdit();
    var id = S.editing, a = S.edit, n = a.item_name.trim(), qs = a.qty.trim();
    S.editErr = "";
    if (!n) S.editErr = "Write the item. Nothing was saved.";
    else if (!/^\d+$/.test(qs) || !(Number(qs) >= 1)) S.editErr = "Write how many (a whole number). Nothing was saved.";
    if (S.editErr) { paint(true); return focusOn("#odr-edit [name=" + (n ? "qty" : "item_name") + "]"); }
    if (editUnchanged()) return closeEdit(); // nothing to save
    var body = { item_name: n, qty: Number(qs), supplier: a.supplier.trim(), notes: a.notes.trim() };
    S.editSaving = true; paint(true);
    try {
      var r = await E.apiFetch("/order-diary/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast("Saved · " + n + " × " + body.qty, "success"); S.editing = null; S.edit = null; S.del = false;
    } catch (x) { S.editErr = E.saveFailText(x); S.editSaving = false; return paint(true); }
    S.editSaving = false; await load(); focusOn('[data-act=open][data-id="' + id + '"]');
  }
  // Delete (pharmacist only): the classic call, DELETE /order-diary/entries/:id, after one plain question. Focus goes to
  // the item that took its place in the list, else the one before, else Add an item.
  async function remove() {
    if (S.editSaving || !S.editing || !isAdmin()) return;
    var id = S.editing, btns = Array.prototype.slice.call(S.mount.querySelectorAll("[data-act=open]")), i = btns.findIndex(function (b) { return Number(b.getAttribute("data-id")) === id; });
    var near = (btns[i + 1] || btns[i - 1] || null), nearId = near ? near.getAttribute("data-id") : null, name = (S.orig || {}).item_name || "";
    S.editSaving = true; S.editErr = ""; paint(true);
    try {
      var r = await E.apiFetch("/order-diary/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Delete failed");
    } catch (x) {
      var gone = false; if (x && x.network) { try { gone = !(await list(S.day)).some(function (e) { return e.id === id; }); } catch (e2) { gone = false; } } // the answer was lost: look
      if (!gone) { S.editErr = E.saveFailText(x).replace(/^Not saved/, "Not deleted"); S.editSaving = false; return paint(true); }
    }
    E.toast("Deleted " + name, "success"); S.editing = null; S.edit = null; S.del = false; S.editSaving = false;
    await load(); focusOn(nearId ? '[data-act=open][data-id="' + nearId + '"]' : '[data-act="add"]');
  }
  async function carry() {
    if (S.saving) return;
    S.saving = true; paint();
    var to = shift(S.day, 1);
    try {
      var r = await E.apiFetch("/order-diary/carry-over", { method: "POST", body: JSON.stringify({ from_date: S.day, to_date: to }) }); // the server skips items it already carried
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not carry over");
      E.toast(r.carried ? r.carried + (r.carried === 1 ? " item" : " items") + " carried to " + label(to).toLowerCase() : "Already carried over", "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.saving = false; return load();
  }
  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    var qty = /^\d+$/.test(String(a.qty || "1")) ? Number(a.qty || 1) : NaN;
    if (!a.item_name) S.err = "Write the item. Nothing was saved.";
    else if (!(qty >= 1)) S.err = "Write how many (a whole number). Nothing was saved.";
    if (S.err) return paint(true);
    S.saving = true; paint(true);
    var body = { order_date: S.day, item_name: a.item_name, qty: qty, supplier: a.supplier || "", notes: a.notes || "" };
    try {
      await E.postOnce("/order-diary/entries", body, { list: function () { return list(S.day); },
        same: function (e) { return String(e.item_name).trim().toLowerCase() === body.item_name.toLowerCase() && Number(e.qty) === qty && String(e.supplier || "").trim().toLowerCase() === body.supplier.toLowerCase(); } });
      S.adding = null; E.toast("Added " + body.item_name + " × " + qty, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "odreg", title: "Order diary", order: 3, icon: "✎", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.day = today(); S.adding = null; S.err = ""; S.busy = {}; S.editing = null; S.edit = null; S.del = false; css(); paint(); return E.takeOpenForm("odreg", S.mount, load(), { btn: "[data-act=add]", form: "#odr-add" }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("odreg") < 0) E.UI2_DESTINATIONS.push("odreg");
  if (E.UI2_PARENT) E.UI2_PARENT.odreg = "stock";
})();
