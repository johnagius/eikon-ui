/* ui/modules.cleaning.js
   Cleaning Register module
   Endpoints used:
     GET    /cleaning/entries?month=YYYY-MM
     POST   /cleaning/entries
     PUT    /cleaning/entries/:id
     DELETE /cleaning/entries/:id
     GET    /cleaning/report?from=YYYY-MM-DD&to=YYYY-MM-DD
*/

(function () {
  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        if (k === "class") n.className = props[k];
        else if (k === "text") n.textContent = props[k];
        else if (k === "html") n.innerHTML = props[k];
        else if (k === "style") Object.assign(n.style, props[k]);
        else if (k.startsWith("on") && typeof props[k] === "function") n.addEventListener(k.slice(2), props[k]);
        else n.setAttribute(k, props[k]);
      }
    }
    if (children && children.length) {
      for (const c of children) {
        if (c === null || c === undefined) continue;
        if (typeof c === "string") n.appendChild(document.createTextNode(c));
        else n.appendChild(c);
      }
    }
    return n;
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function pad2(x) { return String(x).padStart(2, "0"); }

  function isValidYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function isValidHm(s) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || "").trim());
  }

  function parseYmToDate(ym) {
    const m = String(ym || "").trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return null;
    const parts = m.split("-");
    const y = parseInt(parts[0], 10);
    const mo = parseInt(parts[1], 10);
    return new Date(y, mo - 1, 1);
  }

  function monthKeyFromYmd(ymd) {
    return String(ymd || "").slice(0, 7);
  }

  function buildMonthGroups(entries) {
    const groups = {};
    for (const e of entries) {
      const k = monthKeyFromYmd(e.entry_date);
      if (!groups[k]) groups[k] = [];
      groups[k].push(e);
    }
    const keys = Object.keys(groups);
    keys.sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ ym: k, entries: groups[k] }));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function renderPrintHtml(ctx, report) {
    const org = report.org_name || "";
    const loc = report.location_name || "";
    const from = report.from || "";
    const to = report.to || "";
    const entries = Array.isArray(report.entries) ? report.entries : [];
    const groups = buildMonthGroups(entries);

    let html = "";
    html += `<div style="padding:18px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">`;
    html += `<div style="font-weight:900;font-size:18px;margin-bottom:6px;">${escapeHtml(org)} — Cleaning Register</div>`;
    html += `<div style="color:#333;font-size:12px;margin-bottom:12px;">${escapeHtml(loc)} • ${escapeHtml(from)} to ${escapeHtml(to)}</div>`;

    for (const g of groups) {
      const label = ctx.formatYmLabel ? ctx.formatYmLabel(g.ym) : g.ym;
      html += `<div style="margin-top:18px;font-weight:900;font-size:14px;">${escapeHtml(label)}</div>`;
      html += `<table style="width:100%;border-collapse:collapse;margin-top:8px;">`;
      html += `<thead><tr>`;
      html += `<th style="text-align:left;border:1px solid #ccc;padding:6px;font-size:12px;">Date</th>`;
      html += `<th style="text-align:left;border:1px solid #ccc;padding:6px;font-size:12px;">Time In</th>`;
      html += `<th style="text-align:left;border:1px solid #ccc;padding:6px;font-size:12px;">Time Out</th>`;
      html += `<th style="text-align:left;border:1px solid #ccc;padding:6px;font-size:12px;">Cleaner</th>`;
      html += `<th style="text-align:left;border:1px solid #ccc;padding:6px;font-size:12px;">Staff</th>`;
      html += `<th style="text-align:left;border:1px solid #ccc;padding:6px;font-size:12px;">Notes</th>`;
      html += `</tr></thead><tbody>`;

      for (const e of g.entries) {
        html += `<tr>`;
        html += `<td style="border:1px solid #ccc;padding:6px;font-size:12px;">${escapeHtml(e.entry_date || "")}</td>`;
        html += `<td style="border:1px solid #ccc;padding:6px;font-size:12px;">${escapeHtml(e.time_in || "")}</td>`;
        html += `<td style="border:1px solid #ccc;padding:6px;font-size:12px;">${escapeHtml(e.time_out || "")}</td>`;
        html += `<td style="border:1px solid #ccc;padding:6px;font-size:12px;">${escapeHtml(e.cleaner_name || "")}</td>`;
        html += `<td style="border:1px solid #ccc;padding:6px;font-size:12px;">${escapeHtml(e.staff_name || "")}</td>`;
        html += `<td style="border:1px solid #ccc;padding:6px;font-size:12px;">${escapeHtml(e.notes || "")}</td>`;
        html += `</tr>`;
      }

      if (g.entries.length === 0) {
        html += `<tr><td colspan="6" style="border:1px solid #ccc;padding:8px;color:#666;font-size:12px;">No records</td></tr>`;
      }

      html += `</tbody></table>`;
    }

    if (groups.length === 0) {
      html += `<div style="margin-top:12px;color:#666;font-size:12px;">No records</div>`;
    }

    html += `</div>`;
    return html;
  }

  const module = {
    id: "cleaning",
    title: "Cleaning",
    navLabel: "Cleaning",
    icon: "🧼",

    mount: function (container, ctx) {
      let month = ctx.nowLocalYm ? ctx.nowLocalYm() : (new Date().toISOString().slice(0, 7));
      let entries = [];
      let editingId = null;

      const headerCard = el("div", { class: "eikon-card" }, []);
      const row1 = el("div", { class: "eikon-row" }, []);

      const monthField = el("div", { class: "eikon-field", style: { maxWidth: "240px" } }, [
        el("label", { text: "Month" }, []),
        el("input", { type: "month", value: month }, []),
      ]);

      const btnPrev = el("button", { class: "eikon-btn small", type: "button", text: "◀ Prev" }, []);
      const btnNext = el("button", { class: "eikon-btn small", type: "button", text: "Next ▶" }, []);
      const btnReload = el("button", { class: "eikon-btn small", type: "button", text: "Reload" }, []);
      const btnPrint = el("button", { class: "eikon-btn small primary", type: "button", text: "Print report" }, []);

      const monthActions = el("div", { class: "eikon-actions" }, [btnPrev, btnNext, btnReload, btnPrint]);

      row1.appendChild(monthField);
      row1.appendChild(el("div", { class: "eikon-field" }, [
        el("label", { text: "Actions" }, []),
        monthActions,
      ]));

      headerCard.appendChild(row1);

      const formCard = el("div", { class: "eikon-card", style: { marginTop: "12px" } }, []);
      const formTitle = el("div", { style: { fontWeight: "1000", marginBottom: "10px" } }, ["Add / Edit cleaning entry"]);
      const formRow = el("div", { class: "eikon-row" }, []);

      const fDate = el("div", { class: "eikon-field", style: { maxWidth: "200px" } }, [
        el("label", { text: "Date" }, []),
        el("input", { type: "date", value: ctx.nowLocalYmd ? ctx.nowLocalYmd() : new Date().toISOString().slice(0, 10) }, []),
      ]);

      const fIn = el("div", { class: "eikon-field", style: { maxWidth: "160px" } }, [
        el("label", { text: "Time in" }, []),
        el("input", { type: "time", value: "08:00" }, []),
      ]);

      const fOut = el("div", { class: "eikon-field", style: { maxWidth: "160px" } }, [
        el("label", { text: "Time out (optional)" }, []),
        el("input", { type: "time", value: "" }, []),
      ]);

      const fCleaner = el("div", { class: "eikon-field" }, [
        el("label", { text: "Cleaner name" }, []),
        el("input", { type: "text", placeholder: "Cleaner" }, []),
      ]);

      const fStaff = el("div", { class: "eikon-field" }, [
        el("label", { text: "Staff name" }, []),
        el("input", { type: "text", placeholder: "Staff on duty" }, []),
      ]);

      const fNotes = el("div", { class: "eikon-field" }, [
        el("label", { text: "Notes (optional)" }, []),
        el("textarea", { placeholder: "" }, []),
      ]);

      const btnSave = el("button", { class: "eikon-btn primary", type: "button", text: "Save entry" }, []);
      const btnCancel = el("button", { class: "eikon-btn", type: "button", text: "Cancel edit", style: { display: "none" } }, []);

      const errBox = el("div", { class: "eikon-error", style: { display: "none", marginTop: "10px" } }, []);

      formRow.appendChild(fDate);
      formRow.appendChild(fIn);
      formRow.appendChild(fOut);
      formRow.appendChild(fCleaner);
      formRow.appendChild(fStaff);

      formCard.appendChild(formTitle);
      formCard.appendChild(formRow);
      formCard.appendChild(fNotes);
      formCard.appendChild(el("div", { class: "eikon-actions", style: { marginTop: "10px" } }, [btnSave, btnCancel]));
      formCard.appendChild(errBox);

      const tableCard = el("div", { class: "eikon-card", style: { marginTop: "12px" } }, []);
      const tableTitle = el("div", { style: { fontWeight: "1000", marginBottom: "10px" } }, ["Cleaning entries"]);
      const tableWrap = el("div", { class: "eikon-tablewrap" }, []);
      const table = el("table", { class: "eikon-table" }, []);
      tableWrap.appendChild(table);

      tableCard.appendChild(tableTitle);
      tableCard.appendChild(tableWrap);

      container.appendChild(headerCard);
      container.appendChild(formCard);
      container.appendChild(tableCard);

      function showError(msg) {
        errBox.textContent = String(msg || "");
        errBox.style.display = msg ? "block" : "none";
      }

      function setEditing(entry) {
        editingId = entry ? entry.id : null;
        btnCancel.style.display = editingId ? "inline-block" : "none";
        btnSave.textContent = editingId ? "Update entry" : "Save entry";

        if (entry) {
          qs("input", fDate).value = entry.entry_date || "";
          qs("input", fIn).value = entry.time_in || "";
          qs("input", fOut).value = entry.time_out || "";
          qs("input", fCleaner).value = entry.cleaner_name || "";
          qs("input", fStaff).value = entry.staff_name || "";
          qs("textarea", fNotes).value = entry.notes || "";
        } else {
          qs("input", fDate).value = ctx.nowLocalYmd ? ctx.nowLocalYmd() : new Date().toISOString().slice(0, 10);
          qs("input", fIn).value = "08:00";
          qs("input", fOut).value = "";
          qs("input", fCleaner).value = "";
          qs("input", fStaff).value = "";
          qs("textarea", fNotes).value = "";
        }
        showError("");
      }

      function renderTable() {
        table.innerHTML = "";

        const thead = el("thead", null, []);
        const trh = el("tr", null, [
          el("th", { text: "Date" }, []),
          el("th", { text: "Time In" }, []),
          el("th", { text: "Time Out" }, []),
          el("th", { text: "Cleaner" }, []),
          el("th", { text: "Staff" }, []),
          el("th", { text: "Notes" }, []),
          el("th", { text: "Actions" }, []),
        ]);
        thead.appendChild(trh);

        const tbody = el("tbody", null, []);

        if (!entries.length) {
          const tr = el("tr", null, [
            el("td", { class: "muted", text: "No entries for this month.", colSpan: "7" }, []),
          ]);
          tbody.appendChild(tr);
        } else {
          for (const e of entries) {
            const actions = el("div", { class: "eikon-actions" }, []);
            const bEdit = el("button", { class: "eikon-btn small", type: "button", text: "Edit" }, []);
            const bDel = el("button", { class: "eikon-btn small danger", type: "button", text: "Delete" }, []);

            bEdit.addEventListener("click", () => setEditing(e));
            bDel.addEventListener("click", async () => {
              const ok = confirm("Delete this cleaning entry?");
              if (!ok) return;
              try {
                await ctx.apiFetch("/cleaning/entries/" + e.id, { method: "DELETE" });
                ctx.toast("Deleted");
                await loadEntries();
              } catch (err) {
                alert(err && err.message ? err.message : String(err));
              }
            });

            actions.appendChild(bEdit);
            actions.appendChild(bDel);

            const tr = el("tr", null, [
              el("td", { text: e.entry_date || "" }, []),
              el("td", { text: e.time_in || "" }, []),
              el("td", { text: e.time_out || "" }, []),
              el("td", { text: e.cleaner_name || "" }, []),
              el("td", { text: e.staff_name || "" }, []),
              el("td", { text: e.notes || "" }, []),
              el("td", null, [actions]),
            ]);
            tbody.appendChild(tr);
          }
        }

        table.appendChild(thead);
        table.appendChild(tbody);
      }

      async function loadEntries() {
        showError("");
        try {
          const data = await ctx.apiFetch("/cleaning/entries?month=" + encodeURIComponent(month), { method: "GET" });
          entries = (data && data.ok && Array.isArray(data.entries)) ? data.entries : [];
          renderTable();
        } catch (e) {
          showError(e && e.message ? e.message : String(e));
        }
      }

      async function saveEntry() {
        showError("");

        const entry_date = qs("input", fDate).value.trim();
        const time_in = qs("input", fIn).value.trim();
        const time_out = qs("input", fOut).value.trim();
        const cleaner_name = qs("input", fCleaner).value.trim();
        const staff_name = qs("input", fStaff).value.trim();
        const notes = qs("textarea", fNotes).value.trim();

        if (!isValidYmd(entry_date)) return showError("Invalid date.");
        if (!isValidHm(time_in)) return showError("Invalid time in (HH:mm).");
        if (time_out && !isValidHm(time_out)) return showError("Invalid time out (HH:mm or empty).");
        if (!cleaner_name) return showError("Cleaner name is required.");
        if (!staff_name) return showError("Staff name is required.");

        const payload = { entry_date, time_in, time_out, cleaner_name, staff_name, notes };

        btnSave.disabled = true;
        btnSave.textContent = editingId ? "Updating…" : "Saving…";

        try {
          if (!editingId) {
            await ctx.apiFetch("/cleaning/entries", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            ctx.toast("Saved");
          } else {
            await ctx.apiFetch("/cleaning/entries/" + editingId, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            ctx.toast("Updated");
          }

          setEditing(null);
          await loadEntries();
        } catch (e) {
          showError(e && e.message ? e.message : String(e));
        } finally {
          btnSave.disabled = false;
          btnSave.textContent = editingId ? "Update entry" : "Save entry";
        }
      }

      async function printReport() {
        // Ask date range
        const defFrom = month + "-01";
        const defTo = (ctx.nowLocalYmd ? ctx.nowLocalYmd() : new Date().toISOString().slice(0, 10));

        const from = prompt("Report FROM date (YYYY-MM-DD):", defFrom);
        if (from === null) return;
        const to = prompt("Report TO date (YYYY-MM-DD):", defTo);
        if (to === null) return;

        const f = String(from || "").trim();
        const t = String(to || "").trim();
        if (!isValidYmd(f) || !isValidYmd(t)) {
          alert("Invalid from/to date format.");
          return;
        }
        if (t < f) {
          alert("TO must be after FROM.");
          return;
        }

        try {
          const data = await ctx.apiFetch("/cleaning/report?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t), { method: "GET" });
          if (!data || !data.ok) throw new Error("Report failed");

          // Build print DOM into #printRoot
          let pr = document.getElementById("printRoot");
          if (!pr) {
            pr = document.createElement("div");
            pr.id = "printRoot";
            document.body.appendChild(pr);
          }
          pr.innerHTML = renderPrintHtml(ctx, data);

          // Trigger print (core.js routes this to top.print when embedded)
          window.print();

          // Leave content briefly then clear
          setTimeout(() => {
            try { pr.innerHTML = ""; } catch (e) {}
          }, 700);
        } catch (e) {
          alert(e && e.message ? e.message : String(e));
        }
      }

      // Wire events
      qs("input", monthField).addEventListener("change", async (ev) => {
        const v = ev.target.value;
        if (!v || !/^\d{4}-\d{2}$/.test(v)) return;
        month = v;
        await loadEntries();
      });

      btnPrev.addEventListener("click", async () => {
        month = ctx.addMonths ? ctx.addMonths(month, -1) : month;
        qs("input", monthField).value = month;
        await loadEntries();
      });

      btnNext.addEventListener("click", async () => {
        month = ctx.addMonths ? ctx.addMonths(month, +1) : month;
        qs("input", monthField).value = month;
        await loadEntries();
      });

      btnReload.addEventListener("click", loadEntries);
      btnSave.addEventListener("click", saveEntry);
      btnCancel.addEventListener("click", () => setEditing(null));
      btnPrint.addEventListener("click", printReport);

      // Initial load
      loadEntries();

      return {
        unmount: function () {
          // Nothing special
        }
      };
    }
  };

  // Register
  if (window.EIKON && typeof window.EIKON.registerModule === "function") {
    window.EIKON.registerModule("cleaning", module);
  } else {
    // If core wasn't loaded yet, retry briefly
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (window.EIKON && typeof window.EIKON.registerModule === "function") {
        clearInterval(t);
        window.EIKON.registerModule("cleaning", module);
      }
      if (tries > 40) clearInterval(t);
    }, 50);
  }
})();
