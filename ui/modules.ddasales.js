/* ui/modules.ddasales.js Eikon - DDA Sales module (UI) Endpoints (Cloudflare Worker): GET /dda-sales/entries?month=YYYY-MM&q=...
POST /dda-sales/entries PUT /dda-sales/entries/:id DELETE /dda-sales/entries/:id GET /dda-sales/report?from=YYYY-MM-DD&to=YYYY-MM-DD (JSON) */
(function () {
  "use strict";
  var LOG_PREFIX = "[EIKON][dda-sales]";
  function log() {
    try { console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }

  var ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 3v18h18"></path>' +
    '<path d="M7 14l3-3 3 2 5-6"></path>' +
    "</svg>";

  // ✅ PATCH: Medicine Name & Dose suggestions (Tab to accept)
  var MEDICINE_NAME_DOSE_SUGGESTIONS = [
    "Alprazolam 0.25mg",
    "Alprazolam 0.5mg",
    "Bromazepam 3mg",
    "Buprenorphine/Naloxone 8mg/2mg",
    "Clonazepam 0.5mg",
    "Clonazepam 2mg",
    "Dexamfetamine 5mg",
    "Diazepam 5mg",
    "Lorazepam 1mg",
    "Mexazolam 1mg",
    "Methylphenidate 10mg",
    "Methylphenidate 18mg SR",
    "Methylphenidate 36mg SR",
    "Morphine 10mg injection",
    "Morphine 10mg/ml",
    "Morphine sulphate 10mg tablets",
    "Nitrazepam 5mg",
    "Tianeptine 12.5mg",
    "Tramadol 50mg",
    "Tramadol/Dexketoprofen 75/25mg",
    "Zolpidem 10mg",
  ];

  // ✅ PATCH: normalize Maltese ID card numbers
  // - always uppercase
  // - if pattern is 1-7 digits + 1 letter => left-pad zeros to 7 digits, keep letter
  //   e.g. 789M => 0000789M
  function normalizeMtIdCard(raw) {
    var s = String(raw || "").replace(/\s+/g, "").toUpperCase();
    if (!s) return "";
    var m = /^(\d{1,7})([A-Z])$/.exec(s);
    if (m) {
      var digits = m[1];
      while (digits.length < 7) digits = "0" + digits;
      return digits + m[2];
    }
    return s;
  }


  function pad2(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return "00";
    return (n < 10 ? "0" : "") + String(n);
  }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function isYm(s) { return /^\d{4}-\d{2}$/.test(String(s || "").trim()); }

  // ✅ PATCH: Early supply highlighting (same client + medicine within <30 days)
  function ymdToTs(ymd) {
    ymd = String(ymd || "").trim();
    if (!isYmd(ymd)) return NaN;
    var y = parseInt(ymd.slice(0, 4), 10);
    var m = parseInt(ymd.slice(5, 7), 10);
    var d = parseInt(ymd.slice(8, 10), 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
    return new Date(y, m - 1, d).getTime();
  }
  function dateToYmd(dt) {
    if (!(dt instanceof Date)) dt = new Date(dt);
    if (!dt || !Number.isFinite(dt.getTime())) return "";
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }
  function addDaysYmd(ymd, deltaDays) {
    var t = ymdToTs(ymd);
    if (!Number.isFinite(t)) return "";
    var d = new Date(t);
    d.setDate(d.getDate() + Number(deltaDays || 0));
    return dateToYmd(d);
  }
  function normalizeMedicineKey(med) {
    return String(med || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function computeEarlyById(entries) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    // Ensure chronological order to flag the later entry
    list.sort(function (a, b) {
      var ta = ymdToTs(a && a.entry_date);
      var tb = ymdToTs(b && b.entry_date);
      if (ta !== tb) return (ta || 0) - (tb || 0);
      var ia = Number(a && a.id) || 0;
      var ib = Number(b && b.id) || 0;
      return ia - ib;
    });

    var earlyById = {}; // id => true
    var lastTsByKey = {}; // key => ts
    var MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var id = r.id;
      if (id == null) continue;
      var dt = ymdToTs(r.entry_date);
      if (!Number.isFinite(dt)) continue;

      var idCard = normalizeMtIdCard(r.client_id_card || "");
      var medKey = normalizeMedicineKey(r.medicine_name_dose || "");
      if (!idCard || !medKey) continue;

      var k = idCard + "|" + medKey;
      var last = lastTsByKey[k];
      if (last != null && Number.isFinite(last) && (dt - last) < MS_30_DAYS) {
        earlyById[String(id)] = true;
      }
      lastTsByKey[k] = dt;
    }
    return earlyById;
  }

  async function computeEarlyByIdForMonth(month, entriesForMonth) {
    // Prefer a 30-day lookback (month_start - 30 days .. month_end) so we can detect early supply
    // even if the previous supply was in the previous month.
    var early = {};
    try {
      var range = monthStartEnd(month);
      if (!range) return computeEarlyById(entriesForMonth);
      var lookbackFrom = addDaysYmd(range.from, -30);
      if (!lookbackFrom) return computeEarlyById(entriesForMonth);

      var data = await apiJson(ctx.win, "/dda-sales/report?from=" + encodeURIComponent(lookbackFrom) + "&to=" + encodeURIComponent(range.to), { method: "GET" });
      if (!data || data.ok !== true) return computeEarlyById(entriesForMonth);
      var allEarly = computeEarlyById(Array.isArray(data.entries) ? data.entries : []);
      // Only keep flags for entries that are actually displayed in the month list
      for (var i = 0; i < (entriesForMonth || []).length; i++) {
        var e = entriesForMonth[i] || {};
        if (e.id != null && allEarly[String(e.id)]) early[String(e.id)] = true;
      }
      return early;
    } catch (e) {
      return computeEarlyById(entriesForMonth);
    }
  }


  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&", "<": "<", ">": ">", '"': '"', "'": "'" })[c] || c;
    });
  }

  function monthStartEnd(yyyyMm) {
    var m = String(yyyyMm || "").trim();
    if (!isYm(m)) return null;
    var y = parseInt(m.slice(0, 4), 10);
    var mo = parseInt(m.slice(5, 7), 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
    var start = m + "-01";
    var lastDay = new Date(y, mo, 0).getDate();
    var end = m + "-" + pad2(lastDay);
    return { from: start, to: end };
  }

  function todayYm() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function toIntSafe(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) return null;
    return n;
  }
  function ymFromYmd(ymd) { return String(ymd || "").slice(0, 7); }

  function isWindowLike(x) {
    try { return !!(x && x.window === x && x.document && x.document.nodeType === 9); } catch (e) { return false; }
  }
  function findBestMountInDocument(doc) {
    if (!doc) return null;
    var ids = ["eikon-module-root", "module-root", "app", "root", "eikon-root", "content", "main"];
    for (var i = 0; i < ids.length; i++) {
      var el0 = null;
      try { el0 = doc.getElementById(ids[i]); } catch (e) { el0 = null; }
      if (el0 && el0.nodeType === 1) return el0;
    }
    try {
      var q = doc.querySelector("[data-module-root='1'], [data-module-root='true']");
      if (q && q.nodeType === 1) return q;
    } catch (e2) {}
    try { if (doc.body && doc.body.nodeType === 1) return doc.body; } catch (e3) {}
    return null;
  }
  function resolveRenderContext(container) {
    var ctx = { win: null, doc: null, mount: null, note: "" };
    if (container && container.nodeType === 1) {
      ctx.mount = container;
      ctx.doc = container.ownerDocument || document;
      ctx.win = ctx.doc.defaultView || window;
      ctx.note = "container=Element";
      return ctx;
    }
    if (container && container.nodeType === 9) {
      ctx.doc = container;
      ctx.win = container.defaultView || window;
      ctx.mount = findBestMountInDocument(ctx.doc);
      ctx.note = "container=Document";
      return ctx;
    }
    if (isWindowLike(container)) {
      ctx.win = container;
      ctx.doc = container.document;
      ctx.mount = findBestMountInDocument(ctx.doc);
      ctx.note = "container=Window";
      return ctx;
    }
    try {
      if (container && container.tagName && String(container.tagName).toLowerCase() === "iframe") {
        var w0 = container.contentWindow;
        var d0 = container.contentDocument || (w0 ? w0.document : null);
        if (w0 && d0) {
          ctx.win = w0;
          ctx.doc = d0;
          ctx.mount = findBestMountInDocument(ctx.doc);
          ctx.note = "container=iframe";
          return ctx;
        }
      }
    } catch (e1) {}
    var maybeElProps = ["mount", "container", "root", "rootEl", "el", "element", "node"];
    for (var j = 0; j < maybeElProps.length; j++) {
      try {
        var v = container && container[maybeElProps[j]];
        if (v && v.nodeType === 1) {
          ctx.mount = v;
          ctx.doc = v.ownerDocument || document;
          ctx.win = ctx.doc.defaultView || window;
          ctx.note = "container=wrapper." + maybeElProps[j];
          return ctx;
        }
      } catch (e2) {}
    }
    try {
      if (container && container.document && container.document.nodeType === 9) {
        ctx.doc = container.document;
        ctx.win = ctx.doc.defaultView || window;
        ctx.mount = findBestMountInDocument(ctx.doc);
        ctx.note = "container=wrapper.document";
        return ctx;
      }
    } catch (e3) {}
    if (typeof container === "string") {
      try {
        var el1 = document.querySelector(container);
        if (el1 && el1.nodeType === 1) {
          ctx.mount = el1;
          ctx.doc = el1.ownerDocument || document;
          ctx.win = ctx.doc.defaultView || window;
          ctx.note = "container=selector";
          return ctx;
        }
      } catch (e4) {}
    }
    ctx.note = "container=unknown";
    return ctx;
  }

  function el(doc, tag, attrs, children) {
    var node = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "value") node.value = attrs[k];
        else if (k === "type") node.type = attrs[k];
        else if (k === "placeholder") node.placeholder = attrs[k];
        else if (k === "disabled") node.disabled = !!attrs[k];
        else if (k === "onclick") node.onclick = attrs[k];
        else if (k === "colspan") node.colSpan = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    if (children && children.length) {
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(doc.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  function ensureStyleOnce(doc) {
    var id = "eikon-dda-sales-style";
    try { if (doc.getElementById(id)) return; } catch (e) {}

    var css =
      "" +
      ".eikon-dda-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px;}" +
      ".eikon-dda-top{display:flex;flex-wrap:wrap;gap:10px;align-items:end;justify-content:space-between;margin-bottom:12px;}" +
      ".eikon-dda-title{font-size:18px;font-weight:900;margin:0;display:flex;align-items:center;gap:10px;color:var(--text,#e9eef7);}" +
      ".eikon-dda-title .icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;color:var(--text,#e9eef7);opacity:.95;}" +
      ".eikon-dda-controls{display:flex;flex-direction:column;gap:10px;align-items:stretch;}.eikon-dda-controls-row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +

      ".eikon-dda-field{display:flex;flex-direction:column;gap:4px;}" +
      ".eikon-dda-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +
      ".eikon-dda-field input,.eikon-dda-field textarea{" +
      "padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "font-size:14px;background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "transition:border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;" +
      "}" +
      ".eikon-dda-field input:hover,.eikon-dda-field textarea:hover{border-color:rgba(255,255,255,.18);}" +
      ".eikon-dda-field input:focus,.eikon-dda-field textarea:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);}" +
      ".eikon-dda-field textarea{min-height:64px;resize:vertical;}" +

      ".eikon-dda-btn{padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(20,32,48,.62);color:var(--text,#e9eef7);font-weight:900;cursor:pointer;box-shadow:0 10px 24px rgba(0,0,0,.14);" +
      "transition:transform 120ms ease, border-color 120ms ease, background 120ms ease;}" +
      ".eikon-dda-btn:hover{border-color:rgba(58,160,255,.35);background:rgba(24,38,56,.70);}" +
      ".eikon-dda-btn:active{transform:translateY(1px);}" +
      ".eikon-dda-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}" +
      ".eikon-dda-btn.secondary{background:rgba(16,24,36,.34);}" +
      ".eikon-dda-btn.secondary:hover{border-color:rgba(255,255,255,.18);background:rgba(16,24,36,.44);}" +
      ".eikon-dda-btn.danger{background:rgba(255,77,79,.12);border-color:rgba(255,77,79,.42);}" +
      ".eikon-dda-btn.danger:hover{background:rgba(255,77,79,.16);border-color:rgba(255,77,79,.60);}" +

      ".eikon-dda-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:12px;background:var(--panel,rgba(16,24,36,.66));" +
      "box-shadow:0 18px 50px rgba(0,0,0,.38);backdrop-filter:blur(10px);}" +

      ".eikon-dda-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".eikon-dda-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +

      ".eikon-dda-msg{margin:10px 0;padding:10px 12px;border-radius:14px;border:1px solid var(--line,rgba(255,255,255,.10));background:rgba(16,24,36,.52);color:var(--text,#e9eef7);}" +
      ".eikon-dda-msg.ok{border-color:rgba(55,214,122,.35);}" +
      ".eikon-dda-msg.err{border-color:rgba(255,77,79,.35);}" +
      ".eikon-dda-hint{font-size:12px;color:var(--muted,rgba(233,238,247,.68));margin-top:6px;}" +

      ".eikon-dda-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.18);}" +
      ".eikon-dda-table{width:100%;border-collapse:collapse;min-width:980px;color:var(--text,#e9eef7);}" +
      ".eikon-dda-table th,.eikon-dda-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:10px 10px;font-size:12px;vertical-align:top;}" +
      ".eikon-dda-table th{background:rgba(12,19,29,.92);text-align:left;font-weight:900;position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;}" +
      ".eikon-dda-table tbody tr:hover{background:rgba(255,255,255,.04);}" +

      ".eikon-dda-actions{display:flex;gap:10px;}" +
      ".eikon-dda-link{color:var(--brand,#3aa0ff);text-decoration:underline;cursor:pointer;font-weight:900;}" +

      ".eikon-dda-action-btn{background:transparent;border:0;padding:0;margin:0;color:var(--brand,#3aa0ff);text-decoration:underline;cursor:pointer;font-weight:900;font-size:12px;}.eikon-dda-action-btn.danger{color:var(--danger,#ff5a7a);}.eikon-dda-action-btn:disabled{opacity:.55;cursor:not-allowed;text-decoration:none;}.eikon-dda-suggestbox{position:absolute;left:0;right:0;top:100%;margin-top:6px;z-index:2147480000;background:rgba(12,19,29,.98);border:1px solid var(--line,rgba(255,255,255,.12));border-radius:12px;max-height:220px;overflow:auto;box-shadow:0 12px 30px rgba(0,0,0,.35);display:none;}.eikon-dda-suggestitem{padding:8px 10px;cursor:pointer;font-size:12px;}.eikon-dda-suggestitem:hover{background:rgba(255,255,255,.06);}.eikon-dda-suggestmeta{opacity:.7;font-size:11px;margin-left:6px;}.eikon-dda-suggestempty{padding:8px 10px;opacity:.7;font-size:12px;}" +

      ".eikon-dda-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.58);display:none;align-items:center;justify-content:center;padding:16px;z-index:9999;}" +
      ".eikon-dda-modal{width:100%;max-width:860px;background:rgba(16,24,36,.98);border-radius:16px;border:1px solid var(--line,rgba(255,255,255,.10));" +
      "box-shadow:0 28px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);}" +
      ".eikon-dda-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.10));}" +
      ".eikon-dda-modal-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      ".eikon-dda-modal-body{padding:14px;}" +
      ".eikon-dda-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
      ".eikon-dda-grid .full{grid-column:1 / -1;}" +
      ".eikon-dda-checkrow{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(10,16,24,.64);min-height:42px;}" +
      ".eikon-dda-field .eikon-dda-checkrow input[type=checkbox]{width:18px;height:18px;margin:0;padding:0;}" +
      ".eikon-dda-checkrow span{font-size:13px;font-weight:800;color:var(--text,#e9eef7);opacity:.9;}" +
      ".eikon-dda-urgent-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(255,77,79,.55);background:rgba(255,77,79,.14);color:var(--text,#e9eef7);font-weight:1000;font-size:11px;letter-spacing:.6px;text-transform:uppercase;}" +
      "@media(max-width:820px){.eikon-dda-grid{grid-template-columns:1fr;}}";

    var style = doc.createElement("style");
    style.id = id;
    style.type = "text/css";
    style.appendChild(doc.createTextNode(css));
    try {
      if (doc.head) doc.head.appendChild(style);
      else if (doc.documentElement) doc.documentElement.appendChild(style);
      else if (doc.body) doc.body.appendChild(style);
    } catch (e2) {}
  }

  function getStoredToken(win) {
    var candidates = [];
    try { if (window && window !== win) candidates.push(window); } catch (e) {}
    candidates.push(win || window);
    for (var c = 0; c < candidates.length; c++) {
      var W = candidates[c];
      if (!W) continue;
      try { if (W.EIKON && typeof W.EIKON.getToken === "function") { var t = W.EIKON.getToken(); if (t) return String(t); } } catch (e1) {}
      try { if (W.Eikon && typeof W.Eikon.getToken === "function") { var t2 = W.Eikon.getToken(); if (t2) return String(t2); } } catch (e2) {}
      try { if (W.EIKON && W.EIKON.state && W.EIKON.state.token) return String(W.EIKON.state.token); } catch (e3) {}
      try { if (W.Eikon && W.Eikon.state && W.Eikon.state.token) return String(W.Eikon.state.token); } catch (e4) {}
      var keys = ["eikon_token", "EIKON_TOKEN", "token", "auth_token", "session_token"];
      for (var i = 0; i < keys.length; i++) {
        try { var v = W.localStorage && W.localStorage.getItem(keys[i]); if (v && String(v).trim()) return String(v).trim(); } catch (e5) {}
      }
      for (var j = 0; j < keys.length; j++) {
        try { var v2 = W.sessionStorage && W.sessionStorage.getItem(keys[j]); if (v2 && String(v2).trim()) return String(v2).trim(); } catch (e6) {}
      }
    }
    return "";
  }

  function makeHttpError(status, payload) {
    var msg = "HTTP " + status;
    if (payload && typeof payload === "object" && payload.error) msg = String(payload.error);
    else if (typeof payload === "string" && payload.trim()) msg = payload.trim();
    var err = new Error(msg);
    err.status = status;
    err.payload = payload;
    return err;
  }

  async function apiJson(win, path, opts) {
    opts = opts || {};
    var headers = new Headers(opts.headers || {});
    headers.set("Accept", "application/json");
    var token = getStoredToken(win);
    if (token && !headers.has("Authorization")) headers.set("Authorization", "Bearer " + token);
    if (opts.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    var method = opts.method || "GET";
    var fetchOpts = { method: method, headers: headers, body: opts.body != null ? opts.body : undefined };
    try { fetchOpts.cache = "no-store"; } catch (e0) {}
    var res = await fetch(path, fetchOpts);
    var ct = (res.headers.get("Content-Type") || "").toLowerCase();
    var data = null;
    if (ct.indexOf("application/json") >= 0) {
      try { data = await res.json(); } catch (e) { data = null; }
    } else {
      try { data = await res.text(); } catch (e2) { data = null; }
    }
    if (!res.ok) throw makeHttpError(res.status, data);
    return data;
  }

  function openPrintTabWithHtml(html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }
    if (!w) {
      try {
        var a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e2) {}
    }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
  }

  function buildModule() {
    var state = {
      month: todayYm(),
      q: "",
      loading: false,
      entries: [],
      early_by_id: {},
      report_from: "",
      report_to: "",
      report: null,
      report_loading: false,
    };

    var ctx = null;
    var msgBox = null;
    var tableBody = null;
    var monthInput = null;
    var qInput = null;
    var refreshBtn = null;
    var addBtn = null;

    var reportFromInput = null;
    var reportToInput = null;
    var generateBtn = null;
    var printBtn = null;
    var reportMsg = null;
    var reportPreview = null;

    var activeDoc = null;
    var modalBackdrop = null;
    var modalTitle = null;
    var formEls = null;

    // ✅ PATCH: debounce timer for live search
    var searchTimer = null;

    // ✅ PATCH: client lookup debounce / sequencing
    var clientLookupTimer = null;
    var clientLookupSeq = 0;

    // ✅ PATCH: medicine autocomplete UI state
    var medicineHintEl = null;
    var medicineCurrentSuggestion = "";

    // ✅ PATCH: medicine suggestion dropdown (show on click/focus)
    var medicineSuggestBox = null;
    var medicineSuggestHideTimer = null;

    // ✅ PATCH: doctor suggestions + autofill
    var doctorNameSuggestBox = null;
    var doctorRegSuggestBox = null;
    var doctorSuggestHideTimer = null;
    var doctorLookupTimer = null;
    var doctorLookupSeq = 0;
    var doctorSuggestResults = [];
    var doctorLastMode = "name";
    var doctorLastQuery = "";

    function setMsg(kind, text) {
      if (!msgBox) return;
      msgBox.className = "eikon-dda-msg " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
      msgBox.textContent = String(text || "");
      msgBox.style.display = text ? "block" : "none";
    }

    
    // ✅ PATCH: In-UI confirm dialog (works inside sandboxed iframes where window.confirm is blocked)
    // Returns Promise<boolean>
    var _confirmBackdrop = null;
    function uiConfirm(message, opts) {
      opts = opts || {};
      if (!ctx || !ctx.doc || !ctx.win) return Promise.resolve(true);
      var doc = ctx.doc;

      // Build once
      if (!_confirmBackdrop) {
        var bd = doc.createElement("div");
        bd.className = "eikon-dda-confirm-backdrop";
        bd.style.cssText = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:1100;";
        var card = doc.createElement("div");
        card.className = "eikon-dda-confirm-card";
        card.style.cssText = "width:min(420px,calc(100vw - 32px));background:rgba(12,19,29,.98);border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 20px 80px rgba(0,0,0,.55);padding:14px 14px 12px 14px;color:rgba(233,238,247,.92);";
        var title = doc.createElement("div");
        title.className = "eikon-dda-confirm-title";
        title.style.cssText = "font-weight:900;font-size:14px;letter-spacing:.2px;margin-bottom:8px;";
        title.textContent = "Confirm";
        var msg = doc.createElement("div");
        msg.className = "eikon-dda-confirm-message";
        msg.style.cssText = "font-size:13px;line-height:1.35;color:rgba(233,238,247,.86);white-space:pre-wrap;";
        var btnRow = doc.createElement("div");
        btnRow.style.cssText = "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;";
        var cancelBtn = doc.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "eikon-dda-btn";
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.minWidth = "96px";
        var okBtn = doc.createElement("button");
        okBtn.type = "button";
        okBtn.className = "eikon-dda-btn danger";
        okBtn.textContent = "OK";
        okBtn.style.minWidth = "96px";

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(okBtn);

        card.appendChild(title);
        card.appendChild(msg);
        card.appendChild(btnRow);
        bd.appendChild(card);

        // Click outside = cancel
        bd.addEventListener("click", function (ev) {
          try {
            if (ev && ev.target === bd) {
              ev.preventDefault();
              ev.stopPropagation();
              cancelBtn.click();
            }
          } catch (e) {}
        });

        doc.body.appendChild(bd);
        _confirmBackdrop = { bd: bd, title: title, msg: msg, cancelBtn: cancelBtn, okBtn: okBtn };
      }

      return new Promise(function (resolve) {
        var bd = _confirmBackdrop.bd;
        var titleEl = _confirmBackdrop.title;
        var msgEl = _confirmBackdrop.msg;
        var cancelBtn = _confirmBackdrop.cancelBtn;
        var okBtn = _confirmBackdrop.okBtn;

        titleEl.textContent = opts.title ? String(opts.title) : "Confirm";
        msgEl.textContent = String(message || "");
        cancelBtn.textContent = opts.cancelText ? String(opts.cancelText) : "Cancel";
        okBtn.textContent = opts.confirmText ? String(opts.confirmText) : "OK";
        if (opts.danger === false) okBtn.className = "eikon-dda-btn";
        else okBtn.className = "eikon-dda-btn danger";

        function cleanup(val) {
          try { bd.style.display = "none"; } catch (e) {}
          try { cancelBtn.onclick = null; okBtn.onclick = null; } catch (e2) {}
          resolve(!!val);
        }

        cancelBtn.onclick = function (ev) { try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {} cleanup(false); };
        okBtn.onclick = function (ev) { try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {} cleanup(true); };

        try { bd.style.display = "flex"; } catch (e) {}
      });
    }

function setLoading(v) {
      state.loading = !!v;
      if (refreshBtn) refreshBtn.disabled = state.loading || state.report_loading;
      if (addBtn) addBtn.disabled = state.loading || state.report_loading;
      if (monthInput) monthInput.disabled = state.loading || state.report_loading;
      if (qInput) qInput.disabled = state.loading || state.report_loading;
      if (generateBtn) generateBtn.disabled = state.loading || state.report_loading;
      if (printBtn) printBtn.disabled = state.loading || state.report_loading;
      if (reportFromInput) reportFromInput.disabled = state.loading || state.report_loading;
      if (reportToInput) reportToInput.disabled = state.loading || state.report_loading;
    }


    // ✅ PATCH: Find best medicine suggestion for current input (prefix match, case-insensitive)
    function bestMedicineSuggestion(input) {
      var q = String(input || "").trim();
      if (!q) return "";
      var ql = q.toLowerCase();
      var best = "";
      for (var i = 0; i < MEDICINE_NAME_DOSE_SUGGESTIONS.length; i++) {
        var s = MEDICINE_NAME_DOSE_SUGGESTIONS[i];
        if (!s) continue;
        var sl = String(s).toLowerCase();
        if (sl.indexOf(ql) === 0) { best = s; break; }
      }
      if (!best) {
        for (var j = 0; j < MEDICINE_NAME_DOSE_SUGGESTIONS.length; j++) {
          var s2 = MEDICINE_NAME_DOSE_SUGGESTIONS[j];
          if (!s2) continue;
          var s2l = String(s2).toLowerCase();
          if (s2l.indexOf(ql) !== -1) { best = s2; break; }
        }
      }
      return best || "";
    }

    // ✅ PATCH: update medicine hint text below the field
    function updateMedicineHint() {
      if (!formEls || !formEls.medicine_name_dose) return;
      var v = String(formEls.medicine_name_dose.value || "");
      var vTrim = v.trim();
      medicineCurrentSuggestion = bestMedicineSuggestion(vTrim);
      if (!medicineHintEl) return;
      if (!vTrim) {
        medicineHintEl.style.display = "none";
        medicineHintEl.textContent = "";
        return;
      }
      if (medicineCurrentSuggestion &&
          medicineCurrentSuggestion.toLowerCase().indexOf(vTrim.toLowerCase()) === 0 &&
          medicineCurrentSuggestion.toLowerCase() !== vTrim.toLowerCase()) {
        medicineHintEl.style.display = "block";
        medicineHintEl.textContent = "Suggestion: " + medicineCurrentSuggestion + "  (Tab to accept)";
      } else {
        medicineHintEl.style.display = "none";
        medicineHintEl.textContent = "";
      }
    }

    // ✅ PATCH: helper to clear a node
    function clearNode(n) {
      try { while (n && n.firstChild) n.removeChild(n.firstChild); } catch (e) {}
    }

    // ✅ PATCH: Medicine suggestions dropdown (show list on focus/click)
    function getMedicineMatches(q) {
      var qt = String(q || "").trim().toLowerCase();
      var out = [];
      for (var i = 0; i < MEDICINE_NAME_DOSE_SUGGESTIONS.length; i++) {
        var s = MEDICINE_NAME_DOSE_SUGGESTIONS[i];
        if (!s) continue;
        var sl = String(s).toLowerCase();
        if (!qt) out.push(s);
        else if (sl.indexOf(qt) === 0) out.push(s);
        else if (sl.indexOf(qt) >= 0) out.push(s);
        if (out.length >= 14) break;
      }
      return out;
    }

    function renderMedicineSuggest() {
      if (!medicineSuggestBox || !formEls || !formEls.medicine_name_dose) return;
      var doc = medicineSuggestBox.ownerDocument || (ctx ? ctx.doc : document);
      clearNode(medicineSuggestBox);
      var q = String(formEls.medicine_name_dose.value || "");
      var list = getMedicineMatches(q);
      if (!list.length) {
        medicineSuggestBox.appendChild(el(doc, "div", { class: "eikon-dda-suggestempty", text: "No suggestions" }, []));
        return;
      }
      for (var i = 0; i < list.length; i++) {
        (function (val) {
          var it = el(doc, "div", { class: "eikon-dda-suggestitem", text: val }, []);
          var pick = function (ev) {
            try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}
            try { formEls.medicine_name_dose.value = val; } catch (e2) {}
            medicineCurrentSuggestion = "";
            updateMedicineHint();
            hideMedicineSuggest(true);
            try { if (formEls.doctor_name) formEls.doctor_name.focus(); } catch (e3) {}
          };
          it.onmousedown = pick;
          it.onclick = pick;
          it.ontouchstart = pick;
          medicineSuggestBox.appendChild(it);
        })(list[i]);
      }
    }

    function showMedicineSuggest() {
      if (!medicineSuggestBox) return;
      if (medicineSuggestHideTimer) { try { ctx.win.clearTimeout(medicineSuggestHideTimer); } catch (e) {} }
      renderMedicineSuggest();
      medicineSuggestBox.style.display = "block";
    }

    function hideMedicineSuggest(immediate) {
      if (!medicineSuggestBox) return;
      if (medicineSuggestHideTimer) { try { ctx.win.clearTimeout(medicineSuggestHideTimer); } catch (e) {} }
      if (immediate) {
        medicineSuggestBox.style.display = "none";
        return;
      }
      medicineSuggestHideTimer = (ctx && ctx.win ? ctx.win.setTimeout(function () {
        try { if (medicineSuggestBox) medicineSuggestBox.style.display = "none"; } catch (e) {}
      }, 160) : null);
    }

    // ✅ PATCH: Doctor suggestions + autofill (from past DDA sales entries)
    function renderDoctorSuggest(mode) {
      var box = mode === "reg" ? doctorRegSuggestBox : doctorNameSuggestBox;
      if (!box) return;
      var doc = box.ownerDocument || (ctx ? ctx.doc : document);
      clearNode(box);
      var list = doctorSuggestResults || [];
      if (!list.length) {
        box.appendChild(el(doc, "div", { class: "eikon-dda-suggestempty", text: "No doctor suggestions yet" }, []));
        return;
      }
      for (var i = 0; i < list.length; i++) {
        (function (d) {
          var name = String(d.doctor_name || "");
          var reg = String(d.doctor_reg_no || "");
          var count = d.count == null ? "" : String(d.count);
          var it = el(doc, "div", { class: "eikon-dda-suggestitem" }, []);
          it.appendChild(el(doc, "span", { text: name + (reg ? " — " + reg : "") }, []));
          if (count) it.appendChild(el(doc, "span", { class: "eikon-dda-suggestmeta", text: "(" + count + ")" }, []));
          var pick = function (ev) {
            try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}
            try { if (formEls && formEls.doctor_name) formEls.doctor_name.value = name; } catch (e2) {}
            try { if (formEls && formEls.doctor_reg_no) formEls.doctor_reg_no.value = reg; } catch (e3) {}
            hideDoctorSuggest(true);
            try { if (formEls && formEls.prescription_serial_no) formEls.prescription_serial_no.focus(); } catch (e4) {}
          };
          it.onmousedown = pick;
          it.onclick = pick;
          it.ontouchstart = pick;
          box.appendChild(it);
        })(list[i]);
      }
    }

    function showDoctorSuggest(mode) {
      var box = mode === "reg" ? doctorRegSuggestBox : doctorNameSuggestBox;
      if (!box) return;
      if (doctorSuggestHideTimer) { try { ctx.win.clearTimeout(doctorSuggestHideTimer); } catch (e) {} }
      box.style.display = "block";
      renderDoctorSuggest(mode);
    }

    function hideDoctorSuggest(immediate) {
      if (doctorSuggestHideTimer) { try { ctx.win.clearTimeout(doctorSuggestHideTimer); } catch (e) {} }
      var hideFn = function () {
        try { if (doctorNameSuggestBox) doctorNameSuggestBox.style.display = "none"; } catch (e1) {}
        try { if (doctorRegSuggestBox) doctorRegSuggestBox.style.display = "none"; } catch (e2) {}
      };
      if (immediate) { hideFn(); return; }
      doctorSuggestHideTimer = (ctx && ctx.win ? ctx.win.setTimeout(hideFn, 160) : null);
    }

    function scheduleDoctorLookup(mode, q) {
      if (!ctx) return;
      if (!formEls) return;
      doctorLastMode = mode || "name";
      doctorLastQuery = String(q || "");
      if (doctorLookupTimer) { try { ctx.win.clearTimeout(doctorLookupTimer); } catch (e) {} }
      doctorLookupTimer = ctx.win.setTimeout(function () {
        lookupDoctors(doctorLastMode, doctorLastQuery);
      }, 260);
    }

    async function lookupDoctors(mode, q) {
      if (!ctx) return;
      var seq = ++doctorLookupSeq;
      var qq = String(q || "").trim();
      try {
        var url = "/dda-sales/doctors?limit=12";
        if (qq) url += "&q=" + encodeURIComponent(qq);
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (seq !== doctorLookupSeq) return;
        doctorSuggestResults = (data && data.ok === true && Array.isArray(data.doctors)) ? data.doctors : [];
      } catch (e) {
        if (seq !== doctorLookupSeq) return;
        doctorSuggestResults = [];
      }

      // Autofill other field when we have exactly one match
      try {
        var list = doctorSuggestResults || [];
        if (list.length === 1) {
          var d = list[0] || {};
          var name = String(d.doctor_name || "");
          var reg = String(d.doctor_reg_no || "");
          if (mode === "name") {
            var cur = String(formEls.doctor_name.value || "").trim().toLowerCase();
            if (cur && name.toLowerCase().indexOf(cur) === 0) {
              var regCur = String(formEls.doctor_reg_no.value || "").trim();
              if (!regCur || (reg && reg.toLowerCase().indexOf(regCur.toLowerCase()) === 0)) {
                formEls.doctor_reg_no.value = reg;
              }
            }
          } else {
            var curR = String(formEls.doctor_reg_no.value || "").trim().toLowerCase();
            if (curR && reg.toLowerCase().indexOf(curR) === 0) {
              var nameCur = String(formEls.doctor_name.value || "").trim();
              if (!nameCur || (name && name.toLowerCase().indexOf(nameCur.toLowerCase()) === 0)) {
                formEls.doctor_name.value = name;
              }
            }
          }
        }
      } catch (e2) {}

      showDoctorSuggest(mode);
    }


    // ✅ PATCH: prefill client name/address from past DDA sales entries by ID card (create mode only)
    function scheduleClientLookup(idCard) {
      if (!ctx) return;
      if (!formEls || formEls.id) return; // create only
      var norm = normalizeMtIdCard(idCard);
      if (!norm) return;
      // Only auto-lookup when we have a full Maltese ID card format: 7 digits + 1 letter
      if (!/^\d{7}[A-Z]$/.test(norm)) return;

      if (clientLookupTimer) { try { ctx.win.clearTimeout(clientLookupTimer); } catch (e) {} }
      clientLookupTimer = ctx.win.setTimeout(function () {
        lookupClientByIdCard(norm);
      }, 250);
    }

    async function lookupClientByIdCard(idCard) {
      if (!ctx) return;
      if (!formEls || formEls.id) return; // create only
      var norm = normalizeMtIdCard(idCard);
      if (!norm) return;
      var seq = ++clientLookupSeq;
      try {
        var data = await apiJson(ctx.win, "/dda-sales/client?client_id_card=" + encodeURIComponent(norm), { method: "GET" });
        if (seq !== clientLookupSeq) return;
        if (data && data.ok === true && data.found) {
          // Populate (user can overwrite afterwards if needed)
          formEls.client_name.value = String(data.client_name || "");
          formEls.client_address.value = String(data.client_address || "");
        }
      } catch (e) {
        // silent; we don't want noisy errors while typing
      }
    }


    function setReportMsg(kind, text) {
      if (!reportMsg) return;
      reportMsg.className = "eikon-dda-msg " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
      reportMsg.textContent = String(text || "");
      reportMsg.style.display = text ? "block" : "none";
    }

    function setReportDefaultsForMonth(m) {
      var r = monthStartEnd(m);
      if (!r) return;
      state.report_from = r.from;
      state.report_to = r.to;
      if (reportFromInput) reportFromInput.value = r.from;
      if (reportToInput) reportToInput.value = r.to;
    }

    function renderRows() {
      if (!tableBody || !ctx) return;
      tableBody.innerHTML = "";
      var list = state.entries || [];
      if (!list.length) {
        var trEmpty = el(ctx.doc, "tr", {}, [el(ctx.doc, "td", { colspan: "11", html: "No entries for this month." }, [])]);
        tableBody.appendChild(trEmpty);
        return;
      }
      for (var i = 0; i < list.length; i++) {
        (function (row) {
          var tr = el(ctx.doc, "tr", {}, [
            el(ctx.doc, "td", { text: String(row.entry_date || "") }, []),
            el(ctx.doc, "td", { text: String(row.client_name || "") }, []),
            el(ctx.doc, "td", { text: String(row.client_id_card || "") }, []),
            el(ctx.doc, "td", { text: String(row.client_address || "") }, []),
            el(ctx.doc, "td", { text: String(row.medicine_name_dose || "") }, []),
            el(ctx.doc, "td", { text: String(row.quantity == null ? "" : row.quantity) }, []),
            el(ctx.doc, "td", { text: String(row.doctor_name || "") }, []),
            el(ctx.doc, "td", { text: String(row.doctor_reg_no || "") }, []),
            el(ctx.doc, "td", { text: String(row.prescription_serial_no || "") }, []),
            (function(){ var tdel = el(ctx.doc, "td", {}, []); try { if (row && (row.urgent === 1 || row.urgent === true || String(row.urgent || "").toLowerCase() === "true")) { tdel.appendChild(el(ctx.doc, "span", { class: "eikon-dda-urgent-pill", text: "URGENT" }, [])); } } catch (e3) {} return tdel; })(),
            el(ctx.doc, "td", {}, []),
          ]);
          // ✅ PATCH: highlight early supply (<30 days) for same client + medicine
          try {
            var earlyMap = state.early_by_id || {};
            if (row && row.id != null && earlyMap[String(row.id)]) {
              tr.style.backgroundColor = "rgba(255, 90, 90, 0.22)";
              tr.style.borderLeft = "4px solid rgba(255, 120, 120, 0.85)";
              tr.title = "Early supply: same client + medicine within 30 days";
            }
          } catch (e) {}
          var actionsTd = tr.lastChild;
          var actions = el(ctx.doc, "div", { class: "eikon-dda-actions" }, []);
          var edit = el(ctx.doc, "button", { type: "button", class: "eikon-dda-action-btn", text: "Edit" }, []);
          edit.onclick = function (ev) { try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {} openModalForEdit(row); };
          var del = el(ctx.doc, "button", { type: "button", class: "eikon-dda-action-btn danger", text: "Delete" }, []);
          del.onclick = function (ev2) { try { if (ev2) { ev2.preventDefault(); ev2.stopPropagation(); } } catch (e2) {} doDelete(row, false); };
          actions.appendChild(edit);
          actions.appendChild(del);
          actionsTd.appendChild(actions);
          tableBody.appendChild(tr);
        })(list[i]);
      }
    }

    async function refresh() {
      if (!ctx) return;
      setMsg("", "");
      setLoading(true);
      var month = String(state.month || "").trim();
      if (!isYm(month)) month = todayYm();
      var url = "/dda-sales/entries?month=" + encodeURIComponent(month);
      var q = String(state.q || "").trim();
      if (q) url += "&q=" + encodeURIComponent(q);
      url += "&_ts=" + Date.now();
      try {
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        state.entries = Array.isArray(data.entries) ? data.entries : [];
        state.early_by_id = await computeEarlyByIdForMonth(month, state.entries);
        renderRows();
        setLoading(false);
      } catch (e) {
        setLoading(false);
        state.entries = [];
        state.early_by_id = {};
        renderRows();
        var msg = e && e.message ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setMsg("err", msg);
        warn("refresh failed:", e);
      }
    }

    function validateReportRange(from, to) {
      from = String(from || "").trim();
      to = String(to || "").trim();
      if (!isYmd(from) || !isYmd(to)) return { ok: false, error: "Invalid from/to (YYYY-MM-DD)" };
      if (to < from) return { ok: false, error: "to must be >= from" };
      return { ok: true, from: from, to: to };
    }

    function groupEntriesByMonth(entries) {
      var byMonth = new Map();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i] || {};
        var ym = ymFromYmd(e.entry_date);
        if (!byMonth.has(ym)) byMonth.set(ym, []);
        byMonth.get(ym).push(e);
      }
      return byMonth;
    }

    function renderReportPreview() {
      if (!reportPreview || !ctx) return;
      reportPreview.innerHTML = "";
      if (!state.report || state.report.ok !== true) {
        reportPreview.appendChild(el(ctx.doc, "div", { class: "eikon-dda-hint", html: "No report generated yet." }, []));
        return;
      }
      var data = state.report;
      var entries = Array.isArray(data.entries) ? data.entries : [];
      var earlyById = computeEarlyById(entries);
      if (!entries.length) {
        reportPreview.appendChild(el(ctx.doc, "div", { class: "eikon-dda-hint", html: "Report has no entries for the selected date range." }, []));
        return;
      }

      var byMonth = groupEntriesByMonth(entries);
      var monthKeys = Array.from(byMonth.keys()).sort();

      for (var mi = 0; mi < monthKeys.length; mi++) {
        var ym = monthKeys[mi];
        var list = byMonth.get(ym) || [];
        reportPreview.appendChild(el(ctx.doc, "h3", { text: ym, style: "margin:14px 0 8px 0;font-size:14px;font-weight:1000;" }, []));

        var tableWrap = el(ctx.doc, "div", { class: "eikon-dda-table-wrap" }, []);
        var table = el(ctx.doc, "table", { class: "eikon-dda-table", style: "min-width:1100px;" }, []);
        var thead = el(ctx.doc, "thead", {}, []);
        thead.appendChild(
          el(ctx.doc, "tr", {}, [
            el(ctx.doc, "th", { text: "Date" }, []),
            el(ctx.doc, "th", { text: "Client Name" }, []),
            el(ctx.doc, "th", { text: "ID Card" }, []),
            el(ctx.doc, "th", { text: "Address" }, []),
            el(ctx.doc, "th", { text: "Medicine Name & Dose" }, []),
            el(ctx.doc, "th", { text: "Qty" }, []),
            el(ctx.doc, "th", { text: "Doctor Name" }, []),
            el(ctx.doc, "th", { text: "Doctor Reg No." }, []),
            el(ctx.doc, "th", { text: "Prescription Serial No." }, []),
            el(ctx.doc, "th", { text: "Urgent" }, []),
          ])
        );
        table.appendChild(thead);

        var tbody = el(ctx.doc, "tbody", {}, []);
        for (var i = 0; i < list.length; i++) {
          var r = list[i] || {};
                    var tr = el(ctx.doc, "tr", {}, [
              el(ctx.doc, "td", { text: String(r.entry_date || "") }, []),
              el(ctx.doc, "td", { text: String(r.client_name || "") }, []),
              el(ctx.doc, "td", { text: String(r.client_id_card || "") }, []),
              el(ctx.doc, "td", { text: String(r.client_address || "") }, []),
              el(ctx.doc, "td", { text: String(r.medicine_name_dose || "") }, []),
              el(ctx.doc, "td", { text: String(r.quantity == null ? "" : r.quantity) }, []),
              el(ctx.doc, "td", { text: String(r.doctor_name || "") }, []),
              el(ctx.doc, "td", { text: String(r.doctor_reg_no || "") }, []),
              el(ctx.doc, "td", { text: String(r.prescription_serial_no || "") }, []),
              (function(){ var tdel = el(ctx.doc, "td", {}, []); try { if (r && (r.urgent === 1 || r.urgent === true || String(r.urgent || "").toLowerCase() === "true")) { tdel.appendChild(el(ctx.doc, "span", { class: "eikon-dda-urgent-pill", text: "URGENT" }, [])); } } catch (e4) {} return tdel; })(),
            ]);
          // ✅ PATCH: highlight early supply (<30 days) for same client + medicine
          try {
            if (r && r.id != null && earlyById && earlyById[String(r.id)]) {
              tr.style.backgroundColor = "rgba(255, 90, 90, 0.22)";
              tr.style.borderLeft = "4px solid rgba(255, 120, 120, 0.85)";
              tr.title = "Early supply: same client + medicine within 30 days";
            }
          } catch (e) {}
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        reportPreview.appendChild(tableWrap);
      }
    }

    async function generateReport() {
      if (!ctx) return;

      // ✅ PATCH: don’t show “Report generated. Entries: X”
      setReportMsg("", "");

      var from = reportFromInput ? reportFromInput.value : state.report_from;
      var to = reportToInput ? reportToInput.value : state.report_to;
      var vr = validateReportRange(from, to);
      if (!vr.ok) {
        setReportMsg("err", vr.error);
        return;
      }
      state.report_from = vr.from;
      state.report_to = vr.to;

      state.report_loading = true;
      setLoading(false);

      try {
        var url = "/dda-sales/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        state.report = data;

        // ✅ PATCH: keep success message hidden
        setReportMsg("", "");

        renderReportPreview();
      } catch (e) {
        state.report = null;
        renderReportPreview();
        var msg = e && e.message ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setReportMsg("err", msg);
        warn("generate report failed:", e);
      } finally {
        state.report_loading = false;
        setLoading(false);
      }
    }

    function buildPrintableHtml(reportData) {
      var data = reportData || {};
      var org = String(data.org_name || "Pharmacy");
      var loc = String(data.location_name || "");
      var from = String(data.from || "");
      var to = String(data.to || "");
      var entries = Array.isArray(data.entries) ? data.entries : [];

      var byMonth = groupEntriesByMonth(entries);
      var monthKeys = Array.from(byMonth.keys()).sort();

      var html = "";
      html += "<!doctype html><html><head><meta charset='utf-8'>";
      html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
      html += "<title>DDA Sales Report</title>";
      html +=
        "<style>" +
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}" +
        "h1{margin:0 0 6px 0;font-size:18px;}" +
        ".meta{color:#333;font-size:12px;margin-bottom:12px;}" +
        "table{width:100%;border-collapse:collapse;margin:8px 0 14px 0;}" +
        "th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top;}" +
        "th{background:#f5f5f5;text-align:left;}" +
        "@media print{button{display:none!important;}}" +
        "</style>";
      html += "</head><body>";
      html += "<button onclick='window.print()' style='position:fixed;right:14px;top:14px;padding:8px 10px;font-weight:800;'>Print</button>";
      html += "<h1>" + escapeHtml(org) + " — DDA Sales Report</h1>";
      html += "<div class='meta'>" + (loc ? "Location: " + escapeHtml(loc) + "<br>" : "") + "Range: " + escapeHtml(from) + " to " + escapeHtml(to) + "</div>";

      if (!entries.length) {
        html += "<p>No entries for the selected date range.</p>";
      } else {
        for (var mi = 0; mi < monthKeys.length; mi++) {
          var ym = monthKeys[mi];
          var list = byMonth.get(ym) || [];
          html += "<h2 style='font-size:14px;margin:10px 0 6px 0;'>" + escapeHtml(ym) + "</h2>";
          html += "<table><thead><tr>";
          html +=
            "<th>Date</th><th>Client Name</th><th>ID Card</th><th>Address</th><th>Medicine Name & Dose</th><th>Qty</th><th>Doctor Name</th><th>Doctor Reg No.</th><th>Prescription Serial No.</th><th>Urgent</th>";
          html += "</tr></thead><tbody>";
          for (var i = 0; i < list.length; i++) {
            var r = list[i] || {};
            html += "<tr>";
            html += "<td>" + escapeHtml(r.entry_date || "") + "</td>";
            html += "<td>" + escapeHtml(r.client_name || "") + "</td>";
            html += "<td>" + escapeHtml(r.client_id_card || "") + "</td>";
            html += "<td>" + escapeHtml(r.client_address || "") + "</td>";
            html += "<td>" + escapeHtml(r.medicine_name_dose || "") + "</td>";
            html += "<td>" + escapeHtml(String(r.quantity == null ? "" : r.quantity)) + "</td>";
            html += "<td>" + escapeHtml(r.doctor_name || "") + "</td>";
            html += "<td>" + escapeHtml(r.doctor_reg_no || "") + "</td>";
            html += "<td>" + escapeHtml(r.prescription_serial_no || "") + "</td>";
            html += "<td>" + ((r && (r.urgent === 1 || r.urgent === true || String(r.urgent || "").toLowerCase() === "true")) ? "URGENT" : "") + "</td>";
            html += "</tr>";
          }
          html += "</tbody></table>";
        }
      }

      html += "<script>setTimeout(function(){try{window.print()}catch(e){}},250);</script>";
      html += "</body></html>";
      return html;
    }

    async function printReport() {
      if (!ctx) return;
      setReportMsg("", "");
      var from = reportFromInput ? reportFromInput.value : state.report_from;
      var to = reportToInput ? reportToInput.value : state.report_to;
      var vr = validateReportRange(from, to);
      if (!vr.ok) {
        setReportMsg("err", vr.error);
        return;
      }

      var canReuse = !!(state.report && state.report.ok === true && state.report.from === vr.from && state.report.to === vr.to);

      try {
        var data = null;
        if (canReuse) {
          data = state.report;
        } else {
          state.report_loading = true;
          setLoading(false);

          var url = "/dda-sales/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
          data = await apiJson(ctx.win, url, { method: "GET" });
          if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
          state.report = data;
          state.report_from = vr.from;
          state.report_to = vr.to;
          if (reportFromInput) reportFromInput.value = vr.from;
          if (reportToInput) reportToInput.value = vr.to;
          renderReportPreview();
        }

        var html = buildPrintableHtml(data);
        openPrintTabWithHtml(html);
      } catch (e) {
        var msg = e && e.message ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setReportMsg("err", msg);
        warn("print report failed:", e);
      } finally {
        state.report_loading = false;
        setLoading(false);
      }
    }

    function buildModalOnceForDoc(doc) {
      if (activeDoc === doc && modalBackdrop) return;
      activeDoc = doc;
      modalBackdrop = null;
      modalTitle = null;
      formEls = null;

      modalBackdrop = el(doc, "div", { class: "eikon-dda-modal-backdrop" }, []);
      var modal = el(doc, "div", { class: "eikon-dda-modal" }, []);
      var head = el(doc, "div", { class: "eikon-dda-modal-head" }, []);
      modalTitle = el(doc, "h3", { text: "DDA Sales Entry" }, []);
      var closeBtn = el(doc, "button", { class: "eikon-dda-btn secondary", text: "Close" }, []);
      closeBtn.onclick = function () { closeModal(); };
      head.appendChild(modalTitle);
      head.appendChild(closeBtn);

      var body = el(doc, "div", { class: "eikon-dda-modal-body" }, []);
      var grid = el(doc, "div", { class: "eikon-dda-grid" }, []);

      function field(labelText, inputEl, full) {
        var wrap = el(doc, "div", { class: "eikon-dda-field" + (full ? " full" : "") }, []);
        wrap.appendChild(el(doc, "label", { text: labelText }, []));
        wrap.appendChild(inputEl);
        return wrap;
      }

      formEls = {
        id: null,
        entry_date: el(doc, "input", { type: "date", value: "" }, []),
        client_name: el(doc, "input", { type: "text", value: "", placeholder: "Client name" }, []),
        client_id_card: el(doc, "input", { type: "text", value: "", placeholder: "ID card no." }, []),
        client_address: el(doc, "input", { type: "text", value: "", placeholder: "Client address" }, []),
        medicine_name_dose: el(doc, "input", { type: "text", value: "", placeholder: "Medicine name & dose" }, []),
        quantity: el(doc, "input", { type: "number", value: "1", min: "1", step: "1" }, []),
        doctor_name: el(doc, "input", { type: "text", value: "", placeholder: "Doctor name" }, []),
        doctor_reg_no: el(doc, "input", { type: "text", value: "", placeholder: "Doctor reg no." }, []),
        prescription_serial_no: el(doc, "input", { type: "text", value: "", placeholder: "Prescription serial no." }, []),
        urgent: el(doc, "input", { type: "checkbox" }, []),
      };

      // ✅ PATCH: Medicine hint element (shown under the field)
      medicineHintEl = el(doc, "div", {
        class: "eikon-dda-med-hint",
        style: "font-size:12px;opacity:.75;margin-top:4px;display:none;"
      }, []);

      // ✅ PATCH: enforce uppercase and Maltese-ID padding on Client ID Card
      formEls.client_id_card.oninput = function () {
        var v = String(formEls.client_id_card.value || "");
        var up = v.toUpperCase();
        if (up !== v) {
          var ss = null, se = null;
          try { ss = formEls.client_id_card.selectionStart; se = formEls.client_id_card.selectionEnd; } catch (e) { ss = null; se = null; }
          formEls.client_id_card.value = up;
          if (ss != null && se != null) { try { formEls.client_id_card.setSelectionRange(ss, se); } catch (e2) {} }
        }
        // If it looks like a Maltese ID card (1-7 digits + 1 letter), pad it immediately (e.g. 789M -> 0000789M)
        var norm = normalizeMtIdCard(formEls.client_id_card.value || "");
        if (norm && norm !== String(formEls.client_id_card.value || "")) {
          formEls.client_id_card.value = norm;
          try { formEls.client_id_card.setSelectionRange(norm.length, norm.length); } catch (e3) {}
        }
        // Prefill name/address if we already know this ID (create mode only)
        if (norm) scheduleClientLookup(norm);
      };
      formEls.client_id_card.onblur = function () {
        var before = String(formEls.client_id_card.value || "");
        var norm = normalizeMtIdCard(before);
        if (norm !== before) formEls.client_id_card.value = norm;
        scheduleClientLookup(norm);
      };

      // ✅ PATCH: medicine autocomplete events
      formEls.medicine_name_dose.oninput = function () {
        updateMedicineHint();
        try { if (medicineSuggestBox && medicineSuggestBox.style.display === "block") renderMedicineSuggest(); } catch (e) {}
      };
      formEls.medicine_name_dose.onfocus = function () { showMedicineSuggest(); };
      formEls.medicine_name_dose.onclick = function () { showMedicineSuggest(); };
      formEls.medicine_name_dose.onblur = function () { hideMedicineSuggest(false); };
      formEls.medicine_name_dose.onkeydown = function (e) {
        if (!e) return;
        if (e.key === "Tab" && !e.shiftKey) {
          var cur = String(formEls.medicine_name_dose.value || "");
          var curTrim = cur.trim();
          if (!curTrim) return;
          var sug = bestMedicineSuggestion(curTrim);
          if (sug &&
              sug.toLowerCase().indexOf(curTrim.toLowerCase()) === 0 &&
              sug.toLowerCase() !== curTrim.toLowerCase()) {
            e.preventDefault();
            formEls.medicine_name_dose.value = sug;
            updateMedicineHint();
            try { if (formEls.doctor_name) formEls.doctor_name.focus(); } catch (e2) {}
          }
        }
      };

      // ✅ PATCH: doctor autocomplete events (suggest + autofill)
      formEls.doctor_name.oninput = function () { scheduleDoctorLookup("name", formEls.doctor_name.value); };
      formEls.doctor_name.onfocus = function () { showDoctorSuggest("name"); scheduleDoctorLookup("name", formEls.doctor_name.value); };
      formEls.doctor_name.onclick = function () { showDoctorSuggest("name"); scheduleDoctorLookup("name", formEls.doctor_name.value); };
      formEls.doctor_name.onblur = function () { hideDoctorSuggest(false); };
      formEls.doctor_name.onkeydown = function (e) { if (e && e.key === "Escape") hideDoctorSuggest(true); };

      formEls.doctor_reg_no.oninput = function () { scheduleDoctorLookup("reg", formEls.doctor_reg_no.value); };
      formEls.doctor_reg_no.onfocus = function () { showDoctorSuggest("reg"); scheduleDoctorLookup("reg", formEls.doctor_reg_no.value); };
      formEls.doctor_reg_no.onclick = function () { showDoctorSuggest("reg"); scheduleDoctorLookup("reg", formEls.doctor_reg_no.value); };
      formEls.doctor_reg_no.onblur = function () { hideDoctorSuggest(false); };
      formEls.doctor_reg_no.onkeydown = function (e2) { if (e2 && e2.key === "Escape") hideDoctorSuggest(true); };

      grid.appendChild(field("Entry Date", formEls.entry_date, false));
      grid.appendChild(field("Quantity", formEls.quantity, false));
      var urgentRow = el(doc, "div", { class: "eikon-dda-checkrow" }, []);
      urgentRow.appendChild(formEls.urgent);
      urgentRow.appendChild(el(doc, "span", { text: "Yes" }, []));
      grid.appendChild(field("Urgent", urgentRow, false));
      grid.appendChild(field("Client Name", formEls.client_name, true));
      grid.appendChild(field("Client ID Card", formEls.client_id_card, false));
      grid.appendChild(field("Client Address", formEls.client_address, false));
      var medField = field("Medicine Name & Dose", formEls.medicine_name_dose, true);
      // ✅ PATCH: Medicine suggestions dropdown (datalist) + Tab to accept
      try {
        var dlId = "eikon-dda-medlist";
        var dl = el(doc, "datalist", { id: dlId }, []);
        for (var i = 0; i < MEDICINE_NAME_DOSE_SUGGESTIONS.length; i++) {
          dl.appendChild(el(doc, "option", { value: MEDICINE_NAME_DOSE_SUGGESTIONS[i] }, []));
        }
        formEls.medicine_name_dose.setAttribute("list", dlId);
        medField.appendChild(dl);
      } catch (e) {}
      if (medicineHintEl) medField.appendChild(medicineHintEl);
      // ✅ PATCH: show medicine suggestions on click/focus (custom dropdown)
      try {
        medField.style.position = "relative";
        medicineSuggestBox = el(doc, "div", { class: "eikon-dda-suggestbox" }, []);
        medField.appendChild(medicineSuggestBox);
      } catch (e) {}
      grid.appendChild(medField);
      var docNameField = field("Doctor Name", formEls.doctor_name, false);
      var docRegField = field("Doctor Reg No.", formEls.doctor_reg_no, false);
      // ✅ PATCH: doctor suggestions dropdowns (from past entries)
      try {
        docNameField.style.position = "relative";
        doctorNameSuggestBox = el(doc, "div", { class: "eikon-dda-suggestbox" }, []);
        docNameField.appendChild(doctorNameSuggestBox);
      } catch (e) {}
      try {
        docRegField.style.position = "relative";
        doctorRegSuggestBox = el(doc, "div", { class: "eikon-dda-suggestbox" }, []);
        docRegField.appendChild(doctorRegSuggestBox);
      } catch (e2) {}
      grid.appendChild(docNameField);
      grid.appendChild(docRegField);
      grid.appendChild(field("Prescription Serial No.", formEls.prescription_serial_no, true));

      body.appendChild(grid);

      var footerBtns = el(doc, "div", { style: "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;" }, []);
      var deleteBtn = el(doc, "button", { type: "button", class: "eikon-dda-btn danger", text: "Delete" }, []);
      var saveBtn = el(doc, "button", { type: "button", class: "eikon-dda-btn", text: "Save" }, []);
      deleteBtn.style.display = "none";
      saveBtn.onclick = function () { doSave(); };
      deleteBtn.onclick = function () { if (!formEls.id) return; doDelete({ id: formEls.id }, true); };
      footerBtns.appendChild(deleteBtn);
      footerBtns.appendChild(saveBtn);
      body.appendChild(footerBtns);

      modal.appendChild(head);
      modal.appendChild(body);
      modalBackdrop.appendChild(modal);

      modalBackdrop.onclick = function (e) { if (e && e.target === modalBackdrop) closeModal(); };
      modalBackdrop._deleteBtn = deleteBtn;

      try { (doc.body || doc.documentElement).appendChild(modalBackdrop); } catch (e1) {}
    }

    function openModal() { if (modalBackdrop) modalBackdrop.style.display = "flex"; }
    function closeModal() { if (modalBackdrop) modalBackdrop.style.display = "none"; }

    function openModalForCreate() {
      if (!ctx) return;
      buildModalOnceForDoc(ctx.doc);
      var d = new Date();
      var ymd = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
      formEls.id = null;
      modalTitle.textContent = "New DDA Sales Entry";
      formEls.entry_date.value = ymd;
      formEls.client_name.value = "";
      formEls.client_id_card.value = "";
      formEls.client_address.value = "";
      formEls.medicine_name_dose.value = "";
      formEls.quantity.value = "1";
      formEls.doctor_name.value = "";
      formEls.doctor_reg_no.value = "";
      formEls.prescription_serial_no.value = "";
      if (formEls.urgent) formEls.urgent.checked = false;
      clientLookupSeq = 0;
      if (medicineHintEl) { medicineHintEl.style.display = "none"; medicineHintEl.textContent = ""; }
      medicineCurrentSuggestion = "";
      updateMedicineHint();
      try { if (medicineSuggestBox) medicineSuggestBox.style.display = "none"; } catch (e) {}
      hideDoctorSuggest(true);
      if (modalBackdrop && modalBackdrop._deleteBtn) modalBackdrop._deleteBtn.style.display = "none";
      openModal();
    }

    function openModalForEdit(row) {
      if (!ctx) return;
      buildModalOnceForDoc(ctx.doc);
      formEls.id = row && row.id != null ? Number(row.id) : null;
      modalTitle.textContent = "Edit DDA Sales Entry";
      formEls.entry_date.value = String(row.entry_date || "");
      formEls.client_name.value = String(row.client_name || "");
      formEls.client_id_card.value = normalizeMtIdCard(String(row.client_id_card || ""));
      formEls.client_address.value = String(row.client_address || "");
      formEls.medicine_name_dose.value = String(row.medicine_name_dose || "");
      formEls.quantity.value = String(row.quantity == null ? "1" : row.quantity);
      formEls.doctor_name.value = String(row.doctor_name || "");
      formEls.doctor_reg_no.value = String(row.doctor_reg_no || "");
      formEls.prescription_serial_no.value = String(row.prescription_serial_no || "");
      if (formEls.urgent) formEls.urgent.checked = !!(row && (row.urgent === 1 || row.urgent === true || String(row.urgent || "").toLowerCase() === "true"));
      if (medicineHintEl) { medicineHintEl.style.display = "none"; medicineHintEl.textContent = ""; }
      medicineCurrentSuggestion = "";
      updateMedicineHint();
      try { if (medicineSuggestBox) medicineSuggestBox.style.display = "none"; } catch (e) {}
      hideDoctorSuggest(true);
      if (modalBackdrop && modalBackdrop._deleteBtn) modalBackdrop._deleteBtn.style.display = "inline-block";
      openModal();
    }

    function validateFormPayload() {
      var entry_date = String(formEls.entry_date.value || "").trim();
      var client_name = String(formEls.client_name.value || "").trim();
      var client_id_card_raw = String(formEls.client_id_card.value || "").trim();
      var client_id_card = normalizeMtIdCard(client_id_card_raw);
      if (client_id_card && client_id_card !== client_id_card_raw) formEls.client_id_card.value = client_id_card;
      var client_address = String(formEls.client_address.value || "").trim();
      var medicine_name_dose = String(formEls.medicine_name_dose.value || "").trim();
      var quantity = toIntSafe(formEls.quantity.value);
      var doctor_name = String(formEls.doctor_name.value || "").trim();
      var doctor_reg_no = String(formEls.doctor_reg_no.value || "").trim();
      var prescription_serial_no = String(formEls.prescription_serial_no.value || "").trim();
      var urgent = formEls.urgent && !!formEls.urgent.checked ? 1 : 0;

      if (!isYmd(entry_date)) return { ok: false, error: "Invalid entry_date (YYYY-MM-DD)" };
      if (!client_name) return { ok: false, error: "Missing client_name" };
      if (!client_id_card) return { ok: false, error: "Missing client_id_card" };
      if (!client_address) return { ok: false, error: "Missing client_address" };
      if (!medicine_name_dose) return { ok: false, error: "Missing medicine_name_dose" };
      if (!quantity || quantity < 1) return { ok: false, error: "Invalid quantity (must be >= 1)" };
      if (!doctor_name) return { ok: false, error: "Missing doctor_name" };
      if (!doctor_reg_no) return { ok: false, error: "Missing doctor_reg_no" };
      if (!prescription_serial_no) return { ok: false, error: "Missing prescription_serial_no" };

      return {
        ok: true,
        payload: {
          entry_date: entry_date,
          client_name: client_name,
          client_id_card: client_id_card,
          client_address: client_address,
          medicine_name_dose: medicine_name_dose,
          quantity: quantity,
          doctor_name: doctor_name,
          doctor_reg_no: doctor_reg_no,
          prescription_serial_no: prescription_serial_no,
          urgent: urgent,
        },
      };
    }

    async function doSave() {
      if (!ctx) return;
      setMsg("", "");
      var v = validateFormPayload();
      if (!v.ok) { setMsg("err", v.error); return; }
      setLoading(true);
      try {
        var method, path;
        if (formEls.id) { method = "PUT"; path = "/dda-sales/entries/" + encodeURIComponent(String(formEls.id)); }
        else { method = "POST"; path = "/dda-sales/entries"; }
        var data = await apiJson(ctx.win, path, { method: method, body: JSON.stringify(v.payload) });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        closeModal();
        setMsg("ok", "Saved.");
        setLoading(false);
        await refresh();
      } catch (e) {
        setLoading(false);
        var msg = e && e.message ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setMsg("err", msg);
        warn("save failed:", e);
      }
    }

    
    async function doDelete(row, fromModal) {
      if (!ctx) return;
      setMsg("", "");
      var id = row && row.id != null ? Number(row.id) : null;
      if (!id) { setMsg("err", "Invalid entry id."); return; }
      log("delete clicked", { id: id, fromModal: !!fromModal });
      // window.confirm() is blocked inside sandboxed iframes (no allow-modals)
      var ok = await uiConfirm("Delete this DDA Sales entry?", { title: "Delete entry", confirmText: "Delete", cancelText: "Cancel", danger: true });
      if (!ok) { log("delete cancelled", { id: id }); return; }

      setMsg("info", "Deleting…");
      setLoading(true);
      var attempts = [];
      log("delete starting", { id: id });
      var data = null;

      function summarizeAttempts(list) {
        try {
          return (list || []).map(function (a) {
            if (!a) return "";
            if (a.ok) return a.name + " => ok";
            var s = a.status != null ? String(a.status) : "ERR";
            var em = a.message ? String(a.message) : "";
            return a.name + " => " + s + (em ? " (" + em + ")" : "");
          }).filter(Boolean).join(" | ");
        } catch (e) {
          return "";
        }
      }

      async function tryCall(name, path, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        // ask the API to include extra debug info in JSON responses
        try { opts.headers["X-Eikon-Debug"] = "1"; } catch (e0) {}
        try {
          log("delete request", { name: name, path: path, method: (opts && opts.method) || "GET" });
          var out = await apiJson(ctx.win, path, opts);
          attempts.push({ name: name, ok: true, status: 200, data: out });
          return out;
        } catch (e) {
          attempts.push({ name: name, ok: false, status: e && e.status != null ? e.status : null, payload: e && e.payload ? e.payload : null, message: e && e.message ? e.message : String(e || "Error") });
          throw e;
        }
      }

      try {
        // Most compatible: POST to a fixed path (works even if proxies block DELETE or path-params)
        try {
          data = await tryCall("POST /dda-sales/entries/delete", "/dda-sales/entries/delete", {
            method: "POST",
            body: JSON.stringify({ id: id })
          });
        } catch (ePostFixed) {
          data = null;
        }

        // Canonical: DELETE /dda-sales/entries/:id
        if (!data) {
          var url = "/dda-sales/entries/" + encodeURIComponent(String(id));
          try {
            data = await tryCall("DELETE " + url, url, { method: "DELETE" });
          } catch (eDel) {
            data = null;
          }
        }

        // Fallback: POST /dda-sales/entries/:id/delete
        if (!data) {
          var url2 = "/dda-sales/entries/" + encodeURIComponent(String(id)) + "/delete";
          try {
            data = await tryCall("POST " + url2, url2, { method: "POST" });
          } catch (ePost) {
            data = null;
          }
        }

        if (!data || data.ok !== true) {
          var errMsg = data && data.error ? String(data.error) : "Delete failed.";
          var err = new Error(errMsg);
          err.attempts = attempts;
          throw err;
        }

        // Extra safety: if debug info says 0 rows changed, treat as failure
        try {
          if (data && data.debug && data.debug.changes === 0) {
            var err2 = new Error("Delete reported 0 rows changed.");
            err2.attempts = attempts;
            throw err2;
          }
        } catch (eDbg) {
          throw eDbg;
        }

        if (fromModal) closeModal();
        setMsg("ok", "Deleted.");
        setLoading(false);
        await refresh();
      } catch (e) {
        setLoading(false);
        var msg = e && e.message ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        var at = e && e.attempts ? e.attempts : attempts;
        var extra = summarizeAttempts(at);
        if (extra) msg += "\n\nDebug: " + extra;
        setMsg("err", msg);
        warn("delete failed:", e, { attempts: at });
      }
    }

