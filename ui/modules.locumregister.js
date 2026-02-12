(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.locumregister.js)");

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

  var state = { lastMonth: "", entriesByMonth: {} };

  async function loadEntries(month) {
    E.dbg("[locumregister] loadEntries() month=", month);
    var resp = await E.apiFetch("/locumregister/entries?month=" + encodeURIComponent(month), { method: "GET" });
    if (!resp || !resp.ok) throw new Error("Failed to load locum register entries");
    state.entriesByMonth[month] = resp.entries || [];
    E.dbg("[locumregister] entries loaded:", state.entriesByMonth[month].length);
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
      tr.appendChild(td(r.locum_full_name || ""));
      tr.appendChild(td(r.registration_number || ""));

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
        '<div class="eikon-form">' +

        '<div class="eikon-field">' +
          '<label>Date</label>' +
          '<input id="lr-edit-date" class="eikon-input" type="date" value="' + esc(row.entry_date || "") + '">' +
        '</div>' +

        '<div class="eikon-field">' +
          '<label>Time In</label>' +
          '<input id="lr-edit-in" class="eikon-input" type="time" value="' + esc(row.time_in || "") + '">' +
        '</div>' +

        '<div class="eikon-field">' +
          '<label>Time Out</label>' +
          '<input id="lr-edit-out" class="eikon-input" type="time" value="' + esc(row.time_out || "") + '">' +
        '</div>' +

        '<div class="eikon-field">' +
          '<label>Name & Surname</label>' +
          '<input id="lr-edit-name" class="eikon-input" type="text" value="' + esc(row.locum_full_name || "") + '">' +
        '</div>' +

        '<div class="eikon-field">' +
          '<label>Registration Number</label>' +
          '<input id="lr-edit-reg" class="eikon-input" type="text" value="' + esc(row.registration_number || "") + '">' +
        '</div>' +

        '</div>';

      E.modal.show("Edit Locum Register Entry", body, [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Save",
          primary: true,
          onClick: async function () {
            try {
              var payload = {
                entry_date: E.q("#lr-edit-date").value,
                time_in: E.q("#lr-edit-in").value,
                time_out: E.q("#lr-edit-out").value,
                locum_full_name: E.q("#lr-edit-name").value.trim(),
                registration_number: E.q("#lr-edit-reg").value.trim()
              };

              E.dbg("[locumregister] update payload:", payload);

              await E.apiFetch("/locumregister/entries/" + encodeURIComponent(String(row.id)), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });

              E.modal.hide();

              var month = state.lastMonth || ym(new Date());
              var fresh = await loadEntries(month);
              renderTable(tbody, fresh);
            } catch (e) {
              E.error("[locumregister] update failed:", e);
              E.modal.show("Save failed",
                '<div class="eikon-msg">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>',
                [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
              );
            }
          }
        }
      ]);
    }

    function openDelete(row) {
      E.modal.show(
        "Delete locum register entry?",
        '<div class="eikon-msg">Delete entry on <b>' + esc(row.entry_date || "") + '</b> for <b>' + esc(row.locum_full_name || "") + '</b>?</div>',
        [
          { label: "Cancel", onClick: function () { E.modal.hide(); } },
          {
            label: "Delete",
            danger: true,
            onClick: async function () {
              try {
                await E.apiFetch("/locumregister/entries/" + encodeURIComponent(String(row.id)), { method: "DELETE" });
                E.modal.hide();
                var month = state.lastMonth || ym(new Date());
                var fresh = await loadEntries(month);
                renderTable(tbody, fresh);
              } catch (e) {
                E.error("[locumregister] delete failed:", e);
                E.modal.show("Delete failed",
                  '<div class="eikon-msg">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>',
                  [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
                );
              }
            }
          }
        ]
      );
    }
  }

  // -------------------------------
  // PRINT HELPERS (same style as Cleaning/Temperature)
  // -------------------------------
  function buildLocumRegisterPrintHtml(month, entries) {
    month = String(month || "");
    entries = Array.isArray(entries) ? entries : [];

    function esc2(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }

    var rows = entries.slice().sort(function (a, b) {
      var ad = String((a && a.entry_date) || "");
      var bd = String((b && b.entry_date) || "");
      if (ad !== bd) return ad.localeCompare(bd);
      var ati = String((a && a.time_in) || "");
      var bti = String((b && b.time_in) || "");
      return ati.localeCompare(bti);
    }).map(function (r) {
      return ""
        + "<tr>"
        + "<td>" + esc2(r.entry_date || "") + "</td>"
        + "<td>" + esc2(r.time_in || "") + "</td>"
        + "<td>" + esc2(r.time_out || "") + "</td>"
        + "<td>" + esc2(r.locum_full_name || "") + "</td>"
        + "<td>" + esc2(r.registration_number || "") + "</td>"
        + "</tr>";
    }).join("");

    var title = "Locum Register";
    var subtitle = month ? ("Month \u2022 " + month) : "";

    return ""
      + "<!doctype html><html><head><meta charset=\"utf-8\">"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
      + "<title>" + esc2(title) + (month ? (" - " + esc2(month)) : "") + "</title>"
      + "<style>"
      + "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:28px;color:#111;}"
      + "h1{margin:0 0 6px 0;font-size:22px;}"
      + ".sub{margin:0 0 18px 0;color:#444;font-size:13px;}"
      + "table{width:100%;border-collapse:collapse;font-size:12px;}"
      + "th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;vertical-align:top;}"
      + "th{background:#f2f2f2;font-weight:700;}"
      + "@media print{body{margin:12px;} }"
      + "</style>"
      + "</head><body>"
      + "<h1>" + esc2(title) + "</h1>"
      + "<div class=\"sub\">" + esc2(subtitle) + "</div>"
      + "<table>"
      + "<thead><tr>"
      + "<th>Date</th><th>Time In</th><th>Time Out</th><th>Name &amp; Surname</th><th>Registration No</th>"
      + "</tr></thead>"
      + "<tbody>" + rows + "</tbody>"
      + "</table>"
      + "<script>try{setTimeout(function(){window.print();},350);}catch(e){}</script>"
      + "</body></html>";
  }

  function openPrintTabWithHtml(html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);

    var w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }

    if (!w) {
      try {
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e2) {}
    }

    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e3) {}
    }, 60000);
  }

  async function render(ctx) {
    var mount = ctx.mount;
    E.dbg("[locumregister] render() start");

    var month = state.lastMonth || ym(new Date());
    state.lastMonth = month;

    mount.innerHTML =
      '<div class="eikon-card">' +
        '<div class="eikon-card-head">' +
          '<div>' +
            '<div class="eikon-title">Locum Register</div>' +
            '<div class="eikon-sub">You can enter past dates. Time out can be empty.</div>' +
          '</div>' +
          '<div class="eikon-row">' +
            '<div class="eikon-field inline">' +
              '<label>Month</label>' +
              '<input id="lr-month" class="eikon-input" type="month" value="' + esc(month) + '">' +
            '</div>' +
            '<div class="eikon-field inline">' +
              '<label>Actions</label>' +
              '<div>' +
                '<button id="lr-refresh" class="eikon-btn" type="button">Refresh</button>' +
                '<button id="lr-print" class="eikon-btn" type="button" style="margin-left:8px;">Print</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="eikon-card-head">' +
          '<div class="eikon-title">Add Entry</div>' +
        '</div>' +
        '<div class="eikon-card-body">' +
          '<div class="eikon-grid">' +
            '<div class="eikon-field">' +
              '<label>Date</label>' +
              '<input id="lr-date" class="eikon-input" type="date" value="' + esc(ymd(new Date())) + '">' +
            '</div>' +
            '<div class="eikon-field">' +
              '<label>Time In</label>' +
              '<input id="lr-in" class="eikon-input" type="time" value="">' +
            '</div>' +
            '<div class="eikon-field">' +
              '<label>Time Out (optional)</label>' +
              '<input id="lr-out" class="eikon-input" type="time" value="">' +
            '</div>' +
            '<div class="eikon-field">' +
              '<label>Name & Surname</label>' +
              '<input id="lr-name" class="eikon-input" type="text" value="">' +
            '</div>' +
            '<div class="eikon-field">' +
              '<label>Registration Number</label>' +
              '<input id="lr-reg" class="eikon-input" type="text" value="">' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:12px;">' +
            '<button id="lr-save" class="eikon-btn primary" type="button">Save</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="eikon-card-head">' +
          '<div class="eikon-title">Register</div>' +
        '</div>' +
        '<div class="eikon-card-body">' +
          '<div class="eikon-table-wrap">' +
            '<table class="eikon-table">' +
              '<thead>' +
                '<tr>' +
                  '<th>Date</th>' +
                  '<th>Time In</th>' +
                  '<th>Time Out</th>' +
                  '<th>Name & Surname</th>' +
                  '<th>Registration No</th>' +
                  '<th>Actions</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="lr-tbody"></tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</div>';

    var monthInput = E.q("#lr-month", mount);
    var refreshBtn = E.q("#lr-refresh", mount);
    var printBtn = E.q("#lr-print", mount);
    var saveBtn = E.q("#lr-save", mount);
    var tbody = E.q("#lr-tbody", mount);

    if (!monthInput || !refreshBtn || !printBtn || !saveBtn || !tbody) {
      E.error("[locumregister] DOM missing", {
        monthInput: !!monthInput,
        refreshBtn: !!refreshBtn,
        printBtn: !!printBtn,
        saveBtn: !!saveBtn,
        tbody: !!tbody
      });
      E.error("[locumregister] mount innerHTML snapshot:", mount.innerHTML.slice(0, 2000));
      throw new Error("Locum Register DOM incomplete (see console)");
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

    // Print (same pattern as Cleaning -> new tab + auto print)
    printBtn.addEventListener("click", async function () {
      E.dbg("[locumregister] print()");
      try {
        var m = String(monthInput.value || state.lastMonth || month || ym(new Date())).trim();
        state.lastMonth = m;
        var entries = state.entriesByMonth[m];
        if (!Array.isArray(entries)) {
          entries = await loadEntries(m);
        }
        var html = buildLocumRegisterPrintHtml(m, entries || []);
        openPrintTabWithHtml(html);
      } catch (e) {
        E.error("[locumregister] print failed:", e);
        E.modal.show("Print failed",
          '<div class="eikon-msg">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>',
          [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
        );
      }
    });

    saveBtn.addEventListener("click", async function () {
      try {
        var payload = {
          entry_date: E.q("#lr-date", mount).value,
          time_in: E.q("#lr-in", mount).value,
          time_out: E.q("#lr-out", mount).value,
          locum_full_name: E.q("#lr-name", mount).value.trim(),
          registration_number: E.q("#lr-reg", mount).value.trim()
        };

        E.dbg("[locumregister] create payload:", payload);

        await E.apiFetch("/locumregister/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        // Clear quick fields (keep same behavior style as cleaning)
        try { E.q("#lr-out", mount).value = ""; } catch (e2) {}
        await refresh();
      } catch (e) {
        E.error("[locumregister] create failed:", e);
        E.modal.show("Save failed",
          '<div class="eikon-msg">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>',
          [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
        );
      }
    });

    await refresh();
    E.dbg("[locumregister] render() done");
  }

  E.registerModule({
    id: "locumregister",
    title: "Locum Register",
    order: 22,
    icon: "👨‍⚕️",
    render: render
  });

})();
