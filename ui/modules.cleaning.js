(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.cleaning.js)");

  function esc(s) { return E.escapeHtml(s); }

  function ymd(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var dd = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function ym(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }

  var state = {
    lastMonth: "",
    entriesByMonth: {}
  };

  async function loadEntries(month) {
    E.dbg("[cleaning] loadEntries() month=", month);
    var resp = await E.apiFetch("/cleaning/entries?month=" + encodeURIComponent(month), { method: "GET" });
    if (!resp || !resp.ok) throw new Error("Failed to load cleaning entries");
    state.entriesByMonth[month] = resp.entries || [];
    E.dbg("[cleaning] entries loaded:", state.entriesByMonth[month].length);
    return state.entriesByMonth[month];
  }

  function renderTable(tbody, entries) {
    tbody.innerHTML = "";
    entries.forEach(function (r) {
      var tr = document.createElement("tr");

      function td(txt) {
        var t = document.createElement("td");
        t.textContent = txt;
        return t;
      }

      tr.appendChild(td(r.entry_date || ""));
      tr.appendChild(td(r.time_in || ""));
      tr.appendChild(td(r.time_out || ""));
      tr.appendChild(td(r.cleaner_name || ""));
      tr.appendChild(td(r.staff_name || ""));
      tr.appendChild(td(r.notes || ""));

      var act = document.createElement("td");

      var editBtn = document.createElement("button");
      editBtn.className = "eikon-btn";
      editBtn.textContent = "Edit";

      var delBtn = document.createElement("button");
      delBtn.className = "eikon-btn danger";
      delBtn.style.marginLeft = "8px";
      delBtn.textContent = "Delete";

      editBtn.addEventListener("click", function () { openEdit(r); });
      delBtn.addEventListener("click", function () { openDelete(r); });

      act.appendChild(editBtn);
      act.appendChild(delBtn);
      tr.appendChild(act);

      tbody.appendChild(tr);
    });

    function openEdit(row) {
      var body =
        '<div class="eikon-row">' +
        '  <div class="eikon-field">' +
        '    <div class="eikon-label">Date</div>' +
        '    <input class="eikon-input" id="cl-edit-date" type="date" value="' + esc(row.entry_date || "") + '"/>' +
        "  </div>" +
        '  <div class="eikon-field">' +
        '    <div class="eikon-label">Time In</div>' +
        '    <input class="eikon-input" id="cl-edit-in" type="time" value="' + esc(row.time_in || "") + '"/>' +
        "  </div>" +
        '  <div class="eikon-field">' +
        '    <div class="eikon-label">Time Out</div>' +
        '    <input class="eikon-input" id="cl-edit-out" type="time" value="' + esc(row.time_out || "") + '"/>' +
        "  </div>" +
        '  <div class="eikon-field" style="flex:1;min-width:220px;">' +
        '    <div class="eikon-label">Cleaner Name</div>' +
        '    <input class="eikon-input" id="cl-edit-cleaner" type="text" value="' + esc(row.cleaner_name || "") + '"/>' +
        "  </div>" +
        '  <div class="eikon-field" style="flex:1;min-width:220px;">' +
        '    <div class="eikon-label">Staff Name</div>' +
        '    <input class="eikon-input" id="cl-edit-staff" type="text" value="' + esc(row.staff_name || "") + '"/>' +
        "  </div>" +
        "</div>" +
        '<div class="eikon-row" style="margin-top:10px;">' +
        '  <div class="eikon-field" style="flex:1;min-width:260px;">' +
        '    <div class="eikon-label">Notes</div>' +
        '    <input class="eikon-input" id="cl-edit-notes" type="text" value="' + esc(row.notes || "") + '"/>' +
        "  </div>" +
        "</div>";

      E.modal.show("Edit Cleaning Entry", body, [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Save",
          primary: true,
          onClick: async function () {
            try {
              var payload = {
                entry_date: E.q("#cl-edit-date").value,
                time_in: E.q("#cl-edit-in").value,
                time_out: E.q("#cl-edit-out").value,
                cleaner_name: E.q("#cl-edit-cleaner").value.trim(),
                staff_name: E.q("#cl-edit-staff").value.trim(),
                notes: E.q("#cl-edit-notes").value.trim()
              };

              E.dbg("[cleaning] update payload:", payload);

              await E.apiFetch("/cleaning/entries/" + encodeURIComponent(String(row.id)), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });

              E.modal.hide();

              // refresh current month
              var month = state.lastMonth || ym(new Date());
              var fresh = await loadEntries(month);
              renderTable(tbody, fresh);
            } catch (e) {
              E.error("[cleaning] update failed:", e);
              E.modal.show("Save failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
                { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          }
        }
      ]);
    }

    function openDelete(row) {
      E.modal.show("Delete cleaning entry?", "<div>Delete entry on <b>" + esc(row.entry_date || "") + "</b> for <b>" + esc(row.cleaner_name || "") + "</b>?</div>", [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Delete",
          danger: true,
          onClick: async function () {
            try {
              await E.apiFetch("/cleaning/entries/" + encodeURIComponent(String(row.id)), { method: "DELETE" });
              E.modal.hide();
              var month = state.lastMonth || ym(new Date());
              var fresh = await loadEntries(month);
              renderTable(tbody, fresh);
            } catch (e) {
              E.error("[cleaning] delete failed:", e);
              E.modal.show("Delete failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
                { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          }
        }
      ]);
    }
  }

  async function render(ctx) {
    var mount = ctx.mount;
    E.dbg("[cleaning] render() start");

    var month = state.lastMonth || ym(new Date());
    state.lastMonth = month;

    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Month</div>' +
      '      <input class="eikon-input" id="cl-month" type="month" value="' + esc(month) + '"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Actions</div>' +
      '      <div class="eikon-row" style="gap:10px;">' +
      '        <button class="eikon-btn" id="cl-refresh">Refresh</button>' +
      '        <button class="eikon-btn" id="cl-print">Print</button>' +
      "      </div>" +
      "    </div>" +
      '    <div class="eikon-field" style="flex:1;min-width:260px;">' +
      '      <div class="eikon-label">Notes</div>' +
      '      <div class="eikon-help">You can enter past dates. Time out can be empty.</div>' +
      "    </div>" +
      "  </div>" +
      "</div>" +

      '<div class="eikon-card">' +
      '  <div style="font-weight:900;margin-bottom:10px;">Add Entry</div>' +
      '  <div class="eikon-row">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Date</div>' +
      '      <input class="eikon-input" id="cl-date" type="date" value="' + esc(ymd(new Date())) + '"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Time In</div>' +
      '      <input class="eikon-input" id="cl-in" type="time" value="08:00"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Time Out (optional)</div>' +
      '      <input class="eikon-input" id="cl-out" type="time" value=""/>' +
      "    </div>" +
      '    <div class="eikon-field" style="flex:1;min-width:220px;">' +
      '      <div class="eikon-label">Cleaner Name</div>' +
      '      <input class="eikon-input" id="cl-cleaner" type="text" placeholder="e.g. Maria"/>' +
      "    </div>" +
      '    <div class="eikon-field" style="flex:1;min-width:220px;">' +
      '      <div class="eikon-label">Staff Name</div>' +
      '      <input class="eikon-input" id="cl-staff" type="text" placeholder="e.g. John"/>' +
      "    </div>" +
      "  </div>" +
      '  <div class="eikon-row" style="margin-top:10px;">' +
      '    <div class="eikon-field" style="flex:1;min-width:260px;">' +
      '      <div class="eikon-label">Notes</div>' +
      '      <input class="eikon-input" id="cl-notes" type="text" placeholder="optional"/>' +
      "    </div>" +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">&nbsp;</div>' +
      '      <button class="eikon-btn primary" id="cl-save">Save</button>' +
      "    </div>" +
      "  </div>" +
      "</div>" +

      '<div class="eikon-card">' +
      '  <div style="font-weight:900;margin-bottom:10px;">Register</div>' +
      '  <div class="eikon-table-wrap">' +
      '    <table class="eikon-table">' +
      "      <thead>" +
      "        <tr>" +
      "          <th>Date</th>" +
      "          <th>Time In</th>" +
      "          <th>Time Out</th>" +
      "          <th>Cleaner</th>" +
      "          <th>Staff</th>" +
      "          <th>Notes</th>" +
      "          <th>Actions</th>" +
      "        </tr>" +
      "      </thead>" +
      '      <tbody id="cl-tbody"></tbody>' +
      "    </table>" +
      "  </div>" +
      "</div>";

    var monthInput = E.q("#cl-month", mount);
    var refreshBtn = E.q("#cl-refresh", mount);
    var printBtn = E.q("#cl-print", mount);
    var saveBtn = E.q("#cl-save", mount);
    var tbody = E.q("#cl-tbody", mount);

    if (!monthInput || !refreshBtn || !saveBtn || !tbody) {
      E.error("[cleaning] DOM missing", {
        monthInput: !!monthInput,
        refreshBtn: !!refreshBtn,
        saveBtn: !!saveBtn,
        tbody: !!tbody
      });
      E.error("[cleaning] mount innerHTML snapshot:", mount.innerHTML.slice(0, 2000));
      throw new Error("Cleaning DOM incomplete (see console)");
    }

    async function refresh() {
      var m = monthInput.value || month;
      state.lastMonth = m;
      var entries = await loadEntries(m);
      renderTable(tbody, entries);
    }

    monthInput.addEventListener("change", function () {
      refresh().catch(function (e) { E.error(e); });
    });

    refreshBtn.addEventListener("click", function () {
      refresh().catch(function (e) { E.error(e); });
    });

    printBtn.addEventListener("click", function () {
      E.dbg("[cleaning] print()");
      try { window.print(); } catch (e) { E.error("[cleaning] print failed:", e); }
    });

    saveBtn.addEventListener("click", async function () {
      try {
        var payload = {
          entry_date: E.q("#cl-date", mount).value,
          time_in: E.q("#cl-in", mount).value,
          time_out: E.q("#cl-out", mount).value,
          cleaner_name: E.q("#cl-cleaner", mount).value.trim(),
          staff_name: E.q("#cl-staff", mount).value.trim(),
          notes: E.q("#cl-notes", mount).value.trim()
        };

        E.dbg("[cleaning] create payload:", payload);

        await E.apiFetch("/cleaning/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        // Clear quick fields
        try { E.q("#cl-out", mount).value = ""; E.q("#cl-notes", mount).value = ""; } catch (e2) {}

        await refresh();
      } catch (e) {
        E.error("[cleaning] create failed:", e);
        E.modal.show("Save failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      }
    });

    // Initial load
    await refresh();

    E.dbg("[cleaning] render() done");
  }

  E.registerModule({
    id: "cleaning",
    title: "Cleaning",
    order: 20,
    icon: "🧼",
    render: render
  });

})();
