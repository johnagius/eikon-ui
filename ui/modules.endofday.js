/* ui/modules.endofday.js
   Eikon - End Of Day module (UI)

   Requirements implemented:
   - FIX: typing/focus + allow decimals up to 2dp (e.g. 1512.32) in amount boxes
   - X Readings + EPOS start with 1 row (user can add/remove)
   - BOV deposit auto-fills from cash notes to match uploaded HTML behaviour (editable; stops auto once user edits)
   - Copy BOV deposit to Outlook/email (HTML + plain) using selected contact (name/email/phone)
   - Summary calculations aligned with uploaded HTML:
       expected = A - B - C - D
       E = max(0, till - float)
       F = round(E/5)*5
       OU = E - expected
       coins = E - F
   - Print: opens a print tab like modules.temperature.js (does NOT auto-close instantly)
   - Cloud: uses API when available; falls back to localStorage if API 404

   Notes:
   - Deposit denominations include €5 as per your HTML.
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

  function isYmdStr(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  }

  function looksLikeEodRecord(o, dateStr) {
    if (!o || typeof o !== "object") return false;
    // Most important: must have a date (or we can accept the requested date)
    if (isYmdStr(o.date)) return true;
    if (dateStr && isYmdStr(dateStr) && (o.staff || o.cash || o.x || o.epos || o.cheques || o.paid_outs || o.deposit)) return true;
    return false;
  }

  function euro(n) {
    var v = Number(n || 0);
    return "€" + v.toFixed(2);
  }

  function roundToNearest5(n) {
    return Math.round(Number(n || 0) / 5) * 5;
  }

  function openPrintTabWithHtml(html) {
    // Same pattern as modules.temperature.js: open blob in new tab; do not auto-close.
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

  // -----------------------------
  // Decimals: allow partial typing (e.g. "12.", ".5") and up to 2dp
  // -----------------------------
  function moneyNormalizeInput(raw) {
    // returns { ok, normalized, isPartial }
    var s = String(raw == null ? "" : raw);

    // allow empty as partial
    if (s === "") return { ok: true, normalized: "", isPartial: true };

    // allow leading dot ".5"
    if (/^\.\d{0,2}$/.test(s)) return { ok: true, normalized: s, isPartial: true };

    // allow "123" / "123." / "123.4" / "123.45"
    if (/^\d+(\.\d{0,2})?$/.test(s)) {
      var partial = s.endsWith(".") || /\.\d$/.test(s);
      return { ok: true, normalized: s, isPartial: partial };
    }

    // allow "-"? not needed
    return { ok: false, normalized: s, isPartial: false };
  }

  function moneyToNumber(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return 0;
    if (s === ".") return 0;
    var v = Number(s);
    return Number.isFinite(v) ? v : 0;
  }

  function intToNumber(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return 0;
    var v = parseInt(s, 10);
    return Number.isFinite(v) ? v : 0;
  }

  // -----------------------------
  // Cloud API detection + calls (already in your live module; kept compatible)
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
        if (!is404(e)) throw e;
      }
    }
    var err404 = lastErr || new Error("Not found");
    err404.status = 404;
    throw err404;
  }

  async function apiCheckAvailable() {
    var d = ymd(new Date());
    try {
      await apiTryFetch(
        [
          "/endofday/record?date=" + encodeURIComponent(d),
          "/endofday?date=" + encodeURIComponent(d),
          "/eod/record?date=" + encodeURIComponent(d),
          "/eod?date=" + encodeURIComponent(d)
        ],
        { method: "GET" }
      );
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
      _apiMode.ok = false;
      _apiMode.lastCheckedAt = nowIso();
      _apiMode.reason = "EOD API error -> local fallback (" + String(e && (e.message || e)) + ")";
      return false;
    }
  }

  async function apiGetRecord(dateStr) {
    var r = await apiTryFetch(
      [
        "/endofday/record?date=" + encodeURIComponent(dateStr),
        "/endofday?date=" + encodeURIComponent(dateStr),
        "/eod/record?date=" + encodeURIComponent(dateStr),
        "/eod?date=" + encodeURIComponent(dateStr)
      ],
      { method: "GET" }
    );

    var data = r.data;
    if (!data) return null;

    // unwrap common shapes
    var candidate = null;
    if (data.record) candidate = data.record;
    else if (data.eod) candidate = data.eod;
    else if (data.item) candidate = data.item;
    else if (data.ok === true && data.data && typeof data.data === "object") candidate = data.data;
    else if (typeof data === "object") candidate = data;

    if (!candidate || typeof candidate !== "object") return null;

    // IMPORTANT FIX:
    // If API returns { ok:true, eod:null, record:null, item:null } (or similar),
    // treat it as "no record", NOT a record object.
    if (
      candidate.ok === true &&
      candidate.record == null &&
      candidate.eod == null &&
      candidate.item == null &&
      candidate.data == null &&
      !candidate.date
    ) {
      return null;
    }

    // If record object exists but date is missing, set it from the request (safe)
    if (!candidate.date && isYmdStr(dateStr) && looksLikeEodRecord(candidate, dateStr)) {
      candidate.date = dateStr;
    }

    // Only return something that looks like a real EOD record
    if (!looksLikeEodRecord(candidate, dateStr)) return null;

    return candidate;
  }

  async function apiUpsertRecord(rec) {
    var body = JSON.stringify({ record: rec });
    try {
      await apiTryFetch(
        ["/endofday/record", "/endofday", "/eod/record", "/eod"],
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: body }
      );
      return true;
    } catch (e) {
      if (!is404(e)) throw e;
      await apiTryFetch(
        ["/endofday/record", "/endofday", "/eod/record", "/eod"],
        { method: "POST", headers: { "Content-Type": "application/json" }, body: body }
      );
      return true;
    }
  }

  async function apiListDatesForMonth(ym) {
    var r = await apiTryFetch(
      [
        "/endofday/dates?month=" + encodeURIComponent(ym),
        "/endofday/month?month=" + encodeURIComponent(ym),
        "/endofday/list?month=" + encodeURIComponent(ym),
        "/eod/dates?month=" + encodeURIComponent(ym),
        "/eod/month?month=" + encodeURIComponent(ym),
        "/eod/list?month=" + encodeURIComponent(ym)
      ],
      { method: "GET" }
    );
    var data = r.data || {};
    var dates = data.dates || data.items || data.list || data.records || null;
    if (Array.isArray(dates)) {
      return dates
        .map(function (x) {
          if (typeof x === "string") return x;
          if (x && x.date) return x.date;
          if (x && x.eod_date) return x.eod_date;
          return null;
        })
        .filter(Boolean)
        .sort();
    }
    return [];
  }

  async function apiGetContacts() {
    var r = await apiTryFetch(
      ["/endofday/contacts", "/eod/contacts", "/endofday/contact", "/eod/contact"],
      { method: "GET" }
    );
    var data = r.data || {};
    var items = data.contacts || data.items || data.list || data.data || null;
    if (Array.isArray(items)) return items;
    if (Array.isArray(data)) return data;
    return [];
  }

  async function apiSaveContacts(list) {
    var body = JSON.stringify({ contacts: list });
    try {
      await apiTryFetch(
        ["/endofday/contacts", "/eod/contacts"],
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: body }
      );
      return true;
    } catch (e) {
      if (!is404(e)) throw e;
      await apiTryFetch(
        ["/endofday/contacts", "/eod/contacts"],
        { method: "POST", headers: { "Content-Type": "application/json" }, body: body }
      );
      return true;
    }
  }

  // -----------------------------
  // Local storage fallback
  // -----------------------------
  var LS_EOD_KEY = "eikon_eod_records_v2";
  var LS_EOD_CONTACTS_KEY = "eikon_eod_contacts_v2";
  var LS_EOD_AUDIT_KEY = "eikon_eod_audit_v1";

  function loadAllEodsLocal() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_KEY) || "[]";
      var arr = JSON.parse(raw);
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
      var raw = window.localStorage.getItem(LS_EOD_CONTACTS_KEY) || "[]";
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveContactsLocal(arr) {
    try { window.localStorage.setItem(LS_EOD_CONTACTS_KEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function loadAuditLocal() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_AUDIT_KEY) || "[]";
      var arr = JSON.parse(raw);
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
    return all
      .filter(function (a) { return a && a.date === dateStr && a.location_name === locationName; })
      .sort(function (x, y) {
        var xt = (x && x.ts) || "";
        var yt = (y && y.ts) || "";
        if (xt < yt) return 1;
        if (xt > yt) return -1;
        return 0;
      });
  }

  // -----------------------------
  // Unified data access
  // -----------------------------
  async function getEodByDateAndLoc(dateStr, locationName) {
    if (_apiMode.ok) {
      try {
        var rec = await apiGetRecord(dateStr);
        if (rec && typeof rec === "object") {
          if (!rec.date && isYmdStr(dateStr)) rec.date = dateStr;
          if (!rec.location_name && locationName) rec.location_name = locationName;
        }
        return rec;
      }
      catch (e) { return getEodByDateAndLocLocal(dateStr, locationName); }
    }
    return getEodByDateAndLocLocal(dateStr, locationName);
  }

  async function upsertEod(rec) {
    if (_apiMode.ok) {
      try { await apiUpsertRecord(rec); return; }
      catch (e) { upsertEodLocal(rec); return; }
    }
    upsertEodLocal(rec);
  }

  async function loadContacts(locationName) {
    if (_apiMode.ok) {
      try {
        var c = await apiGetContacts();
        return (c || [])
          .map(function (x) {
            return {
              id: x.id != null ? String(x.id) : ("c_" + Math.random().toString(16).slice(2) + "_" + Date.now()),
              name: String(x.name || x.display_name || x.title || "").trim(),
              phone: String(x.phone || "").trim(),
              email: String(x.email || "").trim()
            };
          })
          .filter(function (x) { return !!x.name; });
      } catch (e) {
        return loadContactsLocal();
      }
    }
    return loadContactsLocal();
  }

  async function saveContacts(locationName, arr) {
    if (_apiMode.ok) {
      try { await apiSaveContacts(arr || []); return; }
      catch (e) { saveContactsLocal(arr || []); return; }
    }
    saveContactsLocal(arr || []);
  }

  async function writeAudit(locationName, dateStr, entry) {
    // kept local (safe) for now; easy to switch to server later
    writeAuditLocal(entry);
  }

  async function auditFor(locationName, dateStr) {
    return auditForLocal(dateStr, locationName);
  }

  async function listDatesForMonth(locationName, ym) {
    if (_apiMode.ok) {
      try {
        var dates = await apiListDatesForMonth(ym);
        if (dates && dates.length) return dates;
      } catch (e) {}
      // fallback: scan
      var out = [];
      for (var d = 1; d <= 31; d++) {
        var ds = ym + "-" + String(d).padStart(2, "0");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
        try {
          var r = await apiGetRecord(ds);
          if (r) out.push(r.date ? r.date : ds);
        } catch (e2) {}
      }
      return out.sort();
    }

    var all = loadAllEodsLocal();
    return all
      .filter(function (r) { return r && r.location_name === locationName && ymFromYmd(r.date) === ym; })
      .map(function (r) { return r.date; })
      .sort();
  }

  // -----------------------------
  // Calculations (MATCH HTML)
  // -----------------------------
  function totalA(state) { return (state.x || []).reduce(function (a, r) { return a + moneyToNumber(r.amount); }, 0); }
  function totalB(state) { return (state.epos || []).reduce(function (a, r) { return a + moneyToNumber(r.amount); }, 0); }
  function totalC(state) { return (state.cheques || []).reduce(function (a, r) { return a + moneyToNumber(r.amount); }, 0); }
  function totalD(state) { return (state.paid_outs || []).reduce(function (a, r) { return a + moneyToNumber(r.amount); }, 0); }

  function expectedDeposit(state) {
    return totalA(state) - totalB(state) - totalC(state) - totalD(state);
  }

  function countedCashTill(state) {
    var c = state.cash || {};
    var notes =
      500 * intToNumber(c.n500) +
      200 * intToNumber(c.n200) +
      100 * intToNumber(c.n100) +
       50 * intToNumber(c.n50) +
       20 * intToNumber(c.n20) +
       10 * intToNumber(c.n10) +
        5 * intToNumber(c.n5);
    var coins = moneyToNumber(c.coins_total);
    return { notes: notes, coins: coins, total: notes + coins };
  }

  function totalCashE(state) {
    var till = countedCashTill(state).total;
    var fl = moneyToNumber(state.float_amount);
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
    return 500 * intToNumber(d.n500) +
           200 * intToNumber(d.n200) +
           100 * intToNumber(d.n100) +
            50 * intToNumber(d.n50) +
            20 * intToNumber(d.n20) +
            10 * intToNumber(d.n10) +
             5 * intToNumber(d.n5);
  }

  async function monthSummary(state, monthYm) {
    var loc = state.location_name;
    var m = monthYm || ymFromYmd(state.date);
    var dates = await listDatesForMonth(loc, m);

    var sumE = 0, sumOU = 0, sumCoins = 0;

    for (var i = 0; i < dates.length; i++) {
      var r = await getEodByDateAndLoc(dates[i], loc);
      if (!r) continue;

      var till = (function (rr) {
        var c = rr.cash || {};
        var notes =
          500 * intToNumber(c.n500) +
          200 * intToNumber(c.n200) +
          100 * intToNumber(c.n100) +
           50 * intToNumber(c.n50) +
           20 * intToNumber(c.n20) +
           10 * intToNumber(c.n10) +
            5 * intToNumber(c.n5);
        return notes + moneyToNumber(c.coins_total);
      })(r);

      var fl = moneyToNumber(r.float_amount);
      var E2 = Math.max(0, till - fl);
      var exp = expectedDeposit(r);
      var F2 = roundToNearest5(E2);

      sumE += E2;
      sumOU += (E2 - exp);
      sumCoins += (E2 - F2);
    }

    return { days: dates.length, total_cash_month: sumE, over_under_month: sumOU, coin_box_month: sumCoins };
  }

  // -----------------------------
  // BOV auto-fill (MATCH HTML)
  // -----------------------------
  function paperUnitsFromCash(state) {
    // mirrors HTML: uses notes from cash count. (We include 500 too in our UI.)
    var c = state.cash || {};
    return {
      500: intToNumber(c.n500),
      200: intToNumber(c.n200),
      100: intToNumber(c.n100),
       50: intToNumber(c.n50),
       20: intToNumber(c.n20),
       10: intToNumber(c.n10),
        5: intToNumber(c.n5)
    };
  }

  function autoFillDeposit(state, targetAmount, availableUnits) {
    // Greedy from highest -> lowest, limited by available units.
    // Matches the feel of your HTML (auto suggestion).
    var t = Math.max(0, moneyToNumber(targetAmount));
    var denoms = [500, 200, 100, 50, 20, 10, 5];
    var out = { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, n5: 0 };

    for (var i = 0; i < denoms.length; i++) {
      var d = denoms[i];
      var maxAvail = availableUnits && availableUnits[d] != null ? intToNumber(availableUnits[d]) : 999999;
      var need = Math.floor(t / d);
      var take = Math.min(need, maxAvail);
      if (take < 0) take = 0;
      t -= take * d;
      out["n" + d] = take;
    }

    state.deposit = out;
  }

  // -----------------------------
  // Modal
  // -----------------------------
  function showModal(title, bodyNode, actions) {
    var overlay = el("div", { class: "eikon-modal-overlay", style: "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;" });
    var box = el("div", { class: "eikon-modal", style: "width:min(900px,100%);max-height:90vh;overflow:auto;background:#0f1420;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,.5);padding:14px;" });

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
  // UI helpers
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
             kind === "bad" ? "rgba(255,90,122,.14)" : "rgba(120,140,170,.16)";
    var bd = kind === "good" ? "rgba(67,209,122,.35)" :
             kind === "warn" ? "rgba(255,200,90,.35)" :
             kind === "bad" ? "rgba(255,90,122,.35)" : "rgba(120,140,170,.28)";
    return el("span", {
      style:
        "display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;" +
        "border:1px solid " + bd + ";background:" + bg + ";font-size:12px;color:#e9eef7;"
    }, [text]);
  }

  function setDisabledDeep(node, disabled) {
    var inputs = node.querySelectorAll("input,select,textarea,button");
    for (var i = 0; i < inputs.length; i++) {
      var t = inputs[i];
      if (t && t.dataset && t.dataset.allowWhenLocked === "1") continue;
      t.disabled = !!disabled;
    }
  }

  function toast(title, msg) {
    window.alert((title ? title + "\n\n" : "") + (msg || ""));
  }

  // -----------------------------
  // Contacts manager
  // -----------------------------
  function showContactsManager(locationName, onDone) {
    var contacts = null;

    function renderList(container) {
      container.innerHTML = "";

      var topRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;" });

      var inName = el("input", { class: "eikon-input", placeholder: "Name (e.g. Accounts)" });
      var inEmail = el("input", { class: "eikon-input", placeholder: "Email (optional)" });
      var inPhone = el("input", { class: "eikon-input", placeholder: "Phone (optional)" });
      var btnAdd = el("button", { class: "eikon-btn primary", text: "Add" });

      btnAdd.onclick = async function () {
        var name = String(inName.value || "").trim();
        var email = String(inEmail.value || "").trim();
        var phone = String(inPhone.value || "").trim();
        if (!name) return toast("Validation", "Name is required.");

        var id = "c_" + Math.random().toString(16).slice(2) + "_" + Date.now();
        contacts.push({ id: id, name: name, email: email, phone: phone });
        await saveContacts(locationName, contacts);

        inName.value = "";
        inEmail.value = "";
        inPhone.value = "";
        renderList(container);
      };

      topRow.appendChild(field("New Contact Name", inName));
      topRow.appendChild(field("Email", inEmail));
      topRow.appendChild(field("Phone", inPhone));
      topRow.appendChild(btnAdd);
      container.appendChild(topRow);

      var tbl = el("table", { style: "width:100%;border-collapse:collapse;" });
      tbl.appendChild(el("thead", {}, [
        el("tr", {}, [
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Name" }),
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Email" }),
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Phone" }),
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
          var tdEmail = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
          var tdPhone = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
          var tdAct = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

          var inN = el("input", { class: "eikon-input", value: c.name || "" });
          var inE = el("input", { class: "eikon-input", value: c.email || "" });
          var inP = el("input", { class: "eikon-input", value: c.phone || "" });

          var btnSave = el("button", { class: "eikon-btn primary", text: "Save" });
          var btnDel = el("button", { class: "eikon-btn", text: "Delete" });

          btnSave.onclick = async function () {
            var nn = String(inN.value || "").trim();
            if (!nn) return toast("Validation", "Name cannot be empty.");
            c.name = nn;
            c.email = String(inE.value || "").trim();
            c.phone = String(inP.value || "").trim();
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
          tdEmail.appendChild(inE);
          tdPhone.appendChild(inP);
          tdAct.appendChild(btnSave);
          tdAct.appendChild(el("span", { style: "display:inline-block;width:8px;" }));
          tdAct.appendChild(btnDel);

          tr.appendChild(tdName);
          tr.appendChild(tdEmail);
          tr.appendChild(tdPhone);
          tr.appendChild(tdAct);
          tbody.appendChild(tr);
        });
      }

      tbl.appendChild(tbody);
      container.appendChild(tbl);
    }

    (async function () {
      contacts = await loadContacts(locationName);

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
    })();
  }

  // -----------------------------
  // Printing (A4) — keep same format/output as current
  // (but DO NOT auto-close)
  // -----------------------------
  function buildA4HtmlForCurrent(state) {
    var d = state.date;
    var staff = String(state.staff || "");
    var loc = String(state.location_name || "");

    function fmt(n) {
      return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Ensure fixed rows in print, like previous:
    var Arows = (state.x || []).slice();
    while (Arows.length < 4) Arows.push({ amount: "0", remark: "" });
    var Avals = Arows.slice(0, 4).map(function (r) { return moneyToNumber(r.amount); });
    var Arem = Arows.slice(0, 4).map(function (r) { return String(r.remark || ""); });
    var Atot = totalA(state);

    var Brows = (state.epos || []).slice();
    while (Brows.length < 4) Brows.push({ amount: "0", remark: "" });
    var Bvals = Brows.slice(0, 4).map(function (r) { return moneyToNumber(r.amount); });
    var Btot = totalB(state);

    var Crows = (state.cheques || []).slice(0, 4);
    while (Crows.length < 4) Crows.push({ amount: "0", remark: "" });
    var Cvals = Crows.map(function (r) { return moneyToNumber(r.amount); });
    var Crem = Crows.map(function (r) { return String(r.remark || ""); });
    var Ctot = totalC(state);

    var Drows = (state.paid_outs || []).slice(0, 8);
    while (Drows.length < 8) Drows.push({ amount: "0", remark: "" });
    var Dvals = Drows.map(function (r) { return moneyToNumber(r.amount); });
    var Drem = Drows.map(function (r) { return String(r.remark || ""); });
    var Dtot = totalD(state);

    var expected = expectedDeposit(state);
    var Etotal = totalCashE(state);
    var Ftotal = roundedDepositF(state);
    var OU = overUnder(state);
    var COINS = coinsDiff(state);
    var fl = moneyToNumber(state.float_amount);

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
      ".printbar{position:sticky;top:0;background:#fff;padding:8px;border-bottom:1px solid #ccc;display:flex;gap:8px;justify-content:flex-end}" +
      "</style></head><body>" +
      "<div class='printbar'><button onclick='window.print()'>Print</button></div>" +
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
      row("EXPECTED DEPOSIT (A − B − C − D)", expected, "") +
      row("E  TOTAL CASH (Till − Float " + euro(fl) + ")", Etotal, "") +
      row("F  ROUNDED CASH DEPOSITED", Ftotal, "") +
      "</table>" +
      "<div class='gap'></div>" +
      "<table>" +
      "<tr><td class='l'>OVER/UNDER</td><td class='c'>€</td><td class='r'>" + esc(ouText) + "</td><td class='note'>" + esc(ouNote) + "</td></tr>" +
      row("COINS (E − F)", COINS, "") +
      "</table>" +
      "</div></div>" +
      "</body></html>";

    return html;
  }

  // -----------------------------
  // Copy deposit to Outlook/email (MATCH HTML)
  // -----------------------------
  function buildDepositHTML(state, contact) {
    var bag = esc(String(state.bag_number || "").trim());
    function qty(den) { return intToNumber((state.deposit || {})["n" + den]); }
    function val(den) { return den * qty(den); }

    var rows = [
      { label: "€500.00", den: 500 },
      { label: "€200.00", den: 200 },
      { label: "€100.00", den: 100 },
      { label: "€50.00",  den: 50 },
      { label: "€20.00",  den: 20 },
      { label: "€10.00",  den: 10 },
      { label: "€5.00",   den: 5 }
    ];

    var total = 0;
    for (var i = 0; i < rows.length; i++) total += val(rows[i].den);

    var headerBag =
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">' +
        '<tr><td style="text-align:center;font-weight:bold">BAG NO.</td></tr>' +
        '<tr><td style="text-align:center;border-top:1px solid #000;padding-top:4px">' + bag + '</td></tr>' +
      '</table>';

    var tableOpen = '<table role="presentation" cellpadding="4" cellspacing="0" style="border-collapse:collapse;border:2px solid #000;font-family:Arial,Helvetica,sans-serif;font-size:12px">';
    var headRow =
      '<tr>' +
        '<th style="border:1px solid #000;text-align:center;font-weight:bold;padding:6px" colspan="2">BOV CASH DEPOSIT</th>' +
        '<th style="border:1px solid #000;padding:0">' + headerBag + '</th>' +
      '</tr>';
    var headings =
      '<tr>' +
        '<th style="border:1px solid #000;text-align:left;padding:6px">NOTES</th>' +
        '<th style="border:1px solid #000;text-align:center;padding:6px;background:#ffe8db">NO.</th>' +
        '<th style="border:1px solid #000;text-align:right;padding:6px;background:#daf5df;color:#000">TOTAL</th>' +
      '</tr>';

    var bodyRows = rows.map(function (r) {
      var q = qty(r.den);
      var v = val(r.den);
      return '<tr>' +
        '<td style="border:1px solid #000;text-align:left;padding:6px">' + esc(r.label) + '</td>' +
        '<td style="border:1px solid #000;text-align:center;padding:6px;background:#ffe8db">' + esc(String(q)) + '</td>' +
        '<td style="border:1px solid #000;text-align:right;padding:6px;background:#daf5df;color:#000">€' + esc(Number(v).toFixed(2)) + '</td>' +
      '</tr>';
    }).join("");

    var footRow =
      '<tr>' +
        '<th style="border:1px solid #000;text-align:left;padding:6px" colspan="2">CASH DEPOSITED</th>' +
        '<th style="border:1px solid #000;text-align:right;padding:6px;background:#daf5df;color:#000">€' + esc(Number(total).toFixed(2)) + '</th>' +
      '</tr>';

    return tableOpen + headRow + headings + bodyRows + footRow + "</table>";
  }

  function buildDepositPlain(state) {
    function qty(den) { return intToNumber((state.deposit || {})["n" + den]); }
    function euro2(n) { return "€" + Number(n || 0).toFixed(2); }

    var pairs = [
      [500, "€500.00"],
      [200, "€200.00"],
      [100, "€100.00"],
      [50, "€50.00"],
      [20, "€20.00"],
      [10, "€10.00"],
      [5, "€5.00"]
    ];

    var lines = [];
    var bag = String(state.bag_number || "");
    lines.push(["BOV CASH DEPOSIT", "BAG NO.", bag].join("\t"));
    lines.push(["NOTES", "NO.", "TOTAL"].join("\t"));

    var total = 0;
    for (var i = 0; i < pairs.length; i++) {
      var den = pairs[i][0];
      var label = pairs[i][1];
      var q = qty(den);
      var v = den * q;
      total += v;
      lines.push([label, q, euro2(v)].join("\t"));
    }
    lines.push(["CASH DEPOSITED", "", euro2(total)].join("\t"));
    return lines.join("\n");
  }

  async function copyDepositToClipboard(state, contact) {
    var bagNum = String(state.bag_number || "").trim();
    if (!bagNum) {
      toast("Validation", "Please enter a Bag No. before copying the Cash Deposit table.");
      return false;
    }

    var email = (contact && contact.email) ? String(contact.email) : "";
    var name = (contact && contact.name) ? String(contact.name) : "";
    var greet = name ? ("Dear " + name + ",") : "Dear,";
    var dateLine = "Date: " + ddmmyyyy(state.date);
    var locLine = "Location: " + String(state.location_name || "");

    var htmlBlock =
      (email ? ("<div>" + esc(email) + "</div><div style='height:8px'></div>") : "") +
      "<div>" + esc(greet) + "</div>" +
      "<div style='height:16px'></div>" +
      "<div>" + esc(dateLine) + "</div>" +
      "<div>" + esc(locLine) + "</div>" +
      "<div style='height:12px'></div>" +
      buildDepositHTML(state, contact);

    var plainBlock =
      (email ? (email + "\n\n") : "") +
      greet + "\n\n\n" +
      dateLine + "\n" +
      locLine + "\n\n" +
      buildDepositPlain(state) + "\n";

    try {
      if (navigator.clipboard && window.ClipboardItem) {
        var data = new ClipboardItem({
          "text/html": new Blob([htmlBlock], { type: "text/html" }),
          "text/plain": new Blob([plainBlock], { type: "text/plain" })
        });
        await navigator.clipboard.write([data]);
      } else {
        throw new Error("HTML clipboard not supported");
      }
      toast("Copied", "Formatted cash deposit copied (HTML + plain text). Paste into Outlook.");
      return true;
    } catch (e) {
      // Fallback: contentEditable selection
      try {
        var div = document.createElement("div");
        div.contentEditable = "true";
        div.style.position = "fixed";
        div.style.left = "-9999px";
        div.style.top = "0";
        div.innerHTML = htmlBlock;
        document.body.appendChild(div);

        var range = document.createRange();
        range.selectNodeContents(div);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        document.execCommand("copy");
        sel.removeAllRanges();
        div.remove();
        toast("Copied", "Copied (fallback). Paste into Outlook.");
        return true;
      } catch (e2) {
        toast("Copy failed", "Your browser blocked clipboard access. Try using a different browser or allow clipboard permissions.");
        return false;
      }
    }
  }

  // -----------------------------
  // Render
  // -----------------------------
  var _mountRef = null;
  var _focusedKey = null;
  var _focusedSel = null;

  function rememberFocus() {
    var ae = document.activeElement;
    if (!ae) return;
    var k = ae.getAttribute && ae.getAttribute("data-focus-key");
    if (!k) return;
    _focusedKey = k;
    try { _focusedSel = { start: ae.selectionStart, end: ae.selectionEnd }; } catch (e) { _focusedSel = null; }
  }

  function restoreFocus() {
    if (!_focusedKey) return;
    var node = document.querySelector('[data-focus-key="' + _focusedKey.replace(/"/g, '\\"') + '"]');
    if (!node) return;
    try {
      node.focus();
      if (_focusedSel && node.setSelectionRange) node.setSelectionRange(_focusedSel.start, _focusedSel.end);
    } catch (e) {}
  }

  function rerender() {
    try {
      rememberFocus();
      render(_mountRef).then(function () { restoreFocus(); }).catch(function () { restoreFocus(); });
    } catch (e) {
      try { E.error("[eod] render failed", e); } catch (e2) {}
    }
  }

  async function render(ctx) {
    var mount = ctx && ctx.mount ? ctx.mount : ctx;
    if (!mount) return;

    mount.innerHTML = "";

    var user = (ctx && ctx.user) ? ctx.user : (E.state && E.state.user ? E.state.user : null);
    var locationName = user && user.location_name ? String(user.location_name) : "";
    var createdBy = user && user.full_name ? String(user.full_name) : (user && user.email ? String(user.email) : "");

    // check cloud availability once per module load
    if (_apiMode.lastCheckedAt === "") {
      await apiCheckAvailable();
    }

    // State
    var state = {
      date: ymd(new Date()),
      time_of_day: "AM",
      staff: "",
      location_name: locationName,
      created_by: createdBy,
      float_amount: "1000.00", // match your HTML default better; editable

      x: [{ amount: "0", remark: "" }],           // start 1 row
      epos: [{ amount: "0", remark: "" }],        // start 1 row
      cheques: [{ amount: "0", remark: "" }],
      paid_outs: [{ amount: "0", remark: "" }],

      cash: {
        n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0",
        coins_total: "0"
      },

      bag_number: "",
      deposit: { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0" },
      deposit_edited: false,
      contact_id: "",

      saved_at: "",
      locked_at: ""
    };

    function isLocked() { return !!state.locked_at; }

    async function loadSelectedDate() {
      var existing = await getEodByDateAndLoc(state.date, state.location_name);

      // If the API returned some non-record object, treat as missing
      if (existing && typeof existing === "object" && !looksLikeEodRecord(existing, state.date)) {
        existing = null;
      }

      if (existing) {
        state = JSON.parse(JSON.stringify(existing));

        // ensure critical fields exist
        if (!state.date) state.date = ymd(new Date());
        if (!state.location_name) state.location_name = locationName;
        if (!state.created_by) state.created_by = createdBy;

        if (!state.float_amount) state.float_amount = "1000.00";

        if (!state.deposit) state.deposit = { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0" };
        if (state.deposit.n5 == null) state.deposit.n5 = "0";
        if (state.deposit_edited == null) state.deposit_edited = false;

        if (!Array.isArray(state.x) || !state.x.length) state.x = [{ amount: "0", remark: "" }];
        if (!Array.isArray(state.epos) || !state.epos.length) state.epos = [{ amount: "0", remark: "" }];

        // FIX: these were missing when the API returned an "empty wrapper" record
        if (!Array.isArray(state.cheques) || !state.cheques.length) state.cheques = [{ amount: "0", remark: "" }];
        if (!Array.isArray(state.paid_outs) || !state.paid_outs.length) state.paid_outs = [{ amount: "0", remark: "" }];

        if (!state.cash || typeof state.cash !== "object") {
          state.cash = { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0", coins_total: "0" };
        } else {
          if (state.cash.n500 == null) state.cash.n500 = "0";
          if (state.cash.n200 == null) state.cash.n200 = "0";
          if (state.cash.n100 == null) state.cash.n100 = "0";
          if (state.cash.n50 == null) state.cash.n50 = "0";
          if (state.cash.n20 == null) state.cash.n20 = "0";
          if (state.cash.n10 == null) state.cash.n10 = "0";
          if (state.cash.n5 == null) state.cash.n5 = "0";
          if (state.cash.coins_total == null) state.cash.coins_total = "0";
        }
      } else {
        // reset but keep defaults
        state.saved_at = "";
        state.locked_at = "";
        state.time_of_day = "AM";
        state.staff = "";
        state.created_by = createdBy;
        state.location_name = locationName;
        if (!state.float_amount) state.float_amount = "1000.00";

        state.x = [{ amount: "0", remark: "" }];
        state.epos = [{ amount: "0", remark: "" }];
        state.cheques = [{ amount: "0", remark: "" }];
        state.paid_outs = [{ amount: "0", remark: "" }];
        state.cash = { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0", coins_total: "0" };
        state.bag_number = "";
        state.deposit = { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0" };
        state.deposit_edited = false;
        state.contact_id = "";
      }

      // If not edited, refresh auto-fill based on latest values:
      if (!state.deposit_edited) {
        autoFillDeposit(state, roundedDepositF(state), paperUnitsFromCash(state));
      }
    }

    await loadSelectedDate();

    // -----------------------------
    // Validation + Save + Lock
    // -----------------------------
    function validateBeforeSave() {
      var staff = String(state.staff || "").trim();
      if (!staff) return { ok: false, msg: "Staff is required." };

      var loc = String(state.location_name || "").trim();
      if (!loc) return { ok: false, msg: "Location is missing (login location)." };

      // float must be numeric
      var fl = moneyToNumber(state.float_amount);
      if (!(fl >= 0)) return { ok: false, msg: "Float must be a number (>= 0)." };

      var hasDeposit = bovTotal(state) > 0 || String(state.bag_number || "").trim() !== "";
      if (hasDeposit && !String(state.bag_number || "").trim()) {
        return { ok: false, msg: "Bag Number is required when BOV deposit is used." };
      }

      return { ok: true };
    }

    async function doSave() {
      if (isLocked()) return toast("Locked", "This End Of Day is locked and cannot be edited.");

      var v = validateBeforeSave();
      if (!v.ok) return toast("Missing Information", v.msg);

      state.saved_at = nowIso();
      await upsertEod(JSON.parse(JSON.stringify(state)));

      await writeAudit(state.location_name, state.date, {
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "SAVE",
        details: { staff: state.staff, float_amount: state.float_amount }
      });

      rerender();
    }

    async function doLock() {
      if (isLocked()) return toast("Already Locked", "This End Of Day is already locked.");

      var v = validateBeforeSave();
      if (!v.ok) return toast("Cannot Lock", "Fix required fields first:\n\n" + v.msg);

      state.saved_at = state.saved_at || nowIso();
      state.locked_at = nowIso();
      await upsertEod(JSON.parse(JSON.stringify(state)));

      await writeAudit(state.location_name, state.date, {
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "LOCK",
        details: {}
      });

      rerender();
    }

    async function showAuditLog() {
      var rows = await auditFor(state.location_name, state.date);

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

      showModal("Audit Log — " + ddmmyyyy(state.date), tbl, []);
    }

    // -----------------------------
    // Print / Report
    // -----------------------------
    function doPrintA4() {
      var v = validateBeforeSave();
      if (!v.ok) return toast("Missing Information", "Cannot print until required fields are completed:\n\n" + v.msg);

      openPrintTabWithHtml(buildA4HtmlForCurrent(state));

      writeAudit(state.location_name, state.date, {
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "PRINT_A4",
        details: {}
      });
    }

    async function doPrintRangeReport(from, to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return toast("Validation", "From/To must be dates (YYYY-MM-DD).");
      }
      if (to < from) return toast("Validation", "To must be >= From.");

      var all = [];
      var cur = from;
      while (cur <= to) {
        var rec = await getEodByDateAndLoc(cur, state.location_name);
        if (rec) all.push(rec);
        // increment day
        var dt = new Date(cur + "T00:00:00");
        dt.setDate(dt.getDate() + 1);
        cur = ymd(dt);
      }

      all.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

      var totalCash = 0;
      var totalOU = 0;
      var totalCoins = 0;

      all.forEach(function (r) {
        var till = countedCashTill(r).total;
        var E2 = Math.max(0, till - moneyToNumber(r.float_amount));
        var exp = expectedDeposit(r);
        var F2 = roundToNearest5(E2);
        totalCash += E2;
        totalOU += (E2 - exp);
        totalCoins += (E2 - F2);
      });

      var rowsHtml = all.map(function (r) {
        var till = countedCashTill(r).total;
        var E2 = Math.max(0, till - moneyToNumber(r.float_amount));
        var exp = expectedDeposit(r);
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
        "<style>@media print{@page{size:A4;margin:12mm}} body{font-family:Arial,sans-serif} table{width:100%;border-collapse:collapse} th,td{border:1px solid #000;padding:6px;font-size:12px} th{background:#eee} .printbar{position:sticky;top:0;background:#fff;padding:8px;border-bottom:1px solid #ccc;display:flex;gap:8px;justify-content:flex-end}</style>" +
        "</head><body>" +
        "<div class='printbar'><button onclick='window.print()'>Print</button></div>" +
        "<h2>End Of Day — Range Report</h2>" +
        "<div><b>Location:</b> " + esc(state.location_name) + "</div>" +
        "<div><b>Range:</b> " + esc(ddmmyyyy(from)) + " to " + esc(ddmmyyyy(to)) + "</div>" +
        "<div style='margin:10px 0'><b>Totals:</b> Total Cash " + esc(euro(totalCash)) + " | Over/Under " + esc(euro(totalOU)) + " | Coin Box " + esc(euro(totalCoins)) + "</div>" +
        "<table><thead><tr><th>Date</th><th>Total Cash (E)</th><th>Over/Under</th><th>Staff</th><th>Status</th></tr></thead><tbody>" +
        (rowsHtml || "<tr><td colspan='5'>No records in range.</td></tr>") +
        "</tbody></table>" +
        "</body></html>";

      openPrintTabWithHtml(html);

      writeAudit(state.location_name, state.date, {
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "PRINT_RANGE",
        details: { from: from, to: to }
      });
    }

    // -----------------------------
    // Inputs
    // -----------------------------
    function makeMoneyInput(valueGetter, valueSetter, focusKey, disabled) {
      var inp = el("input", {
        class: "eikon-input eikon-slim-input",
        type: "text",
        inputmode: "decimal",
        value: String(valueGetter() == null ? "" : valueGetter()),
        disabled: !!disabled,
        "data-focus-key": focusKey
      });

      inp.onfocus = function () {
        // match HTML: select + clear if 0/0.00
        try { inp.select(); } catch (e) {}
        var v = String(inp.value || "");
        if (v === "0" || v === "0.00") inp.value = "";
      };

      inp.oninput = function () {
        var raw = inp.value;
        var r = moneyNormalizeInput(raw);
        if (!r.ok) {
          // revert by removing last char
          inp.value = String(valueGetter() == null ? "" : valueGetter());
          return;
        }
        valueSetter(r.normalized);
        // DO NOT rerender on every keystroke (prevents decimal typing issues)
        // Instead update dependent totals via rerender debounce-style:
        window.clearTimeout(inp._t);
        inp._t = window.setTimeout(function () {
          // If deposit not edited, keep autofill synced
          if (!state.deposit_edited) {
            autoFillDeposit(state, roundedDepositF(state), paperUnitsFromCash(state));
          }
          rerender();
        }, 0);
      };

      inp.onblur = function () {
        var raw2 = String(inp.value || "").trim();
        if (raw2 === "" || raw2 === "." || isNaN(Number(raw2))) {
          valueSetter("0");
          inp.value = "0";
        } else {
          // clamp to 2dp display
          var v2 = moneyToNumber(raw2);
          var fixed = (Math.round(v2 * 100) / 100).toFixed(2);
          valueSetter(fixed);
          inp.value = fixed;
        }
        if (!state.deposit_edited) {
          autoFillDeposit(state, roundedDepositF(state), paperUnitsFromCash(state));
        }
        rerender();
      };

      return inp;
    }

    function makeIntInput(valueGetter, valueSetter, focusKey, disabled) {
      var inp = el("input", {
        class: "eikon-input eikon-slim-input",
        type: "number",
        step: "1",
        min: "0",
        value: String(valueGetter() == null ? 0 : valueGetter()),
        disabled: !!disabled,
        "data-focus-key": focusKey
      });

      inp.onfocus = function () {
        try { inp.select(); } catch (e) {}
        if (String(inp.value || "") === "0") inp.value = "";
      };

      inp.oninput = function () {
        valueSetter(String(intToNumber(inp.value)));
        if (!state.deposit_edited) {
          autoFillDeposit(state, roundedDepositF(state), paperUnitsFromCash(state));
        }
        rerender();
      };

      inp.onblur = function () {
        if (String(inp.value || "").trim() === "") {
          valueSetter("0");
          inp.value = "0";
          rerender();
        }
      };

      return inp;
    }

    // -----------------------------
    // Payment table (X / EPOS / Cheques / Paid outs)
    // -----------------------------
    function makePaymentTable(title, rows, canAdd, locked, rowKeyPrefix) {
      var card = el("div", { class: "eikon-card" });

      var btnAdd = el("button", { class: "eikon-btn", text: "Add Entry", disabled: locked || !canAdd });
      btnAdd.onclick = function () {
        rows.push({ amount: "0", remark: "" });
        rerender();
      };

      card.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;", text: title }),
        btnAdd
      ]));

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

          tdName.textContent =
            title === "X Readings" ? ("X Reading " + (idx + 1)) :
            title === "EPOS" ? ("EPOS " + (idx + 1)) :
            title === "Cheques" ? ("Cheque " + (idx + 1)) :
            ("Paid Out " + (idx + 1));

          tdTot.textContent = euro(moneyToNumber(r.amount));

          var inAmt = makeMoneyInput(
            function () { return r.amount; },
            function (v) { r.amount = v; },
            rowKeyPrefix + "_amt_" + idx,
            locked
          );

          var inRem = el("input", { class: "eikon-input", type: "text", value: String(r.remark || ""), disabled: locked, "data-focus-key": rowKeyPrefix + "_rem_" + idx });
          inRem.oninput = function () { r.remark = String(inRem.value || ""); };

          tdAmt.appendChild(inAmt);
          tdRem.appendChild(inRem);

          if (rows.length > 1) {
            var btnDel = el("button", { class: "eikon-btn", text: "Remove", disabled: locked });
            btnDel.onclick = function () {
              rows.splice(idx, 1);
              rerender();
            };
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
    // Build UI
    // -----------------------------
    var headerCard = el("div", { class: "eikon-card" });
    var bodyCard = el("div", { class: "eikon-card" });

    var btnSave = el("button", { class: "eikon-btn primary", text: "Save", "data-allow-when-locked": "0" });
    var btnPrintA4 = el("button", { class: "eikon-btn", text: "Print End of Day on A4", "data-allow-when-locked": "1" });
    var btnLock = el("button", { class: "eikon-btn", text: "Lock", "data-allow-when-locked": "0" });
    var btnAudit = el("button", { class: "eikon-btn", text: "Audit Log", "data-allow-when-locked": "1" });

    btnSave.onclick = doSave;
    btnPrintA4.onclick = doPrintA4;
    btnLock.onclick = doLock;
    btnAudit.onclick = showAuditLog;

    var btnReport = el("button", { class: "eikon-btn", text: "Report (Date Range)", "data-allow-when-locked": "1" });
    btnReport.onclick = function () {
      var wrap = el("div");
      var inFrom = el("input", { class: "eikon-input", type: "date", value: state.date });
      var inTo = el("input", { class: "eikon-input", type: "date", value: state.date });
      wrap.appendChild(el("div", { class: "eikon-help", text: "Print a summary for a selected date range (for the current location)." }));
      wrap.appendChild(el("div", { class: "eikon-row", style: "margin-top:10px;gap:10px;flex-wrap:wrap;" }, [
        field("From", inFrom),
        field("To", inTo)
      ]));
      showModal("EOD Range Report", wrap, [
        { text: "Cancel", primary: false, onClick: function (close) { close(); } },
        { text: "Print", primary: true, onClick: function (close) { close(); doPrintRangeReport(inFrom.value, inTo.value); } }
      ]);
    };

    var statusLine = el("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;" });
    statusLine.appendChild(state.locked_at ? statusPill("Locked", "good") : statusPill("Unlocked", "warn"));
    statusLine.appendChild(state.saved_at ? statusPill("Saved", "good") : statusPill("Not Saved", "bad"));
    statusLine.appendChild(_apiMode.ok ? statusPill("Cloud: ON", "good") : statusPill("Cloud: OFF", "bad"));

    var inDate = el("input", { class: "eikon-input eikon-slim-input", type: "date", value: state.date, "data-allow-when-locked": "1" });
    inDate.onchange = async function () {
      state.date = inDate.value;
      await loadSelectedDate();
      rerender();
    };

    var selTime = el("select", { class: "eikon-select eikon-slim-input", "data-allow-when-locked": "0" }, [
      el("option", { value: "AM", text: "AM" }),
      el("option", { value: "PM", text: "PM" })
    ]);
    selTime.value = state.time_of_day || "AM";
    selTime.onchange = function () { state.time_of_day = selTime.value; };

    var inStaff = el("input", { class: "eikon-input", type: "text", value: state.staff || "", placeholder: "Required", "data-allow-when-locked": "0" });
    inStaff.oninput = function () { state.staff = inStaff.value; };

    var inLoc = el("input", { class: "eikon-input", type: "text", value: state.location_name || "", disabled: true, "data-allow-when-locked": "1" });

    var inFloat = makeMoneyInput(
      function () { return state.float_amount; },
      function (v) { state.float_amount = v; },
      "float_amount",
      isLocked()
    );
    inFloat.dataset.allowWhenLocked = "0";

    var topRow = el("div", { class: "eikon-row", style: "gap:10px;flex-wrap:wrap;" }, [
      btnSave, btnReport, btnPrintA4, btnLock, btnAudit
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
    paymentsWrap.appendChild(makePaymentTable("X Readings", state.x, true, isLocked(), "x"));
    paymentsWrap.appendChild(makePaymentTable("EPOS", state.epos, true, isLocked(), "epos"));
    paymentsWrap.appendChild(makePaymentTable("Cheques", state.cheques, true, isLocked(), "chq"));
    paymentsWrap.appendChild(makePaymentTable("Paid Outs", state.paid_outs, true, isLocked(), "po"));

    // Cash count + BOV deposit
    var cashCard = el("div", { class: "eikon-card" });
    cashCard.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;" }, [
      el("div", { style: "font-weight:900;color:#e9eef7;", text: "Cash Count" })
    ]));

    var cashGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;" });

    // left: cash notes + coins total
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

      var inp = makeIntInput(
        function () { return state.cash[key]; },
        function (v) { state.cash[key] = v; },
        "cash_" + key,
        isLocked()
      );

      tdC.appendChild(inp);
      tdT.textContent = euro(intToNumber(state.cash[key]) * denom);

      tr.appendChild(tdD); tr.appendChild(tdC); tr.appendChild(tdT);
      return tr;
    }

    var cashBody = el("tbody");
    cashBody.appendChild(cashRow("€500", 500, "n500"));
    cashBody.appendChild(cashRow("€200", 200, "n200"));
    cashBody.appendChild(cashRow("€100", 100, "n100"));
    cashBody.appendChild(cashRow("€50", 50, "n50"));
    cashBody.appendChild(cashRow("€20", 20, "n20"));
    cashBody.appendChild(cashRow("€10", 10, "n10"));
    cashBody.appendChild(cashRow("€5", 5, "n5"));

    // coins total (money)
    (function () {
      var tr = el("tr", {}, []);
      var tdD = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);", text: "Coins (total)" });
      var tdC = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;" });
      var tdT = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

      var inp = makeMoneyInput(
        function () { return state.cash.coins_total; },
        function (v) { state.cash.coins_total = v; },
        "cash_coins_total",
        isLocked()
      );
      tdC.appendChild(inp);
      tdT.textContent = euro(moneyToNumber(state.cash.coins_total));

      tr.appendChild(tdD); tr.appendChild(tdC); tr.appendChild(tdT);
      cashBody.appendChild(tr);
    })();

    tblCash.appendChild(cashBody);

    var counted = countedCashTill(state);

    leftCash.appendChild(tblCash);
    leftCash.appendChild(el("div", { style: "margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;display:flex;justify-content:space-between;align-items:center;" }, [
      el("div", { style: "font-weight:900;", text: "Total Cash (Till):" }),
      el("div", { style: "font-weight:900;", text: euro(counted.total) })
    ]));

    // right: BOV deposit
    var rightBov = el("div", {});
    rightBov.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:6px;", text: "BOV Cash Deposit" }));

    var contacts = await loadContacts(state.location_name);

    var selContact = el("select", { class: "eikon-select", disabled: isLocked() });
    selContact.appendChild(el("option", { value: "", text: "— Select Contact —" }));
    contacts.forEach(function (c) {
      var parts = [c.name];
      if (c.email) parts.push(c.email);
      if (c.phone) parts.push(c.phone);
      selContact.appendChild(el("option", { value: c.id, text: parts.join(" • ") }));
    });
    selContact.value = state.contact_id || "";
    selContact.onchange = function () { state.contact_id = selContact.value; };

    var btnManageContacts = el("button", { class: "eikon-btn", text: "Manage Contacts", disabled: isLocked() });
    btnManageContacts.onclick = function () {
      showContactsManager(state.location_name, function () { rerender(); });
    };

    var inBag = el("input", { class: "eikon-input", type: "text", value: state.bag_number || "", disabled: isLocked(), "data-focus-key": "bag_number" });
    inBag.oninput = function () { state.bag_number = inBag.value; };

    var btnCopyDeposit = el("button", { class: "eikon-btn primary", text: "Copy Deposit to Email (Outlook)", disabled: isLocked() });
    btnCopyDeposit.onclick = async function () {
      var c = contacts.filter(function (x) { return String(x.id) === String(state.contact_id); })[0] || null;
      await copyDepositToClipboard(state, c);
    };

    rightBov.appendChild(el("div", { class: "eikon-row", style: "gap:10px;flex-wrap:wrap;align-items:flex-end;" }, [
      field("Bag Number", inBag),
      field("Contact", selContact),
      btnManageContacts
    ]));

    rightBov.appendChild(el("div", { style: "margin-top:8px;display:flex;justify-content:flex-end;" }, [btnCopyDeposit]));

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

      var inp = makeIntInput(
        function () { return state.deposit[key]; },
        function (v) {
          state.deposit[key] = v;
          state.deposit_edited = true; // stop auto-fill once user edits
        },
        "dep_" + key,
        isLocked()
      );

      tdC.appendChild(inp);
      tdT.textContent = euro(intToNumber(state.deposit[key]) * denom);

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
    depBody.appendChild(depRow("€5", 5, "n5"));
    tblDep.appendChild(depBody);

    rightBov.appendChild(tblDep);

    rightBov.appendChild(el("div", { style: "margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;display:flex;justify-content:space-between;align-items:center;" }, [
      el("div", { style: "font-weight:900;", text: "Total BOV Deposit:" }),
      el("div", { style: "font-weight:900;", text: euro(bovTotal(state)) })
    ]));

    cashGrid.appendChild(leftCash);
    cashGrid.appendChild(rightBov);
    cashCard.appendChild(cashGrid);

    // Summary cards (MATCH HTML)
    var summaryGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;" });

    var sumCard = el("div", { class: "eikon-card" });
    sumCard.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:10px;", text: "Summary" }));

    var exp = expectedDeposit(state);
    var Etotal = totalCashE(state);
    var Ftotal = roundedDepositF(state);
    var OU = overUnder(state);
    var COINS = coinsDiff(state);

    sumCard.appendChild(el("div", { style: "display:grid;gap:8px;" }, [
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Expected Deposit (A − B − C − D):" }),
        el("div", { style: "font-weight:900;", text: euro(exp) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "E — Total Cash (Till − Float):" }),
        el("div", { style: "font-weight:900;", text: euro(Etotal) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "F — Rounded Cash Deposited:" }),
        el("div", { style: "font-weight:900;", text: euro(Ftotal) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Over / Under (E − Expected):" }),
        el("div", { style: "font-weight:900;", text: euro(Math.abs(OU)) + (OU < 0 ? " (UNDER)" : OU > 0 ? " (OVER)" : "") })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Coins (E − F):" }),
        el("div", { style: "font-weight:900;", text: euro(COINS) })
      ])
    ]));

    var m = await monthSummary(state, ymFromYmd(state.date));
    var monthCard = el("div", { class: "eikon-card" });
    monthCard.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:10px;", text: "Monthly Summary" }));
    monthCard.appendChild(el("div", { style: "display:grid;gap:8px;" }, [
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

    // Compose
    bodyCard.appendChild(paymentsWrap);
    bodyCard.appendChild(cashCard);
    bodyCard.appendChild(summaryGrid);

    mount.appendChild(headerCard);
    mount.appendChild(bodyCard);

    // Lock behaviour
    if (isLocked()) {
      setDisabledDeep(bodyCard, true);
      var allHdrInputs = headerCard.querySelectorAll("input,select,button");
      for (var z = 0; z < allHdrInputs.length; z++) {
        var t = allHdrInputs[z];
        var allow = t && t.dataset && t.dataset.allowWhenLocked === "1";
        if (!allow && t !== btnPrintA4 && t !== btnReport && t !== btnAudit && t !== inDate) t.disabled = true;
      }
      btnSave.disabled = true;
      btnLock.disabled = true;
    } else {
      btnSave.disabled = false;
      btnLock.disabled = false;
    }
  }

  // Register module
  E.registerModule({
    id: "endofday",
    name: "End Of Day",
    icon: "clock",
    render: function (ctx) {
      _mountRef = ctx;
      return render(ctx);
    }
  });

})();
