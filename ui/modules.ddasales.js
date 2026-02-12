/* ui/modules.ddasales.js
   Eikon - DDA Sales module (UI)

   Endpoints (Cloudflare Worker):
   GET    /dda-sales/entries?month=YYYY-MM&q=...
   POST   /dda-sales/entries
   PUT    /dda-sales/entries/:id
   DELETE /dda-sales/entries/:id
   GET    /dda-sales/report?from=YYYY-MM-DD&to=YYYY-MM-DD (JSON)
*/
(function () {
  "use strict";

  var LOG_PREFIX = "[EIKON][dda-sales]";

  function log() {
    try { console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }

  // NOTE: kept as-is from your file (it’s empty in the current repo snapshot)
  var ICON_SVG = "" + "" + "" + "";

  function pad2(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return "00";
    return (n < 10 ? "0" : "") + String(n);
  }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function isYm(s) { return /^\d{4}-\d{2}$/.test(String(s || "").trim()); }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[c] || c;
    });
  }

  function monthStartEnd(yyyyMm) {
    var m = String(yyyyMm || "").trim();
    if (!isYm(m)) return null;
    var y = parseInt(m.slice(0, 4), 10);
    var mo = parseInt(m.slice(5, 7), 10); // 1..12
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
    var start = m + "-01";
    var lastDay = new Date(y, mo, 0).getDate(); // day 0 of next month
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

  // ---- Resolve mount context (Element / Document / Window / iframe / wrapper) ----
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

  // ---- DOM helpers tied to a specific document ----
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

    var css = ""
      + ".eikon-dda-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px;}"
      + ".eikon-dda-top{display:flex;flex-wrap:wrap;gap:10px;align-items:end;justify-content:space-between;margin-bottom:12px;}"
      + ".eikon-dda-title{font-size:18px;font-weight:900;margin:0;display:flex;align-items:center;gap:10px;}"
      + ".eikon-dda-title .icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;}"
      + ".eikon-dda-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;}"
      + ".eikon-dda-field{display:flex;flex-direction:column;gap:4px;}"
      + ".eikon-dda-field label{font-size:12px;font-weight:800;opacity:0.85;}"
      + ".eikon-dda-field input,.eikon-dda-field textarea{padding:9px 10px;border:1px solid #cfcfcf;border-radius:10px;font-size:14px;background:#fff;color:#111;}"
      + ".eikon-dda-field textarea{min-height:64px;resize:vertical;}"
      + ".eikon-dda-btn{padding:9px 12px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:900;cursor:pointer;}"
      + ".eikon-dda-btn:disabled{opacity:0.5;cursor:not-allowed;}"
      + ".eikon-dda-btn.secondary{background:#444;}"
      + ".eikon-dda-btn.danger{background:#b00020;}"
      + ".eikon-dda-card{border:1px solid #dedede;border-radius:14px;padding:12px;background:#fff;box-shadow:0 1px 0 rgba(0,0,0,0.03);}"
      + ".eikon-dda-msg{margin:10px 0;padding:10px 12px;border-radius:12px;border:1px solid #ddd;background:#fafafa;}"
      + ".eikon-dda-msg.ok{border-color:#bfe8c6;background:#f2fff5;}"
      + ".eikon-dda-msg.err{border-color:#f0b3bc;background:#fff4f6;}"
      + ".eikon-dda-table-wrap{overflow:auto;border:1px solid #e2e2e2;border-radius:14px;}"
      + ".eikon-dda-table{width:100%;border-collapse:collapse;min-width:980px;}"
      + ".eikon-dda-table th,.eikon-dda-table td{border-bottom:1px solid #eee;padding:8px 10px;font-size:12px;vertical-align:top;}"
      + ".eikon-dda-table th{background:#f5f5f5;text-align:left;font-size:12px;font-weight:900;position:sticky;top:0;z-index:1;}"
      + ".eikon-dda-actions{display:flex;gap:8px;}"
      + ".eikon-dda-link{color:#111;text-decoration:underline;cursor:pointer;font-weight:800;}"
      + ".eikon-dda-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.35);display:none;align-items:center;justify-content:center;padding:16px;z-index:9999;}"
      + ".eikon-dda-modal{width:100%;max-width:860px;background:#fff;border-radius:16px;border:1px solid #ddd;box-shadow:0 10px 30px rgba(0,0,0,0.20);}"
      + ".eikon-dda-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;}"
      + ".eikon-dda-modal-head h3{margin:0;font-size:15px;font-weight:1000;}"
      + ".eikon-dda-modal-body{padding:14px;}"
      + ".eikon-dda-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}"
      + ".eikon-dda-grid .full{grid-column:1 / -1;}"
      + ".eikon-dda-hint{font-size:12px;opacity:0.75;margin-top:6px;}"
      + ".eikon-dda-crash{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px;}"
      + ".eikon-dda-crash h3{margin:0 0 8px 0;font-size:16px;font-weight:1000;color:#b00020;}"
      + ".eikon-dda-crash pre{white-space:pre-wrap;border:1px solid #ddd;background:#fff;padding:12px;border-radius:12px;}"
      + "@media(max-width:820px){.eikon-dda-grid{grid-template-columns:1fr;}}";

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

  // ---- Auth/token + API ----
  function getStoredToken(win) {
    var candidates = [];
    try { if (window && window !== win) candidates.push(window); } catch (e) {}
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
      try { if (W.EIKON && W.EIKON.state && W.EIKON.state.token) return String(W.EIKON.state.token); } catch (e3) {}
      try { if (W.Eikon && W.Eikon.state && W.Eikon.state.token) return String(W.Eikon.state.token); } catch (e4) {}

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
      body: opts.body != null ? opts.body : undefined
    });

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

  // ==============================
  // PATCH: proven print-tab method
  // ==============================
  function openPrintTabWithHtml(html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);

    var w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }

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
      try { URL.revokeObjectURL(url); } catch (e3) {}
    }, 60000);
  }

  // ---- Module implementation ----
  function buildModule() {
    var state = {
      month: todayYm(),
      q: "",
      loading: false,
      entries: [],

      // report
      report_from: "",
      report_to: "",
      report: null, // { ok:true, org_name, location_name, from, to, entries:[] }
      report_loading: false
    };

    // Per-render (depends on iframe doc)
    var ctx = null;
    var msgBox = null;
    var tableBody = null;
    var monthInput = null;
    var qInput = null;
    var refreshBtn = null;
    var addBtn = null;

    // report controls + preview
    var reportFromInput = null;
    var reportToInput = null;
    var generateBtn = null;
    var printBtn = null;
    var reportMsg = null;
    var reportPreview = null;

    // Modal per-doc
    var activeDoc = null;
    var modalBackdrop = null;
    var modalTitle = null;
    var formEls = null;

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

    function renderCrash(doc, mount, title, err) {
      try {
        ensureStyleOnce(doc);
        mount.innerHTML = "";
        var wrap = el(doc, "div", { class: "eikon-dda-crash" }, []);
        wrap.appendChild(el(doc, "h3", { text: title }, []));
        wrap.appendChild(el(doc, "pre", { html: escapeHtml(String(err && (err.stack || err.message || String(err)))) }, []));
        mount.appendChild(wrap);
      } catch (e) {}
    }

    function renderRows() {
      if (!tableBody || !ctx) return;
      tableBody.innerHTML = "";
      var list = state.entries || [];
      if (!list.length) {
        var trEmpty = el(ctx.doc, "tr", {}, [
          el(ctx.doc, "td", { colspan: "10", html: "No entries for this month." }, [])
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
            el(ctx.doc, "td", {}, [])
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

      var url = "/dda-sales/entries?month=" + encodeURIComponent(month);
      var q = String(state.q || "").trim();
      if (q) url += "&q=" + encodeURIComponent(q);

      try {
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
        state.entries = Array.isArray(data.entries) ? data.entries : [];
        renderRows();
        setLoading(false);
      } catch (e) {
        setLoading(false);
        state.entries = [];
        renderRows();
        var msg = (e && e.message) ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setMsg("err", msg);
        warn("refresh failed:", e);
      }
    }

    // --------- REPORT (Generate + Print) ---------
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

        reportPreview.appendChild(el(ctx.doc, "h3", {
          text: ym,
          style: "margin:14px 0 8px 0;font-size:14px;font-weight:1000;"
        }, []));

        var tableWrap = el(ctx.doc, "div", { class: "eikon-dda-table-wrap" }, []);
        var table = el(ctx.doc, "table", { class: "eikon-dda-table", style: "min-width:1100px;" }, []);
        var thead = el(ctx.doc, "thead", {}, []);
        thead.appendChild(el(ctx.doc, "tr", {}, [
          el(ctx.doc, "th", { text: "Date" }, []),
          el(ctx.doc, "th", { text: "Client Name" }, []),
          el(ctx.doc, "th", { text: "ID Card" }, []),
          el(ctx.doc, "th", { text: "Address" }, []),
          el(ctx.doc, "th", { text: "Medicine Name & Dose" }, []),
          el(ctx.doc, "th", { text: "Qty" }, []),
          el(ctx.doc, "th", { text: "Doctor Name" }, []),
          el(ctx.doc, "th", { text: "Doctor Reg No." }, []),
          el(ctx.doc, "th", { text: "Prescription Serial No." }, [])
        ]));
        table.appendChild(thead);

        var tbody = el(ctx.doc, "tbody", {}, []);
        for (var i = 0; i < list.length; i++) {
          var r = list[i] || {};
          tbody.appendChild(el(ctx.doc, "tr", {}, [
            el(ctx.doc, "td", { text: String(r.entry_date || "") }, []),
            el(ctx.doc, "td", { text: String(r.client_name || "") }, []),
            el(ctx.doc, "td", { text: String(r.client_id_card || "") }, []),
            el(ctx.doc, "td", { text: String(r.client_address || "") }, []),
            el(ctx.doc, "td", { text: String(r.medicine_name_dose || "") }, []),
            el(ctx.doc, "td", { text: String(r.quantity == null ? "" : r.quantity) }, []),
            el(ctx.doc, "td", { text: String(r.doctor_name || "") }, []),
            el(ctx.doc, "td", { text: String(r.doctor_reg_no || "") }, []),
            el(ctx.doc, "td", { text: String(r.prescription_serial_no || "") }, [])
          ]));
        }

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        reportPreview.appendChild(tableWrap);
      }
    }

    async function generateReport() {
      if (!ctx) return;
      setReportMsg("", "");

      var from = reportFromInput ? reportFromInput.value : state.report_from;
      var to = reportToInput ? reportToInput.value : state.report_to;

      var vr = validateReportRange(from, to);
      if (!vr.ok) { setReportMsg("err", vr.error); return; }

      state.report_from = vr.from;
      state.report_to = vr.to;

      state.report_loading = true;
      setLoading(false);

      try {
        var url = "/dda-sales/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
        var data = await apiJson(ctx.win, url, { method: "GET" });
        if (!data || data.ok !== true) throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
        state.report = data;
        var count = (data.entries && Array.isArray(data.entries)) ? data.entries.length : 0;
        setReportMsg("ok", "Report generated. Entries: " + count);
        renderReportPreview();
      } catch (e) {
        state.report = null;
        renderReportPreview();
        var msg = (e && e.message) ? e.message : String(e || "Error");
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
      html += "<html><head><meta charset='utf-8'/>";
      html += "<meta name='viewport' content='width=device-width,initial-scale=1'/>";
      html += "<title>DDA Sales Report</title>";
      html += "<style>";
      html += "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111;}";
      html += "h1{font-size:18px;margin:0 0 6px 0;}";
      html += ".meta{font-size:12px;opacity:.8;margin:0 0 14px 0;}";
      html += ".btn{display:inline-block;padding:8px 10px;border-radius:10px;background:#111;color:#fff;text-decoration:none;font-weight:900;font-size:12px;}";
      html += "table{width:100%;border-collapse:collapse;margin:8px 0 18px 0;}";
      html += "th,td{border:1px solid #ddd;padding:6px 8px;font-size:11px;vertical-align:top;}";
      html += "th{background:#f5f5f5;text-align:left;}";
      html += "h2{font-size:14px;margin:18px 0 6px 0;}";
      html += "@media print{.noprint{display:none !important;} body{margin:0;}}";
      html += "</style></head><body>";

      html += "<div class='noprint' style='margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;'>";
      html += "<a class='btn' href='javascript:window.print()'>Print</a>";
      html += "</div>";

      html += "<h1>" + escapeHtml(org) + " — DDA Sales Report</h1>";
      html += "<div class='meta'>"
        + (loc ? ("Location: " + escapeHtml(loc) + "<br/>") : "")
        + "Range: " + escapeHtml(from) + " to " + escapeHtml(to)
        + "</div>";

      if (!entries.length) {
        html += "<p>No entries for the selected date range.</p>";
      } else {
        for (var mi = 0; mi < monthKeys.length; mi++) {
          var ym = monthKeys[mi];
          var list = byMonth.get(ym) || [];
          html += "<h2>" + escapeHtml(ym) + "</h2>";
          html += "<table><thead><tr>"
            + "<th>Date</th><th>Client Name</th><th>ID Card</th><th>Address</th>"
            + "<th>Medicine Name &amp; Dose</th><th>Qty</th><th>Doctor Name</th>"
            + "<th>Doctor Reg No.</th><th>Prescription Serial No.</th>"
            + "</tr></thead><tbody>";

          for (var i = 0; i < list.length; i++) {
            var r = list[i] || {};
            html += "<tr>"
              + "<td>" + escapeHtml(r.entry_date || "") + "</td>"
              + "<td>" + escapeHtml(r.client_name || "") + "</td>"
              + "<td>" + escapeHtml(r.client_id_card || "") + "</td>"
              + "<td>" + escapeHtml(r.client_address || "") + "</td>"
              + "<td>" + escapeHtml(r.medicine_name_dose || "") + "</td>"
              + "<td>" + escapeHtml(String(r.quantity == null ? "" : r.quantity)) + "</td>"
              + "<td>" + escapeHtml(r.doctor_name || "") + "</td>"
              + "<td>" + escapeHtml(r.doctor_reg_no || "") + "</td>"
              + "<td>" + escapeHtml(r.prescription_serial_no || "") + "</td>"
              + "</tr>";
          }

          html += "</tbody></table>";
        }
      }

      // OPTIONAL but recommended: auto-open print dialog after load in the new tab
      html += "<script>";
      html += "window.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e){}},250);});";
      html += "</script>";

      html += "</body></html>";
      return html;
    }

    // ==============================
    // PATCH: DDA printReport() fixed
    // ==============================
    async function printReport() {
      if (!ctx) return;
      setReportMsg("", "");

      var from = reportFromInput ? reportFromInput.value : state.report_from;
      var to = reportToInput ? reportToInput.value : state.report_to;

      var vr = validateReportRange(from, to);
      if (!vr.ok) { setReportMsg("err", vr.error); return; }

      // Reuse cached report if it matches range; otherwise fetch report JSON
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

          if (!data || data.ok !== true) throw new Error((data && data.error) ? String(data.error) : "Unexpected response");

          state.report = data;
          state.report_from = vr.from;
          state.report_to = vr.to;

          if (reportFromInput) reportFromInput.value = vr.from;
          if (reportToInput) reportToInput.value = vr.to;

          renderReportPreview();
        }

        var html = buildPrintableHtml(data);

        // Open via Blob URL (same approach as the working modules)
        openPrintTabWithHtml(html);

        setReportMsg("ok", "Print tab opened.");
      } catch (e) {
        var msg = (e && e.message) ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setReportMsg("err", msg);
        warn("print report failed:", e);
      } finally {
        state.report_loading = false;
        setLoading(false);
      }
    }

    // ---- Modal (unchanged) ----
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
        prescription_serial_no: el(doc, "input", { type: "text", value: "", placeholder: "Prescription serial no." }, [])
      };

      grid.appendChild(field("Entry Date", formEls.entry_date, false));
      grid.appendChild(field("Quantity", formEls.quantity, false));
      grid.appendChild(field("Client Name", formEls.client_name, true));
      grid.appendChild(field("Client ID Card", formEls.client_id_card, false));
      grid.appendChild(field("Client Address", formEls.client_address, false));
      grid.appendChild(field("Medicine Name & Dose", formEls.medicine_name_dose, true));
      grid.appendChild(field("Doctor Name", formEls.doctor_name, false));
      grid.appendChild(field("Doctor Reg No.", formEls.doctor_reg_no, false));
      grid.appendChild(field("Prescription Serial No.", formEls.prescription_serial_no, true));

      body.appendChild(grid);
      body.appendChild(el(doc, "div", {
        class: "eikon-dda-hint",
        html: "Saved to D1 table `dda_sales_entries`. Required fields match the API validations."
      }, []));

      var footerBtns = el(doc, "div", {
        style: "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;"
      }, []);

      var deleteBtn = el(doc, "button", { class: "eikon-dda-btn danger", text: "Delete" }, []);
      var saveBtn = el(doc, "button", { class: "eikon-dda-btn", text: "Save" }, []);
      deleteBtn.style.display = "none";

      saveBtn.onclick = function () { doSave(); };
      deleteBtn.onclick = function () {
        if (!formEls.id) return;
        doDelete({ id: formEls.id }, true);
      };

      footerBtns.appendChild(deleteBtn);
      footerBtns.appendChild(saveBtn);

      body.appendChild(footerBtns);
      modal.appendChild(head);
      modal.appendChild(body);
      modalBackdrop.appendChild(modal);

      modalBackdrop.onclick = function (e) {
        if (e && e.target === modalBackdrop) closeModal();
      };

      modalBackdrop._deleteBtn = deleteBtn;

      try { (doc.body || doc.documentElement).appendChild(modalBackdrop); } catch (e1) {}
    }

    function openModal() {
      if (!modalBackdrop) return;
      modalBackdrop.style.display = "flex";
    }
    function closeModal() {
      if (!modalBackdrop) return;
      modalBackdrop.style.display = "none";
    }

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
      formEls.client_id_card.value = String(row.client_id_card || "");
      formEls.client_address.value = String(row.client_address || "");
      formEls.medicine_name_dose.value = String(row.medicine_name_dose || "");
      formEls.quantity.value = String(row.quantity == null ? "1" : row.quantity);
      formEls.doctor_name.value = String(row.doctor_name || "");
      formEls.doctor_reg_no.value = String(row.doctor_reg_no || "");
      formEls.prescription_serial_no.value = String(row.prescription_serial_no || "");

      if (modalBackdrop && modalBackdrop._deleteBtn) modalBackdrop._deleteBtn.style.display = "inline-block";
      openModal();
    }

    function validateFormPayload() {
      var entry_date = String(formEls.entry_date.value || "").trim();
      var client_name = String(formEls.client_name.value || "").trim();
      var client_id_card = String(formEls.client_id_card.value || "").trim();
      var client_address = String(formEls.client_address.value || "").trim();
      var medicine_name_dose = String(formEls.medicine_name_dose.value || "").trim();
      var quantity = toIntSafe(formEls.quantity.value);
      var doctor_name = String(formEls.doctor_name.value || "").trim();
      var doctor_reg_no = String(formEls.doctor_reg_no.value || "").trim();
      var prescription_serial_no = String(formEls.prescription_serial_no.value || "").trim();

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
          prescription_serial_no: prescription_serial_no
        }
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
        if (formEls.id) {
          method = "PUT";
          path = "/dda-sales/entries/" + encodeURIComponent(String(formEls.id));
        } else {
          method = "POST";
          path = "/dda-sales/entries";
        }

        var data = await apiJson(ctx.win, path, { method: method, body: JSON.stringify(v.payload) });
        if (!data || data.ok !== true) throw new Error((data && data.error) ? String(data.error) : "Unexpected response");

        closeModal();
        setMsg("ok", "Saved.");
        setLoading(false);
        await refresh();
      } catch (e) {
        setLoading(false);
        var msg = (e && e.message) ? e.message : String(e || "Error");
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
      try { ok = ctx.win.confirm("Delete this DDA Sales entry?"); } catch (e) { ok = true; }
      if (!ok) return;

      setLoading(true);

      try {
        var data = await apiJson(ctx.win, "/dda-sales/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
        if (!data || data.ok !== true) throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
        if (fromModal) closeModal();
        setMsg("ok", "Deleted.");
        setLoading(false);
        await refresh();
      } catch (e) {
        setLoading(false);
        var msg = (e && e.message) ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setMsg("err", msg);
        warn("delete failed:", e);
      }
    }

    function renderInto(container) {
      ctx = resolveRenderContext(container);

      try { log("renderInto() ctx.note=", ctx.note, "mount=", !!ctx.mount, "doc=", !!ctx.doc, "win=", !!ctx.win); } catch (e) {}

      if (!ctx || !ctx.doc || !ctx.win || !ctx.mount) {
        try {
          var fallbackDoc = document;
          var fallbackMount = document.getElementById("eikon-root") || document.body;
          renderCrash(fallbackDoc, fallbackMount, "DDA Sales module cannot mount (invalid container)", new Error("core passed a non-mountable container"));
        } catch (e2) {}
        return;
      }

      try {
        ensureStyleOnce(ctx.doc);
        try { ctx.mount.innerHTML = ""; } catch (e3) {}

        // Init report defaults to current month
        if (!state.report_from || !state.report_to) {
          setReportDefaultsForMonth(state.month);
        }

        var wrap = el(ctx.doc, "div", { class: "eikon-dda-wrap" }, []);
        var top = el(ctx.doc, "div", { class: "eikon-dda-top" }, []);

        var title = el(ctx.doc, "div", { class: "eikon-dda-title" }, []);
        title.appendChild(el(ctx.doc, "span", { class: "icon", html: ICON_SVG }, []));
        title.appendChild(el(ctx.doc, "span", { text: "DDA Sales" }, []));
        top.appendChild(title);

        var controls = el(ctx.doc, "div", { class: "eikon-dda-controls" }, []);

        var monthField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        monthField.appendChild(el(ctx.doc, "label", { text: "Month" }, []));
        monthInput = el(ctx.doc, "input", { type: "month", value: state.month }, []);
        monthInput.onchange = function () {
          var m = String(monthInput.value || "").trim();
          if (isYm(m)) {
            state.month = m;
            // keep report range synced to chosen month
            setReportDefaultsForMonth(m);
            refresh();
          }
        };
        monthField.appendChild(monthInput);

        var qField = el(ctx.doc, "div", { class: "eikon-dda-field" }, []);
        qField.appendChild(el(ctx.doc, "label", { text: "Search" }, []));
        qInput = el(ctx.doc, "input", {
          type: "text",
          value: state.q,
          placeholder: "Client / ID / medicine / doctor / serial…"
        }, []);
        qInput.oninput = function () { state.q = String(qInput.value || ""); };
        qInput.onkeydown = function (e) { if (e && e.key === "Enter") refresh(); };
        qField.appendChild(qInput);

        refreshBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Refresh" }, []);
        refreshBtn.onclick = function () { refresh(); };

        addBtn = el(ctx.doc, "button", { class: "eikon-dda-btn", text: "New Entry" }, []);
        addBtn.onclick = function () { openModalForCreate(); };

        // Report range + Generate + Print
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
        card.appendChild(el(ctx.doc, "div", {
          class: "eikon-dda-hint",
          html: "Endpoints: `/dda-sales/entries` &nbsp;|&nbsp; Report JSON: `/dda-sales/report`"
        }, []));

        var tableWrap = el(ctx.doc, "div", { class: "eikon-dda-table-wrap", style: "margin-top:10px;" }, []);
        var table = el(ctx.doc, "table", { class: "eikon-dda-table" }, []);
        var thead = el(ctx.doc, "thead", {}, []);
        thead.appendChild(el(ctx.doc, "tr", {}, [
          el(ctx.doc, "th", { text: "Date" }, []),
          el(ctx.doc, "th", { text: "Client" }, []),
          el(ctx.doc, "th", { text: "ID Card" }, []),
          el(ctx.doc, "th", { text: "Address" }, []),
          el(ctx.doc, "th", { text: "Medicine (name & dose)" }, []),
          el(ctx.doc, "th", { text: "Qty" }, []),
          el(ctx.doc, "th", { text: "Doctor" }, []),
          el(ctx.doc, "th", { text: "Reg No." }, []),
          el(ctx.doc, "th", { text: "Prescription Serial No." }, []),
          el(ctx.doc, "th", { text: "Actions" }, [])
        ]));
        table.appendChild(thead);
        tableBody = el(ctx.doc, "tbody", {}, []);
        table.appendChild(tableBody);
        tableWrap.appendChild(table);
        card.appendChild(tableWrap);
        wrap.appendChild(card);

        // Report preview card
        var reportCard = el(ctx.doc, "div", { class: "eikon-dda-card", style: "margin-top:12px;" }, []);
        reportCard.appendChild(el(ctx.doc, "div", {
          class: "eikon-dda-hint",
          html: "Report preview is generated client-side (for printing in a new window to avoid iframe/sandbox print issues)."
        }, []));

        reportMsg = el(ctx.doc, "div", { class: "eikon-dda-msg", text: "" }, []);
        reportMsg.style.display = "none";
        reportCard.appendChild(reportMsg);

        reportPreview = el(ctx.doc, "div", {}, []);
        reportCard.appendChild(reportPreview);

        wrap.appendChild(reportCard);

        ctx.mount.appendChild(wrap);

        // build modal for this doc
        buildModalOnceForDoc(ctx.doc);

        // initial render
        renderRows();
        renderReportPreview();
        refresh();
      } catch (e) {
        warn("renderInto failed:", e);
        renderCrash(ctx.doc, ctx.mount, "DDA Sales module crashed while rendering", e);
      }
    }

    return {
      id: "dda-sales",
      key: "dda-sales",
      slug: "dda-sales",
      title: "DDA Sales",
      navTitle: "DDA Sales",
      icon: "",
      iconText: "",
      iconSvg: ICON_SVG,
      iconHTML: ICON_SVG,
      navIcon: ICON_SVG,
      hash: "#dda-sales",
      route: "dda-sales",
      render: renderInto,
      mount: renderInto,
      renderInto: renderInto
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
