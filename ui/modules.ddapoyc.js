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

    async function doDelete(row) {
      if (!ctx) return;
      var id = row && row.id;
      if (!id) return;

      var ok = true;
      try {
        ok = window.confirm("Delete this entry?");
      } catch (e) {
        ok = true;
      }
      if (!ok) return;

      try {
        setMsg("", "");
        setLoading(true);
        var data = await apiJson(ctx.win, "/dda-poyc/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
        if (!data || data.ok !== true)
          throw new Error(data && data.error ? String(data.error) : "Unexpected response");
        await refresh();
      } catch (e) {
        var msg = e && e.message ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
        setMsg("err", msg);
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
