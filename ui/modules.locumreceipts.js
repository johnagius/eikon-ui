(function () {
  "use strict";

  var E = window.EIKON;
  var LR_MODULE_VERSION = "2026-02-23-2";
  try { if (E && E.dbg) E.dbg("[locumreceipts] loaded v", LR_MODULE_VERSION); } catch (e) {}

  if (!E) throw new Error("EIKON core missing (modules.locumreceipts.js)");

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

  function parseNum(v) {
    var s = String(v == null ? "" : v).trim().replace(",", ".");
    if (!s) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function money2(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    return x.toFixed(2);
  }

  function hoursFmt(n) {
    var x = Number(n);
    if (!isFinite(x)) x = 0;
    var s = x.toFixed(2);
    s = s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return s;
  }

  function dayTypeLabel(v) {
    var s = String(v || "").toLowerCase();
    if (s === "holiday") return "Sunday / Public Holiday";
    return "Normal Day";
  }

  // Malta day type calculation (Sunday/Public Holiday vs Normal)
  // Fixed public holidays (dd/MM). Movable: Good Friday (Western/Gregorian Easter).
  var MALTA_FIXED_HOLIDAYS = {
    "01/01": 1,
    "10/02": 1,
    "19/03": 1,
    "31/03": 1,
    "01/05": 1,
    "07/06": 1,
    "29/06": 1,
    "15/08": 1,
    "08/09": 1,
    "21/09": 1,
    "08/12": 1,
    "13/12": 1,
    "25/12": 1
  };

  function parseYmdLocal(dateStr) {
    var s = String(dateStr || "").trim();
    if (s.length >= 10) s = s.slice(0, 10);

    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (!isFinite(y) || !isFinite(mo) || !isFinite(d)) return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== (mo - 1) || dt.getDate() !== d) return null;
    return dt;
  }

  function easterSundayGregorian(year) {
    // Meeus/Jones/Butcher algorithm (Gregorian calendar)
    var y = Number(year);
    if (!isFinite(y)) return null;

    var a = y % 19;
    var b = Math.floor(y / 100);
    var c = y % 100;
    var d = Math.floor(b / 4);
    var e = b % 4;
    var f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4);
    var k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
    var day = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(y, month - 1, day);
  }

  function goodFridayDate(year) {
    var easter = easterSundayGregorian(year);
    if (!easter) return null;
    return new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2);
  }

  function isMaltaSundayOrPublicHoliday(dt) {
    if (!(dt instanceof Date)) return false;

    if (dt.getDay() === 0) return true; // Sunday

    var dd = String(dt.getDate()).padStart(2, "0");
    var mm = String(dt.getMonth() + 1).padStart(2, "0");
    var key = dd + "/" + mm;
    if (MALTA_FIXED_HOLIDAYS[key]) return true;

    var gf = goodFridayDate(dt.getFullYear());
    if (gf && gf.getFullYear() === dt.getFullYear() && gf.getMonth() === dt.getMonth() && gf.getDate() === dt.getDate()) return true;

    return false;
  }

  function dayTypeFromDateStr(dateStr) {
    var dt = parseYmdLocal(dateStr);
    if (!dt) return "normal";
    return isMaltaSundayOrPublicHoliday(dt) ? "holiday" : "normal";
  }

  function ensureStyles() {
    if (document.getElementById("eikon-locumreceipts-style")) return;
    var css = ""
      + ".lr-head{display:flex;gap:12px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;}"
      + ".lr-title{font-size:18px;font-weight:900;letter-spacing:.2px;margin:0;}"
      + ".lr-sub{margin:2px 0 0 0;color:var(--muted);font-size:12px;}"
      + ".lr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;}"
      + ".lr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:10px;}"
      + ".lr-kpi{border:1px solid var(--border);background:rgba(255,255,255,.03);border-radius:14px;padding:10px 12px;}"
      + ".lr-kpi .k{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);}"
      + ".lr-kpi .v{font-size:18px;font-weight:900;margin-top:4px;}"
      + ".lr-actions{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;}"
      + ".lr-split{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}"
      + ".lr-note{color:var(--muted);font-size:12px;margin:6px 0 0 0;}"
      + ".lr-report-wrap{margin-top:10px;}"
      + ".lr-report-section{border:1px solid var(--border);border-radius:14px;padding:12px;margin-top:10px;}"
      + ".lr-report-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;}"
      + ".lr-report-h h3{margin:0;font-size:15px;font-weight:900;}"
      + ".lr-report-h .lr-mini{font-size:11px;color:var(--muted);font-weight:700;}"
      + ".lr-report-h .tot{font-size:12px;color:var(--muted);}"
      + ".lr-row-actions{display:flex;gap:8px;flex-wrap:wrap;}"
      + "@media print{.no-print{display:none !important;}}";
    var st = document.createElement("style");
    st.id = "eikon-locumreceipts-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function storageKeyFeeMem() {
    return "eikon:locumreceipts:feeMem";
  }

  function loadFeeMem() {
    try {
      var raw = localStorage.getItem(storageKeyFeeMem());
      if (!raw) return { normal: null, holiday: null };
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return { normal: null, holiday: null };
      return {
        normal: (obj.normal != null && isFinite(Number(obj.normal))) ? Number(obj.normal) : null,
        holiday: (obj.holiday != null && isFinite(Number(obj.holiday))) ? Number(obj.holiday) : null
      };
    } catch (e) {
      return { normal: null, holiday: null };
    }
  }

  function saveFeeMem(mem) {
    try {
      localStorage.setItem(storageKeyFeeMem(), JSON.stringify({
        normal: (mem && isFinite(Number(mem.normal))) ? Number(mem.normal) : null,
        holiday: (mem && isFinite(Number(mem.holiday))) ? Number(mem.holiday) : null
      }));
    } catch (e) {}
  }

  var state = {
    lastMonth: "",
    receiptsByMonth: {},
    feeMem: { normal: null, holiday: null },
    lastReport: null
  };

  async function loadReceipts(month) {
    E.dbg("[locumreceipts] loadReceipts() month=", month);
    var resp = await E.apiFetch("/locumreceipts/receipts?month=" + encodeURIComponent(month), { method: "GET" });
    if (!resp || !resp.ok) throw new Error("Failed to load receipts");
    state.receiptsByMonth[month] = resp.receipts || [];
    return state.receiptsByMonth[month];
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

  function buildReceiptPrintHtml(locationName, row) {
    function esc2(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }

    var title = "Locum Receipt";
    var dayLabel = dayTypeLabel(dayTypeFromDateStr(row.receipt_date || ""));
    var receiptNo = row && row.id != null ? String(row.id) : "";
    var d = row.receipt_date || "";
    var loc = locationName || "";

    var hours = hoursFmt(row.hours);
    var fee = money2(row.fee_per_hour);
    var total = money2(row.total_fee);

    return ""
      + "<!doctype html><html><head><meta charset=\"utf-8\">"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
      + "<title>" + esc2(title) + (receiptNo ? (" #" + esc2(receiptNo)) : "") + "</title>"
      + "<style>"
      + "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:26px;color:#111;}"
      + ".hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;}"
      + "h1{margin:0;font-size:22px;letter-spacing:.2px;}"
      + ".meta{font-size:12px;color:#333;margin-top:4px;}"
      + ".card{margin-top:16px;border:1px solid #000;border-radius:10px;padding:14px;}"
      + ".grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;}"
      + ".k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#444;}"
      + ".v{font-size:14px;font-weight:700;margin-top:2px;}"
      + ".tot{margin-top:10px;padding-top:10px;border-top:1px dashed #555;display:flex;justify-content:space-between;align-items:center;}"
      + ".tot .v{font-size:18px;}"
      + ".sign{margin-top:22px;display:flex;gap:18px;align-items:flex-end;}"
      + ".line{flex:1;border-bottom:1px solid #000;height:18px;}"
      + ".lbl{font-size:12px;color:#333;min-width:110px;}"
      + ".note{font-size:11px;color:#444;margin-top:12px;}"
      + "@media print{body{margin:12mm;}}"
      + "</style>"
      + "</head><body>"
      + "<div class=\"hdr\">"
      + "  <div>"
      + "    <h1>" + esc2(title) + "</h1>"
      + "    <div class=\"meta\">" + esc2(loc) + "</div>"
      + "    <div class=\"meta\">Date: <b>" + esc2(d) + "</b> &nbsp;&middot;&nbsp; Receipt #: <b>" + esc2(receiptNo) + "</b></div>"
      + "  </div>"
      + "</div>"
      + "<div class=\"card\">"
      + "  <div class=\"grid\">"
      + "    <div><div class=\"k\">Name &amp; Surname</div><div class=\"v\">" + esc2(row.locum_full_name || "") + "</div></div>"
      + "    <div><div class=\"k\">Registration Number</div><div class=\"v\">" + esc2(row.registration_number || "") + "</div></div>"
      + "    <div><div class=\"k\">Day Type</div><div class=\"v\">" + esc2(dayLabel) + "</div></div>"
      + "    <div><div class=\"k\">Hours</div><div class=\"v\">" + esc2(hours) + "</div></div>"
      + "    <div><div class=\"k\">Fee per Hour</div><div class=\"v\">€ " + esc2(fee) + "</div></div>"
      + "    <div><div class=\"k\">Total Fee</div><div class=\"v\">€ " + esc2(total) + "</div></div>"
      + "  </div>"
      + "  <div class=\"sign\">"
      + "    <div class=\"lbl\">Locum Signature</div><div class=\"line\"></div>"
      + "  </div>"
      + "  <div class=\"note\">This receipt was generated via the Eikon system.</div>"
      + "</div>"
      + "<script>"
      + "window.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e){}},80);});"
      + "window.addEventListener('afterprint',function(){setTimeout(function(){try{window.close();}catch(e){}},250);});"
      + "</script>"
      + "</body></html>";
  }

  function buildReportPrintHtml(report) {
    report = report || {};
    var locName = report.location_name || "";
    var periodLabel = report.period_label || "";
    var generatedAt = report.generated_at || "";

    function esc2(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }

    var locums = Array.isArray(report.locums) ? report.locums : [];
    var overall = Array.isArray(report.overall) ? report.overall : [];

    function fmtRow(r) {
      return ""
        + "<tr>"
        + "<td>" + esc2(r.receipt_date || "") + "</td>"
        + "<td>" + esc2(dayTypeLabel(dayTypeFromDateStr(r.receipt_date || ""))) + "</td>"
        + "<td style=\"text-align:right;\">" + esc2(hoursFmt(r.hours)) + "</td>"
        + "<td style=\"text-align:right;\">€ " + esc2(money2(r.fee_per_hour)) + "</td>"
        + "<td style=\"text-align:right;\">€ " + esc2(money2(r.total_fee)) + "</td>"
        + "</tr>";
    }

    var sectionsHtml = locums.map(function (L) {
      var rows = (L.entries || []).map(fmtRow).join("");
      var head = ""
        + "<div class=\"sec-h\">"
        + "  <div class=\"sec-title\">" + esc2(L.locum_full_name || "") + " <span class=\"muted\">(" + esc2(L.registration_number || "") + ")</span></div>"
        + "  <div class=\"sec-tot\">Total Hours: <b>" + esc2(hoursFmt(L.total_hours)) + "</b> &nbsp;|&nbsp; Total Fees: <b>€ " + esc2(money2(L.total_fees)) + "</b></div>"
        + "</div>";

      return ""
        + "<div class=\"sec\">"
        + head
        + "<table>"
        + "<thead><tr><th style=\"width:20%\">Date</th><th>Day Type</th><th style=\"width:15%;text-align:right;\">Hours</th><th style=\"width:18%;text-align:right;\">Fee/Hr</th><th style=\"width:18%;text-align:right;\">Total</th></tr></thead>"
        + "<tbody>" + rows + "</tbody>"
        + "</table>"
        + "</div>";
    }).join("");

    var overallRows = overall.map(function (r) {
      return ""
        + "<tr>"
        + "<td>" + esc2(r.locum_full_name || "") + "</td>"
        + "<td>" + esc2(r.registration_number || "") + "</td>"
        + "<td style=\"text-align:right;\">" + esc2(hoursFmt(r.total_hours)) + "</td>"
        + "<td style=\"text-align:right;\">€ " + esc2(money2(r.total_fees)) + "</td>"
        + "</tr>";
    }).join("");

    var overallTotals = report.overall_totals || {};
    var overallTotalsHtml = ""
      + "<div class=\"overall-tot\">"
      + "Combined Total Hours: <b>" + esc2(hoursFmt(overallTotals.total_hours)) + "</b>"
      + " &nbsp;|&nbsp; Combined Total Fees: <b>€ " + esc2(money2(overallTotals.total_fees)) + "</b>"
      + "</div>";

    return ""
      + "<!doctype html><html><head><meta charset=\"utf-8\">"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
      + "<title>" + esc2("Locum Receipts Report") + "</title>"
      + "<style>"
      + "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:26px;color:#111;}"
      + "h1{margin:0;font-size:20px;letter-spacing:.2px;}"
      + ".meta{font-size:12px;color:#333;margin-top:4px;}"
      + ".sec{margin-top:16px;border:1px solid #000;border-radius:10px;padding:12px;}"
      + ".sec-h{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;}"
      + ".sec-title{font-size:14px;font-weight:800;}"
      + ".muted{color:#555;font-weight:700;font-size:12px;}"
      + ".sec-tot{font-size:12px;color:#333;}"
      + "table{width:100%;border-collapse:collapse;font-size:12px;}"
      + "th,td{border-bottom:1px solid #ddd;padding:6px 6px;text-align:left;}"
      + "th{background:#f6f6f6;font-weight:800;}"
      + ".overall{margin-top:18px;border:1px solid #000;border-radius:10px;padding:12px;}"
      + ".overall-tot{margin-top:8px;font-size:12px;color:#333;}"
      + "@media print{body{margin:12mm;} .no-print{display:none !important;}}"
      + "</style>"
      + "</head><body>"
      + "<h1>Locum Receipts Report</h1>"
      + "<div class=\"meta\"><b>" + esc2(locName) + "</b> &nbsp;•&nbsp; " + esc2(periodLabel) + (generatedAt ? (" &nbsp;•&nbsp; Generated: " + esc2(generatedAt)) : "") + "</div>"
      + sectionsHtml
      + "<div class=\"overall\">"
      + "  <div class=\"sec-title\">All Locums Summary</div>"
      + "  <table style=\"margin-top:10px;\">"
      + "    <thead><tr><th>Locum</th><th style=\"width:20%\">Reg No</th><th style=\"width:18%;text-align:right;\">Total Hours</th><th style=\"width:22%;text-align:right;\">Total Fees</th></tr></thead>"
      + "    <tbody>" + overallRows + "</tbody>"
      + "  </table>"
      + overallTotalsHtml
      + "</div>"
      + "<script>"
      + "window.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e){}},120);});"
      + "window.addEventListener('afterprint',function(){setTimeout(function(){try{window.close();}catch(e){}},250);});"
      + "</script>"
      + "</body></html>";
  }

  function askPassword(title, message) {
    return new Promise(function (resolve) {
      var body =
        '<div class="eikon-form">' +
          '<div class="eikon-help" style="margin-bottom:10px;">' + esc(message || "") + '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Password</label>' +
            '<input id="lr-pass" class="eikon-input" type="password" autocomplete="new-password" value="">' +
          '</div>' +
        '</div>';

      E.modal.show(title, body, [
        { label: "Cancel", onClick: function () { E.modal.hide(); resolve(null); } },
        {
          label: "Continue",
          primary: true,
          onClick: function () {
            var v = "";
            try { v = String(E.q("#lr-pass").value || ""); } catch (e) { v = ""; }
            E.modal.hide();
            resolve(v);
          }
        }
      ]);

      setTimeout(function () {
        try { E.q("#lr-pass").focus(); } catch (e2) {}
      }, 40);
    });
  }

  function computeTotal(hours, fee) {
    var h = Number(hours);
    var f = Number(fee);
    if (!isFinite(h) || !isFinite(f)) return 0;
    return Math.round((h * f) * 100) / 100;
  }

  function renderReceiptsTable(tbody, receipts, onPrint, onEdit, onDelete) {
    tbody.innerHTML = "";

    // Only show the latest receipt in this table (use Report below for history)
    var rows = Array.isArray(receipts) ? receipts.slice() : [];
    if (rows.length > 1) {
      rows.sort(function (a, b) {
        var ad = String((a && a.receipt_date) || "");
        var bd = String((b && b.receipt_date) || "");
        if (ad < bd) return 1;
        if (ad > bd) return -1;

        var ai = (a && a.id != null && isFinite(Number(a.id))) ? Number(a.id) : -Infinity;
        var bi = (b && b.id != null && isFinite(Number(b.id))) ? Number(b.id) : -Infinity;
        if (ai < bi) return 1;
        if (ai > bi) return -1;
        return 0;
      });
      rows = [rows[0]];
    }

    if (!rows.length) {
      var tr0 = document.createElement("tr");
      var td0 = document.createElement("td");
      td0.colSpan = 8;
      td0.style.color = "var(--muted)";
      td0.style.fontWeight = "700";
      td0.textContent = "No receipts for this month.";
      tr0.appendChild(td0);
      tbody.appendChild(tr0);
      return;
    }

    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      function td(txt, alignRight) {
        var t = document.createElement("td");
        if (alignRight) t.style.textAlign = "right";
        t.textContent = txt;
        return t;
      }

      tr.appendChild(td(r.receipt_date || ""));
      tr.appendChild(td(hoursFmt(r.hours), true));
      tr.appendChild(td(r.locum_full_name || ""));
      tr.appendChild(td(r.registration_number || ""));
      tr.appendChild(td(dayTypeLabel(dayTypeFromDateStr(r.receipt_date || ""))));
      tr.appendChild(td("€ " + money2(r.fee_per_hour), true));
      tr.appendChild(td("€ " + money2(r.total_fee), true));

      var act = document.createElement("td");

      var wrap = document.createElement("div");
      wrap.className = "lr-row-actions";
      act.appendChild(wrap);

      var pBtn = document.createElement("button");
      pBtn.className = "eikon-btn";
      pBtn.textContent = "View / Print";
      pBtn.addEventListener("click", function () { if (onPrint) onPrint(r); });
      wrap.appendChild(pBtn);

      var eBtn = document.createElement("button");
      eBtn.className = "eikon-btn";
      eBtn.textContent = "Edit";
      eBtn.addEventListener("click", function () { if (onEdit) onEdit(r); });
      wrap.appendChild(eBtn);

      var dBtn = document.createElement("button");
      dBtn.className = "eikon-btn";
      dBtn.textContent = "Delete";
      dBtn.addEventListener("click", function () { if (onDelete) onDelete(r); });
      wrap.appendChild(dBtn);

      tr.appendChild(act);
      tbody.appendChild(tr);
    });
  }

  function renderReportInto(container, report) {
    container.innerHTML = "";
    report = report || null;

    if (!report) {
      container.innerHTML = '<div class="lr-note">No report generated yet.</div>';
      return;
    }

    var locums = Array.isArray(report.locums) ? report.locums : [];
    var overall = Array.isArray(report.overall) ? report.overall : [];
    var overallTotals = report.overall_totals || {};

    var header =
      '<div class="lr-note">' +
        '<b>' + esc(report.location_name || "") + '</b>' +
        ' &nbsp;•&nbsp; ' + esc(report.period_label || "") +
        (report.generated_at ? (' &nbsp;•&nbsp; Generated: ' + esc(report.generated_at)) : '') +
      '</div>';

    container.insertAdjacentHTML("beforeend", header);

    locums.forEach(function (L) {
      var sec = document.createElement("div");
      sec.className = "lr-report-section";

      var headHtml =
        '<div class="lr-report-h">' +
          '<h3>' + esc(L.locum_full_name || "") + ' <span class="lr-mini">(' + esc(L.registration_number || "") + ')</span></h3>' +
          '<div class="tot">Total Hours: <b>' + esc(hoursFmt(L.total_hours)) + '</b> &nbsp;|&nbsp; Total Fees: <b>€ ' + esc(money2(L.total_fees)) + '</b></div>' +
        '</div>';

      var table =
        '<div class="eikon-table-wrap" style="margin-top:10px;">' +
          '<table class="eikon-table" style="min-width:920px;">' +
            '<thead><tr>' +
              '<th style="width:120px;">Date</th>' +
              '<th style="width:200px;">Day Type</th>' +
              '<th style="width:110px;text-align:right;">Hours</th>' +
              '<th style="width:120px;text-align:right;">Fee/Hr</th>' +
              '<th style="width:120px;text-align:right;">Total</th>' +
            '</tr></thead>' +
            '<tbody>' +
              (L.entries || []).map(function (r) {
                return ''
                  + '<tr>'
                  + '<td>' + esc(r.receipt_date || "") + '</td>'
                  + '<td>' + esc(dayTypeLabel(dayTypeFromDateStr(r.receipt_date || ""))) + '</td>'
                  + '<td style="text-align:right;">' + esc(hoursFmt(r.hours)) + '</td>'
                  + '<td style="text-align:right;">€ ' + esc(money2(r.fee_per_hour)) + '</td>'
                  + '<td style="text-align:right;">€ ' + esc(money2(r.total_fee)) + '</td>'
                  + '</tr>';
              }).join("") +
            '</tbody>' +
          '</table>' +
        '</div>';

      sec.innerHTML = headHtml + table;
      container.appendChild(sec);
    });

    var overallSec = document.createElement("div");
    overallSec.className = "lr-report-section";

    var overallHead =
      '<div class="lr-report-h">' +
        '<h3>All Locums Summary</h3>' +
        '<div class="tot">Combined Hours: <b>' + esc(hoursFmt(overallTotals.total_hours)) + '</b> &nbsp;|&nbsp; Combined Fees: <b>€ ' + esc(money2(overallTotals.total_fees)) + '</b></div>' +
      '</div>';

    var overallTable =
      '<div class="eikon-table-wrap" style="margin-top:10px;">' +
        '<table class="eikon-table" style="min-width:820px;">' +
          '<thead><tr>' +
            '<th>Locum</th>' +
            '<th style="width:160px;">Reg No</th>' +
            '<th style="width:120px;text-align:right;">Total Hours</th>' +
            '<th style="width:160px;text-align:right;">Total Fees</th>' +
          '</tr></thead>' +
          '<tbody>' +
            overall.map(function (r) {
              return ''
                + '<tr>'
                + '<td>' + esc(r.locum_full_name || "") + '</td>'
                + '<td>' + esc(r.registration_number || "") + '</td>'
                + '<td style="text-align:right;">' + esc(hoursFmt(r.total_hours)) + '</td>'
                + '<td style="text-align:right;">€ ' + esc(money2(r.total_fees)) + '</td>'
                + '</tr>';
            }).join("") +
          '</tbody>' +
        '</table>' +
      '</div>';

    overallSec.innerHTML = overallHead + overallTable;
    container.appendChild(overallSec);
  }

  async function render(ctx) {
    ensureStyles();

    var mount = ctx.mount;
    var month = state.lastMonth || ym(new Date());
    state.lastMonth = month;

    state.feeMem = loadFeeMem();

    var todayStr = ymd(new Date());
    var todayType = dayTypeFromDateStr(todayStr);

    mount.innerHTML =
      '<div class="eikon-card">' +
        '<div class="lr-head">' +
          '<div>' +
            '<div class="lr-title">Locum Receipts</div>' +
            '<div class="lr-sub">Create receipts for locums and print them with a signature space.</div>' +
          '</div>' +
          '<div class="lr-actions">' +
            '<div class="eikon-field">' +
              '<label class="eikon-label">Month</label>' +
              '<input id="lrc-month" class="eikon-input" type="month" value="' + esc(month) + '">' +
            '</div>' +
            '<div class="eikon-field">' +
              '<label class="eikon-label">Actions</label>' +
              '<div class="lr-split">' +
                '<button id="lrc-refresh" class="eikon-btn" type="button">Refresh</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="lr-head" style="margin-bottom:10px;">' +
          '<div>' +
            '<div class="lr-title" style="font-size:15px;">Create Receipt</div>' +
            '<div class="lr-sub">Total fee is calculated automatically.</div>' +
          '</div>' +
        '</div>' +
        '<div class="lr-grid">' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Date</label>' +
            '<input id="lrc-date" class="eikon-input" type="date" value="' + esc(todayStr) + '">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Hours (e.g. 4.5)</label>' +
            '<input id="lrc-hours" class="eikon-input" type="number" step="0.25" min="0" value="">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Name & Surname</label>' +
            '<input id="lrc-name" class="eikon-input" type="text" value="">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Registration Number</label>' +
            '<input id="lrc-reg" class="eikon-input" type="text" value="">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Day Type (auto)</label>' +
            '<input id="lrc-daytype-view" class="eikon-input" type="text" value="' + esc(dayTypeLabel(todayType)) + '" readonly>' +
            '<input id="lrc-daytype" type="hidden" value="' + esc(todayType) + '">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Fee per Hour (€)</label>' +
            '<input id="lrc-fee" class="eikon-input" type="number" step="0.01" min="0" value="">' +
          '</div>' +
        '</div>' +
        '<div class="lr-kpis">' +
          '<div class="lr-kpi">' +
            '<div class="k">Total Fee</div>' +
            '<div class="v" id="lrc-total">€ 0.00</div>' +
          '</div>' +
          '<div class="lr-kpi">' +
            '<div class="k">Selected Day Type</div>' +
            '<div class="v" id="lrc-daylabel">' + esc(dayTypeLabel(todayType)) + '</div>' +
          '</div>' +
          '<div class="lr-kpi">' +
            '<div class="k">Tip</div>' +
            '<div class="v" style="font-size:12px;font-weight:700;color:var(--muted);line-height:1.25;">Use “Save &amp; Print” to print immediately.</div>' +
          '</div>' +
        '</div>' +
        '<div class="lr-actions" style="margin-top:12px;">' +
          '<button id="lrc-save" class="eikon-btn primary" type="button">Save Receipt</button>' +
          '<button id="lrc-saveprint" class="eikon-btn" type="button">Save &amp; Print</button>' +
        '</div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="lr-head" style="margin-bottom:10px;">' +
          '<div>' +
            '<div class="lr-title" style="font-size:15px;">Receipts</div>' +
            '<div class="lr-sub">Showing latest receipt only. Use the report below to view older receipts.</div>' +
          '</div>' +
        '</div>' +
        '<div class="eikon-table-wrap">' +
          '<table class="eikon-table" style="min-width:980px;">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:120px;">Date</th>' +
                '<th style="width:90px;text-align:right;">Hours</th>' +
                '<th>Locum</th>' +
                '<th style="width:150px;">Reg No</th>' +
                '<th style="width:190px;">Day Type</th>' +
                '<th style="width:110px;text-align:right;">Fee/Hr</th>' +
                '<th style="width:110px;text-align:right;">Total</th>' +
                '<th style="width:260px;">Actions</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody id="lrc-tbody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div class="eikon-card">' +
        '<div class="lr-head" style="margin-bottom:10px;">' +
          '<div>' +
            '<div class="lr-title" style="font-size:15px;">Report</div>' +
            '<div class="lr-sub">To view the report you must enter the report password.</div>' +
          '</div>' +
          '<div class="lr-actions">' +
            '<div class="eikon-field">' +
              '<label class="eikon-label">Month</label>' +
              '<input id="lrc-rpt-month" class="eikon-input" type="month" value="' + esc(month) + '">' +
            '</div>' +
            '<div class="eikon-field">' +
              '<label class="eikon-label">Year</label>' +
              '<input id="lrc-rpt-year" class="eikon-input" type="number" min="2000" step="1" value="' + esc(String(new Date().getFullYear())) + '">' +
            '</div>' +
            '<div class="eikon-field">' +
              '<label class="eikon-label">Actions</label>' +
              '<div class="lr-split">' +
                '<button id="lrc-rpt-month-btn" class="eikon-btn" type="button">Generate Month</button>' +
                '<button id="lrc-rpt-year-btn" class="eikon-btn" type="button">Generate Year</button>' +
                '<button id="lrc-rpt-print" class="eikon-btn" type="button">Print Report</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lr-report-wrap" id="lrc-report"></div>' +
      '</div>';

    var monthInput = E.q("#lrc-month", mount);
    var refreshBtn = E.q("#lrc-refresh", mount);
    var tbody = E.q("#lrc-tbody", mount);

    var inDate = E.q("#lrc-date", mount);
    var inHours = E.q("#lrc-hours", mount);
    var inName = E.q("#lrc-name", mount);
    var inReg = E.q("#lrc-reg", mount);
    var inDay = E.q("#lrc-daytype", mount);
    var inDayView = E.q("#lrc-daytype-view", mount);
    var inFee = E.q("#lrc-fee", mount);
    var totalEl = E.q("#lrc-total", mount);
    var dayLabelEl = E.q("#lrc-daylabel", mount);
    var saveBtn = E.q("#lrc-save", mount);
    var savePrintBtn = E.q("#lrc-saveprint", mount);

    var rptMonth = E.q("#lrc-rpt-month", mount);
    var rptYear = E.q("#lrc-rpt-year", mount);
    var rptMonthBtn = E.q("#lrc-rpt-month-btn", mount);
    var rptYearBtn = E.q("#lrc-rpt-year-btn", mount);
    var rptPrintBtn = E.q("#lrc-rpt-print", mount);
    var rptContainer = E.q("#lrc-report", mount);

    function rememberFeeFor(t) {
      t = (t === "holiday") ? "holiday" : "normal";
      var f = parseNum(inFee.value);
      if (isFinite(f) && f >= 0) {
        if (!state.feeMem) state.feeMem = { normal: null, holiday: null };
        state.feeMem[t] = f;
        saveFeeMem(state.feeMem);
      }
    }

    function updateTotalPreview() {
      var h = parseNum(inHours.value);
      var f = parseNum(inFee.value);
      var tot = computeTotal(h, f);
      totalEl.textContent = "€ " + money2(tot);
    }

    function applyRateFromDayType(force) {
      var t = dayTypeFromDateStr(String(inDate.value || "").trim());
      try { inDay.value = t; } catch (e0) {}
      try { if (inDayView) inDayView.value = dayTypeLabel(t); } catch (e0b) {}
      dayLabelEl.textContent = dayTypeLabel(t);

      var mem = state.feeMem || { normal: null, holiday: null };
      var remembered = (t === "holiday") ? mem.holiday : mem.normal;

      var currentFee = parseNum(inFee.value);
      if (force || String(inFee.value || "").trim() === "" || !isFinite(currentFee)) {
        if (remembered != null && isFinite(Number(remembered))) {
          inFee.value = String(remembered);
        }
      }
      updateTotalPreview();
    }

    var lastDayType = dayTypeFromDateStr(String(inDate.value || "").trim());

    inDate.addEventListener("change", function () {
      var newType = dayTypeFromDateStr(String(inDate.value || "").trim());
      if (newType !== lastDayType) {
        rememberFeeFor(lastDayType);
        lastDayType = newType;
        applyRateFromDayType(true);
      } else {
        applyRateFromDayType(false);
      }
    });

    inHours.addEventListener("input", updateTotalPreview);

    inFee.addEventListener("input", function () {
      rememberFeeFor(String(inDay.value || "normal"));
      updateTotalPreview();
    });

    // initial
    applyRateFromDayType(true);

    async function refresh() {
      var m = monthInput.value || month;
      state.lastMonth = m;
      var receipts = await loadReceipts(m);

      renderReceiptsTable(
        tbody,
        receipts,
        function (row) {
          try {
            var html = buildReceiptPrintHtml((E.state.user && E.state.user.location_name) ? E.state.user.location_name : "", row);
            openPrintTabWithHtml(html);
          } catch (e) {
            E.error("[locumreceipts] print receipt failed:", e);
          }
        },
        function (row) { openEdit(row).catch(function (e) { E.error(e); }); },
        function (row) { openDelete(row).catch(function (e) { E.error(e); }); }
      );
    }

    monthInput.addEventListener("change", function () {
      refresh().catch(function (e) { E.error(e); });
    });
    refreshBtn.addEventListener("click", function () {
      refresh().catch(function (e) { E.error(e); });
    });

    async function saveReceipt(shouldPrint) {
      var payload = {
        receipt_date: String(inDate.value || "").trim(),
        hours: parseNum(inHours.value),
        locum_full_name: String(inName.value || "").trim(),
        registration_number: String(inReg.value || "").trim(),
        day_type: dayTypeFromDateStr(String(inDate.value || "").trim()),
        fee_per_hour: parseNum(inFee.value)
      };

      if (!payload.receipt_date) throw new Error("Please enter a date");
      if (!isFinite(payload.hours) || payload.hours <= 0) throw new Error("Please enter valid hours");
      if (payload.hours > 24) throw new Error("Hours cannot exceed 24");
      if (!payload.locum_full_name) throw new Error("Please enter name & surname");
      if (!payload.registration_number) throw new Error("Please enter registration number");
      if (!isFinite(payload.fee_per_hour) || payload.fee_per_hour < 0) throw new Error("Please enter a valid fee per hour");

      var resp = await E.apiFetch("/locumreceipts/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!resp || !resp.ok) throw new Error("Save failed");

      try { inHours.value = ""; } catch (e1) {}
      updateTotalPreview();

      rememberFeeFor(payload.day_type);

      await refresh();

      if (shouldPrint) {
        try {
          var row = (resp.receipt) ? resp.receipt : payload;
          if (row && (row.total_fee == null)) row.total_fee = computeTotal(row.hours, row.fee_per_hour);
          if (row && (row.day_type == null)) row.day_type = payload.day_type;
          var html = buildReceiptPrintHtml((E.state.user && E.state.user.location_name) ? E.state.user.location_name : "", row);
          openPrintTabWithHtml(html);
        } catch (e2) {
          E.error("[locumreceipts] print after save failed:", e2);
        }
      }
    }

    saveBtn.addEventListener("click", function () {
      saveReceipt(false).catch(function (e) {
        E.modal.show("Save failed", '<div class="eikon-help">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      });
    });

    savePrintBtn.addEventListener("click", function () {
      saveReceipt(true).catch(function (e) {
        E.modal.show("Save failed", '<div class="eikon-help">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      });
    });

    async function openEdit(row) {
      var pass = await askPassword("Edit Receipt", "Enter password to edit.");
      if (pass !== "!4321") {
        E.modal.show("Incorrect password", '<div class="eikon-help">Edit password is incorrect.</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
        return;
      }

      var editType = dayTypeFromDateStr(row.receipt_date || "");

      var body =
        '<div class="lr-grid">' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Date</label>' +
            '<input id="lrc-edit-date" class="eikon-input" type="date" value="' + esc(row.receipt_date || "") + '">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Hours</label>' +
            '<input id="lrc-edit-hours" class="eikon-input" type="number" step="0.25" min="0" value="' + esc(String(row.hours || "")) + '">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Name & Surname</label>' +
            '<input id="lrc-edit-name" class="eikon-input" type="text" value="' + esc(row.locum_full_name || "") + '">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Registration Number</label>' +
            '<input id="lrc-edit-reg" class="eikon-input" type="text" value="' + esc(row.registration_number || "") + '">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Day Type (auto)</label>' +
            '<input id="lrc-edit-dayview" class="eikon-input" type="text" value="' + esc(dayTypeLabel(editType)) + '" readonly>' +
            '<input id="lrc-edit-day" type="hidden" value="' + esc(editType) + '">' +
          '</div>' +
          '<div class="eikon-field">' +
            '<label class="eikon-label">Fee per Hour (€)</label>' +
            '<input id="lrc-edit-fee" class="eikon-input" type="number" step="0.01" min="0" value="' + esc(String(row.fee_per_hour || "")) + '">' +
          '</div>' +
        '</div>' +
        '<div class="lr-kpis" style="margin-top:12px;">' +
          '<div class="lr-kpi"><div class="k">Total Fee</div><div class="v" id="lrc-edit-total">€ ' + esc(money2(row.total_fee)) + '</div></div>' +
        '</div>';

      E.modal.show("Edit Receipt", body, [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Save",
          primary: true,
          onClick: async function () {
            try {
              var h = parseNum(E.q("#lrc-edit-hours").value);
              var f = parseNum(E.q("#lrc-edit-fee").value);
              var payload = {
                receipt_date: String(E.q("#lrc-edit-date").value || "").trim(),
                hours: h,
                locum_full_name: String(E.q("#lrc-edit-name").value || "").trim(),
                registration_number: String(E.q("#lrc-edit-reg").value || "").trim(),
                day_type: dayTypeFromDateStr(String(E.q("#lrc-edit-date").value || "").trim()),
                fee_per_hour: f
              };

              if (!payload.receipt_date) throw new Error("Missing date");
              if (!isFinite(payload.hours) || payload.hours <= 0) throw new Error("Invalid hours");
              if (payload.hours > 24) throw new Error("Hours cannot exceed 24");
              if (!payload.locum_full_name) throw new Error("Missing name & surname");
              if (!payload.registration_number) throw new Error("Missing registration number");
              if (!isFinite(payload.fee_per_hour) || payload.fee_per_hour < 0) throw new Error("Invalid fee per hour");

              await E.apiFetch("/locumreceipts/receipts/" + encodeURIComponent(String(row.id)), {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  "X-Eikon-Edit-Pass": pass
                },
                body: JSON.stringify(payload)
              });

              E.modal.hide();
              await refresh();
            } catch (e) {
              E.error("[locumreceipts] update failed:", e);
              E.modal.show("Save failed", '<div class="eikon-help">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>', [
                { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          }
        }
      ]);

      function updEditTotal() {
        try {
          var hh = parseNum(E.q("#lrc-edit-hours").value);
          var ff = parseNum(E.q("#lrc-edit-fee").value);
          E.q("#lrc-edit-total").textContent = "€ " + money2(computeTotal(hh, ff));
        } catch (e) {}
      }

      setTimeout(function () {
        try {
          E.q("#lrc-edit-hours").addEventListener("input", updEditTotal);
          E.q("#lrc-edit-fee").addEventListener("input", updEditTotal);
          E.q("#lrc-edit-date").addEventListener("change", function () {
            try {
              var ds = String(E.q("#lrc-edit-date").value || "").trim();
              var t = dayTypeFromDateStr(ds);
              var prev = String(E.q("#lrc-edit-day").value || "normal");
              E.q("#lrc-edit-day").value = t;
              try { E.q("#lrc-edit-dayview").value = dayTypeLabel(t); } catch (e0) {}

              if (t !== prev) {
                var mem = state.feeMem || { normal: null, holiday: null };
                var remembered = (t === "holiday") ? mem.holiday : mem.normal;
                var feeEl = E.q("#lrc-edit-fee");
                if (!isFinite(parseNum(feeEl.value)) || String(feeEl.value || "").trim() === "") {
                  if (remembered != null && isFinite(Number(remembered))) {
                    feeEl.value = String(remembered);
                  }
                }
              }
            } catch (e2) {}
            updEditTotal();
          });

          try { E.q("#lrc-edit-date").dispatchEvent(new Event("change")); } catch (e4) {}
        } catch (e3) {}
      }, 0);
    }

    async function openDelete(row) {
      var pass = await askPassword("Delete Receipt", "Enter password to delete.");
      if (pass !== "!4321") {
        E.modal.show("Incorrect password", '<div class="eikon-help">Delete password is incorrect.</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
        return;
      }

      E.modal.show(
        "Delete receipt?",
        '<div class="eikon-help">Delete receipt on <b>' + esc(row.receipt_date || "") + '</b> for <b>' + esc(row.locum_full_name || "") + '</b>?</div>',
        [
          { label: "Cancel", onClick: function () { E.modal.hide(); } },
          {
            label: "Delete",
            danger: true,
            onClick: async function () {
              try {
                await E.apiFetch("/locumreceipts/receipts/" + encodeURIComponent(String(row.id)), {
                  method: "DELETE",
                  headers: { "X-Eikon-Edit-Pass": pass }
                });
                E.modal.hide();
                await refresh();
              } catch (e) {
                E.error("[locumreceipts] delete failed:", e);
                E.modal.show("Delete failed", '<div class="eikon-help">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>', [
                  { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
                ]);
              }
            }
          }
        ]
      );
    }

    async function fetchReport(kind) {
      var pass = await askPassword("Report Access", "Enter report password to continue.");
      if (pass !== "Report1234!") {
        E.modal.show("Incorrect password", '<div class="eikon-help">Report password is incorrect.</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
        return;
      }

      var qs = "";
      if (kind === "year") {
        var y = String(rptYear.value || "").trim();
        qs = "year=" + encodeURIComponent(y);
      } else {
        var m = String(rptMonth.value || "").trim();
        qs = "month=" + encodeURIComponent(m);
      }

      var resp = await E.apiFetch("/locumreceipts/report?" + qs, {
        method: "GET",
        headers: { "X-Eikon-Report-Pass": pass }
      });
      if (!resp || !resp.ok) throw new Error("Report failed");
      state.lastReport = resp.report || null;

      renderReportInto(rptContainer, state.lastReport);
    }

    rptMonthBtn.addEventListener("click", function () {
      fetchReport("month").catch(function (e) {
        E.modal.show("Report failed", '<div class="eikon-help">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      });
    });

    rptYearBtn.addEventListener("click", function () {
      fetchReport("year").catch(function (e) {
        E.modal.show("Report failed", '<div class="eikon-help">' + esc(String(e && (e.message || e.bodyText || e))) + '</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      });
    });

    rptPrintBtn.addEventListener("click", function () {
      if (!state.lastReport) {
        E.modal.show("Nothing to print", '<div class="eikon-help">Generate a report first.</div>', [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
        return;
      }
      try {
        var html = buildReportPrintHtml(state.lastReport);
        openPrintTabWithHtml(html);
      } catch (e) {
        E.error("[locumreceipts] print report failed:", e);
      }
    });

    renderReportInto(rptContainer, null);

    await refresh();
  }

  E.registerModule({
    id: "locumreceipts",
    title: "Locum Receipts",
    order: 260,
    icon: "🧾",
    render: render
  });

})();
