(function () {
  "use strict";

  var TAG = "[dda-poyc]";
  function log() { try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {} }
  function warn() { try { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {} }

  // Same icon style as dda-sales (keep consistent UI)
  var ICON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M7 7h10M7 12h10M7 17h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  // ---------- tiny DOM helper (matches dda-sales style) ----------
  function el(doc, tag, props, children) {
    var n = doc.createElement(tag);
    props = props || {};
    for (var k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      var v = props[k];
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k in n) { try { n[k] = v; } catch (e) { n.setAttribute(k, v); } }
      else n.setAttribute(k, v);
    }
    if (children && children.length) {
      for (var i = 0; i < children.length; i++) if (children[i]) n.appendChild(children[i]);
    }
    return n;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad2(n) { n = Number(n || 0); return (n < 10 ? "0" : "") + n; }
  function isYm(s) { return /^\d{4}-\d{2}$/.test(String(s || "").trim()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }

  function monthStartEnd(ym) {
    if (!isYm(ym)) return null;
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5, 7), 10);
    var start = new Date(Date.UTC(y, m - 1, 1));
    var end = new Date(Date.UTC(y, m, 1));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10)
    };
  }

  function setReportDefaultsForMonth(ym) {
    var r = monthStartEnd(ym);
    if (!r) return;
    state.report_from = r.start;
    // end should be last day of month (inclusive)
    var end = new Date(r.end + "T00:00:00Z");
    end.setUTCDate(end.getUTCDate() - 1);
    state.report_to = end.toISOString().slice(0, 10);
  }

  function toIntSafe(v) {
    if (v == null) return null;
    var n = Number(v);
    if (!Number.isFinite(n)) return null;
    var i = Math.floor(n);
    if (!Number.isInteger(n) && n !== i) return null;
    return i;
  }

  // ---------- api ----------
  async function apiJson(win, path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers["Content-Type"] = "application/json";

    // Core likely injects auth header at fetch layer, but keep consistent with dda-sales
    opts.headers = headers;

    var res = await win.fetch(path, opts);
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    var data = null;
    if (ct.indexOf("application/json") >= 0) data = await res.json();
    else data = { ok: false, error: "Unexpected response type" };

    if (!res.ok) {
      var err = new Error((data && data.error) ? String(data.error) : ("HTTP " + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- render root resolution (same strategy as dda-sales) ----------
  function resolveRenderContext(container) {
    var mount = null;
    var doc = null;
    var win = null;

    // container might be: element, {el}, {root}, {mount}, {container}, or iframe doc body wrapper
    if (container && container.ownerDocument) {
      mount = container;
      doc = container.ownerDocument;
      win = doc.defaultView || window;
    } else if (container && container.el && container.el.ownerDocument) {
      mount = container.el;
      doc = mount.ownerDocument;
      win = doc.defaultView || window;
    } else if (container && container.root && container.root.ownerDocument) {
      mount = container.root;
      doc = mount.ownerDocument;
      win = doc.defaultView || window;
    } else if (container && container.mount && container.mount.ownerDocument) {
      mount = container.mount;
      doc = mount.ownerDocument;
      win = doc.defaultView || window;
    } else if (container && container.container && container.container.ownerDocument) {
      mount = container.container;
      doc = mount.ownerDocument;
      win = doc.defaultView || window;
    } else {
      // last resort
      doc = document;
      win = window;
      mount = document.getElementById("app") || document.body;
    }

    if (!mount || !doc || !win) return null;
    return { mount: mount, doc: doc, win: win };
  }

  // ---------- styles (identical to dda-sales; injected once) ----------
  var STYLE_ID = "eikon-dda-style";
  function ensureStyleOnce(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    var css = ""
      + ".eikon-dda-wrap{padding:14px;max-width:1200px;margin:0 auto;}"
      + ".eikon-dda-top{display:flex;flex-direction:column;gap:12px;margin-bottom:12px;}"
      + ".eikon-dda-title{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800;}"
      + ".eikon-dda-title .icon{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:10px;background:#111;color:#fff;}"
      + ".eikon-dda-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}"
      + ".eikon-dda-field{display:flex;flex-direction:column;gap:6px;min-width:160px;}"
      + ".eikon-dda-field label{font-size:12px;color:#444;font-weight:700;}"
      + ".eikon-dda-field input{padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;}"
      + ".eikon-dda-btn{padding:10px 14px;border-radius:10px;border:0;background:#111;color:#fff;font-weight:800;cursor:pointer;}"
      + ".eikon-dda-btn.secondary{background:#f1f1f1;color:#111;border:1px solid #ddd;}"
      + ".eikon-dda-btn.danger{background:#b00020;color:#fff;}"
      + ".eikon-dda-card{background:#fff;border:1px solid #e6e6e6;border-radius:14px;padding:12px;box-shadow:0 2px 10px rgba(0,0,0,.04);}"
      + ".eikon-dda-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}"
      + ".eikon-dda-card-head h3{margin:0;font-size:14px;font-weight:900;}"
      + ".eikon-dda-table-wrap{overflow:auto;border-radius:12px;border:1px solid #eee;}"
      + ".eikon-dda-table{width:100%;border-collapse:collapse;font-size:13px;}"
      + ".eikon-dda-table th,.eikon-dda-table td{padding:10px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;}"
      + ".eikon-dda-table th{background:#fafafa;font-weight:900;text-align:left;}"
      + ".eikon-dda-actions{display:flex;gap:8px;}"
      + ".eikon-dda-msg{margin-top:10px;padding:10px;border-radius:12px;font-weight:800;white-space:pre-wrap;}"
      + ".eikon-dda-msg.ok{background:#e9f8ee;color:#0c6a2a;border:1px solid #bfe9c9;}"
      + ".eikon-dda-msg.err{background:#fdebed;color:#8a1026;border:1px solid #f3b9c1;}"
      + ".eikon-dda-msg.info{background:#eef3ff;color:#1b3a8a;border:1px solid #c8d6ff;}"
      + ".eikon-dda-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;padding:16px;z-index:9999;}"
      + ".eikon-dda-modal{background:#fff;border-radius:16px;border:1px solid #eee;max-width:860px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.22);}"
      + ".eikon-dda-modal-head{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px 14px;border-bottom:1px solid #eee;}"
      + ".eikon-dda-modal-head h3{margin:0;font-size:16px;font-weight:900;}"
      + ".eikon-dda-modal-body{padding:14px;}"
      + ".eikon-dda-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}"
      + ".eikon-dda-field.full{grid-column:1/-1;}"
      + "@media (max-width:760px){.eikon-dda-grid{grid-template-columns:1fr;}.eikon-dda-field{min-width:unset;}}";

    var style = el(doc, "style", { id: STYLE_ID, text: css }, []);
    (doc.head || doc.documentElement).appendChild(style);
  }

  // ---------- module state ----------
  var state = {
    loading: false,
    report_loading: false,
    month: "",
    q: "",
    entries: [],
    report: null,
    report_from: "",
    report_to: ""
  };

  // ctx & dom refs
  var ctx = null;

  var msgBox = null;
  var reportMsg = null;
  var reportPreview = null;

  var monthInput = null;
  var qInput = null;
  var addBtn = null;

  var reportFromInput = null;
  var reportToInput = null;
  var generateBtn = null;
  var printBtn = null;

  var tableBody = null;

  // modal refs
  var activeDoc = null;
  var modalBackdrop = null;
  var modalTitle = null;
  var formEls = null;

  var searchTimer = null;

  function setLoading(on) {
    state.loading = !!on;
    if (addBtn) addBtn.disabled = state.loading || state.report_loading;
    if (monthInput) monthInput.disabled = state.loading || state.report_loading;
    if (qInput) qInput.disabled = state.loading || state.report_loading;
    if (generateBtn) generateBtn.disabled = state.loading || state.report_loading;
    if (printBtn) printBtn.disabled = state.loading || state.report_loading;
  }

  function setMsg(kind, text) {
    if (!msgBox) return;
    msgBox.className = "eikon-dda-msg" + (kind ? (" " + kind) : "");
    msgBox.textContent = String(text || "");
    msgBox.style.display = text ? "block" : "none";
  }

  function setReportMsg(kind, text) {
    if (!reportMsg) return;
    reportMsg.className = "eikon-dda-msg" + (kind ? (" " + kind) : "");
    reportMsg.textContent = String(text || "");
    reportMsg.style.display = text ? "block" : "none";
  }

  function renderRows() {
    if (!ctx || !ctx.doc || !tableBody) return;
    tableBody.innerHTML = "";

    var rows = state.entries || [];
    if (!rows.length) {
      var tr0 = el(ctx.doc, "tr", {}, []);
      var td0 = el(ctx.doc, "td", { text: "No entries for this filter.", style: "padding:14px;color:#666;" }, []);
      td0.colSpan = 10;
      tr0.appendChild(td0);
      tableBody.appendChild(tr0);
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      (function (r) {
        var tr = el(ctx.doc, "tr", {}, []);
        tr.appendChild(el(ctx.doc, "td", { text: r.entry_date || "" }, []));
        tr.appendChild(el(ctx.doc, "td", { text: r.client_name || "" }, []));
        tr.appendChild(el(ctx.doc, "td", { text: r.client_id_card || "" }, []));
        tr.appendChild(el(ctx.doc, "td", { text: r.client_address || "" }, []));
        tr.appendChild(el(ctx.doc, "td", { text: r.medicine_name_dose || "" }, []));
        tr.appendChild(el(ctx.doc, "td", { text: (r.quantity == null ? "" : String(r.quantity)) }, []));
        tr.appendChild(el(ctx.doc, "td", { text: r.doctor_name || "" }, []));
        tr.appendChild(el(ctx.doc, "td", { text: r.doctor_reg_no || "" }, []));
        tr.appendChild(el(ctx.doc, "td", { text: r.prescription_serial_no || "" }, []));

        var actionsTd = el(ctx.doc, "td", {}, []);
        var actions = el(ctx.doc, "div", { class: "eikon-dda-actions" }, []);
        var editBtn = el(ctx.doc, "button", { class: "eikon-dda-btn secondary", text: "Edit" }, []);
        editBtn.onclick = function () { openModalForEdit(r); };
        var delBtn = el(ctx.doc, "button", { class: "eikon-dda-btn danger", text: "Delete" }, []);
        delBtn.onclick = function () { doDelete(r, false); };
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        actionsTd.appendChild(actions);
        tr.appendChild(actionsTd);

        tableBody.appendChild(tr);
      })(rows[i]);
    }
  }

  function validateReportRange(from, to) {
    from = String(from || "").trim();
    to = String(to || "").trim();
    if (!isYmd(from) || !isYmd(to)) return { ok: false, error: "Invalid from/to (YYYY-MM-DD)" };
    if (to < from) return { ok: false, error: "to must be >= from" };
    return { ok: true, from: from, to: to };
  }

  function renderReportPreview() {
    if (!ctx || !ctx.doc || !reportPreview) return;
    reportPreview.innerHTML = "";

    var data = state.report;
    if (!data || data.ok !== true) {
      reportPreview.appendChild(el(ctx.doc, "div", { style: "color:#666;padding:8px 0;", text: "No report loaded. Click Generate." }, []));
      return;
    }

    var entries = data.entries || [];
    var meta = el(ctx.doc, "div", { style: "font-size:12px;color:#444;margin:0 0 8px 0;" }, []);
    meta.innerHTML = "<b>" + escapeHtml(data.org_name || "") + "</b> — "
      + escapeHtml(data.location_name || "")
      + "<br/>Range: <b>" + escapeHtml(data.from) + "</b> to <b>" + escapeHtml(data.to) + "</b>"
      + "<br/>Entries: <b>" + escapeHtml(String(entries.length)) + "</b>";
    reportPreview.appendChild(meta);

    if (!entries.length) {
      reportPreview.appendChild(el(ctx.doc, "div", { style: "color:#666;padding:8px 0;", text: "No entries in this range." }, []));
      return;
    }

    // small preview table (same as dda-sales)
    var wrap = el(ctx.doc, "div", { class: "eikon-dda-table-wrap" }, []);
    var table = el(ctx.doc, "table", { class: "eikon-dda-table" }, []);
    var thead = el(ctx.doc, "thead", {}, []);
    thead.appendChild(el(ctx.doc, "tr", {}, [
      el(ctx.doc, "th", { text: "Date" }, []),
      el(ctx.doc, "th", { text: "Client" }, []),
      el(ctx.doc, "th", { text: "ID Card" }, []),
      el(ctx.doc, "th", { text: "Medicine" }, []),
      el(ctx.doc, "th", { text: "Qty" }, []),
      el(ctx.doc, "th", { text: "Doctor" }, [])
    ]));
    table.appendChild(thead);

    var tb = el(ctx.doc, "tbody", {}, []);
    for (var i = 0; i < entries.length; i++) {
      var r = entries[i];
      tb.appendChild(el(ctx.doc, "tr", {}, [
        el(ctx.doc, "td", { text: r.entry_date || "" }, []),
        el(ctx.doc, "td", { text: r.client_name || "" }, []),
        el(ctx.doc, "td", { text: r.client_id_card || "" }, []),
        el(ctx.doc, "td", { text: r.medicine_name_dose || "" }, []),
        el(ctx.doc, "td", { text: (r.quantity == null ? "" : String(r.quantity)) }, []),
        el(ctx.doc, "td", { text: r.doctor_name || "" }, [])
      ]));
    }
    table.appendChild(tb);
    wrap.appendChild(table);
    reportPreview.appendChild(wrap);
  }

  async function refresh() {
    if (!ctx) return;
    setMsg("", "");
    setLoading(true);

    try {
      var url = "/dda-poyc/entries?month=" + encodeURIComponent(state.month);
      var q = String(state.q || "").trim();
      if (q) url += "&q=" + encodeURIComponent(q);

      var data = await apiJson(ctx.win, url, { method: "GET" });
      if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");

      state.entries = data.entries || [];
      renderRows();
    } catch (e) {
      var msg = e && e.message ? e.message : String(e || "Error");
      if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
      setMsg("err", msg);
      warn("refresh failed:", e);
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    if (!ctx) return;
    setReportMsg("", "");
    var from = reportFromInput ? reportFromInput.value : state.report_from;
    var to = reportToInput ? reportToInput.value : state.report_to;

    var vr = validateReportRange(from, to);
    if (!vr.ok) {
      setReportMsg("err", vr.error);
      return;
    }

    try {
      state.report_loading = true;
      setLoading(false);

      var url = "/dda-poyc/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
      var data = await apiJson(ctx.win, url, { method: "GET" });
      if (!data || data.ok !== true) throw new Error(data && data.error ? String(data.error) : "Unexpected response");

      state.report = data;
      state.report_from = vr.from;
      state.report_to = vr.to;

      if (reportFromInput) reportFromInput.value = vr.from;
      if (reportToInput) reportToInput.value = vr.to;

      renderReportPreview();
      setReportMsg("ok", "Report generated.");
    } catch (e) {
      var msg = e && e.message ? e.message : String(e || "Error");
      if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
      setReportMsg("err", msg);
      warn("generate report failed:", e);
    } finally {
      state.report_loading = false;
      setLoading(false);
    }
  }

  function openPrintTabWithHtml(html) {
    if (!ctx) return;
    try {
      var w = ctx.win.open("", "_blank");
      if (!w) throw new Error("Popup blocked");
      w.document.open();
      w.document.write(html);
      w.document.close();
      // give it a tick to layout before print
      setTimeout(function () {
        try { w.focus(); w.print(); } catch (e) {}
      }, 250);
    } catch (e) {
      setReportMsg("err", "Unable to open print window (popup blocked).");
    }
  }

  function buildPrintableHtml(data) {
    var entries = (data && data.entries) ? data.entries : [];
    var title = "DDA POYC Report";
    var html = "";
    html += "<!doctype html><html><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width,initial-scale=1'/>";
    html += "<title>" + escapeHtml(title) + "</title>";
    html += "<style>";
    html += "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:22px;color:#111;}";
    html += "h1{margin:0 0 6px 0;font-size:20px;}";
    html += ".meta{color:#444;margin:0 0 16px 0;font-size:13px;}";
    html += "table{width:100%;border-collapse:collapse;margin-top:8px;}";
    html += "th,td{border:1px solid #bbb;padding:6px 8px;font-size:12px;vertical-align:top;}";
    html += "th{background:#f2f2f2;}";
    html += ".no-print{margin-bottom:10px;}";
    html += "@media print{.no-print{display:none;} body{margin:0;}}";
    html += "</style></head><body>";
    html += "<div class='no-print'><button onclick='window.print()' style='padding:8px 12px;font-weight:700;'>Print</button></div>";
    html += "<h1>" + escapeHtml((data && data.org_name) ? data.org_name : "Pharmacy") + " — " + escapeHtml(title) + "</h1>";
    html += "<p class='meta'>Location: " + escapeHtml((data && data.location_name) ? data.location_name : "") + "<br/>Range: "
      + escapeHtml((data && data.from) ? data.from : "") + " to " + escapeHtml((data && data.to) ? data.to : "") + "</p>";

    html += "<table><thead><tr>";
    html += "<th>Date</th><th>Client Name</th><th>ID Card</th><th>Address</th><th>Medicine Name &amp; Dose</th><th>Qty</th><th>Doctor Name</th><th>Doctor Reg No.</th><th>Prescription Serial No.</th>";
    html += "</tr></thead><tbody>";

    for (var i = 0; i < entries.length; i++) {
      var r = entries[i] || {};
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

        var url = "/dda-poyc/report?from=" + encodeURIComponent(vr.from) + "&to=" + encodeURIComponent(vr.to);
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

  // ---------- modal (same as dda-sales, just POYC strings + endpoints) ----------
  function buildModalOnceForDoc(doc) {
    if (activeDoc === doc && modalBackdrop) return;
    activeDoc = doc;
    modalBackdrop = null;
    modalTitle = null;
    formEls = null;

    modalBackdrop = el(doc, "div", { class: "eikon-dda-modal-backdrop" }, []);
    var modal = el(doc, "div", { class: "eikon-dda-modal" }, []);

    var head = el(doc, "div", { class: "eikon-dda-modal-head" }, []);
    modalTitle = el(doc, "h3", { text: "DDA POYC Entry" }, []);
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

    modalBackdrop.onclick = function (e) {
      if (e && e.target === modalBackdrop) closeModal();
    };
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
    modalTitle.textContent = "New DDA POYC Entry";
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
    modalTitle.textContent = "Edit DDA POYC Entry";
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
    if (!v.ok) {
      setMsg("err", v.error);
      return;
    }

    setLoading(true);
    try {
      var method, path;
      if (formEls.id) {
        method = "PUT";
        path = "/dda-poyc/entries/" + encodeURIComponent(String(formEls.id));
      } else {
        method = "POST";
        path = "/dda-poyc/entries";
      }

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
    if (!id) {
      setMsg("err", "Invalid entry id.");
      return;
    }

    var ok = false;
    try { ok = ctx.win.confirm("Delete this DDA POYC entry?"); } catch (e) { ok = true; }
    if (!ok) return;

    setLoading(true);
    try {
      var data = await apiJson(ctx.win, "/dda-poyc/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
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

  // ---------- render ----------
  function renderInto(container) {
    ctx = resolveRenderContext(container);
    if (!ctx || !ctx.doc || !ctx.win || !ctx.mount) return;

    try {
      ensureStyleOnce(ctx.doc);
      ctx.mount.innerHTML = "";

      if (!state.month) {
        var d = new Date();
        state.month = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
      }
      if (!state.report_from || !state.report_to) setReportDefaultsForMonth(state.month);

      var wrap = el(ctx.doc, "div", { class: "eikon-dda-wrap" }, []);

      var top = el(ctx.doc, "div", { class: "eikon-dda-top" }, []);
      var title = el(ctx.doc, "div", { class: "eikon-dda-title" }, []);
      title.appendChild(el(ctx.doc, "span", { class: "icon", html: ICON_SVG }, []));
      title.appendChild(el(ctx.doc, "span", { text: "DDA POYC" }, []));
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
      qInput = el(ctx.doc, "input", { type: "text", value: state.q, placeholder: "Client / ID / medicine / doctor / serial…" }, []);

      // ✅ live search while typing (debounced) — matches dda-sales
      qInput.oninput = function () {
        state.q = String(qInput.value || "");
        if (searchTimer) { try { ctx.win.clearTimeout(searchTimer); } catch (e) {} }
        searchTimer = ctx.win.setTimeout(function () {
          if (!state.loading && !state.report_loading) refresh();
        }, 250);
      };
      qInput.onkeydown = function (e) { if (e && e.key === "Enter") refresh(); };
      qField.appendChild(qInput);

      // ✅ NO refresh button (requested)

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

      // Report card
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

  function buildModule() {
    return {
      id: "dda-poyc",
      key: "dda-poyc",
      slug: "dda-poyc",
      title: "DDA POYC",
      navTitle: "DDA POYC",
      icon: "",
      iconText: "",
      iconSvg: ICON_SVG,
      iconHTML: ICON_SVG,
      navIcon: ICON_SVG,
      hash: "#dda-poyc",
      route: "dda-poyc",
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

  // init
  var moduleObj = buildModule();
  tryRegisterModule(moduleObj);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 0);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 200);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 1000);

  log("loaded modules.ddapoyc.js");
})();
