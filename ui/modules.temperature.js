(function(){
  "use strict";

  const EIKON = window.EIKON;

  function meta(){
    return {
      order: 10,
      key: "temperature",
      title: "Temperature",
      subtitle: "Daily fridge / room logs",
      icon: "🌡️"
    };
  }

  function monthNow(){
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    return y + "-" + m;
  }

  function normalizeMonthInput(v){
    const s = String(v||"").trim();
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    return monthNow();
  }

  function formatTempCell(min, max){
    const a = (min === null || min === undefined || min === "") ? "" : String(min);
    const b = (max === null || max === undefined || max === "") ? "" : String(max);
    if (!a && !b) return "";
    if (a && b) return a + " / " + b;
    return a || b;
  }

  async function render(root, user){
    root.append(
      EIKON.el("div", { class:"card" },
        EIKON.el("h2", null, "Temperature"),
        EIKON.el("p", { class:"sub" }, "Enter daily min/max per device. Admins can manage devices.")
      )
    );

    const state = {
      tab: "entries",
      month: monthNow(),
      devices: [],
      entries: [],
      loading: false
    };

    const tabs = EIKON.el("div", { style:"display:flex;gap:10px;flex-wrap:wrap" },
      EIKON.el("button", { class:"btn primary", onclick: ()=>{ state.tab="entries"; draw(); } }, "Entries"),
      EIKON.el("button", { class:"btn", onclick: ()=>{ state.tab="devices"; draw(); } }, "Devices"),
      EIKON.el("button", { class:"btn", onclick: ()=>{ state.tab="print"; draw(); } }, "Print Report")
    );
    root.append(tabs);

    const panel = EIKON.el("div", { class:"grid", style:"gap:14px" });
    root.append(panel);

    async function loadDevices(){
      const data = await EIKON.apiFetch("/temperature/devices", { method:"GET" });
      state.devices = (data && data.devices) ? data.devices : [];
    }

    async function loadEntries(){
      const month = normalizeMonthInput(state.month);
      const data = await EIKON.apiFetch("/temperature/entries?month=" + encodeURIComponent(month), { method:"GET" });
      state.entries = (data && data.entries) ? data.entries : [];
    }

    async function reloadAll(){
      state.loading = true;
      draw();
      try{
        await loadDevices();
        await loadEntries();
      } catch(e){
        EIKON.toast(e && e.message ? e.message : "Failed to load", "err");
      } finally {
        state.loading = false;
        draw();
      }
    }

    function draw(){
      panel.innerHTML = "";

      if (state.tab === "entries") drawEntries();
      if (state.tab === "devices") drawDevices();
      if (state.tab === "print") drawPrint();
    }

    function drawEntries(){
      const monthCard = EIKON.el("div", { class:"card" });

      const monthInput = EIKON.el("input", {
        type:"month",
        value: normalizeMonthInput(state.month),
        onchange: async (e)=>{
          state.month = normalizeMonthInput(e.target.value);
          await reloadAll();
        }
      });

      const btnPrev = EIKON.el("button", { class:"btn", onclick: async ()=>{
        state.month = EIKON.monthAdd(state.month, -1);
        await reloadAll();
      }}, "◀ Prev");

      const btnNext = EIKON.el("button", { class:"btn", onclick: async ()=>{
        state.month = EIKON.monthAdd(state.month, +1);
        await reloadAll();
      }}, "Next ▶");

      const btnReload = EIKON.el("button", { class:"btn", onclick: reloadAll }, "Reload");

      monthCard.append(
        EIKON.el("h2", null, "Month"),
        EIKON.el("div", { class:"grid cols-4" },
          EIKON.el("div", { class:"field" },
            EIKON.el("label", null, "Month"),
            monthInput
          ),
          EIKON.el("div", { class:"field" },
            EIKON.el("label", null, "Actions"),
            EIKON.el("div", { style:"display:flex;gap:10px;flex-wrap:wrap" }, btnPrev, btnNext, btnReload)
          ),
          EIKON.el("div", { class:"field" },
            EIKON.el("label", null, "Status"),
            EIKON.el("div", { class:"pill" }, state.loading ? "Loading..." : ("Devices: " + state.devices.length + " · Entries: " + state.entries.length))
          ),
          EIKON.el("div", { class:"field" },
            EIKON.el("label", null, "Note"),
            EIKON.el("div", { class:"pill" }, "Click a row to edit, or add a new one below.")
          )
        )
      );

      panel.append(monthCard);

      const formCard = EIKON.el("div", { class:"card" });
      const f = {
        id: 0,
        device_id: "",
        entry_date: EIKON.todayYmd(),
        min_temp: "",
        max_temp: "",
        notes: ""
      };

      const deviceSel = EIKON.el("select", {
        onchange: (e)=>{ f.device_id = e.target.value; }
      });

      deviceSel.append(EIKON.el("option", { value:"" }, "Select device..."));
      for (const d of state.devices){
        deviceSel.append(EIKON.el("option", { value:String(d.id) }, d.name + " (" + d.device_type + ")"));
      }

      const dateInput = EIKON.el("input", { type:"date", value:f.entry_date, onchange:(e)=>{ f.entry_date = e.target.value; }});
      const minInput = EIKON.el("input", { type:"number", step:"0.1", value:"", placeholder:"e.g. 3.2", onchange:(e)=>{ f.min_temp = e.target.value; }});
      const maxInput = EIKON.el("input", { type:"number", step:"0.1", value:"", placeholder:"e.g. 6.8", onchange:(e)=>{ f.max_temp = e.target.value; }});
      const notesInput = EIKON.el("textarea", { placeholder:"Optional notes...", onchange:(e)=>{ f.notes = e.target.value; }});

      const btnSave = EIKON.el("button", { class:"btn primary", onclick: async ()=>{
        const devId = parseInt(String(f.device_id||""), 10);
        if (!devId){
          EIKON.toast("Select device", "warn");
          return;
        }
        if (!f.entry_date){
          EIKON.toast("Select date", "warn");
          return;
        }
        btnSave.disabled = true;
        try{
          await EIKON.apiFetch("/temperature/entries", {
            method:"POST",
            body:{
              device_id: devId,
              entry_date: f.entry_date,
              min_temp: (f.min_temp === "" ? null : Number(f.min_temp)),
              max_temp: (f.max_temp === "" ? null : Number(f.max_temp)),
              notes: String(f.notes||"")
            }
          });
          EIKON.toast("Saved", "ok");
          await reloadAll();
          clearForm();
        } catch(e){
          EIKON.toast(e && e.message ? e.message : "Save failed", "err");
        } finally {
          btnSave.disabled = false;
        }
      }}, "Save entry");

      const btnClear = EIKON.el("button", { class:"btn", onclick: ()=>{ clearForm(); }}, "Clear");

      function clearForm(){
        f.id = 0;
        f.device_id = "";
        f.entry_date = EIKON.todayYmd();
        f.min_temp = "";
        f.max_temp = "";
        f.notes = "";
        deviceSel.value = "";
        dateInput.value = f.entry_date;
        minInput.value = "";
        maxInput.value = "";
        notesInput.value = "";
      }

      formCard.append(
        EIKON.el("h2", null, "Add / Edit entry"),
        EIKON.el("div", { class:"grid cols-4" },
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Device"), deviceSel),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Date"), dateInput),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Min"), minInput),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Max"), maxInput)
        ),
        EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Notes (optional)"), notesInput),
        EIKON.el("div", { style:"display:flex;gap:10px;flex-wrap:wrap" }, btnSave, btnClear)
      );

      panel.append(formCard);

      const listCard = EIKON.el("div", { class:"card" },
        EIKON.el("h2", null, "Entries")
      );

      const tableWrap = EIKON.el("div", { class:"tablewrap" });
      const table = EIKON.el("table", null);
      const thead = EIKON.el("thead", null,
        EIKON.el("tr", null,
          EIKON.el("th", null, "Date"),
          EIKON.el("th", null, "Device"),
          EIKON.el("th", null, "Min / Max"),
          EIKON.el("th", null, "Notes"),
          EIKON.el("th", null, "Actions")
        )
      );
      const tbody = EIKON.el("tbody", null);

      if (!state.entries.length){
        tbody.append(EIKON.el("tr", null,
          EIKON.el("td", { colspan:"5", class:"small" }, "No entries for this month.")
        ));
      } else {
        for (const e of state.entries){
          const btnEdit = EIKON.el("button", { class:"btn", onclick: ()=>{
            f.id = e.id;
            f.device_id = String(e.device_id || "");
            f.entry_date = e.entry_date || EIKON.todayYmd();
            f.min_temp = (e.min_temp === null || e.min_temp === undefined) ? "" : String(e.min_temp);
            f.max_temp = (e.max_temp === null || e.max_temp === undefined) ? "" : String(e.max_temp);
            f.notes = String(e.notes || "");
            deviceSel.value = f.device_id;
            dateInput.value = f.entry_date;
            minInput.value = f.min_temp;
            maxInput.value = f.max_temp;
            notesInput.value = f.notes;
            EIKON.toast("Loaded into form (edit then Save)", "ok");
          }}, "Edit");

          const btnDel = EIKON.el("button", { class:"btn danger", onclick: async ()=>{
            const ok = await EIKON.confirmDialog("Delete entry?", "This will permanently delete the temperature entry for:\n\n" + (e.entry_date || "") + " · " + (e.device_name || ""));
            if (!ok) return;
            try{
              await EIKON.apiFetch("/temperature/entries/" + e.id, { method:"DELETE" });
              EIKON.toast("Deleted", "ok");
              await reloadAll();
            } catch(err){
              EIKON.toast(err && err.message ? err.message : "Delete failed", "err");
            }
          }}, "Delete");

          tbody.append(EIKON.el("tr", null,
            EIKON.el("td", null, EIKON.ymdToDmy(e.entry_date)),
            EIKON.el("td", null, (e.device_name || "")),
            EIKON.el("td", null, formatTempCell(e.min_temp, e.max_temp)),
            EIKON.el("td", null, (e.notes || "")),
            EIKON.el("td", null, EIKON.el("div", { class:"row-actions" }, btnEdit, btnDel))
          ));
        }
      }

      table.append(thead, tbody);
      tableWrap.append(table);
      listCard.append(tableWrap);
      panel.append(listCard);
    }

    function drawDevices(){
      const card = EIKON.el("div", { class:"card" },
        EIKON.el("h2", null, "Devices"),
        EIKON.el("p", { class:"sub" }, "Admins can add or disable devices. Defaults are created automatically if missing.")
      );

      if (user.role !== "admin"){
        card.append(EIKON.el("div", { class:"pill" }, "Only admins can manage devices."));
        panel.append(card);
        return;
      }

      const fName = EIKON.el("input", { type:"text", placeholder:"Device name (e.g. Pharmacy Fridge)" });
      const fType = EIKON.el("select", null,
        EIKON.el("option", { value:"room" }, "room"),
        EIKON.el("option", { value:"fridge" }, "fridge"),
        EIKON.el("option", { value:"other" }, "other")
      );
      const fMin = EIKON.el("input", { type:"number", step:"0.1", placeholder:"Min limit (optional)" });
      const fMax = EIKON.el("input", { type:"number", step:"0.1", placeholder:"Max limit (optional)" });

      const btnAdd = EIKON.el("button", { class:"btn primary", onclick: async ()=>{
        const name = (fName.value || "").trim();
        if (!name){
          EIKON.toast("Enter name", "warn");
          return;
        }
        try{
          await EIKON.apiFetch("/temperature/devices", {
            method:"POST",
            body:{
              name,
              device_type: fType.value,
              min_limit: (fMin.value === "" ? null : Number(fMin.value)),
              max_limit: (fMax.value === "" ? null : Number(fMax.value))
            }
          });
          EIKON.toast("Device added", "ok");
          fName.value = "";
          fMin.value = "";
          fMax.value = "";
          await reloadAll();
        } catch(e){
          EIKON.toast(e && e.message ? e.message : "Add failed", "err");
        }
      }}, "Add device");

      card.append(
        EIKON.el("div", { class:"grid cols-4" },
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Name"), fName),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Type"), fType),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Min limit"), fMin),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Max limit"), fMax)
        ),
        EIKON.el("div", { style:"display:flex;gap:10px;flex-wrap:wrap" }, btnAdd, EIKON.el("button", { class:"btn", onclick: reloadAll }, "Reload"))
      );

      const list = EIKON.el("div", { class:"tablewrap", style:"margin-top:14px" });
      const table = EIKON.el("table", null,
        EIKON.el("thead", null,
          EIKON.el("tr", null,
            EIKON.el("th", null, "Name"),
            EIKON.el("th", null, "Type"),
            EIKON.el("th", null, "Min/Max Limit"),
            EIKON.el("th", null, "Active"),
            EIKON.el("th", null, "Actions")
          )
        )
      );
      const tbody = EIKON.el("tbody", null);

      if (!state.devices.length){
        tbody.append(EIKON.el("tr", null, EIKON.el("td", { colspan:"5", class:"small" }, "No devices.")));
      } else {
        for (const d of state.devices){
          const btnDisable = EIKON.el("button", { class:"btn danger", onclick: async ()=>{
            const ok = await EIKON.confirmDialog("Disable device?", "This will hide it from normal use.\n\n" + d.name);
            if (!ok) return;
            try{
              await EIKON.apiFetch("/temperature/devices/" + d.id, {
                method:"PUT",
                body:{
                  name:d.name,
                  device_type:d.device_type,
                  min_limit:d.min_limit,
                  max_limit:d.max_limit,
                  active:false
                }
              });
              EIKON.toast("Disabled", "ok");
              await reloadAll();
            } catch(e){
              EIKON.toast(e && e.message ? e.message : "Update failed", "err");
            }
          }}, "Disable");

          tbody.append(EIKON.el("tr", null,
            EIKON.el("td", null, d.name),
            EIKON.el("td", null, d.device_type),
            EIKON.el("td", null, (d.min_limit ?? "") + " / " + (d.max_limit ?? "")),
            EIKON.el("td", null, d.active ? "Yes" : "No"),
            EIKON.el("td", null, EIKON.el("div", { class:"row-actions" }, d.active ? btnDisable : EIKON.el("span", { class:"pill" }, "Inactive")))
          ));
        }
      }

      table.append(tbody);
      list.append(table);
      card.append(list);
      panel.append(card);
    }

    function drawPrint(){
      const card = EIKON.el("div", { class:"card" },
        EIKON.el("h2", null, "Temperature report"),
        EIKON.el("p", { class:"sub" }, "Generate a date-range report. In GoDaddy sandbox, direct print may be blocked; use Download HTML.")
      );

      const from = EIKON.el("input", { type:"date", value: EIKON.todayYmd() });
      const to = EIKON.el("input", { type:"date", value: EIKON.todayYmd() });

      const btn = EIKON.el("button", { class:"btn primary", onclick: async ()=>{
        try{
          const data = await EIKON.apiFetch("/temperature/report?from=" + encodeURIComponent(from.value) + "&to=" + encodeURIComponent(to.value), { method:"GET" });
          const html = buildReportHtml(data);
          const printed = EIKON.tryPrintHtml(html, "Temperature Report");
          if (!printed){
            EIKON.showModal("Print blocked", "Your page is sandboxed (GoDaddy). Use Download HTML, open the downloaded file, then print (Ctrl+P).", [
              { label:"Download HTML", kind:"primary", onClick: ()=>EIKON.downloadTextFile("temperature-report.html", html) },
              { label:"Close", kind:"ghost" }
            ]);
          }
        } catch(e){
          EIKON.toast(e && e.message ? e.message : "Report failed", "err");
        }
      }}, "Generate & Print");

      const btnDl = EIKON.el("button", { class:"btn", onclick: async ()=>{
        try{
          const data = await EIKON.apiFetch("/temperature/report?from=" + encodeURIComponent(from.value) + "&to=" + encodeURIComponent(to.value), { method:"GET" });
          const html = buildReportHtml(data);
          EIKON.downloadTextFile("temperature-report.html", html);
          EIKON.toast("Downloaded HTML", "ok");
        } catch(e){
          EIKON.toast(e && e.message ? e.message : "Report failed", "err");
        }
      }}, "Download HTML");

      card.append(
        EIKON.el("div", { class:"grid cols-3" },
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "From"), from),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "To"), to),
          EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Actions"), EIKON.el("div", { style:"display:flex;gap:10px;flex-wrap:wrap" }, btn, btnDl))
        )
      );

      panel.append(card);
    }

    function buildReportHtml(data){
      const org = EIKON.escapeHtml((data && data.org_name) ? data.org_name : "");
      const loc = EIKON.escapeHtml((data && data.location_name) ? data.location_name : "");
      const from = EIKON.escapeHtml((data && data.from) ? data.from : "");
      const to = EIKON.escapeHtml((data && data.to) ? data.to : "");

      const devices = (data && data.devices) ? data.devices : [];
      const entries = (data && data.entries) ? data.entries : [];

      const map = new Map();
      for (const e of entries){
        const k = e.entry_date + "::" + e.device_id;
        map.set(k, e);
      }

      // build list of dates from->to
      const dates = [];
      const d0 = new Date(from + "T00:00:00");
      const d1 = new Date(to + "T00:00:00");
      for (let d = new Date(d0); d <= d1; d.setDate(d.getDate()+1)){
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,"0");
        const da = String(d.getDate()).padStart(2,"0");
        dates.push(y + "-" + m + "-" + da);
      }

      let th = `<th>Date</th>`;
      for (const dev of devices){
        th += `<th>${EIKON.escapeHtml(dev.name)}<div style="font-size:11px;color:#666">${EIKON.escapeHtml(dev.device_type || "")}</div></th>`;
      }

      let rows = "";
      for (const day of dates){
        let tds = `<td>${EIKON.escapeHtml(EIKON.ymdToDmy(day))}</td>`;
        for (const dev of devices){
          const e = map.get(day + "::" + dev.id);
          const txt = e ? EIKON.escapeHtml(formatTempCell(e.min_temp, e.max_temp)) : "";
          const note = e && e.notes ? `<div style="font-size:11px;color:#777;margin-top:4px">${EIKON.escapeHtml(e.notes)}</div>` : "";
          tds += `<td>${txt}${note}</td>`;
        }
        rows += `<tr>${tds}</tr>`;
      }

      return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Temperature Report</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#111}
    h1{margin:0 0 6px 0;font-size:20px}
    .sub{color:#444;margin:0 0 16px 0}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #ddd;padding:8px;vertical-align:top;font-size:12px}
    th{background:#f5f5f5;text-align:left}
    @media print{body{margin:0} h1{font-size:16px}}
  </style>
</head>
<body>
  <h1>Temperature Report</h1>
  <p class="sub">${org} · ${loc}<br/>${from} → ${to}</p>
  <table>
    <thead><tr>${th}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
    }

    await reloadAll();
    draw();
  }

  EIKON.registerModule("temperature", { meta: meta(), render });
})();
