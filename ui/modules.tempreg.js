/* Temperature register, new layout: the month at a glance for each fridge and room,
   what is missing, what was outside the limits, and a clean printout for an inspector.
   Reads the same endpoints as the classic screen. "Fridges and rooms" (add one, rename it, set its limits, stop or
   start logging it) is here too, with the classic Devices tab's endpoints and the same bodies.
   Tapping a day opens it: its readings, limits and note; the note is added or changed there, and a past day that was
   never logged can be logged late with a reason (E.tempNote, in modules.today.js, does the saving and holds the words).
   Correct (the pharmacist only, eikon.correct.js): in an open day with a reading, Correct opens that reading (read
   again) with the minimum, maximum and note, a required reason, and saves it the classic way (POST /temperature/entries
   for the device and day, the server's upsert: the same reading, never a second one). A reading is never deleted here. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: null, devices: [], entries: [], loading: false, error: "", focus: null, open: null, mode: "", drafts: {}, msgs: {}, view: "", dv: null };
  // open: { device, day } the day shown under its device's month; mode: "note" or "late" when its form is open.
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var FIX = { reasonPh: "e.g. Maximum read as 6.6, the display said 8.6", entity: "temperature_entries", action: "TEMP_ENTRY_UPSERT", method: "POST", markIf: function (a) { return !!(a.details && a.details.before); }, // an upsert over an existing reading
    fields: [{ k: "min_temp", label: "Minimum °C", type: "num", req: true, what: "the minimum" }, { k: "max_temp", label: "Maximum °C", type: "num", req: true, what: "the maximum" }, { k: "notes", label: "Note" }],
    rows: function () { return S.entries; },
    reread: async function (row) {
      var r = await E.apiFetch("/temperature/entries?month=" + encodeURIComponent(String(row.entry_date || S.month).slice(0, 7)), { method: "GET" });
      return ((r && r.entries) || []).filter(function (e) { return String(e.id) === String(row.id); })[0] || null;
    },
    put: function () { return "/temperature/entries"; },
    body: function (r) { return { device_id: Number(r.device_id), entry_date: String(r.entry_date), min_temp: Number(r.min_temp), max_temp: Number(r.max_temp), notes: String(r.notes == null ? "" : r.notes).trim() }; },
    check: function (r) { return !isFinite(Number(r.min_temp)) || !isFinite(Number(r.max_temp)) || String(r.min_temp).trim() === "" || String(r.max_temp).trim() === "" ? "Write the minimum and the maximum, e.g. 3.5 and 7." : Number(r.min_temp) > Number(r.max_temp) ? "The minimum is above the maximum." : ""; },
    paint: function () { paint(); }, idle: function () { E.whenFormIdle(S.mount, paint); }, done: function () { return load(); } };
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
  function dayLong(key) { var p = key.split("-"); return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1]; }
  function todayKey() { return (E.maltaYmd && E.maltaYmd()) || ymd(new Date()); }
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
      ".trg-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0;margin:-10px 0 0;cursor:pointer}" +
      ".trg-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}" +
      ".trg h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}" +
      ".trg-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".trg-acts{display:flex;gap:8px;align-items:center}" +
      ".trg-btn{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}.trg-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.trg-btn:active{opacity:.7}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .trg-btn.p{color:#00160E}}" +
      ".trg-due{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--panel2);border:1px solid var(--border);border-left:4px solid #C98A12;border-radius:14px;padding:12px 16px;margin-top:14px}.trg-due b{font-size:15.5px}.trg-due span{display:block;color:var(--muted);font-size:13px}" +
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
      "button.trg-d{font:inherit;color:inherit;border:0;text-align:left;cursor:pointer;width:100%}button.trg-d:hover{filter:brightness(.96)}button.trg-d:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button.trg-d[aria-expanded=true]{box-shadow:inset 0 0 0 2px var(--text)}" +
      ".trg-card .ecr-mark{padding:0 2px}" +
      ".trg-d i{font-style:normal;font-size:11.5px;color:var(--muted);font-weight:600}" +
      ".trg-d b{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em;display:flex;flex-direction:column;line-height:1.25}" +
      ".trg-d.ok{background:rgba(10,143,106,.08)}" +
      ".trg-d.bad{background:rgba(215,38,28,.10);box-shadow:inset 0 0 0 1.5px var(--danger)}.trg-d.bad b{color:var(--danger)}.trg-d.bad i::after{content:' !';color:var(--danger);font-weight:800}" +
      ".trg-d.miss{background:transparent;border:1px dashed rgba(201,138,18,.6)}.trg-d.miss b{color:var(--warn,#A06A0E);font-weight:500;font-size:12px}" +
      "button.trg-d{font:inherit;color:inherit;text-align:left;border:0;width:100%;cursor:pointer;margin:0}button.trg-d:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button.trg-d.sel{box-shadow:inset 0 0 0 2px var(--text)}" +
      ".trg-d em{font-style:normal;font-size:10.5px;font-weight:700;color:var(--danger)}" +
      ".trg-day{margin-top:12px;border-top:1px solid var(--border);padding-top:12px}.trg-day h3{font-size:15.5px;margin:0 0 4px;font-weight:700}.trg-day h3:focus{outline:0}" +
      ".trg-day p{margin:4px 0;font-size:14px;line-height:1.45}.trg-day .bad{color:var(--danger);font-weight:600}.trg-day .mut{color:var(--muted)}" +
      ".trg-day-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}" +
      ".trg-d.future,.trg-d.pad{background:transparent}.trg-d.today{box-shadow:inset 0 0 0 2px var(--accent)}.trg-d.today.future b{color:var(--muted);font-weight:500;font-size:12px}.trg-d.focus{box-shadow:inset 0 0 0 2px var(--danger)}" +
      ".trg-flag{background:rgba(201,138,18,.12);border:1px solid rgba(201,138,18,.45);border-left:4px solid #C98A12;border-radius:12px;padding:10px 14px;margin-top:14px;font-size:13.5px;line-height:1.45}.trg-flag b{color:var(--warn,#A06A0E)}.trg-flag a{color:var(--accent);font-weight:600}" +
      ".trg-note{font-size:12.5px;color:var(--muted);margin-top:10px}" +
      ".trg-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}.trg-quiet .trg-btn{margin-left:8px}" +
      ".trg-dv{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:12px 16px;margin-top:12px}.trg-dv.off{opacity:.85}" +
      ".trg-dv h2{font-size:17px;font-weight:700;margin:0 0 8px}.trg-dv .f{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:10px}" +
      ".trg-dv label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:var(--muted);min-width:0}" +
      ".trg-dv input,.trg-dv select{font:inherit;font-size:16px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:10px;min-height:44px;padding:0 10px;width:100%;box-sizing:border-box;min-width:0}" +
      ".trg-dv input:focus,.trg-dv select:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px rgba(10,143,106,.18)}.trg-dv input[aria-invalid=true]{border-color:var(--danger)}" +
      ".trg-dv .acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:10px}.trg-dv .acts .q{flex:1 1 220px;font-size:14px}" +
      ".trg-dv .ln{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.trg-dv .ln b{font-size:15.5px}.trg-dv .ln span{display:block;color:var(--muted);font-size:13px;font-weight:400}" +
      ".trg-err{color:var(--danger);font-size:13.5px;font-weight:600;margin:8px 0 0}.trg-err:empty{display:none}" +
      ".trg-lab{font-size:13px;font-weight:700;color:var(--muted);margin:22px 2px 0}" +
      ".trg-btn.x{color:var(--danger);border-color:var(--danger);background:transparent}" +
      "@media (max-width:600px){.trg-dv .f{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.trg-dv .f label:nth-child(-n+2){grid-column:1/-1}}" +
      ".trg-print,.trg-pmeta{display:none}.trg-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (max-width:600px){.trg{padding:4px 16px 0}.trg h1{font-size:32px}.trg-grid{gap:4px}.trg-d{min-height:50px;padding:5px;border-radius:8px}.trg-d b{font-size:11.5px}.trg-d i{font-size:10.5px}.trg-d.miss b{font-size:10px}.trg-d.today.future b{font-size:10px}.trg-card{padding:14px 12px}}" +
      "@media print{.trg-day{display:none!important}}" +
      "@media print{.eikon-sidebar,.eikon-topbar,.trg-back,.trg-acts,.trg-due,.trg-month,.trg-grid,.trg-wd,.trg-dv,.eikon-toast{display:none!important}" +
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
      E.correct.loadMarks("tempreg", FIX, S.month + "-01"); // which readings were corrected, by whom and why
    } catch (e) {
      if (!keepView) S.error = e && e.network ? "Can't reach the server. The register is safe; try again in a moment." : String((e && (e.message || e)) || "Could not load the register");
    }
    S.loading = false;
    E.whenFormIdle(S.mount, function () { paint(); if (S.focusPanel) { S.focusPanel = false; var hd = S.mount && S.mount.querySelector(".trg-day h3"); if (hd) hd.focus(); } });
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
      } else { cls = "future"; txt = key === today ? "Not yet" : ""; }
      if (key === today) cls += " today";
      if (S.focus && S.focus.day === key && String(S.focus.device) === String(dv.id)) cls += " focus";
      var say = d + " " + MONTHS[Number(p[1]) - 1] + ": " + (e ? "minimum " + fmt(e.min_temp) + ", maximum " + fmt(e.max_temp) + " °C" + (outside(e, dv) ? ", outside the limits" : "") + (e.notes ? ". Note: " + e.notes : "") : key < today ? "not logged" : key === today ? "not logged yet today" : "");
      if (key > today) { cells += '<div class="trg-d ' + cls + '" title="' + esc(say) + '"><i aria-hidden="true">' + d + '</i><b aria-hidden="true">' + txt + '</b><span class="trg-sr">' + esc(say) + "</span></div>"; continue; }
      var isOpen = S.open && S.open.day === key && String(S.open.device) === String(dv.id);
      var lab = dayLong(key) + ", " + dv.name + ", " + (e ? fmt(e.min_temp) + " to " + fmt(e.max_temp) + (outside(e, dv) ? ", outside limits, " + (String(e.notes || "").trim() ? "has a note" : "no note") : ", within limits" + (String(e.notes || "").trim() ? ", has a note" : "")) : key === today ? "not logged yet" : "not logged");
      var flag = e && outside(e, dv) && !String(e.notes || "").trim() ? "<em>no note</em>" : "";
      cells += '<button type="button" class="trg-d ' + cls + (isOpen ? " sel" : "") + '" title="' + esc(say) + '" data-day="' + esc(key) + '" data-dev="' + esc(dv.id) + '" aria-expanded="' + (isOpen ? "true" : "false") + '" aria-label="' + esc(lab) + '"><i aria-hidden="true">' + d + '</i><b aria-hidden="true">' + txt + "</b>" + flag + '<span class="trg-sr">' + esc(say) + "</span></button>";
    }
    var sum = "<b>" + logged + "</b> of " + n + " days logged" +
      (bad ? ' · <span class="bad">' + bad + " outside the limits</span>" : " · none outside the limits") +
      (missed ? " · " + missed + " not logged" : "");
    return '<section class="trg-card" data-device="' + esc(dv.id) + '"><div class="trg-hd"><h2>' + esc(dv.name) + "</h2><span>" +
      esc(dv.device_type === "fridge" ? "Fridge" : dv.device_type === "room" ? "Room" : (dv.device_type || "")) + " · " + esc(limitsText(dv)) + "</span></div>" +
      '<div class="trg-sum">' + sum + "</div>" +
      '<div class="trg-grid">' + cells + "</div>" + dayPanel(dv, byDay) +
      Object.keys(byDay).map(function (k) { var mk = E.correct.mark("tempreg", byDay[k]); return mk ? mk.replace("<span class=\"ecr-mark\">", '<span class="ecr-mark">' + esc(Number(k.slice(8)) + " " + MONTHS[Number(k.slice(5, 7)) - 1].slice(0, 3)) + ": ") : ""; }).join("") +
      '<table class="trg-print"><thead><tr><th>Date</th><th>Min °C</th><th>Max °C</th><th>Note</th></tr></thead><tbody>' + rows + "</tbody></table></section>";
  }

  // The day that was tapped (or opened from Today's "outside limits yesterday" line): readings, limits and note, with
  // the note added or changed here, and a past day with no reading logged late with a reason.
  function dayPanel(dv, byDay) {
    var o = S.open; if (!o || String(o.device) !== String(dv.id) || o.day.slice(0, 7) !== S.month) return "";
    var key = o.day, e = byDay[key], k = key + "|" + dv.id, today = todayKey(), N = E.tempNote;
    var h = '<div class="trg-day" data-panel="' + esc(k) + '"><h3 tabindex="-1">' + esc(dv.name) + " · " + esc(new Date(key + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })) + "</h3>";
    if (e) {
      var o2 = outside(e, dv), nt = String(e.notes || "").trim();
      h += "<p>Min <b>" + fmt(e.min_temp) + "</b> · Max <b>" + fmt(e.max_temp) + " °C</b> · limits " + esc(limitsText(dv)) + (o2 ? ' · <span class="bad">Outside limits</span>' : " · within limits") + "</p>" +
        "<p>" + (nt ? "Note: " + esc(nt) : '<span class="mut">No note.</span>') + "</p>";
      if (S.mode === "note" && N) h += N.noteForm({ key: k, existing: nt, draft: S.drafts[k], msg: S.msgs[k], cancel: true });
      else h += '<div class="trg-day-acts">' + (N ? '<button class="trg-btn" data-act="addnote">' + (nt ? "Change the note" : "Add a note") + "</button>" : "") +
        E.correct.button("tempreg", e, "the reading of " + dv.name + " on " + dayLong(key)) + '<button class="trg-btn" data-act="close">Close</button></div>';
      h += E.correct.panel("tempreg", e, FIX); // the pharmacist's correction of the reading itself, with a reason
    } else if (key < today) {
      h += '<p><span class="mut">Not logged.</span> Limits ' + esc(limitsText(dv)) + ".</p>";
      if (S.mode === "late" && N) h += N.lateForm({ key: k, draft: S.drafts[k], msg: S.msgs[k] });
      else h += '<div class="trg-day-acts">' + (N ? '<button class="trg-btn" data-act="late">Log this day</button>' : "") + '<button class="trg-btn" data-act="close">Close</button></div>';
    } else {
      h += '<p><span class="mut">Not logged yet.</span> Today\'s reading is logged on Today.</p><div class="trg-day-acts"><button class="trg-btn" data-act="today">Open Today</button><button class="trg-btn" data-act="close">Close</button></div>';
    }
    return h + "</div>";
  }
  function openDay(dev, day, mode) { if (!S.open || S.open.day !== day || String(S.open.device) !== String(dev)) E.correct.reset("tempreg"); S.open = { device: String(dev), day: day }; S.mode = mode || ""; paint(); var hd = S.mount && S.mount.querySelector(".trg-day h3"); if (hd) hd.focus(); }
  function closeDay() {
    var o = S.open; S.open = null; S.mode = ""; E.correct.reset("tempreg"); paint();
    var c = o && S.mount && S.mount.querySelector('button.trg-d[data-day="' + o.day + '"][data-dev="' + o.device + '"]'); if (c) c.focus();
  }
  function entryFor(dev, day) { return S.entries.find(function (x) { return Number(x.device_id) === Number(dev) && x.entry_date === day; }) || null; }
  // After a save: the month read again (whatever else changed shows too), the day stays open, focus on its heading.
  async function afterSave(msg) {
    S.mode = ""; E.toast(msg + " · " + (E.maltaHm ? E.maltaHm() : ""), "success");
    try { var en = await E.apiFetch("/temperature/entries?month=" + encodeURIComponent(S.month), { method: "GET" }); if (en && en.ok) S.entries = en.entries || []; } catch (e) {}
    paint(); var hd = S.mount && S.mount.querySelector(".trg-day h3"); if (hd) hd.focus();
  }
  function wireForms(m) {
    var N = E.tempNote; if (!N) return;
    m.querySelectorAll("form[data-tnote]").forEach(function (f) {
      var k = f.getAttribute("data-tnote"), day = k.split("|")[0], dev = k.split("|")[1];
      N.wire(f, {
        onDraft: function (v) { S.drafts[k] = v.note; },
        onCancel: function () { delete S.drafts[k]; delete S.msgs[k]; S.mode = ""; paint(); var hd = S.mount.querySelector(".trg-day h3"); if (hd) hd.focus(); },
        onSubmit: async function (form, v) {
          var shown = entryFor(dev, day); if (!shown || S.busy) return;
          S.busy = true; N.busy(form, true); N.setMsg(form, "");
          try {
            var r = await N.saveNote(shown, v.note);
            if (r.ok) { delete S.drafts[k]; delete S.msgs[k]; S.busy = false; return afterSave("Note saved"); }
            if (r.stale && r.current) S.entries = S.entries.map(function (x) { return x === shown ? r.current : x; });
            S.msgs[k] = r.message || r.error || ""; S.drafts[k] = v.note;
            if (r.stale) { paint(); var t2 = S.mount.querySelector('form[data-tnote] textarea'); if (t2) t2.focus(); return; } // the reading as it is now, above what was typed
            N.busy(form, false); N.setMsg(form, S.msgs[k]); form.querySelector("textarea").focus();
          } catch (x) { S.msgs[k] = E.saveFailText(x); N.busy(form, false); N.setMsg(form, S.msgs[k]); }
          finally { S.busy = false; }
        }
      });
    });
    m.querySelectorAll("form[data-tlate]").forEach(function (f) {
      var k = f.getAttribute("data-tlate"), day = k.split("|")[0], dev = k.split("|")[1];
      N.wire(f, {
        onDraft: function (v) { S.drafts[k] = v; },
        onCancel: function () { delete S.drafts[k]; delete S.msgs[k]; S.mode = ""; paint(); var hd = S.mount.querySelector(".trg-day h3"); if (hd) hd.focus(); },
        onSubmit: async function (form, v) {
          if (S.busy) return;
          S.busy = true; N.busy(form, true); N.setMsg(form, "");
          try {
            var r = await N.logLate(dev, day, v);
            if (r.ok) { delete S.drafts[k]; delete S.msgs[k]; S.busy = false; return afterSave("Logged late: " + r.min + " to " + r.max + " °C"); }
            S.drafts[k] = v; S.msgs[k] = r.message || r.error || "";
            if (r.stale && r.current) { S.entries = S.entries.concat([r.current]); S.mode = ""; S.busy = false; E.toast(S.msgs[k], "warn"); delete S.msgs[k]; paint(); var hd = S.mount.querySelector(".trg-day h3"); if (hd) hd.focus(); return; }
            N.busy(form, false); N.setMsg(form, S.msgs[k]);
            var bad = /min and max|numbers|greater|outside -40/i.test(S.msgs[k]) ? form.querySelector("[name=min]") : form.querySelector("[name=reason]"); if (bad) bad.focus();
          } catch (x) { S.msgs[k] = E.saveFailText(x); N.busy(form, false); N.setMsg(form, S.msgs[k]); }
          finally { S.busy = false; }
        }
      });
    });
  }

  // This month, a fridge or room with nothing logged today: say which, and take them to Today where readings are typed.
  function dueToday() {
    if (S.month !== thisMonth() || S.loading || S.error) return "";
    var today = ymd(new Date()), left = S.devices.filter(function (dv) { return !S.entries.some(function (e) { return Number(e.device_id) === Number(dv.id) && e.entry_date === today; }); });
    if (!left.length) return "";
    return '<div class="trg-due"><div><b>' + (left.length === S.devices.length ? "Today is not logged yet" : esc(left.map(function (d) { return d.name; }).join(", ")) + " not logged today") + "</b><span>Readings are typed on Today, in under a minute.</span></div>" +
      '<button class="trg-btn p" data-act="log">Log today\u2019s readings</button></div>';
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "tempreg") return; // left before the data came back: do not draw over the next screen
    if (S.view === "devices") return E.repaintKeepingFocus(m, paintDevices); // a list arriving never moves you
    var MB = E.months;
    var h = '<div class="trg">' +
      '<button class="trg-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("tempreg") : "‹ Registers") + "</button>" +
      '<div class="trg-top"><div><h1>Temperature</h1><p class="trg-sub">Fridges and rooms, every day, against their limits.</p></div>' +
      '<div class="trg-acts"><button class="trg-btn" data-act="devices" data-k="devices">Fridges and rooms</button></div></div>' +
      '<p class="trg-pmeta">' + esc(((E.state.user || {}).location_name || "") + " · " + monthLabel(S.month) + " · printed " + ymd(new Date())) + "</p>" +
      MB.bar(S.month, { label: "Temperature" });
    if (S.loading && !S.devices.length) h += '<div class="trg-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="trg-quiet" role="alert">' + esc(S.error) + ' <button class="trg-btn" data-act="retry">Try again</button></div>';
    else if (!S.devices.length) h += '<div class="trg-quiet">No fridges or rooms are set up yet. <button class="trg-btn p" data-act="devices" data-k="devices-empty">Add a fridge or room</button></div>';
    else h += dueToday() + (S.month < thisMonth() && !S.entries.length ? '<div class="trg-quiet" data-empty>' + esc(MB.empty(S.month)) + "</div>" : "") +
      S.devices.map(deviceCard).join("") + '<p class="trg-note">Each day shows the minimum above the maximum. Red with ! is outside the limits; a dashed day was not logged. Tap a day to see it, add a note, or log a missed day.' + (E.correct.can() ? " To correct a reading, open its day and press Correct, saying what was wrong; the audit keeps what it said before." : " A wrong reading is corrected by the pharmacist.") + "</p>";
    h += "</div>";
    if (E.tempNote) E.tempNote.css();
    m.innerHTML = h;
    m.querySelectorAll("button.trg-d[data-day]").forEach(function (c) {
      c.addEventListener("click", function () {
        var dev = c.getAttribute("data-dev"), day = c.getAttribute("data-day");
        if (S.open && S.open.day === day && String(S.open.device) === dev) closeDay(); else openDay(dev, day);
      });
    });
    wireForms(m);
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("tempreg") : "#registers";
        else if (a === "log") window.location.hash = "#today";
        else if (a === "retry") load();
        else if (a === "close") closeDay();
        else if (a === "addnote" && S.open) { openDay(S.open.device, S.open.day, "note"); var ta = S.mount.querySelector("form[data-tnote] textarea"); if (ta) ta.focus(); }
        else if (a === "late" && S.open) { openDay(S.open.device, S.open.day, "late"); var mi = S.mount.querySelector("form[data-tlate] [name=min]"); if (mi) mi.focus(); }
        else if (a === "today") window.location.hash = "#today";
        else if (a === "addnote" || a === "late") return;
        else if (a === "devices") openDevices();
      });
    });
    E.correct.wire(m, "tempreg", FIX);
    MB.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; E.correct.reset("tempreg"); load(); }, paint: paint, print: printMonth });
  }

  // ---------- Fridges and rooms ----------
  // Add one, rename it, set its limits, stop logging it (its readings are kept) or log it again. The classic Devices
  // tab's endpoints and bodies, unchanged: POST /temperature/devices {name, device_type, min_limit, max_limit};
  // PUT /temperature/devices/:id with the same four, or {active}. Only the pharmacy's admin may change them (the server
  // says so too), so everyone else sees the list without the boxes.
  var TYPES = [["fridge", "Fridge"], ["room", "Room"], ["other", "Other"]];
  var DEF = { fridge: ["2", "8"], room: ["15", "25"], other: ["", ""] }; // a new fridge or room starts with the limits the server gives a new pharmacy
  function isAdmin() { var u = E.state && E.state.user; return !u || !u.role || u.role === "admin"; } // unknown: the server decides
  function parseNum(n) { var s = String(n || "").trim(); if (!s) return null; s = s.replace(/,/g, "."); var v = Number(s); if (!isFinite(v)) return null; return Math.round(v * 10) / 10; } // the classic's, unchanged
  function typeWord(t) { return t === "fridge" ? "Fridge" : t === "room" ? "Room" : t === "other" ? "Other" : (t || ""); }
  // Today asks "Name your fridges and rooms" while the two a new pharmacy is given still carry their first names;
  // once anything is saved here the pharmacy has seen them, and the line goes.
  function namedKey() { return "eikon_trg_named:" + (((E.state && E.state.user) || {}).location_id || ""); }
  function markNamed() { try { localStorage.setItem(namedKey(), "1"); } catch (e) {} }
  function newAdd(type) { type = type || "fridge"; return { name: "", device_type: type, min_limit: DEF[type][0], max_limit: DEF[type][1] }; }
  function openDevices(fromToday) {
    S.view = "devices"; S.dv = { list: S.dv && S.dv.list || null, loading: true, error: "", draft: {}, err: {}, bad: {}, busy: {}, ask: null, add: newAdd(), addErr: "", addBad: [], adding: false };
    // The screen says where you are: focus on its heading (again after the redraws that follow, unless you moved on).
    var lost = function () { var a = document.activeElement; return !a || a === document.body || !(S.mount && S.mount.contains(a)) || a.id === "trg-dv-h"; };
    var head = function () { var h = S.view === "devices" && lost() && S.mount && S.mount.querySelector("#trg-dv-h"); if (h && document.activeElement !== h) h.focus(); };
    paint(); head(); setTimeout(head, 0);
    return loadDevices().then(function () { // nothing to log yet, or opened to add one: straight into the name box
      var on = ((S.dv && S.dv.list) || []).some(function (d) { return Number(d.active) !== 0; });
      if ((fromToday === "add" || !on) && lost()) { var n = S.mount && S.mount.querySelector('#trg-add [name="name"]'); if (n) n.focus(); } else head();
    });
  }
  async function loadDevices() {
    var D = S.dv; if (!D) return; D.loading = true;
    try { var r = await E.apiFetch("/temperature/devices?include_inactive=1", { method: "GET" }); D.list = (r && r.devices) || []; D.error = ""; }
    catch (e) { D.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the fridges and rooms"); }
    D.loading = false; if (S.view === "devices") E.whenFormIdle(S.mount, function () { E.repaintKeepingFocus(S.mount, paint); });
  }
  function val(id, k, dv) { var d = S.dv.draft[id]; return d && d[k] != null ? d[k] : (dv[k] == null ? "" : (k === "min_limit" || k === "max_limit" ? fmt(dv[k]) : String(dv[k]))); }
  function fields(id, v, dis) {
    var bad = (id === "add" ? S.dv.addBad : S.dv.bad[id]) || [];
    var inp = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(v[k]) + '" autocomplete="off"' + extra + (bad.indexOf(k) >= 0 ? ' aria-invalid="true" aria-describedby="trg-err-' + id + '"' : "") + (dis ? " disabled" : "") + "></label>"; };
    return '<div class="f">' + inp("name", "Name", ' enterkeyhint="next" placeholder="Vaccine fridge"') +
      '<label><span>Type</span><select name="device_type"' + (dis ? " disabled" : "") + ">" + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (v.device_type === t[0] ? " selected" : "") + ">" + t[1] + "</option>"; }).join("") + "</select></label>" +
      inp("min_limit", "Lowest °C", ' inputmode="decimal" enterkeyhint="next"') + inp("max_limit", "Highest °C", ' inputmode="decimal" enterkeyhint="done"') + "</div>";
  }
  function paintDevices() {
    var m = S.mount, D = S.dv, admin = isAdmin();
    var list = (D.list || []).slice(), on = list.filter(function (d) { return Number(d.active) !== 0; }), off = list.filter(function (d) { return Number(d.active) === 0; });
    var h = '<div class="trg"><button class="trg-back" data-act="dv-back" data-k="dv-back">‹ Temperature</button>' +
      '<div class="trg-top"><div><h1 tabindex="-1" id="trg-dv-h">Fridges and rooms</h1><p class="trg-sub">Each one is logged every day on Today and checked against its limits.</p></div></div>';
    if (!admin) h += '<p class="trg-note">Only the pharmacy’s admin can add or change these.</p>';
    if (D.loading && !D.list) h += '<div class="trg-quiet" role="status">Opening the list…</div>';
    else if (D.error && !D.list) h += '<div class="trg-quiet" role="alert">' + esc(D.error) + ' <button class="trg-btn" data-act="dv-retry">Try again</button></div>';
    else {
      if (!on.length) h += '<div class="trg-quiet">Nothing is logged yet. Add the fridge and the room you check each day.</div>';
      h += on.map(function (dv) {
        var id = dv.id, v = { name: val(id, "name", dv), device_type: val(id, "device_type", dv), min_limit: val(id, "min_limit", dv), max_limit: val(id, "max_limit", dv) }, busy = D.busy[id];
        if (!admin) return '<section class="trg-dv"><div class="ln"><div><b>' + esc(dv.name) + "</b><span>" + esc(typeWord(dv.device_type) + " · " + limitsText(dv)) + "</span></div></div></section>";
        var acts = D.ask === id
          ? '<span class="q" role="alert">Stop logging ' + esc(dv.name) + "? Its readings are kept, and it can be logged again.</span>" +
            '<button type="button" class="trg-btn" data-act="dv-keep" data-id="' + id + '" data-k="dv-keep">Keep logging</button><button type="button" class="trg-btn x" data-act="dv-stop-yes" data-id="' + id + '" data-k="dv-stop-yes"' + (busy ? " disabled" : "") + ">" + (busy ? "Saving…" : "Stop logging") + "</button>"
          : '<button type="button" class="trg-btn" data-act="dv-stop" data-id="' + id + '" data-k="dv-stop:' + id + '"' + (busy ? " disabled" : "") + ">Stop logging</button>" +
            '<button type="submit" class="trg-btn p" data-k="dv-save:' + id + '"' + (busy ? " disabled" : "") + ">" + (busy === "save" ? "Saving…" : "Save") + "</button>";
        return '<form class="trg-dv" data-dv="' + id + '" novalidate aria-label="' + esc(dv.name) + '">' + fields(id, v, !!busy) + '<p class="trg-err" role="alert" id="trg-err-' + id + '">' + esc(D.err[id] || "") + '</p><div class="acts">' + acts + "</div></form>";
      }).join("");
      if (off.length) h += '<p class="trg-lab">Not logged any more</p>' + off.map(function (dv) {
        return '<section class="trg-dv off"><div class="ln"><div><b>' + esc(dv.name) + "</b><span>" + esc(typeWord(dv.device_type) + " · " + limitsText(dv)) + "</span></div>" +
          (admin ? '<button type="button" class="trg-btn" data-act="dv-again" data-id="' + dv.id + '" data-k="dv-again:' + dv.id + '"' + (D.busy[dv.id] ? " disabled" : "") + ">" + (D.busy[dv.id] ? "Saving…" : "Log it again") + "</button>" : "") +
          '</div><p class="trg-err" role="alert">' + esc(D.err[dv.id] || "") + "</p></section>";
      }).join("");
      if (admin) h += '<form class="trg-dv" id="trg-add" novalidate aria-labelledby="trg-add-t"><h2 id="trg-add-t">Add a fridge or room</h2>' + fields("add", D.add, D.adding) +
        '<p class="trg-err" role="alert" id="trg-err-add">' + esc(D.addErr) + '</p><div class="acts"><button type="submit" class="trg-btn p" data-k="dv-add"' + (D.adding ? " disabled" : "") + ">" + (D.adding ? "Adding…" : "Add") + "</button></div></form>";
    }
    h += "</div>";
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "dv-back") closeDevices();
        else if (a === "dv-retry") loadDevices();
        else if (a === "dv-stop") { D.ask = id; D.err[id] = ""; E.repaintKeepingFocus(m, paint); var k = m.querySelector('[data-k="dv-keep"]'); if (k) k.focus(); }
        else if (a === "dv-keep") { D.ask = null; paint(); var s = m.querySelector('[data-k="dv-stop:' + id + '"]'); if (s) s.focus(); }
        else if (a === "dv-stop-yes") setActive(id, false);
        else if (a === "dv-again") setActive(id, true);
      });
    });
    m.querySelectorAll("form.trg-dv").forEach(function (f) {
      var id = f.id === "trg-add" ? "add" : Number(f.getAttribute("data-dv"));
      f.addEventListener("submit", function (ev) { ev.preventDefault(); if (id === "add") addDevice(f); else saveDevice(id, f); });
      f.addEventListener("input", function (ev) { var t = ev.target; if (!t.name) return; t.removeAttribute("aria-invalid");
        if (id === "add") D.add[t.name] = t.value; else { D.draft[id] = D.draft[id] || {}; D.draft[id][t.name] = t.value; } });
      var ty = f.querySelector('[name="device_type"]');
      if (id === "add" && ty) ty.addEventListener("change", function () { // a fridge starts at 2 to 8 °C, a room at 15 to 25: changed only while the limits are still the last type's
        var was = DEF[D.add.prev || "fridge"] || ["", ""], lo = f.querySelector('[name="min_limit"]'), hi = f.querySelector('[name="max_limit"]'), now = DEF[ty.value] || ["", ""];
        if (lo.value === was[0] && hi.value === was[1]) { lo.value = now[0]; hi.value = now[1]; D.add.min_limit = now[0]; D.add.max_limit = now[1]; }
        D.add.device_type = ty.value; D.add.prev = ty.value; });
    });
  }
  // What the classic Save sends, from what is typed; a mistake is said once, under the boxes, and nothing is sent.
  function bodyFrom(f, idKey) {
    var g = function (k) { return String((f.querySelector('[name="' + k + '"]') || {}).value || ""); };
    var name = g("name").trim(), lo = g("min_limit").trim(), hi = g("max_limit").trim(), bad = [], msg = "";
    if (!name) { bad.push("name"); msg = "Write a name, like Vaccine fridge."; }
    if (lo && parseNum(lo) === null) bad.push("min_limit"); if (hi && parseNum(hi) === null) bad.push("max_limit");
    if (!msg && bad.length) msg = "Write each limit as a number, like 2 or 8.5, or leave it empty.";
    if (!bad.length && lo && hi && parseNum(lo) > parseNum(hi)) { bad = ["min_limit", "max_limit"]; msg = "The lowest limit is above the highest. Check which is which."; }
    if (bad.length) return { err: msg, bad: bad };
    return { body: { name: name, device_type: String(g("device_type") || "").trim() || "room", min_limit: lo ? parseNum(lo) : null, max_limit: hi ? parseNum(hi) : null } };
  }
  function said(b) { return b.name + (b.min_limit == null && b.max_limit == null ? ", no limits" : ", " + (b.min_limit == null ? "–" : b.min_limit) + " to " + (b.max_limit == null ? "–" : b.max_limit) + " °C"); }
  function showErr(id, f, msg, bad) {
    var D = S.dv; if (id === "add") { D.addErr = msg; D.addBad = bad || []; } else { D.err[id] = msg; D.bad[id] = bad || []; }
    paint(); var nf = id === "add" ? S.mount.querySelector("#trg-add") : S.mount.querySelector('form[data-dv="' + id + '"]');
    var first = nf && bad && bad[0] ? nf.querySelector('[name="' + bad[0] + '"]') : null; if (first) { first.focus(); try { first.select(); } catch (e) {} }
  }
  async function saveDevice(id, f) {
    var D = S.dv; if (D.busy[id]) return;
    var x = bodyFrom(f); if (x.err) return showErr(id, f, x.err, x.bad);
    D.err[id] = ""; D.bad[id] = []; D.busy[id] = "save"; paint();
    try {
      var r = await E.apiFetch("/temperature/devices/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(x.body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      delete D.draft[id]; markNamed(); D.busy[id] = false; E.toast("Saved · " + said(x.body), "success");
      await loadDevices(); paint(); var b = S.mount.querySelector('[data-k="dv-save:' + id + '"]'); if (b) b.focus();
    } catch (e) { D.busy[id] = false; showErr(id, f, E.saveFailText(e), []); var s = S.mount.querySelector('[data-k="dv-save:' + id + '"]'); if (s) s.focus(); }
  }
  async function addDevice(f) {
    var D = S.dv; if (D.adding) return;
    var x = bodyFrom(f); if (x.err) return showErr("add", f, x.err, x.bad);
    D.addErr = ""; D.addBad = []; D.adding = true; paint();
    try {
      await E.postOnce("/temperature/devices", x.body, { list: async function () { var r = await E.apiFetch("/temperature/devices?include_inactive=1", { method: "GET" }); return (r && r.devices) || []; },
        same: function (d) { return d.name === x.body.name && d.device_type === x.body.device_type; } });
      markNamed(); D.adding = false; D.add = newAdd(x.body.device_type); D.add.prev = x.body.device_type; E.toast("Added · " + said(x.body), "success");
      await loadDevices(); paint(); var n = S.mount.querySelector('#trg-add [name="name"]'); if (n) n.focus(); // ready for the next one
    } catch (e) { D.adding = false; showErr("add", f, E.saveFailText(e), []); var a = S.mount.querySelector('[data-k="dv-add"]'); if (a) a.focus(); }
  }
  async function setActive(id, on) {
    var D = S.dv; if (D.busy[id]) return; D.busy[id] = "active"; D.err[id] = ""; paint();
    var dv = (D.list || []).filter(function (d) { return Number(d.id) === id; })[0] || { name: "" };
    try {
      var r = await E.apiFetch("/temperature/devices/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify({ active: on }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      D.busy[id] = false; D.ask = null; markNamed(); E.toast(dv.name + (on ? " is logged again" : " is no longer logged. Its readings are kept."), "success");
      await loadDevices(); paint();
      var b = S.mount.querySelector(on ? '[data-k="dv-stop:' + id + '"]' : '[data-k="dv-again:' + id + '"]') || S.mount.querySelector(".trg h1"); if (b) b.focus();
    } catch (e) { D.busy[id] = false; D.err[id] = E.saveFailText(e); paint(); var k = S.mount.querySelector(on ? '[data-k="dv-again:' + id + '"]' : '[data-k="dv-stop-yes"]'); if (k) k.focus(); }
  }
  function closeDevices() {
    S.view = ""; S.dv = null; S.entries = S.entries || []; paint(); var b = S.mount && S.mount.querySelector('[data-k="devices"]'); if (b) b.focus();
    return load().then(function () { var a = document.activeElement; if (!a || a === document.body) { var x = S.mount && S.mount.querySelector('[data-k="devices"]'); if (x) x.focus(); } });
  }
  function onKey(ev) {
    if (ev.key !== "Escape" || ev.defaultPrevented || E.state.activeModuleId !== "tempreg" || S.view !== "devices" || !S.mount || !document.body.contains(S.mount)) return;
    if (document.querySelector(".eikon-modal-overlay[style*='flex'], .eks")) return;
    ev.preventDefault();
    if (S.dv && S.dv.ask != null) { var id = S.dv.ask; S.dv.ask = null; paint(); var s = S.mount.querySelector('[data-k="dv-stop:' + id + '"]'); if (s) s.focus(); return; }
    closeDevices();
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
      S.mount = ctx && ctx.mount; S.month = thisMonth(); S.entries = []; if (E.months.reset) E.months.reset(); E.correct.reset("tempreg");
      S.focus = null; S.open = null; S.mode = ""; S.drafts = {}; S.msgs = {}; S.busy = false; S.view = ""; S.dv = null;
      document.removeEventListener("keydown", onKey); document.addEventListener("keydown", onKey);
      var want = ""; try { want = sessionStorage.getItem("eikon_tempreg_view") || ""; sessionStorage.removeItem("eikon_tempreg_view"); } catch (e) {} // Today's "Name your fridges and rooms"
      if (want === "devices" || want === "add") { css(); load(); return openDevices(want); }
      try { var f = JSON.parse(sessionStorage.getItem("eikon_tempreg_day") || "null"); sessionStorage.removeItem("eikon_tempreg_day");
        if (f && /^\d{4}-\d{2}-\d{2}$/.test(f.day || "")) { S.focus = f; S.month = f.day.slice(0, 7); S.open = { device: String(f.device), day: f.day }; S.focusPanel = true; } } catch (e) {}
      css(); paint(); return load();
    },
    destroy: function () { document.removeEventListener("keydown", onKey); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("tempreg") < 0) E.UI2_DESTINATIONS.push("tempreg");
})();
