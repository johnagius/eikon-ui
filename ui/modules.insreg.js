/* Inspection check, new layout (Registers › Proof). One read-only page that says, for the days chosen, whether each
   register is in order: temperature days not logged and readings outside the limits without a note, weeks without a
   cleaning, days with work recorded but no pharmacist in the locum register, certificates expired or due, months with
   controlled-drug lines but no stock-take, and (for information) days with no daily-register line. Each reason opens
   the screen and month it is about. Prints as a cover page with sign-off lines, and is the first page of the
   inspection pack in Download our records (E.inspect.coverSection).
   Read only: the GET calls the rebuilt screens already make, a month per call, at most three in flight; the
   controlled-drug lines are read only for a month that has no stock-take. Nothing is written anywhere. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var ID = "insreg", TZ = "Europe/Malta";
  var SOON_DAYS = 30;    // a certificate due within this many days is "look at this" (as the Certificates screen)
  var CLEAN_DAYS = 7;    // cleaned at least once a week (as the Cleaning screen)
  var COUNT_GRACE = 7;   // a stock-take in the first week of the next month counts for the month before
  var MAX_MONTHS = 12;
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var S = { mount: null, range: "this", from: "", to: "", job: null, result: null, error: "" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ── Malta days (strings "YYYY-MM-DD"; arithmetic at UTC noon so no clock change moves a day)
  var fmt = null;
  function parts(ms) {
    if (!fmt) fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    var o = {}; fmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
  }
  function maltaToday() { var p = parts(Date.now()); return p.y + "-" + pad(p.mo) + "-" + pad(p.d); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5); } // b - a
  function weekday(s) { return new Date(s + "T12:00:00Z").getUTCDay(); } // 0 Sunday
  function lastDay(ym) { var a = ym.split("-"); return ym + "-" + pad(new Date(Date.UTC(+a[0], +a[1], 0)).getUTCDate()); }
  function shiftYm(ym, n) { var a = ym.split("-"), d = new Date(Date.UTC(+a[0], +a[1] - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); }
  function monthsIn(from, to) { var out = [], m = from.slice(0, 7), end = to.slice(0, 7); while (m <= end && out.length < 600) { out.push(m); m = shiftYm(m, 1); } return out; }
  function monthName(ym) { var a = ym.split("-"); return MON[+a[1] - 1] + " " + a[0]; }
  function dmy(s) { var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(s || ""); }
  function dayText(s, withYear) { var a = String(s).split("-"); return Number(a[2]) + " " + SHORT[+a[1] - 1] + (withYear ? " " + a[0] : ""); }
  // The server's UTC "YYYY-MM-DD HH:MM:SS" (or ISO) as the Malta day it fell on; a bare date stays itself.
  function maltaDay(v) {
    var s = String(v == null ? "" : v).trim();
    if (!/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return isYmd(s.slice(0, 10)) ? s.slice(0, 10) : "";
    var ms = Date.parse(s.replace(" ", "T") + (/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
    if (isNaN(ms)) return s.slice(0, 10);
    var p = parts(ms); return p.y + "-" + pad(p.mo) + "-" + pad(p.d);
  }
  function num(v) { if (v == null) return null; var s = String(v).trim(); if (!s) return null; var n = Number(s.replace(",", ".")); return isFinite(n) ? n : null; }
  function listDays(days, withYear, max) { // "2, 5 and 9 Oct" style is hard to read across months: "2 Oct, 5 Oct and 9 Oct"
    max = max || 5; var shown = days.slice(0, max).map(function (d) { return dayText(d, withYear); }), more = days.length - shown.length;
    if (more > 0) return shown.join(", ") + " and " + more + " more";
    return shown.length > 1 ? shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1] : shown.join("");
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  // ── The period
  function periodOf(kind, today, from, to) {
    var ym = today.slice(0, 7);
    if (kind === "this") return { kind: kind, from: ym + "-01", to: today, label: monthName(ym) };
    if (kind === "last") { var p = shiftYm(ym, -1); return { kind: kind, from: p + "-01", to: lastDay(p), label: monthName(p) }; }
    if (kind === "three") { var f = shiftYm(ym, -2); return { kind: kind, from: f + "-01", to: today, label: "Last 3 months" }; }
    if (!isYmd(from) || !isYmd(to) || to < from) return null;
    if (to > today) to = today;
    if (to < from) return null;
    return { kind: "custom", from: from, to: to, label: dmy(from) + " to " + dmy(to) };
  }
  function rangeText(rg) { return rg.kind === "custom" ? rg.label : rg.label + " (" + dmy(rg.from) + " to " + dmy(rg.to) + ")"; }
  function inRange(v, rg) { var d = String(v || "").slice(0, 10); return isYmd(d) && d >= rg.from && d <= rg.to; }
  function estimate(rg) { return 3 + 4 * monthsIn(rg.from, rg.to).length; } // devices, certificates, stock-takes; 4 registers a month

  // ── Reading. fetch(path) gives the server's answer (or throws). Registers are read a month at a time, three calls at
  // most in flight. A register whose read fails is reported as "Not checked", never as in order.
  function errText(e) { return e && e.status === 403 ? "not allowed for this account" : e && e.network ? "no connection" : String((e && (e.message || e.error || e)) || "could not read"); }
  async function pool(list, n, fn) {
    var i = 0, ws = [];
    var w = async function () { while (i < list.length) { var k = i++; await fn(list[k], k); } };
    for (var j = 0; j < Math.min(n, list.length); j++) ws.push(w());
    await Promise.all(ws);
  }
  async function gather(rg, fetch, step, today) {
    today = today || maltaToday();
    var months = monthsIn(rg.from, rg.to);
    var D = { months: months, devices: [], temp: [], clean: [], daily: [], locum: [], certs: [], stocktakes: [], dda: {}, err: {}, calls: 0 };
    var call = async function (path) { D.calls++; if (step) step(path, D.calls); var r = await fetch(path); if (!r || r.ok === false) throw new Error((r && r.error) || "No answer"); return r; };
    var tasks = [["temperature", "/temperature/devices", function (r) { D.devices = r.devices || []; }]];
    months.forEach(function (ym) {
      var q = "?month=" + encodeURIComponent(ym);
      tasks.push(["temperature", "/temperature/entries" + q, function (r) { D.temp = D.temp.concat(r.entries || []); }]);
      tasks.push(["cleaning", "/cleaning/entries" + q, function (r) { D.clean = D.clean.concat(r.entries || []); }]);
      tasks.push(["dailyregister", "/daily-register/entries" + q, function (r) { D.daily = D.daily.concat(r.entries || []); }]);
      tasks.push(["locum", "/locumregister/entries" + q, function (r) { D.locum = D.locum.concat(r.entries || []); }]);
    });
    tasks.push(["certificates", "/certificates/items", function (r) { D.certs = r.items || []; }]);
    tasks.push(["dda", "/dda-stocktakes/stocktakes", function (r) { D.stocktakes = r.stocktakes || []; }]);
    await pool(tasks, 3, async function (t) {
      try { t[2](await call(t[1])); }
      catch (e) { if (e && e.cancelled) throw e; if (!D.err[t[0]]) D.err[t[0]] = errText(e); }
    });
    // Cleaning: is it overdue today? Read the month before only when the last week is not in what was read.
    if (!D.err.cleaning && inRange(today, rg)) {
      var weekAgo = addDays(today, -CLEAN_DAYS), start = months[0] + "-01";
      var recent = D.clean.some(function (e) { return e.entry_date >= weekAgo; });
      D.cleanSince = start;
      if (!recent && weekAgo < start) {
        try { var rb = await call("/cleaning/entries?month=" + encodeURIComponent(shiftYm(months[0], -1))); D.clean = D.clean.concat(rb.entries || []); D.cleanSince = shiftYm(months[0], -1) + "-01"; }
        catch (e) { if (e && e.cancelled) throw e; D.err.cleaning = errText(e); }
      }
    }
    // Controlled drugs: a month without a stock-take is read for lines (supplied, POYC, received; stops at the first found).
    if (!D.err.dda) {
      var takes = ddaTakes(D.stocktakes);
      for (var k = 0; k < months.length; k++) {
        var ym = months[k], cut = addDays(lastDay(ym), COUNT_GRACE);
        if (cut >= today || takenFor(takes, ym).length) continue;
        var found = { lines: 0, where: "" };
        for (var r2 of [["cdsreg", "/dda-sales/entries"], ["poyreg", "/dda-poyc/entries"], ["cdpreg", "/dda-purchases/entries"]]) {
          try { var rr = await call(r2[1] + "?month=" + encodeURIComponent(ym)); var n = (rr.entries || []).length; if (n) { found = { lines: n, where: r2[0] }; break; } }
          catch (e) { if (e && e.cancelled) throw e; found = { error: errText(e) }; break; }
        }
        D.dda[ym] = found;
      }
      if (typeof E.ddaBalance === "function") { // item 8 (running balance), when it is in: differences between count and expected
        try { D.balance = await E.ddaBalance({ from: rg.from, to: rg.to, fetch: call }); } catch (e) { if (e && e.cancelled) throw e; D.balanceErr = errText(e); }
      }
    }
    return D;
  }
  // Each stock-take counts for one month: its own, or the month before when it was taken in the first week (the count
  // for October is often made on 1 or 2 November).
  function ddaTakes(list) { return (list || []).map(function (s) { var d = maltaDay(s.created_at); return { id: s.id, day: d, closed: !!s.closed_at, ym: d ? (Number(d.slice(8)) <= COUNT_GRACE ? shiftYm(d.slice(0, 7), -1) : d.slice(0, 7)) : "" }; }).filter(function (s) { return s.day; }); }
  function takenFor(takes, ym) { return takes.filter(function (s) { return s.ym === ym; }); }

  // ── The checks. Pure: the same data, period and day always give the same answer (the UI suite runs them on fixed data).
  // Each register: { id, title, status: ok | look | missing | info | unread, reasons: [{ text, level: missing|look|info|ok, go }] }.
  // go: { mod, ym } opens that screen on that month; { mod: "tempreg", day, device } outlines that day.
  var RANK = { ok: 0, info: 0, look: 1, missing: 2 };
  function worst(reasons) { var s = "ok"; reasons.forEach(function (r) { if ((RANK[r.level] || 0) > RANK[s]) s = r.level; }); return s; }
  function checks(D, rg, today) {
    var yest = addDays(today, -1), withYear = rg.from.slice(0, 4) !== rg.to.slice(0, 4) || rg.to.slice(0, 4) !== today.slice(0, 4);
    var out = [];
    var add = function (id, title, reasons, err, status) {
      if (err) return out.push({ id: id, title: title, status: "unread", reasons: [{ level: "look", text: "Not checked: " + err + ". Try again." }] });
      out.push({ id: id, title: title, status: status || worst(reasons), reasons: reasons });
    };
    var upTo = function (end) { return rg.to < end ? rg.to : end; };

    // Temperature: every day for every fridge and room (from the day it was added), and a note for every reading outside the limits.
    (function () {
      var R = [], entries = D.temp.filter(function (e) { return inRange(e.entry_date, rg); }), last = upTo(yest);
      if (!D.devices.length && !entries.length) { add("temperature", "Temperature", [{ level: "look", text: "No fridge or room is set up, so nothing is being logged.", go: { mod: "tempreg" } }], D.err.temperature); return; }
      var missTotal = 0;
      D.devices.filter(function (d) { return Number(d.active) !== 0; }).forEach(function (dv) {
        var first = rg.from, made = maltaDay(dv.created_at); if (made && made > first) first = made;
        var at = {}; entries.forEach(function (e) { if (String(e.device_id) === String(dv.id)) at[e.entry_date] = 1; });
        var miss = []; for (var d = first; d <= last && miss.length < 400; d = addDays(d, 1)) if (!at[d]) miss.push(d);
        missTotal += miss.length;
        if (miss.length) R.push({ level: "missing", text: dv.name + ": " + plural(miss.length, "day", "days") + " without a reading (" + listDays(miss, withYear) + ").", go: { mod: "tempreg", day: miss[0], device: dv.id } });
      });
      var outs = entries.filter(function (e) {
        var lo = num(e.min_limit), hi = num(e.max_limit), a = num(e.min_temp), b = num(e.max_temp);
        return (lo != null && a != null && a < lo) || (hi != null && b != null && b > hi);
      }).sort(function (a, b) { return a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0; });
      var bare = outs.filter(function (e) { return !String(e.notes || "").trim(); }), noted = outs.length - bare.length;
      var byDev = {}; bare.forEach(function (e) { (byDev[e.device_name || ("Device " + e.device_id)] = byDev[e.device_name || ("Device " + e.device_id)] || []).push(e); });
      Object.keys(byDev).forEach(function (name) {
        var l = byDev[name], e0 = l[0], lim = (num(e0.min_limit) != null ? num(e0.min_limit) : "–") + " to " + (num(e0.max_limit) != null ? num(e0.max_limit) : "–") + " °C";
        R.push({ level: "missing", text: name + ": " + plural(l.length, "reading", "readings") + " outside " + lim + " without a note (" + l.slice(0, 4).map(function (e) { return dayText(e.entry_date, withYear) + " " + num(e.min_temp) + " to " + num(e.max_temp) + " °C"; }).join(", ") + (l.length > 4 ? " and " + (l.length - 4) + " more" : "") + ").", go: { mod: "tempreg", day: e0.entry_date, device: e0.device_id } });
      });
      if (noted) R.push({ level: "info", text: plural(noted, "reading", "readings") + " outside the limits, with a note." });
      if (!R.some(function (r) { return r.level !== "info"; })) R.unshift({ level: "ok", text: "Every day logged for " + plural(D.devices.length, "fridge or room", "fridges and rooms") + (last < rg.from ? " (no full day yet)" : "") + "; no reading outside the limits without a note." });
      add("temperature", "Temperature", R, D.err.temperature);
    })();

    // Cleaning: at least once in every Monday-to-Sunday week inside the days chosen, and not overdue today.
    (function () {
      var R = [], all = D.clean.slice().sort(function (a, b) { return a.entry_date < b.entry_date ? 1 : -1; }), days = {};
      all.forEach(function (e) { days[e.entry_date] = 1; });
      var mon = rg.from; while (weekday(mon) !== 1) mon = addDays(mon, 1);
      var empty = [];
      for (; addDays(mon, 6) <= rg.to && addDays(mon, 6) < today; mon = addDays(mon, 7)) {
        var any = false; for (var i = 0; i < 7; i++) if (days[addDays(mon, i)]) { any = true; break; }
        if (!any) empty.push(mon);
      }
      if (empty.length) R.push({ level: "missing", text: "No cleaning recorded in " + plural(empty.length, "week", "weeks") + ": " + empty.slice(0, 5).map(function (m) { return "week of " + dayText(m, withYear); }).join(", ") + (empty.length > 5 ? " and " + (empty.length - 5) + " more" : "") + ".", go: { mod: "cleanreg", ym: empty[0].slice(0, 7) } });
      if (inRange(today, rg)) {
        var lastC = all.filter(function (e) { return e.entry_date <= today; })[0];
        if (!lastC) R.push({ level: "missing", text: "Overdue: no cleaning recorded since " + dayText(D.cleanSince || (rg.from.slice(0, 7) + "-01"), true) + ". It is due once a week.", go: { mod: "cleanreg", ym: today.slice(0, 7) } });
        else { var n = diffDays(lastC.entry_date, today); if (n > CLEAN_DAYS) R.push({ level: "missing", text: "Overdue: last cleaned " + n + " days ago (" + dayText(lastC.entry_date, withYear) + "). It is due once a week.", go: { mod: "cleanreg", ym: lastC.entry_date.slice(0, 7) } }); }
      }
      var inP = all.filter(function (e) { return inRange(e.entry_date, rg); }).length;
      if (!R.length) R.push({ level: "ok", text: inP ? "Cleaned every week (" + plural(inP, "cleaning", "cleanings") + " recorded)." : "No full week to check yet in these days." });
      add("cleaning", "Cleaning", R, D.err.cleaning);
    })();

    // Daily register: for information only (a day with no prescription medicine supplied has no line).
    (function () {
      var lines = D.daily.filter(function (e) { return inRange(e.entry_date, rg); }), at = {}, none = [];
      lines.forEach(function (e) { at[e.entry_date] = 1; });
      for (var d = rg.from; d <= upTo(yest); d = addDays(d, 1)) if (!at[d]) none.push(d);
      var R = [{ level: "info", text: (lines.length ? plural(lines.length, "line", "lines") + " on " + plural(Object.keys(at).length, "day", "days") + "." : "No line in these days.") + (none.length && lines.length ? " No line on " + plural(none.length, "day", "days") + " (" + listDays(none, withYear, 3) + "); a day with nothing supplied on prescription needs none." : ""), go: none.length ? { mod: "drreg", ym: none[0].slice(0, 7) } : null }];
      add("dailyregister", "Daily register", R, D.err.dailyregister, "info");
    })();

    // Locum register: a pharmacist in charge on each day the pharmacy was working (a reading, a cleaning or a daily-register line).
    (function () {
      var R = [], lines = D.locum.filter(function (e) { return inRange(e.entry_date, rg); }), signed = {}, work = {};
      lines.forEach(function (e) { signed[e.entry_date] = 1; });
      [D.err.temperature ? [] : D.temp, D.err.cleaning ? [] : D.clean, D.err.dailyregister ? [] : D.daily].forEach(function (l) { l.forEach(function (e) { if (inRange(e.entry_date, rg) && e.entry_date < today) work[e.entry_date] = 1; }); });
      var gaps = Object.keys(work).filter(function (d) { return !signed[d]; }).sort();
      if (gaps.length) R.push({ level: "look", text: plural(gaps.length, "day", "days") + " with work recorded but no pharmacist in charge in the locum register (" + listDays(gaps, withYear) + ").", go: { mod: "locreg", ym: gaps[0].slice(0, 7) } });
      var lastL = lines.slice().sort(function (a, b) { return (a.entry_date + (a.time_in || "")) < (b.entry_date + (b.time_in || "")) ? 1 : -1; })[0];
      R.push(lastL ? { level: gaps.length ? "info" : "ok", text: "Last signed " + dayText(lastL.entry_date, withYear) + (lastL.locum_full_name ? " by " + lastL.locum_full_name : "") + (lastL.registration_number ? " (reg no " + lastL.registration_number + ")" : "") + "." + (gaps.length ? "" : " A pharmacist is recorded for every day with work."), go: { mod: "locreg", ym: lastL.entry_date.slice(0, 7) } }
        : { level: gaps.length ? "info" : "ok", text: "No pharmacist recorded in these days." + (gaps.length ? "" : " No day with work to match.") });
      add("locum", "Locum register", R, D.err.locum || (D.err.temperature && D.err.cleaning && D.err.dailyregister ? "the days with work could not be read" : ""));
    })();

    // Certificates: as of today (they are not kept by month).
    (function () {
      var R = [], never = [];
      (D.certs || []).slice().sort(function (a, b) { return String(a.next_due || "9") < String(b.next_due || "9") ? -1 : 1; }).forEach(function (it) {
        if (!it.next_due) { never.push(it.title); return; }
        var n = diffDays(today, it.next_due);
        if (n < 0) R.push({ level: "missing", text: it.title + " expired on " + dayText(it.next_due, true) + " (" + plural(-n, "day", "days") + " ago).", go: { mod: "certreg" } });
        else if (n <= SOON_DAYS) R.push({ level: "look", text: it.title + (n === 0 ? " is due today." : " is due on " + dayText(it.next_due, true) + " (in " + plural(n, "day", "days") + ")."), go: { mod: "certreg" } });
      });
      if (!R.length) R.push({ level: "ok", text: (D.certs || []).length - never.length ? "Every certificate on file is in date for at least " + SOON_DAYS + " days." : "No certificate dates are on file yet." });
      if (never.length) R.push({ level: "info", text: "Not recorded yet: " + never.join(", ") + ".", go: { mod: "certreg" } });
      R.push({ level: "info", text: "Certificates are as of today, whatever days are chosen." });
      add("certificates", "Certificates", R, D.err.certificates);
    })();

    // Controlled drugs: a stock-take for every month with lines; an open stock-take; the balance (item 8) when it exists.
    (function () {
      var R = [], takes = ddaTakes(D.stocktakes);
      D.months.forEach(function (ym) {
        var x = D.dda[ym]; if (!x) return;
        if (x.error) R.push({ level: "look", text: monthName(ym) + ": not checked (" + x.error + ").", go: { mod: "cdsreg", ym: ym } });
        else if (x.lines) R.push({ level: "look", text: monthName(ym) + ": controlled drugs were supplied or received (" + plural(x.lines, "line", "lines") + " in " + ({ cdsreg: "Controlled drugs supplied", poyreg: "POYC controlled drugs", cdpreg: "Controlled drugs received" }[x.where] || "the registers") + "), but no stock-take was taken in the month or the first week after it.", go: { mod: x.where, ym: ym } });
      });
      takes.filter(function (s) { return !s.closed && s.day >= rg.from && s.day <= rg.to; }).forEach(function (s) { R.push({ level: "look", text: "The stock-take started on " + dayText(s.day, withYear) + " is not closed.", go: { mod: "ddstreg" } }); });
      var inP = takes.filter(function (s) { return D.months.indexOf(s.ym) >= 0; }).sort(function (a, b) { return a.day < b.day ? 1 : -1; });
      var cur = D.months.filter(function (ym) { return addDays(lastDay(ym), COUNT_GRACE) >= today; });
      if (D.balance && D.balance.length) D.balance.forEach(function (b) {
        var d = num(b.counted) != null && num(b.expected) != null ? num(b.counted) - num(b.expected) : num(b.diff);
        if (d) R.push({ level: "missing", text: (b.name || "A controlled drug") + ": counted " + num(b.counted) + ", expected " + num(b.expected) + " (" + (d > 0 ? "+" : "") + d + ").", go: { mod: "ddstreg" } });
      });
      if (D.balanceErr) R.push({ level: "look", text: "The running balance could not be read (" + D.balanceErr + ")." });
      if (!R.some(function (r) { return r.level !== "info"; })) R.unshift({ level: "ok", text: inP.length ? plural(inP.length, "stock-take", "stock-takes") + " in these days (last on " + dayText(inP[0].day, withYear) + "); every finished month with lines has one." : "No month with controlled-drug lines is without a stock-take." });
      if (cur.length) R.push({ level: "info", text: cur.map(monthName).join(" and ") + ": the stock-take is not due yet (it counts until a week after the month ends)." });
      add("dda", "Controlled drugs", R, D.err.dda);
    })();
    return out;
  }
  function headline(list) {
    var miss = list.filter(function (r) { return r.status === "missing"; }).length, look = list.filter(function (r) { return r.status === "look"; }).length, un = list.filter(function (r) { return r.status === "unread"; }).length;
    if (!miss && !look && !un) return { level: "ok", text: "Everything checked is in order for these days." };
    var bits = [];
    if (miss) bits.push(plural(miss, "register has", "registers have") + " something missing");
    if (look) bits.push(plural(look, "needs", "need") + " a look");
    if (un) bits.push(plural(un, "could not be checked", "could not be checked"));
    return { level: miss ? "missing" : "look", text: bits.join(", ") + "." };
  }
  var WORD = { ok: "In order", look: "Look at this", missing: "Missing", info: "For information", unread: "Not checked" };

  // A whole run: read, check, keep the result. fetch is optional (Download our records passes its own, so a register month
  // it has already read is not read again).
  async function run(rg, fetch, step) {
    var today = maltaToday(), t0 = Date.now();
    fetch = fetch || function (p) { return E.apiFetch(p, { method: "GET" }); };
    var D = await gather(rg, fetch, step, today);
    var list = checks(D, rg, today);
    return { range: rg, today: today, at: new Date(), ms: Date.now() - t0, calls: D.calls, list: list, head: headline(list) };
  }

  // ── Print. One function, so the print route can be switched in one place: the live CSP-safe route, E.openPrint (a new
  // tab written from here, no inline script; E.printTab focuses and prints it 150 ms after load). Refused tab: E.months.print.
  function printDoc(res) {
    var u = (E.state && E.state.user) || {}, p = parts(res.at.getTime());
    var doc = { register: "Inspection check", period: rangeText(res.range),
      intro: '<p class="sub">' + esc("Checked " + pad(p.d) + "/" + pad(p.mo) + "/" + p.y + " " + pad(p.h) + ":" + pad(p.mi) + " (Malta time)" + (u.full_name ? " by " + u.full_name : "") + ". " + res.head.text) + "</p>",
      sections: [{ cols: ["Register", "Status", "What was found"], rows: res.list.map(function (r) {
        return [r.title, r.status === "missing" ? { html: "<b>" + esc(WORD[r.status]) + "</b>" } : WORD[r.status], { html: r.reasons.map(function (x) { return esc(x.text); }).join("<br>") }];
      }) }],
      sign: ["Pharmacist in charge", "Signature", "Date"] };
    return doc;
  }
  function openPrint(res) {
    var doc = printDoc(res), html = E.months.printHtml(doc);
    E.months.lastPrint = { register: doc.register, month: "", html: html };
    var w = E.openPrint ? E.openPrint(html, { delay: 150, focus: true }) : null;
    if (!w) E.months.print(doc); // the tab was refused: the shared route (a blob tab, or the link)
    return html;
  }
  // The cover page of the inspection pack in Download our records: its own page markup (class "pg"), the same summary.
  function coverSection(res, loc) {
    if (!res) return "";
    var p = parts(res.at.getTime());
    return '<section class="pg"><header><b>' + esc(loc || "") + "</b><span>Inspection check</span><span>" + esc(rangeText(res.range)) + "</span></header>" +
      "<p class='n'>" + esc("Checked " + pad(p.d) + "/" + pad(p.mo) + "/" + p.y + " " + pad(p.h) + ":" + pad(p.mi) + " (Malta time). " + res.head.text) + "</p>" +
      "<table><thead><tr><th>Register</th><th>Status</th><th>What was found</th></tr></thead><tbody>" +
      res.list.map(function (r) { return "<tr><td>" + esc(r.title) + "</td><td" + (r.status === "missing" ? ' class="bad"' : "") + ">" + esc(WORD[r.status]) + "</td><td>" + r.reasons.map(function (x) { return esc(x.text); }).join("<br>") + "</td></tr>"; }).join("") +
      "</tbody></table>" +
      '<div class="sign"><div><span></span><small>Pharmacist in charge</small></div><div><span></span><small>Signature</small></div><div><span></span><small>Date</small></div></div></section>';
  }

  // ── Opening the place a reason is about
  function go(g) {
    if (!g || !g.mod) return;
    if (g.mod === "tempreg" && g.day) { try { sessionStorage.setItem("eikon_tempreg_day", JSON.stringify({ day: g.day, device: g.device })); } catch (e) {} }
    else if (g.ym && E.months && E.months.openAt) E.months.openAt(g.mod, g.ym);
    window.location.hash = "#" + g.mod;
  }

  // ── Screen
  function css() {
    if (document.getElementById("eikon-insreg-css")) return;
    var st = document.createElement("style"); st.id = "eikon-insreg-css";
    st.textContent =
      ".ins{max-width:880px;margin:0 auto}.ins-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".ins h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.ins-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;line-height:1.5}" +
      ".ins-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-top:16px}" +
      ".ins-chips{display:flex;gap:6px;flex-wrap:wrap}.ins-chips button{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".ins-chips button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".ins-f{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px}.ins-f label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--muted);min-width:150px}" +
      ".ins-f input{height:38px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 10px}" +
      ".ins-days{font-size:13.5px;color:var(--muted);margin:10px 0 0}" +
      ".ins-btn{font:inherit;font-size:15px;font-weight:600;min-height:40px;padding:0 18px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".ins-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.ins-btn:disabled{opacity:.55;cursor:default}" +
      ".ins-acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}" +
      ".ins :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".ins-head{margin-top:16px;padding:12px 16px;border-radius:12px;border:1px solid var(--border);border-left:4px solid var(--ok,#0A8F6A);background:var(--panel2);font-size:15px;font-weight:600}" +
      ".ins-head.look{border-left-color:#C98A12}.ins-head.missing{border-left-color:var(--danger)}.ins-head small{display:block;font-weight:400;font-size:13px;color:var(--muted);margin-top:2px}" +
      ".ins-list{margin:14px 0 0;padding:0;list-style:none;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".ins-reg{padding:12px 16px;border-top:.5px solid var(--border);border-left:3px solid transparent}.ins-reg:first-child{border-top:0}" +
      ".ins-reg.missing{border-left-color:var(--danger)}.ins-reg.look,.ins-reg.unread{border-left-color:#C98A12}" +
      ".ins-reg h2{display:flex;align-items:center;gap:10px;justify-content:space-between;font-size:16px;font-weight:700;margin:0}" +
      ".ins-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap}" +
      ".ins-pill.ok{background:rgba(10,143,106,.12);color:var(--accent)}.ins-pill.look,.ins-pill.unread{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.ins-pill.missing{background:rgba(215,38,28,.12);color:var(--danger)}.ins-pill.info{background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".ins-reg ul{margin:6px 0 0;padding:0;list-style:none}.ins-reg li{display:flex;gap:10px;align-items:baseline;justify-content:space-between;font-size:14px;line-height:1.45;padding:3px 0}" +
      ".ins-reg li.info{color:var(--muted);font-size:13px}.ins-reg li.missing span::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--danger);margin-right:7px;vertical-align:1px}.ins-reg li.look span::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#C98A12;margin-right:7px;vertical-align:1px}" +
      ".ins-go{border:0;background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;padding:2px 0;cursor:pointer;white-space:nowrap;flex:none}" +
      ".ins-prog{margin-top:16px;padding:12px 16px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);font-size:14px}.ins-prog b{display:block;margin-bottom:2px}" +
      ".ins-err{color:var(--danger)}.ins-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .ins-chips button[aria-pressed=true]{color:#00160E}}" +
      "@media (max-width:600px){.ins{padding:0 16px}.ins h1{font-size:28px}.ins-f label{flex:1 1 100%}.ins-reg li{flex-direction:column;gap:0}}";
    document.head.appendChild(st);
  }

  function rangeNow() { return periodOf(S.range, maltaToday(), S.from, S.to); }
  async function start() {
    var rg = rangeNow();
    if (!rg) { S.error = "Choose a first and a last day, the last one not before the first."; return paint(); }
    if (monthsIn(rg.from, rg.to).length > MAX_MONTHS) { S.error = "Choose at most " + MAX_MONTHS + " months at a time."; return paint(); }
    var job = { cancel: false, calls: 0, now: "", range: rg };
    S.job = job; S.error = ""; paint();
    var fetch = function (p) { if (job.cancel || S.job !== job) return Promise.reject({ cancelled: true }); return E.apiFetch(p, { method: "GET" }); };
    try {
      var res = await run(rg, fetch, function (path, n) { job.calls = n; job.now = path; if (S.job === job) paint(); });
      if (S.job !== job) return;
      S.result = res; E.inspectLast = res;
    } catch (e) {
      if (S.job !== job) return;
      if (!(e && e.cancelled)) S.error = "The check could not be made: " + errText(e) + ".";
    }
    S.job = null; paint();
  }
  function stepText(path) {
    var m = /month=(\d{4}-\d{2})/.exec(path || ""), w = { "/temperature": "Temperature", "/cleaning": "Cleaning", "/daily-register": "Daily register", "/locumregister": "Locum register", "/certificates": "Certificates", "/dda": "Controlled drugs" }, k = "";
    Object.keys(w).forEach(function (p) { if (!k && String(path).indexOf(p) === 0) k = w[p]; });
    return (k || "Reading") + (m ? ", " + monthName(m[1]) : "");
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== ID) return;
    var busy = !!S.job, rg = rangeNow(), t = maltaToday();
    var chip = function (v, l) { return '<button type="button" data-range="' + v + '" aria-pressed="' + (S.range === v) + '"' + (busy ? " disabled" : "") + ">" + l + "</button>"; };
    var h = '<div class="ins"><button class="ins-back" data-act="back">‹ Registers</button><h1>Inspection check</h1>' +
      '<p class="ins-sub">Whether each register is in order for the days you choose, and what to look at before an inspector does. Read only: nothing is changed.</p>' +
      '<div class="ins-box" role="group" aria-label="Days to check"><div class="ins-chips">' + chip("this", "This month") + chip("last", "Last month") + chip("three", "Last 3 months") + chip("custom", "Choose days") + "</div>";
    if (S.range === "custom") h += '<div class="ins-f"><label for="ins-from">First day<input type="date" id="ins-from" value="' + esc(S.from) + '" max="' + t + '"' + (busy ? " disabled" : "") + '></label><label for="ins-to">Last day<input type="date" id="ins-to" value="' + esc(S.to) + '" max="' + t + '"' + (busy ? " disabled" : "") + '></label><button type="button" class="ins-btn p" data-act="check"' + (busy ? " disabled" : "") + ">Check</button></div>";
    h += '<p class="ins-days">' + (rg ? esc(rangeText(rg)) + " · about " + estimate(rg) + " requests to the server" : "Choose a first and a last day.") + "</p></div>";
    if (S.error) h += '<p class="ins-err" role="alert">' + esc(S.error) + "</p>";
    h += '<div class="ins-live" aria-live="polite">';
    if (busy) h += '<div class="ins-prog"><b>Checking ' + esc(rangeText(S.job.range)) + "…</b>" + esc(stepText(S.job.now)) + " · " + S.job.calls + " requests so far</div>";
    else if (S.result) {
      var R = S.result;
      h += '<div class="ins-head ' + R.head.level + '">' + esc(R.head.text) + "<small>" + esc(rangeText(R.range)) + " · checked " + esc(dmy(R.today)) + " · " + R.calls + " requests</small></div>";
      h += '<ul class="ins-list">' + R.list.map(function (r, ri) {
        return '<li class="ins-reg ' + r.status + '" data-reg="' + esc(r.id) + '"><h2><span>' + esc(r.title) + '</span><span class="ins-pill ' + r.status + '">' + esc(WORD[r.status]) + "</span></h2><ul>" +
          r.reasons.map(function (x, xi) { return '<li class="' + x.level + '"><span>' + esc(x.text) + "</span>" + (x.go && x.go.mod && x.level !== "ok" && x.level !== "info" ? '<button type="button" class="ins-go" data-go="' + ri + ":" + xi + '" aria-label="Open: ' + esc(x.text) + '">Open ›</button>' : x.go && x.go.mod ? '<button type="button" class="ins-go" data-go="' + ri + ":" + xi + '" aria-label="Open ' + esc(r.title) + '">Open ›</button>' : "") + "</li>"; }).join("") + "</ul></li>";
      }).join("") + "</ul>";
    }
    h += "</div>";
    h += '<div class="ins-acts">' + (busy ? '<button class="ins-btn" data-act="cancel">Cancel</button>' : '<button class="ins-btn p" data-act="print"' + (S.result ? "" : " disabled") + ">Print with sign-off lines</button>" + '<button class="ins-btn" data-act="again">Check again</button>') + "</div>";
    h += '<p class="ins-foot">What is checked: a temperature reading every day for each fridge and room, and a note for each reading outside its limits; a cleaning every week; a pharmacist in the locum register on each day with work; certificates expired or due within ' + SOON_DAYS + ' days (as of today); a controlled-drug stock-take for each month with lines. Days with no daily-register line are listed for information only. Today is not counted until it is over.</p></div>';
    var ae = document.activeElement, had = ae && m.contains(ae), sel = "";
    if (had) ["data-act", "data-range", "data-go"].forEach(function (k) { if (!sel && ae.getAttribute(k)) sel = "[" + k + '="' + ae.getAttribute(k) + '"]'; });
    if (had && !sel && ae.id) sel = "#" + ae.id;
    m.innerHTML = h;
    if (had) {
      var again = sel && m.querySelector(sel);
      if (!again || again.disabled) again = m.querySelector(busy ? '[data-act="cancel"]' : '[data-act="again"]');
      if (again) again.focus({ preventScroll: true });
    }
    bind(m);
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#registers";
        else if (a === "check" || a === "again") start();
        else if (a === "cancel") { if (S.job) S.job.cancel = true; S.job = null; paint(); }
        else if (a === "print" && S.result) openPrint(S.result);
      });
    });
    m.querySelectorAll("[data-range]").forEach(function (b) {
      b.addEventListener("click", function () {
        S.range = b.getAttribute("data-range"); S.error = ""; S.result = null;
        if (S.range === "custom") { if (!S.from) { S.to = maltaToday(); S.from = S.to.slice(0, 7) + "-01"; } paint(); }
        else start();
      });
    });
    m.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { var p = b.getAttribute("data-go").split(":"), r = S.result && S.result.list[+p[0]], x = r && r.reasons[+p[1]]; if (x) go(x.go); });
    });
    var on = function (id, fn) { var el = m.querySelector(id); if (el) el.addEventListener("change", fn); };
    on("#ins-from", function () { S.from = this.value; S.result = null; paint(); });
    on("#ins-to", function () { S.to = this.value; S.result = null; paint(); });
  }

  E.registerModule({
    id: ID, title: "Inspection check", order: 3, icon: "☑", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.error = ""; css();
      var fresh = S.result && S.result.today === maltaToday() && Date.now() - S.result.at.getTime() < 10 * 60000; // back from a register: the last check stays
      paint(); if (!fresh && !S.job && rangeNow()) return start();
    }
  });
  // For Download our records, the tests and the real-stack check.
  E.inspect = { periodOf: periodOf, gather: gather, checks: checks, headline: headline, run: run, printDoc: printDoc, openPrint: openPrint, coverSection: coverSection, rangeText: rangeText, state: S, WORD: WORD };
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  if (E.UI2_PARENT) E.UI2_PARENT[ID] = "registers";
})();
