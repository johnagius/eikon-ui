/* Deliveries, new layout: what goes out today (and anything overdue), then later; address, number to call, fridge and
   controlled-drug flags. On its way, Delivered (who took it), Not delivered (why; the third failed attempt returns it to
   the pharmacy, as in the classic screen), New delivery. The server replaces the whole record on every save
   (UPDATE-AUDIT.md: FULL-REPLACE), so each save sends the record as it came back with only the changed fields.
   Open a delivery (its name) to change it: it is read again from the server and sent whole, in the classic screen's
   body (validateAndBuild), with only what was changed here different. Delete is for the pharmacist only: the reason is
   written in the delivery's log first, so the audit's copy of the deleted delivery carries it. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, open: null, mode: "", saving: false, err: "",
    editing: null, edit: null, orig: null, efe: {}, editErr: "", editSaving: false, del: null, delReason: "" };
  // What the change form edits (items as one line of text; the rest as the server stores them).
  var EDIT = ["client_name", "phone", "delivery_address", "address_notes", "itemsText", "scheduled_date", "scheduled_time_slot", "cold_chain_required", "contains_controlled", "signature_required"];
  var METHODS = ["In-house Driver", "Courier", "Collection"], STATUSES = ["Scheduled", "Dispatched", "Out for Delivery", "Delivered", "Failed", "Returned", "Cancelled"]; // the classic screen's lists
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var ACTIVE = ["Scheduled", "Dispatched", "Out for Delivery"];
  var FIELDS = ["delivery_id", "order_date", "scheduled_date", "scheduled_time_slot", "actual_delivery_date", "actual_delivery_time", "client_name", "phone", "email",
    "delivery_address", "address_notes", "id_doc_ref", "delivery_method", "priority", "assigned_driver", "tracking_number", "status", "signature_required", "signature_obtained",
    "recipient_name", "proof_of_delivery", "delivery_attempts", "failure_reason", "contains_controlled", "cold_chain_required", "ticket_ref", "items", "delivery_log", "internal_notes"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
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
  function nowHm() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function daysUntil(s) { var p = String(s).split("-"); var t = new Date(); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function when(s) { var n = daysUntil(s); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; var p = s.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1]; }
  function arr(raw) { if (Array.isArray(raw)) return raw; try { var a = JSON.parse(String(raw || "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  // The next number is one above both the highest stored for the pharmacy (the list this screen has read, read again
  // just before the save) and this browser's counter, which the classic screen shares (modules.deliveries.js
  // nextDeliveryId, the same rule): a second device or a fresh browser never hands out a number in use.
  var SEQ = { max: 0, at: 0 };
  function seen(list) {
    (list || []).forEach(function (e) { var m = /^DEL-(\d+)$/i.exec(String((e && e.delivery_id) || "").trim()); if (m) SEQ.max = Math.max(SEQ.max, Number(m[1])); });
    if (list) SEQ.at = Date.now();
  }
  async function nextId() {
    try { var r = await E.apiFetch("/client-deliveries/entries", { method: "GET" }); if (r && r.ok) seen(r.entries); } catch (e) {}
    var n;
    try { var k = "eikon_deliveries_seq_v1"; n = Math.max(parseInt(localStorage.getItem(k), 10) || 0, SEQ.max) + 1; localStorage.setItem(k, String(n)); }
    catch (e) { if (!SEQ.at && !SEQ.max) return "DEL-" + String(Date.now()).slice(-5); n = SEQ.max + 1; }
    SEQ.max = n; // this tab never hands the same one out twice, even with no storage
    return "DEL-" + String(n).padStart(5, "0");
  }
  function author() { var u = E.state.user || {}; return u.full_name || u.display_name || ""; }
  function isAdmin() { var u = E.state && E.state.user; return !!(u && u.role === "admin"); } // the server lets staff delete too: this screen keeps it to the pharmacist
  function itemsText(items) { return items.map(function (i) { return (Number(i.qty) > 1 ? i.qty + "× " : "") + String(i.name || "").trim(); }).filter(function (x) { return x.trim(); }).join(", "); }
  // Items typed as one line ("2× Insulin pens, Panadol") back into the classic item list. An item already on the delivery
  // keeps its batch, expiry and schedule; a new one is what the classic item editor adds (qty 1 unless "n×", OTC).
  function itemsFrom(text, old) {
    var pool = old.slice();
    return String(text || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var m = /^(\d+)\s*[×x]\s*(.+)$/i.exec(s), qty = m ? Math.max(1, parseInt(m[1], 10) || 1) : 1, name = (m ? m[2] : s).trim();
      var at = -1; pool.some(function (o, i) { if (o && String(o.name || "").trim().toLowerCase() === name.toLowerCase()) { at = i; return true; } return false; });
      if (at >= 0) { var o = Object.assign({}, pool[at]); pool.splice(at, 1); o.qty = qty; return o; }
      return { name: name, qty: qty, schedule: "OTC", batch_ref: "", expiry: "" };
    });
  }
  // The classic screen's PUT body (openDeliveryModal's initial values through validateAndBuild), from a server row.
  // Where the classic edit loses what is stored (the ID document, a driver this browser does not list, the
  // controlled-drug flag it has no box for), the stored value is kept.
  function bodyOf(r) {
    var t = function (k) { return String(r[k] == null ? "" : r[k]).trim(); }, items = arr(r.items).filter(function (i) { return i && String(i.name || "").trim(); });
    var pr = Number(r.priority || 2); if (pr !== 1 && pr !== 2 && pr !== 3) pr = 2;
    var mt = t("delivery_method") || "In-house Driver"; if (METHODS.indexOf(mt) < 0) mt = "In-house Driver";
    var st = t("status") || "Scheduled"; if (STATUSES.indexOf(st) < 0) st = "Scheduled";
    return { delivery_id: t("delivery_id"), order_date: isYmd(r.order_date) ? r.order_date : today(), scheduled_date: isYmd(r.scheduled_date) ? r.scheduled_date : "", scheduled_time_slot: t("scheduled_time_slot"),
      actual_delivery_date: isYmd(r.actual_delivery_date) ? r.actual_delivery_date : "", actual_delivery_time: t("actual_delivery_time"), client_name: t("client_name"), phone: t("phone"), email: t("email"),
      delivery_address: t("delivery_address"), address_notes: t("address_notes"), id_doc_ref: t("id_doc_ref"), delivery_method: mt, priority: pr, assigned_driver: t("assigned_driver"), tracking_number: t("tracking_number"),
      status: st, signature_required: !!Number(r.signature_required), signature_obtained: !!Number(r.signature_obtained), recipient_name: t("recipient_name"), proof_of_delivery: t("proof_of_delivery"),
      delivery_attempts: Number(r.delivery_attempts || 0), failure_reason: t("failure_reason"), contains_controlled: !!Number(r.contains_controlled) || items.some(function (i) { return i.schedule === "CD"; }),
      cold_chain_required: !!Number(r.cold_chain_required), ticket_ref: t("ticket_ref"), items: JSON.stringify(items), delivery_log: typeof r.delivery_log === "string" ? r.delivery_log : JSON.stringify(arr(r.delivery_log)), internal_notes: t("internal_notes") };
  }
  // The form's values, from a server row.
  function editOf(r) {
    var items = arr(r.items);
    return { client_name: String(r.client_name || ""), phone: String(r.phone || ""), delivery_address: String(r.delivery_address || ""), address_notes: String(r.address_notes || ""), itemsText: itemsText(items),
      scheduled_date: isYmd(r.scheduled_date) ? r.scheduled_date : "", scheduled_time_slot: String(r.scheduled_time_slot || ""), cold_chain_required: Number(r.cold_chain_required) ? 1 : 0,
      contains_controlled: Number(r.contains_controlled) || items.some(function (i) { return i && i.schedule === "CD"; }) ? 1 : 0, signature_required: Number(r.signature_required) ? 1 : 0 };
  }
  async function reread(id) { // there is no single-delivery read: the list holds them all
    var r = await E.apiFetch("/client-deliveries/entries", { method: "GET" });
    seen(r && r.entries);
    return ((r && r.entries) || []).find(function (x) { return x.id === id; }) || null;
  }
  // A change whose answer was lost counts as saved only when the delivery now holds what was sent.
  async function landed(id, body) {
    try { var n = await reread(id); if (!n) return false; var b2 = bodyOf(n);
      return Object.keys(body).every(function (k) { return String(b2[k]) === String(body[k]); });
    } catch (e) { return false; }
  }

  function css() {
    if (document.getElementById("eikon-dlvreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-dlvreg-css";
    st.textContent =
      ".dlv{max-width:880px;margin:0 auto}" +
      ".dlv-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".dlv-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".dlv h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.dlv-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".dlv-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".dlv-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.dlv-btn.d{color:var(--danger)}.dlv-btn:disabled{opacity:.55;cursor:default}" +
      ".dlv-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.dlv-lab b{color:var(--text)}" +
      ".dlv-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:13px 16px;margin-bottom:10px;border-left:3px solid var(--border)}.dlv-card.late{border-left-color:var(--danger)}.dlv-card.road{border-left-color:var(--accent)}" +
      ".dlv-card .h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.dlv-card b{font-size:15.5px;font-weight:600}.dlv-card .h span{font-size:12px;color:var(--muted)}" +
      ".dlv-card .ad{font-size:14.5px;margin-top:4px}.dlv-card .ad small{display:block;color:var(--muted);font-size:12.5px}.dlv-card .s{font-size:12.5px;color:var(--muted);margin-top:4px}.dlv-card .s a{color:var(--accent);text-decoration:none}" +
      ".dlv-card .fl{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.dlv-card .a{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}" +
      ".dlv-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--muted)}.dlv-pill.late{background:rgba(215,38,28,.12);color:var(--danger)}" +
      ".dlv-pill.cold{background:rgba(0,122,255,.12);color:var(--info,#0A66C2)}.dlv-pill.cd{background:rgba(215,38,28,.12);color:var(--danger)}.dlv-pill.road{background:rgba(16,140,100,.14);color:var(--accent)}" +
      ".dlv-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}.dlv-in{margin-top:10px;border-radius:10px;background:rgba(118,118,128,.07)}" +
      ".dlv-form label,.dlv-in label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.dlv-form label:first-child,.dlv-in label:first-child{border-top:0}" +
      ".dlv-form label>span,.dlv-in label>span{flex:0 0 96px;font-size:15px}.dlv-form input:not([type=checkbox]),.dlv-in input:not([type=checkbox]){flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".dlv-form input[type=checkbox],.dlv-in input[type=checkbox]{width:20px;height:20px;accent-color:var(--accent);margin-left:auto}" +
      ".dlv-form .acts,.dlv-in .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}" +
      ".dlv-err{color:var(--danger);font-size:13px;padding:2px 14px 4px}.dlv-warn{font-size:13px;color:var(--warn,#A06A0E);padding:4px 14px}" +
      ".dlv-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      // Quality pass (2026-11-03): sentence-case headings, errors beside their fields, a skeleton while loading, 44 px targets.
      ".dlv-lab{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none}.dlv-lab b,.dlv-card .h span{font-variant-numeric:tabular-nums}" +
      ".dlv-form label,.dlv-in label{flex-wrap:wrap}.dlv-ferr{flex-basis:100%;margin:-6px 0 8px 108px;color:var(--danger);font-size:13px;font-weight:500}" +
      ".dlv-skel{display:block;height:120px;margin-bottom:10px;border-radius:12px;border:1px solid var(--border);background:linear-gradient(90deg,rgba(118,118,128,.06),rgba(118,118,128,.14),rgba(118,118,128,.06));background-size:200% 100%;animation:dlvsk 1.2s linear infinite}" +
      "@keyframes dlvsk{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.dlv-skel{animation:none}}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .dlv-ferr{color:#FF7A72}}" + // 5:1 on the tinted row being typed in
      // Changing a delivery (b4-5): the name opens it, as in Orders and Questions.
      ".dlv-name{border:0;background:none;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer;min-height:24px}.dlv-name:hover b,.dlv-name:focus-visible b{text-decoration:underline}" +
      ".dlv-in .acts.l{justify-content:space-between}.dlv-btn.dd{background:#B42318;border-color:#B42318;color:#fff}.dlv-meta{font-size:12.5px;color:var(--muted);padding:6px 14px 2px}" +
      ".dlv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (max-width:600px){.dlv{padding:4px 16px 0}.dlv h1{font-size:32px}.dlv-card .a{display:grid;grid-auto-flow:column;grid-auto-columns:1fr}.dlv-card .a .dlv-btn{padding:0 6px}" +
      ".dlv-btn{height:44px;border-radius:22px}.dlv-ferr{margin-left:0}.dlv-form label>span,.dlv-in label>span{flex-basis:96px}.dlv-form input[type=checkbox],.dlv-in input[type=checkbox]{width:24px;height:24px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/client-deliveries/entries", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load deliveries");
      seen(r.entries);
      S.entries = (r.entries || []).filter(function (e) { return ACTIVE.indexOf(e.status) >= 0; })
        .sort(function (a, b) { return String(a.scheduled_date || a.order_date || "").localeCompare(String(b.scheduled_date || b.order_date || "")) || (Number(a.priority) || 2) - (Number(b.priority) || 2) || a.id - b.id; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load deliveries"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function day(e) { return isYmd(e.scheduled_date) ? e.scheduled_date : isYmd(e.order_date) ? e.order_date : today(); }

  function cardHtml(e) {
    var n = daysUntil(day(e)), road = e.status === "Out for Delivery", items = arr(e.items);
    var cls = n < 0 ? "late" : road ? "road" : "";
    var sub = []; if (e.phone) sub.push('<a href="tel:' + esc(String(e.phone).replace(/\s+/g, "")) + '">' + esc(e.phone) + "</a>");
    if (e.scheduled_time_slot) sub.push(esc(e.scheduled_time_slot)); if (e.assigned_driver) sub.push(esc(e.assigned_driver)); if (Number(e.delivery_attempts) > 0) sub.push("Attempt " + (Number(e.delivery_attempts) + 1));
    var what = items.map(function (i) { return (Number(i.qty) > 1 ? i.qty + "× " : "") + (i.name || ""); }).filter(Boolean).join(", ");
    var fl = [];
    if (road) fl.push('<span class="dlv-pill road">On its way</span>');
    if (n < 0) fl.push('<span class="dlv-pill late">Was due ' + esc(when(day(e))) + "</span>");
    if (Number(e.cold_chain_required)) fl.push('<span class="dlv-pill cold">Fridge</span>');
    if (Number(e.contains_controlled) || items.some(function (i) { return i && i.schedule === "CD"; })) fl.push('<span class="dlv-pill cd">Controlled drug</span>');
    if (Number(e.signature_required)) fl.push('<span class="dlv-pill">Signature</span>');
    var maps = "https://maps.google.com/?q=" + encodeURIComponent(String(e.delivery_address || ""));
    var h = '<div class="dlv-card ' + cls + '"><div class="h"><button type="button" class="dlv-name" data-act="open" data-id="' + e.id + '" aria-expanded="' + (S.editing === e.id ? "true" : "false") + '" aria-label="' + esc("Open the delivery for " + e.client_name) + '"><b>' + esc(e.client_name) + "</b></button><span>" + esc(e.delivery_id || "") + "</span></div>" +
      '<div class="ad"><a href="' + esc(maps) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + esc(e.delivery_address) + "</a>" + (e.address_notes ? "<small>" + esc(e.address_notes) + "</small>" : "") + "</div>" +
      (what ? '<div class="s">' + esc(what) + "</div>" : "") + '<div class="s">' + sub.join(" · ") + "</div>" + (fl.length ? '<div class="fl">' + fl.join("") + "</div>" : "");
    if (S.editing === e.id) {
      h += editHtml(e);
    } else if (S.open === e.id && S.mode === "done") {
      h += '<form class="dlv-in" id="dlv-done" data-id="' + e.id + '" autocomplete="off" aria-label="' + esc("Delivered to " + e.client_name) + '"><label><span>Received by</span><input name="recipient" value="' + esc(S.draft != null ? S.draft : e.client_name || "") + '"' + (S.err ? ' aria-invalid="true" aria-describedby="dlv-in-err"' : "") + "></label>" +
        (Number(e.signature_required) ? '<label><span>Signed</span><input type="checkbox" name="signed"' + (S.signed ? " checked" : "") + "></label>" : "") +
        (S.err ? '<div class="dlv-err" id="dlv-in-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="dlv-btn" data-act="cancel">Cancel</button><button type="submit" class="dlv-btn p"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Delivered") + "</button></div></form>";
    } else if (S.open === e.id && S.mode === "fail") {
      var last = Number(e.delivery_attempts || 0) + 1 >= 3;
      h += '<form class="dlv-in" id="dlv-fail" data-id="' + e.id + '" autocomplete="off" aria-label="' + esc("Not delivered to " + e.client_name) + '"><label><span>Why</span><input name="reason" placeholder="e.g. Not home, wrong address" value="' + esc(S.draft || "") + '"' + (S.err ? ' aria-invalid="true" aria-describedby="dlv-in-err"' : "") + "></label>" +
        (last ? '<div class="dlv-warn">Third attempt: it comes back to the pharmacy.</div>' : "") + (S.err ? '<div class="dlv-err" id="dlv-in-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="dlv-btn" data-act="cancel">Cancel</button><button type="submit" class="dlv-btn d"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Not delivered") + "</button></div></form>";
    } else {
      var who = String(e.client_name || "");
      h += '<div class="a"><button class="dlv-btn d" data-act="fail" data-id="' + e.id + '" aria-label="' + esc("Not delivered: " + who) + '">Not delivered</button>' +
        (road ? "" : '<button class="dlv-btn" data-act="road" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ' aria-label="' + esc("On its way: " + who) + '">' + (S.busy[e.id] ? "Saving…" : "On its way") + "</button>") +
        '<button class="dlv-btn p" data-act="done" data-id="' + e.id + '" aria-label="' + esc("Delivered: " + who) + '">Delivered</button></div>';
    }
    return h + "</div>";
  }

  // The open delivery: the same fields as a new one, filled in; Save changes sends it whole (bodyOf), Delete… is the pharmacist's.
  function editHtml(e) {
    var a = S.edit || {}, fe = S.efe || {};
    var inv = function (k) { return fe[k] ? ' aria-invalid="true" aria-describedby="dlv-ee-' + k + '"' : ""; }, ferr = function (k) { return fe[k] ? '<small class="dlv-ferr" id="dlv-ee-' + k + '">' + esc(fe[k]) + "</small>" : ""; };
    var fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '"' + (extra || "") + inv(k) + ">" + ferr(k) + "</label>"; };
    var box = function (k, label) { return '<label><span>' + label + '</span><input type="checkbox" name="' + k + '"' + (Number(a[k]) ? " checked" : "") + "></label>"; };
    var h = '<form class="dlv-in dlv-ed" id="dlv-edit" data-id="' + e.id + '" autocomplete="off" aria-label="' + esc("Change the delivery for " + e.client_name) + '">' +
      fld("client_name", "Customer", ' placeholder="Name and surname"') + fld("phone", "Phone", ' type="tel" inputmode="tel" placeholder="For the driver"') +
      fld("delivery_address", "Address", ' placeholder="Street, number, town"') + fld("address_notes", "Directions", ' placeholder="Optional, e.g. blue door, 2nd floor"') +
      fld("itemsText", "Items", ' placeholder="Optional, e.g. 2× Augmentin 625, Panadol"') + fld("scheduled_date", "Deliver on", ' type="date"') + fld("scheduled_time_slot", "Time", ' placeholder="Optional, e.g. Afternoon"') +
      box("cold_chain_required", "Fridge item") + box("contains_controlled", "Controlled drug") + box("signature_required", "Needs signature") +
      (S.editErr ? '<div class="dlv-err" role="alert">' + esc(S.editErr) + "</div>" : "");
    if (S.del === e.id) {
      h += '<label><span>Why delete</span><input name="del_reason" value="' + esc(S.delReason || "") + '" placeholder="e.g. Entered twice"></label>' +
        '<div class="dlv-meta">This removes the delivery for good. The reason is written in its log first, so it stays in the audit.</div>' +
        '<div class="acts"><button type="button" class="dlv-btn" data-act="del-cancel">Keep it</button><button type="button" class="dlv-btn dd" data-act="del-go"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Deleting…" : "Delete delivery") + "</button></div>";
    } else {
      h += '<div class="acts l">' + (isAdmin() ? '<button type="button" class="dlv-btn d" data-act="del">Delete…</button>' : "<span></span>") +
        '<span style="display:flex;gap:8px"><button type="button" class="dlv-btn" data-act="edit-cancel">Close</button><button type="submit" class="dlv-btn p"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Saving…" : "Save changes") + "</button></span></div>";
    }
    return h + "</form>";
  }

  // Every delivery ordered in a month (any month, done or not), and the classic printout of the list.
  var HIST = { dep: function () { return S.loading ? undefined : S.entries; }, title: "By month", label: "Deliveries ordered", nowText: "No delivery ordered this month yet.",
    active: function () { return E.state.activeModuleId === "dlvreg"; }, paint: function () { E.repaintKeepingFocus(S.mount, paint); }, // the month list arriving keeps focus where it is
    fetch: async function (ym) { var r = await E.apiFetch("/client-deliveries/entries", { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load deliveries"); return (r.entries || []).filter(function (e) { return String(e.order_date || "").slice(0, 7) === ym; }).sort(function (a, b) { return String(b.order_date).localeCompare(String(a.order_date)) || b.id - a.id; }); },
    row: function (e) { return { t: (e.client_name || "") + (e.delivery_id ? " · " + e.delivery_id : ""), s: [E.months.dmy(e.order_date), e.scheduled_date ? "due " + E.months.dmy(e.scheduled_date) : "", e.delivery_address].filter(Boolean).join(" · "), r: e.status || "" }; },
    print: function (ym, rows) {
      E.months.print({ register: "Deliveries", month: ym, landscape: true, sections: [{ cols: ["Del #", "Order Date", "Scheduled", "Client", "Phone", "Method", "Driver", "Status", "Address", "Items"],
        rows: rows.slice().reverse().map(function (r) { return [r.delivery_id || "", E.months.dmy(r.order_date), E.months.dmy(r.scheduled_date) + (r.scheduled_time_slot ? " " + r.scheduled_time_slot : ""), r.client_name || "", r.phone || "", r.delivery_method || "", r.assigned_driver || "", r.status || "", r.delivery_address || "",
          arr(r.items).map(function (i) { return (i.qty || 1) + "× " + (i.name || ""); }).join(", ")]; }) }] });
    } };
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "dlvreg") return; // left before a reply came back: do not draw over the next screen
    keep(); // what is typed survives a redraw
    var ae = document.activeElement, backTo = ae && m.contains(ae) && ae.closest && ae.closest("#dlv-edit") && ae.name ? ae.name : "";
    var h = '<div class="dlv"><button class="dlv-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("dlvreg") : "‹ Customers") + "</button>" +
      '<div class="dlv-top"><div><h1>Deliveries</h1><p class="dlv-sub">What goes out today, and what is still on the road.</p></div>' + (S.adding ? "" : '<button class="dlv-btn p" data-act="add">New delivery</button>') + "</div>";
    if (S.adding) {
      var a = S.adding, fe = S.fe || {};
      var inv = function (k) { return fe[k] ? ' aria-invalid="true" aria-describedby="dlv-e-' + k + '"' : ""; }, ferr = function (k) { return fe[k] ? '<small class="dlv-ferr" id="dlv-e-' + k + '">' + esc(fe[k]) + "</small>" : ""; };
      var fld = function (k, label, val, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(val || "") + '"' + (extra || "") + inv(k) + ">" + ferr(k) + "</label>"; };
      h += '<form class="dlv-form" id="dlv-add" autocomplete="off" aria-label="New delivery">' + carryLine() + fld("client_name", "Customer", a.client_name, ' placeholder="Name and surname" autocapitalize="words"') +
        // b4-10: the ID card, as on Orders (optional). It is the delivery's own id_doc_ref, the field the classic form sends; sent only when typed
        fld("id_doc_ref", "ID card", a.id_doc_ref, ' placeholder="Optional, e.g. for a controlled drug" autocapitalize="characters"') +
        fld("phone", "Phone", a.phone, ' type="tel" inputmode="tel" placeholder="For the driver"') +
        fld("delivery_address", "Address", a.delivery_address, ' placeholder="Street, number, town"') +
        fld("address_notes", "Directions", a.address_notes, ' placeholder="Optional, e.g. blue door, 2nd floor"') +
        fld("items", "Items", a.itemsText, ' placeholder="Optional, e.g. Augmentin 625, Panadol"') +
        fld("scheduled_date", "Deliver on", a.scheduled_date || today(), ' type="date"') + dayChips("scheduled_date", a.scheduled_date || today(), "Deliver on") +
        fld("scheduled_time_slot", "Time", a.scheduled_time_slot, ' placeholder="Optional, e.g. Afternoon"') +
        '<label><span>Fridge item</span><input type="checkbox" name="cold_chain_required"' + (a.cold_chain_required ? " checked" : "") + "></label>" +
        '<label><span>Controlled drug</span><input type="checkbox" name="contains_controlled"' + (a.contains_controlled ? " checked" : "") + "></label>" +
        '<label><span>Needs signature</span><input type="checkbox" name="signature_required"' + (a.signature_required ? " checked" : "") + "></label>" +
        (S.err && !S.open ? '<div class="dlv-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="dlv-btn" data-act="add-cancel">Cancel</button><button type="submit" class="dlv-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save delivery") + "</button></div></form>";
    }
    if (S.loading && !S.entries.length) h += '<div aria-busy="true" style="margin-top:16px"><span class="dlv-sr" role="status">Opening deliveries</span><i class="dlv-skel"></i><i class="dlv-skel"></i></div>';
    else if (S.error) h += '<div class="dlv-quiet" role="alert">' + esc(S.error) + ' <button type="button" class="dlv-btn" data-act="retry" style="margin-left:6px">Try again</button></div>';
    else if (!S.entries.length) h += '<div class="dlv-quiet">Nothing to deliver. When a customer wants something brought to them, press New delivery.</div>';
    else if (S.who && !S.entries.filter(forWho).length) h += whoLine() + '<div class="dlv-quiet">No delivery on its way for ' + esc(S.who.name) + '. Their past deliveries are under By month.</div>';
    else {
      var shown = S.who ? S.entries.filter(forWho) : S.entries; if (S.who) h += whoLine();
      var now = shown.filter(function (e) { return daysUntil(day(e)) <= 0; }), later = shown.filter(function (e) { return daysUntil(day(e)) > 0; });
      var over = now.filter(function (e) { return daysUntil(day(e)) < 0; }).length;
      if (now.length) h += '<div class="dlv-lab">Today <b>' + now.length + "</b>" + (over ? '<span style="color:var(--danger)">· ' + over + " overdue</span>" : "") + "</div>" + now.map(cardHtml).join("");
      if (later.length) h += '<div class="dlv-lab">Later <b>' + later.length + "</b></div>" + later.map(cardHtml).join("");
    }
    h += E.months.history("dlvreg", HIST);
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Drivers and item batches are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    E.months.wireHistory(m, "dlvreg");
    if (backTo) { var again = m.querySelector("#dlv-edit [name=" + backTo + "]"); if (again) again.focus(); }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("dlvreg") : "#customers";
        else if (a === "who-all") { S.who = null; paint(); focusOn(".dlv-top [data-act=add]"); }
        else if (a === "add") { S.carry = null; S.adding = {}; S.err = ""; S.fe = {}; paint(); E.focusSoon(function () { return m.querySelector("#dlv-add [name=client_name]"); }, 30); }
        else if (a === "add-cancel") closeAdd();
        else if (a === "open") openEdit(id);
        else if (a === "edit-cancel") closeEdit();
        else if (a === "del") { keep(); S.del = S.editing; S.delReason = ""; S.editErr = ""; paint(); focusOn("#dlv-edit [name=del_reason]"); }
        else if (a === "del-cancel") { keep(); S.del = null; S.editErr = ""; paint(); focusOn("#dlv-edit [data-act=del]"); }
        else if (a === "del-go") remove();
        else if (a === "done" || a === "fail") { S.editing = null; S.edit = null; S.del = null; S.open = id; S.mode = a; S.draft = null; S.signed = false; S.err = ""; paint(); setTimeout(function () { var f = m.querySelector(".dlv-in input"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) { f.focus(); try { f.select(); } catch (x) {} } }, 30); }
        else if (a === "cancel") closeIn();
        else if (a === "retry") load();
        else if (a === "road") { var e = find(id); if (e) save(e, { status: "Out for Delivery" }, "Out for delivery", "On its way.").then(function () { focusOn('[data-act=done][data-id="' + id + '"]'); }); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "dlvreg"); } catch (x) {} E.openClassic("deliveries"); }
      });
    });
    var fd = m.querySelector("#dlv-done"); if (fd) fd.addEventListener("submit", function (ev) { ev.preventDefault(); delivered(fd); });
    var ff = m.querySelector("#dlv-fail"); if (ff) ff.addEventListener("submit", function (ev) { ev.preventDefault(); failed(ff); });
    [fd, ff].forEach(function (fi) { if (fi) fi.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); closeIn(); } }); }); // one short line: Escape is Cancel
    var fx = m.querySelector("#dlv-edit");
    if (fx) {
      fx.addEventListener("submit", function (ev) { ev.preventDefault(); if (S.del) return; saveEdit(); });
      fx.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.editSaving) { keep(); if (S.del) { ev.preventDefault(); S.del = null; S.editErr = ""; paint(); focusOn("#dlv-edit [data-act=del]"); } else if (editUnchanged()) { ev.preventDefault(); closeEdit(); } } }); // Escape closes it unless something was changed
      fx.addEventListener("input", function (ev) { var el = ev.target; if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); if (S.efe) delete S.efe[el.name]; var s0 = el.parentNode && el.parentNode.querySelector(".dlv-ferr"); if (s0) s0.remove(); } });
    }
    var fa = m.querySelector("#dlv-add");
    if (fa) {
      fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(fa); });
      wireDays(fa);
      fa.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !document.querySelector(".epp-list:not([hidden])")) { keep(); var a0 = S.adding || {}; if (!["client_name", "id_doc_ref", "phone", "delivery_address", "address_notes", "itemsText", "scheduled_time_slot"].some(function (k) { return String(a0[k] || "").trim(); }) || (S.carry && onlyCarried(a0))) { ev.preventDefault(); closeAdd(); } } }); // Escape closes an empty form; typing is never thrown away
      fa.addEventListener("input", function (ev) { var el = ev.target; if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); if (S.fe) delete S.fe[el.name]; var s0 = el.parentNode && el.parentNode.querySelector(".dlv-ferr"); if (s0) s0.remove(); } });
    }
    if (fa && E.personPick) E.personPick.attach({ key: "dlvreg", form: fa, fields: { id: "id_doc_ref", name: "client_name", phone: "phone", address: "delivery_address" },
      local: function () { return S.entries.map(function (e) { return { name: e.client_name, phone: e.phone, address: e.delivery_address, date: String(e.order_date || "").slice(0, 10), from: "delivery" }; }); } });
  }

  function find(id) { return S.entries.find(function (x) { return x.id === id; }); }
  function focusOn(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }); } // never away from a field the person went to meanwhile
  function closeAdd() { var h = S.carry; S.carry = null; S.adding = null; S.err = ""; S.fe = {}; if (h && E.customerReturn && E.customerReturn(h)) return; paint(); focusOn(".dlv-top [data-act=add]"); } // opened from a customer's page: back to that person
  // Opened from a customer's page (modules.customers.js, BACKLOG4 item 1): who it is for stays in sight at the top, the
  // person is filled into the empty fields only, and focus goes to the first required field still empty.
  var CARRY = { client_name: "name", id_doc_ref: "id_card", phone: "phone", delivery_address: "address" }, NEEDED = ["client_name", "phone", "delivery_address"];
  function carryLine() { var p = S.carry && S.carry.person; return p ? '<div class="dlv-meta" style="font-size:12.5px;color:var(--muted);padding:10px 16px 8px">From Customers: <b>' + esc(p.name) + "</b>" + (p.id_card ? " · ID card " + esc(p.id_card) : "") + "</div>" : ""; }
  function fillCarry() {
    var f = S.mount && S.mount.querySelector("#dlv-add"), p = S.carry && S.carry.person; if (!f || !p) return;
    var want = {}; Object.keys(CARRY).forEach(function (k) { want[k] = p[CARRY[k]]; });
    E.fillEmpty(f, want).forEach(function (k) { S.adding[k] = want[k]; });
    var go = function () { if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#dlv-add")) return; var g = S.mount && S.mount.querySelector("#dlv-add"); if (!g) return; var el = NEEDED.map(function (k) { return g.querySelector("[name=" + k + "]"); }).filter(function (x) { return x && !String(x.value || "").trim(); })[0] || g.querySelector("[name=items]"); if (el) el.focus(); };
    go(); setTimeout(go, 30); // and again after the screen settles, unless the person is already in the form
  }
  function onlyCarried(a0) { var p = (S.carry && S.carry.person) || {}; return ["client_name", "id_doc_ref", "phone", "delivery_address", "address_notes", "itemsText", "scheduled_time_slot"].every(function (k) { var v = String(a0[k] || "").trim(); return !v || (CARRY[k] && v === String(p[CARRY[k]] || "").trim()); }); }
  // From the count of a customer's deliveries: only theirs (same name, or same phone), until Show all.
  function low(s) { return String(s || "").trim().toLowerCase(); }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function forWho(e) { return !S.who || low(e.client_name) === low(S.who.name) || (digits(S.who.phone).length >= 6 && digits(e.phone) === digits(S.who.phone)); }
  function whoLine() { return '<div class="dlv-lab" role="status" style="align-items:center">Deliveries for ' + esc(S.who.name) + ' <button type="button" class="dlv-btn" data-act="who-all" style="margin-left:auto">Show all</button></div>'; }
  function closeIn() { var id = S.open, md = S.mode; S.open = null; S.mode = ""; S.err = ""; S.draft = null; paint(); if (id) focusOn('[data-act=' + md + '][data-id="' + id + '"]'); }
  function keep() { // the new delivery, and who took one / why not, survive any redraw
    var f = S.mount && S.mount.querySelector("#dlv-add");
    if (f && S.adding && !S.saving) {
      ["client_name", "id_doc_ref", "phone", "delivery_address", "address_notes", "scheduled_date", "scheduled_time_slot"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || ""); });
      var it = f.querySelector("[name=items]"); if (it) S.adding.itemsText = String(it.value || "");
      ["cold_chain_required", "contains_controlled", "signature_required"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = el.checked ? 1 : 0; });
    }
    var fx = S.mount && S.mount.querySelector("#dlv-edit");
    if (fx && S.edit && !S.editSaving) {
      EDIT.forEach(function (k) { var el = fx.querySelector("[name=" + k + "]"); if (el) S.edit[k] = el.type === "checkbox" ? (el.checked ? 1 : 0) : String(el.value || ""); });
      var dr = fx.querySelector("[name=del_reason]"); if (dr) S.delReason = String(dr.value || "");
    }
    var fi = S.mount && S.mount.querySelector(".dlv-in"); if (fi && fi.id === "dlv-" + S.mode && Number(fi.getAttribute("data-id")) === S.open) { var inp = fi.querySelector("[name=recipient],[name=reason]"); if (inp) S.draft = String(inp.value || ""); var sg = fi.querySelector("[name=signed]"); if (sg) S.signed = !!sg.checked; }
  }

  // The whole record as the server gave it, with only `changes` different, and a line in the delivery's own log.
  async function save(e, changes, okText, logText) {
    if (S.busy[e.id]) return false;
    var body = {}; FIELDS.forEach(function (k) { body[k] = e[k] == null ? "" : e[k]; });
    Object.keys(changes).forEach(function (k) { body[k] = changes[k]; });
    if (logText) body.delivery_log = JSON.stringify(arr(e.delivery_log).concat([{ ts: new Date().toISOString(), author: author(), text: logText }]));
    S.busy[e.id] = true; paint();
    var ok = false;
    try {
      var r = await E.apiFetch("/client-deliveries/entries/" + encodeURIComponent(String(e.id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      ok = true; if (okText) E.toast(okText, "success");
    } catch (x) { S.err = E.saveFailText(x); E.toast(S.err, "error"); }
    var order = S.entries.map(function (x) { return x.id; }), at = order.indexOf(e.id);
    S.busy[e.id] = false; if (ok) { S.open = null; S.mode = ""; S.err = ""; S.draft = null; } await load();
    if (ok && changes.status && changes.status !== "Out for Delivery") { var nx = S.entries[Math.min(at, S.entries.length - 1)]; focusOn(nx ? '[data-act=done][data-id="' + nx.id + '"]' : ".dlv-top [data-act=add]"); } // gone from the list: on to the next one
    else if (!ok) focusOn(".dlv-in input");
    return ok;
  }
  function delivered(f) {
    var e = find(S.open); if (!e) return;
    var who = String((f.querySelector("[name=recipient]") || {}).value || "").trim(); S.draft = who;
    var signed = !!(f.querySelector("[name=signed]") || {}).checked;
    if (!who) { S.err = "Write who took it. Nothing was saved."; paint(); focusOn("#dlv-done [name=recipient]"); return; }
    save(e, { status: "Delivered", actual_delivery_date: today(), actual_delivery_time: nowHm(), recipient_name: who, signature_obtained: signed ? 1 : Number(e.signature_obtained) ? 1 : 0,
      delivery_attempts: Math.max(1, Number(e.delivery_attempts || 0)) }, e.client_name + "'s delivery is done", "Marked as Delivered. Received by " + who + (signed ? ", signed." : "."));
  }
  function failed(f) {
    var e = find(S.open); if (!e) return;
    var why = String((f.querySelector("[name=reason]") || {}).value || "").trim(); S.draft = why;
    if (!why) { S.err = "Write why it could not be delivered. Nothing was saved."; paint(); focusOn("#dlv-fail [name=reason]"); return; }
    var n = Number(e.delivery_attempts || 0) + 1, back = n >= 3; // same rule as the classic screen
    save(e, { status: back ? "Returned" : "Failed", delivery_attempts: n, failure_reason: why }, back ? "Back to the pharmacy" : "Not delivered, noted", "Attempt " + n + " — Failed: " + why);
  }

  function editUnchanged() { var a = S.edit || {}, o = S.orig || {}; return EDIT.every(function (k) { return String(a[k] == null ? "" : a[k]).trim() === String(o[k] == null ? "" : o[k]).trim(); }); }
  function closeEdit() { var id = S.editing; S.editing = null; S.edit = null; S.orig = null; S.editErr = ""; S.efe = {}; S.del = null; paint(); if (id) focusOn('[data-act=open][data-id="' + id + '"]'); }
  function openEdit(id) {
    if (S.editing === id) { keep(); if (!editUnchanged()) return focusOn("#dlv-edit [type=submit]"); return closeEdit(); } // a second tap closes it, unless something was changed
    var e = find(id); if (!e) return;
    S.open = null; S.mode = ""; S.err = ""; S.editing = id; S.edit = editOf(e); S.orig = editOf(e); S.editErr = ""; S.efe = {}; S.del = null; S.delReason = "";
    paint(); focusOn("#dlv-edit [name=client_name]");
  }

  // Save the open delivery: read it again, change only what was edited here, send it whole (the classic body).
  async function saveEdit() {
    if (S.editSaving || !S.editing) return;
    keep();
    var id = S.editing, a = S.edit, o = S.orig || {}, t = function (k) { return String(a[k] == null ? "" : a[k]).trim(); };
    var fe = {};
    if (!t("client_name")) fe.client_name = "Write the customer's name.";
    if (!t("phone")) fe.phone = "Write a phone number for the driver.";
    if (!t("delivery_address")) fe.delivery_address = "Write the address.";
    if (t("scheduled_date") && !isYmd(t("scheduled_date"))) fe.scheduled_date = "Choose the day to deliver, or leave it empty.";
    S.efe = fe; S.editErr = Object.keys(fe).map(function (k) { return fe[k]; }).join(" ") + (Object.keys(fe).length ? " Nothing was saved." : "");
    if (S.editErr) { paint(); focusOn("#dlv-edit [name=" + Object.keys(fe)[0] + "]"); return; }
    S.editSaving = true; paint();
    var body = null;
    try {
      var fresh = await reread(id);
      if (!fresh) throw new Error("This delivery is no longer in the list (delivered or deleted elsewhere?)");
      var u = Object.assign({}, fresh), ch = function (k) { return t(k) !== String(o[k] == null ? "" : o[k]).trim(); }; // only what changed here
      ["client_name", "phone", "delivery_address", "address_notes", "scheduled_date", "scheduled_time_slot"].forEach(function (k) { if (ch(k)) u[k] = t(k); });
      ["cold_chain_required", "contains_controlled", "signature_required"].forEach(function (k) { if (ch(k)) u[k] = Number(a[k]) ? 1 : 0; });
      if (ch("itemsText")) u.items = JSON.stringify(itemsFrom(t("itemsText"), arr(fresh.items)));
      body = bodyOf(u); // the classic rule stays: an item marked CD keeps the controlled-drug flag on
      var r = await E.apiFetch("/client-deliveries/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
    } catch (x) {
      if (!(x && x.network && body && await landed(id, body))) { S.editErr = E.saveFailText(x); S.editSaving = false; paint(); return focusOn("#dlv-edit [type=submit]"); }
    }
    E.toast(t("client_name") + "'s delivery is saved", "success"); S.editing = null; S.edit = null; S.orig = null; S.editErr = ""; S.efe = {};
    S.editSaving = false; await load(); focusOn('[data-act=open][data-id="' + id + '"]');
  }

  // Delete (pharmacist only): the reason is written in the delivery's log (the classic body), then the delivery is deleted.
  async function remove() {
    if (S.editSaving || !S.editing || !isAdmin()) return;
    keep();
    var id = S.editing, reason = String(S.delReason || "").trim();
    if (!reason) { S.editErr = "Write why it is being deleted. Nothing was deleted."; paint(); return focusOn("#dlv-edit [name=del_reason]"); }
    S.editSaving = true; S.editErr = ""; paint();
    try {
      var fresh = await reread(id);
      if (fresh) {
        var body = bodyOf(fresh); body.delivery_log = JSON.stringify(arr(fresh.delivery_log).concat([{ ts: new Date().toISOString(), author: author(), text: "Deleted: " + reason }]));
        try {
          var r1 = await E.apiFetch("/client-deliveries/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
          if (!r1 || !r1.ok) throw new Error((r1 && r1.error) || "Could not write the reason");
        } catch (x1) { if (!(x1 && x1.network && await landed(id, body))) throw x1; }
        try {
          var r2 = await E.apiFetch("/client-deliveries/entries/" + encodeURIComponent(String(id)), { method: "DELETE" }); // the classic screen's call
          if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Delete failed");
        } catch (x2) { var gone = false; if (x2 && x2.network) { try { gone = !(await reread(id)); } catch (e3) { gone = false; } } if (!gone) throw x2; }
      }
      E.toast("Delivery deleted", "success"); S.editing = null; S.edit = null; S.orig = null; S.del = null;
    } catch (x) { S.editErr = E.saveFailText(x).replace(/^Not saved/, "Not deleted"); S.editSaving = false; paint(); return focusOn("#dlv-edit [data-act=del-go]"); }
    S.editSaving = false; await load(); focusOn(".dlv-top [data-act=add]");
  }

  async function add(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var c = function (n) { var el = f.querySelector("[name=" + n + "]"); return el && el.checked ? 1 : 0; };
    var a = { client_name: v("client_name"), id_doc_ref: v("id_doc_ref"), phone: v("phone"), delivery_address: v("delivery_address"), address_notes: v("address_notes"), itemsText: v("items"),
      scheduled_date: v("scheduled_date"), scheduled_time_slot: v("scheduled_time_slot"), cold_chain_required: c("cold_chain_required"), contains_controlled: c("contains_controlled"), signature_required: c("signature_required") };
    S.adding = a; S.err = "";
    var fe = {};
    if (!a.client_name) fe.client_name = "Write the customer's name.";
    if (!a.phone) fe.phone = "Write a phone number for the driver.";
    if (!a.delivery_address) fe.delivery_address = "Write the address.";
    S.fe = fe; S.err = Object.keys(fe).map(function (k) { return fe[k]; }).join(" ") + (Object.keys(fe).length ? " Nothing was saved." : "");
    if (S.err) { paint(); focusOn("#dlv-add [name=" + Object.keys(fe)[0] + "]"); return; }
    var items = a.itemsText ? a.itemsText.split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (n) { return { name: n, qty: 1, schedule: a.contains_controlled ? "" : "OTC", batch_ref: "", expiry: "" }; }) : [];
    var body = { delivery_id: "", order_date: today(), scheduled_date: isYmd(a.scheduled_date) ? a.scheduled_date : today(), scheduled_time_slot: a.scheduled_time_slot,
      client_name: a.client_name, phone: a.phone, email: "", delivery_address: a.delivery_address, address_notes: a.address_notes, delivery_method: "In-house Driver", priority: 2,
      status: "Scheduled", signature_required: a.signature_required, signature_obtained: 0, delivery_attempts: 0, contains_controlled: a.contains_controlled, cold_chain_required: a.cold_chain_required,
      items: JSON.stringify(items), delivery_log: JSON.stringify([{ ts: new Date().toISOString(), author: author(), text: "Delivery recorded." }]), internal_notes: "" };
    var idc = E.people ? E.people.normIdCard(a.id_doc_ref) : a.id_doc_ref;
    if (a.id_doc_ref) body.id_doc_ref = a.id_doc_ref; // b4-10: only when typed (a delivery without one sends exactly what it sent before), and as typed, as the classic stores it
    // an ID card typed here and the person (E.people.confirmPerson), as on Orders: asked before saving; Go back keeps the form
    var asked = null;
    if (idc && E.people && E.people.confirmPerson) {
      S.saving = true; paint();
      asked = await E.people.confirmPerson({ name: body.client_name, id_card: idc, phone: body.phone, address: body.delivery_address }, { key: "dlvreg", record: "delivery" });
      S.saving = false;
      if (asked.action !== "save") {
        if (asked.action === "fill") S.adding[asked.field === "name" ? "client_name" : "id_doc_ref"] = asked.value;
        paint(); focusOn("#dlv-add [name=" + (asked.field === "name" ? "client_name" : "id_doc_ref") + "]");
        return;
      }
    }
    S.saving = true; paint();
    try {
      body.delivery_id = await nextId(); // taken at the last moment: going back from the ID-card question uses no number
      var r = await E.apiFetch("/client-deliveries/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; S.carry = null; S.fe = {}; E.toast("Saved · delivery for " + body.client_name + " · " + body.delivery_id, "success"); var added = true;
      if (E.linkPerson) E.linkPerson({ name: body.client_name, phone: body.phone, address: body.delivery_address, id_card: idc }, "register:deliveries", asked); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; await load();
    if (added) focusOn(".dlv-top [data-act=add]");
  }

  E.registerModule({
    id: "dlvreg", title: "Deliveries", order: 3, icon: "→", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.open = null; S.mode = ""; S.err = ""; S.fe = {}; S.draft = null; S.editing = null; S.edit = null; S.orig = null; S.del = null; S.editErr = ""; S.editSaving = false; S.efe = {}; E.months.historyReset("dlvreg");
      // From a customer's page: a new delivery for them, or (from the count of their deliveries) their deliveries.
      var hand = E.takeCustomerHandoff ? E.takeCustomerHandoff("dlvreg") : null;
      S.carry = hand && hand.mode === "new" ? hand : null;
      S.who = hand && hand.mode === "find" ? { name: String(hand.person.name), phone: String(hand.person.phone || "") } : null;
      if (S.carry) S.adding = {};
      css(); paint(); if (S.carry) fillCarry(); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("dlvreg") < 0) E.UI2_DESTINATIONS.push("dlvreg");
  if (E.UI2_PARENT) E.UI2_PARENT.dlvreg = "customers";
})();
