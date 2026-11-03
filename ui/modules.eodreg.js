/* End of day, new layout: close the till for one day. Who and the float; X readings, EPOS, cheques and paid outs
   (as many lines as the classic screen allows, each with a remark); the cash count by note and the coins; the
   difference worked out as you type with the classic screen's own sums (expected = X − EPOS − cheques − paid outs,
   cash = till − float, the bag rounded to 10s or 5s, over/under, coins kept); the BOV bank bag (number, contact,
   notes, filled from the count until changed by hand); the month so far. Save, and Save and lock.
   The same record and endpoint as the classic screen; every save sends the whole record (the server replaces it).
   Before saving, the day is read again: if another till saved it since it was opened here, nothing is saved and
   the person chooses. A locked day is read-only here. Unlocking, printing, the date-range report, the audit log,
   copying the deposit to an email and managing contacts stay in the classic screen. */
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
    dirty: false, autoDep: true, ask: null, conflict: null, lastSent: "", shadow: "", month: null, monthYm: "", monthErr: "", seq: 0
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
      var r = await E.apiFetch("/endofday/dates?month=" + encodeURIComponent(ym), { method: "GET" });
      var dates = ((r && (r.dates || r.items || r.records)) || []).map(function (x) { return typeof x === "string" ? x : (x && (x.date || x.eod_date)); }).filter(isYmd);
      var recs = {}, i = 0;
      var next = async function () { while (i < dates.length) { var d = dates[i++]; var rec = await getDay(d); if (rec) recs[d] = rec; } };
      await Promise.all([next(), next(), next(), next()]); // a few at a time, like a person scrolling the month
      if (seq !== S.seq) return;
      S.month = recs; S.monthYm = ym;
    } catch (e) { if (seq === S.seq) { S.month = null; S.monthErr = "The month so far could not be read."; } }
    if (seq === S.seq) E.whenFormIdle(S.mount, function () { paint(); });
  }
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
    S.loading = true; S.error = ""; paint();
    try {
      var both = await Promise.all([getDay(S.date), S.contacts.length ? null : loadContacts()]);
      var rec = both[0];
      if (!keepDraft || !S.w) { // a draft kept from a moment ago stays as typed, still measured against what it was based on
        S.base = rec; S.w = working(rec); S.dirty = false; S.conflict = null; S.ask = null;
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
      ".eod-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".eod-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".eod h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.eod-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".eod-day{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)}.eod-day input{font:inherit;font-size:15px;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:10px;height:36px;padding:0 10px}" +
      ".eod-day input:focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:2px}" +
      ".eod-st{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;font-size:13.5px;color:var(--muted)}" +
      ".eod-chip{font-size:12.5px;font-weight:600;padding:3px 10px;border-radius:999px;background:rgba(118,118,128,.12);color:var(--text)}" +
      ".eod-chip.ok{background:var(--ok-soft,rgba(28,138,91,.14));color:var(--ok,#1C8A5B)}.eod-chip.wn{background:var(--warn-soft,rgba(201,138,18,.16));color:var(--warn,#8A5A08)}" +
      ".eod-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 16px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".eod-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.eod-btn:disabled{opacity:.55;cursor:default}" +
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
      ".eod-acts{margin:20px 0 0;padding:12px 0 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--border)}" +
      ".eod-acts .ou{flex:1;min-width:120px;font-size:13px;color:var(--muted)}.eod-acts .ou b{display:block;font-size:16px;color:var(--text);font-variant-numeric:tabular-nums}" +
      ".eod-err{color:var(--danger);font-size:13.5px;margin-top:10px}" +
      ".eod-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".eod-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}" +
      ".eod .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .eod-chip.ok{color:#5FD3A0}html[data-ui2]:not([data-ui2-visit]) .eod-big b.ok{color:#5FD3A0}html[data-ui2]:not([data-ui2-visit]) .eod-big b.dn{color:#FF7A72}" +
      "html[data-ui2]:not([data-ui2-visit]) .eod-chip.wn,html[data-ui2]:not([data-ui2-visit]) .eod-big b.wn,html[data-ui2]:not([data-ui2-visit]) .eod-hint.wn{color:#F2B84B}html[data-ui2]:not([data-ui2-visit]) .eod-err{color:#FF7A72}}" +
      "@media (max-width:600px){.eod{padding:4px 16px 0}.eod h1{font-size:32px}.eod-f>span{flex-basis:88px}.eod-pr .amt{flex-basis:82px}.eod-cr em{min-width:72px}.eod-big b{font-size:24px}}";
    document.head.appendChild(st);
  }

  function ouText(c) { var v = Math.round(c.OU * 100) / 100; return v > 0 ? "Over by " + eur(v) : v < 0 ? "Short by " + eur(-v) : "Exact"; }
  function ouCls(c) { var v = Math.round(c.OU * 100) / 100; return v === 0 ? "ok" : v < 0 ? "dn" : "wn"; }
  function shown(v, int) { var s = String(v == null ? "" : v); return (int ? inum(s) === 0 && /^\s*0*\s*$/.test(s) : /^\s*0*(\.0*)?\s*$/.test(s)) ? "" : s; } // a zero shows as an empty box with 0 behind it

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "eodreg") return; // left before a reply came back: do not draw over the next screen
    if (S.w && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var locked = !!(S.base && S.base.locked_at), ro = locked || S.saving;
    var h = '<div class="eod"><button class="eod-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("eodreg")) + '</button>' +
      '<div class="eod-top"><div><h1>End of day</h1><p class="eod-sub">Close the till: X readings, cash, cheques and the bank bag.</p></div>' +
      '<label class="eod-day"><span>Day</span><input type="date" id="eod-day" max="' + esc(today()) + '" value="' + esc(S.date) + '"></label></div>';
    if (S.loading && !S.w) h += '<div class="eod-quiet">Opening ' + esc(dayLabel(S.date).toLowerCase() === "today" ? "today" : dayLabel(S.date)) + "…</div>";
    else if (S.error && !S.w) h += '<div class="eod-quiet">' + esc(S.error) + ' <button class="eod-btn" data-act="retry" style="margin-left:8px">Try again</button></div>';
    else if (S.w) h += dayHtml(locked, ro);
    h += '<p class="eod-foot">Unlocking a day, printing it on A4, the date-range report, the audit log, copying the deposit to an email and managing bank contacts are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) && ae.name ? '[name="' + ae.name + '"]' : (ae && ae.id === "eod-day" ? "#eod-day" : "");
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) again.focus(); }
    wire(m);
  }

  function dayHtml(locked, ro) {
    var w = S.w, c = calc(w), b = S.base, RO = ro ? " readonly" : "";
    var st = locked ? '<span class="eod-chip ok">Locked</span><span>' + esc(dayLabel(S.date)) + " was closed" + (hm(b.locked_at) ? " at " + esc(hm(b.locked_at)) : "") + ". Read-only here.</span>"
      : b ? '<span class="eod-chip">Saved</span><span>' + (hm(b.updated_at || b.saved_at) ? "Last saved at " + esc(hm(b.updated_at || b.saved_at)) : "Saved") + (b.staff || b.staff_name ? " by " + esc(b.staff || b.staff_name) : "") + ". Not locked yet.</span>"
      : '<span class="eod-chip wn">Not started</span><span>Nothing saved for ' + esc(dayLabel(S.date) === "Today" ? "today" : dayLabel(S.date)) + " yet.</span>";
    if (S.dirty && !locked) st += '<span class="eod-chip wn">Not saved</span>';
    var h = '<div class="eod-st">' + st + "</div>";
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
    h += '<div class="eod-lab"><span>Who and when</span></div><div class="eod-card">' +
      '<label class="eod-f"><span>Staff</span><input name="staff" value="' + esc(w.staff) + '" placeholder="Who is closing"' + RO + "></label>" +
      '<label class="eod-f"><span>Shift</span><select name="time_of_day"' + (ro ? " disabled" : "") + '><option value="AM"' + (w.time_of_day !== "PM" ? " selected" : "") + '>AM</option><option value="PM"' + (w.time_of_day === "PM" ? " selected" : "") + ">PM</option></select></label>" +
      '<label class="eod-f"><span>Float €</span><input name="float_amount" inputmode="decimal" value="' + esc(w.float_amount) + '" placeholder="0.00"' + RO + "></label></div>";
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
      h += '<div class="eod-note" role="alertdialog" aria-label="Lock this day"><b>Lock ' + esc(dayLabel(S.date) === "Today" ? "today" : dayLabel(S.date)) + "?</b> The figures are saved and the day can no longer be changed here. Only the classic screen can unlock it." +
        '<div class="acts"><button class="eod-btn" data-act="ask-no">Cancel</button><button class="eod-btn p" data-act="lock-yes">Save and lock</button></div></div>';
    } else if (S.ask === "leave") {
      h += '<div class="eod-note" role="alertdialog" aria-label="Figures not saved"><b>Your figures for ' + esc(dayLabel(S.date)) + " are not saved.</b> Open " + esc(dayLabel(S.pendingDate || today())) + " anyway?" +
        '<div class="acts"><button class="eod-btn" data-act="ask-no">Stay</button><button class="eod-btn" data-act="leave-yes">Leave without saving</button></div></div>';
    }
    if (S.err) h += '<div class="eod-err" role="alert">' + esc(S.err) + "</div>";
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
  function monthHtml() {
    var mn = MON[+S.date.slice(5, 7) - 1], t = monthDays();
    var h = '<div class="eod-lab"><span>' + esc(mn) + ' so far</span><span data-b="mdays">' + (t ? t.days + (t.days === 1 ? " day saved" : " days saved") : "") + '</span></div><div class="eod-card eod-sum">';
    if (!t) return h + '<div class="r"><span>' + esc(S.monthErr || "Adding up the month…") + "</span></div></div>";
    return h + '<div class="r"><span>Total cash</span><b data-b="mE">' + esc(eur(t.E)) + "</b></div>" +
      '<div class="r"><span>Over / under</span><b data-b="mOU">' + esc(eur(t.OU)) + "</b></div>" +
      '<div class="r"><span>Coin box</span><b data-b="mCOINS">' + esc(eur(t.COINS)) + "</b></div></div>";
  }

  // ---- typing: numbers follow in place, nothing is redrawn under the fingers
  function live() {
    var m = S.mount, w = S.w; if (!m || !w) return;
    var set = function (k, v) { var el = m.querySelector('[data-b="' + k + '"]'); if (el) el.textContent = v; };
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
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "eodreg"); } catch (x) {} E.openClassic("endofday"); }
        else if (act === "addrow") { keep(); var L = b.getAttribute("data-l"); S.w[L].push({ amount: "0", remark: "" }); S.dirty = true; paint(true); var n = S.w[L].length - 1;
          setTimeout(function () { var f = m.querySelector('[name="row:' + L + ":" + n + ':amount"]'); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form") && document.activeElement !== b)) f.focus(); }, 30); }
        else if (act === "rm") { keep(); var L2 = b.getAttribute("data-l"); if (S.w[L2].length > 1) { S.w[L2].splice(+b.getAttribute("data-i"), 1); S.dirty = true; } paint(true); var ad = m.querySelector('[data-act=addrow][data-l="' + L2 + '"]'); if (ad) ad.focus(); }
        else if (act === "refill") { keep(); S.autoDep = true; S.dirty = true; S.w.deposit = autoDeposit(S.w); paint(true); }
        else if (act === "save") save(false);
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
  function check(w) {
    var money = /^\d+([.,]\d{1,2})?$/, count = /^\d+$/;
    var bad = function (v, re) { var s = String(v == null ? "" : v).trim(); return s !== "" && !re.test(s); };
    if (!String(w.staff || "").trim()) return "Write who is closing (Staff). Nothing was saved.";
    if (String(w.float_amount || "").trim() === "" || bad(w.float_amount, money)) return "Write the float, e.g. 1000 or 1000.00. Nothing was saved.";
    for (var i = 0; i < LISTS.length; i++) {
      var L = LISTS[i];
      for (var j = 0; j < w[L.k].length; j++) if (bad(w[L.k][j].amount, money)) return "Check " + L.one + " " + (j + 1) + ": write an amount like 25.50 (no minus, at most two decimals). Nothing was saved.";
    }
    for (var k = 0; k < DEN.length; k++) {
      if (bad(w.cash["n" + DEN[k]], count)) return "Check the count of €" + DEN[k] + " notes in the till: whole numbers only. Nothing was saved.";
      if (bad(w.deposit["n" + DEN[k]], count)) return "Check the count of €" + DEN[k] + " notes in the bag: whole numbers only. Nothing was saved.";
    }
    if (bad(w.cash.coins_total, money)) return "Check the coins: write the total like 12.40. Nothing was saved.";
    if ((calc(w).bov > 0 || String(w.bag_number || "").trim()) && !String(w.bag_number || "").trim()) return "Write the bag number: there are notes in the bank bag. Nothing was saved.";
    return "";
  }
  function payload(w, lock) {
    var amt = function (v) { return (Math.round(mnum(v) * 100) / 100).toFixed(2); };
    var rows = function (list) { return list.map(function (r) { var o = clone(r); o.amount = amt(r.amount); o.remark = String(r.remark || ""); return o; }); };
    var cash = clone(w.cash); DEN.forEach(function (d) { cash["n" + d] = String(inum(w.cash["n" + d])); }); cash.coins_total = amt(w.cash.coins_total);
    var dep = {}; DEN.forEach(function (d) { dep["n" + d] = String(inum(w.deposit["n" + d])); });
    var staff = String(w.staff || "").trim(), bag = String(w.bag_number || "").trim(), u = user();
    // Each value goes under every name the server reads (it prefers staff_name, bov_deposit, bov_bag_number, bov_contact_id).
    var p = { date: S.date, eod_date: S.date, time_of_day: w.time_of_day === "PM" ? "PM" : "AM", staff: staff, staff_name: staff, location_name: String(u.location_name || ""),
      created_by: String((S.base && S.base.created_by) || u.full_name || u.email || ""), float_amount: amt(w.float_amount),
      x: rows(w.x), epos: rows(w.epos), cheques: rows(w.cheques), paid_outs: rows(w.paid_outs), cash: cash,
      deposit: dep, bov_deposit: dep, bag_number: bag, bov_bag_number: bag, contact_id: w.contact_id ? String(w.contact_id) : "", bov_contact_id: w.contact_id ? (isFinite(+w.contact_id) ? +w.contact_id : w.contact_id) : null,
      deposit_edited: !S.autoDep, notes: String((S.base && S.base.notes) || w.notes || ""), saved_at: new Date().toISOString(), action: lock ? "LOCK" : "SAVE" };
    if (lock) p.locked_at = new Date().toISOString(); // never an empty locked_at on a plain save (the server must not read an unlock)
    return p;
  }
  async function save(lock) {
    if (S.saving || !S.w || (S.base && S.base.locked_at)) return;
    keep();
    S.err = check(S.w); if (S.err) return paint(true);
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
      if (!draft) { S.date = today(); S.w = null; S.base = null; S.month = null; S.conflict = null; }
      paint(); return load({ keepDraft: !!draft });
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("eodreg") < 0) E.UI2_DESTINATIONS.push("eodreg");
  if (E.UI2_PARENT) E.UI2_PARENT.eodreg = "money";
})();
