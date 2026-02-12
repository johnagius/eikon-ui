/* module.ddasales.js
   Eikon UI Module — DDA Sales Register
   Works with Cloudflare Worker endpoints:
     GET    /dda-sales/entries?month=YYYY-MM&q=...
     POST   /dda-sales/entries
     PUT    /dda-sales/entries/:id
     DELETE /dda-sales/entries/:id
     GET    /dda-sales/report/html?from=YYYY-MM-DD&to=YYYY-MM-DD
*/

(function () {
  "use strict";

  var MODULE_KEY = "dda-sales";
  var STYLE_ID = "eikon-style-dda-sales";

  function safeString(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }

  function pad2(n) {
    n = Number(n);
    return (n < 10 ? "0" : "") + String(n);
  }

  function todayYmdLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function currentYmLocal() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function isValidYm(s) {
    return /^\d{4}-\d{2}$/.test(String(s || "").trim());
  }

  function isValidYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function monthStartEnd(ym) {
    var m = String(ym || "").trim();
    if (!isValidYm(m)) return null;
    var parts = m.split("-");
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
    var start = new Date(y, mo - 1, 1);
    var end = new Date(y, mo, 0);
    return {
      from: start.getFullYear() + "-" + pad2(start.getMonth() + 1) + "-" + pad2(start.getDate()),
      to: end.getFullYear() + "-" + pad2(end.getMonth() + 1) + "-" + pad2(end.getDate())
    };
  }

  function normalizeIntPositive(n) {
    if (n === null || n === undefined) return null;
    if (n === "") return null;
    var v = Number(n);
    if (!Number.isFinite(v)) return null;
    if (!Number.isInteger(v)) return null;
    if (v < 1) return null;
    return v;
  }

  function escHtml(s) {
    var str = safeString(s);
    return str.replace(/[&<>"']/g, function (c) {
      if (c === "&") return "&amp;";
      if (c === "<") return "&lt;";
      if (c === ">") return "&gt;";
      if (c === '"') return "&quot;";
      return "&#39;";
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs && typeof attrs === "object") {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === "class") node.className = v;
        else if (k === "style") node.setAttribute("style", v);
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "dataset" && v && typeof v === "object") {
          Object.keys(v).forEach(function (dk) {
            node.dataset[dk] = v[dk];
          });
        } else if (k in node) {
          try { node[k] = v; } catch (_) { node.setAttribute(k, v); }
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c === null || c === undefined) return;
          if (typeof c === "string" || typeof c === "number") node.appendChild(document.createTextNode(String(c)));
          else node.appendChild(c);
        });
      } else if (typeof child === "string" || typeof child === "number") {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function onceInjectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    var css = ""
      + ".eikon-dda-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;}"
      + ".eikon-dda-title{display:flex;align-items:flex-end;gap:12px;margin:0 0 10px 0;}"
      + ".eikon-dda-title h2{margin:0;font-size:18px;}"
      + ".eikon-dda-title .sub{color:#555;font-size:12px;}"
      + ".eikon-dda-card{border:1px solid #ddd;border-radius:12px;padding:12px;margin:12px 0;background:#fff;box-shadow:0 1px 0 rgba(0,0,0,.03);}"
      + ".eikon-dda-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:end;}"
      + ".eikon-dda-field{display:flex;flex-direction:column;gap:4px;}"
      + ".eikon-dda-field label{font-weight:800;font-size:12px;color:#222;}"
      + ".eikon-dda-field input,.eikon-dda-field select{padding:9px 10px;border:1px solid #ccc;border-radius:10px;font-size:14px;min-width:160px;}"
      + ".eikon-dda-btn{padding:10px 12px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:900;cursor:pointer;font-size:13px;}"
      + ".eikon-dda-btn.secondary{background:#444;}"
      + ".eikon-dda-btn.ghost{background:#fff;color:#111;border:1px solid #bbb;}"
      + ".eikon-dda-btn:disabled{opacity:.55;cursor:not-allowed;}"
      + ".eikon-dda-row{display:flex;gap:10px;align-items:center;justify-content:space-between;}"
      + ".eikon-dda-muted{color:#666;font-size:12px;}"
      + ".eikon-dda-table{width:100%;border-collapse:collapse;margin-top:10px;}"
      + ".eikon-dda-table th,.eikon-dda-table td{border:1px solid #bbb;padding:7px 8px;font-size:12px;vertical-align:top;}"
      + ".eikon-dda-table th{background:#f2f2f2;text-align:left;}"
      + ".eikon-dda-actions{display:flex;gap:6px;flex-wrap:wrap;}"
      + ".eikon-dda-mini{padding:6px 8px;border-radius:10px;border:1px solid #bbb;background:#fff;cursor:pointer;font-weight:800;font-size:12px;}"
      + ".eikon-dda-mini.danger{border-color:#b00020;color:#b00020;}"
      + ".eikon-dda-mini.primary{border-color:#111;background:#111;color:#fff;}"
      + ".eikon-dda-mini:disabled{opacity:.6;cursor:not-allowed;}"
      + ".eikon-dda-empty{padding:12px;color:#555;font-size:13px;}"
      + ".eikon-dda-toastwrap{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;}"
      + ".eikon-dda-toast{max-width:360px;padding:10px 12px;border-radius:12px;border:1px solid #ddd;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.12);font-size:13px;}"
      + ".eikon-dda-toast.ok{border-color:#1b7f2a;}"
      + ".eikon-dda-toast.err{border-color:#b00020;}"
      + ".eikon-dda-modalback{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:18px;}"
      + ".eikon-dda-modal{width:min(860px,100%);background:#fff;border-radius:16px;border:1px solid #ddd;box-shadow:0 18px 60px rgba(0,0,0,.25);overflow:hidden;}"
      + ".eikon-dda-modal header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;}"
      + ".eikon-dda-modal header h3{margin:0;font-size:16px;}"
      + ".eikon-dda-modal .body{padding:14px;}"
      + ".eikon-dda-grid{display:grid;grid-template-columns:repeat(2, minmax(0,1fr));gap:10px;}"
      + ".eikon-dda-grid .full{grid-column:1 / -1;}"
      + ".eikon-dda-modal footer{display:flex;gap:10px;justify-content:flex-end;padding:12px 14px;border-top:1px solid #eee;}"
      + ".eikon-dda-help{font-size:12px;color:#555;}"
      + "@media (max-width:720px){"
      + "  .eikon-dda-grid{grid-template-columns:1fr;}"
      + "  .eikon-dda-field input{min-width:unset;width:100%;}"
      + "}";

    var style = el("style", { id: STYLE_ID, text: css });
    document.head.appendChild(style);
  }

  function getApiBase(ctx) {
    if (ctx && ctx.apiBase) return String(ctx.apiBase).replace(/\/+$/, "");
    if (window.EIKON_API_BASE) return String(window.EIKON_API_BASE).replace(/\/+$/, "");
    if (window.Eikon && window.Eikon.apiBase) return String(window.Eikon.apiBase).replace(/\/+$/, "");
    return window.location.origin;
  }

  function getToken(ctx) {
    if (ctx && ctx.token) return String(ctx.token);
    if (window.Eikon && window.Eikon.token) return String(window.Eikon.token);
    try {
      var t1 = localStorage.getItem("eikon_token");
      if (t1) return t1;
      var t2 = localStorage.getItem("token");
      if (t2) return t2;
      return "";
    } catch (_) {
      return "";
    }
  }

  function setTokenMaybe(ctx, token) {
    if (!token) return;
    if (ctx) ctx.token = token;
    if (window.Eikon) window.Eikon.token = token;
    try { localStorage.setItem("eikon_token", token); } catch (_) {}
  }

  function toast(msg, type) {
    var wrap = document.querySelector(".eikon-dda-toastwrap");
    if (!wrap) {
      wrap = el("div", { class: "eikon-dda-toastwrap" });
      document.body.appendChild(wrap);
    }
    var node = el("div", { class: "eikon-dda-toast " + (type === "err" ? "err" : "ok") },
      el("div", { style: "font-weight:900;margin-bottom:2px;" }, type === "err" ? "Error" : "OK"),
      el("div", {}, msg)
    );
    wrap.appendChild(node);
    setTimeout(function () {
      try { node.remove(); } catch (_) {}
    }, 3600);
  }

  function parseJsonSafe(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function apiFetch(ctx, method, path, bodyObj, queryObj, abortSignal) {
    var base = getApiBase(ctx);
    var url = base + path;
    if (queryObj && typeof queryObj === "object") {
      var usp = new URLSearchParams();
      Object.keys(queryObj).forEach(function (k) {
        var v = queryObj[k];
        if (v === null || v === undefined) return;
        var s = String(v);
        if (s === "") return;
        usp.set(k, s);
      });
      var qs = usp.toString();
      if (qs) url += (url.indexOf("?") >= 0 ? "&" : "?") + qs;
    }

    var token = getToken(ctx);
    var headers = {
      "Content-Type": "application/json"
    };
    if (token) headers["Authorization"] = "Bearer " + token;

    var opts = {
      method: method,
      headers: headers,
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      signal: abortSignal
    };

    if (bodyObj !== undefined) {
      opts.body = JSON.stringify(bodyObj);
    }

    return fetch(url, opts).then(function (res) {
      return res.text().then(function (txt) {
        var json = parseJsonSafe(txt);
        var ok = res.ok;
        var status = res.status;

        // Token refresh patterns (optional) — if server ever returns a token
        if (json && json.token) setTokenMaybe(ctx, json.token);

        if (!ok) {
          var errMsg = "Request failed";
          if (json && json.error) errMsg = String(json.error);
          else if (txt) errMsg = txt.slice(0, 240);
          var err = new Error(errMsg);
          err.status = status;
          err.payload = json;
          throw err;
        }
        return json !== null ? json : { ok: true, raw: txt };
      });
    });
  }

  function downloadBlob(filename, blob) {
    var a = document.createElement("a");
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (_) {}
      try { a.remove(); } catch (_) {}
    }, 0);
  }

  function csvEscapeCell(v) {
    var s = safeString(v);
    var needs = /[",\n\r]/.test(s);
    var out = s.replace(/"/g, '""');
    return needs ? '"' + out + '"' : out;
  }

  function entriesToCsv(entries) {
    var headers = [
      "ID",
      "Entry Date",
      "Client Name",
      "ID Card",
      "Address",
      "Medicine Name & Dose",
      "Quantity",
      "Doctor Name",
      "Doctor Reg No.",
      "Prescription Serial No.",
      "Created At",
      "Updated At"
    ];

    var lines = [];
    lines.push(headers.map(csvEscapeCell).join(","));

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      var row = [
        safeString(e.id),
        safeString(e.entry_date),
        safeString(e.client_name),
        safeString(e.client_id_card),
        safeString(e.client_address),
        safeString(e.medicine_name_dose),
        safeString(e.quantity),
        safeString(e.doctor_name),
        safeString(e.doctor_reg_no),
        safeString(e.prescription_serial_no),
        safeString(e.created_at),
        safeString(e.updated_at)
      ];
      lines.push(row.map(csvEscapeCell).join(","));
    }

    return lines.join("\r\n");
  }

  function createModal(titleText) {
    var back = el("div", { class: "eikon-dda-modalback" });
    var modal = el("div", { class: "eikon-dda-modal", role: "dialog", "aria-modal": "true" });
    var header = el("header", {},
      el("h3", { text: titleText }),
      el("button", { class: "eikon-dda-mini", type: "button", text: "Close" })
    );
    var body = el("div", { class: "body" });
    var footer = el("footer", {});
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    back.appendChild(modal);

    function close() {
      try { back.remove(); } catch (_) {}
      document.removeEventListener("keydown", onKeyDown);
    }

    function onKeyDown(ev) {
      if (ev.key === "Escape") close();
    }

    header.querySelector("button").addEventListener("click", function () { close(); });
    back.addEventListener("click", function (ev) {
      if (ev.target === back) close();
    });

    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(back);

    return {
      back: back,
      modal: modal,
      body: body,
      footer: footer,
      close: close
    };
  }

  function buildField(labelText, inputEl, helpText, extraClass) {
    var field = el("div", { class: "eikon-dda-field" + (extraClass ? " " + extraClass : "") },
      el("label", { text: labelText }),
      inputEl
    );
    if (helpText) field.appendChild(el("div", { class: "eikon-dda-help", text: helpText }));
    return field;
  }

  function trimAll(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (typeof v === "string") out[k] = v.trim();
      else out[k] = v;
    });
    return out;
  }

  function buildDdaPayloadFromForm(form) {
    var payload = {
      entry_date: safeString(form.entry_date || "").trim(),
      client_name: safeString(form.client_name || "").trim(),
      client_id_card: safeString(form.client_id_card || "").trim(),
      client_address: safeString(form.client_address || "").trim(),
      medicine_name_dose: safeString(form.medicine_name_dose || "").trim(),
      quantity: normalizeIntPositive(form.quantity),
      doctor_name: safeString(form.doctor_name || "").trim(),
      doctor_reg_no: safeString(form.doctor_reg_no || "").trim(),
      prescription_serial_no: safeString(form.prescription_serial_no || "").trim()
    };
    return payload;
  }

  function validateDdaPayload(payload) {
    if (!isValidYmd(payload.entry_date)) return "Invalid entry_date (YYYY-MM-DD)";
    if (!payload.client_name) return "Missing client_name";
    if (!payload.client_id_card) return "Missing client_id_card";
    if (!payload.client_address) return "Missing client_address";
    if (!payload.medicine_name_dose) return "Missing medicine_name_dose";
    if (!payload.quantity || payload.quantity < 1) return "Invalid quantity (must be an integer >= 1)";
    if (!payload.doctor_name) return "Missing doctor_name";
    if (!payload.doctor_reg_no) return "Missing doctor_reg_no";
    if (!payload.prescription_serial_no) return "Missing prescription_serial_no";
    return "";
  }

  function createModule() {
    onceInjectStyle();

    var state = {
      mounted: false,
      root: null,
      ctx: null,
      abort: null,
      month: currentYmLocal(),
      q: "",
      entries: [],
      loading: false,
      lastLoadError: "",
      lastMonthSavedKey: "eikon_dda_sales_last_month",
      lastQSavedKey: "eikon_dda_sales_last_q"
    };

    var refs = {
      monthInput: null,
      qInput: null,
      refreshBtn: null,
      newBtn: null,
      exportBtn: null,
      reportBtn: null,
      fromInput: null,
      toInput: null,
      tableWrap: null,
      countSpan: null,
      statusSpan: null
    };

    function loadPrefs() {
      try {
        var savedM = localStorage.getItem(state.lastMonthSavedKey);
        if (savedM && isValidYm(savedM)) state.month = savedM;
        var savedQ = localStorage.getItem(state.lastQSavedKey);
        if (savedQ !== null && savedQ !== undefined) state.q = String(savedQ || "");
      } catch (_) {}
    }

    function savePrefs() {
      try {
        localStorage.setItem(state.lastMonthSavedKey, state.month);
        localStorage.setItem(state.lastQSavedKey, state.q);
      } catch (_) {}
    }

    function setLoading(on) {
      state.loading = !!on;
      if (refs.refreshBtn) refs.refreshBtn.disabled = state.loading;
      if (refs.newBtn) refs.newBtn.disabled = state.loading;
      if (refs.exportBtn) refs.exportBtn.disabled = state.loading || !(state.entries && state.entries.length);
      if (refs.reportBtn) refs.reportBtn.disabled = state.loading;
      if (refs.statusSpan) refs.statusSpan.textContent = state.loading ? "Loading…" : (state.lastLoadError ? state.lastLoadError : "");
    }

    function renderTable() {
      var wrap = refs.tableWrap;
      if (!wrap) return;

      wrap.innerHTML = "";

      if (state.loading) {
        wrap.appendChild(el("div", { class: "eikon-dda-empty", text: "Loading…" }));
        return;
      }

      if (state.lastLoadError) {
        wrap.appendChild(el("div", { class: "eikon-dda-empty", html: "<b>Error:</b> " + escHtml(state.lastLoadError) }));
      }

      var entries = state.entries || [];
      if (!entries.length) {
        wrap.appendChild(el("div", { class: "eikon-dda-empty", text: "No entries found for this month." }));
        return;
      }

      var table = el("table", { class: "eikon-dda-table" });
      var thead = el("thead");
      var trh = el("tr");
      var headers = [
        "Date",
        "Client Name",
        "ID Card",
        "Address",
        "Medicine Name & Dose",
        "Qty",
        "Doctor Name",
        "Doctor Reg No.",
        "Prescription Serial No.",
        "Actions"
      ];
      for (var i = 0; i < headers.length; i++) trh.appendChild(el("th", { text: headers[i] }));
      thead.appendChild(trh);
      table.appendChild(thead);

      var tbody = el("tbody");
      for (var r = 0; r < entries.length; r++) {
        var e = entries[r] || {};
        var tr = el("tr");
        tr.appendChild(el("td", { text: safeString(e.entry_date) }));
        tr.appendChild(el("td", { text: safeString(e.client_name) }));
        tr.appendChild(el("td", { text: safeString(e.client_id_card) }));
        tr.appendChild(el("td", { text: safeString(e.client_address) }));
        tr.appendChild(el("td", { text: safeString(e.medicine_name_dose) }));
        tr.appendChild(el("td", { text: safeString(e.quantity) }));
        tr.appendChild(el("td", { text: safeString(e.doctor_name) }));
        tr.appendChild(el("td", { text: safeString(e.doctor_reg_no) }));
        tr.appendChild(el("td", { text: safeString(e.prescription_serial_no) }));

        var actionTd = el("td");
        var actions = el("div", { class: "eikon-dda-actions" });

        var editBtn = el("button", { class: "eikon-dda-mini primary", type: "button", text: "Edit" });
        editBtn.addEventListener("click", (function (entry) {
          return function () { openEntryModal(entry); };
        })(e));

        var delBtn = el("button", { class: "eikon-dda-mini danger", type: "button", text: "Delete" });
        delBtn.addEventListener("click", (function (entry) {
          return function () { confirmDelete(entry); };
        })(e));

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        actionTd.appendChild(actions);
        tr.appendChild(actionTd);

        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      wrap.appendChild(table);
    }

    function setCount() {
      if (!refs.countSpan) return;
      var n = (state.entries && state.entries.length) ? state.entries.length : 0;
      refs.countSpan.textContent = String(n);
    }

    function updateReportRangeDefaults() {
      var range = monthStartEnd(state.month);
      if (!range) return;
      if (refs.fromInput) refs.fromInput.value = range.from;
      if (refs.toInput) refs.toInput.value = range.to;
    }

    function cancelInFlight() {
      if (state.abort) {
        try { state.abort.abort(); } catch (_) {}
      }
      state.abort = null;
    }

    function loadEntries() {
      cancelInFlight();
      state.abort = new AbortController();
      var sig = state.abort.signal;

      state.lastLoadError = "";
      setLoading(true);

      var month = state.month;
      var q = state.q;

      apiFetch(state.ctx, "GET", "/dda-sales/entries", undefined, { month: month, q: q }, sig)
        .then(function (data) {
          if (!data || data.ok !== true) {
            throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
          }
          state.entries = Array.isArray(data.entries) ? data.entries : [];
          setCount();
          renderTable();
          setLoading(false);
          savePrefs();
        })
        .catch(function (err) {
          if (err && (err.name === "AbortError" || err.message === "The user aborted a request.")) return;
          state.entries = [];
          setCount();
          state.lastLoadError = (err && err.message) ? String(err.message) : "Failed to load";
          setLoading(false);
          renderTable();

          if (err && err.status === 401) {
            toast("Unauthorized. Please log in again.", "err");
            if (state.ctx && typeof state.ctx.onUnauthorized === "function") {
              try { state.ctx.onUnauthorized(); } catch (_) {}
            }
          } else {
            toast(state.lastLoadError, "err");
          }
        });
    }

    function openReportHtml() {
      var from = refs.fromInput ? refs.fromInput.value.trim() : "";
      var to = refs.toInput ? refs.toInput.value.trim() : "";
      if (!isValidYmd(from) || !isValidYmd(to)) {
        toast("Invalid report date range. Use YYYY-MM-DD.", "err");
        return;
      }
      if (to < from) {
        toast("Report range invalid: to must be >= from.", "err");
        return;
      }

      var base = getApiBase(state.ctx);
      var token = getToken(state.ctx);

      // Prefer opening directly; auth header cannot be added for window.open.
      // If UI is served from same origin and token is stored in localStorage (used by fetch),
      // the report endpoint still requires Authorization header.
      //
      // So we provide two modes:
      // 1) Try to open report in a new tab using a special "token in query" pattern if you implement it later (not in Worker).
      // 2) Fallback: fetch the HTML with Authorization, then open a blob URL.
      //
      // Since the Worker code requires Authorization and does NOT accept token in query,
      // we implement the secure fallback via fetch+blob.

      setLoading(true);

      apiFetch(state.ctx, "GET", "/dda-sales/report/html", undefined, { from: from, to: to }, state.abort ? state.abort.signal : undefined)
        .then(function (dataOrRaw) {
          // apiFetch parses JSON by default; but /report/html returns HTML.
          // Our apiFetch will try JSON.parse and fail -> returns {ok:true, raw: txt}
          // so we use raw.
          var html = "";
          if (dataOrRaw && typeof dataOrRaw.raw === "string") html = dataOrRaw.raw;
          else if (typeof dataOrRaw === "string") html = dataOrRaw;
          else html = "";

          if (!html || html.indexOf("<!doctype") === -1) {
            // If server returned JSON error or something unexpected.
            // Try to show a meaningful message.
            if (dataOrRaw && dataOrRaw.error) throw new Error(String(dataOrRaw.error));
            throw new Error("Unexpected report response");
          }

          var blob = new Blob([html], { type: "text/html;charset=utf-8" });
          var url = URL.createObjectURL(blob);
          window.open(url, "_blank", "noopener,noreferrer");
          setTimeout(function () {
            try { URL.revokeObjectURL(url); } catch (_) {}
          }, 60000);

          setLoading(false);
        })
        .catch(function (err) {
          setLoading(false);
          var msg = (err && err.message) ? String(err.message) : "Failed to open report";
          toast(msg, "err");
        });
    }

    function exportCsv() {
      var entries = state.entries || [];
      if (!entries.length) {
        toast("No entries to export.", "err");
        return;
      }
      var csv = entriesToCsv(entries);
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      var fname = "dda-sales_" + state.month + ".csv";
      downloadBlob(fname, blob);
      toast("Exported CSV: " + fname, "ok");
    }

    function openEntryModal(existingEntry) {
      var isEdit = !!(existingEntry && existingEntry.id);

      var modal = createModal(isEdit ? "Edit DDA Sale Entry" : "New DDA Sale Entry");

      var defaults = {
        entry_date: todayYmdLocal(),
        client_name: "",
        client_id_card: "",
        client_address: "",
        medicine_name_dose: "",
        quantity: 1,
        doctor_name: "",
        doctor_reg_no: "",
        prescription_serial_no: ""
      };

      var init = {};
      Object.keys(defaults).forEach(function (k) { init[k] = defaults[k]; });

      if (isEdit) {
        init.entry_date = safeString(existingEntry.entry_date || defaults.entry_date);
        init.client_name = safeString(existingEntry.client_name || "");
        init.client_id_card = safeString(existingEntry.client_id_card || "");
        init.client_address = safeString(existingEntry.client_address || "");
        init.medicine_name_dose = safeString(existingEntry.medicine_name_dose || "");
        init.quantity = (existingEntry.quantity !== null && existingEntry.quantity !== undefined) ? Number(existingEntry.quantity) : defaults.quantity;
        init.doctor_name = safeString(existingEntry.doctor_name || "");
        init.doctor_reg_no = safeString(existingEntry.doctor_reg_no || "");
        init.prescription_serial_no = safeString(existingEntry.prescription_serial_no || "");
      }

      var entryDate = el("input", { type: "date", value: init.entry_date });
      var clientName = el("input", { type: "text", value: init.client_name, placeholder: "Name & Surname" });
      var clientId = el("input", { type: "text", value: init.client_id_card, placeholder: "ID Card No." });
      var clientAddress = el("input", { type: "text", value: init.client_address, placeholder: "Address" });
      var medicineNameDose = el("input", { type: "text", value: init.medicine_name_dose, placeholder: "Medicine name + dose" });
      var quantity = el("input", { type: "number", value: String(init.quantity), min: "1", step: "1" });
      var doctorName = el("input", { type: "text", value: init.doctor_name, placeholder: "Doctor name" });
      var doctorRegNo = el("input", { type: "text", value: init.doctor_reg_no, placeholder: "Doctor registration no." });
      var serial = el("input", { type: "text", value: init.prescription_serial_no, placeholder: "Prescription serial no." });

      var grid = el("div", { class: "eikon-dda-grid" },
        buildField("Entry Date", entryDate, "Required (YYYY-MM-DD)."),
        buildField("Quantity", quantity, "Integer >= 1."),
        buildField("Client Name", clientName, "Required."),
        buildField("Client ID Card", clientId, "Required."),
        buildField("Client Address", clientAddress, "Required.", "full"),
        buildField("Medicine Name & Dose", medicineNameDose, "Required.", "full"),
        buildField("Doctor Name", doctorName, "Required."),
        buildField("Doctor Reg No.", doctorRegNo, "Required."),
        buildField("Prescription Serial No.", serial, "Required.", "full")
      );

      modal.body.appendChild(grid);

      var saveBtn = el("button", { class: "eikon-dda-btn", type: "button", text: isEdit ? "Save Changes" : "Create Entry" });
      var cancelBtn = el("button", { class: "eikon-dda-btn ghost", type: "button", text: "Cancel" });

      var busy = false;
      function setBusy(on) {
        busy = !!on;
        saveBtn.disabled = busy;
        cancelBtn.disabled = busy;
      }

      cancelBtn.addEventListener("click", function () {
        if (busy) return;
        modal.close();
      });

      saveBtn.addEventListener("click", function () {
        if (busy) return;

        var form = trimAll({
          entry_date: entryDate.value,
          client_name: clientName.value,
          client_id_card: clientId.value,
          client_address: clientAddress.value,
          medicine_name_dose: medicineNameDose.value,
          quantity: quantity.value,
          doctor_name: doctorName.value,
          doctor_reg_no: doctorRegNo.value,
          prescription_serial_no: serial.value
        });

        var payload = buildDdaPayloadFromForm(form);
        var errMsg = validateDdaPayload(payload);
        if (errMsg) {
          toast(errMsg, "err");
          return;
        }

        setBusy(true);

        var method = isEdit ? "PUT" : "POST";
        var path = isEdit ? ("/dda-sales/entries/" + encodeURIComponent(String(existingEntry.id))) : "/dda-sales/entries";

        apiFetch(state.ctx, method, path, payload, undefined, undefined)
          .then(function (data) {
            if (!data || data.ok !== true) {
              throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
            }
            toast(isEdit ? "Entry updated." : "Entry created.", "ok");
            modal.close();
            loadEntries();
          })
          .catch(function (err) {
            var msg = (err && err.message) ? String(err.message) : "Save failed";
            toast(msg, "err");
          })
          .finally(function () {
            setBusy(false);
          });
      });

      modal.footer.appendChild(cancelBtn);
      modal.footer.appendChild(saveBtn);

      // Focus first field
      setTimeout(function () {
        try { entryDate.focus(); } catch (_) {}
      }, 0);
    }

    function confirmDelete(entry) {
      if (!entry || !entry.id) return;

      var modal = createModal("Delete Entry");
      modal.body.appendChild(
        el("div", { class: "eikon-dda-card", style: "border-color:#f0c0c0;background:#fff6f6;" },
          el("div", { style: "font-weight:900;margin-bottom:6px;color:#b00020;" }, "This cannot be undone."),
          el("div", { class: "eikon-dda-muted" }, "Entry: "),
          el("div", { style: "font-size:13px;margin-top:6px;" },
            el("div", {}, el("b", {}, "Date: "), safeString(entry.entry_date)),
            el("div", {}, el("b", {}, "Client: "), safeString(entry.client_name)),
            el("div", {}, el("b", {}, "Medicine: "), safeString(entry.medicine_name_dose)),
            el("div", {}, el("b", {}, "Qty: "), safeString(entry.quantity)),
            el("div", {}, el("b", {}, "Serial: "), safeString(entry.prescription_serial_no))
          )
        )
      );

      var delBtn = el("button", { class: "eikon-dda-btn", type: "button", text: "Delete" });
      var cancelBtn = el("button", { class: "eikon-dda-btn ghost", type: "button", text: "Cancel" });

      var busy = false;
      function setBusy(on) {
        busy = !!on;
        delBtn.disabled = busy;
        cancelBtn.disabled = busy;
      }

      cancelBtn.addEventListener("click", function () {
        if (busy) return;
        modal.close();
      });

      delBtn.addEventListener("click", function () {
        if (busy) return;
        setBusy(true);

        var path = "/dda-sales/entries/" + encodeURIComponent(String(entry.id));

        apiFetch(state.ctx, "DELETE", path, undefined, undefined, undefined)
          .then(function (data) {
            if (!data || data.ok !== true) {
              throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
            }
            toast("Entry deleted.", "ok");
            modal.close();
            loadEntries();
          })
          .catch(function (err) {
            var msg = (err && err.message) ? String(err.message) : "Delete failed";
            toast(msg, "err");
          })
          .finally(function () {
            setBusy(false);
          });
      });

      modal.footer.appendChild(cancelBtn);
      modal.footer.appendChild(delBtn);
    }

    function buildUi(root) {
      root.innerHTML = "";
      root.classList.add("eikon-dda-wrap");

      var titleRow = el("div", { class: "eikon-dda-title" },
        el("h2", { text: "DDA Sales Register" }),
        el("div", { class: "sub", html: "Controlled drugs sales log (DDA) — <span class='eikon-dda-muted'>entries this month: </span><b id='ddaCount'>0</b>" })
      );

      var toolbarCard = el("div", { class: "eikon-dda-card" });

      var monthInput = el("input", { type: "month", value: state.month });
      // Some browsers may not support type=month; fall back gracefully.
      monthInput.addEventListener("input", function () {
        var v = String(monthInput.value || "").trim();
        if (!v) return;
        // Some browsers output YYYY-MM; others might include day; normalize.
        if (/^\d{4}-\d{2}/.test(v)) v = v.slice(0, 7);
        if (!isValidYm(v)) return;
        state.month = v;
        updateReportRangeDefaults();
      });

      var qInput = el("input", { type: "text", value: state.q, placeholder: "Search (client, ID, medicine, doctor, serial…)" });
      qInput.addEventListener("input", function () {
        state.q = String(qInput.value || "");
      });

      var fromInput = el("input", { type: "date", value: "" });
      var toInput = el("input", { type: "date", value: "" });

      var refreshBtn = el("button", { class: "eikon-dda-btn", type: "button", text: "Refresh" });
      var newBtn = el("button", { class: "eikon-dda-btn secondary", type: "button", text: "New Entry" });
      var exportBtn = el("button", { class: "eikon-dda-btn ghost", type: "button", text: "Export CSV" });
      var reportBtn = el("button", { class: "eikon-dda-btn ghost", type: "button", text: "Open Report (HTML)" });

      refreshBtn.addEventListener("click", function () {
        var v = String(monthInput.value || "").trim();
        if (/^\d{4}-\d{2}/.test(v)) v = v.slice(0, 7);
        if (v && isValidYm(v)) state.month = v;
        state.q = String(qInput.value || "");
        updateReportRangeDefaults();
        loadEntries();
      });

      newBtn.addEventListener("click", function () {
        openEntryModal(null);
      });

      exportBtn.addEventListener("click", function () {
        exportCsv();
      });

      reportBtn.addEventListener("click", function () {
        openReportHtml();
      });

      // Enter key in search triggers refresh
      qInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          refreshBtn.click();
        }
      });

      var statusSpan = el("span", { class: "eikon-dda-muted", text: "" });

      var toolbar = el("div", { class: "eikon-dda-toolbar" },
        buildField("Month", monthInput, "YYYY-MM (used for list/filter)."),
        buildField("Search", qInput, "Optional. Press Enter to refresh.", "full"),
        buildField("Report From", fromInput, "Used by HTML report."),
        buildField("Report To", toInput, "Used by HTML report."),
        el("div", { class: "eikon-dda-field" },
          el("label", { text: "Actions" }),
          el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;" }, refreshBtn, newBtn, exportBtn, reportBtn),
          statusSpan
        )
      );

      toolbarCard.appendChild(toolbar);

      var tableCard = el("div", { class: "eikon-dda-card" });
      var tableWrap = el("div", {});
      tableCard.appendChild(el("div", { class: "eikon-dda-row" },
        el("div", { class: "eikon-dda-muted", html: "List for <b>" + escHtml(state.month) + "</b>" + (state.q ? " — filtered" : "") }),
        el("div", { class: "eikon-dda-muted" }, "Tip: Use Search to find by serial no., ID card, medicine, etc.")
      ));
      tableCard.appendChild(tableWrap);

      root.appendChild(titleRow);
      root.appendChild(toolbarCard);
      root.appendChild(tableCard);

      refs.monthInput = monthInput;
      refs.qInput = qInput;
      refs.refreshBtn = refreshBtn;
      refs.newBtn = newBtn;
      refs.exportBtn = exportBtn;
      refs.reportBtn = reportBtn;
      refs.fromInput = fromInput;
      refs.toInput = toInput;
      refs.tableWrap = tableWrap;
      refs.countSpan = root.querySelector("#ddaCount");
      refs.statusSpan = statusSpan;

      updateReportRangeDefaults();
      setCount();
      renderTable();
      setLoading(false);
    }

    function mount(root, ctx) {
      if (!root) throw new Error("module.ddasales: missing root element");
      if (state.mounted) unmount();

      state.root = root;
      state.ctx = ctx || {};
      state.mounted = true;

      loadPrefs();
      buildUi(root);

      // Ensure month inputs reflect loaded prefs
      if (refs.monthInput) refs.monthInput.value = state.month;
      if (refs.qInput) refs.qInput.value = state.q;
      updateReportRangeDefaults();

      loadEntries();
    }

    function unmount() {
      cancelInFlight();
      state.mounted = false;
      if (state.root) {
        try { state.root.innerHTML = ""; } catch (_) {}
        try { state.root.classList.remove("eikon-dda-wrap"); } catch (_) {}
      }
      state.root = null;
      state.ctx = null;
      refs.monthInput = null;
      refs.qInput = null;
      refs.refreshBtn = null;
      refs.newBtn = null;
      refs.exportBtn = null;
      refs.reportBtn = null;
      refs.fromInput = null;
      refs.toInput = null;
      refs.tableWrap = null;
      refs.countSpan = null;
      refs.statusSpan = null;
    }

    return {
      key: MODULE_KEY,
      title: "DDA Sales",
      mount: mount,
      unmount: unmount,
      init: mount // alias for loaders that call init()
    };
  }

  // Register module in a flexible way:
  // - window.EikonModules[MODULE_KEY]
  // - window.Eikon.registerModule(MODULE_KEY, module)
  // - window.registerEikonModule(MODULE_KEY, module)
  var moduleObj = createModule();

  if (!window.EikonModules) window.EikonModules = {};
  window.EikonModules[MODULE_KEY] = moduleObj;

  if (window.Eikon && typeof window.Eikon.registerModule === "function") {
    try { window.Eikon.registerModule(MODULE_KEY, moduleObj); } catch (_) {}
  }

  if (typeof window.registerEikonModule === "function") {
    try { window.registerEikonModule(MODULE_KEY, moduleObj); } catch (_) {}
  }
})();
