/* ui/modules.cleaning.js
   Cleaning register + report printing
   Worker endpoints:
     GET    /cleaning/entries?month=YYYY-MM
     POST   /cleaning/entries
     PUT    /cleaning/entries/:id
     DELETE /cleaning/entries/:id
     GET    /cleaning/report?from=YYYY-MM-DD&to=YYYY-MM-DD
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

  function isValidHm(s) {
    const v = String(s || "").trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
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

  function buildReportHtml(payload) {
    const orgName = escapeHtml(payload.org_name || "");
    const locName = escapeHtml(payload.location_name || "");
    const from = escapeHtml(payload.from || "");
    const to = escapeHtml(payload.to || "");

    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    const rowsHtml = entries.map((e) => {
      const date = escapeHtml(e.entry_date || "");
      const timeIn = escapeHtml(e.time_in || "");
      const timeOut = escapeHtml(e.time_out || "");
      const cleaner = escapeHtml(e.cleaner_name || "");
      const staff = escapeHtml(e.staff_name || "");
      const notes = escapeHtml(e.notes || "");
      return `
        <tr>
          <td>${date}</td>
          <td>${timeIn}</td>
          <td>${timeOut}</td>
          <td>${cleaner}</td>
          <td>${staff}</td>
          <td>${notes}</td>
        </tr>
      `;
    }).join("");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Cleaning Report ${from} to ${to}</title>
<style>
  body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 24px; color:#111; }
  h1{ margin:0 0 6px 0; font-size: 20px; }
  .sub{ color:#444; margin:0 0 18px 0; }
  table{ width:100%; border-collapse:collapse; font-size: 12px; }
  th, td{ border:1px solid #222; padding: 8px 8px; vertical-align: top; }
  th{ background:#f2f2f2; text-align:left; }
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
  <h1>Cleaning Report</h1>
  <p class="sub"><b>${orgName}</b> — ${locName}<br/>Range: <b>${from}</b> to <b>${to}</b></p>

  <div class="actions">
    <button onclick="window.print()">Print</button>
    <button class="secondary" onclick="window.close()">Close</button>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Time In</th>
        <th>Time Out</th>
        <th>Cleaner</th>
        <th>Staff</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || `<tr><td colspan="6">No entries in this range.</td></tr>`}
    </tbody>
  </table>

  <script>
    setTimeout(function(){ try{ window.print(); }catch(e){} }, 400);
  </script>
</body>
</html>`;
    return html;
  }

  E.modules = E.modules || {};

  E.modules.cleaning = {
    key: "cleaning",
    title: "Cleaning",

    render: function (root) {
      root.innerHTML = "";

      const state = {
        tab: "register",
        month: ymNowLocal(),
        entries: [],
        editingId: null
      };

      const header = el("div", { class: "eikon-topbar" },
        el("div", { class: "eikon-title" }, "Cleaning"),
        el("div", { class: "eikon-top-actions no-print" })
      );

      const card = el("div", { class: "eikon-card" });

      const tabs = el("div", { class: "eikon-tabs no-print" });
      const tabRegister = el("button", { class: "eikon-tab active", type: "button" }, "Register");
      const tabReport = el("button", { class: "eikon-tab", type: "button" }, "Report / Print");
      tabs.appendChild(tabRegister);
      tabs.appendChild(tabReport);

      const body = el("div");

      card.appendChild(tabs);
      card.appendChild(body);

      root.appendChild(header);
      root.appendChild(card);

      function setActiveTab(name) {
        state.tab = name;
        tabRegister.classList.toggle("active", name === "register");
        tabReport.classList.toggle("active", name === "report");
        renderTab();
      }

      tabRegister.addEventListener("click", () => setActiveTab("register"));
      tabReport.addEventListener("click", () => setActiveTab("report"));

      async function loadEntries() {
        const res = await apiFetch(`/cleaning/entries?month=${encodeURIComponent(state.month)}`, { method: "GET" }, true);
        state.entries = Array.isArray(res.entries) ? res.entries : [];
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

        const title = el("div", { style: "font-weight:900; margin-bottom: 8px;" }, state.editingId ? "Edit entry" : "New entry");

        const dateInput = el("input", { class: "eikon-input", type: "date", value: ymdTodayLocal() });
        const timeInInput = el("input", { class: "eikon-input", type: "time", value: "08:00" });
        const timeOutInput = el("input", { class: "eikon-input", type: "time", value: "" });
        const cleanerInput = el("input", { class: "eikon-input", placeholder: "Cleaner name" });
        const staffInput = el("input", { class: "eikon-input", placeholder: "Staff name" });
        const notesInput = el("textarea", { class: "eikon-textarea", rows: "2", placeholder: "Optional notes..." }, "");

        const saveBtn = el("button", { class: "eikon-btn primary", type: "button" }, state.editingId ? "Save changes" : "Add entry");
        const cancelBtn = el("button", { class: "eikon-btn", type: "button" }, "Cancel edit");
        cancelBtn.style.display = state.editingId ? "" : "none";

        cancelBtn.addEventListener("click", () => {
          state.editingId = null;
          renderRegister();
        });

        saveBtn.addEventListener("click", async () => {
          const entryDate = String(dateInput.value || "").trim();
          const timeIn = String(timeInInput.value || "").trim();
          const timeOut = String(timeOutInput.value || "").trim();
          const cleanerName = String(cleanerInput.value || "").trim();
          const staffName = String(staffInput.value || "").trim();
          const notes = String(notesInput.value || "").trim();

          if (!isValidYmd(entryDate)) { toast("Validation", "Invalid date (YYYY-MM-DD)."); return; }
          if (!isValidHm(timeIn)) { toast("Validation", "Invalid time in (HH:mm)."); return; }
          if (timeOut && !isValidHm(timeOut)) { toast("Validation", "Invalid time out (HH:mm) or leave empty."); return; }
          if (!cleanerName) { toast("Validation", "Cleaner name required."); return; }
          if (!staffName) { toast("Validation", "Staff name required."); return; }

          const payload = {
            entry_date: entryDate,
            time_in: timeIn,
            time_out: timeOut || "",
            cleaner_name: cleanerName,
            staff_name: staffName,
            notes: notes
          };

          if (state.editingId) {
            await apiFetch(`/cleaning/entries/${encodeURIComponent(String(state.editingId))}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            }, true);
            toast("Saved", "Cleaning entry updated.");
          } else {
            await apiFetch("/cleaning/entries", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            }, true);
            toast("Saved", "Cleaning entry added.");
          }

          // Keep month aligned
          const ym = entryDate.slice(0, 7);
          state.month = ym;
          monthInput.value = ym;

          state.editingId = null;
          await reloadRegister();
        });

        const form = el("div", { class: "eikon-card", style: "margin-bottom: 14px;" },
          title,
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Date"), dateInput)
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Time In"), timeInInput)
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Time Out (optional)"), timeOutInput)
            )
          ),
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Cleaner name"), cleanerInput)
            ),
            el("div", { class: "eikon-col" },
              el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Staff name"), staffInput)
            )
          ),
          el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Notes"), notesInput),
          el("div", { class: "eikon-row no-print" }, saveBtn, cancelBtn)
        );

        const tableWrap = el("div", { class: "eikon-tablewrap" });
        const table = el("table", { class: "eikon-table" });
        const tbody = el("tbody");

        table.appendChild(el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Time In"),
            el("th", null, "Time Out"),
            el("th", null, "Cleaner"),
            el("th", null, "Staff"),
            el("th", null, "Notes"),
            el("th", null, "Updated"),
            el("th", { class: "no-print" }, "Actions")
          )
        ));
        table.appendChild(tbody);
        tableWrap.appendChild(table);

        function renderRows() {
          tbody.innerHTML = "";

          if (!state.entries.length) {
            tbody.appendChild(el("tr", null, el("td", { colSpan: 8 }, "No cleaning entries for this month.")));
            return;
          }

          for (const e of state.entries) {
            const editBtn = el("button", { class: "eikon-btn", type: "button" }, "Edit");
            const delBtn = el("button", { class: "eikon-btn danger", type: "button" }, "Delete");

            editBtn.addEventListener("click", () => {
              state.editingId = e.id;

              dateInput.value = e.entry_date || ymdTodayLocal();
              timeInInput.value = e.time_in || "08:00";
              timeOutInput.value = e.time_out || "";
              cleanerInput.value = e.cleaner_name || "";
              staffInput.value = e.staff_name || "";
              notesInput.value = e.notes || "";

              renderRegister();
            });

            delBtn.addEventListener("click", async () => {
              const ok = await modalConfirm("Delete cleaning entry?", "This cannot be undone.");
              if (!ok) return;

              await apiFetch(`/cleaning/entries/${encodeURIComponent(String(e.id))}`, { method: "DELETE" }, true);
              toast("Deleted", "Entry removed.");
              await reloadRegister();
            });

            const actionsCell = el("td", { class: "no-print" }, el("div", { class: "eikon-row", style: "gap:10px;" }, editBtn, delBtn));

            tbody.appendChild(el("tr", null,
              el("td", null, e.entry_date || ""),
              el("td", null, e.time_in || ""),
              el("td", null, e.time_out || ""),
              el("td", null, e.cleaner_name || ""),
              el("td", null, e.staff_name || ""),
              el("td", null, e.notes || ""),
              el("td", null, (e.updated_at || e.created_at || "") ? String(e.updated_at || e.created_at).replace("T", " ").slice(0, 16) : ""),
              actionsCell
            ));
          }
        }

        body.appendChild(monthField);
        body.appendChild(form);
        body.appendChild(tableWrap);

        renderRows();

        async function reloadRegister() {
          await loadEntries();
          renderRegister();
        }

        renderRegister.reload = reloadRegister;
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
            el("th", null, "Time In"),
            el("th", null, "Time Out"),
            el("th", null, "Cleaner"),
            el("th", null, "Staff"),
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

          const payload = await apiFetch(`/cleaning/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "GET" }, true);
          lastReportPayload = payload;
          printBtn.disabled = false;

          const entries = Array.isArray(payload.entries) ? payload.entries : [];
          tbody.innerHTML = "";

          if (!entries.length) {
            tbody.appendChild(el("tr", null, el("td", { colSpan: 6 }, "No entries in this range.")));
            return;
          }

          for (const e of entries) {
            tbody.appendChild(el("tr", null,
              el("td", null, e.entry_date || ""),
              el("td", null, e.time_in || ""),
              el("td", null, e.time_out || ""),
              el("td", null, e.cleaner_name || ""),
              el("td", null, e.staff_name || ""),
              el("td", null, e.notes || "")
            ));
          }
        });

        printBtn.addEventListener("click", () => {
          if (!lastReportPayload) return;
          const html = buildReportHtml(lastReportPayload);
          openPrintTabWithHtml(html, "Cleaning Report");
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
        if (state.tab === "report") return renderReport();
      }

      async function initialLoad() {
        try {
          await loadEntries();
          renderTab();
        } catch (e) {
          renderTab();
        }
      }

      async function reloadRegister() {
        await loadEntries();
        renderRegister();
      }

      setActiveTab("register");
      initialLoad();

      if (renderRegister.reload) renderRegister.reload = reloadRegister;
    }
  };
})();
