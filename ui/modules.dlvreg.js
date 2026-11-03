/* Deliveries, new layout: what goes out today (and anything overdue), then later; address, number to call, fridge and
   controlled-drug flags. On its way, Delivered (who took it), Not delivered (why; the third failed attempt returns it to
   the pharmacy, as in the classic screen), New delivery. The server replaces the whole record on every save
   (UPDATE-AUDIT.md: FULL-REPLACE), so each save sends the record as it came back with only the changed fields. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", busy: {}, adding: null, open: null, mode: "", saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var ACTIVE = ["Scheduled", "Dispatched", "Out for Delivery"];
  var FIELDS = ["delivery_id", "order_date", "scheduled_date", "scheduled_time_slot", "actual_delivery_date", "actual_delivery_time", "client_name", "phone", "email",
    "delivery_address", "address_notes", "id_doc_ref", "delivery_method", "priority", "assigned_driver", "tracking_number", "status", "signature_required", "signature_obtained",
    "recipient_name", "proof_of_delivery", "delivery_attempts", "failure_reason", "contains_controlled", "cold_chain_required", "ticket_ref", "items", "delivery_log", "internal_notes"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nowHm() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function daysUntil(s) { var p = String(s).split("-"); var t = new Date(); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function when(s) { var n = daysUntil(s); if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; var p = s.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1]; }
  function arr(raw) { if (Array.isArray(raw)) return raw; try { var a = JSON.parse(String(raw || "[]")); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function nextId() { // same counter as the classic screen, so numbers carry on
    try { var k = "eikon_deliveries_seq_v1", n = (parseInt(localStorage.getItem(k), 10) || 0) + 1; localStorage.setItem(k, String(n)); return "DEL-" + String(n).padStart(5, "0"); }
    catch (e) { return "DEL-" + String(Date.now()).slice(-5); }
  }
  function author() { var u = E.state.user || {}; return u.full_name || u.display_name || ""; }

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
    var h = '<div class="dlv-card ' + cls + '"><div class="h"><b>' + esc(e.client_name) + "</b><span>" + esc(e.delivery_id || "") + "</span></div>" +
      '<div class="ad"><a href="' + esc(maps) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + esc(e.delivery_address) + "</a>" + (e.address_notes ? "<small>" + esc(e.address_notes) + "</small>" : "") + "</div>" +
      (what ? '<div class="s">' + esc(what) + "</div>" : "") + '<div class="s">' + sub.join(" · ") + "</div>" + (fl.length ? '<div class="fl">' + fl.join("") + "</div>" : "");
    if (S.open === e.id && S.mode === "done") {
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

  // Every delivery ordered in a month (any month, done or not), and the classic printout of the list.
  var HIST = { dep: function () { return S.loading ? undefined : S.entries; }, title: "By month", label: "Deliveries ordered", nowText: "No delivery ordered this month yet.",
    active: function () { return E.state.activeModuleId === "dlvreg"; }, paint: function () { paint(); },
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
    var h = '<div class="dlv"><button class="dlv-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("dlvreg") : "‹ Customers") + "</button>" +
      '<div class="dlv-top"><div><h1>Deliveries</h1><p class="dlv-sub">What goes out today, and what is still on the road.</p></div>' + (S.adding ? "" : '<button class="dlv-btn p" data-act="add">New delivery</button>') + "</div>";
    if (S.adding) {
      var a = S.adding, fe = S.fe || {};
      var inv = function (k) { return fe[k] ? ' aria-invalid="true" aria-describedby="dlv-e-' + k + '"' : ""; }, ferr = function (k) { return fe[k] ? '<small class="dlv-ferr" id="dlv-e-' + k + '">' + esc(fe[k]) + "</small>" : ""; };
      var fld = function (k, label, val, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(val || "") + '"' + (extra || "") + inv(k) + ">" + ferr(k) + "</label>"; };
      h += '<form class="dlv-form" id="dlv-add" autocomplete="off" aria-label="New delivery">' + fld("client_name", "Customer", a.client_name, ' placeholder="Name and surname" autocapitalize="words"') +
        fld("phone", "Phone", a.phone, ' type="tel" inputmode="tel" placeholder="For the driver"') +
        fld("delivery_address", "Address", a.delivery_address, ' placeholder="Street, number, town"') +
        fld("address_notes", "Directions", a.address_notes, ' placeholder="Optional, e.g. blue door, 2nd floor"') +
        fld("items", "Items", a.itemsText, ' placeholder="Optional, e.g. Augmentin 625, Panadol"') +
        fld("scheduled_date", "Deliver on", a.scheduled_date || today(), ' type="date"') +
        fld("scheduled_time_slot", "Time", a.scheduled_time_slot, ' placeholder="Optional, e.g. Afternoon"') +
        '<label><span>Fridge item</span><input type="checkbox" name="cold_chain_required"' + (a.cold_chain_required ? " checked" : "") + "></label>" +
        '<label><span>Controlled drug</span><input type="checkbox" name="contains_controlled"' + (a.contains_controlled ? " checked" : "") + "></label>" +
        '<label><span>Needs signature</span><input type="checkbox" name="signature_required"' + (a.signature_required ? " checked" : "") + "></label>" +
        (S.err && !S.open ? '<div class="dlv-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="dlv-btn" data-act="add-cancel">Cancel</button><button type="submit" class="dlv-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Add delivery") + "</button></div></form>";
    }
    if (S.loading && !S.entries.length) h += '<div aria-busy="true" style="margin-top:16px"><span class="dlv-sr" role="status">Opening deliveries</span><i class="dlv-skel"></i><i class="dlv-skel"></i></div>';
    else if (S.error) h += '<div class="dlv-quiet" role="alert">' + esc(S.error) + ' <button type="button" class="dlv-btn" data-act="retry" style="margin-left:6px">Try again</button></div>';
    else if (!S.entries.length) h += '<div class="dlv-quiet">Nothing to deliver. When a customer wants something brought to them, press New delivery.</div>';
    else {
      var now = S.entries.filter(function (e) { return daysUntil(day(e)) <= 0; }), later = S.entries.filter(function (e) { return daysUntil(day(e)) > 0; });
      var over = now.filter(function (e) { return daysUntil(day(e)) < 0; }).length;
      if (now.length) h += '<div class="dlv-lab">Today <b>' + now.length + "</b>" + (over ? '<span style="color:var(--danger)">· ' + over + " overdue</span>" : "") + "</div>" + now.map(cardHtml).join("");
      if (later.length) h += '<div class="dlv-lab">Later <b>' + later.length + "</b></div>" + later.map(cardHtml).join("");
    }
    h += E.months.history("dlvreg", HIST);
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changing a delivery, drivers and item batches are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    E.months.wireHistory(m, "dlvreg");
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("dlvreg") : "#customers";
        else if (a === "add") { S.adding = {}; S.err = ""; S.fe = {}; paint(); setTimeout(function () { var f = m.querySelector("#dlv-add [name=client_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "add-cancel") closeAdd();
        else if (a === "done" || a === "fail") { S.open = id; S.mode = a; S.draft = null; S.signed = false; S.err = ""; paint(); setTimeout(function () { var f = m.querySelector(".dlv-in input"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) { f.focus(); try { f.select(); } catch (x) {} } }, 30); }
        else if (a === "cancel") closeIn();
        else if (a === "retry") load();
        else if (a === "road") { var e = find(id); if (e) save(e, { status: "Out for Delivery" }, "Out for delivery", "On its way.").then(function () { focusOn('[data-act=done][data-id="' + id + '"]'); }); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "dlvreg"); } catch (x) {} E.openClassic("deliveries"); }
      });
    });
    var fd = m.querySelector("#dlv-done"); if (fd) fd.addEventListener("submit", function (ev) { ev.preventDefault(); delivered(fd); });
    var ff = m.querySelector("#dlv-fail"); if (ff) ff.addEventListener("submit", function (ev) { ev.preventDefault(); failed(ff); });
    [fd, ff].forEach(function (fi) { if (fi) fi.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); closeIn(); } }); }); // one short line: Escape is Cancel
    var fa = m.querySelector("#dlv-add");
    if (fa) {
      fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(fa); });
      fa.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !document.querySelector(".epp-list:not([hidden])")) { keep(); var a0 = S.adding || {}; if (!["client_name", "phone", "delivery_address", "address_notes", "itemsText", "scheduled_time_slot"].some(function (k) { return String(a0[k] || "").trim(); })) { ev.preventDefault(); closeAdd(); } } }); // Escape closes an empty form; typing is never thrown away
      fa.addEventListener("input", function (ev) { var el = ev.target; if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); if (S.fe) delete S.fe[el.name]; var s0 = el.parentNode && el.parentNode.querySelector(".dlv-ferr"); if (s0) s0.remove(); } });
    }
    if (fa && E.personPick) E.personPick.attach({ key: "dlvreg", form: fa, fields: { name: "client_name", phone: "phone", address: "delivery_address" },
      local: function () { return S.entries.map(function (e) { return { name: e.client_name, phone: e.phone, address: e.delivery_address, date: String(e.order_date || "").slice(0, 10), from: "delivery" }; }); } });
  }

  function find(id) { return S.entries.find(function (x) { return x.id === id; }); }
  function focusOn(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); if (x) x.focus(); }, 0); }
  function closeAdd() { S.adding = null; S.err = ""; S.fe = {}; paint(); focusOn(".dlv-top [data-act=add]"); }
  function closeIn() { var id = S.open, md = S.mode; S.open = null; S.mode = ""; S.err = ""; S.draft = null; paint(); if (id) focusOn('[data-act=' + md + '][data-id="' + id + '"]'); }
  function keep() { // the new delivery, and who took one / why not, survive any redraw
    var f = S.mount && S.mount.querySelector("#dlv-add");
    if (f && S.adding && !S.saving) {
      ["client_name", "phone", "delivery_address", "address_notes", "scheduled_date", "scheduled_time_slot"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || ""); });
      var it = f.querySelector("[name=items]"); if (it) S.adding.itemsText = String(it.value || "");
      ["cold_chain_required", "contains_controlled", "signature_required"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = el.checked ? 1 : 0; });
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

  async function add(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var c = function (n) { var el = f.querySelector("[name=" + n + "]"); return el && el.checked ? 1 : 0; };
    var a = { client_name: v("client_name"), phone: v("phone"), delivery_address: v("delivery_address"), address_notes: v("address_notes"), itemsText: v("items"),
      scheduled_date: v("scheduled_date"), scheduled_time_slot: v("scheduled_time_slot"), cold_chain_required: c("cold_chain_required"), contains_controlled: c("contains_controlled"), signature_required: c("signature_required") };
    S.adding = a; S.err = "";
    var fe = {};
    if (!a.client_name) fe.client_name = "Write the customer's name.";
    if (!a.phone) fe.phone = "Write a phone number for the driver.";
    if (!a.delivery_address) fe.delivery_address = "Write the address.";
    S.fe = fe; S.err = Object.keys(fe).map(function (k) { return fe[k]; }).join(" ") + (Object.keys(fe).length ? " Nothing was saved." : "");
    if (S.err) { paint(); focusOn("#dlv-add [name=" + Object.keys(fe)[0] + "]"); return; }
    var items = a.itemsText ? a.itemsText.split(",").map(function (s) { return s.trim(); }).filter(Boolean).map(function (n) { return { name: n, qty: 1, schedule: a.contains_controlled ? "" : "OTC", batch_ref: "", expiry: "" }; }) : [];
    var body = { delivery_id: nextId(), order_date: today(), scheduled_date: isYmd(a.scheduled_date) ? a.scheduled_date : today(), scheduled_time_slot: a.scheduled_time_slot,
      client_name: a.client_name, phone: a.phone, email: "", delivery_address: a.delivery_address, address_notes: a.address_notes, delivery_method: "In-house Driver", priority: 2,
      status: "Scheduled", signature_required: a.signature_required, signature_obtained: 0, delivery_attempts: 0, contains_controlled: a.contains_controlled, cold_chain_required: a.cold_chain_required,
      items: JSON.stringify(items), delivery_log: JSON.stringify([{ ts: new Date().toISOString(), author: author(), text: "Delivery recorded." }]), internal_notes: "" };
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/client-deliveries/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; S.fe = {}; E.toast("Delivery recorded · " + body.delivery_id, "success"); var added = true;
      if (E.linkPerson) E.linkPerson({ name: body.client_name, phone: body.phone, address: body.delivery_address }, "register:deliveries"); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; await load();
    if (added) focusOn(".dlv-top [data-act=add]");
  }

  E.registerModule({
    id: "dlvreg", title: "Deliveries", order: 3, icon: "→", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.busy = {}; S.adding = null; S.open = null; S.mode = ""; S.err = ""; S.fe = {}; S.draft = null; E.months.historyReset("dlvreg"); css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("dlvreg") < 0) E.UI2_DESTINATIONS.push("dlvreg");
  if (E.UI2_PARENT) E.UI2_PARENT.dlvreg = "customers";
})();
