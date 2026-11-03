/* Customer questions, new layout: open questions by priority and follow-up date, the customer's number to call, the
   latest note; add a note, mark resolved, record a new question. Same endpoints as the classic screen; the update keeps
   fields it is not sent (UPDATE-AUDIT.md: PARTIAL). Numbers come from the same per-browser counter as the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, noting: null, saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var PRI = { 1: "High", 2: "Medium", 3: "Low" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function daysUntil(s) { var p = String(s).split("-"); var t = new Date(); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function when(s) { var n = daysUntil(s); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; var p = s.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1]; }
  function notes(e) { try { var a = typeof e.notes_log === "string" ? JSON.parse(e.notes_log || "[]") : e.notes_log; return Array.isArray(a) ? a : []; } catch (x) { return []; } }
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
      "@media (max-width:600px){.tkt{padding:4px 16px 0}.tkt h1{font-size:32px}}";
    document.head.appendChild(st);
  }

  async function load() {
    S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/client-tickets/entries?resolved=0", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load questions");
      S.entries = (r.entries || []).filter(function (e) { return !Number(e.resolved) && e.status !== "Resolved" && e.status !== "Closed"; })
        .sort(function (a, b) { return (Number(a.priority) || 2) - (Number(b.priority) || 2) || String(a.followup_date || "9") .localeCompare(String(b.followup_date || "9")) || String(a.open_date).localeCompare(String(b.open_date)); });
    } catch (e) { S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load questions"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function cardHtml(e) {
    var n = e.followup_date ? daysUntil(e.followup_date) : null, last = notes(e).slice(-1)[0];
    var cls = Number(e.priority) === 1 ? "hi" : n != null && n <= 0 ? "due" : "";
    var sub = []; if (e.phone) sub.push('<a href="tel:' + esc(String(e.phone).replace(/\s+/g, "")) + '">' + esc(e.phone) + "</a>");
    if (e.category) sub.push(esc(e.category)); if (e.assigned_to) sub.push("With " + esc(e.assigned_to)); sub.push(esc(e.status || "Open"));
    var h = '<div class="tkt-card ' + cls + '"><div class="h"><b>' + esc(e.client_name) + "</b><span>" + esc(e.ticket_id || "") + " · opened " + esc(when(e.open_date)) + "</span>" +
      (n != null ? '<span class="tkt-pill ' + (n < 0 ? "late" : n === 0 ? "due" : "") + '">Follow up ' + esc(when(e.followup_date)) + "</span>" : "") +
      (Number(e.priority) === 1 ? '<span class="tkt-pill late">High</span>' : "") + "</div>" +
      '<div class="i">' + esc(e.issue) + '</div><div class="s">' + sub.join(" · ") + "</div>" +
      (last ? '<div class="n"><small>' + esc((last.author || "") + (last.ts ? " · " + when(String(last.ts).slice(0, 10)) : "")) + "</small>" + esc(last.text || "") + "</div>" : "");
    if (S.noting === e.id) h += '<form class="tkt-in" id="tkt-note" autocomplete="off"><label><input name="text" placeholder="What happened, e.g. Called, will come Friday" value="' + esc(S.noteDraft || "") + '"></label>' + (S.err ? '<div class="tkt-err">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="tkt-btn" data-act="note-cancel">Cancel</button><button type="submit" class="tkt-btn p"' + (S.busy[e.id] ? " disabled" : "") + ">Add note</button></div></form>";
    else h += '<div class="a"><button class="tkt-btn" data-act="note" data-id="' + e.id + '">Add a note</button><button class="tkt-btn p" data-act="resolve" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">Resolved</button></div>";
    return h + "</div>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "tktreg") return; // left before a reply came back: do not draw over the next screen
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
    if (S.loading && !S.entries.length) h += '<div class="tkt-quiet">Opening questions…</div>';
    else if (S.error) h += '<div class="tkt-quiet">' + esc(S.error) + "</div>";
    else h += S.entries.length ? '<div class="tkt-lab">Open <b>' + S.entries.length + "</b></div>" + S.entries.map(cardHtml).join("") : '<div class="tkt-quiet">No customer is waiting for an answer.</div>';
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changing a question, assigning it, deleting and resolved questions are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = "#customers";
        else if (a === "add") { S.adding = {}; S.err = ""; paint(); }
        else if (a === "add-cancel") { S.adding = null; S.err = ""; paint(); }
        else if (a === "note") { S.noting = id; S.noteDraft = ""; S.err = ""; paint(); setTimeout(function () { var f = m.querySelector("#tkt-note input"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "note-cancel") { S.noting = null; S.err = ""; paint(); }
        else if (a === "resolve") update(id, { status: "Resolved" }, "Marked resolved");
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "tktreg"); } catch (x) {} E.openClassic("tickets"); }
      });
    });
    var fn = m.querySelector("#tkt-note"); if (fn) fn.addEventListener("submit", function (ev) { ev.preventDefault(); addNote(fn); });
    var fa = m.querySelector("#tkt-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(fa); });
  }

  async function update(id, body, okText) {
    if (S.busy[id]) return;
    S.busy[id] = true; paint();
    var ok = false;
    try {
      var r = await E.apiFetch("/client-tickets/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      ok = true; if (okText) E.toast(okText, "success");
    } catch (x) { S.err = E.saveFailText(x); E.toast(S.err, "error"); }
    S.busy[id] = false; if (ok) { S.noting = null; S.err = ""; } await load(); return ok;
  }
  function addNote(f) {
    var e = S.entries.find(function (x) { return x.id === S.noting; }); if (!e) return;
    var text = String((f.querySelector("input") || {}).value || "").trim(); S.noteDraft = text;
    if (!text) { S.err = "Write the note. Nothing was saved."; return paint(); }
    var log = notes(e).concat([{ ts: new Date().toISOString(), author: (E.state.user || {}).full_name || "", text: text }]); // the history is kept, one note added
    update(e.id, { notes_log: JSON.stringify(log) }, "Note added");
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
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "tktreg", title: "Questions", order: 3, icon: "?", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.noting = null; S.err = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("tktreg") < 0) E.UI2_DESTINATIONS.push("tktreg");
  if (E.UI2_PARENT) E.UI2_PARENT.tktreg = "customers";
})();
