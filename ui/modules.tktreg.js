/* Customer questions, new layout: open questions by priority and follow-up date, the customer's number to call, the
   latest note; add a note, mark resolved, record a new question. Same endpoints as the classic screen; the update keeps
   fields it is not sent (UPDATE-AUDIT.md: PARTIAL), but every change here sends what the classic screen sends: the whole
   question as read again from the server, with only the change made here different. Open one to change it, assign it
   or set its status; "Done" lists resolved and closed ones, 20 at a time; delete is for the pharmacist, with a reason
   written as a note first so the audit's copy carries it. Numbers come from the same per-browser counter as the classic screen.
   An open question prints on its own, on the classic screen's one-question page (printSingleTicket); a customer with
   an email address can be written to from the card (the device's mail app: the classic screen sends no email). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, noting: null, saving: false, err: "",
    view: "open", done: [], doneLoading: false, doneError: "", shown: 20, editing: null, edit: null, editErr: "", editSaving: false, del: null, q: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var PRI = { 1: "High", 2: "Medium", 3: "Low" };

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
  function daysUntil(s) { var p = String(s).split("-"); var t = new Date(); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function when(s) { var n = daysUntil(s); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; var p = s.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1]; }
  function notes(e) { try { var a = typeof e.notes_log === "string" ? JSON.parse(e.notes_log || "[]") : e.notes_log; return Array.isArray(a) ? a : []; } catch (x) { return []; } }
  var STATUSES = ["Open", "In Progress", "Awaiting Client", "Resolved", "Closed"]; // the server's list (VALID_TICKET_STATUSES)
  var EDIT = ["open_date", "client_name", "phone", "email", "category", "priority", "status", "issue", "assigned_to", "followup_date"];
  var PAGE = 20;
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function isAdmin() { var u = E.state && E.state.user; return !!(u && u.role === "admin"); } // the server lets staff delete too: this screen keeps it to the pharmacist
  function staff() { try { var a = JSON.parse(localStorage.getItem("eikon_tickets_staff_v1") || "null"); if (Array.isArray(a)) return a; } catch (e) {} return ["John Agius"]; } // the classic screen's list
  function isDone(e) { return !!Number(e.resolved) || e.status === "Resolved" || e.status === "Closed"; }
  function findQ(id) { return S.entries.concat(S.done).find(function (x) { return x.id === id; }) || null; }
  // The classic screen's body for any change (validateAndBuild): every field, from the question as it was read again.
  function bodyOf(r) {
    var pr = Number(r.priority || 2); if (pr !== 1 && pr !== 2 && pr !== 3) pr = 2;
    var st = String(r.status || "Open").trim(); if (STATUSES.indexOf(st) < 0) st = "Open";
    var res = st === "Resolved" || st === "Closed";
    return { ticket_id: String(r.ticket_id || "").trim(), open_date: isYmd(r.open_date) ? r.open_date : today(), client_name: String(r.client_name || "").trim(), phone: String(r.phone || "").trim(),
      email: String(r.email || "").trim(), category: String(r.category || "").trim(), priority: pr, status: st, issue: String(r.issue || "").trim(), assigned_to: String(r.assigned_to || "").trim(),
      followup_date: isYmd(r.followup_date) ? r.followup_date : "", notes_log: JSON.stringify(notes(r)), resolved: res, resolved_at: res ? (String(r.resolved_at || "").trim() || new Date().toISOString()) : "" };
  }
  async function reread(id) { // there is no single-question read: the list holds them all
    var r = await E.apiFetch("/client-tickets/entries", { method: "GET" });
    return ((r && r.entries) || []).find(function (x) { return x.id === id; }) || null;
  }
  // A change whose answer was lost counts as saved only when the question now holds what was sent.
  async function landed(id, body) {
    try { var n = await reread(id); if (!n) return false; var b2 = bodyOf(n);
      return ["client_name", "phone", "email", "category", "status", "issue", "assigned_to", "followup_date", "notes_log", "open_date"].every(function (k) { return String(b2[k]) === String(body[k]); }) && b2.priority === body.priority;
    } catch (e) { return false; }
  }
  function nextId() { // same counter as the classic screen, so numbers carry on
    try { var k = "eikon_tickets_seq_v1", n = (parseInt(localStorage.getItem(k), 10) || 0) + 1; localStorage.setItem(k, String(n)); return "TKT-" + String(n).padStart(5, "0"); }
    catch (e) { return "TKT-" + String(Date.now()).slice(-5); }
  }

  // The classic screen's one-question print (modules.tickets.js printSingleTicket), the same page, through E.printTab.
  function printOne(entry) {
    var pad2 = function (n) { return String(n).padStart(2, "0"); };
    var dmy = function (s) { if (!isYmd(s)) return s || ""; var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; };
    var fmtTs = function (iso) { if (!iso) return ""; try { var d = new Date(iso); if (isNaN(d.getTime())) return iso; return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); } catch (e) { return iso; } };
    function safe(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
    function prText(p) { var n = Number(p || 2); if (n === 1) return "1 — High"; if (n === 3) return "3 — Low"; return "2 — Medium"; }
    var ns = notes(entry);
    var notesHtml = ns.length ? ns.map(function (n) {
      return "<div style='border:1px solid #e2e4e8;border-radius:6px;padding:8px;margin-bottom:6px;'>" +
             "<div style='font-size:10px;color:#888;margin-bottom:4px;'>" + safe(fmtTs(n.ts)) + (n.author ? " · " + safe(n.author) : "") + "</div>" +
             "<div style='font-size:12px;white-space:pre-wrap;'>" + safe(n.text || "") + "</div></div>";
    }).join("") : "<p style='color:#888;font-style:italic;font-size:12px;'>No notes recorded.</p>";
    var html =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<title>" + safe(entry.ticket_id || "Ticket") + "</title>" +
      "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111;max-width:700px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;}" +
      ".hdr{border-bottom:2px solid #222;padding-bottom:10px;margin-bottom:16px;}" +
      ".tid{font-size:22px;font-weight:900;} .tsub{font-size:12px;color:#666;margin-top:4px;}" +
      ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}" +
      ".kv{border:1px solid #e2e4e8;border-radius:8px;padding:10px;}" +
      ".kv .k{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}" +
      ".kv .v{font-size:12px;}" +
      ".issue-box{border:1px solid #e2e4e8;border-radius:8px;padding:12px;margin-bottom:14px;}" +
      ".issue-box .lbl{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}" +
      ".issue-box .txt{font-size:13px;white-space:pre-wrap;}" +
      "h3{margin:0 0 10px 0;font-size:14px;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button data-eikon-print='print'>🖨 Print</button>" +
      "<div class='hdr'><div class='tid'>" + safe(entry.ticket_id || "—") + "</div>" +
      "<div class='tsub'>Opened: " + safe(dmy(entry.open_date || "")) + " · Status: " + safe(entry.status || "") + " · Priority: " + safe(prText(entry.priority)) + "</div></div>" +
      "<div class='grid'>" +
      "<div class='kv'><div class='k'>Client</div><div class='v'>" + safe(entry.client_name || "—") + "</div></div>" +
      "<div class='kv'><div class='k'>Phone</div><div class='v'>" + safe(entry.phone || "—") + "</div></div>" +
      "<div class='kv'><div class='k'>Email</div><div class='v'>" + safe(entry.email || "—") + "</div></div>" +
      "<div class='kv'><div class='k'>Category</div><div class='v'>" + safe(entry.category || "—") + "</div></div>" +
      "<div class='kv'><div class='k'>Assigned To</div><div class='v'>" + safe(entry.assigned_to || "—") + "</div></div>" +
      "<div class='kv'><div class='k'>Follow-up Date</div><div class='v'>" + safe(entry.followup_date ? dmy(entry.followup_date) : "—") + "</div></div>" +
      "</div>" +
      "<div class='issue-box'><div class='lbl'>Issue Description</div><div class='txt'>" + safe(entry.issue || "—") + "</div></div>" +
      "<h3>Notes Log (" + String(ns.length) + " entr" + (ns.length === 1 ? "y" : "ies") + ")</h3>" +
      notesHtml +
      "</body></html>";
    var w = E.openPrint ? E.openPrint(html, { delay: 250 }) : null;
    if (!w) E.toast("The print page was blocked. Allow pop-ups for this site, then press Print again.", "error");
  }

  function cats() { // same list as the classic screen keeps in this browser
    try { var a = JSON.parse(localStorage.getItem("eikon_tickets_cats_v1") || "null"); if (Array.isArray(a) && a.length) return a; } catch (e) {}
    return ["Billing", "Prescription", "Product Complaint", "Delivery", "General Enquiry"];
  }

  function css() {
    if (document.getElementById("eikon-tktreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-tktreg-css";
    st.textContent =
      ".tkt{max-width:880px;margin:0 auto}" +
      ".tkt-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".tkt-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".tkt h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.tkt-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".tkt-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".tkt-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.tkt-btn:disabled{opacity:.55;cursor:default}" +
      ".tkt-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.tkt-lab b{color:var(--text)}" +
      ".tkt-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:13px 16px;margin-bottom:10px;border-left:3px solid var(--border)}.tkt-card.hi{border-left-color:var(--danger)}.tkt-card.due{border-left-color:#C98A12}" +
      ".tkt-card .h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.tkt-card b{font-size:15.5px;font-weight:600}.tkt-card .h span:not(.tkt-pill){font-size:12px;color:var(--muted)}" +
      ".tkt-card .i{font-size:14.5px;margin-top:4px}.tkt-card .s{font-size:12.5px;color:var(--muted);margin-top:3px}.tkt-card .s a{color:var(--accent);text-decoration:none}" +
      ".tkt-card .n{font-size:13px;margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(118,118,128,.08)}.tkt-card .n small{display:block;color:var(--muted);font-size:11.5px}" +
      ".tkt-card .a{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}" +
      ".tkt-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--muted)}.tkt-pill.due{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.tkt-pill.late{background:rgba(215,38,28,.12);color:var(--danger)}" +
      ".tkt-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}.tkt-in{margin-top:8px;border-radius:10px;background:rgba(118,118,128,.07)}" +
      ".tkt-form label,.tkt-in label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.tkt-form label:first-child,.tkt-in label:first-child{border-top:0}" +
      ".tkt-form label>span{flex:0 0 96px;font-size:15px}.tkt-form input,.tkt-form select,.tkt-in input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".tkt-form .acts,.tkt-in .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}" +
      ".tkt-err{color:var(--danger);font-size:13px;padding:2px 14px 4px}" +
      ".tkt-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".tkt-tabs{display:inline-flex;gap:2px;padding:2px;border-radius:10px;background:rgba(118,118,128,.12);margin-top:16px}.tkt-tabs button{font:inherit;font-size:14px;font-weight:600;height:30px;padding:0 14px;border:0;border-radius:8px;background:transparent;color:var(--text);cursor:pointer}.tkt-tabs button[aria-pressed=true]{background:var(--panel2);box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      ".tkt-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:12px}" +
      ".tkt-name{border:0;background:none;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer}.tkt-name:hover b,.tkt-name:focus-visible b{text-decoration:underline}" +
      ".tkt-ed label>span{flex:0 0 88px;font-size:15px}.tkt-ed select,.tkt-ed textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}.tkt-ed textarea{resize:vertical;min-height:44px}" +
      ".tkt-in .acts.l{justify-content:space-between}.tkt-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.tkt-btn.dd{background:#B42318;border-color:#B42318;color:#fff}" +
      ".tkt-meta{font-size:12.5px;color:var(--muted);padding:6px 14px 2px}.tkt-more{display:flex;justify-content:center;margin-top:6px}" +
      // Quality pass (2026-11-03): sentence-case headings, figures that line up, errors beside their fields, a skeleton
      // while loading, and 44 px targets on a phone.
      ".tkt-lab{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none}.tkt-lab b,.tkt-pill,.tkt-card .h span{font-variant-numeric:tabular-nums}" +
      ".tkt-form label,.tkt-in label{flex-wrap:wrap}.tkt-ferr{flex-basis:100%;margin:-6px 0 8px 108px;color:var(--danger);font-size:13px;font-weight:500}.tkt-ed .tkt-ferr{margin-left:100px}" +
      ".tkt-skel{display:block;height:96px;margin-bottom:10px;border-radius:12px;border:1px solid var(--border);background:linear-gradient(90deg,rgba(118,118,128,.06),rgba(118,118,128,.14),rgba(118,118,128,.06));background-size:200% 100%;animation:tktsk 1.2s linear infinite}" +
      "@keyframes tktsk{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.tkt-skel{animation:none}}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .tkt-ferr{color:#FF7A72}}" + // 5:1 on the tinted row being typed in
      ".tkt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (max-width:600px){.tkt{padding:4px 16px 0}.tkt h1{font-size:32px}.tkt-btn,.tkt-tabs button{height:44px;border-radius:22px}.tkt-tabs button{border-radius:9px}" +
      ".tkt-ferr,.tkt-ed .tkt-ferr{margin-left:0}.tkt-form label>span,.tkt-ed label>span{flex-basis:88px}.tkt-q{height:44px;font-size:16px}.tkt-card .a .tkt-btn{flex:1}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/client-tickets/entries?resolved=0", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load questions");
      S.entries = (r.entries || []).filter(function (e) { return !isDone(e); })
        .sort(function (a, b) { return (Number(a.priority) || 2) - (Number(b.priority) || 2) || String(a.followup_date || "9") .localeCompare(String(b.followup_date || "9")) || String(a.open_date).localeCompare(String(b.open_date)); });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load questions"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  // Done: resolved and closed questions (the classic list's resolved=1), latest first, shown 20 at a time.
  async function loadDone() {
    S.doneLoading = true; S.doneError = ""; paint();
    try {
      var r = await E.apiFetch("/client-tickets/entries?resolved=1", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load questions");
      S.done = (r.entries || []).filter(isDone).sort(function (a, b) { return String(b.resolved_at || b.open_date || "").localeCompare(String(a.resolved_at || a.open_date || "")) || b.id - a.id; });
    } catch (e) { S.doneError = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load questions"); }
    S.doneLoading = false; E.whenFormIdle(S.mount, paint);
  }

  // The server's statuses, in the words a pharmacist uses (the stored value never changes).
  var SAY = { "Open": "Waiting", "In Progress": "In progress", "Awaiting Client": "Waiting for the customer", "Resolved": "Resolved", "Closed": "Closed" };
  function say(st) { return SAY[st] || String(st || "Waiting"); }
  // A field the last save refused: marked, its reason under it, read out with it.
  function inv(map, k) { return map && map[k] ? ' aria-invalid="true" aria-describedby="tkt-e-' + k + '"' : ""; }
  function ferr(map, k) { return map && map[k] ? '<small class="tkt-ferr" id="tkt-e-' + k + '">' + esc(map[k]) + "</small>" : ""; }
  function sumUp(fe) { var ks = Object.keys(fe); return ks.length ? ks.map(function (k) { return fe[k]; }).join(" ") + " Nothing was saved." : ""; }
  function lastCat() { try { return localStorage.getItem("eikon_tktreg_lastcat") || ""; } catch (e) { return ""; } } // this browser's last choice
  function setLastCat(c) { try { localStorage.setItem("eikon_tktreg_lastcat", c); } catch (e) {} }

  function cardHtml(e) {
    var done = isDone(e);
    var n = e.followup_date && !done ? daysUntil(e.followup_date) : null, last = notes(e).slice(-1)[0];
    // the edge: red when the follow-up is late, amber when it is due today or the question is high priority
    var cls = done ? "" : n != null && n < 0 ? "hi" : (n === 0 || Number(e.priority) === 1) ? "due" : "";
    var sub = []; if (e.phone) sub.push('<a href="tel:' + esc(String(e.phone).replace(/\s+/g, "")) + '">' + esc(e.phone) + "</a>");
    if (e.email) sub.push('<a href="mailto:' + esc(String(e.email).trim()) + "?subject=" + esc(encodeURIComponent("Your question" + (e.ticket_id ? " (" + e.ticket_id + ")" : ""))) + '" aria-label="' + esc("Email " + e.client_name + ", " + e.email) + '">' + esc(e.email) + "</a>");
    if (e.category) sub.push(esc(e.category)); if (e.assigned_to) sub.push("With " + esc(e.assigned_to));
    if (done || (e.status && e.status !== "Open")) sub.push(esc(say(e.status))); // "Open" on every open question says nothing
    if (done && e.resolved_at) sub.push("closed " + esc(when(String(e.resolved_at).slice(0, 10))));
    var h = '<div class="tkt-card ' + cls + '"><div class="h"><button type="button" class="tkt-name" data-act="open" data-id="' + e.id + '" aria-expanded="' + (S.editing === e.id ? "true" : "false") + '" aria-label="' + esc("Open the question from " + e.client_name) + '"><b>' + esc(e.client_name) + "</b></button><span>" + esc(e.ticket_id || "") + " · opened " + esc(when(e.open_date)) + "</span>" +
      (n != null ? '<span class="tkt-pill ' + (n < 0 ? "late" : n === 0 ? "due" : "") + '">' + (n < 0 ? "Follow-up late · " : "Follow up ") + esc(when(e.followup_date)) + "</span>" : "") +
      (Number(e.priority) === 1 && !done ? '<span class="tkt-pill late">High</span>' : "") + "</div>" +
      '<div class="i">' + esc(e.issue) + '</div><div class="s">' + sub.join(" · ") + "</div>" +
      (last ? '<div class="n"><small>' + esc((last.author || "") + (last.ts ? " · " + when(String(last.ts).slice(0, 10)) : "")) + "</small>" + esc(last.text || "") + "</div>" : "");
    if (S.editing === e.id) h += editHtml(e);
    else if (S.noting === e.id) h += '<form class="tkt-in" id="tkt-note" autocomplete="off" aria-label="' + esc("A note on the question from " + e.client_name) + '"><label><input name="text" aria-label="Note" placeholder="What happened, e.g. Called, will come Friday" value="' + esc(S.noteDraft || "") + '"' + (S.err ? ' aria-invalid="true" aria-describedby="tkt-note-err"' : "") + "></label>" + (S.err ? '<div class="tkt-err" id="tkt-note-err" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="tkt-btn" data-act="note-cancel">Cancel</button><button type="submit" class="tkt-btn p"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Add note") + "</button></div></form>";
    else if (done) h += '<div class="a"><button class="tkt-btn" data-act="reopen" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Open again") + "</button></div>";
    else h += '<div class="a"><button class="tkt-btn" data-act="note" data-id="' + e.id + '" aria-label="' + esc("Add a note for " + e.client_name) + '">Add a note</button><button class="tkt-btn p" data-act="resolve" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ' aria-label="' + esc("Resolved: " + e.client_name + " has their answer") + '">' + (S.busy[e.id] ? "Saving…" : "Resolved") + "</button></div>";
    return h + "</div>";
  }

  function editHtml(e) {
    var a = S.edit || {}, fe = S.efe || {}, f = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '"' + (extra || "") + inv(fe, k) + ">" + ferr(fe, k) + "</label>"; };
    var cs = cats(); if (a.category && cs.indexOf(a.category) < 0) cs = cs.concat([a.category]);
    var st = staff(); if (a.assigned_to && st.indexOf(a.assigned_to) < 0) st = st.concat([a.assigned_to]);
    var h = '<form class="tkt-in tkt-ed" id="tkt-edit" autocomplete="off" aria-label="' + esc("Change the question from " + e.client_name) + '">' +
      f("client_name", "Customer", ' placeholder="Name and surname"') + f("phone", "Phone", ' type="tel" inputmode="tel" placeholder="Optional"') + f("email", "Email", ' type="email" inputmode="email" autocapitalize="off" placeholder="Optional"') +
      '<label><span>Question</span><textarea name="issue" rows="2"' + inv(fe, "issue") + ">" + esc(a.issue || "") + "</textarea>" + ferr(fe, "issue") + "</label>" +
      '<label><span>About</span><select name="category"' + inv(fe, "category") + ">" + cs.map(function (c) { return "<option" + (c === a.category ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>" + ferr(fe, "category") + "</label>" +
      '<label><span>Priority</span><select name="priority"><option value="1"' + (String(a.priority) === "1" ? " selected" : "") + '>High</option><option value="2"' + (String(a.priority) === "2" ? " selected" : "") + '>Medium</option><option value="3"' + (String(a.priority) === "3" ? " selected" : "") + ">Low</option></select></label>" +
      '<label><span>Status</span><select name="status">' + STATUSES.map(function (c) { return '<option value="' + esc(c) + '"' + (c === a.status ? " selected" : "") + ">" + esc(say(c)) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>Assigned to</span><select name="assigned_to"><option value="">Nobody yet</option>' + st.map(function (c) { return "<option" + (c === a.assigned_to ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
      f("followup_date", "Follow up", ' type="date"') + f("open_date", "Opened", ' type="date"') +
      (S.editErr ? '<div class="tkt-err" role="alert">' + esc(S.editErr) + "</div>" : "");
    if (S.del === e.id) {
      h += '<label><span>Why delete</span><input name="del_reason" value="' + esc(S.delReason || "") + '" placeholder="e.g. Recorded twice"></label>' +
        '<div class="tkt-meta">This removes the question for good. The reason is added as a note first, so it stays in the audit.</div>' +
        '<div class="acts"><button type="button" class="tkt-btn" data-act="del-cancel">Keep it</button><button type="button" class="tkt-btn dd" data-act="del-go"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Deleting…" : "Delete question") + "</button></div>";
    } else {
      h += '<div class="acts l">' + (isAdmin() ? '<button type="button" class="tkt-btn d" data-act="del">Delete…</button>' : "<span></span>") +
        '<span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="tkt-btn" data-act="print" data-id="' + e.id + '" aria-label="' + esc("Print the question from " + e.client_name) + '">Print</button><button type="button" class="tkt-btn" data-act="edit-cancel">Close</button><button type="submit" class="tkt-btn p"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Saving…" : "Save changes") + "</button></span></div>";
    }
    return h + "</form>";
  }

  function keepEdit() { // what is typed in the open question, a note or the new question survives a redraw
    var f = S.mount && S.mount.querySelector("#tkt-edit");
    if (f && S.edit) {
      EDIT.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.edit[k] = String(el.value || ""); });
      var r = f.querySelector("[name=del_reason]"); if (r) S.delReason = String(r.value || "");
    }
    var n = S.mount && S.mount.querySelector("#tkt-note input"); if (n) S.noteDraft = String(n.value || "");
    var fa = S.mount && S.mount.querySelector("#tkt-add");
    if (fa && S.adding && !S.saving) ["client_name", "phone", "issue", "category", "priority", "followup_date"].forEach(function (k) { var el = fa.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || ""); });
  }

  function matchQ(e) { var q = String(S.q || "").trim().toLowerCase(); return !q || [e.client_name, e.phone, e.issue, e.ticket_id, e.category, e.assigned_to].some(function (v) { return String(v || "").toLowerCase().indexOf(q) >= 0; }); }
  function skel(what) { return '<div aria-busy="true" style="margin-top:16px"><span class="tkt-sr" role="status">Opening ' + what + '</span><i class="tkt-skel"></i><i class="tkt-skel"></i><i class="tkt-skel"></i></div>'; }
  function trouble(msg) { return '<div class="tkt-quiet" role="alert">' + esc(msg) + ' <button type="button" class="tkt-btn" data-act="retry" style="margin-left:6px">Try again</button></div>'; }

  // Opened from a customer's page (modules.customers.js, BACKLOG4 item 1): who it is for stays in sight at the top, the
  // person is filled into the empty fields only, and focus goes to the first required field still empty.
  var CARRY = { client_name: "name", phone: "phone" }, NEEDED = ["client_name", "issue"];
  function carryLine() { var p = S.carry && S.carry.person; return p ? '<div class="tkt-meta" style="padding:10px 14px 8px">From Customers: <b>' + esc(p.name) + "</b>" + (p.id_card ? " · ID card " + esc(p.id_card) : "") + "</div>" : ""; }
  function fillCarry() {
    var f = S.mount && S.mount.querySelector("#tkt-add"), p = S.carry && S.carry.person; if (!f || !p) return;
    var want = {}; Object.keys(CARRY).forEach(function (k) { want[k] = p[CARRY[k]]; });
    E.fillEmpty(f, want).forEach(function (k) { S.adding[k] = want[k]; });
    var go = function () { if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#tkt-add")) return; var g = S.mount && S.mount.querySelector("#tkt-add"); if (!g) return; var el = NEEDED.map(function (k) { return g.querySelector("[name=" + k + "]"); }).filter(function (x) { return x && !String(x.value || "").trim(); })[0] || g.querySelector("[type=submit]"); if (el) el.focus(); };
    go(); setTimeout(go, 30); // and again after the screen settles, unless the person is already in the form
  }
  function onlyCarried(fa) { // nothing typed beyond what came from the customer's page
    var p = (S.carry && S.carry.person) || {};
    return ["client_name", "phone", "issue", "followup_date"].every(function (k) { var el = fa.querySelector("[name=" + k + "]"), v = String((el && el.value) || "").trim(); return !v || (CARRY[k] && v === String(p[CARRY[k]] || "").trim()); });
  }

  function addHtml() {
    var a = S.adding, fe = S.fe || {}, cat = a.category || lastCat() || "General Enquiry", cs = cats(); if (cs.indexOf(cat) < 0) cat = cs.indexOf("General Enquiry") >= 0 ? "General Enquiry" : cs[0];
    return '<form class="tkt-form" id="tkt-add" autocomplete="off" aria-label="New question">' + carryLine() + '<label><span>Customer</span><input name="client_name" value="' + esc(a.client_name || "") + '" placeholder="Name and surname" autocapitalize="words"' + inv(fe, "client_name") + ">" + ferr(fe, "client_name") + "</label>" +
      '<label><span>Phone</span><input name="phone" type="tel" inputmode="tel" value="' + esc(a.phone || "") + '" placeholder="To call with the answer"></label>' +
      '<label><span>Question</span><input name="issue" value="' + esc(a.issue || "") + '" placeholder="What they asked"' + inv(fe, "issue") + ">" + ferr(fe, "issue") + "</label>" +
      '<label><span>About</span><select name="category">' + cs.map(function (c) { return '<option' + (c === cat ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>Priority</span><select name="priority"><option value="2">Medium</option><option value="1"' + (String(a.priority) === "1" ? " selected" : "") + '>High</option><option value="3"' + (String(a.priority) === "3" ? " selected" : "") + ">Low</option></select></label>" +
      '<label><span>Follow up</span><input name="followup_date" type="date" min="' + esc(today()) + '" value="' + esc(a.followup_date || "") + '"></label>' + dayChips("followup_date", a.followup_date, "Follow up") +
      (S.err && !S.noting ? '<div class="tkt-err" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="tkt-btn" data-act="add-cancel">Cancel</button><button type="submit" class="tkt-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save question") + "</button></div></form>";
  }

  // The lists (what a search changes): redrawn on their own while typing, so the search box is never rebuilt.
  function resultsHtml() {
    var h = "", q = String(S.q || "").trim();
    if (S.view === "done") {
      var dn = S.done.filter(matchQ);
      if (S.doneLoading && !S.done.length) return skel("resolved questions");
      if (S.doneError) return trouble(S.doneError);
      if (!dn.length) return '<div class="tkt-quiet">' + (q ? "No resolved question matches “" + esc(q) + "”." : "No question has been resolved yet.") + "</div>";
      h += '<div class="tkt-lab">Resolved and closed <b>' + dn.length + "</b></div>" + dn.slice(0, S.shown).map(cardHtml).join("");
      if (dn.length > S.shown) h += '<div class="tkt-more"><button class="tkt-btn" data-act="more">Show ' + Math.min(PAGE, dn.length - S.shown) + " more</button></div>";
      return h;
    }
    var op = S.entries.filter(matchQ);
    if (S.loading && !S.entries.length) return skel("questions");
    if (S.error) return trouble(S.error);
    var late = op.filter(function (e) { return e.followup_date && daysUntil(e.followup_date) < 0; }).length;
    return op.length ? '<div class="tkt-lab">Waiting <b>' + op.length + "</b>" + (late ? '<span style="color:var(--danger)">· ' + late + " follow-up" + (late === 1 ? "" : "s") + " late</span>" : "") + "</div>" + op.map(cardHtml).join("")
      : '<div class="tkt-quiet">' + (q ? "No waiting question matches “" + esc(q) + "”." : "No customer is waiting for an answer. When someone asks something you cannot answer now, press New question.") + "</div>";
  }

  function html() {
    var h = '<div class="tkt"><button class="tkt-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("tktreg") : "‹ Customers") + "</button>" +
      '<div class="tkt-top"><div><h1>Questions</h1><p class="tkt-sub">Customers waiting for an answer, most pressing first.</p></div>' + (S.adding ? "" : '<button class="tkt-btn p" data-act="add">New question</button>') + "</div>";
    if (S.adding) h += addHtml();
    h += '<div class="tkt-tabs" role="group" aria-label="Which questions"><button type="button" data-act="view-open" aria-pressed="' + (S.view === "open") + '">Waiting</button><button type="button" data-act="view-done" aria-pressed="' + (S.view === "done") + '">Done</button></div>';
    var list = S.view === "done" ? S.done : S.entries;
    if (list.length > 8 || S.q) h += '<input class="tkt-q" aria-label="Search questions" id="tkt-q" type="search" autocomplete="off" placeholder="Search customer, phone, question or number" value="' + esc(S.q) + '">';
    h += '<div id="tkt-res">' + resultsHtml() + "</div>";
    h += E.months.history("tktreg", E.months.preset("questions", { paint: function () { E.repaintKeepingFocus(S.mount, paint); }, dep: function () { return S.loading ? undefined : S.entries; } })); // every question of a month, answered or not, and its printout (eikon.months.js)
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">New categories and staff names are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    return h;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "tktreg") return; // left before a reply came back: do not draw over the next screen
    if (!S.editSaving) keepEdit();
    var ae = document.activeElement, backTo = ae && m.contains(ae) && ae.closest && ae.closest("#tkt-edit") && ae.name ? ae.name : "";
    m.innerHTML = html();
    E.months.wireHistory(m, "tktreg");
    if (backTo) { var again = m.querySelector("#tkt-edit [name=" + backTo + "]"); if (again) again.focus(); }
    bind(m);
  }
  function paintResults() { var box = S.mount && S.mount.querySelector("#tkt-res"); if (!box) return paint(); keepEdit(); box.innerHTML = resultsHtml(); bind(box); }
  function focusOn(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); if (x) x.focus(); }, 0); }
  function editUnchanged() { var a = S.edit || {}, o = S.orig || {}; return EDIT.every(function (k) { return String(a[k] == null ? "" : a[k]).trim() === String(o[k] == null ? "" : o[k]).trim(); }); }
  function closeEdit() { var id = S.editing; S.editing = null; S.edit = null; S.editErr = ""; S.efe = {}; S.del = null; paint(); if (id) focusOn('[data-act=open][data-id="' + id + '"]'); }
  function closeNote() { var id = S.noting; S.noting = null; S.err = ""; S.noteDraft = ""; paint(); if (id) focusOn('[data-act=note][data-id="' + id + '"]'); }
  function closeAdd() { var h = S.carry; S.carry = null; S.adding = null; S.err = ""; S.fe = {}; if (h && E.customerReturn && E.customerReturn(h)) return; paint(); focusOn(".tkt-top [data-act=add]"); } // opened from a customer's page: back to that person

  function bind(root) {
    var m = S.mount;
    root.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("tktreg") : "#customers";
        else if (a === "add") { S.carry = null; S.adding = {}; S.err = ""; S.fe = {}; paint(); setTimeout(function () { var f = m.querySelector("#tkt-add [name=client_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "add-cancel") closeAdd();
        else if (a === "note") { keepEdit(); S.noting = id; S.noteDraft = ""; S.err = ""; S.editing = null; S.edit = null; paint(); setTimeout(function () { var f = m.querySelector("#tkt-note input"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "note-cancel") closeNote();
        else if (a === "resolve") { var at = S.entries.filter(matchQ).map(function (x) { return x.id; }).indexOf(id); change(id, function (r) { r.status = "Resolved"; }, "Marked resolved").then(function (ok) { if (!ok) return focusOn('[data-act=resolve][data-id="' + id + '"]'); var bs = S.mount.querySelectorAll("#tkt-res [data-act=open]"); var nx = bs[Math.min(at, bs.length - 1)]; if (nx) nx.focus(); else focusOn(".tkt-top [data-act=add]"); }); } // focus moves to the next question in the list
        else if (a === "reopen") change(id, function (r) { r.status = "Open"; r.resolved_at = ""; }, "Open again");
        else if (a === "retry") reloadAll();
        else if (a === "open") openEdit(id);
        else if (a === "edit-cancel") closeEdit();
        else if (a === "print") { var pe = findQ(id); if (pe) printOne(pe); } // as saved (a change not yet saved is not on it)
        else if (a === "del") { keepEdit(); S.del = S.editing; S.delReason = ""; S.editErr = ""; paint(); var r = m.querySelector("#tkt-edit [name=del_reason]"); if (r) r.focus(); }
        else if (a === "del-cancel") { keepEdit(); S.del = null; S.editErr = ""; paint(); focusOn("#tkt-edit [data-act=del]"); }
        else if (a === "del-go") remove();
        else if (a === "view-open") { S.view = "open"; S.editing = null; S.edit = null; S.del = null; S.noting = null; paint(); focusOn("[data-act=view-open]"); }
        else if (a === "view-done") { S.view = "done"; S.editing = null; S.edit = null; S.del = null; S.noting = null; S.shown = PAGE; loadDone(); focusOn("[data-act=view-done]"); }
        else if (a === "more") { S.shown += PAGE; paintResults(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "tktreg"); } catch (x) {} E.openClassic("tickets"); }
      });
    });
    var qi = root.querySelector("#tkt-q");
    if (qi) {
      qi.addEventListener("input", function () { S.q = qi.value; paintResults(); });
      qi.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && qi.value) { ev.preventDefault(); qi.value = ""; S.q = ""; paintResults(); } });
    }
    var fn = root.querySelector("#tkt-note");
    if (fn) {
      fn.addEventListener("submit", function (ev) { ev.preventDefault(); addNote(fn); });
      fn.addEventListener("keydown", function (ev) { var i = fn.querySelector("input"); if (ev.key === "Escape" && !String(i && i.value || "").trim()) { ev.preventDefault(); closeNote(); } }); // Escape closes an empty note; a typed one is kept
    }
    var fe = root.querySelector("#tkt-edit");
    if (fe) {
      fe.addEventListener("submit", function (ev) { ev.preventDefault(); if (S.del) return; saveEdit(); });
      fe.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.editSaving) { keepEdit(); if (S.del) { ev.preventDefault(); S.del = null; S.editErr = ""; paint(); focusOn("#tkt-edit [data-act=del]"); } else if (editUnchanged()) { ev.preventDefault(); closeEdit(); } } });
    }
    var fa = root.querySelector("#tkt-add");
    if (fa) {
      fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(fa); });
      wireDays(fa);
      fa.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !document.querySelector(".epp-list:not([hidden])")) { var typed = ["client_name", "phone", "issue", "followup_date"].some(function (k) { var el = fa.querySelector("[name=" + k + "]"); return el && String(el.value || "").trim(); }); if (!typed || (S.carry && onlyCarried(fa))) { ev.preventDefault(); closeAdd(); } } });
    }
    if (fa && E.personPick) E.personPick.attach({ key: "tktreg", form: fa, fields: { name: "client_name", phone: "phone" },
      local: function () { return S.entries.map(function (e) { return { name: e.client_name, phone: e.phone, date: String(e.open_date || "").slice(0, 10), from: "question" }; }); } });
    root.querySelectorAll("form").forEach(function (fm) { fm.addEventListener("input", function (ev) { var el = ev.target; if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); var map = fm.id === "tkt-add" ? S.fe : S.efe; if (map && el.name) delete map[el.name]; var s = el.parentNode && el.parentNode.querySelector(".tkt-ferr"); if (s) s.remove(); } }); });
  }

  function openEdit(id) {
    if (S.editing === id) { keepEdit(); if (!editUnchanged()) { var sv = S.mount.querySelector("#tkt-edit [type=submit]"); if (sv) sv.focus(); return; } return closeEdit(); } // a second tap closes it, unless something was typed
    var e = findQ(id); if (!e) return;
    var b = bodyOf(e); S.orig = Object.assign({}, b, { priority: String(b.priority) }); S.edit = Object.assign({}, b, { priority: String(b.priority) });
    S.editing = id; S.noting = null; S.editErr = ""; S.efe = {}; S.del = null;
    paint(); var f = S.mount.querySelector("#tkt-edit [name=client_name]"); if (f) f.focus();
  }

  // One change to one question: read it again, apply the change, send it whole (the classic body). A lost answer is
  // checked against the server before it is called a failure.
  async function send(id, mutate) {
    var fresh = await reread(id);
    if (!fresh) throw new Error("This question is no longer there (deleted elsewhere?)");
    var r0 = Object.assign({}, fresh); mutate(r0);
    var body = bodyOf(r0);
    try {
      var r = await E.apiFetch("/client-tickets/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
    } catch (x) { if (!(x && x.network && await landed(id, body))) throw x; }
    return body;
  }

  async function change(id, mutate, okText) {
    if (S.busy[id]) return false;
    S.busy[id] = true; paint();
    var ok = false;
    try { await send(id, mutate); ok = true; if (okText) E.toast(okText, "success"); }
    catch (x) { S.err = E.saveFailText(x); E.toast(S.err, "error"); }
    S.busy[id] = false; if (ok) { S.noting = null; S.err = ""; } await reloadAll(); return ok;
  }
  function reloadAll() { var p = load(); return S.view === "done" ? Promise.all([p, loadDone()]) : p; }

  function addNote(f) {
    var e = findQ(S.noting); if (!e) return;
    var text = String((f.querySelector("input") || {}).value || "").trim(); S.noteDraft = text;
    if (!text) { S.err = "Write the note. Nothing was saved."; paint(); focusOn("#tkt-note input"); return; }
    var note = { ts: new Date().toISOString(), author: (E.state.user || {}).full_name || "", text: text }; // the history is kept, one note added
    var id = e.id; change(id, function (r) { r.notes_log = JSON.stringify(notes(r).concat([note])); }, "Note added").then(function (ok) { focusOn(ok ? '[data-act=note][data-id="' + id + '"]' : "#tkt-note input"); });
  }

  async function saveEdit() {
    if (S.editSaving || !S.editing) return;
    keepEdit();
    var id = S.editing, a = S.edit, o = S.orig || {};
    var t = function (k) { return String(a[k] == null ? "" : a[k]).trim(); };
    var fe = {};
    if (!t("client_name")) fe.client_name = "Write the customer's name.";
    if (t("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t("email"))) fe.email = "Check the email: it should look like name@example.com.";
    if (!t("issue")) fe.issue = "Write what they asked.";
    if (!t("category")) fe.category = "Choose what it is about.";
    if (t("followup_date") && !isYmd(t("followup_date"))) fe.followup_date = "Choose a follow-up day, or leave it empty.";
    if (!isYmd(t("open_date"))) fe.open_date = "Choose the day it was opened.";
    S.efe = fe; S.editErr = sumUp(fe);
    if (S.editErr) { paint(); focusOn("#tkt-edit [name=" + Object.keys(fe)[0] + "]"); return; }
    S.editSaving = true; paint();
    try {
      await send(id, function (r) {
        EDIT.forEach(function (k) { var v = k === "priority" ? Number(a[k]) : t(k), was = k === "priority" ? Number(o[k]) : String(o[k] == null ? "" : o[k]).trim(); if (String(v) !== String(was)) r[k] = v; }); // only what changed here
        if (r.status !== "Resolved" && r.status !== "Closed") r.resolved_at = "";
      });
      E.toast(a.client_name + "'s question is saved", "success"); S.editing = null; S.edit = null; S.editErr = ""; S.efe = {};
    } catch (x) { S.editErr = E.saveFailText(x); S.editSaving = false; return paint(); }
    S.editSaving = false; await reloadAll(); focusOn('[data-act=open][data-id="' + id + '"]');
  }

  // Delete (pharmacist only): the reason goes in as a note (the classic body), then the question is deleted.
  async function remove() {
    if (S.editSaving || !S.editing || !isAdmin()) return;
    keepEdit();
    var id = S.editing, reason = String(S.delReason || "").trim();
    if (!reason) { S.editErr = "Write why it is being deleted. Nothing was deleted."; paint(); var r0 = S.mount.querySelector("#tkt-edit [name=del_reason]"); if (r0) r0.focus(); return; }
    S.editSaving = true; S.editErr = ""; paint();
    try {
      var note = { ts: new Date().toISOString(), author: (E.state.user || {}).full_name || "", text: "Deleted: " + reason };
      await send(id, function (r) { r.notes_log = JSON.stringify(notes(r).concat([note])); });
      try {
        var r2 = await E.apiFetch("/client-tickets/entries/" + encodeURIComponent(String(id)), { method: "DELETE" }); // the classic screen's call
        if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Delete failed");
      } catch (x2) { var gone = false; if (x2 && x2.network) { try { gone = !(await reread(id)); } catch (e3) { gone = false; } } if (!gone) throw x2; }
      E.toast("Question deleted", "success"); S.editing = null; S.edit = null; S.del = null;
    } catch (x) { S.editErr = E.saveFailText(x).replace(/^Not saved/, "Not deleted"); S.editSaving = false; return paint(); }
    S.editSaving = false; return reloadAll();
  }

  async function add(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { ticket_id: "", open_date: today(), client_name: v("client_name"), phone: v("phone"), email: "", issue: v("issue"), category: v("category"), priority: Number(v("priority") || 2), status: "Open", assigned_to: "", followup_date: v("followup_date") || null, notes_log: "[]" };
    S.adding = Object.assign({}, body, { priority: String(body.priority), followup_date: body.followup_date || "" }); S.err = "";
    var fe = {};
    if (!body.client_name) fe.client_name = "Write the customer's name.";
    if (!body.issue) fe.issue = "Write what they asked.";
    S.fe = fe; S.err = sumUp(fe);
    if (S.err) { paint(); focusOn("#tkt-add [name=" + Object.keys(fe)[0] + "]"); return; }
    body.ticket_id = nextId();
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/client-tickets/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; S.carry = null; S.fe = {}; setLastCat(body.category); E.toast("Saved · question for " + body.client_name + " · " + body.ticket_id, "success"); var added = true;
      if (E.linkPerson) E.linkPerson({ name: body.client_name, phone: body.phone }, "register:questions"); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; await load();
    if (added) focusOn(".tkt-top [data-act=add]"); // the next question is one key away
  }

  E.registerModule({
    id: "tktreg", title: "Questions", order: 3, icon: "?", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.noting = null; S.err = ""; S.editing = null; S.edit = null; S.del = null; S.editErr = ""; S.editSaving = false; S.view = "open"; S.done = []; S.q = ""; S.fe = {}; S.efe = {};
      // From a customer's page: a new question for them, or (from the count of their questions) their questions.
      var hand = E.takeCustomerHandoff ? E.takeCustomerHandoff("tktreg") : null;
      S.carry = hand && hand.mode === "new" ? hand : null;
      if (hand && hand.mode === "find") S.q = String(hand.person.name);
      if (S.carry) S.adding = {};
      css(); paint(); if (S.carry) fillCarry(); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("tktreg") < 0) E.UI2_DESTINATIONS.push("tktreg");
  if (E.UI2_PARENT) E.UI2_PARENT.tktreg = "customers";
})();
