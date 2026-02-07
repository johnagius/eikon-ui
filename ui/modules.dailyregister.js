(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.dailyregister.js)");

  function dbg() {
    try {
      if (E && typeof E.dbg === "function") E.dbg.apply(null, arguments);
      else console.log.apply(console, arguments);
    } catch (e) {}
  }

  function err() {
    try {
      if (E && typeof E.error === "function") E.error.apply(null, arguments);
      else console.error.apply(console, arguments);
    } catch (e) {}
  }

  function esc(s) {
    try {
      return E.escapeHtml(String(s == null ? "" : s));
    } catch (e) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
  }

  function pad2(n) {
    var v = String(n);
    return v.length === 1 ? "0" + v : v;
  }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function thisMonthYm() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function isYm(s) {
    return /^\d{4}-\d{2}$/.test(String(s || "").trim());
  }

  function fmtDmyFromYmd(s) {
    var v = String(s || "").trim();
    if (!isYmd(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }

  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().trim();
  }

  function rowSearchBlob(r) {
    // One blob for quick includes() filtering
    return (
      norm(r.entry_date) + " | " +
      norm(r.client_name) + " | " +
      norm(r.client_id) + " | " +
      norm(r.medicine_name_dose) + " | " +
      norm(r.posology) + " | " +
      norm(r.prescriber_name) + " | " +
      norm(r.prescriber_reg_no)
    );
  }

  async function apiList(monthYm) {
    var ym = String(monthYm || "").trim();
    if (!isYm(ym)) throw new Error("Invalid month (YYYY-MM)");
    dbg("[dailyregister] apiList month=", ym);
    var resp = await E.apiFetch("/daily-register/entries?month=" + encodeURIComponent(ym), { method: "GET" });
    dbg("[dailyregister] apiList resp=", resp);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : "Failed to load daily register entries");
    return Array.isArray(resp.entries) ? resp.entries : [];
  }

  async function apiCreate(payload) {
    dbg("[dailyregister] apiCreate payload=", payload);
    var resp = await E.apiFetch("/daily-register/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    dbg("[dailyregister] apiCreate resp=", resp);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : "Create failed");
    return resp;
  }

  async function apiUpdate(id, payload) {
    dbg("[dailyregister] apiUpdate id=", id, "payload=", payload);
    var resp = await E.apiFetch("/daily-register/entries/" + encodeURIComponent(String(id)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    dbg("[dailyregister] apiUpdate resp=", resp);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : "Update failed");
    return resp;
  }

  async function apiDelete(id) {
    dbg("[dailyregister] apiDelete id=", id);
    var resp = await E.apiFetch("/daily-register/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
    dbg("[dailyregister] apiDelete resp=", resp);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : "Delete failed");
    return resp;
  }

  function validatePayload(p) {
    var out = {
      entry_date: String(p.entry_date || "").trim(),
      client_name: String(p.client_name || "").trim(),
      client_id: String(p.client_id || "").trim(),
      medicine_name_dose: String(p.medicine_name_dose || "").trim(),
      posology: String(p.posology || "").trim(),
      prescriber_name: String(p.prescriber_name || "").trim(),
      prescriber_reg_no: String(p.prescriber_reg_no || "").trim()
    };

    if (!out.entry_date || !isYmd(out.entry_date)) throw new Error("Date is required (YYYY-MM-DD)");
    if (!out.client_name) throw new Error("Client Name & Surname is required");
    if (!out.client_id) throw new Error("Client ID is required");
    if (!out.medicine_name_dose) throw new Error("Medicine Name & Dose is required");
    if (!out.posology) throw new Error("Posology is required");
    if (!out.prescriber_name) throw new Error("Prescriber Name is required");
    if (!out.prescriber_reg_no) throw new Error("Prescriber Reg No is required");

    // Keep lengths sane (avoid accidents)
    if (out.client_name.length > 200) throw new Error("Client Name too long");
    if (out.client_id.length > 100) throw new Error("Client ID too long");
    if (out.medicine_name_dose.length > 300) throw new Error("Medicine Name & Dose too long");
    if (out.posology.length > 400) throw new Error("Posology too long");
    if (out.prescriber_name.length > 200) throw new Error("Prescriber Name too long");
    if (out.prescriber_reg_no.length > 100) throw new Error("Prescriber Reg No too long");

    return out;
  }

  function modalError(title, e) {
    try {
      var msg = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : "Error");
      E.modal.show(title || "Error", '<div class="eikon-alert">' + esc(msg) + "</div>", [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
    } catch (e2) {
      alert(String(e && (e.message || e) ? (e.message || e) : "Error"));
    }
  }

  function openEntryModal(opts) {
    // opts: { mode: "new"|"edit", entry: {...} }
    var mode = (opts && opts.mode) ? String(opts.mode) : "new";
    var entry = (opts && opts.entry) ? opts.entry : {};

    var isEdit = mode === "edit";
    var title = isEdit ? "Edit Daily Register Entry" : "New Daily Register Entry";

    var initial = {
      entry_date: String(entry.entry_date || todayYmd()).trim(),
      client_name: String(entry.client_name || "").trim(),
      client_id: String(entry.client_id || "").trim(),
      medicine_name_dose: String(entry.medicine_name_dose || "").trim(),
      posology: String(entry.posology || "").trim(),
      prescriber_name: String(entry.prescriber_name || "").trim(),
      prescriber_reg_no: String(entry.prescriber_reg_no || "").trim()
    };

    var body =
      '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;align-items:flex-start;">' +
      '  <div class="eikon-field" style="min-width:220px;flex:0 0 auto;">' +
      '    <div class="eikon-label">Date</div>' +
      '    <input class="eikon-input" id="dr-date" type="date" value="' + esc(initial.entry_date) + '"/>' +
      "  </div>" +
      '  <div class="eikon-field" style="min-width:320px;flex:1 1 320px;">' +
      '    <div class="eikon-label">Client Name &amp; Surname</div>' +
      '    <input class="eikon-input" id="dr-client-name" type="text" value="' + esc(initial.client_name) + '" placeholder="e.g. Maria Borg"/>' +
      "  </div>" +
      '  <div class="eikon-field" style="min-width:220px;flex:0 0 auto;">' +
      '    <div class="eikon-label">Client ID</div>' +
      '    <input class="eikon-input" id="dr-client-id" type="text" value="' + esc(initial.client_id) + '" placeholder="e.g. ID card / passport / other"/>' +
      "  </div>" +
      "</div>" +
      '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;align-items:flex-start;margin-top:10px;">' +
      '  <div class="eikon-field" style="min-width:420px;flex:1 1 420px;">' +
      '    <div class="eikon-label">Medicine Name &amp; Dose</div>' +
      '    <input class="eikon-input" id="dr-med" type="text" value="' + esc(initial.medicine_name_dose) + '" placeholder="e.g. Amoxicillin 500mg caps"/>' +
      "  </div>" +
      '  <div class="eikon-field" style="min-width:420px;flex:1 1 420px;">' +
      '    <div class="eikon-label">Posology</div>' +
      '    <input class="eikon-input" id="dr-pos" type="text" value="' + esc(initial.posology) + '" placeholder="e.g. 1 cap TDS for 7 days"/>' +
      "  </div>" +
      "</div>" +
      '<div class="eikon-row" style="gap:12px;flex-wrap:wrap;align-items:flex-start;margin-top:10px;">' +
      '  <div class="eikon-field" style="min-width:320px;flex:1 1 320px;">' +
      '    <div class="eikon-label">Prescriber Name</div>' +
      '    <input class="eikon-input" id="dr-prescriber" type="text" value="' + esc(initial.prescriber_name) + '" placeholder="e.g. Dr John Camilleri"/>' +
      "  </div>" +
      '  <div class="eikon-field" style="min-width:220px;flex:0 0 auto;">' +
      '    <div class="eikon-label">Prescriber Reg No</div>' +
      '    <input class="eikon-input" id="dr-presc-reg" type="text" value="' + esc(initial.prescriber_reg_no) + '" placeholder="e.g. MMC ####"/>' +
      "  </div>" +
      "</div>";

    E.modal.show(title, body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var payload = validatePayload({
                entry_date: (E.q("#dr-date").value || "").trim(),
                client_name: (E.q("#dr-client-name").value || "").trim(),
                client_id: (E.q("#dr-client-id").value || "").trim(),
                medicine_name_dose: (E.q("#dr-med").value || "").trim(),
                posology: (E.q("#dr-pos").value || "").trim(),
                prescriber_name: (E.q("#dr-prescriber").value || "").trim(),
                prescriber_reg_no: (E.q("#dr-presc-reg").value || "").trim()
              });

              if (isEdit) {
                await apiUpdate(entry.id, payload);
              } else {
                await apiCreate(payload);
              }

              E.modal.hide();
              if (state && typeof state.refresh === "function") state.refresh();
            } catch (e) {
              modalError("Save failed", e);
            }
          })();
        }
      }
    ]);
  }

  function openConfirmDelete(entry) {
    if (!entry || !entry.id) return;

    var body =
      '<div class="eikon-alert" style="margin-bottom:10px;">This will permanently delete the entry.</div>' +
      '<div style="font-size:13px;line-height:1.4;">' +
      "<b>Date:</b> " + esc(fmtDmyFromYmd(entry.entry_date)) + "<br/>" +
      "<b>Client:</b> " + esc(entry.client_name) + " (" + esc(entry.client_id) + ")<br/>" +
      "<b>Medicine:</b> " + esc(entry.medicine_name_dose) +
      "</div>";

    E.modal.show("Delete entry?", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Delete",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              await apiDelete(entry.id);
              E.modal.hide();
              if (state && typeof state.refresh === "function") state.refresh();
            } catch (e) {
              modalError("Delete failed", e);
            }
          })();
        }
      }
    ]);
  }

  function openPrintWindow(entries, monthYm, queryText) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var ym = String(monthYm || "").trim();
    var q = String(queryText || "").trim();

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show("Print", '<div class="eikon-alert">Popup blocked. Allow popups and try again.</div>', [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    function safe(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    var rowsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      rowsHtml +=
        "<tr>" +
        "<td>" + safe(fmtDmyFromYmd(r.entry_date || "")) + "</td>" +
        "<td><b>" + safe(r.client_name || "") + "</b><div style=\"opacity:.75;font-size:11px;\">ID: " + safe(r.client_id || "") + "</div></td>" +
        "<td>" + safe(r.medicine_name_dose || "") + "</td>" +
        "<td>" + safe(r.posology || "") + "</td>" +
        "<td>" + safe(r.prescriber_name || "") + "</td>" +
        "<td>" + safe(r.prescriber_reg_no || "") + "</td>" +
        "</tr>";
    }

    var html =
      "<!doctype html><html><head><meta charset=\"utf-8\"/>" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>" +
      "<title>Daily Register</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:22px;color:#111;}" +
      "h1{margin:0 0 6px 0;font-size:20px;}" +
      ".meta{color:#444;margin:0 0 16px 0;font-size:13px;line-height:1.35;}" +
      ".no-print{margin-bottom:10px;display:flex;gap:10px;align-items:center;}" +
      "button{padding:8px 12px;font-weight:900;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer;}" +
      "table{width:100%;border-collapse:collapse;margin-top:8px;}" +
      "th,td{border:1px solid #bbb;padding:6px 8px;font-size:12px;vertical-align:top;}" +
      "th{background:#f2f2f2;}" +
      "@media print{.no-print{display:none;}body{margin:0;}}" +
      "</style>" +
      "</head><body>" +
      "<div class=\"no-print\">" +
      "<button id=\"btnPrint\">Print</button>" +
      "<div style=\"font-weight:900;color:#444;\">Rows: " + safe(String(list.length)) + "</div>" +
      "</div>" +
      "<h1>Daily Register</h1>" +
      "<div class=\"meta\">" +
      "<div><b>Month:</b> " + safe(ym || "-") + "</div>" +
      "<div><b>Search:</b> " + safe(q || "-") + "</div>" +
      "<div><b>Printed:</b> " + safe(new Date().toLocaleString()) + "</div>" +
      "</div>" +
      "<table><thead><tr>" +
      "<th style=\"width:88px;\">Date</th>" +
      "<th style=\"width:220px;\">Client</th>" +
      "<th>Medicine Name &amp; Dose</th>" +
      "<th>Posology</th>" +
      "<th style=\"width:180px;\">Prescriber Name</th>" +
      "<th style=\"width:110px;\">Reg No</th>" +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table>" +
      "<script>(function(){document.getElementById('btnPrint').addEventListener('click',function(){window.print();});setTimeout(function(){try{window.print();}catch(e){}},250);})();</script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function buildTableRow(entry, onEdit, onDelete) {
    var tr = document.createElement("tr");

    function tdText(text, bold) {
      var td = document.createElement("td");
      if (bold) {
        var b = document.createElement("b");
        b.textContent = text;
        td.appendChild(b);
      } else {
        td.textContent = text;
      }
      return td;
    }

    var tdDate = tdText(fmtDmyFromYmd(entry.entry_date || ""), false);

    var tdClient = document.createElement("td");
    var bName = document.createElement("b");
    bName.textContent = entry.client_name || "";
    var divId = document.createElement("div");
    divId.style.opacity = ".75";
    divId.style.fontSize = "11px";
    divId.textContent = "ID: " + (entry.client_id || "");
    tdClient.appendChild(bName);
    tdClient.appendChild(divId);

    var tdMed = tdText(entry.medicine_name_dose || "", false);
    var tdPos = tdText(entry.posology || "", false);
    var tdPresc = tdText(entry.prescriber_name || "", false);
    var tdReg = tdText(entry.prescriber_reg_no || "", false);

    var tdActions = document.createElement("td");
    tdActions.style.whiteSpace = "nowrap";

    var btnEdit = document.createElement("button");
    btnEdit.className = "eikon-btn";
    btnEdit.type = "button";
    btnEdit.textContent = "Edit";
    btnEdit.style.marginRight = "8px";
    btnEdit.addEventListener("click", function () { onEdit(entry); });

    var btnDel = document.createElement("button");
    btnDel.className = "eikon-btn";
    btnDel.type = "button";
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", function () { onDelete(entry); });

    tdActions.appendChild(btnEdit);
    tdActions.appendChild(btnDel);

    tr.appendChild(tdDate);
    tr.appendChild(tdClient);
    tr.appendChild(tdMed);
    tr.appendChild(tdPos);
    tr.appendChild(tdPresc);
    tr.appendChild(tdReg);
    tr.appendChild(tdActions);

    return tr;
  }

  var state = {
    monthYm: thisMonthYm(),
    query: "",
    entries: [],
    filtered: [],
    mounted: false,
    refresh: null
  };

  function applyFilterAndRender(tableBodyEl, countEl) {
    var q = norm(state.query);
    var out = [];
    if (!q) {
      out = state.entries.slice();
    } else {
      for (var i = 0; i < state.entries.length; i++) {
        var r = state.entries[i];
        if (rowSearchBlob(r).indexOf(q) >= 0) out.push(r);
      }
    }

    // Sort newest date first, then id desc
    out.sort(function (a, b) {
      var da = String(a.entry_date || "");
      var db = String(b.entry_date || "");
      if (da < db) return 1;
      if (da > db) return -1;
      var ia = Number(a.id || 0);
      var ib = Number(b.id || 0);
      return ib - ia;
    });

    state.filtered = out;

    tableBodyEl.innerHTML = "";
    for (var j = 0; j < out.length; j++) {
      (function (entry) {
        var tr = buildTableRow(
          entry,
          function (e) { openEntryModal({ mode: "edit", entry: e }); },
          function (e) { openConfirmDelete(e); }
        );
        tableBodyEl.appendChild(tr);
      })(out[j]);
    }

    if (countEl) {
      countEl.textContent = "Showing " + String(out.length) + " / " + String(state.entries.length);
    }
  }

  async function render(ctx) {
    var mount = ctx.mount;
    dbg("[dailyregister] render() start", ctx);

    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row" style="align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
      '    <div style="min-width:240px;">' +
      '      <div style="font-weight:900;font-size:18px;">Daily Register</div>' +
      '      <div style="color:#666;font-size:12px;margin-top:2px;">Log client medicine supply details. Search filters all columns live.</div>' +
      "    </div>" +
      '    <div class="eikon-row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;justify-content:flex-end;">' +
      '      <div class="eikon-field" style="min-width:170px;">' +
      '        <div class="eikon-label">Month</div>' +
      '        <input class="eikon-input" id="dr-month" type="month" value="' + esc(state.monthYm) + '"/>' +
      "      </div>" +
      '      <div class="eikon-field" style="min-width:260px;flex:1 1 260px;">' +
      '        <div class="eikon-label">Search (any column)</div>' +
      '        <input class="eikon-input" id="dr-search" type="text" value="' + esc(state.query) + '" placeholder="Type to filter…"/>' +
      "      </div>" +
      '      <button class="eikon-btn" id="dr-new">New</button>' +
      '      <button class="eikon-btn" id="dr-print">Print</button>' +
      '      <button class="eikon-btn" id="dr-refresh">Refresh</button>' +
      "    </div>" +
      "  </div>" +
      "</div>" +

      '<div class="eikon-card" style="margin-top:12px;">' +
      '  <div class="eikon-row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '    <div style="font-weight:900;">Entries</div>' +
      '    <div id="dr-count" style="font-size:12px;color:#444;font-weight:800;">Loading…</div>' +
      "  </div>" +
      '  <div style="margin-top:10px;overflow:auto;border:1px solid #e5e5e5;border-radius:12px;">' +
      '    <table style="width:100%;border-collapse:collapse;min-width:980px;">' +
      '      <thead>' +
      '        <tr style="background:#f6f6f6;">' +
      '          <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e5e5;width:88px;">Date</th>' +
      '          <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e5e5;width:220px;">Client</th>' +
      '          <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e5e5;">Medicine Name &amp; Dose</th>' +
      '          <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e5e5;">Posology</th>' +
      '          <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e5e5;width:180px;">Prescriber</th>' +
      '          <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e5e5;width:110px;">Reg No</th>' +
      '          <th style="text-align:left;padding:10px;border-bottom:1px solid #e5e5e5;width:150px;">Actions</th>' +
      "        </tr>" +
      "      </thead>" +
      '      <tbody id="dr-tbody"></tbody>' +
      "    </table>" +
      "  </div>" +
      "</div>";

    var monthEl = E.q("#dr-month", mount);
    var searchEl = E.q("#dr-search", mount);
    var btnNew = E.q("#dr-new", mount);
    var btnPrint = E.q("#dr-print", mount);
    var btnRefresh = E.q("#dr-refresh", mount);
    var tbody = E.q("#dr-tbody", mount);
    var countEl = E.q("#dr-count", mount);

    if (!monthEl || !searchEl || !btnNew || !btnPrint || !btnRefresh || !tbody || !countEl) {
      err("[dailyregister] DOM missing", {
        monthEl: !!monthEl, searchEl: !!searchEl, btnNew: !!btnNew, btnPrint: !!btnPrint,
        btnRefresh: !!btnRefresh, tbody: !!tbody, countEl: !!countEl
      });
      throw new Error("Daily Register DOM incomplete (see console)");
    }

    async function refresh() {
      try {
        countEl.textContent = "Loading…";
        var ym = String(monthEl.value || "").trim();
        if (!isYm(ym)) ym = thisMonthYm();
        state.monthYm = ym;

        var entries = await apiList(state.monthYm);

        // Normalize expected fields
        for (var i = 0; i < entries.length; i++) {
          var r = entries[i] || {};
          r.id = r.id;
          r.entry_date = String(r.entry_date || "").trim();
          r.client_name = String(r.client_name || "").trim();
          r.client_id = String(r.client_id || "").trim();
          r.medicine_name_dose = String(r.medicine_name_dose || "").trim();
          r.posology = String(r.posology || "").trim();
          r.prescriber_name = String(r.prescriber_name || "").trim();
          r.prescriber_reg_no = String(r.prescriber_reg_no || "").trim();
        }

        state.entries = entries;
        applyFilterAndRender(tbody, countEl);
      } catch (e) {
        err("[dailyregister] refresh failed", e);
        countEl.textContent = "Failed to load";
        modalError("Daily Register", e);
      }
    }

    state.refresh = refresh;

    monthEl.addEventListener("change", function () {
      refresh();
    });

    searchEl.addEventListener("input", function () {
      state.query = String(searchEl.value || "");
      applyFilterAndRender(tbody, countEl);
    });

    btnNew.addEventListener("click", function () {
      openEntryModal({ mode: "new", entry: { entry_date: todayYmd() } });
    });

    btnPrint.addEventListener("click", function () {
      try {
        openPrintWindow(state.filtered || [], state.monthYm, state.query || "");
      } catch (e) {
        err("[dailyregister] print failed", e);
        modalError("Print", e);
      }
    });

    btnRefresh.addEventListener("click", function () {
      refresh();
    });

    await refresh();

    state.mounted = true;
    dbg("[dailyregister] render() done");
  }

  E.registerModule({
    id: "dailyregister",
    title: "Daily Register",
    order: 16,
    icon: "🗓️",
    render: render
  });

})();
