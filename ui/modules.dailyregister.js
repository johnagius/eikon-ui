(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.dailyregister.js)");

  function dbg() {
    try {
      if (E && typeof E.dbg === "function") E.dbg.apply(null, arguments);
      else console.log.apply(console, arguments);
    } catch (e) {}
  }
  function err() {
    try {
      if (E && typeof E.error === "function") E.error.apply(null, arguments);
      else console.error.apply(console, arguments);
    } catch (e) {}
  }

  function esc(s) {
    try {
      return E.escapeHtml(String(s == null ? "" : s));
    } catch (e) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
  }

  function pad2(n) {
    var v = String(n);
    return v.length === 1 ? "0" + v : v;
  }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function thisMonthYm() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }
  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }
  function isYm(s) {
    return /^\d{4}-\d{2}$/.test(String(s || "").trim());
  }
  function fmtDmyFromYmd(s) {
    var v = String(s || "").trim();
    if (!isYmd(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().trim();
  }

  function rowSearchBlob(r) {
    // One blob for quick includes() filtering
    return (
      norm(r.entry_date) +
      " | " +
      norm(r.client_name) +
      " | " +
      norm(r.client_id) +
      " | " +
      norm(r.medicine_name_dose) +
      " | " +
      norm(r.posology) +
      " | " +
      norm(r.prescriber_name) +
      " | " +
      norm(r.prescriber_reg_no)
    );
  }

  // ------------------------------------------------------------
  // PATCH: module-scoped harmonious CSS (like Temperature module)
  // ------------------------------------------------------------
  var drStyleInstalled = false;
  function ensureDailyRegisterStyles() {
    if (drStyleInstalled) return;
    drStyleInstalled = true;

    var st = document.createElement("style");
    st.type = "text/css";
    st.id = "eikon-dailyregister-style";
    st.textContent =
      "" +
      /* Wrap / headings */
      ".dr-wrap{max-width:1100px;margin:0 auto;padding:16px;}" +
      ".dr-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px;}" +
      ".dr-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".dr-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +

      /* Control row */
      ".dr-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +
      ".dr-field{display:flex;flex-direction:column;gap:4px;}" +
      ".dr-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +

      /* Inputs (match Temperature/Cleaning feel) */
      ".dr-field input{" +
      "padding:10px 12px;" +
      "border:1px solid var(--line,rgba(255,255,255,.10));" +
      "border-radius:12px;" +
      "background:rgba(10,16,24,.64);" +
      "color:var(--text,#e9eef7);" +
      "outline:none;" +
      "transition:border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;" +
      "}" +
      ".dr-field input:hover{border-color:rgba(255,255,255,.18);}" +
      ".dr-field input:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);}" +
      ".dr-field input::placeholder{color:rgba(233,238,247,.40);}" +
      "#dr-month,#dr-search{color-scheme:dark;}" +

      /* Buttons */
      ".dr-actions{display:flex;gap:10px;align-items:flex-end;}" +

      /* Cards */
      ".dr-card{" +
      "border:1px solid var(--line,rgba(255,255,255,.10));" +
      "border-radius:16px;" +
      "padding:12px;" +
      "background:var(--panel,rgba(16,24,36,.66));" +
      "box-shadow:0 18px 50px rgba(0,0,0,.38);" +
      "backdrop-filter:blur(10px);" +
      "}" +
      ".dr-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".dr-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      "#dr-count{font-size:12px;color:var(--muted,rgba(233,238,247,.68));font-weight:800;}" +

      /* Table (fix contrast: no more white background) */
      ".dr-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.18);}" +
      ".dr-table{width:100%;border-collapse:collapse;min-width:980px;color:var(--text,#e9eef7);}" +
      ".dr-table th,.dr-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:10px 10px;font-size:12px;vertical-align:top;}" +
      ".dr-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:1000;text-align:left;}" +
      ".dr-table tbody tr:hover{background:rgba(255,255,255,.04);}" +
      ".dr-table b{color:var(--text,#e9eef7);}" +

      /* Make the small "ID:" line readable */
      ".dr-idline{opacity:.75;font-size:11px;color:var(--muted,rgba(233,238,247,.68));}" +

      /* Modal form inputs (E.modal content uses these IDs) */
      "#dr-date,#dr-client-name,#dr-client-id,#dr-med,#dr-pos,#dr-prescriber,#dr-presc-reg{" +
      "width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "}" +
      "#dr-date:focus,#dr-client-name:focus,#dr-client-id:focus,#dr-med:focus,#dr-pos:focus,#dr-prescriber:focus,#dr-presc-reg:focus{" +
      "border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);" +
      "}" +
      "#dr-date{color-scheme:dark;}" +

      "@media(max-width:820px){.dr-wrap{padding:12px;}.dr-controls{width:100%;}}";

    document.head.appendChild(st);
  }

  async function apiList(monthYm) {
    var ym = String(monthYm || "").trim();
    if (!isYm(ym)) throw new Error("Invalid month (YYYY-MM)");
    dbg("[dailyregister] apiList month=", ym);
    var resp = await E.apiFetch("/daily-register/entries?month=" + encodeURIComponent(ym), { method: "GET" });
    dbg("[dailyregister] apiList resp=", resp);
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Failed to load daily register entries");
    return Array.isArray(resp.entries) ? resp.entries : [];
  }

  async function apiCreate(payload) {
    dbg("[dailyregister] apiCreate payload=", payload);
    var resp = await E.apiFetch("/daily-register/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    dbg("[dailyregister] apiCreate resp=", resp);
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Create failed");
    return resp;
  }

  async function apiUpdate(id, payload) {
    dbg("[dailyregister] apiUpdate id=", id, "payload=", payload);
    var resp = await E.apiFetch("/daily-register/entries/" + encodeURIComponent(String(id)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    dbg("[dailyregister] apiUpdate resp=", resp);
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Update failed");
    return resp;
  }

  async function apiDelete(id) {
    dbg("[dailyregister] apiDelete id=", id);
    var resp = await E.apiFetch("/daily-register/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
    dbg("[dailyregister] apiDelete resp=", resp);
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Delete failed");
    return resp;
  }

  function validatePayload(p) {
    var out = {
      entry_date: String(p.entry_date || "").trim(),
      client_name: String(p.client_name || "").trim(),
      client_id: String(p.client_id || "").trim(),
      medicine_name_dose: String(p.medicine_name_dose || "").trim(),
      posology: String(p.posology || "").trim(),
      prescriber_name: String(p.prescriber_name || "").trim(),
      prescriber_reg_no: String(p.prescriber_reg_no || "").trim(),
    };

    if (!out.entry_date || !isYmd(out.entry_date)) throw new Error("Date is required (YYYY-MM-DD)");
    if (!out.client_name) throw new Error("Client Name & Surname is required");
    if (!out.client_id) throw new Error("Client ID is required");
    if (!out.medicine_name_dose) throw new Error("Medicine Name & Dose is required");
    if (!out.posology) throw new Error("Posology is required");
    if (!out.prescriber_name) throw new Error("Prescriber Name is required");
    if (!out.prescriber_reg_no) throw new Error("Prescriber Reg No is required");

    // Keep lengths sane (avoid accidents)
    if (out.client_name.length > 200) throw new Error("Client Name too long");
    if (out.client_id.length > 100) throw new Error("Client ID too long");
    if (out.medicine_name_dose.length > 300) throw new Error("Medicine Name & Dose too long");
    if (out.posology.length > 400) throw new Error("Posology too long");
    if (out.prescriber_name.length > 200) throw new Error("Prescriber Name too long");
    if (out.prescriber_reg_no.length > 100) throw new Error("Prescriber Reg No too long");

    return out;
  }

  function modalError(title, e) {
    try {
      var msg = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : "Error");
      E.modal.show(
        title || "Error",
        "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
      );
    } catch (e2) {
      alert(String(e && (e.message || e) ? (e.message || e) : "Error"));
    }
  }

  function openEntryModal(opts) {
    // opts: { mode: "new"|"edit", entry: {...} }
    var mode = opts && opts.mode ? String(opts.mode) : "new";
    var entry = opts && opts.entry ? opts.entry : {};
    var isEdit = mode === "edit";

    var title = isEdit ? "Edit Daily Register Entry" : "New Daily Register Entry";
    var initial = {
      entry_date: String(entry.entry_date || todayYmd()).trim(),
      client_name: String(entry.client_name || "").trim(),
      client_id: String(entry.client_id || "").trim(),
      medicine_name_dose: String(entry.medicine_name_dose || "").trim(),
      posology: String(entry.posology || "").trim(),
      prescriber_name: String(entry.prescriber_name || "").trim(),
      prescriber_reg_no: String(entry.prescriber_reg_no || "").trim(),
    };

    var body =
      "" +
      "<div class='eikon-field'><div class='eikon-label'>Date</div><input id='dr-date' type='date' value='" + esc(initial.entry_date) + "'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Client Name &amp; Surname</div><input id='dr-client-name' type='text' value='" + esc(initial.client_name) + "' placeholder='e.g. John Borg'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Client ID</div><input id='dr-client-id' type='text' value='" + esc(initial.client_id) + "' placeholder='e.g. 123456M'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Medicine Name &amp; Dose</div><input id='dr-med' type='text' value='" + esc(initial.medicine_name_dose) + "' placeholder='e.g. Amoxil 500mg'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Posology</div><input id='dr-pos' type='text' value='" + esc(initial.posology) + "' placeholder='e.g. 1-1-1 x 7 days'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Prescriber Name</div><input id='dr-prescriber' type='text' value='" + esc(initial.prescriber_name) + "' placeholder='e.g. Dr Kevin'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Prescriber Reg No</div><input id='dr-presc-reg' type='text' value='" + esc(initial.prescriber_reg_no) + "' placeholder='e.g. 1234'></div>";

    E.modal.show(title, body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var payload = validatePayload({
                entry_date: (E.q("#dr-date").value || "").trim(),
                client_name: (E.q("#dr-client-name").value || "").trim(),
                client_id: (E.q("#dr-client-id").value || "").trim(),
                medicine_name_dose: (E.q("#dr-med").value || "").trim(),
                posology: (E.q("#dr-pos").value || "").trim(),
                prescriber_name: (E.q("#dr-prescriber").value || "").trim(),
                prescriber_reg_no: (E.q("#dr-presc-reg").value || "").trim(),
              });

              if (isEdit) await apiUpdate(entry.id, payload);
              else await apiCreate(payload);

              E.modal.hide();
              if (state && typeof state.refresh === "function") state.refresh();
            } catch (e) {
              modalError("Save failed", e);
            }
          })();
        },
      },
    ]);
  }

  function openConfirmDelete(entry) {
    if (!entry || !entry.id) return;

    var body =
      "<div style='white-space:pre-wrap'>" +
      "This will permanently delete the entry.\n\n" +
      "Date: " + esc(fmtDmyFromYmd(entry.entry_date)) + "\n" +
      "Client: " + esc(entry.client_name) + " (" + esc(entry.client_id) + ")\n" +
      "Medicine: " + esc(entry.medicine_name_dose) + "\n" +
      "</div>";

    E.modal.show("Delete entry?", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Delete",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              await apiDelete(entry.id);
              E.modal.hide();
              if (state && typeof state.refresh === "function") state.refresh();
            } catch (e) {
              modalError("Delete failed", e);
            }
          })();
        },
      },
    ]);
  }

  function openPrintWindow(entries, monthYm, queryText) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var ym = String(monthYm || "").trim();
    var q = String(queryText || "").trim();

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show(
        "Print",
        "<div style='white-space:pre-wrap'>Popup blocked. Allow popups and try again.</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
      );
      return;
    }

    function safe(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    var rowsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      rowsHtml +=
        "<tr>" +
        "<td>" + safe(fmtDmyFromYmd(r.entry_date || "")) + "</td>" +
        "<td><b>" + safe(r.client_name || "") + "</b><div style='opacity:.75;font-size:11px'>ID: " + safe(r.client_id || "") + "</div></td>" +
        "<td>" + safe(r.medicine_name_dose || "") + "</td>" +
        "<td>" + safe(r.posology || "") + "</td>" +
        "<td>" + safe(r.prescriber_name || "") + "</td>" +
        "<td>" + safe(r.prescriber_reg_no || "") + "</td>" +
        "</tr>";
    }

    var html =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>Daily Register</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 10px;font-weight:800;}" +
      "table{width:100%;border-collapse:collapse;margin-top:10px;}" +
      "th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top;}" +
      "th{background:#f5f5f5;text-align:left;}" +
      ".meta{font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>Print</button>" +
      "<h1 style='margin:0 0 4px 0;font-size:18px;'>Daily Register</h1>" +
      "<div class='meta'>Rows: " + safe(String(list.length)) + "\nMonth: " + safe(ym || "-") + "\nSearch: " + safe(q || "-") + "\nPrinted: " + safe(new Date().toLocaleString()) + "</div>" +
      "<table><thead><tr>" +
      "<th>Date</th><th>Client</th><th>Medicine Name &amp; Dose</th><th>Posology</th><th>Prescriber Name</th><th>Reg No</th>" +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);</script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function buildTableRow(entry, onEdit, onDelete) {
    var tr = document.createElement("tr");

    function tdText(text, bold) {
      var td = document.createElement("td");
      if (bold) {
        var b = document.createElement("b");
        b.textContent = text;
        td.appendChild(b);
      } else {
        td.textContent = text;
      }
      return td;
    }

    var tdDate = tdText(fmtDmyFromYmd(entry.entry_date || ""), false);

    var tdClient = document.createElement("td");
    var bName = document.createElement("b");
    bName.textContent = entry.client_name || "";
    var divId = document.createElement("div");
    divId.className = "dr-idline";
    divId.textContent = "ID: " + (entry.client_id || "");
    tdClient.appendChild(bName);
    tdClient.appendChild(divId);

    var tdMed = tdText(entry.medicine_name_dose || "", false);
    var tdPos = tdText(entry.posology || "", false);
    var tdPresc = tdText(entry.prescriber_name || "", false);
    var tdReg = tdText(entry.prescriber_reg_no || "", false);

    var tdActions = document.createElement("td");
    tdActions.style.whiteSpace = "nowrap";

    var btnEdit = document.createElement("button");
    btnEdit.className = "eikon-btn";
    btnEdit.type = "button";
    btnEdit.textContent = "Edit";
    btnEdit.style.marginRight = "8px";
    btnEdit.addEventListener("click", function () { onEdit(entry); });

    var btnDel = document.createElement("button");
    btnDel.className = "eikon-btn";
    btnDel.type = "button";
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", function () { onDelete(entry); });

    tdActions.appendChild(btnEdit);
    tdActions.appendChild(btnDel);

    tr.appendChild(tdDate);
    tr.appendChild(tdClient);
    tr.appendChild(tdMed);
    tr.appendChild(tdPos);
    tr.appendChild(tdPresc);
    tr.appendChild(tdReg);
    tr.appendChild(tdActions);

    return tr;
  }

  var state = { monthYm: thisMonthYm(), query: "", entries: [], filtered: [], mounted: false, refresh: null };

  function applyFilterAndRender(tableBodyEl, countEl) {
    var q = norm(state.query);
    var out = [];

    if (!q) {
      out = state.entries.slice();
    } else {
      for (var i = 0; i < state.entries.length; i++) {
        var r = state.entries[i];
        if (rowSearchBlob(r).indexOf(q) >= 0) out.push(r);
      }
    }

    // Sort newest date first, then id desc
    out.sort(function (a, b) {
      var da = String(a.entry_date || "");
      var db = String(b.entry_date || "");
      if (da < db) return 1;
      if (da > db) return -1;
      var ia = Number(a.id || 0);
      var ib = Number(b.id || 0);
      return ib - ia;
    });

    state.filtered = out;

    tableBodyEl.innerHTML = "";
    for (var j = 0; j < out.length; j++) {
      (function (entry) {
        var tr = buildTableRow(
          entry,
          function (e) { openEntryModal({ mode: "edit", entry: e }); },
          function (e) { openConfirmDelete(e); }
        );
        tableBodyEl.appendChild(tr);
      })(out[j]);
    }

    if (countEl) countEl.textContent = "Showing " + String(out.length) + " / " + String(state.entries.length);
  }

  async function render(ctx) {
    // PATCH: inject module-scoped styling only (no layout changes elsewhere)
    ensureDailyRegisterStyles();

    var mount = ctx.mount;
    dbg("[dailyregister] render() start", ctx);

    mount.innerHTML =
      "" +
      "<div class='dr-wrap'>" +
      "  <div class='dr-head'>" +
      "    <div>" +
      "      <h2 class='dr-title'>Daily Register</h2>" +
      "      <div class='dr-sub'>Log client medicine supply details. Search filters all columns live.</div>" +
      "    </div>" +
      "    <div class='dr-controls'>" +
      "      <div class='dr-field'>" +
      "        <label>Month</label>" +
      "        <input id='dr-month' type='month' value='" + esc(state.monthYm || thisMonthYm()) + "'>" +
      "      </div>" +
      "      <div class='dr-field' style='min-width:320px;max-width:420px;flex:1;'>" +
      "        <label>Search (any column)</label>" +
      "        <input id='dr-search' type='text' value='" + esc(state.query || "") + "' placeholder='Type to filter…'>" +
      "      </div>" +
      "      <div class='dr-actions'>" +
      "        <button id='dr-new' class='eikon-btn' type='button'>New</button>" +
      "        <button id='dr-print' class='eikon-btn' type='button'>Print</button>" +
      "        <button id='dr-refresh' class='eikon-btn' type='button'>Refresh</button>" +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "  <div class='dr-card'>" +
      "    <div class='dr-card-head'>" +
      "      <h3>Entries</h3>" +
      "      <div id='dr-count'>Loading…</div>" +
      "    </div>" +
      "    <div class='dr-table-wrap'>" +
      "      <table class='dr-table'>" +
      "        <thead>" +
      "          <tr>" +
      "            <th>Date</th>" +
      "            <th>Client</th>" +
      "            <th>Medicine Name &amp; Dose</th>" +
      "            <th>Posology</th>" +
      "            <th>Prescriber</th>" +
      "            <th>Reg No</th>" +
      "            <th>Actions</th>" +
      "          </tr>" +
      "        </thead>" +
      "        <tbody id='dr-tbody'></tbody>" +
      "      </table>" +
      "    </div>" +
      "  </div>" +
      "</div>";

    var monthEl = E.q("#dr-month", mount);
    var searchEl = E.q("#dr-search", mount);
    var btnNew = E.q("#dr-new", mount);
    var btnPrint = E.q("#dr-print", mount);
    var btnRefresh = E.q("#dr-refresh", mount);
    var tbody = E.q("#dr-tbody", mount);
    var countEl = E.q("#dr-count", mount);

    if (!monthEl || !searchEl || !btnNew || !btnPrint || !btnRefresh || !tbody || !countEl) {
      err("[dailyregister] DOM missing", {
        monthEl: !!monthEl, searchEl: !!searchEl, btnNew: !!btnNew, btnPrint: !!btnPrint,
        btnRefresh: !!btnRefresh, tbody: !!tbody, countEl: !!countEl,
      });
      throw new Error("Daily Register DOM incomplete (see console)");
    }

    async function refresh() {
      try {
        countEl.textContent = "Loading…";
        var ym = String(monthEl.value || "").trim();
        if (!isYm(ym)) ym = thisMonthYm();
        state.monthYm = ym;

        var entries = await apiList(state.monthYm);

        // Normalize expected fields
        for (var i = 0; i < entries.length; i++) {
          var r = entries[i] || {};
          r.id = r.id;
          r.entry_date = String(r.entry_date || "").trim();
          r.client_name = String(r.client_name || "").trim();
          r.client_id = String(r.client_id || "").trim();
          r.medicine_name_dose = String(r.medicine_name_dose || "").trim();
          r.posology = String(r.posology || "").trim();
          r.prescriber_name = String(r.prescriber_name || "").trim();
          r.prescriber_reg_no = String(r.prescriber_reg_no || "").trim();
        }

        state.entries = entries;
        applyFilterAndRender(tbody, countEl);
      } catch (e) {
        err("[dailyregister] refresh failed", e);
        countEl.textContent = "Failed to load";
        modalError("Daily Register", e);
      }
    }

    state.refresh = refresh;

    monthEl.addEventListener("change", function () { refresh(); });
    searchEl.addEventListener("input", function () {
      state.query = String(searchEl.value || "");
      applyFilterAndRender(tbody, countEl);
    });

    btnNew.addEventListener("click", function () {
      openEntryModal({ mode: "new", entry: { entry_date: todayYmd() } });
    });

    btnPrint.addEventListener("click", function () {
      try {
        openPrintWindow(state.filtered || [], state.monthYm, state.query || "");
      } catch (e) {
        err("[dailyregister] print failed", e);
        modalError("Print", e);
      }
    });

    btnRefresh.addEventListener("click", function () { refresh(); });

    await refresh();
    state.mounted = true;
    dbg("[dailyregister] render() done");
  }

  E.registerModule({
    id: "dailyregister",
    title: "Daily Register",
    order: 16,
    icon: "️",
    render: render,
  });
})();
