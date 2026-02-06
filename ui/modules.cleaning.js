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

  async function openPrintableReport(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function isHm(v) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || "").trim());
  }

  E.modules.cleaning = {
    id: "cleaning",
    title: "Cleaning",
    subtitle: "Daily cleaning register",
    icon: "C",
    async render(root, user) {
      const debug = (localStorage.getItem("eikon_debug") === "1");
      function dlog(...args) { if (debug) console.log(...args); }

      dlog("[EIKON][cleaning] render() start");

      const state = {
        month: thisMonth(),
        entries: []
      };

      const header = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-title" }, "Cleaning Register"),
        el("div", { class: "eikon-help" }, "Create entries with date, time in/out, cleaner name and staff name. You can add past dates too.")
      );

      const monthInput = el("input", { class: "eikon-input", type: "month", value: state.month });
      const btnRefresh = el("button", { class: "eikon-btn" }, "Refresh");
      const btnPrint = el("button", { class: "eikon-btn eikon-btn-primary" }, "Print Report");

      const controls = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-row" },
          el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Month"), monthInput),
          el("div", { class: "eikon-field", style: "min-width:140px" }, btnRefresh),
          el("div", { class: "eikon-field", style: "min-width:160px" }, btnPrint)
        )
      );

      const formCard = el("div", { class: "eikon-card" });
      const tableCard = el("div", { class: "eikon-card" });

      root.appendChild(header);
      root.appendChild(controls);
      root.appendChild(formCard);
      root.appendChild(tableCard);

      const fDate = el("input", { class: "eikon-input", type: "date", value: todayYmd() });
      const fTimeIn = el("input", { class: "eikon-input", type: "time", value: "08:00" });
      const fTimeOut = el("input", { class: "eikon-input", type: "time", value: "" });
      const fCleaner = el("input", { class: "eikon-input", type: "text", placeholder: "Cleaner name" });
      const fStaff = el("input", { class: "eikon-input", type: "text", placeholder: "Staff name" });
      const fNotes = el("input", { class: "eikon-input", type: "text", placeholder: "Optional notes" });

      const btnAdd = el("button", { class: "eikon-btn eikon-btn-primary" }, "Add Entry");

      btnAdd.addEventListener("click", async () => {
        const payload = {
          entry_date: (fDate.value || "").trim(),
          time_in: (fTimeIn.value || "").trim(),
          time_out: (fTimeOut.value || "").trim(),
          cleaner_name: (fCleaner.value || "").trim(),
          staff_name: (fStaff.value || "").trim(),
          notes: (fNotes.value || "").trim()
        };

        if (!payload.entry_date) { E.toast("Missing date", "Choose a date.", 2500); return; }
        if (!isHm(payload.time_in)) { E.toast("Invalid time in", "Use HH:mm.", 2500); return; }
        if (payload.time_out && !isHm(payload.time_out)) { E.toast("Invalid time out", "Use HH:mm or leave empty.", 3000); return; }
        if (!payload.cleaner_name) { E.toast("Missing cleaner", "Enter cleaner name.", 2500); return; }
        if (!payload.staff_name) { E.toast("Missing staff", "Enter staff name.", 2500); return; }

        dlog("[EIKON][cleaning] create", payload);

        try {
          await E.apiFetch("/cleaning/entries", { method: "POST", body: JSON.stringify(payload) });
          E.toast("Added", "Cleaning entry saved.", 1800);
          await refreshAll();
        } catch (err) {
          console.error("[EIKON][cleaning] create error", err);
          E.toast("Add failed", err.message || "Unknown error", 4200);
        }
      });

      function renderForm() {
        formCard.innerHTML = "";
        formCard.appendChild(el("div", { class: "eikon-title" }, "Add Cleaning Entry"));
        formCard.appendChild(
          el("div", { class: "eikon-row" },
            el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Date"), fDate),
            el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Time in"), fTimeIn),
            el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Time out (optional)"), fTimeOut),
            el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Cleaner"), fCleaner),
            el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Staff"), fStaff),
            el("div", { class: "eikon-field", style: "min-width:260px" }, el("div", { class: "eikon-label" }, "Notes"), fNotes),
            el("div", { class: "eikon-field", style: "min-width:140px" }, btnAdd)
          )
        );
      }

      async function loadEntries() {
        dlog("[EIKON][cleaning] loadEntries() month=", state.month);
        const out = await E.apiFetch("/cleaning/entries?month=" + encodeURIComponent(state.month), { method: "GET" });
        state.entries = (out && out.entries) ? out.entries : [];
      }

      function renderTable() {
        tableCard.innerHTML = "";
        tableCard.appendChild(el("div", { class: "eikon-title" }, "Entries (" + state.month + ")"));

        const wrap = el("div", { class: "eikon-tablewrap", style: "margin-top:10px" });
        const table = el("table", { class: "eikon-table" });

        const thead = el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Time in"),
            el("th", null, "Time out"),
            el("th", null, "Cleaner"),
            el("th", null, "Staff"),
            el("th", null, "Notes"),
            el("th", null, "Actions")
          )
        );

        const tbody = el("tbody");

        const rows = state.entries.slice().sort((a, b) => {
          if (a.entry_date > b.entry_date) return -1;
          if (a.entry_date < b.entry_date) return 1;
          if (a.time_in > b.time_in) return -1;
          if (a.time_in < b.time_in) return 1;
          return (b.id || 0) - (a.id || 0);
        });

        for (const r of rows) {
          const btnEdit = el("button", { class: "eikon-btn eikon-btn-primary" }, "Edit");
          const btnDel = el("button", { class: "eikon-btn eikon-btn-danger" }, "Delete");

          btnEdit.addEventListener("click", async () => {
            // Inline edit modal replacement: reuse confirm modal just for confirmation; edits are done inline via temporary row editor
            const editor = el("div", { class: "eikon-card", style: "margin-top:10px" },
              el("div", { class: "eikon-title" }, "Edit entry #" + r.id),
              el("div", { class: "eikon-row" })
            );

            const eDate = el("input", { class: "eikon-input", type: "date", value: r.entry_date });
            const eIn = el("input", { class: "eikon-input", type: "time", value: r.time_in });
            const eOut = el("input", { class: "eikon-input", type: "time", value: r.time_out || "" });
            const eCleaner = el("input", { class: "eikon-input", type: "text", value: r.cleaner_name });
            const eStaff = el("input", { class: "eikon-input", type: "text", value: r.staff_name });
            const eNotes = el("input", { class: "eikon-input", type: "text", value: r.notes || "" });

            const saveBtn = el("button", { class: "eikon-btn eikon-btn-primary" }, "Save");
            const cancelBtn = el("button", { class: "eikon-btn" }, "Cancel");

            cancelBtn.addEventListener("click", () => {
              try { editor.remove(); } catch {}
            });

            saveBtn.addEventListener("click", async () => {
              const payload = {
                entry_date: (eDate.value || "").trim(),
                time_in: (eIn.value || "").trim(),
                time_out: (eOut.value || "").trim(),
                cleaner_name: (eCleaner.value || "").trim(),
                staff_name: (eStaff.value || "").trim(),
                notes: (eNotes.value || "").trim()
              };

              if (!payload.entry_date) { E.toast("Missing date", "Choose a date.", 2500); return; }
              if (!isHm(payload.time_in)) { E.toast("Invalid time in", "Use HH:mm.", 2500); return; }
              if (payload.time_out && !isHm(payload.time_out)) { E.toast("Invalid time out", "Use HH:mm or leave empty.", 3000); return; }
              if (!payload.cleaner_name) { E.toast("Missing cleaner", "Enter cleaner name.", 2500); return; }
              if (!payload.staff_name) { E.toast("Missing staff", "Enter staff name.", 2500); return; }

              dlog("[EIKON][cleaning] update", r.id, payload);

              try {
                await E.apiFetch("/cleaning/entries/" + r.id, { method: "PUT", body: JSON.stringify(payload) });
                E.toast("Saved", "Entry updated.", 1800);
                await refreshAll();
              } catch (err) {
                console.error("[EIKON][cleaning] update error", err);
                E.toast("Update failed", err.message || "Unknown error", 4200);
              }
            });

            editor.querySelector(".eikon-row").appendChild(el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Date"), eDate));
            editor.querySelector(".eikon-row").appendChild(el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Time in"), eIn));
            editor.querySelector(".eikon-row").appendChild(el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Time out"), eOut));
            editor.querySelector(".eikon-row").appendChild(el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Cleaner"), eCleaner));
            editor.querySelector(".eikon-row").appendChild(el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Staff"), eStaff));
            editor.querySelector(".eikon-row").appendChild(el("div", { class: "eikon-field", style: "min-width:260px" }, el("div", { class: "eikon-label" }, "Notes"), eNotes));
            editor.querySelector(".eikon-row").appendChild(el("div", { class: "eikon-field", style: "min-width:220px" }, el("div", { class: "eikon-label" }, "Actions"),
              el("div", { class: "eikon-row", style: "gap:8px" }, saveBtn, cancelBtn)
            ));

            tableCard.appendChild(editor);
          });

          btnDel.addEventListener("click", async () => {
            const ok = await E.confirm("Delete entry", "Delete cleaning entry on " + r.entry_date + " (" + r.time_in + ")?", "Delete", "Cancel");
            if (!ok) return;

            dlog("[EIKON][cleaning] delete", r.id);

            try {
              await E.apiFetch("/cleaning/entries/" + r.id, { method: "DELETE" });
              E.toast("Deleted", "Entry deleted.", 1600);
              await refreshAll();
            } catch (err) {
              console.error("[EIKON][cleaning] delete error", err);
              E.toast("Delete failed", err.message || "Unknown error", 4200);
            }
          });

          tbody.appendChild(
            el("tr", null,
              el("td", null, r.entry_date),
              el("td", null, r.time_in),
              el("td", null, r.time_out || ""),
              el("td", null, r.cleaner_name),
              el("td", null, r.staff_name),
              el("td", null, r.notes || ""),
              el("td", null, el("div", { class: "eikon-row", style: "gap:8px" }, btnEdit, btnDel))
            )
          );
        }

        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        tableCard.appendChild(wrap);
      }

      async function refreshAll() {
        await loadEntries();
        renderForm();
        renderTable();
      }

      monthInput.addEventListener("change", async () => {
        state.month = (monthInput.value || "").trim();
        if (!state.month) return;
        await refreshAll();
      });

      btnRefresh.addEventListener("click", async () => {
        await refreshAll();
        E.toast("Refreshed", "Cleaning entries reloaded.", 1600);
      });

      btnPrint.addEventListener("click", async () => {
        const from = state.month + "-01";
        // print full month by default (server will handle)
        const url = "/cleaning/report/html?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(from.slice(0, 7) + "-31");
        dlog("[EIKON][cleaning] open print", url);
        await openPrintableReport(url);
      });

      await refreshAll();
      dlog("[EIKON][cleaning] render() done");
    }
  };
})();
