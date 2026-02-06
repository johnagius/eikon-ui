(function () {
  const E = (window.EIKON = window.EIKON || {});
  E.modules = E.modules || {};
  if (typeof E.registerModule !== "function") {
    E.registerModule = function (k, m) {
      E.modules = E.modules || {};
      E.modules[k] = m || {};
      E._navOrder = E._navOrder || [];
      if (!E._navOrder.includes(k)) E._navOrder.push(k);
    };
  }

  function isYm(s) { return /^\d{4}-\d{2}$/.test(String(s || "").trim()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function isHm(s) { return /^\d{2}:\d{2}$/.test(String(s || "").trim()); }

  function fmtYmdToDisplay(ymd) {
    const s = String(ymd || "");
    if (!isYmd(s)) return s;
    return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
  }

  function clamp1(n) {
    if (n === "" || n === null || n === undefined) return null;
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 10) / 10;
  }

  function buildDayList(fromYmd, toYmd) {
    const out = [];
    if (!isYmd(fromYmd) || !isYmd(toYmd)) return out;
    const start = new Date(fromYmd + "T00:00:00Z");
    const end = new Date(toYmd + "T00:00:00Z");
    if (!(end >= start)) return out;

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      out.push(y + "-" + m + "-" + day);
    }
    return out;
  }

  function groupByMonth(ymdList) {
    const map = {};
    for (const d of ymdList) {
      const ym = d.slice(0, 7);
      if (!map[ym]) map[ym] = [];
      map[ym].push(d);
    }
    return map;
  }

  function openPrintWindow(title, html) {
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      E.modal.alert("Popup blocked", "Your browser blocked the print window. Allow popups for this site, then try again.");
      return;
    }
    w.document.open();
    w.document.write(
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'/>" +
      "<title>" + String(title).replace(/</g, "&lt;") + "</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111}" +
      "h1{margin:0 0 6px 0;font-size:20px}" +
      "h2{margin:18px 0 10px 0;font-size:16px}" +
      ".meta{color:#444;font-size:12px;margin-bottom:10px}" +
      "table{width:100%;border-collapse:collapse;margin-top:10px}" +
      "th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top}" +
      "th{background:#f5f5f5;text-align:left}" +
      ".muted{color:#666}" +
      "</style>" +
      "</head><body>" + html + "</body></html>"
    );
    w.document.close();
    w.focus();
    setTimeout(() => {
      try { w.print(); } catch {}
    }, 250);
  }

  function moduleRender(container, Core) {
    const U = Core.utils;

    const state = {
      tab: "entries", // entries | devices | report
      month: U.toYm(new Date()),
      devices: [],
      entries: [],
      includeInactive: false,
      loading: false,
      form: {
        device_id: "",
        entry_date: U.toYmd(new Date()),
        min_temp: "",
        max_temp: "",
        notes: ""
      },
      report: {
        from: U.toYmd(new Date()),
        to: U.toYmd(new Date())
      }
    };

    function card(titleText) {
      const c = U.el("div", { class: "eikon-card eikon-section" });
      const ci = U.el("div", { class: "eikon-card-inner" });
      if (titleText) ci.appendChild(U.el("div", { style: "font-weight:900;margin-bottom:10px", text: titleText }));
      c.appendChild(ci);
      return { c, ci };
    }

    function setLoading(v) {
      state.loading = !!v;
      render();
    }

    async function loadDevices() {
      const q = state.includeInactive ? "?include_inactive=1" : "";
      const data = await Core.apiFetch("/temperature/devices" + q, { method: "GET" });
      state.devices = (data && data.devices) ? data.devices : [];
    }

    async function loadEntries() {
      const data = await Core.apiFetch("/temperature/entries?month=" + encodeURIComponent(state.month), { method: "GET" });
      state.entries = (data && data.entries) ? data.entries : [];
    }

    async function reloadAll() {
      setLoading(true);
      try {
        await loadDevices();
        await loadEntries();
      } catch (e) {
        Core.modal.alert("Error", e.message || "Failed to load temperature data.");
      } finally {
        setLoading(false);
      }
    }

    async function saveEntry() {
      const f = state.form;
      const deviceId = parseInt(f.device_id, 10);
      const entryDate = String(f.entry_date || "").trim();
      const minTemp = clamp1(f.min_temp);
      const maxTemp = clamp1(f.max_temp);
      const notes = String(f.notes || "").trim();

      if (!deviceId) { Core.modal.alert("Missing", "Select a device."); return; }
      if (!isYmd(entryDate)) { Core.modal.alert("Missing", "Pick a valid date (YYYY-MM-DD)."); return; }

      setLoading(true);
      try {
        await Core.apiFetch("/temperature/entries", {
          method: "POST",
          json: {
            device_id: deviceId,
            entry_date: entryDate,
            min_temp: minTemp,
            max_temp: maxTemp,
            notes
          }
        });

        state.form.notes = "";
        state.form.min_temp = "";
        state.form.max_temp = "";
        await loadEntries();
      } catch (e) {
        Core.modal.alert("Save failed", e.message || "Could not save entry.");
      } finally {
        setLoading(false);
      }
    }

    async function deleteEntry(entryId) {
      const ok = await Core.modal.confirm("Delete entry", "Delete this temperature entry?");
      if (!ok) return;

      setLoading(true);
      try {
        await Core.apiFetch("/temperature/entries/" + encodeURIComponent(String(entryId)), { method: "DELETE" });
        await loadEntries();
      } catch (e) {
        Core.modal.alert("Delete failed", e.message || "Could not delete entry.");
      } finally {
        setLoading(false);
      }
    }

    async function createDevice(payload) {
      setLoading(true);
      try {
        await Core.apiFetch("/temperature/devices", { method: "POST", json: payload });
        await loadDevices();
      } catch (e) {
        Core.modal.alert("Create failed", e.message || "Could not create device.");
      } finally {
        setLoading(false);
      }
    }

    async function updateDevice(deviceId, payload) {
      setLoading(true);
      try {
        await Core.apiFetch("/temperature/devices/" + encodeURIComponent(String(deviceId)), {
          method: "PUT",
          json: payload
        });
        await loadDevices();
        await loadEntries();
      } catch (e) {
        Core.modal.alert("Update failed", e.message || "Could not update device.");
      } finally {
        setLoading(false);
      }
    }

    async function deactivateDevice(deviceId) {
      const ok = await Core.modal.confirm("Deactivate device", "Deactivate this device? (History stays, but it won’t be required.)");
      if (!ok) return;
      await updateDevice(deviceId, { active: false });
    }

    async function printReport() {
      const from = String(state.report.from || "").trim();
      const to = String(state.report.to || "").trim();

      if (!isYmd(from) || !isYmd(to)) {
        Core.modal.alert("Missing", "Choose a valid date range.");
        return;
      }
      if (to < from) {
        Core.modal.alert("Invalid", "To date must be the same or after From date.");
        return;
      }

      setLoading(true);
      try {
        const data = await Core.apiFetch("/temperature/report?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to), { method: "GET" });
        const orgName = (data && data.org_name) ? data.org_name : "Temperature Report";
        const locationName = (data && data.location_name) ? data.location_name : "";
        const devices = (data && data.devices) ? data.devices : [];
        const entries = (data && data.entries) ? data.entries : [];

        const days = buildDayList(from, to);
        const byMonth = groupByMonth(days);

        // map: day -> deviceId -> {min,max}
        const map = {};
        for (const d of days) map[d] = {};
        for (const e of entries) {
          const day = String(e.entry_date || "");
          const did = String(e.device_id || "");
          if (!map[day]) map[day] = {};
          map[day][did] = { min: e.min_temp, max: e.max_temp, notes: e.notes || "" };
        }

        let html = "";
        html += "<h1>" + orgName.replace(/</g, "&lt;") + "</h1>";
        html += "<div class='meta'><b>Location:</b> " + locationName.replace(/</g, "&lt;") + " &nbsp; | &nbsp; <b>From:</b> " + from + " &nbsp; <b>To:</b> " + to + "</div>";
        html += "<div class='muted'>Each cell shows <b>min / max</b> (°C). Temperatures stored to 1 decimal place.</div>";

        const monthKeys = Object.keys(byMonth).sort();
        for (const ym of monthKeys) {
          const label = Core.utils.monthLabel(ym);
          html += "<h2>" + label.replace(/</g, "&lt;") + "</h2>";
          html += "<table><thead><tr><th style='width:110px'>Date</th>";
          for (const dev of devices) {
            html += "<th>" + String(dev.name || ("Device " + dev.id)).replace(/</g, "&lt;") + "</th>";
          }
          html += "</tr></thead><tbody>";

          for (const d of byMonth[ym]) {
            html += "<tr>";
            html += "<td>" + fmtYmdToDisplay(d).replace(/</g, "&lt;") + "</td>";
            for (const dev of devices) {
              const cell = map[d] && map[d][String(dev.id)] ? map[d][String(dev.id)] : null;
              if (!cell) {
                html += "<td class='muted'></td>";
              } else {
                const min = (cell.min === null || cell.min === undefined) ? "" : String(cell.min);
                const max = (cell.max === null || cell.max === undefined) ? "" : String(cell.max);
                const val = (min || max) ? (min + " / " + max) : "";
                html += "<td>" + val.replace(/</g, "&lt;") + "</td>";
              }
            }
            html += "</tr>";
          }

          html += "</tbody></table>";
        }

        openPrintWindow(orgName + " - Temperature", html);
      } catch (e) {
        Core.modal.alert("Print failed", e.message || "Could not build report.");
      } finally {
        setLoading(false);
      }
    }

    function renderTabs(row) {
      const tabs = U.el("div", { class: "eikon-tabs" });

      function tabButton(key, label) {
        const b = U.el("button", { class: "eikon-tab" + (state.tab === key ? " active" : ""), type: "button", text: label });
        b.addEventListener("click", () => { state.tab = key; render(); });
        return b;
      }

      tabs.appendChild(tabButton("entries", "Entries"));
      tabs.appendChild(tabButton("devices", "Devices"));
      tabs.appendChild(tabButton("report", "Print Report"));

      row.appendChild(tabs);
    }

    function renderMonthControls(ci) {
      const row = U.el("div", { class: "eikon-row" });

      const fMonth = U.el("div", { class: "eikon-field" });
      fMonth.appendChild(U.el("label", { text: "Month" }));
      const iMonth = U.el("input", { class: "eikon-input", type: "month", value: state.month });
      iMonth.addEventListener("change", () => {
        const v = String(iMonth.value || "").trim();
        if (isYm(v)) {
          state.month = v;
          reloadAll();
        }
      });
      fMonth.appendChild(iMonth);
      row.appendChild(fMonth);

      const actions = U.el("div", { class: "eikon-row" });
      actions.style.flex = "2 1 360px";
      actions.style.alignItems = "flex-end";

      const prev = U.el("button", { class: "eikon-btn small", type: "button", text: "◀ Prev" });
      prev.addEventListener("click", () => {
        state.month = U.addMonths(state.month, -1);
        iMonth.value = state.month;
        reloadAll();
      });

      const next = U.el("button", { class: "eikon-btn small", type: "button", text: "Next ▶" });
      next.addEventListener("click", () => {
        state.month = U.addMonths(state.month, 1);
        iMonth.value = state.month;
        reloadAll();
      });

      const reload = U.el("button", { class: "eikon-btn small", type: "button", text: "Reload" });
      reload.addEventListener("click", reloadAll);

      actions.appendChild(prev);
      actions.appendChild(next);
      actions.appendChild(reload);

      row.appendChild(actions);

      ci.appendChild(row);
    }

    function renderEntriesTab(ci) {
      // Add/edit form
      const formCard = card("Add / Update temperature entry");
      const f = state.form;

      const row1 = U.el("div", { class: "eikon-row" });

      const fd = U.el("div", { class: "eikon-field" });
      fd.appendChild(U.el("label", { text: "Date" }));
      const iDate = U.el("input", { class: "eikon-input", type: "date", value: f.entry_date });
      iDate.addEventListener("change", () => { f.entry_date = String(iDate.value || "").trim(); });
      fd.appendChild(iDate);

      const fdev = U.el("div", { class: "eikon-field" });
      fdev.appendChild(U.el("label", { text: "Device" }));
      const iDev = U.el("select", { class: "eikon-select" });
      const opt0 = U.el("option", { value: "", text: "Select device…" });
      iDev.appendChild(opt0);

      for (const d of state.devices.filter(x => x.active === 1)) {
        const o = U.el("option", { value: String(d.id), text: String(d.name || ("Device " + d.id)) });
        iDev.appendChild(o);
      }
      iDev.value = f.device_id ? String(f.device_id) : "";
      iDev.addEventListener("change", () => { f.device_id = String(iDev.value || ""); });
      fdev.appendChild(iDev);

      const fmin = U.el("div", { class: "eikon-field" });
      fmin.appendChild(U.el("label", { text: "Min (°C)" }));
      const iMin = U.el("input", { class: "eikon-input", type: "number", step: "0.1", value: f.min_temp });
      iMin.addEventListener("input", () => { f.min_temp = String(iMin.value || ""); });
      fmin.appendChild(iMin);

      const fmax = U.el("div", { class: "eikon-field" });
      fmax.appendChild(U.el("label", { text: "Max (°C)" }));
      const iMax = U.el("input", { class: "eikon-input", type: "number", step: "0.1", value: f.max_temp });
      iMax.addEventListener("input", () => { f.max_temp = String(iMax.value || ""); });
      fmax.appendChild(iMax);

      row1.appendChild(fd);
      row1.appendChild(fdev);
      row1.appendChild(fmin);
      row1.appendChild(fmax);

      const row2 = U.el("div", { class: "eikon-row eikon-section" });
      const fn = U.el("div", { class: "eikon-field", style: "flex: 1 1 100%" });
      fn.appendChild(U.el("label", { text: "Notes (optional)" }));
      const iNotes = U.el("textarea", { class: "eikon-textarea" });
      iNotes.value = f.notes;
      iNotes.addEventListener("input", () => { f.notes = String(iNotes.value || ""); });
      fn.appendChild(iNotes);
      row2.appendChild(fn);

      const row3 = U.el("div", { class: "eikon-row eikon-section" });
      const save = U.el("button", { class: "eikon-btn primary", type: "button", text: state.loading ? "Saving…" : "Save entry" });
      save.disabled = state.loading;
      save.addEventListener("click", saveEntry);

      const hint = U.el("div", { class: "eikon-muted", text: "You can add past dates. Same device+date updates the entry." });
      hint.style.alignSelf = "center";

      row3.appendChild(save);
      row3.appendChild(hint);

      formCard.ci.appendChild(row1);
      formCard.ci.appendChild(row2);
      formCard.ci.appendChild(row3);

      ci.appendChild(formCard.c);

      // List
      const listCard = card("Temperature entries");
      const tw = U.el("div", { class: "eikon-tablewrap" });
      const table = U.el("table", { class: "eikon-table" });
      const thead = U.el("thead");
      const trh = U.el("tr");
      ["Date","Device","Min","Max","Status","Actions"].forEach((h) => trh.appendChild(U.el("th", { text: h })));
      thead.appendChild(trh);

      const tbody = U.el("tbody");

      if (!state.entries || state.entries.length === 0) {
        const tr = U.el("tr");
        const td = U.el("td", { text: "No entries for this month." });
        td.colSpan = 6;
        td.className = "eikon-muted";
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        for (const e of state.entries) {
          const tr = U.el("tr");

          tr.appendChild(U.el("td", { text: fmtYmdToDisplay(e.entry_date) }));
          tr.appendChild(U.el("td", { text: String(e.device_name || ("Device " + e.device_id)) }));

          const min = (e.min_temp === null || e.min_temp === undefined) ? "" : String(e.min_temp);
          const max = (e.max_temp === null || e.max_temp === undefined) ? "" : String(e.max_temp);

          tr.appendChild(U.el("td", { text: min }));
          tr.appendChild(U.el("td", { text: max }));

          // status based on limits if present
          let statusTxt = "OK";
          let statusCls = "eikon-ok";
          const limMin = e.min_limit;
          const limMax = e.max_limit;

          const minNum = (min === "") ? null : Number(min);
          const maxNum = (max === "") ? null : Number(max);

          if (Number.isFinite(limMin) && minNum !== null && Number.isFinite(minNum) && minNum < limMin) {
            statusTxt = "OUT";
            statusCls = "eikon-bad";
          }
          if (Number.isFinite(limMax) && maxNum !== null && Number.isFinite(maxNum) && maxNum > limMax) {
            statusTxt = "OUT";
            statusCls = "eikon-bad";
          }

          tr.appendChild(U.el("td", { class: statusCls, text: statusTxt }));

          const tda = U.el("td", { class: "actions" });

          const del = U.el("button", { class: "eikon-btn small danger", type: "button", text: "Delete" });
          del.addEventListener("click", () => deleteEntry(e.id));

          tda.appendChild(del);
          tr.appendChild(tda);

          tbody.appendChild(tr);
        }
      }

      table.appendChild(thead);
      table.appendChild(tbody);
      tw.appendChild(table);
      listCard.ci.appendChild(tw);

      ci.appendChild(listCard.c);
    }

    function renderDevicesTab(ci) {
      const devCard = card("Devices (rooms / fridges)");
      const rowTop = U.el("div", { class: "eikon-row" });

      const include = U.el("button", {
        class: "eikon-btn small",
        type: "button",
        text: state.includeInactive ? "Hide inactive" : "Show inactive"
      });
      include.addEventListener("click", () => {
        state.includeInactive = !state.includeInactive;
        reloadAll();
      });

      const reload = U.el("button", { class: "eikon-btn small", type: "button", text: "Reload" });
      reload.addEventListener("click", reloadAll);

      rowTop.appendChild(include);
      rowTop.appendChild(reload);

      devCard.ci.appendChild(rowTop);

      // Create form (admin only)
      const u = Core.state.user || {};
      const isAdmin = (u.role === "admin");

      const createCard = U.el("div", { class: "eikon-section" });
      if (isAdmin) {
        const createWrap = U.el("div", { class: "eikon-card-inner", style: "padding:0;margin-top:12px" });

        const cRow = U.el("div", { class: "eikon-row", style: "padding:12px;border:1px solid rgba(255,255,255,.06);border-radius:14px;background:rgba(255,255,255,.02)" });

        const fName = U.el("div", { class: "eikon-field" });
        fName.appendChild(U.el("label", { text: "Name" }));
        const iName = U.el("input", { class: "eikon-input", value: "" });
        fName.appendChild(iName);

        const fType = U.el("div", { class: "eikon-field" });
        fType.appendChild(U.el("label", { text: "Type" }));
        const iType = U.el("select", { class: "eikon-select" });
        ["room","fridge","other"].forEach((t) => iType.appendChild(U.el("option", { value: t, text: t })));
        fType.appendChild(iType);

        const fMin = U.el("div", { class: "eikon-field" });
        fMin.appendChild(U.el("label", { text: "Min limit (optional)" }));
        const iMin = U.el("input", { class: "eikon-input", type: "number", step: "0.1", value: "" });
        fMin.appendChild(iMin);

        const fMax = U.el("div", { class: "eikon-field" });
        fMax.appendChild(U.el("label", { text: "Max limit (optional)" }));
        const iMax = U.el("input", { class: "eikon-input", type: "number", step: "0.1", value: "" });
        fMax.appendChild(iMax);

        const add = U.el("button", { class: "eikon-btn primary", type: "button", text: state.loading ? "Adding…" : "Add device" });
        add.disabled = state.loading;
        add.style.alignSelf = "flex-end";

        add.addEventListener("click", async () => {
          const name = String(iName.value || "").trim();
          const device_type = String(iType.value || "other").trim();
          const min_limit = iMin.value === "" ? null : Number(iMin.value);
          const max_limit = iMax.value === "" ? null : Number(iMax.value);

          if (!name) { Core.modal.alert("Missing", "Device name is required."); return; }
          await createDevice({ name, device_type, min_limit, max_limit });
          iName.value = "";
          iMin.value = "";
          iMax.value = "";
        });

        cRow.appendChild(fName);
        cRow.appendChild(fType);
        cRow.appendChild(fMin);
        cRow.appendChild(fMax);
        cRow.appendChild(add);

        createWrap.appendChild(cRow);
        createCard.appendChild(createWrap);
      } else {
        createCard.appendChild(U.el("div", { class: "eikon-muted eikon-section", text: "Only admins can create or edit devices." }));
      }

      devCard.ci.appendChild(createCard);

      // Table
      const tw = U.el("div", { class: "eikon-tablewrap eikon-section" });
      const table = U.el("table", { class: "eikon-table" });
      const thead = U.el("thead");
      const trh = U.el("tr");
      ["Name","Type","Min limit","Max limit","Active","Actions"].forEach((h) => trh.appendChild(U.el("th", { text: h })));
      thead.appendChild(trh);

      const tbody = U.el("tbody");
      if (!state.devices || state.devices.length === 0) {
        const tr = U.el("tr");
        const td = U.el("td", { text: "No devices found." });
        td.colSpan = 6;
        td.className = "eikon-muted";
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        for (const d of state.devices) {
          const tr = U.el("tr");

          const nameTd = U.el("td");
          const nameIn = U.el("input", { class: "eikon-input", value: String(d.name || "") });
          nameIn.disabled = !isAdmin;
          nameTd.appendChild(nameIn);

          const typeTd = U.el("td");
          const typeSel = U.el("select", { class: "eikon-select" });
          ["room","fridge","other"].forEach((t) => typeSel.appendChild(U.el("option", { value: t, text: t })));
          typeSel.value = String(d.device_type || "other");
          typeSel.disabled = !isAdmin;
          typeTd.appendChild(typeSel);

          const minTd = U.el("td");
          const minIn = U.el("input", {
            class: "eikon-input",
            type: "number",
            step: "0.1",
            value: (d.min_limit === null || d.min_limit === undefined) ? "" : String(d.min_limit)
          });
          minIn.disabled = !isAdmin;
          minTd.appendChild(minIn);

          const maxTd = U.el("td");
          const maxIn = U.el("input", {
            class: "eikon-input",
            type: "number",
            step: "0.1",
            value: (d.max_limit === null || d.max_limit === undefined) ? "" : String(d.max_limit)
          });
          maxIn.disabled = !isAdmin;
          maxTd.appendChild(maxIn);

          tr.appendChild(nameTd);
          tr.appendChild(typeTd);
          tr.appendChild(minTd);
          tr.appendChild(maxTd);

          tr.appendChild(U.el("td", { text: d.active === 1 ? "Yes" : "No", class: d.active === 1 ? "eikon-ok" : "eikon-muted" }));

          const actTd = U.el("td", { class: "actions" });

          if (isAdmin) {
            const save = U.el("button", { class: "eikon-btn small primary", type: "button", text: "Save" });
            save.addEventListener("click", async () => {
              const payload = {
                name: String(nameIn.value || "").trim(),
                device_type: String(typeSel.value || "other").trim(),
                min_limit: minIn.value === "" ? null : Number(minIn.value),
                max_limit: maxIn.value === "" ? null : Number(maxIn.value),
                active: d.active === 1
              };
              if (!payload.name) { Core.modal.alert("Missing", "Name cannot be empty."); return; }
              await updateDevice(d.id, payload);
            });

            const deact = U.el("button", { class: "eikon-btn small danger", type: "button", text: d.active === 1 ? "Deactivate" : "Deactivated" });
            deact.disabled = d.active !== 1;
            deact.addEventListener("click", () => deactivateDevice(d.id));

            actTd.appendChild(save);
            actTd.appendChild(deact);
          } else {
            actTd.appendChild(U.el("div", { class: "eikon-muted", text: "—" }));
          }

          tr.appendChild(actTd);

          tbody.appendChild(tr);
        }
      }

      table.appendChild(thead);
      table.appendChild(tbody);
      tw.appendChild(table);
      devCard.ci.appendChild(tw);

      ci.appendChild(devCard.c);
    }

    function renderReportTab(ci) {
      const rep = card("Print report (date range)");
      const row = U.el("div", { class: "eikon-row" });

      const fFrom = U.el("div", { class: "eikon-field" });
      fFrom.appendChild(U.el("label", { text: "From" }));
      const iFrom = U.el("input", { class: "eikon-input", type: "date", value: state.report.from });
      iFrom.addEventListener("change", () => { state.report.from = String(iFrom.value || "").trim(); });
      fFrom.appendChild(iFrom);

      const fTo = U.el("div", { class: "eikon-field" });
      fTo.appendChild(U.el("label", { text: "To" }));
      const iTo = U.el("input", { class: "eikon-input", type: "date", value: state.report.to });
      iTo.addEventListener("change", () => { state.report.to = String(iTo.value || "").trim(); });
      fTo.appendChild(iTo);

      const btn = U.el("button", { class: "eikon-btn primary", type: "button", text: state.loading ? "Preparing…" : "Print report" });
      btn.disabled = state.loading;
      btn.style.alignSelf = "flex-end";
      btn.addEventListener("click", printReport);

      row.appendChild(fFrom);
      row.appendChild(fTo);
      row.appendChild(btn);

      rep.ci.appendChild(row);
      rep.ci.appendChild(U.el("div", { class: "eikon-muted eikon-section", text: "Report is split by month. Columns are your devices. Each cell shows min/max." }));

      ci.appendChild(rep.c);
    }

    function render() {
      container.innerHTML = "";

      const topCard = card("");
      const topRow = U.el("div", { class: "eikon-row" });
      renderTabs(topRow);
      topCard.ci.appendChild(topRow);

      renderMonthControls(topCard.ci);

      container.appendChild(topCard.c);

      if (state.tab === "entries") {
        renderEntriesTab(container);
      } else if (state.tab === "devices") {
        renderDevicesTab(container);
      } else if (state.tab === "report") {
        renderReportTab(container);
      }
    }

    // Initial load
    reloadAll().then(render).catch(render);
  }

  E.registerModule("temperature", {
    title: "Temperature",
    subtitle: "Daily min/max logging",
    icon: "🌡️",
    render: moduleRender
  });

})();
