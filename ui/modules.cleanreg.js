/* Cleaning register, new layout: when the dispensary and fridge were last cleaned, every week of the month
   with what was recorded (or that nothing was), a short form to record one, and a printout for an inspector.
   Same endpoints as the classic screen (/cleaning/entries). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var DUE_DAYS = 7; // cleaned at least once a week
  var S = { mount: null, month: null, entries: [], around: [], recent: [], loading: false, error: "", form: null, saving: false };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = String(s).split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function shiftMonth(m, k) { var p = m.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(m) { var p = m.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function dayShort(s) { var d = parse(s); return WDN[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; }
  function hmNow() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function daysAgo(s) { return Math.round((parse(ymd(new Date())) - parse(s)) / 86400000); }
  function agoText(n) { return n <= 0 ? "today" : n === 1 ? "yesterday" : n + " days ago"; }

  function css() {
    if (document.getElementById("eikon-cleanreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-cleanreg-css";
    st.textContent =
      ".clr{max-width:860px;margin:0 auto}" +
      ".clr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".clr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".clr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}" +
      ".clr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".clr-acts{display:flex;gap:8px}" +
      ".clr-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".clr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.clr-btn:disabled{opacity:.55;cursor:default}" +
      ".clr-status{display:flex;align-items:center;gap:12px;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:16px}" +
      ".clr-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--ok)}.clr-status.late .clr-dot{background:var(--danger)}" +
      ".clr-status b{font-size:15.5px}.clr-status span{display:block;color:var(--muted);font-size:13px}" +
      ".clr-month{display:flex;align-items:center;gap:6px;margin:18px 0 6px}.clr-month b{font-size:17px;min-width:150px;text-align:center}" +
      ".clr-arrow{width:34px;height:34px;border-radius:50%;border:0;background:rgba(118,118,128,.12);color:var(--text);font-size:18px;cursor:pointer}.clr-arrow:disabled{opacity:.35;cursor:default}" +
      ".clr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 2px 7px}" +
      ".clr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".clr-row{display:flex;align-items:center;gap:12px;padding:11px 16px;border-top:.5px solid var(--border)}.clr-row:first-child{border-top:0}" +
      ".clr-row .t{flex:1;min-width:0}.clr-row b{display:block;font-size:14.5px;font-weight:600}.clr-row span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".clr-row .tm{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted);white-space:nowrap}" +
      ".clr-row.none b{color:var(--warn,#A06A0E);font-weight:500}.clr-row.none{background:rgba(201,138,18,.06)}" +
      ".clr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".clr-form label{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border)}.clr-form label:first-child{border-top:0}" +
      ".clr-form label>span{flex:0 0 96px;font-size:15px}.clr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".clr-form .acts{display:flex;gap:8px;padding:10px 16px 8px;justify-content:flex-end}" +
      ".clr-err{color:var(--danger);font-size:13px;padding:0 16px 6px}" +
      ".clr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".clr-print,.clr-pmeta{display:none}" +
      "@media (max-width:600px){.clr{padding:4px 16px 0}.clr h1{font-size:32px}.clr-form label>span{flex-basis:84px}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.clr-back,.clr-acts,.clr-month,.clr-lab,.clr-list,.clr-form,.clr-status,.eikon-toast{display:none!important}" +
      ".eikon-content{padding:0!important}.clr-pmeta{display:block;font-size:12px;margin:2px 0 8px}.clr-print{display:table;width:100%;border-collapse:collapse;font-size:11px}" +
      ".clr-print th,.clr-print td{border:1px solid #999;padding:3px 6px;text-align:left}}";
    document.head.appendChild(st);
  }

  async function load() {
    S.loading = true; S.error = ""; paint();
    try {
      // Weeks cross month ends, and the status line needs the last clean even if it was last month:
      // read the month either side too (the next one only for a past month). Two or three small reads.
      var months = [shiftMonth(S.month, -1), S.month].concat(S.month < thisMonth() ? [shiftMonth(S.month, 1)] : []);
      var res = await Promise.all(months.map(function (mo) { return E.apiFetch("/cleaning/entries?month=" + encodeURIComponent(mo), { method: "GET" }); }));
      var byNewest = function (a, b) { return (a.entry_date + (a.time_in || "")) < (b.entry_date + (b.time_in || "")) ? 1 : -1; };
      S.around = [].concat.apply([], res.map(function (r) { return (r && r.entries) || []; })).sort(byNewest);
      S.entries = S.around.filter(function (e) { return String(e.entry_date).slice(0, 7) === S.month; });
      S.recent = S.around;
    } catch (e) {
      S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
    }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  // Weeks (Monday to Sunday) that touch the month, newest first; future weeks are left out.
  function weeks() {
    var p = S.month.split("-"), first = new Date(Number(p[0]), Number(p[1]) - 1, 1), last = new Date(Number(p[0]), Number(p[1]), 0);
    var start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    var today = ymd(new Date()), out = [];
    for (var d = new Date(start); d <= last; d.setDate(d.getDate() + 7)) {
      var a = ymd(d), e = new Date(d); e.setDate(e.getDate() + 6);
      if (a > today) break;
      out.push({ from: a, to: ymd(e) });
    }
    return out.reverse();
  }

  function statusHtml() {
    if (S.month !== thisMonth()) return "";
    var last = (S.recent || [])[0];
    if (!last) return '<div class="clr-status late"><i class="clr-dot"></i><div><b>No cleaning recorded recently</b><span>The dispensary and fridge are cleaned at least once a week.</span></div></div>';
    var n = daysAgo(last.entry_date), late = n > DUE_DAYS;
    return '<div class="clr-status' + (late ? " late" : "") + '"><i class="clr-dot"></i><div><b>' +
      (late ? "Overdue · last cleaned " : "Last cleaned ") + esc(agoText(n)) + (last.cleaner_name ? " by " + esc(last.cleaner_name) : "") + "</b><span>" +
      (late ? "It is due once a week." : "Next one due " + esc(dayShort(ymd(new Date(parse(last.entry_date).getTime() + DUE_DAYS * 86400000)))) + ".") + "</span></div></div>";
  }

  function formHtml() {
    var f = S.form;
    return '<form class="clr-form" id="clr-form">' +
      '<label><span>Date</span><input type="date" name="entry_date" value="' + esc(f.entry_date) + '" max="' + esc(ymd(new Date())) + '"></label>' +
      '<label><span>Time in</span><input type="time" name="time_in" value="' + esc(f.time_in) + '"></label>' +
      '<label><span>Time out</span><input type="time" name="time_out" value="' + esc(f.time_out) + '"></label>' +
      '<label><span>Cleaner</span><input name="cleaner_name" autocomplete="off" placeholder="Who cleaned" value="' + esc(f.cleaner_name) + '"></label>' +
      '<label><span>Notes</span><input name="notes" autocomplete="off" placeholder="Optional" value="' + esc(f.notes) + '"></label>' +
      (f.err ? '<div class="clr-err">' + esc(f.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="clr-btn" data-act="cancel">Cancel</button><button type="submit" class="clr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Record") + "</button></div></form>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "cleanreg") return; // left before a reply came back: do not draw over the next screen
    var isNow = S.month >= thisMonth(), user = E.state.user || {};
    var h = '<div class="clr"><button class="clr-back" data-act="back">‹ Registers</button>' +
      '<div class="clr-top"><div><h1>Cleaning</h1><p class="clr-sub">Dispensary and fridge, at least once a week.</p></div>' +
      '<div class="clr-acts">' + (S.form ? "" : '<button class="clr-btn p" data-act="new">Record a cleaning</button>') + '<button class="clr-btn" data-act="print">Print</button></div></div>' +
      '<p class="clr-pmeta">' + esc((user.location_name || "") + " · Cleaning register · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>";
    if (S.form) h += formHtml();
    h += statusHtml();
    h += '<div class="clr-month"><button class="clr-arrow" data-act="prev" aria-label="Previous month">‹</button><b>' + esc(monthLabel(S.month)) + '</b><button class="clr-arrow" data-act="next" aria-label="Next month"' + (isNow ? " disabled" : "") + ">›</button></div>";
    if (S.loading && !S.entries.length) h += '<div class="clr-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="clr-quiet">' + esc(S.error) + "</div>";
    else {
      weeks().forEach(function (w) {
        var inWeek = S.around.filter(function (e) { return e.entry_date >= w.from && e.entry_date <= w.to; });
        var current = w.to >= ymd(new Date()), last = (S.recent || [])[0], overdue = !last || daysAgo(last.entry_date) > DUE_DAYS;
        h += '<div class="clr-lab">' + (current ? "This week" : "Week of " + esc(dayShort(w.from))) + "</div><div class=\"clr-list\">";
        if (!inWeek.length) h += current && !overdue ? '<div class="clr-row"><div class="t"><span>Nothing recorded yet this week</span></div></div>' : '<div class="clr-row none"><div class="t"><b>No cleaning recorded this week</b></div></div>';
        inWeek.forEach(function (e) {
          h += '<div class="clr-row"><div class="t"><b>' + esc(dayShort(e.entry_date)) + (e.cleaner_name ? " · " + esc(e.cleaner_name) : "") + "</b><span>" +
            (e.staff_name ? "Checked by " + esc(e.staff_name) : "") + (e.notes ? (e.staff_name ? " · " : "") + esc(e.notes) : "") + "</span></div>" +
            '<div class="tm">' + esc(e.time_in || "") + (e.time_out ? "–" + esc(e.time_out) : "") + "</div></div>";
        });
        h += "</div>";
      });
      h += '<table class="clr-print"><thead><tr><th>Date</th><th>Time in</th><th>Time out</th><th>Cleaner</th><th>Checked by</th><th>Notes</th></tr></thead><tbody>' +
        (S.entries.length ? S.entries.slice().reverse().map(function (e) {
          return "<tr><td>" + esc(e.entry_date) + "</td><td>" + esc(e.time_in || "") + "</td><td>" + esc(e.time_out || "") + "</td><td>" + esc(e.cleaner_name || "") + "</td><td>" + esc(e.staff_name || "") + "</td><td>" + esc(e.notes || "") + "</td></tr>";
        }).join("") : '<tr><td colspan="6">No cleaning recorded this month.</td></tr>') + "</tbody></table>";
    }
    h += "</div>";
    m.innerHTML = h;
    bind(m);
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#registers";
        else if (a === "prev") { S.month = shiftMonth(S.month, -1); load(); }
        else if (a === "next") { if (S.month < thisMonth()) { S.month = shiftMonth(S.month, 1); load(); } }
        else if (a === "print") window.print();
        else if (a === "new") { S.form = { entry_date: ymd(new Date()), time_in: hmNow(), time_out: "", cleaner_name: "", notes: "", err: "" }; paint(); setTimeout(function () { var c = m.querySelector("[name=cleaner_name]"); if (c && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) c.focus(); }, 30); }
        else if (a === "cancel") { S.form = null; paint(); }
      });
    });
    var f = m.querySelector("#clr-form");
    if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); save(f); });
  }

  async function save(f) {
    if (S.saving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    var body = { entry_date: v("entry_date"), time_in: v("time_in"), time_out: v("time_out"), cleaner_name: v("cleaner_name"), staff_name: (E.state.user || {}).full_name || "", notes: v("notes") };
    S.form = Object.assign({}, S.form, body, { err: "" });
    if (!body.entry_date) { S.form.err = "Choose the date. Nothing was saved."; return paint(); }
    if (body.entry_date > ymd(new Date())) { S.form.err = "The date is in the future. Nothing was saved."; return paint(); }
    if (!body.cleaner_name) { S.form.err = "Write who cleaned. Nothing was saved."; return paint(); }
    if (!body.time_in) { S.form.err = "Fill in the time in. Nothing was saved."; return paint(); }
    if (body.time_in && body.time_out && body.time_out < body.time_in) { S.form.err = "Time out is before time in. Nothing was saved."; return paint(); }
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/cleaning/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.form = null; E.toast("Cleaning recorded · " + dayShort(body.entry_date) + " · " + body.cleaner_name, "success");
      S.month = body.entry_date.slice(0, 7);
    } catch (e) {
      S.form.err = E.saveFailText(e);
    }
    S.saving = false;
    return load();
  }

  E.registerModule({
    id: "cleanreg", title: "Cleaning", order: 3, icon: "✓", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.form = null; if (!S.month) S.month = thisMonth(); css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("cleanreg") < 0) E.UI2_DESTINATIONS.push("cleanreg");
  if (E.UI2_PARENT) E.UI2_PARENT.cleanreg = "registers";
})();
