/* Alerts (recalls and quarantines), new layout: open alerts with their checklist, one tap per step, close when done;
   record a new alert. Same endpoints as the classic screen. The server's update replaces every field, so each tap
   sends the whole record back as read with only that step changed (see design/eikon-next/UPDATE-AUDIT.md). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var CHECK = [["team_informed", "Team told"], ["supplier_informed", "Supplier told"], ["authorities_informed", "Authorities told"],
    ["return_arranged", "Return arranged"], ["handed_over", "Handed over"], ["collection_note_received", "Collection note"], ["credit_note_received", "Credit note"]];
  // Every field the server's update writes; sent back as read so nothing is blanked.
  var FIELDS = ["entry_date", "alert_type", "status", "item_name", "batch", "expiry", "quantity", "reason", "storage_location", "supplier", "notes",
    "team_informed", "supplier_informed", "authorities_informed", "return_arranged", "handed_over", "collection_note_received", "credit_note_received"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function nice(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : ""; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function on(e, k) { return Number(e[k]) === 1; }

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
      ".alr-foot{display:flex;justify-content:flex-end;margin-top:10px}" +
      ".alr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".alr-form label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 16px;border-top:.5px solid var(--border)}.alr-form label:first-child{border-top:0}" +
      ".alr-form label>span{flex:0 0 90px;font-size:15px}.alr-form input,.alr-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".alr-form .acts{display:flex;gap:8px;padding:10px 16px;justify-content:flex-end}" +
      ".alr-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
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
      "<b>" + esc(e.item_name) + '</b><div class="s">' + esc(sub.join(" · ")) + "</div>" + (e.reason ? '<div class="s">' + esc(e.reason) + "</div>" : "") +
      '<div class="alr-chk">' + CHECK.map(function (c) { return '<button class="' + (on(e, c[0]) ? "on" : "") + '" data-act="tick" data-id="' + e.id + '" data-k="' + c[0] + '" aria-pressed="' + on(e, c[0]) + '"' + (S.busy[e.id] || closed ? " disabled" : "") + ">" + (on(e, c[0]) ? "✓ " : "") + c[1] + "</button>"; }).join("") + "</div>" +
      (closed ? "" : '<div class="alr-foot"><button class="alr-btn' + (CHECK.every(function (c) { return on(e, c[0]); }) ? " p" : "") + '" data-act="close" data-id="' + e.id + '"' + (S.busy[e.id] ? " disabled" : "") + ">Close alert</button></div>") + "</div>";
  }

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
      h += '<form class="alr-form" id="alr-add" autocomplete="off"><label><span>Type</span><select name="alert_type"><option value="recall"' + (a.alert_type !== "quarantine" ? " selected" : "") + '>Recall</option><option value="quarantine"' + (a.alert_type === "quarantine" ? " selected" : "") + ">Quarantine</option></select></label>" +
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
    if (S.loading && !S.entries.length) h += '<div class="alr-quiet">Opening alerts…</div>';
    else if (S.error) h += '<div class="alr-quiet" role="alert">' + esc(S.error) + '<button class="alr-btn" data-act="retry">Try again</button></div>';
    else {
      var open = S.entries.filter(function (e) { return e.status !== "closed"; }), closed = S.entries.filter(function (e) { return e.status === "closed"; });
      h += open.length ? '<div class="alr-lab">Open <b>' + open.length + "</b></div>" + open.map(cardHtml).join("") : '<div class="alr-quiet">No open alerts. When a recall comes in, record it here and tick off each step.</div>';
      if (closed.length) h += '<div class="alr-lab">Closed in the last 60 days <b>' + closed.length + "</b></div>" + closed.map(cardHtml).join("");
    }
    h += E.months.history("alertreg", HIST);
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changing an alert’s details, notes and deleting are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    E.months.wireHistory(m, "alertreg");
    applyRefocus();
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = E.ui2BackHash("alertreg");
        else if (a === "retry") load();
        else if (a === "add") { S.adding = {}; S.err = ""; paint(); focusSoon("#alr-add [name=item_name]"); }
        else if (a === "add-cancel") { S.adding = null; S.err = ""; paint(); focusSoon('[data-act="add"]'); }
        else if (a === "tick") save(id, function (body) { body[b.getAttribute("data-k")] = on(body, b.getAttribute("data-k")) ? 0 : 1; }, "", b.getAttribute("data-k"));
        else if (a === "close") { if (window.confirm("Close this alert? It moves to Closed.")) save(id, function (body) { body.status = "closed"; }, "Alert closed"); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "alertreg"); } catch (e) {} E.openClassic("alerts"); }
      });
    });
    var f = m.querySelector("#alr-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); add(f); });
    // Escape closes the open form (what is typed in it is dropped, as with Cancel) and puts you back where you were.
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
  }
  function focusSoon(sel) { setTimeout(function () { var f = S.mount && S.mount.querySelector(sel); if (f) f.focus(); }, 30); }

  // After a one-tap save the list is redrawn: a keyboard user stays on that item (the same button, or the one now in its place).
  // Later redraws (the month list arriving) keep it there for a few seconds, unless focus has moved on by then.
  function refocus(sel) { S.refocus = { sel: sel, until: Date.now() + 4000 }; applyRefocus(); }
  function applyRefocus() { var r = S.refocus, a = document.activeElement; if (!r || Date.now() > r.until || !S.mount || (a && a !== document.body)) return; var b = null; r.sel.forEach(function (q) { if (!b && q) b = S.mount.querySelector(q); }); if (b && !b.disabled) b.focus(); }
  // Sends the whole record back as read, with only the change made by `change`.
  async function save(id, change, okText, key) {
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e || S.busy[id]) return;
    var body = {}; FIELDS.forEach(function (k) { body[k] = e[k] == null ? "" : e[k]; });
    change(body);
    S.busy[id] = true; paint();
    try {
      var r = await E.apiFetch("/alerts/entries/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      if (okText) E.toast(okText, "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy[id] = false; await load(); refocus([key ? '[data-act="tick"][data-id="' + id + '"][data-k="' + key + '"]' : "", '[data-act="close"][data-id="' + id + '"]']);
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
    render: function (ctx) { S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; E.months.historyReset("alertreg"); css(); paint(); return E.takeOpenForm("alertreg", S.mount, load(), { btn: "[data-act=add]", form: "#alr-add" }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("alertreg") < 0) E.UI2_DESTINATIONS.push("alertreg");
  if (E.UI2_PARENT) E.UI2_PARENT.alertreg = "stock";
})();
