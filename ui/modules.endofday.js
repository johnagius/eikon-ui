/* ui/modules.endofday.js
   Eikon - End Of Day module (UI)
   Persistence currently uses localStorage so the UI is testable immediately.

   FIXES INCLUDED (2026-02-12):
   - Keep Unlock / Print / Report / Audit / Admin-clear enabled when EOD is locked.
   - Admin: Clear Local EOD Data now fully clears EOD localStorage and resets module state.
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // -----------------------------
  // Debug
  // -----------------------------
  function dbgEnabled() {
    try { return !!(E && E.state && Number(E.state.dbg || 0) >= 2); } catch (e) { return false; }
  }
  function DBG() {
    if (!dbgEnabled()) return;
    try { console.log.apply(console, ["[EIKON][eod]"].concat([].slice.call(arguments))); } catch (e) {}
  }

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

  function nowIso() { try { return new Date().toISOString(); } catch (e) { return ""; } }

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

  function roundToNearest5(n) { return Math.round(Number(n || 0) / 5) * 5; }

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

    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e3) {}
    }, 60000);
  }

  // -----------------------------
  // Local storage “DB” (temporary)
  // -----------------------------
  var LS_EOD_KEY = "eikon_eod_records_v1";
  var LS_EOD_CONTACTS_KEY = "eikon_eod_contacts_v1";
  var LS_EOD_AUDIT_KEY = "eikon_eod_audit_v1";

  function loadAllEods() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_KEY) || "[]";
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveAllEods(arr) {
    try { window.localStorage.setItem(LS_EOD_KEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function getEodByDateAndLoc(dateStr, locationName) {
    var all = loadAllEods();
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (r && r.date === dateStr && r.location_name === locationName) return r;
    }
    return null;
  }

  function upsertEod(rec) {
    var all = loadAllEods();
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

    saveAllEods(all);
  }

  function loadContacts() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_CONTACTS_KEY) || "";
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveContacts(arr) {
    try { window.localStorage.setItem(LS_EOD_CONTACTS_KEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function loadAudit() {
    try {
      var raw = window.localStorage.getItem(LS_EOD_AUDIT_KEY) || "[]";
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function writeAudit(entry) {
    var all = loadAudit();
    all.push(entry);
    try { window.localStorage.setItem(LS_EOD_AUDIT_KEY, JSON.stringify(all)); } catch (e) {}
  }

  function auditFor(dateStr, locationName) {
    var all = loadAudit();
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

  function clearLocalEodAll() {
    try { window.localStorage.removeItem(LS_EOD_KEY); } catch (e) {}
    try { window.localStorage.removeItem(LS_EOD_CONTACTS_KEY); } catch (e2) {}
    try { window.localStorage.removeItem(LS_EOD_AUDIT_KEY); } catch (e3) {}
  }

  // -----------------------------
  // Modal
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

    var head = el("div", {
      style: "display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px;"
    }, [
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
  // Module persistent state
  // -----------------------------
  var _mountRef = null;
  var _state = null;

  function makeDefaultState(locationName, createdBy, dateStr) {
    return {
      date: dateStr || ymd(new Date()),
      time_of_day: "AM",
      staff: "",
      location_name: locationName,
      created_by: createdBy,
      float_amount: 500,

      // A: X readings (4)
      x: [
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" }
      ],

      // B: EPOS (4)
      epos: [
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" },
        { amount: 0, remark: "" }
      ],

      // C: Cheques (2 by default)
      cheques: [
        { amount: 0, remark: "" },
        { amount: 0, remark: "" }
      ],

      // D: Paid outs (1 by default)
      paid_outs: [
        { amount: 0, remark: "" }
      ],

      // Cash count
      cash: { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, n5: 0, coins_total: 0 },

      // BOV deposit
      bag_number: "",
      deposit: { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0 },
      contact_id: "",

      // meta
      saved_at: "",
      locked_at: ""
    };
  }

  function deepCopy(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  }

  function loadRecordIntoState(dateStr, locationName, createdBy) {
    var existing = getEodByDateAndLoc(dateStr, locationName);
    if (existing) return deepCopy(existing);
    return makeDefaultState(locationName, createdBy, dateStr);
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
    var bg = kind === "good" ? "rgba(67,209,122,.14)"
      : kind === "warn" ? "rgba(255,200,90,.14)"
      : kind === "bad" ? "rgba(255,90,122,.14)"
      : "rgba(120,140,170,.16)";

    var bd = kind === "good" ? "rgba(67,209,122,.35)"
      : kind === "warn" ? "rgba(255,200,90,.35)"
      : kind === "bad" ? "rgba(255,90,122,.35)"
      : "rgba(120,140,170,.28)";

    return el("span", {
      style: "display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;" +
        "border:1px solid " + bd + ";background:" + bg + ";font-size:12px;color:#e9eef7;"
    }, [text]);
  }

  function toast(title, msg) {
    window.alert((title ? title + "\n\n" : "") + (msg || ""));
  }

  // ✅ FIX: allow certain buttons even when locked (no need to rely on dataset wiring)
  function setDisabledDeep(node, disabled) {
    var inputs = node.querySelectorAll("input,select,textarea,button");
    for (var i = 0; i < inputs.length; i++) {
      var t = inputs[i];
      if (!t) continue;

      // Always allow explicitly marked controls
      if (t.dataset && t.dataset.allowWhenLocked === "1") continue;

      // Also allow these by label (covers cases where dataset isn’t set)
      if (t.tagName === "BUTTON") {
        var txt = String(t.textContent || "").trim();
        if (
          txt === "Unlock (Master Key)" ||
          txt === "Print End of Day on A4" ||
          txt === "Report (Date Range)" ||
          txt === "Audit Log" ||
          txt === "Admin: Clear Local EOD Data" ||
          txt === "Logout" // harmless; some shells include it
        ) {
          continue;
        }
      }

      t.disabled = !!disabled;
    }
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
      50 * parseNum(c.n50) +
      20 * parseNum(c.n20) +
      10 * parseNum(c.n10) +
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

  function roundedDepositF(state) { return roundToNearest5(totalCashE(state)); }
  function overUnder(state) { return totalCashE(state) - expectedDeposit(state); }
  function coinsDiff(state) { return totalCashE(state) - roundedDepositF(state); }

  function bovTotal(state) {
    var d = state.deposit || {};
    return (
      500 * parseNum(d.n500) +
      200 * parseNum(d.n200) +
      100 * parseNum(d.n100) +
      50 * parseNum(d.n50) +
      20 * parseNum(d.n20) +
      10 * parseNum(d.n10)
    );
  }

  // -----------------------------
  // Validation + Save + Lock + Unlock + Audit
  // -----------------------------
  function validateBeforeSave(state) {
    var staff = String(state.staff || "").trim();
    if (!staff) return { ok: false, msg: "Staff is required." };

    var loc = String(state.location_name || "").trim();
    if (!loc) return { ok: false, msg: "Location is missing (login location)." };

    var fl = parseNum(state.float_amount);
    if (!(fl >= 0)) return { ok: false, msg: "Float must be a number (>= 0)." };

    var hasDeposit = bovTotal(state) > 0 || String(state.bag_number || "").trim() !== "";
    if (hasDeposit && !String(state.bag_number || "").trim()) {
      return { ok: false, msg: "Bag Number is required when BOV deposit is used." };
    }

    return { ok: true };
  }

  function isLocked(state) { return !!state.locked_at; }

  function monthSummary(state, monthYm) {
    var all = loadAllEods();
    var loc = state.location_name;
    var m = monthYm || ymFromYmd(state.date);
    var list = all.filter(function (r) { return r && r.location_name === loc && ymFromYmd(r.date) === m; });

    var sumE = 0, sumOU = 0, sumCoins = 0;

    list.forEach(function (r) {
      var e = (function (rr) {
        var notes =
          500 * parseNum(rr.cash.n500) +
          200 * parseNum(rr.cash.n200) +
          100 * parseNum(rr.cash.n100) +
          50 * parseNum(rr.cash.n50) +
          20 * parseNum(rr.cash.n20) +
          10 * parseNum(rr.cash.n10) +
          5 * parseNum(rr.cash.n5);
        var till = notes + parseNum(rr.cash.coins_total);
        var fl = parseNum(rr.float_amount);
        var E2 = till - fl;
        if (E2 < 0) E2 = 0;
        return E2;
      })(r);

      var exp = (function (rr) {
        var X2 = rr.x.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
        var B2 = rr.epos.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
        var C2 = rr.cheques.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
        var D2 = rr.paid_outs.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
        return X2 - B2 - C2 - D2;
      })(r);

      var F2 = roundToNearest5(e);
      sumE += e;
      sumOU += (e - exp);
      sumCoins += (e - F2);
    });

    return { days: list.length, total_cash_month: sumE, over_under_month: sumOU, coin_box_month: sumCoins };
  }

  // -----------------------------
  // Printing (A4)
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

    function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    function row(lbl, val, note) {
      return "<tr>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #e6e6e6;font-weight:700;'>" + esc(lbl) + "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #e6e6e6;text-align:right;white-space:nowrap;'>€ " + esc(fmt(val)) + "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #e6e6e6;color:#333;'>" + (note ? esc(note) : "") + "</td>" +
        "</tr>";
    }

    var ouText = (OU < 0 ? "-€ " + fmt(Math.abs(OU)) : "€ " + fmt(Math.abs(OU)));
    var ouNote = (OU < 0 ? "(- UNDER)" : (OU > 0 ? "(OVER)" : ""));

    var html =
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<title>EOD (A4)</title>" +
      "<style>" +
      "body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#000;}" +
      ".hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}" +
      ".hdr h1{margin:0;font-size:18px;}" +
      ".meta{font-size:12px;line-height:1.35;}" +
      "table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px;}" +
      "th{background:#f2f2f2;text-align:left;padding:6px 8px;border:1px solid #ddd;}" +
      "td{border:1px solid #ddd;}" +
      ".summary{margin-top:10px;border:1px solid #ddd;border-radius:8px;padding:10px;}" +
      ".k{font-weight:800;}" +
      "</style></head><body>" +
      "<div class='hdr'><h1>End Of Day</h1><div class='meta'>" +
      "<div><span class='k'>DATE:</span> " + esc(ddmmyyyy(d)) + "</div>" +
      "<div><span class='k'>STAFF:</span> " + esc(staff) + "</div>" +
      "<div><span class='k'>LOCATION:</span> " + esc(loc) + "</div>" +
      "</div></div>" +

      "<table>" +
      "<thead><tr><th>Item</th><th style='text-align:right;'>Amount</th><th>Remark</th></tr></thead>" +
      "<tbody>" +
      row("A1 X READING 1", Avals[0], Arem[0]) +
      row("A2 X READING 2", Avals[1], Arem[1]) +
      row("A3 X READING 3", Avals[2], Arem[2]) +
      row("A4 X READING 4", Avals[3], Arem[3]) +
      row("TOTAL X READINGS", Atot, "") +
      row("B1 EPOS", Bvals[0], "") +
      row("B2 EPOS", Bvals[1], "") +
      row("B3 EPOS", Bvals[2], "") +
      row("B4 EPOS", Bvals[3], "") +
      row("TOTAL EPOS", Btot, "") +
      row("C1 CHEQUES", Cvals[0], Crem[0]) +
      row("C2 CHEQUES", Cvals[1], Crem[1]) +
      row("C3 CHEQUES", Cvals[2], Crem[2]) +
      row("C4 CHEQUES", Cvals[3], Crem[3]) +
      row("TOTAL CHEQUES", Ctot, "") +
      row("D1 PAID OUTS", Dvals[0], Drem[0]) +
      row("D2 PAID OUTS", Dvals[1], Drem[1]) +
      row("D3 PAID OUTS", Dvals[2], Drem[2]) +
      row("D4 PAID OUTS", Dvals[3], Drem[3]) +
      row("D5 PAID OUTS", Dvals[4], Drem[4]) +
      row("D6 PAID OUTS", Dvals[5], Drem[5]) +
      row("D7 PAID OUTS", Dvals[6], Drem[6]) +
      row("D8 PAID OUTS", Dvals[7], Drem[7]) +
      row("TOTAL PAID OUTS", Dtot, "") +
      row("E TOTAL CASH (Till - Float " + euro(fl) + ")", Etotal, "") +
      row("F ROUNDED CASH DEPOSITED", Ftotal, "") +
      "</tbody></table>" +

      "<div class='summary'>" +
      "<div><span class='k'>COINS (E − F):</span> " + esc(euro(COINS)) + "</div>" +
      "<div><span class='k'>OVER/UNDER:</span> " + esc(ouText) + " " + esc(ouNote) + "</div>" +
      "<div style='margin-top:6px;color:#333;font-size:11px;'>Till notes: " + esc(euro(counted.notes)) + " • Coins: " + esc(euro(counted.coins)) + "</div>" +
      "</div>" +

      "<script>window.onload=function(){window.print(); setTimeout(function(){window.close();},300);};</script>" +
      "</body></html>";

    return html;
  }

  function doPrintA4(state, createdBy) {
    var v = validateBeforeSave(state);
    if (!v.ok) return toast("Missing Information", "Cannot print until required fields are completed:\n\n" + v.msg);

    openPrintTabWithHtml(buildA4HtmlForCurrent(state));
    writeAudit({ ts: nowIso(), date: state.date, location_name: state.location_name, by: createdBy, action: "PRINT_A4", details: {} });
  }

  function doPrintRangeReport(state, createdBy, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return toast("Validation", "From/To must be dates (YYYY-MM-DD).");
    }
    if (to < from) return toast("Validation", "To must be >= From.");

    var all = loadAllEods()
      .filter(function (r) { return r && r.location_name === state.location_name && r.date >= from && r.date <= to; })
      .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

    var totalCash = 0, totalOU = 0, totalCoins = 0;

    all.forEach(function (r) {
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
      var E2 = till - fl; if (E2 < 0) E2 = 0;

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

    var rowsHtml = all.map(function (r) {
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
      var E2 = till - fl; if (E2 < 0) E2 = 0;

      var X2 = r.x.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var B2 = r.epos.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var C2 = r.cheques.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var D2 = r.paid_outs.reduce(function (a, t) { return a + parseNum(t.amount); }, 0);
      var exp = X2 - B2 - C2 - D2;

      var ou = E2 - exp;

      return "<tr>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;white-space:nowrap;'>" + esc(ddmmyyyy(r.date)) + "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap;'>" + esc(euro(E2)) + "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap;'>" + esc(euro(ou)) + "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;'>" + esc(String(r.staff || "")) + "</td>" +
        "<td style='padding:6px 8px;border-bottom:1px solid #ddd;'>" + esc(r.locked_at ? "Locked" : "") + "</td>" +
        "</tr>";
    }).join("");

    var html =
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<title>EOD Range Report</title>" +
      "<style>" +
      "body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#000;}" +
      "h1{margin:0 0 10px 0;font-size:18px;}" +
      ".meta{font-size:12px;margin-bottom:10px;line-height:1.4;color:#222;}" +
      "table{width:100%;border-collapse:collapse;font-size:12px;}" +
      "th{background:#f2f2f2;text-align:left;padding:6px 8px;border:1px solid #ddd;}" +
      "td{border:1px solid #ddd;}" +
      "</style></head><body>" +
      "<h1>End Of Day — Range Report</h1>" +
      "<div class='meta'>" +
      "<div><b>Location:</b> " + esc(state.location_name) + "</div>" +
      "<div><b>Range:</b> " + esc(ddmmyyyy(from)) + " to " + esc(ddmmyyyy(to)) + "</div>" +
      "<div><b>Totals:</b> Total Cash " + esc(euro(totalCash)) + " | Over/Under " + esc(euro(totalOU)) + " | Coin Box " + esc(euro(totalCoins)) + "</div>" +
      "</div>" +
      "<table><thead><tr>" +
      "<th>Date</th><th style='text-align:right;'>Total Cash (E)</th><th style='text-align:right;'>Over/Under</th><th>Staff</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      (rowsHtml || "<tr><td colspan='5' style='padding:10px;color:#444;'>No records in range.</td></tr>") +
      "</tbody></table>" +
      "<script>window.onload=function(){window.print(); setTimeout(function(){window.close();},300);};</script>" +
      "</body></html>";

    openPrintTabWithHtml(html);
    writeAudit({ ts: nowIso(), date: state.date, location_name: state.location_name, by: createdBy, action: "PRINT_RANGE", details: { from: from, to: to } });
  }

  // -----------------------------
  // Contacts manager (simple)
  // -----------------------------
  function showContactsManager(onDone) {
    var contacts = loadContacts();

    function renderList(container) {
      container.innerHTML = "";

      var topRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;" });
      var inName = el("input", { class: "eikon-input", placeholder: "Name (e.g. Accounts)" });
      var inPhone = el("input", { class: "eikon-input", placeholder: "Phone (optional)" });
      var btnAdd = el("button", { class: "eikon-btn primary", text: "Add" });

      btnAdd.onclick = function () {
        var name = String(inName.value || "").trim();
        var phone = String(inPhone.value || "").trim();
        if (!name) return toast("Validation", "Name is required.");

        var id = "c_" + Math.random().toString(16).slice(2) + "_" + Date.now();
        contacts.push({ id: id, name: name, phone: phone });
        saveContacts(contacts);

        inName.value = "";
        inPhone.value = "";
        renderList(container);
      };

      topRow.appendChild(field("New Contact Name", inName));
      topRow.appendChild(field("Phone", inPhone));
      topRow.appendChild(btnAdd);
      container.appendChild(topRow);

      var tbl = el("table", { style: "width:100%;border-collapse:collapse;" });
      tbl.appendChild(el("thead", {}, [
        el("tr", {}, [
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Name" }),
          el("th", { style: "text-align:left;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Phone" }),
          el("th", { style: "text-align:right;border-bottom:1px solid rgba(255,255,255,.12);padding:8px;", text: "Actions" })
        ])
      ]));

      var tbody = el("tbody");

      if (!contacts.length) {
        tbody.appendChild(el("tr", {}, [
          el("td", { colspan: "3", style: "padding:10px;color:rgba(233,238,247,.75);", text: "No contacts yet. Add your first contact above." })
        ]));
      } else {
        contacts.forEach(function (c) {
          var tr = el("tr", {}, []);
          var tdName = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
          var tdPhone = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);" });
          var tdAct = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

          var inN = el("input", { class: "eikon-input", value: c.name || "" });
          var inP = el("input", { class: "eikon-input", value: c.phone || "" });

          var btnSave = el("button", { class: "eikon-btn primary", text: "Save" });
          var btnDel = el("button", { class: "eikon-btn", text: "Delete" });

          btnSave.onclick = function () {
            var nn = String(inN.value || "").trim();
            if (!nn) return toast("Validation", "Name cannot be empty.");
            c.name = nn;
            c.phone = String(inP.value || "").trim();
            saveContacts(contacts);
            renderList(container);
          };

          btnDel.onclick = function () {
            var ok = window.confirm("Delete this contact?\n\n" + (c.name || ""));
            if (!ok) return;
            contacts = contacts.filter(function (x) { return x.id !== c.id; });
            saveContacts(contacts);
            renderList(container);
          };

          tdName.appendChild(inN);
          tdPhone.appendChild(inP);
          tdAct.appendChild(btnSave);
          tdAct.appendChild(el("span", { style: "display:inline-block;width:8px;" }));
          tdAct.appendChild(btnDel);

          tr.appendChild(tdName);
          tr.appendChild(tdPhone);
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
      { text: "Done", primary: true, onClick: function (close) { close(); if (onDone) onDone(); } }
    ]);
  }

  function showAuditLog(state) {
    var rows = auditFor(state.date, state.location_name);
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
  // UI section builders
  // -----------------------------
  function makeMoneyRow(label, rowObj, onChange) {
    var inAmt = el("input", { class: "eikon-input", type: "number", value: String(rowObj.amount || 0) });
    var inRem = el("input", { class: "eikon-input", value: String(rowObj.remark || "") });

    inAmt.onchange = inAmt.onblur = function () {
      rowObj.amount = parseNum(inAmt.value);
      onChange && onChange();
    };
    inRem.onchange = inRem.onblur = function () {
      rowObj.remark = String(inRem.value || "");
      onChange && onChange();
    };

    return el("div", { style: "display:grid;grid-template-columns:1fr 160px 1fr;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);" }, [
      el("div", { style: "font-weight:800;color:#e9eef7;" , text: label }),
      inAmt,
      inRem
    ]);
  }

  function makeSectionCard(title, rightNode, bodyNode) {
    return el("div", { class: "eikon-card", style: "margin-top:14px;padding:14px;border:1px solid rgba(255,255,255,.10);border-radius:16px;background:rgba(15,22,34,.55);" }, [
      el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;" }, [
        el("div", { style: "font-weight:900;font-size:16px;color:#e9eef7;", text: title }),
        rightNode || el("div")
      ]),
      bodyNode
    ]);
  }

  // -----------------------------
  // Render
  // -----------------------------
  async function render(mount) {
    DBG("render() mount=", mount, "state?", !!_state);

    if (!mount || typeof mount !== "object" || typeof mount.innerHTML !== "string") {
      DBG("render(): invalid mount", mount);
      return;
    }

    mount.innerHTML = "";

    var user = E.state && E.state.user ? E.state.user : null;
    var locationName = user && user.location_name ? String(user.location_name) : "";
    var createdBy = user && user.full_name ? String(user.full_name) : (user && user.email ? String(user.email) : "");

    // Initialize persistent state once
    if (!_state) {
      _state = loadRecordIntoState(ymd(new Date()), locationName, createdBy);
      DBG("initialized state for", _state.date, _state.location_name);
    } else {
      _state.location_name = locationName || _state.location_name || "";
      _state.created_by = createdBy || _state.created_by || "";
    }

    var state = _state;

    function rerender() { render(_mountRef || mount); }

    // -----------------------------
    // Handlers
    // -----------------------------
    function doSave() {
      if (isLocked(state)) return toast("Locked", "This End Of Day is locked and cannot be edited.");
      var v = validateBeforeSave(state);
      if (!v.ok) return toast("Missing Information", v.msg);

      state.saved_at = nowIso();
      upsertEod(deepCopy(state));
      writeAudit({ ts: nowIso(), date: state.date, location_name: state.location_name, by: createdBy, action: "SAVE", details: { staff: state.staff, float_amount: state.float_amount } });
      rerender();
    }

    function doLock() {
      if (isLocked(state)) return toast("Already Locked", "This End Of Day is already locked.");
      var v = validateBeforeSave(state);
      if (!v.ok) return toast("Cannot Lock", "Fix required fields first:\n\n" + v.msg);

      state.saved_at = state.saved_at || nowIso();
      state.locked_at = nowIso();
      upsertEod(deepCopy(state));
      writeAudit({ ts: nowIso(), date: state.date, location_name: state.location_name, by: createdBy, action: "LOCK", details: {} });
      rerender();
    }

    function doUnlock() {
      if (!isLocked(state)) return toast("Not Locked", "This End Of Day is not locked.");

      var pin = window.prompt("Enter master key to unlock this End Of Day:", "");
      if (pin == null) return;
      if (String(pin).trim() !== "6036") return toast("Incorrect", "Master key is incorrect.");

      state.locked_at = "";
      state.saved_at = nowIso();
      upsertEod(deepCopy(state));
      writeAudit({ ts: nowIso(), date: state.date, location_name: state.location_name, by: createdBy, action: "UNLOCK", details: {} });
      rerender();
    }

    function doAdminClearLocal() {
      var ok = window.confirm(
        "This will clear ALL End Of Day local data on this device:\n\n" +
        "- saved records\n- contacts\n- audit log\n\n" +
        "Continue?"
      );
      if (!ok) return;

      clearLocalEodAll();
      _state = null;
      writeAudit({ ts: nowIso(), date: ymd(new Date()), location_name: locationName, by: createdBy, action: "ADMIN_CLEAR_LOCAL", details: {} });
      rerender();
    }

    // -----------------------------
    // Top header + actions
    // -----------------------------
    var header = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;" }, [
      el("div", { style: "font-weight:950;font-size:22px;color:#e9eef7;", text: "End Of Day" }),
      el("div")
    ]);

    var btnRow = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;" });

    var btnSave = el("button", { class: "eikon-btn primary", text: "Save" });
    btnSave.onclick = doSave;

    var btnReport = el("button", { class: "eikon-btn", text: "Report (Date Range)" });
    btnReport.dataset.allowWhenLocked = "1";
    btnReport.onclick = function () {
      var body = el("div", {}, []);
      var inFrom = el("input", { class: "eikon-input", type: "date", value: state.date });
      var inTo = el("input", { class: "eikon-input", type: "date", value: state.date });
      body.appendChild(field("From", inFrom));
      body.appendChild(field("To", inTo));
      showModal("Print Range Report", body, [
        { text: "Cancel", onClick: function (close) { close(); } },
        {
          text: "Print", primary: true, onClick: function (close) {
            close();
            doPrintRangeReport(state, createdBy, String(inFrom.value || ""), String(inTo.value || ""));
          }
        }
      ]);
    };

    var btnPrint = el("button", { class: "eikon-btn", text: "Print End of Day on A4" });
    btnPrint.dataset.allowWhenLocked = "1";
    btnPrint.onclick = function () { doPrintA4(state, createdBy); };

    var btnLock = el("button", { class: "eikon-btn", text: "Lock" });
    btnLock.onclick = doLock;

    var btnUnlock = el("button", { class: "eikon-btn", text: "Unlock (Master Key)" });
    btnUnlock.dataset.allowWhenLocked = "1";
    btnUnlock.onclick = doUnlock;

    var btnAudit = el("button", { class: "eikon-btn", text: "Audit Log" });
    btnAudit.dataset.allowWhenLocked = "1";
    btnAudit.onclick = function () { showAuditLog(state); };

    btnRow.appendChild(btnSave);
    btnRow.appendChild(btnReport);
    btnRow.appendChild(btnPrint);
    btnRow.appendChild(btnLock);
    btnRow.appendChild(btnUnlock);
    btnRow.appendChild(btnAudit);

    var btnAdminClear = el("button", { class: "eikon-btn", text: "Admin: Clear Local EOD Data" });
    btnAdminClear.dataset.allowWhenLocked = "1";
    btnAdminClear.onclick = doAdminClearLocal;

    // -----------------------------
    // Meta row
    // -----------------------------
    var metaGrid = el("div", { style: "display:grid;grid-template-columns:repeat(5,minmax(160px,1fr));gap:12px;align-items:end;" });

    var inDate = el("input", { class: "eikon-input", type: "date", value: state.date });
    inDate.onchange = function () {
      // Load the correct record for selected date
      _state = loadRecordIntoState(String(inDate.value || ""), state.location_name, createdBy);
      rerender();
    };

    var selTod = el("select", { class: "eikon-input" }, [
      el("option", { value: "AM", text: "AM" }),
      el("option", { value: "PM", text: "PM" })
    ]);
    selTod.value = state.time_of_day || "AM";
    selTod.onchange = function () { state.time_of_day = String(selTod.value || "AM"); };

    var inStaff = el("input", { class: "eikon-input", value: String(state.staff || "") });
    inStaff.onchange = inStaff.onblur = function () { state.staff = String(inStaff.value || ""); };

    var inLoc = el("input", { class: "eikon-input", value: String(state.location_name || ""), disabled: true });

    var inFloat = el("input", { class: "eikon-input", type: "number", value: String(state.float_amount || 0) });
    inFloat.onchange = inFloat.onblur = function () { state.float_amount = parseNum(inFloat.value); rerender(); };

    metaGrid.appendChild(field("Date", inDate));
    metaGrid.appendChild(field("Time of Day", selTod));
    metaGrid.appendChild(field("Staff (required)", inStaff));
    metaGrid.appendChild(field("Location", inLoc));
    metaGrid.appendChild(field("Float", inFloat));

    var pills = el("div", { style: "display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;" });
    pills.appendChild(statusPill(isLocked(state) ? "Locked" : "Unlocked", isLocked(state) ? "warn" : "good"));
    pills.appendChild(statusPill(state.saved_at ? "Saved" : "Not saved", state.saved_at ? "good" : "bad"));

    // -----------------------------
    // Sections A-D (simple UI)
    // -----------------------------
    function makeSectionList(title, list, labels, addLabel) {
      var wrap = el("div", {}, []);
      for (var i = 0; i < list.length; i++) {
        wrap.appendChild(makeMoneyRow(labels[i] || (title + " " + (i + 1)), list[i], function () { /* no-op */ }));
      }

      var right = null;
      if (addLabel) {
        var addBtn = el("button", { class: "eikon-btn", text: "Add Entry" });
        addBtn.onclick = function () {
          list.push({ amount: 0, remark: "" });
          rerender();
        };
        right = addBtn;
      }
      return makeSectionCard(title, right, wrap);
    }

    var secX = makeSectionList("X Readings", state.x, ["X Reading 1", "X Reading 2", "X Reading 3", "X Reading 4"], null);
    var secEpos = makeSectionList("EPOS", state.epos, ["EPOS 1", "EPOS 2", "EPOS 3", "EPOS 4"], null);
    var secCheq = makeSectionList("Cheques", state.cheques, state.cheques.map(function (_, i) { return "Cheque " + (i + 1); }), "Add Entry");
    var secPaid = makeSectionList("Paid Outs", state.paid_outs, state.paid_outs.map(function (_, i) { return "Paid Out " + (i + 1); }), "Add Entry");

    // -----------------------------
    // Totals summary card
    // -----------------------------
    var counted = countedCashTill(state);
    var Etotal = totalCashE(state);
    var Ftotal = roundedDepositF(state);
    var OU = overUnder(state);
    var COINS = coinsDiff(state);
    var exp = expectedDeposit(state);

    var summary = el("div", { style: "display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:12px;" }, [
      el("div", { style: "padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,14,22,.45);" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:4px;", text: "Expected Deposit (X - EPOS - Cheques - Paid outs)" }),
        el("div", { style: "font-size:18px;font-weight:950;color:#e9eef7;", text: euro(exp) })
      ]),
      el("div", { style: "padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,14,22,.45);" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:4px;", text: "Total Cash E (Till - Float)" }),
        el("div", { style: "font-size:18px;font-weight:950;color:#e9eef7;", text: euro(Etotal) })
      ]),
      el("div", { style: "padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,14,22,.45);" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:4px;", text: "Rounded Deposit F (Nearest €5)" }),
        el("div", { style: "font-size:18px;font-weight:950;color:#e9eef7;", text: euro(Ftotal) })
      ]),
      el("div", { style: "padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,14,22,.45);" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:4px;", text: "Coins (E − F)" }),
        el("div", { style: "font-size:18px;font-weight:950;color:#e9eef7;", text: euro(COINS) })
      ]),
      el("div", { style: "padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,14,22,.45);" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:4px;", text: "Over / Under" }),
        el("div", { style: "font-size:18px;font-weight:950;color:#e9eef7;", text: euro(OU) })
      ]),
      el("div", { style: "padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,14,22,.45);" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:4px;", text: "Till Cash (Notes + Coins)" }),
        el("div", { style: "font-size:18px;font-weight:950;color:#e9eef7;", text: euro(counted.total) })
      ])
    ]);

    // Month summary
    var ms = monthSummary(state, ymFromYmd(state.date));
    var monthCard = el("div", { style: "margin-top:12px;padding:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,14,22,.35);display:flex;gap:14px;flex-wrap:wrap;align-items:center;" }, [
      el("div", { style: "font-weight:950;color:#e9eef7;", text: "Month (" + esc(ymFromYmd(state.date)) + ") Summary" }),
      el("div", { style: "color:rgba(233,238,247,.9);", text: "Days: " + String(ms.days) }),
      el("div", { style: "color:rgba(233,238,247,.9);", text: "Total Cash: " + euro(ms.total_cash_month) }),
      el("div", { style: "color:rgba(233,238,247,.9);", text: "Over/Under: " + euro(ms.over_under_month) }),
      el("div", { style: "color:rgba(233,238,247,.9);", text: "Coin Box: " + euro(ms.coin_box_month) })
    ]);

    // -----------------------------
    // Compose page
    // -----------------------------
    var page = el("div", {}, []);
    page.appendChild(
::contentReference[oaicite:0]{index=0}
