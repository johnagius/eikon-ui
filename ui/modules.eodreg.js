/* End of day, new layout: close the till for one day. Who and the float; X readings, EPOS, cheques and paid outs
   (as many lines as the classic screen allows, each with a remark); the cash count by note and the coins; the
   difference worked out as you type with the classic screen's own sums (expected = X − EPOS − cheques − paid outs,
   cash = till − float, the bag rounded to 10s or 5s, over/under, coins kept); the BOV bank bag (number, contact,
   notes, filled from the count until changed by hand); the month so far. Save, and Save and lock.
   A new day starts from the last saved day's float (€1000.00, as the classic, only when there is none) and the shift
   by Malta time (PM from 13:00; an earlier day, the shift of the day before it); the summary line says where the float
   came from, or "Float changed from …" when it differs from the last saved day (q5-6).
   The same record and endpoint as the classic screen; every save sends the whole record (the server replaces it).
   Before saving, the day is read again: if another till saved it since it was opened here, nothing is saved and
   the person chooses. A locked day is read-only here, except for a correction by the pharmacist (role admin): "Correct
   this day" asks what was wrong, unlocks the day (the classic unlock: the server only clears locked_at) with the
   reason, and the day opens as an unlocked day; the reason goes with every save of that day here until it is locked
   again (correction_reason, written into the audit entries by the worker). Print on A4 prints the day on the classic
   screen's A4 sheet (its rows and wording; page numbers and the time printed, Malta time, in the page margin); the
   unlock and the print leave the classic screen's own audit note in this browser, as it does. The date-range report,
   the audit log, copying the deposit to an email and managing contacts stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var DEN = [500, 200, 100, 50, 20, 10, 5];
  var LISTS = [
    { k: "x", title: "X readings", one: "X reading", add: "Add an X reading" },
    { k: "epos", title: "EPOS", one: "EPOS", add: "Add an EPOS line" },
    { k: "cheques", title: "Cheques", one: "Cheque", add: "Add a cheque" },
    { k: "paid_outs", title: "Paid outs", one: "Paid out", add: "Add a paid out" }
  ];
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var LS_ROUND = "eikon_eod_rounding"; // shared with the classic screen
  var LS_SHADOW = "eikon_eod_records_v2"; // the classic screen's copy of each day in this browser

  var S = {
    mount: null, date: "", w: null, base: null, contacts: [], loading: false, error: "", saving: false, err: "", warn: "",
    dirty: false, autoDep: true, ask: null, conflict: null, lastSent: "", shadow: "", month: null, monthYm: "", monthErr: "", seq: 0,
    prev: null, memo: { dates: {}, recs: {} } // q5-6: the last saved day before this one (its float and shift are the defaults); reads shared with the month
  };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function dayLabel(s) { if (s === today()) return "Today"; var p = String(s).split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()] + " " + (+p[2]) + " " + MON[+p[1] - 1]; }
  function eur(n) { var v = Number(n || 0); return (v < 0 ? "−€" : "€") + Math.abs(v).toFixed(2); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function user() { return (E.state && E.state.user) || {}; }
  function whoOpen() { return !S.w || !!S.whoOpen; } // b4-4: day, staff, shift and float are one summary line until "Change"

  // ---- the classic screen's number rules, unchanged, so the totals are the same to the cent
  function mnum(raw) { var s = String(raw == null ? "" : raw).trim(); if (!s) return 0; if (s.indexOf(",") >= 0 && s.indexOf(".") === -1) s = s.replace(/,/g, "."); if (s === ".") return 0; var v = Number(s); return isFinite(v) ? v : 0; }
  function inum(raw) { var s = String(raw == null ? "" : raw).trim(); if (!s) return 0; var v = parseInt(s, 10); return isFinite(v) ? v : 0; }
  function unit() { try { return parseInt(localStorage.getItem(LS_ROUND), 10) === 5 ? 5 : 10; } catch (e) { return 10; } }
  function setUnit(u) { try { localStorage.setItem(LS_ROUND, String(u === 5 ? 5 : 10)); } catch (e) {} }
  function round5(n) { var u = unit(); return Math.round(Number(n || 0) / u) * u; }
  function total(rows) { return (rows || []).reduce(function (a, r) { return a + mnum(r && r.amount); }, 0); }
  function calc(r) {
    var A = total(r.x), B = total(r.epos), C = total(r.cheques), D = total(r.paid_outs), c = r.cash || {}, d = r.deposit || {};
    var notes = 500 * inum(c.n500) + 200 * inum(c.n200) + 100 * inum(c.n100) + 50 * inum(c.n50) + 20 * inum(c.n20) + 10 * inum(c.n10) + 5 * inum(c.n5);
    var coins = mnum(c.coins_total), till = notes + coins, exp = A - B - C - D;
    var Ec = till - mnum(r.float_amount); if (Ec < 0) Ec = 0;
    var F = round5(Ec);
    var bov = 500 * inum(d.n500) + 200 * inum(d.n200) + 100 * inum(d.n100) + 50 * inum(d.n50) + 20 * inum(d.n20) + 10 * inum(d.n10) + 5 * inum(d.n5);
    return { A: A, B: B, C: C, D: D, exp: exp, notes: notes, coins: coins, till: till, E: Ec, F: F, OU: Ec - exp, COINS: Ec - F, bov: bov };
  }
  function autoDeposit(r) { // the classic screen's fill: largest notes first, never more notes than were counted
    var t = Math.max(0, calc(r).F), c = r.cash || {}, out = {};
    DEN.forEach(function (d) { var take = Math.min(Math.floor(t / d), inum(c["n" + d])); if (take < 0) take = 0; t -= take * d; out["n" + d] = String(take); });
    return out;
  }
  function sameDeposit(a, b) { return DEN.every(function (d) { return inum(a && a["n" + d]) === inum(b && b["n" + d]); }); }

  // ---- a record from the server (or nothing) as the working copy; every field kept, the shape the classic screen uses
  function blank() {
    var row = function () { return [{ amount: "0", remark: "" }]; };
    return { time_of_day: "AM", staff: "", float_amount: "1000.00", x: row(), epos: row(), cheques: row(), paid_outs: row(),
      cash: { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0", coins_total: "0" },
      deposit: { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0" }, bag_number: "", contact_id: "", notes: "" };
  }
  function working(rec) {
    var w = blank(); if (!rec) return w;
    w.time_of_day = rec.time_of_day || "AM";
    w.staff = String(rec.staff || rec.staff_name || "");
    w.float_amount = rec.float_amount != null && rec.float_amount !== "" ? String(rec.float_amount) : "1000.00";
    LISTS.forEach(function (L) {
      var rows = Array.isArray(rec[L.k]) ? rec[L.k] : [];
      w[L.k] = rows.length ? rows.map(function (r) { var o = r && typeof r === "object" ? clone(r) : {}; o.amount = o.amount == null ? "0" : String(o.amount); o.remark = o.remark == null ? "" : String(o.remark); return o; }) : [{ amount: "0", remark: "" }];
    });
    var c = rec.cash && typeof rec.cash === "object" ? rec.cash : {};
    Object.keys(w.cash).forEach(function (k) { if (c[k] != null) w.cash[k] = String(c[k]); });
    Object.keys(c).forEach(function (k) { if (w.cash[k] == null) w.cash[k] = c[k]; }); // anything else in the record stays
    var d = rec.deposit || rec.bov_deposit || {}; d = typeof d === "object" ? d : {};
    Object.keys(w.deposit).forEach(function (k) { if (d[k] != null) w.deposit[k] = String(d[k]); });
    w.bag_number = String(rec.bag_number || rec.bov_bag_number || "");
    w.contact_id = rec.contact_id != null && rec.contact_id !== "" ? String(rec.contact_id) : (rec.bov_contact_id != null ? String(rec.bov_contact_id) : "");
    w.notes = String(rec.notes || "");
    return w;
  }
  // What the money adds up to, for telling two versions of the day apart
  function moneySig(r) {
    var w = working(r), c = w.cash;
    return JSON.stringify([mnum(w.float_amount), LISTS.map(function (L) { return w[L.k].map(function (x) { return [Math.round(mnum(x.amount) * 100), String(x.remark || "").trim()]; }); }),
      DEN.map(function (d) { return inum(c["n" + d]); }), Math.round(mnum(c.coins_total) * 100)]);
  }
  function fullSig(r) { var w = working(r); return JSON.stringify([moneySig(r), w.staff.trim(), w.time_of_day, w.bag_number.trim(), w.contact_id, DEN.map(function (d) { return inum(w.deposit["n" + d]); })]); }

  // ---- server
  async function getDay(date) {
    var loc = String(user().location_name || "");
    var r = await E.apiFetch("/endofday/record?date=" + encodeURIComponent(date) + (loc ? "&location_name=" + encodeURIComponent(loc) : ""), { method: "GET", headers: { "Cache-Control": "no-cache" } });
    if (!r || r.ok === false) throw new Error((r && r.error) || "Could not open the day");
    var rec = r.record || r.eod || r.item || null;
    return rec && typeof rec === "object" && (rec.date || rec.eod_date) ? rec : null;
  }
  async function loadContacts() {
    try { var r = await E.apiFetch("/endofday/contacts", { method: "GET" }); var list = (r && (r.contacts || r.items)) || [];
      S.contacts = list.map(function (x) { return { id: String(x.id), name: String(x.name || x.display_name || x.title || "").trim() }; }).filter(function (x) { return x.name; });
    } catch (e) { S.contacts = S.contacts || []; }
  }
  async function loadMonth(ym) {
    var seq = ++S.seq; S.monthErr = "";
    try {
      var memo = S.memo; S.memo = { dates: {}, recs: {} }; // what opening the day already read is not read again (once)
      var dates = memo.dates[ym] || await monthDates(ym);
      var recs = {}, i = 0;
      var next = async function () { while (i < dates.length) { var d = dates[i++]; var rec = memo.recs[d] !== undefined ? memo.recs[d] : await getDay(d); if (rec) recs[d] = rec; } };
      await Promise.all([next(), next(), next(), next()]); // a few at a time, like a person scrolling the month
      if (seq !== S.seq) return;
      S.month = recs; S.monthYm = ym;
    } catch (e) { if (seq === S.seq) { S.month = null; S.monthErr = "The month so far could not be read."; } }
    if (seq === S.seq) E.whenFormIdle(S.mount, function () { paint(); });
  }
  async function monthDates(ym) {
    var r = await E.apiFetch("/endofday/dates?month=" + encodeURIComponent(ym), { method: "GET" });
    if (!r || r.ok === false) throw new Error((r && r.error) || "Could not read the month");
    return ((r.dates || r.items || r.records) || []).map(function (x) { return typeof x === "string" ? x : (x && (x.date || x.eod_date)); }).filter(isYmd);
  }
  // q5-6: the last day saved before `date` at this pharmacy (this month, else the two months before), read with the
  // same calls the month below makes anyway (kept in S.memo for it). null: none; false: it could not be read.
  async function prevDay(date) {
    try {
      var ym = date.slice(0, 7);
      for (var k = 0; k < 3; k++) {
        var list = S.memo.dates[ym] = await monthDates(ym);
        var before = list.filter(function (d) { return d < date; }).sort();
        if (before.length) { var d = before[before.length - 1], rec = await getDay(d); S.memo.recs[d] = rec; return rec || null; }
        var y = +ym.slice(0, 4), mo = +ym.slice(5, 7) - 1; if (mo < 1) { mo = 12; y--; } ym = y + "-" + pad(mo);
      }
      return null;
    } catch (e) { return false; }
  }
  function prevFloat() { var p = S.prev, s = p && p.float_amount != null ? String(p.float_amount).trim() : ""; return /^\d+([.,]\d{1,2})?$/.test(s) ? mnum(s) : null; }
  // A new day's shift: today, PM from 13:00 Malta time; an earlier day, the shift of the day saved before it.
  function shiftFor(date) {
    if (date === today()) { var hm = E.maltaHm ? E.maltaHm(new Date()) : pad(new Date().getHours()) + ":00"; return hm >= "13:00" ? "PM" : "AM"; }
    return S.prev && S.prev.time_of_day === "PM" ? "PM" : "AM";
  }
  // What the float is measured against, said under the summary line: where a new day's float came from, or that it
  // differs from the last saved day (amber, never red: a float can change on purpose).
  function floatNote() {
    var w = S.w; if (!w) return null;
    var pf = prevFloat(), now = mnum(w.float_amount), locked = !!(S.base && S.base.locked_at);
    if (pf != null && Math.round(now * 100) !== Math.round(pf * 100) && String(w.float_amount || "").trim() !== "") return { wn: true, t: "Float changed from " + eur(pf) + ", the float on " + dayLabel(S.prev.date || S.prev.eod_date) + "." };
    if (S.base || locked) return null;
    if (pf != null) return { t: "Float as on " + dayLabel(S.prev.date || S.prev.eod_date) + ". Change it if today's is different." };
    if (S.prev === false) return { wn: true, t: "The last saved day could not be read, so the float starts at €1000.00. Check it before saving." };
    return { t: "No earlier day saved, so the float starts at €1000.00. Change it if yours is different." };
  }
  function floatNoteHtml() { var n = floatNote(); return '<div class="eod-hint' + (n && n.wn ? " wn" : "") + '" data-b="floatnote"' + (n ? "" : " hidden") + ">" + (n ? esc(n.t) : "") + "</div>"; }
  function shadowCheck(date, cloud) { // a day the classic screen kept in this browser but never got to the server
    try {
      var all = JSON.parse(localStorage.getItem(LS_SHADOW) || "[]"), loc = String(user().location_name || ""), best = null;
      if (!Array.isArray(all)) return "";
      all.forEach(function (r) { if (r && r.date === date && String(r.location_name || "") === loc && (!best || ms(r) > ms(best))) best = r; });
      if (!best || moneySig(best) === moneySig(cloud)) return "";
      if (cloud && ms(cloud) >= ms(best)) return "";
      return "This computer holds different figures for this day, typed in the classic screen, that are not on the server. The server's are shown here. To send those instead, open the day in the classic screen.";
    } catch (e) { return ""; }
  }
  function shadowReplace(rec) { // keep the classic screen in this browser showing what was just saved (as it does after a load)
    try {
      var all = JSON.parse(localStorage.getItem(LS_SHADOW) || "null"); if (!Array.isArray(all)) return;
      var loc = String(user().location_name || ""), hit = false, copy = clone(rec); copy.date = copy.date || copy.eod_date; if (!copy.location_name) copy.location_name = loc;
      for (var i = 0; i < all.length; i++) if (all[i] && all[i].date === copy.date && String(all[i].location_name || "") === loc) { all[i] = copy; hit = true; }
      if (hit) localStorage.setItem(LS_SHADOW, JSON.stringify(all));
    } catch (e) {}
  }
  function ms(r) { // the classic screen's reading of a record's time: ISO, or SQLite time in UTC
    if (!r) return 0;
    return Math.max.apply(null, [r.updated_at, r.saved_at, r.locked_at].map(function (v) {
      var s = String(v == null ? "" : v).trim(); if (!s) return 0;
      if (s.indexOf("T") >= 0) { var a = Date.parse(s); return isFinite(a) ? a : 0; }
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(s)) { var b = Date.parse(s.replace(" ", "T") + "Z"); return isFinite(b) ? b : 0; }
      var c = Date.parse(s); return isFinite(c) ? c : 0;
    }));
  }
  function hm(v) { var t = ms({ updated_at: v }); if (!t) return ""; var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  async function load(opts) {
    var keepView = E.takeSaveFailed && E.takeSaveFailed();
    var keepDraft = !!(opts && opts.keepDraft);
    if (S.fix && S.fix.date !== S.date) S.fix = null; // another day opened: its correction form goes
    S.loading = true; S.error = ""; S.memo = { dates: {}, recs: {} }; paint();
    try {
      var both = await Promise.all([getDay(S.date), S.contacts.length ? null : loadContacts(), prevDay(S.date)]);
      var rec = both[0]; S.prev = both[2]; if (rec) S.memo.recs[S.date] = rec;
      if (!keepDraft || !S.w) { // a draft kept from a moment ago stays as typed, still measured against what it was based on
        S.base = rec; S.w = working(rec); S.dirty = false; S.conflict = null; S.ask = null;
        if (!rec) { // a new day: the person signed in, the float of the last saved day, the shift by the time (q5-6); all shown in the summary line, and Change changes them
          S.w.staff = String(user().full_name || "").trim();
          var pf = prevFloat(); if (pf != null) S.w.float_amount = pf.toFixed(2);
          S.w.time_of_day = shiftFor(S.date);
        }
        if (!String(S.w.staff || "").trim()) S.whoOpen = true; // nobody to name in the summary line: the fields are shown
        S.autoDep = !rec || sameDeposit(rec.deposit || rec.bov_deposit, autoDeposit(S.w));
        if (S.autoDep) S.w.deposit = autoDeposit(S.w);
      }
      S.shadow = shadowCheck(S.date, rec);
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not open the day"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
    if (!S.error && S.w) loadMonth(S.date.slice(0, 7));
  }

  // ---- drawing
  function css() {
    if (document.getElementById("eikon-eodreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-eodreg-css";
    st.textContent =
      ".eod{max-width:880px;margin:0 auto;padding-bottom:8px}" +
      ".eod-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 12px 0 0;min-height:44px;margin:-8px 0 2px;cursor:pointer}" +
      ".eod-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".eod h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.eod-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".eod-day{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)}.eod .eod-day input{font:inherit;font-size:16px;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:10px;height:44px;padding:0 10px}" +
      ".eod-day input:focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:2px}" +
      ".eod-who{display:flex;align-items:center;gap:12px;min-height:46px;padding:4px 8px 4px 14px;font-size:15px}.eod-who span{flex:1;min-width:0;font-variant-numeric:tabular-nums}" + // b4-4: the summary line
      ".eod-st{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;font-size:13.5px;color:var(--muted)}" +
      ".eod-st .eod-a4{order:9;margin-left:auto;min-height:44px}" + // after the chips, also the "Not saved" one added while typing
      ".eod-chip{font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;background:rgba(118,118,128,.12);color:var(--text)}" +
      ".eod-chip.ok{background:var(--ok-soft,rgba(28,138,91,.14));color:var(--ok,#1C8A5B)}.eod-chip.wn{background:var(--warn-soft,rgba(201,138,18,.16));color:var(--warn,#8A5A08)}" +
      ".eod-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 16px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".eod-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.eod-btn:disabled{opacity:.55;cursor:default}" +
      ".eod-mp{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 2px 0;font-size:12.5px;color:var(--muted)}.eod-mp .eod-btn{min-height:44px}" +
      ".eod-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;justify-content:space-between;gap:10px}.eod-lab b{color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:0;font-size:13px;text-transform:none}" +
      ".eod-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;overflow:hidden}" +
      ".eod-f{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 14px;border-top:.5px solid var(--border)}.eod-card>:first-child{border-top:0}" +
      ".eod-f>span{flex:0 0 104px;font-size:15px}.eod input,.eod select{font:inherit;color:inherit}" +
      ".eod-f input,.eod-f select{flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:16px;padding:10px 0}" +
      ".eod-pr{display:flex;align-items:center;gap:8px;min-height:46px;padding:0 6px 0 14px;border-top:.5px solid var(--border)}" +
      ".eod-pr .n{flex:0 0 18px;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".eod-pr input{border:0;outline:0;background:transparent;font-size:16px;padding:10px 0;min-width:0}.eod-pr .amt{flex:0 0 96px;font-variant-numeric:tabular-nums}.eod-pr .rem{flex:1;border-left:.5px solid var(--border);padding-left:10px}" +
      ".eod-card :is(label,.eod-pr):focus-within{box-shadow:inset 3px 0 0 var(--accent);background:rgba(10,143,106,.07)}" +
      ".eod-pr input.rem[readonly]::placeholder{color:transparent}" +
      ".eod-x{flex:0 0 40px;height:40px;border:0;background:none;color:var(--muted);font-size:20px;line-height:1;border-radius:10px;cursor:pointer}.eod-x:hover{background:rgba(118,118,128,.12)}" +
      ".eod-add{display:block;width:100%;text-align:left;border:0;border-top:.5px solid var(--border);background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:12px 14px;cursor:pointer}" +
      ".eod-cr{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".eod-cr .d{flex:0 0 64px;font-size:15px;font-variant-numeric:tabular-nums}.eod-cr input{flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:16px;padding:10px 0;font-variant-numeric:tabular-nums}" +
      ".eod-cr em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--muted);font-size:14.5px;min-width:84px;text-align:right}" +
      ".eod-tot{display:flex;justify-content:space-between;align-items:baseline;padding:12px 14px;border-top:.5px solid var(--border);font-weight:600}.eod-tot b{font-size:17px;font-variant-numeric:tabular-nums}" +
      ".eod-sum .r{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:11px 14px;border-top:.5px solid var(--border);font-size:15px}.eod-sum .r:first-child{border-top:0}" +
      ".eod-sum .r small{display:block;font-size:12.5px;color:var(--muted);margin-top:1px}.eod-sum .r b{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}" +
      ".eod-big{padding:16px 14px 14px;display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.eod-big span{font-size:13px;color:var(--muted)}.eod-big b{font-size:26px;font-weight:700;letter-spacing:-.01em;font-variant-numeric:tabular-nums}" +
      ".eod-big b.ok{color:var(--ok,#1C8A5B)}.eod-big b.dn{color:var(--danger)}.eod-big b.wn{color:var(--warn,#8A5A08)}" +
      ".eod-unit{display:inline-flex;border:1px solid var(--border);border-radius:9px;overflow:hidden;margin-left:8px;vertical-align:middle}.eod-unit label{position:relative;display:block}" +
      ".eod-unit input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}.eod-unit span{display:block;font-size:12.5px;font-weight:600;padding:3px 9px;color:var(--text)}" +
      ".eod-unit input:checked+span{background:rgba(118,118,128,.2)}.eod-unit input:focus-visible+span{outline:3px solid rgba(10,143,106,.5);outline-offset:-3px}" +
      ".eod-hint{font-size:13px;color:var(--muted);padding:10px 14px;border-top:.5px solid var(--border);line-height:1.45}.eod-hint button{border:0;background:none;color:var(--accent);font:inherit;font-weight:600;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}" +
      ".eod-hint.wn{color:var(--warn,#8A5A08)}" +
      ".eod-note{background:var(--warn-soft,rgba(201,138,18,.16));color:var(--text);border-radius:12px;padding:12px 14px;margin-top:14px;font-size:14px;line-height:1.45}.eod-note .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}" +
      ".eod-note.dn{background:var(--danger-soft,rgba(191,59,46,.12))}" +
      ".eod-acts{margin:20px 0 0;padding:12px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border);position:sticky;bottom:0;z-index:5;background:var(--bg)}" + // Save stays in reach while the long form scrolls
      ".eod-acts .eod-btn{min-height:44px}.eod [aria-invalid=true]{box-shadow:inset 0 -2px 0 var(--danger)}" +
      ".eod-acts .ou{flex:1;min-width:120px;font-size:13px;color:var(--muted)}.eod-acts .ou b{display:block;font-size:16px;color:var(--text);font-variant-numeric:tabular-nums}" +
      ".eod-err{color:var(--danger);font-size:13.5px;margin-top:10px}" +
      ".eod-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".eod-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}" +
      ".eod .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .eod-chip.ok{color:#5FD3A0}html[data-ui2]:not([data-ui2-visit]) .eod-big b.ok{color:#5FD3A0}html[data-ui2]:not([data-ui2-visit]) .eod-big b.dn{color:#FF7A72}" +
      "html[data-ui2]:not([data-ui2-visit]) .eod-chip.wn,html[data-ui2]:not([data-ui2-visit]) .eod-big b.wn,html[data-ui2]:not([data-ui2-visit]) .eod-hint.wn{color:#F2B84B}html[data-ui2]:not([data-ui2-visit]) .eod-err{color:#FF7A72}}" +
      "@media (max-width:760px){.eod-acts{position:fixed;left:0;right:0;bottom:calc(84px + env(safe-area-inset-bottom,0px));margin:0;padding:8px 16px;border-top:.5px solid var(--border);box-shadow:0 -6px 16px rgba(0,0,0,.06)}.eod-foot{padding-bottom:72px}.eod :is(input,select,button){scroll-margin-bottom:150px}}" + // phones: pinned just above the tab bar (the page itself scrolls there)
      "@media (max-width:600px){.eod{padding:4px 16px 0}.eod h1{font-size:32px}.eod-f>span{flex-basis:88px}.eod-pr .amt{flex-basis:82px}.eod-cr em{min-width:72px}.eod-big b{font-size:24px}}";
    document.head.appendChild(st);
  }

  function counted(c) { return !!(c.A || c.B || c.C || c.D || c.till); } // b4-4: no figure typed yet is not "Exact"
  function ouText(c) { var v = Math.round(c.OU * 100) / 100; if (!counted(c)) return "Nothing counted yet"; return v > 0 ? "Over by " + eur(v) : v < 0 ? "Short by " + eur(-v) : "Exact"; }
  function ouCls(c) { var v = Math.round(c.OU * 100) / 100; if (!counted(c)) return ""; return v === 0 ? "ok" : v < 0 ? "dn" : "wn"; }
  function shown(v, int) { var s = String(v == null ? "" : v); return (int ? inum(s) === 0 && /^\s*0*\s*$/.test(s) : /^\s*0*(\.0*)?\s*$/.test(s)) ? "" : s; } // a zero shows as an empty box with 0 behind it

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "eodreg") return; // left before a reply came back: do not draw over the next screen
    if (S.w && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var locked = !!(S.base && S.base.locked_at), ro = locked || S.saving;
    var h = '<div class="eod"><button class="eod-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("eodreg")) + '</button>' +
      '<div class="eod-top"><div><h1>End of day</h1><p class="eod-sub">Close the till: X readings, cash, cheques and the bank bag.</p></div>' +
      (whoOpen() ? '<label class="eod-day"><span>Day</span><input type="date" id="eod-day" max="' + esc(today()) + '" value="' + esc(S.date) + '"></label>' : "") + "</div>";
    if (S.loading && !S.w) h += '<div class="eod-quiet">Opening ' + esc(dayLabel(S.date).toLowerCase() === "today" ? "today" : dayLabel(S.date)) + "…</div>";
    else if (S.error && !S.w) h += '<div class="eod-quiet">' + esc(S.error) + ' <button class="eod-btn" data-act="retry" style="margin-left:8px">Try again</button></div>';
    else if (S.w) h += dayHtml(locked, ro);
    h += '<p class="eod-foot">' + (E.correct && E.correct.can() ? "A locked day is corrected here with Correct this day, saying what was wrong. " : "A locked day is corrected by the pharmacist. ") + 'A date-range report across months, the audit log, copying the deposit to an email and managing bank contacts are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) && ae.name ? '[name="' + ae.name + '"]' : (ae && (ae.id === "eod-day" || ae.id === "eod-fixnote") ? "#" + ae.id : "");
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) again.focus(); }
    wire(m);
  }

  // Correcting a locked day (the pharmacist only): the reason, then the day is unlocked; until it is locked again the
  // reason travels with each save of that day.
  function fixing() { return !!(S.fixReason && S.fixDate === S.date); }
  function fixHtml(locked) {
    if (!E.correct || !E.correct.can()) return "";
    if (!locked) return fixing() ? '<div class="eod-note" id="eod-fixnote" tabindex="-1" role="status"><b>Unlocked for a correction:</b> ' + esc(S.fixReason) + ". Change what was wrong, then Save and lock. The audit keeps the day as it was.</div>" : "";
    if (!S.fix) return '<div class="eod-fix"><button class="eod-btn" data-act="fix">Correct this day</button></div>';
    return '<div class="eod-note" role="group" aria-label="Unlock this day to correct it"><b>Unlock ' + esc(dayLabel(S.date)) + " to correct it?</b> Once unlocked, its figures can be changed again; lock it again when done. The audit keeps the day as it was, who unlocked it and why." +
      '<label class="eod-f" style="margin-top:8px"><span>What was wrong?</span><input name="fix_reason" maxlength="500" value="' + esc(S.fix.reason || "") + '" placeholder="e.g. Cheque total typed twice" aria-required="true"></label>' +
      (S.fix.err ? '<div class="eod-err" role="alert">' + esc(S.fix.err) + "</div>" : "") +
      '<div class="acts"><button class="eod-btn" data-act="fix-no">Cancel</button><button class="eod-btn p" data-act="fix-go"' + (S.fix.busy ? " disabled" : "") + ">" + (S.fix.busy ? "Unlocking…" : "Unlock to correct") + "</button></div></div>";
  }
  async function unlockToFix() {
    if (!S.fix || S.fix.busy || !E.correct.can()) return;
    var ri = S.mount && S.mount.querySelector("[name=fix_reason]"); if (ri) S.fix.reason = ri.value;
    var reason = String(S.fix.reason || "").replace(/\s+/g, " ").trim();
    if (!reason) { S.fix.err = "Write what was wrong, for the audit. Nothing was unlocked."; paint(true); var r0 = S.mount.querySelector("[name=fix_reason]"); if (r0) r0.focus(); return; }
    S.fix.busy = true; S.fix.err = ""; paint(true);
    try {
      var fresh = await getDay(S.date);
      if (fresh && fresh.locked_at) {
        S.base = fresh;
        var body = payload(working(fresh), false);
        body.locked_at = ""; body.unlock = true; body.action = "UNLOCK"; body.correction_reason = reason; // the classic unlock, with the reason
        var r = await E.apiFetch("/endofday/record", { method: "PUT", body: JSON.stringify({ record: body }) });
        if (!r || r.ok === false) throw new Error((r && r.error) || "Could not unlock");
        if (r.record) shadowReplace(r.record);
        classicAudit("UNLOCK"); // the classic unlock's own note, as it writes it
      }
      S.fixReason = reason; S.fixDate = S.date; S.fix = null;
      E.toast(dayLabel(S.date) + " is unlocked for the correction", "success");
      await load();
      var fn = S.mount && S.mount.querySelector("#eod-fixnote"); if (fn) fn.focus(); // the button pressed is gone: focus goes to what it did
    } catch (x) {
      if (S.fix) { S.fix.busy = false; S.fix.err = x && x.network ? "The connection dropped. Check the day before trying again." : "Not unlocked: " + String((x && (x.message || x)) || "error"); }
      if (x && x.network) return load();
      return paint(true);
    }
  }

  function dayHtml(locked, ro) {
    var w = S.w, c = calc(w), b = S.base, RO = ro ? " readonly" : "";
    var a4 = '<button type="button" class="eod-btn eod-a4" data-act="print-a4">Print on A4</button>';
    var st = locked ? '<span class="eod-chip ok">Locked</span><span>' + esc(dayLabel(S.date)) + " was closed" + (hm(b.locked_at) ? " at " + esc(hm(b.locked_at)) : "") + ". Read-only here.</span>"
      : b ? '<span class="eod-chip">Saved</span><span>' + (hm(b.updated_at || b.saved_at) ? "Last saved at " + esc(hm(b.updated_at || b.saved_at)) : "Saved") + (b.staff || b.staff_name ? " by " + esc(b.staff || b.staff_name) : "") + ". Not locked yet.</span>"
      : '<span class="eod-chip wn">Not started</span><span>Nothing saved for ' + esc(dayLabel(S.date) === "Today" ? "today" : dayLabel(S.date)) + " yet.</span>";
    if (S.dirty && !locked) st += '<span class="eod-chip wn">Not saved</span>';
    var h = '<div class="eod-st">' + st + a4 + "</div>" + fixHtml(locked);
    if (S.error) h += '<div class="eod-err" role="alert">' + esc(S.error) + "</div>";
    if (S.shadow) h += '<div class="eod-note">' + esc(S.shadow) + "</div>";
    if (S.conflict) {
      var cf = S.conflict;
      h += '<div class="eod-note dn" role="alert"><b>Nothing was saved.</b> This day was saved on another till' + (hm(cf.updated_at) ? " at " + esc(hm(cf.updated_at)) : "") + (cf.staff || cf.staff_name ? " by " + esc(cf.staff || cf.staff_name) : "") +
        " after you opened it here. Their figures: expected " + esc(eur(calc(working(cf)).exp)) + ", cash " + esc(eur(calc(working(cf)).E)) + ". Yours are still on screen." +
        '<div class="acts"><button class="eod-btn" data-act="theirs">Show theirs</button><button class="eod-btn" data-act="mine">Save mine over theirs</button></div></div>';
    }
    h += '<form id="eod-form" autocomplete="off" novalidate>';
    // who and when
    if (!whoOpen()) h += '<div class="eod-lab"><span>Who and when</span></div><div class="eod-card"><div class="eod-who"><span>' + esc([dayLabel(S.date), String(w.staff || "").trim(), w.time_of_day === "PM" ? "PM" : "AM", "float " + eur(mnum(w.float_amount))].join(" · ")) +
      '</span><button type="button" class="eod-btn" data-act="who" aria-label="Change the day, staff, shift or float">Change</button></div>' + floatNoteHtml() + "</div>";
    else h += '<div class="eod-lab"><span>Who and when</span></div><div class="eod-card">' +
      '<label class="eod-f"><span>Staff</span><input name="staff" value="' + esc(w.staff) + '" placeholder="Who is closing"' + RO + "></label>" +
      '<label class="eod-f"><span>Shift</span><select name="time_of_day"' + (ro ? " disabled" : "") + '><option value="AM"' + (w.time_of_day !== "PM" ? " selected" : "") + '>AM</option><option value="PM"' + (w.time_of_day === "PM" ? " selected" : "") + ">PM</option></select></label>" +
      '<label class="eod-f"><span>Float €</span><input name="float_amount" inputmode="decimal" value="' + esc(w.float_amount) + '" placeholder="0.00"' + RO + "></label>" + floatNoteHtml() + "</div>";
    // the four lists
    LISTS.forEach(function (L) {
      var rows = w[L.k], key = { x: "A", epos: "B", cheques: "C", paid_outs: "D" }[L.k];
      h += '<div class="eod-lab"><span>' + esc(L.title) + '</span><b data-b="' + key + '">' + esc(eur(c[key])) + '</b></div><div class="eod-card">';
      rows.forEach(function (r, i) {
        var nm = L.one + " " + (i + 1);
        h += '<div class="eod-pr"><span class="n" aria-hidden="true">' + (i + 1) + "</span>" +
          '<input class="amt" name="row:' + L.k + ":" + i + ':amount" inputmode="decimal" value="' + esc(shown(r.amount)) + '" placeholder="0.00" aria-label="' + esc(nm) + ', amount in euro"' + RO + ">" +
          '<input class="rem" name="row:' + L.k + ":" + i + ':remark" value="' + esc(r.remark) + '" placeholder="Remark" aria-label="' + esc(nm) + ', remark"' + RO + ">" +
          (rows.length > 1 && !ro ? '<button type="button" class="eod-x" data-act="rm" data-l="' + L.k + '" data-i="' + i + '" aria-label="Remove ' + esc(nm) + '">×</button>' : "") + "</div>";
      });
      if (!ro) h += '<button type="button" class="eod-add" data-act="addrow" data-l="' + L.k + '">' + esc(L.add) + "</button>";
      h += "</div>";
    });
    // cash
    h += '<div class="eod-lab"><span>Cash in the till</span><b data-b="till">' + esc(eur(c.till)) + '</b></div><div class="eod-card">';
    DEN.forEach(function (d) {
      h += '<label class="eod-cr"><span class="d">€' + d + '</span><input name="cash:n' + d + '" inputmode="numeric" value="' + esc(shown(w.cash["n" + d], true)) + '" placeholder="0" aria-label="€' + d + ' notes, how many"' + RO + '><em data-b="c' + d + '">' + esc(eur(inum(w.cash["n" + d]) * d)) + "</em></label>";
    });
    h += '<label class="eod-cr"><span class="d">Coins</span><input name="cash:coins_total" inputmode="decimal" value="' + esc(shown(w.cash.coins_total)) + '" placeholder="0.00" aria-label="Coins, total in euro"' + RO + '><em data-b="ccoins">' + esc(eur(c.coins)) + "</em></label></div>";
    // the difference
    var u = unit();
    h += '<div class="eod-lab"><span>The difference</span></div><div class="eod-card eod-sum">' +
      '<div class="eod-big"><span>Cash against the readings</span><b data-b="ouBig" class="' + ouCls(c) + '">' + esc(ouText(c)) + "</b></div>" +
      '<div class="r"><span>Expected in cash<small>X readings − EPOS − cheques − paid outs</small></span><b data-b="exp">' + esc(eur(c.exp)) + "</b></div>" +
      '<div class="r"><span>Cash taken<small>Till − float</small></span><b data-b="E">' + esc(eur(c.E)) + "</b></div>" +
      '<div class="r"><span>Over / under<small>Cash taken − expected</small></span><b data-b="OU">' + esc(eur(c.OU)) + "</b></div>" +
      '<div class="r"><span>For the bank, rounded<span class="eod-unit" role="radiogroup" aria-label="Round to">' +
        '<label><input type="radio" name="eod-unit" value="10"' + (u === 10 ? " checked" : "") + '><span>10s</span></label><label><input type="radio" name="eod-unit" value="5"' + (u === 5 ? " checked" : "") + "><span>5s</span></label></span>" +
        '<small>Cash taken, to the nearest ' + u + "</small></span><b data-b=\"F\">" + esc(eur(c.F)) + "</b></div>" +
      '<div class="r"><span>Coins kept<small>Cash taken − rounded</small></span><b data-b="COINS">' + esc(eur(c.COINS)) + "</b></div></div>";
    // bank bag
    h += '<div class="eod-lab"><span>Bank bag (BOV)</span><b data-b="bov">' + esc(eur(c.bov)) + '</b></div><div class="eod-card">' +
      '<label class="eod-f"><span>Bag number</span><input name="bag_number" value="' + esc(w.bag_number) + '" placeholder="Needed when there is a deposit"' + RO + "></label>" +
      '<label class="eod-f"><span>Contact</span><select name="contact_id"' + (ro ? " disabled" : "") + '><option value="">None</option>' +
        S.contacts.map(function (k) { return '<option value="' + esc(k.id) + '"' + (String(w.contact_id) === k.id ? " selected" : "") + ">" + esc(k.name) + "</option>"; }).join("") +
        (w.contact_id && !S.contacts.some(function (k) { return k.id === String(w.contact_id); }) ? '<option value="' + esc(w.contact_id) + '" selected>Contact ' + esc(w.contact_id) + "</option>" : "") + "</select></label>";
    h += '<div class="eod-hint" data-b="depmode">' + depHint(ro) + "</div>";
    DEN.forEach(function (d) {
      h += '<label class="eod-cr"><span class="d">€' + d + '</span><input name="dep:n' + d + '" inputmode="numeric" value="' + esc(shown(w.deposit["n" + d], true)) + '" placeholder="0" aria-label="€' + d + ' notes in the bag, how many"' + RO + '><em data-b="d' + d + '">' + esc(eur(inum(w.deposit["n" + d]) * d)) + "</em></label>";
    });
    h += '<div class="eod-hint wn" data-b="bagdiff"' + (Math.abs(c.bov - c.F) < 0.005 ? " hidden" : "") + ">" + esc(bagDiff(c)) + "</div></div>";
    // the month
    h += monthHtml();
    h += "</form>";
    // the bar at the bottom
    if (S.ask === "lock") {
      h += '<div class="eod-note" role="alertdialog" aria-label="Lock this day"><b>Lock ' + esc(dayLabel(S.date) === "Today" ? "today" : dayLabel(S.date)) + "?</b> The figures are saved and the day can no longer be changed. Only the pharmacist can unlock it again." +
        '<div class="acts"><button class="eod-btn" data-act="ask-no">Cancel</button><button class="eod-btn p" data-act="lock-yes">Save and lock</button></div></div>';
    } else if (S.ask === "leave") {
      h += '<div class="eod-note" role="alertdialog" aria-label="Figures not saved"><b>Your figures for ' + esc(dayLabel(S.date)) + " are not saved.</b> Open " + esc(dayLabel(S.pendingDate || today())) + " anyway?" +
        '<div class="acts"><button class="eod-btn" data-act="ask-no">Stay</button><button class="eod-btn" data-act="leave-yes">Leave without saving</button></div></div>';
    }
    if (S.err) h += '<div class="eod-err" id="eod-err" role="alert">' + esc(S.err) + "</div>";
    if (!locked) {
      h += '<div class="eod-acts"><div class="ou">Over / under<b data-b="ouBar">' + esc(ouText(c)) + "</b></div>" +
        '<button class="eod-btn" data-act="lock"' + (S.saving ? " disabled" : "") + ">Save and lock</button>" +
        '<button class="eod-btn p" data-act="save"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save") + "</button></div>";
    }
    return h;
  }
  function depHint(ro) {
    if (ro) return "The notes that went to the bank.";
    return S.autoDep ? "Filled from the cash count, rounded to the nearest " + unit() + ". Change a line to set it by hand."
      : 'Set by hand. <button type="button" data-act="refill">Fill from the cash count</button>';
  }
  function bagDiff(c) { return "The bag holds " + eur(c.bov) + "; the cash taken, rounded, is " + eur(c.F) + "."; }
  function monthDays() { // the classic screen's month: every saved day, this one as it stands on screen
    if (!S.month || S.monthYm !== S.date.slice(0, 7)) return null;
    var t = { E: 0, OU: 0, COINS: 0, days: 0 }, add = function (r) { var c = calc(r); t.E += c.E; t.OU += c.E - c.exp; t.COINS += c.E - c.F; };
    Object.keys(S.month).forEach(function (d) { t.days++; if (d !== S.date) add(working(S.month[d])); });
    add(S.w); // this day as it stands on screen (the classic screen: stored month − stored day + what is typed)
    return t;
  }
  // The classic "Range report" for the month: every saved day, its columns in its order, and the totals row.
  function printMonth() {
    var MB = E.months, ym = S.date.slice(0, 7); if (!MB || !S.month || S.monthYm !== ym) return;
    var days = Object.keys(S.month).sort(), e2 = function (n) { return "€" + Number(n || 0).toFixed(2); };
    var cols = ["Staff Name", "Date"].concat(["Total Cash", "Rounded Cash Deposited"]).concat(["Bag Number"]).concat(["Total X Reading", "Total EPOS", "Total Cheques", "Total Paid Outs", "Total Cash Count", "Rounded", "Total Cash Till", "Total BOV Deposit", "Over / Under", "Coins"])
      .map(function (h, i) { return i < 2 || i === 4 ? h : { h: h, num: true }; });
    var sum = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var rows = days.map(function (d) {
      var w = working(S.month[d]), c = calc(w), v = [c.E, c.F, c.A, c.B, c.C, c.D, c.till, round5(c.till), mnum(w.float_amount), c.bov, c.OU, c.COINS];
      v.forEach(function (x, i) { sum[i] += x; });
      return [w.staff, MB.dmy(d), e2(v[0]), e2(v[1]), w.bag_number.trim()].concat(v.slice(2).map(e2));
    });
    MB.print({ register: "End Of Day — Range Report", month: ym, landscape: true,
      intro: '<p class="sub"><b>Range:</b> ' + esc(MB.dmy(MB.first(ym))) + " to " + esc(MB.dmy(MB.last(ym))) + "</p>",
      sections: [{ cols: cols, rows: rows, empty: "No records in range.", foot: rows.length ? ["Totals (" + rows.length + " days)", "", e2(sum[0]), e2(sum[1]), ""].concat(sum.slice(2).map(e2)) : null }] });
  }
  // ---- the classic "Print End of Day on A4": the same sheet, rows, wording and sums (rows past the sheet's count add
  // into the totals, as in the classic). Added in the page margin only: the pharmacy, the time printed (Malta time) and
  // page numbers. It prints the day as it is on screen; the classic's checks before printing come first.
  function printProblem(w, loc) {
    S.bad = "";
    if (!String(w.staff || "").trim()) { S.bad = "staff"; return "Write who is closing (Staff), then print."; }
    if (!loc) return "This sign-in has no pharmacy name to print on the sheet. Sign out and in again, then print.";
    if (!(mnum(w.float_amount) >= 0)) { S.bad = "float_amount"; return "Write the float, e.g. 1000.00, then print."; }
    if (calc(w).bov > 0 && !String(w.bag_number || "").trim()) { S.bad = "bag_number"; return "Write the bag number (there are notes in the bank bag), then print."; }
    return "";
  }
  function a4Html(w, loc) {
    var c = calc(w), d = S.date, dmy = d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4);
    var fmt = function (n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var fill = function (list, n) { var a = (list || []).slice(0, n); while (a.length < n) a.push({ amount: "0", remark: "" }); return a; };
    var row = function (lbl, val, note) { return "<tr><td class='l'>" + esc(lbl) + "</td><td class='c'>€</td><td class='r'>" + esc(fmt(val)) + "</td><td class='note'>" + (note ? esc(note) : "") + "</td></tr>"; };
    var lines = function (list, n, lbl, rem) { return fill(list, n).map(function (r, i) { return row(lbl(i), mnum(r.amount), rem ? String(r.remark || "") : ""); }).join(""); };
    var ou = c.OU, ouText = (ou < 0 ? "-€ " + fmt(Math.abs(ou)) : "€ " + fmt(Math.abs(ou))), ouNote = ou < 0 ? "(- UNDER)" : ou > 0 ? "(OVER)" : "";
    var now = new Date(), pd = E.maltaYmd ? E.maltaYmd(now) : today(), printed = pd.slice(8, 10) + "/" + pd.slice(5, 7) + "/" + pd.slice(0, 4) + " " + (E.maltaHm ? E.maltaHm(now) : "");
    var foot = (loc + " · End of day " + dmy + " · printed " + printed + " (Malta)").replace(/["\\]/g, "'");
    return "<!DOCTYPE html><html><head><meta charset='utf-8'><title>EOD (A4)</title><style>" +
      "@page{size:A4;margin:6mm 0 10mm;@bottom-left{content:\"" + foot + "\";font:9pt Arial,sans-serif;color:#000;padding-left:20mm}@bottom-right{content:\"Page \" counter(page) \" of \" counter(pages);font:9pt Arial,sans-serif;color:#000;padding-right:20mm}}" +
      "@media print{.printbar,.pf{display:none !important;} html,body{height:auto;overflow:visible !important;margin:0;padding:0;} .page{height:auto !important;min-height:0;width:210mm;box-sizing:border-box;} .sheet{margin:4mm auto !important;} .gap{height:6mm !important;} *{page-break-after:avoid !important;page-break-before:avoid !important;page-break-inside:avoid !important;} }" +
      "html,body{margin:0;padding:0;background:#fff;color:#000} body{font-family:Arial, sans-serif} .page{width:210mm;height:297mm;position:relative}" +
      ".sheet{width:170mm;margin:25mm auto} table{width:100%;border-collapse:collapse}" +
      "td{border:1px solid #000;padding:6px;font-size:12pt} .hdr td{font-weight:bold}" +
      ".l{width:46%}.c{width:4%;text-align:center}.r{width:20%;text-align:right}.note{width:30%}" +
      ".gap{height:10mm}.pf{font-size:9pt;margin-top:6mm}" +
      ".printbar{position:sticky;top:0;background:#fff;padding:8px;border-bottom:1px solid #ccc;display:flex;gap:8px;justify-content:flex-end}" +
      "</style></head><body>" +
      "<div class='printbar'><button data-eikon-print='print'>Print</button></div>" +
      "<div class='page'><div class='sheet'>" +
      "<table class='hdr'><tr><td>DATE:</td><td>" + esc(dmy) + "</td></tr><tr><td>STAFF:</td><td>" + esc(String(w.staff || "")) + "</td></tr><tr><td>LOCATION:</td><td>" + esc(loc) + "</td></tr></table>" +
      "<div class='gap'></div><table>" +
      lines(w.x, 4, function (i) { return "A" + (i + 1) + "  X READING " + (i + 1); }, true) + row("TOTAL X READINGS", c.A, "") +
      lines(w.epos, 4, function (i) { return "B" + (i + 1) + "  EPOS"; }, false) + row("TOTAL EPOS", c.B, "") +
      lines(w.cheques, 4, function (i) { return "C" + (i + 1) + "  CHEQUES"; }, true) + row("TOTAL CHEQUES", c.C, "") +
      lines(w.paid_outs, 8, function (i) { return "D" + (i + 1) + "  PAID OUTS"; }, true) + row("TOTAL PAID OUTS", c.D, "") +
      row("EXPECTED DEPOSIT (A − B − C − D)", c.exp, "") +
      row("E  TOTAL CASH (Till − Float €" + mnum(w.float_amount).toFixed(2) + ")", c.E, "") +
      row("F  ROUNDED CASH DEPOSITED", c.F, "") +
      "</table><div class='gap'></div><table>" +
      "<tr><td class='l'>OVER/UNDER</td><td class='c'>€</td><td class='r'>" + esc(ouText) + "</td><td class='note'>" + esc(ouNote) + "</td></tr>" +
      row("COINS (E − F)", c.COINS, "") +
      "</table><p class='pf'>" + esc(foot) + "</p></div></div></body></html>";
  }
  function printA4() {
    if (!S.w) return;
    if (!(S.base && S.base.locked_at) && !S.saving) keep();
    var loc = String((S.base && S.base.location_name) || user().location_name || "").trim(), had = !!S.err;
    S.err = printProblem(S.w, loc);
    if (S.err) { if (S.bad === "staff" || S.bad === "float_amount") S.whoOpen = true; paint(true); return toBad(); }
    var html = a4Html(S.w, loc); E.eodLastA4 = html;
    var url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    if (E.openPrintUrlOrLink) E.openPrintUrlOrLink(url, { delay: 150, focus: true }); else E.openPrintUrl(url, { delay: 150, focus: true });
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
    classicAudit("PRINT_A4");
    if (had) paint(true); // an earlier message about printing goes once it has printed
  }
  // The classic screen's own audit note: kept in this browser (its Audit log shows it) and offered to the server as it
  // offers it (best effort; this server keeps its own audit of every save, lock and unlock).
  function classicAudit(action) {
    var u = user(), entry = { ts: new Date().toISOString(), date: S.date, location_name: String((S.base && S.base.location_name) || u.location_name || ""), by: String(u.full_name || u.email || ""), action: action, details: {} };
    try { var all = JSON.parse(localStorage.getItem("eikon_eod_audit_v1") || "[]"); if (!Array.isArray(all)) all = []; all.push(entry); localStorage.setItem("eikon_eod_audit_v1", JSON.stringify(all)); } catch (e) {}
    var body = JSON.stringify({ audit: entry }), paths = ["/endofday/audit", "/eod/audit"], i = 0;
    (function next() { if (i >= paths.length) return; E.apiFetch(paths[i++], { method: "POST", headers: { "Content-Type": "application/json" }, body: body }).then(function (r) { if (r && r.ok === false) next(); }, next); })();
  }

  function monthHtml() {
    var mn = MON[+S.date.slice(5, 7) - 1], t = monthDays();
    var h = '<div class="eod-lab"><span>' + esc(mn) + ' so far</span><span data-b="mdays">' + (t ? t.days + (t.days === 1 ? " day saved" : " days saved") : "") + '</span></div><div class="eod-card eod-sum">';
    if (!t) return h + '<div class="r"><span>' + esc(S.monthErr || "Adding up the month…") + "</span></div></div>";
    return h + '<div class="r"><span>Total cash</span><b data-b="mE">' + esc(eur(t.E)) + "</b></div>" +
      '<div class="r"><span>Over / under</span><b data-b="mOU">' + esc(eur(t.OU)) + "</b></div>" +
      '<div class="r"><span>Coin box</span><b data-b="mCOINS">' + esc(eur(t.COINS)) + "</b></div></div>" +
      '<p class="eod-mp"><button type="button" class="eod-btn" data-act="print-month">Print ' + esc(E.months ? E.months.label(S.date.slice(0, 7)) : "the month") + '</button><span>The days saved, as the classic range report prints them. Choose a day in another month to print that one.</span></p>';
  }

  // ---- typing: numbers follow in place, nothing is redrawn under the fingers
  function live() {
    var m = S.mount, w = S.w; if (!m || !w) return;
    var set = function (k, v) { var el = m.querySelector('[data-b="' + k + '"]'); if (el) el.textContent = v; };
    var fn = m.querySelector('[data-b="floatnote"]'); if (fn) { var n = floatNote(); fn.hidden = !n; fn.textContent = n ? n.t : ""; fn.classList.toggle("wn", !!(n && n.wn)); } // q5-6
    if (S.autoDep && !(S.base && S.base.locked_at)) {
      w.deposit = autoDeposit(w);
      DEN.forEach(function (d) { var el = m.querySelector('[name="dep:n' + d + '"]'); if (el && el !== document.activeElement) el.value = shown(w.deposit["n" + d], true); });
    }
    var c = calc(w);
    ["A", "B", "C", "D", "exp", "E", "F", "COINS"].forEach(function (k) { set(k, eur(c[k])); });
    set("OU", eur(c.OU)); set("till", eur(c.till)); set("ccoins", eur(c.coins)); set("bov", eur(c.bov));
    set("ouBig", ouText(c)); set("ouBar", ouText(c));
    var big = m.querySelector('[data-b="ouBig"]'); if (big) big.className = ouCls(c);
    DEN.forEach(function (d) { set("c" + d, eur(inum(w.cash["n" + d]) * d)); set("d" + d, eur(inum(w.deposit["n" + d]) * d)); });
    var bd = m.querySelector('[data-b="bagdiff"]'); if (bd) { bd.textContent = bagDiff(c); bd.hidden = Math.abs(c.bov - c.F) < 0.005; }
    var t = monthDays(); if (t) { set("mE", eur(t.E)); set("mOU", eur(t.OU)); set("mCOINS", eur(t.COINS)); }
  }
  function keep() {
    var f = S.mount && S.mount.querySelector("#eod-form"); if (!f || !S.w) return;
    f.querySelectorAll("input[name],select[name]").forEach(function (el) { put(el.name, el.value); });
  }
  function put(name, v) {
    var w = S.w, p = String(name).split(":");
    if (p[0] === "row") { var row = w[p[1]] && w[p[1]][+p[2]]; if (row) row[p[3]] = v; }
    else if (p[0] === "cash") w.cash[p[1]] = v;
    else if (p[0] === "dep") w.deposit[p[1]] = v;
    else if (["staff", "time_of_day", "float_amount", "bag_number", "contact_id"].indexOf(name) >= 0) w[name] = v;
  }

  function wire(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("eodreg");
        else if (act === "retry") load();
        else if (act === "print-month") printMonth();
        else if (act === "print-a4") printA4();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "eodreg"); } catch (x) {} E.openClassic("endofday"); }
        else if (act === "addrow") { keep(); var L = b.getAttribute("data-l"); S.w[L].push({ amount: "0", remark: "" }); S.dirty = true; paint(true); var n = S.w[L].length - 1;
          setTimeout(function () { var f = m.querySelector('[name="row:' + L + ":" + n + ':amount"]'); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form") && document.activeElement !== b)) f.focus(); }, 30); }
        else if (act === "rm") { keep(); var L2 = b.getAttribute("data-l"); if (S.w[L2].length > 1) { S.w[L2].splice(+b.getAttribute("data-i"), 1); S.dirty = true; } paint(true); var ad = m.querySelector('[data-act=addrow][data-l="' + L2 + '"]'); if (ad) ad.focus(); }
        else if (act === "refill") { keep(); S.autoDep = true; S.dirty = true; S.w.deposit = autoDeposit(S.w); paint(true); }
        else if (act === "save") save(false);
        else if (act === "fix") { S.fix = { reason: "", err: "", busy: false, date: S.date }; paint(true); var fr = m.querySelector("[name=fix_reason]"); if (fr) fr.focus(); }
        else if (act === "fix-no") { S.fix = null; paint(true); var fb = m.querySelector("[data-act=fix]"); if (fb) fb.focus(); }
        else if (act === "fix-go") unlockToFix();
        else if (act === "who") { keep(); S.whoOpen = true; paint(true); var dy = m.querySelector("#eod-day"); if (dy) dy.focus(); }
        else if (act === "lock") { keep(); S.ask = "lock"; S.err = ""; paint(true); setTimeout(function () { var y = m.querySelector("[data-act=lock-yes]"); if (y) y.focus(); }, 30); }
        else if (act === "lock-yes") { S.ask = null; save(true); }
        else if (act === "ask-no") { keep(); S.ask = null; S.pendingDate = ""; paint(true); var di = m.querySelector("#eod-day"); if (di) di.value = S.date; }
        else if (act === "leave-yes") { S.ask = null; S.dirty = false; S.date = S.pendingDate || today(); S.pendingDate = ""; S.w = null; S.month = null; S.err = ""; S.conflict = null; load(); }
        else if (act === "theirs") { S.conflict = null; S.dirty = false; S.err = ""; load(); }
        else if (act === "mine") { keep(); var cf = S.conflict; S.conflict = null; if (cf && cf.locked_at) { S.err = "That day has been locked meanwhile. Nothing was saved."; return paint(true); } S.base = cf; save(false); } // measured against theirs now: a third save meanwhile is caught again
      });
    });
    var day = m.querySelector("#eod-day");
    if (day) day.addEventListener("change", function () {
      var v = day.value; if (!isYmd(v) || v === S.date) return;
      if (v > today()) { day.value = S.date; return; }
      if (S.dirty) { keep(); S.pendingDate = v; S.ask = "leave"; paint(true); return; }
      S.date = v; S.w = null; S.month = null; S.err = ""; S.conflict = null; load();
    });
    var f = m.querySelector("#eod-form");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); save(false); });
      f.addEventListener("keydown", function (ev) { // b4-4: Enter goes on to the next amount (after the last one, to Save); it never saves by itself
        var t = ev.target; if (ev.key !== "Enter" || ev.isComposing || !t || t.tagName !== "INPUT" || t.type === "radio") return;
        ev.preventDefault();
        var nx = Array.prototype.filter.call(f.querySelectorAll("input[inputmode]:not([readonly])"), function (x) { return t.compareDocumentPosition(x) & 4; })[0];
        if (nx) { nx.focus(); try { nx.select(); } catch (x) {} } else { var sv = m.querySelector("[data-act=save]"); if (sv) sv.focus(); }
      });
      f.addEventListener("input", function (ev) {
        var t = ev.target; if (!t || !t.name || !S.w || (S.base && S.base.locked_at)) return;
        if (t.name === "eod-unit") return;
        put(t.name, t.value); S.dirty = true; S.err = "";
        if (/^dep:/.test(t.name) && S.autoDep) { S.autoDep = false; var hint = m.querySelector('[data-b="depmode"]'); if (hint) hint.innerHTML = depHint(false); wire1(hint); }
        live(); markDirty();
      });
      f.addEventListener("change", function (ev) {
        var t = ev.target; if (!t) return;
        if (t.name === "eod-unit") { setUnit(+t.value); keep(); if (S.autoDep) S.w.deposit = autoDeposit(S.w); paint(true); var r = m.querySelector('input[name="eod-unit"]:checked'); if (r) r.focus(); }
        else if (t.name && S.w) { put(t.name, t.value); S.dirty = true; markDirty(); }
      });
    }
  }
  function wire1(hint) { var b = hint && hint.querySelector("[data-act=refill]"); if (b) b.addEventListener("click", function () { keep(); S.autoDep = true; S.dirty = true; S.w.deposit = autoDeposit(S.w); paint(true); }); }
  function markDirty() { var st = S.mount && S.mount.querySelector(".eod-st"); if (st && !st.querySelector(".eod-chip.dirty")) { var s = document.createElement("span"); s.className = "eod-chip wn dirty"; s.textContent = "Not saved"; if (!/Not saved/.test(st.textContent)) st.appendChild(s); } }

  // ---- saving: the whole record, as the server replaces it
  function check(w) { // the first problem, and (S.bad) the box it is in, so the cursor goes straight to it
    S.bad = "";
    var no = function (msg, name) { S.bad = name; return msg; };
    var money = /^\d+([.,]\d{1,2})?$/, count = /^\d+$/;
    var bad = function (v, re) { var s = String(v == null ? "" : v).trim(); return s !== "" && !re.test(s); };
    if (!String(w.staff || "").trim()) return no("Write who is closing (Staff). Nothing was saved.", "staff");
    if (String(w.float_amount || "").trim() === "" || bad(w.float_amount, money)) return no("Write the float, e.g. 1000 or 1000.00. Nothing was saved.", "float_amount");
    for (var i = 0; i < LISTS.length; i++) {
      var L = LISTS[i];
      for (var j = 0; j < w[L.k].length; j++) if (bad(w[L.k][j].amount, money)) return no("Check " + L.one + " " + (j + 1) + ": write an amount like 25.50 (no minus, at most two decimals). Nothing was saved.", "row:" + L.k + ":" + j + ":amount");
    }
    for (var k = 0; k < DEN.length; k++) {
      if (bad(w.cash["n" + DEN[k]], count)) return no("Check the count of €" + DEN[k] + " notes in the till: whole numbers only. Nothing was saved.", "cash:n" + DEN[k]);
      if (bad(w.deposit["n" + DEN[k]], count)) return no("Check the count of €" + DEN[k] + " notes in the bag: whole numbers only. Nothing was saved.", "dep:n" + DEN[k]);
    }
    if (bad(w.cash.coins_total, money)) return no("Check the coins: write the total like 12.40. Nothing was saved.", "cash:coins_total");
    if ((calc(w).bov > 0 || String(w.bag_number || "").trim()) && !String(w.bag_number || "").trim()) return no("Write the bag number: there are notes in the bank bag. Nothing was saved.", "bag_number");
    return "";
  }
  function toBad() { // the box with the problem: marked, tied to the message, and the cursor in it
    var el = S.bad && S.mount && S.mount.querySelector('#eod-form [name="' + S.bad + '"]'); if (!el) return;
    el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "eod-err"); el.focus();
    el.addEventListener("input", function () { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); }, { once: true });
  }
  function payload(w, lock) {
    var amt = function (v) { return (Math.round(mnum(v) * 100) / 100).toFixed(2); };
    var rows = function (list) { return list.map(function (r) { var o = clone(r); o.amount = amt(r.amount); o.remark = String(r.remark || ""); return o; }); };
    var cash = clone(w.cash); DEN.forEach(function (d) { cash["n" + d] = String(inum(w.cash["n" + d])); }); cash.coins_total = amt(w.cash.coins_total);
    var dep = {}; DEN.forEach(function (d) { dep["n" + d] = inum(w.deposit["n" + d]); }); // bag counts as numbers, as the classic screen stores them
    var staff = String(w.staff || "").trim(), bag = String(w.bag_number || "").trim(), u = user();
    // Each value goes under every name the server reads (it prefers staff_name, bov_deposit, bov_bag_number, bov_contact_id).
    var p = { date: S.date, eod_date: S.date, time_of_day: w.time_of_day === "PM" ? "PM" : "AM", staff: staff, staff_name: staff, location_name: String(u.location_name || ""),
      created_by: String((S.base && S.base.created_by) || u.full_name || u.email || ""), float_amount: amt(w.float_amount),
      x: rows(w.x), epos: rows(w.epos), cheques: rows(w.cheques), paid_outs: rows(w.paid_outs), cash: cash,
      deposit: dep, bov_deposit: dep, bag_number: bag, bov_bag_number: bag, contact_id: w.contact_id ? String(w.contact_id) : "", bov_contact_id: w.contact_id ? (isFinite(+w.contact_id) ? +w.contact_id : w.contact_id) : null,
      deposit_edited: !S.autoDep, notes: String((S.base && S.base.notes) || w.notes || ""), saved_at: new Date().toISOString(), action: lock ? "LOCK" : "SAVE" };
    if (lock) p.locked_at = new Date().toISOString(); // never an empty locked_at on a plain save (the server must not read an unlock)
    if (fixing()) p.correction_reason = S.fixReason; // a day unlocked for a correction: the reason goes into the audit of each save
    return p;
  }
  async function save(lock) {
    if (S.saving || !S.w || (S.base && S.base.locked_at)) return;
    keep();
    S.err = check(S.w); if (S.err) { if (S.bad === "staff" || S.bad === "float_amount") S.whoOpen = true; paint(true); return toBad(); }
    var body = payload(S.w, lock), mine = fullSig(body);
    S.saving = true; S.conflict = null; paint(true);
    try {
      // Read the day again first: another till may have saved it since it was opened here.
      var fresh = await getDay(S.date);
      var was = S.base ? String(S.base.updated_at || S.base.saved_at || "") : "", now = fresh ? String(fresh.updated_at || fresh.saved_at || "") : "";
      var ours = fresh && S.lastSent && fullSig(fresh) === S.lastSent; // our own earlier save whose answer was lost
      if (fresh && fresh.locked_at) { S.saving = false; S.base = fresh; S.w = working(fresh); S.dirty = false; S.err = "This day was locked on another till" + (hm(fresh.locked_at) ? " at " + hm(fresh.locked_at) : "") + ". Nothing was saved; the locked figures are shown."; S.autoDep = false; return paint(true); }
      if ((was !== now || (!!S.base !== !!fresh)) && !ours) { S.saving = false; S.conflict = fresh; return paint(true); }
      if (fresh) S.base = fresh;
      S.lastSent = mine;
      var r = await E.apiFetch("/endofday/record", { method: "PUT", body: JSON.stringify({ record: body }) });
      if (!r || r.ok === false) throw new Error((r && r.error) || "Save failed");
      var rec = r.record || r.eod || r.item || null;
      if (lock && rec && !rec.locked_at) { // the server answered for an already locked day without the record
        rec = await getDay(S.date);
      }
      if (rec) { S.base = rec; shadowReplace(rec); if (S.month && S.monthYm === S.date.slice(0, 7)) S.month[S.date] = rec; }
      S.dirty = false; S.err = ""; S.saving = false;
      if (lock && fixing()) { S.fixReason = ""; S.fixDate = ""; } // corrected and locked again
      E.toast(lock ? dayLabel(S.date) + " is locked · " + ouText(calc(S.w)) : "Saved · " + ouText(calc(S.w)), "success");
      if (rec) { S.w = working(rec); S.autoDep = !rec.locked_at && sameDeposit(rec.deposit || rec.bov_deposit, autoDeposit(S.w)); if (S.autoDep) S.w.deposit = autoDeposit(S.w); }
      return paint(true);
    } catch (x) {
      S.saving = false;
      if (x && x.status === 409) { S.err = "This day is locked on the server. Nothing was saved."; return load(); }
      S.err = E.saveFailText(x);
      return paint(true);
    }
  }

  E.registerModule({
    id: "eodreg", title: "End of day", order: 3, icon: "€", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.err = ""; S.ask = null; css();
      var draft = S.dirty && S.w && S.date; // figures typed and not saved stay, as in the classic screen
      if (!draft) { S.date = today(); S.w = null; S.base = null; S.month = null; S.conflict = null; S.whoOpen = false; }
      paint(); return E.takeOpenForm("eodreg", S.mount, load({ keepDraft: !!draft }), { focus: "#eod-form input.amt" });
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("eodreg") < 0) E.UI2_DESTINATIONS.push("eodreg");
  if (E.UI2_PARENT) E.UI2_PARENT.eodreg = "money";
})();
