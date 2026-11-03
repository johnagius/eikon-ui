/* Certificates, new layout: what is overdue or due soon first, then what is in date; update the last date (the server
   works out the next due date, as in the classic screen); print for an inspector. Files stay in the classic screen.
   Same endpoints as the classic screen (/certificates/items). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var SOON_DAYS = 30;
  var S = { mount: null, items: [], loading: false, error: "", editing: null, saving: false, formErr: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // The server's names are Title Case ("Thermometer Calibration", "Next Due"); the screen and its print say them in
  // sentence case like every other screen. Acronyms stay (AC); nothing stored changes.
  function sc(t) { return String(t == null ? "" : t).split(" ").map(function (w, i) { return !i || w.length < 2 || w === w.toUpperCase() || /\d/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1); }).join(" "); }
  function nice(s) { if (!s) return ""; var p = String(s).split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0]; }
  function daysUntil(s) { var p = String(s).split("-"); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000); }
  function state(it) {
    if (!it.next_due) return { k: "none", label: "Not recorded", order: 1 };
    var n = daysUntil(it.next_due);
    if (n < 0) return { k: "over", label: "Overdue " + (-n) + (n === -1 ? " day" : " days"), order: 0, n: n };
    if (n <= SOON_DAYS) return { k: "soon", label: n === 0 ? "Due today" : "Due in " + n + (n === 1 ? " day" : " days"), order: 2, n: n };
    return { k: "ok", label: "In date", order: 3, n: n };
  }

  function css() {
    if (document.getElementById("eikon-certreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-certreg-css";
    st.textContent =
      ".crt{max-width:860px;margin:0 auto}" +
      ".crt-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0;margin:-10px 0 0;cursor:pointer}" +
      ".crt-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".crt h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.crt-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".crt-btn{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".crt-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.crt-btn:disabled{opacity:.55;cursor:default}.crt-btn:active:not(:disabled){opacity:.7}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .crt-btn.p{color:#00160E}}" +
      ".crt-form :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}.crt-quiet .crt-btn{margin-left:8px}.crt-form label.miss{box-shadow:inset 3px 0 0 var(--danger)}.crt-form label.miss>span{font-weight:700}.crt-form label.miss>span::after{content:' *';color:var(--danger)}" +
      ".crt-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px}" +
      ".crt-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".crt-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:.5px solid var(--border);border-left:3px solid transparent}.crt-row:first-child{border-top:0}" +
      ".crt-row.over{border-left-color:var(--danger)}.crt-row.soon{border-left-color:#C98A12}.crt-row.none{border-left-color:var(--border)}" +
      ".crt-row .t{flex:1;min-width:0}.crt-row b{display:block;font-size:15px;font-weight:600}.crt-row span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".crt-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap}" +
      ".crt-pill.over{background:rgba(215,38,28,.12);color:var(--danger)}.crt-pill.soon{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.crt-row.none .crt-pill{display:none}.crt-pill.ok{background:rgba(10,143,106,.12);color:var(--accent)}.crt-pill.none{background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".crt-form{border-top:.5px solid var(--border);background:rgba(118,118,128,.05)}" +
      ".crt-form label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 16px;border-top:.5px solid var(--border)}.crt-form label:first-child{border-top:0}" +
      ".crt-form label>span{flex:0 0 110px;font-size:15px}.crt-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".crt-form .acts{display:flex;gap:8px;padding:10px 16px;justify-content:flex-end;align-items:center}.crt-form .acts small{margin-right:auto;color:var(--muted);font-size:12.5px}" +
      ".crt-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
      ".crt-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".crt-print,.crt-pmeta{display:none}" +
      "@media (max-width:600px){.crt{padding:4px 16px 0}.crt h1{font-size:32px}.crt-row{flex-wrap:wrap;row-gap:8px}.crt-row .t{flex-basis:100%}.crt-row .crt-btn{margin-left:auto}.crt-row.none{flex-wrap:nowrap}.crt-row.none .t{flex-basis:auto}.crt-form label>span{flex-basis:96px}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.crt-back,.crt-top .crt-btn,.crt-lab,.crt-list,.crt-note,.crt-quiet,.eikon-toast{display:none!important}" +
      ".eikon-content{padding:0!important}.crt-pmeta{display:block;font-size:12px;margin:2px 0 8px}.crt-print{display:table;width:100%;border-collapse:collapse;font-size:11px}" +
      ".crt-print th,.crt-print td{border:1px solid #999;padding:3px 6px;text-align:left}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/certificates/items", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the certificates");
      S.items = r.items || [];
    } catch (e) {
      if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the certificates");
    }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function rowHtml(it) {
    var st = state(it), sub = [];
    if (it.next_due) sub.push(sc(it.next_label || "Next due") + " " + nice(it.next_due));
    if (it.last_date) sub.push(sc(it.last_label || "Last") + " " + nice(it.last_date));
    if (!it.last_date) sub.push(sc(it.subtitle || ("Every " + it.interval_months + " months")));
    if (it.certified_person) sub.push(it.certified_person);
    if (it.file_name) sub.push("File: " + it.file_name);
    var h = '<div class="crt-row ' + st.k + '" data-id="' + it.id + '"><div class="t"><b>' + esc(sc(it.title)) + "</b><span>" + esc(sub.join(" · ")) + "</span></div>" +
      '<span class="crt-pill ' + st.k + '">' + esc(st.label) + "</span>" +
      (S.editing === it.id ? "" : '<button class="crt-btn" data-act="edit" data-id="' + it.id + '" aria-label="' + esc((it.last_date ? "Update " : "Record ") + sc(it.title)) + '">' + (it.last_date ? "Update" : "Record") + "</button>") + "</div>";
    if (S.editing === it.id) {
      // What was typed survives an error. A renewal (nothing recorded yet, overdue or due soon) starts on today's date,
      // the usual case; an item in date keeps its date, so changing only the person never moves it.
      var renew = !it.last_date || st.k === "over" || st.k === "soon";
      var dv = S.draft || { last_date: renew ? ymd(new Date()) : it.last_date, interval_months: it.interval_months, certified_person: it.certified_person || "" };
      var bad = S.formBad || "", inv = function (k) { return bad === k ? ' aria-invalid="true" aria-describedby="crt-err"' : ""; }, cls = function (k) { return bad === k ? ' class="miss"' : ""; };
      h += '<form class="crt-form" id="crt-form" novalidate autocomplete="off" aria-label="' + esc(sc(it.title)) + '">' +
        "<label" + cls("last_date") + "><span>" + esc(sc(it.last_label || "Last date")) + '</span><input type="date" name="last_date" max="' + esc(ymd(new Date())) + '" value="' + esc(dv.last_date) + '"' + inv("last_date") + "></label>" +
        "<label" + cls("interval_months") + '><span>Every</span><input type="number" name="interval_months" min="1" max="120" inputmode="numeric" value="' + esc(dv.interval_months) + '"' + inv("interval_months") + '><em style="font-style:normal;color:var(--muted)">months</em></label>' +
        (it.requires_person ? "<label" + cls("certified_person") + '><span>Certified</span><input name="certified_person" placeholder="Name and surname" value="' + esc(dv.certified_person) + '"' + inv("certified_person") + "></label>" : "") +
        (S.formErr ? '<div class="crt-err" id="crt-err" role="alert">' + esc(S.formErr) + "</div>" : "") +
        '<div class="acts"><small>The next due date is worked out for you.</small><button type="button" class="crt-btn" data-act="cancel">Cancel</button><button type="submit" class="crt-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save") + "</button></div></form>";
    }
    return h;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "certreg") return; // left before a reply came back: do not draw over the next screen
    var user = E.state.user || {};
    var h = '<div class="crt"><button class="crt-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("certreg") : "‹ Registers") + "</button>" +
      '<div class="crt-top"><div><h1>Certificates</h1><p class="crt-sub">Calibrations, services and licences, with what is due.</p></div>' +
      '<button class="crt-btn" data-act="print">Print</button></div>' +
      '<p class="crt-pmeta">' + esc((user.location_name || "") + " · Certificates · printed " + ymd(new Date())) + "</p>";
    if (S.loading && !S.items.length) h += '<div class="crt-quiet">Opening the certificates…</div>';
    else if (S.error) h += '<div class="crt-quiet" role="alert">' + esc(S.error) + ' <button class="crt-btn" data-act="retry">Try again</button></div>';
    else if (!S.items.length) h += '<div class="crt-quiet">No certificates are set up for this pharmacy.</div>';
    else {
      var sorted = S.items.slice().sort(function (a, b) { var x = state(a), y = state(b); return x.order - y.order || (x.n || 0) - (y.n || 0) || String(a.title).localeCompare(String(b.title)); });
      // Never-recorded items get their own group at the end as one-line rows, so what is overdue or due soon is what you see first.
      var need = sorted.filter(function (it) { var k = state(it).k; return k === "over" || k === "soon"; }), fine = sorted.filter(function (it) { return state(it).k === "ok"; }), never = sorted.filter(function (it) { return state(it).k === "none"; });
      if (need.length) h += '<div class="crt-lab">Needs attention</div><div class="crt-list">' + need.map(rowHtml).join("") + "</div>";
      if (fine.length) h += '<div class="crt-lab">In date</div><div class="crt-list">' + fine.map(rowHtml).join("") + "</div>";
      if (never.length) h += '<div class="crt-lab">Not recorded yet</div><div class="crt-list">' + never.map(rowHtml).join("") + "</div>";
      h += '<p class="crt-note" style="font-size:12.5px;color:var(--muted);margin-top:12px">To upload or download a certificate file, use the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p>';
      h += '<table class="crt-print"><thead><tr><th>Item</th><th>Last</th><th>Next due</th><th>Every</th><th>Certified</th><th>Status</th></tr></thead><tbody>' +
        sorted.map(function (it) { return "<tr><td>" + esc(it.title) + "</td><td>" + esc(nice(it.last_date)) + "</td><td>" + esc(nice(it.next_due)) + "</td><td>" + esc(it.interval_months) + " months</td><td>" + esc(it.certified_person || "") + "</td><td>" + esc(state(it).label) + "</td></tr>"; }).join("") +
        "</tbody></table>";
    }
    h += "</div>";
    m.innerHTML = h;
    bind(m);
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("certreg") : "#registers";
        else if (a === "retry") load();
        else if (a === "print") printList();
        else if (a === "edit") { S.editing = Number(b.getAttribute("data-id")); S.formErr = ""; S.formBad = ""; S.draft = null; paint(); setTimeout(function () { var f = m.querySelector("[name=last_date]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (a === "cancel") closeForm();
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "certreg"); } catch (e) {} E.openClassic("certificates"); }
      });
    });
    var f = m.querySelector("#crt-form");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); save(f); });
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.saving) { ev.preventDefault(); closeForm(); } });
    }
  }
  // Escape or Cancel: the form closes and focus goes back to the row's button, so the keyboard carries on from there.
  function closeForm() {
    var id = S.editing; S.editing = null; S.formErr = ""; S.formBad = ""; S.draft = null; paint();
    var b = S.mount && S.mount.querySelector('[data-act=edit][data-id="' + id + '"]'); if (b) b.focus();
  }

  // The printout as every register prints (E.months.print): the pharmacy, page numbers, black on white; the classic columns.
  function printList() {
    var MB = E.months, sorted = S.items.slice().sort(function (a, b) { var x = state(a), y = state(b); return x.order - y.order || (x.n || 0) - (y.n || 0) || String(a.title).localeCompare(String(b.title)); });
    if (!MB || !MB.print) return window.print();
    MB.print({ register: "Certificates", period: "Printed " + MB.dmy(ymd(new Date())), sections: [{ cols: ["Item", "Last", "Next due", "Every", "Certified", "Status"],
      rows: sorted.map(function (it) { var st = state(it), t = st.label; return [sc(it.title || ""), MB.dmy(it.last_date || ""), MB.dmy(it.next_due || ""), it.interval_months ? it.interval_months + " months" : "", it.certified_person || "", st.k === "over" ? { html: "<b>" + esc(t) + "</b>" } : t]; }),
      empty: "No certificates are set up for this pharmacy." }] });
  }

  async function save(f) {
    if (S.saving) return;
    var it = S.items.find(function (x) { return x.id === S.editing; }); if (!it) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var last = v("last_date"), every = Math.round(Number(v("interval_months")));
    S.draft = { last_date: last, interval_months: v("interval_months"), certified_person: v("certified_person") };
    // every problem at once; the first one is marked and focused
    var errs = [], bad = [];
    if (!last) { errs.push("choose the date"); bad.push("last_date"); }
    else if (last > ymd(new Date())) { errs.push("the date is in the future: choose today or earlier"); bad.push("last_date"); }
    if (!(every >= 1 && every <= 120)) { errs.push("write how often, from 1 to 120 months"); bad.push("interval_months"); }
    if (it.requires_person && !v("certified_person")) { errs.push("write who is certified"); bad.push("certified_person"); }
    S.formBad = bad[0] || "";
    S.formErr = errs.length ? errs.join(", ").replace(/^./, function (c) { return c.toUpperCase(); }) + ". Nothing was saved." : "";
    if (S.formErr) { paint(); var first = S.mount.querySelector('#crt-form [name="' + S.formBad + '"]'); if (first) first.focus(); return; }
    var body = { last_date: last, interval_months: every };
    if (it.requires_person) body.certified_person = v("certified_person");
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/certificates/items/" + encodeURIComponent(String(it.id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.editing = null; S.draft = null; S.formBad = ""; E.toast(sc(it.title) + " updated", "success");
    } catch (e) { S.formErr = E.saveFailText(e); }
    S.saving = false;
    var done = S.editing == null;
    await load();
    if (done && S.mount) { var b = S.mount.querySelector('[data-act=edit][data-id="' + it.id + '"]'); if (b && (!document.activeElement || document.activeElement === document.body)) b.focus({ preventScroll: true }); }
  }

  E.registerModule({
    id: "certreg", title: "Certificates", order: 3, icon: "✓", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.editing = null; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("certreg") < 0) E.UI2_DESTINATIONS.push("certreg");
  if (E.UI2_PARENT) E.UI2_PARENT.certreg = "registers";
})();
