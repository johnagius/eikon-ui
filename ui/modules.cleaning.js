(function () {
  "use strict";

  const E = window.EIKON;

  if (!E || !E.util || !E.modules) {
    console.error("[EIKON][cleaning] EIKON core not found. Make sure core.js loads before modules.cleaning.js");
    return;
  }

  const dbg = (...args) => console.log("[EIKON][cleaning]", ...args);
  const dbe = (...args) => console.error("[EIKON][cleaning]", ...args);

  function pad2(n) {
    const v = String(n);
    return v.length === 1 ? "0" + v : v;
  }

  function todayYmd() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function currentMonthYyyyMm() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function isValidYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function isValidHm(s) {
    const v = String(s || "").trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  }

  async function api(path, opts) {
    dbg("API ->", path, opts || {});
    try {
      const res = await E.util.apiFetch(path, opts || {});
      dbg("API <-", path, res);
      return res;
    } catch (err) {
      dbe("API !!", path, err);
      throw err;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function openPrintTabWithHtml(html, title) {
    dbg("openPrintTabWithHtml()");
    const w = window.open("", "_blank");
    if (!w) {
      E.util.toast("Popup blocked. Allow popups to open the report tab.", "error");
      return;
    }
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.document.title = title || "Report";
    } catch (e) {
      dbe("Failed to open print tab", e);
      E.util.toast("Failed to open report tab.", "error");
    }
  }

  function buildCleaningReportHtml(payload) {
    const orgName = esc(payload.org_name || "");
    const locationName = esc(payload.location_name || "");
    const from = esc(payload.from || "");
    const to = esc(payload.to || "");
    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    const rows = entries
      .map((e) => {
        return `
          <tr>
            <td>${esc(e.entry_date || "")}</td>
            <td>${esc(e.time_in || "")}</td>
            <td>${esc(e.time_out || "")}</td>
            <td>${esc(e.cleaner_name || "")}</td>
            <td>${esc(e.staff_name || "")}</td>
            <td>${esc(e.notes || "")}</td>
          </tr>
        `.trim();
      })
      .join("");

    const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Cleaning Report</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 18px; }
    h1 { margin: 0 0 6px 0; font-size: 20px; }
    .meta { color: #444; margin-bottom: 14px; }
    .btns { margin: 14px 0; display: flex; gap: 10px; }
    button { padding: 10px 14px; border: 0; border-radius: 10px; background: #111; color: #fff; font-weight: 700; cursor: pointer; }
    button.secondary { background: #444; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; vertical-align: top; }
    th { background: #f6f6f6; text-align: left; }
    @media print {
      .btns { display: none; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>Cleaning Register</h1>
  <div class="meta">
    <div><b>Org:</b> ${orgName}</div>
    <div><b>Location:</b> ${locationName}</div>
    <div><b>Range:</b> ${from} to ${to}</div>
  </div>

  <div class="btns">
    <button onclick="window.print()">Print</button>
    <button class="secondary" onclick="window.close()">Close</button>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 110px;">Date</th>
        <th style="width: 80px;">Time In</th>
        <th style="width: 80px;">Time Out</th>
        <th style="width: 160px;">Cleaner</th>
        <th style="width: 160px;">Staff</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="6">No entries.</td></tr>`}
    </tbody>
  </table>
</body>
</html>
    `.trim();

    return html;
  }

  E.modules.cleaning = {
    key: "cleaning",
    title: "Cleaning",
    render: function (root) {
      dbg("render() start");

      const state = {
        month: currentMonthYyyyMm(),
        entries: [],
        loading: false,
        editingId: null
      };

      root.innerHTML = `
        <div class="eikon-module">
          <div class="eikon-row eikon-row-between eikon-gap-12 eikon-wrap">
            <div>
              <div class="eikon-title">Cleaning</div>
              <div class="eikon-subtitle">Create, edit, delete cleaning register entries (including past dates).</div>
            </div>

            <div class="eikon-row eikon-gap-8 eikon-wrap">
              <div class="eikon-field">
                <label class="eikon-label">Month</label>
                <input id="cl-month" type="month" class="eikon-input" value="${state.month}" />
              </div>
              <button id="cl-refresh" class="eikon-btn">Refresh</button>
            </div>
          </div>

          <div class="eikon-grid eikon-grid-2 eikon-gap-12" style="margin-top: 12px;">
            <div class="eikon-card">
              <div class="eikon-card-title" id="cl-form-title">New Entry</div>

              <div class="eikon-grid eikon-grid-2 eikon-gap-10" style="margin-top: 10px;">
                <div class="eikon-field">
                  <label class="eikon-label">Date</label>
                  <input id="cl-date" type="date" class="eikon-input" value="${todayYmd()}" />
                </div>

                <div class="eikon-field">
                  <label class="eikon-label">Cleaner Name</label>
                  <input id="cl-cleaner" type="text" class="eikon-input" placeholder="e.g. Maria" />
                </div>

                <div class="eikon-field">
                  <label class="eikon-label">Time In</label>
                  <input id="cl-time-in" type="time" class="eikon-input" value="08:00" />
                </div>

                <div class="eikon-field">
                  <label class="eikon-label">Time Out (optional)</label>
                  <input id="cl-time-out" type="time" class="eikon-input" />
                </div>

                <div class="eikon-field">
                  <label class="eikon-label">Staff Name</label>
                  <input id="cl-staff" type="text" class="eikon-input" placeholder="e.g. John" />
                </div>

                <div class="eikon-field">
                  <label class="eikon-label">Notes</label>
                  <input id="cl-notes" type="text" class="eikon-input" placeholder="Optional notes" />
                </div>
              </div>

              <div class="eikon-row eikon-gap-8 eikon-wrap" style="margin-top: 12px;">
                <button id="cl-save" class="eikon-btn eikon-btn-primary">Save</button>
                <button id="cl-clear" class="eikon-btn eikon-btn-ghost">Clear</button>
                <button id="cl-delete" class="eikon-btn eikon-btn-danger" style="display:none;">Delete</button>
              </div>

              <div class="eikon-muted" id="cl-form-hint" style="margin-top: 10px;"></div>
            </div>

            <div class="eikon-card">
              <div class="eikon-card-title">Entries</div>
              <div class="eikon-muted" style="margin-top: 6px;">Click “Edit” to load an entry into the form.</div>
              <div id="cl-table" style="margin-top: 10px;"></div>
            </div>
          </div>

          <div class="eikon-card" style="margin-top: 12px;">
            <div class="eikon-card-title">Report</div>
            <div class="eikon-row eikon-gap-10 eikon-wrap" style="margin-top: 10px;">
              <div class="eikon-field">
                <label class="eikon-label">From</label>
                <input id="cl-report-from" type="date" class="eikon-input" value="${todayYmd()}" />
              </div>
              <div class="eikon-field">
                <label class="eikon-label">To</label>
                <input id="cl-report-to" type="date" class="eikon-input" value="${todayYmd()}" />
              </div>
              <div class="eikon-row eikon-gap-8" style="align-items: flex-end;">
                <button id="cl-report" class="eikon-btn">Generate Report</button>
              </div>
            </div>
            <div class="eikon-muted" id="cl-report-hint" style="margin-top: 10px;"></div>
          </div>
        </div>
      `.trim();

      const els = {
        month: root.querySelector("#cl-month"),
        refresh: root.querySelector("#cl-refresh"),

        formTitle: root.querySelector("#cl-form-title"),
        date: root.querySelector("#cl-date"),
        timeIn: root.querySelector("#cl-time-in"),
        timeOut: root.querySelector("#cl-time-out"),
        cleaner: root.querySelector("#cl-cleaner"),
        staff: root.querySelector("#cl-staff"),
        notes: root.querySelector("#cl-notes"),
        save: root.querySelector("#cl-save"),
        clear: root.querySelector("#cl-clear"),
        del: root.querySelector("#cl-delete"),
        formHint: root.querySelector("#cl-form-hint"),

        table: root.querySelector("#cl-table"),

        reportFrom: root.querySelector("#cl-report-from"),
        reportTo: root.querySelector("#cl-report-to"),
        reportBtn: root.querySelector("#cl-report"),
        reportHint: root.querySelector("#cl-report-hint")
      };

      function setLoading(isLoading) {
        state.loading = !!isLoading;
        els.save.disabled = state.loading;
        els.refresh.disabled = state.loading;
        els.reportBtn.disabled = state.loading;
      }

      function clearForm() {
        dbg("clearForm()");
        state.editingId = null;
        els.formTitle.textContent = "New Entry";
        els.date.value = todayYmd();
        els.timeIn.value = "08:00";
        els.timeOut.value = "";
        els.cleaner.value = "";
        els.staff.value = "";
        els.notes.value = "";
        els.del.style.display = "none";
        els.save.textContent = "Save";
        els.formHint.textContent = "";
      }

      function setEditMode(entry) {
        dbg("setEditMode()", entry);
        state.editingId = entry.id;
        els.formTitle.textContent = "Edit Entry #" + entry.id;
        els.date.value = entry.entry_date || todayYmd();
        els.timeIn.value = entry.time_in || "08:00";
        els.timeOut.value = entry.time_out || "";
        els.cleaner.value = entry.cleaner_name || "";
        els.staff.value = entry.staff_name || "";
        els.notes.value = entry.notes || "";
        els.del.style.display = "inline-flex";
        els.save.textContent = "Update";
        els.formHint.textContent = "Editing entry " + entry.id + ". Update fields then click Update, or Delete.";
      }

      function validateForm() {
        const entry_date = String(els.date.value || "").trim();
        const time_in = String(els.timeIn.value || "").trim();
        const time_out = String(els.timeOut.value || "").trim();
        const cleaner_name = String(els.cleaner.value || "").trim();
        const staff_name = String(els.staff.value || "").trim();
        const notes = String(els.notes.value || "").trim();

        if (!isValidYmd(entry_date)) return { ok: false, error: "Invalid date (YYYY-MM-DD)" };
        if (!isValidHm(time_in)) return { ok: false, error: "Invalid time in (HH:mm)" };
        if (time_out && !isValidHm(time_out)) return { ok: false, error: "Invalid time out (HH:mm) or leave empty" };
        if (!cleaner_name) return { ok: false, error: "Cleaner name is required" };
        if (!staff_name) return { ok: false, error: "Staff name is required" };

        return {
          ok: true,
          payload: {
            entry_date,
            time_in,
            time_out: time_out || "",
            cleaner_name,
            staff_name,
            notes
          }
        };
      }

      function renderTable() {
        dbg("renderTable() entries=", state.entries.length);

        if (!state.entries || state.entries.length === 0) {
          els.table.innerHTML = `<div class="eikon-muted">No entries for ${esc(state.month)}.</div>`;
          return;
        }

        const rows = state.entries
          .map((e) => {
            return `
              <tr>
                <td>${esc(e.entry_date || "")}</td>
                <td>${esc(e.time_in || "")}</td>
                <td>${esc(e.time_out || "")}</td>
                <td>${esc(e.cleaner_name || "")}</td>
                <td>${esc(e.staff_name || "")}</td>
                <td>${esc(e.notes || "")}</td>
                <td style="white-space:nowrap;">
                  <button class="eikon-btn eikon-btn-ghost" data-act="edit" data-id="${e.id}">Edit</button>
                  <button class="eikon-btn eikon-btn-danger" data-act="del" data-id="${e.id}">Delete</button>
                </td>
              </tr>
            `.trim();
          })
          .join("");

        els.table.innerHTML = `
          <div style="overflow:auto; max-width: 100%;">
            <table class="eikon-table" style="min-width: 860px;">
              <thead>
                <tr>
                  <th style="width:110px;">Date</th>
                  <th style="width:80px;">In</th>
                  <th style="width:80px;">Out</th>
                  <th style="width:160px;">Cleaner</th>
                  <th style="width:160px;">Staff</th>
                  <th>Notes</th>
                  <th style="width:160px;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        `.trim();

        els.table.querySelectorAll("button[data-act]").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const act = btn.getAttribute("data-act");
            const id = parseInt(btn.getAttribute("data-id"), 10);
            if (!id) return;

            const entry = state.entries.find((x) => x.id === id);
            if (!entry) return;

            if (act === "edit") {
              setEditMode(entry);
            } else if (act === "del") {
              await deleteEntry(id);
            }
          });
        });
      }

      async function loadEntries() {
        try {
          setLoading(true);
          els.formHint.textContent = "";
          dbg("loadEntries() month=", state.month);

          const res = await api(`/cleaning/entries?month=${encodeURIComponent(state.month)}`, { method: "GET" });
          if (!res || res.ok !== true) {
            const msg = (res && res.error) ? res.error : "Failed to load entries";
            throw new Error(msg);
          }

          state.entries = Array.isArray(res.entries) ? res.entries : [];
          renderTable();
          E.util.toast(`Loaded ${state.entries.length} cleaning entries`, "success");
        } catch (e) {
          dbe("loadEntries failed", e);
          E.util.toast(e && e.message ? e.message : "Failed to load entries", "error");
          els.table.innerHTML = `<div class="eikon-muted">Failed to load entries.</div>`;
        } finally {
          setLoading(false);
        }
      }

      async function saveEntry() {
        const v = validateForm();
        if (!v.ok) {
          E.util.toast(v.error, "error");
          return;
        }

        try {
          setLoading(true);

          const payload = v.payload;
          dbg("saveEntry()", { editingId: state.editingId, payload });

          let res;
          if (state.editingId) {
            res = await api(`/cleaning/entries/${state.editingId}`, {
              method: "PUT",
              body: JSON.stringify(payload)
            });
          } else {
            res = await api(`/cleaning/entries`, {
              method: "POST",
              body: JSON.stringify(payload)
            });
          }

          if (!res || res.ok !== true) {
            const msg = (res && res.error) ? res.error : "Save failed";
            throw new Error(msg);
          }

          E.util.toast(state.editingId ? "Entry updated" : "Entry created", "success");
          clearForm();
          await loadEntries();
        } catch (e) {
          dbe("saveEntry failed", e);
          E.util.toast(e && e.message ? e.message : "Save failed", "error");
        } finally {
          setLoading(false);
        }
      }

      async function deleteEntry(entryId) {
        try {
          const ok = await E.util.modalConfirm(
            "Delete entry",
            "Are you sure you want to delete cleaning entry #" + entryId + "? This cannot be undone."
          );
          if (!ok) return;

          setLoading(true);
          dbg("deleteEntry()", entryId);

          const res = await api(`/cleaning/entries/${entryId}`, { method: "DELETE" });
          if (!res || res.ok !== true) {
            const msg = (res && res.error) ? res.error : "Delete failed";
            throw new Error(msg);
          }

          E.util.toast("Entry deleted", "success");

          if (state.editingId === entryId) clearForm();
          await loadEntries();
        } catch (e) {
          dbe("deleteEntry failed", e);
          E.util.toast(e && e.message ? e.message : "Delete failed", "error");
        } finally {
          setLoading(false);
        }
      }

      async function generateReport() {
        const from = String(els.reportFrom.value || "").trim();
        const to = String(els.reportTo.value || "").trim();

        dbg("generateReport()", { from, to });

        if (!isValidYmd(from) || !isValidYmd(to)) {
          E.util.toast("Invalid report dates (YYYY-MM-DD).", "error");
          return;
        }
        if (to < from) {
          E.util.toast("Report 'To' must be >= 'From'.", "error");
          return;
        }

        try {
          setLoading(true);
          els.reportHint.textContent = "Generating report…";

          const res = await api(`/cleaning/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "GET" });
          if (!res || res.ok !== true) {
            const msg = (res && res.error) ? res.error : "Report failed";
            throw new Error(msg);
          }

          const html = buildCleaningReportHtml(res);
          openPrintTabWithHtml(html, "Cleaning Report");

          els.reportHint.textContent = "Report opened in a new tab (if popups are allowed).";
        } catch (e) {
          dbe("generateReport failed", e);
          E.util.toast(e && e.message ? e.message : "Report failed", "error");
          els.reportHint.textContent = "Report failed.";
        } finally {
          setLoading(false);
        }
      }

      // Wire events
      els.month.addEventListener("change", () => {
        state.month = String(els.month.value || "").trim() || currentMonthYyyyMm();
        dbg("month changed ->", state.month);
        loadEntries();
      });

      els.refresh.addEventListener("click", () => loadEntries());
      els.save.addEventListener("click", () => saveEntry());
      els.clear.addEventListener("click", () => clearForm());

      els.del.addEventListener("click", async () => {
        if (!state.editingId) return;
        await deleteEntry(state.editingId);
      });

      els.reportBtn.addEventListener("click", () => generateReport());

      // Initial load
      if (!els.month.value) els.month.value = state.month;
      loadEntries();

      dbg("render() done");
    }
  };

  dbg("module registered as E.modules.cleaning");
})();
