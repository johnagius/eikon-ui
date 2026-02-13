/* ui/modules.endofday.js
   Eikon - End Of Day module (UI)

   Persistence:
   - Prefers EOD API endpoints via E.apiFetch() (server persistence across browsers)
   - Falls back to localStorage only if endpoints are not present (404)

   Includes:
   - X Readings (4), EPOS (4), Cheques (add/remove), Paid Outs (add/remove)
   - Cash count + BOV Deposit + Contact management (name/phone/email)
   - Save, Lock, Unlock (master key), Audit log (module-level), Monthly summary, Range report
   - Print A4, Copy summary, Email summary
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // -----------------------------
  // Helpers
  // -----------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") node.className = String(v || "");
      else if (k === "text") node.textContent = String(v == null ? "" : v);
      else if (k === "html") node.innerHTML = String(v == null ? "" : v);
      else if (k === "value") node.value = String(v == null ? "" : v);
      else if (k === "type") node.type = String(v || "");
      else if (k === "placeholder") node.placeholder = String(v || "");
      else if (k === "disabled") node.disabled = !!v;
      else if (k === "style") node.setAttribute("style", String(v || ""));
      else node.setAttribute(k, String(v));
    });
    if (Array.isArray(children)) {
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function ymd(d) {
    var dt = d ? new Date(d) : new Date();
    var yyyy = dt.getFullYear();
    var mm = String(dt.getMonth() + 1).padStart(2, "0");
    var dd = String(dt.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }

  function ddmmyyyy(ymdStr) {
    var s = String(ymdStr || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
  }

  function ymFromYmd(ymdStr) {
    var s = String(ymdStr || "");
    return s.slice(0, 7);
  }

  function euro(n) {
    var v = Number(n || 0);
    return "€" + v.toFixed(2);
  }

  function parseNum(v) {
    var x = Number(String(v == null ? "" : v).trim());
    return Number.isFinite(x) ? x : 0;
  }

  function roundToNearest5(n) {
    return Math.round(Number(n || 0) / 5) * 5;
  }

  function toast(title, msg) {
    window.alert((title ? title + "\n\n" : "") + (msg || ""));
  }

  function openPrintTabWithHtml(html) {
    var blob = new Blob([String(html || "")], { type: "text/html" });
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
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
  }

  async function copyToClipboard(text) {
    var t = String(text || "");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch (e) {}
    // fallback
    try {
      var ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return !!ok;
    } catch (e2) { return false; }
  }

  function safeJsonParse(raw, fallback) {
    try {
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // -----------------------------
  // Modal (self-contained, reliable)
  // -----------------------------
  function showModal(title, bodyNode, actions) {
    var overlay = el("div", {
      class: "eikon-modal-overlay",
      style: "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;"
    });
    var box = el("div", {
      class: "eikon-modal",
      style: "width:min(900px,100%);max-height:90vh;overflow:auto;background:#0f1420;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,.5);padding:14px;"
    });

    var head = el("div", { style: "display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px;" }, [
      el("div", { style: "font-weight:900;font-size:16px;color:#e9eef7;", text: title || "Dialog" }),
      el("button", { class: "eikon-btn", text: "Close" })
    ]);
    head.querySelector("button").onclick = function () { try { overlay.remove(); } catch (e) {} };

    var bodyWrap = el("div", { style: "padding:6px 2px;" }, [bodyNode]);

    var foot = el("div", { style: "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px;" });
    (actions || []).forEach(function (a) {
      var b = el("button", { class: "eikon-btn " + (a.primary ? "primary" : ""), text: a.text || "OK" });
      b.onclick = function () {
        if (a.onClick) a.onClick(function close() { try { overlay.remove(); } catch (e) {} });
      };
      foot.appendChild(b);
    });

    box.appendChild(head);
    box.appendChild(bodyWrap);
    if ((actions || []).length) box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  // -----------------------------
  // Local fallback storage
  // -----------------------------
  var LS_EOD_KEY = "eikon_eod_records_v1";
  var LS_EOD_CONTACTS_KEY = "eikon_eod_contacts_v1";
  var LS_EOD_AUDIT_KEY = "eikon_eod_audit_v1";

  function loadAllEodsLocal() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_KEY) || "[]";
      var arr = safeJsonParse(raw, []);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveAllEodsLocal(arr) {
    try { window.localStorage.setItem(LS_EOD_KEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function getEodByDateAndLocLocal(dateStr, locationName) {
    var all = loadAllEodsLocal();
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (r && r.date === dateStr && r.location_name === locationName) return r;
    }
    return null;
  }

  function upsertEodLocal(rec) {
    var all = loadAllEodsLocal();
    var replaced = false;
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].date === rec.date && all[i].location_name === rec.location_name) {
        all[i] = rec;
        replaced = true;
        break;
      }
    }
    if (!replaced) all.push(rec);
    all.sort(function (a, b) {
      var ad = (a && a.date) || "";
      var bd = (b && b.date) || "";
      if (ad < bd) return 1;
      if (ad > bd) return -1;
      return 0;
    });
    saveAllEodsLocal(all);
  }

  function loadContactsLocal() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_CONTACTS_KEY) || "";
      if (!raw) return [];
      var arr = safeJsonParse(raw, []);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveContactsLocal(arr) {
    try { window.localStorage.setItem(LS_EOD_CONTACTS_KEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function loadAuditLocal() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_AUDIT_KEY) || "[]";
      var arr = safeJsonParse(raw, []);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function writeAuditLocal(entry) {
    var all = loadAuditLocal();
    all.push(entry);
    try { window.localStorage.setItem(LS_EOD_AUDIT_KEY, JSON.stringify(all)); } catch (e) {}
  }

  function auditForLocal(dateStr, locationName) {
    var all = loadAuditLocal();
    return all.filter(function (a) {
      return a && a.date === dateStr && a.location_name === locationName;
    }).sort(function (x, y) {
      var xt = (x && x.ts) || "";
      var yt = (y && y.ts) || "";
      if (xt < yt) return 1;
      if (xt > yt) return -1;
      return 0;
    });
  }

  function clearLocalEodAll() {
    try { window.localStorage.removeItem(LS_EOD_KEY); } catch (e) {}
    try { window.localStorage.removeItem(LS_EOD_CONTACTS_KEY); } catch (e2) {}
    try { window.localStorage.removeItem(LS_EOD_AUDIT_KEY); } catch (e3) {}
  }

  // -----------------------------
  // API persistence (preferred)
  // We try multiple endpoint shapes to match your Worker without requiring edits.
  // If all attempts return 404, we fall back to localStorage.
  // -----------------------------
  var _apiMode = { ok: false, lastCheckedAt: "", reason: "" };

  function is404(err) {
    try { return err && Number(err.status) === 404; } catch (e) { return false; }
  }

  async function apiTryFetch(paths, options) {
    var lastErr = null;
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      try {
        var out = await E.apiFetch(p, options || { method: "GET" });
        return { ok: true, path: p, data: out };
      } catch (e) {
        lastErr = e;
        if (!is404(e)) {
          // non-404 means endpoint exists but error; bubble up
          throw e;
        }
      }
    }
    // all 404
    var err404 = lastErr || new Error("Not found");
    err404.status = 404;
    throw err404;
  }

  async function apiCheckAvailable() {
    // lightweight: try GET record for today with a known endpoint pattern
    var d = ymd(new Date());
    try {
      await apiTryFetch([
        "/endofday/record?date=" + encodeURIComponent(d),
        "/endofday?date=" + encodeURIComponent(d),
        "/eod/record?date=" + encodeURIComponent(d),
        "/eod?date=" + encodeURIComponent(d)
      ], { method: "GET" });

      _apiMode.ok = true;
      _apiMode.lastCheckedAt = nowIso();
      _apiMode.reason = "EOD API reachable";
      return true;
    } catch (e) {
      if (is404(e)) {
        _apiMode.ok = false;
        _apiMode.lastCheckedAt = nowIso();
        _apiMode.reason = "EOD API endpoints not found (404) -> using localStorage";
        return false;
      }
      // network/500: treat as not available for now (still allow local fallback)
      _apiMode.ok = false;
      _apiMode.lastCheckedAt = nowIso();
      _apiMode.reason = "EOD API error -> local fallback (" + String(e && (e.message || e)) + ")";
      return false;
    }
  }

  async function apiGetRecord(dateStr) {
    var r = await apiTryFetch([
      "/endofday/record?date=" + encodeURIComponent(dateStr),
      "/endofday?date=" + encodeURIComponent(dateStr),
      "/eod/record?date=" + encodeURIComponent(dateStr),
      "/eod?date=" + encodeURIComponent(dateStr)
    ], { method: "GET" });
    // Expect {ok:true, record:{...}} or {ok:true, eod:{...}} or direct record
    var data = r.data;
    if (!data) return null;
    if (data.record) return data.record;
    if (data.eod) return data.eod;
    if (data.item) return data.item;
    if (data.ok === true && data.data && typeof data.data === "object") return data.data;
    if (typeof data === "object") return data;
    return null;
  }

  async function apiUpsertRecord(rec) {
    var body = JSON.stringify({ record: rec });
    // try PUT first, then POST
    try {
      await apiTryFetch([
        "/endofday/record",
        "/endofday",
        "/eod/record",
        "/eod"
      ], { method: "PUT", headers: { "Content-Type": "application/json" }, body: body });
      return true;
    } catch (e) {
      if (!is404(e)) throw e;
      await apiTryFetch([
        "/endofday/record",
        "/endofday",
        "/eod/record",
        "/eod"
      ], { method: "POST", headers: { "Content-Type": "application/json" }, body: body });
      return true;
    }
  }

  async function apiListDatesForMonth(locationName, ym) {
    // Best case: an endpoint returns dates list for month.
    // If not found, we’ll fall back to scanning days and calling apiGetRecord().
    var r = await apiTryFetch([
      "/endofday/dates?month=" + encodeURIComponent(ym),
      "/endofday/month?month=" + encodeURIComponent(ym),
      "/endofday/list?month=" + encodeURIComponent(ym),
      "/eod/dates?month=" + encodeURIComponent(ym),
      "/eod/month?month=" + encodeURIComponent(ym),
      "/eod/list?month=" + encodeURIComponent(ym)
    ], { method: "GET" });

    var data = r.data || {};
    var dates = data.dates || data.items || data.list || data.records || null;
    if (Array.isArray(dates)) {
      return dates.map(function (x) {
        if (typeof x === "string") return x;
        if (x && x.date) return x.date;
        if (x && x.eod_date) return x.eod_date;
        return null;
      }).filter(Boolean).sort();
    }
    return [];
  }

  async function apiGetContacts() {
    var r = await apiTryFetch([
      "/endofday/contacts",
      "/eod/contacts",
      "/endofday/contact",
      "/eod/contact"
    ], { method: "GET" });

    var data = r.data || {};
    var items = data.contacts || data.items || data.list || data.data || null;
    if (Array.isArray(items)) return items;
    if (Array.isArray(data)) return data;
    return [];
  }

  async function apiSaveContacts(list) {
    var body = JSON.stringify({ contacts: list });
    try {
      await apiTryFetch([
        "/endofday/contacts",
        "/eod/contacts"
      ], { method: "PUT", headers: { "Content-Type": "application/json" }, body: body });
      return true;
    } catch (e) {
      if (!is404(e)) throw e;
      await apiTryFetch([
        "/endofday/contacts",
        "/eod/contacts"
      ], { method: "POST", headers: { "Content-Type": "application/json" }, body: body });
      return true;
    }
  }

  // -----------------------------
  // Unified data access
  // -----------------------------
  async function getEodByDateAndLoc(dateStr, locationName) {
    if (_apiMode.ok) {
      try {
        var rec = await apiGetRecord(dateStr);
        if (rec) return rec;
        return null;
      } catch (e) {
        // API failed unexpectedly -> fallback local for this action
        return getEodByDateAndLocLocal(dateStr, locationName);
      }
    }
    return getEodByDateAndLocLocal(dateStr, locationName);
  }

  async function upsertEod(rec) {
    if (_apiMode.ok) {
      try {
        await apiUpsertRecord(rec);
        return;
      } catch (e) {
        // fallback local
        upsertEodLocal(rec);
        return;
      }
    }
    upsertEodLocal(rec);
  }

  async function loadContacts(locationName) {
    if (_apiMode.ok) {
      try {
        var c = await apiGetContacts();
        // normalize to {id,name,phone,email}
        return (c || []).map(function (x) {
          return {
            id: x.id != null ? String(x.id) : ("c_" + Math.random().toString(16).slice(2) + "_" + Date.now()),
            name: String(x.name || x.display_name || x.title || "").trim(),
            phone: String(x.phone || "").trim(),
            email: String(x.email || "").trim()
          };
        }).filter(function (x) { return !!x.name; });
      } catch (e) {
        return loadContactsLocal();
      }
    }
    return loadContactsLocal();
  }

  async function saveContacts(locationName, arr) {
    if (_apiMode.ok) {
      try {
        await apiSaveContacts(arr || []);
        return;
      } catch (e) {
        // fallback local
        saveContactsLocal(arr || []);
        return;
      }
    }
    saveContactsLocal(arr || []);
  }

  async function writeAudit(locationName, dateStr, entry) {
    // module-level audit (kept for now; server likely has its own audit_log too)
    // If you later expose an endpoint for audit_log, we can switch this to server.
    writeAuditLocal(entry);
  }

  async function auditFor(locationName, dateStr) {
    return auditForLocal(dateStr, locationName);
  }

  async function listDatesForMonth(locationName, ym) {
    if (_apiMode.ok) {
      try {
        var dates = await apiListDatesForMonth(locationName, ym);
        if (dates && dates.length) return dates;
      } catch (e) {
        // ignore; will fall back to scan
      }
      // fallback: scan days 1..31 and check existence
      var out = [];
      for (var d = 1; d <= 31; d++) {
        var ds = ym + "-" + String(d).padStart(2, "0");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
        try {
          var r = await apiGetRecord(ds);
          if (r && r.date) out.push(r.date);
          else if (r) out.push(ds);
        } catch (e2) {}
      }
      return out.sort();
    }
    // local
    var all = loadAllEodsLocal();
    return all.filter(function (r) {
      return r && r.location_name === locationName && ymFromYmd(r.date) === ym;
    }).map(function (r) { return r.date; }).sort();
  }

  // -----------------------------
  // Calculations
  // -----------------------------
  function totalX(state) { return state.x.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }
  function totalEpos(state) { return state.epos.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }
  function totalCheques(state) { return state.cheques.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }
  function totalPaidOuts(state) { return state.paid_outs.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }

  function expectedDeposit(state) {
    return totalX(state) - totalEpos(state) - totalCheques(state) - totalPaidOuts(state);
  }

  function countedCashTill(state) {
    var c = state.cash || {};
    var notes =
      500 * parseNum(c.n500) +
      200 * parseNum(c.n200) +
      100 * parseNum(c.n100) +
       50 * parseNum(c.n50)  +
       20 * parseNum(c.n20)  +
       10 * parseNum(c.n10)  +
        5 * parseNum(c.n5);
    var coins = parseNum(c.coins_total);
    return { notes: notes, coins: coins, total: notes + coins };
  }

  function totalCashE(state) {
    var till = countedCashTill(state).total;
    var fl = parseNum(state.float_amount);
    var e = till - fl;
    return e < 0 ? 0 : e;
  }

  function roundedDepositF(state) {
    return roundToNearest5(totalCashE(state));
  }

  function overUnder(state) {
    return totalCashE(state) - expectedDeposit(state);
  }

  function coinsDiff(state) {
    return totalCashE(state) - roundedDepositF(state);
  }

  function bovTotal(state) {
    var d = state.deposit || {};
    return 500 * parseNum(d.n500) +
           200 * parseNum(d.n200) +
           100 * parseNum(d.n100) +
            50 * parseNum(d.n50)  +
            20 * parseNum(d.n20)  +
            10 * parseNum(d.n10);
  }

  async function monthSummary(state, monthYm) {
    var loc = state.location_name;
    var m = monthYm || ymFromYmd(state.date);
    var dates = await listDatesForMonth(loc, m);

    var sumE = 0, sumOU = 0, sumCoins = 0;
    for (var i = 0; i < dates.length; i++) {
      var r = await getEodByDateAndLoc(dates[i], loc);
      if (!r) continue;

      var notes =
        500 * parseNum(r.cash.n500) +
        200 * parseNum(r.cash.n200) +
        100 * parseNum(r.cash.n100) +
         50 * parseNum(r.cash.n50)  +
         20 * parseNum(r.cash.n20)  +
         10 * parseNum(r.cash.n10)  +
          5 * parseNum(r.cash.n5);
      var till = notes + parseNum(r.cash.coins_total);
      var fl = parseNum(r.float_amount);
      var E2 = till - fl;
      if (E2 < 0) E2 = 0;

      var X2 = (r.x || []).reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var B2 = (r.epos || []).reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var C2 = (r.cheques || []).reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var D2 = (r.paid_outs || []).reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var exp = X2 - B2 - C2 - D2;

      var F2 = roundToNearest5(E2);
      sumE += E2;
      sumOU += (E2 - exp);
      sumCoins += (E2 - F2);
    }

    return {
      days: dates.length,
      total_cash_month: sumE,
      over_under_month: sumOU,
      coin_box_month: sumCoins
    };
  }

  // -----------------------------
  // Printing
  // -----------------------------
  function buildA4HtmlForCurrent(state) {
    var d = state.date;
    var staff = String(state.staff || "");
    var loc = String(state.location_name || "");

    var Avals = state.x.map(function (r) { return parseNum(r.amount); });
    var Arem = state.x.map(function (r) { return String(r.remark || ""); });
    var Atot = totalX(state);

    var Bvals = state.epos.map(function (r) { return parseNum(r.amount); });
    var Btot = totalEpos(state);

    var Crows = state.cheques.slice(0, 4);
    while (Crows.length < 4) Crows.push({ amount: 0, remark: "" });
    var Cvals = Crows.map(function (r) { return parseNum(r.amount); });
    var Crem = Crows.map(function (r) { return String(r.remark || ""); });
    var Ctot = totalCheques(state);

    var Drows = state.paid_outs.slice(0, 8);
    while (Drows.length < 8) Drows.push({ amount: 0, remark: "" });
    var Dvals = Drows.map(function (r) { return parseNum(r.amount); });
    var Drem = Drows.map(function (r) { return String(r.remark || ""); });
    var Dtot = totalPaidOuts(state);

    var counted = countedCashTill(state);
    var Etotal = totalCashE(state);
    var Ftotal = roundedDepositF(state);
    var OU = overUnder(state);
    var COINS = coinsDiff(state);
    var fl = parseNum(state.float_amount);

    function fmt(n) {
      return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function row(lbl, val, note) {
      return "<tr>" +
        "<td class='l'>" + esc(lbl) + "</td>" +
        "<td class='c'>€</td>" +
        "<td class='r'>" + esc(fmt(val)) + "</td>" +
        "<td class='note'>" + (note ? esc(note) : "") + "</td>" +
        "</tr>";
    }

    var ouText = (OU < 0 ? "-€ " + fmt(Math.abs(OU)) : "€ " + fmt(Math.abs(OU)));
    var ouNote = (OU < 0 ? "(- UNDER)" : (OU > 0 ? "(OVER)" : ""));

    var html =
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>EOD (A4)</title>" +
      "<style>" +
      "@media print{ @page{ size:A4; margin:0; } html,body{height:297mm;overflow:hidden !important;} *{page-break-after:avoid !important;page-break-before:avoid !important;page-break-inside:avoid !important;} }" +
      "html,body{margin:0;padding:0} body{font-family:Arial, sans-serif} .page{width:210mm;height:297mm;position:relative}" +
      ".sheet{width:170mm;margin:25mm auto} table{width:100%;border-collapse:collapse}" +
      "td{border:1px solid #000;padding:6px;font-size:12pt} .hdr td{font-weight:bold}" +
      ".l{width:46%}.c{width:4%;text-align:center}.r{width:20%;text-align:right}.note{width:30%}" +
      ".gap{height:10mm}" +
      "</style></head><body>" +
      "<div class='page'><div class='sheet'>" +
      "<table class='hdr'>" +
      "<tr><td>DATE:</td><td>" + esc(ddmmyyyy(d)) + "</td></tr>" +
      "<tr><td>STAFF:</td><td>" + esc(staff) + "</td></tr>" +
      "<tr><td>LOCATION:</td><td>" + esc(loc) + "</td></tr>" +
      "</table>" +
      "<div class='gap'></div>" +
      "<table>" +
      row("A1  X READING 1", Avals[0], Arem[0]) +
      row("A2  X READING 2", Avals[1], Arem[1]) +
      row("A3  X READING 3", Avals[2], Arem[2]) +
      row("A4  X READING 4", Avals[3], Arem[3]) +
      row("TOTAL X READINGS", Atot, "") +
      row("B1  EPOS", Bvals[0], "") +
      row("B2  EPOS", Bvals[1], "") +
      row("B3  EPOS", Bvals[2], "") +
      row("B4  EPOS", Bvals[3], "") +
      row("TOTAL EPOS", Btot, "") +
      row("C1  CHEQUES", Cvals[0], Crem[0]) +
      row("C2  CHEQUES", Cvals[1], Crem[1]) +
      row("C3  CHEQUES", Cvals[2], Crem[2]) +
      row("C4  CHEQUES", Cvals[3], Crem[3]) +
      row("TOTAL CHEQUES", Ctot, "") +
      row("D1  PAID OUTS", Dvals[0], Drem[0]) +
      row("D2  PAID OUTS", Dvals[1], Drem[1]) +
      row("D3  PAID OUTS", Dvals[2], Drem[2]) +
      row("D4  PAID OUTS", Dvals[3], Drem[3]) +
      row("D5  PAID OUTS", Dvals[4], Drem[4]) +
      row("D6  PAID OUTS", Dvals[5], Drem[5]) +
      row("D7  PAID OUTS", Dvals[6], Drem[6]) +
      row("D8  PAID OUTS", Dvals[7], Drem[7]) +
      row("TOTAL PAID OUTS", Dtot, "") +
      row("E  TOTAL CASH (Till - Float " + euro(fl) + ")", Etotal, "") +
      row("F  ROUNDED CASH DEPOSITED", Ftotal, "") +
      "</table>" +
      "<div class='gap'></div>" +
      "<table>" +
      "<tr><td class='l'>OVER/UNDER</td><td class='c'>€</td><td class='r'>" + esc(ouText) + "</td><td class='note'>" + esc(ouNote) + "</td></tr>" +
      row("COINS (E − F)", COINS, "") +
      "</table>" +
      "<div style='margin-top:10px;font-size:11pt'>Till notes: " + esc(euro(counted.notes)) + " • Coins: " + esc(euro(counted.coins)) + "</div>" +
      "</div></div>" +
      "<scr" + "ipt>window.onload=function(){window.print(); setTimeout(function(){window.close();},300);};</scr" + "ipt>" +
      "</body></html>";

    return html;
  }

  // -----------------------------
  // UI blocks
  // -----------------------------
  function field(label, inputNode) {
    return el("div", { class: "eikon-field" }, [
      el("div", { class: "eikon-label", text: label }),
      inputNode
    ]);
  }

  function statusPill(text, kind) {
    var bg = kind === "good" ? "rgba(67,209,122,.14)" :
             kind === "warn" ? "rgba(255,200,90,.14)" :
             kind === "bad"  ? "rgba(255,90,122,.14)" : "rgba(120,140,170,.16)";
    var bd = kind === "good" ? "rgba(67,209,122,.35)" :
             kind === "warn" ? "rgba(255,200,90,.35)" :
             kind === "bad"  ? "rgba(255,90,122,.35)" : "rgba(120,140,170,.28)";
    return el("span", {
      style:
        "display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;" +
        "border:1px solid " + bd + ";background:" + bg + ";font-size:12px;color:#e9eef7;"
    }, [ text ]);
  }

  function setDisabledDeep(node, disabled) {
    var inputs = node.querySelectorAll("input,select,textarea,button");
    for (var i = 0; i < inputs.length; i++) {
      var t = inputs[i];
      if (!t) continue;
      if (t.dataset && t.dataset.allowWhenLocked === "1") continue;
      t.disabled = !!disabled;
    }
  }

  // -----------------------------
  // Module persistent state
  // -----------------------------
  var _mountRef = null;
  var _state = null;
  var _storageBadge = "Checking…";

  function makeDefaultState(locationName, createdBy, dateStr) {
    return {
      date: dateStr || ymd(new Date()),
      time_of_day: "AM",
      staff: "",
      location_name: locationName,
      created_by: createdBy,
      float_amount: 500,

      x: [
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" }
      ],
      epos: [
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" }
      ],
      cheques: [
        { amount: 0, remark: "" },
        { amount: 0, remark: "" }
      ],
      paid_outs: [
        { amount: 0, remark: "" }
      ],
      cash: {
        n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, n5: 0,
        coins_total: 0
      },
      bag_number: "",
      deposit: { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0 },
      contact_id: "",

      saved_at: "",
      locked_at: ""
    };
  }

  function deepCopy(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  }

  function isLocked(state) { return !!(state && state.locked_at); }

  async function loadRecordIntoState(dateStr, locationName, createdBy) {
    var existing = await getEodByDateAndLoc(dateStr, locationName);
    if (existing) return deepCopy(existing);
    return makeDefaultState(locationName, createdBy, dateStr);
  }

  // -----------------------------
  // Validation + actions
  // -----------------------------
  function validateBeforeSave(state) {
    var staff = String(state.staff || "").trim();
    if (!staff) return { ok: false, msg: "Staff is required." };

    var loc = String(state.location_name || "").trim();
    if (!loc) return { ok: false, msg: "Location is missing (login location)." };

    var fl = parseNum(state.float_amount);
    if (!(fl >= 0)) return { ok: false, msg: "Float must be a number (>= 0)." };

    // BOV: require bag number if used
    var hasDeposit = bovTotal(state) > 0 || String(state.bag_number || "").trim() !== "";
    if (hasDeposit && !String(state.bag_number || "").trim()) {
      return { ok: false, msg: "Bag Number is required when BOV deposit is used." };
    }
    return { ok: true };
  }

  async function doSave(createdBy) {
    if (isLocked(_state)) return toast("Locked", "This End Of Day is locked and cannot be edited.");

    var v = validateBeforeSave(_state);
    if (!v.ok) return toast("Missing Information", v.msg);

    _state.saved_at = nowIso();
    await upsertEod(deepCopy(_state));

    await writeAudit(_state.location_name, _state.date, {
      ts: nowIso(),
      date: _state.date,
      location_name: _state.location_name,
      by: createdBy,
      action: "SAVE",
      details: { staff: _state.staff, float_amount: _state.float_amount }
    });

    rerender();
  }

  async function doLock(createdBy) {
    if (isLocked(_state)) return toast("Already Locked", "This End Of Day is already locked.");

    var v = validateBeforeSave(_state);
    if (!v.ok) return toast("Cannot Lock", "Fix required fields first:\n\n" + v.msg);

    _state.saved_at = _state.saved_at || nowIso();
    _state.locked_at = nowIso();
    await upsertEod(deepCopy(_state));

    await writeAudit(_state.location_name, _state.date, {
      ts: nowIso(),
      date: _state.date,
      location_name: _state.location_name,
      by: createdBy,
      action: "LOCK",
      details: {}
    });

    rerender();
  }

  async function doUnlockMaster(createdBy) {
    var ok = window.prompt("Master Unlock Key:");
    if (!ok) return;
    // keep it simple: any non-empty unlock key unlocks (you can tighten later)
    _state.locked_at = "";
    await upsertEod(deepCopy(_state));

    await writeAudit(_state.location_name, _state.date, {
      ts: nowIso(),
      date: _state.date,
      location_name: _state.location_name,
      by: createdBy,
      action: "UNLOCK_MASTER",
      details: { used: true }
    });

    rerender();
  }

  async function showAuditLog() {
    var rows = await auditFor(_state.location_name, _state.date);

    var tbl = el("table", { style: "width:100%;border-collapse:collapse;" });
    tbl.appendChild(el("thead", {}, [
      el("tr", {}, [
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Time" }),
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Action" }),
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "By" }),
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Details" })
      ])
    ]));

    var tbody = el("tbody");
    if (!rows.length) {
      tbody.appendChild(el("tr", {}, [
        el("td", { colspan: "4", style: "padding:10px;color:rgba(233,238,247,.75);", text: "No audit entries yet." })
      ]));
    } else {
      rows.forEach(function (r) {
        tbody.appendChild(el("tr", {}, [
          el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap;", text: String(r.ts || "").replace("T", " ").replace("Z", "").slice(0, 19) }),
          el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);font-weight:800;", text: r.action || "" }),
          el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);", text: r.by || "" }),
          el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;font-size:12px;color:rgba(233,238,247,.85);", text: JSON.stringify(r.details || {}) })
        ]));
      });
    }

    tbl.appendChild(tbody);
    showModal("Audit Log — " + ddmmyyyy(_state.date), tbl, []);
  }

  async function doPrintA4(createdBy) {
    var v = validateBeforeSave(_state);
    if (!v.ok) return toast("Missing Information", "Cannot print until required fields are completed:\n\n" + v.msg);

    openPrintTabWithHtml(buildA4HtmlForCurrent(_state));

    await writeAudit(_state.location_name, _state.date, {
      ts: nowIso(),
      date: _state.date,
      location_name: _state.location_name,
      by: createdBy,
      action: "PRINT_A4",
      details: {}
    });
  }

  async function doPrintRangeReport(createdBy, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return toast("Validation", "From/To must be dates (YYYY-MM-DD).");
    }
    if (to < from) return toast("Validation", "To must be >= From.");

    function nextDay(s) {
      var d = new Date(s + "T00:00:00");
      d.setDate(d.getDate() + 1);
      return ymd(d);
    }

    var rows = [];
    var cur = from;
    while (cur <= to) {
      var r = await getEodByDateAndLoc(cur, _state.location_name);
      if (r) rows.push(r);
      cur = nextDay(cur);
    }
    rows.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

    var totalCash = 0, totalOU = 0, totalCoins = 0;

    rows.forEach(function (r) {
      var notes =
        500 * parseNum(r.cash.n500) +
        200 * parseNum(r.cash.n200) +
        100 * parseNum(r.cash.n100) +
         50 * parseNum(r.cash.n50) +
         20 * parseNum(r.cash.n20) +
         10 * parseNum(r.cash.n10) +
          5 * parseNum(r.cash.n5);
      var till = notes + parseNum(r.cash.coins_total);
      var fl = parseNum(r.float_amount);
      var E2 = till - fl;
      if (E2 < 0) E2 = 0;

      var X2 = r.x.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var B2 = r.epos.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var C2 = r.cheques.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var D2 = r.paid_outs.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var exp = X2 - B2 - C2 - D2;

      var F2 = roundToNearest5(E2);

      totalCash += E2;
      totalOU += (E2 - exp);
      totalCoins += (E2 - F2);
    });

    var rowsHtml = rows.map(function (r) {
      var notes =
        500 * parseNum(r.cash.n500) +
        200 * parseNum(r.cash.n200) +
        100 * parseNum(r.cash.n100) +
         50 * parseNum(r.cash.n50) +
         20 * parseNum(r.cash.n20) +
         10 * parseNum(r.cash.n10) +
          5 * parseNum(r.cash.n5);
      var till = notes + parseNum(r.cash.coins_total);
      var fl = parseNum(r.float_amount);
      var E2 = till - fl;
      if (E2 < 0) E2 = 0;

      var X2 = r.x.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var B2 = r.epos.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var C2 = r.cheques.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var D2 = r.paid_outs.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var exp = X2 - B2 - C2 - D2;

      var ou = E2 - exp;
      return "<tr>" +
        "<td>" + esc(ddmmyyyy(r.date)) + "</td>" +
        "<td style='text-align:right'>" + esc(euro(E2)) + "</td>" +
        "<td style='text-align:right'>" + esc(euro(ou)) + "</td>" +
        "<td>" + esc(String(r.staff || "")) + "</td>" +
        "<td>" + esc(r.locked_at ? "Locked" : "") + "</td>" +
        "</tr>";
    }).join("");

    var html =
      "<!doctype html><html><head><meta charset='utf-8'><title>EOD Range Report</title>" +
      "<style>@media print{@page{size:A4;margin:12mm}} body{font-family:Arial,sans-serif} table{width:100%;border-collapse:collapse} th,td{border:1px solid #000;padding:6px;font-size:12px} th{background:#eee}</style>" +
      "</head><body>" +
      "<h2>End Of Day — Range Report</h2>" +
      "<div><b>Location:</b> " + esc(_state.location_name) + "</div>" +
      "<div><b>Range:</b> " + esc(ddmmyyyy(from)) + " to " + esc(ddmmyyyy(to)) + "</div>" +
      "<div style='margin:10px 0'><b>Totals:</b> Total Cash " + esc(euro(totalCash)) + " | Over/Under " + esc(euro(totalOU)) + " | Coin Box " + esc(euro(totalCoins)) + "</div>" +
      "<table><thead><tr><th>Date</th><th>Total Cash (E)</th><th>Over/Under</th><th>Staff</th><th>Status</th></tr></thead><tbody>" +
      (rowsHtml || "<tr><td colspan='5'>No records in range.</td></tr>") +
      "</tbody></table>" +
      "<scr" + "ipt>window.onload=function(){window.print(); setTimeout(function(){window.close();},300);};</scr" + "ipt>" +
      "</body></html>";

    openPrintTabWithHtml(html);

    await writeAudit(_state.location_name, _state.date, {
      ts: nowIso(),
      date: _state.date,
      location_name: _state.location_name,
      by: createdBy,
      action: "PRINT_RANGE",
      details: { from: from, to: to }
    });
  }

  // -----------------------------
  // Contacts manager
  // -----------------------------
  async function showContactsManager(locationName, onDone) {
    var contacts = await loadContacts(locationName);

    function renderList(container) {
      container.innerHTML = "";

      var topRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;" });

      var inName = el("input", { class: "eikon-input", placeholder: "Name (e.g. Accounts)" });
      var inPhone = el("input", { class: "eikon-input", placeholder: "Phone (optional)" });
      var inEmail = el("input", { class: "eikon-input", placeholder: "Email (optional)" });
      var btnAdd = el("button", { class: "eikon-btn primary", text: "Add" });

      btnAdd.onclick = async function () {
        var name = String(inName.value || "").trim();
        var phone = String(inPhone.value || "").trim();
        var email = String(inEmail.value || "").trim();
        if (!name) return toast("Validation", "Name is required.");
        var id = "c_" + Math.random().toString(16).slice(2) + "_" + Date.now();
        contacts.push({ id: id, name: name, phone: phone, email: email });
        await saveContacts(locationName, contacts);
        inName.value = "";
        inPhone.value = "";
        inEmail.value = "";
        renderList(container);
      };

      topRow.appendChild(field("New Contact Name", inName));
      topRow.appendChild(field("Phone", inPhone));
      topRow.appendChild(field("Email", inEmail));
      topRow.appendChild(btnAdd);

      container.appendChild(topRow);

      var tbl = el("table", { style: "width:100%;border-collapse:collapse;" });
      tbl.appendChild(el("thead", {}, [
        el("tr", {}, [
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Name" }),
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Phone" }),
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Email" }),
          el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Actions" })
        ])
      ]));

      var tbody = el("tbody");
      if (!contacts.length) {
        tbody.appendChild(el("tr", {}, [
          el("td", { colspan: "4", style: "padding:10px;color:rgba(233,238,247,.75);", text: "No contacts yet. Add your first contact above." })
        ]));
      } else {
        contacts.forEach(function (c) {
          var tr = el("tr", {}, []);
          var tdName = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
          var tdPhone = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
          var tdEmail = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
          var tdAct = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

          var inN = el("input", { class: "eikon-input", value: c.name || "" });
          var inP = el("input", { class: "eikon-input", value: c.phone || "" });
          var inE = el("input", { class: "eikon-input", value: c.email || "" });

          var btnSave = el("button", { class: "eikon-btn primary", text: "Save" });
          var btnDel = el("button", { class: "eikon-btn", text: "Delete" });

          btnSave.onclick = async function () {
            var nn = String(inN.value || "").trim();
            if (!nn) return toast("Validation", "Name cannot be empty.");
            c.name = nn;
            c.phone = String(inP.value || "").trim();
            c.email = String(inE.value || "").trim();
            await saveContacts(locationName, contacts);
            renderList(container);
          };

          btnDel.onclick = async function () {
            var ok = window.confirm("Delete this contact?\n\n" + (c.name || ""));
            if (!ok) return;
            contacts = contacts.filter(function (x) { return x.id !== c.id; });
            await saveContacts(locationName, contacts);
            renderList(container);
          };

          tdName.appendChild(inN);
          tdPhone.appendChild(inP);
          tdEmail.appendChild(inE);
          tdAct.appendChild(btnSave);
          tdAct.appendChild(el("span", { style: "display:inline-block;width:8px;" }));
          tdAct.appendChild(btnDel);

          tr.appendChild(tdName);
          tr.appendChild(tdPhone);
          tr.appendChild(tdEmail);
          tr.appendChild(tdAct);
          tbody.appendChild(tr);
        });
      }

      tbl.appendChild(tbody);
      container.appendChild(tbl);
    }

    var wrap = el("div");
    renderList(wrap);

    showModal("Manage BOV Contacts", wrap, [
      {
        text: "Done",
        primary: true,
        onClick: function (close) {
          close();
          if (onDone) onDone();
        }
      }
    ]);
  }

  // -----------------------------
  // Payment table
  // -----------------------------
  function makePaymentTable(title, rows, allowAdd, onAddRow, locked) {
    var card = el("div", { class: "eikon-card" });

    var headRow = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;" }, [
      el("div", { style: "font-weight:900;color:#e9eef7;", text: title }),
      allowAdd ? el("button", { class: "eikon-btn", text: "Add Entry", disabled: locked }) : el("span", { text: "" })
    ]);
    card.appendChild(headRow);

    if (allowAdd) {
      var btnAdd = headRow.querySelector("button");
      btnAdd.onclick = function () { if (onAddRow) onAddRow(); };
    }

    var tbl = el("table", { style: "width:100%;border-collapse:collapse;margin-top:8px;" });
    tbl.appendChild(el("thead", {}, [
      el("tr", {}, [
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Payment" }),
        el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Total" }),
        el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Amount" }),
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Remark" }),
        el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "" })
      ])
    ]));

    var tbody = el("tbody");

    for (var i = 0; i < rows.length; i++) {
      (function (idx) {
        var r = rows[idx];
        var tr = el("tr", {}, []);
        var tdName = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
        var tdTot = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });
        var tdAmt = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;" });
        var tdRem = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
        var tdAct = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

        var label =
          title === "X Readings" ? ("X Reading " + (idx + 1)) :
          title === "EPOS" ? ("EPOS " + (idx + 1)) :
          title === "Cheques" ? ("Cheque " + (idx + 1)) :
          ("Paid Out " + (idx + 1));

        tdName.textContent = label;
        tdTot.textContent = euro(parseNum(r.amount));

        var inAmt = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(r.amount)), disabled: locked });
        inAmt.oninput = function () { r.amount = parseNum(inAmt.value); rerender(); };

        var inRem = el("input", { class: "eikon-input", type: "text", value: String(r.remark || ""), disabled: locked });
        inRem.oninput = function () { r.remark = String(inRem.value || ""); };

        tdAmt.appendChild(inAmt);
        tdRem.appendChild(inRem);

        var canRemove = (title === "Cheques" || title === "Paid Outs") && rows.length > 1;
        if (canRemove) {
          var btnDel = el("button", { class: "eikon-btn", text: "Remove", disabled: locked });
          btnDel.onclick = function () { rows.splice(idx, 1); rerender(); };
          tdAct.appendChild(btnDel);
        }

        tr.appendChild(tdName);
        tr.appendChild(tdTot);
        tr.appendChild(tdAmt);
        tr.appendChild(tdRem);
        tr.appendChild(tdAct);

        tbody.appendChild(tr);
      })(i);
    }

    tbl.appendChild(tbody);
    card.appendChild(tbl);
    return card;
  }

  // -----------------------------
  // Email/Copy summary text
  // -----------------------------
  function buildSummaryText(state, contact) {
    var counted = countedCashTill(state);
    var lines = [];
    lines.push("End Of Day — " + ddmmyyyy(state.date));
    lines.push("Location: " + String(state.location_name || ""));
    lines.push("Staff: " + String(state.staff || ""));
    lines.push("Time: " + String(state.time_of_day || ""));
    lines.push("");
    lines.push("Total X: " + euro(totalX(state)));
    lines.push("Total EPOS: " + euro(totalEpos(state)));
    lines.push("Total Cheques: " + euro(totalCheques(state)));
    lines.push("Total Paid Outs: " + euro(totalPaidOuts(state)));
    lines.push("Expected Deposit: " + euro(expectedDeposit(state)));
    lines.push("");
    lines.push("Till Cash (notes): " + euro(counted.notes));
    lines.push("Till Coins: " + euro(counted.coins));
    lines.push("Till Total: " + euro(counted.total));
    lines.push("Float: " + euro(parseNum(state.float_amount)));
    lines.push("E Total Cash (Till - Float): " + euro(totalCashE(state)));
    lines.push("F Rounded Deposit: " + euro(roundedDepositF(state)));
    lines.push("Over/Under: " + euro(overUnder(state)));
    lines.push("Coins (E-F): " + euro(coinsDiff(state)));
    lines.push("");
    lines.push("BOV Deposit:");
    lines.push("Bag Number: " + String(state.bag_number || ""));
    lines.push("Total BOV Deposit: " + euro(bovTotal(state)));
    if (contact) {
      lines.push("Contact: " + String(contact.name || ""));
      if (contact.phone) lines.push("Phone: " + String(contact.phone));
      if (contact.email) lines.push("Email: " + String(contact.email));
    }
    return lines.join("\n");
  }

  // -----------------------------
  // Main render
  // -----------------------------
  async function render(ctx) {
    var mount = ctx && ctx.mount ? ctx.mount : ctx;
    if (!mount) return;

    mount.innerHTML = "";

    var user = (ctx && ctx.user) ? ctx.user : (E.state && E.state.user ? E.state.user : null);
    var locationName = user && user.location_name ? String(user.location_name) : "";
    var createdBy = user && user.full_name ? String(user.full_name) : (user && user.email ? String(user.email) : "");

    // check API availability once per module session
    if (!_apiMode.lastCheckedAt) {
      await apiCheckAvailable();
      _storageBadge = _apiMode.ok ? "Storage: Server (shared)" : "Storage: Local (this browser)";
    } else {
      _storageBadge = _apiMode.ok ? "Storage: Server (shared)" : "Storage: Local (this browser)";
    }

    // init state if first time
    if (!_state) {
      _state = await loadRecordIntoState(ymd(new Date()), locationName, createdBy);
    } else {
      // ensure location fields remain correct
      _state.location_name = locationName;
      _state.created_by = createdBy;
    }

    // Header cards
    var headerCard = el("div", { class: "eikon-card" });
    var bodyCard = el("div", { class: "eikon-card" });

    // Action buttons
    var btnSave = el("button", { class: "eikon-btn primary", text: "Save", "data-allow-when-locked": "0" });
    var btnPrintA4 = el("button", { class: "eikon-btn", text: "Print End of Day on A4", "data-allow-when-locked": "1" });
    var btnLock = el("button", { class: "eikon-btn", text: "Lock", "data-allow-when-locked": "0" });
    var btnUnlock = el("button", { class: "eikon-btn", text: "Unlock (Master Key)", "data-allow-when-locked": "1" });
    var btnAudit = el("button", { class: "eikon-btn", text: "Audit Log", "data-allow-when-locked": "1" });

    btnSave.onclick = function () { doSave(createdBy); };
    btnPrintA4.onclick = function () { doPrintA4(createdBy); };
    btnLock.onclick = function () { doLock(createdBy); };
    btnUnlock.onclick = function () { doUnlockMaster(createdBy); };
    btnAudit.onclick = function () { showAuditLog(); };

    var btnReport = el("button", { class: "eikon-btn", text: "Report (Date Range)", "data-allow-when-locked": "1" });
    btnReport.onclick = function () {
      var wrap = el("div");
      var inFrom = el("input", { class: "eikon-input", type: "date", value: _state.date });
      var inTo = el("input", { class: "eikon-input", type: "date", value: _state.date });
      wrap.appendChild(el("div", { class: "eikon-help", text: "Print a summary for a selected date range (for the current location)." }));
      wrap.appendChild(el("div", { class: "eikon-row", style: "margin-top:10px;gap:10px;flex-wrap:wrap;" }, [
        field("From", inFrom),
        field("To", inTo)
      ]));
      showModal("EOD Range Report", wrap, [
        { text: "Cancel", primary: false, onClick: function (close) { close(); } },
        { text: "Print", primary: true, onClick: function (close) { close(); doPrintRangeReport(createdBy, inFrom.value, inTo.value); } }
      ]);
    };

    var btnAdminClearLocal = el("button", { class: "eikon-btn", text: "Admin: Clear Local EOD Data", "data-allow-when-locked": "1" });
    btnAdminClearLocal.onclick = function () {
      var ok = window.confirm("This clears ONLY local fallback storage in this browser.\n\nContinue?");
      if (!ok) return;
      clearLocalEodAll();
      toast("Done", "Local EOD data cleared (this browser only).");
      rerender();
    };

    // Status line
    var statusLine = el("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;" });
    statusLine.appendChild(statusPill(_storageBadge, _apiMode.ok ? "good" : "warn"));
    statusLine.appendChild(isLocked(_state) ? statusPill("Locked", "good") : statusPill("Unlocked", "warn"));
    statusLine.appendChild(_state.saved_at ? statusPill("Saved", "good") : statusPill("Not Saved", "bad"));

    // Header fields
    var inDate = el("input", { class: "eikon-input eikon-slim-input", type: "date", value: _state.date, "data-allow-when-locked": "1" });
    inDate.onchange = async function () {
      _state = await loadRecordIntoState(inDate.value, locationName, createdBy);
      rerender();
    };

    var selTime = el("select", { class: "eikon-select eikon-slim-input", "data-allow-when-locked": "0" }, [
      el("option", { value: "AM", text: "AM" }),
      el("option", { value: "PM", text: "PM" })
    ]);
    selTime.value = _state.time_of_day || "AM";
    selTime.onchange = function () { _state.time_of_day = selTime.value; };

    var inStaff = el("input", { class: "eikon-input", type: "text", value: _state.staff || "", placeholder: "Required", "data-allow-when-locked": "0" });
    inStaff.oninput = function () { _state.staff = inStaff.value; };

    var inLoc = el("input", { class: "eikon-input", type: "text", value: _state.location_name || "", disabled: true, "data-allow-when-locked": "1" });

    var inFloat = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(_state.float_amount)), "data-allow-when-locked": "0" });
    inFloat.oninput = function () { _state.float_amount = parseNum(inFloat.value); rerender(); };

    var topRow = el("div", { class: "eikon-row", style: "gap:10px;flex-wrap:wrap;" }, [
      btnSave, btnReport, btnPrintA4, btnLock, btnUnlock, btnAudit, btnAdminClearLocal
    ]);

    var metaRow = el("div", { class: "eikon-row", style: "gap:12px;flex-wrap:wrap;margin-top:10px;" }, [
      field("Date", inDate),
      field("Time of Day", selTime),
      field("Staff (required)", inStaff),
      field("Location", inLoc),
      field("Float", inFloat)
    ]);

    headerCard.appendChild(el("div", { style: "font-weight:900;font-size:18px;color:#e9eef7;margin-bottom:8px;", text: "End Of Day" }));
    headerCard.appendChild(topRow);
    headerCard.appendChild(metaRow);
    headerCard.appendChild(statusLine);

    // Payments
    var paymentsWrap = el("div", { style: "display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px;" });
    paymentsWrap.appendChild(makePaymentTable("X Readings", _state.x, false, null, isLocked(_state)));
    paymentsWrap.appendChild(makePaymentTable("EPOS", _state.epos, false, null, isLocked(_state)));
    paymentsWrap.appendChild(makePaymentTable("Cheques", _state.cheques, true, function () {
      _state.cheques.push({ amount: 0, remark: "" });
      rerender();
    }, isLocked(_state)));
    paymentsWrap.appendChild(makePaymentTable("Paid Outs", _state.paid_outs, true, function () {
      _state.paid_outs.push({ amount: 0, remark: "" });
      rerender();
    }, isLocked(_state)));

    // Cash Count + BOV
    var cashCard = el("div", { class: "eikon-card" });
    cashCard.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;" }, [
      el("div", { style: "font-weight:900;color:#e9eef7;", text: "Cash Count & BOV Deposit" })
    ]));

    var cashGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;" });

    // Left: cash denomination table
    var leftCash = el("div", {});
    var tblCash = el("table", { style: "width:100%;border-collapse:collapse;" });
    tblCash.appendChild(el("thead", {}, [
      el("tr", {}, [
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Denomination" }),
        el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Count" }),
        el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Total" })
      ])
    ]));

    function cashRow(label, denom, key) {
      var tr = el("tr", {}, []);
      var tdD = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);", text: label });
      var tdC = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;" });
      var tdT = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

      var inp = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(_state.cash[key])), disabled: isLocked(_state) });
      inp.oninput = function () { _state.cash[key] = parseNum(inp.value); rerender(); };

      tdC.appendChild(inp);
      tdT.textContent = euro(parseNum(_state.cash[key]) * denom);

      tr.appendChild(tdD); tr.appendChild(tdC); tr.appendChild(tdT);
      return tr;
    }

    var tb = el("tbody");
    tb.appendChild(cashRow("€500", 500, "n500"));
    tb.appendChild(cashRow("€200", 200, "n200"));
    tb.appendChild(cashRow("€100", 100, "n100"));
    tb.appendChild(cashRow("€50", 50, "n50"));
    tb.appendChild(cashRow("€20", 20, "n20"));
    tb.appendChild(cashRow("€10", 10, "n10"));
    tb.appendChild(cashRow("€5", 5, "n5"));

    // Coins
    (function () {
      var tr = el("tr", {}, []);
      var tdD = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);", text: "Coins" });
      var tdC = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;" });
      var tdT = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

      var inp = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(_state.cash.coins_total)), disabled: isLocked(_state) });
      inp.oninput = function () { _state.cash.coins_total = parseNum(inp.value); rerender(); };

      tdC.appendChild(inp);
      tdT.textContent = euro(parseNum(_state.cash.coins_total));

      tr.appendChild(tdD); tr.appendChild(tdC); tr.appendChild(tdT);
      tb.appendChild(tr);
    })();

    tblCash.appendChild(tb);
    leftCash.appendChild(tblCash);

    var counted = countedCashTill(_state);
    leftCash.appendChild(el("div", { style: "margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;display:flex;justify-content:space-between;align-items:center;" }, [
      el("div", { style: "font-weight:900;", text: "Total Cash:" }),
      el("div", { style: "font-weight:900;", text: euro(counted.total) })
    ]));

    // Right: BOV deposit
    var rightBov = el("div", {});
    rightBov.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:6px;", text: "BOV Cash Deposit" }));

    var contacts = await loadContacts(locationName);
    var selContact = el("select", { class: "eikon-select", disabled: isLocked(_state) });
    selContact.appendChild(el("option", { value: "", text: "— Select Contact —" }));
    contacts.forEach(function (c) {
      var bits = [c.name];
      if (c.phone) bits.push(c.phone);
      if (c.email) bits.push(c.email);
      selContact.appendChild(el("option", { value: c.id, text: bits.join(" • ") }));
    });
    selContact.value = _state.contact_id || "";
    selContact.onchange = function () { _state.contact_id = selContact.value; };

    var btnManageContacts = el("button", { class: "eikon-btn", text: "Manage Contacts", disabled: isLocked(_state) });
    btnManageContacts.onclick = function () { showContactsManager(locationName, function () { rerender(); }); };

    var inBag = el("input", { class: "eikon-input", type: "text", value: _state.bag_number || "", disabled: isLocked(_state) });
    inBag.oninput = function () { _state.bag_number = inBag.value; };

    rightBov.appendChild(el("div", { class: "eikon-row", style: "gap:10px;flex-wrap:wrap;align-items:flex-end;" }, [
      field("Bag Number", inBag),
      field("Contact", selContact),
      btnManageContacts
    ]));

    var tblDep = el("table", { style: "width:100%;border-collapse:collapse;margin-top:8px;" });
    tblDep.appendChild(el("thead", {}, [
      el("tr", {}, [
        el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Denomination" }),
        el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Count" }),
        el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Total" })
      ])
    ]));

    function depRow(label, denom, key) {
      var tr = el("tr", {}, []);
      var tdD = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);", text: label });
      var tdC = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;" });
      var tdT = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

      var inp = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(_state.deposit[key])), disabled: isLocked(_state) });
      inp.oninput = function () { _state.deposit[key] = parseNum(inp.value); rerender(); };

      tdC.appendChild(inp);
      tdT.textContent = euro(parseNum(_state.deposit[key]) * denom);

      tr.appendChild(tdD); tr.appendChild(tdC); tr.appendChild(tdT);
      return tr;
    }

    var depBody = el("tbody");
    depBody.appendChild(depRow("€500", 500, "n500"));
    depBody.appendChild(depRow("€200", 200, "n200"));
    depBody.appendChild(depRow("€100", 100, "n100"));
    depBody.appendChild(depRow("€50", 50, "n50"));
    depBody.appendChild(depRow("€20", 20, "n20"));
    depBody.appendChild(depRow("€10", 10, "n10"));
    tblDep.appendChild(depBody);

    rightBov.appendChild(tblDep);

    // Copy / Email buttons
    var chosenContact = contacts.filter(function (c) { return String(c.id) === String(_state.contact_id || ""); })[0] || null;

    var btnCopy = el("button", { class: "eikon-btn", text: "Copy Summary", disabled: false, "data-allow-when-locked": "1" });
    btnCopy.onclick = async function () {
      var txt = buildSummaryText(_state, chosenContact);
      var ok = await copyToClipboard(txt);
      toast(ok ? "Copied" : "Copy failed", ok ? "Summary copied to clipboard." : "Could not copy to clipboard.");
    };

    var btnEmail = el("button", { class: "eikon-btn", text: "Email Summary", disabled: false, "data-allow-when-locked": "1" });
    btnEmail.onclick = function () {
      var subject = "End Of Day - " + ddmmyyyy(_state.date) + " - " + String(_state.location_name || "");
      var body = buildSummaryText(_state, chosenContact);
      var to = (chosenContact && chosenContact.email) ? chosenContact.email : "";
      var url = "mailto:" + encodeURIComponent(to) +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);
      try { window.location.href = url; } catch (e) {}
    };

    rightBov.appendChild(el("div", { style: "margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;" }, [
      btnCopy, btnEmail
    ]));

    rightBov.appendChild(el("div", { style: "margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;display:flex;justify-content:space-between;align-items:center;" }, [
      el("div", { style: "font-weight:900;", text: "Total BOV Deposit:" }),
      el("div", { style: "font-weight:900;", text: euro(bovTotal(_state)) })
    ]));

    cashGrid.appendChild(leftCash);
    cashGrid.appendChild(rightBov);
    cashCard.appendChild(cashGrid);

    // Summary + Monthly summary
    var summaryGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;" });

    var sumCard = el("div", { class: "eikon-card" });
    sumCard.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:10px;", text: "Summary" }));
    sumCard.appendChild(el("div", { style: "display:grid;gap:8px;" }, [
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Expected Deposit:" }),
        el("div", { style: "font-weight:900;", text: euro(expectedDeposit(_state)) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Rounded Cash Deposit (F):" }),
        el("div", { style: "font-weight:900;", text: euro(roundedDepositF(_state)) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Over / Under:" }),
        el("div", { style: "font-weight:900;", text: euro(overUnder(_state)) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Coins (E − F):" }),
        el("div", { style: "font-weight:900;", text: euro(coinsDiff(_state)) })
      ])
    ]));

    var monthCard = el("div", { class: "eikon-card" });
    monthCard.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:10px;", text: "Monthly Summary" }));

    var m = await monthSummary(_state, ymFromYmd(_state.date));
    monthCard.appendChild(el("div", { style: "display:grid;gap:8px;" }, [
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Days Recorded:" }),
        el("div", { style: "font-weight:900;", text: String(m.days) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Total Cash (Month):" }),
        el("div", { style: "font-weight:900;", text: euro(m.total_cash_month) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Over / Under (Month):" }),
        el("div", { style: "font-weight:900;", text: euro(m.over_under_month) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Coin Box (Month):" }),
        el("div", { style: "font-weight:900;", text: euro(m.coin_box_month) })
      ])
    ]));

    summaryGrid.appendChild(sumCard);
    summaryGrid.appendChild(monthCard);

    // Compose body
    bodyCard.appendChild(paymentsWrap);
    bodyCard.appendChild(cashCard);
    bodyCard.appendChild(summaryGrid);

    // Mount
    mount.appendChild(headerCard);
    mount.appendChild(bodyCard);

    // Lock handling (disable body edits, but keep allowed header buttons enabled)
    if (isLocked(_state)) {
      setDisabledDeep(bodyCard, true);

      // disable specific header controls
      selTime.disabled = true;
      inStaff.disabled = true;
      inFloat.disabled = true;
      btnSave.disabled = true;
      btnLock.disabled = true;
    } else {
      btnSave.disabled = false;
      btnLock.disabled = false;
    }
  }

  function rerender() {
    try { render(_mountRef); } catch (e) { E.error("[eod] render failed", e); }
  }

  // Register module
  E.registerModule({
    id: "endofday",
    title: "End Of Day",
    icon: "🕒",
    render: function (ctx) {
      _mountRef = ctx;
      return render(ctx);
    }
  });

})();
