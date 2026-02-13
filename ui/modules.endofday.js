/* ui/modules.endofday.js
   Eikon - End Of Day module (UI)

   IMPORTANT:
   - This file must be valid JavaScript. The previous version contained plain markdown/text
     outside of strings, which caused "Unexpected token ':'" and broke page load.

   Persistence:
   - localStorage only (per org+location+date), so it works immediately.
   - Includes "Lock" state (soft lock in localStorage).

   Features:
   - EOD form: date, staff, float, X readings, EPOS, cheques, paid outs, cash notes + coins.
   - Calculations: totals, expected cash, over/under, coins (E-F).
   - Print: A4 summary
   - Range report (from/to): scans localStorage records for this location.
   - Audit log (localStorage per location) + view
   - Contacts manager (localStorage per location)
   - Admin: Clear local EOD data (location scope)
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // -----------------------------
  // Logging helpers
  // -----------------------------
  function log() { E.log.apply(E, ["[eod]"].concat([].slice.call(arguments))); }
  function dbg() { E.dbg.apply(E, ["[eod]"].concat([].slice.call(arguments))); }
  function warn() { E.warn.apply(E, ["[eod]"].concat([].slice.call(arguments))); }
  function err() { E.error.apply(E, ["[eod]"].concat([].slice.call(arguments))); }

  // -----------------------------
  // Small DOM helpers
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
      else if (k === "style") node.setAttribute("style", String(v || ""));
      else if (k === "value") node.value = String(v == null ? "" : v);
      else if (k === "type") node.type = String(v || "");
      else if (k === "placeholder") node.placeholder = String(v || "");
      else if (k === "disabled") node.disabled = !!v;
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

  function field(labelText, inputEl) {
    return el("div", { class: "eikon-field" }, [
      el("div", { class: "eikon-label", text: labelText }),
      inputEl
    ]);
  }

  // -----------------------------
  // Toasts (local)
  // -----------------------------
  var toastInstalled = false;

  function ensureToastStyles() {
    if (toastInstalled) return;
    toastInstalled = true;
    var st = document.createElement("style");
    st.type = "text/css";
    st.textContent =
      ".eikon-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".eikon-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);}" +
      ".eikon-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
      ".eikon-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".eikon-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".eikon-toast.bad{border-color:rgba(255,90,122,.35);}" +
      ".eikon-toast.warn{border-color:rgba(255,200,90,.35);}";
    document.head.appendChild(st);
  }

  function toast(title, message, kind, ms) {
    ensureToastStyles();
    var wrap = document.getElementById("eikon-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "eikon-toast-wrap";
      wrap.className = "eikon-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = el("div", { class: "eikon-toast " + (kind || "") });
    t.appendChild(el("div", { class: "t-title", text: title || "Info" }));
    t.appendChild(el("div", { class: "t-msg", text: message || "" }));
    wrap.appendChild(t);
    var ttl = (typeof ms === "number" ? ms : 2600);
    setTimeout(function () {
      try { t.remove(); } catch (e) {}
    }, ttl);
  }

  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function (resolve) {
      try {
        E.modal.show(
          title || "Confirm",
          '<div style="white-space:pre-wrap;line-height:1.35;">' + esc(bodyText || "") + "</div>",
          [
            { label: cancelLabel || "Cancel", onClick: function () { E.modal.hide(); resolve(false); } },
            { label: okLabel || "OK", danger: true, onClick: function () { E.modal.hide(); resolve(true); } }
          ]
        );
      } catch (e) {
        resolve(window.confirm(bodyText || "Are you sure?"));
      }
    });
  }

  // -----------------------------
  // Data helpers
  // -----------------------------
  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function ymd(d) {
    var dt = d || new Date();
    var y = dt.getFullYear();
    var m = String(dt.getMonth() + 1).padStart(2, "0");
    var dd = String(dt.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function ddmmyyyy(s) {
    var v = String(s || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }

  function parseNum(x) {
    var s = String(x == null ? "" : x).trim().replace(",", ".");
    if (!s) return 0;
    var v = Number(s);
    if (!Number.isFinite(v)) return 0;
    return v;
  }

  function euro(n) {
    var v = Number(n || 0);
    if (!Number.isFinite(v)) v = 0;
    return "€" + (Math.round(v * 100) / 100).toFixed(2);
  }

  function roundToNearest5(amount) {
    var v = Number(amount || 0);
    if (!Number.isFinite(v)) v = 0;
    return Math.round(v / 5) * 5;
  }

  // -----------------------------
  // localStorage keys
  // -----------------------------
  function keyPrefix(user) {
    // keep stable and location-scoped
    var org = user && user.org_id ? String(user.org_id) : "org";
    var loc = user && user.location_name ? String(user.location_name) : "location";
    return "eikon_eod_v1|" + org + "|" + loc + "|";
  }

  function keyForDate(user, dateYmd) {
    return keyPrefix(user) + String(dateYmd || "");
  }

  function auditKey(user) {
    var org = user && user.org_id ? String(user.org_id) : "org";
    var loc = user && user.location_name ? String(user.location_name) : "location";
    return "eikon_eod_audit_v1|" + org + "|" + loc;
  }

  function contactsKey(user) {
    var org = user && user.org_id ? String(user.org_id) : "org";
    var loc = user && user.location_name ? String(user.location_name) : "location";
    return "eikon_eod_contacts_v1|" + org + "|" + loc;
  }

  function lsGet(k) {
    try {
      var raw = window.localStorage.getItem(k);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function lsSet(k, obj) {
    try {
      window.localStorage.setItem(k, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  function lsDel(k) {
    try { window.localStorage.removeItem(k); } catch (e) {}
  }

  function lsKeys() {
    try {
      return Object.keys(window.localStorage || {});
    } catch (e) {
      return [];
    }
  }

  // -----------------------------
  // Default record
  // -----------------------------
  function emptyRecord(user, dateYmd) {
    var u = user || {};
    return {
      v: 1,
      date: String(dateYmd || ymd(new Date())),
      org_id: u.org_id || null,
      org_name: u.org_name || "",
      location_id: u.location_id || null,
      location_name: u.location_name || "",
      staff: u.full_name || "",
      float_amount: 0,
      locked_at: null,
      locked_by: "",
      updated_at: nowIso(),
      updated_by: u.full_name || "",
      cash: {
        n500: "",
        n200: "",
        n100: "",
        n50: "",
        n20: "",
        n10: "",
        n5: "",
        coins_total: ""
      },
      x: [
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" }
      ],
      epos: [
        { amount: "" },
        { amount: "" },
        { amount: "" },
        { amount: "" }
      ],
      cheques: [
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" }
      ],
      paid_outs: [
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" },
        { amount: "", remark: "" }
      ]
    };
  }

  // -----------------------------
  // Load / Save record
  // -----------------------------
  function loadRecord(user, dateYmd) {
    var k = keyForDate(user, dateYmd);
    var rec = lsGet(k);
    if (!rec) return emptyRecord(user, dateYmd);
    // ensure required structure
    var base = emptyRecord(user, dateYmd);
    rec = rec || {};
    base.staff = (rec.staff != null ? rec.staff : base.staff);
    base.float_amount = (rec.float_amount != null ? rec.float_amount : base.float_amount);
    base.locked_at = rec.locked_at || null;
    base.locked_by = rec.locked_by || "";
    base.updated_at = rec.updated_at || base.updated_at;
    base.updated_by = rec.updated_by || base.updated_by;

    // cash
    base.cash = Object.assign({}, base.cash, rec.cash || {});
    // arrays
    function mergeArr(dst, src) {
      if (!Array.isArray(src)) return dst;
      for (var i = 0; i < dst.length; i++) {
        dst[i] = Object.assign({}, dst[i], (src[i] || {}));
      }
      return dst;
    }
    base.x = mergeArr(base.x, rec.x);
    base.epos = mergeArr(base.epos, rec.epos);
    base.cheques = mergeArr(base.cheques, rec.cheques);
    base.paid_outs = mergeArr(base.paid_outs, rec.paid_outs);

    return base;
  }

  function saveRecord(user, rec) {
    rec.updated_at = nowIso();
    rec.updated_by = (user && user.full_name) ? user.full_name : (rec.updated_by || "");
    var k = keyForDate(user, rec.date);
    return lsSet(k, rec);
  }

  // -----------------------------
  // Audit log
  // -----------------------------
  function loadAudit(user) {
    var k = auditKey(user);
    var a = lsGet(k);
    if (!Array.isArray(a)) return [];
    return a;
  }

  function saveAudit(user, items) {
    var k = auditKey(user);
    return lsSet(k, items || []);
  }

  function writeAudit(user, dateYmd, entry) {
    var items = loadAudit(user);
    items.unshift(Object.assign({ ts: nowIso(), date: String(dateYmd || ""), by: (user && user.full_name) ? user.full_name : "" }, entry || {}));
    // cap
    if (items.length > 500) items = items.slice(0, 500);
    saveAudit(user, items);
  }

  // -----------------------------
  // Contacts
  // -----------------------------
  function loadContacts(user) {
    var k = contactsKey(user);
    var a = lsGet(k);
    if (!Array.isArray(a)) return [];
    return a;
  }

  function saveContacts(user, contacts) {
    var k = contactsKey(user);
    return lsSet(k, contacts || []);
  }

  // -----------------------------
  // Calculations
  // -----------------------------
  function calc(rec) {
    var X = rec.x.reduce(function (a, r) { return a + parseNum(r.amount); }, 0);
    var B = rec.epos.reduce(function (a, r) { return a + parseNum(r.amount); }, 0);
    var C = rec.cheques.reduce(function (a, r) { return a + parseNum(r.amount); }, 0);
    var D = rec.paid_outs.reduce(function (a, r) { return a + parseNum(r.amount); }, 0);

    var notes =
      500 * parseNum(rec.cash.n500) +
      200 * parseNum(rec.cash.n200) +
      100 * parseNum(rec.cash.n100) +
      50 * parseNum(rec.cash.n50) +
      20 * parseNum(rec.cash.n20) +
      10 * parseNum(rec.cash.n10) +
      5 * parseNum(rec.cash.n5);

    var coins = parseNum(rec.cash.coins_total);

    var tillCash = notes + coins;
    var fl = parseNum(rec.float_amount);
    var Etotal = tillCash - fl;
    if (Etotal < 0) Etotal = 0;

    var Ftotal = roundToNearest5(Etotal);
    var COINS = Etotal - Ftotal; // coin box

    var expectedCash = X - B - C - D;
    var overUnder = Etotal - expectedCash;

    return {
      X: X, B: B, C: C, D: D,
      notes: notes,
      coinsTill: coins,
      tillCash: tillCash,
      float_amount: fl,
      Etotal: Etotal,
      Ftotal: Ftotal,
      coinBox: COINS,
      expectedCash: expectedCash,
      overUnder: overUnder
    };
  }

  // -----------------------------
  // Validation
  // -----------------------------
  function validateBeforeSave(rec) {
    var missing = [];
    if (!String(rec.date || "").trim()) missing.push("Date");
    if (!String(rec.staff || "").trim()) missing.push("Staff");

    // Require float
    if (String(rec.float_amount || "").trim() === "") missing.push("Float amount");

    // Require at least one X reading (common minimum)
    var anyX = rec.x.some(function (r) { return String(r.amount || "").trim() !== ""; });
    if (!anyX) missing.push("At least one X reading");

    // Require cash count basics (notes or coins)
    var anyCash = false;
    Object.keys(rec.cash || {}).forEach(function (k) {
      if (String(rec.cash[k] || "").trim() !== "") anyCash = true;
    });
    if (!anyCash) missing.push("Cash count (notes/coins)");

    if (missing.length) {
      return { ok: false, msg: missing.join("\n") };
    }
    return { ok: true, msg: "" };
  }

  // -----------------------------
  // Printing
  // -----------------------------
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
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 45000);
  }

  function buildA4Html(rec) {
    var c = calc(rec);

    function row(label, amt, remark) {
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e7e7;">${esc(label)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e7e7;text-align:right;">${esc(amt)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e7e7e7;">${esc(remark || "")}</td>
      </tr>`;
    }

    var Avals = rec.x.map(function (r) { return euro(parseNum(r.amount)); });
    var Arem = rec.x.map(function (r) { return r.remark || ""; });
    var Bvals = rec.epos.map(function (r) { return euro(parseNum(r.amount)); });
    var Cvals = rec.cheques.map(function (r) { return euro(parseNum(r.amount)); });
    var Crem = rec.cheques.map(function (r) { return r.remark || ""; });
    var Dvals = rec.paid_outs.map(function (r) { return euro(parseNum(r.amount)); });
    var Drem = rec.paid_outs.map(function (r) { return r.remark || ""; });

    var ou = c.overUnder;
    var ouText = euro(ou);
    var ouNote = "";
    if (Math.abs(ou) >= 0.01) {
      ouNote = (ou > 0 ? "(Over)" : "(Under)");
    }

    var html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>EOD - ${esc(rec.location_name)} - ${esc(rec.date)}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:18px;color:#111;}
    h1{margin:0 0 6px 0;font-size:20px;}
    .meta{margin:0 0 14px 0;font-size:12px;color:#333;}
    .box{border:1px solid #ddd;border-radius:12px;padding:12px;margin:12px 0;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    th{background:#f5f5f5;text-align:left;padding:7px 8px;border-bottom:1px solid #ddd;}
    .kpi{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}
    .k{border:1px solid #ddd;border-radius:12px;padding:10px 12px;min-width:210px;}
    .k .t{font-size:11px;color:#555;margin-bottom:4px}
    .k .v{font-weight:900;font-size:16px}
    .muted{color:#666}
  </style>
</head>
<body>
  <h1>End Of Day</h1>
  <div class="meta">
    <div><b>DATE:</b> ${esc(ddmmyyyy(rec.date))}</div>
    <div><b>STAFF:</b> ${esc(rec.staff || "")}</div>
    <div><b>LOCATION:</b> ${esc(rec.location_name || "")}</div>
    <div class="muted">Generated: ${esc(nowIso())}</div>
  </div>

  <div class="box">
    <table>
      <thead>
        <tr><th style="width:45%;">Item</th><th style="width:20%;text-align:right;">Amount</th><th>Remark</th></tr>
      </thead>
      <tbody>
        ${row("A1 X READING 1", Avals[0], Arem[0])}
        ${row("A2 X READING 2", Avals[1], Arem[1])}
        ${row("A3 X READING 3", Avals[2], Arem[2])}
        ${row("A4 X READING 4", Avals[3], Arem[3])}
        ${row("TOTAL X READINGS", euro(c.X), "")}

        ${row("B1 EPOS", Bvals[0], "")}
        ${row("B2 EPOS", Bvals[1], "")}
        ${row("B3 EPOS", Bvals[2], "")}
        ${row("B4 EPOS", Bvals[3], "")}
        ${row("TOTAL EPOS", euro(c.B), "")}

        ${row("C1 CHEQUES", Cvals[0], Crem[0])}
        ${row("C2 CHEQUES", Cvals[1], Crem[1])}
        ${row("C3 CHEQUES", Cvals[2], Crem[2])}
        ${row("C4 CHEQUES", Cvals[3], Crem[3])}
        ${row("TOTAL CHEQUES", euro(c.C), "")}

        ${row("D1 PAID OUTS", Dvals[0], Drem[0])}
        ${row("D2 PAID OUTS", Dvals[1], Drem[1])}
        ${row("D3 PAID OUTS", Dvals[2], Drem[2])}
        ${row("D4 PAID OUTS", Dvals[3], Drem[3])}
        ${row("D5 PAID OUTS", Dvals[4], Drem[4])}
        ${row("D6 PAID OUTS", Dvals[5], Drem[5])}
        ${row("D7 PAID OUTS", Dvals[6], Drem[6])}
        ${row("D8 PAID OUTS", Dvals[7], Drem[7])}
        ${row("TOTAL PAID OUTS", euro(c.D), "")}

        ${row("E TOTAL CASH (Till - Float " + euro(c.float_amount) + ")", euro(c.Etotal), "")}
        ${row("F ROUNDED CASH DEPOSITED", euro(c.Ftotal), "")}
      </tbody>
    </table>

    <div class="kpi">
      <div class="k">
        <div class="t">EXPECTED CASH (X - EPOS - CHEQUES - PAID OUTS)</div>
        <div class="v">${esc(euro(c.expectedCash))}</div>
      </div>
      <div class="k">
        <div class="t">COINS (E − F)</div>
        <div class="v">${esc(euro(c.coinBox))}</div>
        <div class="muted" style="font-size:11px;margin-top:4px">
          Till notes: ${esc(euro(c.notes))} • Coins: ${esc(euro(c.coinsTill))}
        </div>
      </div>
      <div class="k">
        <div class="t">OVER/UNDER</div>
        <div class="v">${esc(ouText)} <span class="muted" style="font-size:12px">${esc(ouNote)}</span></div>
      </div>
    </div>
  </div>

  <div class="box muted" style="font-size:12px">
    <b>Lock status:</b> ${rec.locked_at ? ("Locked at " + esc(rec.locked_at) + " by " + esc(rec.locked_by || "")) : "Not locked"}
  </div>
</body>
</html>`;

    return html;
  }

  // Range report reads localStorage keys for this location
  function getAllEodRecordsForLocation(user) {
    var prefix = keyPrefix(user);
    var keys = lsKeys();
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf(prefix) !== 0) continue;
      var rec = lsGet(k);
      if (rec && rec.date && rec.location_name === (user && user.location_name)) {
        out.push(rec);
      }
    }
    return out;
  }

  function buildRangeReportHtml(user, from, to) {
    var rows = getAllEodRecordsForLocation(user)
      .filter(function (r) { return r.date >= from && r.date <= to; })
      .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

    var totalCash = 0, totalOU = 0, totalCoins = 0;

    function calcFor(r) {
      var c = calc(r);
      totalCash += c.Etotal;
      totalOU += c.overUnder;
      totalCoins += c.coinBox;
      return c;
    }

    var rowsHtml = "";
    if (!rows.length) {
      rowsHtml = `<tr><td colspan="5" style="padding:10px;color:#666">No records in range.</td></tr>`;
    } else {
      rowsHtml = rows.map(function (r) {
        var c = calcFor(r);
        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(ddmmyyyy(r.date))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${esc(euro(c.Etotal))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${esc(euro(c.overUnder))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(String(r.staff || ""))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(r.locked_at ? "Locked" : "")}</td>
        </tr>`;
      }).join("");
    }

    var html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>EOD Range Report - ${esc(user && user.location_name ? user.location_name : "")}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:18px;color:#111;}
    h1{margin:0 0 6px 0;font-size:20px;}
    .meta{margin:0 0 14px 0;font-size:12px;color:#333;}
    table{width:100%;border-collapse:collapse;font-size:12px;}
    th{background:#f5f5f5;text-align:left;padding:7px 8px;border-bottom:1px solid #ddd;}
    .right{text-align:right;}
    .kpi{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
    .k{border:1px solid #ddd;border-radius:12px;padding:10px 12px;min-width:210px;}
    .k .t{font-size:11px;color:#555;margin-bottom:4px}
    .k .v{font-weight:900;font-size:16px}
    .muted{color:#666}
  </style>
</head>
<body>
  <h1>End Of Day — Range Report</h1>
  <div class="meta">
    <div><b>Location:</b> ${esc(user && user.location_name ? user.location_name : "")}</div>
    <div><b>Range:</b> ${esc(ddmmyyyy(from))} to ${esc(ddmmyyyy(to))}</div>
    <div class="muted">Generated: ${esc(nowIso())}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:20%;">Date</th>
        <th style="width:20%;" class="right">Total Cash (E)</th>
        <th style="width:20%;" class="right">Over/Under</th>
        <th>Staff</th>
        <th style="width:12%;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="kpi">
    <div class="k">
      <div class="t">Totals: Total Cash</div>
      <div class="v">${esc(euro(totalCash))}</div>
    </div>
    <div class="k">
      <div class="t">Totals: Over/Under</div>
      <div class="v">${esc(euro(totalOU))}</div>
    </div>
    <div class="k">
      <div class="t">Totals: Coin Box (E − F)</div>
      <div class="v">${esc(euro(totalCoins))}</div>
    </div>
  </div>
</body>
</html>`;

    return html;
  }

  // -----------------------------
  // UI build blocks
  // -----------------------------
  function makeMoneyInput(placeholder) {
    return el("input", { class: "eikon-input", placeholder: placeholder || "0.00" });
  }

  function makeTextInput(placeholder) {
    return el("input", { class: "eikon-input", placeholder: placeholder || "" });
  }

  function makeDateInput() {
    return el("input", { class: "eikon-input", type: "date" });
  }

  function btn(label, cls) {
    return el("button", { class: "eikon-btn " + (cls || ""), text: label });
  }

  function sectionTitle(t) {
    return el("div", { style: "font-weight:900;margin:16px 0 8px 0;font-size:14px;" , text: t });
  }

  function hr() {
    return el("div", { style: "height:1px;background:rgba(255,255,255,.10);margin:14px 0;" });
  }

  function pill(text, kind) {
    var bg = "rgba(255,255,255,.08)";
    var bd = "rgba(255,255,255,.12)";
    if (kind === "good") { bg = "rgba(67,209,122,.14)"; bd = "rgba(67,209,122,.28)"; }
    if (kind === "bad") { bg = "rgba(255,90,122,.14)"; bd = "rgba(255,90,122,.28)"; }
    if (kind === "warn") { bg = "rgba(255,200,90,.14)"; bd = "rgba(255,200,90,.28)"; }
    return el("span", { style: "display:inline-block;padding:6px 10px;border-radius:999px;border:1px solid " + bd + ";background:" + bg + ";font-size:12px;", text: text });
  }

  // -----------------------------
  // Module render
  // -----------------------------
  async function render(ctx) {
    var mount = ctx.mount;
    var user = ctx.user || {};

    var wrap = el("div", { style: "max-width:1100px;margin:0 auto;" });

    // Top row: date/staff/location/lock
    var top = el("div", { style: "display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;" });

    var left = el("div", { style: "display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;" });

    var inDate = makeDateInput();
    inDate.value = ymd(new Date());

    var inStaff = makeTextInput("Staff name");
    inStaff.value = user.full_name || "";

    var inFloat = makeMoneyInput("Float");
    inFloat.value = "";

    left.appendChild(field("Date", inDate));
    left.appendChild(field("Staff", inStaff));
    left.appendChild(field("Float Amount (€)", inFloat));

    var right = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:flex-end;" });
    var lockPill = pill("Not locked", "warn");
    right.appendChild(lockPill);

    top.appendChild(left);
    top.appendChild(right);

    wrap.appendChild(top);

    // Form containers
    var grid = el("div", { style: "display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;margin-top:14px;" });

    function card(title, colSpan, bodyChild) {
      var c = el("div", { class: "eikon-card", style: "grid-column:span " + colSpan + ";padding:14px;border:1px solid rgba(255,255,255,.10);border-radius:16px;background:rgba(255,255,255,.02);" });
      c.appendChild(el("div", { style: "font-weight:900;margin-bottom:10px;font-size:13px;", text: title }));
      c.appendChild(bodyChild);
      return c;
    }

    // X readings
    var xBody = el("div");
    var xInputs = [];
    for (var i = 0; i < 4; i++) {
      var row = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;" });
      var amt = makeMoneyInput("Amount");
      var rem = makeTextInput("Remark (optional)");
      xInputs.push({ amt: amt, rem: rem });
      row.appendChild(el("div", { style: "width:32px;font-weight:900;opacity:.9", text: "A" + (i + 1) }));
      row.appendChild(amt);
      row.appendChild(rem);
      xBody.appendChild(row);
    }
    grid.appendChild(card("X Readings (A)", 6, xBody));

    // EPOS
    var bBody = el("div");
    var bInputs = [];
    for (var j = 0; j < 4; j++) {
      var r2 = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;" });
      var amt2 = makeMoneyInput("Amount");
      bInputs.push({ amt: amt2 });
      r2.appendChild(el("div", { style: "width:32px;font-weight:900;opacity:.9", text: "B" + (j + 1) }));
      r2.appendChild(amt2);
      bBody.appendChild(r2);
    }
    grid.appendChild(card("EPOS (B)", 6, bBody));

    // Cheques
    var cBody = el("div");
    var cInputs = [];
    for (var k = 0; k < 4; k++) {
      var r3 = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;" });
      var amt3 = makeMoneyInput("Amount");
      var rem3 = makeTextInput("Remark (optional)");
      cInputs.push({ amt: amt3, rem: rem3 });
      r3.appendChild(el("div", { style: "width:32px;font-weight:900;opacity:.9", text: "C" + (k + 1) }));
      r3.appendChild(amt3);
      r3.appendChild(rem3);
      cBody.appendChild(r3);
    }
    grid.appendChild(card("Cheques (C)", 6, cBody));

    // Paid outs
    var dBody = el("div");
    var dInputs = [];
    for (var p = 0; p < 8; p++) {
      var r4 = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;" });
      var amt4 = makeMoneyInput("Amount");
      var rem4 = makeTextInput("Remark");
      dInputs.push({ amt: amt4, rem: rem4 });
      r4.appendChild(el("div", { style: "width:32px;font-weight:900;opacity:.9", text: "D" + (p + 1) }));
      r4.appendChild(amt4);
      r4.appendChild(rem4);
      dBody.appendChild(r4);
    }
    grid.appendChild(card("Paid Outs (D)", 6, dBody));

    // Cash count
    var eBody = el("div");
    var notesRow1 = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;" });
    function denom(label, ph) {
      var inp = el("input", { class: "eikon-input", placeholder: ph || "0", style: "max-width:120px;" });
      return { wrap: field(label, inp), input: inp };
    }
    var n500 = denom("€500", "0");
    var n200 = denom("€200", "0");
    var n100 = denom("€100", "0");
    var n50  = denom("€50", "0");
    var n20  = denom("€20", "0");
    var n10  = denom("€10", "0");
    var n5   = denom("€5", "0");
    var coinsTotal = makeMoneyInput("Coins total (€)");
    coinsTotal.style.maxWidth = "160px";

    [n500, n200, n100, n50, n20, n10, n5].forEach(function (x) { notesRow1.appendChild(x.wrap); });
    eBody.appendChild(notesRow1);
    eBody.appendChild(field("Coins total (€)", coinsTotal));

    grid.appendChild(card("Cash Count", 6, eBody));

    // Summary KPIs
    var sumBody = el("div");
    var kpi1 = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;" });

    function kpiBox(title, valueId) {
      var b = el("div", { style: "border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:10px 12px;min-width:220px;background:rgba(255,255,255,.02);" });
      b.appendChild(el("div", { style: "font-size:11px;opacity:.75;margin-bottom:4px;", text: title }));
      b.appendChild(el("div", { style: "font-weight:900;font-size:16px;", html: '<span id="' + valueId + '">€0.00</span>' }));
      return b;
    }

    kpi1.appendChild(kpiBox("TOTAL X (A)", "eod_kpi_x"));
    kpi1.appendChild(kpiBox("TOTAL EPOS (B)", "eod_kpi_b"));
    kpi1.appendChild(kpiBox("TOTAL CHEQUES (C)", "eod_kpi_c"));
    kpi1.appendChild(kpiBox("TOTAL PAID OUTS (D)", "eod_kpi_d"));
    kpi1.appendChild(kpiBox("TOTAL CASH (E)", "eod_kpi_e"));
    kpi1.appendChild(kpiBox("ROUNDED DEPOSIT (F)", "eod_kpi_f"));
    kpi1.appendChild(kpiBox("COIN BOX (E − F)", "eod_kpi_coin"));
    kpi1.appendChild(kpiBox("EXPECTED CASH", "eod_kpi_exp"));
    kpi1.appendChild(kpiBox("OVER/UNDER", "eod_kpi_ou"));

    sumBody.appendChild(kpi1);
    grid.appendChild(card("Summary", 12, sumBody));

    wrap.appendChild(grid);

    // Buttons row
    wrap.appendChild(hr());

    var btnRow = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap;align-items:center;" });

    var btnSave = btn("Save", "primary");
    var btnLock = btn("Lock", "danger");
    var btnUnlock = btn("Unlock", "");
    var btnPrint = btn("Print A4", "");
    var btnRange = btn("Range Report", "");
    var btnAudit = btn("View Audit", "");
    var btnContacts = btn("Contacts", "");
    var btnClear = btn("Admin: Clear Local EOD Data", "danger");

    btnRow.appendChild(btnSave);
    btnRow.appendChild(btnLock);
    btnRow.appendChild(btnUnlock);
    btnRow.appendChild(btnPrint);
    btnRow.appendChild(btnRange);
    btnRow.appendChild(btnAudit);
    btnRow.appendChild(btnContacts);

    if (user && user.role === "admin") {
      btnRow.appendChild(btnClear);
    }

    wrap.appendChild(btnRow);

    // Mount everything
    mount.appendChild(wrap);

    // Current state
    var rec = null;

    function readFormIntoRecord(base) {
      var r = base || emptyRecord(user, inDate.value);
      r.date = String(inDate.value || "").trim();
      r.staff = String(inStaff.value || "").trim();
      r.float_amount = parseNum(inFloat.value);

      r.cash.n500 = String(n500.input.value || "").trim();
      r.cash.n200 = String(n200.input.value || "").trim();
      r.cash.n100 = String(n100.input.value || "").trim();
      r.cash.n50  = String(n50.input.value || "").trim();
      r.cash.n20  = String(n20.input.value || "").trim();
      r.cash.n10  = String(n10.input.value || "").trim();
      r.cash.n5   = String(n5.input.value || "").trim();
      r.cash.coins_total = String(coinsTotal.value || "").trim();

      for (var i2 = 0; i2 < 4; i2++) {
        r.x[i2].amount = String(xInputs[i2].amt.value || "").trim();
        r.x[i2].remark = String(xInputs[i2].rem.value || "").trim();
      }
      for (var j2 = 0; j2 < 4; j2++) {
        r.epos[j2].amount = String(bInputs[j2].amt.value || "").trim();
      }
      for (var k2 = 0; k2 < 4; k2++) {
        r.cheques[k2].amount = String(cInputs[k2].amt.value || "").trim();
        r.cheques[k2].remark = String(cInputs[k2].rem.value || "").trim();
      }
      for (var p2 = 0; p2 < 8; p2++) {
        r.paid_outs[p2].amount = String(dInputs[p2].amt.value || "").trim();
        r.paid_outs[p2].remark = String(dInputs[p2].rem.value || "").trim();
      }
      return r;
    }

    function writeRecordToForm(r) {
      inDate.value = String(r.date || ymd(new Date()));
      inStaff.value = String(r.staff || "");
      inFloat.value = (r.float_amount == null ? "" : String(r.float_amount));

      n500.input.value = String(r.cash.n500 || "");
      n200.input.value = String(r.cash.n200 || "");
      n100.input.value = String(r.cash.n100 || "");
      n50.input.value  = String(r.cash.n50 || "");
      n20.input.value  = String(r.cash.n20 || "");
      n10.input.value  = String(r.cash.n10 || "");
      n5.input.value   = String(r.cash.n5 || "");
      coinsTotal.value = String(r.cash.coins_total || "");

      for (var i2 = 0; i2 < 4; i2++) {
        xInputs[i2].amt.value = String((r.x[i2] && r.x[i2].amount) || "");
        xInputs[i2].rem.value = String((r.x[i2] && r.x[i2].remark) || "");
      }
      for (var j2 = 0; j2 < 4; j2++) {
        bInputs[j2].amt.value = String((r.epos[j2] && r.epos[j2].amount) || "");
      }
      for (var k2 = 0; k2 < 4; k2++) {
        cInputs[k2].amt.value = String((r.cheques[k2] && r.cheques[k2].amount) || "");
        cInputs[k2].rem.value = String((r.cheques[k2] && r.cheques[k2].remark) || "");
      }
      for (var p2 = 0; p2 < 8; p2++) {
        dInputs[p2].amt.value = String((r.paid_outs[p2] && r.paid_outs[p2].amount) || "");
        dInputs[p2].rem.value = String((r.paid_outs[p2] && r.paid_outs[p2].remark) || "");
      }
    }

    function setLockedUi(isLocked, lockedAt, lockedBy) {
      // disable inputs when locked
      var disabled = !!isLocked;

      function setAllDisabled(nodeList, value) {
        nodeList.forEach(function (n) {
          try { n.disabled = !!value; } catch (e) {}
        });
      }

      var inputs = [];
      inputs.push(inDate, inStaff, inFloat, coinsTotal);
      [n500, n200, n100, n50, n20, n10, n5].forEach(function (x) { inputs.push(x.input); });
      xInputs.forEach(function (x) { inputs.push(x.amt, x.rem); });
      bInputs.forEach(function (x) { inputs.push(x.amt); });
      cInputs.forEach(function (x) { inputs.push(x.amt, x.rem); });
      dInputs.forEach(function (x) { inputs.push(x.amt, x.rem); });

      setAllDisabled(inputs, disabled);

      // Buttons:
      // - Keep Unlock / Print / Range / Audit / Contacts enabled even when locked
      btnSave.disabled = disabled;
      btnLock.disabled = disabled;
      btnUnlock.disabled = false;
      btnPrint.disabled = false;
      btnRange.disabled = false;
      btnAudit.disabled = false;
      btnContacts.disabled = false;
      if (btnClear) btnClear.disabled = false;

      if (isLocked) {
        lockPill.textContent = "Locked";
        lockPill.setAttribute("style", lockPill.getAttribute("style").replace("warn", ""));
        lockPill.replaceWith(lockPill = pill("Locked", "bad"));
        right.innerHTML = "";
        right.appendChild(lockPill);
        right.appendChild(el("span", { style: "font-size:12px;opacity:.8", text: (lockedAt ? ("at " + lockedAt) : "") + (lockedBy ? (" by " + lockedBy) : "") }));
      } else {
        right.innerHTML = "";
        lockPill = pill("Not locked", "warn");
        right.appendChild(lockPill);
      }
    }

    function updateKpis() {
      var r = readFormIntoRecord(rec || emptyRecord(user, inDate.value));
      var c = calc(r);

      function set(id, v) {
        var node = document.getElementById(id);
        if (node) node.textContent = v;
      }

      set("eod_kpi_x", euro(c.X));
      set("eod_kpi_b", euro(c.B));
      set("eod_kpi_c", euro(c.C));
      set("eod_kpi_d", euro(c.D));
      set("eod_kpi_e", euro(c.Etotal));
      set("eod_kpi_f", euro(c.Ftotal));
      set("eod_kpi_coin", euro(c.coinBox));
      set("eod_kpi_exp", euro(c.expectedCash));
      set("eod_kpi_ou", euro(c.overUnder));
    }

    function loadForDate(dateYmd) {
      rec = loadRecord(user, dateYmd);
      writeRecordToForm(rec);
      updateKpis();
      setLockedUi(!!rec.locked_at, rec.locked_at, rec.locked_by);
    }

    // initial load
    loadForDate(inDate.value);

    // events -> kpi refresh + autosave on date change (load)
    function wireKpiInputs() {
      var all = [];
      all.push(inStaff, inFloat, coinsTotal, inDate);
      [n500, n200, n100, n50, n20, n10, n5].forEach(function (x) { all.push(x.input); });
      xInputs.forEach(function (x) { all.push(x.amt, x.rem); });
      bInputs.forEach(function (x) { all.push(x.amt); });
      cInputs.forEach(function (x) { all.push(x.amt, x.rem); });
      dInputs.forEach(function (x) { all.push(x.amt, x.rem); });

      all.forEach(function (inp) {
        inp.addEventListener("input", function () {
          updateKpis();
        });
      });

      inDate.addEventListener("change", function () {
        var d = String(inDate.value || "").trim();
        if (!d) return;
        loadForDate(d);
      });
    }
    wireKpiInputs();

    // actions
    btnSave.onclick = async function () {
      try {
        var r = readFormIntoRecord(rec || emptyRecord(user, inDate.value));
        if (r.locked_at) return toast("Locked", "This EOD is locked. Unlock to edit.", "warn");

        var v = validateBeforeSave(r);
        if (!v.ok) {
          toast("Missing Information", "Cannot save until required fields are completed:\n\n" + v.msg, "warn", 4200);
          return;
        }

        if (!saveRecord(user, r)) {
          toast("Save failed", "localStorage write failed (quota?)", "bad", 4200);
          return;
        }
        writeAudit(user, r.date, { action: "SAVE", details: {} });
        rec = r;
        toast("Saved", "EOD saved locally.", "good");
      } catch (e) {
        err("save error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };

    btnLock.onclick = async function () {
      try {
        var r = readFormIntoRecord(rec || emptyRecord(user, inDate.value));
        if (r.locked_at) return toast("Locked", "Already locked.", "warn");

        var v = validateBeforeSave(r);
        if (!v.ok) {
          toast("Missing Information", "Cannot lock until required fields are completed:\n\n" + v.msg, "warn", 4200);
          return;
        }

        var ok = await modalConfirm("Lock EOD", "Locking prevents edits.\n\nContinue?", "Lock", "Cancel");
        if (!ok) return;

        r.locked_at = nowIso();
        r.locked_by = user.full_name || "";
        if (!saveRecord(user, r)) {
          toast("Lock failed", "localStorage write failed (quota?)", "bad", 4200);
          return;
        }
        writeAudit(user, r.date, { action: "LOCK", details: {} });
        rec = r;
        setLockedUi(true, r.locked_at, r.locked_by);
        toast("Locked", "EOD locked.", "good");
      } catch (e) {
        err("lock error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };

    btnUnlock.onclick = async function () {
      try {
        var r = readFormIntoRecord(rec || emptyRecord(user, inDate.value));
        if (!r.locked_at) {
          toast("Not locked", "This EOD is not locked.", "warn");
          return;
        }

        // Only admin can unlock
        if (!user || user.role !== "admin") {
          toast("Forbidden", "Only admin can unlock locked EOD.", "bad", 4200);
          return;
        }

        var ok = await modalConfirm("Unlock EOD", "Unlocking allows edits.\n\nContinue?", "Unlock", "Cancel");
        if (!ok) return;

        r.locked_at = null;
        r.locked_by = "";
        if (!saveRecord(user, r)) {
          toast("Unlock failed", "localStorage write failed (quota?)", "bad", 4200);
          return;
        }
        writeAudit(user, r.date, { action: "UNLOCK", details: {} });
        rec = r;
        setLockedUi(false);
        toast("Unlocked", "EOD unlocked.", "good");
      } catch (e) {
        err("unlock error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };

    btnPrint.onclick = async function () {
      try {
        var r = readFormIntoRecord(rec || emptyRecord(user, inDate.value));
        var v = validateBeforeSave(r);
        if (!v.ok) {
          toast("Missing Information", "Cannot print until required fields are completed:\n\n" + v.msg, "warn", 4200);
          return;
        }
        openPrintTabWithHtml(buildA4Html(r));
        writeAudit(user, r.date, { action: "PRINT_A4", details: {} });
      } catch (e) {
        err("print error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };

    btnRange.onclick = async function () {
      try {
        var from = "";
        var to = "";

        // Use modal with two date inputs
        var body =
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">' +
            '<div style="min-width:220px;">' +
              '<div style="font-size:12px;opacity:.8;margin-bottom:6px;">From (YYYY-MM-DD)</div>' +
              '<input id="eod_range_from" type="date" class="eikon-input" style="width:220px;" />' +
            "</div>" +
            '<div style="min-width:220px;">' +
              '<div style="font-size:12px;opacity:.8;margin-bottom:6px;">To (YYYY-MM-DD)</div>' +
              '<input id="eod_range_to" type="date" class="eikon-input" style="width:220px;" />' +
            "</div>" +
          "</div>";

        var ok = await new Promise(function (resolve) {
          E.modal.show("EOD Range Report", body, [
            { label: "Cancel", onClick: function () { E.modal.hide(); resolve(false); } },
            {
              label: "Generate",
              onClick: function () {
                var f = document.getElementById("eod_range_from");
                var t = document.getElementById("eod_range_to");
                from = f ? String(f.value || "").trim() : "";
                to = t ? String(t.value || "").trim() : "";
                E.modal.hide();
                resolve(true);
              }
            }
          ]);
        });

        if (!ok) return;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          toast("Validation", "From/To must be dates (YYYY-MM-DD).", "warn", 4200);
          return;
        }
        if (to < from) {
          toast("Validation", "To must be >= From.", "warn", 4200);
          return;
        }

        openPrintTabWithHtml(buildRangeReportHtml(user, from, to));
        writeAudit(user, inDate.value, { action: "PRINT_RANGE", details: { from: from, to: to } });
      } catch (e) {
        err("range error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };

    btnAudit.onclick = async function () {
      try {
        var items = loadAudit(user);
        var rows = items.slice(0, 200).map(function (it) {
          return `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;">${esc(it.ts || "")}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(it.date || "")}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(it.by || "")}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:900;">${esc(it.action || "")}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(JSON.stringify(it.details || {}))}</td>
          </tr>`;
        }).join("");

        if (!rows) {
          rows = `<tr><td colspan="5" style="padding:10px;color:#666">No audit entries.</td></tr>`;
        }

        var html =
          '<div style="max-height:70vh;overflow:auto;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
              '<thead>' +
                '<tr>' +
                  '<th style="text-align:left;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.12);">Timestamp</th>' +
                  '<th style="text-align:left;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.12);">Date</th>' +
                  '<th style="text-align:left;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.12);">By</th>' +
                  '<th style="text-align:left;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.12);">Action</th>' +
                  '<th style="text-align:left;padding:7px 8px;border-bottom:1px solid rgba(255,255,255,.12);">Details</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>';

        E.modal.show("EOD Audit", html, [
          { label: "Close", onClick: function () { E.modal.hide(); } }
        ]);
      } catch (e) {
        err("audit error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };

    btnContacts.onclick = async function () {
      try {
        var contacts = loadContacts(user);

        function renderList(container) {
          container.innerHTML = "";

          var topRow = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;" });
          var inName = el("input", { class: "eikon-input", placeholder: "Name (e.g. Accounts)" });
          var inPhone = el("input", { class: "eikon-input", placeholder: "Phone (optional)" });
          var btnAdd = el("button", { class: "eikon-btn primary", text: "Add" });

          btnAdd.onclick = function () {
            var name = String(inName.value || "").trim();
            var phone = String(inPhone.value || "").trim();
            if (!name) return toast("Validation", "Name is required.", "warn");
            var id = "c_" + Math.random().toString(16).slice(2) + "_" + Date.now();
            contacts.push({ id: id, name: name, phone: phone });
            saveContacts(user, contacts);
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
              el("td", { colspan: "3", style: "padding:10px;color:rgba(233,238,247,.75);", text: "No contacts yet." })
            ]));
          } else {
            contacts.forEach(function (c) {
              var tr = el("tr");
              tr.appendChild(el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.08);", text: c.name || "" }));
              tr.appendChild(el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.08);", text: c.phone || "" }));
              var tdA = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:right;" });
              var bDel = el("button", { class: "eikon-btn danger", text: "Delete" });
              bDel.onclick = function () {
                contacts = contacts.filter(function (x) { return x.id !== c.id; });
                saveContacts(user, contacts);
                renderList(container);
              };
              tdA.appendChild(bDel);
              tr.appendChild(tdA);
              tbody.appendChild(tr);
            });
          }

          tbl.appendChild(tbody);
          container.appendChild(tbl);
        }

        var container = el("div");
        renderList(container);

        E.modal.show("Contacts", container.outerHTML, [
          { label: "Close", onClick: function () { E.modal.hide(); } }
        ]);

        // rehydrate because we used outerHTML
        setTimeout(function () {
          try {
            var body = document.querySelector(".eikon-modal-body");
            if (!body) return;
            body.innerHTML = "";
            body.appendChild(container);
          } catch (e) {}
        }, 0);

      } catch (e) {
        err("contacts error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };

    btnClear.onclick = async function () {
      try {
        if (!user || user.role !== "admin") {
          toast("Forbidden", "Admin only.", "bad", 4200);
          return;
        }

        var ok = await modalConfirm(
          "Clear Local EOD Data",
          "This removes ALL locally stored EOD records (for this location) from this browser.\n\nContinue?",
          "Clear",
          "Cancel"
        );
        if (!ok) return;

        var prefix = keyPrefix(user);
        var keys = lsKeys();
        var count = 0;
        keys.forEach(function (k) {
          if (k.indexOf(prefix) === 0) {
            lsDel(k);
            count++;
          }
        });

        // Clear audit too (location scoped)
        lsDel(auditKey(user));

        writeAudit(user, inDate.value, { action: "ADMIN_CLEAR_LOCAL", details: { removed: count } });

        // reset form state
        rec = emptyRecord(user, inDate.value);
        writeRecordToForm(rec);
        updateKpis();
        setLockedUi(false);

        toast("Cleared", "Removed " + count + " EOD record(s) + audit for this location.", "good", 4200);
      } catch (e) {
        err("clear error", e);
        toast("Error", String(e && (e.message || e)), "bad", 4200);
      }
    };
  }

  // -----------------------------
  // Register module
  // -----------------------------
  E.registerModule({
    id: "endofday",
    title: "End Of Day",
    icon: "🧾",
    order: 60,
    render: render
  });

  dbg("loaded modules.endofday.js");
})();
