/* ============================================================
   EIKON — Dashboard Module  (modules.dashboard.js)
   - Order 1 (first in sidebar)
   - Compact, actionable overview across modules
   - Quick-entry modals for: Temperature, Cleaning, Daily Register
   - FAST LOAD: parallel fetch + incremental render + timeouts
   - DEBUG: console + diagnostics modal (dbg>=1)
   ============================================================ */
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ----------------------------
  // Helpers
  // ----------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  function pad2(n) { n = parseInt(n, 10) || 0; return (n < 10 ? "0" : "") + n; }

  function ymdFromDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function ymFromDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function parseYmd(s) {
    s = String(s || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + "T00:00:00");
    if (!isFinite(d.getTime())) return null;
    return d;
  }

  function parseYm(s) {
    s = String(s || "").trim();
    if (!/^\d{4}-\d{2}$/.test(s)) return null;
    var d = new Date(s + "-01T00:00:00");
    if (!isFinite(d.getTime())) return null;
    return d;
  }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + (parseInt(n, 10) || 0));
    return x;
  }

  function todayYmd() { return ymdFromDate(new Date()); }
  function todayYm() { return ymFromDate(new Date()); }

  function ymdAdd(ymd, n) {
    var d = parseYmd(ymd);
    if (!d) return ymd;
    return ymdFromDate(addDays(d, n));
  }

  function moneyEUR(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return "€" + n.toFixed(2);
  }

  function truthy01(v) {
    return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true" || String(v).toLowerCase() === "yes";
  }

  function safeStr(v) { return String(v == null ? "" : v).trim(); }

  function q(sel, root) { return (root || document).querySelector(sel); }

  // ----------------------------
  // Fast API (timeout wrapper)
  // ----------------------------
  var REQ_TIMEOUT_MS = 8000;

  function withTimeout(promise, ms, label) {
    ms = ms || REQ_TIMEOUT_MS;
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          var err = new Error((label ? (label + ": ") : "") + "Request timeout");
          err.code = "timeout";
          reject(err);
        }, ms);
      })
    ]);
  }

  async function api(path, options, timeoutMs, label) {
    return withTimeout(E.apiFetch(path, options || { method: "GET" }), timeoutMs, label || path);
  }

  // ----------------------------
  // Dashboard debug (respects core.js dbg setting)
  // ----------------------------
  var DASH_DEBUG = (typeof E.DEBUG === "number") ? E.DEBUG : (typeof E.DBG === "number" ? E.DBG : 0);

  function dashNowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function dlog(level /* 'log'|'warn'|'error'|'dbg' */, args) {
    try {
      var lv = String(level || "log");
      if (lv === "log" && DASH_DEBUG < 1) return;
      if (lv === "dbg" && DASH_DEBUG < 2) return;

      var a = Array.prototype.slice.call(args || []);
      a.unshift("[dash]");
      if (lv === "warn") console.warn.apply(console, a);
      else if (lv === "error") console.error.apply(console, a);
      else console.log.apply(console, a);
    } catch (e) {}
  }

  function dgroup(label, fn) {
    if (DASH_DEBUG < 1) { try { fn && fn(); } catch (e) {} return; }
    try {
      if (console.groupCollapsed) console.groupCollapsed(label);
      else console.log(label);
      try { fn && fn(); } catch (e2) {}
      if (console.groupEnd) console.groupEnd();
    } catch (e3) { try { fn && fn(); } catch (e4) {} }
  }

  // ----------------------------
  // Compact UI builders
  // ----------------------------
  function pill(type, text) {
    return '<span class="eikon-pill eikon-dash-pill eikon-dash-pill-' + esc(type) + '">' + esc(text) + "</span>";
  }

  function btn(action, label, opts) {
    opts = opts || {};
    var cls = "eikon-btn eikon-dash-btn";
    if (opts.primary) cls += " primary";
    if (opts.danger) cls += " danger";
    if (opts.small) cls += " eikon-dash-btn-small";
    var title = opts.title ? ' title="' + esc(opts.title) + '"' : "";
    return '<button class="' + cls + '" data-action="' + esc(action) + '"' + title + ">" + esc(label) + "</button>";
  }

  function row(icon, title, sub, pillHtml, actionsHtml) {
    return (
      '<div class="eikon-dash-item">' +
        '<div class="eikon-dash-left">' +
          '<div class="eikon-dash-ico" aria-hidden="true">' + esc(icon) + "</div>" +
          '<div class="eikon-dash-txt">' +
            '<div class="eikon-dash-label">' + esc(title) + "</div>" +
            (sub ? '<div class="eikon-dash-sub">' + esc(sub) + "</div>" : "") +
          "</div>" +
        "</div>" +
        '<div class="eikon-dash-right">' +
          (pillHtml || "") +
          (actionsHtml || "") +
        "</div>" +
      "</div>"
    );
  }

  function injectCssOnce() {
    if (document.getElementById("eikon-dash-style")) return;
    var st = document.createElement("style");
    st.id = "eikon-dash-style";
    st.textContent =
      ".eikon-dash-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}" +
      ".eikon-dash-title{font-weight:950;font-size:16px;letter-spacing:.2px}" +
      ".eikon-dash-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".eikon-dash-grid{display:flex;gap:12px;flex-wrap:wrap}" +
      ".eikon-dash-card{flex:1 1 360px;min-width:320px}" +
      ".eikon-dash-card-wide{flex:1 1 100%}" +
      ".eikon-dash-card-title{font-weight:950;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:10px}" +
      ".eikon-dash-list{display:flex;flex-direction:column;gap:8px}" +
      ".eikon-dash-item{display:flex;align-items:center;justify-content:space-between;gap:12px;" +
        "padding:10px 12px;border-radius:14px;border:1px solid var(--border);background:rgba(0,0,0,.18)}" +
      ".eikon-dash-left{display:flex;align-items:flex-start;gap:10px;min-width:0}" +
      ".eikon-dash-ico{width:26px;height:26px;display:flex;align-items:center;justify-content:center;" +
        "border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.06);flex:0 0 auto}" +
      ".eikon-dash-txt{min-width:0}" +
      ".eikon-dash-label{font-weight:900;font-size:13px;line-height:1.1}" +
      ".eikon-dash-sub{font-size:12px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:58vw}" +
      ".eikon-dash-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}" +
      ".eikon-dash-btn{padding:8px 10px;border-radius:999px;font-size:12px;line-height:1}" +
      ".eikon-dash-btn-small{padding:6px 9px}" +
      ".eikon-dash-pill{font-weight:900}" +
      ".eikon-dash-pill-ok{border-color:rgba(80,200,120,.35);background:rgba(80,200,120,.10)}" +
      ".eikon-dash-pill-warn{border-color:rgba(255,196,0,.35);background:rgba(255,196,0,.10)}" +
      ".eikon-dash-pill-danger{border-color:rgba(255,90,122,.45);background:rgba(255,90,122,.12)}" +
      ".eikon-dash-pill-info{border-color:rgba(90,162,255,.35);background:rgba(90,162,255,.10)}" +
      ".eikon-dash-pill-na{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04);opacity:.9}" +
      ".eikon-dash-detail{font-size:13px;line-height:1.35}" +
      ".eikon-dash-detail .eikon-help{margin-top:6px}" +
      ".eikon-dash-detail ul{margin:10px 0 0 18px;padding:0}" +
      ".eikon-dash-detail li{margin:6px 0}" +
      ".eikon-dash-mini-table{width:100%;border-collapse:collapse;margin-top:10px}" +
      ".eikon-dash-mini-table th,.eikon-dash-mini-table td{padding:8px 8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;font-size:12px}" +
      ".eikon-dash-mini-table th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.2px}" +
      "@media (max-width:520px){.eikon-dash-sub{max-width:78vw}.eikon-dash-right{gap:6px}.eikon-dash-btn{padding:7px 9px}}";
    document.head.appendChild(st);
  }

  // ----------------------------
  // State
  // ----------------------------
  var state = {
    mount: null,
    loading: false,
    lastUpdated: "",
    refreshToken: 0,
    diag: null,
    data: {
      temp: null,
      cleaning: null,
      dailyregister: null,
      certificates: null,
      alerts: null,
      shifts: null,
      clientorders: null,
      tickets: null,
      returns: null,
      paidout: null,
      nearexpiry: null,
      instructions: null
    }
  };

  function setLoadingPlaceholders() {
    state.data.temp = null;
    state.data.cleaning = null;
    state.data.dailyregister = null;
    state.data.certificates = null;
    state.data.alerts = null;
    state.data.shifts = null;
    state.data.clientorders = null;
    state.data.tickets = null;
    state.data.returns = null;
    state.data.paidout = null;
    state.data.nearexpiry = null;
    state.data.instructions = null;
  }

  // ----------------------------
  // Checks
  // ----------------------------
  function computeTemperature(devices, entries, ymd) {
    devices = Array.isArray(devices) ? devices : [];
    entries = Array.isArray(entries) ? entries : [];

    function isActiveDev(d) {
      if (!d) return false;
      if (truthy01(d.inactive) || truthy01(d.is_inactive)) return false;
      if (String(d.status || "").toLowerCase() === "inactive") return false;
      if (d.is_active === 0 || d.active === 0 || d.enabled === 0) return false;
      return true;
    }

    var active = devices.filter(isActiveDev);

    var byDev = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      if (safeStr(e.entry_date) !== ymd) continue;
      var did = String(e.device_id || "");
      if (did) byDev[did] = e;
    }

    var missing = [];
    for (var j = 0; j < active.length; j++) {
      var dev = active[j];
      var id = String(dev.id || "");
      if (!id) continue;
      if (!byDev[id]) missing.push(dev);
    }

    return { total: active.length, missing: missing, byDev: byDev, devices: active };
  }

  function computeCleaning(entries, today) {
    entries = Array.isArray(entries) ? entries : [];
    var last = "";
    var hasRecent = false;

    var t0 = parseYmd(today) || new Date();
    var threshold = ymdFromDate(addDays(t0, -13)); // 14-day window inclusive

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      var d = safeStr(e.entry_date);
      if (!d) continue;
      if (!last || d > last) last = d;
      if (d >= threshold && d <= today) hasRecent = true;
    }

    return { lastDate: last, hasRecent: hasRecent, threshold: threshold };
  }

  function computeDailyRegister(entries, today) {
    entries = Array.isArray(entries) ? entries : [];
    var count = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      if (safeStr(e.entry_date) === today) count++;
    }
    return { countToday: count };
  }

  function computeCertificates(items, today) {
    items = Array.isArray(items) ? items : [];
    var expired = [];
    var due = [];

    var t = parseYmd(today) || new Date();
    var tTs = t.getTime();
    var t30 = addDays(t, 30).getTime();

    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var nd = safeStr(it.next_due);
      if (!nd) continue;
      var d = parseYmd(nd);
      if (!d) continue;
      var ts = d.getTime();
      if (ts < tTs) expired.push(it);
      else if (ts <= t30) due.push(it);
    }

    expired.sort(function (a, b) { return safeStr(a.next_due) < safeStr(b.next_due) ? -1 : 1; });
    due.sort(function (a, b) { return safeStr(a.next_due) < safeStr(b.next_due) ? -1 : 1; });

    return { expired: expired, dueSoon: due };
  }

  function computeAlerts(entries) {
    entries = Array.isArray(entries) ? entries : [];
    var keys = [
      "team_informed",
      "supplier_informed",
      "authorities_informed",
      "return_arranged",
      "handed_over",
      "collection_note_received",
      "credit_note_received"
    ];

    var incomplete = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      var ok = true;
      for (var k = 0; k < keys.length; k++) {
        if (!truthy01(e[keys[k]])) { ok = false; break; }
      }
      if (!ok) incomplete.push(e);
    }
    return { incomplete: incomplete };
  }

  // --- Shifts coverage (lightweight; uses existing assignments endpoints) ---
  function t2m(hhmm) {
    hhmm = String(hhmm || "").trim();
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
    if (!m) return NaN;
    var h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (!isFinite(h) || !isFinite(mm)) return NaN;
    return h * 60 + mm;
  }
  function m2t(mins) {
    mins = Math.max(0, parseInt(mins, 10) || 0);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return pad2(h) + ":" + pad2(m);
  }
  function ohFor(ds, hours) {
    hours = hours || {};
    var def = hours["default"] || { open: "07:30", close: "19:30", closed: false };
    var ovr = (hours.overrides && hours.overrides[ds]) ? hours.overrides[ds] : null;
    var out = {
      open: safeStr((ovr && ovr.open) || def.open || "07:30"),
      close: safeStr((ovr && ovr.close) || def.close || "19:30"),
      closed: !!((ovr && ovr.closed) || def.closed)
    };

    try {
      var wd = new Date(ds + "T00:00:00").getDay();
      if (!out.closed) {
        if (wd === 6 && hours.openSaturday === false) out.closed = true;
        if (wd === 0 && hours.openSunday === false) out.closed = true;
      }
    } catch (e) {}

    return out;
  }
  function emp(staffId, staff) {
    staffId = String(staffId || "");
    staff = Array.isArray(staff) ? staff : [];
    for (var i = 0; i < staff.length; i++) {
      if (String((staff[i] || {}).id) === staffId) return staff[i];
    }
    return null;
  }
  function checkCoverage(ds, payload) {
    payload = payload || {};
    var hours = payload.openingHours || {};
    var settings = payload.settings || {};
    var staff = payload.staff || [];
    var shifts = payload.shifts || [];
    var leaves = payload.leaves || [];

    var oh = ohFor(ds, hours);
    if (oh.closed) return { ok: true, issues: [], open: oh.open, close: oh.close };

    var min = parseInt(settings.minPharmacists, 10) || 1;
    var need = !!settings.pharmacistRequired;

    var onLeave = Object.create(null);
    for (var i = 0; i < leaves.length; i++) {
      var l = leaves[i] || {};
      if (String(l.status || "") !== "approved") continue;
      if (safeStr(l.start_date) <= ds && safeStr(l.end_date) >= ds) onLeave[String(l.staff_id || "")] = true;
    }

    var openM = t2m(oh.open || "07:30");
    var closeM = t2m(oh.close || "19:30");
    if (!isFinite(openM) || !isFinite(closeM) || closeM <= openM) return { ok: true, issues: [], open: oh.open, close: oh.close };

    var events = [];
    for (var s = 0; s < shifts.length; s++) {
      var sh = shifts[s] || {};
      if (safeStr(sh.shift_date) !== ds) continue;

      var sid = String(sh.staff_id || "");
      if (onLeave[sid]) continue;

      var e = emp(sid, staff);
      var des = String((e && e.designation) || "").toLowerCase();
      var isPh = (des === "pharmacist" || des === "locum") || (String(sh.role_override || "").toLowerCase() === "pharmacist");
      if (!isPh) continue;

      var st = Math.max(openM, t2m(sh.start_time));
      var et = Math.min(closeM, t2m(sh.end_time));
      if (!isFinite(st) || !isFinite(et) || et <= st) continue;

      events.push({ t: st, d: +1 });
      events.push({ t: et, d: -1 });
    }

    if (!events.length) {
      var issues0 = need ? ["No pharmacist coverage: " + m2t(openM) + "–" + m2t(closeM)] : [];
      return { ok: issues0.length === 0, issues: issues0, open: oh.open, close: oh.close };
    }

    events.sort(function (a, b) { return a.t - b.t || b.d - a.d; });
    var gaps = [];
    var count = 0;
    var cur = openM;

    var idx = 0;
    while (idx < events.length && events[idx].t <= openM) { count += events[idx].d; idx++; }

    while (cur < closeM) {
      var nextT = (idx < events.length) ? Math.min(events[idx].t, closeM) : closeM;
      if (nextT > cur) {
        if (need && count < min) gaps.push({ start: cur, end: nextT, count: count });
        cur = nextT;
      }
      while (idx < events.length && events[idx].t === cur) { count += events[idx].d; idx++; }
      if (idx >= events.length) {
        if (cur < closeM && need && count < min) gaps.push({ start: cur, end: closeM, count: count });
        break;
      }
    }

    var issues = [];
    if (need && gaps.length) {
      for (var g = 0; g < Math.min(3, gaps.length); g++) {
        issues.push("Pharmacist gap: " + m2t(gaps[g].start) + "–" + m2t(gaps[g].end));
      }
      if (gaps.length > 3) issues.push("+" + (gaps.length - 3) + " more gap(s)");
    }

    return { ok: issues.length === 0, issues: issues, open: oh.open, close: oh.close, min: min };
  }

  function computeNearExpiry(entries, today) {
    entries = Array.isArray(entries) ? entries : [];
    var expired = [];
    var soon = [];

    var t = parseYmd(today) || new Date();
    var tTs = t.getTime();
    var t30 = addDays(t, 30).getTime();

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      var ex = safeStr(e.expiry_date);
      if (!ex) continue;
      var d = parseYmd(ex);
      if (!d) continue;
      var ts = d.getTime();
      if (ts < tTs) expired.push(e);
      else if (ts <= t30) soon.push(e);
    }

    expired.sort(function (a, b) { return safeStr(a.expiry_date) < safeStr(b.expiry_date) ? -1 : 1; });
    soon.sort(function (a, b) { return safeStr(a.expiry_date) < safeStr(b.expiry_date) ? -1 : 1; });

    return { expired: expired, soon: soon };
  }

  function computeInstructions(dailyMap, today, yesterday) {
    // API returns a keyed object: { "YYYY-MM-DD": { notes:"...", handover_out:[] } }
    dailyMap = (dailyMap && typeof dailyMap === "object") ? dailyMap : {};

    var t = dailyMap[today] || null;
    var y = dailyMap[yesterday] || null;

    var notes = t && safeStr(t.notes);
    var handover = (y && Array.isArray(y.handover_out)) ? y.handover_out : [];

    return { todayNotes: notes || "", yesterdayHandover: handover };
  }

  function computeReturns(entries) {
    entries = Array.isArray(entries) ? entries : [];
    var incomplete = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      var ok =
        truthy01(e.return_arranged) &&
        truthy01(e.handed_over) &&
        truthy01(e.collection_note_received) &&
        truthy01(e.credit_note_received);
      if (!ok) incomplete.push(e);
    }
    return { incomplete: incomplete };
  }

  // ----------------------------
  // Rendering
  // ----------------------------
  function renderAll() {
    var mount = state.mount;
    if (!mount) return;

    var today = todayYmd();

    function showNA(msg) { return pill("na", msg || "Unavailable"); }

    var todayList = q("#dash-today", mount);
    var attnList = q("#dash-attn", mount);
    var opsList = q("#dash-ops", mount);
    var meta = q("#dash-updated", mount);
    var refreshBtn = q('[data-action="dash-refresh"]', mount);

    if (meta) meta.textContent = state.lastUpdated ? ("Updated: " + state.lastUpdated) : "";
    if (refreshBtn) refreshBtn.disabled = !!state.loading;

    // --- Temperature ---
    var tempRow = "";
    if (!state.data.temp) tempRow = row("🌡", "Temperature (today)", "Loading…", pill("info", "…"), "");
    else if (!state.data.temp.ok) tempRow = row("🌡", "Temperature (today)", state.data.temp.error || "Unavailable", showNA("N/A"), btn("dash-open-temperature", "Open", { small: true }));
    else {
      var t = state.data.temp.data;
      if (!t.total) {
        tempRow = row("🌡", "Temperature (today)", "No active devices", pill("info", "Info"), btn("dash-open-temperature", "Open", { small: true }));
      } else if (!t.missing.length) {
        tempRow = row("🌡", "Temperature (today)", "All devices recorded", pill("ok", "OK"), btn("dash-open-temperature", "Open", { small: true }));
      } else {
        tempRow = row(
          "🌡",
          "Temperature (today)",
          t.missing.length + " missing / " + t.total + " devices",
          pill("danger", "Missing"),
          btn("dash-temp-quick", "Quick enter", { primary: true, small: true }) +
          btn("dash-open-temperature", "Open", { small: true })
        );
      }
    }

    // --- Daily Register ---
    var drRow = "";
    if (!state.data.dailyregister) drRow = row("📘", "Daily register (today)", "Loading…", pill("info", "…"), "");
    else if (!state.data.dailyregister.ok) drRow = row("📘", "Daily register (today)", state.data.dailyregister.error || "Unavailable", showNA("N/A"), btn("dash-open-dailyregister", "Open", { small: true }));
    else {
      var dr = state.data.dailyregister.data;
      if (dr.countToday > 0) {
        drRow = row("📘", "Daily register (today)", dr.countToday + " record(s) today", pill("ok", "OK"), btn("dash-open-dailyregister", "Open", { small: true }));
      } else {
        drRow = row(
          "📘",
          "Daily register (today)",
          "No record for " + today,
          pill("danger", "Missing"),
          btn("dash-dr-quick", "Quick enter", { primary: true, small: true }) +
          btn("dash-open-dailyregister", "Open", { small: true })
        );
      }
    }

    // --- Paid out today ---
    var poRow = "";
    if (!state.data.paidout) poRow = row("💸", "Paid out (today)", "Loading…", pill("info", "…"), "");
    else if (!state.data.paidout.ok) poRow = row("💸", "Paid out (today)", state.data.paidout.error || "Unavailable", showNA("N/A"), btn("dash-open-paidout", "Open", { small: true }));
    else {
      var po = state.data.paidout.data;
      poRow = row("💸", "Paid out (today)", moneyEUR(po.totalToday) + " total", pill("info", moneyEUR(po.totalToday)), btn("dash-open-paidout", "Open", { small: true }));
    }

    // --- Instructions (today + previous day handover) ---
    var insRow = "";
    if (!state.data.instructions) insRow = row("📝", "Instructions & handover", "Loading…", pill("info", "…"), "");
    else if (!state.data.instructions.ok) insRow = row("📝", "Instructions & handover", state.data.instructions.error || "Unavailable", showNA("N/A"), btn("dash-open-instructions", "Open", { small: true }));
    else {
      var ins = state.data.instructions.data;
      var hasNotes = !!safeStr(ins.todayNotes);
      var hasHandover = Array.isArray(ins.yesterdayHandover) && ins.yesterdayHandover.length > 0;
      if (!hasNotes && !hasHandover) {
        insRow = row("📝", "Instructions & handover", "No day-specific notes / handover", pill("ok", "OK"), btn("dash-open-instructions", "Open", { small: true }));
      } else {
        var sub = [];
        if (hasNotes) sub.push("Today: notes");
        if (hasHandover) sub.push("Prev day: " + ins.yesterdayHandover.length + " handover item(s)");
        insRow = row(
          "📝",
          "Instructions & handover",
          sub.join(" • "),
          pill("warn", "Review"),
          btn("dash-instructions-details", "View", { primary: true, small: true }) +
          btn("dash-open-instructions", "Open", { small: true })
        );
      }
    }

    // --- Cleaning 14 days ---
    var clRow = "";
    if (!state.data.cleaning) clRow = row("🧽", "Cleaning (14 days)", "Loading…", pill("info", "…"), "");
    else if (!state.data.cleaning.ok) clRow = row("🧽", "Cleaning (14 days)", state.data.cleaning.error || "Unavailable", showNA("N/A"), btn("dash-open-cleaning", "Open", { small: true }));
    else {
      var cl = state.data.cleaning.data;
      if (cl.hasRecent) {
        clRow = row("🧽", "Cleaning (14 days)", "Last record: " + (cl.lastDate || "—"), pill("ok", "OK"), btn("dash-open-cleaning", "Open", { small: true }));
      } else {
        clRow = row(
          "🧽",
          "Cleaning (14 days)",
          "No record since " + (cl.lastDate || "—"),
          pill("danger", "Overdue"),
          btn("dash-clean-quick", "Quick enter", { primary: true, small: true }) +
          btn("dash-open-cleaning", "Open", { small: true })
        );
      }
    }

    // --- Certificates ---
    var certRow = "";
    if (!state.data.certificates) certRow = row("📄", "Certificates (due/expired)", "Loading…", pill("info", "…"), "");
    else if (!state.data.certificates.ok) certRow = row("📄", "Certificates (due/expired)", state.data.certificates.error || "Unavailable", showNA("N/A"), btn("dash-open-certificates", "Open", { small: true }));
    else {
      var ce = state.data.certificates.data;
      var exN = ce.expired.length;
      var dueN = ce.dueSoon.length;
      if (exN === 0 && dueN === 0) {
        certRow = row("📄", "Certificates (due/expired)", "Nothing due in 30 days", pill("ok", "OK"), btn("dash-open-certificates", "Open", { small: true }));
      } else {
        var subc = [];
        if (exN) subc.push(exN + " expired");
        if (dueN) subc.push(dueN + " due ≤30d");
        certRow = row(
          "📄",
          "Certificates (due/expired)",
          subc.join(" • "),
          pill(exN ? "danger" : "warn", exN ? "Expired" : "Due soon"),
          btn("dash-cert-details", "Details", { primary: true, small: true }) +
          btn("dash-open-certificates", "Open", { small: true })
        );
      }
    }

    // --- Alerts ---
    var alRow = "";
    if (!state.data.alerts) alRow = row("🚨", "Alerts (incomplete)", "Loading…", pill("info", "…"), "");
    else if (!state.data.alerts.ok) alRow = row("🚨", "Alerts (incomplete)", state.data.alerts.error || "Unavailable", showNA("N/A"), btn("dash-open-alerts", "Open", { small: true }));
    else {
      var al = state.data.alerts.data;
      var n = al.incomplete.length;
      if (!n) alRow = row("🚨", "Alerts (incomplete)", "All alerts completed", pill("ok", "OK"), btn("dash-open-alerts", "Open", { small: true }));
      else {
        alRow = row(
          "🚨",
          "Alerts (incomplete)",
          n + " alert(s) need attention",
          pill("warn", "Action"),
          btn("dash-alerts-details", "Details", { primary: true, small: true }) +
          btn("dash-open-alerts", "Open", { small: true })
        );
      }
    }

    // --- Returns ---
    var rtRow = "";
    if (!state.data.returns) rtRow = row("↩️", "Returns (incomplete)", "Loading…", pill("info", "…"), "");
    else if (!state.data.returns.ok) rtRow = row("↩️", "Returns (incomplete)", state.data.returns.error || "Unavailable", showNA("N/A"), btn("dash-open-returns", "Open", { small: true }));
    else {
      var rr = state.data.returns.data;
      var rn = rr.incomplete.length;
      if (!rn) rtRow = row("↩️", "Returns (incomplete)", "All returns completed (recent months)", pill("ok", "OK"), btn("dash-open-returns", "Open", { small: true }));
      else {
        rtRow = row(
          "↩️",
          "Returns (incomplete)",
          rn + " return(s) need checkboxes (recent months)",
          pill("warn", "Action"),
          btn("dash-returns-details", "Details", { primary: true, small: true }) +
          btn("dash-open-returns", "Open", { small: true })
        );
      }
    }

    // --- Near expiry ---
    var neRow = "";
    if (!state.data.nearexpiry) neRow = row("⏳", "Near expiry", "Loading…", pill("info", "…"), "");
    else if (!state.data.nearexpiry.ok) neRow = row("⏳", "Near expiry", state.data.nearexpiry.error || "Unavailable", showNA("N/A"), btn("dash-open-nearexpiry", "Open", { small: true }));
    else {
      var nx = state.data.nearexpiry.data;
      var ex = nx.expired.length;
      var so = nx.soon.length;
      if (!ex && !so) {
        neRow = row("⏳", "Near expiry", "No expired / due ≤30d items", pill("ok", "OK"), btn("dash-open-nearexpiry", "Open", { small: true }));
      } else {
        var subn = [];
        if (ex) subn.push(ex + " expired");
        if (so) subn.push(so + " due ≤30d");
        neRow = row(
          "⏳",
          "Near expiry",
          subn.join(" • "),
          pill(ex ? "danger" : "warn", ex ? "Expired" : "Due soon"),
          btn("dash-ne-details", "Details", { primary: true, small: true }) +
          btn("dash-open-nearexpiry", "Open", { small: true })
        );
      }
    }

    // --- Shifts coverage ---
    var shRow = "";
    if (!state.data.shifts) shRow = row("📅", "Shifts (coverage)", "Loading…", pill("info", "…"), "");
    else if (!state.data.shifts.ok) shRow = row("📅", "Shifts (coverage)", state.data.shifts.error || "Unavailable", showNA("N/A"), btn("dash-open-shifts", "Open", { small: true }));
    else {
      var sh = state.data.shifts.data;
      var cn = sh.issueDays.length;
      if (!cn) {
        shRow = row("📅", "Shifts (coverage)", "No pharmacist coverage warnings (this & next month)", pill("ok", "OK"), btn("dash-open-shifts", "Open", { small: true }));
      } else {
        shRow = row(
          "📅",
          "Shifts (coverage)",
          cn + " day(s) with pharmacist coverage issue",
          pill("danger", "Warning"),
          btn("dash-shifts-details", "Details", { primary: true, small: true }) +
          btn("dash-open-shifts", "Open", { small: true })
        );
      }
    }

    // --- Client orders ---
    var coRow = "";
    if (!state.data.clientorders) coRow = row("🧾", "Client orders (active)", "Loading…", pill("info", "…"), "");
    else if (!state.data.clientorders.ok) coRow = row("🧾", "Client orders (active)", state.data.clientorders.error || "Unavailable", showNA("N/A"), btn("dash-open-clientorders", "Open", { small: true }));
    else {
      var co = state.data.clientorders.data;
      if (!co.activeCount) {
        coRow = row("🧾", "Client orders (active)", "No active orders (recent months)", pill("ok", "OK"), btn("dash-open-clientorders", "Open", { small: true }));
      } else {
        coRow = row("🧾", "Client orders (active)", co.activeCount + " active order(s) (recent months)", pill("warn", "Review"), btn("dash-open-clientorders", "Open", { primary: true, small: true }));
      }
    }

    // --- Tickets ---
    var tkRow = "";
    if (!state.data.tickets) tkRow = row("🎫", "Client tickets (open)", "Loading…", pill("info", "…"), "");
    else if (!state.data.tickets.ok) tkRow = row("🎫", "Client tickets (open)", state.data.tickets.error || "Unavailable", showNA("N/A"), btn("dash-open-tickets", "Open", { small: true }));
    else {
      var tk = state.data.tickets.data;
      if (!tk.openCount) {
        tkRow = row("🎫", "Client tickets (open)", "No open tickets", pill("ok", "OK"), btn("dash-open-tickets", "Open", { small: true }));
      } else {
        tkRow = row("🎫", "Client tickets (open)", tk.openCount + " open ticket(s)", pill("warn", "Action"), btn("dash-open-tickets", "Open", { primary: true, small: true }));
      }
    }

    if (todayList) todayList.innerHTML = tempRow + drRow + poRow + insRow;
    if (attnList) attnList.innerHTML = clRow + certRow + alRow + rtRow + neRow;
    if (opsList) opsList.innerHTML = shRow + coRow + tkRow;
  }

  // ----------------------------
  // Incremental refresh (PARALLEL)
  // ----------------------------
  function setResult(token, key, ok, dataOrErr) {
    if (token !== state.refreshToken) return; // stale refresh

    if (ok) {
      state.data[key] = { ok: true, data: dataOrErr };
    } else {
      var msg = String(dataOrErr || "Error");
      state.data[key] = { ok: false, error: msg };
      dlog("warn", ["#" + token, key, "error:", msg]);
    }

    renderAll();
  }

  async function refreshAll(opts) {
    opts = opts || {};
    var force = !!opts.force;
    if (state.loading && !force) {
      dlog("warn", ["refreshAll skipped (already loading)."]);
      return;
    }

    state.loading = true;
    state.lastUpdated = "";
    state.refreshToken++;
    var token = state.refreshToken;

    setLoadingPlaceholders();
    renderAll();

    var tYmd = todayYmd();
    var tYm = todayYm();
    var yYmd = ymdAdd(tYmd, -1);
    var yYm = ymFromDate(parseYmd(yYmd) || new Date());

    // Diagnostics
    state.diag = { token: token, startedAt: Date.now(), startedIso: dashNowIso(), tasks: {} };
    dgroup("[dash] refresh #" + token + " " + (state.diag.startedIso || ""), function () {
      dlog("log", ["today=", tYmd, "month=", tYm, "force=", force, "debug=", DASH_DEBUG]);
    });

    // Build recent months list (light scan)
    function recentMonths(n) {
      n = parseInt(n, 10) || 6;
      var months = [];
      var base = parseYm(tYm) || new Date();
      base = new Date(base.getFullYear(), base.getMonth(), 1);
      for (var i = 0; i < n; i++) {
        var d = new Date(base.getFullYear(), base.getMonth() - i, 1);
        months.push(ymFromDate(d));
      }
      return months;
    }

    // Task runner
    var tasks = [];

    function run(key, fn) {
      var started = Date.now();
      if (state.diag && state.diag.tasks) state.diag.tasks[key] = { status: "running", startedAt: started };

      dlog("dbg", ["#" + token, key, "start"]);

      var p = (async function () {
        try {
          var out = await fn();
          var ms = Date.now() - started;
          if (state.diag && state.diag.tasks && state.diag.tasks[key]) {
            state.diag.tasks[key].status = "ok";
            state.diag.tasks[key].ms = ms;
          }
          dlog("dbg", ["#" + token, key, "ok", ms + "ms"]);
          setResult(token, key, true, out);
        } catch (e) {
          var ms2 = Date.now() - started;
          var emsg = String(e && (e.message || e.bodyText || e) || "Error");
          if (state.diag && state.diag.tasks && state.diag.tasks[key]) {
            state.diag.tasks[key].status = "error";
            state.diag.tasks[key].ms = ms2;
            state.diag.tasks[key].error = emsg;
          }
          dlog("warn", ["#" + token, key, "fail", ms2 + "ms", emsg]);
          setResult(token, key, false, emsg);
        }
      })();

      tasks.push(p);
      return p;
    }

    // --- TODAY (high priority) ---
    run("temp", async function () {
      var dev = await api("/temperature/devices?include_inactive=1", { method: "GET" }, 7000, "temperature devices");
      var ent = await api("/temperature/entries?month=" + encodeURIComponent(tYm), { method: "GET" }, 7000, "temperature entries");
      var devices = (dev && dev.devices) ? dev.devices : [];
      var entries = (ent && ent.entries) ? ent.entries : [];
      return computeTemperature(devices, entries, tYmd);
    });

    run("dailyregister", async function () {
      var r = await api("/daily-register/entries?month=" + encodeURIComponent(tYm), { method: "GET" }, 7000, "daily register");
      var ent = (r && r.entries) ? r.entries : [];
      return computeDailyRegister(ent, tYmd);
    });

    run("paidout", async function () {
      var r = await api("/paid-out/entries?month=" + encodeURIComponent(tYm) + "&_ts=" + Date.now(), { method: "GET" }, 7000, "paid out");
      if (!r || r.ok !== true) throw new Error((r && r.error) ? r.error : "Failed to load paid out entries");
      var ent = Array.isArray(r.entries) ? r.entries : [];
      var total = 0;
      for (var i = 0; i < ent.length; i++) {
        var e = ent[i] || {};
        if (safeStr(e.entry_date) !== tYmd) continue;
        var v = Number(e.amount != null ? e.amount : e.fee);
        if (isFinite(v)) total += v;
      }
      return { totalToday: total };
    });

    run("instructions", async function () {
      // Merge current month and (if needed) previous-month daily map.
      // Primary format: { ok:true, daily: { "YYYY-MM-DD": { notes:"", handover_out:[] } } }
      function toDailyMap(resp) {
        if (resp && resp.daily && typeof resp.daily === "object") return resp.daily;
        // Back-compat: accept array forms if ever returned
        var out = {};
        var arr = (resp && (resp.records || resp.entries));
        if (Array.isArray(arr)) {
          for (var i = 0; i < arr.length; i++) {
            var r = arr[i] || {};
            var ds = safeStr(r.ymd || r.entry_date || r.date);
            if (!ds) continue;
            out[ds] = r;
          }
        }
        return out;
      }

      var r1 = await api("/instructions/daily?month=" + encodeURIComponent(tYm), { method: "GET" }, 7000, "instructions month");
      if (!r1 || r1.ok !== true) throw new Error((r1 && r1.error) ? r1.error : "Failed to load instructions");

      var dailyMap = Object.assign({}, toDailyMap(r1));

      if (yYm !== tYm) {
        var r2 = await api("/instructions/daily?month=" + encodeURIComponent(yYm), { method: "GET" }, 7000, "instructions prev month");
        if (r2 && r2.ok === true) Object.assign(dailyMap, toDailyMap(r2));
      }

      return computeInstructions(dailyMap, tYmd, yYmd);
    });

    // --- ATTENTION ---
    run("cleaning", async function () {
      var months = [tYm];
      var td = parseYmd(tYmd) || new Date();
      if ((td.getDate() || 1) <= 14) {
        var prev = new Date(td.getFullYear(), td.getMonth() - 1, 1);
        months.push(ymFromDate(prev));
      }
      var reqs = months.map(function (m) {
        return api("/cleaning/entries?month=" + encodeURIComponent(m), { method: "GET" }, 7000, "cleaning " + m);
      });
      var res = await Promise.all(reqs);
      var all = [];
      for (var i = 0; i < res.length; i++) all = all.concat((res[i] && res[i].entries) ? res[i].entries : []);
      return computeCleaning(all, tYmd);
    });

    run("certificates", async function () {
      var r = await api("/certificates/items", { method: "GET" }, 7000, "certificates");
      if (!r || r.ok !== true) throw new Error((r && r.error) ? r.error : "Failed to load certificates");
      return computeCertificates(r.items || [], tYmd);
    });

    run("alerts", async function () {
      var r = await api("/alerts/entries?ts=" + Date.now(), { method: "GET" }, 8000, "alerts");
      var ent = (r && r.entries) ? r.entries : [];
      return computeAlerts(ent);
    });

    run("nearexpiry", async function () {
      var r = await api("/near-expiry/entries", { method: "GET" }, 9000, "near expiry");
      var ent = (r && r.entries) ? r.entries : [];
      return computeNearExpiry(ent, tYmd);
    });

    run("returns", async function () {
      var months = recentMonths(6);
      var reqs = months.map(function (m) {
        return api("/returns/entries?month=" + encodeURIComponent(m), { method: "GET" }, 8000, "returns " + m);
      });
      var res = await Promise.all(reqs);
      var all = [];
      for (var i = 0; i < res.length; i++) all = all.concat((res[i] && res[i].entries) ? res[i].entries : []);
      return computeReturns(all);
    });

    // --- OPERATIONS ---
    run("clientorders", async function () {
      var months = recentMonths(6);
      var reqs = months.map(function (m) {
        return api("/client-orders/entries?month=" + encodeURIComponent(m), { method: "GET" }, 8000, "client orders " + m);
      });
      var res = await Promise.all(reqs);

      var active = 0;
      for (var i = 0; i < res.length; i++) {
        var ent = (res[i] && res[i].entries) ? res[i].entries : [];
        for (var j = 0; j < ent.length; j++) {
          var e = ent[j] || {};
          if (!truthy01(e.fulfilled)) active++;
        }
      }

      return { activeCount: active, monthsScanned: months };
    });

    run("tickets", async function () {
      var r = await api("/client-tickets/entries?_ts=" + Date.now(), { method: "GET" }, 8000, "client tickets");
      var ent = Array.isArray(r) ? r : ((r && Array.isArray(r.entries)) ? r.entries : []);
      var open = 0;
      for (var i = 0; i < ent.length; i++) {
        var e = ent[i] || {};
        var resolved = truthy01(e.resolved) || String(e.status || "").toLowerCase() === "resolved";
        if (!resolved) open++;
      }
      return { openCount: open };
    });

    run("shifts", async function () {
      var now = new Date();
      var year1 = now.getFullYear();
      var month1 = now.getMonth() + 1;
      var next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      var year2 = next.getFullYear();
      var month2 = next.getMonth() + 1;

      var staffP = api("/shifts/staff?include_inactive=1", { method: "GET" }, 8000, "shifts staff");
      var hoursP = api("/shifts/opening-hours", { method: "GET" }, 8000, "opening hours");
      var setP = api("/shifts/settings", { method: "GET" }, 8000, "shifts settings");
      var leavesP1 = api("/shifts/leaves?year=" + encodeURIComponent(String(year1)), { method: "GET" }, 8000, "leaves " + year1);
      var leavesP2 = (year2 === year1) ? Promise.resolve({ ok: true, leaves: [] }) : api("/shifts/leaves?year=" + encodeURIComponent(String(year2)), { method: "GET" }, 8000, "leaves " + year2);

      var assP1 = api("/shifts/assignments?year=" + encodeURIComponent(String(year1)) + "&month=" + encodeURIComponent(String(month1)), { method: "GET" }, 9000, "assignments " + year1 + "-" + month1);
      var assP2 = api("/shifts/assignments?year=" + encodeURIComponent(String(year2)) + "&month=" + encodeURIComponent(String(month2)), { method: "GET" }, 9000, "assignments " + year2 + "-" + month2);

      var out = await Promise.all([staffP, hoursP, setP, leavesP1, leavesP2, assP1, assP2]);

      var staffResp = out[0], hoursResp = out[1], setResp = out[2], l1 = out[3], l2 = out[4], a1 = out[5], a2 = out[6];

      var payload = {
        staff: (staffResp && staffResp.staff) ? staffResp.staff : [],
        openingHours: (hoursResp && hoursResp.hours) ? hoursResp.hours : {},
        settings: (setResp && setResp.settings) ? setResp.settings : {},
        leaves: []
          .concat((l1 && l1.leaves) ? l1.leaves : [])
          .concat((l2 && l2.leaves) ? l2.leaves : []),
        shifts: []
          .concat((a1 && a1.shifts) ? a1.shifts : [])
          .concat((a2 && a2.shifts) ? a2.shifts : [])
      };

      var fromD = new Date(now.getFullYear(), now.getMonth(), 1);
      var toD = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      var from = ymdFromDate(fromD);
      var to = ymdFromDate(toD);

      var issueDays = [];
      var cur = parseYmd(from);
      var end = parseYmd(to);
      while (cur && end && cur.getTime() <= end.getTime()) {
        var ds = ymdFromDate(cur);
        var cov = checkCoverage(ds, payload);
        if (cov && cov.ok === false) issueDays.push({ ymd: ds, issues: cov.issues || [] });
        cur = addDays(cur, 1);
      }

      return { issueDays: issueDays, from: from, to: to };
    });

    Promise.allSettled(tasks).then(function () {
      if (token !== state.refreshToken) return;
      state.loading = false;
      if (state.diag && state.diag.token === token) {
        state.diag.finishedAt = Date.now();
        state.diag.totalMs = state.diag.finishedAt - (state.diag.startedAt || state.diag.finishedAt);
      }
      dlog("log", ["#" + token, "refresh done", (state.diag && state.diag.totalMs != null) ? (state.diag.totalMs + "ms") : ""]);

      try {
        var now = new Date();
        state.lastUpdated = pad2(now.getHours()) + ":" + pad2(now.getMinutes());
      } catch (e) {
        state.lastUpdated = "";
      }
      renderAll();
    });
  }

  // ----------------------------
  // Modals (Quick entry + Details)
  // ----------------------------
  function showError(title, msg) {
    E.modal.show(title || "Error", '<div class="eikon-alert">' + esc(msg || "Something went wrong") + "</div>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
  }

  function openTempQuickModal() {
    var t = state.data.temp && state.data.temp.ok ? state.data.temp.data : null;
    if (!t) return showError("Temperature", "Temperature data not available yet. Please refresh.");

    var missing = Array.isArray(t.missing) ? t.missing : [];
    var today = todayYmd();

    if (!missing.length) {
      E.modal.show("Temperature (today)", '<div class="eikon-help">All devices already have an entry for ' + esc(today) + ".</div>", [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    var rows = "";
    for (var i = 0; i < missing.length; i++) {
      var d = missing[i] || {};
      var id = String(d.id || "");
      var name = String(d.name || ("Device " + id));

      rows +=
        "<tr>" +
          "<td>" + esc(name) + "</td>" +
          '<td><input class="eikon-input" style="min-width:110px" id="dash-tmin-' + esc(id) + '" placeholder="min" /></td>' +
          '<td><input class="eikon-input" style="min-width:110px" id="dash-tmax-' + esc(id) + '" placeholder="max" /></td>' +
          '<td><input class="eikon-input" style="min-width:160px" id="dash-tnote-' + esc(id) + '" placeholder="notes (optional)" /></td>' +
        "</tr>";
    }

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Quick enter missing temperatures for <b>' + esc(today) + "</b>.</div>" +
        '<div class="eikon-help">This will create entries for the missing devices only.</div>' +
        '<table class="eikon-dash-mini-table" aria-label="Temperature quick entry">' +
          "<thead><tr><th>Device</th><th>Min</th><th>Max</th><th>Notes</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
      "</div>";

    E.modal.show("Temperature — Quick entry", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: async function () {
          try {
            for (var j = 0; j < missing.length; j++) {
              var dev = missing[j] || {};
              var did = String(dev.id || "");
              var minEl = document.getElementById("dash-tmin-" + did);
              var maxEl = document.getElementById("dash-tmax-" + did);
              var noteEl = document.getElementById("dash-tnote-" + did);

              var minV = Number((minEl && minEl.value || "").trim());
              var maxV = Number((maxEl && maxEl.value || "").trim());
              var notes = (noteEl && noteEl.value || "").trim();

              if (!isFinite(minV) || !isFinite(maxV)) throw new Error("Please enter valid Min/Max for all devices.");

              await api("/temperature/entries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  device_id: dev.id,
                  entry_date: today,
                  min_temp: minV,
                  max_temp: maxV,
                  notes: notes
                })
              }, 8000, "temperature save");
            }

            E.modal.hide();
            E.showToast && E.showToast("Temperature saved");
            refreshAll();
          } catch (e) {
            showError("Temperature save failed", String(e && (e.message || e.bodyText || e) || "Error"));
          }
        }
      }
    ]);
  }

  function openCleaningQuickModal() {
    var today = todayYmd();
    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Quick add a cleaning record (saves to the Cleaning module).</div>' +
        '<div class="eikon-row" style="margin-top:10px">' +
          '<div class="eikon-field"><div class="eikon-label">Date</div><input class="eikon-input" id="dash-cl-date" value="' + esc(today) + '" /></div>' +
          '<div class="eikon-field"><div class="eikon-label">Time in</div><input class="eikon-input" id="dash-cl-in" placeholder="HH:MM" /></div>' +
          '<div class="eikon-field"><div class="eikon-label">Time out</div><input class="eikon-input" id="dash-cl-out" placeholder="HH:MM" /></div>' +
        "</div>" +
        '<div class="eikon-row" style="margin-top:10px">' +
          '<div class="eikon-field"><div class="eikon-label">Cleaner name</div><input class="eikon-input" id="dash-cl-cleaner" placeholder="Name" /></div>' +
          '<div class="eikon-field"><div class="eikon-label">Staff name</div><input class="eikon-input" id="dash-cl-staff" placeholder="Name" /></div>' +
        "</div>" +
        '<div class="eikon-field" style="margin-top:10px">' +
          '<div class="eikon-label">Notes</div><input class="eikon-input" id="dash-cl-notes" placeholder="Optional" style="min-width:260px" />' +
        "</div>" +
      "</div>";

    E.modal.show("Cleaning — Quick entry", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: async function () {
          try {
            var payload = {
              entry_date: (document.getElementById("dash-cl-date").value || "").trim(),
              time_in: (document.getElementById("dash-cl-in").value || "").trim(),
              time_out: (document.getElementById("dash-cl-out").value || "").trim(),
              cleaner_name: (document.getElementById("dash-cl-cleaner").value || "").trim(),
              staff_name: (document.getElementById("dash-cl-staff").value || "").trim(),
              notes: (document.getElementById("dash-cl-notes").value || "").trim()
            };

            if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.entry_date)) throw new Error("Invalid date. Use YYYY-MM-DD.");

            await api("/cleaning/entries", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            }, 8000, "cleaning save");

            E.modal.hide();
            E.showToast && E.showToast("Cleaning saved");
            refreshAll();
          } catch (e) {
            showError("Cleaning save failed", String(e && (e.message || e.bodyText || e) || "Error"));
          }
        }
      }
    ]);
  }

  function openDailyRegisterQuickModal() {
    var today = todayYmd();

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Quick add a Daily Register record for today.</div>' +
        '<div class="eikon-row" style="margin-top:10px">' +
          '<div class="eikon-field"><div class="eikon-label">Date</div><input class="eikon-input" id="dash-dr-date" value="' + esc(today) + '" /></div>' +
          '<div class="eikon-field"><div class="eikon-label">Client name</div><input class="eikon-input" id="dash-dr-client" placeholder="Client" /></div>' +
          '<div class="eikon-field"><div class="eikon-label">Client ID</div><input class="eikon-input" id="dash-dr-clientid" placeholder="ID" /></div>' +
        "</div>" +
        '<div class="eikon-row" style="margin-top:10px">' +
          '<div class="eikon-field" style="flex:1 1 260px"><div class="eikon-label">Medicine name & dose</div><input class="eikon-input" id="dash-dr-med" placeholder="Medicine" style="min-width:260px" /></div>' +
          '<div class="eikon-field" style="flex:1 1 260px"><div class="eikon-label">Posology</div><input class="eikon-input" id="dash-dr-pos" placeholder="Posology" style="min-width:260px" /></div>' +
        "</div>" +
        '<div class="eikon-row" style="margin-top:10px">' +
          '<div class="eikon-field" style="flex:1 1 260px"><div class="eikon-label">Prescriber name</div><input class="eikon-input" id="dash-dr-presc" placeholder="Prescriber" style="min-width:260px" /></div>' +
          '<div class="eikon-field"><div class="eikon-label">Prescriber reg no</div><input class="eikon-input" id="dash-dr-reg" placeholder="Reg no" /></div>' +
        "</div>" +
      "</div>";

    E.modal.show("Daily Register — Quick entry", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: async function () {
          try {
            var payload = {
              entry_date: (document.getElementById("dash-dr-date").value || "").trim(),
              client_name: (document.getElementById("dash-dr-client").value || "").trim(),
              client_id: (document.getElementById("dash-dr-clientid").value || "").trim(),
              medicine_name_dose: (document.getElementById("dash-dr-med").value || "").trim(),
              posology: (document.getElementById("dash-dr-pos").value || "").trim(),
              prescriber_name: (document.getElementById("dash-dr-presc").value || "").trim(),
              prescriber_reg_no: (document.getElementById("dash-dr-reg").value || "").trim()
            };

            if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.entry_date)) throw new Error("Invalid date. Use YYYY-MM-DD.");
            if (!payload.client_name) throw new Error("Client name is required.");
            if (!payload.medicine_name_dose) throw new Error("Medicine name & dose is required.");
            if (!payload.posology) throw new Error("Posology is required.");
            if (!payload.prescriber_name) throw new Error("Prescriber name is required.");
            if (!payload.prescriber_reg_no) throw new Error("Prescriber reg no is required.");

            await api("/daily-register/entries", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            }, 8000, "daily register save");

            E.modal.hide();
            E.showToast && E.showToast("Daily register saved");
            refreshAll();
          } catch (e) {
            showError("Daily register save failed", String(e && (e.message || e.bodyText || e) || "Error"));
          }
        }
      }
    ]);
  }

  function showCertDetails() {
    var ce = state.data.certificates && state.data.certificates.ok ? state.data.certificates.data : null;
    if (!ce) return showError("Certificates", "Certificates data not available.");

    function nameOf(it) { return safeStr(it.title || it.name || it.certificate_name || ("Item #" + (it.id || ""))) || "Certificate"; }

    var rows = "";
    var i;
    for (i = 0; i < ce.expired.length; i++) rows += "<tr><td>" + esc(nameOf(ce.expired[i])) + "</td><td>" + esc(safeStr(ce.expired[i].next_due)) + "</td><td><b>Expired</b></td></tr>";
    for (i = 0; i < ce.dueSoon.length; i++) rows += "<tr><td>" + esc(nameOf(ce.dueSoon[i])) + "</td><td>" + esc(safeStr(ce.dueSoon[i].next_due)) + "</td><td>Due ≤30d</td></tr>";

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Expired or due within 30 days.</div>' +
        '<table class="eikon-dash-mini-table">' +
          "<thead><tr><th>Certificate</th><th>Next due</th><th>Status</th></tr></thead>" +
          "<tbody>" + (rows || "<tr><td colspan='3'>No items.</td></tr>") + "</tbody>" +
        "</table>" +
      "</div>";

    E.modal.show("Certificates — Details", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#certificates"; } }
    ]);
  }

  function showAlertsDetails() {
    var al = state.data.alerts && state.data.alerts.ok ? state.data.alerts.data : null;
    if (!al) return showError("Alerts", "Alerts data not available.");

    var list = al.incomplete || [];
    var keys = [
      ["team_informed", "Team"],
      ["supplier_informed", "Supplier"],
      ["authorities_informed", "Authorities"],
      ["return_arranged", "Return"],
      ["handed_over", "Handover"],
      ["collection_note_received", "Collection note"],
      ["credit_note_received", "Credit note"]
    ];

    function labelOf(r) { return safeStr(r.title || r.product_name || r.description || r.item || r.notes || "") || ("Alert #" + (r.id || "")); }
    function dateOf(r) { return safeStr(r.alert_date || r.entry_date || r.date || r.created_at || ""); }
    function missingOf(r) {
      var miss = [];
      for (var i = 0; i < keys.length; i++) if (!truthy01(r[keys[i][0]])) miss.push(keys[i][1]);
      return miss.join(", ");
    }

    var rows = "";
    for (var i = 0; i < Math.min(25, list.length); i++) rows += "<tr><td>" + esc(dateOf(list[i])) + "</td><td>" + esc(labelOf(list[i])) + "</td><td>" + esc(missingOf(list[i])) + "</td></tr>";
    if (!rows) rows = "<tr><td colspan='3'>No incomplete alerts.</td></tr>";

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Showing up to 25 incomplete alerts.</div>' +
        '<table class="eikon-dash-mini-table">' +
          "<thead><tr><th>Date</th><th>Alert</th><th>Missing</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
      "</div>";

    E.modal.show("Alerts — Incomplete", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#alerts"; } }
    ]);
  }

  function showReturnsDetails() {
    var rr = state.data.returns && state.data.returns.ok ? state.data.returns.data : null;
    if (!rr) return showError("Returns", "Returns data not available.");

    var list = rr.incomplete || [];

    function labelOf(r) { return safeStr(r.description || r.item_name || r.product || r.supplier || "") || ("Return #" + (r.id || "")); }
    function dateOf(r) { return safeStr(r.entry_date || r.date || r.created_at || ""); }
    function missingOf(r) {
      var miss = [];
      if (!truthy01(r.return_arranged)) miss.push("Return arranged");
      if (!truthy01(r.handed_over)) miss.push("Handed over");
      if (!truthy01(r.collection_note_received)) miss.push("Collection note");
      if (!truthy01(r.credit_note_received)) miss.push("Credit note");
      return miss.join(", ");
    }

    var rows = "";
    for (var i = 0; i < Math.min(25, list.length); i++) rows += "<tr><td>" + esc(dateOf(list[i])) + "</td><td>" + esc(labelOf(list[i])) + "</td><td>" + esc(missingOf(list[i])) + "</td></tr>";
    if (!rows) rows = "<tr><td colspan='3'>No incomplete returns.</td></tr>";

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Showing up to 25 incomplete returns.</div>' +
        '<table class="eikon-dash-mini-table">' +
          "<thead><tr><th>Date</th><th>Return</th><th>Missing</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
      "</div>";

    E.modal.show("Returns — Incomplete", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#returns"; } }
    ]);
  }

  function showNearExpiryDetails() {
    var nx = state.data.nearexpiry && state.data.nearexpiry.ok ? state.data.nearexpiry.data : null;
    if (!nx) return showError("Near expiry", "Near expiry data not available.");

    function labelOf(r) { return safeStr(r.item_name || r.product_name || r.name || r.description || r.sku || "") || ("Item #" + (r.id || "")); }

    var rows = "";
    var i;
    for (i = 0; i < Math.min(15, nx.expired.length); i++) rows += "<tr><td>" + esc(labelOf(nx.expired[i])) + "</td><td>" + esc(safeStr(nx.expired[i].expiry_date)) + "</td><td><b>Expired</b></td></tr>";
    for (i = 0; i < Math.min(15, nx.soon.length); i++) rows += "<tr><td>" + esc(labelOf(nx.soon[i])) + "</td><td>" + esc(safeStr(nx.soon[i].expiry_date)) + "</td><td>Due ≤30d</td></tr>";
    if (!rows) rows = "<tr><td colspan='3'>No items.</td></tr>";

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Showing up to 30 items total (15 expired + 15 due ≤30d).</div>' +
        '<table class="eikon-dash-mini-table">' +
          "<thead><tr><th>Item</th><th>Expiry</th><th>Status</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
      "</div>";

    E.modal.show("Near expiry — Details", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#nearexpiry"; } }
    ]);
  }

  function showShiftsDetails() {
    var sh = state.data.shifts && state.data.shifts.ok ? state.data.shifts.data : null;
    if (!sh) return showError("Shifts", "Shifts data not available.");

    var list = sh.issueDays || [];
    var rows = "";
    for (var i = 0; i < Math.min(31, list.length); i++) rows += "<tr><td>" + esc(list[i].ymd) + "</td><td>" + esc((list[i].issues || []).join(" | ") || "Coverage issue") + "</td></tr>";
    if (!rows) rows = "<tr><td colspan='2'>No issues found.</td></tr>";

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Coverage issues from <b>' + esc(sh.from || "") + "</b> to <b>" + esc(sh.to || "") + "</b>. (Showing up to 31 days)</div>" +
        '<table class="eikon-dash-mini-table">' +
          "<thead><tr><th>Date</th><th>Issue</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
      "</div>";

    E.modal.show("Shifts — Coverage issues", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#shifts"; } }
    ]);
  }

  function showInstructionsDetails() {
    var ins = state.data.instructions && state.data.instructions.ok ? state.data.instructions.data : null;
    if (!ins) return showError("Instructions", "Instructions data not available.");

    var today = todayYmd();
    var yday = ymdAdd(today, -1);

    var notes = safeStr(ins.todayNotes);
    var ho = Array.isArray(ins.yesterdayHandover) ? ins.yesterdayHandover : [];

    var listHtml = "";
    if (ho.length) {
      listHtml += "<ul>";
      for (var i = 0; i < Math.min(20, ho.length); i++) {
        var it = ho[i] || {};
        var sev = safeStr(it.sev || it.severity || "");
        var txt = safeStr(it.text || it.note || it.message || "");
        var line = (sev ? ("[" + sev + "] ") : "") + (txt || ("Item #" + (it.id || "")));
        listHtml += "<li>" + esc(line) + "</li>";
      }
      if (ho.length > 20) listHtml += "<li>+" + (ho.length - 20) + " more…</li>";
      listHtml += "</ul>";
    } else {
      listHtml += '<div class="eikon-help" style="margin-top:10px">No handover items.</div>';
    }

    var body =
      '<div class="eikon-dash-detail">' +
        '<div><b>Today (' + esc(today) + ") — Day specific instructions</b></div>" +
        (notes ? ('<div style="margin-top:8px;white-space:pre-wrap">' + esc(notes) + "</div>") : '<div class="eikon-help" style="margin-top:6px">No notes for today.</div>') +
        '<div style="margin-top:14px"><b>Previous day (' + esc(yday) + ") — Handover from previous day</b></div>" +
        listHtml +
      "</div>";

    E.modal.show("Instructions & handover", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#instructions"; } }
    ]);
  }

  function showDiagnostics() {
    try {
      var d = state.diag || null;
      if (!d) return showError("Diagnostics", "No diagnostics available yet. Click Refresh and try again.");

      var tasks = d.tasks || {};
      var keys = Object.keys(tasks);
      keys.sort();

      var rows = "";
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var t = tasks[k] || {};
        var st = t.status || "—";
        var ms = (t.ms != null) ? (String(t.ms) + "ms") : "";
        var err = t.error ? String(t.error) : "";
        rows += "<tr><td>" + esc(k) + "</td><td>" + esc(st) + "</td><td>" + esc(ms) + "</td><td>" + esc(err) + "</td></tr>";
      }
      if (!rows) rows = "<tr><td colspan='4'>No task data.</td></tr>";

      var body =
        '<div class="eikon-dash-detail">' +
          '<div class="eikon-help">Refresh #' + esc(d.token) + " • started " + esc(d.startedIso || "") + "</div>" +
          '<div class="eikon-help">Tip: use dbg=2 for verbose API logs. (Example: add <b>?dbg=2</b> to the iframe URL)</div>' +
          '<table class="eikon-dash-mini-table">' +
            "<thead><tr><th>Section</th><th>Status</th><th>Time</th><th>Last error</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>";

      E.modal.show("Dashboard diagnostics", body, [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
    } catch (e) {
      showError("Diagnostics", String(e && (e.message || e) || "Error"));
    }
  }

  // ----------------------------
  // Click handler
  // ----------------------------
  function handleClick(e) {
    var t = e.target;
    if (!t) return;

    var btnEl = t.closest ? t.closest("[data-action]") : null;
    if (!btnEl) return;

    var act = btnEl.getAttribute("data-action") || "";
    if (!act) return;

    if (act === "dash-refresh") return refreshAll();

    if (act === "dash-diag") return showDiagnostics();

    if (act === "dash-temp-quick") return openTempQuickModal();
    if (act === "dash-clean-quick") return openCleaningQuickModal();
    if (act === "dash-dr-quick") return openDailyRegisterQuickModal();

    if (act === "dash-cert-details") return showCertDetails();
    if (act === "dash-alerts-details") return showAlertsDetails();
    if (act === "dash-returns-details") return showReturnsDetails();
    if (act === "dash-ne-details") return showNearExpiryDetails();
    if (act === "dash-shifts-details") return showShiftsDetails();
    if (act === "dash-instructions-details") return showInstructionsDetails();

    if (act === "dash-open-temperature") window.location.hash = "#temperature";
    else if (act === "dash-open-cleaning") window.location.hash = "#cleaning";
    else if (act === "dash-open-dailyregister") window.location.hash = "#dailyregister";
    else if (act === "dash-open-certificates") window.location.hash = "#certificates";
    else if (act === "dash-open-alerts") window.location.hash = "#alerts";
    else if (act === "dash-open-shifts") window.location.hash = "#shifts";
    else if (act === "dash-open-clientorders") window.location.hash = "#clientorders";
    else if (act === "dash-open-tickets") window.location.hash = "#tickets";
    else if (act === "dash-open-returns") window.location.hash = "#returns";
    else if (act === "dash-open-paidout") window.location.hash = "#paidout";
    else if (act === "dash-open-nearexpiry") window.location.hash = "#nearexpiry";
    else if (act === "dash-open-instructions") window.location.hash = "#instructions";
  }

  // ----------------------------
  // Render
  // ----------------------------
  async function render(ctx) {
    injectCssOnce();

    var mount = ctx && ctx.mount ? ctx.mount : null;
    if (!mount) return;

    state.mount = mount;

    mount.innerHTML =
      '<div class="eikon-dash">' +
        '<div class="eikon-dash-top">' +
          '<div class="eikon-dash-title">Dashboard</div>' +
          '<div class="eikon-dash-meta">' +
            '<span class="eikon-help" id="dash-updated"></span>' +
            btn("dash-refresh", "Refresh", { small: true, title: "Refresh all dashboard checks" }) +
            (DASH_DEBUG >= 1 ? btn("dash-diag", "Diag", { small: true, title: "Dashboard diagnostics" }) : "") +
          "</div>" +
        "</div>" +

        '<div class="eikon-dash-grid">' +
          '<div class="eikon-card eikon-dash-card">' +
            '<div class="eikon-dash-card-title">Today</div>' +
            '<div class="eikon-dash-list" id="dash-today"></div>' +
          "</div>" +

          '<div class="eikon-card eikon-dash-card">' +
            '<div class="eikon-dash-card-title">Attention</div>' +
            '<div class="eikon-dash-list" id="dash-attn"></div>' +
          "</div>" +

          '<div class="eikon-card eikon-dash-card eikon-dash-card-wide">' +
            '<div class="eikon-dash-card-title">Operations</div>' +
            '<div class="eikon-dash-list" id="dash-ops"></div>' +
          "</div>" +
        "</div>" +
      "</div>";

    // bind only once per mount
    if (!mount.__eikonDashBound) {
      mount.addEventListener("click", handleClick);
      mount.__eikonDashBound = true;
    }

    // ✅ BUG 1 FIX: do NOT set loading=true here (refreshAll would bail out)
    state.loading = false; // ensure refreshAll() can run (avoid deadlock)
    setLoadingPlaceholders();
    state.lastUpdated = "";
    renderAll();

    refreshAll({ force: true });
  }

  // Register module (order 1)
  E.registerModule({
    id: "dashboard",
    title: "Dashboard",
    order: 1,
    icon: "📊",
    render: render
  });

})();
