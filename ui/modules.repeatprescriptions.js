(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.repeatprescriptions.js)");

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

  function addMonthsToYmd(ymd, months) {
    var s = String(ymd || "").trim();
    if (!isYmd(s)) return null;

    var y = parseInt(s.slice(0, 4), 10);
    var m = parseInt(s.slice(5, 7), 10);
    var d = parseInt(s.slice(8, 10), 10);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;

    var targetMonthIndex = (m - 1) + Number(months || 0);
    var ty = y + Math.floor(targetMonthIndex / 12);
    var tm = ((targetMonthIndex % 12) + 12) % 12;

    var lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    var td = Math.min(d, lastDay);

    var dt = new Date(Date.UTC(ty, tm, td));
    return dt.toISOString().slice(0, 10);
  }

  function isExpiredYmd(expiresYmd) {
    var ex = String(expiresYmd || "").trim();
    if (!isYmd(ex)) return false;
    return ex < todayYmd(); // strictly older than today
  }

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().trim();
  }

  function rowSearchBlob(r) {
    return (
      norm(r.entry_date) +
      " | " +
      norm(r.expires_date) +
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
  // Styles
  // ------------------------------------------------------------
  var rpStyleInstalled = false;
  function ensureRepeatPrescriptionStyles() {
    if (rpStyleInstalled) return;
    rpStyleInstalled = true;

    var st = document.createElement("style");
    st.type = "text/css";
    st.id = "eikon-repeatprescriptions-style";
    st.textContent =
      "" +
      ".rp-wrap{max-width:1200px;margin:0 auto;padding:16px;}" +
      ".rp-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px;}" +
      ".rp-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".rp-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +
      ".rp-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +
      ".rp-field{display:flex;flex-direction:column;gap:4px;}" +
      ".rp-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +
      ".rp-field input{padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;transition:border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;}" +
      ".rp-field input:hover{border-color:rgba(255,255,255,.18);}" +
      ".rp-field input:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);}" +
      ".rp-field input::placeholder{color:rgba(233,238,247,.40);}" +
      "#rp-month,#rp-search{color-scheme:dark;}" +
      ".rp-actions{display:flex;gap:10px;align-items:flex-end;}" +
      ".rp-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:12px;background:var(--panel,rgba(16,24,36,.66));box-shadow:0 18px 50px rgba(0,0,0,.38);backdrop-filter:blur(10px);}" +
      ".rp-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".rp-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      "#rp-count{font-size:12px;color:var(--muted,rgba(233,238,247,.68));font-weight:800;}" +
      ".rp-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.18);}" +
      ".rp-table{width:100%;border-collapse:collapse;min-width:1180px;color:var(--text,#e9eef7);}" +
      ".rp-table th,.rp-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:10px 10px;font-size:12px;vertical-align:top;}" +
      ".rp-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:1000;text-align:left;}" +
      ".rp-table tbody tr:hover{background:rgba(255,255,255,.04);}" +
      ".rp-table tbody tr.rp-expired{background:rgba(255,80,80,.18) !important;}" +
      ".rp-table tbody tr.rp-expired:hover{background:rgba(255,80,80,.26) !important;}" +
      ".rp-table tbody tr.rp-expired td:first-child{box-shadow:inset 4px 0 0 rgba(255,80,80,.65);}" +
      ".rp-idline{opacity:.75;font-size:11px;color:var(--muted,rgba(233,238,247,.68));}" +
      "#rp-date,#rp-expires,#rp-client-name,#rp-client-id,#rp-med,#rp-pos,#rp-prescriber,#rp-presc-reg{width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;}" +
      "#rp-date:focus,#rp-expires:focus,#rp-client-name:focus,#rp-client-id:focus,#rp-med:focus,#rp-pos:focus,#rp-prescriber:focus,#rp-presc-reg:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);}" +
      "#rp-date,#rp-expires{color-scheme:dark;}" +
      "@media(max-width:820px){.rp-wrap{padding:12px;}.rp-controls{width:100%;}}";

    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // API
  // ------------------------------------------------------------
  async function apiList(monthYm) {
    var ym = String(monthYm || "").trim();
    if (!isYm(ym)) throw new Error("Invalid month (YYYY-MM)");
    var resp = await E.apiFetch("/repeat-prescriptions/entries?month=" + encodeURIComponent(ym), { method: "GET" });
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Failed to load repeat prescription entries");
    return Array.isArray(resp.entries) ? resp.entries : [];
  }

  async function apiCreate(payload) {
    var resp = await E.apiFetch("/repeat-prescriptions/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Create failed");
    return resp;
  }

  async function apiUpdate(id, payload) {
    var resp = await E.apiFetch("/repeat-prescriptions/entries/" + encodeURIComponent(String(id)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Update failed");
    return resp;
  }

  async function apiDelete(id) {
    var resp = await E.apiFetch("/repeat-prescriptions/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : "Delete failed");
    return resp;
  }

  function validatePayload(p) {
    var out = {
      entry_date: String(p.entry_date || "").trim(),
      expires_date: String(p.expires_date || "").trim(),
      client_name: String(p.client_name || "").trim(),
      client_id: String(p.client_id || "").trim(),
      medicine_name_dose: String(p.medicine_name_dose || "").trim(),
      posology: String(p.posology || "").trim(),
      prescriber_name: String(p.prescriber_name || "").trim(),
      prescriber_reg_no: String(p.prescriber_reg_no || "").trim(),
    };

    if (!out.entry_date || !isYmd(out.entry_date)) throw new Error("Date is required (YYYY-MM-DD)");
    if (!out.expires_date || !isYmd(out.expires_date)) throw new Error("Expires is required (YYYY-MM-DD)");
    if (!out.client_name) throw new Error("Client Name & Surname is required");
    if (!out.client_id) throw new Error("Client ID is required");
    if (!out.medicine_name_dose) throw new Error("Medicine Name & Dose is required");
    if (!out.posology) throw new Error("Posology is required");
    if (!out.prescriber_name) throw new Error("Prescriber Name is required");
    if (!out.prescriber_reg_no) throw new Error("Prescriber Reg No is required");

    return out;
  }

  function modalError(title, e) {
    try {
      var msg = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : "Error");
      E.modal.show(title || "Error", "\n" + esc(msg) + "\n", [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } },
      ]);
    } catch (e2) {
      alert(String(e && (e.message || e) ? (e.message || e) : "Error"));
    }
  }

  function openEntryModal(opts) {
    var mode = opts && opts.mode ? String(opts.mode) : "new";
    var entry = opts && opts.entry ? opts.entry : {};
    var isEdit = mode === "edit";

    var initialEntryDate = String(entry.entry_date || todayYmd()).trim();
    if (!isYmd(initialEntryDate)) initialEntryDate = todayYmd();

    var initialExpires = String(entry.expires_date || "").trim();
    if (!isYmd(initialExpires)) initialExpires = addMonthsToYmd(initialEntryDate, 6) || initialEntryDate;

    var body =
      "" +
      "<div class='eikon-form'>" +
      "  <div class='eikon-form-row'><label>Date</label><input id='rp-date' type='date' value='" + esc(initialEntryDate) + "' /></div>" +
      "  <div class='eikon-form-row'><label>Expires</label><input id='rp-expires' type='date' value='" + esc(initialExpires) + "' /></div>" +
      "  <div class='eikon-form-row'><label>Client Name &amp; Surname</label><input id='rp-client-name' type='text' value='" + esc(entry.client_name || "") + "' /></div>" +
      "  <div class='eikon-form-row'><label>Client ID</label><input id='rp-client-id' type='text' value='" + esc(entry.client_id || "") + "' /></div>" +
      "  <div class='eikon-form-row'><label>Medicine Name &amp; Dose</label><input id='rp-med' type='text' value='" + esc(entry.medicine_name_dose || "") + "' /></div>" +
      "  <div class='eikon-form-row'><label>Posology</label><input id='rp-pos' type='text' value='" + esc(entry.posology || "") + "' /></div>" +
      "  <div class='eikon-form-row'><label>Prescriber Name</label><input id='rp-prescriber' type='text' value='" + esc(entry.prescriber_name || "") + "' /></div>" +
      "  <div class='eikon-form-row'><label>Prescriber Reg No</label><input id='rp-presc-reg' type='text' value='" + esc(entry.prescriber_reg_no || "") + "' /></div>" +
      "</div>";

    E.modal.show(isEdit ? "Edit Repeat Prescription Entry" : "New Repeat Prescription Entry", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var payload = validatePayload({
                entry_date: (E.q("#rp-date").value || "").trim(),
                expires_date: (E.q("#rp-expires").value || "").trim(),
                client_name: (E.q("#rp-client-name").value || "").trim(),
                client_id: (E.q("#rp-client-id").value || "").trim(),
                medicine_name_dose: (E.q("#rp-med").value || "").trim(),
                posology: (E.q("#rp-pos").value || "").trim(),
                prescriber_name: (E.q("#rp-prescriber").value || "").trim(),
                prescriber_reg_no: (E.q("#rp-presc-reg").value || "").trim(),
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

    // Auto set expires = date + 6 months unless user edits expires
    setTimeout(function () {
      try {
        var dateEl = E.q("#rp-date");
        var expEl = E.q("#rp-expires");
        if (!dateEl || !expEl) return;

        var touched = false;
        expEl.addEventListener("input", function () { touched = true; });

        dateEl.addEventListener("change", function () {
          if (touched) return;
          var d = String(dateEl.value || "").trim();
          if (!isYmd(d)) return;
          var next = addMonthsToYmd(d, 6);
          if (next) expEl.value = next;
        });
      } catch (e) {}
    }, 0);
  }

  function openConfirmDelete(entry) {
    if (!entry || !entry.id) return;

    var body =
      "\nThis will permanently delete the entry.\n\n" +
      "Date: " + esc(fmtDmyFromYmd(entry.entry_date)) + "\n" +
      "Expires: " + esc(fmtDmyFromYmd(entry.expires_date)) + "\n" +
      "Client: " + esc(entry.client_name) + " (" + esc(entry.client_id) + ")\n" +
      "Medicine: " + esc(entry.medicine_name_dose) + "\n";

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

  function buildTableRow(entry) {
    var tr = document.createElement("tr");
    if (isExpiredYmd(entry.expires_date)) tr.className = "rp-expired";

    function tdText(text) {
      var td = document.createElement("td");
      td.textContent = text;
      return td;
    }

    var tdDate = tdText(fmtDmyFromYmd(entry.entry_date || ""));
    var tdExpires = tdText(fmtDmyFromYmd(entry.expires_date || ""));

    var tdClient = document.createElement("td");
    var bName = document.createElement("b");
    bName.textContent = entry.client_name || "";
    var divId = document.createElement("div");
    divId.className = "rp-idline";
    divId.textContent = "ID: " + (entry.client_id || "");
    tdClient.appendChild(bName);
    tdClient.appendChild(divId);

    var tdMed = tdText(entry.medicine_name_dose || "");
    var tdPos = tdText(entry.posology || "");
    var tdPresc = tdText(entry.prescriber_name || "");
    var tdReg = tdText(entry.prescriber_reg_no || "");

    var tdActions = document.createElement("td");
    tdActions.style.whiteSpace = "nowrap";

    var btnEdit = document.createElement("button");
    btnEdit.className = "eikon-btn";
    btnEdit.type = "button";
    btnEdit.textContent = "Edit";
    btnEdit.style.marginRight = "8px";
    btnEdit.addEventListener("click", function () { openEntryModal({ mode: "edit", entry: entry }); });

    var btnDel = document.createElement("button");
    btnDel.className = "eikon-btn";
    btnDel.type = "button";
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", function () { openConfirmDelete(entry); });

    tdActions.appendChild(btnEdit);
    tdActions.appendChild(btnDel);

    tr.appendChild(tdDate);
    tr.appendChild(tdExpires);
    tr.appendChild(tdClient);
    tr.appendChild(tdMed);
    tr.appendChild(tdPos);
    tr.appendChild(tdPresc);
    tr.appendChild(tdReg);
    tr.appendChild(tdActions);

    return tr;
  }

  var state = { monthYm: thisMonthYm(), query: "", entries: [], filtered: [], refresh: null };

  function applyFilterAndRender(tbody, countEl) {
    var q = norm(state.query);
    var out = [];

    // Never hide expired rows here; only filter by search text
    if (!q) out = state.entries.slice();
    else {
      for (var i = 0; i < state.entries.length; i++) {
        var r = state.entries[i];
        if (rowSearchBlob(r).indexOf(q) >= 0) out.push(r);
      }
    }

    out.sort(function (a, b) {
      var da = String(a.entry_date || "");
      var db = String(b.entry_date || "");
      if (da < db) return 1;
      if (da > db) return -1;
      return Number(b.id || 0) - Number(a.id || 0);
    });

    state.filtered = out;

    tbody.innerHTML = "";
    for (var j = 0; j < out.length; j++) tbody.appendChild(buildTableRow(out[j]));

    if (countEl) countEl.textContent = "Showing " + out.length + " / " + state.entries.length;
  }

  async function render(ctx) {
    ensureRepeatPrescriptionStyles();

    var mount = ctx.mount;
    mount.innerHTML =
      "" +
      "<div class='rp-wrap'>" +
      "  <div class='rp-head'>" +
      "    <div><h2 class='rp-title'>Repeat Prescriptions</h2><div class='rp-sub'>Expired rows stay visible and are highlighted red.</div></div>" +
      "    <div class='rp-controls'>" +
      "      <div class='rp-field'><label for='rp-month'>Month (Entry Date)</label><input id='rp-month' type='month' value='" + esc(state.monthYm) + "' /></div>" +
      "      <div class='rp-field'><label for='rp-search'>Search (any column)</label><input id='rp-search' type='text' placeholder='Type to filter…' value='" + esc(state.query || "") + "' /></div>" +
      "      <div class='rp-actions'>" +
      "        <button id='rp-new' class='eikon-btn' type='button'>New</button>" +
      "        <button id='rp-refresh' class='eikon-btn' type='button'>Refresh</button>" +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "  <div class='rp-card'>" +
      "    <div class='rp-card-head'><h3>Entries</h3><div id='rp-count'>Loading…</div></div>" +
      "    <div class='rp-table-wrap'>" +
      "      <table class='rp-table'>" +
      "        <thead><tr>" +
      "          <th>Date</th><th>Expires</th><th>Client</th><th>Medicine Name &amp; Dose</th><th>Posology</th><th>Prescriber</th><th>Reg No</th><th>Actions</th>" +
      "        </tr></thead>" +
      "        <tbody id='rp-tbody'><tr><td colspan='8'>Loading…</td></tr></tbody>" +
      "      </table>" +
      "    </div>" +
      "  </div>" +
      "</div>";

    var monthEl = E.q("#rp-month", mount);
    var searchEl = E.q("#rp-search", mount);
    var btnNew = E.q("#rp-new", mount);
    var btnRefresh = E.q("#rp-refresh", mount);
    var tbody = E.q("#rp-tbody", mount);
    var countEl = E.q("#rp-count", mount);

    async function refresh() {
      try {
        countEl.textContent = "Loading…";
        var ym = String(monthEl.value || "").trim();
        if (!isYm(ym)) ym = thisMonthYm();
        state.monthYm = ym;

        var entries = await apiList(state.monthYm);

        for (var i = 0; i < entries.length; i++) {
          var r = entries[i] || {};
          r.id = r.id;
          r.entry_date = String(r.entry_date || "").trim();
          r.expires_date = String(r.expires_date || "").trim();
          r.client_name = String(r.client_name || "").trim();
          r.client_id = String(r.client_id || "").trim();
          r.medicine_name_dose = String(r.medicine_name_dose || "").trim();
          r.posology = String(r.posology || "").trim();
          r.prescriber_name = String(r.prescriber_name || "").trim();
          r.prescriber_reg_no = String(r.prescriber_reg_no || "").trim();

          // safety default if backend returns old row missing expires_date
          if (!isYmd(r.expires_date) && isYmd(r.entry_date)) r.expires_date = addMonthsToYmd(r.entry_date, 6) || "";
        }

        state.entries = entries;
        applyFilterAndRender(tbody, countEl);
      } catch (e) {
        err("[repeatprescriptions] refresh failed", e);
        countEl.textContent = "Failed to load";
        modalError("Repeat Prescriptions", e);
      }
    }

    state.refresh = refresh;

    monthEl.addEventListener("change", refresh);
    searchEl.addEventListener("input", function () {
      state.query = String(searchEl.value || "");
      applyFilterAndRender(tbody, countEl);
    });

    btnNew.addEventListener("click", function () {
      var d = todayYmd();
      openEntryModal({ mode: "new", entry: { entry_date: d, expires_date: addMonthsToYmd(d, 6) || d } });
    });

    btnRefresh.addEventListener("click", refresh);

    await refresh();
  }

  E.registerModule({
    id: "repeatprescriptions",
    title: "Repeat Prescriptions",
    order: 17,
    icon: "🔁",
    render: render,
  });
})();
