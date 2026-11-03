/* Temperature register, new layout: the month at a glance for each fridge and room,
   what is missing, what was outside the limits, and a clean printout for an inspector.
   Reads the same endpoints as the classic screen; device settings stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: null, devices: [], entries: [], loading: false, error: "", focus: null };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function shiftMonth(m, k) { var p = m.split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function monthLabel(m) { var p = m.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; }
  function daysIn(m) { var p = m.split("-"); return new Date(Number(p[0]), Number(p[1]), 0).getDate(); }
  function fmt(v) { return v == null || v === "" ? "–" : String(Math.round(Number(v) * 10) / 10); }
  function outside(e, dv) {
    var lo = dv.min_limit, hi = dv.max_limit;
    return (lo != null && Number(e.min_temp) < Number(lo)) || (hi != null && Number(e.max_temp) > Number(hi));
  }
  function limitsText(dv) {
    if (dv.min_limit == null && dv.max_limit == null) return "No limits set";
    return fmt(dv.min_limit) + " to " + fmt(dv.max_limit) + " °C";
  }

  function css() {
    if (document.getElementById("eikon-tempreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-tempreg-css";
    st.textContent =
      ".trg{max-width:1100px;margin:0 auto}" +
      ".trg-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".trg-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}" +
      ".trg h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}" +
      ".trg-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".trg-acts{display:flex;gap:8px;align-items:center}" +
      ".trg-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".trg-month{display:flex;align-items:center;gap:6px;margin:14px 0 4px}" +
      ".trg-month b{font-size:17px;min-width:150px;text-align:center}" +
      ".trg-arrow{width:34px;height:34px;border-radius:50%;border:0;background:rgba(118,118,128,.12);color:var(--text);font-size:18px;cursor:pointer}" +
      ".trg-arrow:disabled{opacity:.35;cursor:default}" +
      ".trg-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-top:14px}" +
      ".trg-hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}" +
      ".trg-hd h2{font-size:17px;margin:0;font-weight:700}.trg-hd span{color:var(--muted);font-size:13px}" +
      ".trg-sum{font-size:13.5px;color:var(--muted);margin:4px 0 12px}.trg-sum b{color:var(--text);font-weight:600}.trg-sum .bad{color:var(--danger);font-weight:600}" +
      ".trg-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}" +
      ".trg-wd{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:center;padding-bottom:2px}" +
      ".trg-d{border-radius:10px;background:rgba(118,118,128,.08);min-height:58px;padding:6px 7px;display:flex;flex-direction:column;gap:2px}" +
      ".trg-d i{font-style:normal;font-size:11.5px;color:var(--muted);font-weight:600}" +
      ".trg-d b{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em;display:flex;flex-direction:column;line-height:1.25}" +
      ".trg-d.ok{background:rgba(10,143,106,.08)}" +
      ".trg-d.bad{background:rgba(215,38,28,.10)}.trg-d.bad b{color:var(--danger)}" +
      ".trg-d.miss{background:transparent;border:1px dashed rgba(201,138,18,.6)}.trg-d.miss b{color:var(--warn,#A06A0E);font-weight:500;font-size:12px}" +
      ".trg-d.future,.trg-d.pad{background:transparent}.trg-d.today{box-shadow:inset 0 0 0 2px var(--accent)}.trg-d.focus{box-shadow:inset 0 0 0 2px var(--danger)}" +
      ".trg-flag{background:rgba(201,138,18,.12);border:1px solid rgba(201,138,18,.45);border-left:4px solid #C98A12;border-radius:12px;padding:10px 14px;margin-top:14px;font-size:13.5px;line-height:1.45}.trg-flag b{color:var(--warn,#A06A0E)}.trg-flag a{color:var(--accent);font-weight:600}" +
      ".trg-note{font-size:12.5px;color:var(--muted);margin-top:10px}" +
      ".trg-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".trg-print,.trg-pmeta{display:none}" +
      "@media (max-width:600px){.trg{padding:4px 16px 0}.trg h1{font-size:32px}.trg-grid{gap:4px}.trg-d{min-height:50px;padding:5px;border-radius:8px}.trg-d b{font-size:11.5px}.trg-d i{font-size:10.5px}.trg-d.miss b{font-size:10px}.trg-card{padding:14px 12px}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.trg-back,.trg-acts,.trg-month,.trg-grid,.trg-wd,.eikon-toast{display:none!important}" +
      ".eikon-content{padding:0!important}.trg-card{border:0;padding:0;break-inside:avoid;margin-top:18px}.trg-pmeta{display:block;font-size:12px;margin:2px 0 0}.trg-print{display:table;width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}" +
      ".trg-print th,.trg-print td{border:1px solid #999;padding:3px 6px;text-align:left}.trg-print td.bad{font-weight:700}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      // both at once (they do not depend on each other): one round trip instead of two
      var both = await Promise.all([E.apiFetch("/temperature/devices", { method: "GET" }), E.apiFetch("/temperature/entries?month=" + encodeURIComponent(S.month), { method: "GET" })]);
      var dv = both[0], en = both[1];
      S.devices = ((dv && dv.devices) || []).filter(function (d) { return Number(d.active) !== 0; });
      S.entries = (en && en.entries) || [];
    } catch (e) {
      if (!keepView) S.error = e && e.network ? "Can't reach the server. The register is safe; try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
    }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function deviceCard(dv) {
    var m = S.month, n = daysIn(m), today = ymd(new Date());
    var byDay = {};
    S.entries.forEach(function (e) { if (Number(e.device_id) === Number(dv.id)) byDay[e.entry_date] = e; });
    var p = m.split("-"), first = new Date(Number(p[0]), Number(p[1]) - 1, 1);
    var lead = (first.getDay() + 6) % 7; // Monday first
    var cells = WD.map(function (w) { return '<div class="trg-wd">' + w + "</div>"; }).join("");
    for (var i = 0; i < lead; i++) cells += '<div class="trg-d pad"></div>';
    var logged = 0, bad = 0, missed = 0, rows = "";
    for (var d = 1; d <= n; d++) {
      var key = m + "-" + pad(d), e = byDay[key], cls, txt;
      if (e) {
        logged++; var o = outside(e, dv); if (o) bad++;
        cls = o ? "bad" : "ok"; txt = "<span>" + fmt(e.min_temp) + "</span><span>" + fmt(e.max_temp) + "</span>";
        rows += "<tr><td>" + key + "</td><td" + (o ? ' class="bad"' : "") + ">" + fmt(e.min_temp) + "</td><td" + (o ? ' class="bad"' : "") + ">" + fmt(e.max_temp) + "</td><td>" + (o ? "Outside limits" : "") + (e.notes ? " " + esc(e.notes) : "") + "</td></tr>";
      } else if (key < today) {
        missed++; cls = "miss"; txt = "Not logged";
        rows += "<tr><td>" + key + "</td><td>–</td><td>–</td><td>Not logged</td></tr>";
      } else { cls = "future"; txt = ""; }
      if (key === today) cls += " today";
      if (S.focus && S.focus.day === key && String(S.focus.device) === String(dv.id)) cls += " focus";
      cells += '<div class="trg-d ' + cls + '" title="' + esc(key) + '"><i>' + d + "</i><b>" + txt + "</b></div>";
    }
    var sum = "<b>" + logged + "</b> of " + n + " days logged" +
      (bad ? ' · <span class="bad">' + bad + " outside the limits</span>" : " · none outside the limits") +
      (missed ? " · " + missed + " not logged" : "");
    return '<section class="trg-card" data-device="' + esc(dv.id) + '"><div class="trg-hd"><h2>' + esc(dv.name) + "</h2><span>" +
      esc(dv.device_type === "fridge" ? "Fridge" : dv.device_type === "room" ? "Room" : (dv.device_type || "")) + " · " + esc(limitsText(dv)) + "</span></div>" +
      '<div class="trg-sum">' + sum + "</div>" +
      '<div class="trg-grid">' + cells + "</div>" +
      '<table class="trg-print"><thead><tr><th>Date</th><th>Min °C</th><th>Max °C</th><th>Note</th></tr></thead><tbody>' + rows + "</tbody></table></section>";
  }

  // Opened from Today's "outside limits yesterday" line: that day is outlined, and the way to add the note is said.
  function focusNote() {
    var f = S.focus; if (!f || f.day.slice(0, 7) !== S.month) return "";
    var dv = S.devices.find(function (d) { return String(d.id) === String(f.device); }); if (!dv) return "";
    var e = S.entries.find(function (x) { return Number(x.device_id) === Number(dv.id) && x.entry_date === f.day; });
    if (!e || !outside(e, dv)) return "";
    var p = f.day.split("-");
    return '<div class="trg-flag" role="status"><b>' + esc(dv.name) + " on " + Number(p[2]) + " " + MONTHS[Number(p[1]) - 1] + ": " + fmt(e.min_temp) + " to " + fmt(e.max_temp) + " °C</b>, outside " + esc(limitsText(dv)) + "." +
      (e.notes ? " Note: " + esc(e.notes) : ' No note yet. <a href="#" data-act="note">Add a note in the classic Temperature screen ›</a>') + "</div>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "tempreg") return; // left before the data came back: do not draw over the next screen
    var MB = E.months;
    var h = '<div class="trg">' +
      '<button class="trg-back" data-act="back">‹ Registers</button>' +
      '<div class="trg-top"><div><h1>Temperature</h1><p class="trg-sub">Fridges and rooms, every day, against their limits.</p></div>' +
      '<div class="trg-acts"><button class="trg-btn" data-act="devices">Devices</button></div></div>' +
      '<p class="trg-pmeta">' + esc(((E.state.user || {}).location_name || "") + " · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>" +
      MB.bar(S.month, { label: "Temperature" });
    if (S.loading && !S.devices.length) h += '<div class="trg-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="trg-quiet">' + esc(S.error) + "</div>";
    else if (!S.devices.length) h += '<div class="trg-quiet">No fridges or rooms are set up yet. Add them under Devices.</div>';
    else h += focusNote() + (S.month < thisMonth() && !S.entries.length ? '<div class="trg-quiet" data-empty>' + esc(MB.empty(S.month)) + "</div>" : "") +
      S.devices.map(deviceCard).join("") + '<p class="trg-note">Readings are logged on Today. Each day shows the minimum above the maximum; a dashed day was not logged.</p>';
    h += "</div>";
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "note") ev.preventDefault();
        if (a === "back") window.location.hash = "#registers";
        else if (a === "note") { try { sessionStorage.setItem("eikon_ui2_return", "tempreg"); } catch (e) {} E.openClassic("temperature"); }
        else if (a === "devices") { try { sessionStorage.setItem("eikon_ui2_return", "tempreg"); } catch (e) {} E.openClassic("temperature"); }
      });
    });
    MB.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; load(); }, paint: paint, print: printMonth });
  }

  // The classic temperature report for one month: a line per day, a column per fridge or room, "min / max" in each,
  // "Not logged" for a day that has passed without a reading (bold when outside the limits).
  function printMonth() {
    var MB = E.months, m = S.month, n = daysIn(m), today = ymd(new Date()), at = {};
    S.entries.forEach(function (e) { at[e.entry_date + "|" + e.device_id] = e; });
    var devs = S.devices.slice();
    S.entries.forEach(function (e) { if (!devs.some(function (d) { return Number(d.id) === Number(e.device_id); })) devs.push({ id: e.device_id, name: e.device_name || ("Device " + e.device_id), device_type: e.device_type, min_limit: e.min_limit, max_limit: e.max_limit }); });
    var rows = [];
    for (var d = 1; d <= n; d++) {
      var key = m + "-" + pad(d); if (key > today) break;
      rows.push([MB.dmy(key)].concat(devs.map(function (dv) {
        var e = at[key + "|" + dv.id];
        if (!e) return key < today ? { html: '<span class="miss">Not logged</span>' } : "";
        var o = outside(e, dv), t = fmt(e.min_temp) + " / " + fmt(e.max_temp) + (o ? " (outside limits)" : "") + (e.notes ? " · " + e.notes : "");
        return o ? { html: "<b>" + esc(t) + "</b>" } : t;
      })));
    }
    MB.print({ register: "Temperature", month: m,
      intro: '<p class="sub">Each day: minimum / maximum °C. Limits: ' + esc(devs.map(function (dv) { return dv.name + " " + limitsText(dv); }).join(" · ")) + ".</p>",
      sections: [{ cols: [m.slice(0, 4) + "-" + m.slice(5)].concat(devs.map(function (dv) { return dv.name; })), rows: rows, empty: devs.length ? MB.empty(m) : "No fridges or rooms are set up." }] });
  }

  E.registerModule({
    id: "tempreg", title: "Temperature", order: 3, icon: "🌡", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.month = thisMonth(); S.entries = []; if (E.months.reset) E.months.reset();
      S.focus = null;
      try { var f = JSON.parse(sessionStorage.getItem("eikon_tempreg_day") || "null"); sessionStorage.removeItem("eikon_tempreg_day");
        if (f && /^\d{4}-\d{2}-\d{2}$/.test(f.day || "")) { S.focus = f; S.month = f.day.slice(0, 7); } } catch (e) {}
      css(); paint(); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("tempreg") < 0) E.UI2_DESTINATIONS.push("tempreg");
})();
