/* Alerts (recalls and quarantines), new layout: open alerts with their checklist, one tap per step, close when done;
   record a new alert; change an alert (its details, status and notes). Same endpoints as the classic screen. The
   server's update replaces every field, so each save sends the whole record back as read with only what was changed
   (see design/eikon-next/UPDATE-AUDIT.md), in the classic screen's own body (its payloadFromEntry: every text trimmed,
   every step 0 or 1). Delete is on the card for whoever classic shows it to (everyone: modules.alerts.js:513), the
   classic DELETE after one plain question; the server writes the ALERT_DELETE audit entry, as for classic. Undo puts
   it back with the classic New body holding every field as it was (an alert links to nothing, so that is faithful). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, saving: false, err: "", editing: null, editErr: [], editMiss: [], del: null, delErr: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var CHECK = [["team_informed", "Team told"], ["supplier_informed", "Supplier told"], ["authorities_informed", "Authorities told"],
    ["return_arranged", "Return arranged"], ["handed_over", "Handed over"], ["collection_note_received", "Collection note"], ["credit_note_received", "Credit note"]];
  // Every field the server's update writes, in the classic screen's order; sent back as read so nothing is blanked.
  var TEXTS = ["entry_date", "alert_type", "status", "item_name", "batch", "expiry", "quantity", "reason", "storage_location", "supplier", "notes"];
  var STATUS = [["open", "Open"], ["in_progress", "In progress"], ["closed", "Closed"]];
  // The classic screen's payloadFromEntry, unchanged: the body of every update it sends (edit, checklist, close).
  function payload(x) {
    var o = {};
    TEXTS.forEach(function (k) { o[k] = String(x[k] || "").trim(); });
    CHECK.forEach(function (c) { var v = x[c[0]]; o[c[0]] = v === 1 || v === "1" || v === true ? 1 : 0; });
    return o;
  }

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function nice(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : ""; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function on(e, k) { return Number(e[k]) === 1; }
  // Who sees Delete: as classic (every user; the server allows admin and staff). Decision J7 for John: pharmacists only
  // would be `return !!(E.state && E.state.user && E.state.user.role === "admin");`.
  function canDelete() { return true; }

  function css() {
    if (document.getElementById("eikon-alertreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-alertreg-css";
    st.textContent =
      ".alr{max-width:880px;margin:0 auto}" +
      ".alr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".alr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".alr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.alr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".alr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".alr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.alr-btn:disabled{opacity:.55;cursor:default}" +
      ".alr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.alr-lab b{color:var(--text)}" +
      ".alr-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;border-left:3px solid var(--danger)}.alr-card.q{border-left-color:#C98A12}.alr-card.closed{border-left-color:var(--border)}" +
      ".alr-card b{font-size:16px;font-weight:600}.alr-card .k{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--danger);margin-bottom:2px}.alr-card.q .k{color:var(--warn,#A06A0E)}.alr-card.closed .k{color:var(--muted)}" +
      ".alr-card .s{font-size:13px;color:var(--muted);margin-top:2px}" +
      ".alr-chk{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}" +
      ".alr-chk button{font:inherit;font-size:13px;font-weight:600;height:32px;padding:0 12px;border-radius:16px;border:0;background:rgba(118,118,128,.12);color:var(--muted);cursor:pointer}" +
      ".alr-chk button.on{background:rgba(10,143,106,.12);color:var(--accent)}.alr-chk button:disabled{opacity:.5}" +
      ".alr-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}" +
      ".alr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".alr-form label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 16px;border-top:.5px solid var(--border)}.alr-form label:first-child{border-top:0}" +
      ".alr-form label>span{flex:0 0 90px;font-size:15px}.alr-form input,.alr-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".alr-form .acts{display:flex;gap:8px;padding:10px 16px;justify-content:flex-end}" +
      ".alr-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
      ".alr-edit{margin:0 0 10px;border-left:3px solid var(--accent)}.alr-form label.miss>span{color:var(--danger);font-weight:600}.alr-form label.miss{box-shadow:inset 3px 0 0 var(--danger)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .alr-form label.miss>span{color:#FF7A72}}" + // as pocreg: the red label readable on dark
      ".alr-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.alr-btn.dd{background:#B42318;border-color:#B42318;color:#fff}" +
      ".alr-foot.l{justify-content:space-between}.alr-foot.l>span{display:flex;gap:8px}.alr-ask{font-size:15px;font-weight:600;margin:12px 0 0}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .alr-btn.d{color:#FF7A72;border-color:#FF7A72}}" +
      ".alr-undo{display:flex;align-items:center;gap:12px;justify-content:space-between;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:8px 8px 8px 16px;margin-top:14px;font-size:14.5px}" +
      ".alr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.alr{padding:4px 16px 0}.alr h1{font-size:32px}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".alr-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.alr-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".alr-quiet .alr-btn{margin-top:12px;display:block}" +
      "@media (max-width:600px){.alr-btn,.alr-btn.s{height:44px;border-radius:22px}.alr-chk button{min-height:44px;border-radius:22px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/alerts/entries", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load alerts");
      var cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      S.entries = (r.entries || []).filter(function (e) { return e.status !== "closed" || String(e.entry_date) >= cutoff; })
        .sort(function (a, b) { return String(a.entry_date) < String(b.entry_date) ? 1 : -1; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load alerts"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function cardHtml(e) {
    var closed = e.status === "closed", sub = [];
    if (e.batch) sub.push("Batch " + e.batch); if (e.expiry) sub.push("Expires " + nice(e.expiry)); if (e.quantity) sub.push("Qty " + e.quantity);
    sub.push(e.storage_location === "fridge" ? "Fridge" : "Room"); if (e.supplier) sub.push(e.supplier); sub.push("Recorded " + nice(e.entry_date));
    return '<div class="alr-card' + (e.alert_type === "quarantine" ? " q" : "") + (closed ? " closed" : "") + '"><div class="k">' + (e.alert_type === "quarantine" ? "Quarantine" : "Recall") + (closed ? " · closed" : e.status === "in_progress" ? " · in progress" : "") + "</div>" +
      "<b>" + esc(e.item_name) + '</b><div class="s">' + esc(sub.join(" · ")) + "</div>" + (e.reason ? '<div class="s">' + esc(e.reason) + "</div>" : "") + (e.notes ? '<div class="s">Notes: ' + esc(e.notes) + "</div>" : "") +
      '<div class="alr-chk">' + CHECK.map(function (c) { return '<button class="' + (on(e, c[0]) ? "on" : "") + '" data-act="tick" data-id="' + e.id + '" data-k="' + c[0] + '" aria-pressed="' + on(e, c[0]) + '"' + (S.busy[e.id] || closed ? " disabled" : "") + ">" + (on(e, c[0]) ? "✓ " : "") + c[1] + "</button>"; }).join("") + "</div>" +
      (S.del === e.id ? delHtml(e) :
      '<div class="alr-foot' + (canDelete() ? " l" : "") + '">' + (canDelete() ? '<button class="alr-btn d" data-act="del" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ' aria-label="Delete the alert for ' + esc(e.item_name) + '">Delete…</button><span>' : "") +
      '<button class="alr-btn" data-act="edit" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ' aria-label="Change ' + esc(e.item_name) + '">Change</button>' +
      (closed ? "" : '<button class="alr-btn' + (CHECK.every(function (c) { return on(e, c[0]); }) ? " p" : "") + '" data-act="close" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">Close alert</button>") + (canDelete() ? "</span>" : "") + "</div>") + "</div>";
  }
  // Delete (pharmacist only): one plain question on the card, Keep it first.
  function delHtml(e) {
    return '<p class="alr-ask" id="alr-ask-' + e.id + '">Delete the alert for ' + esc(e.item_name) + "?</p>" + (S.delErr ? '<div class="alr-err" role="alert" style="padding:4px 0">' + esc(S.delErr) + "</div>" : "") +
      '<div class="alr-foot"><button class="alr-btn" data-act="del-cancel" data-id="' + e.id + '">Keep it</button><button class="alr-btn dd" data-act="del-go" data-id="' + e.id + '" aria-describedby="alr-ask-' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">" + (S.busy[e.id] ? "Deleting…" : "Delete alert") + "</button></div>";
  }

  // Change an alert: the card becomes its form, every field as stored (the checklist stays one tap on the card).
  function editHtml(e) {
    var d = S.editDraft || e, miss = S.editMiss;
    var lab = function (k, t, inner) { var bad = miss.indexOf(k) >= 0; return "<label" + (bad ? ' class="miss"' : "") + "><span>" + t + "</span>" + inner.replace("<input", "<input" + (bad ? ' aria-invalid="true" aria-describedby="alr-edit-err"' : "")) + "</label>"; };
    var inp = function (k, t, extra) { return lab(k, t, '<input name="' + k + '" value="' + esc(d[k] == null ? "" : d[k]) + '"' + (extra || "") + ">"); };
    var sel = function (k, t, opts) { return "<label><span>" + t + '</span><select name="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(d[k] || opts[0][0]) === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>"; };
    return '<form class="alr-form sf-form alr-edit" id="alr-edit" data-id="' + e.id + '" autocomplete="off" aria-label="Change ' + esc(e.item_name) + '">' +
      inp("entry_date", "Recorded", ' type="date"') + sel("alert_type", "Type", [["recall", "Recall"], ["quarantine", "Quarantine"]]) + sel("status", "Status", STATUS) +
      inp("item_name", "Item", ' placeholder="Product and strength"') + inp("batch", "Batch", ' placeholder="Optional"') + inp("expiry", "Expires", ' type="date"') +
      inp("quantity", "Quantity", ' placeholder="Optional"') + inp("reason", "Why", ' placeholder="Optional"') + sel("storage_location", "Kept in", [["room", "Room"], ["fridge", "Fridge"]]) +
      inp("supplier", "Supplier", ' placeholder="Optional"') + inp("notes", "Notes", ' placeholder="Optional"') +
      (S.editErr.length ? '<div class="alr-err" id="alr-edit-err" role="alert">' + esc(S.editErr.join(" ")) + "</div>" : "") +
      '<div class="acts"><button type="button" class="alr-btn" data-act="edit-cancel">Cancel</button><button type="submit" class="alr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save changes") + "</button></div></form>";
  }
  function oneHtml(e) { return S.editing === e.id ? editHtml(e) : cardHtml(e); }

  // Every alert recorded in a month (any month), and the classic printout of it.
  var HIST = { dep: function () { return S.loading ? undefined : S.entries; }, title: "By month", label: "Alerts recorded", active: function () { return E.state.activeModuleId === "alertreg"; }, paint: function () { paint(); },
    fetch: async function (ym) { var r = await E.apiFetch("/alerts/entries?month=" + encodeURIComponent(ym), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load alerts"); return (r.entries || []).slice().sort(function (a, b) { return String(b.entry_date).localeCompare(String(a.entry_date)) || b.id - a.id; }); },
    row: function (e) { return { t: e.item_name || "", s: [E.months.dmy(e.entry_date), e.alert_type === "quarantine" ? "Quarantine" : "Recall", e.status === "in_progress" ? "In progress" : e.status === "closed" ? "Closed" : "Open", e.supplier].filter(Boolean).join(" · ") }; },
    print: function (ym, rows) {
      var yn = function (v) { return v === 1 || v === "1" || v === true ? "Yes" : "No"; };
      E.months.print({ register: "Alerts", month: ym, landscape: true, sections: [{ cols: ["Date", "Type", "Status", "Item", "Room/Fridge", "Supplier", "Checklist"],
        rows: rows.slice().reverse().map(function (r) {
          var bits = []; if (r.batch) bits.push("Batch: " + r.batch); if (r.expiry) bits.push("Expiry: " + E.months.dmy(r.expiry)); if (r.quantity) bits.push("Qty: " + r.quantity);
          return [E.months.dmy(r.entry_date), r.alert_type === "quarantine" ? "Quarantine" : "Recall", r.status === "in_progress" ? "In progress" : r.status === "closed" ? "Closed" : "Open",
            { html: "<b>" + esc(r.item_name || "") + "</b>" + (bits.length ? "<br>" + esc(bits.join(" | ")) : "") + (r.reason ? "<br>Reason: " + esc(r.reason) : "") + (r.notes ? "<br>Notes: " + esc(r.notes) : "") },
            r.storage_location === "fridge" ? "Fridge" : "Room", r.supplier || "",
            { html: esc("Team: " + yn(r.team_informed) + " | Supplier: " + yn(r.supplier_informed) + " | Authorities: " + yn(r.authorities_informed)) + "<br>" + esc("Return: " + yn(r.return_arranged) + " | Handover: " + yn(r.handed_over) + " | Collection: " + yn(r.collection_note_received) + " | Credit: " + yn(r.credit_note_received)) }];
        }) }] });
    } };
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "alertreg") return; // left before a reply came back: do not draw over the next screen
    var h = '<div class="alr"><button class="alr-back" data-act="back">' + esc(E.ui2BackLabel("alertreg")) + '</button>' +
      '<div class="alr-top"><div><h1>Alerts</h1><p class="alr-sub">Recalls and quarantines, with each step ticked off.</p></div>' + (S.adding ? "" : '<button class="alr-btn p" data-act="add">New alert</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="alr-form sf-form sf-new" id="alr-add" autocomplete="off"><label><span>Type</span><select name="alert_type"><option value="recall"' + (a.alert_type !== "quarantine" ? " selected" : "") + '>Recall</option><option value="quarantine"' + (a.alert_type === "quarantine" ? " selected" : "") + ">Quarantine</option></select></label>" +
        '<label><span>Item</span><input name="item_name" value="' + esc(a.item_name || "") + '" placeholder="Product and strength"></label>' +
        '<label><span>Batch</span><input name="batch" value="' + esc(a.batch || "") + '" placeholder="Optional"></label>' +
        '<label><span>Expires</span><input name="expiry" type="date" value="' + esc(a.expiry || "") + '"></label>' +
        '<label><span>Quantity</span><input name="quantity" value="' + esc(a.quantity || "") + '" placeholder="Optional"></label>' +
        '<label><span>Why</span><input name="reason" value="' + esc(a.reason || "") + '" placeholder="e.g. Manufacturer recall notice"></label>' +
        '<label><span>Kept in</span><select name="storage_location"><option value="room">Room</option><option value="fridge"' + (a.storage_location === "fridge" ? " selected" : "") + ">Fridge</option></select></label>" +
        '<label><span>Supplier</span><input name="supplier" value="' + esc(a.supplier || "") + '" placeholder="Optional"></label>' +
        (S.err ? '<div class="alr-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="alr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="alr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save alert") + "</button></div></form>";
    }
    if (S.undo) h += '<div class="alr-undo" role="status"><span>Deleted the alert for ' + esc(S.undo.body.item_name) + '.</span><button class="alr-btn" data-act="undo"' + (S.undo.busy ? " disabled" : "") + ">" + (S.undo.busy ? "Putting it back…" : "Undo") + "</button></div>";
    if (S.loading && !S.entries.length) h += '<div class="alr-quiet">Opening alerts…</div>';
    else if (S.error) h += '<div class="alr-quiet" role="alert">' + esc(S.error) + '<button class="alr-btn" data-act="retry">Try again</button></div>';
    else {
      var open = S.entries.filter(function (e) { return e.status !== "closed"; }), closed = S.entries.filter(function (e) { return e.status === "closed"; });
      h += open.length ? '<div class="alr-lab">Open <b>' + open.length + "</b></div>" + open.map(oneHtml).join("") : '<div class="alr-quiet">No open alerts. When a recall comes in, record it here and tick off each step.</div>';
      if (closed.length) h += '<div class="alr-lab">Closed in the last 60 days <b>' + closed.length + "</b></div>" + closed.map(oneHtml).join("");
    }
    h += E.months.history("alertreg", HIST);
    h += "</div>";
    m.innerHTML = h;
    E.months.wireHistory(m, "alertreg");
    applyRefocus();
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = E.ui2BackHash("alertreg");
        else if (a === "retry") load();
        else if (a === "add") { S.undo = null; S.adding = {}; S.err = ""; S.editing = null; paint(); focusSoon("#alr-add [name=item_name]"); }
        else if (a === "edit") { S.editing = id; S.del = null; S.editDraft = null; S.editErr = []; S.editMiss = []; S.adding = null; paint(); focusSoon("#alr-edit [name=item_name]"); }
        else if (a === "edit-cancel") { var was = S.editing; S.editing = null; S.editDraft = null; S.editErr = []; S.editMiss = []; paint(); focusSoon('[data-act="edit"][data-id="' + was + '"]'); }
        else if (a === "add-cancel") { S.adding = null; S.err = ""; paint(); focusSoon('[data-act="add"]'); }
        else if (a === "tick") save(id, function (body) { body[b.getAttribute("data-k")] = on(body, b.getAttribute("data-k")) ? 0 : 1; }, "", b.getAttribute("data-k"));
        else if (a === "close") { if (window.confirm("Close this alert? It moves to Closed.")) save(id, function (body) { body.status = "closed"; }, "Alert closed"); }
        else if (a === "del") { S.del = id; S.delErr = ""; S.editing = null; paint(); focusSoon('[data-act="del-cancel"][data-id="' + id + '"]'); }
        else if (a === "del-cancel") { S.del = null; S.delErr = ""; paint(); focusSoon('[data-act="del"][data-id="' + id + '"]'); }
        else if (a === "del-go") remove(id);
        else if (a === "undo") undo();
      });
    });
    var f = m.querySelector("#alr-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); add(f); });
    var fe = m.querySelector("#alr-edit"); if (fe) fe.addEventListener("submit", function (ev) { ev.preventDefault(); saveEdit(fe); });
    // Escape closes the open form (what is typed in it is dropped, as with Cancel) and puts you back where you were.
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
  }
  function focusSoon(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }, 30); } // never away from a field the person went to meanwhile

  // After a one-tap save the list is redrawn: a keyboard user stays on that item (the same button, or the one now in its place).
  // Later redraws (the month list arriving) keep it there for a few seconds, unless focus has moved on by then.
  function refocus(sel) { S.refocus = { sel: sel, until: Date.now() + 4000 }; applyRefocus(); }
  function applyRefocus() { var r = S.refocus, a = document.activeElement; if (!r || Date.now() > r.until || !S.mount || (a && a !== document.body)) return; var b = null; r.sel.forEach(function (q) { if (!b && q) b = S.mount.querySelector(q); }); if (b && !b.disabled) b.focus(); }
  // Sends the whole record back as read, with only the change made by `change`.
  async function save(id, change, okText, key) {
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e || S.busy[id]) return;
    var body = payload(e);
    change(body);
    S.busy[id] = true; paint();
    try {
      var r = await E.apiFetch("/alerts/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      if (okText) E.toast(okText, "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy[id] = false; await load(); refocus([key ? '[data-act="tick"][data-id="' + id + '"][data-k="' + key + '"]' : "", '[data-act="close"][data-id="' + id + '"]']);
  }

  // Change: the record as read with the form's fields over it, sent as the classic Edit sends it (same checks first).
  async function saveEdit(f) {
    if (S.saving) return;
    var id = Number(f.getAttribute("data-id")), e = S.entries.find(function (x) { return x.id === id; }); if (!e) return;
    var d = Object.assign({}, e);
    TEXTS.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) d[k] = String(el.value || "").trim(); });
    S.editDraft = d; S.editErr = []; S.editMiss = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.entry_date)) { S.editErr.push("Choose the day it was recorded."); S.editMiss.push("entry_date"); }
    if (!d.item_name) { S.editErr.push("Write the item."); S.editMiss.push("item_name"); }
    if (S.editErr.length) { S.editErr.push("Nothing was saved."); paint(); var bad = S.mount && S.mount.querySelector("#alr-edit [aria-invalid=true]"); if (bad) bad.focus(); return; }
    var body = payload(d);
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/alerts/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.editing = null; S.editDraft = null; E.toast("Saved · " + body.item_name, "success");
    } catch (x) { S.editErr = [E.saveFailText(x)]; }
    S.saving = false; await load();
    if (S.editing == null) refocus(['[data-act="edit"][data-id="' + id + '"]']);
  }

  // Delete: the classic call, DELETE /alerts/entries/:id (no body). A lost answer looks again before saying it failed.
  // Focus goes to the alert that took its place, else the one before, else New alert.
  async function remove(id) {
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e || S.busy[id] || !canDelete()) return;
    var ids = S.entries.map(function (x) { return x.id; }), i = ids.indexOf(id), near = ids[i + 1] || ids[i - 1] || null;
    S.busy[id] = true; S.delErr = ""; paint();
    try {
      var r = await E.apiFetch("/alerts/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Delete failed");
    } catch (x) {
      var gone = false; if (x && x.network) { try { var l = await E.apiFetch("/alerts/entries", { method: "GET" }); gone = !!(l && l.ok) && !(l.entries || []).some(function (y) { return y.id === id; }); } catch (y) { gone = false; } }
      if (!gone) { S.busy[id] = false; S.delErr = E.saveFailText(x).replace(/^Not saved/, "Not deleted"); paint(); return focusSoon('[data-act="del-go"][data-id="' + id + '"]'); }
    }
    S.busy[id] = false; S.del = null; S.undo = { body: Object.assign(payload(e)), id: id };
    await load(); refocus([near ? '[data-act="edit"][data-id="' + near + '"]' : "", '[data-act="undo"]', '[data-act="add"]']);
  }
  // Undo: the alert again, as it was (POST /alerts/entries with every field: the classic New body, its checklist kept).
  async function undo() {
    var u = S.undo; if (!u || u.busy) return;
    u.busy = true; paint();
    var low = function (x) { return String(x || "").trim().toLowerCase(); }, r;
    try {
      r = await E.postOnce("/alerts/entries", u.body, { list: async function () { var x = await E.apiFetch("/alerts/entries", { method: "GET" }); return (x && x.entries) || []; },
        same: function (e) { return e.id !== u.id && low(e.item_name) === low(u.body.item_name) && String(e.entry_date) === u.body.entry_date && low(e.batch) === low(u.body.batch) && String(e.status) === u.body.status; } });
    } catch (x) { u.busy = false; E.toast(E.saveFailText(x), "error"); paint(); return focusSoon('[data-act="undo"]'); }
    S.undo = null; E.toast("Put back · alert for " + u.body.item_name, "success");
    await load(); refocus([r && r.id ? '[data-act="edit"][data-id="' + r.id + '"]' : "", '[data-act="add"]']);
  }

  async function add(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { entry_date: today(), alert_type: v("alert_type"), status: "open", item_name: v("item_name"), batch: v("batch"), expiry: v("expiry"), quantity: v("quantity"), reason: v("reason"), storage_location: v("storage_location"), supplier: v("supplier") };
    S.adding = body; S.err = "";
    if (!body.item_name) { S.err = "Write the item. Nothing was saved."; return paint(); }
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/alerts/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Saved · alert for " + body.item_name, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "alertreg", title: "Alerts", order: 3, icon: "!", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.editing = null; S.editDraft = null; S.editErr = []; S.editMiss = []; S.del = null; S.delErr = ""; S.undo = null; E.months.historyReset("alertreg"); css(); paint(); return Promise.resolve(E.takeOpenForm("alertreg", S.mount, load(), { btn: "[data-act=add]", form: "#alr-add" })).then(function (v) { if (E.stockLand) E.stockLand.apply("alertreg", S.mount); return v; }); } // d-stock: Open from Stock lands on that alert's next step
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("alertreg") < 0) E.UI2_DESTINATIONS.push("alertreg");
  if (E.UI2_PARENT) E.UI2_PARENT.alertreg = "stock";
})();
