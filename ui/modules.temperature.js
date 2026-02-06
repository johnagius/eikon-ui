/* ui/modules.temperature.js
   Temperature register + devices + report printing
   Works with EIKON core.js + Worker endpoints:
     GET    /temperature/devices
     POST   /temperature/devices
     PUT    /temperature/devices/:id
     GET    /temperature/entries?month=YYYY-MM
     POST   /temperature/entries
     DELETE /temperature/entries/:id
     GET    /temperature/report?from=YYYY-MM-DD&to=YYYY-MM-DD
*/

(function () {
  "use strict";

  if (!window.EIKON || !window.EIKON.util) return;

  const E = window.EIKON;
  const el = E.util.el;
  const apiFetch = E.util.apiFetch;
  const toast = E.util.toast;
  const modalConfirm = E.util.modalConfirm;

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function ymdTodayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function ymNowLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function isValidYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function clampOneDecimal(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function openPrintTabWithHtml(html, title) {
    try {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) {
        toast("Popup blocked", "Allow popups to print.");
        return;
      }
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (_) {}
      }, 60000);
    } catch (e) {
      toast("Print error", e && (e.message || String(e)) ? (e.message || String(e)) : "Could not open print tab.");
    }
  }

  function statusClassForReading(device, entry) {
    // If limits are missing/null, treat as neutral/ok
    const minLimit = device && device.min_limit !== undefined ? device.min_limit : null;
    const maxLimit = device && device.max_limit !== undefined ? device.max_limit : null;

    const min = entry && entry.min_temp !== undefined ? entry.min_temp : null;
    const max = entry && entry.max_temp !== undefined ? entry.max_temp : null;

    if (min === null || min === undefined || max === null || max === undefined) return "warn";
    if (minLimit !== null && minLimit !== undefined && Number.isFinite(Number(minLimit)) && min < Number(minLimit)) return "bad";
    if (maxLimit !== null && maxLimit !== undefined && Number.isFinite(Number(maxLimit)) && max > Number(maxLimit)) return "bad";
    return "ok";
  }

  function fmtTemp(v) {
    if (v === null || v === undefined) return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    // Keep one decimal if needed
    return (Math.round(n * 10) / 10).toString();
  }

  function buildReportHtml(payload) {
    const orgName = escapeHtml(payload.org_name || "");
    const locName = escapeHtml(payload.location_name || "");
    const from = escapeHtml(payload.from || "");
    const to = escapeHtml(payload.to || "");

    const devices = Array.isArray(payload.devices) ? payload.devices : [];
    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    // Index device by id for limits + display
    const devById = {};
    for (const d of devices) devById[String(d.id)] = d;

    const rowsHtml = entries.map((e) => {
      const dev = devById[String(e.device_id)] || null;
      const devName = escapeHtml(dev ? dev.name : `Device #${e.device_id}`);
      const devType = escapeHtml(dev ? dev.device_type : "");
      const limits = dev
        ? `${fmtTemp(dev.min_limit)}–${fmtTemp(dev.max_limit)}`
        : "";
      const limEsc = escapeHtml(limits);

      const status = statusClassForReading(dev, e);
      const min = escapeHtml(fmtTemp(e.min_temp));
      const max = escapeHtml(fmtTemp(e.max_temp));
      const notes = escapeHtml(e.notes || "");
      const date = escapeHtml(e.entry_date || "");

      return `
        <tr>
          <td>${date}</td>
          <td>${devName}</td>
          <td>${devType}</td>
          <td>${limEsc}</td>
          <td>${min}</td>
          <td>${max}</td>
          <td>
            <span class="pill ${status}">
              <span class="dot ${status}"></span>
              ${status.toUpperCase()}
            </span>
          </td>
          <td>${notes}</td>
        </tr>
      `;
    }).join("");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Temperature Report ${from} to ${to}</title>
<style>
  :root{ --ok:#1f9d55; --warn:#c0841a; --bad:#d64545; }
  body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color:#111; }
  h1{ margin:0 0 6px 0; font-size: 20px; }
  .sub{ color:#444; margin:0 0 18px 0; }
  table{ width:100%; border-collapse:collapse; font-size: 12px; }
  th, td{ border:1px solid #222; padding: 8px 8px; vertical-align: top; }
  th{ background:#f2f2f2; text-align:left; }
  .pill{ display:inline-flex; align-items:center; gap:6px; padding: 2px 8px; border-radius: 999px; font-weight: 800; font-size: 11px; border:1px solid #bbb; }
  .dot{ width:10px; height:10px; border-radius: 999px; display:inline-block; }
  .dot.ok{ background: var(--ok); }
  .dot.warn{ background: var(--warn); }
  .dot.bad{ background: var(--bad); }
  .pill.ok{ border-color: var(--ok); }
  .pill.warn{ border-color: var(--warn); }
  .pill.bad{ border-color: var(--bad); }
  .actions{ margin: 14px 0 0 0; display:flex; gap:10px; }
  button{ padding: 10px 12px; border: 1px solid #111; background:#111; color:#fff; border-radius: 10px; font-weight: 800; cursor:pointer; }
  button.secondary{ background:#fff; color:#111; }
  @media print{
    .actions{ display:none; }
    body{ margin: 0; }
  }
</style>
</head>
<body>
  <h1>Temperature Report</h1>
  <p class="sub"><b>${orgName}</b> — ${locName}<br/>Range: <b>${from}</b> to <b>${to}</b></p>

  <div class="actions">
    <button onclick="window.print()">Print</button>
    <button class="secondary" onclick="window.close()">Close</button>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Device</th>
        <th>Type</th>
        <th>Limits</th>
        <th>Min</th>
        <th>Max</th>
        <th>Status</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || `<tr><td colspan="8">No entries in this range.</td></tr>`}
    </tbody>
  </table>

  <script>
    // Auto-trigger print shortly after load (works because this page is NOT sandboxed)
    setTimeout(function(){ try{ window.print(); }catch(e){} }, 400);
  </script>
</body>
</html>`;

    return html;
  }

  E.modules = E.modules || {};

  E.modules.temperature = {
    key: "temperature",
    title: "Temperature",

    render: function (root) {
      root.innerHTML = "";

      const state = {
        tab: "register",
        month: ymNowLocal(),
        devices: [],
        entries: [],
        editingEntry: null
      };

      const header = el("div", { class: "eikon-topbar" },
        el("div", { class: "eikon-title" }, "Temperature"),
        el("div", { class: "eikon-top-actions no-print" })
      );

      const card = el("div", { class: "eikon-card" });

      const tabs = el("div", { class: "eikon-tabs no-print" });
      const tabRegister = el("button", { class: "eikon-tab active", type: "button" }, "Register");
      const tabDevices = el("button", { class: "eikon-tab", type: "button" }, "Devices");
      const tabReport = el("button", { class: "eikon-tab", type: "button" }, "Report / Print");
      tabs.appendChild(tabRegister);
      tabs.appendChild(tabDevices);
      tabs.appendChild(tabReport);

      const body = el("div");

      card.appendChild(tabs);
      card.appendChild(body);

      root.appendChild(header);
      root.appendChild(card);

      function setActiveTab(name) {
        state.tab = name;
        tabRegister.classList.toggle("active", name === "register");
        tabDevices.classList.toggle("active", name === "devices");
        tabReport.classList.toggle("active", name === "report");
        renderTab();
      }

      tabRegister.addEventListener("click", () => setActiveTab("register"));
      tabDevices.addEventListener("click", () => setActiveTab("devices"));
      tabReport.addEventListener("click", () => setActiveTab("report"));

      async function loadDevices() {
        const res = await apiFetch("/temperature/devices", { method: "GET" }, true);
        state.devices = Array.isArray(res.devices) ? res.devices : [];
      }

      async function loadEntries() {
        const res = await apiFetch(`/temperature/entries?month=${encodeURIComponent(state.month)}`, { method: "GET" }, true);
        state.entries = Array.isArray(res.entries) ? res.entries : [];
      }

      function deviceOptions(selectedId) {
        const opts = [];
        opts.push(el("option", { value: "" }, "Select device..."));
        for (const d of state.devices) {
          const o = el("option", { value: String(d.id) }, `${d.name} (${d.device_type})`);
          if (String(d.id) === String(selectedId)) o.selected = true;
          opts.push(o);
        }
        return opts;
      }

      function renderRegister() {
        body.innerHTML = "";

        const monthField = el("div", { class: "eikon-field" },
          el("div", { class: "eikon-label" }, "Month"),
          el("input", { class: "eikon-input", type: "month", value: state.month })
        );

        const monthInput = monthField.querySelector("input");
        monthInput.addEventListener("change", async () => {
          state.month = String(monthInput.value || "").trim() || ymNowLocal();
          await reloadRegister();
        });

        const formTitle = el("div", { style: "font-weight:900; margin-bottom: 8px;" }, state.editingEntry ? "Edit entry" : "New entry");

        const dateInput = el("input", { class: "eikon-input", type: "date", value: state.editingEntry ? state.editingEntry.entry_date : ymdTodayLocal() });
        const devSelect = el("select", { class: "eikon-select" }, ...deviceOptions(state.editingEntry ? state.editingEntry.device_id : ""));
        const minInput = el("input", { class: "eikon-input", type: "number", step: "0.1", inputmode: "decimal", value: state.editingEntry ? fmtTemp(state.editingEntry.min_temp) : "" });
        const maxInput = el("input", { class: "eikon-input", type: "number", step: "0.1", inputmode: "decimal", value: state.editingEntry ? fmtTemp(state.editingEntry.max_temp) : "" });
        const notesInput = el("textarea", { class: "eikon-textarea", rows: "2", placeholder: "Optional notes..." }, state.editingEntry ? (state.editingEntry.notes || "") : "");

        const saveBtn = el("button", { class: "eikon-btn primary", type: "button" }, state.editingEntry ? "Save changes" : "Save entry");
        const cancelBtn = el("button", { class: "eikon-btn", type: "button" }, "Cancel edit");
        cancelBtn.style.display = state.editingEntry ? "" : "none";

        cancelBtn.addEventListener("click", async () => {
          state.editingEntry = null;
          renderRegister();
        });

        saveBtn.addEventListener("click", async () => {
          const entryDate = String(dateInput.value || "").trim();
          const deviceId = parseInt(String(devSelect.value || "").trim(), 10);
          const minTemp = clampOneDecimal(minInput.value);
          const maxTemp = clampOneDecimal(maxInput.value);
          const notes = String(notesInput.value || "").trim();

          if (!isValidYmd(entryDate)) {
            toast("Validation", "Invalid date (YYYY-MM-DD).");
            return;
          }
          if (!deviceId) {
            toast("Validation", "Select a device.");
            return;
          }
          if (minTemp === null || maxTemp === null) {
            toast("Validation", "Enter min and max temperature.");
            return;
          }

          await apiFetch("/temperature/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              device_id: deviceId,
              entry_date: entryDate,
              min_temp: minTemp,
              max_temp: maxTemp,
              notes: notes
            })
          }, true);

          toast("Saved", "Temperature entry saved.");
          state.editingEntry = null;

          // Keep month aligned with selected date
          const ym = entryDate.slice(0, 7);
          state.month = ym;
          monthInput.value = ym;

          await reloadRegister();
        });

        const form = el("div", { class: "eikon-card", style: "margin-bottom: 14px;" },
          formTitle,
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" },
                el("div", { class: "eikon-label" }, "Date"),
                dateInput
              )
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" },
                el("div", { class: "eikon-label" }, "Device"),
                devSelect
              )
            )
          ),
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" },
                el("div", { class: "eikon-label" }, "Min °C"),
                minInput
              )
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" },
                el("div", { class: "eikon-label" }, "Max °C"),
                maxInput
              )
            )
          ),
          el("div", { class: "eikon-field" },
            el("div", { class: "eikon-label" }, "Notes"),
            notesInput
          ),
          el("div", { class: "eikon-row no-print" },
            saveBtn,
            cancelBtn
          )
        );

        const help = el("div", { class: "eikon-help eikon-muted", style: "margin: 6px 0 10px 0;" },
          "Tip: click Edit on a row to load it into the form. Saving uses upsert (same date + device updates)."
        );

        const tableWrap = el("div", { class: "eikon-tablewrap" });
        const table = el("table", { class: "eikon-table" });
        table.appendChild(el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Device"),
            el("th", null, "Min"),
            el("th", null, "Max"),
            el("th", null, "Status"),
            el("th", null, "Notes"),
            el("th", null, "Updated"),
            el("th", { class: "no-print" }, "Actions")
          )
        ));

        const tbody = el("tbody");
        table.appendChild(tbody);
        tableWrap.appendChild(table);

        function renderRows() {
          tbody.innerHTML = "";

          // Index devices
          const devById = {};
          for (const d of state.devices) devById[String(d.id)] = d;

          if (!state.entries.length) {
            tbody.appendChild(el("tr", null,
              el("td", { colSpan: 8 }, "No entries for this month.")
            ));
            return;
          }

          for (const e of state.entries) {
            const dev = devById[String(e.device_id)] || {
              id: e.device_id,
              name: e.device_name || `Device #${e.device_id}`,
              device_type: e.device_type || "",
              min_limit: e.min_limit,
              max_limit: e.max_limit
            };

            const st = statusClassForReading(dev, e);

            const editBtn = el("button", { class: "eikon-btn", type: "button" }, "Edit");
            const delBtn = el("button", { class: "eikon-btn danger", type: "button" }, "Delete");

            editBtn.addEventListener("click", () => {
              state.editingEntry = {
                id: e.id,
                entry_date: e.entry_date,
                device_id: e.device_id,
                min_temp: e.min_temp,
                max_temp: e.max_temp,
                notes: e.notes || ""
              };
              renderRegister();
            });

            delBtn.addEventListener("click", async () => {
              const ok = await modalConfirm("Delete temperature entry?", "This cannot be undone.");
              if (!ok) return;
              await apiFetch(`/temperature/entries/${encodeURIComponent(String(e.id))}`, { method: "DELETE" }, true);
              toast("Deleted", "Entry removed.");
              await reloadRegister();
            });

            const actionsCell = el("td", { class: "no-print" }, el("div", { class: "eikon-row", style: "gap:10px;" }, editBtn, delBtn));

            tbody.appendChild(el("tr", null,
              el("td", null, e.entry_date || ""),
              el("td", null, `${dev.name}${dev.device_type ? " (" + dev.device_type + ")" : ""}`),
              el("td", null, fmtTemp(e.min_temp)),
              el("td", null, fmtTemp(e.max_temp)),
              el("td", null,
                el("span", { class: "eikon-pill" },
                  el("span", { class: `eikon-dot ${st}` }),
                  st.toUpperCase()
                )
              ),
              el("td", null, e.notes || ""),
              el("td", null, (e.updated_at || e.created_at || "") ? String(e.updated_at || e.created_at).replace("T", " ").slice(0, 16) : ""),
              actionsCell
            ));
          }
        }

        body.appendChild(monthField);
        body.appendChild(form);
        body.appendChild(help);
        body.appendChild(tableWrap);

        renderRows();

        async function reloadRegister() {
          await loadDevices();
          await loadEntries();
          renderRegister();
        }

        // Expose for outer calls
        renderRegister.reload = reloadRegister;
      }

      function renderDevices() {
        body.innerHTML = "";

        const createName = el("input", { class: "eikon-input", placeholder: "Device name" });
        const createType = el("select", { class: "eikon-select" },
          el("option", { value: "room" }, "room"),
          el("option", { value: "fridge" }, "fridge"),
          el("option", { value: "other" }, "other")
        );
        const createMin = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "Min limit" });
        const createMax = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "Max limit" });
        const createBtn = el("button", { class: "eikon-btn primary", type: "button" }, "Add device");

        createBtn.addEventListener("click", async () => {
          const name = String(createName.value || "").trim();
          const deviceType = String(createType.value || "").trim() || "other";
          const minLimit = createMin.value === "" ? null : Number(createMin.value);
          const maxLimit = createMax.value === "" ? null : Number(createMax.value);

          if (!name) { toast("Validation", "Enter a device name."); return; }
          await apiFetch("/temperature/devices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, device_type: deviceType, min_limit: minLimit, max_limit: maxLimit })
          }, true);

          toast("Created", "Device added.");
          createName.value = "";
          createMin.value = "";
          createMax.value = "";
          await loadDevices();
          renderDevices();
        });

        const createCard = el("div", { class: "eikon-card", style: "margin-bottom: 14px;" },
          el("div", { style: "font-weight:900; margin-bottom: 8px;" }, "Add device"),
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Name"), createName)
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Type"), createType)
            )
          ),
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Min limit"), createMin)
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Max limit"), createMax)
            )
          ),
          el("div", { class: "eikon-row no-print" }, createBtn)
        );

        const tableWrap = el("div", { class: "eikon-tablewrap" });
        const table = el("table", { class: "eikon-table" });
        const tbody = el("tbody");

        table.appendChild(el("thead", null,
          el("tr", null,
            el("th", null, "Name"),
            el("th", null, "Type"),
            el("th", null, "Min"),
            el("th", null, "Max"),
            el("th", null, "Active"),
            el("th", null, "Actions")
          )
        ));
        table.appendChild(tbody);
        tableWrap.appendChild(table);

        for (const d of state.devices) {
          const name = el("input", { class: "eikon-input", value: d.name || "" });
          const type = el("select", { class: "eikon-select" },
            el("option", { value: "room" }, "room"),
            el("option", { value: "fridge" }, "fridge"),
            el("option", { value: "other" }, "other")
          );
          type.value = d.device_type || "other";

          const min = el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.min_limit === null || d.min_limit === undefined) ? "" : String(d.min_limit) });
          const max = el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.max_limit === null || d.max_limit === undefined) ? "" : String(d.max_limit) });

          const active = el("select", { class: "eikon-select" },
            el("option", { value: "1" }, "Yes"),
            el("option", { value: "0" }, "No")
          );
          active.value = String(d.active ? 1 : 0);

          const save = el("button", { class: "eikon-btn ok", type: "button" }, "Save");
          save.addEventListener("click", async () => {
            const newName = String(name.value || "").trim();
            const newType = String(type.value || "").trim();
            const newMin = min.value === "" ? null : Number(min.value);
            const newMax = max.value === "" ? null : Number(max.value);
            const newActive = active.value === "1";

            if (!newName) { toast("Validation", "Name cannot be empty."); return; }

            await apiFetch(`/temperature/devices/${encodeURIComponent(String(d.id))}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: newName,
                device_type: newType,
                min_limit: newMin,
                max_limit: newMax,
                active: newActive
              })
            }, true);

            toast("Saved", "Device updated.");
            await loadDevices();
            renderDevices();
          });

          tbody.appendChild(el("tr", null,
            el("td", null, name),
            el("td", null, type),
            el("td", null, min),
            el("td", null, max),
            el("td", null, active),
            el("td", null, save)
          ));
        }

        body.appendChild(createCard);
        body.appendChild(tableWrap);
      }

      function renderReport() {
        body.innerHTML = "";

        const fromInput = el("input", { class: "eikon-input", type: "date", value: ymdTodayLocal() });
        const toInput = el("input", { class: "eikon-input", type: "date", value: ymdTodayLocal() });
        const runBtn = el("button", { class: "eikon-btn primary", type: "button" }, "Generate");
        const printBtn = el("button", { class: "eikon-btn", type: "button", disabled: true }, "Print");

        const tableWrap = el("div", { class: "eikon-tablewrap" });
        const table = el("table", { class: "eikon-table" });
        const tbody = el("tbody");

        table.appendChild(el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Device"),
            el("th", null, "Min"),
            el("th", null, "Max"),
            el("th", null, "Notes")
          )
        ));
        table.appendChild(tbody);
        tableWrap.appendChild(table);

        let lastReportPayload = null;

        runBtn.addEventListener("click", async () => {
          const from = String(fromInput.value || "").trim();
          const to = String(toInput.value || "").trim();
          if (!isValidYmd(from) || !isValidYmd(to)) { toast("Validation", "Pick valid from/to dates."); return; }
          if (to < from) { toast("Validation", "To must be >= From."); return; }

          const payload = await apiFetch(`/temperature/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "GET" }, true);
          lastReportPayload = payload;
          printBtn.disabled = false;

          const entries = Array.isArray(payload.entries) ? payload.entries : [];
          const devById = {};
          for (const d of (Array.isArray(payload.devices) ? payload.devices : [])) devById[String(d.id)] = d;

          tbody.innerHTML = "";
          if (!entries.length) {
            tbody.appendChild(el("tr", null, el("td", { colSpan: 5 }, "No entries in this range.")));
            return;
          }

          for (const e of entries) {
            const dev = devById[String(e.device_id)] || null;
            const devName = dev ? dev.name : `Device #${e.device_id}`;
            tbody.appendChild(el("tr", null,
              el("td", null, e.entry_date || ""),
              el("td", null, devName),
              el("td", null, fmtTemp(e.min_temp)),
              el("td", null, fmtTemp(e.max_temp)),
              el("td", null, e.notes || "")
            ));
          }
        });

        printBtn.addEventListener("click", () => {
          if (!lastReportPayload) return;
          const html = buildReportHtml(lastReportPayload);
          openPrintTabWithHtml(html, "Temperature Report");
        });

        const controls = el("div", { class: "eikon-card", style: "margin-bottom: 14px;" },
          el("div", { style: "font-weight:900; margin-bottom: 8px;" }, "Report"),
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "From"), fromInput)
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "To"), toInput)
            )
          ),
          el("div", { class: "eikon-row no-print" }, runBtn, printBtn),
          el("div", { class: "eikon-help" }, "Print opens a new tab to avoid iframe sandbox restrictions.")
        );

        body.appendChild(controls);
        body.appendChild(tableWrap);
      }

      function renderTab() {
        if (state.tab === "register") return renderRegister();
        if (state.tab === "devices") return renderDevices();
        if (state.tab === "report") return renderReport();
      }

      async function initialLoad() {
        try {
          await loadDevices();
          await loadEntries();
          renderTab();
        } catch (e) {
          // core.js already toasts errors; keep UI alive
          renderTab();
        }
      }

      async function reloadRegister() {
        await loadDevices();
        await loadEntries();
        renderRegister();
      }

      // Kickoff
      setActiveTab("register");
      initialLoad();

      // Allow register reload to be called from within
      if (renderRegister.reload) renderRegister.reload = reloadRegister;
    }
  };
})();
