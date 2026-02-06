(function () {
  "use strict";

  const E = window.EIKON;
  const el = E.el;

  function pad2(n) { return String(n).padStart(2, "0"); }

  function todayYmd() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function thisMonth() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function clampOneDec(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
  }

  function monthStartEnd(yyyyMm) {
    const m = String(yyyyMm || "").trim();
    const ok = /^\d{4}-\d{2}$/.test(m);
    if (!ok) return null;
    const y = parseInt(m.slice(0, 4), 10);
    const mo = parseInt(m.slice(5, 7), 10) - 1;
    const start = new Date(Date.UTC(y, mo, 1));
    const end = new Date(Date.UTC(y, mo + 1, 1));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  async function openPrintableReport(url) {
    // Works even when the app is inside sandbox if user clicks (user-gesture).
    // If popup is blocked, user can right-click the link in the UI.
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  E.modules.temperature = {
    id: "temperature",
    title: "Temperature",
    subtitle: "Rooms / fridges register",
    icon: "T",
    async render(root, user) {
      const debug = (localStorage.getItem("eikon_debug") === "1");
      function dlog(...args) { if (debug) console.log(...args); }

      dlog("[EIKON][temperature] render() start");

      const state = {
        month: thisMonth(),
        date: todayYmd(),
        devices: [],
        entries: [],
        entryByDeviceId: new Map() // device_id -> entry row for selected date
      };

      const header = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-title" }, "Temperature Register"),
        el("div", { class: "eikon-help" },
          "Your location is fixed to your account. Add devices (rooms/fridges) once, then enter daily temperatures. "
        )
      );

      const monthInput = el("input", { class: "eikon-input", type: "month", value: state.month });
      const dateInput = el("input", { class: "eikon-input", type: "date", value: state.date });

      const btnRefresh = el("button", { class: "eikon-btn" }, "Refresh");
      const btnDevices = el("button", { class: "eikon-btn" }, "Manage Rooms/Fridges");
      const btnPrint = el("button", { class: "eikon-btn eikon-btn-primary" }, "Print Report");

      const controls = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-row" },
          el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Month"), monthInput),
          el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Entry Date"), dateInput),
          el("div", { class: "eikon-field", style: "min-width:140px" }, btnRefresh),
          el("div", { class: "eikon-field", style: "min-width:180px" }, btnDevices),
          el("div", { class: "eikon-field", style: "min-width:160px" }, btnPrint)
        ),
        el("div", { class: "eikon-help", style: "margin-top:10px" },
          "If printing is blocked inside GoDaddy, EIKON opens a printable report in a new tab (from the Worker domain)."
        )
      );

      const entryCard = el("div", { class: "eikon-card" });
      const monthTableCard = el("div", { class: "eikon-card" });

      root.appendChild(header);
      root.appendChild(controls);
      root.appendChild(entryCard);
      root.appendChild(monthTableCard);

      async function loadDevices() {
        dlog("[EIKON][temperature] loadDevices()");
        const out = await E.apiFetch("/temperature/devices", { method: "GET" });
        state.devices = (out && out.devices) ? out.devices : [];
      }

      async function loadEntries() {
        dlog("[EIKON][temperature] loadEntries() month=", state.month);
        const out = await E.apiFetch("/temperature/entries?month=" + encodeURIComponent(state.month), { method: "GET" });
        state.entries = (out && out.entries) ? out.entries : [];
      }

      function rebuildEntryMapForSelectedDate() {
        state.entryByDeviceId.clear();
        for (const e of state.entries) {
          if (e.entry_date === state.date) {
            state.entryByDeviceId.set(Number(e.device_id), e);
          }
        }
      }

      function renderEntryForm() {
        rebuildEntryMapForSelectedDate();

        entryCard.innerHTML = "";
        entryCard.appendChild(el("div", { class: "eikon-title" }, "Enter temperatures for " + state.date));
        entryCard.appendChild(el("div", { class: "eikon-help" }, "Fill values to 1 decimal place. Save per device."));

        if (!state.devices.length) {
          entryCard.appendChild(el("div", { style: "height:10px" }));
          entryCard.appendChild(el("div", { class: "eikon-help" }, "No devices found. Click “Manage Rooms/Fridges” and add at least one."));
          return;
        }

        const wrap = el("div", { class: "eikon-tablewrap", style: "margin-top:10px" });
        const table = el("table", { class: "eikon-table" });
        const thead = el("thead", null,
          el("tr", null,
            el("th", null, "Device"),
            el("th", null, "Type"),
            el("th", null, "Min"),
            el("th", null, "Max"),
            el("th", null, "Notes"),
            el("th", null, "Actions")
          )
        );

        const tbody = el("tbody");

        for (const d of state.devices.filter(x => x.active === 1)) {
          const existing = state.entryByDeviceId.get(Number(d.id)) || null;

          const minInput = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "e.g. 18.5", value: existing && existing.min_temp !== null ? String(existing.min_temp) : "" });
          const maxInput = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "e.g. 23.0", value: existing && existing.max_temp !== null ? String(existing.max_temp) : "" });
          const notesInput = el("input", { class: "eikon-input", type: "text", placeholder: "Optional notes", value: existing ? (existing.notes || "") : "" });

          const btnSave = el("button", { class: "eikon-btn eikon-btn-primary" }, existing ? "Update" : "Save");

          const btnDelete = el("button", { class: "eikon-btn eikon-btn-danger" }, "Delete");
          if (!existing) btnDelete.disabled = true;

          btnSave.addEventListener("click", async () => {
            const payload = {
              device_id: d.id,
              entry_date: state.date,
              min_temp: clampOneDec(minInput.value),
              max_temp: clampOneDec(maxInput.value),
              notes: (notesInput.value || "").trim()
            };

            dlog("[EIKON][temperature] upsert", payload);

            try {
              await E.apiFetch("/temperature/entries", { method: "POST", body: JSON.stringify(payload) });
              E.toast("Saved", d.name + " saved for " + state.date, 2000);
              await refreshAll();
            } catch (err) {
              console.error("[EIKON][temperature] save error", err);
              E.toast("Save failed", err.message || "Unknown error", 4200);
            }
          });

          btnDelete.addEventListener("click", async () => {
            const ok = await E.confirm("Delete entry", "Delete " + d.name + " entry for " + state.date + "?", "Delete", "Cancel");
            if (!ok) return;

            const current = state.entryByDeviceId.get(Number(d.id));
            if (!current || !current.id) {
              E.toast("Nothing to delete", "No entry exists for this device/date.", 2800);
              return;
            }

            try {
              await E.apiFetch("/temperature/entries/" + current.id, { method: "DELETE" });
              E.toast("Deleted", d.name + " entry deleted.", 2000);
              await refreshAll();
            } catch (err) {
              console.error("[EIKON][temperature] delete error", err);
              E.toast("Delete failed", err.message || "Unknown error", 4200);
            }
          });

          tbody.appendChild(
            el("tr", null,
              el("td", null, el("b", null, d.name)),
              el("td", null, d.device_type),
              el("td", null, minInput),
              el("td", null, maxInput),
              el("td", null, notesInput),
              el("td", null, el("div", { class: "eikon-row", style: "gap:8px" }, btnSave, btnDelete))
            )
          );
        }

        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        entryCard.appendChild(wrap);
      }

      function renderMonthTable() {
        monthTableCard.innerHTML = "";
        monthTableCard.appendChild(el("div", { class: "eikon-title" }, "Month Entries (" + state.month + ")"));
        monthTableCard.appendChild(el("div", { class: "eikon-help" }, "This view shows all saved entries for the month."));

        const wrap = el("div", { class: "eikon-tablewrap", style: "margin-top:10px" });
        const table = el("table", { class: "eikon-table" });

        const thead = el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Device"),
            el("th", null, "Min"),
            el("th", null, "Max"),
            el("th", null, "Notes"),
            el("th", null, "Updated")
          )
        );

        const tbody = el("tbody");
        const rows = state.entries.slice().sort((a, b) => {
          if (a.entry_date > b.entry_date) return -1;
          if (a.entry_date < b.entry_date) return 1;
          if (a.device_name > b.device_name) return 1;
          if (a.device_name < b.device_name) return -1;
          return 0;
        });

        for (const r of rows) {
          tbody.appendChild(
            el("tr", null,
              el("td", null, r.entry_date),
              el("td", null, r.device_name),
              el("td", null, r.min_temp === null ? "" : String(r.min_temp)),
              el("td", null, r.max_temp === null ? "" : String(r.max_temp)),
              el("td", null, r.notes || ""),
              el("td", null, (r.updated_at || "").replace("T", " ").slice(0, 16))
            )
          );
        }

        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        monthTableCard.appendChild(wrap);
      }

      async function manageDevices() {
        const out = await E.apiFetch("/temperature/devices?include_inactive=1", { method: "GET" });
        const devices = (out && out.devices) ? out.devices : [];

        // Build modal content
        const list = el("div", null);

        function makeRow(d) {
          const nameInput = el("input", { class: "eikon-input", type: "text", value: d.name || "" });
          const typeSelect = el("select", { class: "eikon-select" },
            el("option", { value: "room" }, "room"),
            el("option", { value: "fridge" }, "fridge"),
            el("option", { value: "other" }, "other")
          );
          typeSelect.value = d.device_type || "other";

          const minInput = el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.min_limit === null || d.min_limit === undefined) ? "" : String(d.min_limit) });
          const maxInput = el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.max_limit === null || d.max_limit === undefined) ? "" : String(d.max_limit) });

          const activeCheck = el("input", { type: "checkbox" });
          activeCheck.checked = (d.active === 1);

          const btnSave = el("button", { class: "eikon-btn eikon-btn-primary" }, "Save");
          btnSave.addEventListener("click", async () => {
            const payload = {
              name: (nameInput.value || "").trim(),
              device_type: typeSelect.value,
              min_limit: minInput.value === "" ? null : Number(minInput.value),
              max_limit: maxInput.value === "" ? null : Number(maxInput.value),
              active: activeCheck.checked
            };
            await E.apiFetch("/temperature/devices/" + d.id, { method: "PUT", body: JSON.stringify(payload) });
            E.toast("Saved", "Device updated.", 2000);
            await refreshAll();
          });

          return el("div", { class: "eikon-card", style: "margin-top:10px" },
            el("div", { class: "eikon-row" },
              el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Name"), nameInput),
              el("div", { class: "eikon-field", style: "min-width:140px" }, el("div", { class: "eikon-label" }, "Type"), typeSelect),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Min limit"), minInput),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Max limit"), maxInput),
              el("div", { class: "eikon-field", style: "min-width:120px" },
                el("div", { class: "eikon-label" }, "Active"),
                el("div", { style: "display:flex; align-items:center; gap:10px; padding:10px 0;" }, activeCheck, el("span", { class: "eikon-help" }, "Enabled"))
              ),
              el("div", { class: "eikon-field", style: "min-width:120px" }, btnSave)
            )
          );
        }

        list.appendChild(el("div", { class: "eikon-help" }, "Add rooms/fridges and rename them as needed. Deactivate to hide from daily entry (history is kept)."));
        for (const d of devices) list.appendChild(makeRow(d));

        // Add-new section
        const newName = el("input", { class: "eikon-input", type: "text", placeholder: "e.g. Main Room / Fridge 1" });
        const newType = el("select", { class: "eikon-select" },
          el("option", { value: "room" }, "room"),
          el("option", { value: "fridge" }, "fridge"),
          el("option", { value: "other" }, "other")
        );
        const newMin = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "optional" });
        const newMax = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "optional" });
        const addBtn = el("button", { class: "eikon-btn eikon-btn-primary" }, "Add Device");
        addBtn.addEventListener("click", async () => {
          const payload = {
            name: (newName.value || "").trim(),
            device_type: newType.value,
            min_limit: newMin.value === "" ? null : Number(newMin.value),
            max_limit: newMax.value === "" ? null : Number(newMax.value)
          };
          if (!payload.name) {
            E.toast("Missing name", "Enter a device name.", 2500);
            return;
          }
          await E.apiFetch("/temperature/devices", { method: "POST", body: JSON.stringify(payload) });
          E.toast("Added", "Device created.", 2000);
          await refreshAll();
        });

        list.appendChild(
          el("div", { class: "eikon-card", style: "margin-top:12px" },
            el("div", { class: "eikon-title" }, "Add new device"),
            el("div", { class: "eikon-row" },
              el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Name"), newName),
              el("div", { class: "eikon-field", style: "min-width:140px" }, el("div", { class: "eikon-label" }, "Type"), newType),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Min limit"), newMin),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Max limit"), newMax),
              el("div", { class: "eikon-field", style: "min-width:120px" }, addBtn)
            )
          )
        );

        // show in modal
        await E.confirm("Manage Rooms/Fridges", "Close this dialog when finished.", "Close", "Close");
        // We can’t render custom body inside E.confirm in this minimal setup.
        // So instead show a dedicated page-like card inside main UI:
        // (We’ll render it in content as a temporary view)
      }

      async function refreshAll() {
        await loadDevices();
        await loadEntries();
        renderEntryForm();
        renderMonthTable();
      }

      monthInput.addEventListener("change", async () => {
        state.month = (monthInput.value || "").trim();
        if (!state.month) return;
        await refreshAll();
      });

      dateInput.addEventListener("change", () => {
        state.date = (dateInput.value || "").trim();
        renderEntryForm();
      });

      btnRefresh.addEventListener("click", async () => {
        await refreshAll();
        E.toast("Refreshed", "Data reloaded.", 1600);
      });

      btnDevices.addEventListener("click", async () => {
        // Instead of using browser confirm/alert (blocked in sandbox), we render device management inline
        // in a temporary card that replaces the month table card.
        monthTableCard.innerHTML = "";
        monthTableCard.appendChild(el("div", { class: "eikon-title" }, "Manage Rooms/Fridges"));
        monthTableCard.appendChild(el("div", { class: "eikon-help" }, "Edit, deactivate, or add devices."));

        const out = await E.apiFetch("/temperature/devices?include_inactive=1", { method: "GET" });
        const devices = (out && out.devices) ? out.devices : [];

        const listWrap = el("div", null);

        function deviceEditor(d) {
          const nameInput = el("input", { class: "eikon-input", type: "text", value: d.name || "" });
          const typeSelect = el("select", { class: "eikon-select" },
            el("option", { value: "room" }, "room"),
            el("option", { value: "fridge" }, "fridge"),
            el("option", { value: "other" }, "other")
          );
          typeSelect.value = d.device_type || "other";

          const minInput = el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.min_limit === null || d.min_limit === undefined) ? "" : String(d.min_limit) });
          const maxInput = el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.max_limit === null || d.max_limit === undefined) ? "" : String(d.max_limit) });

          const active = el("input", { type: "checkbox" });
          active.checked = d.active === 1;

          const saveBtn = el("button", { class: "eikon-btn eikon-btn-primary" }, "Save");
          saveBtn.addEventListener("click", async () => {
            const payload = {
              name: (nameInput.value || "").trim(),
              device_type: typeSelect.value,
              min_limit: minInput.value === "" ? null : Number(minInput.value),
              max_limit: maxInput.value === "" ? null : Number(maxInput.value),
              active: active.checked
            };
            if (!payload.name) {
              E.toast("Name required", "Device name cannot be empty.", 2800);
              return;
            }
            await E.apiFetch("/temperature/devices/" + d.id, { method: "PUT", body: JSON.stringify(payload) });
            E.toast("Saved", "Device updated.", 1600);
            await refreshAll();
          });

          return el("div", { class: "eikon-card", style: "margin-top:10px" },
            el("div", { class: "eikon-row" },
              el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Name"), nameInput),
              el("div", { class: "eikon-field", style: "min-width:140px" }, el("div", { class: "eikon-label" }, "Type"), typeSelect),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Min limit"), minInput),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Max limit"), maxInput),
              el("div", { class: "eikon-field", style: "min-width:110px" },
                el("div", { class: "eikon-label" }, "Active"),
                el("div", { style: "padding:10px 0; display:flex; align-items:center; gap:10px;" }, active, el("span", { class: "eikon-help" }, active.checked ? "Yes" : "No"))
              ),
              el("div", { class: "eikon-field", style: "min-width:120px" }, saveBtn)
            )
          );
        }

        for (const d of devices) listWrap.appendChild(deviceEditor(d));

        // Add new
        const nName = el("input", { class: "eikon-input", type: "text", placeholder: "e.g. Room 2 / Fridge 2" });
        const nType = el("select", { class: "eikon-select" },
          el("option", { value: "room" }, "room"),
          el("option", { value: "fridge" }, "fridge"),
          el("option", { value: "other" }, "other")
        );
        const nMin = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "optional" });
        const nMax = el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "optional" });
        const addBtn = el("button", { class: "eikon-btn eikon-btn-primary" }, "Add");

        addBtn.addEventListener("click", async () => {
          const payload = {
            name: (nName.value || "").trim(),
            device_type: nType.value,
            min_limit: nMin.value === "" ? null : Number(nMin.value),
            max_limit: nMax.value === "" ? null : Number(nMax.value)
          };
          if (!payload.name) {
            E.toast("Missing name", "Enter a device name.", 2400);
            return;
          }
          await E.apiFetch("/temperature/devices", { method: "POST", body: JSON.stringify(payload) });
          E.toast("Added", "Device created.", 1600);
          await refreshAll();
        });

        monthTableCard.appendChild(
          el("div", { class: "eikon-card", style: "margin-top:12px" },
            el("div", { class: "eikon-title" }, "Add device"),
            el("div", { class: "eikon-row" },
              el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Name"), nName),
              el("div", { class: "eikon-field", style: "min-width:140px" }, el("div", { class: "eikon-label" }, "Type"), nType),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Min limit"), nMin),
              el("div", { class: "eikon-field", style: "min-width:120px" }, el("div", { class: "eikon-label" }, "Max limit"), nMax),
              el("div", { class: "eikon-field", style: "min-width:120px" }, addBtn)
            )
          )
        );

        monthTableCard.appendChild(listWrap);
      });

      btnPrint.addEventListener("click", async () => {
        // Ask for date range using custom modal-free UI: we will use prompt-like fields inline.
        const from = state.month + "-01";
        const range = monthStartEnd(state.month);
        const to = range ? new Date(new Date(range.end + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10) : state.date;

        const url = "/temperature/report/html?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
        dlog("[EIKON][temperature] open print", url);
        await openPrintableReport(url);
      });

      await refreshAll();
      dlog("[EIKON][temperature] render() done");
    }
  };
})();
