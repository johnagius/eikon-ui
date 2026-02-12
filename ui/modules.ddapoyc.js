/* ui/modules.ddapoyc.js
   DDA POYC — same UX as DDA Sales, but uses /dda-poyc/* endpoints (dda_poyc_entries table)
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E || !E.registerModule) {
    console.error("[dda-poyc] EIKON core not loaded");
    return;
  }

  function ymNow() {
    // local month (good enough for this UI)
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }

  function ymdNow() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function isValidYm(s) {
    return /^\d{4}-\d{2}$/.test(String(s || "").trim());
  }

  function isValidYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function esc(s) {
    // core has E.escapeHtml but it's currently buggy in the repo (see core.js)
    // so we do a safe local escape.
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[c];
    });
  }

  function val(root, sel) {
    var el = E.q(sel, root);
    return el ? String(el.value || "").trim() : "";
  }

  function setVal(root, sel, v) {
    var el = E.q(sel, root);
    if (el) el.value = v == null ? "" : String(v);
  }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null) return;
      v = String(v).trim();
      if (!v) return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return parts.length ? ("?" + parts.join("&")) : "";
  }

  async function apiGet(path) {
    return await E.apiFetch(path, { method: "GET" });
  }

  async function apiPost(path, obj) {
    return await E.apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj || {})
    });
  }

  async function apiPut(path, obj) {
    return await E.apiFetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj || {})
    });
  }

  async function apiDel(path) {
    return await E.apiFetch(path, { method: "DELETE" });
  }

  function renderShell(mount) {
    mount.innerHTML = `
      <div class="eikon-card" style="padding:14px;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
          <div>
            <label style="display:block;font-weight:800;margin-bottom:6px;">Month</label>
            <input id="ddaPoycMonth" type="month" style="padding:10px;border:1px solid #ccc;border-radius:10px;" />
          </div>

          <div style="flex:1;min-width:220px;">
            <label style="display:block;font-weight:800;margin-bottom:6px;">Search</label>
            <input id="ddaPoycQ" placeholder="name, ID card, serial, medicine…" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
          </div>

          <button id="ddaPoycRefresh" class="eikon-btn" style="padding:10px 14px;font-weight:900;">Refresh</button>
          <button id="ddaPoycAdd" class="eikon-btn" style="padding:10px 14px;font-weight:900;">+ Add</button>
          <button id="ddaPoycReport" class="eikon-btn" style="padding:10px 14px;font-weight:900;">Print Report</button>
        </div>

        <div id="ddaPoycMsg" style="margin-top:10px;font-weight:800;"></div>

        <div style="overflow:auto;margin-top:12px;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Date</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Client</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">ID Card</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Address</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Medicine (dose)</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Qty</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Doctor</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Reg No</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Rx Serial</th>
                <th style="border:1px solid #bbb;padding:8px;background:#f2f2f2;">Actions</th>
              </tr>
            </thead>
            <tbody id="ddaPoycRows">
              <tr><td colspan="10" style="border:1px solid #bbb;padding:10px;color:#444;">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div id="ddaPoycModal" style="position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:18px;z-index:999999;">
        <div style="background:#fff;border-radius:14px;max-width:720px;width:100%;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.3);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div style="font-weight:900;font-size:16px;" id="ddaPoycModalTitle">Add Entry</div>
            <button id="ddaPoycModalClose" class="eikon-btn" style="padding:8px 10px;font-weight:900;">✕</button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
            <div>
              <label style="font-weight:800;display:block;margin-bottom:6px;">Date</label>
              <input id="f_entry_date" type="date" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>
            <div>
              <label style="font-weight:800;display:block;margin-bottom:6px;">Quantity</label>
              <input id="f_quantity" type="number" min="1" step="1" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>

            <div style="grid-column:1 / -1;">
              <label style="font-weight:800;display:block;margin-bottom:6px;">Client Name</label>
              <input id="f_client_name" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>

            <div>
              <label style="font-weight:800;display:block;margin-bottom:6px;">Client ID Card</label>
              <input id="f_client_id_card" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>
            <div>
              <label style="font-weight:800;display:block;margin-bottom:6px;">Prescription Serial No.</label>
              <input id="f_prescription_serial_no" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>

            <div style="grid-column:1 / -1;">
              <label style="font-weight:800;display:block;margin-bottom:6px;">Client Address</label>
              <input id="f_client_address" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>

            <div style="grid-column:1 / -1;">
              <label style="font-weight:800;display:block;margin-bottom:6px;">Medicine Name & Dose</label>
              <input id="f_medicine_name_dose" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>

            <div>
              <label style="font-weight:800;display:block;margin-bottom:6px;">Doctor Name</label>
              <input id="f_doctor_name" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>
            <div>
              <label style="font-weight:800;display:block;margin-bottom:6px;">Doctor Reg No.</label>
              <input id="f_doctor_reg_no" style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" />
            </div>
          </div>

          <div id="ddaPoycModalMsg" style="margin-top:10px;font-weight:800;"></div>

          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">
            <button id="ddaPoycSave" class="eikon-btn" style="padding:10px 14px;font-weight:900;">Save</button>
          </div>

          <input type="hidden" id="f_id" />
        </div>
      </div>
    `;
  }

  function showMsg(root, text, isErr) {
    var el = E.q("#ddaPoycMsg", root);
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isErr ? "#b00020" : "#0a7a2f";
  }

  function showModalMsg(root, text, isErr) {
    var el = E.q("#ddaPoycModalMsg", root);
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isErr ? "#b00020" : "#0a7a2f";
  }

  function openModal(root, mode, row) {
    var modal = E.q("#ddaPoycModal", root);
    var title = E.q("#ddaPoycModalTitle", root);
    if (!modal || !title) return;

    showModalMsg(root, "", false);

    if (mode === "edit") {
      title.textContent = "Edit Entry";
      setVal(root, "#f_id", row.id);
      setVal(root, "#f_entry_date", row.entry_date || "");
      setVal(root, "#f_client_name", row.client_name || "");
      setVal(root, "#f_client_id_card", row.client_id_card || "");
      setVal(root, "#f_client_address", row.client_address || "");
      setVal(root, "#f_medicine_name_dose", row.medicine_name_dose || "");
      setVal(root, "#f_quantity", row.quantity == null ? "" : row.quantity);
      setVal(root, "#f_doctor_name", row.doctor_name || "");
      setVal(root, "#f_doctor_reg_no", row.doctor_reg_no || "");
      setVal(root, "#f_prescription_serial_no", row.prescription_serial_no || "");
    } else {
      title.textContent = "Add Entry";
      setVal(root, "#f_id", "");
      setVal(root, "#f_entry_date", ymdNow());
      setVal(root, "#f_client_name", "");
      setVal(root, "#f_client_id_card", "");
      setVal(root, "#f_client_address", "");
      setVal(root, "#f_medicine_name_dose", "");
      setVal(root, "#f_quantity", "1");
      setVal(root, "#f_doctor_name", "");
      setVal(root, "#f_doctor_reg_no", "");
      setVal(root, "#f_prescription_serial_no", "");
    }

    modal.style.display = "flex";
  }

  function closeModal(root) {
    var modal = E.q("#ddaPoycModal", root);
    if (modal) modal.style.display = "none";
  }

  function readForm(root) {
    var obj = {
      entry_date: val(root, "#f_entry_date"),
      client_name: val(root, "#f_client_name"),
      client_id_card: val(root, "#f_client_id_card"),
      client_address: val(root, "#f_client_address"),
      medicine_name_dose: val(root, "#f_medicine_name_dose"),
      quantity: Number(val(root, "#f_quantity")),
      doctor_name: val(root, "#f_doctor_name"),
      doctor_reg_no: val(root, "#f_doctor_reg_no"),
      prescription_serial_no: val(root, "#f_prescription_serial_no")
    };
    return obj;
  }

  function validateEntry(obj) {
    if (!isValidYmd(obj.entry_date)) return "Invalid date (YYYY-MM-DD)";
    if (!obj.client_name) return "Client name is required";
    if (!obj.client_id_card) return "Client ID card is required";
    if (!obj.client_address) return "Client address is required";
    if (!obj.medicine_name_dose) return "Medicine name & dose is required";
    if (!obj.quantity || obj.quantity < 1 || !Number.isInteger(obj.quantity)) return "Quantity must be an integer >= 1";
    if (!obj.doctor_name) return "Doctor name is required";
    if (!obj.doctor_reg_no) return "Doctor reg no is required";
    if (!obj.prescription_serial_no) return "Prescription serial no is required";
    return "";
  }

  function renderRows(root, entries) {
    var tb = E.q("#ddaPoycRows", root);
    if (!tb) return;

    if (!entries || !entries.length) {
      tb.innerHTML = `<tr><td colspan="10" style="border:1px solid #bbb;padding:10px;color:#444;">No entries.</td></tr>`;
      return;
    }

    tb.innerHTML = entries.map(function (r) {
      return `
        <tr data-id="${esc(r.id)}">
          <td style="border:1px solid #bbb;padding:8px;white-space:nowrap;">${esc(r.entry_date)}</td>
          <td style="border:1px solid #bbb;padding:8px;">${esc(r.client_name)}</td>
          <td style="border:1px solid #bbb;padding:8px;white-space:nowrap;">${esc(r.client_id_card)}</td>
          <td style="border:1px solid #bbb;padding:8px;">${esc(r.client_address)}</td>
          <td style="border:1px solid #bbb;padding:8px;">${esc(r.medicine_name_dose)}</td>
          <td style="border:1px solid #bbb;padding:8px;white-space:nowrap;">${esc(r.quantity)}</td>
          <td style="border:1px solid #bbb;padding:8px;">${esc(r.doctor_name)}</td>
          <td style="border:1px solid #bbb;padding:8px;white-space:nowrap;">${esc(r.doctor_reg_no)}</td>
          <td style="border:1px solid #bbb;padding:8px;white-space:nowrap;">${esc(r.prescription_serial_no)}</td>
          <td style="border:1px solid #bbb;padding:8px;white-space:nowrap;">
            <button class="ddaPoycEdit eikon-btn" style="padding:6px 10px;font-weight:900;">Edit</button>
            <button class="ddaPoycDel eikon-btn" style="padding:6px 10px;font-weight:900;">Del</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function loadList(root) {
    var month = val(root, "#ddaPoycMonth");
    if (!isValidYm(month)) month = ymNow();

    var q = val(root, "#ddaPoycQ");

    showMsg(root, "Loading…", false);

    var res = await apiGet("/dda-poyc/entries" + qs({ month: month, q: q }));
    renderRows(root, (res && res.entries) || []);
    showMsg(root, "", false);
  }

  async function onSave(root) {
    var id = val(root, "#f_id");
    var obj = readForm(root);
    var err = validateEntry(obj);
    if (err) {
      showModalMsg(root, err, true);
      return;
    }

    showModalMsg(root, "Saving…", false);

    if (id) {
      await apiPut("/dda-poyc/entries/" + encodeURIComponent(id), obj);
    } else {
      await apiPost("/dda-poyc/entries", obj);
    }

    showModalMsg(root, "", false);
    closeModal(root);
    await loadList(root);
  }

  function monthToRange(monthYm) {
    // monthYm: YYYY-MM
    // returns {from,to} where to is last day of month
    var y = parseInt(monthYm.slice(0, 4), 10);
    var m = parseInt(monthYm.slice(5, 7), 10);
    var from = monthYm + "-01";
    var last = new Date(y, m, 0); // local, day 0 => last day prev month (here: correct for m)
    var to = y + "-" + String(m).padStart(2, "0") + "-" + String(last.getDate()).padStart(2, "0");
    return { from: from, to: to };
  }

  function bindEvents(root) {
    var btnRefresh = E.q("#ddaPoycRefresh", root);
    var btnAdd = E.q("#ddaPoycAdd", root);
    var btnReport = E.q("#ddaPoycReport", root);
    var monthEl = E.q("#ddaPoycMonth", root);
    var qEl = E.q("#ddaPoycQ", root);

    var modalClose = E.q("#ddaPoycModalClose", root);
    var saveBtn = E.q("#ddaPoycSave", root);

    if (btnRefresh) btnRefresh.addEventListener("click", function () { loadList(root).catch(function (e) { showMsg(root, e.message || String(e), true); }); });
    if (monthEl) monthEl.addEventListener("change", function () { loadList(root).catch(function (e) { showMsg(root, e.message || String(e), true); }); });
    if (qEl) qEl.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") loadList(root).catch(function (e) { showMsg(root, e.message || String(e), true); });
    });

    if (btnAdd) btnAdd.addEventListener("click", function () { openModal(root, "add"); });
    if (modalClose) modalClose.addEventListener("click", function () { closeModal(root); });
    if (saveBtn) saveBtn.addEventListener("click", function () {
      onSave(root).catch(function (e) {
        showModalMsg(root, e.message || String(e), true);
      });
    });

    // Report (opens HTML report)
    if (btnReport) btnReport.addEventListener("click", function () {
      var month = val(root, "#ddaPoycMonth");
      if (!isValidYm(month)) month = ymNow();
      var range = monthToRange(month);
      var url = "/dda-poyc/report/html" + qs({ from: range.from, to: range.to });
      window.open(url, "_blank", "noopener,noreferrer");
    });

    // Delegated table actions
    root.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t) return;

      // Edit
      if (t.classList && t.classList.contains("ddaPoycEdit")) {
        var tr = t.closest("tr");
        if (!tr) return;
        var id = tr.getAttribute("data-id");
        if (!id) return;

        // Read row data directly from cells (fast/simple)
        var cells = tr.querySelectorAll("td");
        var row = {
          id: id,
          entry_date: cells[0] ? cells[0].textContent.trim() : "",
          client_name: cells[1] ? cells[1].textContent.trim() : "",
          client_id_card: cells[2] ? cells[2].textContent.trim() : "",
          client_address: cells[3] ? cells[3].textContent.trim() : "",
          medicine_name_dose: cells[4] ? cells[4].textContent.trim() : "",
          quantity: cells[5] ? Number(cells[5].textContent.trim()) : 1,
          doctor_name: cells[6] ? cells[6].textContent.trim() : "",
          doctor_reg_no: cells[7] ? cells[7].textContent.trim() : "",
          prescription_serial_no: cells[8] ? cells[8].textContent.trim() : ""
        };
        openModal(root, "edit", row);
      }

      // Delete
      if (t.classList && t.classList.contains("ddaPoycDel")) {
        var tr2 = t.closest("tr");
        if (!tr2) return;
        var id2 = tr2.getAttribute("data-id");
        if (!id2) return;

        var ok = window.confirm("Delete this entry?");
        if (!ok) return;

        (async function () {
          showMsg(root, "Deleting…", false);
          await apiDel("/dda-poyc/entries/" + encodeURIComponent(id2));
          await loadList(root);
          showMsg(root, "", false);
        })().catch(function (e) {
          showMsg(root, e.message || String(e), true);
        });
      }
    });
  }

  E.registerModule({
    id: "dda-poyc",
    title: "DDA POYC",
    icon: "🧾",
    order: 55,

    render: async function (ctx) {
      // IMPORTANT: core.js calls render({E,mount,user})
      if (!ctx || !ctx.mount || !(ctx.mount instanceof Element)) {
        throw new Error("Invalid render root");
      }

      var mount = ctx.mount;

      renderShell(mount);

      // defaults
      var monthEl = E.q("#ddaPoycMonth", mount);
      if (monthEl) monthEl.value = ymNow();

      bindEvents(mount);

      // initial load
      await loadList(mount);
    }
  });

  E.dbg && E.dbg("[dda-poyc] registered via window.EIKON.registerModule()");
})();
