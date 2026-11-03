/* Locum register, new layout: which pharmacist was in charge, when, with their registration number.
   The month by day, a quick entry form that fills a known locum's registration number, and a printout.
   Same endpoints as the classic screen (/locumregister/entries); corrections still happen there. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: null, entries: [], history: [], loading: false, error: "", form: null, saving: false };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = String(s).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function shiftMonth(m, k) { var p = m.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(m) { var p = m.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function dayLong(s) { var d = parse(s); return s === ymd(new Date()) ? "Today" : WDN[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; }
  function hmNow() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function css() {
    if (document.getElementById("eikon-locreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-locreg-css";
    // Shares the look of the other rebuilt registers; only what differs is here.
    st.textContent =
      ".lcr{max-width:860px;margin:0 auto}" +
      ".lcr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0;margin:-10px 0 0;cursor:pointer}" +
      ".lcr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".lcr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.lcr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".lcr-acts{display:flex;gap:8px}" +
      ".lcr-btn{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".lcr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.lcr-btn:disabled{opacity:.55;cursor:default}.lcr-btn:active:not(:disabled){opacity:.7}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .lcr-btn.p{color:#00160E}}" +
      ".lcr-form :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}.lcr-quiet .lcr-btn{margin-left:8px}" +
      ".lcr-month{display:flex;align-items:center;gap:6px;margin:18px 0 6px}.lcr-month b{font-size:17px;min-width:150px;text-align:center}" +
      ".lcr-arrow{width:34px;height:34px;border-radius:50%;border:0;background:rgba(118,118,128,.12);color:var(--text);font-size:18px;cursor:pointer}.lcr-arrow:disabled{opacity:.35;cursor:default}" +
      ".lcr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 2px 7px}" +
      ".lcr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".lcr-row{display:flex;align-items:center;gap:12px;padding:11px 16px;border-top:.5px solid var(--border)}.lcr-row:first-child{border-top:0}" +
      ".lcr-row .t{flex:1;min-width:0}.lcr-row b{display:block;font-size:14.5px;font-weight:600}.lcr-row span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".lcr-row .tm{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);white-space:nowrap}" +
      ".lcr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".lcr-form label{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border)}.lcr-form label:first-child{border-top:0}" +
      ".lcr-form label>span{flex:0 0 108px;font-size:15px;white-space:nowrap}.lcr-form label.miss{box-shadow:inset 3px 0 0 var(--danger)}.lcr-form label.miss>span{font-weight:700}.lcr-form label.miss>span::after{content:' *';color:var(--danger)}" +
      ".lcr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".lcr-form .acts{display:flex;gap:8px;padding:10px 16px 8px;justify-content:flex-end}" +
      ".lcr-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
      ".lcr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".lcr-print,.lcr-pmeta{display:none}" +
      "@media (max-width:600px){.lcr{padding:4px 16px 0}.lcr h1{font-size:32px}.lcr-form label>span{flex-basis:100px}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.lcr-back,.lcr-acts,.lcr-month,.lcr-lab,.lcr-list,.lcr-form,.lcr-note,.eikon-toast{display:none!important}" +
      ".eikon-content{padding:0!important}.lcr-pmeta{display:block;font-size:12px;margin:2px 0 8px}.lcr-print{display:table;width:100%;border-collapse:collapse;font-size:11px}" +
      ".lcr-print th,.lcr-print td{border:1px solid #999;padding:3px 6px;text-align:left}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var res = await Promise.all([S.month, shiftMonth(S.month, -1)].map(function (mo) { return E.apiFetch("/locumregister/entries?month=" + encodeURIComponent(mo), { method: "GET" }); }));
      var byNewest = function (a, b) { return (String(a.entry_date) + (a.time_in || "")) < (String(b.entry_date) + (b.time_in || "")) ? 1 : -1; };
      S.entries = ((res[0] && res[0].entries) || []).slice().sort(byNewest);
      S.history = S.entries.concat((res[1] && res[1].entries) || []);
    } catch (e) {
      if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
    }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function formHtml() {
    var f = S.form, names = {}, miss = f.missing || [];
    S.history.forEach(function (e) { if (e.locum_full_name) names[e.locum_full_name] = 1; });
    var row = function (k, label, type, ph, extra) {
      var b = miss.indexOf(k) >= 0;
      return '<label' + (b ? ' class="miss"' : "") + "><span>" + label + '</span><input name="' + k + '" type="' + type + '" placeholder="' + esc(ph) + '" value="' + esc(f[k] || "") + '"' + (extra || "") + (b ? ' aria-invalid="true" aria-describedby="lcr-err"' : "") + "></label>";
    };
    return '<form class="lcr-form" id="lcr-form" novalidate autocomplete="off" aria-label="New locum">' +
      row("entry_date", "Date", "date", "", ' max="' + esc(ymd(new Date())) + '"') +
      row("time_in", "Time in", "time", "") +
      row("time_out", "Time out", "time", "Optional") +
      row("locum_full_name", "Pharmacist", "text", "Name and surname", ' list="lcr-names"') +
      row("registration_number", "Reg no", "text", "Registration number") +
      '<datalist id="lcr-names">' + Object.keys(names).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
      (f.err ? '<div class="lcr-err" id="lcr-err" role="alert">' + esc(f.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="lcr-btn" data-act="cancel">Cancel</button><button type="submit" class="lcr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save locum") + "</button></div></form>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "locreg") return; // left before a reply came back: do not draw over the next screen
    var MB = E.months, user = E.state.user || {};
    var h = '<div class="lcr"><button class="lcr-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("locreg") : "‹ Registers") + "</button>" +
      '<div class="lcr-top"><div><h1>Locum register</h1><p class="lcr-sub">Which pharmacist was in charge, and when.</p></div>' +
      '<div class="lcr-acts">' + (S.form ? "" : '<button class="lcr-btn p" data-act="new">New locum</button>') + "</div></div>" +
      '<p class="lcr-pmeta">' + esc((user.location_name || "") + " · Locum register · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>";
    if (S.form) h += formHtml();
    h += MB.bar(S.month, { label: "Locum register" });
    if (S.loading && !S.entries.length) h += '<div class="lcr-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="lcr-quiet" role="alert">' + esc(S.error) + ' <button class="lcr-btn" data-act="retry">Try again</button></div>';
    else if (!S.entries.length) h += '<div class="lcr-quiet" data-empty>' + esc(MB.empty(S.month)) + "</div>";
    else {
      var day = null;
      S.entries.forEach(function (e) {
        if (e.entry_date !== day) { if (day) h += "</div>"; day = e.entry_date; h += '<div class="lcr-lab">' + esc(dayLong(day)) + '</div><div class="lcr-list">'; }
        h += '<div class="lcr-row"><div class="t"><b>' + esc(e.locum_full_name) + "</b><span>Reg no " + esc(e.registration_number) + '</span></div><div class="tm">' +
          esc(e.time_in || "") + (e.time_out ? "–" + esc(e.time_out) : " onwards") + "</div></div>";
      });
      h += "</div>";
    }
    h += '<p class="lcr-note" style="font-size:12.5px;color:var(--muted);margin-top:12px">To correct or remove a line, open it in the <a href="#" data-act="classic" style="color:var(--accent)">classic register</a>.</p>';
    h += '<table class="lcr-print"><thead><tr><th>Date</th><th>Time in</th><th>Time out</th><th>Pharmacist</th><th>Reg no</th></tr></thead><tbody>' +
      (S.entries.length ? S.entries.slice().reverse().map(function (e) {
        return "<tr><td>" + esc(e.entry_date) + "</td><td>" + esc(e.time_in || "") + "</td><td>" + esc(e.time_out || "") + "</td><td>" + esc(e.locum_full_name) + "</td><td>" + esc(e.registration_number) + "</td></tr>";
      }).join("") : '<tr><td colspan="5">No locum recorded this month.</td></tr>') + "</tbody></table></div>";
    m.innerHTML = h;
    bind(m);
    MB.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; load(); }, paint: paint, print: printMonth });
  }
  // The classic locum register printout: one line per entry, oldest first.
  function printMonth() {
    var MB = E.months;
    MB.print({ register: "Locum register", month: S.month, sections: [{ cols: ["Date", "Time in", "Time out", "Name and surname", "Registration no"],
      rows: S.entries.slice().reverse().map(function (e) { return [MB.dmy(e.entry_date), e.time_in || "", e.time_out || "", e.locum_full_name || "", e.registration_number || ""]; }) }] });
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("locreg") : "#registers";
        else if (a === "retry") load();
        else if (a === "new") { S.form = { entry_date: ymd(new Date()), time_in: hmNow() }; paint(); setTimeout(function () { var c = m.querySelector("[name=locum_full_name]"); if (c && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) c.focus(); }, 30); }
        else if (a === "cancel") { S.form = null; paint(); var nb = m.querySelector("[data-act=new]"); if (nb) nb.focus(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "locreg"); } catch (e) {} E.openClassic("locumregister"); }
      });
    });
    var f = m.querySelector("#lcr-form");
    if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); save(f); });
    var nm = f.querySelector("[name=locum_full_name]"), rg = f.querySelector("[name=registration_number]");
    // a locum who worked here before brings their registration number: on leaving the name, or as soon as a suggestion
    // is picked; only into an empty field, never over what was typed (E.fillEmpty)
    var fillReg = function () {
      var hit = S.history.find(function (e) { return norm(e.locum_full_name) === norm(nm.value) && e.registration_number; });
      if (!hit) return;
      if (E.fillEmpty) E.fillEmpty(f, { registration_number: hit.registration_number }); else if (!rg.value) rg.value = hit.registration_number;
    };
    nm.addEventListener("change", fillReg);
    nm.addEventListener("input", function (ev) { if (!ev.inputType || ev.inputType === "insertReplacementText") fillReg(); }); // a datalist pick
    f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.saving) { ev.preventDefault(); S.form = null; paint(); var nb = m.querySelector("[data-act=new]"); if (nb) nb.focus(); } });
  }

  async function save(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { entry_date: v("entry_date"), time_in: v("time_in"), time_out: v("time_out"), locum_full_name: v("locum_full_name"), registration_number: v("registration_number") };
    var need = { entry_date: "the date", time_in: "the time in", locum_full_name: "the pharmacist", registration_number: "the registration number" };
    var missing = Object.keys(need).filter(function (k) { return !body[k]; }), errs = [];
    if (missing.length) errs.push("Fill in " + missing.map(function (k) { return need[k]; }).join(", "));
    if (body.entry_date && body.entry_date > ymd(new Date())) { errs.push("the date is in the future: choose today or earlier"); missing.push("entry_date"); }
    if (body.time_in && body.time_out && body.time_out < body.time_in) { errs.push("time out is before time in"); missing.push("time_out"); }
    S.form = Object.assign({}, body, { err: "", missing: missing });
    if (errs.length) { // every problem at once, each field marked, the first one focused
      S.form.err = errs.join("; ").replace(/^./, function (c) { return c.toUpperCase(); }) + ". Nothing was saved."; paint();
      var first = S.mount.querySelector('#lcr-form [name="' + missing[0] + '"]'); if (first) first.focus(); return;
    }
    S.saving = true; paint();
    try {
      var r = await E.postOnce("/locumregister/entries", body, { list: async function () { var r0 = await E.apiFetch("/locumregister/entries?month=" + body.entry_date.slice(0, 7), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; },
        same: function (e) { return e.entry_date === body.entry_date && String(e.time_in || "").slice(0, 5) === body.time_in && String(e.locum_full_name || "").trim().toLowerCase() === String(body.locum_full_name || "").trim().toLowerCase(); } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.form = null; E.toast("Saved · locum " + body.locum_full_name + " from " + body.time_in, "success");
      S.month = body.entry_date.slice(0, 7);
    } catch (e) {
      S.form.err = E.saveFailText(e);
    }
    S.saving = false;
    var saved = !S.form;
    await load();
    if (saved && S.mount && (!document.activeElement || document.activeElement === document.body)) { var nb = S.mount.querySelector("[data-act=new]"); if (nb) nb.focus({ preventScroll: true }); }
  }

  E.registerModule({
    id: "locreg", title: "Locum register", order: 3, icon: "◷", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.form = null; S.month = thisMonth(); S.entries = []; E.months.reset(); css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("locreg") < 0) E.UI2_DESTINATIONS.push("locreg");
  if (E.UI2_PARENT) E.UI2_PARENT.locreg = "registers";
})();
