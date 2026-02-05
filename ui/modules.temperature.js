(function(){
  "use strict";

  const EIKON = window.EIKON;
  const ui = EIKON.ui;
  const api = EIKON.api;
  const auth = EIKON.auth;
  const queue = EIKON.queue;

  function ymd(d){
    const x = new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth()+1).padStart(2,"0");
    const day = String(x.getDate()).padStart(2,"0");
    return y+"-"+m+"-"+day;
  }
  function ym(d){
    const x = new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth()+1).padStart(2,"0");
    return y+"-"+m;
  }
  function clamp1(n){
    if (n === null || n === undefined || n === "") return null;
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(v*10)/10;
  }

  function iconText(t){
    return ui.el("span", { class:"icon" }, t);
  }

  function buildLayout(root, user){
    root.innerHTML = "";
    const app = ui.el("div", { class:"eikon-app" });
    const sidebar = ui.el("div", { class:"eikon-sidebar" });

    const brand = ui.el("div", { class:"eikon-brand" }, [
      ui.el("div", { class:"eikon-brand-mark" }),
      ui.el("div", {}, [
        ui.el("div", { class:"eikon-brand-title" }, "Eikon"),
        ui.el("div", { class:"eikon-brand-sub" }, "Pharmacy processes")
      ])
    ]);

    const usercard = ui.el("div", { class:"eikon-usercard" }, [
      ui.el("div", { class:"name" }, user.org_name || "Pharmacy"),
      ui.el("div", { class:"meta" }, [
        ui.el("div", {}, (user.location_name || "")),
        ui.el("div", {}, (user.email || "")),
        ui.el("div", {}, ("Role: " + (user.role || "")))
      ])
    ]);

    const nav = ui.el("div", { class:"eikon-nav" });

    function navBtn(key, label, ico){
      const b = ui.el("button", { type:"button", "data-key":key }, [
        iconText(ico),
        ui.el("span", {}, label)
      ]);
      nav.appendChild(b);
      return b;
    }

    const btnTemp = navBtn("temperature", "Temperature", "🌡️");
    navBtn("eod", "End of Day", "🧾");
    navBtn("dda_purchases", "DDA Purchases", "🛒");
    navBtn("dda_sales", "DDA Sales", "💊");
    navBtn("daily_register", "Daily Register", "📒");
    navBtn("repeat_rx", "Repeat Prescriptions", "🔁");
    navBtn("dda_stocktake", "DDA Stock Take", "📦");
    navBtn("calibrations", "Calibrations", "🧯");
    navBtn("maintenance", "Maintenance", "🧰");
    navBtn("cleaning", "Cleaning", "🧼");

    const spacer = ui.el("div", { class:"eikon-spacer" });

    const logoutBtn = ui.el("button", { class:"eikon-btn secondary", type:"button" }, "Logout");
    logoutBtn.addEventListener("click", ()=>{
      auth.logout();
      location.reload();
    });

    sidebar.appendChild(brand);
    sidebar.appendChild(usercard);
    sidebar.appendChild(nav);
    sidebar.appendChild(spacer);
    sidebar.appendChild(ui.el("div", { class:"eikon-sidebar-footer" }, [logoutBtn]));

    const main = ui.el("div", { class:"eikon-main" });
    app.appendChild(sidebar);
    app.appendChild(main);
    root.appendChild(app);

    const route = { key:"temperature" };

    function setActive(key){
      route.key = key;
      ui.qsa("button[data-key]", nav).forEach(b=>{
        b.classList.toggle("active", b.getAttribute("data-key") === key);
      });
      renderRoute();
    }

    btnTemp.classList.add("active");

    nav.addEventListener("click", (e)=>{
      const btn = e.target.closest("button[data-key]");
      if (!btn) return;
      const key = btn.getAttribute("data-key");
      setActive(key);
    });

    function renderComingSoon(key){
      main.innerHTML = "";
      const top = ui.el("div", { class:"eikon-topbar" }, [
        ui.el("div", {}, [
          ui.el("h1", {}, "Coming soon"),
          ui.el("div", { class:"sub" }, "Module: " + key)
        ]),
        ui.el("div", { class:"eikon-pill" }, [
          ui.el("span", { class:"dot warn" }),
          ui.el("span", {}, "MVP: Temperature first")
        ])
      ]);
      const card = ui.el("div", { class:"eikon-card" }, [
        ui.el("div", { class:"eikon-card-header" }, [
          ui.el("div", {}, [
            ui.el("div", { class:"title" }, "This module is not implemented yet"),
            ui.el("div", { class:"hint" }, "We will add modules one by one.")
          ])
        ]),
        ui.el("div", { class:"eikon-card-body" }, [
          ui.el("div", { style:"color:var(--muted); line-height:1.55" },
            "Temperature is ready. Next we can add End of Day, then DDA Purchases/Sales, etc.")
        ])
      ]);
      main.appendChild(top);
      main.appendChild(card);
    }

    async function renderRoute(){
      if (route.key === "temperature"){
        await renderTemperature(main, user);
      } else {
        renderComingSoon(route.key);
      }
    }

    renderRoute();

    return { setActive };
  }

  async function fetchDevices(){
    const res = await api.fetch("/temperature/devices", { method:"GET" });
    if (res.ok && res.json && res.json.ok) return res.json.devices || [];
    return [];
  }

  async function fetchEntries(month){
    const res = await api.fetch("/temperature/entries?month=" + encodeURIComponent(month), { method:"GET" });
    if (res.ok && res.json && res.json.ok) return res.json.entries || [];
    return [];
  }

  async function upsertEntry(payload){
    // if offline: queue
    if (!navigator.onLine){
      queue.add({ type:"temp_upsert", payload });
      return { queued:true };
    }
    const res = await api.fetch("/temperature/entries", { method:"POST", body: JSON.stringify(payload) });
    if (res.ok && res.json && res.json.ok) return { ok:true, entry_id: res.json.entry_id };
    // if network error: queue
    if (!res.ok && res.status === 0){
      queue.add({ type:"temp_upsert", payload });
      return { queued:true };
    }
    return { ok:false, error:(res.json && res.json.error) ? res.json.error : "Failed" };
  }

  async function deleteEntry(entryId){
    if (!navigator.onLine){
      queue.add({ type:"temp_delete", entry_id: entryId });
      return { queued:true };
    }
    const res = await api.fetch("/temperature/entries/" + encodeURIComponent(entryId), { method:"DELETE" });
    if (res.ok && res.json && res.json.ok) return { ok:true };
    if (!res.ok && res.status === 0){
      queue.add({ type:"temp_delete", entry_id: entryId });
      return { queued:true };
    }
    return { ok:false, error:(res.json && res.json.error) ? res.json.error : "Failed" };
  }

  async function createDevice(payload){
    const res = await api.fetch("/temperature/devices", { method:"POST", body: JSON.stringify(payload) });
    if (res.ok && res.json && res.json.ok) return { ok:true, device_id: res.json.device_id };
    return { ok:false, error:(res.json && res.json.error) ? res.json.error : "Failed" };
  }

  async function updateDevice(id, payload){
    const res = await api.fetch("/temperature/devices/" + encodeURIComponent(id), { method:"PUT", body: JSON.stringify(payload) });
    if (res.ok && res.json && res.json.ok) return { ok:true };
    return { ok:false, error:(res.json && res.json.error) ? res.json.error : "Failed" };
  }

  async function deactivateDevice(id){
    const res = await api.fetch("/temperature/devices/" + encodeURIComponent(id), { method:"DELETE" });
    if (res.ok && res.json && res.json.ok) return { ok:true };
    return { ok:false, error:(res.json && res.json.error) ? res.json.error : "Failed" };
  }

  function buildTempEntryMatrix(devices, entries){
    // entries: list of (entry_date, device_id, min_temp, max_temp, notes, id)
    // map by date->deviceId
    const byDate = {};
    entries.forEach(e=>{
      if (!byDate[e.entry_date]) byDate[e.entry_date] = {};
      byDate[e.entry_date][String(e.device_id)] = e;
    });
    return byDate;
  }

  function monthDays(monthStr){
    const m = (monthStr || "").trim();
    const parts = m.split("-");
    if (parts.length !== 2) return [];
    const y = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10);
    if (!y || !mo) return [];
    const start = new Date(y, mo-1, 1);
    const next = new Date(y, mo, 1);
    const days = [];
    for (let d = new Date(start); d < next; d.setDate(d.getDate()+1)){
      days.push(ymd(d));
    }
    return days;
  }

  function buildPrintableReportHtml(payload){
    // payload: {org_name, location_name, from, to, devices, entries}
    const orgName = payload.org_name || "Pharmacy";
    const locName = payload.location_name || "";
    const from = payload.from;
    const to = payload.to;
    const devices = payload.devices || [];
    const entries = payload.entries || [];

    // group entries by month
    const entriesByMonth = {};
    entries.forEach(e=>{
      const m = String(e.entry_date).slice(0,7);
      if (!entriesByMonth[m]) entriesByMonth[m] = [];
      entriesByMonth[m].push(e);
    });

    // set months list between from..to
    function listMonths(fromYmd, toYmd){
      const fy = parseInt(fromYmd.slice(0,4),10);
      const fm = parseInt(fromYmd.slice(5,7),10);
      const ty = parseInt(toYmd.slice(0,4),10);
      const tm = parseInt(toYmd.slice(5,7),10);
      const out = [];
      let y = fy, m = fm;
      while (y < ty || (y === ty && m <= tm)){
        out.push(String(y) + "-" + String(m).padStart(2,"0"));
        m++;
        if (m === 13){ m = 1; y++; }
      }
      return out;
    }

    const months = listMonths(from, to);
    const deviceCols = devices.slice().sort((a,b)=>a.id-b.id);

    function esc(s){
      return String(s||"").replace(/[&<>"']/g, c=>({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
      }[c]));
    }

    function cellText(e){
      if (!e) return "";
      const mn = (e.min_temp === null || e.min_temp === undefined) ? "" : Number(e.min_temp).toFixed(1);
      const mx = (e.max_temp === null || e.max_temp === undefined) ? "" : Number(e.max_temp).toFixed(1);
      if (mn && mx) return mn + " / " + mx;
      if (mn) return mn;
      if (mx) return mx;
      return "";
    }

    function inRange(d){
      return d >= from && d <= to;
    }

    let html = "";
    html += "<!doctype html><html><head><meta charset='utf-8'/><meta name='viewport' content='width=device-width, initial-scale=1'/>";
    html += "<title>Temperature Report</title>";
    html += "<style>";
    html += "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:18px}";
    html += "h1{margin:0 0 4px 0;font-size:20px}";
    html += ".meta{margin:0 0 14px 0;font-size:12px;color:#555}";
    html += ".month{margin-top:18px}";
    html += ".month h2{font-size:16px;margin:0 0 8px 0}";
    html += "table{width:100%;border-collapse:collapse;font-size:12px}";
    html += "th,td{border:1px solid #ccc;padding:6px 6px;vertical-align:top}";
    html += "th{background:#f2f2f2;text-align:left}";
    html += ".small{font-size:11px;color:#666}";
    html += "@media print{body{margin:10mm}}";
    html += "</style></head><body>";

    html += "<h1>" + esc(orgName) + " — Temperature Report</h1>";
    html += "<div class='meta'><div><b>Location:</b> " + esc(locName) + "</div><div><b>Date range:</b> " + esc(from) + " to " + esc(to) + "</div></div>";

    months.forEach(m=>{
      const allDays = monthDays(m);
      const days = allDays.filter(d=>inRange(d));
      const monthEntries = (entriesByMonth[m] || []).slice();
      const byDate = {};
      monthEntries.forEach(e=>{
        if (!byDate[e.entry_date]) byDate[e.entry_date] = {};
        byDate[e.entry_date][String(e.device_id)] = e;
      });

      html += "<div class='month'>";
      html += "<h2>" + esc(m) + "</h2>";
      html += "<table><thead><tr>";
      html += "<th style='width:110px'>Date</th>";
      deviceCols.forEach(dev=>{
        html += "<th>" + esc(dev.name) + "<div class='small'>" + esc(dev.device_type || "") + "</div></th>";
      });
      html += "</tr></thead><tbody>";

      days.forEach(d=>{
        html += "<tr>";
        html += "<td><b>" + esc(d) + "</b></td>";
        deviceCols.forEach(dev=>{
          const e = byDate[d] ? byDate[d][String(dev.id)] : null;
          html += "<td>" + esc(cellText(e)) + "</td>";
        });
        html += "</tr>";
      });

      html += "</tbody></table></div>";
    });

    html += "</body></html>";
    return html;
  }

  function printHtml(html){
    // print via hidden iframe (works in sandbox where confirm()/popups may not)
    let frame = document.getElementById("eikon-print-frame");
    if (!frame){
      frame = document.createElement("iframe");
      frame.id = "eikon-print-frame";
      frame.style.position = "fixed";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.width = "0";
      frame.style.height = "0";
      frame.style.border = "0";
      document.body.appendChild(frame);
    }
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(()=>{
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }, 250);
  }

  async function renderTemperature(main, user){
    main.innerHTML = "";

    const top = ui.el("div", { class:"eikon-topbar" }, [
      ui.el("div", {}, [
        ui.el("h1", {}, "Temperature"),
        ui.el("div", { class:"sub" }, (user.org_name || "Pharmacy") + (user.location_name ? (" — " + user.location_name) : ""))
      ]),
      ui.el("div", { class:"eikon-row" }, [
        ui.el("span", { class:"eikon-pill", id:"eikon-online-pill" }, [
          ui.el("span", { class:"dot", id:"eikon-online-dot" }),
          ui.el("span", { id:"eikon-online-text" }, "Checking…")
        ]),
        ui.el("button", { class:"eikon-btn secondary", type:"button", id:"eikon-flush" }, "Sync now")
      ])
    ]);

    const grid = ui.el("div", { class:"eikon-grid" });

    // LEFT: entry form + device quick list
    const left = ui.el("div", { class:"eikon-card" });
    const leftHeader = ui.el("div", { class:"eikon-card-header" }, [
      ui.el("div", {}, [
        ui.el("div", { class:"title" }, "Daily entry"),
        ui.el("div", { class:"hint" }, "Your rooms/fridges are defined under Devices.")
      ])
    ]);
    const leftBody = ui.el("div", { class:"eikon-card-body" });

    // RIGHT: entries list + report/print
    const right = ui.el("div", { class:"eikon-card" });
    const rightHeader = ui.el("div", { class:"eikon-card-header" }, [
      ui.el("div", {}, [
        ui.el("div", { class:"title" }, "Records & report"),
        ui.el("div", { class:"hint" }, "View month, delete records, and print date-range report.")
      ])
    ]);
    const rightBody = ui.el("div", { class:"eikon-card-body" });

    left.appendChild(leftHeader);
    left.appendChild(leftBody);
    right.appendChild(rightHeader);
    right.appendChild(rightBody);

    grid.appendChild(left);
    grid.appendChild(right);

    main.appendChild(top);
    main.appendChild(grid);

    const onlineDot = ui.qs("#eikon-online-dot", top);
    const onlineText = ui.qs("#eikon-online-text", top);
    const flushBtn = ui.qs("#eikon-flush", top);

    function refreshOnlinePill(){
      const q = queue.load();
      const queued = q.length;
      if (navigator.onLine){
        onlineDot.className = "dot ok";
        onlineText.textContent = queued ? ("Online • " + queued + " queued") : "Online • synced";
      } else {
        onlineDot.className = "dot warn";
        onlineText.textContent = queued ? ("Offline • " + queued + " queued") : "Offline • will queue";
      }
    }

    flushBtn.addEventListener("click", async ()=>{
      ui.setBusy(true, "Syncing queued items…");
      const r = await queue.flush();
      ui.setBusy(false);
      refreshOnlinePill();
      if (r && r.ok){
        ui.toast("Sync complete", "Sent: " + r.sent + " • Remaining: " + r.left);
      } else {
        ui.toast("Sync not possible", "Make sure you are online and logged in.");
      }
      await reloadAll();
    });

    window.addEventListener("online", refreshOnlinePill);
    window.addEventListener("offline", refreshOnlinePill);

    const state = {
      devices: [],
      entries: [],
      month: ym(new Date()),
      date: ymd(new Date()),
      tab: "records"
    };

    // Controls
    const monthIn = ui.el("input", { class:"eikon-input", type:"month", value: state.month });
    const dateIn = ui.el("input", { class:"eikon-input", type:"date", value: state.date });

    // left form container
    const deviceFormArea = ui.el("div", {});
    const saveBtn = ui.el("button", { class:"eikon-btn", type:"button" }, "Save day");
    const noteHint = ui.el("div", { class:"eikon-mini", style:"margin-top:10px" }, "Offline: entries are queued locally and synced later.");

    leftBody.appendChild(ui.el("div", { class:"eikon-row" }, [
      ui.el("div", { class:"grow" }, [
        ui.el("div", { class:"eikon-label" }, "Month"),
        monthIn
      ]),
      ui.el("div", { class:"grow" }, [
        ui.el("div", { class:"eikon-label" }, "Date"),
        dateIn
      ])
    ]));
    leftBody.appendChild(ui.el("div", { style:"height:12px" }));
    leftBody.appendChild(deviceFormArea);
    leftBody.appendChild(ui.el("div", { style:"height:12px" }));
    leftBody.appendChild(saveBtn);
    leftBody.appendChild(noteHint);

    // right body: tabs + content
    const tabs = ui.el("div", { class:"eikon-tabs" });
    const tabRecords = ui.el("button", { class:"eikon-tab active", type:"button" }, "Records");
    const tabDevices = ui.el("button", { class:"eikon-tab", type:"button" }, "Devices");
    const tabReport = ui.el("button", { class:"eikon-tab", type:"button" }, "Report / Print");

    tabs.appendChild(tabRecords);
    tabs.appendChild(tabDevices);
    tabs.appendChild(tabReport);
    rightBody.appendChild(tabs);

    const tabArea = ui.el("div", { style:"margin-top:12px" });
    rightBody.appendChild(tabArea);

    function setTab(t){
      state.tab = t;
      tabRecords.classList.toggle("active", t==="records");
      tabDevices.classList.toggle("active", t==="devices");
      tabReport.classList.toggle("active", t==="report");
      renderRightTab();
    }

    tabRecords.addEventListener("click", ()=>setTab("records"));
    tabDevices.addEventListener("click", ()=>setTab("devices"));
    tabReport.addEventListener("click", ()=>setTab("report"));

    monthIn.addEventListener("change", async ()=>{
      state.month = monthIn.value;
      // if date outside month, snap
      if (String(state.date).slice(0,7) !== state.month){
        state.date = state.month + "-01";
        dateIn.value = state.date;
      }
      await reloadAll();
    });

    dateIn.addEventListener("change", ()=>{
      state.date = dateIn.value;
      renderLeftForm();
    });

    function findEntryFor(dateStr, deviceId){
      for (let i=0;i<state.entries.length;i++){
        const e = state.entries[i];
        if (e.entry_date === dateStr && Number(e.device_id) === Number(deviceId)) return e;
      }
      return null;
    }

    function renderLeftForm(){
      deviceFormArea.innerHTML = "";

      const activeDevices = state.devices.filter(d=>Number(d.active) === 1);

      if (!activeDevices.length){
        deviceFormArea.appendChild(ui.el("div", { style:"color:var(--muted); line-height:1.55" },
          "No active devices. Go to Devices tab and add rooms/fridges."));
        return;
      }

      const byDevice = {};
      activeDevices.forEach(d=>{
        const ex = findEntryFor(state.date, d.id);
        byDevice[String(d.id)] = {
          entry_id: ex ? ex.id : null,
          min_temp: ex && ex.min_temp !== null && ex.min_temp !== undefined ? Number(ex.min_temp).toFixed(1) : "",
          max_temp: ex && ex.max_temp !== null && ex.max_temp !== undefined ? Number(ex.max_temp).toFixed(1) : "",
          notes: ex && ex.notes ? String(ex.notes) : ""
        };
      });

      const rows = [];

      activeDevices.forEach(dev=>{
        const minI = ui.el("input", { class:"eikon-input", type:"number", step:"0.1", inputmode:"decimal", placeholder:"Min", value: byDevice[String(dev.id)].min_temp });
        const maxI = ui.el("input", { class:"eikon-input", type:"number", step:"0.1", inputmode:"decimal", placeholder:"Max", value: byDevice[String(dev.id)].max_temp });
        const noteI = ui.el("input", { class:"eikon-input", type:"text", placeholder:"Notes (optional)", value: byDevice[String(dev.id)].notes });

        // store refs
        byDevice[String(dev.id)].minEl = minI;
        byDevice[String(dev.id)].maxEl = maxI;
        byDevice[String(dev.id)].noteEl = noteI;

        const limits = [];
        if (dev.min_limit !== null && dev.min_limit !== undefined) limits.push("min " + Number(dev.min_limit).toFixed(1));
        if (dev.max_limit !== null && dev.max_limit !== undefined) limits.push("max " + Number(dev.max_limit).toFixed(1));

        const header = ui.el("div", { style:"display:flex; align-items:flex-start; justify-content:space-between; gap:10px" }, [
          ui.el("div", {}, [
            ui.el("div", { style:"font-weight:900" }, dev.name),
            ui.el("div", { class:"eikon-mini" }, (dev.device_type || "") + (limits.length ? (" • limits: " + limits.join(", ")) : ""))
          ])
        ]);

        const row = ui.el("div", {
          style:"padding:12px; border:1px solid rgba(255,255,255,0.08); border-radius:14px; background:rgba(0,0,0,0.18); margin-bottom:10px"
        }, [
          header,
          ui.el("div", { style:"height:10px" }),
          ui.el("div", { class:"eikon-row" }, [
            ui.el("div", { style:"width:140px" }, minI),
            ui.el("div", { style:"width:140px" }, maxI),
            ui.el("div", { class:"grow" }, noteI)
          ])
        ]);

        rows.push(row);
      });

      rows.forEach(r=>deviceFormArea.appendChild(r));
    }

    async function saveDay(){
      const activeDevices = state.devices.filter(d=>Number(d.active) === 1);
      if (!activeDevices.length){
        ui.toast("No devices", "Add devices first.");
        return;
      }
      if (!state.date){
        ui.toast("Missing date", "Choose a date.");
        return;
      }

      // validate & save per device
      ui.setBusy(true, "Saving entries…");
      let okCount = 0;
      let queuedCount = 0;
      let failCount = 0;

      // capture values from current DOM form
      const cards = ui.qsa("[data-device-id]", deviceFormArea); // not used in this version
      (void cards);

      for (let i=0;i<activeDevices.length;i++){
        const dev = activeDevices[i];

        // find inputs by re-reading from DOM: simplest is to query card by text, but we kept no ids.
        // so: rebuild a small search based on order (same order as activeDevices)
        const cardNodes = Array.from(deviceFormArea.children);
        const card = cardNodes[i];
        const inputs = card.querySelectorAll("input.eikon-input");
        const minEl = inputs[0];
        const maxEl = inputs[1];
        const noteEl = inputs[2];

        const payload = {
          device_id: dev.id,
          entry_date: state.date,
          min_temp: clamp1(minEl.value),
          max_temp: clamp1(maxEl.value),
          notes: (noteEl.value || "").trim()
        };

        const r = await upsertEntry(payload);
        if (r && r.ok) okCount++;
        else if (r && r.queued) queuedCount++;
        else failCount++;
      }

      ui.setBusy(false);
      refreshOnlinePill();

      if (failCount === 0){
        ui.toast("Saved", okCount ? ("Saved " + okCount + " entries.") : ("Queued " + queuedCount + " entries."));
      } else {
        ui.toast("Partial save", "Saved: " + okCount + " • Queued: " + queuedCount + " • Failed: " + failCount);
      }

      await reloadAll();
    }

    saveBtn.addEventListener("click", saveDay);

    function renderRightTab(){
      tabArea.innerHTML = "";
      if (state.tab === "records"){
        tabArea.appendChild(renderRecordsTab());
      } else if (state.tab === "devices"){
        tabArea.appendChild(renderDevicesTab());
      } else {
        tabArea.appendChild(renderReportTab());
      }
    }

    function statusForEntry(dev, entry){
      if (!entry) return { dot:"warn", text:"Missing" };
      const minL = (dev.min_limit !== null && dev.min_limit !== undefined) ? Number(dev.min_limit) : null;
      const maxL = (dev.max_limit !== null && dev.max_limit !== undefined) ? Number(dev.max_limit) : null;
      const mn = (entry.min_temp !== null && entry.min_temp !== undefined) ? Number(entry.min_temp) : null;
      const mx = (entry.max_temp !== null && entry.max_temp !== undefined) ? Number(entry.max_temp) : null;

      let bad = false;
      if (minL !== null && mn !== null && mn < minL) bad = true;
      if (maxL !== null && mx !== null && mx > maxL) bad = true;

      return bad ? { dot:"bad", text:"Out of limit" } : { dot:"ok", text:"OK" };
    }

    function renderRecordsTab(){
      const wrap = ui.el("div", {});
      const activeDevices = state.devices.filter(d=>Number(d.active)===1);
      const byDate = buildTempEntryMatrix(state.devices, state.entries);

      // completeness indicator for selected date
      let complete = true;
      activeDevices.forEach(dev=>{
        const e = (byDate[state.date] && byDate[state.date][String(dev.id)]) ? byDate[state.date][String(dev.id)] : null;
        if (!e) complete = false;
      });

      wrap.appendChild(ui.el("div", { class:"eikon-row" }, [
        ui.el("span", { class:"eikon-badge" }, [
          ui.el("span", { class:"dot " + (complete ? "ok" : "warn") }),
          ui.el("span", {}, complete ? "Complete day" : "Incomplete day")
        ]),
        ui.el("span", { class:"eikon-badge" }, [
          ui.el("span", { class:"dot " + (navigator.onLine ? "ok" : "warn") }),
          ui.el("span", {}, navigator.onLine ? "Online" : "Offline")
        ]),
        ui.el("span", { class:"eikon-badge" }, [
          ui.el("span", { class:"dot " + (queue.load().length ? "warn" : "ok") }),
          ui.el("span", {}, queue.load().length ? ("Queued: " + queue.load().length) : "Queue empty")
        ])
      ]));

      wrap.appendChild(ui.el("div", { style:"height:12px" }));

      const tableWrap = ui.el("div", { class:"eikon-table-wrap" });
      const table = ui.el("table", { class:"eikon-table" });
      const thead = ui.el("thead", {});
      const trh = ui.el("tr", {});
      trh.appendChild(ui.el("th", {}, "Date"));
      trh.appendChild(ui.el("th", {}, "Device"));
      trh.appendChild(ui.el("th", {}, "Min"));
      trh.appendChild(ui.el("th", {}, "Max"));
      trh.appendChild(ui.el("th", {}, "Status"));
      trh.appendChild(ui.el("th", {}, "Notes"));
      trh.appendChild(ui.el("th", {}, "Actions"));
      thead.appendChild(trh);

      const tbody = ui.el("tbody", {});
      const sorted = state.entries.slice().sort((a,b)=>{
        if (a.entry_date === b.entry_date) return Number(a.device_id) - Number(b.device_id);
        return a.entry_date < b.entry_date ? 1 : -1;
      });

      sorted.forEach(e=>{
        const dev = state.devices.find(d=>Number(d.id)===Number(e.device_id)) || { name:"Device", device_type:"", min_limit:null, max_limit:null };
        const st = statusForEntry(dev, e);

        const delBtn = ui.el("button", { class:"eikon-btn danger", type:"button", style:"padding:8px 10px; border-radius:12px" }, "Delete");
        delBtn.addEventListener("click", async ()=>{
          const ok = await ui.confirmDialog("Delete record", "Delete this temperature entry for " + e.entry_date + " — " + dev.name + "?");
          if (!ok) return;
          ui.setBusy(true, "Deleting…");
          const r = await deleteEntry(e.id);
          ui.setBusy(false);
          refreshOnlinePill();
          if (r && r.ok){
            ui.toast("Deleted", "Record deleted.");
          } else if (r && r.queued){
            ui.toast("Queued", "Delete queued (offline). It will sync later.");
          } else {
            ui.toast("Failed", "Could not delete.");
          }
          await reloadAll();
        });

        const tr = ui.el("tr", {});
        tr.appendChild(ui.el("td", {}, e.entry_date));
        tr.appendChild(ui.el("td", {}, dev.name));
        tr.appendChild(ui.el("td", {}, (e.min_temp === null || e.min_temp === undefined) ? "" : Number(e.min_temp).toFixed(1)));
        tr.appendChild(ui.el("td", {}, (e.max_temp === null || e.max_temp === undefined) ? "" : Number(e.max_temp).toFixed(1)));
        tr.appendChild(ui.el("td", {}, ui.el("span", { class:"eikon-pill" }, [
          ui.el("span", { class:"dot " + st.dot }),
          ui.el("span", {}, st.text)
        ])));
        tr.appendChild(ui.el("td", {}, e.notes || ""));
        const actionsTd = ui.el("td", { class:"actions" });
        actionsTd.appendChild(delBtn);
        tr.appendChild(actionsTd);

        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      tableWrap.appendChild(table);

      wrap.appendChild(tableWrap);
      return wrap;
    }

    function renderDevicesTab(){
      const wrap = ui.el("div", {});

      const intro = ui.el("div", { style:"color:var(--muted); line-height:1.55; margin-bottom:10px" },
        "Add and rename your rooms/fridges. Only active devices are required for a “complete day”. Deactivated devices keep history.");

      wrap.appendChild(intro);

      // add form
      const nameIn = ui.el("input", { class:"eikon-input", type:"text", placeholder:"Device name (e.g. POYC Fridge)" });
      const typeSel = ui.el("select", { class:"eikon-select" }, [
        ui.el("option", { value:"room" }, "room"),
        ui.el("option", { value:"fridge" }, "fridge"),
        ui.el("option", { value:"other" }, "other")
      ]);
      const minIn = ui.el("input", { class:"eikon-input", type:"number", step:"0.1", placeholder:"Min limit (optional)" });
      const maxIn = ui.el("input", { class:"eikon-input", type:"number", step:"0.1", placeholder:"Max limit (optional)" });
      const addBtn = ui.el("button", { class:"eikon-btn", type:"button" }, "Add device");

      wrap.appendChild(ui.el("div", { class:"eikon-row" }, [
        ui.el("div", { class:"grow" }, [
          ui.el("div", { class:"eikon-label" }, "Name"),
          nameIn
        ]),
        ui.el("div", { style:"width:140px" }, [
          ui.el("div", { class:"eikon-label" }, "Type"),
          typeSel
        ])
      ]));

      wrap.appendChild(ui.el("div", { class:"eikon-row" }, [
        ui.el("div", { style:"width:180px" }, [
          ui.el("div", { class:"eikon-label" }, "Min limit"),
          minIn
        ]),
        ui.el("div", { style:"width:180px" }, [
          ui.el("div", { class:"eikon-label" }, "Max limit"),
          maxIn
        ]),
        ui.el("div", { style:"padding-top:28px" }, addBtn)
      ]));

      wrap.appendChild(ui.el("div", { style:"height:14px" }));

      addBtn.addEventListener("click", async ()=>{
        const name = (nameIn.value || "").trim();
        const device_type = (typeSel.value || "other").trim();
        const min_limit = minIn.value === "" ? null : clamp1(minIn.value);
        const max_limit = maxIn.value === "" ? null : clamp1(maxIn.value);

        if (!name){
          ui.toast("Missing name", "Enter a device name.");
          return;
        }

        ui.setBusy(true, "Adding device…");
        const r = await createDevice({ name, device_type, min_limit, max_limit });
        ui.setBusy(false);

        if (r && r.ok){
          nameIn.value = "";
          minIn.value = "";
          maxIn.value = "";
          ui.toast("Added", "Device created.");
          await reloadAll();
        } else {
          ui.toast("Failed", r && r.error ? r.error : "Could not add device.");
        }
      });

      // list devices
      const listWrap = ui.el("div", { class:"eikon-table-wrap" });
      const table = ui.el("table", { class:"eikon-table", style:"min-width:820px" });
      const thead = ui.el("thead", {});
      const trh = ui.el("tr", {});
      ["Name","Type","Min","Max","Active","Actions"].forEach(t=>trh.appendChild(ui.el("th", {}, t)));
      thead.appendChild(trh);

      const tbody = ui.el("tbody", {});
      state.devices.slice().sort((a,b)=>Number(a.id)-Number(b.id)).forEach(d=>{
        const editBtn = ui.el("button", { class:"eikon-btn secondary", type:"button", style:"padding:8px 10px;border-radius:12px" }, "Edit");
        const deactBtn = ui.el("button", { class:"eikon-btn danger", type:"button", style:"padding:8px 10px;border-radius:12px;margin-left:8px" }, (Number(d.active)===1 ? "Deactivate" : "Inactive"));

        deactBtn.disabled = (Number(d.active)!==1);

        editBtn.addEventListener("click", ()=>{
          const nameE = ui.el("input", { class:"eikon-input", type:"text", value: d.name || "" });
          const typeE = ui.el("select", { class:"eikon-select" }, [
            ui.el("option", { value:"room", selected: (d.device_type==="room") }, "room"),
            ui.el("option", { value:"fridge", selected: (d.device_type==="fridge") }, "fridge"),
            ui.el("option", { value:"other", selected: (d.device_type==="other") }, "other")
          ]);
          const minE = ui.el("input", { class:"eikon-input", type:"number", step:"0.1", value: (d.min_limit===null||d.min_limit===undefined) ? "" : Number(d.min_limit).toFixed(1) });
          const maxE = ui.el("input", { class:"eikon-input", type:"number", step:"0.1", value: (d.max_limit===null||d.max_limit===undefined) ? "" : Number(d.max_limit).toFixed(1) });

          const body = ui.el("div", {}, [
            ui.el("div", { class:"eikon-label" }, "Name"),
            nameE,
            ui.el("div", { class:"eikon-label" }, "Type"),
            typeE,
            ui.el("div", { class:"eikon-row" }, [
              ui.el("div", { class:"grow" }, [
                ui.el("div", { class:"eikon-label" }, "Min limit"),
                minE
              ]),
              ui.el("div", { class:"grow" }, [
                ui.el("div", { class:"eikon-label" }, "Max limit"),
                maxE
              ])
            ])
          ]);

          ui.showModal({
            title: "Edit device",
            bodyNode: body,
            buttons: [
              { label:"Cancel", kind:"secondary", onClick:(close)=>close(false) },
              { label:"Save", onClick: async (close)=>{
                  const name = (nameE.value || "").trim();
                  const device_type = (typeE.value || "other").trim();
                  const min_limit = minE.value === "" ? null : clamp1(minE.value);
                  const max_limit = maxE.value === "" ? null : clamp1(maxE.value);
                  if (!name){
                    ui.toast("Missing name", "Name cannot be empty.");
                    return;
                  }
                  close(true);
                  ui.setBusy(true, "Saving…");
                  const r = await updateDevice(d.id, { name, device_type, min_limit, max_limit, active: true });
                  ui.setBusy(false);
                  if (r && r.ok){
                    ui.toast("Saved", "Device updated.");
                    await reloadAll();
                  } else {
                    ui.toast("Failed", r && r.error ? r.error : "Update failed.");
                  }
                }
              }
            ]
          });
        });

        deactBtn.addEventListener("click", async ()=>{
          const ok = await ui.confirmDialog("Deactivate device", "Deactivate '" + d.name + "'? History is kept, but it will no longer be required for daily completion.");
          if (!ok) return;
          ui.setBusy(true, "Deactivating…");
          const r = await deactivateDevice(d.id);
          ui.setBusy(false);
          if (r && r.ok){
            ui.toast("Deactivated", "Device deactivated.");
            await reloadAll();
          } else {
            ui.toast("Failed", r && r.error ? r.error : "Could not deactivate.");
          }
        });

        const tr = ui.el("tr", {});
        tr.appendChild(ui.el("td", {}, d.name || ""));
        tr.appendChild(ui.el("td", {}, d.device_type || ""));
        tr.appendChild(ui.el("td", {}, (d.min_limit===null||d.min_limit===undefined) ? "" : Number(d.min_limit).toFixed(1)));
        tr.appendChild(ui.el("td", {}, (d.max_limit===null||d.max_limit===undefined) ? "" : Number(d.max_limit).toFixed(1)));
        tr.appendChild(ui.el("td", {}, Number(d.active)===1 ? "Yes" : "No"));
        const actions = ui.el("td", { class:"actions" });
        actions.appendChild(editBtn);
        actions.appendChild(deactBtn);
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });

      table.appendChild(thead);
      table.appendChild(tbody);
      listWrap.appendChild(table);

      wrap.appendChild(listWrap);
      return wrap;
    }

    function renderReportTab(){
      const wrap = ui.el("div", {});
      wrap.appendChild(ui.el("div", { style:"color:var(--muted); line-height:1.55; margin-bottom:10px" },
        "Print a temperature report for a date range. Months are separated into tables."));

      const fromIn = ui.el("input", { class:"eikon-input", type:"date", value: state.month + "-01" });
      const toIn = ui.el("input", { class:"eikon-input", type:"date", value: state.date });

      const btn = ui.el("button", { class:"eikon-btn", type:"button" }, "Generate & Print");

      wrap.appendChild(ui.el("div", { class:"eikon-row" }, [
        ui.el("div", { class:"grow" }, [
          ui.el("div", { class:"eikon-label" }, "From"),
          fromIn
        ]),
        ui.el("div", { class:"grow" }, [
          ui.el("div", { class:"eikon-label" }, "To"),
          toIn
        ]),
        ui.el("div", { style:"padding-top:28px" }, btn)
      ]));

      btn.addEventListener("click", async ()=>{
        const from = (fromIn.value || "").trim();
        const to = (toIn.value || "").trim();
        if (!from || !to){
          ui.toast("Missing dates", "Select from/to.");
          return;
        }
        if (to < from){
          ui.toast("Invalid range", "'To' must be after 'From'.");
          return;
        }
        ui.setBusy(true, "Preparing report…");
        const res = await api.fetch("/temperature/report?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to), { method:"GET" });
        ui.setBusy(false);
        if (!(res.ok && res.json && res.json.ok)){
          ui.toast("Failed", (res.json && res.json.error) ? res.json.error : "Could not generate report.");
          return;
        }
        const html = buildPrintableReportHtml(res.json);
        printHtml(html);
      });

      return wrap;
    }

    async function reloadAll(){
      refreshOnlinePill();
      ui.setBusy(true, "Loading temperature data…");
      const devices = await fetchDevices();
      const entries = await fetchEntries(state.month);
      ui.setBusy(false);

      state.devices = devices || [];
      state.entries = entries || [];

      renderLeftForm();
      renderRightTab();
      refreshOnlinePill();
    }

    refreshOnlinePill();
    queue.start();
    await reloadAll();
  }

  async function render(root){
    // Ensure logged in user available; if not, show login
    ui.setBusy(true, "Loading…");
    const user = await auth.authMe();
    ui.setBusy(false);

    if (!user){
      auth.renderLogin(root, async ()=>{
        const u = await auth.authMe();
        if (!u){
          ui.toast("Login problem", "Please try again.");
          return;
        }
        buildLayout(root, u);
      });
      return;
    }

    buildLayout(root, user);
  }

  EIKON.modules.temperature = { render };

})();
