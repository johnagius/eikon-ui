/* ui/modules.ddapurchases.js
   Eikon - DDA Purchases module (UI)

   Endpoints (Cloudflare Worker):
   GET    /dda-purchases/entries?month=YYYY-MM&q=...
   POST   /dda-purchases/entries
   PUT    /dda-purchases/entries/:id
   DELETE /dda-purchases/entries/:id
   GET    /dda-purchases/report?from=YYYY-MM-DD&to=YYYY-MM-DD (JSON)
*/
(function () {
  "use strict";
  var LOG_PREFIX = "[EIKON][dda-purchases]";
  function log() {
    try { console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }

  var ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 3v18h18"></path>' +
    '<path d="M7 10h10"></path>' +
    '<path d="M7 14h10"></path>' +
    '<path d="M7 18h6"></path>' +
    "</svg>";

  function pad2(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return "00";
    return (n < 10 ? "0" : "") + String(n);
  }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function isYm(s) { return /^\d{4}-\d{2}$/.test(String(s || "").trim()); }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c;
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
    var id = "eikon-dda-purchases-style";
    try { if (doc.getElementById(id)) return; } catch (e) {}

    var css =
      "" +
      ".eikon-dda-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px;}" +
      ".eikon-dda-top{display:flex;flex-wrap:wrap;gap:10px;align-items:end;justify-content:space-between;margin-bottom:12px;}" +
      ".eikon-dda-title{font-size:18px;font-weight:900;margin:0;display:flex;align-items:center;gap:10px;color:var(--text,#e9eef7);}" +
      ".eikon-dda-title .icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;color:var(--text,#e9eef7);opacity:.95;}" +
      ".eikon-dda-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;}" +

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

      ".eikon-dda-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.58);display:none;align-items:center;justify-content:center;padding:16px;z-index:9999;}" +
      ".eikon-dda-modal{width:100%;max-width:860px;background:rgba(16,24,36,.98);border-radius:16px;border:1px solid var(--line,rgba(255,255,255,.10));" +
      "box-shadow:0 28px 80px rgba(0,0,0,.55);backdrop-filter:blur(10px);}" +
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
    var res = await fetch(path, { method: opts.method || "GET", headers: headers, body: opts.body != null ? opts.body : undefined });
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

    // debounce timer for live search
    var searchTimer = null;

    function setMsg(kind, text) {
      if (!msgBox) return;
      msgBox.className = "eikon-dda-msg " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
      msgBox.textContent = String(text || "");
      msgBox.style.display = text ? "block" : "none";
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
        var trEmpty = el(ctx.doc, "tr", {}, [el(ctx.doc, "td", { colspan: "6", html: "No entries for this month." }, [])]);
        tableBody.appendChild(trEmpty);
        return;
      }
      for (var i = 0; i < list.length; i++) {
        (function (row) {
          var tr = el(ctx.doc, "tr", {}, [
            el(ctx.doc, "td", { text: String(row.entry_date || "") }, []),
            el(ctx.doc, "td", { text: String(row.dda_name_dose || "") }, []),
            el(ctx.doc, "td", { text: String(row.quantity == null ? "" : row.quantity) }, []),
            el(ctx.doc, "td", { text: String(row.agent || "") }, []),
            el(ctx.doc, "td", { text: String(row.invoice_number || "") }, []),
            el(ctx.doc, "td", {}, []),
          ]);
          var actionsTd = tr.lastChild;
          var actions = el(ctx.doc, "div", { class: "eikon-dda-actions" }, []);
          var edit = el(ctx.doc, "span", { class: "eikon-dda-link", text: "Edit" }, []);
          edit.onclick = function () { openModalForEdit(row); };
          var del = el(ctx.doc, "span", { class: "eikon-dda-link", text: "Delete" }, []);
          del.onclick = function () { doDelete(row, false); };
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
      var url = "/dda-purchases/entries?month=" + encodeURIComponent(month);
      var q = String(state.q || "").trim();
      if (q) url += "&q=" + encodeURIComponent(q);
      try {
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        state.entries = Array.isArray(data.entries) ? data.entries : [];
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
        reportPreview.appendChild(el(ctx.doc, "div", { class: "eikon-dda-hint", html: "No report generated yet." }, []));
        return;
      }
      var data = state.report;
      var entries = Array.isArray(data.entries) ? data.entries : [];
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
        var table = el(ctx.doc, "table", { class: "eikon-dda-table", style: "min-width:980px;" }, []);
        var thead = el(ctx.doc, "thead", {}, []);
        thead.appendChild(
          el(ctx.doc, "tr", {}, [
            el(ctx.doc, "th", { text: "Date" }, []),
            el(ctx.doc, "th", { text: "DDA Name & Dose" }, []),
            el(ctx.doc, "th", { text: "Qty" }, []),
            el(ctx.doc, "th", { text: "Agent" }, []),
            el(ctx.doc, "th", { text: "Invoice Number" }, []),
          ])
        );
        table.appendChild(thead);

        var tbody = el(ctx.doc, "tbody", {}, []);
        for (var i = 0; i < list.length; i++) {
          var r = list[i] || {};
          tbody.appendChild(
            el(ctx.doc, "tr", {}, [
              el(ctx.doc, "td", { text: String(r.entry_date || "") }, []),
              el(ctx.doc, "td", { text: String(r.dda_name_dose || "") }, []),
              el(ctx.doc, "td", { text: String(r.quantity == null ? "" : r.quantity) }, []),
              el(ctx.doc, "td", { text: String(r.agent || "") }, []),
              el(ctx.doc, "td", { text: String(r.invoice_number || "") }, []),
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

      // don’t show “Report generated...” message
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
        var url = "/dda-purchases/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        state.report = data;

        // keep success message hidden
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
      html += "<title>DDA Purchases Report</title>";
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
      html += "<h1>" + escapeHtml(org) + " — DDA Purchases Report</h1>";
      html += "<div class='meta'>" + (loc ? "Location: " + escapeHtml(loc) + "<br>" : "") + "Range: " + escapeHtml(from) + " to " + escapeHtml(to) + "</div>";

      if (!entries.length) {
        html += "<p>No entries for the selected date range.</p>";
      } else {
        for (var mi = 0; mi < monthKeys.length; mi++) {
          var ym = monthKeys[mi];
          var list = byMonth.get(ym) || [];
          html += "<h2 style='font-size:14px;margin:10px 0 6px 0;'>" + escapeHtml(ym) + "</h2>";
          html += "<table><thead><tr>";
          html += "<th>Date</th><th>DDA Name &amp; Dose</th><th>Qty</th><th>Agent</th><th>Invoice Number</th>";
          html += "</tr></thead><tbody>";
          for (var i = 0; i < list.length; i++) {
            var r = list[i] || {};
            html += "<tr>";
            html += "<td>" + escapeHtml(r.entry_date || "") + "</td>";
            html += "<td>" + escapeHtml(r.dda_name_dose || "") + "</td>";
            html += "<td>" + escapeHtml(String(r.quantity == null ? "" : r.quantity)) + "</td>";
            html += "<td>" + escapeHtml(r.agent || "") + "</td>";
            html += "<td>" + escapeHtml(r.invoice_number || "") + "</td>";
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

          var url = "/dda-purchases/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
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
      modalTitle = el(doc, "h3", { text: "DDA Purchases Entry" }, []);
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
        dda_name_dose: el(doc, "input", { type: "text", value: "", placeholder: "DDA name & dose" }, []),
        quantity: el(doc, "input", { type: "number", value: "1", min: "1", step: "1" }, []),
        agent: el(doc, "input", { type: "text", value: "", placeholder: "Agent" }, []),
        invoice_number: el(doc, "input", { type: "text", value: "", placeholder: "Invoice number" }, []),
      };

      grid.appendChild(field("Entry Date", formEls.entry_date, false));
      grid.appendChild(field("Quantity", formEls.quantity, false));
      grid.appendChild(field("DDA Name & Dose", formEls.dda_name_dose, true));
      grid.appendChild(field("Agent", formEls.agent, false));
      grid.appendChild(field("Invoice Number", formEls.invoice_number, false));

      body.appendChild(grid);

      var footerBtns = el(doc, "div", { style: "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;" }, []);
      var deleteBtn = el(doc, "button", { class: "eikon-dda-btn danger", text: "Delete" }, []);
      var saveBtn = el(doc, "button", { class: "eikon-dda-btn", text: "Save" }, []);
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
      modalTitle.textContent = "New DDA Purchases Entry";
      formEls.entry_date.value = ymd;
      formEls.dda_name_dose.value = "";
      formEls.quantity.value = "1";
      formEls.agent.value = "";
      formEls.invoice_number.value = "";
      if (modalBackdrop && modalBackdrop._deleteBtn) modalBackdrop._deleteBtn.style.display = "none";
      openModal();
    }

    function openModalForEdit(row) {
      if (!ctx) return;
      buildModalOnceForDoc(ctx.doc);
      formEls.id = row && row.id != null ? Number(row.id) : null;
      modalTitle.textContent = "Edit DDA Purchases Entry";
      formEls.entry_date.value = String(row.entry_date || "");
      formEls.dda_name_dose.value = String(row.dda_name_dose || "");
      formEls.quantity.value = String(row.quantity == null ? "1" : row.quantity);
      formEls.agent.value = String(row.agent || "");
      formEls.invoice_number.value = String(row.invoice_number || "");
      if (modalBackdrop && modalBackdrop._deleteBtn) modalBackdrop._deleteBtn.style.display = "inline-block";
      openModal();
    }

    function validateFormPayload() {
      var entry_date = String(formEls.entry_date.value || "").trim();
      var dda_name_dose = String(formEls.dda_name_dose.value || "").trim();
      var quantity = toIntSafe(formEls.quantity.value);
      var agent = String(formEls.agent.value || "").trim();
      var invoice_number = String(formEls.invoice_number.value || "").trim();

      if (!isYmd(entry_date)) return { ok: false, error: "Invalid entry_date (YYYY-MM-DD)" };
      if (!dda_name_dose) return { ok: false, error: "Missing dda_name_dose" };
      if (!quantity || quantity < 1) return { ok: false, error: "Invalid quantity (must be >= 1)" };
      if (!agent) return { ok: false, error: "Missing agent" };
      if (!invoice_number) return { ok: false, error: "Missing invoice_number" };

      return {
        ok: true,
        payload: {
          entry_date: entry_date,
          dda_name_dose: dda_name_dose,
          quantity: quantity,
          agent: agent,
          invoice_number: invoice_number,
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
        if (formEls.id) { method = "PUT"; path = "/dda-purchases/entries/" + encodeURIComponent(String(formEls.id)); }
        else { method = "POST"; path = "/dda-purchases/entries"; }
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
      var ok = false;
      try { ok = ctx.win.confirm("Delete this DDA Purchases entry?"); } catch (e) { ok = true; }
      if (!ok) return;

      setLoading(true);
      try {
        var data = await apiJson(ctx.win, "/dda-purchases/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
        if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        if (fromModal) closeModal();
        setMsg("ok", "Deleted.");
        setLoading(false);
        await refresh();
      } catch (e) {
        setLoading(false);
        var msg = e && e.message ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setMsg("err", msg);
        warn("delete failed:", e);
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
        title.appendChild(el(ctx.doc, "span", { text: "DDA Purchases" }, []));
        top.appendChild(title);

        var controls = el(ctx.doc, "div", { class: "eikon-dda-controls" }, []);

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

        var qField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        qField.appendChild(el(ctx.doc, "label", { text: "Search" }, []));
        qInput = el(ctx.doc, "input", { type: "text", value: state.q, placeholder: "DDA / agent / invoice…" }, []);

        // live search (debounced)
        qInput.oninput = function () {
          state.q = String(qInput.value || "");
          if (searchTimer) { try { ctx.win.clearTimeout(searchTimer); } catch (e) {} }
          searchTimer = ctx.win.setTimeout(function () {
            if (!state.loading && !state.report_loading) refresh();
          }, 250);
        };

        qInput.onkeydown = function (e) { if (e && e.key === "Enter") refresh(); };
        qField.appendChild(qInput);

        refreshBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Refresh" }, []);
        refreshBtn.onclick = function () { refresh(); };

        addBtn = el(ctx.doc, "button", { class: "eikon-dda-btn", text: "New Entry" }, []);
        addBtn.onclick = function () { openModalForCreate(); };

        var fromField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        fromField.appendChild(el(ctx.doc, "label", { text: "From" }, []));
        reportFromInput = el(ctx.doc, "input", { type: "date", value: state.report_from }, []);
        reportFromInput.onchange = function () { state.report_from = String(reportFromInput.value || "").trim(); };
        fromField.appendChild(reportFromInput);

        var toField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        toField.appendChild(el(ctx.doc, "label", { text: "To" }, []));
        reportToInput = el(ctx.doc, "input", { type: "date", value: state.report_to }, []);
        reportToInput.onchange = function () { state.report_to = String(reportToInput.value || "").trim(); };
        toField.appendChild(reportToInput);

        generateBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Generate" }, []);
        generateBtn.onclick = function () { generateReport(); };

        printBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Print" }, []);
        printBtn.onclick = function () { printReport(); };

        controls.appendChild(monthField);
        controls.appendChild(qField);
        controls.appendChild(refreshBtn);
        controls.appendChild(addBtn);
        controls.appendChild(fromField);
        controls.appendChild(toField);
        controls.appendChild(generateBtn);
        controls.appendChild(printBtn);

        top.appendChild(controls);
        wrap.appendChild(top);

        msgBox = el(ctx.doc, "div", { class: "eikon-dda-msg", text: "" }, []);
        msgBox.style.display = "none";
        wrap.appendChild(msgBox);

        // Entries card
        var card = el(ctx.doc, "div", { class: "eikon-dda-card" }, []);
        var cardHead = el(ctx.doc, "div", { class: "eikon-dda-card-head" }, []);
        cardHead.appendChild(el(ctx.doc, "h3", { text: "Entries" }, []));
        card.appendChild(cardHead);

        var tableWrap = el(ctx.doc, "div", { class: "eikon-dda-table-wrap" }, []);
        var table = el(ctx.doc, "table", { class: "eikon-dda-table" }, []);
        var thead = el(ctx.doc, "thead", {}, []);
        thead.appendChild(
          el(ctx.doc, "tr", {}, [
            el(ctx.doc, "th", { text: "Date" }, []),
            el(ctx.doc, "th", { text: "DDA Name & Dose" }, []),
            el(ctx.doc, "th", { text: "Qty" }, []),
            el(ctx.doc, "th", { text: "Agent" }, []),
            el(ctx.doc, "th", { text: "Invoice Number" }, []),
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
      id: "dda-purchases",
      key: "dda-purchases",
      slug: "dda-purchases",
      title: "DDA Purchases",
      navTitle: "DDA Purchases",

      icon: "🧾",

      iconText: "",
      iconSvg: ICON_SVG,
      iconHTML: ICON_SVG,
      navIcon: ICON_SVG,
      hash: "#dda-purchases",
      route: "dda-purchases",
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
  log("loaded modules.ddapurchases.js");
})();
