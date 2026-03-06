(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.audit.js)");

  function esc(s) { return E.escapeHtml(s); }

  function ymd(d) {
    var dt = (d instanceof Date) ? d : new Date();
    return dt.getFullYear() + "-" +
      String(dt.getMonth() + 1).padStart(2, "0") + "-" +
      String(dt.getDate()).padStart(2, "0");
  }

  // Friendly labels for entity_type -> module name
  var MODULE_LABELS = {
    temperature_devices: "Temperature",
    temperature_entries: "Temperature",
    daily_register_entries: "Daily Register",
    dda_sales_entries: "DDA Sales",
    dda_poyc_entries: "DDA POYC",
    dda_purchases_entries: "DDA Purchases",
    dda_stocktakes: "DDA Stock Takes",
    dda_stocktake_items: "DDA Stock Takes",
    cleaning_entries: "Cleaning",
    certificates_items: "Certificates",
    locum_register_entries: "Locum Register"
  };

  // Action -> human-readable verb + colour class
  function actionLabel(action) {
    var a = String(action || "").toUpperCase();
    if (a.indexOf("DELETE") >= 0) return { text: "Deleted", cls: "audit-act-delete" };
    if (a.indexOf("CREATE") >= 0 || a.indexOf("ADD") >= 0 || a.indexOf("UPSERT") >= 0) return { text: "Created", cls: "audit-act-create" };
    if (a.indexOf("UPDATE") >= 0 || a.indexOf("EDIT") >= 0) return { text: "Updated", cls: "audit-act-update" };
    if (a.indexOf("CLOSE") >= 0) return { text: "Closed", cls: "audit-act-update" };
    if (a.indexOf("REOPEN") >= 0) return { text: "Reopened", cls: "audit-act-create" };
    if (a.indexOf("UPLOAD") >= 0) return { text: "Uploaded", cls: "audit-act-create" };
    return { text: a, cls: "" };
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
        " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (e) { return String(iso); }
  }

  function formatDetails(details) {
    if (!details || typeof details !== "object") return "";
    var keys = Object.keys(details);
    if (keys.length === 0) return "";
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = details[k];
      if (v === "" || v === null || v === undefined) continue;
      var label = k.replace(/_/g, " ");
      parts.push("<span class='audit-detail-key'>" + esc(label) + ":</span> " + esc(String(v)));
    }
    return parts.join(" &middot; ");
  }

  var MODULES = [
    { value: "", label: "All Modules" },
    { value: "temperature", label: "Temperature" },
    { value: "dailyregister", label: "Daily Register" },
    { value: "ddasales", label: "DDA Sales" },
    { value: "ddapoyc", label: "DDA POYC" },
    { value: "ddapurchases", label: "DDA Purchases" },
    { value: "ddastocktakes", label: "DDA Stock Takes" },
    { value: "cleaning", label: "Cleaning" },
    { value: "certificates", label: "Certificates" },
    { value: "locumregister", label: "Locum Register" }
  ];

  var state = {
    entries: [],
    total: 0,
    offset: 0,
    limit: 50,
    module: "",
    action: "",
    from: "",
    to: ""
  };

  async function loadAudit() {
    var params = "?limit=" + state.limit + "&offset=" + state.offset;
    if (state.module) params += "&module=" + encodeURIComponent(state.module);
    if (state.action) params += "&action=" + encodeURIComponent(state.action);
    if (state.from)   params += "&from=" + encodeURIComponent(state.from);
    if (state.to)     params += "&to=" + encodeURIComponent(state.to);

    var resp = await E.apiFetch("/audit/log" + params, { method: "GET" });
    if (!resp || !resp.ok) throw new Error("Failed to load audit log");
    state.entries = resp.entries || [];
    state.total = resp.total || 0;
    return state.entries;
  }

  function renderTable(tbody) {
    tbody.innerHTML = "";

    if (state.entries.length === 0) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 6;
      td.style.textAlign = "center";
      td.style.padding = "24px";
      td.style.color = "var(--muted)";
      td.textContent = "No audit entries found.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    state.entries.forEach(function (r) {
      var tr = document.createElement("tr");

      function td(html, isHtml) {
        var t = document.createElement("td");
        if (isHtml) t.innerHTML = html;
        else t.textContent = html;
        return t;
      }

      tr.appendChild(td(formatDateTime(r.created_at)));
      tr.appendChild(td(r.user_name || ""));

      var modLabel = MODULE_LABELS[r.entity_type] || r.entity_type || "";
      tr.appendChild(td(modLabel));

      var act = actionLabel(r.action);
      tr.appendChild(td("<span class='" + act.cls + "'>" + esc(act.text) + "</span>" +
        "<span class='audit-action-raw'>" + esc(r.action) + "</span>", true));

      tr.appendChild(td(r.entity_id || ""));
      tr.appendChild(td(formatDetails(r.details), true));

      tbody.appendChild(tr);
    });
  }

  function renderPagination(paginationEl) {
    var page = Math.floor(state.offset / state.limit) + 1;
    var totalPages = Math.max(1, Math.ceil(state.total / state.limit));
    paginationEl.innerHTML =
      "<span style='color:var(--muted);font-size:13px;'>" +
      "Showing " + (state.offset + 1) + "–" + Math.min(state.offset + state.entries.length, state.total) +
      " of " + state.total + " entries (Page " + page + " of " + totalPages + ")" +
      "</span>";
  }

  // ── Print ────────────────────────────────────────────────────────────────
  function buildPrintHtml() {
    var rows = state.entries.map(function (r) {
      var modLabel = MODULE_LABELS[r.entity_type] || r.entity_type || "";
      var act = actionLabel(r.action);
      var details = "";
      if (r.details && typeof r.details === "object") {
        var keys = Object.keys(r.details);
        var parts = [];
        for (var i = 0; i < keys.length; i++) {
          var v = r.details[keys[i]];
          if (v === "" || v === null || v === undefined) continue;
          parts.push(keys[i].replace(/_/g, " ") + ": " + v);
        }
        details = parts.join("; ");
      }
      return "<tr>" +
        "<td style='white-space:nowrap;'>" + esc(formatDateTime(r.created_at)) + "</td>" +
        "<td>" + esc(r.user_name || "") + "</td>" +
        "<td>" + esc(modLabel) + "</td>" +
        "<td>" + esc(act.text) + "</td>" +
        "<td>" + esc(r.entity_id || "") + "</td>" +
        "<td style='font-size:11px;'>" + esc(details) + "</td>" +
        "</tr>";
    }).join("");

    var title = "Audit Trail";
    var subtitle = [];
    if (state.module) {
      var ml = MODULES.find(function (m) { return m.value === state.module; });
      subtitle.push("Module: " + (ml ? ml.label : state.module));
    }
    if (state.from || state.to) subtitle.push("Date: " + (state.from || "…") + " to " + (state.to || "…"));

    return "<!doctype html>\n<html>\n<head>\n<meta charset='utf-8'/>" +
      "<meta name='viewport' content='width=device-width, initial-scale=1'/>" +
      "<title>Audit Trail</title>\n<style>\n" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin:24px; color:#000;}\n" +
      "h1{margin:0 0 6px 0; font-size:22px;}\n" +
      ".sub{margin:0 0 18px 0; color:#333; font-size:13px;}\n" +
      "table{width:100%; border-collapse:collapse; table-layout:fixed;}\n" +
      "th,td{border:1px solid #000; padding:6px 8px; vertical-align:top; font-size:11px; word-wrap:break-word;}\n" +
      "th{background:#f2f2f2; font-size:10px; text-transform:uppercase; letter-spacing:0.6px;}\n" +
      "@media print{body{margin:12mm;} tr{page-break-inside:avoid;}}\n" +
      "</style>\n</head>\n<body>\n" +
      "<h1>" + esc(title) + "</h1>\n" +
      "<p class='sub'>" + esc(subtitle.join(" | ")) + "</p>\n" +
      "<table>\n<thead><tr>" +
      "<th>Date/Time</th><th>User</th><th>Module</th><th>Action</th><th>Record ID</th><th>Details</th>" +
      "</tr></thead>\n<tbody>\n" + rows + "\n</tbody>\n</table>\n" +
      "<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},80);});" +
      "window.addEventListener('afterprint',function(){setTimeout(function(){try{window.close();}catch(e){}},250);});</script>\n" +
      "</body>\n</html>";
  }

  function openPrintTab(html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }
    if (!w) {
      try {
        var a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = "none";
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e2) {}
    }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  async function render(ctx) {
    var mount = ctx.mount;

    // Build module <option> list
    var moduleOpts = MODULES.map(function (m) {
      return '<option value="' + esc(m.value) + '"' +
        (state.module === m.value ? " selected" : "") + '>' +
        esc(m.label) + '</option>';
    }).join("");

    // Default dates: last 30 days
    if (!state.from && !state.to) {
      var now = new Date();
      state.to = ymd(now);
      var past = new Date(now);
      past.setDate(past.getDate() - 30);
      state.from = ymd(past);
    }

    mount.innerHTML =
      '<style>' +
      '.audit-act-create{color:var(--ok);font-weight:700;}' +
      '.audit-act-update{color:var(--accent);font-weight:700;}' +
      '.audit-act-delete{color:var(--danger);font-weight:700;}' +
      '.audit-action-raw{display:block;font-size:11px;color:var(--muted);margin-top:2px;}' +
      '.audit-detail-key{color:var(--muted);font-weight:600;text-transform:capitalize;}' +
      '</style>' +

      '<div class="eikon-card">' +
      '  <div style="font-weight:900;margin-bottom:10px;">Filters</div>' +
      '  <div class="eikon-row">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Module</div>' +
      '      <select class="eikon-select" id="audit-module">' + moduleOpts + '</select>' +
      '    </div>' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Action Contains</div>' +
      '      <input class="eikon-input" id="audit-action" type="text" placeholder="e.g. DELETE" value="' + esc(state.action) + '" style="min-width:140px;"/>' +
      '    </div>' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">From</div>' +
      '      <input class="eikon-input" id="audit-from" type="date" value="' + esc(state.from) + '"/>' +
      '    </div>' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">To</div>' +
      '      <input class="eikon-input" id="audit-to" type="date" value="' + esc(state.to) + '"/>' +
      '    </div>' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">&nbsp;</div>' +
      '      <div class="eikon-row" style="gap:8px;">' +
      '        <button class="eikon-btn primary" id="audit-search">Search</button>' +
      '        <button class="eikon-btn" id="audit-print">Print</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>' +

      '<div class="eikon-card">' +
      '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
      '    <div style="font-weight:900;">Audit Trail</div>' +
      '    <div id="audit-pagination"></div>' +
      '  </div>' +
      '  <div class="eikon-table-wrap">' +
      '    <table class="eikon-table">' +
      '      <thead>' +
      '        <tr>' +
      '          <th>Date / Time</th>' +
      '          <th>User</th>' +
      '          <th>Module</th>' +
      '          <th>Action</th>' +
      '          <th>Record ID</th>' +
      '          <th>Details</th>' +
      '        </tr>' +
      '      </thead>' +
      '      <tbody id="audit-tbody"></tbody>' +
      '    </table>' +
      '  </div>' +
      '  <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">' +
      '    <button class="eikon-btn" id="audit-prev">Previous</button>' +
      '    <button class="eikon-btn" id="audit-next">Next</button>' +
      '  </div>' +
      '</div>';

    var moduleSelect = E.q("#audit-module", mount);
    var actionInput  = E.q("#audit-action", mount);
    var fromInput    = E.q("#audit-from", mount);
    var toInput      = E.q("#audit-to", mount);
    var searchBtn    = E.q("#audit-search", mount);
    var printBtn     = E.q("#audit-print", mount);
    var tbody        = E.q("#audit-tbody", mount);
    var paginationEl = E.q("#audit-pagination", mount);
    var prevBtn      = E.q("#audit-prev", mount);
    var nextBtn      = E.q("#audit-next", mount);

    async function doSearch(resetOffset) {
      state.module = moduleSelect.value;
      state.action = actionInput.value.trim();
      state.from   = fromInput.value;
      state.to     = toInput.value;
      if (resetOffset) state.offset = 0;

      try {
        await loadAudit();
        renderTable(tbody);
        renderPagination(paginationEl);
        prevBtn.disabled = state.offset <= 0;
        nextBtn.disabled = (state.offset + state.limit) >= state.total;
      } catch (e) {
        E.error("[audit] search failed:", e);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:20px;">' +
          esc(String(e && (e.message || e.bodyText || e))) + '</td></tr>';
      }
    }

    searchBtn.addEventListener("click", function () { doSearch(true); });

    // Allow Enter key in action filter
    actionInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") doSearch(true);
    });

    printBtn.addEventListener("click", function () {
      openPrintTab(buildPrintHtml());
    });

    prevBtn.addEventListener("click", function () {
      state.offset = Math.max(0, state.offset - state.limit);
      doSearch(false);
    });

    nextBtn.addEventListener("click", function () {
      if ((state.offset + state.limit) < state.total) {
        state.offset += state.limit;
        doSearch(false);
      }
    });

    // Initial load
    await doSearch(true);
  }

  E.registerModule({
    id: "audit",
    title: "Audit Trail",
    order: 115,
    icon: "\uD83D\uDCCB",
    render: render
  });

})();
