(function () {
  const E = window.EIKON;
  if (!E) return;

  function fmt1(n) {
    if (n === null || n === undefined) return "";
    const v = Number(n);
    if (!Number.isFinite(v)) return "";
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  function parseNum(n) {
    const s = String(n || "").trim();
    if (!s) return null;
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 10) / 10;
  }

  function ymdToMonth(ymd) {
    return E.util.monthFromYmd(ymd);
  }

  function groupEntriesByDate(entries) {
    const map = {};
    for (const e of entries) {
      if (!map[e.entry_date]) map[e.entry_date] = [];
      map[e.entry_date].push(e);
    }
    return map;
  }

  function statusDot(minTemp, maxTemp, minLimit, maxLimit) {
    const minT = (minTemp === null || minTemp === undefined) ? null : Number(minTemp);
    const maxT = (maxTemp === null || maxTemp === undefined) ? null : Number(maxTemp);
    const minL = (minLimit === null || minLimit === undefined) ? null : Number(minLimit);
    const maxL = (maxLimit === null || maxLimit === undefined) ? null : Number(maxLimit);

    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return { cls: "", label: "Missing" };

    let out = false;
    if (Number.isFinite(minL) && minT < minL) out = true;
    if (Number.isFinite(maxL) && maxT > maxL) out = true;

    if (out) return { cls: "bad", label: "Out of limit" };
    return { cls: "ok", label: "OK" };
  }

  function monthKeyFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function parseYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return null;
    const [y, m, d] = s.split("-").map(n => parseInt(n, 10));
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== (m - 1) || dt.getDate() !== d) return null;
    return dt;
  }

  function buildPrintHtml(data) {
    const org = String(data.org_name || "");
    const loc = String(data.location_name || "");
    const from = String(data.from || "");
    const to = String(data.to || "");
    const devices = Array.isArray(data.devices) ? data.devices : [];
    const entries = Array.isArray(data.entries) ? data.entries : [];

    const mapByDate = {};
    for (const e of entries) {
      const ed = String(e.entry_date || "");
      const did = String(e.device_id || "");
      if (!mapByDate[ed]) mapByDate[ed] = {};
      mapByDate[ed][did] = e;
    }

    const fromDt = parseYmd(from);
    const toDt = parseYmd(to);
    const days = [];

    if (fromDt && toDt) {
      const cur = new Date(fromDt.getFullYear(), fromDt.getMonth(), fromDt.getDate());
      const end = new Date(toDt.getFullYear(), toDt.getMonth(), toDt.getDate());
      while (cur <= end) {
        const ymd = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
        days.push(ymd);
        cur.setDate(cur.getDate() + 1);
      }
    }

    const byMonth = {};
    for (const ymd of days) {
      const dt = parseYmd(ymd);
      const mk = dt ? monthKeyFromDate(dt) : ymd.slice(0, 7);
      if (!byMonth[mk]) byMonth[mk] = [];
      byMonth[mk].push(ymd);
    }

    const months = Object.keys(byMonth);

    function esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c]));
    }

    function cellFor(ymd, devId) {
      const e = (mapByDate[ymd] && mapByDate[ymd][String(devId)]) ? mapByDate[ymd][String(devId)] : null;
      if (!e) return "";
      return `${fmt1(e.min_temp)} / ${fmt1(e.max_temp)}`;
    }

    let tables = "";

    for (const mk of months) {
      let thead = `<tr><th style="text-align:left;">${esc(mk)}</th>`;
      for (const d of devices) {
        thead += `<th style="text-align:left;">${esc(d.name || "")}</th>`;
      }
      thead += `</tr>`;

      let tbody = "";
      for (const ymd of byMonth[mk]) {
        let tr = `<tr><td style="white-space:nowrap;">${esc(ymd)}</td>`;
        for (const d of devices) {
          tr += `<td>${esc(cellFor(ymd, d.id))}</td>`;
        }
        tr += `</tr>`;
        tbody += tr;
      }

      tables += `
        <h2>${esc(mk)}</h2>
        <table>
          <thead>${thead}</thead>
          <tbody>${tbody}</tbody>
        </table>
      `;
    }

    const title = loc ? `${org} - ${loc}` : org;

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} - Temperature Report</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin:24px; color:#000;}
  h1{margin:0 0 6px 0; font-size:22px;}
  .sub{margin:0 0 18px 0; color:#333; font-size:13px;}
  h2{margin:20px 0 8px 0; font-size:16px;}
  table{width:100%; border-collapse:collapse; margin:0 0 14px 0; table-layout:fixed;}
  th,td{border:1px solid #000; padding:8px 8px; vertical-align:top; font-size:12px; word-wrap:break-word;}
  th{background:#f2f2f2; font-size:11px; text-transform:uppercase; letter-spacing:0.6px;}
  @media print{
    body{margin:12mm;}
    h1{font-size:18px;}
    .sub{font-size:12px;}
    h2{page-break-after:avoid;}
    table{page-break-inside:avoid;}
  }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p class="sub">Temperature Report • ${esc(from)} to ${esc(to)}</p>
  ${tables}
<script>
  window.addEventListener('load', function(){
    setTimeout(function(){
      try{ window.focus(); }catch(e){}
      try{ window.print(); }catch(e){}
    }, 80);
  });
  window.addEventListener('afterprint', function(){
    setTimeout(function(){
      try{ window.close(); }catch(e){}
    }, 250);
  });
</script>
</body>
</html>`;
  }

  function openPrintTabWithHtml(html) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 60000);
  }

  function renderReportPreviewHtml(data) {
    const org = data.org_name || "";
    const loc = data.location_name || "";
    const from = data.from;
    const to = data.to;

    const devices = data.devices || [];
    const entries = data.entries || [];

    const mapByDate = {};
    for (const e of entries) {
      if (!mapByDate[e.entry_date]) mapByDate[e.entry_date] = {};
      mapByDate[e.entry_date][String(e.device_id)] = e;
    }

    const fromDt = parseYmd(from);
    const toDt = parseYmd(to);
    const days = [];

    if (fromDt && toDt) {
      const cur = new Date(fromDt.getFullYear(), fromDt.getMonth(), fromDt.getDate());
      const end = new Date(toDt.getFullYear(), toDt.getMonth(), toDt.getDate());
      while (cur <= end) {
        const ymd = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
        days.push(ymd);
        cur.setDate(cur.getDate() + 1);
      }
    }

    const byMonth = {};
    for (const ymd of days) {
      const dt = parseYmd(ymd);
      const mk = dt ? monthKeyFromDate(dt) : ymd.slice(0, 7);
      if (!byMonth[mk]) byMonth[mk] = [];
      byMonth[mk].push(ymd);
    }

    const months = Object.keys(byMonth);

    const wrap = E.util.el("div", { class: "eikon-card" });
    wrap.appendChild(E.util.el("div", { class: "eikon-title", text: "Temperature Report Preview" }));
    wrap.appendChild(E.util.el("div", { class: "eikon-help", text: `${org}${loc ? " • " + loc : ""} • ${from} to ${to}` }));
    wrap.appendChild(E.util.el("div", { style: "height:10px;" }));

    for (const mk of months) {
      const tableWrap = E.util.el("div", { class: "eikon-tablewrap" });
      const table = E.util.el("table", { class: "eikon-table" });

      const thead = E.util.el("thead");
      const trh = E.util.el("tr");
      trh.appendChild(E.util.el("th", { text: mk }));
      for (const d of devices) {
        trh.appendChild(E.util.el("th", { text: d.name }));
      }
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = E.util.el("tbody");
      for (const ymd of byMonth[mk]) {
        const tr = E.util.el("tr");
        tr.appendChild(E.util.el("td", { text: ymd }));
        for (const dev of devices) {
          const e = (mapByDate[ymd] && mapByDate[ymd][String(dev.id)]) ? mapByDate[ymd][String(dev.id)] : null;
          const cell = e ? `${fmt1(e.min_temp)} / ${fmt1(e.max_temp)}` : "";
          tr.appendChild(E.util.el("td", { text: cell }));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);

      tableWrap.appendChild(table);

      wrap.appendChild(E.util.el("div", { style: "height:12px;" }));
      wrap.appendChild(E.util.el("div", { class: "eikon-muted", text: mk }));
      wrap.appendChild(E.util.el("div", { style: "height:8px;" }));
      wrap.appendChild(tableWrap);
    }

    return wrap;
  }

  E.modules.temperature = {
    render: function (root) {
      const state = {
        tab: "entries",
        devices: [],
        entriesMonthCache: {},
        selectedDate: E.util.todayYmd()
      };

      const tabs = E.util.el("div", { class: "eikon-tabs no-print" });
      const tabEntries = E.util.el("div", { class: "eikon-tab active", text: "Entries" });
      const tabDevices = E.util.el("div", { class: "eikon-tab", text: "Devices" });
      const tabReport = E.util.el("div", { class: "eikon-tab", text: "Print Report" });

      tabs.appendChild(tabEntries);
      tabs.appendChild(tabDevices);
      tabs.appendChild(tabReport);

      const content = E.util.el("div");
      root.innerHTML = "";
      root.appendChild(tabs);
      root.appendChild(content);

      function setActiveTab(name) {
        state.tab = name;
        [tabEntries, tabDevices, tabReport].forEach(t => t.classList.remove("active"));
        if (name === "entries") tabEntries.classList.add("active");
        if (name === "devices") tabDevices.classList.add("active");
        if (name === "report") tabReport.classList.add("active");
      }

      async function loadDevices(includeInactive) {
        const q = includeInactive ? "?include_inactive=1" : "";
        const r = await E.util.apiFetch("/temperature/devices" + q, { method: "GET" });
        state.devices = (r && r.devices) ? r.devices : [];
      }

      async function loadMonthEntries(month) {
        if (state.entriesMonthCache[month]) return state.entriesMonthCache[month];
        const r = await E.util.apiFetch("/temperature/entries?month=" + encodeURIComponent(month), { method: "GET" });
        const entries = (r && r.entries) ? r.entries : [];
        state.entriesMonthCache[month] = entries;
        return entries;
      }

      function clearMonthCache(month) {
        delete state.entriesMonthCache[month];
      }

      async function renderEntries() {
        content.innerHTML = "";

        await loadDevices(false);
        const activeDevices = state.devices.filter(d => d.active === 1);

        const dateInput = E.util.el("input", { class: "eikon-input", type: "date", value: state.selectedDate });
        const reloadBtn = E.util.el("button", { class: "eikon-btn", text: "Load" });
        const saveBtn = E.util.el("button", { class: "eikon-btn primary", text: "Save" });
        const syncBtn = E.util.el("button", { class: "eikon-btn", text: "Sync queued" });

        const header = E.util.el("div", { class: "eikon-card no-print" });
        header.appendChild(E.util.el("div", { class: "eikon-row" }, [
          E.util.el("div", { class: "eikon-col" }, [
            E.util.el("div", { class: "eikon-field" }, [
              E.util.el("div", { class: "eikon-label", text: "Date" }),
              dateInput
            ])
          ]),
          E.util.el("div", { class: "eikon-col", style: "display:flex;align-items:flex-end;gap:10px;justify-content:flex-end;" }, [
            reloadBtn,
            syncBtn,
            saveBtn
          ])
        ]));

        const help = E.util.el("div", { class: "eikon-help", text: "Enter Min/Max for each active room/fridge. You can back-date any day. No browser confirm() is used (GoDaddy sandbox safe)." });
        header.appendChild(E.util.el("div", { style: "height:8px;" }));
        header.appendChild(help);

        const tableCard = E.util.el("div", { class: "eikon-card" });
        const tableWrap = E.util.el("div", { class: "eikon-tablewrap" });
        const table = E.util.el("table", { class: "eikon-table" });

        const thead = E.util.el("thead");
        const trh = E.util.el("tr");
        ["Device", "Type", "Min", "Max", "Status", "Notes", ""].forEach(h => trh.appendChild(E.util.el("th", { text: h })));
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = E.util.el("tbody");
        table.appendChild(tbody);

        tableWrap.appendChild(table);
        tableCard.appendChild(tableWrap);

        content.appendChild(header);
        content.appendChild(E.util.el("div", { style: "height:12px;" }));
        content.appendChild(tableCard);

        function currentMonth() {
          return ymdToMonth(state.selectedDate);
        }

        function buildRow(dev, existingEntry) {
          const minIn = E.util.el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "e.g. 3.2" });
          const maxIn = E.util.el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "e.g. 7.8" });
          const notesIn = E.util.el("input", { class: "eikon-input", type: "text", placeholder: "Optional notes" });

          if (existingEntry) {
            minIn.value = fmt1(existingEntry.min_temp);
            maxIn.value = fmt1(existingEntry.max_temp);
            notesIn.value = existingEntry.notes || "";
          }

          const dot = E.util.el("span", { class: "eikon-dot" });
          const statusLabel = E.util.el("span", { class: "eikon-muted", text: "" });
          const statusWrap = E.util.el("span", { class: "eikon-pill" }, [dot, statusLabel]);

          function refreshStatus() {
            const minT = parseNum(minIn.value);
            const maxT = parseNum(maxIn.value);
            const st = statusDot(minT, maxT, dev.min_limit, dev.max_limit);
            dot.className = "eikon-dot " + (st.cls || "");
            statusLabel.textContent = st.label;
          }
          refreshStatus();

          minIn.addEventListener("input", refreshStatus);
          maxIn.addEventListener("input", refreshStatus);

          const delBtn = E.util.el("button", { class: "eikon-btn danger", text: "Delete" });
          delBtn.disabled = !existingEntry;

          delBtn.addEventListener("click", async () => {
            if (!existingEntry) return;
            const ok = await E.util.modalConfirm("Delete entry", `Delete temperature entry for ${dev.name} on ${state.selectedDate}?`, "Delete", "Cancel");
            if (!ok) return;
            try {
              await E.util.apiFetch("/temperature/entries/" + existingEntry.id, { method: "DELETE" });
              E.util.toast("Deleted", "Entry removed.");
              clearMonthCache(currentMonth());
              await renderEntries();
            } catch (e) {
              E.util.toast("Delete failed", e.message || "Error");
            }
          });

          const tr = E.util.el("tr");
          tr.appendChild(E.util.el("td", { text: dev.name }));
          tr.appendChild(E.util.el("td", { text: dev.device_type }));
          tr.appendChild(E.util.el("td", {}, [minIn]));
          tr.appendChild(E.util.el("td", {}, [maxIn]));
          tr.appendChild(E.util.el("td", {}, [statusWrap]));
          tr.appendChild(E.util.el("td", {}, [notesIn]));
          tr.appendChild(E.util.el("td", {}, [delBtn]));

          return { tr, dev, minIn, maxIn, notesIn, existingEntry };
        }

        async function fillRows() {
          tbody.innerHTML = "";

          const m = currentMonth();
          const monthEntries = await loadMonthEntries(m);
          const map = groupEntriesByDate(monthEntries);
          const dayEntries = map[state.selectedDate] || [];

          const byDeviceId = {};
          for (const e of dayEntries) byDeviceId[String(e.device_id)] = e;

          const rows = [];
          for (const dev of activeDevices) {
            const ex = byDeviceId[String(dev.id)] || null;
            rows.push(buildRow(dev, ex));
          }

          if (rows.length === 0) {
            const tr = E.util.el("tr");
            const td = E.util.el("td", { text: "No active devices. Add devices first." });
            td.colSpan = 7;
            tr.appendChild(td);
            tbody.appendChild(tr);
            saveBtn.disabled = true;
          } else {
            saveBtn.disabled = false;
            for (const r of rows) tbody.appendChild(r.tr);
          }

          return rows;
        }

        let rowObjs = await fillRows();

        reloadBtn.addEventListener("click", async () => {
          state.selectedDate = dateInput.value;
          rowObjs = await fillRows();
        });

        dateInput.addEventListener("change", async () => {
          state.selectedDate = dateInput.value;
          rowObjs = await fillRows();
        });

        syncBtn.addEventListener("click", async () => {
          try {
            const r = await E.util.qFlush();
            E.util.toast("Sync", `Sent ${r.sent}. Remaining ${r.remaining}.`);
          } catch (e) {
            E.util.toast("Sync failed", e.message || "Error");
          }
        });

        saveBtn.addEventListener("click", async () => {
          const d = (dateInput.value || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            E.util.toast("Invalid date", "Pick a valid date.");
            return;
          }

          const jobs = [];
          for (const r of rowObjs) {
            const minT = parseNum(r.minIn.value);
            const maxT = parseNum(r.maxIn.value);
            const notes = (r.notesIn.value || "").trim();

            if (minT === null || maxT === null) {
              E.util.toast("Missing values", "Each active device needs Min and Max.");
              return;
            }

            jobs.push({
              device_id: r.dev.id,
              entry_date: d,
              min_temp: minT,
              max_temp: maxT,
              notes: notes
            });
          }

          saveBtn.disabled = true;
          saveBtn.textContent = "Saving...";

          try {
            for (const b of jobs) {
              try {
                await E.util.apiFetch("/temperature/entries", { method: "POST", body: JSON.stringify(b) });
              } catch (e) {
                E.util.qAdd({ path: "/temperature/entries", method: "POST", body: b });
              }
            }
            E.util.toast("Saved", "Entries saved (or queued if offline).");
            clearMonthCache(ymdToMonth(d));
            await renderEntries();
          } catch (e) {
            E.util.toast("Save failed", e.message || "Error");
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
          }
        });
      }

      async function renderDevices() {
        content.innerHTML = "";
        await loadDevices(true);

        const card = E.util.el("div", { class: "eikon-card no-print" });
        card.appendChild(E.util.el("div", { class: "eikon-title", text: "Devices (Rooms / Fridges)" }));
        card.appendChild(E.util.el("div", { class: "eikon-help", text: "Create, rename, set limits, deactivate/reactivate. Active devices are required for a complete daily record." }));
        card.appendChild(E.util.el("div", { style: "height:12px;" }));

        const addName = E.util.el("input", { class: "eikon-input", placeholder: "Device name (e.g. Back Room / Vaccine Fridge)" });
        const addType = E.util.el("select", { class: "eikon-select" }, [
          E.util.el("option", { value: "room", text: "room" }),
          E.util.el("option", { value: "fridge", text: "fridge" }),
          E.util.el("option", { value: "other", text: "other" })
        ]);
        const addMin = E.util.el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "Min limit (optional)" });
        const addMax = E.util.el("input", { class: "eikon-input", type: "number", step: "0.1", placeholder: "Max limit (optional)" });
        const addBtn = E.util.el("button", { class: "eikon-btn primary", text: "Add device" });

        const addRow = E.util.el("div", { class: "eikon-row" }, [
          E.util.el("div", { class: "eikon-col" }, [E.util.el("div", { class: "eikon-field" }, [E.util.el("div", { class: "eikon-label", text: "Name" }), addName])]),
          E.util.el("div", { class: "eikon-col" }, [E.util.el("div", { class: "eikon-field" }, [E.util.el("div", { class: "eikon-label", text: "Type" }), addType])]),
          E.util.el("div", { class: "eikon-col" }, [E.util.el("div", { class: "eikon-field" }, [E.util.el("div", { class: "eikon-label", text: "Min limit" }), addMin])]),
          E.util.el("div", { class: "eikon-col" }, [E.util.el("div", { class: "eikon-field" }, [E.util.el("div", { class: "eikon-label", text: "Max limit" }), addMax])])
        ]);

        card.appendChild(addRow);
        card.appendChild(addBtn);

        const tableCard = E.util.el("div", { class: "eikon-card" });
        const tableWrap = E.util.el("div", { class: "eikon-tablewrap" });
        const table = E.util.el("table", { class: "eikon-table" });

        const thead = E.util.el("thead");
        const trh = E.util.el("tr");
        ["Name", "Type", "Min", "Max", "Active", ""].forEach(h => trh.appendChild(E.util.el("th", { text: h })));
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = E.util.el("tbody");
        table.appendChild(tbody);

        tableWrap.appendChild(table);
        tableCard.appendChild(tableWrap);

        content.appendChild(card);
        content.appendChild(E.util.el("div", { style: "height:12px;" }));
        content.appendChild(tableCard);

        function rowForDevice(d) {
          const name = E.util.el("input", { class: "eikon-input", value: d.name });
          const type = E.util.el("select", { class: "eikon-select" }, [
            E.util.el("option", { value: "room", text: "room" }),
            E.util.el("option", { value: "fridge", text: "fridge" }),
            E.util.el("option", { value: "other", text: "other" })
          ]);
          type.value = d.device_type;

          const min = E.util.el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.min_limit === null || d.min_limit === undefined) ? "" : fmt1(d.min_limit) });
          const max = E.util.el("input", { class: "eikon-input", type: "number", step: "0.1", value: (d.max_limit === null || d.max_limit === undefined) ? "" : fmt1(d.max_limit) });

          const activeText = E.util.el("span", { class: "eikon-muted", text: d.active === 1 ? "Yes" : "No" });

          const save = E.util.el("button", { class: "eikon-btn ok", text: "Save" });
          const toggle = E.util.el("button", { class: d.active === 1 ? "eikon-btn danger" : "eikon-btn", text: d.active === 1 ? "Deactivate" : "Reactivate" });

          save.addEventListener("click", async () => {
            try {
              await E.util.apiFetch("/temperature/devices/" + d.id, {
                method: "PUT",
                body: JSON.stringify({
                  name: (name.value || "").trim(),
                  device_type: type.value,
                  min_limit: (min.value.trim() ? parseNum(min.value) : null),
                  max_limit: (max.value.trim() ? parseNum(max.value) : null)
                })
              });
              E.util.toast("Saved", "Device updated.");
              await renderDevices();
            } catch (e) {
              E.util.toast("Save failed", e.message || "Error");
            }
          });

          toggle.addEventListener("click", async () => {
            const wantActive = d.active !== 1;
            const ok = await E.util.modalConfirm(
              wantActive ? "Reactivate device" : "Deactivate device",
              wantActive ? "Reactivate this device?" : "Deactivate this device? (history kept)",
              wantActive ? "Reactivate" : "Deactivate",
              "Cancel"
            );
            if (!ok) return;

            try {
              await E.util.apiFetch("/temperature/devices/" + d.id, {
                method: "PUT",
                body: JSON.stringify({ active: wantActive })
              });
              E.util.toast("Updated", wantActive ? "Device reactivated." : "Device deactivated.");
              await renderDevices();
            } catch (e) {
              E.util.toast("Update failed", e.message || "Error");
            }
          });

          const tr = E.util.el("tr");
          tr.appendChild(E.util.el("td", {}, [name]));
          tr.appendChild(E.util.el("td", {}, [type]));
          tr.appendChild(E.util.el("td", {}, [min]));
          tr.appendChild(E.util.el("td", {}, [max]));
          tr.appendChild(E.util.el("td", {}, [activeText]));
          tr.appendChild(E.util.el("td", {}, [E.util.el("div", { style: "display:flex;gap:8px;justify-content:flex-end;" }, [save, toggle])]));
          return tr;
        }

        function refreshTable() {
          tbody.innerHTML = "";
          for (const d of state.devices) {
            tbody.appendChild(rowForDevice(d));
          }
        }

        refreshTable();

        addBtn.addEventListener("click", async () => {
          const name = (addName.value || "").trim();
          if (!name) {
            E.util.toast("Missing", "Enter device name.");
            return;
          }
          addBtn.disabled = true;
          addBtn.textContent = "Adding...";
          try {
            await E.util.apiFetch("/temperature/devices", {
              method: "POST",
              body: JSON.stringify({
                name,
                device_type: addType.value,
                min_limit: (addMin.value.trim() ? parseNum(addMin.value) : null),
                max_limit: (addMax.value.trim() ? parseNum(addMax.value) : null)
              })
            });
            addName.value = "";
            addMin.value = "";
            addMax.value = "";
            E.util.toast("Added", "Device created.");
            await renderDevices();
          } catch (e) {
            E.util.toast("Add failed", e.message || "Error");
          } finally {
            addBtn.disabled = false;
            addBtn.textContent = "Add device";
          }
        });
      }

      async function renderReport() {
        content.innerHTML = "";
        await loadDevices(true);

        const card = E.util.el("div", { class: "eikon-card no-print" });
        card.appendChild(E.util.el("div", { class: "eikon-title", text: "Print Temperature Report" }));
        card.appendChild(E.util.el("div", { class: "eikon-help", text: "Pick a date range. Months are separated into different tables. Print opens in a new tab (GoDaddy sandbox-safe) and the print dialog appears automatically." }));
        card.appendChild(E.util.el("div", { style: "height:12px;" }));

        const from = E.util.el("input", { class: "eikon-input", type: "date", value: E.util.todayYmd() });
        const to = E.util.el("input", { class: "eikon-input", type: "date", value: E.util.todayYmd() });
        const gen = E.util.el("button", { class: "eikon-btn primary", text: "Generate" });
        const print = E.util.el("button", { class: "eikon-btn", text: "Print" });

        const row = E.util.el("div", { class: "eikon-row" }, [
          E.util.el("div", { class: "eikon-col" }, [E.util.el("div", { class: "eikon-field" }, [E.util.el("div", { class: "eikon-label", text: "From" }), from])]),
          E.util.el("div", { class: "eikon-col" }, [E.util.el("div", { class: "eikon-field" }, [E.util.el("div", { class: "eikon-label", text: "To" }), to])]),
          E.util.el("div", { class: "eikon-col", style: "display:flex;align-items:flex-end;gap:10px;justify-content:flex-end;" }, [gen, print])
        ]);

        card.appendChild(row);
        content.appendChild(card);
        content.appendChild(E.util.el("div", { style: "height:12px;" }));

        const reportWrap = E.util.el("div");
        content.appendChild(reportWrap);

        let lastData = null;

        gen.addEventListener("click", async () => {
          const f = (from.value || "").trim();
          const t = (to.value || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
            E.util.toast("Invalid", "Pick a valid date range.");
            return;
          }
          if (t < f) {
            E.util.toast("Invalid", "To must be >= From.");
            return;
          }

          gen.disabled = true;
          gen.textContent = "Loading...";
          reportWrap.innerHTML = "";

          try {
            const r = await E.util.apiFetch("/temperature/report?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t), { method: "GET" });
            if (!r || !r.ok) throw new Error("Report failed");
            lastData = r;
            reportWrap.appendChild(renderReportPreviewHtml(r));
          } catch (e) {
            E.util.toast("Report failed", e.message || "Error");
          } finally {
            gen.disabled = false;
            gen.textContent = "Generate";
          }
        });

        print.addEventListener("click", () => {
          if (!lastData) {
            E.util.toast("Nothing to print", "Generate the report first.");
            return;
          }
          try {
            const html = buildPrintHtml(lastData);
            openPrintTabWithHtml(html);
          } catch (e) {
            E.util.toast("Print failed", e.message || "Error");
          }
        });
      }

      tabEntries.addEventListener("click", async () => {
        setActiveTab("entries");
        await renderEntries();
      });
      tabDevices.addEventListener("click", async () => {
        setActiveTab("devices");
        await renderDevices();
      });
      tabReport.addEventListener("click", async () => {
        setActiveTab("report");
        await renderReport();
      });

      (async () => {
        setActiveTab("entries");
        await renderEntries();
      })();
    }
  };
})();
