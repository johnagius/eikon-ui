/* ui/modules.endofday.js
   Eikon - End Of Day module (UI)
   First implementation: UI + printing + validation + lock + audit + monthly + range report.
   Persistence currently uses localStorage so the UI is testable immediately.
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

  // -----------------------------
  // Debug helpers
  // -----------------------------
  function dbg() {
    try {
      if (E && typeof E.dbg === "function") E.dbg.apply(null, arguments);
    } catch (e) {}
  }

  function warn() {
    try {
      if (E && typeof E.warn === "function") E.warn.apply(null, arguments);
    } catch (e) {}
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
      if (!raw) {
        // Start empty per your requirement (no Benedicta/Alison defaults).
        return [];
      }
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

  function clearLocalEodData() {
    try { window.localStorage.removeItem(LS_EOD_KEY); } catch (e) {}
    try { window.localStorage.removeItem(LS_EOD_CONTACTS_KEY); } catch (e2) {}
    try { window.localStorage.removeItem(LS_EOD_AUDIT_KEY); } catch (e3) {}
  }

  // -----------------------------
  // Modal
  // -----------------------------
  function showModal(title, bodyNode, actions) {
    var overlay = el("div", { class: "eikon-modal-overlay", style: "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;" });
    var box = el("div", { class: "eikon-modal", style: "width:min(900px,100%);max-height:90vh;overflow:auto;background:#0f1420;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 16px 60px rgba(0,0,0,.5);padding:14px;" });

    var head = el("div", { style: "display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px;" }, [
      el("div", { style: "font-weight:900;font-size:16px;color:#e9eef7;" , text: title || "Dialog" }),
      el("button", { class: "eikon-btn", text: "Close" })
    ]);

    head.querySelector("button").onclick = function () {
      try { overlay.remove(); } catch (e) {}
    };

    var bodyWrap = el("div", { style: "padding:6px 2px;" }, [ bodyNode ]);

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
  // Module UI
  // -----------------------------
  async function render(mount) {
    // mount is a real DOM element (core passes ctx.mount)
    mount.innerHTML = "";

    var user = E.state && E.state.user ? E.state.user : null;
    var locationName = user && user.location_name ? String(user.location_name) : "";
    var createdBy = user && user.full_name ? String(user.full_name) : (user && user.email ? String(user.email) : "");

    dbg("[eod] render()", { locationName: locationName, createdBy: createdBy });

    // State
    var state = {
      date: ymd(new Date()),
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

      // Cash count (notes + coins total)
      cash: {
        n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, n5: 0,
        coins_total: 0
      },

      // BOV deposit
      bag_number: "",
      deposit: { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0 },
      contact_id: "",

      // meta
      saved_at: "",
      locked_at: ""
    };

    function isLocked() { return !!state.locked_at; }

    // Load existing record for today+location
    function loadSelectedDate() {
      var existing = getEodByDateAndLoc(state.date, state.location_name);
      if (existing) {
        state = JSON.parse(JSON.stringify(existing));
        dbg("[eod] loaded existing record", { date: state.date, loc: state.location_name, locked: !!state.locked_at });
      } else {
        // reset but keep location/createdBy and defaults
        state.saved_at = "";
        state.locked_at = "";
        state.time_of_day = "AM";
        state.staff = "";
        state.created_by = createdBy;
        state.location_name = locationName;
        state.float_amount = 500;

        state.x = [
          { amount: 0, remark: "" },
          { amount: 0, remark: "" },
          { amount: 0, remark: "" },
          { amount: 0, remark: "" }
        ];
        state.epos = [
          { amount: 0, remark: "" },
          { amount: 0, remark: "" },
          { amount: 0, remark: "" },
          { amount: 0, remark: "" }
        ];
        state.cheques = [
          { amount: 0, remark: "" },
          { amount: 0, remark: "" }
        ];
        state.paid_outs = [
          { amount: 0, remark: "" }
        ];
        state.cash = { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0, n5: 0, coins_total: 0 };
        state.bag_number = "";
        state.deposit = { n500: 0, n200: 0, n100: 0, n50: 0, n20: 0, n10: 0 };
        state.contact_id = "";
        dbg("[eod] new blank record", { date: state.date, loc: state.location_name });
      }
    }

    loadSelectedDate();

    // -----------------------------
    // Calculations
    // -----------------------------
    function totalX() { return state.x.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }
    function totalEpos() { return state.epos.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }
    function totalCheques() { return state.cheques.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }
    function totalPaidOuts() { return state.paid_outs.reduce(function (a, r) { return a + parseNum(r.amount); }, 0); }

    function expectedDeposit() {
      return totalX() - totalEpos() - totalCheques() - totalPaidOuts();
    }

    function countedCashTill() {
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

    function totalCashE() {
      var till = countedCashTill().total;
      var fl = parseNum(state.float_amount);
      var e = till - fl;
      return e < 0 ? 0 : e;
    }

    function roundedDepositF() {
      return roundToNearest5(totalCashE());
    }

    function overUnder() {
      return totalCashE() - expectedDeposit();
    }

    function coinsDiff() {
      return totalCashE() - roundedDepositF();
    }

    function bovTotal() {
      var d = state.deposit || {};
      return 500 * parseNum(d.n500) +
             200 * parseNum(d.n200) +
             100 * parseNum(d.n100) +
              50 * parseNum(d.n50)  +
              20 * parseNum(d.n20)  +
              10 * parseNum(d.n10);
    }

    function monthSummary(monthYm) {
      var all = loadAllEods();
      var loc = state.location_name;
      var m = monthYm || ymFromYmd(state.date);
      var list = all.filter(function (r) {
        return r && r.location_name === loc && ymFromYmd(r.date) === m;
      });

      var sumE = 0;
      var sumOU = 0;
      var sumCoins = 0;
      list.forEach(function (r) {
        var e = (function (rr) {
          var notes =
            500 * parseNum(rr.cash.n500) +
            200 * parseNum(rr.cash.n200) +
            100 * parseNum(rr.cash.n100) +
             50 * parseNum(rr.cash.n50)  +
             20 * parseNum(rr.cash.n20)  +
             10 * parseNum(rr.cash.n10)  +
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

      return {
        days: list.length,
        total_cash_month: sumE,
        over_under_month: sumOU,
        coin_box_month: sumCoins
      };
    }

    // -----------------------------
    // UI building blocks
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
        if (t && t.dataset && t.dataset.allowWhenLocked === "1") continue;
        t.disabled = !!disabled;
      }
    }

    function toast(title, msg) {
      window.alert((title ? title + "\n\n" : "") + (msg || ""));
    }

    // -----------------------------
    // Rerender scheduling (fix typing)
    // -----------------------------
    function getActiveBindSnapshot() {
      try {
        var ae = document.activeElement;
        if (!ae) return null;

        var node = ae;
        if (node && node.getAttribute && !node.getAttribute("data-bind")) {
          var p = node.closest ? node.closest("[data-bind]") : null;
          if (p) node = p;
        }

        if (!node || !node.getAttribute) return null;
        var b = node.getAttribute("data-bind");
        if (!b) return null;

        return {
          bind: b,
          start: (typeof node.selectionStart === "number") ? node.selectionStart : null,
          end: (typeof node.selectionEnd === "number") ? node.selectionEnd : null
        };
      } catch (e) {
        return null;
      }
    }

    function restoreActiveBindSnapshot(snap) {
      if (!snap || !snap.bind) return;
      try {
        var sel = "[data-bind=\"" + snap.bind.replace(/"/g, '\\"') + "\"]";
        var node = mount.querySelector(sel);
        if (!node) return;

        node.focus();
        if (typeof node.setSelectionRange === "function" && snap.start != null && snap.end != null) {
          node.setSelectionRange(snap.start, snap.end);
        }
      } catch (e) {}
    }

    var _rafPending = false;
    var _lastSnap = null;

    function scheduleRerender() {
      _lastSnap = getActiveBindSnapshot();
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(function () {
        _rafPending = false;
        try {
          render(_mountRef);
          restoreActiveBindSnapshot(_lastSnap);
        } catch (e) {
          try { E.error("[eod] scheduled render failed", e); } catch (e2) {}
        }
      });
    }

    // -----------------------------
    // Validation + Save + Lock + Audit
    // -----------------------------
    function validateBeforeSave() {
      var staff = String(state.staff || "").trim();
      if (!staff) return { ok: false, msg: "Staff is required." };

      var loc = String(state.location_name || "").trim();
      if (!loc) return { ok: false, msg: "Location is missing (login location)." };

      var fl = parseNum(state.float_amount);
      if (!(fl >= 0)) return { ok: false, msg: "Float must be a number (>= 0)." };

      // Prevent locking totally blank sheets:
      // Require at least one meaningful numeric input to be entered (non-zero)
      // across X / EPOS / Cheques / Paid Outs / Cash / Deposit.
      var hasNumbers =
        totalX() !== 0 ||
        totalEpos() !== 0 ||
        totalCheques() !== 0 ||
        totalPaidOuts() !== 0 ||
        countedCashTill().total !== 0 ||
        bovTotal() !== 0;

      if (!hasNumbers) {
        return { ok: false, msg: "You cannot save/lock a completely empty EOD. Enter at least one amount (X/EPOS/Cheques/Paid Outs/Cash/Deposit)." };
      }

      // If BOV section is used (any deposit notes or bag entered), require bag number.
      var hasDeposit = bovTotal() > 0 || String(state.bag_number || "").trim() !== "";
      if (hasDeposit && !String(state.bag_number || "").trim()) {
        return { ok: false, msg: "Bag Number is required when BOV deposit is used." };
      }

      return { ok: true };
    }

    function doSave() {
      if (isLocked()) return toast("Locked", "This End Of Day is locked and cannot be edited.");

      var v = validateBeforeSave();
      if (!v.ok) return toast("Missing Information", v.msg);

      state.saved_at = nowIso();

      upsertEod(JSON.parse(JSON.stringify(state)));

      writeAudit({
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "SAVE",
        details: {
          staff: state.staff,
          float_amount: state.float_amount
        }
      });

      scheduleRerender();
    }

    function doLock() {
      if (isLocked()) return toast("Already Locked", "This End Of Day is already locked.");
      var v = validateBeforeSave();
      if (!v.ok) return toast("Cannot Lock", "Fix required fields first:\n\n" + v.msg);

      state.saved_at = state.saved_at || nowIso();
      state.locked_at = nowIso();
      upsertEod(JSON.parse(JSON.stringify(state)));

      writeAudit({
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "LOCK",
        details: {}
      });

      scheduleRerender();
    }

    function doUnlock() {
      if (!isLocked()) return toast("Not Locked", "This End Of Day is not locked.");
      var pw = window.prompt("Enter master key to unlock this End Of Day:", "");
      if (String(pw || "").trim() !== "6036") return toast("Denied", "Incorrect master key.");

      state.locked_at = "";
      upsertEod(JSON.parse(JSON.stringify(state)));

      writeAudit({
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "UNLOCK",
        details: {}
      });

      scheduleRerender();
    }

    function showAuditLog() {
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
    // Contacts management (dropdown)
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
    // Printing (A4) — keep current printed format
    // -----------------------------
    function buildA4HtmlForCurrent() {
      var d = state.date;
      var staff = String(state.staff || "");
      var loc = String(state.location_name || "");

      var Avals = state.x.map(function (r) { return parseNum(r.amount); });
      var Arem = state.x.map(function (r) { return String(r.remark || ""); });
      var Atot = totalX();

      var Bvals = state.epos.map(function (r) { return parseNum(r.amount); });
      var Btot = totalEpos();

      var Crows = state.cheques.slice(0, 4);
      while (Crows.length < 4) Crows.push({ amount: 0, remark: "" });
      var Cvals = Crows.map(function (r) { return parseNum(r.amount); });
      var Crem = Crows.map(function (r) { return String(r.remark || ""); });
      var Ctot = totalCheques();

      var Drows = state.paid_outs.slice(0, 8);
      while (Drows.length < 8) Drows.push({ amount: 0, remark: "" });
      var Dvals = Drows.map(function (r) { return parseNum(r.amount); });
      var Drem = Drows.map(function (r) { return String(r.remark || ""); });
      var Dtot = totalPaidOuts();

      var counted = countedCashTill();
      var Etotal = totalCashE();
      var Ftotal = roundedDepositF();
      var OU = overUnder();
      var COINS = coinsDiff();
      var fl = parseNum(state.float_amount);

      function fmt(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
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
        "</div></div>" +
        "<scr" + "ipt>window.onload=function(){window.print(); setTimeout(function(){window.close();},300);};</scr" + "ipt>" +
        "</body></html>";

      return html;
    }

    function doPrintA4() {
      var v = validateBeforeSave();
      if (!v.ok) return toast("Missing Information", "Cannot print until required fields are completed:\n\n" + v.msg);
      openPrintTabWithHtml(buildA4HtmlForCurrent());

      writeAudit({
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "PRINT_A4",
        details: {}
      });
    }

    function doPrintRangeReport(from, to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return toast("Validation", "From/To must be dates (YYYY-MM-DD).");
      }
      if (to < from) return toast("Validation", "To must be >= From.");

      var all = loadAllEods().filter(function (r) {
        return r && r.location_name === state.location_name && r.date >= from && r.date <= to;
      }).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

      var totalCash = 0;
      var totalOU = 0;
      var totalCoins = 0;

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
        "<div><b>Location:</b> " + esc(state.location_name) + "</div>" +
        "<div><b>Range:</b> " + esc(ddmmyyyy(from)) + " to " + esc(ddmmyyyy(to)) + "</div>" +
        "<div style='margin:10px 0'><b>Totals:</b> Total Cash " + esc(euro(totalCash)) + " | Over/Under " + esc(euro(totalOU)) + " | Coin Box " + esc(euro(totalCoins)) + "</div>" +
        "<table><thead><tr><th>Date</th><th>Total Cash (E)</th><th>Over/Under</th><th>Staff</th><th>Status</th></tr></thead><tbody>" +
        (rowsHtml || "<tr><td colspan='5'>No records in range.</td></tr>") +
        "</tbody></table>" +
        "<scr" + "ipt>window.onload=function(){window.print(); setTimeout(function(){window.close();},300);};</scr" + "ipt>" +
        "</body></html>";

      openPrintTabWithHtml(html);

      writeAudit({
        ts: nowIso(),
        date: state.date,
        location_name: state.location_name,
        by: createdBy,
        action: "PRINT_RANGE",
        details: { from: from, to: to }
      });
    }

    // -----------------------------
    // UI: Build rows for sections
    // -----------------------------
    function makePaymentTable(title, rows, maxRows, onAddRow, locked, bindPrefix) {
      var card = el("div", { class: "eikon-card" });
      card.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;" }, [
        el("div", { style: "font-weight:900;color:#e9eef7;", text: title }),
        el("button", { class: "eikon-btn", text: "Add Entry", disabled: locked })
      ]));
      var btnAdd = card.querySelector("button");
      btnAdd.onclick = function () { if (onAddRow) onAddRow(); };

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

          tdName.textContent = title.indexOf("X Reading") >= 0 ? ("X Reading " + (idx + 1)) :
                               title.indexOf("EPOS") >= 0 ? ("EPOS " + (idx + 1)) :
                               title.indexOf("Cheques") >= 0 ? ("Cheque " + (idx + 1)) :
                               ("Paid Out " + (idx + 1));

          tdTot.textContent = euro(parseNum(r.amount));

          var inAmt = el("input", {
            class: "eikon-input eikon-slim-input",
            type: "number",
            value: String(parseNum(r.amount)),
            disabled: locked,
            "data-bind": bindPrefix + "." + idx + ".amount"
          });
          inAmt.oninput = function () {
            r.amount = parseNum(inAmt.value);
            scheduleRerender();
          };

          var inRem = el("input", {
            class: "eikon-input",
            type: "text",
            value: String(r.remark || ""),
            disabled: locked,
            "data-bind": bindPrefix + "." + idx + ".remark"
          });
          inRem.oninput = function () {
            r.remark = String(inRem.value || "");
            // remark doesn't need totals, but keep consistent
            scheduleRerender();
          };

          tdAmt.appendChild(inAmt);
          tdRem.appendChild(inRem);

          if ((title.indexOf("Cheques") >= 0 || title.indexOf("Paid Outs") >= 0) && rows.length > 1) {
            var btnDel = el("button", { class: "eikon-btn", text: "Remove", disabled: locked });
            btnDel.onclick = function () {
              rows.splice(idx, 1);
              scheduleRerender();
            };
            tdAct.appendChild(btnDel);
          } else {
            tdAct.textContent = "";
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
    // Main render
    // -----------------------------
    var headerCard = el("div", { class: "eikon-card" });
    var bodyCard = el("div", { class: "eikon-card" });

    // Top action bar
    var btnSave = el("button", { class: "eikon-btn primary", text: "Save", "data-allow-when-locked": "0" });
    var btnPrintA4 = el("button", { class: "eikon-btn", text: "Print End of Day on A4", "data-allow-when-locked": "1" });
    var btnLock = el("button", { class: "eikon-btn", text: "Lock", "data-allow-when-locked": "0" });
    var btnUnlock = el("button", { class: "eikon-btn", text: "Unlock (Master Key)", "data-allow-when-locked": "1" });
    var btnAudit = el("button", { class: "eikon-btn", text: "Audit Log", "data-allow-when-locked": "1" });

    btnSave.onclick = doSave;
    btnPrintA4.onclick = doPrintA4;
    btnLock.onclick = doLock;
    btnUnlock.onclick = doUnlock;
    btnAudit.onclick = showAuditLog;

    // Range report button
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

    // Admin clear local data (prototype)
    var btnClear = el("button", { class: "eikon-btn", text: "Admin: Clear Local EOD Data", "data-allow-when-locked": "1" });
    btnClear.onclick = function () {
      var pw = window.prompt("Master key required to clear ALL local EOD data:", "");
      if (String(pw || "").trim() !== "6036") return toast("Denied", "Incorrect master key.");
      var ok = window.confirm("This will delete ALL local EOD records, contacts, and audit log from this browser.\n\nContinue?");
      if (!ok) return;
      clearLocalEodData();
      toast("Cleared", "Local EOD data cleared.");
      // reload current date record after wipe
      loadSelectedDate();
      scheduleRerender();
    };

    // Status line
    var statusLine = el("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;" });
    if (state.locked_at) statusLine.appendChild(statusPill("Locked", "good"));
    else statusLine.appendChild(statusPill("Unlocked", "warn"));
    if (state.saved_at) statusLine.appendChild(statusPill("Saved", "good"));
    else statusLine.appendChild(statusPill("Not Saved", "bad"));

    // Header fields
    var inDate = el("input", { class: "eikon-input eikon-slim-input", type: "date", value: state.date, "data-allow-when-locked": "1", "data-bind": "meta.date" });
    inDate.onchange = function () {
      state.date = inDate.value;
      dbg("[eod] date change", state.date);
      loadSelectedDate();
      scheduleRerender();
    };

    var selTime = el("select", { class: "eikon-select eikon-slim-input", "data-allow-when-locked": "0", "data-bind": "meta.time_of_day" }, [
      el("option", { value: "AM", text: "AM" }),
      el("option", { value: "PM", text: "PM" })
    ]);
    selTime.value = state.time_of_day || "AM";
    selTime.onchange = function () { state.time_of_day = selTime.value; scheduleRerender(); };

    var inStaff = el("input", { class: "eikon-input", type: "text", value: state.staff || "", placeholder: "Required", "data-allow-when-locked": "0", "data-bind": "meta.staff" });
    inStaff.oninput = function () { state.staff = inStaff.value; /* no need to re-render */ };

    var inLoc = el("input", { class: "eikon-input", type: "text", value: state.location_name || "", disabled: true, "data-allow-when-locked": "1" });

    var inFloat = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(state.float_amount)), "data-allow-when-locked": "0", "data-bind": "meta.float_amount" });
    inFloat.oninput = function () { state.float_amount = parseNum(inFloat.value); scheduleRerender(); };

    var topRow = el("div", { class: "eikon-row", style: "gap:10px;flex-wrap:wrap;" }, [
      btnSave, btnReport, btnPrintA4, btnLock, btnUnlock, btnAudit, btnClear
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

    // Payments section (X / EPOS / Cheques / Paid Outs)
    var paymentsWrap = el("div", { style: "display:grid;grid-template-columns:1fr;gap:12px;margin-top:12px;" });

    paymentsWrap.appendChild(makePaymentTable("X Readings", state.x, 4, null, isLocked(), "x"));
    paymentsWrap.appendChild(makePaymentTable("EPOS", state.epos, 4, null, isLocked(), "epos"));

    paymentsWrap.appendChild(makePaymentTable("Cheques", state.cheques, 2, function () {
      state.cheques.push({ amount: 0, remark: "" });
      scheduleRerender();
    }, isLocked(), "cheques"));

    paymentsWrap.appendChild(makePaymentTable("Paid Outs", state.paid_outs, 1, function () {
      state.paid_outs.push({ amount: 0, remark: "" });
      scheduleRerender();
    }, isLocked(), "paid_outs"));

    // Cash count + BOV deposit + summaries
    var cashCard = el("div", { class: "eikon-card" });
    cashCard.appendChild(el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;" }, [
      el("div", { style: "font-weight:900;color:#e9eef7;", text: "Cash Count" })
    ]));

    var cashGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px;" });

    // Cash denom table
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

      var inp = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(state.cash[key])), disabled: isLocked(), "data-bind": "cash." + key });
      inp.oninput = function () { state.cash[key] = parseNum(inp.value); scheduleRerender(); };

      tdC.appendChild(inp);
      tdT.textContent = euro(parseNum(state.cash[key]) * denom);

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

    (function () {
      var tr = el("tr", {}, []);
      var tdD = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);", text: "Coins" });
      var tdC = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;" });
      var tdT = el("td", { style: "padding:8px;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;" });

      var inp = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(state.cash.coins_total)), disabled: isLocked(), "data-bind": "cash.coins_total" });
      inp.oninput = function () { state.cash.coins_total = parseNum(inp.value); scheduleRerender(); };

      tdC.appendChild(inp);
      tdT.textContent = euro(parseNum(state.cash.coins_total));

      tr.appendChild(tdD); tr.appendChild(tdC); tr.appendChild(tdT);
      tb.appendChild(tr);
    })();

    tblCash.appendChild(tb);

    var counted = countedCashTill();
    leftCash.appendChild(tblCash);
    leftCash.appendChild(el("div", { style: "margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;display:flex;justify-content:space-between;align-items:center;" }, [
      el("div", { style: "font-weight:900;", text: "Total Cash:" }),
      el("div", { style: "font-weight:900;", text: euro(counted.total) })
    ]));

    // BOV deposit
    var rightBov = el("div", {});
    rightBov.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:6px;", text: "BOV Cash Deposit" }));

    var contacts = loadContacts();
    var selContact = el("select", { class: "eikon-select", disabled: isLocked(), "data-bind": "bov.contact_id" });
    selContact.appendChild(el("option", { value: "", text: "— Select Contact —" }));
    contacts.forEach(function (c) {
      var label = (c.phone ? (c.name + " (" + c.phone + ")") : c.name);
      selContact.appendChild(el("option", { value: c.id, text: label }));
    });
    selContact.value = state.contact_id || "";
    selContact.onchange = function () { state.contact_id = selContact.value; scheduleRerender(); };

    var btnManageContacts = el("button", { class: "eikon-btn", text: "Manage Contacts", disabled: isLocked() });
    btnManageContacts.onclick = function () {
      showContactsManager(function () {
        scheduleRerender();
      });
    };

    var inBag = el("input", { class: "eikon-input", type: "text", value: state.bag_number || "", disabled: isLocked(), "data-bind": "bov.bag_number" });
    inBag.oninput = function () { state.bag_number = inBag.value; /* don't need rerender */ };

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

      var inp = el("input", { class: "eikon-input eikon-slim-input", type: "number", value: String(parseNum(state.deposit[key])), disabled: isLocked(), "data-bind": "deposit." + key });
      inp.oninput = function () { state.deposit[key] = parseNum(inp.value); scheduleRerender(); };

      tdC.appendChild(inp);
      tdT.textContent = euro(parseNum(state.deposit[key]) * denom);

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
    rightBov.appendChild(el("div", { style: "margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;display:flex;justify-content:space-between;align-items:center;" }, [
      el("div", { style: "font-weight:900;", text: "Total BOV Deposit:" }),
      el("div", { style: "font-weight:900;", text: euro(bovTotal()) })
    ]));

    cashGrid.appendChild(leftCash);
    cashGrid.appendChild(rightBov);
    cashCard.appendChild(cashGrid);

    // Summary cards
    var summaryGrid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;" });

    var sumCard = el("div", { class: "eikon-card" });
    sumCard.appendChild(el("div", { style: "font-weight:900;color:#e9eef7;margin-bottom:10px;", text: "Summary" }));
    sumCard.appendChild(el("div", { style: "display:grid;gap:8px;" }, [
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Rounded Cash Deposit:" }),
        el("div", { style: "font-weight:900;", text: euro(-roundedDepositF()) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Over / Under:" }),
        el("div", { style: "font-weight:900;", text: euro(overUnder()) })
      ]),
      el("div", { style: "display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;" }, [
        el("div", { text: "Coins:" }),
        el("div", { style: "font-weight:900;", text: euro(coinsDiff()) })
      ])
    ]));

    var m = monthSummary(ymFromYmd(state.date));
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
        el("div", { text: "Coin Box:" }),
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

    // Lock handling
    if (isLocked()) {
      setDisabledDeep(bodyCard, true);
      var allHdrInputs = headerCard.querySelectorAll("input,select,button");
      for (var z = 0; z < allHdrInputs.length; z++) {
        var t = allHdrInputs[z];
        var allow = t && t.dataset && t.dataset.allowWhenLocked === "1";
        if (!allow && t !== btnPrintA4 && t !== btnReport && t !== btnAudit && t !== btnUnlock && t !== btnClear && t !== inDate) {
          t.disabled = true;
        }
      }
      btnSave.disabled = true;
      btnLock.disabled = true;
      btnUnlock.disabled = false;
    } else {
      btnSave.disabled = false;
      btnLock.disabled = false;
      btnUnlock.disabled = true;
    }

    // Expose a small debug hook (optional)
    try {
      window.__EIKON_EOD_DEBUG__ = {
        getState: function () { return JSON.parse(JSON.stringify(state)); },
        listAll: function () { return loadAllEods(); },
        clearLocal: function () { clearLocalEodData(); }
      };
    } catch (e) {}
  }

  // rerender trampoline
  var _mountRef = null;

  // Register module (FIX: core passes ctx object, not mount directly)
  E.registerModule({
    id: "endofday",
    name: "End Of Day",
    icon: "clock",
    render: function (ctx) {
      // ctx = { E, mount, user }
      var mountEl = ctx && ctx.mount ? ctx.mount : ctx;
      _mountRef = mountEl;
      return render(mountEl);
    }
  });

  /*
    Server-side DB clear (you asked for a query):
    Your real table names may differ; adjust accordingly.

    -- Example (generic):
    DELETE FROM eod_records;
    DELETE FROM eod_contacts;
    DELETE FROM eod_audit;

    -- If you need to clear by org/location:
    DELETE FROM eod_records WHERE org_id = ? AND location_id = ?;
  */
})();
