/* Temperature register, new layout: the month at a glance for each fridge and room,
   what is missing, what was outside the limits, and a clean printout for an inspector.
   Reads the same endpoints as the classic screen; device settings stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: null, devices: [], entries: [], loading: false, error: "" };
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
      ".trg-d.future,.trg-d.pad{background:transparent}.trg-d.today{box-shadow:inset 0 0 0 2px var(--accent)}" +
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
    S.loading = true; S.error = ""; paint();
    try {
      var dv = await E.apiFetch("/temperature/devices", { method: "GET" });
      var en = await E.apiFetch("/temperature/entries?month=" + encodeURIComponent(S.month), { method: "GET" });
      S.devices = ((dv && dv.devices) || []).filter(function (d) { return Number(d.active) !== 0; });
      S.entries = (en && en.entries) || [];
    } catch (e) {
      S.error = e && e.network ? "Can't reach the server. The register is safe; try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
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
        missed++; cls = "miss"; txt = "Missed";
        rows += "<tr><td>" + key + "</td><td>–</td><td>–</td><td>Not logged</td></tr>";
      } else { cls = "future"; txt = ""; }
      if (key === today) cls += " today";
      cells += '<div class="trg-d ' + cls + '" title="' + esc(key) + '"><i>' + d + "</i><b>" + txt + "</b></div>";
    }
    var sum = "<b>" + logged + "</b> of " + n + " days logged" +
      (bad ? ' · <span class="bad">' + bad + " outside the limits</span>" : " · none outside the limits") +
      (missed ? " · " + missed + " missed" : "");
    return '<section class="trg-card" data-device="' + esc(dv.id) + '"><div class="trg-hd"><h2>' + esc(dv.name) + "</h2><span>" +
      esc(dv.device_type === "fridge" ? "Fridge" : dv.device_type === "room" ? "Room" : (dv.device_type || "")) + " · " + esc(limitsText(dv)) + "</span></div>" +
      '<div class="trg-sum">' + sum + "</div>" +
      '<div class="trg-grid">' + cells + "</div>" +
      '<table class="trg-print"><thead><tr><th>Date</th><th>Min °C</th><th>Max °C</th><th>Note</th></tr></thead><tbody>' + rows + "</tbody></table></section>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "tempreg") return; // left before the data came back: do not draw over the next screen
    var isNow = S.month >= thisMonth();
    var h = '<div class="trg">' +
      '<button class="trg-back" data-act="back">‹ Registers</button>' +
      '<div class="trg-top"><div><h1>Temperature</h1><p class="trg-sub">Fridges and rooms, every day, against their limits.</p></div>' +
      '<div class="trg-acts"><button class="trg-btn" data-act="print">Print</button><button class="trg-btn" data-act="devices">Devices</button></div></div>' +
      '<p class="trg-pmeta">' + esc(((E.state.user || {}).location_name || "") + " · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>" +
      '<div class="trg-month"><button class="trg-arrow" data-act="prev" aria-label="Previous month">‹</button><b>' + esc(monthLabel(S.month)) + '</b><button class="trg-arrow" data-act="next" aria-label="Next month"' + (isNow ? " disabled" : "") + ">›</button></div>";
    if (S.loading && !S.devices.length) h += '<div class="trg-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="trg-quiet">' + esc(S.error) + "</div>";
    else if (!S.devices.length) h += '<div class="trg-quiet">No fridges or rooms are set up yet. Add them under Devices.</div>';
    else h += S.devices.map(deviceCard).join("") + '<p class="trg-note">Readings are logged on Today. Each day shows the minimum above the maximum; a dashed day was missed.</p>';
    h += "</div>";
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#registers";
        else if (a === "prev") { S.month = shiftMonth(S.month, -1); load(); }
        else if (a === "next") { if (S.month < thisMonth()) { S.month = shiftMonth(S.month, 1); load(); } }
        else if (a === "print") window.print();
        else if (a === "devices") { try { sessionStorage.setItem("eikon_ui2_return", "tempreg"); } catch (e) {} E.openClassic("temperature"); }
      });
    });
  }

  E.registerModule({
    id: "tempreg", title: "Temperature", order: 3, icon: "🌡", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; if (!S.month) S.month = thisMonth(); css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("tempreg") < 0) E.UI2_DESTINATIONS.push("tempreg");
})();
