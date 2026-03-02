(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ── Logging ─────────────────────────────────────────────────────
  function log()  { E.log.apply(E,  ["[dash]"].concat([].slice.call(arguments))); }
  function dbg()  { E.dbg.apply(E,  ["[dash]"].concat([].slice.call(arguments))); }
  function warn() { E.warn.apply(E, ["[dash]"].concat([].slice.call(arguments))); }
  function err()  { (E.error||E.log).apply(E, ["[dash]"].concat([].slice.call(arguments))); }

  function escHtml(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  // ── Date helpers ─────────────────────────────────────────────────
  function todayYmd() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function currentYm() {
    return todayYmd().slice(0, 7);
  }

  function prevYm(ym) {
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5, 7), 10);
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
    return y + "-" + String(m).padStart(2, "0");
  }

  function nextYm(ym) {
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5, 7), 10);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return y + "-" + String(m).padStart(2, "0");
  }

  function addDaysYmd(ymd, n) {
    var parts = ymd.split("-");
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + n);
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + mo + "-" + dd;
  }

  function daysUntil(ymd) {
    var s = String(ymd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var parts = s.split("-");
    var exp = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    exp.setHours(0, 0, 0, 0);
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((exp.getTime() - now.getTime()) / 86400000);
  }

  // ── Styles ───────────────────────────────────────────────────────
  var styleInstalled = false;
  function ensureStyles() {
    if (styleInstalled) return;
    styleInstalled = true;
    if (document.getElementById("eikon-dashboard-style")) return;
    var st = document.createElement("style");
    st.id = "eikon-dashboard-style";
    st.textContent =
      /* Layout */
      ".db-wrap{padding:18px 20px;max-width:1200px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}" +
      ".db-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:10px;flex-wrap:wrap;}" +
      ".db-title{font-size:17px;font-weight:900;color:var(--text,#e9eef7);letter-spacing:.2px;}" +
      ".db-refresh{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:var(--muted,#a8b3c7);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;transition:background .15s;}" +
      ".db-refresh:hover{background:rgba(255,255,255,.10);}" +
      ".db-ts{font-size:11px;color:var(--muted,#a8b3c7);opacity:.7;}" +

      /* Grid */
      ".db-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}" +
      "@media(max-width:900px){.db-grid{grid-template-columns:repeat(2,1fr);}}" +
      "@media(max-width:560px){.db-grid{grid-template-columns:1fr;}}" +

      /* Card */
      ".db-card{border:1px solid var(--border,#263246);border-radius:14px;background:rgba(255,255,255,.025);padding:12px 14px;display:flex;flex-direction:column;gap:6px;transition:border-color .2s;position:relative;overflow:hidden;}" +
      ".db-card.db-ok{border-color:rgba(67,209,122,.20);background:rgba(67,209,122,.03);}" +
      ".db-card.db-warn{border-color:rgba(255,200,90,.30);background:rgba(255,200,90,.04);}" +
      ".db-card.db-danger{border-color:rgba(255,90,122,.30);background:rgba(255,90,122,.04);}" +
      ".db-card.db-info{border-color:rgba(90,162,255,.22);background:rgba(90,162,255,.03);}" +
      ".db-card.db-loading{opacity:.6;}" +

      /* Card header */
      ".db-card-head{display:flex;align-items:center;gap:7px;}" +
      ".db-card-icon{font-size:15px;line-height:1;flex-shrink:0;}" +
      ".db-card-name{font-size:12px;font-weight:900;color:var(--muted,#a8b3c7);text-transform:uppercase;letter-spacing:.4px;flex:1;}" +
      ".db-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}" +
      ".db-dot-ok{background:#43d17a;box-shadow:0 0 6px rgba(67,209,122,.5);}" +
      ".db-dot-warn{background:#ffc85a;box-shadow:0 0 6px rgba(255,200,90,.5);}" +
      ".db-dot-danger{background:#ff5a7a;box-shadow:0 0 6px rgba(255,90,122,.5);}" +
      ".db-dot-info{background:#5aa2ff;box-shadow:0 0 6px rgba(90,162,255,.5);}" +
      ".db-dot-idle{background:#555;}" +

      /* Card body */
      ".db-card-body{font-size:12px;color:var(--text,#e9eef7);line-height:1.4;}" +
      ".db-card-body strong{font-weight:900;}" +
      ".db-card-sub{font-size:11px;color:var(--muted,#a8b3c7);line-height:1.3;margin-top:2px;}" +

      /* Card actions */
      ".db-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;}" +
      ".db-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;font-size:11px;font-weight:800;border-radius:8px;cursor:pointer;border:1px solid;transition:background .15s,opacity .15s;white-space:nowrap;}" +
      ".db-btn-primary{background:rgba(90,162,255,.18);border-color:rgba(90,162,255,.45);color:#7dc8ff;}" +
      ".db-btn-primary:hover{background:rgba(90,162,255,.28);}" +
      ".db-btn-action{background:rgba(255,200,90,.14);border-color:rgba(255,200,90,.38);color:#ffd97a;}" +
      ".db-btn-action:hover{background:rgba(255,200,90,.22);}" +
      ".db-btn-ok{background:rgba(67,209,122,.12);border-color:rgba(67,209,122,.30);color:#6de0a0;}" +
      ".db-btn-ok:hover{background:rgba(67,209,122,.20);}" +

      /* Instructions banner */
      ".db-instr-banner{border:1px solid rgba(90,162,255,.20);border-radius:14px;background:rgba(90,162,255,.04);padding:12px 14px;margin-top:10px;}" +
      ".db-instr-title{font-size:12px;font-weight:900;color:var(--muted,#a8b3c7);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;display:flex;align-items:center;gap:6px;}" +
      ".db-instr-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
      "@media(max-width:640px){.db-instr-row{grid-template-columns:1fr;}}" +
      ".db-instr-section{}" +
      ".db-instr-label{font-size:11px;font-weight:900;color:var(--muted,#a8b3c7);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;}" +
      ".db-instr-text{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;line-height:1.5;background:rgba(0,0,0,.15);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:8px 10px;max-height:120px;overflow-y:auto;}" +
      ".db-instr-empty{font-size:12px;color:var(--muted,#a8b3c7);font-style:italic;}" +
      ".db-bullet{display:flex;gap:6px;margin-bottom:4px;}" +
      ".db-bullet-sev{font-size:10px;font-weight:900;padding:2px 6px;border-radius:4px;flex-shrink:0;margin-top:1px;}" +
      ".db-bullet-sev-high{background:rgba(255,90,122,.22);color:#ff8fa3;border:1px solid rgba(255,90,122,.3);}" +
      ".db-bullet-sev-med{background:rgba(255,200,90,.16);color:#ffd97a;border:1px solid rgba(255,200,90,.28);}" +
      ".db-bullet-sev-low{background:rgba(90,162,255,.14);color:#7dc8ff;border:1px solid rgba(90,162,255,.25);}" +
      ".db-bullet-text{font-size:12px;color:var(--text,#e9eef7);line-height:1.4;}" +

      /* Modal quick-forms */
      ".db-form{display:flex;flex-direction:column;gap:10px;min-width:min(400px,90vw);}" +
      ".db-form-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;}" +
      ".db-form label{font-size:12px;font-weight:900;color:var(--muted,#a8b3c7);display:block;margin-bottom:3px;}" +
      ".db-device-row{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;background:rgba(0,0,0,.12);margin-bottom:4px;}" +
      ".db-device-name{font-size:12px;font-weight:900;margin-bottom:6px;color:var(--text,#e9eef7);}" +
      ".db-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.15);border-top-color:var(--accent,#5aa2ff);border-radius:50%;animation:db-spin .7s linear infinite;vertical-align:middle;margin-right:6px;}" +
      "@keyframes db-spin{to{transform:rotate(360deg);}}" +
      ".db-nav-hint{font-size:11px;color:var(--muted);text-align:center;margin-top:8px;opacity:.7;}" +
      ".db-err{color:var(--danger,#ff5a7a);font-size:12px;font-weight:700;padding:6px 8px;background:rgba(255,90,122,.08);border:1px solid rgba(255,90,122,.2);border-radius:8px;}" +
      ".db-section-sep{grid-column:1/-1;margin:4px 0 2px 0;}" +
      ".db-section-sep hr{border:none;border-top:1px solid rgba(255,255,255,.06);margin:0;}" +
      ".db-section-label{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;color:var(--muted,#a8b3c7);opacity:.7;margin-bottom:6px;}" +

      /* Paid Out value display */
      ".db-big-val{font-size:22px;font-weight:900;color:var(--text,#e9eef7);line-height:1;}" +
      ".db-big-sub{font-size:11px;color:var(--muted,#a8b3c7);margin-top:2px;}";

    document.head.appendChild(st);
  }

  // ── API helpers ──────────────────────────────────────────────────
  async function apiGet(path) {
    try {
      var r = await E.apiFetch(path, { method: "GET" });
      return r;
    } catch (e) {
      warn("[dash] apiGet failed:", path, e && e.message);
      return null;
    }
  }

  // ── Navigate to module ───────────────────────────────────────────
  function goTo(moduleId) {
    try {
      window.location.hash = "#" + moduleId;
    } catch (e) {}
  }

  // ── Toast (minimal inline) ───────────────────────────────────────
  function toast(msg, kind) {
    try {
      var wrap = document.getElementById("db-toast-wrap");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "db-toast-wrap";
        wrap.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:999998;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
        document.body.appendChild(wrap);
      }
      var t = document.createElement("div");
      t.style.cssText = "background:rgba(15,22,34,.96);border:1px solid " +
        (kind === "ok" ? "rgba(67,209,122,.4)" : kind === "bad" ? "rgba(255,90,122,.4)" : "rgba(255,200,90,.4)") +
        ";color:#e9eef7;border-radius:12px;padding:9px 13px;font-size:12px;font-weight:700;font-family:system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:all;";
      t.textContent = msg;
      wrap.appendChild(t);
      setTimeout(function () { try { wrap.removeChild(t); } catch (e2) {} }, 3000);
    } catch (e) {}
  }

  // ════════════════════════════════════════════════════════════════
  //  DATA FETCHERS  (each returns a structured result object)
  // ════════════════════════════════════════════════════════════════

  async function fetchTemperature() {
    var today = todayYmd();
    var ym = currentYm();
    try {
      var r = await apiGet("/temperature/entries?month=" + encodeURIComponent(ym));
      var entries = (r && Array.isArray(r.entries)) ? r.entries : [];
      var todayEntries = entries.filter(function (e) { return String(e.entry_date || "") === today; });

      // Also get devices to know how many are active
      var dr = await apiGet("/temperature/devices");
      var devices = (dr && Array.isArray(dr.devices)) ? dr.devices.filter(function (d) { return !d.inactive; }) : [];

      if (devices.length === 0) {
        return { ok: true, status: "no_devices", msg: "No devices configured" };
      }
      if (todayEntries.length === 0) {
        return { ok: false, status: "missing", msg: "Not entered for today", deviceCount: devices.length, devices: devices };
      }
      return { ok: true, status: "done", msg: "Entered (" + todayEntries.length + " reading" + (todayEntries.length !== 1 ? "s" : "") + ")", entries: todayEntries };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchCleaning() {
    var today = todayYmd();
    var ym = currentYm();
    // Load current month and previous month to cover 14 day lookback
    try {
      var [r1, r2] = await Promise.all([
        apiGet("/cleaning/entries?month=" + encodeURIComponent(ym)),
        apiGet("/cleaning/entries?month=" + encodeURIComponent(prevYm(ym)))
      ]);
      var entries = (r1 && Array.isArray(r1.entries) ? r1.entries : []).concat(
        r2 && Array.isArray(r2.entries) ? r2.entries : []
      );
      // Check last 14 days
      var cutoff = addDaysYmd(today, -14);
      var recent = entries.filter(function (e) {
        var d = String(e.entry_date || "");
        return d >= cutoff && d <= today;
      });
      if (recent.length === 0) {
        var lastEntry = entries.slice().sort(function (a, b) {
          return String(b.entry_date || "").localeCompare(String(a.entry_date || ""));
        })[0];
        var lastMsg = lastEntry ? ("Last: " + lastEntry.entry_date) : "No records found";
        return { ok: false, status: "missing", msg: "No record in last 14 days", lastMsg: lastMsg };
      }
      var newest = recent.sort(function (a, b) {
        return String(b.entry_date || "").localeCompare(String(a.entry_date || ""));
      })[0];
      var d = daysUntil(newest.entry_date);
      var ago = d === 0 ? "today" : (Math.abs(d) === 1 ? "yesterday" : Math.abs(d) + " days ago");
      return { ok: true, status: "done", msg: "Last record: " + ago };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchDailyRegister() {
    var today = todayYmd();
    var ym = currentYm();
    try {
      var r = await apiGet("/daily-register/entries?month=" + encodeURIComponent(ym));
      var entries = (r && Array.isArray(r.entries)) ? r.entries : [];
      var todayEntries = entries.filter(function (e) { return String(e.entry_date || "") === today; });
      if (todayEntries.length === 0) {
        return { ok: false, status: "missing", msg: "No entry for today" };
      }
      return { ok: true, status: "done", msg: todayEntries.length + " entr" + (todayEntries.length === 1 ? "y" : "ies") + " today" };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchCertificates() {
    try {
      var r = await apiGet("/certificates/items");
      var items = (r && Array.isArray(r.items)) ? r.items : [];
      var expired = [], soonList = [];
      items.forEach(function (it) {
        var nd = String(it.next_due || "").trim();
        if (!nd) return;
        var d = daysUntil(nd);
        if (d === null) return;
        if (d < 0) expired.push({ name: String(it.title || it.subtitle || "Certificate"), days: d });
        else if (d <= 30) soonList.push({ name: String(it.title || it.subtitle || "Certificate"), days: d });
      });
      if (expired.length === 0 && soonList.length === 0) {
        return { ok: true, status: "ok", msg: items.length + " certificate" + (items.length !== 1 ? "s" : "") + " — all current" };
      }
      var parts = [];
      if (expired.length) parts.push(expired.length + " expired");
      if (soonList.length) parts.push(soonList.length + " due within 30d");
      return {
        ok: false,
        status: expired.length > 0 ? "danger" : "warn",
        msg: parts.join(", "),
        expired: expired,
        soon: soonList
      };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchAlerts() {
    try {
      var r = await apiGet("/alerts/entries?ts=" + Date.now());
      var entries = (r && Array.isArray(r.entries)) ? r.entries : [];
      var incomplete = entries.filter(function (e) {
        if (e.status === "closed") return false;
        return !(e.team_informed && e.supplier_informed && e.authorities_informed &&
          e.return_arranged && e.handed_over && e.collection_note_received && e.credit_note_received);
      });
      if (incomplete.length === 0) {
        return { ok: true, status: "ok", msg: entries.length > 0 ? "All alerts resolved" : "No alerts" };
      }
      return { ok: false, status: "warn", msg: incomplete.length + " incomplete alert" + (incomplete.length !== 1 ? "s" : ""), count: incomplete.length };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchShifts() {
    var today = todayYmd();
    var y = parseInt(today.slice(0, 4), 10);
    var mo = parseInt(today.slice(5, 7), 10); // 1-based

    // Build list of months to check: this month + next month
    var months = [
      { year: y, month: mo },
      mo === 12 ? { year: y + 1, month: 1 } : { year: y, month: mo + 1 }
    ];

    try {
      // Load staff + settings + opening hours once, then assignments per month
      var [staffR, settingsR, ohR] = await Promise.all([
        apiGet("/shifts/staff?include_inactive=1"),
        apiGet("/shifts/settings"),
        apiGet("/shifts/opening-hours")
      ]);

      var staff = (staffR && Array.isArray(staffR.staff)) ? staffR.staff : [];
      var settings = (settingsR && settingsR.settings) ? settingsR.settings : { pharmacistRequired: true, minPharmacists: 1 };
      var openingHours = (ohR && ohR.opening_hours) ? ohR.opening_hours : { "default": { open: "07:30", close: "19:30", closed: false } };

      // Helper: get employee
      function emp(sid) { return staff.find(function (s) { return String(s.id) === String(sid); }) || null; }

      // Helper: parse time HH:MM → minutes
      function t2m(t) {
        var p = String(t || "").split(":");
        return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
      }
      function m2t(m) {
        return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
      }

      // Helper: opening hours for a day-string YYYY-MM-DD
      function ohFor(ds) {
        var overrides = (openingHours && openingHours.overrides) ? openingHours.overrides : {};
        if (overrides[ds]) return Object.assign({}, overrides[ds]);
        var base = (openingHours && openingHours["default"]) ? openingHours["default"] : { open: "07:30", close: "19:30", closed: false };
        var dow = new Date(ds + "T00:00:00").getDay(); // 0=Sun
        if (dow === 0 && !(openingHours && openingHours.openSunday)) return { closed: true };
        if (dow === 6 && !(openingHours && openingHours.openSaturday) && !(openingHours && openingHours.weekends)) return { closed: true };
        return { open: base.open || "07:30", close: base.close || "19:30", closed: !!base.closed };
      }

      // Helper: check coverage for a day
      function checkCov(ds, shifts, leaves) {
        var oh = ohFor(ds);
        if (oh.closed) return { ok: true, issues: [] };
        var min = parseInt(settings.minPharmacists, 10) || 1;
        var need = !!settings.pharmacistRequired;
        var onLeave = {};
        (leaves || []).filter(function (l) {
          return l.status === "approved" && l.start_date <= ds && l.end_date >= ds;
        }).forEach(function (l) { onLeave[l.staff_id] = true; });
        var openM = t2m(oh.open);
        var closeM = t2m(oh.close);
        if (closeM <= openM) return { ok: true, issues: [] };
        var events = [];
        (shifts || []).filter(function (s) { return s.shift_date === ds; }).forEach(function (s) {
          if (onLeave[s.staff_id]) return;
          var e = emp(s.staff_id);
          var isPh = (e && (e.designation === "pharmacist" || e.designation === "locum")) || (s.role_override === "pharmacist");
          if (!isPh) return;
          var st = Math.max(openM, t2m(s.start_time));
          var et = Math.min(closeM, t2m(s.end_time));
          if (et <= st) return;
          events.push({ t: st, d: +1 });
          events.push({ t: et, d: -1 });
        });
        if (!events.length) {
          return need
            ? { ok: false, issues: ["No pharmacist coverage: " + m2t(openM) + "–" + m2t(closeM)] }
            : { ok: true, issues: [] };
        }
        events.sort(function (a, b) { return a.t - b.t || b.d - a.d; });
        var gaps = [], count = 0, cur = openM, i = 0;
        while (i < events.length && events[i].t <= openM) { count += events[i].d; i++; }
        while (cur < closeM) {
          var nextT = (i < events.length) ? Math.min(events[i].t, closeM) : closeM;
          if (nextT > cur) {
            if (need && count < min) gaps.push(cur + "–" + nextT);
            cur = nextT;
          }
          while (i < events.length && events[i].t === cur) { count += events[i].d; i++; }
          if (i >= events.length) {
            if (cur < closeM && need && count < min) gaps.push(cur + "–" + closeM);
            break;
          }
        }
        return gaps.length > 0 ? { ok: false, issues: ["Gap on " + ds] } : { ok: true, issues: [] };
      }

      var allGapDays = [];

      for (var mi = 0; mi < months.length; mi++) {
        var mc = months[mi];
        var [assignR, leaveR] = await Promise.all([
          apiGet("/shifts/assignments?year=" + mc.year + "&month=" + mc.month),
          apiGet("/shifts/leaves?year=" + mc.year)
        ]);
        var shifts = (assignR && Array.isArray(assignR.shifts)) ? assignR.shifts : [];
        var leaves = (leaveR && Array.isArray(leaveR.leaves)) ? leaveR.leaves : [];

        // Check every working day in the month
        var daysInMonth = new Date(mc.year, mc.month, 0).getDate();
        for (var day = 1; day <= daysInMonth; day++) {
          var ds = mc.year + "-" + String(mc.month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
          if (ds < today) continue; // past days
          var cov = checkCov(ds, shifts, leaves);
          if (!cov.ok) allGapDays.push(ds);
        }
      }

      if (allGapDays.length === 0) {
        return { ok: true, status: "ok", msg: "No pharmacist gaps this/next month" };
      }
      return {
        ok: false,
        status: "warn",
        msg: allGapDays.length + " day" + (allGapDays.length !== 1 ? "s" : "") + " with pharmacist gap",
        days: allGapDays.slice(0, 5)
      };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchClientOrders() {
    var ym = currentYm();
    try {
      // Load current + previous month to catch active orders
      var [r1, r2] = await Promise.all([
        apiGet("/client-orders/entries?month=" + encodeURIComponent(ym) + "&fulfilled=0"),
        apiGet("/client-orders/entries?month=" + encodeURIComponent(prevYm(ym)) + "&fulfilled=0")
      ]);
      var entries = (r1 && Array.isArray(r1.entries) ? r1.entries : []).concat(
        r2 && Array.isArray(r2.entries) ? r2.entries : []
      );
      var active = entries.filter(function (e) { return !e.fulfilled; });
      if (active.length === 0) {
        return { ok: true, status: "ok", msg: "No active orders" };
      }
      return { ok: false, status: "info", msg: active.length + " active order" + (active.length !== 1 ? "s" : ""), count: active.length };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchTickets() {
    try {
      var r = await apiGet("/client-tickets/entries");
      var entries = (r && Array.isArray(r.entries)) ? r.entries : [];
      var open = entries.filter(function (e) {
        return !e.resolved && e.status !== "Resolved" && e.status !== "Closed";
      });
      if (open.length === 0) {
        return { ok: true, status: "ok", msg: "No open tickets" };
      }
      return { ok: false, status: "info", msg: open.length + " open ticket" + (open.length !== 1 ? "s" : ""), count: open.length };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchReturns() {
    var ym = currentYm();
    function from01(v) { return v === 1 || v === true || v === "1"; }
    try {
      var [r1, r2] = await Promise.all([
        apiGet("/returns/entries?month=" + encodeURIComponent(ym)),
        apiGet("/returns/entries?month=" + encodeURIComponent(prevYm(ym)))
      ]);
      var entries = (r1 && Array.isArray(r1.entries) ? r1.entries : []).concat(
        r2 && Array.isArray(r2.entries) ? r2.entries : []
      );
      var incomplete = entries.filter(function (e) {
        return !(from01(e.return_arranged) && from01(e.handed_over) &&
          from01(e.collection_note_received) && from01(e.credit_note_received));
      });
      if (incomplete.length === 0) {
        return { ok: true, status: "ok", msg: entries.length > 0 ? "All returns complete" : "No returns" };
      }
      return { ok: false, status: "warn", msg: incomplete.length + " return" + (incomplete.length !== 1 ? "s" : "") + " incomplete", count: incomplete.length };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchPaidOut() {
    var today = todayYmd();
    var ym = currentYm();
    try {
      var r = await apiGet("/paid-out/entries?month=" + encodeURIComponent(ym));
      var entries = (r && Array.isArray(r.entries)) ? r.entries : [];
      var todayEntries = entries.filter(function (e) { return String(e.entry_date || "") === today; });
      var total = 0;
      todayEntries.forEach(function (e) {
        var v = parseFloat(String(e.amount || e.fee || 0));
        if (isFinite(v)) total += v;
      });
      return {
        ok: true,
        status: "info",
        msg: "€" + total.toFixed(2) + " today",
        count: todayEntries.length,
        total: total
      };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchNearExpiry() {
    function daysUntilLocal(ymd) {
      var s = String(ymd || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      var parts = s.split("-");
      var exp = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      exp.setHours(0, 0, 0, 0);
      var now = new Date(); now.setHours(0, 0, 0, 0);
      return Math.round((exp.getTime() - now.getTime()) / 86400000);
    }
    try {
      var r = await apiGet("/near-expiry/entries");
      var entries = (r && Array.isArray(r.entries)) ? r.entries : [];
      var expired = [], expiring = [];
      entries.forEach(function (e) {
        var d = daysUntilLocal(e.expiry_date);
        if (d === null) return;
        if (d < 0) expired.push(e);
        else if (d <= 30) expiring.push(e);
      });
      if (expired.length === 0 && expiring.length === 0) {
        return { ok: true, status: "ok", msg: entries.length > 0 ? "No expired/near-expiry items" : "No items tracked" };
      }
      var parts = [];
      if (expired.length) parts.push(expired.length + " expired");
      if (expiring.length) parts.push(expiring.length + " expiring ≤30d");
      return {
        ok: false,
        status: expired.length > 0 ? "danger" : "warn",
        msg: parts.join(", "),
        expired: expired.length,
        expiring: expiring.length
      };
    } catch (e) {
      return { ok: null, status: "error", msg: "Failed to load" };
    }
  }

  async function fetchInstructions() {
    var today = todayYmd();
    var yesterday = addDaysYmd(today, -1);
    var ym = currentYm();
    var prevM = prevYm(ym);
    var needPrevMonth = yesterday.slice(0, 7) !== ym;

    try {
      var fetches = [
        apiGet("/instructions/global"),
        apiGet("/instructions/daily?month=" + encodeURIComponent(ym))
      ];
      if (needPrevMonth) {
        fetches.push(apiGet("/instructions/daily?month=" + encodeURIComponent(prevM)));
      }
      var results = await Promise.all(fetches);
      var globalR = results[0];
      var dailyR  = results[1];
      var daily2R = results[2] || null;

      // Merge daily records
      var dailyMap = {};
      function mergeDailyR(dr) {
        if (!dr) return;
        var records = dr.records || dr.daily || {};
        Object.keys(records).forEach(function (k) { dailyMap[k] = records[k]; });
      }
      mergeDailyR(dailyR);
      if (daily2R) mergeDailyR(daily2R);

      var todayRec = dailyMap[today] || null;
      var yesterdayRec = dailyMap[yesterday] || null;

      var todayNotes = todayRec && typeof todayRec.notes === "string" ? todayRec.notes.trim() : "";
      var handoverIn = yesterdayRec && Array.isArray(yesterdayRec.handover_out) ? yesterdayRec.handover_out : [];

      var permanentHandover = (globalR && globalR.global && globalR.global.permanent_handover)
        ? String(globalR.global.permanent_handover.text || "").trim()
        : "";

      return {
        ok: true,
        status: "info",
        todayNotes: todayNotes,
        handoverIn: handoverIn,
        permanentHandover: permanentHandover,
        yesterday: yesterday
      };
    } catch (e) {
      return { ok: null, status: "error", todayNotes: "", handoverIn: [], permanentHandover: "" };
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  QUICK-ENTRY MODALS
  // ════════════════════════════════════════════════════════════════

  // ── Temperature quick-entry ──────────────────────────────────────
  async function openTempModal(onSaved) {
    var today = todayYmd();
    try {
      var dr = await apiGet("/temperature/devices");
      var devices = (dr && Array.isArray(dr.devices)) ? dr.devices.filter(function (d) { return !d.inactive; }) : [];
      if (devices.length === 0) {
        E.modal.show("Quick Temperature Entry",
          "<div class='db-form'><p class='db-err'>No active devices configured. Go to Temperature to add devices first.</p></div>",
          [{ label: "Close", onClick: function () { E.modal.hide(); } }]);
        return;
      }

      var deviceRows = devices.map(function (dev) {
        return "<div class='db-device-row'>" +
          "<div class='db-device-name'>" + escHtml(dev.name || dev.device_name || "Device") +
          (dev.device_type ? " <span style='opacity:.6;font-weight:500;'>(" + escHtml(dev.device_type) + ")</span>" : "") +
          "</div>" +
          "<div style='display:grid;grid-template-columns:1fr 1fr 2fr;gap:6px;align-items:end;'>" +
          "<div><label>Min °C</label><input class='eikon-input' id='db-temp-min-" + escHtml(String(dev.id)) + "' type='number' step='0.1' placeholder='e.g. 2' style='width:100%;' /></div>" +
          "<div><label>Max °C</label><input class='eikon-input' id='db-temp-max-" + escHtml(String(dev.id)) + "' type='number' step='0.1' placeholder='e.g. 8' style='width:100%;' /></div>" +
          "<div><label>Notes</label><input class='eikon-input' id='db-temp-notes-" + escHtml(String(dev.id)) + "' type='text' placeholder='optional' style='width:100%;' /></div>" +
          "</div></div>";
      }).join("");

      var body =
        "<div class='db-form'>" +
        "<div style='display:flex;align-items:center;gap:8px;margin-bottom:4px;'>" +
        "<label style='font-size:12px;font-weight:900;color:var(--muted);'>Date</label>" +
        "<input class='eikon-input' id='db-temp-date' type='date' value='" + escHtml(today) + "' style='max-width:160px;' />" +
        "</div>" +
        deviceRows +
        "</div>";

      E.modal.show("Quick Temperature Entry", body, [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Save All", primary: true, onClick: async function () {
            var d = document.getElementById("db-temp-date");
            var dateVal = d ? d.value.trim() : today;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
              toast("Invalid date", "warn"); return;
            }
            var jobs = [];
            var missing = false;
            for (var i = 0; i < devices.length; i++) {
              var dev = devices[i];
              var minEl = document.getElementById("db-temp-min-" + dev.id);
              var maxEl = document.getElementById("db-temp-max-" + dev.id);
              var notesEl = document.getElementById("db-temp-notes-" + dev.id);
              var minV = minEl ? parseFloat(minEl.value) : NaN;
              var maxV = maxEl ? parseFloat(maxEl.value) : NaN;
              if (!isFinite(minV) || !isFinite(maxV)) { missing = true; break; }
              jobs.push({ device_id: dev.id, entry_date: dateVal, min_temp: minV, max_temp: maxV, notes: notesEl ? notesEl.value.trim() : "" });
            }
            if (missing) { toast("Fill Min and Max for all devices", "warn"); return; }
            try {
              for (var j = 0; j < jobs.length; j++) {
                await E.apiFetch("/temperature/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jobs[j]) });
              }
              E.modal.hide();
              toast("Temperature saved", "ok");
              if (typeof onSaved === "function") onSaved();
            } catch (e2) {
              toast("Save failed: " + (e2 && e2.message ? e2.message : "error"), "bad");
            }
          }
        }
      ]);
    } catch (e) {
      toast("Could not load devices", "bad");
    }
  }

  // ── Cleaning quick-entry ─────────────────────────────────────────
  function openCleaningModal(onSaved) {
    var today = todayYmd();
    var body =
      "<div class='db-form'>" +
      "<div class='db-form-row'>" +
      "<div><label>Date</label><input class='eikon-input' id='db-cl-date' type='date' value='" + escHtml(today) + "' /></div>" +
      "<div><label>Cleaner Name</label><input class='eikon-input' id='db-cl-cleaner' type='text' placeholder='Cleaner name' /></div>" +
      "</div>" +
      "<div class='db-form-row'>" +
      "<div><label>Time In</label><input class='eikon-input' id='db-cl-in' type='time' /></div>" +
      "<div><label>Time Out</label><input class='eikon-input' id='db-cl-out' type='time' /></div>" +
      "</div>" +
      "<div><label>Staff Name</label><input class='eikon-input' id='db-cl-staff' type='text' placeholder='Staff who witnessed' /></div>" +
      "<div><label>Notes</label><input class='eikon-input' id='db-cl-notes' type='text' placeholder='Optional notes' /></div>" +
      "</div>";

    E.modal.show("Quick Cleaning Record", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save", primary: true, onClick: async function () {
          var payload = {
            entry_date: (document.getElementById("db-cl-date") || {}).value || today,
            time_in: (document.getElementById("db-cl-in") || {}).value || "",
            time_out: (document.getElementById("db-cl-out") || {}).value || "",
            cleaner_name: ((document.getElementById("db-cl-cleaner") || {}).value || "").trim(),
            staff_name: ((document.getElementById("db-cl-staff") || {}).value || "").trim(),
            notes: ((document.getElementById("db-cl-notes") || {}).value || "").trim()
          };
          if (!payload.entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.entry_date)) {
            toast("Invalid date", "warn"); return;
          }
          try {
            await E.apiFetch("/cleaning/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            E.modal.hide();
            toast("Cleaning record saved", "ok");
            if (typeof onSaved === "function") onSaved();
          } catch (e) {
            toast("Save failed: " + (e && e.message ? e.message : "error"), "bad");
          }
        }
      }
    ]);
  }

  // ── Daily Register quick-entry ───────────────────────────────────
  function openDailyRegisterModal(onSaved) {
    var today = todayYmd();
    var body =
      "<div class='db-form'>" +
      "<div class='db-form-row'>" +
      "<div><label>Date</label><input class='eikon-input' id='db-dr-date' type='date' value='" + escHtml(today) + "' /></div>" +
      "<div><label>Client ID (ID No.)</label><input class='eikon-input' id='db-dr-clientid' type='text' placeholder='ID number' /></div>" +
      "</div>" +
      "<div><label>Client Name &amp; Surname</label><input class='eikon-input' id='db-dr-client' type='text' placeholder='Full name' /></div>" +
      "<div><label>Medicine Name &amp; Dose</label><input class='eikon-input' id='db-dr-medicine' type='text' placeholder='e.g. Methadone 40mg' /></div>" +
      "<div><label>Posology</label><input class='eikon-input' id='db-dr-posology' type='text' placeholder='e.g. 1 daily' /></div>" +
      "<div class='db-form-row'>" +
      "<div><label>Prescriber Name</label><input class='eikon-input' id='db-dr-prescriber' type='text' placeholder='Dr. name' /></div>" +
      "<div><label>Prescriber Reg No.</label><input class='eikon-input' id='db-dr-prescreg' type='text' placeholder='Reg no.' /></div>" +
      "</div>" +
      "</div>";

    E.modal.show("Quick Daily Register Entry", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save", primary: true, onClick: async function () {
          var payload = {
            entry_date: (document.getElementById("db-dr-date") || {}).value || today,
            client_name: ((document.getElementById("db-dr-client") || {}).value || "").trim(),
            client_id: ((document.getElementById("db-dr-clientid") || {}).value || "").trim(),
            medicine_name_dose: ((document.getElementById("db-dr-medicine") || {}).value || "").trim(),
            posology: ((document.getElementById("db-dr-posology") || {}).value || "").trim(),
            prescriber_name: ((document.getElementById("db-dr-prescriber") || {}).value || "").trim(),
            prescriber_reg_no: ((document.getElementById("db-dr-prescreg") || {}).value || "").trim()
          };
          if (!payload.entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.entry_date)) {
            toast("Invalid date", "warn"); return;
          }
          if (!payload.client_name) { toast("Client name required", "warn"); return; }
          if (!payload.client_id) { toast("Client ID required", "warn"); return; }
          if (!payload.medicine_name_dose) { toast("Medicine name required", "warn"); return; }
          if (!payload.posology) { toast("Posology required", "warn"); return; }
          try {
            await E.apiFetch("/daily-register/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            E.modal.hide();
            toast("Daily register entry saved", "ok");
            if (typeof onSaved === "function") onSaved();
          } catch (e) {
            toast("Save failed: " + (e && e.message ? e.message : "error"), "bad");
          }
        }
      }
    ]);
  }

  // ════════════════════════════════════════════════════════════════
  //  CARD RENDERERS
  // ════════════════════════════════════════════════════════════════

  function dotHtml(level) {
    // level: "ok"|"warn"|"danger"|"info"|"idle"
    return "<span class='db-dot db-dot-" + level + "'></span>";
  }

  function cardClass(level) {
    if (level === "ok") return "db-card db-ok";
    if (level === "warn") return "db-card db-warn";
    if (level === "danger") return "db-card db-danger";
    if (level === "info") return "db-card db-info";
    return "db-card";
  }

  function loadingCard(icon, name) {
    return "<div class='db-card db-loading'>" +
      "<div class='db-card-head'><span class='db-card-icon'>" + icon + "</span>" +
      "<span class='db-card-name'>" + escHtml(name) + "</span>" +
      "<span class='db-dot db-dot-idle'></span></div>" +
      "<div class='db-card-body'><span class='db-spinner'></span>Loading…</div>" +
      "</div>";
  }

  function renderTemperatureCard(data, onAction) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "danger");
    var actBtn = "";
    if (!data.ok && data.status === "missing") {
      actBtn = "<button class='db-btn db-btn-action' id='db-temp-enter-btn'>+ Enter Now</button>";
    }
    var viewBtn = "<button class='db-btn db-btn-primary' id='db-temp-view-btn'>View</button>";
    var sub = data.status === "missing" && data.deviceCount
      ? "<div class='db-card-sub'>" + data.deviceCount + " device" + (data.deviceCount !== 1 ? "s" : "") + " configured</div>"
      : "";
    return "<div class='" + cardClass(level) + "' id='db-card-temperature'>" +
      "<div class='db-card-head'><span class='db-card-icon'>🌡</span><span class='db-card-name'>Temperature</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      sub +
      "<div class='db-card-actions'>" + actBtn + viewBtn + "</div>" +
      "</div>";
  }

  function renderCleaningCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "danger");
    var actBtn = "";
    if (!data.ok && data.status === "missing") {
      actBtn = "<button class='db-btn db-btn-action' id='db-clean-enter-btn'>+ Enter Now</button>";
    }
    var sub = data.lastMsg ? "<div class='db-card-sub'>" + escHtml(data.lastMsg) + "</div>" : "";
    return "<div class='" + cardClass(level) + "' id='db-card-cleaning'>" +
      "<div class='db-card-head'><span class='db-card-icon'>🧼</span><span class='db-card-name'>Cleaning</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      sub +
      "<div class='db-card-actions'>" + actBtn +
      "<button class='db-btn db-btn-primary' id='db-clean-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderDailyRegCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "danger");
    var actBtn = "";
    if (!data.ok && data.status === "missing") {
      actBtn = "<button class='db-btn db-btn-action' id='db-dr-enter-btn'>+ Enter Now</button>";
    }
    return "<div class='" + cardClass(level) + "' id='db-card-dailyreg'>" +
      "<div class='db-card-head'><span class='db-card-icon'>📓</span><span class='db-card-name'>Daily Register</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      "<div class='db-card-actions'>" + actBtn +
      "<button class='db-btn db-btn-primary' id='db-dr-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderCertificatesCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : (data.status === "danger" ? "danger" : "warn"));
    var sub = "";
    if (!data.ok && (data.expired || data.soon)) {
      var lines = [];
      if (data.expired) data.expired.slice(0, 2).forEach(function (c) { lines.push("❌ " + c.name); });
      if (data.soon) data.soon.slice(0, 2).forEach(function (c) { lines.push("⏳ " + c.name + " (" + c.days + "d)"); });
      if (lines.length) sub = "<div class='db-card-sub'>" + lines.map(escHtml).join("<br>") + "</div>";
    }
    return "<div class='" + cardClass(level) + "' id='db-card-certs'>" +
      "<div class='db-card-head'><span class='db-card-icon'>📄</span><span class='db-card-name'>Certificates</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      sub +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-certs-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderAlertsCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "warn");
    return "<div class='" + cardClass(level) + "' id='db-card-alerts'>" +
      "<div class='db-card-head'><span class='db-card-icon'>⚠️</span><span class='db-card-name'>Alerts</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-alerts-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderShiftsCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "warn");
    var sub = "";
    if (!data.ok && data.days && data.days.length) {
      sub = "<div class='db-card-sub'>" + data.days.slice(0, 3).map(escHtml).join(", ") +
        (data.days.length > 3 ? "…" : "") + "</div>";
    }
    return "<div class='" + cardClass(level) + "' id='db-card-shifts'>" +
      "<div class='db-card-head'><span class='db-card-icon'>📅</span><span class='db-card-name'>Shifts</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      sub +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-shifts-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderOrdersCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "info");
    return "<div class='" + cardClass(level) + "' id='db-card-orders'>" +
      "<div class='db-card-head'><span class='db-card-icon'>📦</span><span class='db-card-name'>Client Orders</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-orders-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderTicketsCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "info");
    return "<div class='" + cardClass(level) + "' id='db-card-tickets'>" +
      "<div class='db-card-head'><span class='db-card-icon'>🎟</span><span class='db-card-name'>Client Tickets</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-tickets-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderReturnsCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : "warn");
    return "<div class='" + cardClass(level) + "' id='db-card-returns'>" +
      "<div class='db-card-head'><span class='db-card-icon'>↩️</span><span class='db-card-name'>Returns</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-returns-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderPaidOutCard(data) {
    var level = "info";
    return "<div class='" + cardClass(level) + "' id='db-card-paidout'>" +
      "<div class='db-card-head'><span class='db-card-icon'>💸</span><span class='db-card-name'>Paid Out</span>" + dotHtml(level) + "</div>" +
      "<div class='db-big-val'>" + escHtml(data.ok === null ? "—" : ("€" + (data.total || 0).toFixed(2))) + "</div>" +
      "<div class='db-big-sub'>Today" + (data.count ? " · " + data.count + " entr" + (data.count === 1 ? "y" : "ies") : "") + "</div>" +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-paidout-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderNearExpiryCard(data) {
    var level = data.ok === null ? "idle" : (data.ok ? "ok" : (data.expired > 0 ? "danger" : "warn"));
    return "<div class='" + cardClass(level) + "' id='db-card-nearexpiry'>" +
      "<div class='db-card-head'><span class='db-card-icon'>⏳</span><span class='db-card-name'>Near Expiry</span>" + dotHtml(level) + "</div>" +
      "<div class='db-card-body'>" + escHtml(data.msg) + "</div>" +
      "<div class='db-card-actions'><button class='db-btn db-btn-primary' id='db-nearexpiry-view-btn'>View</button></div>" +
      "</div>";
  }

  function renderInstructionsBanner(data) {
    if (!data || data.ok === null) return "";

    var hasNotes = data.todayNotes && data.todayNotes.length > 0;
    var hasHandover = data.handoverIn && data.handoverIn.length > 0;
    var hasPermanent = data.permanentHandover && data.permanentHandover.length > 0;

    if (!hasNotes && !hasHandover && !hasPermanent) return "";

    var notesHtml = hasNotes
      ? "<div class='db-instr-text'>" + escHtml(data.todayNotes) + "</div>"
      : "<div class='db-instr-empty'>No notes for today</div>";

    var handoverHtml = "";
    if (hasHandover) {
      handoverHtml = data.handoverIn.slice(0, 8).map(function (b) {
        var sev = String(b.severity || b.sev || "low").toLowerCase();
        var sevClass = sev === "high" ? "db-bullet-sev-high" : (sev === "medium" || sev === "med" ? "db-bullet-sev-med" : "db-bullet-sev-low");
        return "<div class='db-bullet'><span class='db-bullet-sev " + sevClass + "'>" + escHtml(sev.toUpperCase().slice(0, 3)) + "</span><span class='db-bullet-text'>" + escHtml(b.text || "") + "</span></div>";
      }).join("");
    } else {
      handoverHtml = "<div class='db-instr-empty'>No incoming handover from " + escHtml(data.yesterday) + "</div>";
    }

    var permanentHtml = hasPermanent
      ? "<div class='db-instr-text'>" + escHtml(data.permanentHandover) + "</div>"
      : "";

    // Show 2-col layout for notes + handover; permanent below if present
    var cols = 2;
    var rowHtml =
      "<div class='db-instr-row'>" +
      "<div class='db-instr-section'><div class='db-instr-label'>📝 Today's Notes</div>" + notesHtml + "</div>" +
      "<div class='db-instr-section'><div class='db-instr-label'>📨 Incoming Handover (from " + escHtml(data.yesterday) + ")</div>" + handoverHtml + "</div>" +
      "</div>";

    var permanentRow = hasPermanent
      ? "<div style='margin-top:10px;'><div class='db-instr-label'>📌 Permanent Handover</div>" + permanentHtml + "</div>"
      : "";

    return "<div class='db-instr-banner'>" +
      "<div class='db-instr-title'><span>📋</span> Instructions &amp; Handover</div>" +
      rowHtml +
      permanentRow +
      "<div style='margin-top:8px;text-align:right;'><button class='db-btn db-btn-primary' id='db-instr-view-btn'>View Instructions</button></div>" +
      "</div>";
  }

  // ════════════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ════════════════════════════════════════════════════════════════

  async function render({ E: _E, mount, user }) {
    ensureStyles();
    mount.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "db-wrap";
    mount.appendChild(wrap);

    // ── Header ─────────────────────────────────────────────────────
    var header = document.createElement("div");
    header.className = "db-header";
    header.innerHTML =
      "<div class='db-title'>Dashboard</div>" +
      "<div style='display:flex;align-items:center;gap:10px;'>" +
      "<span class='db-ts' id='db-ts'>Loading…</span>" +
      "<button class='db-refresh' id='db-refresh-btn'>↻ Refresh</button>" +
      "</div>";
    wrap.appendChild(header);

    // ── Grid placeholder (loading state) ───────────────────────────
    var gridEl = document.createElement("div");
    gridEl.className = "db-grid";
    gridEl.id = "db-grid";
    gridEl.innerHTML =
      loadingCard("🌡", "Temperature") +
      loadingCard("🧼", "Cleaning") +
      loadingCard("📓", "Daily Register") +
      loadingCard("📄", "Certificates") +
      loadingCard("⚠️", "Alerts") +
      loadingCard("📅", "Shifts") +
      loadingCard("📦", "Client Orders") +
      loadingCard("🎟", "Client Tickets") +
      loadingCard("↩️", "Returns") +
      loadingCard("💸", "Paid Out") +
      loadingCard("⏳", "Near Expiry");
    wrap.appendChild(gridEl);

    // ── Instructions placeholder ────────────────────────────────────
    var instrEl = document.createElement("div");
    instrEl.id = "db-instr-area";
    wrap.appendChild(instrEl);

    // ── Run all fetches ─────────────────────────────────────────────
    async function loadAll() {
      var ts = new Date();
      var tsEl = document.getElementById("db-ts");
      if (tsEl) tsEl.textContent = "Loading…";

      // Reset grid to loading state
      var g = document.getElementById("db-grid");
      if (g) {
        g.innerHTML =
          loadingCard("🌡", "Temperature") +
          loadingCard("🧼", "Cleaning") +
          loadingCard("📓", "Daily Register") +
          loadingCard("📄", "Certificates") +
          loadingCard("⚠️", "Alerts") +
          loadingCard("📅", "Shifts") +
          loadingCard("📦", "Client Orders") +
          loadingCard("🎟", "Client Tickets") +
          loadingCard("↩️", "Returns") +
          loadingCard("💸", "Paid Out") +
          loadingCard("⏳", "Near Expiry");
      }
      var ia = document.getElementById("db-instr-area");
      if (ia) ia.innerHTML = "";

      try {
        // Run all fetches in parallel
        var [tempD, cleanD, drD, certD, alertsD, shiftsD, ordersD, ticketsD, returnsD, paidoutD, nearexpiryD, instrD] =
          await Promise.all([
            fetchTemperature(),
            fetchCleaning(),
            fetchDailyRegister(),
            fetchCertificates(),
            fetchAlerts(),
            fetchShifts(),
            fetchClientOrders(),
            fetchTickets(),
            fetchReturns(),
            fetchPaidOut(),
            fetchNearExpiry(),
            fetchInstructions()
          ]);

        // Update timestamp
        var now = new Date();
        var h = String(now.getHours()).padStart(2, "0");
        var m = String(now.getMinutes()).padStart(2, "0");
        if (tsEl) tsEl.textContent = "Updated " + h + ":" + m;

        // Re-render grid
        var g2 = document.getElementById("db-grid");
        if (!g2) return;
        g2.innerHTML =
          renderTemperatureCard(tempD) +
          renderCleaningCard(cleanD) +
          renderDailyRegCard(drD) +
          renderCertificatesCard(certD) +
          renderAlertsCard(alertsD) +
          renderShiftsCard(shiftsD) +
          renderOrdersCard(ordersD) +
          renderTicketsCard(ticketsD) +
          renderReturnsCard(returnsD) +
          renderPaidOutCard(paidoutD) +
          renderNearExpiryCard(nearexpiryD);

        // Instructions banner
        var ia2 = document.getElementById("db-instr-area");
        if (ia2) ia2.innerHTML = renderInstructionsBanner(instrD);

        // ── Bind button events ──────────────────────────────────────
        // Temperature
        var tempEnterBtn = document.getElementById("db-temp-enter-btn");
        if (tempEnterBtn) tempEnterBtn.addEventListener("click", function () {
          openTempModal(function () { loadAll(); });
        });
        var tempViewBtn = document.getElementById("db-temp-view-btn");
        if (tempViewBtn) tempViewBtn.addEventListener("click", function () { goTo("temperature"); });

        // Cleaning
        var cleanEnterBtn = document.getElementById("db-clean-enter-btn");
        if (cleanEnterBtn) cleanEnterBtn.addEventListener("click", function () {
          openCleaningModal(function () { loadAll(); });
        });
        var cleanViewBtn = document.getElementById("db-clean-view-btn");
        if (cleanViewBtn) cleanViewBtn.addEventListener("click", function () { goTo("cleaning"); });

        // Daily Register
        var drEnterBtn = document.getElementById("db-dr-enter-btn");
        if (drEnterBtn) drEnterBtn.addEventListener("click", function () {
          openDailyRegisterModal(function () { loadAll(); });
        });
        var drViewBtn = document.getElementById("db-dr-view-btn");
        if (drViewBtn) drViewBtn.addEventListener("click", function () { goTo("dailyregister"); });

        // Certificates
        var certsViewBtn = document.getElementById("db-certs-view-btn");
        if (certsViewBtn) certsViewBtn.addEventListener("click", function () { goTo("certificates"); });

        // Alerts
        var alertsViewBtn = document.getElementById("db-alerts-view-btn");
        if (alertsViewBtn) alertsViewBtn.addEventListener("click", function () { goTo("alerts"); });

        // Shifts
        var shiftsViewBtn = document.getElementById("db-shifts-view-btn");
        if (shiftsViewBtn) shiftsViewBtn.addEventListener("click", function () { goTo("shifts"); });

        // Client Orders
        var ordersViewBtn = document.getElementById("db-orders-view-btn");
        if (ordersViewBtn) ordersViewBtn.addEventListener("click", function () { goTo("clientorders"); });

        // Tickets
        var ticketsViewBtn = document.getElementById("db-tickets-view-btn");
        if (ticketsViewBtn) ticketsViewBtn.addEventListener("click", function () { goTo("tickets"); });

        // Returns
        var returnsViewBtn = document.getElementById("db-returns-view-btn");
        if (returnsViewBtn) returnsViewBtn.addEventListener("click", function () { goTo("returns"); });

        // Paid Out
        var paidoutViewBtn = document.getElementById("db-paidout-view-btn");
        if (paidoutViewBtn) paidoutViewBtn.addEventListener("click", function () { goTo("paidout"); });

        // Near Expiry
        var nearexpiryViewBtn = document.getElementById("db-nearexpiry-view-btn");
        if (nearexpiryViewBtn) nearexpiryViewBtn.addEventListener("click", function () { goTo("nearexpiry"); });

        // Instructions
        var instrViewBtn = document.getElementById("db-instr-view-btn");
        if (instrViewBtn) instrViewBtn.addEventListener("click", function () { goTo("instructions"); });

      } catch (e) {
        err("[dash] loadAll error:", e);
        var g3 = document.getElementById("db-grid");
        if (g3) g3.innerHTML = "<div style='grid-column:1/-1;padding:16px;color:var(--danger);font-size:13px;'>Failed to load dashboard data: " + escHtml(String(e && (e.message || e))) + "</div>";
      }
    }

    // ── Refresh button ──────────────────────────────────────────────
    var refreshBtn = document.getElementById("db-refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        loadAll();
      });
    }

    // Initial load
    await loadAll();
  }

  // ── Register module ─────────────────────────────────────────────
  E.registerModule({
    id: "dashboard",
    title: "Dashboard",
    order: 1,
    icon: "🏠",
    render: render
  });

})();
