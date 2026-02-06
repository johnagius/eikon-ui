(function () {
  const E = (window.EIKON = window.EIKON || {});
  E.modules = E.modules || {};
  const U = E.util;

  function openPrintTabWithHtml(title, html) {
    const w = window.open("", "_blank");
    if (!w) {
      U.toast("Popup blocked", "Allow popups so printing can open in a new tab.");
      return;
    }
    w.document.open();
    w.document.write(
      `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title || "Print")}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;}
  h1,h2,h3{margin:0 0 10px 0;}
  .meta{color:#444;margin:0 0 16px 0;}
  table{border-collapse:collapse;width:100%;}
  th,td{border:1px solid #ddd;padding:8px;vertical-align:top;}
  th{background:#f6f6f6;text-align:left;}
  .small{font-size:12px;color:#555;}
  .right{text-align:right;}
  @media print { .no-print{display:none!important;} body{margin:0;} }
</style>
</head>
<body>
${html}
<script>
  setTimeout(function(){ try{ window.print(); }catch(e){} }, 250);
</script>
</body>
</html>`
    );
    w.document.close();
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function todayYmdLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }

  function ymNowLocal() {
    return todayYmdLocal().slice(0, 7);
  }

  function addMonths(yyyyMm, delta) {
    const m = String(yyyyMm || "").trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return ymNowLocal();
    const y = parseInt(m.slice(0, 4), 10);
    const mo = parseInt(m.slice(5, 7), 10);
    const d = new Date(y, mo - 1 + (delta || 0), 1);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${yy}-${mm}`;
  }

  function formatYmLabel(yyyyMm) {
    const m = String(yyyyMm || "").trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return m;
    const y = m.slice(0, 4);
    const mo = parseInt(m.slice(5, 7), 10);
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[mo - 1]} ${y}`;
  }

  function isNetworkishError(err) {
    if (!err) return true;
    if (typeof err.status === "number") return false;
    const msg = String(err.message || "");
    return /failed to fetch|networkerror|load failed/i.test(msg);
  }

  E.modules.cleaning = {
    id: "cleaning",
    title: "Cleaning",
    render: function (root) {
      root.innerHTML = "";

      let month = ymNowLocal();
      let editingId = null;

      const card = U.el("div", { class: "eikon-card" });
      const header = U.el("div", { class: "eikon-row" }, [
        U.el("div", { class: "eikon-title", text: "Cleaning Register" })
      ]);

      const monthRow = U.el("div", { class: "eikon-row" }, []);
      const btnPrev = U.el("button", { class: "eikon-btn", text: "◀" });
      const lblMonth = U.el("div", { class: "eikon-help", text: formatYmLabel(month), style: "padding:8px 10px;" });
      const btnNext = U.el("button", { class: "eikon-btn", text: "▶" });
      const btnRefresh = U.el("button", { class: "eikon-btn", text: "Refresh" });
      const btnPrint = U.el("button", { class: "eikon-btn primary", text: "Print Report" });

      monthRow.appendChild(btnPrev);
      monthRow.appendChild(lblMonth);
      monthRow.appendChild(btnNext);
      monthRow.appendChild(btnRefresh);
      monthRow.appendChild(btnPrint);

      const formTitle = U.el("div", { class: "eikon-title", text: "Add Entry", style: "margin-top:14px;" });

      const inpDate = U.el("input", { class: "eikon-input", type: "date", value: todayYmdLocal() });
      const inpIn = U.el("input", { class: "eikon-input", type: "time", value: "" });
      const inpOut = U.el("input", { class: "eikon-input", type: "time", value: "" });
      const inpCleaner = U.el("input", { class: "eikon-input", type: "text", placeholder: "Cleaner name" });
      const inpStaff = U.el("input", { class: "eikon-input", type: "text", placeholder: "Staff name (supervising)" });
      const inpNotes = U.el("textarea", { class: "eikon-input", placeholder: "Notes (optional)", style: "min-height:72px;resize:vertical;" });

      const btnSave = U.el("button", { class: "eikon-btn primary", text: "Save" });
      const btnCancelEdit = U.el("button", { class: "eikon-btn", text: "Cancel Edit" });
      btnCancelEdit.style.display = "none";

      const formGrid = U.el("div", { class: "eikon-grid" }, [
        U.el("div", { class: "eikon-field" }, [U.el("div", { class: "eikon-label", text: "Date" }), inpDate]),
        U.el("div", { class: "eikon-field" }, [U.el("div", { class: "eikon-label", text: "Time In" }), inpIn]),
        U.el("div", { class: "eikon-field" }, [U.el("div", { class: "eikon-label", text: "Time Out" }), inpOut]),
        U.el("div", { class: "eikon-field" }, [U.el("div", { class: "eikon-label", text: "Cleaner" }), inpCleaner]),
        U.el("div", { class: "eikon-field" }, [U.el("div", { class: "eikon-label", text: "Staff" }), inpStaff])
      ]);

      const formFieldNotes = U.el("div", { class: "eikon-field" }, [
        U.el("div", { class: "eikon-label", text: "Notes" }),
        inpNotes
      ]);

      const formActions = U.el("div", { class: "eikon-row", style: "gap:10px;margin-top:10px;" }, [
        btnSave,
        btnCancelEdit
      ]);

      const tableWrap = U.el("div", { style: "margin-top:14px;" });
      const table = U.el("table", { class: "eikon-table" });
      tableWrap.appendChild(table);

      card.appendChild(header);
      card.appendChild(monthRow);
      card.appendChild(formTitle);
      card.appendChild(formGrid);
      card.appendChild(formFieldNotes);
      card.appendChild(formActions);
      card.appendChild(tableWrap);

      root.appendChild(card);

      function setEditMode(on, row) {
        editingId = on ? (row && row.id ? Number(row.id) : null) : null;
        formTitle.textContent = on ? "Edit Entry" : "Add Entry";
        btnCancelEdit.style.display = on ? "inline-flex" : "none";

        if (!on) {
          inpDate.value = todayYmdLocal();
          inpIn.value = "";
          inpOut.value = "";
          inpCleaner.value = "";
          inpStaff.value = "";
          inpNotes.value = "";
          return;
        }

        inpDate.value = String(row.entry_date || "");
        inpIn.value = String(row.time_in || "");
        inpOut.value = String(row.time_out || "");
        inpCleaner.value = String(row.cleaner_name || "");
        inpStaff.value = String(row.staff_name || "");
        inpNotes.value = String(row.notes || "");
      }

      function renderTable(rows) {
        table.innerHTML = "";

        const thead = U.el("thead");
        const trh = U.el("tr");
        ["Date", "In", "Out", "Cleaner", "Staff", "Notes", ""].forEach((h) => trh.appendChild(U.el("th", { text: h })));
        thead.appendChild(trh);

        const tbody = U.el("tbody");

        rows.forEach((r) => {
          const tr = U.el("tr");
          tr.appendChild(U.el("td", { text: r.entry_date || "" }));
          tr.appendChild(U.el("td", { text: r.time_in || "" }));
          tr.appendChild(U.el("td", { text: r.time_out || "" }));
          tr.appendChild(U.el("td", { text: r.cleaner_name || "" }));
          tr.appendChild(U.el("td", { text: r.staff_name || "" }));
          tr.appendChild(U.el("td", { text: r.notes || "" }));

          const tdAct = U.el("td");

          const btnEdit = U.el("button", { class: "eikon-btn", text: "Edit" });
          btnEdit.addEventListener("click", () => {
            setEditMode(true, r);
            window.scrollTo({ top: 0, behavior: "smooth" });
          });

          const btnDel = U.el("button", { class: "eikon-btn danger", text: "Delete" });
          btnDel.addEventListener("click", async () => {
            const ok = await U.modalConfirm("Delete entry", "Delete this cleaning entry?", "Delete", "Cancel");
            if (!ok) return;

            try {
              await U.apiFetch(`/cleaning/entries/${Number(r.id)}`, { method: "DELETE" });
              U.toast("Deleted", "Entry removed.");
              await load();
            } catch (err) {
              if (isNetworkishError(err)) {
                U.qAdd({ path: `/cleaning/entries/${Number(r.id)}`, method: "DELETE", body: {} });
                U.toast("Queued", "Offline: delete queued and will sync when online.");
              } else {
                U.toast("Delete failed", err.message || "Error");
              }
            }
          });

          tdAct.appendChild(btnEdit);
          tdAct.appendChild(U.el("span", { style: "display:inline-block;width:8px;" }));
          tdAct.appendChild(btnDel);

          tr.appendChild(tdAct);
          tbody.appendChild(tr);
        });

        table.appendChild(thead);
        table.appendChild(tbody);

        if (!rows.length) {
          const empty = U.el("div", { class: "eikon-help", text: "No entries for this month yet." });
          tableWrap.appendChild(empty);
        }
      }

      async function load() {
        lblMonth.textContent = formatYmLabel(month);
        tableWrap.querySelectorAll(".eikon-help").forEach((n) => n.remove());

        try {
          const r = await U.apiFetch(`/cleaning/entries?month=${encodeURIComponent(month)}`, { method: "GET" });
          renderTable((r && r.entries) ? r.entries : []);
        } catch (err) {
          U.toast("Load failed", err.message || "Error");
          renderTable([]);
        }
      }

      btnPrev.addEventListener("click", async () => {
        month = addMonths(month, -1);
        await load();
      });

      btnNext.addEventListener("click", async () => {
        month = addMonths(month, 1);
        await load();
      });

      btnRefresh.addEventListener("click", async () => {
        const f = await U.qFlush();
        if (f && f.sent) U.toast("Synced", `Sent ${f.sent} queued changes.`);
        await load();
      });

      btnCancelEdit.addEventListener("click", () => setEditMode(false));

      btnSave.addEventListener("click", async () => {
        const body = {
          entry_date: String(inpDate.value || "").trim(),
          time_in: String(inpIn.value || "").trim(),
          time_out: String(inpOut.value || "").trim(),
          cleaner_name: String(inpCleaner.value || "").trim(),
          staff_name: String(inpStaff.value || "").trim(),
          notes: String(inpNotes.value || "").trim()
        };

        if (!body.entry_date || !body.time_in || !body.cleaner_name || !body.staff_name) {
          U.toast("Missing", "Date, Time In, Cleaner and Staff are required.");
          return;
        }

        btnSave.disabled = true;
        btnSave.textContent = "Saving...";

        try {
          if (editingId) {
            await U.apiFetch(`/cleaning/entries/${editingId}`, { method: "PUT", body: JSON.stringify(body) });
            U.toast("Saved", "Entry updated.");
          } else {
            await U.apiFetch(`/cleaning/entries`, { method: "POST", body: JSON.stringify(body) });
            U.toast("Saved", "Entry created.");
          }
          setEditMode(false);
          month = String(body.entry_date).slice(0, 7);
          await load();
        } catch (err) {
          if (isNetworkishError(err)) {
            if (editingId) {
              U.qAdd({ path: `/cleaning/entries/${editingId}`, method: "PUT", body });
              U.toast("Queued", "Offline: update queued and will sync when online.");
            } else {
              U.qAdd({ path: `/cleaning/entries`, method: "POST", body });
              U.toast("Queued", "Offline: create queued and will sync when online.");
            }
            setEditMode(false);
          } else {
            U.toast("Save failed", err.message || "Error");
          }
        } finally {
          btnSave.disabled = false;
          btnSave.textContent = "Save";
        }
      });

      btnPrint.addEventListener("click", async () => {
        const from = month + "-01";
        const to = month + "-31";

        try {
          const r = await U.apiFetch(`/cleaning/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "GET" });

          const orgName = escapeHtml((r && r.org_name) ? r.org_name : "");
          const locName = escapeHtml((r && r.location_name) ? r.location_name : "");
          const entries = (r && r.entries) ? r.entries : [];

          let rowsHtml = "";
          for (const e of entries) {
            rowsHtml += `<tr>
<td>${escapeHtml(e.entry_date || "")}</td>
<td>${escapeHtml(e.time_in || "")}</td>
<td>${escapeHtml(e.time_out || "")}</td>
<td>${escapeHtml(e.cleaner_name || "")}</td>
<td>${escapeHtml(e.staff_name || "")}</td>
<td>${escapeHtml(e.notes || "")}</td>
</tr>`;
          }

          const html = `
<h1>Cleaning Report</h1>
<div class="meta"><b>${orgName}</b> — ${locName}<br/><span class="small">From ${escapeHtml(from)} to ${escapeHtml(to)}</span></div>
<table>
  <thead>
    <tr>
      <th>Date</th><th>In</th><th>Out</th><th>Cleaner</th><th>Staff</th><th>Notes</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml || `<tr><td colspan="6" class="small">No entries.</td></tr>`}
  </tbody>
</table>`;

          openPrintTabWithHtml("Cleaning Report", html);
        } catch (err) {
          U.toast("Report failed", err.message || "Error");
        }
      });

      // Initial load
      load();
    }
  };
})();
