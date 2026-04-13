(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  /* ── helpers ──────────────────────────────────────────────────────────── */
  function esc(s) { return E.escapeHtml(String(s || "")); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function currentYm() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1);
  }

  function prevMonth(ym) {
    var parts = ym.split("-");
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    if (m < 1) { m = 12; y--; }
    return y + "-" + pad(m);
  }

  function nextMonth(ym) {
    var parts = ym.split("-");
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) + 1;
    if (m > 12) { m = 1; y++; }
    return y + "-" + pad(m);
  }

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  function monthLabel(ym) {
    var parts = ym.split("-");
    return MONTH_NAMES[parseInt(parts[1], 10) - 1] + " " + parts[0];
  }

  function shortDate(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr.replace(" ", "T") + (dateStr.indexOf("T") >= 0 ? "" : "Z"));
    if (isNaN(d.getTime())) return dateStr;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getUTCDate() + " " + months[d.getUTCMonth()];
  }

  function shortDateTime(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr.replace(" ", "T") + (dateStr.indexOf("T") >= 0 || dateStr.indexOf("Z") >= 0 ? "" : "Z"));
    if (isNaN(d.getTime())) return dateStr;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return d.getUTCDate() + " " + months[d.getUTCMonth()] + ", " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes());
  }

  /* ── state ───────────────────────────────────────────────────────────── */
  var S = {
    month: currentYm(),
    data: null,
    mount: null,
    user: null,
    loading: false
  };

  /* ── API ─────────────────────────────────────────────────────────────── */
  function loadOverview() {
    S.loading = true;
    return E.apiFetch("/admin/pharmacy-overview?month=" + S.month, { method: "GET" })
      .then(function (r) { S.data = r; S.loading = false; })
      .catch(function (err) {
        try { console.error("[admin-overview] load error", err); } catch (e) {}
        S.data = null;
        S.loading = false;
      });
  }

  /* ── styles ──────────────────────────────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById("ao-styles")) return;
    var st = document.createElement("style");
    st.id = "ao-styles";
    st.textContent =
      '.ao-month-nav{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;}' +
      '.ao-month-nav button{font-size:12px;padding:6px 12px;}' +
      '.ao-month-label{font-weight:800;font-size:14px;min-width:180px;text-align:center;}' +
      '.ao-wrap{overflow-x:auto;margin-bottom:18px;border:1px solid var(--border);border-radius:12px;}' +
      '.ao-grid{width:100%;border-collapse:collapse;font-size:12px;min-width:900px;}' +
      '.ao-grid th{text-align:center;padding:8px 6px;background:rgba(255,255,255,.03);border-bottom:1px solid var(--border);font-weight:700;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;}' +
      '.ao-grid th:first-child{text-align:left;padding-left:14px;position:sticky;left:0;background:var(--panel);z-index:2;min-width:140px;}' +
      '.ao-grid td{padding:6px;border-bottom:1px solid var(--border);text-align:center;vertical-align:top;}' +
      '.ao-grid td:first-child{text-align:left;padding-left:14px;font-weight:700;font-size:13px;position:sticky;left:0;background:var(--panel);z-index:1;white-space:nowrap;}' +
      '.ao-grid tr:last-child td{border-bottom:none;}' +
      '.ao-grid tr:hover td{background:rgba(255,255,255,.02);}' +
      '.ao-grid tr:hover td:first-child{background:var(--panel2);}' +
      '.ao-cell{padding:4px 6px;border-radius:8px;display:inline-block;min-width:80px;text-align:center;line-height:1.4;}' +
      '.ao-cell-ok{background:rgba(67,209,122,.12);color:#43d17a;}' +
      '.ao-cell-warn{background:rgba(255,180,60,.12);color:#ffb43c;}' +
      '.ao-cell-danger{background:rgba(255,90,122,.12);color:#ff5a7a;}' +
      '.ao-cell-gray{background:rgba(168,179,199,.06);color:var(--muted);}' +
      '.ao-cell .ao-sub{display:block;font-size:9px;opacity:.7;margin-top:1px;}' +
      '.ao-summary{margin-bottom:18px;padding:14px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.02);}' +
      '.ao-summary-title{font-weight:900;font-size:14px;margin-bottom:8px;}' +
      '.ao-summary-row{display:flex;gap:20px;font-size:12px;color:var(--muted);flex-wrap:wrap;}' +
      '.ao-summary-stat{font-weight:700;color:var(--text);}' +
      '@media print {' +
      '  .eikon-sidebar,.eikon-topbar,.ao-month-nav button,.eikon-nav{display:none!important;}' +
      '  .eikon-main{margin:0!important;padding:10px!important;}' +
      '  body{background:#fff!important;color:#000!important;}' +
      '  .ao-grid th,.ao-grid td{color:#000!important;border-color:#ccc!important;}' +
      '  .ao-grid th:first-child,.ao-grid td:first-child{background:#fff!important;}' +
      '  .ao-grid th{background:#f0f0f0!important;}' +
      '  .ao-cell-ok{background:#e6f9ed!important;color:#1a7a3a!important;}' +
      '  .ao-cell-warn{background:#fff5e0!important;color:#a06800!important;}' +
      '  .ao-cell-danger{background:#ffe8ec!important;color:#a0001a!important;}' +
      '  .ao-cell-gray{background:#f5f5f5!important;color:#888!important;}' +
      '  .ao-month-label{color:#000!important;}' +
      '  .ao-summary{border-color:#ccc!important;}' +
      '  .ao-summary-title,.ao-summary-stat{color:#000!important;}' +
      '  .ao-summary-row{color:#333!important;}' +
      '}';
    document.head.appendChild(st);
  }

  /* ── cell renderers ──────────────────────────────────────────────────── */
  function cellDailyCompliance(sectionData, locId, workingDays) {
    var d = sectionData[String(locId)];
    if (!d) return '<div class="ao-cell ao-cell-gray">No data</div>';
    var days = d.days_with_entries || 0;
    var total = workingDays || 1;
    var pct = days / total;
    var cls = pct >= 0.9 ? "ao-cell-ok" : pct >= 0.7 ? "ao-cell-warn" : "ao-cell-danger";
    var sub = d.last_created_at ? '<span class="ao-sub">last: ' + esc(shortDateTime(d.last_created_at)) + '</span>' : '';
    return '<div class="ao-cell ' + cls + '">' + days + '/' + total + ' days' + sub + '</div>';
  }

  function cellTransaction(sectionData, locId) {
    var d = sectionData[String(locId)];
    if (!d || !d.entry_count) return '<div class="ao-cell ao-cell-gray">No data</div>';
    var count = d.entry_count;
    // Determine color based on recency
    var cls = "ao-cell-ok";
    if (d.last_created_at) {
      var lastTs = new Date(d.last_created_at.replace(" ", "T") + "Z").getTime();
      var nowTs = Date.now();
      var daysSince = (nowTs - lastTs) / (1000 * 60 * 60 * 24);
      if (daysSince > 7) cls = "ao-cell-warn";
    }
    var sub = d.last_created_at ? '<span class="ao-sub">last: ' + esc(shortDateTime(d.last_created_at)) + '</span>' : '';
    return '<div class="ao-cell ' + cls + '">' + count + ' entries' + sub + '</div>';
  }

  function cellCertificates(certData, locId) {
    var d = certData[String(locId)];
    if (!d) return '<div class="ao-cell ao-cell-gray">No data</div>';
    var expired = d.expired_count || 0;
    var missing = d.missing_file_count || 0;
    var total = d.total_certs || 0;
    if (expired > 0) {
      var parts = [];
      parts.push(expired + ' expired');
      if (missing > 0) parts.push(missing + ' missing');
      return '<div class="ao-cell ao-cell-danger">' + esc(parts.join(', ')) + '</div>';
    }
    if (missing > 0) {
      return '<div class="ao-cell ao-cell-warn">' + missing + ' missing file' + (missing > 1 ? 's' : '') + '</div>';
    }
    if (total > 0) {
      return '<div class="ao-cell ao-cell-ok">All OK (' + total + ')</div>';
    }
    return '<div class="ao-cell ao-cell-gray">No data</div>';
  }

  function cellStockTakes(stData, locId) {
    var d = stData[String(locId)];
    if (!d) return '<div class="ao-cell ao-cell-gray">No data</div>';
    var cls = d.is_closed ? "ao-cell-ok" : "ao-cell-warn";
    var status = d.is_closed ? "Closed" : "Open";
    var dateLabel = d.last_stocktake_date ? shortDate(d.last_stocktake_date) : "?";
    return '<div class="ao-cell ' + cls + '">Last: ' + esc(dateLabel) + '<span class="ao-sub">' + status + '</span></div>';
  }

  function cellRepeatRx(rpData, locId) {
    var d = rpData[String(locId)];
    if (!d || !d.total_count) return '<div class="ao-cell ao-cell-gray">No data</div>';
    var expired = d.expired_count || 0;
    var total = d.total_count || 0;
    if (expired > 0) {
      return '<div class="ao-cell ao-cell-danger">' + total + ' total, ' + expired + ' expired</div>';
    }
    return '<div class="ao-cell ao-cell-ok">' + total + ' total</div>';
  }

  /* ── rendering ───────────────────────────────────────────────────────── */
  function renderSummary() {
    if (!S.data || !S.data.pharmacies) return '';
    var pCount = S.data.pharmacies.length;
    var wd = S.data.working_days || 0;

    // Count pharmacies with issues
    var tempIssues = 0, cleanIssues = 0, certIssues = 0;
    S.data.pharmacies.forEach(function (p) {
      var pid = String(p.id);
      var t = S.data.temperature[pid];
      if (!t || (t.days_with_entries || 0) < wd * 0.7) tempIssues++;
      var c = S.data.cleaning[pid];
      if (!c || (c.days_with_entries || 0) < wd * 0.7) cleanIssues++;
      var cert = S.data.certificates[pid];
      if (cert && ((cert.expired_count || 0) > 0 || (cert.missing_file_count || 0) > 0)) certIssues++;
    });

    return '<div class="ao-summary">' +
      '<div class="ao-summary-title">' + esc(monthLabel(S.month)) + ' Overview</div>' +
      '<div class="ao-summary-row">' +
      '<span><span class="ao-summary-stat">' + pCount + '</span> pharmacies</span>' +
      '<span><span class="ao-summary-stat">' + wd + '</span> working days (Mon-Sat)</span>' +
      (tempIssues > 0 ? '<span style="color:var(--danger);">Temp issues: <span class="ao-summary-stat" style="color:var(--danger);">' + tempIssues + '</span></span>' : '') +
      (cleanIssues > 0 ? '<span style="color:var(--danger);">Cleaning issues: <span class="ao-summary-stat" style="color:var(--danger);">' + cleanIssues + '</span></span>' : '') +
      (certIssues > 0 ? '<span style="color:var(--danger);">Cert issues: <span class="ao-summary-stat" style="color:var(--danger);">' + certIssues + '</span></span>' : '') +
      '</div></div>';
  }

  function renderGrid() {
    if (!S.data || !S.data.pharmacies || !S.data.pharmacies.length) {
      return '<div style="padding:30px;text-align:center;color:var(--muted);">No pharmacies found for this organisation.</div>';
    }

    var wd = S.data.working_days || 0;
    var html = '<div class="ao-wrap"><table class="ao-grid">';
    html += '<thead><tr>';
    html += '<th>Pharmacy</th>';
    html += '<th>Temp</th>';
    html += '<th>Cleaning</th>';
    html += '<th>Daily Reg</th>';
    html += '<th>DDA Sales</th>';
    html += '<th>DDA POYC</th>';
    html += '<th>DDA Purch</th>';
    html += '<th>DDA ST</th>';
    html += '<th>Certs</th>';
    html += '<th>Locum</th>';
    html += '<th>Repeat Rx</th>';
    html += '</tr></thead><tbody>';

    S.data.pharmacies.forEach(function (p) {
      var id = p.id;
      html += '<tr>';
      html += '<td>' + esc(p.name) + '</td>';
      html += '<td>' + cellDailyCompliance(S.data.temperature, id, wd) + '</td>';
      html += '<td>' + cellDailyCompliance(S.data.cleaning, id, wd) + '</td>';
      html += '<td>' + cellTransaction(S.data.daily_register, id) + '</td>';
      html += '<td>' + cellTransaction(S.data.dda_sales, id) + '</td>';
      html += '<td>' + cellTransaction(S.data.dda_poyc, id) + '</td>';
      html += '<td>' + cellTransaction(S.data.dda_purchases, id) + '</td>';
      html += '<td>' + cellStockTakes(S.data.dda_stocktakes, id) + '</td>';
      html += '<td>' + cellCertificates(S.data.certificates, id) + '</td>';
      html += '<td>' + cellTransaction(S.data.locum_register, id) + '</td>';
      html += '<td>' + cellRepeatRx(S.data.repeat_prescriptions, id) + '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  function renderAll() {
    var mount = S.mount;
    if (!mount) return;

    var cur = currentYm();
    var prevDisabled = "";
    var nextDisabled = S.month >= cur ? " disabled" : "";

    var html = '';

    // Month nav
    html += '<div class="ao-month-nav">';
    html += '<button class="eikon-btn" id="ao-prev"' + prevDisabled + '>&laquo; Prev</button>';
    html += '<div class="ao-month-label">' + esc(monthLabel(S.month)) + '</div>';
    html += '<button class="eikon-btn" id="ao-next"' + nextDisabled + '>Next &raquo;</button>';
    html += '<button class="eikon-btn primary" id="ao-current" style="margin-left:6px;">This Month</button>';
    html += '<button class="eikon-btn" id="ao-print" style="margin-left:auto;font-size:11px;padding:5px 10px;">Print</button>';
    html += '<button class="eikon-btn" id="ao-refresh" style="font-size:11px;padding:5px 10px;">Refresh</button>';
    html += '</div>';

    if (!S.data) {
      html += '<div style="padding:30px;text-align:center;color:var(--muted);">No data loaded.</div>';
    } else {
      html += renderSummary();
      html += renderGrid();
    }

    mount.innerHTML = html;
    wireEvents();
  }

  /* ── events ──────────────────────────────────────────────────────────── */
  function wireEvents() {
    var prevBtn = document.getElementById("ao-prev");
    var nextBtn = document.getElementById("ao-next");
    var curBtn = document.getElementById("ao-current");
    var refreshBtn = document.getElementById("ao-refresh");
    var printBtn = document.getElementById("ao-print");

    if (prevBtn) prevBtn.onclick = function () {
      S.month = prevMonth(S.month);
      refresh();
    };
    if (nextBtn && !nextBtn.disabled) nextBtn.onclick = function () {
      var n = nextMonth(S.month);
      if (n <= currentYm()) { S.month = n; refresh(); }
    };
    if (curBtn) curBtn.onclick = function () {
      S.month = currentYm();
      refresh();
    };
    if (refreshBtn) refreshBtn.onclick = function () { refresh(); };
    if (printBtn) printBtn.onclick = function () { window.print(); };
  }

  function refresh() {
    if (S.mount) {
      S.mount.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading overview...</div>';
    }
    loadOverview().then(function () { renderAll(); });
  }

  /* ── main render ─────────────────────────────────────────────────────── */
  async function render(ctx) {
    S.mount = ctx.mount;
    S.user = ctx.user;
    ensureStyles();
    S.mount.innerHTML = '<div style="padding:20px;color:var(--muted);">Loading pharmacy overview...</div>';
    await loadOverview();
    renderAll();
  }

  /* ── register ────────────────────────────────────────────────────────── */
  E.registerModule({
    id: "admin-overview",
    title: "Pharmacy Overview",
    order: 5,
    icon: "\uD83D\uDCCA",
    render: render,
    destroy: function () { S.mount = null; }
  });

})();
