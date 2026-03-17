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

  function dashToast(kind, msg) {
    var el = document.createElement("div");
    el.className = "od-toast od-toast-" + kind;
    el.innerHTML = msg;
    document.body.appendChild(el);
    setTimeout(function () {
      el.classList.add("od-toast-exit");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
    }, 4000);
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
      "@media (max-width:520px){.eikon-dash-sub{max-width:78vw}.eikon-dash-right{gap:6px}.eikon-dash-btn{padding:7px 9px}}" +
      "@keyframes eikon-dash-flash{0%,100%{border-color:rgba(255,90,122,.55);box-shadow:0 0 8px rgba(255,90,122,.25)}50%{border-color:rgba(255,90,122,.15);box-shadow:none}}" +
      ".eikon-dash-item-flash{animation:eikon-dash-flash 1s ease-in-out infinite}" +
      /* --- OTC Cross Sell widget --- */
      ".eikon-dash-xsell{position:relative}" +
      ".eikon-dash-xsell-search{position:relative;margin-bottom:10px}" +
      ".eikon-dash-xsell-search input{width:100%;padding:9px 14px 9px 34px;border:1px solid var(--border);background:rgba(0,0,0,.28);color:var(--text);border-radius:10px;font-size:13px;outline:none}" +
      ".eikon-dash-xsell-search input:focus{border-color:var(--accent)}" +
      ".eikon-dash-xsell-search .xsell-ico{position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:13px;pointer-events:none;opacity:.5}" +
      ".eikon-dash-xsell-dd{position:absolute;top:100%;left:0;right:0;margin-top:4px;background:#1a2640;border:1px solid rgba(255,255,255,.16);border-radius:10px;max-height:220px;overflow-y:auto;box-shadow:0 12px 36px rgba(0,0,0,.5);z-index:120;display:none}" +
      ".eikon-dash-xsell-dd.open{display:block}" +
      ".xsell-dd-item{padding:10px 14px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;transition:background .08s}" +
      ".xsell-dd-item:hover,.xsell-dd-item.hl{background:rgba(46,229,157,.18);border-left-color:#2ee59d;color:#fff}" +
      ".xsell-dd-item .xdd-type{font-size:10px;padding:2px 7px;border-radius:6px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;flex-shrink:0}" +
      ".xsell-dd-item .xdd-type.product{background:rgba(46,229,157,.15);color:#6af0be}" +
      ".xsell-dd-item .xdd-type.symptom{background:rgba(255,204,102,.15);color:#ffcc66}" +
      ".xsell-dd-item .xdd-type.usecase{background:rgba(185,142,255,.15);color:#d9c4ff}" +
      ".xsell-dd-item .xdd-type.bundle{background:rgba(36,215,215,.15);color:#baf3ff}" +
      ".eikon-dash-xsell-selected{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(46,229,157,.3);border-radius:12px;background:rgba(46,229,157,.06);margin-bottom:10px}" +
      ".eikon-dash-xsell-selected .xs-name{flex:1;font-size:13px;font-weight:800;color:#6af0be}" +
      ".eikon-dash-xsell-selected .xs-clear{background:none;border:1px solid rgba(255,255,255,.12);color:var(--muted);width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:14px}" +
      ".eikon-dash-xsell-selected .xs-clear:hover{background:rgba(255,255,255,.08);color:#fff}" +
      /* --- Cross Sell modal (reuses mindmap look) --- */
      ".xsell-modal-overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s}" +
      ".xsell-modal-overlay.open{opacity:1;pointer-events:auto}" +
      ".xsell-modal{width:620px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:linear-gradient(170deg,#1a2640,#111a2c);box-shadow:0 24px 64px rgba(0,0,0,.6);color:var(--text)}" +
      ".xsell-modal-hd{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.1)}" +
      ".xsell-modal-hd h3{margin:0;font-size:15px;font-weight:900;flex:1;color:#6af0be}" +
      ".xsell-modal-close{background:none;border:1px solid rgba(255,255,255,.1);color:rgba(170,183,214,.72);width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}" +
      ".xsell-modal-close:hover{background:rgba(255,255,255,.08);color:#fff}" +
      ".xsell-modal-body{padding:16px 20px;overflow-y:auto;flex:1}" +
      ".xsell-section{margin-bottom:16px}" +
      ".xsell-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:rgba(170,183,214,.72);margin-bottom:8px}" +
      ".xsell-chips{display:flex;flex-wrap:wrap;gap:6px}" +
      ".xsell-chip{padding:6px 12px;border:1px solid rgba(255,255,255,.16);border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.03);color:rgba(170,183,214,.72);transition:all .12s}" +
      ".xsell-chip:hover{background:rgba(255,204,102,.1);border-color:rgba(255,204,102,.3)}" +
      ".xsell-chip.active{background:rgba(255,204,102,.18);border-color:#ffcc66;color:#ffe6a0}" +
      ".xsell-comp-list{display:flex;flex-direction:column;gap:4px;max-height:480px;overflow-y:auto}" +
      ".xsell-comp-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.04);cursor:pointer;transition:background .12s,border-color .12s}" +
      ".xsell-comp-row:hover{background:rgba(46,229,157,.08);border-color:rgba(46,229,157,.3)}" +
      ".xsell-comp-row .xc-score{font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(46,229,157,.15);color:#6af0be;flex-shrink:0}" +
      ".xsell-comp-row .xc-name{flex:1;font-size:13px;font-weight:700;color:#dbe7ff}" +
      ".xsell-comp-row .xc-reason{font-size:11px;color:rgba(170,183,214,.72);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".xsell-comp-empty{padding:24px;text-align:center;color:rgba(170,183,214,.72);font-size:12px}" +
      ".xsell-group{border:1px solid rgba(255,255,255,.08);border-radius:10px}" +
      ".xsell-group-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:rgba(255,255,255,.03);transition:background .1s}" +
      ".xsell-group-hd:hover{background:rgba(255,255,255,.06)}" +
      ".xsell-group-hd .xg-arrow{font-size:9px;color:rgba(170,183,214,.5);transition:transform .15s}" +
      ".xsell-group-hd .xg-arrow.open{transform:rotate(90deg)}" +
      ".xsell-group-hd .xg-brand{font-size:13px;font-weight:800;color:#6af0be;flex:1}" +
      ".xsell-group-hd .xg-count{font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.06);color:rgba(170,183,214,.72)}" +
      ".xsell-group-hd .xg-score{font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(46,229,157,.15);color:#6af0be}" +
      ".xsell-group-bd{max-height:0;overflow:hidden;padding:0 8px;transition:max-height .25s ease,padding .25s ease}" +
      ".xsell-group-bd.open{max-height:2000px;overflow:visible;padding:4px 8px 8px}" +
      ".xsell-group-bd .xsell-comp-row{border-radius:8px;padding:8px 10px}" +
      ".xsell-sibling-list{display:flex;flex-direction:column;gap:4px;max-height:480px;overflow-y:auto}" +
      ".xsell-sib-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.04);cursor:pointer;transition:background .12s,border-color .12s}" +
      ".xsell-sib-row:hover{background:rgba(255,204,102,.08);border-color:rgba(255,204,102,.3)}" +
      ".xsell-sib-row .xs-score{font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(255,204,102,.15);color:#ffcc66;flex-shrink:0}" +
      ".xsell-sib-row .xs-name{flex:1;font-size:13px;font-weight:700;color:#dbe7ff}" +
      ".xsell-sib-row .xs-symptom{font-size:11px;color:rgba(170,183,214,.72);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}";
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
      instructions: null,
      scarcestock: null,
      stocktransfers: null,
      board: null,
      supplierChanges: null,
      supplierOrders: null
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
    state.data.scarcestock = null;
    state.data.stocktransfers = null;
    state.data.board = null;
    state.data.supplierChanges = null;
    state.data.supplierOrders = null;
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
  function boolVal(v, dflt) {
    if (v == null) return !!dflt;
    // allow explicit false-ish values to override defaults
    if (v === false || v === 0 || v === "0" || String(v).toLowerCase() === "false" || String(v).toLowerCase() === "no") return false;
    return truthy01(v);
  }

  // Malta public holidays (default CLOSED unless explicitly opened via an override)
  var PH = [
    "2026-01-01","2026-02-10","2026-03-19","2026-03-31",
    "2026-05-01","2026-06-07","2026-06-29","2026-08-15",
    "2026-09-08","2026-09-21","2026-12-08","2026-12-13","2026-12-25",
    "2025-01-01","2025-02-10","2025-03-19","2025-04-18",
    "2025-05-01","2025-06-07","2025-06-29","2025-08-15",
    "2025-09-08","2025-09-21","2025-12-08","2025-12-13","2025-12-25"
  ];
  function isPH(d) { return PH.indexOf(safeStr(d)) >= 0; }

  function normalizeOpeningHoursForCov(hours) {
    hours = (hours && typeof hours === "object") ? hours : {};
    if (!hours["default"]) hours["default"] = { open: "07:30", close: "19:30", closed: false };
    if (!hours.overrides) hours.overrides = {};

    // Legacy weekend flags
    if (typeof hours.weekends === "boolean") {
      if (hours.openSaturday == null) hours.openSaturday = hours.weekends;
      if (hours.openSunday == null) hours.openSunday = hours.weekends;
    }
    if (hours.openSaturday == null) hours.openSaturday = true;
    if (hours.openSunday == null) hours.openSunday = false;

    var def = hours["default"] || { open: "07:30", close: "19:30", closed: false };

    // New structure: weekly hours by day-of-week (0=Sun..6=Sat)
    if (!hours.weekly || typeof hours.weekly !== "object") {
      hours.weekly = {};
      for (var d = 0; d < 7; d++) {
        hours.weekly[d] = {
          open: safeStr(def.open || "07:30"),
          close: safeStr(def.close || "19:30"),
          closed: boolVal(def.closed, false)
        };
      }
      if (hours.openSaturday === false) hours.weekly[6].closed = true;
      if (hours.openSunday === false) hours.weekly[0].closed = true;
    } else {
      // Normalize weekly entries (support string keys)
      var wk = {};
      for (var d2 = 0; d2 < 7; d2++) {
        var e = hours.weekly[d2] || hours.weekly[String(d2)] || {};
        wk[d2] = {
          open: safeStr(e.open || def.open || "07:30"),
          close: safeStr(e.close || def.close || "19:30"),
          closed: (e.closed == null) ? boolVal(def.closed, false) : boolVal(e.closed, false),
          note: e.note
        };
      }
      hours.weekly = wk;
    }

    // Keep legacy flags aligned (older code may rely on these)
    hours.openSaturday = !hours.weekly[6].closed;
    hours.openSunday = !hours.weekly[0].closed;
    if (hours.weekends == null) hours.weekends = (hours.openSaturday && hours.openSunday);

    // Ensure default mirrors Monday (helps older UI assumptions)
    hours["default"] = Object.assign({}, hours.weekly[1] || def);

    return hours;
  }

  function ohFor(ds, hours) {
    hours = normalizeOpeningHoursForCov(hours || {});
    ds = safeStr(ds);

    // Explicit day override always wins (including exceptional openings on normally-closed days)
    var ovr = (hours.overrides && hours.overrides[ds]) ? hours.overrides[ds] : null;
    if (ovr) {
      return {
        open: safeStr(ovr.open || ""),
        close: safeStr(ovr.close || ""),
        closed: (ovr.closed == null) ? false : boolVal(ovr.closed, false),
        note: safeStr(ovr.note || ovr.type || "")
      };
    }

    // Public Holiday: default CLOSED unless explicitly opened via an override
    if (isPH(ds)) return { open: "", close: "", closed: true, note: "Public Holiday (default closed)" };

    var wd = 0;
    try { wd = new Date(ds + "T00:00:00").getDay(); } catch (e) {}

    var base = (hours.weekly && (hours.weekly[wd] || hours.weekly[String(wd)])) || hours["default"] || { open: "07:30", close: "19:30", closed: false };
    return {
      open: safeStr(base.open || "07:30"),
      close: safeStr(base.close || "19:30"),
      closed: boolVal(base.closed, false),
      note: base.note
    };
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
      // Skip items already handed over (picked up by supplier)
      if (safeStr(e.return_status) === "handed_over") continue;
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
    if (!state.data.alerts) alRow = row("🚨", "Alerts", "Loading…", pill("info", "…"), "");
    else if (!state.data.alerts.ok) alRow = row("🚨", "Alerts", state.data.alerts.error || "Unavailable", showNA("N/A"), btn("dash-open-alerts", "Open", { small: true }));
    else {
      var al = state.data.alerts.data;
      var n = al.incomplete.length;
      if (!n) alRow = row("🚨", "Alerts", "All alerts completed", pill("ok", "OK"), btn("dash-open-alerts", "Open", { small: true }));
      else {
        alRow = row(
          "🚨",
          "Alerts",
          n + " alert(s) need attention",
          pill("warn", "Action"),
          btn("dash-alerts-details", "Details", { primary: true, small: true }) +
          btn("dash-open-alerts", "Open", { small: true })
        );
      }
    }

    // --- Returns ---
    var rtRow = "";
    if (!state.data.returns) rtRow = row("↩️", "Returns", "Loading…", pill("info", "…"), "");
    else if (!state.data.returns.ok) rtRow = row("↩️", "Returns", state.data.returns.error || "Unavailable", showNA("N/A"), btn("dash-open-returns", "Open", { small: true }));
    else {
      var rr = state.data.returns.data;
      var rn = rr.incomplete.length;
      if (!rn) rtRow = row("↩️", "Returns", "All returns completed (recent months)", pill("ok", "OK"), btn("dash-open-returns", "Open", { small: true }));
      else {
        rtRow = row(
          "↩️",
          "Returns",
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

    // --- Scarce Stock (requested from other locations) ---
    var ssRow = "";
    if (!state.data.scarcestock) ssRow = row("📦", "Scarce stock requests", "Loading…", pill("info", "…"), "");
    else if (!state.data.scarcestock.ok) ssRow = row("📦", "Scarce stock requests", state.data.scarcestock.error || "Unavailable", showNA("N/A"), btn("dash-open-scarcestock", "Open", { small: true }));
    else {
      var ss = state.data.scarcestock.data;
      var ssOpenNeeds = ss.openNeeds || 0;
      var ssUnaccepted = ss.unacceptedOffers || 0;

      if (!ssOpenNeeds && !ssUnaccepted) {
        ssRow = row("📦", "Scarce stock requests", "No open requests from other locations", pill("ok", "OK"), btn("dash-open-scarcestock", "Open", { small: true }));
      } else {
        var ssSub = [];
        if (ssOpenNeeds) ssSub.push(ssOpenNeeds + " open request(s)");
        if (ssUnaccepted) ssSub.push(ssUnaccepted + " offer(s) to review");
        ssRow = '<div class="eikon-dash-item' + (ssUnaccepted ? " eikon-dash-item-flash" : "") + '">' +
          '<div class="eikon-dash-left">' +
            '<div class="eikon-dash-ico" aria-hidden="true">📦</div>' +
            '<div class="eikon-dash-txt">' +
              '<div class="eikon-dash-label">Scarce stock requests</div>' +
              '<div class="eikon-dash-sub">' + esc(ssSub.join(" • ")) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="eikon-dash-right">' +
            pill(ssUnaccepted ? "danger" : "warn", ssUnaccepted ? "Offers pending" : "Open") +
            btn("dash-open-scarcestock", "Open", { primary: true, small: true }) +
          '</div>' +
        '</div>';
      }
    }

    // --- Stock Transfers ---
    var stRow = "";
    if (!state.data.stocktransfers) stRow = row("🔄", "Stock transfers", "Loading…", pill("info", "…"), "");
    else if (!state.data.stocktransfers.ok) stRow = row("🔄", "Stock transfers", state.data.stocktransfers.error || "Unavailable", showNA("N/A"), btn("dash-open-stocktransfers", "Open", { small: true }));
    else {
      var st = state.data.stocktransfers.data;
      var stPending = st.pendingRequests || 0;
      var stUnconfirmed = st.unconfirmedDeliveries || 0;
      var stTotal = stPending + stUnconfirmed;

      if (!stTotal) {
        stRow = row("🔄", "Stock transfers", "No pending transfers", pill("ok", "OK"), btn("dash-open-stocktransfers", "Open", { small: true }));
      } else {
        var stSub = [];
        if (stPending) stSub.push(stPending + " pending request(s)");
        if (stUnconfirmed) stSub.push(stUnconfirmed + " awaiting delivery confirmation");
        stRow = '<div class="eikon-dash-item eikon-dash-item-flash">' +
          '<div class="eikon-dash-left">' +
            '<div class="eikon-dash-ico" aria-hidden="true">🔄</div>' +
            '<div class="eikon-dash-txt">' +
              '<div class="eikon-dash-label">Stock transfers</div>' +
              '<div class="eikon-dash-sub">' + esc(stSub.join(" • ")) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="eikon-dash-right">' +
            pill("danger", "Action needed") +
            btn("dash-open-stocktransfers", "Open", { primary: true, small: true }) +
          '</div>' +
        '</div>';
      }
    }

    // --- Chat Board ---
    var boardRow = "";
    if (!state.data.board) boardRow = row("\uD83D\uDCAC", "Chat Board", "Loading\u2026", pill("info", "\u2026"), "");
    else if (!state.data.board.ok) boardRow = row("\uD83D\uDCAC", "Chat Board", state.data.board.error || "Unavailable", showNA("N/A"), btn("dash-open-messageboard", "Open", { small: true }));
    else {
      var bd = state.data.board.data;
      var boardSub = [];
      if (bd.unread > 0) boardSub.push(bd.unread + " unread mention" + (bd.unread > 1 ? "s" : ""));
      if (bd.unread_messages > 0) boardSub.push(bd.unread_messages + " unread message" + (bd.unread_messages > 1 ? "s" : ""));
      if (bd.recent && bd.recent.length > 0) {
        var latest = bd.recent[0];
        var preview = String(latest.body || "").substring(0, 60);
        if (String(latest.body || "").length > 60) preview += "\u2026";
        boardSub.push(esc(latest.user_name) + ": " + esc(preview));
      }
      if (!boardSub.length) boardSub.push("No recent messages");

      if (bd.unread > 0) {
        // Flash when user has unread mentions (same pattern as scarce stock / stock transfers)
        boardRow = '<div class="eikon-dash-item eikon-dash-item-flash">' +
          '<div class="eikon-dash-left">' +
            '<div class="eikon-dash-ico" aria-hidden="true">\uD83D\uDCAC</div>' +
            '<div class="eikon-dash-txt">' +
              '<div class="eikon-dash-label">Chat Board</div>' +
              '<div class="eikon-dash-sub">' + esc(boardSub.join(" \u2022 ")) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="eikon-dash-right">' +
            pill("danger", bd.unread + " mention" + (bd.unread > 1 ? "s" : "")) +
            btn("dash-open-messageboard", "Open", { primary: true, small: true }) +
          '</div>' +
        '</div>';
      } else {
        var boardPill = bd.unread_messages > 0 ? pill("warn", bd.unread_messages + " new") : pill("ok", "OK");
        boardRow = row("\uD83D\uDCAC", "Chat Board", boardSub.join(" \u2022 "), boardPill,
          btn("dash-open-messageboard", "Open", { primary: bd.unread_messages > 0, small: true }));
      }
    }

    // --- Supplier Updates (Attention section) ---
    var supChgRow = "";
    if (!state.data.supplierChanges) supChgRow = row("\uD83D\uDE9A", "Supplier Updates", "Loading\u2026", pill("info", "\u2026"), "");
    else if (!state.data.supplierChanges.ok) supChgRow = row("\uD83D\uDE9A", "Supplier Updates", state.data.supplierChanges.error || "Unavailable", showNA("N/A"), btn("dash-open-supplier-inventory", "Open", { small: true }));
    else {
      var sc = state.data.supplierChanges.data;
      var scEntries = sc.entries || [];
      // Filter unseen for this location
      var myLocId = Number((E.state.user || {}).location_id);
      var unseen = scEntries.filter(function (ch) {
        try { var seen = JSON.parse(ch.seen_by || "[]"); return !seen.includes(myLocId); } catch (e) { return true; }
      });
      if (unseen.length > 0) {
        var deduped = dedupeStockChanges(unseen);
        var oosCount = deduped.filter(function (c) { return c.change_type === "out_of_stock" || c.change_type === "removed"; }).length;
        var bisCount = deduped.filter(function (c) { return c.change_type === "back_in_stock"; }).length;
        var scSub = [];
        if (oosCount) scSub.push(oosCount + " out of stock");
        if (bisCount) scSub.push(bisCount + " back/new");
        supChgRow = row("\uD83D\uDE9A", "Supplier Updates", scSub.join(", ") || (unseen.length + " changes"),
          pill("warn", unseen.length + " update" + (unseen.length !== 1 ? "s" : "")),
          btn("dash-supplier-changes-details", "Details", { primary: true, small: true }) + btn("dash-open-supplier-inventory", "View", { small: true }));

        // Toast for stock changes (use deduplicated data)
        var supGroups = {};
        deduped.forEach(function (ch) {
          var sn = ch.supplier_name || "Unknown";
          if (!supGroups[sn]) supGroups[sn] = { oos: 0, bis: 0 };
          if (ch.change_type === "out_of_stock" || ch.change_type === "removed") supGroups[sn].oos++;
          else supGroups[sn].bis++;
        });
        for (var sgk in supGroups) {
          if (Object.prototype.hasOwnProperty.call(supGroups, sgk)) {
            var sg = supGroups[sgk];
            var parts = [];
            if (sg.oos) parts.push(sg.oos + " out of stock");
            if (sg.bis) parts.push(sg.bis + " back in stock");
            dashToast("info", esc(sgk) + ": " + parts.join(", "));
          }
        }
      } else {
        supChgRow = row("\uD83D\uDE9A", "Supplier Updates", "No recent changes", pill("ok", "OK"),
          btn("dash-open-supplier-inventory", "Open", { small: true }));
      }
    }

    // --- Supplier Orders (Operations section) ---
    var supOrdRow = "";
    if (!state.data.supplierOrders) supOrdRow = row("\uD83D\uDCE6", "Supplier Orders", "Loading\u2026", pill("info", "\u2026"), "");
    else if (!state.data.supplierOrders.ok) supOrdRow = row("\uD83D\uDCE6", "Supplier Orders", state.data.supplierOrders.error || "Unavailable", showNA("N/A"), btn("dash-open-supplier-inventory-orders", "Open", { small: true }));
    else {
      var so = state.data.supplierOrders.data;
      var soEntries = so.entries || [];
      var soPending = soEntries.filter(function (o) { return o.status === "pending"; }).length;
      var soShipped = soEntries.filter(function (o) { return o.status === "shipped"; }).length;
      if (soPending > 0 || soShipped > 0) {
        var soSub = [];
        if (soPending) soSub.push(soPending + " pending");
        if (soShipped) soSub.push(soShipped + " shipped");
        supOrdRow = row("\uD83D\uDCE6", "Supplier Orders", soSub.join(", "),
          pill("warn", (soPending + soShipped) + " active"),
          btn("dash-open-supplier-inventory-orders", "View", { primary: true, small: true }));
      } else {
        supOrdRow = row("\uD83D\uDCE6", "Supplier Orders", "All orders received", pill("ok", "OK"),
          btn("dash-open-supplier-inventory-orders", "Open", { small: true }));
      }
    }

    if (todayList) todayList.innerHTML = tempRow + drRow + poRow + insRow + boardRow;
    if (attnList) attnList.innerHTML = clRow + certRow + alRow + rtRow + neRow + ssRow + stRow + supChgRow;
    if (opsList) opsList.innerHTML = shRow + coRow + tkRow + supOrdRow;
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

    run("scarcestock", async function () {
      var r = await api("/scarce-stock/needs?ts=" + Date.now(), { method: "GET" }, 8000, "scarce stock needs");
      var needs = (r && r.needs) ? r.needs : [];

      var openNeeds = 0;
      var unacceptedOffers = 0;

      for (var i = 0; i < needs.length; i++) {
        var need = needs[i] || {};
        // Only show needs from OTHER locations (not our own)
        if (need.mine_owner) {
          // This is our request — check for offers we haven't accepted
          var offers = Array.isArray(need.offers) ? need.offers : [];
          for (var j = 0; j < offers.length; j++) {
            var off = offers[j] || {};
            if (!off.accepted && !off.confirmed && !off.is_private) {
              unacceptedOffers++;
            }
          }
        }
        if (!need.mine_owner && !need.is_closed) {
          openNeeds++;
        }
      }

      return { openNeeds: openNeeds, unacceptedOffers: unacceptedOffers };
    });

    run("stocktransfers", async function () {
      var r = await api("/stock-transfers/items?ts=" + Date.now(), { method: "GET" }, 8000, "stock transfers");
      var items = (r && r.items) ? r.items : [];

      var pendingRequests = 0;
      var unconfirmedDeliveries = 0;

      for (var i = 0; i < items.length; i++) {
        var item = items[i] || {};
        var requests = Array.isArray(item.requests) ? item.requests : [];
        for (var j = 0; j < requests.length; j++) {
          var req = requests[j] || {};
          var status = safeStr(req.status).toLowerCase();
          // Pending requests on items I own (need my acceptance)
          if (item.mine_owner && status === "pending") pendingRequests++;
          // Dispatched items I requested (need my delivery confirmation)
          if (req.mine && status === "dispatched") unconfirmedDeliveries++;
        }
      }

      return { pendingRequests: pendingRequests, unconfirmedDeliveries: unconfirmedDeliveries };
    });

    run("board", async function () {
      var r = await api("/board/dashboard", { method: "GET" }, 6000, "board");
      if (!r || r.ok !== true) throw new Error((r && r.error) ? r.error : "Failed");
      return { unread: r.unread_mentions || 0, unread_messages: r.unread_messages || 0, recent: r.recent_messages || [], mentions: r.recent_mentions || [] };
    });

    run("supplierChanges", async function () {
      var since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      var r = await api("/supplier-products/changes?since=" + encodeURIComponent(since), { method: "GET" }, 5000, "supplier changes");
      return { entries: (r && r.entries) ? r.entries : [] };
    });

    run("supplierOrders", async function () {
      var r = await api("/supplier-orders/sent?status=pending,shipped", { method: "GET" }, 5000, "supplier orders");
      return { entries: (r && r.entries) ? r.entries : [] };
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
        '<div style="max-height:420px;overflow-y:auto;">' +
          '<table class="eikon-dash-mini-table">' +
            "<thead><tr><th>Certificate</th><th>Next due</th><th>Status</th></tr></thead>" +
            "<tbody>" + (rows || "<tr><td colspan='3'>No items.</td></tr>") + "</tbody>" +
          "</table>" +
        "</div>" +
      "</div>";

    E.modal.show("Certificates — Details", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#certificates"; } }
    ]);
  }

  function dedupeStockChanges(unseen) {
    var byKey = {};
    unseen.forEach(function (ch) {
      var key = (ch.product_description || "").toLowerCase().trim() + "||" + (ch.supplier_name || "").toLowerCase().trim();
      if (!byKey[key] || ch.created_at > byKey[key].created_at) {
        byKey[key] = ch;
      }
    });
    var result = [];
    for (var k in byKey) {
      if (Object.prototype.hasOwnProperty.call(byKey, k)) {
        if (byKey[k].change_type !== "added") result.push(byKey[k]);
      }
    }
    return result;
  }

  function showSupplierChangesDetails() {
    var sc = state.data.supplierChanges && state.data.supplierChanges.ok ? state.data.supplierChanges.data : null;
    if (!sc) return showError("Supplier Updates", "Supplier changes data not available.");

    var scEntries = sc.entries || [];
    var myLocId = Number((E.state.user || {}).location_id);
    var unseen = scEntries.filter(function (ch) {
      try { var seen = JSON.parse(ch.seen_by || "[]"); return !seen.includes(myLocId); } catch (e) { return true; }
    });

    var deduped = dedupeStockChanges(unseen);
    var rows = "";
    for (var i = 0; i < deduped.length; i++) {
      var ch = deduped[i];
      var statusLabel = ch.change_type === "out_of_stock" ? "Out of Stock" :
        ch.change_type === "back_in_stock" ? "Back in Stock" :
        ch.change_type === "removed" ? "Removed" : ch.change_type;
      var statusColor = (ch.change_type === "out_of_stock" || ch.change_type === "removed") ? "#ff5a7a" : "#43d17a";
      var timeStr = ch.created_at ? new Date(ch.created_at + "Z").toLocaleString() : "";
      rows += "<tr>" +
        "<td>" + esc(ch.product_description || "") + "</td>" +
        "<td>" + esc(ch.supplier_name || "") + "</td>" +
        "<td style='color:" + statusColor + ";font-weight:600;'>" + esc(statusLabel) + "</td>" +
        "<td style='color:rgba(233,238,247,.5);'>" + esc(timeStr) + "</td>" +
      "</tr>";
    }

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">' + deduped.length + ' product' + (deduped.length !== 1 ? 's' : '') + ' with stock changes.</div>' +
        '<div style="max-height:300px;overflow-y:auto;">' +
          '<table class="eikon-dash-mini-table">' +
            "<thead><tr><th>Product</th><th>Supplier</th><th>Status</th><th>Time</th></tr></thead>" +
            "<tbody>" + (rows || "<tr><td colspan='4'>No changes.</td></tr>") + "</tbody>" +
          "</table>" +
        "</div>" +
      "</div>";

    E.modal.show("Supplier Updates \u2014 Details", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#supplier-inventory"; } }
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
        '<div style="max-height:420px;overflow-y:auto;">' +
          '<table class="eikon-dash-mini-table">' +
            "<thead><tr><th>Date</th><th>Alert</th><th>Missing</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>" +
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
        '<div style="max-height:420px;overflow-y:auto;">' +
          '<table class="eikon-dash-mini-table">' +
            "<thead><tr><th>Date</th><th>Return</th><th>Missing</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>" +
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

    function actionHtml(item) {
      var rs = safeStr(item.return_status || "");
      if (rs === "refused") return '<span style="font-size:11px;opacity:.55;font-weight:800;">Supplier refused</span>';
      if (rs === "pending") return '<span style="font-size:11px;color:var(--ok,green);font-weight:800;">Return pending</span>';
      if (rs === "handed_over") return '<span style="font-size:11px;color:var(--ok,green);font-weight:800;">Returned</span>';
      return '<button class="eikon-btn" data-dash-ne-return="' + esc(String(item.id || "")) + '" style="font-size:11px;padding:4px 10px;">Return</button>';
    }

    function stockActionHtml(item, isExpired) {
      if (item.scarce_stock_offer_id) return '<span style="font-size:11px;color:var(--ok,green);font-weight:800;">In Stock</span>';
      if (isExpired) return '<span style="font-size:11px;opacity:.4;">Expired</span>';
      if (item.damaged) return '<span style="font-size:11px;opacity:.4;">Damaged</span>';
      return '<button class="eikon-btn" data-dash-ne-stock="' + esc(String(item.id || "")) + '" ' +
        'data-name="' + esc(safeStr(item.product_name || item.item_name || item.name || "")) + '" ' +
        'data-expiry="' + esc(safeStr(item.expiry_date || "")) + '" ' +
        'style="font-size:11px;padding:4px 10px;">Add to Scarce Stock</button>';
    }

    var rows = "";
    var i;
    for (i = 0; i < Math.min(15, nx.expired.length); i++) rows += "<tr><td>" + esc(labelOf(nx.expired[i])) + "</td><td>" + esc(safeStr(nx.expired[i].expiry_date)) + "</td><td><b>Expired</b></td><td>" + actionHtml(nx.expired[i]) + "</td><td>" + stockActionHtml(nx.expired[i], true) + "</td></tr>";
    for (i = 0; i < Math.min(15, nx.soon.length); i++) rows += "<tr><td>" + esc(labelOf(nx.soon[i])) + "</td><td>" + esc(safeStr(nx.soon[i].expiry_date)) + "</td><td>Due ≤30d</td><td>" + actionHtml(nx.soon[i]) + "</td><td>" + stockActionHtml(nx.soon[i], false) + "</td></tr>";
    if (!rows) rows = "<tr><td colspan='5'>No items.</td></tr>";

    var body =
      '<div class="eikon-dash-detail">' +
        '<div class="eikon-help">Showing up to 30 items total (15 expired + 15 due ≤30d).</div>' +
        '<div style="max-height:420px;overflow-y:auto;">' +
          '<table class="eikon-dash-mini-table">' +
            "<thead><tr><th>Item</th><th>Expiry</th><th>Status</th><th>Return</th><th>Scarce Stock</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>" +
      "</div>";

    E.modal.show("Near expiry — Details", body, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      { label: "Open module", primary: true, onClick: function () { E.modal.hide(); window.location.hash = "#nearexpiry"; } }
    ]);

    // Wire return buttons in the modal
    setTimeout(function () {
      var btns = document.querySelectorAll("[data-dash-ne-return]");
      for (var b = 0; b < btns.length; b++) {
        (function (btn) {
          btn.addEventListener("click", function () {
            var neId = Number(btn.getAttribute("data-dash-ne-return"));
            if (!neId) return;
            showDashNearExpiryReturnModal(neId, btn);
          });
        })(btns[b]);
      }

      // Wire stock buttons
      var stockBtns = document.querySelectorAll("[data-dash-ne-stock]");
      for (var s = 0; s < stockBtns.length; s++) {
        (function (btn) {
          btn.addEventListener("click", function () {
            var neId = Number(btn.getAttribute("data-dash-ne-stock"));
            var name = btn.getAttribute("data-name") || "";
            var expiry = btn.getAttribute("data-expiry") || "";
            if (!neId) return;
            showDashAddToStockModal(neId, name, expiry, btn);
          });
        })(stockBtns[s]);
      }
    }, 50);
  }

  function showDashNearExpiryReturnModal(neId, btn) {
    var supplierHtml =
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<div style="flex:1;min-width:200px;">' +
          '<div class="eikon-label">Supplier (optional)</div>' +
          '<input id="dash-ne-ret-supplier" class="eikon-input" placeholder="e.g. Supplier name" />' +
        '</div>' +
        '<div style="min-width:120px;">' +
          '<div class="eikon-label">Quantity (optional)</div>' +
          '<input id="dash-ne-ret-qty" class="eikon-input" placeholder="e.g. 10" />' +
        '</div>' +
      '</div>' +
      '<div class="eikon-help" style="color:var(--muted);">This will create a return entry in the Returns module.</div>';

    E.modal.show("Create Return", supplierHtml, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Create Return",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var supplier = String((document.getElementById("dash-ne-ret-supplier") || {}).value || "").trim();
              var qty = String((document.getElementById("dash-ne-ret-qty") || {}).value || "").trim();
              var j = await api("/near-expiry/entries/create-return", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ near_expiry_id: neId, supplier: supplier, quantity: qty })
              }, 10000, "dash-ne-create-return");

              if (!j || !j.ok) throw new Error((j && j.error) || "Failed");

              E.modal.hide();
              E.showToast && E.showToast("Return created");

              // Refresh dashboard data so the change is visible immediately
              refreshAll({ force: true });
            } catch (ex) {
              E.modal.show("Return failed", "<div style='color:var(--danger);white-space:pre-wrap;'>" + esc((ex && (ex.message || ex.error)) || String(ex)) + "</div>", [
                { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          })();
        }
      }
    ]);
  }

  function showDashAddToStockModal(neId, name, expiry, btn) {
    var html =
      '<div style="margin-bottom:12px;">' +
        '<div style="font-weight:900;font-size:14px;margin-bottom:4px;">' + esc(name) + '</div>' +
        (expiry ? '<div style="color:var(--muted);font-size:12px;">Expiry: <b>' + esc(expiry) + '</b></div>' : '') +
      '</div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        '<div class="eikon-field" style="min-width:120px;">' +
          '<div class="eikon-label">Quantity available</div>' +
          '<input id="dash-ne-stock-qty" class="eikon-input" type="number" min="1" value="1" style="max-width:100px;" />' +
        '</div>' +
        '<div class="eikon-field" style="min-width:180px;">' +
          '<div class="eikon-label">Batch / Lot (optional)</div>' +
          '<input id="dash-ne-stock-batch" class="eikon-input" placeholder="e.g. LOT12345" />' +
        '</div>' +
      '</div>' +
      '<div class="eikon-help" style="margin-top:10px;color:var(--muted);">This will list the item in Scarce Stock so other locations can request it.</div>';

    E.modal.show("Add to Scarce Stock", html, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Add to Stock",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var qty = parseInt(String((document.getElementById("dash-ne-stock-qty") || {}).value || "1"), 10);
              if (!qty || qty < 1) qty = 1;
              var batch = String((document.getElementById("dash-ne-stock-batch") || {}).value || "").trim();

              var today = new Date().toISOString().slice(0, 10);
              var j = await api("/scarce-stock/offers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  entry_date: today,
                  item_name: name,
                  expiry_date: expiry || "",
                  batch: batch,
                  quantity_available: qty,
                  is_closed: 0,
                  near_expiry_id: neId
                })
              }, 10000, "dash-ne-add-stock");

              if (!j || !j.ok) throw new Error((j && j.error) || "Failed");

              E.modal.hide();
              E.showToast && E.showToast("Added to Scarce Stock");

              // Refresh dashboard data so the change is visible immediately
              refreshAll({ force: true });
            } catch (ex) {
              E.modal.show("Failed", "<div style='color:var(--danger);white-space:pre-wrap;'>" + esc((ex && (ex.message || ex.error)) || String(ex)) + "</div>", [
                { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          })();
        }
      }
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
        '<div style="max-height:420px;overflow-y:auto;">' +
          '<table class="eikon-dash-mini-table">' +
            "<thead><tr><th>Date</th><th>Issue</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>" +
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
        '<div style="max-height:420px;overflow-y:auto;">' +
          '<div><b>Today (' + esc(today) + ") — Day specific instructions</b></div>" +
          (notes ? ('<div style="margin-top:8px;white-space:pre-wrap">' + esc(notes) + "</div>") : '<div class="eikon-help" style="margin-top:6px">No notes for today.</div>') +
          '<div style="margin-top:14px"><b>Previous day (' + esc(yday) + ") — Handover from previous day</b></div>" +
          listHtml +
        "</div>" +
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
  // OTC Cross Sell logic
  // ----------------------------
  var xsell = {
    searchIndex: null,
    cache: new Map(),
    currentData: null,
    selectedId: null
  };

  var XSELL_DATA_BASE = (window.EIKON_PRODUCTMAP_BASE || "").replace(/\/$/, "");
  function xsellAsset(path) { return (XSELL_DATA_BASE ? XSELL_DATA_BASE + "/" : "") + path.replace(/^\//, ""); }

  function xsellFetchJson(path) {
    return fetch(xsellAsset(path), { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error("Failed to load " + path);
      return r.json();
    });
  }

  function xsellLoadSearchIndex() {
    if (xsell.searchIndex) return Promise.resolve(xsell.searchIndex);
    return xsellFetchJson("productmap-data/search-index.json").then(function (idx) { xsell.searchIndex = idx; return idx; });
  }

  function xsellLoadNeighborhood(centerId) {
    var parts = String(centerId || "").split(":");
    var type = parts[0], refId = parts[1];
    var key = type + ":" + refId;
    if (xsell.cache.has(key)) return Promise.resolve(xsell.cache.get(key));
    var typePath = type === "product" ? "product" : (type === "symptom" ? "symptom" : (type === "usecase" ? "usecase" : "bundle"));
    return xsellFetchJson("productmap-data/neighbours/" + typePath + "/" + refId + ".json").then(function (data) {
      xsell.cache.set(key, data); return data;
    });
  }

  function xsellNorm(s) { return String(s || "").trim().toLowerCase(); }

  function xsellDoSearch(q) {
    q = xsellNorm(q);
    if (!q || !xsell.searchIndex) return [];
    var words = q.split(/\s+/).filter(Boolean);
    var results = [];
    for (var i = 0; i < xsell.searchIndex.length; i++) {
      var it = xsell.searchIndex[i];
      var hay = xsellNorm(it.label + " " + (it.searchText || ""));
      var score = 0;
      if (xsellNorm(it.label) === q) score = 120;
      else if (xsellNorm(it.label).indexOf(q) === 0) score = 100;
      else if (hay.indexOf(q) >= 0) score = 80;
      else {
        var matched = 0;
        for (var w = 0; w < words.length; w++) if (hay.indexOf(words[w]) >= 0) matched++;
        if (matched > 0) score = 40 + (matched / words.length) * 30;
      }
      if (score > 0) results.push({ item: it, score: score + (it.priority || 0) * 0.01 });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 15);
  }

  function xsellShowDropdown(results, ddEl) {
    if (!ddEl) return;
    if (!results.length) { ddEl.classList.remove("open"); return; }
    ddEl.innerHTML = "";
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var item = document.createElement("div");
      item.className = "xsell-dd-item";
      item.setAttribute("data-idx", i);
      item.innerHTML = '<span class="xdd-type ' + esc(r.item.nodeType) + '">' + esc(r.item.nodeType) + '</span><span>' + esc(r.item.label) + '</span>';
      (function (nodeId, label) {
        item.addEventListener("click", function () {
          xsellSelect(nodeId, label);
          ddEl.classList.remove("open");
        });
      })(r.item.id, r.item.label);
      ddEl.appendChild(item);
    }
    ddEl.classList.add("open");
  }

  function xsellSelect(nodeId, label) {
    var mount = state.mount;
    if (!mount) return;
    var input = mount.querySelector(".xsell-input");
    var selEl = mount.querySelector(".eikon-dash-xsell-selected");

    if (input) input.value = "";

    xsellLoadNeighborhood(nodeId).then(function (data) {
      xsell.currentData = data;
      xsell.selectedId = nodeId;
      xsell.symptomSiblings = [];

      // Find the center node label
      var centerLabel = label;
      for (var i = 0; i < data.nodes.length; i++) {
        if (data.nodes[i].id === data.centerId) { centerLabel = data.nodes[i].label; break; }
      }

      // Show selected item
      if (selEl) {
        selEl.innerHTML = '<span class="xs-name">💊 ' + esc(centerLabel) + '</span><button class="xs-clear" title="Clear selection">&times;</button>';
        selEl.style.display = "flex";
        selEl.querySelector(".xs-clear").addEventListener("click", function () {
          xsellClear();
        });
      }

      // Collect symptom IDs from the product neighborhood
      var centerId = data.centerId;
      var symptomIds = [];
      for (var j = 0; j < data.links.length; j++) {
        if (data.links[j].rel === "symptom") {
          var sId = data.links[j].source === centerId ? data.links[j].target : data.links[j].source;
          symptomIds.push(sId);
        }
      }

      // Load symptom neighborhoods to find sibling products
      var fetches = symptomIds.map(function (sId) { return xsellLoadNeighborhood(sId); });
      Promise.all(fetches).then(function (symptomDatas) {
        var seen = {};
        seen[centerId] = true;
        // Also exclude products already in direct complements
        for (var ci = 0; ci < data.links.length; ci++) {
          if (data.links[ci].rel === "complement") {
            seen[data.links[ci].source] = true;
            seen[data.links[ci].target] = true;
          }
        }

        var siblings = [];
        for (var si = 0; si < symptomDatas.length; si++) {
          var sd = symptomDatas[si];
          var symptomNode = null;
          for (var sn = 0; sn < sd.nodes.length; sn++) {
            if (sd.nodes[sn].id === sd.centerId) { symptomNode = sd.nodes[sn]; break; }
          }
          var symptomLabel = symptomNode ? symptomNode.label : "";
          for (var li = 0; li < sd.links.length; li++) {
            var sl = sd.links[li];
            if (sl.rel !== "symptom") continue;
            var prodId = sl.source === sd.centerId ? sl.target : sl.source;
            if (seen[prodId]) continue;
            seen[prodId] = true;
            // Find the product node in the symptom neighborhood
            var prodNode = null;
            for (var pn = 0; pn < sd.nodes.length; pn++) {
              if (sd.nodes[pn].id === prodId) { prodNode = sd.nodes[pn]; break; }
            }
            if (prodNode && prodNode.nodeType === "product") {
              siblings.push({ node: prodNode, score: sl.score || 0, symptom: symptomLabel });
            }
          }
        }
        siblings.sort(function (a, b) { return b.score - a.score; });
        xsell.symptomSiblings = siblings;
        xsellOpenModal();
      });
    });
  }

  function xsellClear() {
    var mount = state.mount;
    if (!mount) return;
    xsell.currentData = null;
    xsell.selectedId = null;
    var selEl = mount.querySelector(".eikon-dash-xsell-selected");
    if (selEl) { selEl.style.display = "none"; selEl.innerHTML = ""; }
  }

  function xsellGetComplementData() {
    var data = xsell.currentData;
    if (!data) return { symptoms: [], complements: [] };
    var centerId = data.centerId;
    var symptoms = [], complements = [];
    for (var i = 0; i < data.links.length; i++) {
      var l = data.links[i];
      if (l.rel === "symptom") {
        var sId = l.source === centerId ? l.target : l.source;
        for (var j = 0; j < data.nodes.length; j++) {
          if (data.nodes[j].id === sId) { symptoms.push(data.nodes[j]); break; }
        }
      }
      if (l.rel === "complement") {
        var cId = l.source === centerId ? l.target : l.source;
        for (var k = 0; k < data.nodes.length; k++) {
          if (data.nodes[k].id === cId) {
            complements.push({ node: data.nodes[k], score: l.score || 0, label: l.label || "", why: l.why || "", trigger: (l.meta && l.meta.triggerContext) || "" });
            break;
          }
        }
      }
    }
    complements.sort(function (a, b) { return b.score - a.score; });
    return { symptoms: symptoms, complements: complements };
  }

  function xsellOpenModal() {
    var mount = state.mount;
    if (!mount) return;
    var overlay = mount.querySelector(".xsell-modal-overlay");
    if (!overlay) overlay = document.querySelector(".xsell-modal-overlay");
    if (!overlay) return;

    var data = xsellGetComplementData();
    var chipsEl = overlay.querySelector(".xsell-chips");
    var listEl = overlay.querySelector(".xsell-comp-list");
    var sibListEl = overlay.querySelector(".xsell-sibling-list");
    var selected = {};

    // Update heading
    var hd = overlay.querySelector(".xsell-modal-hd h3");
    if (hd && xsell.currentData) {
      var centerNode = null;
      for (var n = 0; n < xsell.currentData.nodes.length; n++) {
        if (xsell.currentData.nodes[n].id === xsell.currentData.centerId) { centerNode = xsell.currentData.nodes[n]; break; }
      }
      hd.textContent = "➕ Cross-sell for " + (centerNode ? centerNode.label : "");
    }

    // Build symptom chips
    chipsEl.innerHTML = "";
    if (data.symptoms.length === 0) {
      chipsEl.innerHTML = '<span style="color:rgba(170,183,214,.72);font-size:11px">No symptoms linked to this item</span>';
    }
    for (var i = 0; i < data.symptoms.length; i++) {
      var chip = document.createElement("span");
      chip.className = "xsell-chip";
      chip.textContent = data.symptoms[i].label;
      chip.setAttribute("data-id", data.symptoms[i].id);
      (function (chipEl, sId) {
        chipEl.addEventListener("click", function () {
          if (selected[sId]) { delete selected[sId]; chipEl.classList.remove("active"); }
          else { selected[sId] = true; chipEl.classList.add("active"); }
          xsellRenderCompList(data, selected, listEl);
          xsellRenderSiblingList(data, selected, sibListEl);
        });
      })(chip, data.symptoms[i].id);
      chipsEl.appendChild(chip);
    }

    xsellRenderCompList(data, selected, listEl);
    xsellRenderSiblingList(data, selected, sibListEl);
    overlay.classList.add("open");
  }

  function xsellBrand(c) {
    var brand = (c.node.meta && c.node.meta.brand) || "";
    var label = c.node.label || "";
    // If brand is a fragment of a hyphenated word (e.g. "NO" from "NO-SPA"),
    // extract the full hyphenated token from the label instead
    if (brand && label) {
      var firstToken = label.split(/[\s,]+/)[0] || "";
      if (firstToken.toLowerCase().indexOf(brand.toLowerCase()) === 0 && firstToken.length > brand.length) {
        return firstToken;
      }
    }
    return brand || label.split(/[\s,]+/)[0] || "Other";
  }

  function xsellMakeRow(c) {
    var row = document.createElement("div");
    row.className = "xsell-comp-row";
    row.innerHTML =
      '<span class="xc-score">' + c.score + '</span>' +
      '<span class="xc-name">' + esc(c.node.label) + '</span>' +
      (c.label ? '<span class="xc-reason" title="' + esc(c.why || c.label) + '">' + esc(c.label) + '</span>' : '');
    (function (nodeId, label) {
      row.addEventListener("click", function () {
        xsellCloseModal();
        xsellSelect(nodeId, label);
      });
    })(c.node.id, c.node.label);
    return row;
  }

  function xsellRenderCompList(data, selected, listEl) {
    listEl.innerHTML = "";
    var activeSymptoms = Object.keys(selected);
    var filtered = data.complements;

    if (activeSymptoms.length > 0) {
      var symptomLabels = [];
      for (var s = 0; s < data.symptoms.length; s++) {
        if (selected[data.symptoms[s].id]) symptomLabels.push(xsellNorm(data.symptoms[s].label));
      }
      filtered = data.complements.filter(function (c) {
        var t = xsellNorm(c.trigger + " " + c.label + " " + c.why);
        for (var si = 0; si < symptomLabels.length; si++) {
          var words = symptomLabels[si].split(/\s+/);
          for (var wi = 0; wi < words.length; wi++) {
            if (words[wi].length > 3 && t.indexOf(words[wi]) >= 0) return true;
          }
        }
        return false;
      });
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="xsell-comp-empty">' + (activeSymptoms.length > 0 ? 'No complementary items match the selected symptoms. Try removing a filter.' : 'No complementary items available.') + '</div>';
      return;
    }

    // Group by brand (case-insensitive key, preserve display label)
    var brandOrder = [], brandMap = {}, brandDisplay = {};
    for (var i = 0; i < filtered.length; i++) {
      var brand = xsellBrand(filtered[i]);
      var brandKey = brand.toLowerCase();
      if (!brandMap[brandKey]) { brandMap[brandKey] = []; brandOrder.push(brandKey); brandDisplay[brandKey] = brand; }
      brandMap[brandKey].push(filtered[i]);
    }

    // Sort brands: multi-item groups first (by best score), then singles by score
    brandOrder.sort(function (a, b) {
      var multi = (brandMap[b].length > 1 ? 1 : 0) - (brandMap[a].length > 1 ? 1 : 0);
      if (multi !== 0) return multi;
      return brandMap[b][0].score - brandMap[a][0].score;
    });

    var rendered = 0;
    var MAX_VISIBLE = 12;
    for (var bi = 0; bi < brandOrder.length; bi++) {
      var brandKey = brandOrder[bi];
      var items = brandMap[brandKey];

      if (items.length === 1) {
        // Single item — render as flat row
        listEl.appendChild(xsellMakeRow(items[0]));
        rendered++;
      } else {
        // Multi-item group — collapsible
        var bestScore = items[0].score;
        var grp = document.createElement("div");
        grp.className = "xsell-group";
        var hd = document.createElement("div");
        hd.className = "xsell-group-hd";
        hd.innerHTML =
          '<span class="xg-arrow">▶</span>' +
          '<span class="xg-brand">' + esc(brandDisplay[brandKey]) + '</span>' +
          '<span class="xg-count">' + items.length + ' variants</span>' +
          '<span class="xg-score">' + bestScore + '</span>';

        var bd = document.createElement("div");
        bd.className = "xsell-group-bd";
        for (var gi = 0; gi < items.length; gi++) {
          bd.appendChild(xsellMakeRow(items[gi]));
        }

        (function (hdEl, bdEl) {
          hdEl.addEventListener("click", function () {
            bdEl.classList.toggle("open");
            hdEl.querySelector(".xg-arrow").classList.toggle("open");
          });
        })(hd, bd);

        grp.appendChild(hd);
        grp.appendChild(bd);
        listEl.appendChild(grp);
        rendered++;
      }
    }
  }

  function xsellRenderSiblingList(data, selected, listEl) {
    if (!listEl) return;
    listEl.innerHTML = "";
    var siblings = xsell.symptomSiblings || [];
    if (siblings.length === 0) {
      listEl.innerHTML = '<div class="xsell-comp-empty">No additional products found for these symptoms.</div>';
      return;
    }

    // Filter by selected symptoms if any
    var activeSymptoms = Object.keys(selected);
    var filtered = siblings;
    if (activeSymptoms.length > 0) {
      var selectedLabels = [];
      for (var s = 0; s < data.symptoms.length; s++) {
        if (selected[data.symptoms[s].id]) selectedLabels.push(xsellNorm(data.symptoms[s].label));
      }
      filtered = siblings.filter(function (sib) {
        var symptomNorm = xsellNorm(sib.symptom);
        for (var si = 0; si < selectedLabels.length; si++) {
          if (symptomNorm === selectedLabels[si]) return true;
        }
        return false;
      });
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="xsell-comp-empty">No products match the selected symptoms.</div>';
      return;
    }

    // Group by brand, same as complements (case-insensitive key, preserve display label)
    var brandOrder = [], brandMap = {}, brandDisplay = {};
    for (var i = 0; i < filtered.length; i++) {
      var brand = xsellBrand(filtered[i]);
      var brandKey = brand.toLowerCase();
      if (!brandMap[brandKey]) { brandMap[brandKey] = []; brandOrder.push(brandKey); brandDisplay[brandKey] = brand; }
      brandMap[brandKey].push(filtered[i]);
    }
    brandOrder.sort(function (a, b) {
      var multi = (brandMap[b].length > 1 ? 1 : 0) - (brandMap[a].length > 1 ? 1 : 0);
      if (multi !== 0) return multi;
      return brandMap[b][0].score - brandMap[a][0].score;
    });

    for (var bi = 0; bi < brandOrder.length; bi++) {
      var brandKey = brandOrder[bi];
      var items = brandMap[brandKey];

      if (items.length === 1) {
        var sib = items[0];
        var row = document.createElement("div");
        row.className = "xsell-sib-row";
        row.innerHTML =
          '<span class="xs-score">' + sib.score + '</span>' +
          '<span class="xs-name">' + esc(sib.node.label) + '</span>' +
          '<span class="xs-symptom">' + esc(sib.symptom) + '</span>';
        (function (nodeId, label) {
          row.addEventListener("click", function () {
            xsellCloseModal();
            xsellSelect(nodeId, label);
          });
        })(sib.node.id, sib.node.label);
        listEl.appendChild(row);
      } else {
        var grp = document.createElement("div");
        grp.className = "xsell-group";
        var hd = document.createElement("div");
        hd.className = "xsell-group-hd";
        hd.innerHTML =
          '<span class="xg-arrow">▶</span>' +
          '<span class="xg-brand">' + esc(brandDisplay[brandKey]) + '</span>' +
          '<span class="xg-count">' + items.length + ' variants</span>' +
          '<span class="xg-score">' + items[0].score + '</span>';
        var bd = document.createElement("div");
        bd.className = "xsell-group-bd";
        for (var gi = 0; gi < items.length; gi++) {
          var sibItem = items[gi];
          var sibRow = document.createElement("div");
          sibRow.className = "xsell-sib-row";
          sibRow.style.borderRadius = "8px";
          sibRow.style.padding = "8px 10px";
          sibRow.innerHTML =
            '<span class="xs-score">' + sibItem.score + '</span>' +
            '<span class="xs-name">' + esc(sibItem.node.label) + '</span>' +
            '<span class="xs-symptom">' + esc(sibItem.symptom) + '</span>';
          (function (nodeId, label) {
            sibRow.addEventListener("click", function () {
              xsellCloseModal();
              xsellSelect(nodeId, label);
            });
          })(sibItem.node.id, sibItem.node.label);
          bd.appendChild(sibRow);
        }
        (function (hdEl, bdEl) {
          hdEl.addEventListener("click", function () {
            bdEl.classList.toggle("open");
            hdEl.querySelector(".xg-arrow").classList.toggle("open");
          });
        })(hd, bd);
        grp.appendChild(hd);
        grp.appendChild(bd);
        listEl.appendChild(grp);
      }
    }
  }

  function xsellCloseModal() {
    var overlay = state.mount && state.mount.querySelector(".xsell-modal-overlay");
    if (!overlay) overlay = document.querySelector(".xsell-modal-overlay");
    if (overlay) overlay.classList.remove("open");
  }

  function bindXsellSearch(mount) {
    var input = mount.querySelector(".xsell-input");
    var ddEl = mount.querySelector(".eikon-dash-xsell-dd");
    var overlay = mount.querySelector(".xsell-modal-overlay");
    if (!overlay) overlay = document.querySelector(".xsell-modal-overlay");

    if (!input || !ddEl) return;

    xsellLoadSearchIndex();

    var timer = null;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = input.value.trim();
        if (q.length < 2) { ddEl.classList.remove("open"); return; }
        xsellShowDropdown(xsellDoSearch(q), ddEl);
      }, 120);
    });

    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") ddEl.classList.remove("open");
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        var items = ddEl.querySelectorAll(".xsell-dd-item");
        if (!items.length) return;
        var cur = ddEl.querySelector(".xsell-dd-item.hl");
        var idx = -1;
        if (cur) { idx = parseInt(cur.getAttribute("data-idx"), 10); cur.classList.remove("hl"); }
        idx = ev.key === "ArrowDown" ? idx + 1 : idx - 1;
        if (idx < 0) idx = items.length - 1;
        if (idx >= items.length) idx = 0;
        items[idx].classList.add("hl");
        items[idx].scrollIntoView({ block: "nearest" });
      }
      if (ev.key === "Enter") {
        var hl = ddEl.querySelector(".xsell-dd-item.hl");
        if (hl) { hl.click(); return; }
        var q = input.value.trim(), results = xsellDoSearch(q);
        if (results.length) {
          xsellSelect(results[0].item.id, results[0].item.label);
          ddEl.classList.remove("open");
        }
      }
    });

    document.addEventListener("click", function (ev) {
      if (ddEl && !ddEl.contains(ev.target) && ev.target !== input) ddEl.classList.remove("open");
    });

    if (overlay) {
      overlay.querySelector(".xsell-modal-close").addEventListener("click", function () { xsellCloseModal(); });
      overlay.addEventListener("click", function (ev) { if (ev.target === overlay) xsellCloseModal(); });
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

    if (act === "dash-supplier-changes-details") return showSupplierChangesDetails();
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
    else if (act === "dash-open-scarcestock") window.location.hash = "#scarcestock";
    else if (act === "dash-open-stocktransfers") window.location.hash = "#stocktransfers";
    else if (act === "dash-open-messageboard") window.location.hash = "#messageboard";
    else if (act === "dash-open-supplier-inventory") window.location.hash = "#supplier-inventory";
    else if (act === "dash-open-supplier-inventory-orders") window.location.hash = "#supplier-inventory";
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
          '<div class="eikon-card eikon-dash-card eikon-dash-xsell">' +
            '<div class="eikon-dash-card-title">Today</div>' +
            '<div style="margin-bottom:10px">' +
              '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin-bottom:6px">OTC Cross Sell</div>' +
              '<div class="eikon-dash-xsell-search">' +
                '<span class="xsell-ico">🔍</span>' +
                '<input type="text" class="xsell-input" placeholder="Search a product to find cross-sell complements…" autocomplete="off" spellcheck="false">' +
                '<div class="eikon-dash-xsell-dd"></div>' +
              '</div>' +
              '<div class="eikon-dash-xsell-selected" style="display:none"></div>' +
            '</div>' +
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

        '<div class="xsell-modal-overlay">' +
          '<div class="xsell-modal">' +
            '<div class="xsell-modal-hd"><h3>➕ Complementary Items</h3><button class="xsell-modal-close">&times;</button></div>' +
            '<div class="xsell-modal-body">' +
              '<div class="xsell-section"><div class="xsell-section-label">Filter by symptom</div><div class="xsell-chips"></div></div>' +
              '<div class="xsell-section"><div class="xsell-section-label">Complementary products</div><div class="xsell-comp-list"></div></div>' +
              '<div class="xsell-section"><div class="xsell-section-label">Products for same symptoms</div><div class="xsell-sibling-list"></div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      "</div>";

    // bind only once per mount
    if (!mount.__eikonDashBound) {
      mount.addEventListener("click", handleClick);
      mount.__eikonDashBound = true;
    }

    // OTC Cross Sell search bindings
    bindXsellSearch(mount);

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