function renderInto(container) {
      ctx = resolveRenderContext(container);
      if (!ctx || !ctx.doc || !ctx.win || !ctx.mount) return;

      try {
        ensureStyleOnce(ctx.doc);
        ctx.mount.innerHTML = "";

        if (!state.report_from || !state.report_to) setReportDefaultsForMonth(state.month);

        var wrap = el(ctx.doc, "div", { class: "eikon-dda-wrap" }, []);
        var top = el(ctx.doc, "div", { class: "eikon-dda-top" }, []);

        var title = el(ctx.doc, "div", { class: "eikon-dda-title" }, []);
        title.appendChild(el(ctx.doc, "span", { class: "icon", html: ICON_SVG }, []));
        title.appendChild(el(ctx.doc, "span", { text: "DDA Sales" }, []));
        top.appendChild(title);

        var controls = el(ctx.doc, "div", { class: "eikon-dda-controls" }, []);
        var controlsTop = el(ctx.doc, "div", { class: "eikon-dda-controls-row" }, []);
        var controlsBottom = el(ctx.doc, "div", { class: "eikon-dda-controls-row" }, []);

        var monthField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        monthField.appendChild(el(ctx.doc, "label", { text: "Month" }, []));
        monthInput = el(ctx.doc, "input", { type: "month", value: state.month }, []);
        monthInput.onchange = function () {
          var m = String(monthInput.value || "").trim();
          if (isYm(m)) {
            state.month = m;
            setReportDefaultsForMonth(m);
            refresh();
          }
        };
        monthField.appendChild(monthInput);
        try { monthField.style.minWidth = "170px"; } catch (e0) {}

        var qField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        qField.appendChild(el(ctx.doc, "label", { text: "Search" }, []));
        qInput = el(ctx.doc, "input", { type: "text", value: state.q, placeholder: "Client / ID / medicine / doctor / serial…" }, []);

        // ✅ PATCH: live search (debounced)
        qInput.oninput = function () {
          state.q = String(qInput.value || "");
          if (searchTimer) { try { ctx.win.clearTimeout(searchTimer); } catch (e) {} }
          searchTimer = ctx.win.setTimeout(function () {
            if (!state.loading && !state.report_loading) refresh();
          }, 250);
        };

        qInput.onkeydown = function (e) { if (e && e.key === "Enter") refresh(); };
        qField.appendChild(qInput);
        try { qField.style.minWidth = "260px"; qField.style.flex = "1 1 320px"; } catch (e1) {}

        refreshBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Refresh" }, []);
        refreshBtn.onclick = function () { refresh(); };

        addBtn = el(ctx.doc, "button", { class: "eikon-dda-btn", text: "New Entry" }, []);
        addBtn.onclick = function () { openModalForCreate(); };

        var fromField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        fromField.appendChild(el(ctx.doc, "label", { text: "From" }, []));
        reportFromInput = el(ctx.doc, "input", { type: "date", value: state.report_from }, []);
        reportFromInput.onchange = function () { state.report_from = String(reportFromInput.value || "").trim(); };
        fromField.appendChild(reportFromInput);
        try { fromField.style.minWidth = "170px"; } catch (e2) {}

        var toField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        toField.appendChild(el(ctx.doc, "label", { text: "To" }, []));
        reportToInput = el(ctx.doc, "input", { type: "date", value: state.report_to }, []);
        reportToInput.onchange = function () { state.report_to = String(reportToInput.value || "").trim(); };
        toField.appendChild(reportToInput);
        try { toField.style.minWidth = "170px"; } catch (e3) {}

        generateBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Generate" }, []);
        generateBtn.onclick = function () { generateReport(); };

        printBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Print" }, []);
        printBtn.onclick = function () { printReport(); };

        controlsTop.appendChild(monthField);
        controlsTop.appendChild(qField);
        controlsTop.appendChild(refreshBtn);
        controlsTop.appendChild(addBtn);

        // keep From/To/Generate/Print on the same line
        controlsBottom.appendChild(fromField);
        controlsBottom.appendChild(toField);
        controlsBottom.appendChild(generateBtn);
        controlsBottom.appendChild(printBtn);

        controls.appendChild(controlsTop);
        controls.appendChild(controlsBottom);

        top.appendChild(controls);
wrap.appendChild(top);

        msgBox = el(ctx.doc, "div", { class: "eikon-dda-msg", text: "" }, []);
        msgBox.style.display = "none";
        wrap.appendChild(msgBox);

        // Entries card
        var card = el(ctx.doc, "div", { class: "eikon-dda-card" }, []);

        // ✅ PATCH: replace “Endpoints...” with a proper header "Entries"
        var cardHead = el(ctx.doc, "div", { class: "eikon-dda-card-head" }, []);
        cardHead.appendChild(el(ctx.doc, "h3", { text: "Entries" }, []));
        card.appendChild(cardHead);

        var tableWrap = el(ctx.doc, "div", { class: "eikon-dda-table-wrap" }, []);
        var table = el(ctx.doc, "table", { class: "eikon-dda-table" }, []);
        var thead = el(ctx.doc, "thead", {}, []);
        thead.appendChild(
          el(ctx.doc, "tr", {}, [
            el(ctx.doc, "th", { text: "Date" }, []),
            el(ctx.doc, "th", { text: "Client" }, []),
            el(ctx.doc, "th", { text: "ID Card" }, []),
            el(ctx.doc, "th", { text: "Address" }, []),
            el(ctx.doc, "th", { text: "Medicine (name & dose)" }, []),
            el(ctx.doc, "th", { text: "Qty" }, []),
            el(ctx.doc, "th", { text: "Doctor" }, []),
            el(ctx.doc, "th", { text: "Reg No." }, []),
            el(ctx.doc, "th", { text: "Prescription Serial No." }, []),
            el(ctx.doc, "th", { text: "Urgent" }, []),
            el(ctx.doc, "th", { text: "Actions" }, []),
          ])
        );
        table.appendChild(thead);
        tableBody = el(ctx.doc, "tbody", {}, []);
        table.appendChild(tableBody);
        tableWrap.appendChild(table);
        card.appendChild(tableWrap);
        wrap.appendChild(card);

        // Report preview card
        var reportCard = el(ctx.doc, "div", { class: "eikon-dda-card", style: "margin-top:12px;" }, []);

        // ✅ PATCH: remove “Report preview is generated client-side ...” text
        var reportHead = el(ctx.doc, "div", { class: "eikon-dda-card-head" }, []);
        reportHead.appendChild(el(ctx.doc, "h3", { text: "Report" }, []));
        reportCard.appendChild(reportHead);

        reportMsg = el(ctx.doc, "div", { class: "eikon-dda-msg", text: "" }, []);
        reportMsg.style.display = "none";
        reportCard.appendChild(reportMsg);

        reportPreview = el(ctx.doc, "div", {}, []);
        reportCard.appendChild(reportPreview);
        wrap.appendChild(reportCard);

        ctx.mount.appendChild(wrap);

        buildModalOnceForDoc(ctx.doc);

        renderRows();
        renderReportPreview();
        refresh();
      } catch (e) {
        warn("renderInto failed:", e);
      }
    }

    return {
      id: "dda-sales",
      key: "dda-sales",
      order: 40,
      slug: "dda-sales",
      title: "DDA Sales",
      navTitle: "DDA Sales",

      // keep sidebar icon
      icon: "📈",

      iconText: "",
      iconSvg: ICON_SVG,
      iconHTML: ICON_SVG,
      navIcon: ICON_SVG,
      hash: "#dda-sales",
      route: "dda-sales",
      render: renderInto,
      mount: renderInto,
      renderInto: renderInto,
    };
  }

  function tryRegisterModule(mod) {
    if (!mod) return false;
    try {
      if (window.EIKON && typeof window.EIKON.registerModule === "function") {
        window.EIKON.registerModule(mod);
        log("registered via window.EIKON.registerModule()");
        return true;
      }
    } catch (e1) { warn("registerModule(EIKON) failed:", e1); }
    try {
      if (window.Eikon && typeof window.Eikon.registerModule === "function") {
        window.Eikon.registerModule(mod);
        log("registered via window.Eikon.registerModule()");
        return true;
      }
    } catch (e2) { warn("registerModule(Eikon) failed:", e2); }
    try {
      window.EIKON_MODULES = window.EIKON_MODULES || [];
      window.EIKON_MODULES.push(mod);
      log("registered via window.EIKON_MODULES[] fallback");
      return true;
    } catch (e3) {}
    try {
      window.EikonModules = window.EikonModules || [];
      window.EikonModules.push(mod);
      log("registered via window.EikonModules[] fallback");
      return true;
    } catch (e4) {}
    return false;
  }

  var moduleObj = buildModule();
  tryRegisterModule(moduleObj);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 0);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 200);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 1000);
  log("loaded modules.ddasales.js");
})();
