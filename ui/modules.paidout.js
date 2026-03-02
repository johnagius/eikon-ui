(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.paidout.js)");

  function dbg() { try { (E && E.dbg ? E.dbg : console.log).apply(console, arguments); } catch (e) {} }
  function warn() { try { (E && E.warn ? E.warn : console.warn).apply(console, arguments); } catch (e) {} }
  function err() { try { (E && E.error ? E.error : console.error).apply(console, arguments); } catch (e) {} }

  function esc(s) { return E.escapeHtml(s); }

  function ymd(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var dd = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function hm(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var h = String(dt.getHours()).padStart(2, "0");
    var m = String(dt.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }

  function ym(d) {
    var dt = (d instanceof Date) ? d : new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }

  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function isYm(s) { return /^\d{4}-\d{2}$/.test(String(s || "").trim()); }
  function isHm(s) { return /^\d{2}:\d{2}$/.test(String(s || "").trim()); }

  function fmtMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return n.toFixed(2);
  }

  function computeTotals(entries) {
    var list = Array.isArray(entries) ? entries : [];
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      var f = Number(list[i] && list[i].fee);
      if (isFinite(f)) sum += f;
    }
    return sum;
  }

  function modalError(title, e) {
    var msg = String(e && (e.message || e.bodyText || e.bodyJson && (e.bodyJson.error || e.bodyJson.message) || e) || "");
    E.modal.show(title || "Error", "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
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
    // Primary: dedicated /paid-out API. Fallback: store inside End Of Day (paid_outs_json) if backend missing.
    if (!_poUseEodBackend) {
      try {
        var ymv = String(monthYm || "").trim();
        if (!isYm(ymv)) throw new Error("Invalid month (YYYY-MM)");
        var url = "/paid-out/entries?month=" + encodeURIComponent(ymv);
        var qq = String(q || "").trim();
        if (qq) url += "&q=" + encodeURIComponent(qq);
        url += "&_ts=" + Date.now();
        var resp = await E.apiFetch(url, { method: "GET" });
        if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to load paid out entries");
        return Array.isArray(resp.entries) ? resp.entries : [];
      } catch (e) {
        if (isHttp404(e)) {
          _poUseEodBackend = true;
          dbg("[paidout] /paid-out API missing (404) -> using EOD backend");
        } else {
          throw e;
        }
      }
    }
    return await eodListEntries(monthYm, q);
  }

  async function apiReport(from, to) {
    if (!_poUseEodBackend) {
      try {
        var f = String(from || "").trim();
        var t = String(to || "").trim();
        if (!isYmd(f) || !isYmd(t)) throw new Error("Invalid from/to (YYYY-MM-DD)");
        var url = "/paid-out/report?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t) + "&_ts=" + Date.now();
        var resp = await E.apiFetch(url, { method: "GET" });
        if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to generate report");
        return Array.isArray(resp.entries) ? resp.entries : [];
      } catch (e) {
        if (isHttp404(e)) {
          _poUseEodBackend = true;
          dbg("[paidout] /paid-out API missing (404) -> using EOD backend");
        } else {
          throw e;
        }
      }
    }
    return await eodReportEntries(from, to);
  }

  async function apiNames(q) {
    if (!_poUseEodBackend) {
      try {
        var qq = String(q || "").trim();
        var url = "/paid-out/names?q=" + encodeURIComponent(qq) + "&_ts=" + Date.now();
        var resp = await E.apiFetch(url, { method: "GET" });
        if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to load names");
        return Array.isArray(resp.names) ? resp.names : [];
      } catch (e) {
        if (isHttp404(e)) {
          _poUseEodBackend = true;
          dbg("[paidout] /paid-out API missing (404) -> using EOD backend");
        } else {
          throw e;
        }
      }
    }
    return await eodNames(q);
  }

  async function apiCreate(payload) {
    if (!_poUseEodBackend) {
      try {
        var resp = await E.apiFetch("/paid-out/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
        if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to create paid out");
        return resp.entry || null;
      } catch (e) {
        if (isHttp404(e)) {
          _poUseEodBackend = true;
          dbg("[paidout] /paid-out API missing (404) -> using EOD backend");
        } else {
          throw e;
        }
      }
    }
    return await eodCreateEntry(payload || {});
  }

  async function apiUpdate(id, payload) {
    if (!_poUseEodBackend) {
      try {
        var resp = await E.apiFetch("/paid-out/entries/" + encodeURIComponent(String(id)), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
        if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to update paid out");
        return resp.entry || null;
      } catch (e) {
        if (isHttp404(e)) {
          _poUseEodBackend = true;
          dbg("[paidout] /paid-out API missing (404) -> using EOD backend");
        } else {
          throw e;
        }
      }
    }
    return await eodUpdateEntry(id, payload || {});
  }

  async function apiDelete(id) {
    if (!_poUseEodBackend) {
      try {
        var resp = await E.apiFetch("/paid-out/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
        if (!resp || resp.ok !== true) throw new Error(resp && resp.error ? String(resp.error) : "Failed to delete paid out");
        return true;
      } catch (e) {
        if (isHttp404(e)) {
          _poUseEodBackend = true;
          dbg("[paidout] /paid-out API missing (404) -> using EOD backend");
        } else {
          throw e;
        }
      }
    }
    return await eodDeleteEntry(id);
  }

  // ---------------------------------------------------------------------------
  // Fallback backend: store Paid Out entries inside End Of Day records
  // (uses worker's end_of_day.paid_outs_json via /endofday/* or /eod/* endpoints)
  // ---------------------------------------------------------------------------

  var _poUseEodBackend = false;          // flips to true when /paid-out returns 404
  var _poIdToDate = Object.create(null); // entry id -> YYYY-MM-DD (helps update/delete when date changes)
  var _poNamesCache = null;              // [{ name, last_used }] for quick suggestions

  function isHttp404(e) {
    try {
      if (!e) return false;
      var s = Number(e.status || e.http_status || e.code || e.statusCode || 0);
      if (s === 404) return true;
      if (String(e.message || "").toLowerCase().indexOf("404") >= 0) return true;
      return false;
    } catch (_e) { return false; }
  }

  function safeClone(obj) {
    try { return JSON.parse(JSON.stringify(obj || null)); } catch (e) { return obj; }
  }

  async function eodTryFetch(paths, options) {
    var list = Array.isArray(paths) ? paths : [paths];
    var lastErr = null;
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i] || "").trim();
      if (!p) continue;
      try {
        var out = await E.apiFetch(p, options || { method: "GET" });
        // Some APIs return 200 with { ok:false } rather than throwing.
        if (out && typeof out === "object" && out.ok === false) {
          var msg = String(out.error || out.message || "API error");
          var err0 = new Error(msg);
          try { err0.status = Number(out.status || out.http_status || out.code || 400); } catch (e2) {}
          err0.api = out;
          throw err0;
        }
        return out;
      } catch (e) {
        lastErr = e;
        if (!isHttp404(e)) throw e;
      }
    }
    var err404 = lastErr || new Error("Not found");
    err404.status = 404;
    throw err404;
  }

  function eodPickCandidate(data) {
    if (!data) return null;
    if (data.record) return data.record;
    if (data.eod) return data.eod;
    if (data.item) return data.item;
    if (data.data && typeof data.data === "object") return data.data;
    if (typeof data === "object") return data;
    return null;
  }

  async function eodGetRecord(dateStr) {
    var d = String(dateStr || "").trim();
    if (!isYmd(d)) throw new Error("Invalid date (YYYY-MM-DD)");
    var base = [
      "/endofday/record?date=" + encodeURIComponent(d),
      "/endofday?date=" + encodeURIComponent(d),
      "/eod/record?date=" + encodeURIComponent(d),
      "/eod?date=" + encodeURIComponent(d)
    ];
    var data = await eodTryFetch(base, { method: "GET" });
    var cand = eodPickCandidate(data);
    // Treat { ok:true, record:null, ... } as no record
    if (!cand || (cand && cand.ok === true && !cand.date && !cand.eod_date && !cand.id)) return null;
    // Normalise
    if (!cand.date && cand.eod_date) cand.date = cand.eod_date;
    if (!cand.eod_date && cand.date) cand.eod_date = cand.date;
    if (!cand.date) cand.date = d;
    if (!cand.eod_date) cand.eod_date = d;
    return cand;
  }

  async function eodUpsertRecord(rec) {
    var body = JSON.stringify({ record: rec });
    try {
      await eodTryFetch(["/endofday/record", "/endofday", "/eod/record", "/eod"], { method: "PUT", headers: { "Content-Type": "application/json" }, body: body });
      return true;
    } catch (e) {
      if (!isHttp404(e)) throw e;
      await eodTryFetch(["/endofday/record", "/endofday", "/eod/record", "/eod"], { method: "POST", headers: { "Content-Type": "application/json" }, body: body });
      return true;
    }
  }

  async function eodListDatesForMonth(ymStr) {
    var ymv = String(ymStr || "").trim();
    if (!isYm(ymv)) throw new Error("Invalid month (YYYY-MM)");
    var base = [
      "/endofday/dates?month=" + encodeURIComponent(ymv),
      "/endofday/month?month=" + encodeURIComponent(ymv),
      "/endofday/list?month=" + encodeURIComponent(ymv),
      "/eod/dates?month=" + encodeURIComponent(ymv),
      "/eod/month?month=" + encodeURIComponent(ymv),
      "/eod/list?month=" + encodeURIComponent(ymv)
    ];
    var data = await eodTryFetch(base, { method: "GET" });
    var arr = null;
    if (data && typeof data === "object") {
      arr = data.dates || data.items || data.list || data.records || data.entries || null;
    }
    if (!Array.isArray(arr) && Array.isArray(data)) arr = data;

    var out = [];
    if (Array.isArray(arr)) {
      for (var i = 0; i < arr.length; i++) {
        var x = arr[i];
        if (typeof x === "string") {
          if (isYmd(x)) out.push(x);
        } else if (x && typeof x === "object") {
          var d = String(x.date || x.eod_date || x.day || "").trim();
          if (isYmd(d)) out.push(d);
        }
      }
    }
    out.sort();
    // Dedup
    var ded = [];
    for (var j = 0; j < out.length; j++) {
      if (!j || out[j] !== out[j - 1]) ded.push(out[j]);
    }
    return ded;
  }

  function eodEnsureEntryId(e, fallbackDate, index) {
    var id = (e && e.id != null) ? String(e.id) : "";
    if (id) return id;
    // deterministic best-effort id if backend stored without id
    var d = String((e && e.entry_date) || fallbackDate || "");
    var t = String((e && e.entry_time) || "");
    var n = String((e && e.payee_name) || "");
    var f = String((e && e.fee) || "");
    return "po_" + d + "_" + t + "_" + index + "_" + (n.slice(0, 6) || "x") + "_" + (f || "0");
  }

  function eodExtractEntriesFromRecord(rec, fallbackDate) {
    var r = rec || {};
    var list = Array.isArray(r.paid_outs) ? r.paid_outs : [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || typeof e !== "object") continue;
      // Accept only entries with our expected core fields (avoid polluting with other EOD structures)
      var payee = String(e.payee_name || e.name || "").trim();
      var fee = Number(e.fee != null ? e.fee : e.amount);
      if (!payee || !(fee > 0)) continue;

      var entry = safeClone(e) || {};
      entry.payee_name = String(entry.payee_name || entry.name || "").trim();
      entry.fee = Number(entry.fee != null ? entry.fee : entry.amount);
      entry.entry_date = String(entry.entry_date || fallbackDate || r.date || r.eod_date || "").trim();
      entry.entry_time = String(entry.entry_time || "").trim();
      entry.invoice_no = String(entry.invoice_no || "").trim();
      entry.payment_method = String(entry.payment_method || "cash").trim().toLowerCase() === "cheque" ? "cheque" : "cash";
      entry.cheque_no = String(entry.cheque_no || "").trim();
      entry.reason = String(entry.reason || "").trim();
      entry.id = eodEnsureEntryId(entry, entry.entry_date, i);

      _poIdToDate[String(entry.id)] = entry.entry_date;

      out.push(entry);
    }
    return out;
  }

  function eodFilterQuery(entries, q) {
    var qq = String(q || "").trim().toLowerCase();
    if (!qq) return entries;
    return (entries || []).filter(function (e) {
      var s =
        String(e.entry_date || "") + " " +
        String(e.entry_time || "") + " " +
        String(e.payee_name || "") + " " +
        String(e.invoice_no || "") + " " +
        String(e.cheque_no || "") + " " +
        String(e.reason || "");
      return s.toLowerCase().indexOf(qq) >= 0;
    });
  }

  async function eodListEntries(monthYm, q) {
    var ymv = String(monthYm || "").trim();
    if (!isYm(ymv)) throw new Error("Invalid month (YYYY-MM)");
    var dates = await eodListDatesForMonth(ymv);
    var all = [];
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      try {
        var rec = await eodGetRecord(d);
        if (!rec) continue;
        var items = eodExtractEntriesFromRecord(rec, d);
        for (var k = 0; k < items.length; k++) all.push(items[k]);
      } catch (e) {
        // Ignore missing records (some list endpoints may return dates without records)
        if (!isHttp404(e)) throw e;
      }
    }
    return eodFilterQuery(all, q);
  }

  function genPoId() {
    return "po_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  async function eodCreateEntry(payload) {
    var p = payload || {};
    var d = String(p.entry_date || "").trim();
    if (!isYmd(d)) throw new Error("Invalid date (YYYY-MM-DD)");
    var rec = null;
    try { rec = await eodGetRecord(d); } catch (e) { if (!isHttp404(e)) throw e; rec = null; }
    if (!rec) {
      rec = { date: d, eod_date: d, paid_outs: [] };
    } else {
      rec = safeClone(rec) || rec;
    }
    var list = Array.isArray(rec.paid_outs) ? rec.paid_outs.slice() : [];
    var entry = safeClone(p) || {};
    entry.id = genPoId();
    entry.entry_date = d;
    entry.entry_time = String(entry.entry_time || "").trim();
    entry.payee_name = String(entry.payee_name || "").trim();
    entry.fee = Number(entry.fee);
    entry.invoice_no = String(entry.invoice_no || "").trim();
    entry.payment_method = String(entry.payment_method || "cash").trim().toLowerCase() === "cheque" ? "cheque" : "cash";
    entry.cheque_no = String(entry.cheque_no || "").trim();
    if (entry.payment_method !== "cheque") entry.cheque_no = "";
    entry.reason = String(entry.reason || "").trim();

    list.push(entry);
    rec.paid_outs = list;
    rec.date = rec.date || d;
    rec.eod_date = rec.eod_date || d;

    await eodUpsertRecord(rec);
    _poIdToDate[String(entry.id)] = d;
    // update name cache
    try { eodRememberName(entry.payee_name); } catch (e2) {}

    return entry;
  }

  async function eodUpdateEntry(id, payload) {
    var pid = String(id);
    var p = payload || {};
    var newDate = String(p.entry_date || "").trim();
    if (!isYmd(newDate)) throw new Error("Invalid date (YYYY-MM-DD)");
    var oldDate = _poIdToDate[pid] || newDate;

    // Remove from old date if date changed
    if (oldDate !== newDate) {
      try {
        var oldRec = await eodGetRecord(oldDate);
        if (oldRec) {
          oldRec = safeClone(oldRec) || oldRec;
          var oldList = Array.isArray(oldRec.paid_outs) ? oldRec.paid_outs : [];
          oldRec.paid_outs = oldList.filter(function (x) { return String(x && x.id) !== pid; });
          await eodUpsertRecord(oldRec);
        }
      } catch (e) {
        if (!isHttp404(e)) throw e;
      }
    }

    var rec = null;
    try { rec = await eodGetRecord(newDate); } catch (e2) { if (!isHttp404(e2)) throw e2; rec = null; }
    if (!rec) rec = { date: newDate, eod_date: newDate, paid_outs: [] };
    rec = safeClone(rec) || rec;

    var list = Array.isArray(rec.paid_outs) ? rec.paid_outs.slice() : [];

    var updated = safeClone(p) || {};
    updated.id = pid;
    updated.entry_date = newDate;
    updated.entry_time = String(updated.entry_time || "").trim();
    updated.payee_name = String(updated.payee_name || "").trim();
    updated.fee = Number(updated.fee);
    updated.invoice_no = String(updated.invoice_no || "").trim();
    updated.payment_method = String(updated.payment_method || "cash").trim().toLowerCase() === "cheque" ? "cheque" : "cash";
    updated.cheque_no = String(updated.cheque_no || "").trim();
    if (updated.payment_method !== "cheque") updated.cheque_no = "";
    updated.reason = String(updated.reason || "").trim();

    // replace
    var replaced = false;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i] && list[i].id) === pid) {
        list[i] = updated;
        replaced = true;
        break;
      }
    }
    if (!replaced) list.push(updated);

    rec.paid_outs = list;
    rec.date = rec.date || newDate;
    rec.eod_date = rec.eod_date || newDate;

    await eodUpsertRecord(rec);
    _poIdToDate[pid] = newDate;
    try { eodRememberName(updated.payee_name); } catch (e3) {}
    return updated;
  }

  async function eodDeleteEntry(id) {
    var pid = String(id);
    var d = _poIdToDate[pid] || "";
    if (!d) {
      // best-effort: search current month cache not available here -> fail loudly
      throw new Error("Not found");
    }
    var rec = await eodGetRecord(d);
    if (!rec) throw new Error("Not found");
    rec = safeClone(rec) || rec;
    var list = Array.isArray(rec.paid_outs) ? rec.paid_outs : [];
    var before = list.length;
    rec.paid_outs = list.filter(function (x) { return String(x && x.id) !== pid; });
    if (rec.paid_outs.length === before) throw new Error("Not found");
    await eodUpsertRecord(rec);
    try { delete _poIdToDate[pid]; } catch (e) {}
    return true;
  }

  function ymFromYmd(d) { return String(d || "").slice(0, 7); }

  function monthsBetween(fromYmd, toYmd) {
    var f = String(fromYmd || "").trim();
    var t = String(toYmd || "").trim();
    if (!isYmd(f) || !isYmd(t)) return [];
    var fy = parseInt(f.slice(0, 4), 10), fm = parseInt(f.slice(5, 7), 10);
    var ty = parseInt(t.slice(0, 4), 10), tm = parseInt(t.slice(5, 7), 10);
    var out = [];
    var y = fy, m = fm;
    for (var guard = 0; guard < 240; guard++) {
      out.push(String(y) + "-" + String(m).padStart(2, "0"));
      if (y === ty && m === tm) break;
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  async function eodReportEntries(from, to) {
    var f = String(from || "").trim();
    var t = String(to || "").trim();
    if (!isYmd(f) || !isYmd(t)) throw new Error("Invalid from/to (YYYY-MM-DD)");
    var months = monthsBetween(f, t);
    var out = [];
    for (var i = 0; i < months.length; i++) {
      var m = months[i];
      var list = await eodListEntries(m, "");
      for (var k = 0; k < list.length; k++) {
        var e = list[k];
        var d = String(e.entry_date || "");
        if (d >= f && d <= t) out.push(e);
      }
    }
    return out;
  }

  function loadNamesCache() {
    if (_poNamesCache) return _poNamesCache;
    try {
      var raw = window.localStorage.getItem("eikon_paidout_names_v1") || "[]";
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) _poNamesCache = arr;
    } catch (e) {}
    if (!_poNamesCache) _poNamesCache = [];
    return _poNamesCache;
  }

  function saveNamesCache() {
    try { window.localStorage.setItem("eikon_paidout_names_v1", JSON.stringify(_poNamesCache || [])); } catch (e) {}
  }

  function eodRememberName(name) {
    var n = String(name || "").trim();
    if (!n) return;
    var cache = loadNamesCache();
    var now = Date.now();
    for (var i = 0; i < cache.length; i++) {
      if (String(cache[i] && cache[i].name || "") === n) {
        cache[i].last_used = now;
        saveNamesCache();
        return;
      }
    }
    cache.push({ name: n, last_used: now });
    // keep small
    cache.sort(function (a, b) { return Number(b.last_used || 0) - Number(a.last_used || 0); });
    if (cache.length > 250) cache.length = 250;
    saveNamesCache();
  }

  async function eodNames(q) {
    var qq = String(q || "").trim().toLowerCase();
    var cache = loadNamesCache().slice();
    var out = [];
    for (var i = 0; i < cache.length; i++) {
      var n = String(cache[i] && cache[i].name || "").trim();
      if (!n) continue;
      if (!qq || n.toLowerCase().indexOf(qq) >= 0) out.push(n);
      if (out.length >= 25) break;
    }
    // If cache empty, warm it from current month (best-effort)
    if (out.length < 8) {
      try {
        var curYm = ym(new Date());
        var entries = await eodListEntries(curYm, qq);
        var seen = new Set(out.map(function (x) { return x.toLowerCase(); }));
        for (var k = 0; k < entries.length; k++) {
          var nn = String(entries[k] && entries[k].payee_name || "").trim();
          if (!nn) continue;
          var key = nn.toLowerCase();
          if (seen.has(key)) continue;
          if (qq && key.indexOf(qq) < 0) continue;
          out.push(nn);
          seen.add(key);
          eodRememberName(nn);
          if (out.length >= 25) break;
        }
      } catch (e2) {}
    }
    return out;
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

  function buildReportBodyHtml(ctx, entries, title, subtitle) {
    var user = (ctx && ctx.user) ? ctx.user : (E.state ? E.state.user : null);
    var org = user && user.org_name ? user.org_name : "Pharmacy";
    var loc = user && user.location_name ? user.location_name : "";

    var list = Array.isArray(entries) ? entries : [];
    var grouped = groupByName(list);
    var names = Array.from(grouped.keys()).sort(function (a, b) { return a.localeCompare(b); });

    var total = computeTotals(list);

    var html = "";
    html += "<div style='display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;'>";
    html += "  <div>";
    html += "    <div style='font-weight:1000;font-size:18px;'>" + esc(org) + (loc ? " — " + esc(loc) : "") + "</div>";
    html += "    <div style='opacity:.82;font-weight:900;margin-top:4px;'>" + esc(title || "Paid Out Report") + "</div>";
    if (subtitle) html += "    <div style='opacity:.72;font-weight:900;margin-top:4px;font-size:12px;'>" + esc(subtitle) + "</div>";
    html += "  </div>";
    html += "  <div style='text-align:right;'>";
    html += "    <div class='po-total'>Total: " + esc(fmtMoney(total)) + "</div>";
    html += "    <div style='opacity:.72;font-weight:900;font-size:12px;margin-top:4px;'>Items: " + esc(String(list.length)) + "</div>";
    html += "  </div>";
    html += "</div>";

    html += "<div class='po-report-wrap'>";
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var g = sortEntriesForGroup(grouped.get(name) || []);
      var subtotal = computeTotals(g);

      html += "<div class='po-report-group'>";
      html += "  <div class='po-report-head'><div class='name'>" + esc(name) + "</div><div class='meta'>Items: " + esc(String(g.length)) + " • Subtotal: " + esc(fmtMoney(subtotal)) + "</div></div>";
      html += "  <div style='overflow:auto'>";
      html += "    <table class='po-report-table'>";
      html += "      <thead><tr>";
      html += "        <th style='min-width:110px;'>Date</th>";
      html += "        <th style='min-width:70px;'>Time</th>";
      html += "        <th style='min-width:120px;'>Amount</th>";
      html += "        <th style='min-width:110px;'>Method</th>";
      html += "        <th style='min-width:120px;'>Invoice</th>";
      html += "        <th style='min-width:120px;'>Cheque</th>";
      html += "        <th style='min-width:300px;'>Reason</th>";
      html += "      </tr></thead>";
      html += "      <tbody>";
      for (var k = 0; k < g.length; k++) {
        var e = g[k] || {};
        var m = String(e.payment_method || "").toLowerCase() === "cheque" ? "Cheque" : "Cash";
        html += "        <tr>";
        html += "          <td>" + esc(e.entry_date || "") + "</td>";
        html += "          <td>" + esc(e.entry_time || "") + "</td>";
        html += "          <td class='po-total'>" + esc(fmtMoney(e.fee)) + "</td>";
        html += "          <td>" + esc(m) + "</td>";
        html += "          <td>" + esc(e.invoice_no || "") + "</td>";
        html += "          <td>" + esc(e.cheque_no || "") + "</td>";
        html += "          <td style='white-space:pre-wrap'>" + esc(e.reason || "") + "</td>";
        html += "        </tr>";
      }
      html += "      </tbody>";
      html += "    </table>";
      html += "  </div>";
      html += "  <div class='po-report-foot'><div class='big'>Subtotal</div><div class='po-total'>" + esc(fmtMoney(subtotal)) + "</div></div>";
      html += "</div>";
    }
    html += "</div>";

    return html;
  }

  function buildPrintDocHtml(bodyHtml, title) {
    function esc2(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&", "<": "<", ">": ">", '"': "\"", "'": "'" })[c]; }); }
    return (
      "<!doctype html><html><head><meta charset='utf-8' />" +
      "<meta name='viewport' content='width=device-width,initial-scale=1' />" +
      "<title>" + esc2(title || "Print") + "</title>" +
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

  function openPrintTabWithHtml(html) {
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }
    if (!w) {
      try {
        var a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e2) {}
    }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
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
    var end = new Date(Date.UTC(y, mo, 0));
    var from = ymd(new Date(start));
    var to = ymd(new Date(end));
    return { from: from, to: to };
  }

  function buildEntryModalBodyHtml(mode, entry) {
    var e = entry || {};
    var date = String(e.entry_date || ymd(new Date()));
    var time = String(e.entry_time || hm(new Date()));
    var name = String(e.payee_name || "");
    var fee = (e.fee != null && e.fee !== "") ? String(e.fee) : "";
    var inv = String(e.invoice_no || "");
    var pm = String(e.payment_method || "cash").toLowerCase();
    var chq = String(e.cheque_no || "");
    var reason = String(e.reason || "");

    return (
      "<div class='eikon-row' style='align-items:flex-end;'>" +
      "  <div class='eikon-field'><div class='eikon-label'>Date</div><input class='eikon-input' id='po-f-date' type='date' value='" + esc(date) + "' /></div>" +
      "  <div class='eikon-field'><div class='eikon-label'>Time</div><input class='eikon-input' id='po-f-time' type='time' value='" + esc(time) + "' /></div>" +
      "  <div class='eikon-field' style='position:relative;flex:1;min-width:220px;'>" +
      "    <div class='eikon-label'>Paid To (name)</div>" +
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
        var empty = document.createElement("div");
        empty.className = "po-suggestempty";
        empty.textContent = "No suggestions";
        suggestBox.appendChild(empty);
        suggestBox.style.display = "block";
        return;
      }

      for (var i = 0; i < suggestResults.length; i++) {
        (function (name) {
          var it = document.createElement("div");
          it.className = "po-suggestitem";
          it.innerHTML = "<span>" + esc(name) + "</span>";
          it.onclick = function () {
            if (elName) elName.value = name;
            suggestBox.style.display = "none";
            try { elName && elName.focus(); } catch (e) {}
          };
          suggestBox.appendChild(it);
        })(suggestResults[i]);
      }

      suggestBox.style.display = "block";
    }

    function hideSuggestSoon() {
      if (!suggestBox) return;
      if (suggestHideTimer) clearTimeout(suggestHideTimer);
      suggestHideTimer = setTimeout(function () {
        try { suggestBox.style.display = "none"; } catch (e) {}
      }, 180);
    }

    async function doSuggest() {
      var q = String(elName && elName.value || "").trim();
      if (!q) {
        suggestResults = [];
        if (suggestBox) suggestBox.style.display = "none";
        return;
      }

      var seq = ++suggestSeq;
      try {
        var names = await apiNames(q);
        if (seq !== suggestSeq) return;
        suggestResults = Array.isArray(names) ? names : [];
        if (!suggestResults.length) {
          if (suggestBox) suggestBox.style.display = "none";
          return;
        }
        renderSuggest();
      } catch (e) {
        if (seq !== suggestSeq) return;
        suggestResults = [];
        if (suggestBox) suggestBox.style.display = "none";
      }
    }

    if (elMethod) elMethod.onchange = function () { setChequeVisibility(); };
    setChequeVisibility();

    if (elName) {
      elName.oninput = function () { doSuggest(); };
      elName.onfocus = function () { doSuggest(); };
      elName.onblur = function () { hideSuggestSoon(); };
    }
    if (suggestBox) {
      suggestBox.onmousedown = function () { if (suggestHideTimer) clearTimeout(suggestHideTimer); };
      suggestBox.onmouseleave = function () { hideSuggestSoon(); };
    }

    async function doSave(printAfter) {
      try {
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
        if (!norm.ok) { setFormMsg("err", norm.error); return; }

        setFormMsg("", "Saving…");

        var saved = null;
        if (mode === "edit") {
          saved = await apiUpdate(entry.id, norm.payload);
        } else {
          saved = await apiCreate(norm.payload);
        }
        if (!saved) throw new Error("Save failed");

        E.modal.hide();
        if (printAfter) printReceipt(ctx, saved);
        if (typeof onSaved === "function") onSaved(saved);
      } catch (e) {
        setFormMsg("err", String(e && (e.message || e.bodyText || e) || "Save failed"));
      }
    }

    try { elName && elName.focus(); } catch (e) {}
  }

  async function render(ctx) {
    ensurePaidOutStyles();

    var mount = ctx.mount;
    mount.innerHTML =
      "<div class='eikon-card'>" +
      "  <div style='display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;'>" +
      "    <div>" +
      "      <div style='font-weight:1000;font-size:16px;'>Paid Out</div>" +
      "      <div class='muted' style='font-size:12px;font-weight:800;opacity:.85;margin-top:4px;'>Record supplier / cash payments (receipt + report)</div>" +
      "    </div>" +
      "    <div style='display:flex;gap:8px;flex-wrap:wrap;align-items:center;'>" +
      "      <button class='eikon-btn' id='po-new'>New Paid Out</button>" +
      "      <button class='eikon-btn' id='po-print-month'>Print Month</button>" +
      "    </div>" +
      "  </div>" +

      "  <div class='eikon-row' style='margin-top:12px;align-items:flex-end;'>" +
      "    <div class='eikon-field'><div class='eikon-label'>Month</div><input class='eikon-input' id='po-month' type='month' value='" + esc(ym(new Date())) + "' /></div>" +
      "    <div class='eikon-field' style='flex:1;min-width:220px;'><div class='eikon-label'>Search</div><input class='eikon-input' id='po-q' placeholder='Name, invoice, reason…' /></div>" +
      "    <div style='display:flex;gap:8px;flex-wrap:wrap;'>" +
      "      <button class='eikon-btn' id='po-refresh'>Refresh</button>" +
      "    </div>" +
      "  </div>" +
      "  <div class='eikon-help' id='po-msg' style='margin-top:8px;'></div>" +

      "  <div style='margin-top:12px;overflow:auto;border:1px solid var(--border);border-radius:16px;background:rgba(255,255,255,.02);'>" +
      "    <table style='width:100%;border-collapse:collapse;min-width:980px;'>" +
      "      <thead>" +
      "        <tr style='text-align:left;'>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Date</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Time</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Paid To</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Fee</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Method</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Invoice</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Cheque</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Reason</th>" +
      "          <th style='padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.2px;'>Actions</th>" +
      "        </tr>" +
      "      </thead>" +
      "      <tbody id='po-tbody'></tbody>" +
      "    </table>" +
      "  </div>" +

      "  <div id='po-summary' style='margin-top:10px;font-weight:900;'></div>" +
      "</div>" +

      "<div class='eikon-card' style='margin-top:12px;'>" +
      "  <div style='display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;'>" +
      "    <div>" +
      "      <div style='font-weight:1000;font-size:16px;'>Report</div>" +
      "      <div class='muted' style='font-size:12px;font-weight:800;opacity:.85;margin-top:4px;'>Generate a date-range report and print it.</div>" +
      "    </div>" +
      "    <div style='display:flex;gap:8px;flex-wrap:wrap;align-items:center;'>" +
      "      <button class='eikon-btn' id='po-run'>Generate</button>" +
      "      <button class='eikon-btn' id='po-print-report'>Print</button>" +
      "    </div>" +
      "  </div>" +

      "  <div class='eikon-row' style='margin-top:12px;align-items:flex-end;'>" +
      "    <div class='eikon-field'><div class='eikon-label'>From</div><input class='eikon-input' id='po-from' type='date' /></div>" +
      "    <div class='eikon-field'><div class='eikon-label'>To</div><input class='eikon-input' id='po-to' type='date' /></div>" +
      "  </div>" +
      "  <div class='eikon-help' id='po-rmsg' style='margin-top:8px;'></div>" +
      "  <div id='po-report-preview' style='margin-top:10px;'></div>" +
      "</div>";

    var state = {
      month: ym(new Date()),
      q: "",
      entries: [],
      report: [],
      reportMeta: null
    };

    var monthEl = mount.querySelector("#po-month");
    var qEl = mount.querySelector("#po-q");
    var btnRefresh = mount.querySelector("#po-refresh");
    var btnNew = mount.querySelector("#po-new");
    var btnPrintMonth = mount.querySelector("#po-print-month");
    var msgEl = mount.querySelector("#po-msg");
    var summaryEl = mount.querySelector("#po-summary");
    var tbody = mount.querySelector("#po-tbody");

    var fromEl = mount.querySelector("#po-from");
    var toEl = mount.querySelector("#po-to");
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
        err("[paidout] refresh failed:", e);
        setMsg("err", String(e && (e.message || e.bodyText || e) || "Failed to load"));
      }
    }

    async function runReport() {
      setRmsg("", "");
      var f = String(fromEl && fromEl.value || "").trim();
      var t = String(toEl && toEl.value || "").trim();
      if (!isYmd(f) || !isYmd(t)) { setRmsg("err", "Pick From/To dates."); return; }
      if (t < f) { setRmsg("err", "To cannot be before From."); return; }

      try {
        setRmsg("", "Generating…");
        var entries = await apiReport(f, t);
        state.report = entries || [];
        state.reportMeta = {
          title: "Paid Out Report",
          subtitle: "From " + f + " to " + t
        };
        if (reportPreview) {
          var html = "<div class='po-report-summary'><div><div class='k'>Items</div><div class='v'>" + esc(String(state.report.length)) + "</div></div>" +
            "<div><div class='k'>Total</div><div class='v'>" + esc(fmtMoney(computeTotals(state.report))) + "</div></div></div>";
          reportPreview.innerHTML = html;
        }
        setRmsg("", "");
      } catch (e) {
        setRmsg("err", String(e && (e.message || e.bodyText || e) || "Report failed"));
      }
    }

    if (monthEl) monthEl.onchange = function () { refresh(); };
    if (btnRefresh) btnRefresh.onclick = function () { refresh(); };
    if (btnNew) btnNew.onclick = function () {
      openEntryModal(ctx, "new", null, function (saved) {
        if (!saved) return;
        state.entries.unshift(saved);
        renderRows();
        renderSummary();
      });
    };

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

    // Set default report range to current month
    try {
      var r = monthRange(state.month);
      if (r) {
        if (fromEl) fromEl.value = r.from;
        if (toEl) toEl.value = r.to;
      }
    } catch (e) {}

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
