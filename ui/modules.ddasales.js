/* ui/modules.ddasales.js
   Eikon - DDA Sales module (UI)
   Endpoints (Cloudflare Worker):
     GET    /dda-sales/entries?month=YYYY-MM&q=...
     POST   /dda-sales/entries
     PUT    /dda-sales/entries/:id
     DELETE /dda-sales/entries/:id
     GET    /dda-sales/report/html?from=YYYY-MM-DD&to=YYYY-MM-DD
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

  function monthStartEnd(yyyyMm) {
    var m = String(yyyyMm || "").trim();
    if (!isYm(m)) return null;
    var y = parseInt(m.slice(0, 4), 10);
    var mo = parseInt(m.slice(5, 7), 10); // 1..12
    if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;

    var start = m + "-01";

    // last day of month: new Date(y, mo, 0) => day 0 of next month
    var lastDay = new Date(y, mo, 0).getDate();
    var end = m + "-" + pad2(lastDay);

    return { from: start, to: end };
  }

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

  function ensureStyleOnce() {
    var id = "eikon-dda-sales-style";
    if (document.getElementById(id)) return;

    var css = ""
      + ".eikon-dda-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:1100px;margin:0 auto;padding:16px;}"
      + ".eikon-dda-top{display:flex;flex-wrap:wrap;gap:10px;align-items:end;justify-content:space-between;margin-bottom:12px;}"
      + ".eikon-dda-title{font-size:18px;font-weight:900;margin:0;}"
      + ".eikon-dda-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:end;}"
      + ".eikon-dda-field{display:flex;flex-direction:column;gap:4px;}"
      + ".eikon-dda-field label{font-size:12px;font-weight:800;opacity:0.85;}"
      + ".eikon-dda-field input,.eikon-dda-field textarea{padding:9px 10px;border:1px solid #cfcfcf;border-radius:10px;font-size:14px;}"
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
      + "@media(max-width:820px){.eikon-dda-grid{grid-template-columns:1fr;}}";

    var style = document.createElement("style");
    style.id = id;
    style.type = "text/css";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "value") node.value = attrs[k];
        else if (k === "type") node.type = attrs[k];
        else if (k === "placeholder") node.placeholder = attrs[k];
        else if (k === "href") node.href = attrs[k];
        else if (k === "target") node.target = attrs[k];
        else if (k === "rel") node.rel = attrs[k];
        else if (k === "disabled") node.disabled = !!attrs[k];
        else if (k === "onclick") node.onclick = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    if (children && children.length) {
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  function getStoredToken() {
    // Try common patterns without breaking if unavailable.
    try {
      if (window.Eikon && typeof window.Eikon.getToken === "function") {
        var t0 = window.Eikon.getToken();
        if (t0) return String(t0);
      }
    } catch (e) {}

    // Try state objects
    try {
      if (window.Eikon && window.Eikon.state && window.Eikon.state.token) return String(window.Eikon.state.token);
    } catch (e) {}
    try {
      if (window.EIKON && window.EIKON.state && window.EIKON.state.token) return String(window.EIKON.state.token);
    } catch (e) {}

    // localStorage keys
    var keys = ["eikon_token", "EIKON_TOKEN", "token", "auth_token", "session_token"];
    for (var i = 0; i < keys.length; i++) {
      try {
        var v = localStorage.getItem(keys[i]);
        if (v && String(v).trim()) return String(v).trim();
      } catch (e) {}
    }

    // sessionStorage keys
    for (var j = 0; j < keys.length; j++) {
      try {
        var v2 = sessionStorage.getItem(keys[j]);
        if (v2 && String(v2).trim()) return String(v2).trim();
      } catch (e) {}
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

  async function apiJson(path, opts) {
    opts = opts || {};
    var headers = new Headers(opts.headers || {});
    headers.set("Accept", "application/json");

    var token = getStoredToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", "Bearer " + token);
    }

    if (opts.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

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

  function setMsg(msgBox, kind, text) {
    if (!msgBox) return;
    msgBox.className = "eikon-dda-msg " + (kind === "ok" ? "ok" : kind === "err" ? "err" : "");
    msgBox.textContent = String(text || "");
    msgBox.style.display = text ? "block" : "none";
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

  function buildModule() {
    ensureStyleOnce();

    var state = {
      month: todayYm(),
      q: "",
      loading: false,
      entries: [],
      lastError: ""
    };

    var modal = null;
    var modalTitle = null;
    var modalBackdrop = null;
    var formEls = null;
    var msgBox = null;
    var tableBody = null;
    var monthInput = null;
    var qInput = null;
    var refreshBtn = null;
    var addBtn = null;
    var reportBtn = null;

    function renderInto(container) {
      ensureStyleOnce();
      container.innerHTML = "";

      var wrap = el("div", { class: "eikon-dda-wrap" }, []);

      var top = el("div", { class: "eikon-dda-top" }, []);
      top.appendChild(el("h2", { class: "eikon-dda-title", text: "DDA Sales" }, []));

      var controls = el("div", { class: "eikon-dda-controls" }, []);

      var monthField = el("div", { class: "eikon-dda-field" }, []);
      monthField.appendChild(el("label", { text: "Month" }, []));
      monthInput = el("input", { type: "month", value: state.month }, []);
      monthInput.onchange = function () {
        var m = String(monthInput.value || "").trim();
        if (isYm(m)) {
          state.month = m;
          refresh();
        }
      };
      monthField.appendChild(monthInput);

      var qField = el("div", { class: "eikon-dda-field" }, []);
      qField.appendChild(el("label", { text: "Search" }, []));
      qInput = el("input", { type: "text", value: state.q, placeholder: "Client / ID / medicine / doctor / serial…" }, []);
      qInput.oninput = function () { state.q = String(qInput.value || ""); };
      qInput.onkeydown = function (e) {
        if (e && e.key === "Enter") refresh();
      };
      qField.appendChild(qInput);

      refreshBtn = el("button", { class: "eikon-dda-btn secondary", text: "Refresh" }, []);
      refreshBtn.onclick = function () { refresh(); };

      addBtn = el("button", { class: "eikon-dda-btn", text: "New Entry" }, []);
      addBtn.onclick = function () { openModalForCreate(); };

      reportBtn = el("button", { class: "eikon-dda-btn secondary", text: "Open Report (HTML)" }, []);
      reportBtn.onclick = function () { openReport(); };

      controls.appendChild(monthField);
      controls.appendChild(qField);
      controls.appendChild(refreshBtn);
      controls.appendChild(addBtn);
      controls.appendChild(reportBtn);

      top.appendChild(controls);
      wrap.appendChild(top);

      msgBox = el("div", { class: "eikon-dda-msg", text: "" }, []);
      msgBox.style.display = "none";
      wrap.appendChild(msgBox);

      var card = el("div", { class: "eikon-dda-card" }, []);
      card.appendChild(el("div", { class: "eikon-dda-hint", html:
        "Endpoints: <code>/dda-sales/entries</code> &nbsp;|&nbsp; Report: <code>/dda-sales/report/html</code>"
      }, []));

      var tableWrap = el("div", { class: "eikon-dda-table-wrap", style: "margin-top:10px;" }, []);
      var table = el("table", { class: "eikon-dda-table" }, []);
      var thead = el("thead", {}, []);
      thead.appendChild(el("tr", {}, [
        el("th", { text: "Date" }, []),
        el("th", { text: "Client" }, []),
        el("th", { text: "ID Card" }, []),
        el("th", { text: "Address" }, []),
        el("th", { text: "Medicine (name & dose)" }, []),
        el("th", { text: "Qty" }, []),
        el("th", { text: "Doctor" }, []),
        el("th", { text: "Reg No." }, []),
        el("th", { text: "Prescription Serial No." }, []),
        el("th", { text: "Actions" }, [])
      ]));
      table.appendChild(thead);

      tableBody = el("tbody", {}, []);
      table.appendChild(tableBody);

      tableWrap.appendChild(table);
      card.appendChild(tableWrap);
      wrap.appendChild(card);

      container.appendChild(wrap);

      buildModalOnce();

      refresh();
    }

    function setLoading(v) {
      state.loading = !!v;
      if (refreshBtn) refreshBtn.disabled = state.loading;
      if (addBtn) addBtn.disabled = state.loading;
      if (reportBtn) reportBtn.disabled = state.loading;
      if (monthInput) monthInput.disabled = state.loading;
      if (qInput) qInput.disabled = state.loading;
    }

    function renderRows() {
      if (!tableBody) return;
      tableBody.innerHTML = "";

      var list = state.entries || [];
      if (!list.length) {
        tableBody.appendChild(el("tr", {}, [
          el("td", { html: '<span style="opacity:0.7;">No entries for this month.</span>', colspan: "10" }, [])
        ]));
        return;
      }

      for (var i = 0; i < list.length; i++) {
        (function (row) {
          var doctorLabel = String(row.doctor_name || "");
          var tr = el("tr", {}, [
            el("td", { text: String(row.entry_date || "") }, []),
            el("td", { text: String(row.client_name || "") }, []),
            el("td", { text: String(row.client_id_card || "") }, []),
            el("td", { text: String(row.client_address || "") }, []),
            el("td", { text: String(row.medicine_name_dose || "") }, []),
            el("td", { text: String(row.quantity == null ? "" : row.quantity) }, []),
            el("td", { text: doctorLabel }, []),
            el("td", { text: String(row.doctor_reg_no || "") }, []),
            el("td", { text: String(row.prescription_serial_no || "") }, []),
            el("td", {}, [])
          ]);

          var actionsTd = tr.lastChild;
          var actions = el("div", { class: "eikon-dda-actions" }, []);

          var edit = el("span", { class: "eikon-dda-link", text: "Edit" }, []);
          edit.onclick = function () { openModalForEdit(row); };

          var del = el("span", { class: "eikon-dda-link", text: "Delete" }, []);
          del.onclick = function () { doDelete(row); };

          actions.appendChild(edit);
          actions.appendChild(del);
          actionsTd.appendChild(actions);

          tableBody.appendChild(tr);
        })(list[i]);
      }
    }

    async function refresh() {
      setMsg(msgBox, "", "");
      setLoading(true);

      var month = String(state.month || "").trim();
      if (!isYm(month)) month = todayYm();

      var url = "/dda-sales/entries?month=" + encodeURIComponent(month);
      var q = String(state.q || "").trim();
      if (q) url += "&q=" + encodeURIComponent(q);

      try {
        var data = await apiJson(url, { method: "GET" });
        if (!data || data.ok !== true) {
          throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
        }
        state.entries = Array.isArray(data.entries) ? data.entries : [];
        renderRows();
        setLoading(false);
      } catch (e) {
        setLoading(false);
        state.entries = [];
        renderRows();

        var msg = (e && e.message) ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token). Log in again.";
        setMsg(msgBox, "err", msg);
        warn("refresh failed:", e);
      }
    }

    function openReport() {
      var range = monthStartEnd(state.month);
      if (!range) {
        setMsg(msgBox, "err", "Invalid month.");
        return;
      }
      var reportUrl = "/dda-sales/report/html?from=" + encodeURIComponent(range.from) + "&to=" + encodeURIComponent(range.to);
      try {
        window.open(reportUrl, "_blank", "noopener,noreferrer");
      } catch (e) {
        // fallback: navigate same tab
        window.location.href = reportUrl;
      }
    }

    function buildModalOnce() {
      if (modalBackdrop) return;

      modalBackdrop = el("div", { class: "eikon-dda-modal-backdrop" }, []);
      modal = el("div", { class: "eikon-dda-modal" }, []);

      var head = el("div", { class: "eikon-dda-modal-head" }, []);
      modalTitle = el("h3", { text: "DDA Sales Entry" }, []);
      var closeBtn = el("button", { class: "eikon-dda-btn secondary", text: "Close" }, []);
      closeBtn.onclick = function () { closeModal(); };

      head.appendChild(modalTitle);
      head.appendChild(closeBtn);

      var body = el("div", { class: "eikon-dda-modal-body" }, []);

      var grid = el("div", { class: "eikon-dda-grid" }, []);

      function field(labelText, inputEl, full) {
        var wrap = el("div", { class: "eikon-dda-field" + (full ? " full" : "") }, []);
        wrap.appendChild(el("label", { text: labelText }, []));
        wrap.appendChild(inputEl);
        return wrap;
      }

      formEls = {
        id: null,
        entry_date: el("input", { type: "date", value: "" }, []),
        client_name: el("input", { type: "text", value: "", placeholder: "Client name" }, []),
        client_id_card: el("input", { type: "text", value: "", placeholder: "ID card no." }, []),
        client_address: el("input", { type: "text", value: "", placeholder: "Client address" }, []),
        medicine_name_dose: el("input", { type: "text", value: "", placeholder: "Medicine name & dose" }, []),
        quantity: el("input", { type: "number", value: "1", min: "1", step: "1" }, []),
        doctor_name: el("input", { type: "text", value: "", placeholder: "Doctor name" }, []),
        doctor_reg_no: el("input", { type: "text", value: "", placeholder: "Doctor reg no." }, []),
        prescription_serial_no: el("input", { type: "text", value: "", placeholder: "Prescription serial no." }, [])
      };

      // Layout
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

      var footerMsg = el("div", { class: "eikon-dda-hint", html:
        "Saved to D1 table <code>dda_sales_entries</code>. Required fields match the API validations."
      }, []);
      body.appendChild(footerMsg);

      var footerBtns = el("div", { style: "display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;" }, []);
      var saveBtn = el("button", { class: "eikon-dda-btn", text: "Save" }, []);
      var deleteBtn = el("button", { class: "eikon-dda-btn danger", text: "Delete" }, []);
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

      document.body.appendChild(modalBackdrop);

      // attach to state for toggling delete button visibility
      modalBackdrop._eikonDeleteBtn = deleteBtn;
      modalBackdrop._eikonSaveBtn = saveBtn;
    }

    function openModalForCreate() {
      buildModalOnce();

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

      if (modalBackdrop && modalBackdrop._eikonDeleteBtn) modalBackdrop._eikonDeleteBtn.style.display = "none";

      openModal();
    }

    function openModalForEdit(row) {
      buildModalOnce();

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

      if (modalBackdrop && modalBackdrop._eikonDeleteBtn) modalBackdrop._eikonDeleteBtn.style.display = "inline-block";

      openModal();
    }

    function openModal() {
      setMsg(msgBox, "", "");
      if (modalBackdrop) modalBackdrop.style.display = "flex";
    }

    function closeModal() {
      if (modalBackdrop) modalBackdrop.style.display = "none";
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
      setMsg(msgBox, "", "");
      var v = validateFormPayload();
      if (!v.ok) {
        setMsg(msgBox, "err", v.error);
        return;
      }

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

        var data = await apiJson(path, {
          method: method,
          body: JSON.stringify(v.payload)
        });

        if (!data || data.ok !== true) {
          throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
        }

        closeModal();
        setMsg(msgBox, "ok", "Saved.");
        setLoading(false);
        await refresh();
      } catch (e) {
        setLoading(false);
        var msg = (e && e.message) ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token). Log in again.";
        setMsg(msgBox, "err", msg);
        warn("save failed:", e);
      }
    }

    async function doDelete(row, fromModal) {
      setMsg(msgBox, "", "");
      var id = row && row.id != null ? Number(row.id) : null;
      if (!id) {
        setMsg(msgBox, "err", "Invalid entry id.");
        return;
      }

      var ok = false;
      try { ok = window.confirm("Delete this DDA Sales entry?"); } catch (e) { ok = true; }
      if (!ok) return;

      setLoading(true);

      try {
        var data = await apiJson("/dda-sales/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
        if (!data || data.ok !== true) {
          throw new Error((data && data.error) ? String(data.error) : "Unexpected response");
        }
        if (fromModal) closeModal();
        setMsg(msgBox, "ok", "Deleted.");
        setLoading(false);
        await refresh();
      } catch (e) {
        setLoading(false);
        var msg = (e && e.message) ? e.message : String(e || "Error");
        if (e && e.status === 401) msg = "Unauthorized (missing/invalid token). Log in again.";
        setMsg(msgBox, "err", msg);
        warn("delete failed:", e);
      }
    }

    // Public-ish interface for whatever core expects
    return {
      id: "dda-sales",
      key: "dda-sales",
      title: "DDA Sales",
      navTitle: "DDA Sales",
      route: "/dda-sales",
      hash: "#/dda-sales",

      // many systems call one of these
      render: renderInto,
      mount: renderInto,

      // some systems call init(core)
      init: function (core) {
        // we don’t require core, but keep reference if provided
        try { this._core = core; } catch (e) {}
      }
    };
  }

  function tryRegisterModule(mod) {
    if (!mod) return false;

    // Avoid duplicates
    function already(list) {
      if (!Array.isArray(list)) return false;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m) continue;
        var id = m.id || m.key;
        if (id === mod.id || id === mod.key) return true;
      }
      return false;
    }

    // Preferred: explicit registration hooks
    try {
      if (window.Eikon && typeof window.Eikon.registerModule === "function") {
        window.Eikon.registerModule(mod);
        log("registered via window.Eikon.registerModule()");
        return true;
      }
    } catch (e) { warn("registerModule(Eikon) failed:", e); }

    try {
      if (window.EIKON && typeof window.EIKON.registerModule === "function") {
        window.EIKON.registerModule(mod);
        log("registered via window.EIKON.registerModule()");
        return true;
      }
    } catch (e2) { warn("registerModule(EIKON) failed:", e2); }

    try {
      if (window.Eikon && typeof window.Eikon.addModule === "function") {
        window.Eikon.addModule(mod);
        log("registered via window.Eikon.addModule()");
        return true;
      }
    } catch (e3) { warn("addModule(Eikon) failed:", e3); }

    try {
      if (window.EIKON && typeof window.EIKON.addModule === "function") {
        window.EIKON.addModule(mod);
        log("registered via window.EIKON.addModule()");
        return true;
      }
    } catch (e4) { warn("addModule(EIKON) failed:", e4); }

    // Fallback: global arrays that main.js may read
    try {
      window.EikonModules = window.EikonModules || [];
      if (!already(window.EikonModules)) window.EikonModules.push(mod);
      log("registered via window.EikonModules[] fallback");
    } catch (e5) { warn("EikonModules fallback failed:", e5); }

    try {
      window.EIKON_MODULES = window.EIKON_MODULES || [];
      if (!already(window.EIKON_MODULES)) window.EIKON_MODULES.push(mod);
      log("registered via window.EIKON_MODULES[] fallback");
    } catch (e6) { warn("EIKON_MODULES fallback failed:", e6); }

    // Also expose a direct handle for debugging
    try { window.EikonDdaSalesModule = mod; } catch (e7) {}

    return true;
  }

  // Build + register now
  var moduleObj = null;
  try {
    moduleObj = buildModule();
  } catch (e) {
    warn("buildModule failed:", e);
    // Ensure we never break boot; just expose something
    moduleObj = {
      id: "dda-sales",
      key: "dda-sales",
      title: "DDA Sales",
      render: function (container) {
        try {
          container.innerHTML =
            '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px;">'
            + '<div style="font-weight:900;font-size:16px;color:#b00020;">DDA Sales module failed to initialize</div>'
            + '<pre style="white-space:pre-wrap;border:1px solid #ddd;background:#fff;padding:10px;border-radius:10px;margin-top:10px;">'
            + escapeHtml(String(e && (e.stack || e.message || e)))
            + '</pre></div>';
        } catch (e2) {}
      }
    };
  }

  // Try immediate registration (core.js loaded before modules in your index)
  tryRegisterModule(moduleObj);

  // Try again shortly in case core registers late
  setTimeout(function () { tryRegisterModule(moduleObj); }, 0);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 250);
  setTimeout(function () { tryRegisterModule(moduleObj); }, 1000);

  log("loaded modules.ddasales.js");
})();
