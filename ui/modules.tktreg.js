/* Customer questions, new layout: open questions by priority and follow-up date, the customer's number to call, the
   latest note; add a note, mark resolved, record a new question. Same endpoints as the classic screen; the update keeps
   fields it is not sent (UPDATE-AUDIT.md: PARTIAL), but every change here sends what the classic screen sends: the whole
   question as read again from the server, with only the change made here different. Open one to change it, assign it
   or set its status; "Done" lists resolved and closed ones, 20 at a time; delete is for the pharmacist, with a reason
   written as a note first so the audit's copy carries it. Numbers come from the same per-browser counter as the classic screen. */
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
      ".tkt-q{width:100%;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 12px;outline:0;margin-top:12px}" +
      ".tkt-name{border:0;background:none;padding:0;font:inherit;color:inherit;text-align:left;cursor:pointer}.tkt-name:hover b,.tkt-name:focus-visible b{text-decoration:underline}" +
      ".tkt-ed label>span{flex:0 0 88px;font-size:15px}.tkt-ed select,.tkt-ed textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}.tkt-ed textarea{resize:vertical;min-height:44px}" +
      ".tkt-in .acts.l{justify-content:space-between}.tkt-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.tkt-btn.dd{background:#B42318;border-color:#B42318;color:#fff}" +
      ".tkt-meta{font-size:12.5px;color:var(--muted);padding:6px 14px 2px}.tkt-more{display:flex;justify-content:center;margin-top:6px}" +
      "@media (max-width:600px){.tkt{padding:4px 16px 0}.tkt h1{font-size:32px}}";
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

  function cardHtml(e) {
    var done = isDone(e);
    var n = e.followup_date && !done ? daysUntil(e.followup_date) : null, last = notes(e).slice(-1)[0];
    var cls = done ? "" : Number(e.priority) === 1 ? "hi" : n != null && n <= 0 ? "due" : "";
    var sub = []; if (e.phone) sub.push('<a href="tel:' + esc(String(e.phone).replace(/\s+/g, "")) + '">' + esc(e.phone) + "</a>");
    if (e.category) sub.push(esc(e.category)); if (e.assigned_to) sub.push("With " + esc(e.assigned_to)); sub.push(esc(e.status || "Open"));
    if (done && e.resolved_at) sub.push("closed " + esc(when(String(e.resolved_at).slice(0, 10))));
    var h = '<div class="tkt-card ' + cls + '"><div class="h"><button type="button" class="tkt-name" data-act="open" data-id="' + e.id + '" aria-expanded="' + (S.editing === e.id ? "true" : "false") + '" aria-label="' + esc("Open the question from " + e.client_name) + '"><b>' + esc(e.client_name) + "</b></button><span>" + esc(e.ticket_id || "") + " · opened " + esc(when(e.open_date)) + "</span>" +
      (n != null ? '<span class="tkt-pill ' + (n < 0 ? "late" : n === 0 ? "due" : "") + '">Follow up ' + esc(when(e.followup_date)) + "</span>" : "") +
      (Number(e.priority) === 1 && !done ? '<span class="tkt-pill late">High</span>' : "") + "</div>" +
      '<div class="i">' + esc(e.issue) + '</div><div class="s">' + sub.join(" · ") + "</div>" +
      (last ? '<div class="n"><small>' + esc((last.author || "") + (last.ts ? " · " + when(String(last.ts).slice(0, 10)) : "")) + "</small>" + esc(last.text || "") + "</div>" : "");
    if (S.editing === e.id) h += editHtml(e);
    else if (S.noting === e.id) h += '<form class="tkt-in" id="tkt-note" autocomplete="off"><label><input name="text" aria-label="Note" placeholder="What happened, e.g. Called, will come Friday" value="' + esc(S.noteDraft || "") + '"></label>' + (S.err ? '<div class="tkt-err">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="tkt-btn" data-act="note-cancel">Cancel</button><button type="submit" class="tkt-btn p"' + (S.busy[e.id] ? " disabled" : "") + ">Add note</button></div></form>";
    else if (done) h += '<div class="a"><button class="tkt-btn" data-act="reopen" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Open again") + "</button></div>";
    else h += '<div class="a"><button class="tkt-btn" data-act="note" data-id="' + e.id + '">Add a note</button><button class="tkt-btn p" data-act="resolve" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : "Resolved") + "</button></div>";
    return h + "</div>";
  }

  function editHtml(e) {
    var a = S.edit || {}, f = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '"' + (extra || "") + "></label>"; };
    var cs = cats(); if (a.category && cs.indexOf(a.category) < 0) cs = cs.concat([a.category]);
    var st = staff(); if (a.assigned_to && st.indexOf(a.assigned_to) < 0) st = st.concat([a.assigned_to]);
    var h = '<form class="tkt-in tkt-ed" id="tkt-edit" autocomplete="off" aria-label="' + esc("Change the question from " + e.client_name) + '">' +
      f("client_name", "Customer", ' placeholder="Name and surname"') + f("phone", "Phone", ' type="tel" placeholder="Optional"') + f("email", "Email", ' type="email" placeholder="Optional"') +
      '<label><span>Question</span><textarea name="issue" rows="2">' + esc(a.issue || "") + "</textarea></label>" +
      '<label><span>About</span><select name="category">' + cs.map(function (c) { return "<option" + (c === a.category ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>Priority</span><select name="priority"><option value="1"' + (String(a.priority) === "1" ? " selected" : "") + '>High</option><option value="2"' + (String(a.priority) === "2" ? " selected" : "") + '>Medium</option><option value="3"' + (String(a.priority) === "3" ? " selected" : "") + ">Low</option></select></label>" +
      '<label><span>Status</span><select name="status">' + STATUSES.map(function (c) { return "<option" + (c === a.status ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>With</span><select name="assigned_to"><option value="">Nobody yet</option>' + st.map(function (c) { return "<option" + (c === a.assigned_to ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
      f("followup_date", "Follow up", ' type="date"') + f("open_date", "Opened", ' type="date"') +
      (S.editErr ? '<div class="tkt-err" role="alert">' + esc(S.editErr) + "</div>" : "");
    if (S.del === e.id) {
      h += '<label><span>Why delete</span><input name="del_reason" value="' + esc(S.delReason || "") + '" placeholder="e.g. Recorded twice"></label>' +
        '<div class="tkt-meta">This removes the question for good. The reason is added as a note first, so it stays in the audit.</div>' +
        '<div class="acts"><button type="button" class="tkt-btn" data-act="del-cancel">Keep it</button><button type="button" class="tkt-btn dd" data-act="del-go"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Deleting…" : "Delete question") + "</button></div>";
    } else {
      h += '<div class="acts l">' + (isAdmin() ? '<button type="button" class="tkt-btn d" data-act="del">Delete…</button>' : "<span></span>") +
        '<span style="display:flex;gap:8px"><button type="button" class="tkt-btn" data-act="edit-cancel">Close</button><button type="submit" class="tkt-btn p"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Saving…" : "Save changes") + "</button></span></div>";
    }
    return h + "</form>";
  }

  function keepEdit() { // what is typed in the open question survives a redraw
    var f = S.mount && S.mount.querySelector("#tkt-edit"); if (!f || !S.edit) return;
    EDIT.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.edit[k] = String(el.value || ""); });
    var r = f.querySelector("[name=del_reason]"); if (r) S.delReason = String(r.value || "");
    var n = S.mount.querySelector("#tkt-note input"); if (n) S.noteDraft = String(n.value || "");
  }

  function matchQ(e) { var q = String(S.q || "").trim().toLowerCase(); return !q || [e.client_name, e.phone, e.issue, e.ticket_id, e.category, e.assigned_to].some(function (v) { return String(v || "").toLowerCase().indexOf(q) >= 0; }); }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "tktreg") return; // left before a reply came back: do not draw over the next screen
    if (!S.editSaving) keepEdit();
    var h = '<div class="tkt"><button class="tkt-back" data-act="back">‹ Customers</button>' +
      '<div class="tkt-top"><div><h1>Questions</h1><p class="tkt-sub">Customers waiting for an answer, most pressing first.</p></div>' + (S.adding ? "" : '<button class="tkt-btn p" data-act="add">New question</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="tkt-form" id="tkt-add" autocomplete="off"><label><span>Customer</span><input name="client_name" value="' + esc(a.client_name || "") + '" placeholder="Name and surname"></label>' +
        '<label><span>Phone</span><input name="phone" type="tel" value="' + esc(a.phone || "") + '" placeholder="Optional"></label>' +
        '<label><span>Question</span><input name="issue" value="' + esc(a.issue || "") + '" placeholder="What they asked"></label>' +
        '<label><span>About</span><select name="category">' + cats().map(function (c) { return '<option' + (c === (a.category || "General Enquiry") ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></label>" +
        '<label><span>Priority</span><select name="priority"><option value="2">Medium</option><option value="1"' + (String(a.priority) === "1" ? " selected" : "") + '>High</option><option value="3"' + (String(a.priority) === "3" ? " selected" : "") + ">Low</option></select></label>" +
        '<label><span>Follow up</span><input name="followup_date" type="date" min="' + esc(today()) + '" value="' + esc(a.followup_date || "") + '"></label>' +
        (S.err && !S.noting ? '<div class="tkt-err">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="tkt-btn" data-act="add-cancel">Cancel</button><button type="submit" class="tkt-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Record") + "</button></div></form>";
    }
    h += '<div class="tkt-tabs" role="group" aria-label="Which questions"><button type="button" data-act="view-open" aria-pressed="' + (S.view === "open") + '">Open</button><button type="button" data-act="view-done" aria-pressed="' + (S.view === "done") + '">Done</button></div>';
    var list = S.view === "done" ? S.done : S.entries;
    if (list.length > 8 || S.q) h += '<input class="tkt-q" aria-label="Search questions" id="tkt-q" type="search" placeholder="Search customer, phone, question or number" value="' + esc(S.q) + '">';
    if (S.view === "done") {
      var dn = S.done.filter(matchQ);
      if (S.doneLoading && !S.done.length) h += '<div class="tkt-quiet">Opening questions…</div>';
      else if (S.doneError) h += '<div class="tkt-quiet">' + esc(S.doneError) + "</div>";
      else if (!dn.length) h += '<div class="tkt-quiet">' + (S.q ? "No resolved question matches “" + esc(S.q) + "”." : "No question has been resolved yet.") + "</div>";
      else {
        h += '<div class="tkt-lab">Resolved and closed <b>' + dn.length + "</b></div>" + dn.slice(0, S.shown).map(cardHtml).join("");
        if (dn.length > S.shown) h += '<div class="tkt-more"><button class="tkt-btn" data-act="more">Show ' + Math.min(PAGE, dn.length - S.shown) + " more</button></div>";
      }
    } else {
      var op = S.entries.filter(matchQ);
      if (S.loading && !S.entries.length) h += '<div class="tkt-quiet">Opening questions…</div>';
      else if (S.error) h += '<div class="tkt-quiet">' + esc(S.error) + "</div>";
      else h += op.length ? '<div class="tkt-lab">Open <b>' + op.length + "</b></div>" + op.map(cardHtml).join("") : '<div class="tkt-quiet">' + (S.q ? "No open question matches “" + esc(S.q) + "”." : "No customer is waiting for an answer.") + "</div>";
    }
    h += E.months.history("tktreg", E.months.preset("questions", { paint: function () { paint(); }, dep: function () { return S.loading ? undefined : S.entries; } })); // every question of a month, answered or not, and its printout (eikon.months.js)
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Printing a question, an email to the customer and new categories or staff names are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, backTo = ae && m.contains(ae) && ae.closest && ae.closest("#tkt-edit") && ae.name ? ae.name : "";
    m.innerHTML = h;
    E.months.wireHistory(m, "tktreg");
    if (backTo) { var again = m.querySelector("#tkt-edit [name=" + backTo + "]"); if (again) again.focus(); }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = "#customers";
        else if (a === "add") { S.adding = {}; S.err = ""; paint(); }
        else if (a === "add-cancel") { S.adding = null; S.err = ""; paint(); }
        else if (a === "note") { S.noting = id; S.noteDraft = ""; S.err = ""; S.editing = null; S.edit = null; paint(); setTimeout(function () { var f = m.querySelector("#tkt-note input"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "note-cancel") { S.noting = null; S.err = ""; paint(); }
        else if (a === "resolve") change(id, function (r) { r.status = "Resolved"; }, "Marked resolved");
        else if (a === "reopen") change(id, function (r) { r.status = "Open"; r.resolved_at = ""; }, "Open again");
        else if (a === "open") openEdit(id);
        else if (a === "edit-cancel") { S.editing = null; S.edit = null; S.editErr = ""; S.del = null; paint(); }
        else if (a === "del") { keepEdit(); S.del = S.editing; S.delReason = ""; S.editErr = ""; paint(); var r = m.querySelector("#tkt-edit [name=del_reason]"); if (r) r.focus(); }
        else if (a === "del-cancel") { keepEdit(); S.del = null; S.editErr = ""; paint(); }
        else if (a === "del-go") remove();
        else if (a === "view-open") { S.view = "open"; S.editing = null; S.edit = null; S.del = null; S.noting = null; paint(); }
        else if (a === "view-done") { S.view = "done"; S.editing = null; S.edit = null; S.del = null; S.noting = null; S.shown = PAGE; loadDone(); }
        else if (a === "more") { S.shown += PAGE; paint(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "tktreg"); } catch (x) {} E.openClassic("tickets"); }
      });
    });
    var qi = m.querySelector("#tkt-q"); if (qi) qi.addEventListener("input", function () { var pos = qi.selectionStart; S.q = qi.value; paint(); var q2 = S.mount.querySelector("#tkt-q"); if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} } });
    var fn = m.querySelector("#tkt-note"); if (fn) fn.addEventListener("submit", function (ev) { ev.preventDefault(); addNote(fn); });
    var fe = m.querySelector("#tkt-edit"); if (fe) fe.addEventListener("submit", function (ev) { ev.preventDefault(); if (S.del) return; saveEdit(); });
    var fa = m.querySelector("#tkt-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(fa); });
    if (fa && E.personPick) E.personPick.attach({ key: "tktreg", form: fa, fields: { name: "client_name", phone: "phone" },
      local: function () { return S.entries.map(function (e) { return { name: e.client_name, phone: e.phone, date: String(e.open_date || "").slice(0, 10), from: "question" }; }); } });
  }

  function openEdit(id) {
    if (S.editing === id) { S.editing = null; S.edit = null; S.del = null; S.editErr = ""; return paint(); }
    var e = findQ(id); if (!e) return;
    var b = bodyOf(e); S.orig = b; S.edit = Object.assign({}, b, { priority: String(b.priority) });
    S.editing = id; S.noting = null; S.editErr = ""; S.del = null;
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
  function reloadAll() { var p = load(); if (S.view === "done") loadDone(); return p; }

  function addNote(f) {
    var e = findQ(S.noting); if (!e) return;
    var text = String((f.querySelector("input") || {}).value || "").trim(); S.noteDraft = text;
    if (!text) { S.err = "Write the note. Nothing was saved."; return paint(); }
    var note = { ts: new Date().toISOString(), author: (E.state.user || {}).full_name || "", text: text }; // the history is kept, one note added
    change(e.id, function (r) { r.notes_log = JSON.stringify(notes(r).concat([note])); }, "Note added");
  }

  async function saveEdit() {
    if (S.editSaving || !S.editing) return;
    keepEdit();
    var id = S.editing, a = S.edit, o = S.orig || {};
    var t = function (k) { return String(a[k] == null ? "" : a[k]).trim(); };
    S.editErr = "";
    if (!t("client_name")) S.editErr = "Write the customer's name. Nothing was saved.";
    else if (!t("issue")) S.editErr = "Write what they asked. Nothing was saved.";
    else if (!t("category")) S.editErr = "Choose what it is about. Nothing was saved.";
    else if (!isYmd(t("open_date"))) S.editErr = "Choose the day it was opened. Nothing was saved.";
    else if (t("followup_date") && !isYmd(t("followup_date"))) S.editErr = "Choose a follow-up day, or leave it empty. Nothing was saved.";
    else if (t("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t("email"))) S.editErr = "The email does not look right. Nothing was saved.";
    if (S.editErr) return paint();
    S.editSaving = true; paint();
    try {
      await send(id, function (r) {
        EDIT.forEach(function (k) { var v = k === "priority" ? Number(a[k]) : t(k), was = k === "priority" ? Number(o[k]) : String(o[k] == null ? "" : o[k]).trim(); if (String(v) !== String(was)) r[k] = v; }); // only what changed here
        if (r.status !== "Resolved" && r.status !== "Closed") r.resolved_at = "";
      });
      E.toast("Saved", "success"); S.editing = null; S.edit = null; S.editErr = "";
    } catch (x) { S.editErr = E.saveFailText(x); S.editSaving = false; return paint(); }
    S.editSaving = false; return reloadAll();
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
    S.adding = body; S.err = "";
    if (!body.client_name) S.err = "Write the customer's name. Nothing was saved.";
    else if (!body.issue) S.err = "Write what they asked. Nothing was saved.";
    if (S.err) return paint();
    body.ticket_id = nextId();
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/client-tickets/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Question recorded · " + body.ticket_id, "success");
      if (E.linkPerson) E.linkPerson({ name: body.client_name, phone: body.phone }, "register:questions"); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "tktreg", title: "Questions", order: 3, icon: "?", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.noting = null; S.err = ""; S.editing = null; S.edit = null; S.del = null; S.editErr = ""; S.editSaving = false; S.view = "open"; S.done = []; S.q = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("tktreg") < 0) E.UI2_DESTINATIONS.push("tktreg");
  if (E.UI2_PARENT) E.UI2_PARENT.tktreg = "customers";
})();
