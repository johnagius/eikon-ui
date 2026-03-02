/** * DDA POYC * Endpoints expected (same shape as dda-sales): * GET /dda-poyc/entries?month=YYYY-MM&q=... * POST /dda-poyc/entries * PUT /dda-poyc/entries/:id * DELETE /dda-poyc/entries/:id * GET /dda-poyc/report?from=YYYY-MM-DD&to=YYYY-MM-DD */
(function () {
  "use strict";

  var LOG_PREFIX = "[EIKON][dda-poyc]";
  function log() {
    try {
      console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments)));
    } catch (e) {}
  }
  function warn() {
    try {
      console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  // ✅ PATCH (ICON ONLY): Use the same technique as DDA Sales (iconSvg/iconHTML/navIcon/etc),
  // but with a different icon for DDA POYC.
  var ICON_SVG =
    "" +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>' +
    '<rect x="8" y="2" width="8" height="4" rx="1"/>' +
    '<path d="m9 14 2 2 4-4"/>' +
    "</svg>";

  function pad2(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return "00";
    return (n < 10 ? "0" : "") + String(n);
  }
  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }
  function isYm(s) {
    return /^\d{4}-\d{2}$/.test(String(s || "").trim());
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
  function ymFromYmd(ymd) {
    return String(ymd || "").slice(0, 7);
  }

  // ✅ Helper: shift YYYY-MM by delta months (negative = past)
  function shiftYm(ym, deltaMonths) {
    var s = String(ym || "").trim();
    if (!isYm(s)) s = todayYm();
    var y = parseInt(s.slice(0, 4), 10);
    var m = parseInt(s.slice(5, 7), 10);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return todayYm();
    var d = new Date(y, (m - 1) + Number(deltaMonths || 0), 1);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  // ✅ Fixed medicine autosuggest list (DDA POYC)
  var POYC_MEDICINE_SUGGESTIONS = [
    "Alprazolam 0.25mg tablets",
    "Alprazolam 0.5mg tablets",
    "Bromazepam 1.5mg tablets",
    "Bromazepam 3mg tablets",
    "Bromazepam 6mg tablets",
    "Chloral Hydrate 500mg/5ml 200ml oral solution",
    "Chlordiazepoxide 5mg capsules",
    "Clobazam 10mg tablets",
    "Clonazepam 0.5mg scored tablets",
    "Clonazepam 0.5mg/5ml oral solution",
    "Clonazepam 2.5mg/5ml oral solution",
    "Clonazepam 2mg cross scored tablets",
    "Dexamfetamine Sulphate 5mg tablets",
    "Diazepam 10mg/2ml injections",
    "Diazepam 2mg tablets",
    "Diazepam 5mg tablets",
    "Diazepam rectal tubes 10mg/2.5ml",
    "Diazepam rectal tubes 5mg/2.5ml",
    "Diazepam syrup 2mg/5ml",
    "Fentanyl 25mcg/hour transdermal patches",
    "Fentanyl 50mcg/hour transdermal patches",
    "Lorazepam 1mg tablets",
    "Lorazepam 2mg tablets",
    "Lormetazepam 1mg tablets",
    "Methylphenidate 10mg tablets",
    "Methylphenidate 18mg PR tablets",
    "Methylphenidate 27mg PR tablets",
    "Methylphenidate 36mg PR tablets",
    "Midazolam 10mg 2ml IV injections",
    "Midazolam 10mg 5ml IV injections",
    "Morphine 10mg/ml 1ml injections IV/SC",
    "Morphine Sulphate 10mg/5ml solution",
    "Morphine Sulphate 10mg SR tablets",
    "Morphine Sulphate 30mg SR tablets",
    "Morphine Sulphate 60mg SR tablets",
    "Morphine Sulphate 100mg SR tablets",
    "Morphine Sulphate 15mg 1ml injections IV/SC",
    "Morphine Sulphate 20mg/ml injections",
    "Morphine Sulphate 30mg/ml 1ml injections",
    "Nitrazepam 2.5mg/5ml solution",
    "Nitrazepam 5mg tablets",
    "Pethidine Hydrochloride 50mg tablets",
    "Pethidine Hydrochloride 50mg/ml injections",
    "Pethidine Hydrochloride 100mg/2ml injections",
    "Phenobarbital 30mg tablets",
    "Phenobarbitone Sodium 25g - 50g powder crystalline",
    "Temazepam 10mg tablets",
    "Tramadol 50mg capsules"
  ];

  function isWindowLike(x) {
    try {
      return !!(x && x.window === x && x.document && x.document.nodeType === 9);
    } catch (e) {
      return false;
    }
  }
  function findBestMountInDocument(doc) {
    if (!doc) return null;
    var ids = ["eikon-module-root", "module-root", "app", "root", "eikon-root", "content", "main"];
    for (var i = 0; i < ids.length; i++) {
      var el0 = null;
      try {
        el0 = doc.getElementById(ids[i]);
      } catch (e) {
        el0 = null;
      }
      if (el0 && el0.nodeType === 1) return el0;
    }
    try {
      var q = doc.querySelector("[data-module-root='1'], [data-module-root='true']");
      if (q && q.nodeType === 1) return q;
    } catch (e2) {}
    try {
      if (doc.body && doc.body.nodeType === 1) return doc.body;
    } catch (e3) {}
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
        else if (k === "style") node.setAttribute("style", attrs[k]);
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
    // Reuse the exact styling class names used by dda-sales so it looks identical.
    var id = "eikon-dda-sales-style";
    try {
      if (doc.getElementById(id)) return;
    } catch (e) {}
    var css =
      "" +
      ".eikon-dda-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;width:100%;margin:0;padding:16px;box-sizing:border-box;}.eikon-dda-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:12px;align-items:start;}.eikon-dda-span-all{grid-column:1 / -1;}.eikon-dda-topbar{grid-column:1 / -1;display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;align-items:start;}.eikon-dda-topcard{grid-column:1 / -1;}.eikon-dda-topgrid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;align-items:end;}@media(max-width:980px){.eikon-dda-topgrid{grid-template-columns:1fr;}}.eikon-dda-topgrid .eikon-dda-controls{justify-content:flex-start;}@media(max-width:980px){.eikon-dda-topbar{grid-template-columns:1fr;}}@media(max-width:980px){.eikon-dda-layout{grid-template-columns:1fr;}}.eikon-dda-main{min-width:0;}.eikon-dda-side{min-width:0;}.eikon-dda-controls.vertical{flex-direction:column;align-items:stretch;}.eikon-dda-controls.vertical .eikon-dda-btn{width:100%;}.eikon-dda-report-layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:12px;align-items:start;}@media(max-width:980px){.eikon-dda-report-layout{grid-template-columns:1fr;}}" +
      ".eikon-dda-top{display:flex;flex-wrap:wrap;gap:10px;align-items:end;justify-content:space-between;margin-bottom:12px;}" +
      ".eikon-dda-title{font-size:18px;font-weight:900;margin:0;display:flex;align-items:center;gap:10px;color:var(--text,#e9eef7);}" +
      ".eikon-dda-title .icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;color:var(--text,#e9eef7);opacity:.95;}" +
      ".eikon-dda-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;}" +
      ".eikon-dda-field{display:flex;flex-direction:column;gap:4px;}" +
      ".eikon-dda-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +
      ".eikon-dda-field input,.eikon-dda-field textarea{padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;font-size:14px;background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;transition:border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;}" +
      ".eikon-dda-field input:hover,.eikon-dda-field textarea:hover{border-color:rgba(255,255,255,.18);}" +
      ".eikon-dda-field input:focus,.eikon-dda-field textarea:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);}" +
      ".eikon-dda-field textarea{min-height:64px;resize:vertical;}" +
      ".eikon-dda-btn{padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(20,32,48,.62);color:var(--text,#e9eef7);font-weight:900;cursor:pointer;box-shadow:0 10px 24px rgba(0,0,0,.14);transition:transform 120ms ease, border-color 120ms ease, background 120ms ease;}" +
      ".eikon-dda-btn:hover{border-color:rgba(58,160,255,.35);background:rgba(24,38,56,.70);}" +
      ".eikon-dda-btn:active{transform:translateY(1px);}" +
      ".eikon-dda-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:none;}" +
      ".eikon-dda-btn.secondary{background:rgba(16,24,36,.34);}" +
      ".eikon-dda-btn.secondary:hover{border-color:rgba(255,255,255,.18);background:rgba(16,24,36,.44);}" +
      ".eikon-dda-btn.danger{background:rgba(255,77,79,.12);border-color:rgba(255,77,79,.42);}" +
      ".eikon-dda-btn.danger:hover{background:rgba(255,77,79,.16);border-color:rgba(255,77,79,.60);}" +
      ".eikon-dda-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:12px;background:var(--panel,rgba(16,24,36,.66));box-shadow:0 18px 50px rgba(0,0,0,.38);backdrop-filter:blur(10px);}" +
      ".eikon-dda-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".eikon-dda-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      ".eikon-dda-msg{margin:10px 0;padding:10px 12px;border-radius:14px;border:1px solid var(--line,rgba(255,255,255,.10));background:rgba(16,24,36,.52);color:var(--text,#e9eef7);white-space:pre-line;}" +
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
      ".eikon-dda-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.58);display:none;align-items:center;justify-content:center;padding:16px;z-index:9999;}" +
      ".eikon-dda-modal{width:100%;max-width:860px;background:rgba(16,24,36,.98);border-radius:16px;border:1px solid var(--line,rgba(255,255,255,.10));box-shadow:0 28px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);}" +
      ".eikon-dda-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.10));}" +
      ".eikon-dda-modal-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      ".eikon-dda-modal-body{padding:14px;}" +
      ".eikon-dda-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
      ".eikon-dda-grid .full{grid-column:1 / -1;}" +
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
    // identical strategy to dda-sales
    var candidates = [];
    try {
      if (window && window !== win) candidates.push(window);
    } catch (e) {}
    candidates.push(win || window);

    for (var c = 0; c < candidates.length; c++) {
      var W = candidates[c];
      if (!W) continue;

      try {
        if (W.EIKON && typeof W.EIKON.getToken === "function") {
          var t = W.EIKON.getToken();
          if (t) return String(t);
        }
      } catch (e1) {}
      try {
        if (W.Eikon && typeof W.Eikon.getToken === "function") {
          var t2 = W.Eikon.getToken();
          if (t2) return String(t2);
        }
      } catch (e2) {}
      try {
        if (W.EIKON && W.EIKON.state && W.EIKON.state.token) return String(W.EIKON.state.token);
      } catch (e3) {}
      try {
        if (W.Eikon && W.Eikon.state && W.Eikon.state.token) return String(W.Eikon.state.token);
      } catch (e4) {}

      var keys = ["eikon_token", "EIKON_TOKEN", "token", "auth_token", "session_token"];
      for (var i = 0; i < keys.length; i++) {
        try {
          var v = W.localStorage && W.localStorage.getItem(keys[i]);
          if (v && String(v).trim()) return String(v).trim();
        } catch (e5) {}
      }
      for (var j = 0; j < keys.length; j++) {
        try {
          var v2 = W.sessionStorage && W.sessionStorage.getItem(keys[j]);
          if (v2 && String(v2).trim()) return String(v2).trim();
        } catch (e6) {}
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

    var res = await fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body != null ? opts.body : undefined,
    });

    var ct = (res.headers.get("Content-Type") || "").toLowerCase();
    var data = null;
    if (ct.indexOf("application/json") >= 0) {
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
    } else {
      try {
        data = await res.text();
      } catch (e2) {
        data = null;
      }
    }
    if (!res.ok) throw makeHttpError(res.status, data);
    return data;
  }

  function openPrintTabWithHtml(html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var w = null;
    try {
      w = window.open(url, "_blank", "noopener");
    } catch (e) {
      w = null;
    }
    if (!w) {
      try {
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e2) {}
    }
    setTimeout(function () {
      try {
        URL.revokeObjectURL(url);
      } catch (e3) {}
    }, 60000);
  }

  function buildModule() {
    var state = {
      month: todayYm(),
      q: "",
      loading: false,
      entries: [],
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
    var addBtn = null;
    var refreshBtn = null;

    var reportFromInput = null;
    var reportToInput = null;
    var generateBtn = null;
    var printBtn = null;
    var reportMsg = null;
    var reportPreview = null;

    var modalBackdrop = null;
    var modalTitle = null;
    var formEls = null;
    var modalSaveBtn = null;
    var modalOnSave = null;

    // live search debounce (same behavior as dda-sales)
    var searchTimer = null;

    // ✅ PATCH: preserve search focus/caret across loading toggles
    var qFocusRestore = null;


    // ✅ Autosuggest (clients + medicines) — keeps UI the same, just adds type-ahead.
    var _suggestUi = null;
    var _suggestSeq = 0;
    // ✅ Client autosuggest cache/index for speed
    // We build a local "recent clients" index from:
    //  1) whatever months we already loaded (table refresh),
    //  2) any months we queried for autosuggest.
    // This makes suggestions instant after the first few lookups, and reduces cloud calls.
    var _clientIndex = [];
    var _clientIndexMap = Object.create(null); // key -> client object
    var _clientSearchCache = Object.create(null); // qNorm -> { ts, items }
    var _clientSearchInFlight = Object.create(null); // qNorm -> Promise
    var _CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;

    // ✅ Doctor autosuggest cache/index for speed
    var _doctorIndex = [];
    var _doctorIndexMap = Object.create(null); // key -> doctor object
    var _doctorSearchCache = Object.create(null); // qNorm -> { ts, items }
    var _doctorSearchInFlight = Object.create(null); // qNorm -> Promise
    var _DOCTOR_CACHE_TTL_MS = 10 * 60 * 1000;

    function _ymdToInt(s) {
      var v = String(s || "").trim();
      if (!isYmd(v)) return 0;
      try {
        return parseInt(v.replace(/-/g, ""), 10) || 0;
      } catch (e) {
        return 0;
      }
    }

    function upsertClientFromEntry(r) {
      r = r || {};
      var name = String(r.client_name || "").trim();
      var idc = String(r.client_id_card || "").trim();
      var addr = String(r.client_address || "").trim();
      if (!name && !idc && !addr) return;

      var key = _normKey(idc ? ("id:" + idc) : ("name:" + name));
      if (!key || key === "id:" || key === "name:") return;

      var seenInt = _ymdToInt(r.entry_date) || 0;
      var existing = _clientIndexMap[key];
      if (existing) {
        if (name && !existing.client_name) existing.client_name = name;
        if (idc && !existing.client_id_card) existing.client_id_card = idc;
        if (addr && (!existing.client_address || existing.client_address.length < addr.length)) existing.client_address = addr;
        if (seenInt && seenInt >= (existing._seenInt || 0)) existing._seenInt = seenInt;
        existing._t = Date.now();
        return;
      }

      var obj = {
        client_name: name,
        client_id_card: idc,
        client_address: addr,
        _seenInt: seenInt,
        _t: Date.now(),
      };
      _clientIndexMap[key] = obj;
      _clientIndex.push(obj);
    }

    function indexClientsFromEntries(entries) {
      if (!entries || !entries.length) return;
      for (var i = 0; i < entries.length; i++) upsertClientFromEntry(entries[i]);
    }

    function buildClientSuggestion(c) {
      c = c || {};
      var name = String(c.client_name || "").trim();
      var idc = String(c.client_id_card || "").trim();
      var addr = String(c.client_address || "").trim();
      var secondaryParts = [];
      if (idc) secondaryParts.push(idc);
      if (addr) secondaryParts.push(addr);
      return {
        kind: "client",
        primary: name || idc || addr,
        secondary: secondaryParts.join(" • "),
        client_name: name,
        client_id_card: idc,
        client_address: addr,
      };
    }

    function scoreClient(c, qn) {
      var name = _normKey(c.client_name);
      var idc = _normKey(c.client_id_card);
      var addr = _normKey(c.client_address);

      if (idc && idc.indexOf(qn) === 0) return 0;
      if (name && name.indexOf(qn) === 0) return 1;
      if (idc && idc.indexOf(qn) !== -1) return 2;
      if (name && name.indexOf(qn) !== -1) return 3;
      if (addr && addr.indexOf(qn) !== -1) return 4;
      return 99;
    }

    function findClientsInIndex(qn, limit) {
      var out = [];
      if (!qn) return out;

      for (var i = 0; i < _clientIndex.length; i++) {
        var c = _clientIndex[i];
        if (!c) continue;
        var s = scoreClient(c, qn);
        if (s === 99) continue;
        out.push({ c: c, s: s });
      }

      out.sort(function (a, b) {
        if (a.s !== b.s) return a.s - b.s;
        var as = a.c && a.c._seenInt ? a.c._seenInt : 0;
        var bs = b.c && b.c._seenInt ? b.c._seenInt : 0;
        if (bs !== as) return bs - as;
        var at = a.c && a.c._t ? a.c._t : 0;
        var bt = b.c && b.c._t ? b.c._t : 0;
        return bt - at;
      });

      var items = [];
      var seen = Object.create(null);
      for (var j = 0; j < out.length && items.length < limit; j++) {
        var it = buildClientSuggestion(out[j].c);
        var k = _normKey((it.client_id_card ? "id:" + it.client_id_card : "name:" + it.client_name) || it.primary);
        if (seen[k]) continue;
        seen[k] = 1;
        items.push(it);
      }
      return items;
    }

    function mergeUniqueClientSuggestions(a, b, limit) {
      var out = [];
      var seen = Object.create(null);

      function pushList(list) {
        if (!list) return;
        for (var i = 0; i < list.length && out.length < limit; i++) {
          var it = list[i];
          if (!it) continue;
          var k = _normKey((it.client_id_card ? "id:" + it.client_id_card : "name:" + it.client_name) || it.primary);
          if (seen[k]) continue;
          seen[k] = 1;
          out.push(it);
        }
      }

      pushList(a);
      pushList(b);
      return out;
    }



    function upsertDoctorFromEntry(r) {
      r = r || {};
      var name = String(r.doctor_name || "").trim();
      var reg = String(r.doctor_reg_no || "").trim();
      if (!name && !reg) return;

      var key = _normKey(reg ? "reg:" + reg : "name:" + name);
      if (!key || key === "reg:" || key === "name:") return;

      var seenInt = _ymdToInt(r.entry_date) || 0;
      var existing = _doctorIndexMap[key];
      if (existing) {
        if (name && !existing.doctor_name) existing.doctor_name = name;
        if (reg && !existing.doctor_reg_no) existing.doctor_reg_no = reg;
        if (seenInt && seenInt >= (existing._seenInt || 0)) existing._seenInt = seenInt;
        existing._t = Date.now();
        return;
      }

      var obj = {
        doctor_name: name,
        doctor_reg_no: reg,
        _seenInt: seenInt,
        _t: Date.now(),
      };
      _doctorIndexMap[key] = obj;
      _doctorIndex.push(obj);
    }

    function indexDoctorsFromEntries(entries) {
      if (!entries || !entries.length) return;
      for (var i = 0; i < entries.length; i++) upsertDoctorFromEntry(entries[i]);
    }

    function buildDoctorSuggestion(d) {
      d = d || {};
      var name = String(d.doctor_name || "").trim();
      var reg = String(d.doctor_reg_no || "").trim();

      var primary = name || reg;
      var secondary = "";
      if (name && reg) secondary = reg;
      else if (!name && reg) secondary = "";
      else if (name && !reg) secondary = "";

      // If user typed reg, it is still useful to show reg as primary sometimes in the list,
      // but we keep primary as name when available (matches client behavior).
      return {
        kind: "doctor",
        primary: primary,
        secondary: secondary,
        doctor_name: name,
        doctor_reg_no: reg,
      };
    }

    function scoreDoctor(d, qn) {
      var name = _normKey(d.doctor_name);
      var reg = _normKey(d.doctor_reg_no);

      if (reg && reg.indexOf(qn) === 0) return 0;
      if (name && name.indexOf(qn) === 0) return 1;
      if (reg && reg.indexOf(qn) !== -1) return 2;
      if (name && name.indexOf(qn) !== -1) return 3;
      return 99;
    }

    function findDoctorsInIndex(qn, limit) {
      var out = [];
      if (!qn) return out;

      for (var i = 0; i < _doctorIndex.length; i++) {
        var d = _doctorIndex[i];
        if (!d) continue;
        var s = scoreDoctor(d, qn);
        if (s === 99) continue;
        out.push({ d: d, s: s });
      }

      out.sort(function (a, b) {
        if (a.s !== b.s) return a.s - b.s;
        var as = a.d && a.d._seenInt ? a.d._seenInt : 0;
        var bs = b.d && b.d._seenInt ? b.d._seenInt : 0;
        if (bs !== as) return bs - as;
        var at = a.d && a.d._t ? a.d._t : 0;
        var bt = b.d && b.d._t ? b.d._t : 0;
        return bt - at;
      });

      var items = [];
      var seen = Object.create(null);
      for (var j = 0; j < out.length && items.length < limit; j++) {
        var it = buildDoctorSuggestion(out[j].d);
        var k = _normKey((it.doctor_reg_no ? "reg:" + it.doctor_reg_no : "name:" + it.doctor_name) || it.primary);
        if (seen[k]) continue;
        seen[k] = 1;
        items.push(it);
      }
      return items;
    }

    function mergeUniqueDoctorSuggestions(a, b, limit) {
      var out = [];
      var seen = Object.create(null);

      function pushList(list) {
        if (!list) return;
        for (var i = 0; i < list.length && out.length < limit; i++) {
          var it = list[i];
          if (!it) continue;
          var k = _normKey((it.doctor_reg_no ? "reg:" + it.doctor_reg_no : "name:" + it.doctor_name) || it.primary);
          if (seen[k]) continue;
          seen[k] = 1;
          out.push(it);
        }
      }

      pushList(a);
      pushList(b);
      return out;
    }

    function _normKey(s) {
      return String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    }

    function ensureSuggestUi() {
      if (_suggestUi && _suggestUi.root && _suggestUi.root.ownerDocument) return _suggestUi;
      if (!ctx || !ctx.doc) return null;

      var doc = ctx.doc;

      var root = doc.createElement("div");
      root.setAttribute("data-eikon-suggest", "1");
      root.style.cssText =
        "position:fixed;left:0;top:0;display:none;min-width:120px;max-width:720px;max-height:280px;overflow:auto;" +
        "background:rgba(10,16,24,.96);border:1px solid rgba(255,255,255,.14);border-radius:12px;" +
        "box-shadow:0 28px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);z-index:12050;" +
        "padding:6px;box-sizing:border-box;color:var(--text,#e9eef7);";

      var list = doc.createElement("div");
      root.appendChild(list);

      function hide() {
        try { root.style.display = "none"; } catch (e) {}
        try { list.innerHTML = ""; } catch (e2) {}
        try { root._anchor = null; root._onPick = null; } catch (e3) {}
      }

      function show(anchorEl, items, onPick) {
        if (!anchorEl || !items || !items.length) return hide();

        // position below the input (fixed, so based on viewport)
        var r = null;
        try { r = anchorEl.getBoundingClientRect(); } catch (e) { r = null; }
        if (!r) return hide();

        var left = Math.max(8, Math.min(r.left, (doc.documentElement ? doc.documentElement.clientWidth : 9999) - 8));
        var top = r.bottom + 6;
        var width = Math.max(220, Math.min(r.width, 720));

        try {
          root.style.left = left + "px";
          root.style.top = top + "px";
          root.style.width = width + "px";
        } catch (e0) {}

        list.innerHTML = "";

        for (var i = 0; i < items.length; i++) {
          (function (it) {
            var row = doc.createElement("div");
            row.style.cssText =
              "display:flex;gap:10px;align-items:flex-start;justify-content:space-between;" +
              "padding:8px 10px;border-radius:10px;cursor:pointer;" +
              "border:1px solid rgba(255,255,255,0);";

            row.onmouseenter = function () {
              row.style.background = "rgba(255,255,255,.06)";
              row.style.borderColor = "rgba(255,255,255,.10)";
            };
            row.onmouseleave = function () {
              row.style.background = "transparent";
              row.style.borderColor = "rgba(255,255,255,0)";
            };

            // prevent input blur before click
            row.onmousedown = function (ev) {
              try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e1) {}
            };

            var leftCol = doc.createElement("div");
            leftCol.style.cssText = "min-width:0;flex:1 1 auto;";
            var primary = doc.createElement("div");
            primary.style.cssText = "font-weight:900;font-size:13px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
            primary.textContent = String(it.primary || it.value || "");
            leftCol.appendChild(primary);

            if (it.secondary) {
              var secondary = doc.createElement("div");
              secondary.style.cssText = "margin-top:2px;font-size:12px;color:rgba(233,238,247,.68);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
              secondary.textContent = String(it.secondary || "");
              leftCol.appendChild(secondary);
            }

            row.appendChild(leftCol);

            row.onclick = function (ev2) {
              try { if (ev2) { ev2.preventDefault(); ev2.stopPropagation(); } } catch (e2) {}
              try { if (typeof onPick === "function") onPick(it); } catch (e3) {}
              hide();
            };

            list.appendChild(row);
          })(items[i]);
        }

        try { root._anchor = anchorEl; root._onPick = onPick; } catch (e4) {}

        try { root.style.display = "block"; } catch (e5) {}
      }

      // Hide when clicking anywhere outside
      function onDocDown(ev) {
        try {
          if (!root || root.style.display === "none") return;
          var t = ev && ev.target;
          if (!t) return;
          if (t === root || root.contains(t)) return;
          if (root._anchor && (t === root._anchor || (root._anchor.contains && root._anchor.contains(t)))) return;
          hide();
        } catch (e) {}
      }

      try {
        doc.addEventListener("mousedown", onDocDown, true);
        doc.addEventListener("touchstart", onDocDown, true);
      } catch (e6) {}

      // Hide on scroll/resize to avoid floating in wrong place
      try {
        doc.addEventListener("scroll", hide, true);
      } catch (e7) {}
      try {
        (doc.defaultView || window).addEventListener("resize", hide, true);
      } catch (e8) {}

      try { doc.body.appendChild(root); } catch (e9) {}

      _suggestUi = { root: root, list: list, show: show, hide: hide };
      return _suggestUi;
    }

    function attachSuggest(inputEl, providerFn, onPickFn, opts) {
      opts = opts || {};
      var minChars = Number.isFinite(opts.minChars) ? opts.minChars : 1;
      var debounceMs = Number.isFinite(opts.debounceMs) ? opts.debounceMs : 150;
      var limit = Number.isFinite(opts.limit) ? opts.limit : 10;

      var timer = null;

      function run() {
        if (!ctx) return;
        var ui = ensureSuggestUi();
        if (!ui) return;

        var term = String(inputEl && inputEl.value != null ? inputEl.value : "").trim();
        if (term.length < minChars) {
          ui.hide();
          return;
        }

        var seq = ++_suggestSeq;
        Promise.resolve()
          .then(function () { return providerFn(term, limit); })
          .then(function (items) {
            if (seq !== _suggestSeq) return;
            if (!items || !items.length) { ui.hide(); return; }
            ui.show(inputEl, items, function (item) { if (onPickFn) onPickFn(item); });
          })
          .catch(function () { try { ui.hide(); } catch (e) {} });
      }

      function schedule() {
        if (timer) {
          try { clearTimeout(timer); } catch (e) {}
        }
        timer = setTimeout(run, debounceMs);
      }

      try { inputEl.addEventListener("input", schedule); } catch (e1) {}
      try { inputEl.addEventListener("focus", schedule); } catch (e2) {}
      try {
        inputEl.addEventListener("keydown", function (ev) {
          if (!ev) return;
          if (ev.key === "Escape") {
            var ui = ensureSuggestUi();
            if (ui) ui.hide();
          }
        });
      } catch (e3) {}

      // allow clicking suggestion list without it disappearing instantly
      try { inputEl.addEventListener("blur", function () { setTimeout(function () { var ui = ensureSuggestUi(); if (ui) ui.hide(); }, 220); }); } catch (e4) {}
    }

    
async function suggestPoycClients(term, limit) {
      if (!ctx) return [];
      var qRaw = String(term || "").trim();
      if (!qRaw) return [];
      limit = Number.isFinite(limit) ? limit : 10;

      var qn = _normKey(qRaw);
      if (!qn) return [];

      // 1) Instant results from local index
      var local = findClientsInIndex(qn, limit);
      if (local.length >= limit || qn.length < 2) return local;

      // 2) Cache
      var now = Date.now();
      var cached = _clientSearchCache[qn];
      if (cached && cached.items && (now - cached.ts) < _CLIENT_CACHE_TTL_MS) {
        return mergeUniqueClientSuggestions(local, cached.items, limit);
      }

      // 3) De-duplicate in-flight searches for the same query
      if (_clientSearchInFlight[qn]) {
        try {
          var inflightItems = await _clientSearchInFlight[qn];
          return mergeUniqueClientSuggestions(local, inflightItems, limit);
        } catch (e0) {
          // ignore and fall through to new request
        }
      }

      var baseYm = String(state.month || "").trim();
      if (!isYm(baseYm)) baseYm = todayYm();

      // We query months in small parallel batches (fast), expanding only if needed.
      var batches = [
        [0, 1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10, 11],
        [12, 13, 14, 15, 16, 17],
      ];

      var promise = (async function () {
        for (var bi = 0; bi < batches.length; bi++) {
          var deltas = batches[bi];
          var months = [];
          for (var i = 0; i < deltas.length; i++) months.push(shiftYm(baseYm, -deltas[i]));

          var reqs = months.map(function (ym) {
            var url = "/dda-poyc/entries?month=" + encodeURIComponent(ym) + "&q=" + encodeURIComponent(qRaw);
            return apiJson(ctx.win, url, { method: "GET" }).catch(function () { return null; });
          });

          var resps = await Promise.all(reqs);

          for (var ri = 0; ri < resps.length; ri++) {
            var data = resps[ri];
            if (!data || data.ok !== true) continue;
            var entries = Array.isArray(data.entries) ? data.entries : [];
            indexClientsFromEntries(entries);
            indexDoctorsFromEntries(entries);
          }

          // After each batch, see if we have enough results now
          var itemsNow = findClientsInIndex(qn, limit);
          if (itemsNow.length >= limit) return itemsNow;

          // If query is short, don't over-fetch too much
          if (qn.length < 3) return itemsNow;
        }

        return findClientsInIndex(qn, limit);
      })();

      _clientSearchInFlight[qn] = promise;

      try {
        var items = await promise;
        _clientSearchCache[qn] = { ts: Date.now(), items: items || [] };
        return mergeUniqueClientSuggestions(local, items, limit);
      } finally {
        // Clean up in-flight record (only if still the same promise)
        try {
          if (_clientSearchInFlight[qn] === promise) delete _clientSearchInFlight[qn];
        } catch (e1) {}
      }
    }



    async function suggestPoycDoctors(term, limit) {
      if (!ctx) return [];
      var qRaw = String(term || "").trim();
      if (!qRaw) return [];
      limit = Number.isFinite(limit) ? limit : 10;

      var qn = _normKey(qRaw);
      if (!qn) return [];

      // 1) Instant results from local index
      var local = findDoctorsInIndex(qn, limit);
      if (local.length >= limit || qn.length < 2) return local;

      // 2) Cache
      var now = Date.now();
      var cached = _doctorSearchCache[qn];
      if (cached && cached.items && now - cached.ts < _DOCTOR_CACHE_TTL_MS) {
        return mergeUniqueDoctorSuggestions(local, cached.items, limit);
      }

      // 3) De-duplicate in-flight searches for the same query
      if (_doctorSearchInFlight[qn]) {
        try {
          var inflightItems = await _doctorSearchInFlight[qn];
          return mergeUniqueDoctorSuggestions(local, inflightItems, limit);
        } catch (e0) {
          // ignore and fall through
        }
      }

      var baseYm = String(state.month || "").trim();
      if (!isYm(baseYm)) baseYm = todayYm();

      // Parallel month batches (same pattern as client autosuggest)
      var batches = [
        [0, 1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10, 11],
        [12, 13, 14, 15, 16, 17],
      ];

      var promise = (async function () {
        for (var bi = 0; bi < batches.length; bi++) {
          var deltas = batches[bi];
          var months = [];
          for (var i = 0; i < deltas.length; i++) months.push(shiftYm(baseYm, -deltas[i]));

          var reqs = months.map(function (ym) {
            var url = "/dda-poyc/entries?month=" + encodeURIComponent(ym) + "&q=" + encodeURIComponent(qRaw);
            return apiJson(ctx.win, url, { method: "GET" }).catch(function () {
              return null;
            });
          });

          var resps = await Promise.all(reqs);

          for (var ri = 0; ri < resps.length; ri++) {
            var data = resps[ri];
            if (!data || data.ok !== true) continue;
            var entries = Array.isArray(data.entries) ? data.entries : [];
            indexDoctorsFromEntries(entries);
            // also warm the client index for free (helps overall UX)
            indexClientsFromEntries(entries);
          }

          var itemsNow = findDoctorsInIndex(qn, limit);
          if (itemsNow.length >= limit) return itemsNow;

          if (qn.length < 3) return itemsNow;
        }

        return findDoctorsInIndex(qn, limit);
      })();

      _doctorSearchInFlight[qn] = promise;

      try {
        var items = await promise;
        _doctorSearchCache[qn] = { ts: Date.now(), items: items || [] };
        return mergeUniqueDoctorSuggestions(local, items, limit);
      } finally {
        try {
          if (_doctorSearchInFlight[qn] === promise) delete _doctorSearchInFlight[qn];
        } catch (e1) {}
      }
    }


    function suggestPoycMedicines(term, limit) {
      var q = _normKey(term);
      if (!q) return [];
      var out = [];
      for (var i = 0; i < POYC_MEDICINE_SUGGESTIONS.length; i++) {
        var med = POYC_MEDICINE_SUGGESTIONS[i];
        if (_normKey(med).indexOf(q) !== -1) {
          out.push({ kind: "medicine", primary: med, value: med });
          if (out.length >= limit) break;
        }
      }
      return out;
    }

    function setMsg(kind, text) {
      if (!msgBox) return;
      msgBox.className = "eikon-dda-msg " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
      msgBox.textContent = String(text || "");
      msgBox.style.display = text ? "block" : "none";
    }

    function setLoading(v) {
      state.loading = !!v;
      var disabled = state.loading || state.report_loading;
      if (refreshBtn) refreshBtn.disabled = disabled;
      if (addBtn) addBtn.disabled = disabled;
      if (monthInput) monthInput.disabled = disabled;

      if (qInput) {
        // ✅ PATCH: if disabling while focused, remember caret/selection so we can restore it after loading.
        try {
          if (v && ctx && ctx.doc && ctx.doc.activeElement === qInput) {
            qFocusRestore = { s: qInput.selectionStart, e: qInput.selectionEnd };
          }
        } catch (e0) {}
        qInput.disabled = disabled;
      }

      if (generateBtn) generateBtn.disabled = disabled;
      if (printBtn) printBtn.disabled = disabled;
      if (reportFromInput) reportFromInput.disabled = disabled;
      if (reportToInput) reportToInput.disabled = disabled;

      // ✅ PATCH: restore focus/caret after re-enabling to prevent live-search blur.
      if (!v && qInput && qFocusRestore && !qInput.disabled) {
        try {
          qInput.focus();
          if (
            typeof qInput.setSelectionRange === "function" &&
            qFocusRestore.s != null &&
            qFocusRestore.e != null
          ) {
            qInput.setSelectionRange(qFocusRestore.s, qFocusRestore.e);
          }
        } catch (e1) {}
        qFocusRestore = null;
      } else if (!v) {
        qFocusRestore = null;
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
        var trEmpty = el(ctx.doc, "tr", {}, [
          el(ctx.doc, "td", { colspan: "10", html: "No entries for this filter." }, []),
        ]);
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
            el(ctx.doc, "td", {}, []),
          ]);

          var actionsTd = tr.lastChild;
          var actions = el(ctx.doc, "div", { class: "eikon-dda-actions" }, []);
          var edit = el(ctx.doc, "span", { class: "eikon-dda-link", text: "Edit" }, []);
          edit.onclick = function () {
            openModalForEdit(row);
          };
          var del = el(ctx.doc, "span", { class: "eikon-dda-link", text: "Delete" }, []);
          del.onclick = function () {
            doDelete(row);
          };
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

      var url = "/dda-poyc/entries?month=" + encodeURIComponent(month);
      var q = String(state.q || "").trim();
      if (q) url += "&q=" + encodeURIComponent(q);

      try {
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        state.entries = Array.isArray(data.entries) ? data.entries : [];
        try { indexClientsFromEntries(state.entries); } catch (e0) {}
        try { indexDoctorsFromEntries(state.entries); } catch (e1) {}
        renderRows();
        setLoading(false);
      } catch (e) {
        setLoading(false);
        state.entries = [];
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
        reportPreview.appendChild(
          el(ctx.doc, "div", { class: "eikon-dda-hint", html: "No report loaded. Click Generate." }, [])
        );
        return;
      }

      var data = state.report;
      var entries = Array.isArray(data.entries) ? data.entries : [];
      if (!entries.length) {
        reportPreview.appendChild(
          el(ctx.doc, "div", { class: "eikon-dda-hint", html: "Report has no entries for the selected date range." }, [])
        );
        return;
      }

      var byMonth = groupEntriesByMonth(entries);
      var monthKeys = Array.from(byMonth.keys()).sort();

      for (var mi = 0; mi < monthKeys.length; mi++) {
        var ym = monthKeys[mi];
        var list = byMonth.get(ym) || [];

        reportPreview.appendChild(
          el(ctx.doc, "h3", { text: ym, style: "margin:14px 0 8px 0;font-size:14px;font-weight:1000;" }, [])
        );

        var tableWrap = el(ctx.doc, "div", { class: "eikon-dda-table-wrap" }, []);
        var table = el(ctx.doc, "table", { class: "eikon-dda-table", style: "min-width:1100px;" }, []);
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
          ])
        );
        table.appendChild(thead);

        var tbody = el(ctx.doc, "tbody", {}, []);
        for (var i = 0; i < list.length; i++) {
          var r = list[i] || {};
          tbody.appendChild(
            el(ctx.doc, "tr", {}, [
              el(ctx.doc, "td", { text: String(r.entry_date || "") }, []),
              el(ctx.doc, "td", { text: String(r.client_name || "") }, []),
              el(ctx.doc, "td", { text: String(r.client_id_card || "") }, []),
              el(ctx.doc, "td", { text: String(r.client_address || "") }, []),
              el(ctx.doc, "td", { text: String(r.medicine_name_dose || "") }, []),
              el(ctx.doc, "td", { text: String(r.quantity == null ? "" : r.quantity) }, []),
              el(ctx.doc, "td", { text: String(r.doctor_name || "") }, []),
              el(ctx.doc, "td", { text: String(r.doctor_reg_no || "") }, []),
              el(ctx.doc, "td", { text: String(r.prescription_serial_no || "") }, []),
            ])
          );
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        reportPreview.appendChild(tableWrap);
      }
    }

    async function generateReport() {
      if (!ctx) return;

      // match dda-sales: keep success message hidden unless error
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
        var url = "/dda-poyc/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        state.report = data;
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
      html += "<!doctype html>";
      html += "<html>";
      html += "<head>";
      html += '<meta charset="utf-8">';
      html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
      html += "<title>DDA POYC Report</title>";
      html += "<style>";
      html += "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111;}";
      html += "h1{margin:0 0 6px 0;font-size:20px;}";
      html += ".meta{margin:0 0 16px 0;font-size:12px;color:#333;}";
      html += "h2{margin:18px 0 8px 0;font-size:14px;}";
      html += "table{width:100%;border-collapse:collapse;margin:0 0 14px 0;}";
      html += "th,td{border:1px solid #ddd;padding:6px 6px;font-size:11px;vertical-align:top;}";
      html += "th{background:#f3f5f7;text-align:left;font-weight:700;}";
      html += "@media print{body{margin:10mm;} h2{page-break-after:avoid;} table{page-break-inside:auto;} tr{page-break-inside:avoid;page-break-after:auto;}}";
      html += "</style>";
      html += "</head>";
      html += "<body>";

      html += "<h1>" + escapeHtml(org) + " — DDA POYC Report</h1>";
      html += '<div class="meta">';
      if (loc) html += "Location: " + escapeHtml(loc) + "<br>";
      html += "Range: " + escapeHtml(from) + " to " + escapeHtml(to);
      html += "</div>";

      if (!entries.length) {
        html += "<div>No entries for the selected date range.</div>";
      } else {
        for (var mi = 0; mi < monthKeys.length; mi++) {
          var ym = monthKeys[mi];
          var list = byMonth.get(ym) || [];

          html += "<h2>" + escapeHtml(ym) + "</h2>";
          html += "<table>";
          html += "<thead><tr>";
          html += "<th>Date</th>";
          html += "<th>Client</th>";
          html += "<th>ID Card</th>";
          html += "<th>Address</th>";
          html += "<th>Medicine (name &amp; dose)</th>";
          html += "<th>Qty</th>";
          html += "<th>Doctor</th>";
          html += "<th>Reg No.</th>";
          html += "<th>Prescription Serial No.</th>";
          html += "</tr></thead>";
          html += "<tbody>";

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
            html += "</tr>";
          }

          html += "</tbody></table>";
        }
      }

      html += "</body></html>";
      return html;
    }

    function openModal(title, initial, onSave) {
      if (!ctx) return;

      // IMPORTANT: modal DOM is built once, so we MUST refresh the Save handler each time.
      modalOnSave = typeof onSave === "function" ? onSave : null;

      if (!modalBackdrop) {
        modalBackdrop = el(ctx.doc, "div", { class: "eikon-dda-modal-backdrop" }, []);
        var modal = el(ctx.doc, "div", { class: "eikon-dda-modal" }, []);
        var head = el(ctx.doc, "div", { class: "eikon-dda-modal-head" }, []);
        modalTitle = el(ctx.doc, "h3", { text: "" }, []);
        var closeBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Close" }, []);
        closeBtn.onclick = function () {
          hideModal();
        };
        head.appendChild(modalTitle);
        head.appendChild(closeBtn);

        var body = el(ctx.doc, "div", { class: "eikon-dda-modal-body" }, []);
        var grid = el(ctx.doc, "div", { class: "eikon-dda-grid" }, []);

        function field(label, type, key, full, placeholder) {
          var wrap = el(ctx.doc, "div", { class: "eikon-dda-field" + (full ? " full" : "") }, []);
          wrap.appendChild(el(ctx.doc, "label", { text: label }, []));
          var inp = null;
          if (type === "textarea") inp = el(ctx.doc, "textarea", { placeholder: placeholder || "" }, []);
          else inp = el(ctx.doc, "input", { type: type, placeholder: placeholder || "" }, []);
          wrap.appendChild(inp);
          return { wrap: wrap, input: inp, key: key };
        }

        var f_entry_date = field("Date", "date", "entry_date", false);
        var f_qty = field("Qty", "number", "quantity", false);
        var f_client = field("Client", "text", "client_name", true, "Client name");
        var f_id = field("ID Card", "text", "client_id_card", false, "ID card");
        var f_addr = field("Address", "text", "client_address", true, "Address");
        var f_med = field("Medicine (name & dose)", "text", "medicine_name_dose", true, "e.g. Diazepam 5mg");
        var f_doc = field("Doctor", "text", "doctor_name", true, "Doctor name");
        var f_reg = field("Reg No.", "text", "doctor_reg_no", false, "Registration no.");
        var f_serial = field("Prescription Serial No.", "text", "prescription_serial_no", false, "Serial no.");

        formEls = [f_entry_date, f_client, f_id, f_addr, f_med, f_qty, f_doc, f_reg, f_serial];

        // ✅ Autosuggest:
        // - Client / ID Card: suggests from latest matching entries in the cloud (searching backwards by month)
        // - Medicine: fixed list (provided)
        attachSuggest(
          f_client.input,
          suggestPoycClients,
          function (it) {
            if (!it) return;
            if (it.client_name) f_client.input.value = it.client_name;
            if (it.client_id_card) f_id.input.value = it.client_id_card;
            if (it.client_address) f_addr.input.value = it.client_address;
          },
          { minChars: 1, debounceMs: 80, limit: 12 }
        );

        attachSuggest(
          f_id.input,
          suggestPoycClients,
          function (it) {
            if (!it) return;
            if (it.client_name) f_client.input.value = it.client_name;
            if (it.client_id_card) f_id.input.value = it.client_id_card;
            if (it.client_address) f_addr.input.value = it.client_address;
          },
          { minChars: 1, debounceMs: 80, limit: 12 }
        );

        attachSuggest(
          f_doc.input,
          suggestPoycDoctors,
          function (it) {
            if (!it) return;
            if (it.doctor_name) f_doc.input.value = it.doctor_name;
            if (it.doctor_reg_no) f_reg.input.value = it.doctor_reg_no;
          },
          { minChars: 1, debounceMs: 80, limit: 12 }
        );

        attachSuggest(
          f_reg.input,
          suggestPoycDoctors,
          function (it) {
            if (!it) return;
            if (it.doctor_name) f_doc.input.value = it.doctor_name;
            if (it.doctor_reg_no) f_reg.input.value = it.doctor_reg_no;
          },
          { minChars: 1, debounceMs: 80, limit: 12 }
        );

        attachSuggest(
          f_med.input,
          suggestPoycMedicines,
          function (it) {
            if (!it) return;
            f_med.input.value = it.value || it.primary || "";
          },
          { minChars: 1, debounceMs: 80, limit: 20 }
        );

        for (var i = 0; i < formEls.length; i++) grid.appendChild(formEls[i].wrap);

        var footer = el(
          ctx.doc,
          "div",
          { style: "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;" },
          []
        );

        modalSaveBtn = el(ctx.doc, "button", { class: "eikon-dda-btn", text: "Save" }, []);
        footer.appendChild(modalSaveBtn);

        body.appendChild(grid);
        body.appendChild(footer);

        modal.appendChild(head);
        modal.appendChild(body);
        modalBackdrop.appendChild(modal);

        // close if click backdrop
        modalBackdrop.onclick = function (e) {
          if (e && e.target === modalBackdrop) hideModal();
        };

        ctx.doc.body.appendChild(modalBackdrop);
      }

      // Always update Save handler (modal is built once)
      if (modalSaveBtn) {
        modalSaveBtn.onclick = async function () {
          if (!modalOnSave) return;
          var payload = {};
          for (var i = 0; i < formEls.length; i++) {
            var k = formEls[i].key;
            var v = formEls[i].input.value;
            payload[k] = v;
          }
          // normalize qty
          if (payload.quantity !== "" && payload.quantity != null) payload.quantity = Number(payload.quantity);
          if (payload.quantity === "" || payload.quantity == null) delete payload.quantity;
          await modalOnSave(payload);
        };
      }

      modalTitle.textContent = title;

      // set values
      var init = initial || {};
      for (var i = 0; i < formEls.length; i++) {
        var k = formEls[i].key;
        var inp = formEls[i].input;
        var v = init[k];
        inp.value = v == null ? "" : String(v);
      }

      showModal();
    }

    function showModal() {
      if (!modalBackdrop) return;
      modalBackdrop.style.display = "flex";
    }
    function hideModal() {
      if (!modalBackdrop) return;
      modalBackdrop.style.display = "none";
    }

    function openModalForNew() {
      var startEnd = monthStartEnd(state.month) || monthStartEnd(todayYm());
      var defaultDate = startEnd ? startEnd.from : "";
      openModal("New Entry", { entry_date: defaultDate }, async function (payload) {
        if (!ctx) return;
        try {
          setMsg("", "");
          setLoading(true);
          var data = await apiJson(ctx.win, "/dda-poyc/entries", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          if (!data || data.ok !== true)
            throw new Error(data && data.error ? String(data.error) : "Unexpected response");
          hideModal();
          await refresh();
        } catch (e) {
          var msg = e && e.message ? e.message : String(e || "Error");
          if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
          setMsg("err", msg);
          warn("create failed:", e);
        } finally {
          setLoading(false);
        }
      });
    }

    function openModalForEdit(row) {
      openModal("Edit Entry", row || {}, async function (payload) {
        if (!ctx) return;
        var id = row && row.id;
        if (!id) return;
        try {
          setMsg("", "");
          setLoading(true);
          var data = await apiJson(ctx.win, "/dda-poyc/entries/" + encodeURIComponent(String(id)), {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          if (!data || data.ok !== true)
            throw new Error(data && data.error ? String(data.error) : "Unexpected response");
          hideModal();
          await refresh();
        } catch (e) {
          var msg = e && e.message ? e.message : String(e || "Error");
          if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
          setMsg("err", msg);
          warn("update failed:", e);
        } finally {
          setLoading(false);
        }
      });
    }

    
    // ✅ DDA Sales-style confirm dialog (window.confirm is blocked in sandboxed iframes without allow-modals)
    var _confirmBackdrop = null;
    function uiConfirm(message, opts) {
      opts = opts || {};
      if (!ctx || !ctx.doc) return Promise.resolve(true);
      var doc = ctx.doc;

      if (!_confirmBackdrop) {
        var bd = doc.createElement("div");
        bd.style.cssText = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:11000;padding:16px;";
        var card = doc.createElement("div");
        card.style.cssText = "width:min(420px,calc(100vw - 32px));background:rgba(10,16,24,.94);border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.60);padding:14px;color:var(--text,#e9eef7);";
        var title = doc.createElement("div");
        title.style.cssText = "font-weight:1000;font-size:14px;margin:0 0 8px 0;";
        title.textContent = "Confirm";
        var msg = doc.createElement("div");
        msg.style.cssText = "font-size:13px;line-height:1.35;color:rgba(233,238,247,.86);white-space:pre-wrap;";
        var row = doc.createElement("div");
        row.style.cssText = "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;";
        var cancelBtn = doc.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "eikon-dda-btn secondary";
        cancelBtn.textContent = "Cancel";
        var okBtn = doc.createElement("button");
        okBtn.type = "button";
        okBtn.className = "eikon-dda-btn danger";
        okBtn.textContent = "OK";
        row.appendChild(cancelBtn);
        row.appendChild(okBtn);

        card.appendChild(title);
        card.appendChild(msg);
        card.appendChild(row);
        bd.appendChild(card);

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
        okBtn.className = "eikon-dda-btn " + (opts.danger === false ? "" : "danger");

        function cleanup(val) {
          try { bd.style.display = "none"; } catch (e) {}
          try { cancelBtn.onclick = null; okBtn.onclick = null; } catch (e2) {}
          resolve(!!val);
        }

        cancelBtn.onclick = function (ev) {
          try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}
          cleanup(false);
        };
        okBtn.onclick = function (ev) {
          try { if (ev) { ev.preventDefault(); ev.stopPropagation(); } } catch (e) {}
          cleanup(true);
        };

        try { bd.style.display = "flex"; } catch (e) {}
      });
    }

async function doDelete(row) {
      if (!ctx) return;
      setMsg("", "");

      var id = row && row.id != null ? Number(row.id) : null;
      if (!id) {
        setMsg("err", "Invalid entry id.");
        return;
      }

      var ok = await uiConfirm("Delete this entry?", { title: "Delete entry", confirmText: "Delete", cancelText: "Cancel", danger: true });
      if (!ok) return;

      setMsg("", "Deleting…");
      setLoading(true);

      var attempts = [];

      function summarize(list) {
        try {
          return (list || [])
            .map(function (a) {
              if (!a) return "";
              if (a.ok) return a.name + " => ok";
              var s = a.status != null ? String(a.status) : "ERR";
              var em = a.message ? String(a.message) : "";
              return a.name + " => " + s + (em ? " (" + em + ")" : "");
            })
            .filter(Boolean)
            .join(" | ");
        } catch (e) {
          return "";
        }
      }

      async function tryCall(name, path, opts) {
        opts = opts || {};
        opts.headers = opts.headers || {};
        try { opts.headers["X-Eikon-Debug"] = "1"; } catch (e0) {}
        try {
          var out = await apiJson(ctx.win, path, opts);
          attempts.push({ name: name, ok: true, status: 200 });
          return out;
        } catch (e) {
          attempts.push({
            name: name,
            ok: false,
            status: e && e.status != null ? e.status : null,
            message: e && e.message ? e.message : String(e || "Error"),
          });
          return null;
        }
      }

      try {
        // Prefer POST fallback (works even when DELETE is blocked by some proxies/iframes)
        var data = await tryCall("POST /dda-poyc/entries/delete", "/dda-poyc/entries/delete", {
          method: "POST",
          body: JSON.stringify({ id: id }),
        });

        // Canonical DELETE
        if (!data) {
          var u1 = "/dda-poyc/entries/" + encodeURIComponent(String(id));
          data = await tryCall("DELETE " + u1, u1, { method: "DELETE" });
        }

        // Fallback POST /:id/delete
        if (!data) {
          var u2 = "/dda-poyc/entries/" + encodeURIComponent(String(id)) + "/delete";
          data = await tryCall("POST " + u2, u2, { method: "POST" });
        }

        if (!data || data.ok !== true) {
          var msg = (data && data.error) ? String(data.error) : "Delete failed.";
          var dbg = summarize(attempts);
          if (dbg) msg += "  Debug: " + dbg;
          throw new Error(msg);
        }

        setMsg("ok", "Deleted.");
        await refresh();
      } catch (e) {
        var msg2 = e && e.message ? e.message : String(e || "Error");
        var dbg2 = summarize(attempts);
        if (dbg2 && msg2.indexOf("Debug:") === -1) msg2 += "  Debug: " + dbg2;
        if (e && e.status === 401) msg2 = "Unauthorized (missing/invalid token). Log in again.";
        setMsg("err", msg2);
        warn("delete failed:", e);
      } finally {
        setLoading(false);
      }
    }



    function scheduleLiveSearch() {
      if (searchTimer) {
        try {
          clearTimeout(searchTimer);
        } catch (e) {}
      }
      // same feel as dda-sales: debounce a little as user types
      searchTimer = setTimeout(function () {
        refresh();
      }, 220);
    }

    function renderInto(container) {
      ctx = resolveRenderContext(container);
      if (!ctx || !ctx.doc || !ctx.mount) throw new Error("Invalid render root");

      ensureStyleOnce(ctx.doc);

      // clear mount
      try {
        ctx.mount.innerHTML = "";
      } catch (e) {}

      var wrap = el(ctx.doc, "div", { class: "eikon-dda-wrap" }, []);
      var layout = el(ctx.doc, "div", { class: "eikon-dda-layout" }, []);

      // Title (full width)
      var titleRow = el(ctx.doc, "div", { class: "eikon-dda-span-all" }, []);
      var title = el(ctx.doc, "h2", { class: "eikon-dda-title", style: "margin:0 0 10px 0;" }, []);
      title.appendChild(el(ctx.doc, "span", { class: "icon", html: ICON_SVG }, []));
      title.appendChild(el(ctx.doc, "span", { text: "DDA POYC" }, []));
      titleRow.appendChild(title);

      msgBox = el(ctx.doc, "div", { class: "eikon-dda-msg", style: "display:none;" }, []);
      titleRow.appendChild(msgBox);
      layout.appendChild(titleRow);

      // ✅ Top card (full width): match DDA Sales layout (consistent look)
      var topCard = el(ctx.doc, "div", { class: "eikon-dda-card eikon-dda-topcard" }, []);
      var topHead = el(ctx.doc, "div", { class: "eikon-dda-card-head" }, []);
      topHead.appendChild(el(ctx.doc, "h3", { text: "Report & Filters" }, []));
      topCard.appendChild(topHead);

      reportMsg = el(ctx.doc, "div", { class: "eikon-dda-msg", style: "display:none;" }, []);
      topCard.appendChild(reportMsg);

      var controls = el(ctx.doc, "div", {}, []);
      var controlsTop = el(ctx.doc, "div", { class: "eikon-dda-controls" }, []);
      var controlsBottom = el(ctx.doc, "div", { class: "eikon-dda-controls" }, []);

      // Month
      var monthField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
      monthField.appendChild(el(ctx.doc, "label", { text: "Month" }, []));
      monthInput = el(ctx.doc, "input", { type: "month", value: state.month }, []);
      monthInput.onchange = function () {
        state.month = String(monthInput.value || "").trim();
        setReportDefaultsForMonth(state.month);
        refresh();
      };
      monthField.appendChild(monthInput);
      try { monthField.style.minWidth = "170px"; } catch (e0) {}

      // Search (live)
      var qField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
      qField.appendChild(el(ctx.doc, "label", { text: "Search" }, []));
      qInput = el(ctx.doc, "input", { type: "text", value: state.q, placeholder: "Client / ID / medicine / doctor / serial…" }, []);
      qInput.oninput = function () {
        state.q = String(qInput.value || "");
        scheduleLiveSearch();
      };
      qInput.onkeydown = function (e) { if (e && e.key === "Enter") refresh(); };
      qField.appendChild(qInput);
      try { qField.style.minWidth = "260px"; qField.style.flex = "1 1 320px"; } catch (e1) {}

      refreshBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Refresh" }, []);
      refreshBtn.onclick = function () {
        refresh();
      };

      // New Entry
      addBtn = el(ctx.doc, "button", { class: "eikon-dda-btn", text: "New Entry" }, []);
      addBtn.onclick = function () {
        openModalForNew();
      };

      controlsTop.appendChild(monthField);
      controlsTop.appendChild(qField);
      controlsTop.appendChild(refreshBtn);
      controlsTop.appendChild(addBtn);

      // Report controls (From/To/Generate/Print)
      var fromField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
      fromField.appendChild(el(ctx.doc, "label", { text: "From" }, []));
      reportFromInput = el(ctx.doc, "input", { type: "date", value: state.report_from }, []);
      fromField.appendChild(reportFromInput);
      try { fromField.style.minWidth = "170px"; } catch (e2) {}

      var toField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
      toField.appendChild(el(ctx.doc, "label", { text: "To" }, []));
      reportToInput = el(ctx.doc, "input", { type: "date", value: state.report_to }, []);
      toField.appendChild(reportToInput);
      try { toField.style.minWidth = "170px"; } catch (e3) {}

      generateBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Generate" }, []);
      generateBtn.onclick = function () {
        generateReport();
      };

      printBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Print" }, []);
      printBtn.onclick = function () {
        if (!state.report || state.report.ok !== true) {
          setReportMsg("err", "No report loaded. Click Generate.");
          return;
        }
        var html = buildPrintableHtml(state.report);
        openPrintTabWithHtml(html);
      };

      controlsBottom.appendChild(fromField);
      controlsBottom.appendChild(toField);
      controlsBottom.appendChild(generateBtn);
      controlsBottom.appendChild(printBtn);

      controls.appendChild(controlsTop);
      controls.appendChild(controlsBottom);
      topCard.appendChild(controls);
      layout.appendChild(topCard);

// Entries card (full width)
      var cardEntries = el(ctx.doc, "div", { class: "eikon-dda-card eikon-dda-span-all" }, []);
      var headEntries = el(ctx.doc, "div", { class: "eikon-dda-card-head" }, []);
      headEntries.appendChild(el(ctx.doc, "h3", { text: "Entries" }, []));
      cardEntries.appendChild(headEntries);

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
          el(ctx.doc, "th", { text: "Actions" }, []),
        ])
      );
      table.appendChild(thead);
      tableBody = el(ctx.doc, "tbody", {}, []);
      table.appendChild(tableBody);
      tableWrap.appendChild(table);
      cardEntries.appendChild(tableWrap);
      layout.appendChild(cardEntries);

      // Report preview (full width)
      var cardReportPreview = el(ctx.doc, "div", { class: "eikon-dda-card eikon-dda-span-all" }, []);
      var headPreview = el(ctx.doc, "div", { class: "eikon-dda-card-head" }, []);
      headPreview.appendChild(el(ctx.doc, "h3", { text: "Report Preview" }, []));
      cardReportPreview.appendChild(headPreview);

      reportPreview = el(ctx.doc, "div", {}, []);
      cardReportPreview.appendChild(reportPreview);
      layout.appendChild(cardReportPreview);

      wrap.appendChild(layout);
      ctx.mount.appendChild(wrap);

      // defaults + initial load
      if (!isYm(state.month)) state.month = todayYm();
      if (monthInput) monthInput.value = state.month;
      setReportDefaultsForMonth(state.month);

      renderRows();
      renderReportPreview();
      refresh();
    }


    function destroy() {
      try {
        if (modalBackdrop && modalBackdrop.parentNode) modalBackdrop.parentNode.removeChild(modalBackdrop);
      } catch (e) {}
      modalBackdrop = null;
      modalTitle = null;
      formEls = null;
      modalSaveBtn = null;
      modalOnSave = null;

      // Autosuggest popup (cleanup)
      try {
        if (_suggestUi && _suggestUi.root && _suggestUi.root.parentNode) _suggestUi.root.parentNode.removeChild(_suggestUi.root);
      } catch (e0) {}
      _suggestUi = null;

      msgBox = null;
      tableBody = null;
      monthInput = null;
      qInput = null;
      addBtn = null;
      refreshBtn = null;

      reportFromInput = null;
      reportToInput = null;
      generateBtn = null;
      printBtn = null;
      reportMsg = null;
      reportPreview = null;

      ctx = null;
    }

    return { id: "dda-poyc", title: "DDA POYC", render: renderInto, destroy: destroy };
  }

  // Register module (same icon technique as DDA Sales)
  function register() {
    var mod = buildModule();
    var api = (window && window.EIKON) || (window && window.Eikon);
    if (!api || typeof api.registerModule !== "function") {
      warn("EIKON.registerModule() not found");
      return;
    }

    api.registerModule({
      id: mod.id,
      key: mod.id,
      order: 60,
      slug: "dda-poyc",
      title: mod.title,
      navTitle: "DDA POYC",

      // ✅ ICON (SIDEBAR): core.js uses m.icon as textContent, so it must be a glyph (not SVG).
      icon: "🧾",

      iconText: "",
      iconSvg: ICON_SVG,
      iconHTML: ICON_SVG,
      navIcon: ICON_SVG,

      hash: "#dda-poyc",
      route: "dda-poyc",

      render: mod.render,
      mount: mod.render,
      renderInto: mod.render,
      destroy: mod.destroy,
    });

    log("registered via window.EIKON.registerModule()");
  }

  try {
    register();
    log("loaded modules.ddapoyc.js");
  } catch (e) {
    warn("failed to register:", e);
  }
})();
