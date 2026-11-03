/* Download our records, new layout (Settings › This pharmacy). A pharmacy takes its own registers out of Eikon: pick the
   days and the registers, get one spreadsheet (a sheet per register plus a Summary) or, without the spreadsheet library,
   one CSV per register in a zip; or print an inspection pack, one register per page with the pharmacy and the days on
   each page. Read only: the same GET calls the rebuilt screens make, one register at a time, a month per call, at most
   two calls in flight. Nothing is uploaded anywhere: the file is made in this browser and saved by it. Admin only. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var TZ = "Europe/Malta";
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var S = { mount: null, range: "this", year: "", from: "", to: "", picked: null, job: null, done: null, error: "" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function user() { return (E.state && E.state.user) || {}; }
  function isAdmin() { var u = user(); return !u.role || u.role === "admin"; } // unknown: the server decides, as it does for each call

  // ── Malta days
  var fmt = null;
  function parts(ms) {
    if (!fmt) fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    var o = {}; fmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
  }
  function today() { var p = parts(Date.now()); return p.y + "-" + pad(p.mo) + "-" + pad(p.d); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function lastDay(ym) { var a = ym.split("-"); return ym + "-" + pad(new Date(Date.UTC(+a[0], +a[1], 0)).getUTCDate()); }
  function shiftYm(ym, n) { var a = ym.split("-"), d = new Date(Date.UTC(+a[0], +a[1] - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); }
  function monthsIn(from, to) { var out = [], m = from.slice(0, 7), end = to.slice(0, 7); while (m <= end && out.length < 600) { out.push(m); m = shiftYm(m, 1); } return out; }
  function monthName(ym) { var a = ym.split("-"); return MON[+a[1] - 1] + " " + a[0]; }

  // ── Plain values: dd/mm/yyyy, 2-decimal money, Yes/No
  function dmy(v) { var s = String(v == null ? "" : v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "/" + m[2] + "/" + m[1] : s; }
  function stamp(v) { // the server's UTC "YYYY-MM-DD HH:MM:SS" (or ISO) as Malta dd/mm/yyyy HH:MM; a bare date stays a date
    var s = String(v == null ? "" : v).trim(); if (!/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return dmy(s);
    var ms = Date.parse(s.replace(" ", "T") + (/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
    if (isNaN(ms)) return dmy(s);
    var p = parts(ms); return pad(p.d) + "/" + pad(p.mo) + "/" + p.y + " " + pad(p.h) + ":" + pad(p.mi);
  }
  function num(v) { var s = String(v == null ? "" : v).trim(); if (!s) return null; if (s.indexOf(",") >= 0 && s.indexOf(".") < 0) s = s.replace(/,/g, "."); var n = Number(s); return isFinite(n) ? n : null; }
  function money(v) { var n = num(v); return n == null ? null : Math.round(n * 100) / 100; }
  function yn(v) { return v === true || v === 1 || v === "1" || v === "true" ? "Yes" : "No"; }
  function prio(v, words) { return words[String(Number(v) || 2)] || ""; }
  function sum(list) { return (list || []).reduce(function (a, r) { return a + (num(r && r.amount) || 0); }, 0); }

  // End of day, the classic screen's sums (no rounding preference: the export shows the counts as kept)
  function eodCalc(r) {
    var c = r.cash || {}, d = r.deposit || r.bov_deposit || {}, i = function (v) { var n = parseInt(String(v == null ? "" : v), 10); return isFinite(n) ? n : 0; };
    var notes = function (o) { return 500 * i(o.n500) + 200 * i(o.n200) + 100 * i(o.n100) + 50 * i(o.n50) + 20 * i(o.n20) + 10 * i(o.n10) + 5 * i(o.n5); };
    var A = sum(r.x), B = sum(r.epos), C = sum(r.cheques), D = sum(r.paid_outs), till = notes(c) + (num(c.coins_total) || 0), exp = A - B - C - D;
    var net = till - (num(r.float_amount) || 0); if (net < 0) net = 0;
    return { A: A, B: B, C: C, D: D, exp: exp, till: till, net: net, ou: net - exp, bov: notes(d) };
  }

  // ── The registers. cols: [heading, value, kind] kind m = money, n = number, t = text. "Record no." comes first in every sheet.
  // print: the columns the register's own screen prints (tempreg, cleanreg, drreg, locreg); otherwise every column.
  var REGS = [
    { id: "temperature", title: "Temperature", group: "Legal registers", mode: "month", path: "/temperature/entries", key: "entries", date: "entry_date", devices: true,
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Fridge or room", function (e) { return e.device_name; }], ["Kind", function (e) { return e.device_type === "fridge" ? "Fridge" : e.device_type === "room" ? "Room" : e.device_type; }],
        ["Lowest °C", function (e) { return num(e.min_temp); }, "n"], ["Highest °C", function (e) { return num(e.max_temp); }, "n"], ["Lower limit °C", function (e) { return num(e.min_limit); }, "n"], ["Upper limit °C", function (e) { return num(e.max_limit); }, "n"],
        ["Outside limits", function (e) { return outside(e) ? "Yes" : "No"; }], ["Note", function (e) { return e.notes; }], ["Recorded at", function (e) { return stamp(e.created_at); }]] },
    { id: "cleaning", title: "Cleaning", group: "Legal registers", mode: "month", path: "/cleaning/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Time in", function (e) { return e.time_in; }], ["Time out", function (e) { return e.time_out; }], ["Cleaner", function (e) { return e.cleaner_name; }], ["Checked by", function (e) { return e.staff_name; }], ["Notes", function (e) { return e.notes; }], ["Recorded at", function (e) { return stamp(e.created_at); }]],
      print: ["Date", "Time in", "Time out", "Cleaner", "Checked by", "Notes"] },
    { id: "dailyregister", title: "Daily register", group: "Legal registers", mode: "month", path: "/daily-register/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Client", function (e) { return e.client_name; }], ["ID card", function (e) { return e.client_id; }], ["Medicine and dose", function (e) { return e.medicine_name_dose; }], ["Posology", function (e) { return e.posology; }], ["Prescriber", function (e) { return e.prescriber_name; }], ["Reg no", function (e) { return e.prescriber_reg_no; }], ["Recorded at", function (e) { return stamp(e.created_at); }]],
      print: ["Date", "Client", "ID card", "Medicine and dose", "Posology", "Prescriber", "Reg no"] },
    { id: "locumregister", title: "Locum register", group: "Legal registers", mode: "month", path: "/locumregister/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Time in", function (e) { return e.time_in; }], ["Time out", function (e) { return e.time_out; }], ["Pharmacist", function (e) { return e.locum_full_name; }], ["Reg no", function (e) { return e.registration_number; }], ["Recorded at", function (e) { return stamp(e.created_at); }]],
      print: ["Date", "Time in", "Time out", "Pharmacist", "Reg no"] },
    { id: "ddapurchases", title: "DDA purchases", group: "Legal registers", mode: "month", path: "/dda-purchases/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Controlled drug and dose", function (e) { return e.dda_name_dose; }], ["Quantity", function (e) { return num(e.quantity); }, "n"], ["Supplier", function (e) { return e.agent; }], ["Invoice no", function (e) { return e.invoice_number; }], ["Recorded at", function (e) { return stamp(e.created_at); }]] },
    { id: "ddasales", title: "DDA sales", group: "Legal registers", mode: "month", path: "/dda-sales/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Client", function (e) { return e.client_name; }], ["ID card", function (e) { return e.client_id_card; }], ["Address", function (e) { return e.client_address; }], ["Medicine and dose", function (e) { return e.medicine_name_dose; }], ["Quantity", function (e) { return num(e.quantity); }, "n"], ["Doctor", function (e) { return e.doctor_name; }], ["Doctor reg no", function (e) { return e.doctor_reg_no; }], ["Prescription serial no", function (e) { return e.prescription_serial_no; }], ["Urgent", function (e) { return yn(e.urgent); }], ["Recorded at", function (e) { return stamp(e.created_at); }]] },
    { id: "ddapoyc", title: "DDA POYC", group: "Legal registers", mode: "month", path: "/dda-poyc/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Client", function (e) { return e.client_name; }], ["ID card", function (e) { return e.client_id_card; }], ["Address", function (e) { return e.client_address; }], ["Medicine and dose", function (e) { return e.medicine_name_dose; }], ["Quantity", function (e) { return num(e.quantity); }, "n"], ["Doctor", function (e) { return e.doctor_name; }], ["Doctor reg no", function (e) { return e.doctor_reg_no; }], ["Prescription serial no", function (e) { return e.prescription_serial_no; }], ["Recorded at", function (e) { return stamp(e.created_at); }]] },
    { id: "repeatprescriptions", title: "Repeat prescriptions", group: "Legal registers", mode: "month", path: "/repeat-prescriptions/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Runs out", function (e) { return dmy(e.expires_date); }], ["Client", function (e) { return e.client_name; }], ["ID card", function (e) { return e.client_id; }], ["Medicine and dose", function (e) { return e.medicine_name_dose; }], ["Posology", function (e) { return e.posology; }], ["Prescriber", function (e) { return e.prescriber_name; }], ["Reg no", function (e) { return e.prescriber_reg_no; }], ["Recorded at", function (e) { return stamp(e.created_at); }]] },
    { id: "paidout", title: "Paid out", group: "Money", mode: "month", path: "/paid-out/entries", key: "entries", date: "entry_date",
      cols: [["Date", function (e) { return dmy(e.entry_date); }], ["Time", function (e) { return e.entry_time; }], ["Paid to", function (e) { return e.payee_name; }], ["Amount €", function (e) { return money(e.fee); }, "m"], ["Paid by", function (e) { return e.payment_method === "cheque" ? "Cheque" : "Cash"; }], ["Cheque no", function (e) { return e.cheque_no; }], ["Invoice no", function (e) { return e.invoice_no; }], ["Reason", function (e) { return e.reason; }], ["Recorded at", function (e) { return stamp(e.created_at); }]] },
    { id: "endofday", title: "End of day", group: "Money", mode: "eod", date: "eod_date",
      cols: [["Date", function (e) { return dmy(e.eod_date || e.date); }], ["Shift", function (e) { return e.time_of_day; }], ["Closed by", function (e) { return e.staff || e.staff_name; }], ["Float €", function (e) { return money(e.float_amount); }, "m"],
        ["X readings €", function (e) { return money(eodCalc(e).A); }, "m"], ["EPOS €", function (e) { return money(eodCalc(e).B); }, "m"], ["Cheques €", function (e) { return money(eodCalc(e).C); }, "m"], ["Paid outs €", function (e) { return money(eodCalc(e).D); }, "m"],
        ["Cash expected €", function (e) { return money(eodCalc(e).exp); }, "m"], ["Cash in till €", function (e) { return money(eodCalc(e).till); }, "m"], ["Cash less float €", function (e) { return money(eodCalc(e).net); }, "m"], ["Over or under €", function (e) { return money(eodCalc(e).ou); }, "m"],
        ["Bank deposit €", function (e) { return money(eodCalc(e).bov); }, "m"], ["Bag no", function (e) { return e.bag_number || e.bov_bag_number; }], ["Notes", function (e) { return e.notes; }], ["Locked", function (e) { return e.locked_at ? "Yes" : "No"; }], ["Saved at", function (e) { return stamp(e.saved_at || e.updated_at); }]] },
    { id: "locumreceipts", title: "Locum receipts", group: "Money", mode: "month", path: "/locumreceipts/receipts", key: "receipts", date: "receipt_date",
      cols: [["Date", function (e) { return dmy(e.receipt_date); }], ["Locum", function (e) { return e.locum_full_name; }], ["Reg no", function (e) { return e.registration_number; }], ["Day", function (e) { return String(e.day_type || "").toLowerCase() === "holiday" ? "Sunday or holiday" : "Normal"; }], ["Hours", function (e) { return num(e.hours); }, "n"], ["Rate per hour €", function (e) { return money(e.fee_per_hour); }, "m"], ["Total €", function (e) { return money(e.total_fee); }, "m"], ["Recorded at", function (e) { return stamp(e.created_at); }]] },
    { id: "creditnotes", title: "Credit notes", group: "Money", mode: "once", path: "/creditnotes/list", key: "entries", date: "issue_date", cap: 1000,
      cols: [["Issued", function (e) { return dmy(e.issue_date); }], ["Name", function (e) { return e.client_name; }], ["Surname", function (e) { return e.client_surname; }], ["Phone", function (e) { return e.telephone; }], ["Email", function (e) { return e.email; }], ["Receipt no", function (e) { return e.receipt_number; }], ["Amount €", function (e) { return money(e.amount); }, "m"],
        ["Used €", function (e) { return money(sum(e.purchase_entries)); }, "m"], ["Left €", function (e) { return money((num(e.amount) || 0) - sum(e.purchase_entries)); }, "m"], ["Expires", function (e) { return e.no_expiry ? "No expiry" : dmy(e.expiry_date); }]] },
    { id: "clientorders", title: "Orders", group: "Customers", mode: "month", path: "/client-orders/entries", key: "entries", date: "order_date",
      cols: [["Ordered", function (e) { return dmy(e.order_date); }], ["Customer", function (e) { return e.client_name; }], ["Phone", function (e) { return e.client_phone; }], ["Other phone", function (e) { return e.client_alt_phone; }], ["Email", function (e) { return e.client_email; }], ["Address", function (e) { return e.client_address; }], ["Items", function (e) { return e.items_text; }],
        ["Priority", function (e) { return prio(e.priority, { 1: "Urgent", 2: "Normal", 3: "Low" }); }], ["Needed by", function (e) { return dmy(e.needed_by); }], ["Pick-up date", function (e) { return dmy(e.pickup_date); }], ["Deposit €", function (e) { return money(e.deposit_amount); }, "m"], ["Ready", function (e) { return yn(e.fulfilled); }], ["Ready at", function (e) { return stamp(e.fulfilled_at); }], ["Order code", function (e) { return e.order_code; }], ["Follow-up", function (e) { return e.follow_up_status; }], ["Notes", function (e) { return e.notes; }]] },
    { id: "tickets", title: "Questions", group: "Customers", mode: "once", path: "/client-tickets/entries", key: "entries", date: "open_date",
      cols: [["Opened", function (e) { return dmy(e.open_date); }], ["Ticket", function (e) { return e.ticket_id; }], ["Customer", function (e) { return e.client_name; }], ["Phone", function (e) { return e.phone; }], ["Email", function (e) { return e.email; }], ["Category", function (e) { return e.category; }], ["Priority", function (e) { return prio(e.priority, { 1: "High", 2: "Medium", 3: "Low" }); }],
        ["Status", function (e) { return e.status; }], ["Question", function (e) { return e.issue; }], ["Assigned to", function (e) { return e.assigned_to; }], ["Follow up on", function (e) { return dmy(e.followup_date); }], ["Answered", function (e) { return yn(e.resolved); }], ["Answered at", function (e) { return stamp(e.resolved_at); }]] },
    { id: "deliveries", title: "Deliveries", group: "Customers", mode: "once", path: "/client-deliveries/entries", key: "entries", date: "order_date", cap: 2000,
      cols: [["Ordered", function (e) { return dmy(e.order_date); }], ["Delivery", function (e) { return e.delivery_id; }], ["Customer", function (e) { return e.client_name; }], ["Phone", function (e) { return e.phone; }], ["Address", function (e) { return e.delivery_address; }], ["Due", function (e) { return dmy(e.scheduled_date); }], ["Time of day", function (e) { return e.scheduled_time_slot; }],
        ["Status", function (e) { return e.status; }], ["Delivered on", function (e) { return dmy(e.actual_delivery_date); }], ["Delivered at", function (e) { return e.actual_delivery_time; }], ["Driver", function (e) { return e.assigned_driver; }], ["Received by", function (e) { return e.recipient_name; }],
        ["Controlled drugs", function (e) { return yn(e.contains_controlled); }], ["Cold chain", function (e) { return yn(e.cold_chain_required); }], ["Attempts", function (e) { return num(e.delivery_attempts); }, "n"], ["Why not delivered", function (e) { return e.failure_reason; }]] }
  ];
  var BY = {}; REGS.forEach(function (r) { BY[r.id] = r; });
  function outside(e) { var lo = num(e.min_limit), hi = num(e.max_limit), a = num(e.min_temp), b = num(e.max_temp); return (lo != null && a != null && a < lo) || (hi != null && b != null && b > hi); }

  // ── The days chosen
  function rangeOf() {
    var t = today(), ym = t.slice(0, 7);
    if (S.range === "this") return { from: ym + "-01", to: t, label: monthName(ym) };
    if (S.range === "last") { var p = shiftYm(ym, -1); return { from: p + "-01", to: lastDay(p), label: monthName(p) }; }
    if (S.range === "year") { var y = S.year || t.slice(0, 4), end = y + "-12-31"; return { from: y + "-01-01", to: end > t ? t : end, label: "Year " + y }; }
    if (!isYmd(S.from) || !isYmd(S.to) || S.to < S.from) return null;
    return { from: S.from, to: S.to, label: dmy(S.from) + " to " + dmy(S.to) };
  }
  function rangeText(r) { return r.label + (S.range === "custom" ? "" : " (" + dmy(r.from) + " to " + dmy(r.to) + ")"); }
  function inRange(v, r) { var d = String(v || "").slice(0, 10); return isYmd(d) && d >= r.from && d <= r.to; }

  // ── Reading. One register at a time; inside it, at most two calls in flight. Cancel stops at the next call.
  function cancelled(job) { return !job || job.cancel || S.job !== job; }
  async function get(job, path) {
    if (cancelled(job)) throw { cancelled: true };
    job.calls++; job.paths.push(path); paint();
    var r = await E.apiFetch(path, { method: "GET" });
    if (cancelled(job)) throw { cancelled: true };
    if (!r || r.ok === false) throw new Error((r && r.error) || "No answer");
    return r;
  }
  async function pool(list, n, fn) {
    var i = 0, out = new Array(list.length);
    var w = async function () { while (i < list.length) { var k = i++; out[k] = await fn(list[k], k); } };
    var ws = []; for (var j = 0; j < Math.min(n, list.length); j++) ws.push(w());
    await Promise.all(ws); return out;
  }
  async function readReg(job, reg, rg) {
    var rows = [], extra = {};
    if (reg.mode === "month") {
      var months = monthsIn(rg.from, rg.to);
      if (reg.devices) { var dv = await get(job, "/temperature/devices"); extra.devices = dv.devices || []; }
      var got = await pool(months, 2, async function (ym) { job.now = reg.title + ": " + monthName(ym); var r = await get(job, reg.path + "?month=" + encodeURIComponent(ym)); return r[reg.key] || []; });
      got.forEach(function (l) { rows = rows.concat(l); });
    } else if (reg.mode === "once") {
      job.now = reg.title; var r1 = await get(job, reg.path); rows = r1[reg.key] || [];
      if (reg.cap && rows.length >= reg.cap) extra.capped = reg.cap;
    } else if (reg.mode === "eod") {
      var dates = [];
      var ds = await pool(monthsIn(rg.from, rg.to), 2, async function (ym) { job.now = reg.title + ": " + monthName(ym); var r = await get(job, "/endofday/dates?month=" + encodeURIComponent(ym)); return (r.dates || r.items || r.records || []).map(function (x) { return typeof x === "string" ? x : x && (x.date || x.eod_date); }); });
      ds.forEach(function (l) { dates = dates.concat(l.filter(function (d) { return inRange(d, rg); })); });
      var recs = await pool(dates, 2, async function (d) { job.now = reg.title + ": " + dmy(d); var r = await get(job, "/endofday/record?date=" + encodeURIComponent(d)); return r.record || r.eod || r.item || null; });
      rows = recs.filter(function (x) { return x && (x.eod_date || x.date); });
    }
    var seen = {};
    rows = rows.filter(function (e) { var k = e && e.id != null ? String(e.id) : ""; if (k && seen[k]) return false; if (k) seen[k] = 1; return inRange(e[reg.date] || e.date, rg); });
    rows.sort(function (a, b) { var x = String(a[reg.date] || a.date || ""), y = String(b[reg.date] || b.date || ""); return x < y ? -1 : x > y ? 1 : (Number(a.id) || 0) - (Number(b.id) || 0); });
    return { rows: rows, extra: extra };
  }

  async function run(kind) {
    var rg = rangeOf(); if (!rg) { S.error = "Choose a first and a last day, the last one not before the first."; return paint(); }
    var ids = picked(); if (!ids.length) { S.error = "Tick at least one register."; return paint(); }
    var job = { kind: kind, cancel: false, calls: 0, paths: [], now: "", i: 0, n: ids.length, range: rg, results: [] };
    S.job = job; S.done = null; S.error = ""; paint();
    for (var k = 0; k < ids.length; k++) {
      var reg = BY[ids[k]]; job.i = k + 1; job.now = reg.title; paint();
      try { var got = await readReg(job, reg, rg); job.results.push({ reg: reg, rows: got.rows, extra: got.extra }); }
      catch (e) {
        if (e && e.cancelled) break;
        job.results.push({ reg: reg, rows: [], error: e && e.status === 403 ? "Not allowed for this account" : e && e.network ? "No connection" : String((e && (e.message || e)) || "Could not read") });
      }
    }
    if (cancelled(job)) { if (S.job === job) { S.job = null; S.done = { cancelled: true }; paint(); } return; }
    var out = { kind: kind, range: rg, calls: job.calls, paths: job.paths, results: job.results, at: new Date() };
    try {
      if (kind === "print") printPack(out); else out.file = save(out);
    } catch (e2) { out.error = String((e2 && e2.message) || e2); }
    S.job = null; S.done = out; E.expLast = out; paint();
  }

  // ── Tables
  function table(res) {
    var head = ["Record no."].concat(res.reg.cols.map(function (c) { return c[0]; }));
    var kinds = ["n"].concat(res.reg.cols.map(function (c) { return c[2] || "t"; }));
    var body = res.rows.map(function (e) { return [e.id == null ? "" : e.id].concat(res.reg.cols.map(function (c) { var v = c[1](e); return v == null ? "" : v; })); });
    return { head: head, kinds: kinds, body: body };
  }
  function summaryRows(out) {
    var u = user(), at = out.at, p = parts(at.getTime());
    var rows = [["Pharmacy", u.location_name || ""], ["Days", rangeText(out.range)], ["Exported at", pad(p.d) + "/" + pad(p.mo) + "/" + p.y + " " + pad(p.h) + ":" + pad(p.mi) + " (Malta time)"], ["Exported by", u.full_name || u.email || ""], ["", ""], ["Register", "Rows"]];
    out.results.forEach(function (r) { rows.push([r.reg.title, r.error ? "Not exported: " + r.error : r.rows.length + (r.extra && r.extra.capped ? " (the server sends at most " + r.extra.capped + "; older ones may be missing)" : "")]); });
    rows.push(["", ""], ["Keep this file safe", "It holds patients' names and ID cards."]);
    return rows;
  }
  function fileBase(out) { var u = user(), n = String(u.location_name || "pharmacy").replace(/[^A-Za-z0-9]+/g, " ").trim().replace(/ /g, "-") || "pharmacy"; return "Eikon-records-" + n + "-" + out.range.from + "-to-" + out.range.to; }
  function sheetName(t, used) { var s = String(t).replace(/[\[\]\*\?\/\\:]/g, " ").slice(0, 31), n = s, i = 2; while (used[n.toLowerCase()]) n = s.slice(0, 28) + " " + i++; used[n.toLowerCase()] = 1; return n; }

  function save(out) {
    var X = window.XLSX, base = fileBase(out), blob, name;
    if (X && X.utils && X.utils.aoa_to_sheet && X.utils.book_new && X.write) {
      var wb = X.utils.book_new(), used = {};
      var sm = X.utils.aoa_to_sheet(summaryRows(out)); sm["!cols"] = [{ wch: 24 }, { wch: 60 }];
      X.utils.book_append_sheet(wb, sm, sheetName("Summary", used));
      out.results.forEach(function (r) {
        var t = table(r), ws = X.utils.aoa_to_sheet([t.head].concat(t.body));
        t.body.forEach(function (row, ri) { t.kinds.forEach(function (k, ci) { if (k !== "m") return; var a = X.utils.encode_cell({ r: ri + 1, c: ci }); if (ws[a] && ws[a].t === "n") ws[a].z = "0.00"; }); });
        ws["!cols"] = t.head.map(function (h, ci) { var w = String(h).length; t.body.slice(0, 200).forEach(function (row) { w = Math.max(w, Math.min(50, String(row[ci]).length)); }); return { wch: w + 2 }; });
        X.utils.book_append_sheet(wb, ws, sheetName(r.reg.title, used));
      });
      var buf = X.write(wb, { bookType: "xlsx", type: "array", compression: true });
      blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); name = base + ".xlsx"; out.format = "xlsx";
    } else {
      var files = [{ name: "Summary.csv", data: csv(summaryRows(out)) }], usedN = {};
      out.results.forEach(function (r) { var t = table(r), fn = sheetName(r.reg.title, usedN).replace(/ /g, "-") + ".csv"; files.push({ name: fn, data: csv([t.head].concat(t.body.map(function (row) { return row.map(function (v, ci) { return t.kinds[ci] === "m" && typeof v === "number" ? v.toFixed(2) : v; }); }))) }); });
      blob = new Blob([zip(files)], { type: "application/zip" }); name = base + ".zip"; out.format = "zip";
    }
    download(blob, name);
    return { name: name, blob: blob, size: blob.size };
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a);
    try { a.click(); } catch (e) {}
    a.remove(); setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }

  // CSV: UTF-8 with a BOM (Excel reads the accents), CRLF lines, quotes only when needed.
  function csv(rows) {
    var cell = function (v) {
      var s = v == null ? "" : String(v);
      if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s; // a spreadsheet would read it as a formula
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return "\ufeff" + rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n") + "\r\n";
  }
  // A store-only zip (no compression): enough for a few CSV files, and no library to load.
  var CRC = null;
  function crc32(b) { if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } } var x = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) x = CRC[(x ^ b[i]) & 0xFF] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0, now = new Date();
    var dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    function hdr(len) { var b = new Uint8Array(len); return { b: b, v: new DataView(b.buffer) }; }
    files.forEach(function (f) {
      var nm = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var L = hdr(30); L.v.setUint32(0, 0x04034b50, true); L.v.setUint16(4, 20, true); L.v.setUint16(6, 0x0800, true); L.v.setUint16(8, 0, true); L.v.setUint16(10, dosT, true); L.v.setUint16(12, dosD, true);
      L.v.setUint32(14, crc, true); L.v.setUint32(18, data.length, true); L.v.setUint32(22, data.length, true); L.v.setUint16(26, nm.length, true); L.v.setUint16(28, 0, true);
      var C = hdr(46); C.v.setUint32(0, 0x02014b50, true); C.v.setUint16(4, 20, true); C.v.setUint16(6, 20, true); C.v.setUint16(8, 0x0800, true); C.v.setUint16(10, 0, true); C.v.setUint16(12, dosT, true); C.v.setUint16(14, dosD, true);
      C.v.setUint32(16, crc, true); C.v.setUint32(20, data.length, true); C.v.setUint32(24, data.length, true); C.v.setUint16(28, nm.length, true); C.v.setUint32(42, off, true);
      parts.push(L.b, nm, data); central.push(C.b, nm); off += 30 + nm.length + data.length;
    });
    var csize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var Z = hdr(22); Z.v.setUint32(0, 0x06054b50, true); Z.v.setUint16(8, files.length, true); Z.v.setUint16(10, files.length, true); Z.v.setUint32(12, csize, true); Z.v.setUint32(16, off, true);
    return new Blob(parts.concat(central, [Z.b]));
  }

  // ── Inspection pack: one register per page, the pharmacy and the days at the top of each page.
  function printPack(out) {
    var u = user(), loc = u.location_name || "", rt = rangeText(out.range), p = parts(out.at.getTime()), printed = pad(p.d) + "/" + pad(p.mo) + "/" + p.y;
    var cell = function (v, k) { return k === "m" && typeof v === "number" ? v.toFixed(2) : v; };
    var secs = out.results.map(function (r) {
      var h = '<section class="pg"><header><b>' + esc(loc) + "</b><span>" + esc(r.reg.title) + "</span><span>" + esc(rt) + "</span></header>";
      if (r.error) return h + "<p>Not printed: " + esc(r.error) + "</p></section>";
      if (r.reg.id === "temperature") return h + tempTables(r, out.range) + "</section>";
      var t = table(r), keep = r.reg.print ? r.reg.print.map(function (c) { return t.head.indexOf(c); }) : t.head.map(function (_, i) { return i; }).filter(function (i) { return t.head[i] !== "Record no." && t.head[i] !== "Recorded at"; });
      h += "<p class='n'>" + r.rows.length + " " + (r.rows.length === 1 ? "line" : "lines") + "</p><table><thead><tr>" + keep.map(function (i) { return "<th>" + esc(t.head[i]) + "</th>"; }).join("") + "</tr></thead><tbody>";
      h += t.body.length ? t.body.map(function (row) { return "<tr>" + keep.map(function (i) { return "<td>" + esc(cell(row[i], t.kinds[i])) + "</td>"; }).join("") + "</tr>"; }).join("") : '<tr><td colspan="' + keep.length + '">Nothing recorded in these days.</td></tr>';
      return h + "</tbody></table></section>";
    }).join("");
    var html = "<!doctype html><html lang='en'><head><meta charset='utf-8'><title>Inspection pack</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#000;background:#fff}" +
      ".pg{page-break-after:always;break-after:page}.pg:last-child{page-break-after:auto;break-after:auto}header{display:flex;justify-content:space-between;gap:12px;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:10px;font-size:13px}header b{font-size:15px}header span:nth-child(2){font-size:18px;font-weight:800}" +
      "h3{font-size:14px;margin:14px 0 6px}.n{font-size:12px;color:#333;margin:0 0 8px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:4px 6px;font-size:10.5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}td.bad{font-weight:700}" +
      "footer{font-size:10px;color:#333;margin-top:8px}@page{size:A4 landscape;margin:10mm}@media print{body{margin:0}tr{page-break-inside:avoid}}</style></head><body>" + secs +
      "<footer>Printed " + esc(printed) + " from Eikon. It holds patients' names and ID cards: keep it safe.</footer><script>window.addEventListener('load',function(){setTimeout(function(){try{window.print();}catch(e){}},120);});<\/script></body></html>";
    out.html = html;
    var url = URL.createObjectURL(new Blob([html], { type: "text/html" })), w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }
    if (!w) { try { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); } catch (e2) {} }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
  }
  // Temperature prints as its screen does: a table per fridge or room, a line per day, "Not logged" for a day with no reading.
  function tempTables(r, rg) {
    var devs = ((r.extra && r.extra.devices) || []).slice(), byId = {}, t = today();
    devs.forEach(function (d) { byId[d.id] = d; });
    r.rows.forEach(function (e) { if (!byId[e.device_id]) { byId[e.device_id] = { id: e.device_id, name: e.device_name, device_type: e.device_type, min_limit: e.min_limit, max_limit: e.max_limit, active: 1 }; devs.push(byId[e.device_id]); } });
    devs = devs.filter(function (d) { return Number(d.active) !== 0 || r.rows.some(function (e) { return e.device_id === d.id; }); });
    if (!devs.length) return "<p>No fridge or room set up.</p>";
    var end = rg.to < t ? rg.to : t, days = [], d0 = new Date(rg.from + "T12:00:00Z");
    while (days.length < 3700) { var k = d0.toISOString().slice(0, 10); if (k > end) break; days.push(k); d0.setUTCDate(d0.getUTCDate() + 1); }
    return devs.map(function (dv) {
      var at = {}; r.rows.forEach(function (e) { if (e.device_id === dv.id) at[e.entry_date] = e; });
      var lim = (dv.min_limit != null ? dv.min_limit : "–") + " to " + (dv.max_limit != null ? dv.max_limit : "–") + " °C";
      return "<h3>" + esc(dv.name) + " · " + esc(dv.device_type === "fridge" ? "Fridge" : dv.device_type === "room" ? "Room" : dv.device_type || "") + " · limits " + esc(lim) + "</h3><table><thead><tr><th>Date</th><th>Min °C</th><th>Max °C</th><th>Note</th></tr></thead><tbody>" +
        days.map(function (k) { var e = at[k]; if (!e) return "<tr><td>" + dmy(k) + "</td><td>–</td><td>–</td><td>Not logged</td></tr>"; var o = outside(Object.assign({}, dv, e)), b = o ? ' class="bad"' : "";
          return "<tr><td>" + dmy(k) + "</td><td" + b + ">" + esc(e.min_temp) + "</td><td" + b + ">" + esc(e.max_temp) + "</td><td>" + (o ? "Outside limits" : "") + (e.notes ? " " + esc(e.notes) : "") + "</td></tr>"; }).join("") + "</tbody></table>";
    }).join("");
  }

  // ── Screen
  function picked() { if (!S.picked) { S.picked = {}; REGS.forEach(function (r) { S.picked[r.id] = 1; }); } return REGS.filter(function (r) { return S.picked[r.id]; }).map(function (r) { return r.id; }); }
  function estimate(rg) { // calls a run will make (End of day adds one per day it finds)
    var m = monthsIn(rg.from, rg.to).length; return picked().reduce(function (a, id) { var r = BY[id]; return a + (r.mode === "once" ? 1 : m + (r.devices ? 1 : 0)); }, 0);
  }
  function css() {
    if (document.getElementById("eikon-expreg-css")) return;
    var st = document.createElement("style"); st.id = "eikon-expreg-css";
    st.textContent =
      ".exp{max-width:880px;margin:0 auto}.exp-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".exp h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.exp-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;line-height:1.5}" +
      ".exp-safe{margin:14px 0 0;padding:10px 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);font-size:14px;font-weight:600}" +
      ".exp-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 8px}" +
      ".exp-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px}" +
      ".exp-chips{display:flex;gap:6px;flex-wrap:wrap}.exp-chips button{font:inherit;font-size:14px;font-weight:600;min-height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".exp-chips button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".exp-f{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.exp-f label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted);min-width:150px}" +
      ".exp-f input,.exp-f select{height:38px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 10px}" +
      ".exp-days{font-size:13.5px;color:var(--muted);margin:10px 0 0}" +
      ".exp-g{border:0;margin:0;padding:0}.exp-g+.exp-g{margin-top:12px}.exp-g legend{font-size:13px;font-weight:700;padding:0;margin-bottom:6px}" +
      ".exp-ck{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 12px}.exp-ck label{display:flex;align-items:center;gap:8px;font-size:15px;min-height:32px;cursor:pointer}.exp-ck input{width:18px;height:18px;accent-color:var(--accent)}" +
      ".exp-all{display:flex;gap:14px;margin-top:10px}.exp-link{border:0;background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;padding:4px 0;cursor:pointer}" +
      ".exp-acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.exp-btn{font:inherit;font-size:15px;font-weight:600;min-height:40px;padding:0 18px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".exp-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.exp-btn:disabled{opacity:.55;cursor:default}" +
      ".exp :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".exp-prog{margin-top:16px;padding:12px 16px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);font-size:14px}.exp-prog b{display:block;margin-bottom:2px}" +
      ".exp-res{margin-top:16px}.exp-res table{width:100%;border-collapse:collapse;font-size:14px}.exp-res th,.exp-res td{text-align:left;padding:6px 10px;border-top:.5px solid var(--border)}.exp-res td.n{text-align:right;font-variant-numeric:tabular-nums}" +
      ".exp-err{color:var(--danger)}.exp-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".exp-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .exp-chips button[aria-pressed=true]{color:#00160E}}" + // dark accent is light: dark text on it, as the audit trail does
      "@media (max-width:600px){.exp{padding:0 16px}.exp h1{font-size:28px}.exp-f label{flex:1 1 100%}}";
    document.head.appendChild(st);
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "expreg") return;
    var h = '<div class="exp"><button class="exp-back" data-act="back">‹ Settings</button><h1>Download our records</h1>' +
      '<p class="exp-sub">Your registers for the days you choose, as a spreadsheet to keep, or printed for an inspector. Made in this browser from what the screens already show; nothing is sent anywhere.</p>';
    if (!isAdmin()) {
      m.innerHTML = h + '<div class="exp-quiet">Only the pharmacist in charge (an admin account) can download the records. Ask them to sign in.</div></div>'; return bind(m);
    }
    h += '<p class="exp-safe" role="note">This file holds patients\' names and ID cards. Keep it safe.</p>';
    var busy = !!S.job, rg = rangeOf(), t = today(), years = [];
    for (var y = +t.slice(0, 4); y >= +t.slice(0, 4) - 6; y--) years.push(String(y));
    var chip = function (v, l) { return '<button type="button" data-range="' + v + '" aria-pressed="' + (S.range === v) + '"' + (busy ? " disabled" : "") + ">" + l + "</button>"; };
    h += '<h2 class="exp-lab" id="exp-days-h">Days</h2><div class="exp-box" role="group" aria-labelledby="exp-days-h"><div class="exp-chips">' + chip("this", "This month") + chip("last", "Last month") + chip("year", "A year") + chip("custom", "Choose days") + "</div>";
    if (S.range === "year") h += '<div class="exp-f"><label for="exp-year">Year<select id="exp-year"' + (busy ? " disabled" : "") + ">" + years.map(function (y) { return "<option" + ((S.year || years[0]) === y ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></label></div>";
    if (S.range === "custom") h += '<div class="exp-f"><label for="exp-from">First day<input type="date" id="exp-from" value="' + esc(S.from) + '" max="' + t + '"' + (busy ? " disabled" : "") + '></label><label for="exp-to">Last day<input type="date" id="exp-to" value="' + esc(S.to) + '" max="' + t + '"' + (busy ? " disabled" : "") + "></label></div>";
    h += '<p class="exp-days" aria-live="polite">' + (rg ? esc(rangeText(rg)) + " · about " + estimate(rg) + " requests to the server" + (S.picked.endofday ? ", and one more for each day End of day was closed" : "") : "Choose a first and a last day.") + "</p></div>";
    h += '<h2 class="exp-lab">Registers</h2><div class="exp-box">';
    var groups = []; REGS.forEach(function (r) { if (groups.indexOf(r.group) < 0) groups.push(r.group); });
    picked();
    groups.forEach(function (g) {
      h += '<fieldset class="exp-g"><legend>' + esc(g) + '</legend><div class="exp-ck">' + REGS.filter(function (r) { return r.group === g; }).map(function (r) {
        return '<label><input type="checkbox" data-reg="' + r.id + '"' + (S.picked[r.id] ? " checked" : "") + (busy ? " disabled" : "") + ">" + esc(r.title) + "</label>";
      }).join("") + "</div></fieldset>";
    });
    h += '<div class="exp-all"><button type="button" class="exp-link" data-act="all"' + (busy ? " disabled" : "") + '>Tick all</button><button type="button" class="exp-link" data-act="legal"' + (busy ? " disabled" : "") + ">Legal registers only</button></div></div>";
    h += '<div class="exp-acts"><button class="exp-btn p" data-act="download"' + (busy ? " disabled" : "") + '>Download</button><button class="exp-btn" data-act="print"' + (busy ? " disabled" : "") + ">Print inspection pack</button>" +
      (busy ? '<button class="exp-btn" data-act="cancel">Cancel</button>' : "") + "</div>";
    if (S.error) h += '<p class="exp-err" role="alert">' + esc(S.error) + "</p>";
    h += '<div class="exp-live" aria-live="polite">';
    if (busy) h += '<div class="exp-prog"><b>Reading register ' + S.job.i + " of " + S.job.n + "</b>" + esc(S.job.now) + " · " + S.job.calls + " requests so far</div>";
    else if (S.done && S.done.cancelled) h += '<div class="exp-prog"><b>Cancelled.</b>Nothing was saved.</div>';
    else if (S.done) {
      var d = S.done, failed = d.results.filter(function (r) { return r.error; }).length;
      h += '<div class="exp-res"><div class="exp-prog"><b>' + (d.error ? "The file could not be made: " + esc(d.error) : d.kind === "print" ? "The inspection pack opened in a new tab." : "Saved " + esc(d.file.name) + (d.format === "zip" ? " (a CSV file per register)" : "")) + "</b>" +
        esc(rangeText(d.range)) + " · " + d.calls + " requests" + (failed ? ' · <span class="exp-err">' + failed + " not exported</span>" : "") + "</div>" +
        "<table><caption class='exp-lab' style='text-align:left'>What is in it</caption><thead><tr><th scope='col'>Register</th><th scope='col' style='text-align:right'>Rows</th></tr></thead><tbody>" +
        d.results.map(function (r) { return "<tr><td>" + esc(r.reg.title) + "</td><td class='n'>" + (r.error ? '<span class="exp-err">' + esc(r.error) + "</span>" : r.rows.length + (r.extra && r.extra.capped ? " (at most " + r.extra.capped + ")" : "")) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    h += "</div>";
    h += '<p class="exp-foot">One register at a time, a month per request, so the pharmacy\'s day is not slowed. Dates are dd/mm/yyyy, money in euro with two decimals; "Record no." is the number Eikon gave the line, as in the audit trail. Stock-takes, certificates and the other screens are not in this file yet.</p></div>';
    var ae = document.activeElement, had = ae && m.contains(ae), sel = "";
    if (had) ["data-act", "data-range", "data-reg"].forEach(function (k) { if (!sel && ae.getAttribute(k)) sel = "[" + k + '="' + ae.getAttribute(k) + '"]'; });
    if (had && !sel && ae.id) sel = "#" + ae.id;
    m.innerHTML = h;
    if (had) { // keep the keyboard where it was; a run that starts or ends moves it to Cancel or back to Download
      var again = sel && m.querySelector(sel);
      if (!again || again.disabled) again = m.querySelector(busy ? '[data-act="cancel"]' : '[data-act="download"]');
      if (again) again.focus({ preventScroll: true });
    }
    bind(m);
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#settings";
        else if (a === "download") run("file");
        else if (a === "print") run("print");
        else if (a === "cancel") { if (S.job) S.job.cancel = true; S.job = null; S.done = { cancelled: true }; paint(); }
        else if (a === "all") { REGS.forEach(function (r) { S.picked[r.id] = 1; }); paint(); }
        else if (a === "legal") { REGS.forEach(function (r) { S.picked[r.id] = r.group === "Legal registers" ? 1 : 0; }); paint(); }
      });
    });
    m.querySelectorAll("[data-range]").forEach(function (b) {
      b.addEventListener("click", function () { S.range = b.getAttribute("data-range"); S.error = ""; if (S.range === "custom" && !S.from) { S.to = today(); S.from = S.to.slice(0, 7) + "-01"; } paint(); });
    });
    m.querySelectorAll("[data-reg]").forEach(function (c) { c.addEventListener("change", function () { S.picked[c.getAttribute("data-reg")] = c.checked ? 1 : 0; S.error = ""; paint(); }); });
    var on = function (id, fn) { var el = m.querySelector(id); if (el) el.addEventListener("change", fn); };
    on("#exp-year", function () { S.year = this.value; paint(); });
    on("#exp-from", function () { S.from = this.value; paint(); });
    on("#exp-to", function () { S.to = this.value; paint(); });
  }

  E.registerModule({
    id: "expreg", title: "Download our records", order: 102, icon: "⇩", ui2Only: true, adminOnly: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.error = ""; if (!S.job) S.done = null; css(); paint(); }
  });
  // For tests and the real-stack check: the registers and how a run is made.
  E.expreg = { REGS: REGS, run: run, state: S, csv: csv, zip: zip };
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("expreg") < 0) E.UI2_DESTINATIONS.push("expreg");
  if (E.UI2_PARENT) E.UI2_PARENT.expreg = "settings";
})();
