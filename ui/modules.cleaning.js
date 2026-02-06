(function(){
  "use strict";

  const EIKON = window.EIKON;

  function meta(){
    return {
      order: 20,
      key: "cleaning",
      title: "Cleaning",
      subtitle: "Cleaner register",
      icon: "🧼"
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

  function hm(v){
    const s = String(v||"").trim();
    return s;
  }

  async function render(root, user){
    root.append(
      EIKON.el("div", { class:"card" },
        EIKON.el("h2", null, "Cleaning"),
        EIKON.el("p", { class:"sub" }, "Register of cleaning visits. Add past dates, edit, delete, and generate reports.")
      )
    );

    const state = {
      month: monthNow(),
      entries: [],
      loading: false,
      editId: 0
    };

    const monthCard = EIKON.el("div", { class:"card" });
    const monthInput = EIKON.el("input", {
      type:"month",
      value: normalizeMonthInput(state.month),
      onchange: async (e)=>{
        state.month = normalizeMonthInput(e.target.value);
        await reload();
      }
    });

    const btnPrev = EIKON.el("button", { class:"btn", onclick: async ()=>{
      state.month = EIKON.monthAdd(state.month, -1);
      await reload();
    }}, "◀ Prev");

    const btnNext = EIKON.el("button", { class:"btn", onclick: async ()=>{
      state.month = EIKON.monthAdd(state.month, +1);
      await reload();
    }}, "Next ▶");

    const btnReload = EIKON.el("button", { class:"btn", onclick: reload }, "Reload");

    const btnPrint = EIKON.el("button", { class:"btn primary", onclick: ()=>openPrintModal() }, "Print report");

    monthCard.append(
      EIKON.el("h2", null, "Month"),
      EIKON.el("div", { class:"grid cols-4" },
        EIKON.el("div", { class:"field" },
          EIKON.el("label", null, "Month"),
          monthInput
        ),
        EIKON.el("div", { class:"field" },
          EIKON.el("label", null, "Actions"),
          EIKON.el("div", { style:"display:flex;gap:10px;flex-wrap:wrap" }, btnPrev, btnNext, btnReload, btnPrint)
        ),
        EIKON.el("div", { class:"field" },
          EIKON.el("label", null, "Status"),
          EIKON.el("div", { class:"pill" }, state.loading ? "Loading..." : ("Entries: " + state.entries.length))
        ),
        EIKON.el("div", { class:"field" },
          EIKON.el("label", null, "Tip"),
          EIKON.el("div", { class:"pill" }, "Click Edit to load entry into the form.")
        )
      )
    );

    root.append(monthCard);

    const formCard = EIKON.el("div", { class:"card" },
      EIKON.el("h2", null, "Add / Edit cleaning entry")
    );

    const fDate = EIKON.el("input", { type:"date", value: EIKON.todayYmd() });
    const fIn = EIKON.el("input", { type:"time", value: EIKON.nowHmRound() });
    const fOut = EIKON.el("input", { type:"time", value: "" });
    const fCleaner = EIKON.el("input", { type:"text", placeholder:"Cleaner name (e.g. Maria)" });
    const fStaff = EIKON.el("input", { type:"text", placeholder:"Staff on duty (e.g. John)" });
    const fNotes = EIKON.el("textarea", { placeholder:"Optional notes..." });

    const btnSave = EIKON.el("button", { class:"btn primary", onclick: save }, "Save entry");
    const btnClear = EIKON.el("button", { class:"btn", onclick: clearForm }, "Clear");

    formCard.append(
      EIKON.el("div", { class:"grid cols-4" },
        EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Date"), fDate),
        EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Time in"), fIn),
        EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Time out (optional)"), fOut),
        EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Cleaner name"), fCleaner)
      ),
      EIKON.el("div", { class:"grid cols-2" },
        EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Staff name"), fStaff),
        EIKON.el("div", { class:"field" }, EIKON.el("label", null, "Notes (optional)"), fNotes)
      ),
      EIKON.el("div", { style:"display:flex;gap:10px;flex-wrap:wrap" }, btnSave, btnClear)
    );

    root.append(formCard);

    const listCard = EIKON.el("div", { class:"card" },
      EIKON.el("h2", null, "Cleaning entries")
    );
    const tableWrap = EIKON.el("div", { class:"tablewrap" });
    const table = EIKON.el("table", null);
    const thead = EIKON.el("thead", null,
      EIKON.el("tr", null,
        EIKON.el("th", null, "Date"),
        EIKON.el("th", null, "Time In"),
        EIKON.el("th", null, "Time Out"),
        EIKON.el("th", null, "Cleaner"),
        EIKON.el("th", null, "Staff"),
        EIKON.el("th", null, "Notes"),
        EIKON.el("th", null, "Actions")
      )
    );
    const tbody = EIKON.el("tbody", null);
    table.append(thead, tbody);
    tableWrap.append(table);
    listCard.append(tableWrap);
    root.append(listCard);

    function drawTable(){
      tbody.innerHTML = "";
      if (!state.entries.length){
        tbody.append(EIKON.el("tr", null,
          EIKON.el("td", { colspan:"7", class:"small" }, "No entries for this month.")
        ));
        return;
      }

      for (const e of state.entries){
        const btnEdit = EIKON.el("button", { class:"btn", onclick: ()=>{
          state.editId = e.id;
          fDate.value = e.entry_date || EIKON.todayYmd();
          fIn.value = hm(e.time_in || "");
          fOut.value = hm(e.time_out || "");
          fCleaner.value = e.cleaner_name || "";
          fStaff.value = e.staff_name || "";
          fNotes.value = e.notes || "";
          EIKON.toast("Loaded into form (edit then Save)", "ok");
        }}, "Edit");

        const btnDel = EIKON.el("button", { class:"btn danger", onclick: async ()=>{
          const ok = await EIKON.confirmDialog("Delete entry?", "This will permanently delete this cleaning entry:\n\n" + EIKON.ymdToDmy(e.entry_date) + " · " + (e.cleaner_name || ""));
          if (!ok) return;
          try{
            await EIKON.apiFetch("/cleaning/entries/" + e.id, { method:"DELETE" });
            EIKON.toast("Deleted", "ok");
            await reload();
            if (state.editId === e.id) clearForm();
          } catch(err){
            EIKON.toast(err && err.message ? err.message : "Delete failed", "err");
          }
        }}, "Delete");

        tbody.append(EIKON.el("tr", null,
          EIKON.el("td", null, EIKON.ymdToDmy(e.entry_date)),
          EIKON.el("td", null, e.time_in || ""),
          EIKON.el("td", null, e.time_out || ""),
          EIKON.el("td", null, e.cleaner_name || ""),
          EIKON.el("td", null, e.staff_name || ""),
          EIKON.el("td", null, e.notes || ""),
          EIKON.el("td", null, EIKON.el("div", { class:"row-actions" }, btnEdit, btnDel))
        ));
      }
    }

    function clearForm(){
      state.editId = 0;
      fDate.value = EIKON.todayYmd();
      fIn.value = EIKON.nowHmRound();
      fOut.value = "";
      fCleaner.value = "";
      fStaff.value = "";
      fNotes.value = "";
    }

    async function save(){
      const entry_date = (fDate.value || "").trim();
      const time_in = (fIn.value || "").trim();
      const time_out = (fOut.value || "").trim();
      const cleaner_name = (fCleaner.value || "").trim();
      const staff_name = (fStaff.value || "").trim();
      const notes = (fNotes.value || "").trim();

      if (!entry_date){
        EIKON.toast("Select a date", "warn");
        return;
      }
      if (!time_in){
        EIKON.toast("Enter time in", "warn");
        return;
      }
      if (!cleaner_name){
        EIKON.toast("Enter cleaner name", "warn");
        return;
      }
      if (!staff_name){
        EIKON.toast("Enter staff name", "warn");
        return;
      }

      btnSave.disabled = true;
      try{
        if (!state.editId){
          await EIKON.apiFetch("/cleaning/entries", {
            method:"POST",
            body:{ entry_date, time_in, time_out, cleaner_name, staff_name, notes }
          });
          EIKON.toast("Saved", "ok");
        } else {
          await EIKON.apiFetch("/cleaning/entries/" + state.editId, {
            method:"PUT",
            body:{ entry_date, time_in, time_out, cleaner_name, staff_name, notes }
          });
          EIKON.toast("Updated", "ok");
        }
        await reload();
        clearForm();
      } catch(e){
        EIKON.toast(e && e.message ? e.message : "Save failed", "err");
      } finally {
        btnSave.disabled = false;
      }
    }

    async function reload(){
      state.loading = true;
      drawTable();
      try{
        const month = normalizeMonthInput(state.month);
        const data = await EIKON.apiFetch("/cleaning/entries?month=" + encodeURIComponent(month), { method:"GET" });
        state.entries = (data && data.entries) ? data.entries : [];
      } catch(e){
        EIKON.toast(e && e.message ? e.message : "Load failed", "err");
      } finally {
        state.loading = false;
        drawTable();
      }
    }

    function openPrintModal(){
      const today = EIKON.todayYmd();
      const from = EIKON.el("input", { type:"date", value: today });
      const to = EIKON.el("input", { type:"date", value: today });

      EIKON.showModal("Cleaning report", "Choose date range:", [
        {
          label:"Generate & Print",
          kind:"primary",
          keepOpen:true,
          onClick: async ()=>{
            try{
              const data = await EIKON.apiFetch("/cleaning/report?from=" + encodeURIComponent(from.value) + "&to=" + encodeURIComponent(to.value), { method:"GET" });
              const html = buildReportHtml(data);
              const printed = EIKON.tryPrintHtml(html, "Cleaning Report");
              if (!printed){
                EIKON.showModal("Print blocked", "Your page is sandboxed (GoDaddy). Use Download HTML, open the downloaded file, then print (Ctrl+P).", [
                  { label:"Download HTML", kind:"primary", onClick: ()=>EIKON.downloadTextFile("cleaning-report.html", html) },
                  { label:"Close", kind:"ghost" }
                ]);
              }
            } catch(e){
              EIKON.toast(e && e.message ? e.message : "Report failed", "err");
            }
          }
        },
        {
          label:"Download HTML",
          kind:"ghost",
          keepOpen:true,
          onClick: async ()=>{
            try{
              const data = await EIKON.apiFetch("/cleaning/report?from=" + encodeURIComponent(from.value) + "&to=" + encodeURIComponent(to.value), { method:"GET" });
              const html = buildReportHtml(data);
              EIKON.downloadTextFile("cleaning-report.html", html);
              EIKON.toast("Downloaded HTML", "ok");
            } catch(e){
              EIKON.toast(e && e.message ? e.message : "Report failed", "err");
            }
          }
        },
        { label:"Close", kind:"ghost" }
      ]);

      // Hack: add inputs into the latest modal (created by showModal)
      const overlays = document.querySelectorAll(".modal-overlay");
      const last = overlays[overlays.length-1];
      if (last){
        const box = last.querySelector(".modal");
        if (box){
          const insert = EIKON.el("div", { class:"grid cols-2", style:"margin:10px 0 8px 0" },
            EIKON.el("div", { class:"field" }, EIKON.el("label", null, "From"), from),
            EIKON.el("div", { class:"field" }, EIKON.el("label", null, "To"), to)
          );
          box.insertBefore(insert, box.querySelector(".modal-actions"));
        }
      }
    }

    function buildReportHtml(data){
      const org = EIKON.escapeHtml((data && data.org_name) ? data.org_name : "");
      const loc = EIKON.escapeHtml((data && data.location_name) ? data.location_name : "");
      const from = EIKON.escapeHtml((data && data.from) ? data.from : "");
      const to = EIKON.escapeHtml((data && data.to) ? data.to : "");
      const entries = (data && data.entries) ? data.entries : [];

      let rows = "";
      for (const e of entries){
        rows += `<tr>
<td>${EIKON.escapeHtml(EIKON.ymdToDmy(e.entry_date))}</td>
<td>${EIKON.escapeHtml(e.time_in || "")}</td>
<td>${EIKON.escapeHtml(e.time_out || "")}</td>
<td>${EIKON.escapeHtml(e.cleaner_name || "")}</td>
<td>${EIKON.escapeHtml(e.staff_name || "")}</td>
<td>${EIKON.escapeHtml(e.notes || "")}</td>
</tr>`;
      }

      return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Cleaning Report</title>
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
  <h1>Cleaning Report</h1>
  <p class="sub">${org} · ${loc}<br/>${from} → ${to}</p>
  <table>
    <thead>
      <tr>
        <th>Date</th><th>Time In</th><th>Time Out</th><th>Cleaner</th><th>Staff</th><th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows || "<tr><td colspan='6'>No entries</td></tr>"}
    </tbody>
  </table>
</body>
</html>`;
    }

    await reload();
  }

  EIKON.registerModule("cleaning", { meta: meta(), render });
})();
