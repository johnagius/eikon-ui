(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.paidout.js)");

  function dbg() { try { (E && E.dbg ? E.dbg : console.log).apply(console, arguments); } catch (e) {} }
  function warn() { try { (E && E.warn ? E.warn : console.warn).apply(console, arguments); } catch (e) {} }
  function err() { try { (E && E.error ? E.error : console.error).apply(console, arguments); } catch (e) {} }

  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) { return String(s == null ? "" : s); }
  }

  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function isYm(s) { return /^\d{4}-\d{2}$/.test(String(s || "").trim()); }
  function isHm(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || "").trim()); }

  function ymd(d) {
    var dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 10);
  }
  function ym(d) {
    var dt = d ? new Date(d) : new Date();
    return dt.toISOString().slice(0, 7);
  }
  function hm(d) {
    var dt = d ? new Date(d) : new Date();
    var h = String(dt.getHours()).padStart(2, "0");
    var m = String(dt.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }

  function fmtMoney(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    return "€ " + v.toFixed(2);
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

  function ensurePaidOutStyles() {
    if (document.getElementById("eikon-paidout-style")) return;
    var st = document.createElement("style");
    st.id = "eikon-paidout-style";
    st.textContent =
      ".po-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);font-size:12px;font-weight:800;color:var(--text)}" +
      ".po-badge.cash{border-color:rgba(90,162,255,.35);background:rgba(90,162,255,.12)}" +
      ".po-badge.cheque{border-color:rgba(255,209,90,.35);background:rgba(255,209,90,.10)}" +
      ".po-total{font-weight:1000;letter-spacing:.2px}" +
      ".po-suggestbox{position:absolute;left:0;right:0;top:100%;margin-top:6px;max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:14px;background:rgba(10,16,24,.96);box-shadow:0 18px 55px rgba(0,0,0,.42);z-index:99;display:none}" +
      ".po-suggestitem{padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px}" +
      ".po-suggestitem:hover{background:rgba(90,162,255,.12)}" +
      ".po-suggestmeta{opacity:.70;font-weight:800;font-size:12px}" +
      ".po-suggestempty{padding:10px 10px;opacity:.75;font-size:13px}" +
      ".po-report-wrap{display:flex;flex-direction:column;gap:10px}" +
      ".po-report-group{border:1px solid var(--border);border-radius:16px;background:rgba(255,255,255,.02);overflow:hidden}" +
      ".po-report-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 12px;border-bottom:1px solid rgba(255,255,255,.06)}" +
      ".po-report-head .name{font-weight:1000}" +
      ".po-report-head .meta{opacity:.80;font-weight:900;font-size:12px}" +
      ".po-report-table{width:100%;border-collapse:collapse;min-width:980px}" +
      ".po-report-table th,.po-report-table td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;font-size:13px;vertical-align:top}" +
      ".po-report-table th{font-size:12px;text-transform:uppercase;letter-spacing:.2px;color:var(--muted)}" +
      ".po-report-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 12px}" +
      ".po-report-foot .big{font-weight:1000}" +
      ".po-report-summary{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between}" +
      ".po-report-summary .k{opacity:.75;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.2px}" +
      ".po-report-summary .v{font-weight:1000}" +
      ".po-muted{opacity:.78}" +
      "@media(max-width:840px){.po-report-table{min-width:840px}}";
    document.head.appendChild(st);
  }

  async function apiList(monthYm, q) {
    var ymv = String(monthYm || "").trim();
    if (!isYm(ymv)) throw new Error("Invalid month (YYYY-MM)");
    var url = "/paid-out/entries?month=" + encodeURIComponent(ymv);
    var qq = String(q || "").trim();
    if (qq) url += "&q=" + encodeURIComponent(qq);
    url += "&_ts=" + Date.now();
    var resp = await E.apiFetch(url, { method: "GET" });
    if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to load paid out entries");
    return Array.isArray(resp.entries) ? resp.entries : [];
  }

  async function apiReport(from, to) {
    var f = String(from || "").trim();
    var t = String(to || "").trim();
    if (!isYmd(f) || !isYmd(t)) throw new Error("Invalid from/to (YYYY-MM-DD)");
    var url = "/paid-out/report?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t) + "&_ts=" + Date.now();
    var resp = await E.apiFetch(url, { method: "GET" });
    if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to generate report");
    return Array.isArray(resp.entries) ? resp.entries : [];
  }

  async function apiNames(q) {
    var qq = String(q || "").trim();
    var url = "/paid-out/names?q=" + encodeURIComponent(qq) + "&_ts=" + Date.now();
    var resp = await E.apiFetch(url, { method: "GET" });
    if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to load names");
    return Array.isArray(resp.names) ? resp.names : [];
  }

  async function apiCreate(payload) {
    var resp = await E.apiFetch("/paid-out/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
    if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to create paid out");
    return resp.entry || null;
  }

  async function apiUpdate(id, payload) {
    var resp = await E.apiFetch("/paid-out/entries/" + encodeURIComponent(String(id)), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
    if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to update paid out");
    return resp.entry || null;
  }

  async function apiDelete(id) {
    var resp = await E.apiFetch("/paid-out/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
    if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to delete paid out");
    return true;
  }

  function groupByName(entries) {
    var map = new Map();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      var name = String(e.payee_name || "").trim();
      if (!name) name = "(No name)";
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(e);
    }
    return map;
  }

  function sortEntriesForGroup(list) {
    return (list || []).slice().sort(function (a, b) {
      var ad = String((a && a.entry_date) || "");
      var bd = String((b && b.entry_date) || "");
      if (ad !== bd) return ad < bd ? -1 : 1;
      var at = String((a && a.entry_time) || "");
      var bt = String((b && b.entry_time) || "");
      if (at !== bt) return at < bt ? -1 : 1;
      var ai = Number((a && a.id) || 0);
      var bi = Number((b && b.id) || 0);
      return ai - bi;
    });
  }

  function computeTotals(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) {
      var v = Number((list[i] || {}).fee);
      if (isFinite(v)) total += v;
    }
    return total;
  }

  function buildReportBodyHtml(ctx, entries, title, subtitle) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var user = (ctx && ctx.user) ? ctx.user : (E.state ? E.state.user : null);
    var org = user && user.org_name ? user.org_name : "Pharmacy";
    var loc = user && user.location_name ? user.location_name : "";

    var byName = groupByName(list);
    var names = Array.from(byName.keys()).sort(function (a, b) { return a.localeCompare(b); });

    var grandTotal = computeTotals(list);
    var count = list.length;

    var html = "";
    html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
            '  <div>' +
            '    <div style="font-weight:1000;font-size:18px;">' + esc(org) + (loc ? " — " + esc(loc) : "") + "</div>" +
            '    <div style="opacity:.82;font-weight:900;margin-top:4px;">' + esc(title || "Paid Out Report") + "</div>" +
            (subtitle ? ('    <div style="opacity:.72;margin-top:2px;">' + esc(subtitle) + "</div>") : "") +
            "  </div>" +
            '  <div class="po-report-summary">' +
            '    <div><div class="k">Entries</div><div class="v">' + esc(String(count)) + "</div></div>" +
            '    <div><div class="k">Grand Total</div><div class="v">' + esc(fmtMoney(grandTotal)) + "</div></div>" +
            "  </div>" +
            "</div>";

    if (!list.length) {
      html += '<div style="margin-top:12px;opacity:.78">No entries for the selected period.</div>';
      return html;
    }

    html += '<div class="po-report-wrap" style="margin-top:12px;">';

    for (var ni = 0; ni < names.length; ni++) {
      var name = names[ni];
      var g = sortEntriesForGroup(byName.get(name) || []);
      var gTotal = computeTotals(g);

      html += '<div class="po-report-group">';
      html += '  <div class="po-report-head">' +
              '    <div class="name">' + esc(name) + '</div>' +
              '    <div class="meta">Total: <span class="po-total">' + esc(fmtMoney(gTotal)) + "</span> • " + esc(String(g.length)) + " item(s)</div>" +
              "  </div>";

      html += '  <div style="overflow:auto;">';
      html += '    <table class="po-report-table">';
      html += "      <thead><tr>" +
              "<th>Date</th><th>Time</th><th>Fee</th><th>Method</th><th>Invoice</th><th>Cheque No.</th><th>Reason</th>" +
              "</tr></thead><tbody>";

      for (var i = 0; i < g.length; i++) {
        var e = g[i] || {};
        var method = String(e.payment_method || "").toLowerCase() === "cheque" ? "Cheque" : "Cash";
        html += "<tr>" +
                "<td>" + esc(e.entry_date || "") + "</td>" +
                "<td>" + esc(e.entry_time || "") + "</td>" +
                "<td>" + esc(fmtMoney(e.fee)) + "</td>" +
                "<td>" + esc(method) + "</td>" +
                "<td class='po-muted'>" + esc(e.invoice_no || "") + "</td>" +
                "<td class='po-muted'>" + esc(e.cheque_no || "") + "</td>" +
                "<td class='po-muted'>" + esc(e.reason || "") + "</td>" +
                "</tr>";
      }

      html += "      </tbody></table>";
      html += "  </div>";

      html += '  <div class="po-report-foot">' +
              '    <div class="po-muted">Subtotal for ' + esc(name) + "</div>" +
              '    <div class="big">' + esc(fmtMoney(gTotal)) + "</div>" +
              "  </div>";

      html += "</div>";
    }

    html += "</div>";
    html += '<div style="margin-top:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;border-top:1px solid rgba(255,255,255,.08);padding-top:12px;">' +
            '  <div class="po-muted" style="font-weight:900;">Grand Total (all individuals/companies)</div>' +
            '  <div style="font-weight:1000;font-size:16px;">' + esc(fmtMoney(grandTotal)) + "</div>" +
            "</div>";

    return html;
  }

  function buildPrintDocHtml(bodyHtml, title) {
    var t = String(title || "Paid Out");
    return (
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'/>" +
      "<title>" + esc(t) + "</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:22px;color:#111;background:#fff;}" +
      "h1,h2,h3{margin:0 0 10px 0;}" +
      ".muted{color:#555;}" +
      ".card{border:1px solid #ddd;border-radius:14px;padding:14px;margin-top:12px;}" +
      ".po-report-group{border:1px solid #ddd;border-radius:14px;overflow:hidden;margin-top:12px;}" +
      ".po-report-head{padding:12px 12px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;}" +
      ".po-report-head .name{font-weight:900;}" +
      ".po-report-head .meta{font-size:12px;color:#555;font-weight:800;}" +
      "table{width:100%;border-collapse:collapse;}" +
      "th,td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12.5px;text-align:left;vertical-align:top;}" +
      "th{font-size:11px;text-transform:uppercase;letter-spacing:.2px;color:#555;}" +
      ".po-report-foot{padding:10px 12px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;}" +
      ".po-total{font-weight:900;}" +
      "@media print{body{padding:0} .noprint{display:none}}" +
      "</style></head><body>" +
      bodyHtml +
      "<script>window.onload=function(){try{setTimeout(function(){window.print();},40);}catch(e){}}</script>" +
      "</body></html>"
    );
  }

  function buildReceiptBodyHtml(ctx, entry) {
    var e = entry || {};
    var user = (ctx && ctx.user) ? ctx.user : (E.state ? E.state.user : null);
    var org = user && user.org_name ? user.org_name : "Pharmacy";
    var loc = user && user.location_name ? user.location_name : "";

    var method = String(e.payment_method || "").toLowerCase() === "cheque" ? "Cheque" : "Cash";

    var html = "";
    html += "<div style='display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;'>";
    html += "  <div>";
    html += "    <div style='font-weight:1000;font-size:18px;'>" + esc(org) + (loc ? " — " + esc(loc) : "") + "</div>";
    html += "    <div style='opacity:.82;font-weight:900;margin-top:4px;'>Paid Out Receipt</div>";
    html += "  </div>";
    html += "  <div style='text-align:right;'>";
    html += "    <div style='font-weight:900;'>Date: " + esc(e.entry_date || "") + "</div>";
    html += "    <div style='opacity:.82;font-weight:900;'>Time: " + esc(e.entry_time || "") + "</div>";
    html += "  </div>";
    html += "</div>";

    html += "<div class='card'>";
    html += "  <div style='display:flex;gap:12px;flex-wrap:wrap;'>";
    html += "    <div style='min-width:260px;flex:2;'><div class='muted' style='font-weight:800;text-transform:uppercase;letter-spacing:.2px;font-size:11px;'>Paid To</div><div style='font-weight:1000;font-size:14px;margin-top:4px;'>" + esc(e.payee_name || "") + "</div></div>";
    html += "    <div style='min-width:180px;flex:1;'><div class='muted' style='font-weight:800;text-transform:uppercase;letter-spacing:.2px;font-size:11px;'>Amount</div><div style='font-weight:1000;font-size:16px;margin-top:4px;'>" + esc(fmtMoney(e.fee)) + "</div></div>";
    html += "    <div style='min-width:160px;flex:1;'><div class='muted' style='font-weight:800;text-transform:uppercase;letter-spacing:.2px;font-size:11px;'>Method</div><div style='font-weight:900;margin-top:4px;'>" + esc(method) + "</div></div>";
    html += "  </div>";

    html += "  <div style='display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;'>";
    html += "    <div style='min-width:220px;flex:1;'><div class='muted' style='font-weight:800;text-transform:uppercase;letter-spacing:.2px;font-size:11px;'>Invoice No.</div><div style='font-weight:900;margin-top:4px;'>" + esc(e.invoice_no || "") + "</div></div>";
    html += "    <div style='min-width:220px;flex:1;'><div class='muted' style='font-weight:800;text-transform:uppercase;letter-spacing:.2px;font-size:11px;'>Cheque No.</div><div style='font-weight:900;margin-top:4px;'>" + esc(e.cheque_no || "") + "</div></div>";
    html += "  </div>";

    html += "  <div style='margin-top:12px;'>";
    html += "    <div class='muted' style='font-weight:800;text-transform:uppercase;letter-spacing:.2px;font-size:11px;'>Reason</div>";
    html += "    <div style='font-weight:800;margin-top:4px;white-space:pre-wrap;'>" + esc(e.reason || "") + "</div>";
    html += "  </div>";
    html += "</div>";

    html += "<div class='card' style='margin-top:14px;'>";
    html += "  <div class='muted' style='font-weight:900;margin-bottom:10px;'>Client signature</div>";
    html += "  <div style='display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;'>";
    html += "    <div style='flex:2;min-width:260px;'><div class='muted' style='font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.2px;'>Name</div><div style='border-bottom:1px solid #bbb;height:28px;'></div></div>";
    html += "    <div style='flex:2;min-width:260px;'><div class='muted' style='font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.2px;'>Signature</div><div style='border-bottom:1px solid #bbb;height:28px;'></div></div>";
    html += "    <div style='flex:1;min-width:160px;'><div class='muted' style='font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.2px;'>Date</div><div style='border-bottom:1px solid #bbb;height:28px;'></div></div>";
    html += "  </div>";
    html += "</div>";

    html += "<div class='muted' style='margin-top:12px;font-size:11px;'>This receipt confirms a paid out from the pharmacy cash/cheque. Keep a copy for your records.</div>";
    return html;
  }

  function printReceipt(ctx, entry) {
    var body = buildReceiptBodyHtml(ctx, entry);
    var html = buildPrintDocHtml(body, "Paid Out Receipt");
    openPrintTabWithHtml(html);
  }

  function printReport(ctx, entries, title, subtitle) {
    var body = buildReportBodyHtml(ctx, entries, title, subtitle);
    var html = buildPrintDocHtml(body, title || "Paid Out Report");
    openPrintTabWithHtml(html);
  }

  function monthRange(ymStr) {
    var m = String(ymStr || "").trim();
    if (!isYm(m)) return null;
    var y = parseInt(m.slice(0, 4), 10);
    var mo = parseInt(m.slice(5, 7), 10);
    var start = new Date(Date.UTC(y, mo - 1, 1));
    var end = new Date(Date.UTC(y, mo, 1));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  function yearRange(yStr) {
    var y = String(yStr || "").trim();
    if (!/^\d{4}$/.test(y)) return null;
    var yn = parseInt(y, 10);
    var start = new Date(Date.UTC(yn, 0, 1));
    var end = new Date(Date.UTC(yn + 1, 0, 1));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  function dayRange(dStr) {
    var d = String(dStr || "").trim();
    if (!isYmd(d)) return null;
    var y = parseInt(d.slice(0, 4), 10);
    var mo = parseInt(d.slice(5, 7), 10);
    var da = parseInt(d.slice(8, 10), 10);
    var start = new Date(Date.UTC(y, mo - 1, da));
    var end = new Date(Date.UTC(y, mo - 1, da + 1));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  function modalError(title, e) {
    var msg = String(e && (e.message || e.stack || e));
    if (e && e.status === 401) msg = "Unauthorized (missing/invalid token).\nLog in again.";
    E.modal.show(title || "Error", "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
  }

  function buildEntryModalBodyHtml(mode, entry) {
    var e = entry || {};
    var title = (mode === "edit" ? "Edit" : "New") + " Paid Out";
    var d = String(e.entry_date || "") || ymd(new Date());
    var t = String(e.entry_time || "") || hm(new Date());
    var name = String(e.payee_name || "");
    var fee = (e.fee != null ? String(e.fee) : "");
    var inv = String(e.invoice_no || "");
    var pm = String(e.payment_method || "cash").toLowerCase();
    if (pm !== "cheque") pm = "cash";
    var chq = String(e.cheque_no || "");
    var reason = String(e.reason || "");

    return (
      "<div style='margin-bottom:8px;font-weight:1000;'>" + esc(title) + "</div>" +
      "<div class='eikon-row' style='align-items:flex-end;'>" +
      "  <div class='eikon-field'><div class='eikon-label'>Date</div><input class='eikon-input' id='po-f-date' type='date' value='" + esc(d) + "' /></div>" +
      "  <div class='eikon-field'><div class='eikon-label'>Time</div><input class='eikon-input' id='po-f-time' type='time' value='" + esc(t) + "' /></div>" +
      "  <div class='eikon-field' style='flex:1;min-width:240px;position:relative;'>" +
      "    <div class='eikon-label'>Company / Individual Name</div>" +
      "    <input class='eikon-input' id='po-f-name' placeholder='Start typing…' value='" + esc(name) + "' />" +
      "    <div class='po-suggestbox' id='po-name-suggest'></div>" +
      "  </div>" +
      "  <div class='eikon-field'><div class='eikon-label'>Fee</div><input class='eikon-input' id='po-f-fee' type='number' step='0.01' placeholder='0.00' value='" + esc(fee) + "' /></div>" +
      "</div>" +

      "<div class='eikon-row' style='margin-top:10px;align-items:flex-end;'>" +
      "  <div class='eikon-field'><div class='eikon-label'>Invoice No. (optional)</div><input class='eikon-input' id='po-f-inv' placeholder='Invoice number' value='" + esc(inv) + "' /></div>" +
      "  <div class='eikon-field'><div class='eikon-label'>Payment Method</div>" +
      "    <select class='eikon-select' id='po-f-method'>" +
      "      <option value='cash'" + (pm === "cash" ? " selected" : "") + ">Cash</option>" +
      "      <option value='cheque'" + (pm === "cheque" ? " selected" : "") + ">Cheque</option>" +
      "    </select>" +
      "  </div>" +
      "  <div class='eikon-field' id='po-cheque-wrap'><div class='eikon-label'>Cheque No. (optional)</div><input class='eikon-input' id='po-f-cheque' placeholder='Cheque number' value='" + esc(chq) + "' /></div>" +
      "</div>" +

      "<div class='eikon-field' style='margin-top:10px;'>" +
      "  <div class='eikon-label'>Reason (optional)</div>" +
      "  <textarea class='eikon-textarea' id='po-f-reason' placeholder='Reason…'>" + esc(reason) + "</textarea>" +
      "</div>" +

      "<div class='eikon-help' id='po-f-msg' style='margin-top:10px;'></div>"
    );
  }

  function normalizeEntryPayload(dateVal, timeVal, nameVal, feeVal, invVal, methodVal, chequeVal, reasonVal) {
    var entry_date = String(dateVal || "").trim();
    var entry_time = String(timeVal || "").trim();
    var payee_name = String(nameVal || "").trim();
    var invoice_no = String(invVal || "").trim();
    var payment_method = String(methodVal || "").trim().toLowerCase();
    var cheque_no = String(chequeVal || "").trim();
    var reason = String(reasonVal || "").trim();

    var fee = Number(feeVal);
    if (!isFinite(fee)) fee = NaN;

    if (!isYmd(entry_date)) return { ok: false, error: "Invalid date (YYYY-MM-DD)" };
    if (!isHm(entry_time)) return { ok: false, error: "Invalid time (HH:MM)" };
    if (!payee_name) return { ok: false, error: "Name is required" };
    if (!(fee > 0)) return { ok: false, error: "Fee must be a positive number" };

    if (payment_method !== "cheque") payment_method = "cash";
    if (payment_method === "cash") cheque_no = "";

    return {
      ok: true,
      payload: {
        entry_date: entry_date,
        entry_time: entry_time,
        payee_name: payee_name,
        fee: fee,
        invoice_no: invoice_no,
        payment_method: payment_method,
        cheque_no: cheque_no,
        reason: reason
      }
    };
  }

  async function openEntryModal(ctx, mode, entry, onSaved) {
    var bodyHtml = buildEntryModalBodyHtml(mode, entry);

    E.modal.show(mode === "edit" ? "Edit Paid Out" : "New Paid Out", bodyHtml, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Save", primary: true, onClick: function () { doSave(false); } },
      { label: "Save & Print", onClick: function () { doSave(true); } }
    ]);

    var ov = document.querySelector(".eikon-modal-overlay");
    var body = ov ? ov.querySelector("#eikon-modal-body") : null;

    var elDate = body ? body.querySelector("#po-f-date") : null;
    var elTime = body ? body.querySelector("#po-f-time") : null;
    var elName = body ? body.querySelector("#po-f-name") : null;
    var elFee = body ? body.querySelector("#po-f-fee") : null;
    var elInv = body ? body.querySelector("#po-f-inv") : null;
    var elMethod = body ? body.querySelector("#po-f-method") : null;
    var elChequeWrap = body ? body.querySelector("#po-cheque-wrap") : null;
    var elCheque = body ? body.querySelector("#po-f-cheque") : null;
    var elReason = body ? body.querySelector("#po-f-reason") : null;
    var msg = body ? body.querySelector("#po-f-msg") : null;

    var suggestBox = body ? body.querySelector("#po-name-suggest") : null;
    var suggestHideTimer = null;
    var suggestSeq = 0;
    var suggestResults = [];

    function setFormMsg(kind, text) {
      if (!msg) return;
      msg.textContent = text || "";
      msg.style.color = (kind === "err" ? "var(--danger)" : "var(--muted)");
    }

    function setChequeVisibility() {
      if (!elMethod || !elChequeWrap) return;
      var m = String(elMethod.value || "").toLowerCase();
      var show = (m === "cheque");
      elChequeWrap.style.display = show ? "" : "none";
      if (!show && elCheque) elCheque.value = "";
    }

    function clearNode(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

    function renderSuggest() {
      if (!suggestBox) return;
      clearNode(suggestBox);

      if (!suggestResults || !suggestResults.length) {
        suggestBox.appendChild(document.createElement("div")).className = "po-suggestempty";
        suggestBox.firstChild.textContent = "No suggestions";
        return;
      }

      for (var i = 0; i < suggestResults.length; i++) {
        (function (it) {
          var name = String((it && it.name) || "");
          var count = Number((it && it.count) || 0);
          var row = document.createElement("div");
          row.className = "po-suggestitem";
          row.innerHTML = "<span>" + esc(name) + "</span>" + (count ? "<span class='po-suggestmeta'>(" + esc(String(count)) + ")</span>" : "");
          row.onmousedown = function (ev) { try { ev.preventDefault(); } catch (e) {} };
          row.onclick = function () {
            try { if (elName) elName.value = name; } catch (e2) {}
            hideSuggest(true);
            try { if (elFee) elFee.focus(); } catch (e3) {}
          };
          suggestBox.appendChild(row);
        })(suggestResults[i]);
      }
    }

    function showSuggest() {
      if (!suggestBox) return;
      if (suggestHideTimer) { try { clearTimeout(suggestHideTimer); } catch (e) {} suggestHideTimer = null; }
      renderSuggest();
      suggestBox.style.display = "block";
    }

    function hideSuggest(immediate) {
      if (!suggestBox) return;
      if (suggestHideTimer) { try { clearTimeout(suggestHideTimer); } catch (e) {} suggestHideTimer = null; }
      if (immediate) { suggestBox.style.display = "none"; return; }
      suggestHideTimer = setTimeout(function () { try { suggestBox.style.display = "none"; } catch (e2) {} }, 160);
    }

    async function scheduleLookup(q) {
      var seq = ++suggestSeq;
      var query = String(q || "");
      try {
        var names = await apiNames(query);
        if (seq !== suggestSeq) return;
        suggestResults = names;
      } catch (e) {
        if (seq !== suggestSeq) return;
        suggestResults = [];
      }
      showSuggest();
    }

    async function doSave(printAfter) {
      setFormMsg("", "");
      var norm = normalizeEntryPayload(
        elDate && elDate.value,
        elTime && elTime.value,
        elName && elName.value,
        elFee && elFee.value,
        elInv && elInv.value,
        elMethod && elMethod.value,
        elCheque && elCheque.value,
        elReason && elReason.value
      );

      if (!norm.ok) {
        setFormMsg("err", norm.error);
        return;
      }

      try {
        setFormMsg("", "Saving…");
        var saved = null;
        if (mode === "edit" && entry && entry.id) saved = await apiUpdate(entry.id, norm.payload);
        else saved = await apiCreate(norm.payload);

        E.modal.hide();
        try { if (onSaved) onSaved(saved); } catch (e2) {}
        if (printAfter && saved) printReceipt(ctx, saved);
      } catch (e) {
        setFormMsg("err", String(e && (e.message || e)));
      }
    }

    // Events
    try { if (elMethod) elMethod.onchange = setChequeVisibility; } catch (e) {}
    setChequeVisibility();

    // Suggestions (cloud-backed)
    if (elName) {
      elName.onfocus = function () { scheduleLookup(elName.value); };
      elName.onclick = function () { scheduleLookup(elName.value); };
      elName.oninput = function () { scheduleLookup(elName.value); };
      elName.onblur = function () { hideSuggest(false); };
      elName.onkeydown = function (ev) { if (ev && ev.key === "Escape") hideSuggest(true); };
    }

    if (suggestBox) {
      suggestBox.onmouseenter = function () { if (suggestHideTimer) { try { clearTimeout(suggestHideTimer); } catch (e) {} suggestHideTimer = null; } };
      suggestBox.onmouseleave = function () { hideSuggest(false); };
    }
  }

  async function render(ctx) {
    ensurePaidOutStyles();

    var mount = ctx.mount;
    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Month</div>' +
      '      <input class="eikon-input" id="po-month" type="month" />' +
      '    </div>' +
      '    <div class="eikon-field" style="flex:1;min-width:240px;">' +
      '      <div class="eikon-label">Search</div>' +
      '      <input class="eikon-input" id="po-q" placeholder="Name, invoice, reason…" />' +
      '    </div>' +
      '    <div style="flex:1;"></div>' +
      '    <button class="eikon-btn" id="po-refresh">Refresh</button>' +
      '    <button class="eikon-btn primary" id="po-new">New Paid Out</button>' +
      '  </div>' +
      '  <div class="eikon-help" id="po-msg" style="margin-top:10px;"></div>' +
      '</div>' +

      '<div class="eikon-card">' +
      '  <div class="eikon-row" style="justify-content:space-between;align-items:center;">' +
      '    <div>' +
      '      <div style="font-weight:1000;font-size:14px;">Entries</div>' +
      '      <div class="eikon-help" id="po-summary" style="margin-top:4px;"></div>' +
      '    </div>' +
      '    <div class="eikon-row" style="gap:8px;align-items:center;">' +
      '      <button class="eikon-btn" id="po-print-month">Print month report</button>' +
      '    </div>' +
      '  </div>' +
      '  <div style="height:10px;"></div>' +
      '  <div class="eikon-table-wrap">' +
      '    <table class="eikon-table" style="min-width:1100px;">' +
      '      <thead><tr>' +
      '        <th>Date</th>' +
      '        <th>Time</th>' +
      '        <th>Name</th>' +
      '        <th>Fee</th>' +
      '        <th>Method</th>' +
      '        <th>Invoice</th>' +
      '        <th>Cheque No.</th>' +
      '        <th>Reason</th>' +
      '        <th style="width:240px;">Actions</th>' +
      '      </tr></thead>' +
      '      <tbody id="po-tbody"></tbody>' +
      '    </table>' +
      '  </div>' +
      '</div>' +

      '<div class="eikon-card">' +
      '  <div style="font-weight:1000;font-size:14px;margin-bottom:10px;">Reports</div>' +
      '  <div class="eikon-row" style="align-items:flex-end;">' +
      '    <div class="eikon-field">' +
      '      <div class="eikon-label">Type</div>' +
      '      <select class="eikon-select" id="po-rtype">' +
      '        <option value="day">Day</option>' +
      '        <option value="month">Month</option>' +
      '        <option value="year">Year</option>' +
      '      </select>' +
      '    </div>' +
      '    <div class="eikon-field" id="po-rday-wrap">' +
      '      <div class="eikon-label">Day</div>' +
      '      <input class="eikon-input" id="po-rday" type="date" />' +
      '    </div>' +
      '    <div class="eikon-field" id="po-rmonth-wrap">' +
      '      <div class="eikon-label">Month</div>' +
      '      <input class="eikon-input" id="po-rmonth" type="month" />' +
      '    </div>' +
      '    <div class="eikon-field" id="po-ryear-wrap">' +
      '      <div class="eikon-label">Year</div>' +
      '      <input class="eikon-input" id="po-ryear" type="number" min="2000" max="2100" />' +
      '    </div>' +
      '    <button class="eikon-btn" id="po-run">Generate</button>' +
      '    <button class="eikon-btn" id="po-print-report">Print report</button>' +
      '  </div>' +
      '  <div class="eikon-help" id="po-rmsg" style="margin-top:10px;"></div>' +
      '  <div id="po-report-preview" style="margin-top:10px;"></div>' +
      '</div>';

    var state = {
      month: ym(new Date()),
      q: "",
      entries: [],
      report: null,
      reportMeta: null
    };

    var monthEl = mount.querySelector("#po-month");
    var qEl = mount.querySelector("#po-q");
    var msgEl = mount.querySelector("#po-msg");
    var summaryEl = mount.querySelector("#po-summary");
    var tbody = mount.querySelector("#po-tbody");
    var btnRefresh = mount.querySelector("#po-refresh");
    var btnNew = mount.querySelector("#po-new");
    var btnPrintMonth = mount.querySelector("#po-print-month");

    var rtypeEl = mount.querySelector("#po-rtype");
    var rdayWrap = mount.querySelector("#po-rday-wrap");
    var rmonthWrap = mount.querySelector("#po-rmonth-wrap");
    var ryearWrap = mount.querySelector("#po-ryear-wrap");
    var rdayEl = mount.querySelector("#po-rday");
    var rmonthEl = mount.querySelector("#po-rmonth");
    var ryearEl = mount.querySelector("#po-ryear");
    var btnRun = mount.querySelector("#po-run");
    var btnPrintReport = mount.querySelector("#po-print-report");
    var rmsgEl = mount.querySelector("#po-rmsg");
    var reportPreview = mount.querySelector("#po-report-preview");

    function setMsg(kind, text) {
      if (!msgEl) return;
      msgEl.textContent = text || "";
      msgEl.style.color = (kind === "err" ? "var(--danger)" : "var(--muted)");
    }

    function setRmsg(kind, text) {
      if (!rmsgEl) return;
      rmsgEl.textContent = text || "";
      rmsgEl.style.color = (kind === "err" ? "var(--danger)" : "var(--muted)");
    }

    function clearNode(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

    function badge(method) {
      var m = String(method || "").toLowerCase() === "cheque" ? "cheque" : "cash";
      return "<span class='po-badge " + (m === "cheque" ? "cheque" : "cash") + "'>" + (m === "cheque" ? "Cheque" : "Cash") + "</span>";
    }

    function renderRows() {
      if (!tbody) return;
      clearNode(tbody);

      var list = Array.isArray(state.entries) ? state.entries.slice() : [];
      list.sort(function (a, b) {
        var ad = String((a && a.entry_date) || "");
        var bd = String((b && b.entry_date) || "");
        if (ad !== bd) return ad > bd ? -1 : 1;
        var at = String((a && a.entry_time) || "");
        var bt = String((b && b.entry_time) || "");
        if (at !== bt) return at > bt ? -1 : 1;
        var ai = Number((a && a.id) || 0);
        var bi = Number((b && b.id) || 0);
        return bi - ai;
      });

      if (!list.length) {
        var tr0 = document.createElement("tr");
        var td0 = document.createElement("td");
        td0.colSpan = 9;
        td0.style.opacity = "0.75";
        td0.textContent = "No paid out entries for this month.";
        tr0.appendChild(td0);
        tbody.appendChild(tr0);
      } else {
        for (var i = 0; i < list.length; i++) {
          (function (row) {
            var tr = document.createElement("tr");

            function td(html) {
              var cell = document.createElement("td");
              cell.innerHTML = html;
              return cell;
            }

            tr.appendChild(td(esc(row.entry_date || "")));
            tr.appendChild(td(esc(row.entry_time || "")));
            tr.appendChild(td("<span style='font-weight:900;'>" + esc(row.payee_name || "") + "</span>"));
            tr.appendChild(td("<span class='po-total'>" + esc(fmtMoney(row.fee)) + "</span>"));
            tr.appendChild(td(badge(row.payment_method)));
            tr.appendChild(td("<span class='po-muted'>" + esc(row.invoice_no || "") + "</span>"));
            tr.appendChild(td("<span class='po-muted'>" + esc(row.cheque_no || "") + "</span>"));
            tr.appendChild(td("<span class='po-muted' style='white-space:pre-wrap'>" + esc(row.reason || "") + "</span>"));

            var actions = document.createElement("td");
            actions.style.whiteSpace = "nowrap";

            var bEdit = document.createElement("button");
            bEdit.className = "eikon-btn";
            bEdit.textContent = "Edit";
            bEdit.onclick = function () {
              openEntryModal(ctx, "edit", row, function (saved) {
                if (!saved) return;
                for (var j = 0; j < state.entries.length; j++) {
                  if (state.entries[j].id === saved.id) { state.entries[j] = saved; break; }
                }
                renderRows();
                renderSummary();
              });
            };

            var bReceipt = document.createElement("button");
            bReceipt.className = "eikon-btn";
            bReceipt.style.marginLeft = "8px";
            bReceipt.textContent = "Receipt";
            bReceipt.onclick = function () { printReceipt(ctx, row); };

            var bDel = document.createElement("button");
            bDel.className = "eikon-btn danger";
            bDel.style.marginLeft = "8px";
            bDel.textContent = "Delete";
            bDel.onclick = function () {
              E.modal.show("Delete", "<div style='white-space:pre-wrap'>Delete this paid out entry?\n\n" + esc(row.payee_name || "") + " — " + esc(fmtMoney(row.fee)) + "</div>", [
                { label: "Cancel", primary: true, onClick: function () { E.modal.hide(); } },
                {
                  label: "Delete",
                  onClick: async function () {
                    try {
                      await apiDelete(row.id);
                      E.modal.hide();
                      state.entries = state.entries.filter(function (x) { return x.id !== row.id; });
                      renderRows();
                      renderSummary();
                    } catch (e) {
                      modalError("Delete failed", e);
                    }
                  }
                }
              ]);
            };

            actions.appendChild(bEdit);
            actions.appendChild(bReceipt);
            actions.appendChild(bDel);
            tr.appendChild(actions);

            tbody.appendChild(tr);
          })(list[i]);
        }
      }
    }

    function renderSummary() {
      if (!summaryEl) return;
      var list = Array.isArray(state.entries) ? state.entries : [];
      var total = computeTotals(list);
      summaryEl.innerHTML =
        "<span class='po-muted'>Items:</span> <b>" + esc(String(list.length)) + "</b>" +
        " &nbsp;•&nbsp; " +
        "<span class='po-muted'>Total:</span> <b>" + esc(fmtMoney(total)) + "</b>";
    }

    async function refresh() {
      setMsg("", "");
      var m = String(monthEl && monthEl.value || state.month || "").trim();
      if (!isYm(m)) m = ym(new Date());
      state.month = m;

      var q = String(qEl && qEl.value || "").trim();
      state.q = q;

      try {
        setMsg("", "Loading…");
        var entries = await apiList(m, q);
        state.entries = entries || [];
        renderRows();
        renderSummary();
        setMsg("", "");
      } catch (e) {
        state.entries = [];
        renderRows();
        renderSummary();
        setMsg("err", String(e && (e.message || e)));
        warn("refresh failed", e);
      }
    }

    function setReportTypeUI() {
      var t = String(rtypeEl && rtypeEl.value || "day").toLowerCase();
      if (rdayWrap) rdayWrap.style.display = (t === "day" ? "" : "none");
      if (rmonthWrap) rmonthWrap.style.display = (t === "month" ? "" : "none");
      if (ryearWrap) ryearWrap.style.display = (t === "year" ? "" : "none");
    }

    function renderReportPreview() {
      if (!reportPreview) return;
      if (!state.reportMeta) {
        reportPreview.innerHTML = "<div class='po-muted'>No report generated yet.</div>";
        return;
      }
      reportPreview.innerHTML = buildReportBodyHtml(ctx, state.report || [], state.reportMeta.title, state.reportMeta.subtitle);
    }

    async function runReport() {
      setRmsg("", "");
      var typ = String(rtypeEl && rtypeEl.value || "day").toLowerCase();
      var range = null;
      var title = "Paid Out Report";
      var subtitle = "";

      if (typ === "day") {
        var d = String(rdayEl && rdayEl.value || "").trim();
        if (!d) d = ymd(new Date());
        range = dayRange(d);
        title = "Paid Out — Day Report";
        subtitle = d;
      } else if (typ === "month") {
        var m = String(rmonthEl && rmonthEl.value || "").trim();
        if (!m) m = ym(new Date());
        range = monthRange(m);
        title = "Paid Out — Month Report";
        subtitle = m;
      } else if (typ === "year") {
        var y = String(ryearEl && ryearEl.value || "").trim();
        if (!y) y = String(new Date().getFullYear());
        range = yearRange(y);
        title = "Paid Out — Year Report";
        subtitle = y;
      } else {
        setRmsg("err", "Invalid report type");
        return;
      }

      if (!range) { setRmsg("err", "Invalid period"); return; }

      try {
        setRmsg("", "Generating…");
        var entries = await apiReport(range.from, range.to);
        state.report = entries || [];
        state.reportMeta = { from: range.from, to: range.to, title: title, subtitle: subtitle };
        renderReportPreview();
        setRmsg("", "");
      } catch (e) {
        state.report = [];
        state.reportMeta = { from: range.from, to: range.to, title: title, subtitle: subtitle };
        renderReportPreview();
        setRmsg("err", String(e && (e.message || e)));
      }
    }

    // Init controls
    if (monthEl) monthEl.value = state.month;
    if (qEl) qEl.value = state.q;

    if (rdayEl) rdayEl.value = ymd(new Date());
    if (rmonthEl) rmonthEl.value = ym(new Date());
    if (ryearEl) ryearEl.value = String(new Date().getFullYear());
    setReportTypeUI();
    renderReportPreview();

    // Events
    if (btnRefresh) btnRefresh.onclick = function () { refresh(); };
    if (btnNew) btnNew.onclick = function () {
      openEntryModal(ctx, "new", null, function (saved) {
        if (saved) {
          state.entries.push(saved);
          renderRows();
          renderSummary();
        }
      });
    };

    if (monthEl) monthEl.onchange = function () { refresh(); };
    if (qEl) {
      qEl.onkeydown = function (ev) {
        if (ev && ev.key === "Enter") refresh();
      };
    }

    if (btnPrintMonth) btnPrintMonth.onclick = function () {
      var m = String(state.month || "").trim();
      var subtitle = m ? ("Month: " + m) : "";
      printReport(ctx, state.entries || [], "Paid Out — Month Report", subtitle);
    };

    if (rtypeEl) rtypeEl.onchange = function () { setReportTypeUI(); };
    if (btnRun) btnRun.onclick = function () { runReport(); };
    if (btnPrintReport) btnPrintReport.onclick = function () {
      if (!state.reportMeta) { setRmsg("err", "Generate a report first."); return; }
      printReport(ctx, state.report || [], state.reportMeta.title, state.reportMeta.subtitle);
    };

    await refresh();
  }

  E.registerModule({
    id: "paidout",
    title: "Paid Out",
    order: 250,
    icon: "💸",
    render: render,
  });
})();
