/* Returns, new layout: each return as four steps (arranged, handed over, collection note, credit note), grouped by
   what it waits for; tick the next step in one tap. Same endpoints as the classic screen. Saving sends the whole record
   back unchanged except the step (the server's update replaces every field, so nothing may be left out).
   New return: the classic New + Save body (every field, the four steps and refused/damaged at 0), POST /returns/entries.
   Edits, refused/damaged and deleting stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, saving: false, err: "", errAt: "" };
  // The classic screen's remark suggestions (the same words, so the stored remarks stay the same).
  var REMARKS = ["Wrong Pick", "Expiring soon", "Damaged", "Wrong quantity", "Received late", "Duplicate order"];
  var NEW = ["description", "quantity", "supplier", "remarks", "expiry", "batch", "invoice_number", "location_stored", "entry_date"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var STEPS = [["return_arranged", "Arranged"], ["handed_over", "Handed over"], ["collection_note_received", "Collection note"], ["credit_note_received", "Credit note"]];
  var GROUPS = [["arrange", "To arrange"], ["collect", "Waiting for collection"], ["note", "Waiting for the collection note"], ["credit", "Waiting for the credit note"], ["stopped", "Refused or damaged"], ["done", "Credited (last 60 days)"]];
  // Every field the server's update writes; sent back as read so nothing is blanked.
  var FIELDS = ["entry_date", "description", "expiry", "batch", "quantity", "supplier", "invoice_number", "remarks", "location_stored",
    "return_arranged", "handed_over", "collection_note_received", "credit_note_received", "supplier_refused", "damaged"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function nice(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function on(e, k) { return Number(e[k]) === 1; }
  function group(e) {
    if (on(e, "credit_note_received")) return "done";
    if (on(e, "supplier_refused") || on(e, "damaged")) return "stopped";
    if (!on(e, "return_arranged")) return "arrange";
    if (!on(e, "handed_over")) return "collect";
    if (!on(e, "collection_note_received")) return "note";
    return "credit";
  }
  function nextStep(e) { for (var i = 0; i < STEPS.length; i++) if (!on(e, STEPS[i][0])) return STEPS[i]; return null; }

  function css() {
    if (document.getElementById("eikon-retreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-retreg-css";
    st.textContent =
      ".rtn{max-width:880px;margin:0 auto}" +
      ".rtn-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".rtn h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.rtn-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".rtn-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".rtn-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.rtn-btn:disabled{opacity:.55;cursor:default}" +
      ".rtn-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.rtn-lab b{color:var(--text)}" +
      ".rtn-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".rtn-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:.5px solid var(--border)}.rtn-row:first-child{border-top:0}" +
      ".rtn-row .t{flex:1;min-width:0}.rtn-row b{display:block;font-size:15px;font-weight:600}.rtn-row span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".rtn-steps{display:flex;gap:4px;margin-top:7px;flex-wrap:wrap}.rtn-steps i{font-style:normal;font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:999px;background:rgba(127,127,127,.12);color:var(--muted)}" +
      ".rtn-steps i.ok{background:rgba(10,143,106,.12);color:var(--accent)}.rtn-steps i.bad{background:rgba(215,38,28,.12);color:var(--danger)}" +
      ".rtn-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.rtn{padding:4px 16px 0}.rtn h1{font-size:32px}.rtn-row{flex-wrap:wrap;row-gap:8px}.rtn-row .t{flex-basis:100%}.rtn-row .rtn-btn{margin-left:auto}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".rtn-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.rtn-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".rtn-quiet .rtn-btn{margin-top:12px;display:block}" +
      "@media (max-width:600px){.rtn-btn,.rtn-btn.s{height:44px;border-radius:22px}}" +
      // b4-6a: a new return in place.
      ".rtn-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".rtn-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".rtn-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.rtn-form label:first-child{border-top:0}" +
      ".rtn-form label>span{flex:0 0 112px;font-size:15px}.rtn-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".rtn-form input{font-feature-settings:\"calt\" 0}" +
      ".rtn-form label:focus-within{box-shadow:inset 3px 0 0 var(--accent)}" +
      ".rtn-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}.rtn-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".rtn-quiet>.rtn-btn.p{display:inline-block;margin-top:0}" +
      "@media (max-width:600px){.rtn-form label>span{flex-basis:100px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      // open=1: unfinished returns plus the last 60 days (a server without it returns everything; the list below copes).
      var r = await E.apiFetch("/returns/entries?open=1", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load returns");
      var cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      S.entries = (r.entries || []).filter(function (e) { return !on(e, "credit_note_received") || String(e.entry_date) >= cutoff; })
        .sort(function (a, b) { return String(a.entry_date) < String(b.entry_date) ? -1 : 1; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load returns"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function rowHtml(e) {
    var nx = nextStep(e), g = group(e), sub = [];
    if (e.supplier) sub.push(e.supplier); if (e.quantity) sub.push("Qty " + e.quantity); if (e.expiry) sub.push("Expires " + nice(e.expiry)); sub.push("Added " + nice(e.entry_date));
    var steps = STEPS.map(function (s) { return '<i class="' + (on(e, s[0]) ? "ok" : "") + '">' + (on(e, s[0]) ? "✓ " : "") + s[1] + "</i>"; }).join("");
    if (on(e, "supplier_refused")) steps += '<i class="bad">Supplier refused</i>'; if (on(e, "damaged")) steps += '<i class="bad">Damaged</i>';
    return '<div class="rtn-row"><div class="t"><b>' + esc(e.description) + "</b><span>" + esc(sub.join(" · ")) + '</span><div class="rtn-steps">' + steps + "</div></div>" +
      (nx && g !== "stopped" ? '<button class="rtn-btn' + (g === "arrange" ? " p" : "") + '" data-act="step" data-id="' + e.id + '" data-k="' + nx[0] + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Saving…" : ({ return_arranged: "Mark arranged", handed_over: "Mark handed over", collection_note_received: "Got the collection note", credit_note_received: "Got the credit note" })[nx[0]]) + "</button>" : "") + "</div>";
  }

  // Every return recorded in a month (any month), and the classic printout of it.
  var HIST = { dep: function () { return S.loading ? undefined : S.entries; }, title: "By month", label: "Returns recorded", active: function () { return E.state.activeModuleId === "retreg"; }, paint: function () { paint(); },
    fetch: async function (ym) { var r = await E.apiFetch("/returns/entries?month=" + encodeURIComponent(ym), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load returns"); return (r.entries || []).slice().sort(function (a, b) { return String(b.entry_date).localeCompare(String(a.entry_date)) || b.id - a.id; }); },
    row: function (e) { return { t: e.description || "", s: [E.months.dmy(e.entry_date), e.supplier, e.quantity ? "Qty " + e.quantity : "", on(e, "credit_note_received") ? "Credit note received" : on(e, "collection_note_received") ? "Collection note received" : on(e, "handed_over") ? "Handed over" : on(e, "return_arranged") ? "Arranged" : "Not arranged yet"].filter(Boolean).join(" · ") }; },
    print: function (ym, rows) {
      var f = function (v) { return String(v) === "1" || v === 1 || v === true; };
      E.months.print({ register: "Returns", month: ym, landscape: true, sections: [{ cols: ["Date", "Description", "Expiry", "Batch", "Invoice #", "Remarks", "Location stored", "Checklist"],
        rows: rows.slice().reverse().map(function (r) {
          var fl = []; if (f(r.return_arranged)) fl.push("Return arranged"); if (f(r.handed_over)) fl.push("Handed over"); if (f(r.collection_note_received)) fl.push("Collection note"); if (f(r.credit_note_received)) fl.push("Credit note");
          return [E.months.dmy(r.entry_date), { html: "<b>" + esc(r.description || "") + "</b><br>" + (r.quantity ? "Qty: " + esc(r.quantity) + " • " : "") + (r.supplier ? "Supplier: " + esc(r.supplier) + " • " : "") + "ID: " + esc(r.id || "") },
            r.expiry || "", r.batch || "", r.invoice_number || "", r.remarks || "", r.location_stored || "", fl.join(" • ")];
        }) }] });
    } };
  // The new-return form: what the classic Details panel asks, most used first; the date is today unless changed.
  function formHtml() {
    var a = S.adding, fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (S.errAt === k ? ' aria-invalid="true" aria-describedby="rtn-err"' : "") + (extra || "") + "></label>"; };
    var sups = [], seen = {}; S.entries.forEach(function (e) { var k = String(e.supplier || "").trim().toLowerCase(); if (k && !seen[k]) { seen[k] = 1; sups.push(e.supplier); } });
    return '<form class="rtn-form" id="rtn-add" autocomplete="off" aria-label="New return">' + fld("description", "Item", ' placeholder="e.g. Augmentin 625 x14"') + fld("quantity", "How many", ' inputmode="numeric" placeholder="Optional"') +
      fld("supplier", "Supplier", ' list="rtn-sups" placeholder="Optional"') + fld("remarks", "Why", ' list="rtn-why" placeholder="e.g. Expiring soon"') + fld("expiry", "Expiry", ' type="date"') +
      fld("batch", "Batch", ' placeholder="Optional"') + fld("invoice_number", "Invoice no.", ' placeholder="Optional"') + fld("location_stored", "Kept in", ' placeholder="e.g. Back room"') + fld("entry_date", "Date", ' type="date"') +
      (S.err ? '<div class="rtn-err" id="rtn-err" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="rtn-btn" data-act="add-cancel">Cancel</button><button type="submit" class="rtn-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save return") + "</button></div>" +
      '<datalist id="rtn-sups">' + sups.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + '</datalist><datalist id="rtn-why">' + REMARKS.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
  }
  function keep() {
    var f = S.mount && S.mount.querySelector("#rtn-add"); if (!f || !S.adding) return;
    NEW.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || ""); });
  }
  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "retreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && fromState !== true) keep(); // a reply landing while someone types must not wipe the form
    var empty = !S.loading && !S.error && !S.entries.length, addBtn = '<button type="button" class="rtn-btn p" data-act="add">New return</button>';
    var head = '<h1>Returns</h1><p class="rtn-sub">Stock going back to suppliers, step by step until the credit note.</p>';
    // Empty: the heading stands alone, so New return in the empty box is the screen's main button (N opens it).
    var h = '<div class="rtn"><button class="rtn-back" data-act="back">' + esc(E.ui2BackLabel("retreg")) + "</button>" + (S.adding || empty ? head : '<div class="rtn-top"><div>' + head + "</div>" + addBtn + "</div>");
    if (S.adding) h += formHtml();
    if (S.loading && !S.entries.length) h += '<div class="rtn-quiet">Opening returns…</div>';
    else if (S.error) h += '<div class="rtn-quiet" role="alert">' + esc(S.error) + '<button class="rtn-btn" data-act="retry">Try again</button></div>';
    else if (!S.entries.length) h += S.adding ? "" : '<div class="rtn-quiet"><p style="margin:0 0 12px">Nothing is going back.</p>' + addBtn +
      '<p style="margin:12px 0 0">To send stock back from an expiring line, open <a href="#nearexpiry" style="color:var(--accent);font-weight:600">Near expiry</a> and press Send back on its line.</p></div>'; // the form open: it is the next step, the empty box goes. New return first: the main button is the next Tab after the heading
    else GROUPS.forEach(function (g) {
      var list = S.entries.filter(function (e) { return group(e) === g[0]; });
      if (list.length) h += '<div class="rtn-lab">' + g[1] + " <b>" + list.length + '</b></div><div class="rtn-list">' + list.map(rowHtml).join("") + "</div>";
    });
    h += E.months.history("retreg", HIST);
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changes, deleting and refused or damaged stock are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) && ae.name && ae.closest && ae.closest("#rtn-add") ? "#rtn-add [name=" + ae.name + "]" : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) again.focus(); }
    E.months.wireHistory(m, "retreg");
    var f = m.querySelector("#rtn-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
    applyRefocus();
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash("retreg");
        else if (a === "retry") load();
        else if (a === "step") tick(Number(b.getAttribute("data-id")), b.getAttribute("data-k"));
        else if (a === "add") { S.adding = { entry_date: today() }; S.err = ""; S.errAt = ""; paint(true); focusOn("#rtn-add [name=description]"); }
        else if (a === "add-cancel") { S.adding = null; S.err = ""; S.errAt = ""; paint(true); focusOn('[data-act="add"]'); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "retreg"); } catch (e) {} E.openClassic("returns"); }
      });
    });
  }

  // After a one-tap save the list is redrawn: a keyboard user stays on that item (the same button, or the one now in its place).
  // Later redraws (the month list arriving) keep it there for a few seconds, unless focus has moved on by then.
  function refocus(sel) { S.refocus = { sel: sel, until: Date.now() + 4000 }; applyRefocus(); }
  function applyRefocus() { var r = S.refocus, a = document.activeElement; if (!r || Date.now() > r.until || !S.mount || (a && a !== document.body)) return; var b = null; r.sel.forEach(function (q) { if (!b && q) b = S.mount.querySelector(q); }); if (b && !b.disabled) b.focus(); }
  function focusOn(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }, 0); } // never from a field the person went to meanwhile
  // Save return: the classic New + Save, POST /returns/entries with every field of its form, the checklist all 0.
  async function add() {
    if (S.saving || !S.adding) return;
    keep();
    var a = S.adding, v = function (k) { return String(a[k] || "").trim(); }, ymd = /^\d{4}-\d{2}-\d{2}$/;
    S.err = ""; S.errAt = "";
    if (!v("description")) { S.err = "Write the item going back. Nothing was saved."; S.errAt = "description"; }
    else if (v("expiry") && !ymd.test(v("expiry"))) { S.err = "Write the expiry as a date, or leave it empty. Nothing was saved."; S.errAt = "expiry"; }
    else if (!ymd.test(v("entry_date"))) { S.err = "Write the date of the return. Nothing was saved."; S.errAt = "entry_date"; }
    if (S.err) { paint(true); return focusOn("#rtn-add [name=" + S.errAt + "]"); }
    var body = { entry_date: v("entry_date"), description: v("description"), expiry: v("expiry"), batch: v("batch"), quantity: v("quantity"), supplier: v("supplier"),
      invoice_number: v("invoice_number"), remarks: v("remarks"), location_stored: v("location_stored"),
      return_arranged: 0, handed_over: 0, collection_note_received: 0, credit_note_received: 0, supplier_refused: 0, damaged: 0 };
    S.saving = true; paint(true);
    var low = function (x) { return String(x || "").trim().toLowerCase(); };
    try {
      var r = await E.postOnce("/returns/entries", body, { list: async function () { var x = await E.apiFetch("/returns/entries?open=1", { method: "GET" }); return (x && x.entries) || []; },
        same: function (e) { return low(e.description) === low(body.description) && String(e.entry_date) === body.entry_date && low(e.supplier) === low(body.supplier); } });
      S.adding = null; E.toast("Saved · return for " + body.description, "success");
      S.saving = false; await load();
      // The next step is right there: Mark arranged on the new return.
      return focusOn(r && r.id ? '[data-act="step"][data-id="' + r.id + '"]' : '[data-act="add"]');
    } catch (x) { S.err = E.saveFailText(x); S.errAt = ""; }
    S.saving = false; return load();
  }
  async function tick(id, key) {
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e || S.busy[id]) return;
    var body = {}; FIELDS.forEach(function (k) { body[k] = e[k] == null ? "" : e[k]; });
    body[key] = 1;
    S.busy[id] = true; paint();
    try {
      var r = await E.apiFetch("/returns/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast(e.description + " · " + (STEPS.find(function (s) { return s[0] === key; }) || ["", "done"])[1].toLowerCase(), "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy[id] = false; await load(); refocus(['[data-act="step"][data-id="' + id + '"]']);
  }

  E.registerModule({
    id: "retreg", title: "Returns", order: 3, icon: "↩", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.err = ""; S.errAt = ""; E.months.historyReset("retreg"); css(); paint(); return Promise.resolve(E.takeOpenForm("retreg", S.mount, load(), { btn: "[data-act=add]", form: "#rtn-add" } /* q5-2: a half-typed form comes back */, null)).then(function (v) { if (E.stockLand) E.stockLand.apply("retreg", S.mount); return v; }); } // d-stock: Next step from Stock lands on that return
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("retreg") < 0) E.UI2_DESTINATIONS.push("retreg");
  if (E.UI2_PARENT) E.UI2_PARENT.retreg = "stock";
})();
