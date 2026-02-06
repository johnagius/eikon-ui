(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.temperature.js)");

  function ymd(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var dd = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function ym(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }

  function esc(s) { return E.escapeHtml(s); }

  var state = {
    devices: null,
    entriesByMonth: {}, // { "YYYY-MM": [...] }
    lastMonth: ""
  };

  async function loadDevices() {
    if (state.devices) return state.devices;
    E.dbg("[temp] loadDevices()");
    var resp = await E.apiFetch("/temperature/devices", { method: "GET" });
    if (!resp || !resp.ok) throw new Error("Failed to load devices");
    state.devices = resp.devices || [];
    E.dbg("[temp] devices loaded:", state.devices.length);
    return state.devices;
  }

  async function loadEntries(month) {
    E.dbg("[temp] loadEntries() month=", month);
    var resp = await E.apiFetch("/temperature/entries?month=" + encodeURIComponent(month), { method: "GET" });
    if (!resp || !resp.ok) throw new Error("Failed to load entries");
    state.entriesByMonth[month] = resp.entries || [];
    E.dbg("[temp] entries loaded:", state.entriesByMonth[month].length);
    return state.entriesByMonth[month];
  }

  function renderRegister(mount, devices, entries, month) {
    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Month</div>' +
      '      <input class="eikon-input" id="temp-month" type="month" value="' + esc(month) + '"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Actions</div>' +
      '      <div class="eikon-row" style="gap:10px;">' +
      '        <button class="eikon-btn" id="temp-refresh">Refresh</button>' +
      '        <button class="eikon-btn" id="temp-print">Print</button>' +
      "      </div>" +
      "    </div>" +
      '    <div class="eikon-field" style="flex:1;min-width:240px;">' +
      '      <div class="eikon-label">Devices</div>' +
      '      <div class="eikon-help">' + esc(String(devices.length)) + " active device(s) for this location.</div>" +
      "    </div>" +
      "  </div>" +
      "</div>" +

      '<div class="eikon-card">' +
      '  <div style="font-weight:900;margin-bottom:10px;">Add / Update Entry (same date + device overwrites)</div>' +
      '  <div class="eikon-row">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Date</div>' +
      '      <input class="eikon-input" id="temp-date" type="date" value="' + esc(ymd(new Date())) + '"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Device</div>' +
      '      <select class="eikon-select" id="temp-device"></select>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Min</div>' +
      '      <input class="eikon-input" id="temp-min" type="number" step="0.1" />' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Max</div>' +
      '      <input class="eikon-input" id="temp-max" type="number" step="0.1" />' +
      "    </div>" +
      '    <div class="eikon-field" style="flex:1;min-width:260px;">' +
      '      <div class="eikon-label">Notes</div>' +
      '      <input class="eikon-input" id="temp-notes" type="text" placeholder="optional"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">&nbsp;</div>' +
      '      <button class="eikon-btn primary" id="temp-save">Save</button>' +
      "    </div>" +
      "  </div>" +
      '  <div class="eikon-help" style="margin-top:10px;">Tip: if you see Unauthorized, you are not logged in or token is missing.</div>' +
      "</div>" +

      '<div class="eikon-card">' +
      '  <div style="font-weight:900;margin-bottom:10px;">Entries</div>' +
      '  <div class="eikon-table-wrap">' +
      '    <table class="eikon-table">' +
      "      <thead>" +
      "        <tr>" +
      "          <th>Date</th>" +
      "          <th>Device</th>" +
      "          <th>Min</th>" +
      "          <th>Max</th>" +
      "          <th>Notes</th>" +
      "          <th>Actions</th>" +
      "        </tr>" +
      "      </thead>" +
      '      <tbody id="temp-tbody"></tbody>' +
      "    </table>" +
      "  </div>" +
      "</div>";

    // Bind safely inside mount
    var monthInput = E.q("#temp-month", mount);
    var refreshBtn = E.q("#temp-refresh", mount);
    var printBtn = E.q("#temp-print", mount);
    var saveBtn = E.q("#temp-save", mount);
    var deviceSel = E.q("#temp-device", mount);
    var tbody = E.q("#temp-tbody", mount);

    // HARD DEBUG if missing
    if (!monthInput || !refreshBtn || !saveBtn || !deviceSel || !tbody) {
      E.error("[temp] DOM missing in renderRegister", {
        monthInput: !!monthInput,
        refreshBtn: !!refreshBtn,
        saveBtn: !!saveBtn,
        deviceSel: !!deviceSel,
        tbody: !!tbody
      });
      E.error("[temp] mount innerHTML snapshot:", mount.innerHTML.slice(0, 2000));
      throw new Error("Temperature register DOM incomplete (see console)");
    }

    // Populate devices dropdown
    deviceSel.innerHTML = "";
    devices.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = String(d.device_id || d.id);
      opt.textContent = (d.device_name || d.name) + " (" + (d.device_type || "") + ")";
      deviceSel.appendChild(opt);
    });

    // Render table
    function fillTable(list) {
      tbody.innerHTML = "";
      list.forEach(function (r) {
        var tr = document.createElement("tr");

        var tdDate = document.createElement("td");
        tdDate.textContent = r.entry_date || "";
        tr.appendChild(tdDate);

        var tdDev = document.createElement("td");
        tdDev.textContent = r.device_name || "";
        tr.appendChild(tdDev);

        var tdMin = document.createElement("td");
        tdMin.textContent = (r.min_temp === null || r.min_temp === undefined) ? "" : String(r.min_temp);
        tr.appendChild(tdMin);

        var tdMax = document.createElement("td");
        tdMax.textContent = (r.max_temp === null || r.max_temp === undefined) ? "" : String(r.max_temp);
        tr.appendChild(tdMax);

        var tdNotes = document.createElement("td");
        tdNotes.textContent = r.notes || "";
        tr.appendChild(tdNotes);

        var tdAct = document.createElement("td");

        var editBtn = document.createElement("button");
        editBtn.className = "eikon-btn";
        editBtn.textContent = "Edit";

        var delBtn = document.createElement("button");
        delBtn.className = "eikon-btn danger";
        delBtn.style.marginLeft = "8px";
        delBtn.textContent = "Delete";

        editBtn.addEventListener("click", function () {
          openEdit(r);
        });

        delBtn.addEventListener("click", function () {
          openDelete(r);
        });

        tdAct.appendChild(editBtn);
        tdAct.appendChild(delBtn);
        tr.appendChild(tdAct);

        tbody.appendChild(tr);
      });
    }

    fillTable(entries);

    function openEdit(row) {
      var body =
        '<div class="eikon-row">' +
        '  <div class="eikon-field">' +
        '    <div class="eikon-label">Date</div>' +
        '    <input class="eikon-input" id="temp-edit-date" type="date" value="' + esc(row.entry_date || "") + '"/>' +
        "  </div>" +
        '  <div class="eikon-field">' +
        '    <div class="eikon-label">Min</div>' +
        '    <input class="eikon-input" id="temp-edit-min" type="number" step="0.1" value="' + esc(row.min_temp == null ? "" : String(row.min_temp)) + '"/>' +
        "  </div>" +
        '  <div class="eikon-field">' +
        '    <div class="eikon-label">Max</div>' +
        '    <input class="eikon-input" id="temp-edit-max" type="number" step="0.1" value="' + esc(row.max_temp == null ? "" : String(row.max_temp)) + '"/>' +
        "  </div>" +
        '  <div class="eikon-field" style="flex:1;min-width:260px;">' +
        '    <div class="eikon-label">Notes</div>' +
        '    <input class="eikon-input" id="temp-edit-notes" type="text" value="' + esc(row.notes || "") + '"/>' +
        "  </div>" +
        "</div>" +
        '<div class="eikon-help" style="margin-top:10px;">Device is fixed for this row in this simple editor.</div>';

      E.modal.show("Edit Temperature Entry — " + (row.device_name || ""), body, [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Save",
          primary: true,
          onClick: async function () {
            try {
              var d = E.q("#temp-edit-date");
              var mi = E.q("#temp-edit-min");
              var ma = E.q("#temp-edit-max");
              var no = E.q("#temp-edit-notes");

              var payload = {
                device_id: row.device_id,
                entry_date: (d ? d.value : row.entry_date),
                min_temp: (mi ? mi.value : ""),
                max_temp: (ma ? ma.value : ""),
                notes: (no ? no.value : "")
              };

              // Normalize
              if (payload.min_temp === "") payload.min_temp = null;
              else payload.min_temp = Number(payload.min_temp);

              if (payload.max_temp === "") payload.max_temp = null;
              else payload.max_temp = Number(payload.max_temp);

              await E.apiFetch("/temperature/entries", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });

              E.modal.hide();
              // Reload month
              var newMonth = monthInput.value || month;
              state.lastMonth = newMonth;
              var fresh = await loadEntries(newMonth);
              fillTable(fresh);
            } catch (e) {
              E.error("[temp] edit save failed:", e);
              E.modal.show("Save failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
                { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          }
        }
      ]);
    }

    function openDelete(row) {
      E.modal.show("Delete entry?", "<div>Delete <b>" + esc(row.device_name || "") + "</b> on <b>" + esc(row.entry_date || "") + "</b>?</div>", [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Delete",
          danger: true,
          onClick: async function () {
            try {
              await E.apiFetch("/temperature/entries/" + encodeURIComponent(String(row.id)), {
                method: "DELETE"
              });
              E.modal.hide();
              var newMonth = monthInput.value || month;
              state.lastMonth = newMonth;
              var fresh = await loadEntries(newMonth);
              fillTable(fresh);
            } catch (e) {
              E.error("[temp] delete failed:", e);
              E.modal.show("Delete failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
                { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          }
        }
      ]);
    }

    // Events
    monthInput.addEventListener("change", async function () {
      try {
        var m = monthInput.value || month;
        E.dbg("[temp] month change ->", m);
        state.lastMonth = m;
        var fresh = await loadEntries(m);
        fillTable(fresh);
      } catch (e) {
        E.error("[temp] month change load failed:", e);
      }
    });

    refreshBtn.addEventListener("click", async function () {
      try {
        var m = monthInput.value || month;
        E.dbg("[temp] refresh ->", m);
        state.lastMonth = m;
        var fresh = await loadEntries(m);
        fillTable(fresh);
      } catch (e) {
        E.error("[temp] refresh failed:", e);
      }
    });

    printBtn.addEventListener("click", function () {
      E.dbg("[temp] print()");
      try { window.print(); } catch (e) { E.error("[temp] print failed:", e); }
    });

    saveBtn.addEventListener("click", async function () {
      try {
        var dateEl = E.q("#temp-date", mount);
        var devEl = E.q("#temp-device", mount);
        var minEl = E.q("#temp-min", mount);
        var maxEl = E.q("#temp-max", mount);
        var notesEl = E.q("#temp-notes", mount);

        var payload2 = {
          device_id: parseInt(devEl.value, 10),
          entry_date: String(dateEl.value || "").trim(),
          min_temp: (minEl.value === "" ? null : Number(minEl.value)),
          max_temp: (maxEl.value === "" ? null : Number(maxEl.value)),
          notes: String(notesEl.value || "").trim()
        };

        E.dbg("[temp] save payload:", payload2);

        await E.apiFetch("/temperature/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload2)
        });

        // Refresh current month
        var m2 = monthInput.value || month;
        state.lastMonth = m2;
        var fresh2 = await loadEntries(m2);
        fillTable(fresh2);

        // clear inputs
        try { minEl.value = ""; maxEl.value = ""; notesEl.value = ""; } catch (e2) {}
      } catch (e) {
        E.error("[temp] save failed:", e);
        E.modal.show("Save failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      }
    });
  }

  async function renderReport(mount) {
    var today = ymd(new Date());
    var first = today.slice(0, 8) + "01";

    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div style="font-weight:900;margin-bottom:10px;">Temperature Report</div>' +
      '  <div class="eikon-row">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">From</div>' +
      '      <input class="eikon-input" id="temp-from" type="date" value="' + esc(first) + '"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">To</div>' +
      '      <input class="eikon-input" id="temp-to" type="date" value="' + esc(today) + '"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Actions</div>' +
      '      <div class="eikon-row" style="gap:10px;">' +
      '        <button class="eikon-btn primary" id="temp-run">Generate</button>' +
      '        <button class="eikon-btn" id="temp-print-report">Print</button>' +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      '  <div class="eikon-help" style="margin-top:10px;">This uses <code>/temperature/report</code>.</div>' +
      "</div>" +
      '<div class="eikon-card">' +
      '  <div style="font-weight:900;margin-bottom:10px;">Output</div>' +
      '  <div id="temp-report-out" class="eikon-help">No report generated yet.</div>' +
      "</div>";

    var runBtn = E.q("#temp-run", mount);
    var printBtn = E.q("#temp-print-report", mount);
    var out = E.q("#temp-report-out", mount);

    runBtn.addEventListener("click", async function () {
      try {
        var from = E.q("#temp-from", mount).value;
        var to = E.q("#temp-to", mount).value;
        E.dbg("[temp] report generate:", { from: from, to: to });

        var resp = await E.apiFetch("/temperature/report?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to), {
          method: "GET"
        });

        if (!resp || !resp.ok) throw new Error("Report failed");

        var lines = [];
        lines.push("Org: " + (resp.org_name || ""));
        lines.push("Location: " + (resp.location_name || ""));
        lines.push("From: " + from + " To: " + to);
        lines.push("");
        lines.push("Devices: " + (resp.devices ? resp.devices.length : 0));
        lines.push("Entries: " + (resp.entries ? resp.entries.length : 0));
        lines.push("");
        lines.push("Tip: for a formatted printable table, we can enhance this later.");

        out.innerHTML = "<pre style='white-space:pre-wrap;margin:0;background:rgba(0,0,0,.25);padding:12px;border-radius:14px;border:1px solid var(--border);'>" + esc(lines.join("\n")) + "</pre>";
      } catch (e) {
        E.error("[temp] report error:", e);
        out.innerHTML = '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>";
      }
    });

    printBtn.addEventListener("click", function () {
      E.dbg("[temp] print report()");
      try { window.print(); } catch (e) { E.error("[temp] print failed:", e); }
    });
  }

  async function render(ctx) {
    var mount = ctx.mount;
    E.dbg("[temp] render() start");

    // Simple internal tabs: Register + Report
    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row" style="align-items:center;">' +
      '    <div class="eikon-pill" style="font-weight:900;">Temperature</div>' +
      '    <button class="eikon-btn" id="temp-tab-register">Register</button>' +
      '    <button class="eikon-btn" id="temp-tab-report">Report</button>' +
      '    <div class="eikon-help" style="margin-left:auto;">dbg=' + esc(String(E.DEBUG)) + "</div>" +
      "  </div>" +
      "</div>" +
      '<div id="temp-tab-mount"></div>';

    var tabMount = E.q("#temp-tab-mount", mount);
    var btnReg = E.q("#temp-tab-register", mount);
    var btnRep = E.q("#temp-tab-report", mount);

    function setActive(which) {
      btnReg.classList.toggle("primary", which === "register");
      btnRep.classList.toggle("primary", which === "report");
    }

    async function showRegister() {
      setActive("register");
      tabMount.innerHTML = '<div class="eikon-help">Loading temperature register…</div>';

      var devices = await loadDevices();
      var month = state.lastMonth || ym(new Date());
      var entries = await loadEntries(month);
      renderRegister(tabMount, devices, entries, month);
    }

    async function showReport() {
      setActive("report");
      tabMount.innerHTML = "";
      await renderReport(tabMount);
    }

    btnReg.addEventListener("click", function () { showRegister().catch(function (e) { E.error(e); }); });
    btnRep.addEventListener("click", function () { showReport().catch(function (e) { E.error(e); }); });

    // default
    await showRegister();
    E.dbg("[temp] render() done");
  }

  E.registerModule({
    id: "temperature",
    title: "Temperature",
    order: 10,
    icon: "🌡",
    render: render
  });

})();
