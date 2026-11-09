/* EIKON — the inspection pack  (eikon.inspack.js)
   One tap on the Inspection check (modules.insreg.js) makes the whole pack for the days chosen, in one printable tab:
     1. a cover page: the pharmacy, its address and phone (Bookings › Messages, when this account may read them), the
        days, the pharmacists in charge (from the locum register) and who prepared it;
     2. contents: every register with ✓ or what is missing;
     3. each register as its own screen prints it, month by month (E.months.printHtml, the same document its Print
        button makes, so the legal wording of the controlled-drug registers is the screen's own), after a box that lists
        every gap the check found in it, day by day;
     4. a sign-off page for the pharmacist in charge and the inspector.
   Built only when asked. Read only: the GET calls the screens already make, a month per call, at most three in flight,
   each path read once per pack (the check and the pages share them); a stock take's printout is the worker's own page,
   read once per stock take in the days chosen. Nothing is written anywhere. "Since last inspection" is a day this
   browser remembers (no new storage on the server).
   CSP-safe: the tab is opened on the tap (so no pop-up blocker refuses it), written from here with no script in it, and
   printed by E.printTab. A refused tab falls back to E.openPrintUrlOrLink. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var POOL = 3, MAX_TAKES = 24, LAST_KEY = "eikon_inspack_last:"; // + location id (no key is shared between pharmacies)
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function user() { return (E.state && E.state.user) || {}; }
  function ymdLocal(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function maltaToday() { return (E.maltaYmd && E.maltaYmd()) || ymdLocal(new Date()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  // The pack's own words write a day as the screen does ("1 Oct 2026"); the registers' pages keep their own dates.
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dmy(s) { var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Number(m[3]) + " " + SHORT[+m[2] - 1] + " " + m[1] : String(s || ""); }
  function shiftYm(ym, n) { var a = ym.split("-"), d = new Date(Date.UTC(+a[0], +a[1] - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); }
  function monthsIn(from, to) { var out = [], m = from.slice(0, 7), end = to.slice(0, 7); while (m <= end && out.length < 600) { out.push(m); m = shiftYm(m, 1); } return out; }
  function monthName(ym) { var a = ym.split("-"); return MON[+a[1] - 1] + " " + a[0]; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function inRange(v, rg) { var d = String(v || "").slice(0, 10); return isYmd(d) && d >= rg.from && d <= rg.to; }

  // ── "Since last inspection": the day is kept on the server for the pharmacy (GET/PUT /registers/last-inspection), so
  // every device of the pharmacy agrees; this browser keeps a copy, and is the only place when the route is missing
  // (an older worker answers 404/405). lastInspection() is the day known now; loadLast() asks the server once a minute
  // at most; setLastInspection(d) keeps it here at once and on the server (a Promise: { ok, server, error }).
  var SRV = { loc: "", day: null, by: "", at: 0, missing: false };
  function locKey() { var u = user(); return String(u.location_id || u.location_name || "here"); }
  function localDay() { try { var d = localStorage.getItem(LAST_KEY + locKey()); return isYmd(d) ? d : ""; } catch (e) { return ""; } }
  function keepLocal(d) { try { if (isYmd(d)) localStorage.setItem(LAST_KEY + locKey(), d); else localStorage.removeItem(LAST_KEY + locKey()); } catch (e) {} }
  function fresh() { if (SRV.loc !== locKey()) SRV = { loc: locKey(), day: null, by: "", at: 0, missing: false }; return SRV; }
  function lastInspection() { var s = fresh(); return s.day != null ? s.day : localDay(); }
  function lastInspectionBy() { var s = fresh(); return s.day ? s.by : ""; }
  function noRoute(e) { return e && (e.status === 404 || e.status === 405); }
  async function loadLast() {
    var s = fresh();
    if (s.missing || Date.now() - s.at < 60000) return lastInspection();
    try {
      var r = await E.apiFetch("/registers/last-inspection", { method: "GET" });
      if (s !== fresh()) return lastInspection();
      s.at = Date.now();
      if (r && r.ok !== false && typeof r.last_date === "string") {
        var here = localDay();
        if (!r.last_date && here) { s.day = here; s.by = ""; setLastInspection(here); return here; } // a day kept here before the server had it: share it once
        s.day = r.last_date; s.by = r.set_name || ""; keepLocal(r.last_date);
      }
    } catch (e) { if (noRoute(e)) s.missing = true; }
    return lastInspection();
  }
  async function setLastInspection(d) {
    var s = fresh(); keepLocal(d); s.day = isYmd(d) ? d : ""; s.by = user().full_name || "";
    if (s.missing) return { ok: true, server: false };
    try {
      var r = await E.apiFetch("/registers/last-inspection", { method: "PUT", body: JSON.stringify({ date: isYmd(d) ? d : "" }) });
      if (r && r.ok !== false) { s.day = r.last_date || ""; s.by = r.set_name || s.by; s.at = Date.now(); return { ok: true, server: true }; }
      return { ok: false, server: true, error: (r && r.error) || "not saved" };
    } catch (e) {
      if (noRoute(e)) { s.missing = true; return { ok: true, server: false }; }
      return { ok: false, server: true, error: e && e.network ? "no connection" : String((e && e.message) || e) };
    }
  }

  // ── Each register's printout, as its own screen makes it: the screen's document builder E.printDocs[id](month,
  // entries, extra), the same object its Print button passes to E.months.print. The controlled-drug registers are never
  // copied here (their legal wording is theirs alone): until their screens share E.printDocs, their pages in the pack say
  // to print them from the screen. Until the daily registers share theirs, these copies of their printMonth stand in, and
  // tests/real/cases/inspack.mjs proves each page is byte-identical to the screen's own print for the same month.
  var DOCS = {
    // modules.tempreg.js printMonth (devices: the active fridges and rooms, as the screen loads them)
    tempreg: function (m, entries, devices) {
      var MB = E.months, n = MB.days(m), today = ymdLocal(new Date()), at = {};
      var fmt = function (v) { return v == null || v === "" ? "–" : String(Math.round(Number(v) * 10) / 10); };
      var outside = function (e, dv) { var lo = dv.min_limit, hi = dv.max_limit; return (lo != null && Number(e.min_temp) < Number(lo)) || (hi != null && Number(e.max_temp) > Number(hi)); };
      var limitsText = function (dv) { if (dv.min_limit == null && dv.max_limit == null) return "No limits set"; return fmt(dv.min_limit) + " to " + fmt(dv.max_limit) + " °C"; };
      var printName = function (dv) { var nm = String((dv && dv.name) || "").trim(), k = nm.toLowerCase(), here = String(user().location_name || "").trim().toLowerCase(); return k === "pharmacy" || (here && k === here) ? "Room (" + nm + ")" : nm; };
      entries.forEach(function (e) { at[e.entry_date + "|" + e.device_id] = e; });
      var devs = (devices || []).filter(function (d) { return Number(d.active) !== 0; }).slice();
      entries.forEach(function (e) { if (!devs.some(function (d) { return Number(d.id) === Number(e.device_id); })) devs.push({ id: e.device_id, name: e.device_name || ("Device " + e.device_id), device_type: e.device_type, min_limit: e.min_limit, max_limit: e.max_limit }); });
      var rows = [];
      for (var d = 1; d <= n; d++) {
        var key = m + "-" + pad(d); if (key > today) break;
        rows.push([MB.dmy(key)].concat(devs.map(function (dv) {
          var e = at[key + "|" + dv.id];
          if (!e) return key < today ? { html: '<span class="miss">Not logged</span>' } : "";
          var o = outside(e, dv), t = fmt(e.min_temp) + " / " + fmt(e.max_temp) + (o ? " (outside limits)" : "") + (e.notes ? " · " + e.notes : "");
          return o ? { html: "<b>" + esc(t) + "</b>" } : t;
        })));
      }
      return { register: "Temperature", month: m,
        intro: '<p class="sub">Each day: minimum / maximum °C. Limits: ' + esc(devs.map(function (dv) { return printName(dv) + " " + limitsText(dv); }).join(" · ")) + ".</p>",
        sections: [{ cols: [m.slice(0, 4) + "-" + m.slice(5)].concat(devs.map(printName)), rows: rows, empty: devs.length ? MB.empty(m) : "No fridges or rooms are set up." }] };
    },
    // modules.cleanreg.js printMonth (entries newest first, as the screen sorts them)
    cleanreg: function (m, entries) {
      var MB = E.months, list = entries.slice().sort(function (a, b) { return (a.entry_date + (a.time_in || "")) < (b.entry_date + (b.time_in || "")) ? 1 : -1; });
      return { register: "Cleaning register", month: m, sections: [{ cols: ["Date", "Time in", "Time out", "Cleaner", "Staff", "Notes"],
        rows: list.slice().reverse().map(function (e) { return [MB.dmy(e.entry_date), e.time_in || "", e.time_out || "", e.cleaner_name || "", e.staff_name || "", e.notes || ""]; }) }] };
    },
    // modules.drreg.js printMonth
    drreg: function (m, entries) {
      var MB = E.months, list = entries.slice().sort(function (a, b) { return (String(a.entry_date) + String(a.id).padStart(9, "0")) < (String(b.entry_date) + String(b.id).padStart(9, "0")) ? 1 : -1; });
      return { register: "Daily register", month: m, landscape: true, sections: [{ cols: ["Date", "Client", "Medicine name and dose", "Posology", "Prescriber name", "Reg no"],
        rows: list.slice().reverse().map(function (e) { return [MB.dmy(e.entry_date), { html: "<b>" + esc(e.client_name || "") + "</b><br>ID: " + esc(e.client_id || "") }, e.medicine_name_dose || "", e.posology || "", e.prescriber_name || "", e.prescriber_reg_no || ""]; }) }] };
    },
    // modules.locreg.js printMonth
    locreg: function (m, entries) {
      var MB = E.months, list = entries.slice().sort(function (a, b) { return (String(a.entry_date) + (a.time_in || "")) < (String(b.entry_date) + (b.time_in || "")) ? 1 : -1; });
      return { register: "Locum register", month: m, sections: [{ cols: ["Date", "Time in", "Time out", "Name and surname", "Registration no"],
        rows: list.slice().reverse().map(function (e) { return [MB.dmy(e.entry_date), e.time_in || "", e.time_out || "", e.locum_full_name || "", e.registration_number || ""]; }) }] };
    },
    // modules.certreg.js printList (items as of today)
    certreg: function (_m, items) {
      var MB = E.months, SHORT = 30;
      var sc = function (t) { return String(t == null ? "" : t).split(" ").map(function (w, i) { return !i || w.length < 2 || w === w.toUpperCase() || /\d/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1); }).join(" "); };
      var daysUntil = function (s) { var p = String(s).split("-"); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000); };
      var state = function (it) {
        if (!it.next_due) return { k: "none", label: "Not recorded", order: 1 };
        var n = daysUntil(it.next_due);
        if (n < 0) return { k: "over", label: "Overdue " + (-n) + (n === -1 ? " day" : " days"), order: 0, n: n };
        if (n <= SHORT) return { k: "soon", label: n === 0 ? "Due today" : "Due in " + n + (n === 1 ? " day" : " days"), order: 2, n: n };
        return { k: "ok", label: "In date", order: 3, n: n };
      };
      var sorted = (items || []).slice().sort(function (a, b) { var x = state(a), y = state(b); return x.order - y.order || (x.n || 0) - (y.n || 0) || String(a.title).localeCompare(String(b.title)); });
      return { register: "Certificates", period: "Printed " + MB.dmy(ymdLocal(new Date())), sections: [{ cols: ["Item", "Last", "Next due", "Every", "Certified", "Status"],
        rows: sorted.map(function (it) { var st = state(it), t = st.label; return [sc(it.title || ""), MB.dmy(it.last_date || ""), MB.dmy(it.next_due || ""), it.interval_months ? it.interval_months + " months" : "", it.certified_person || "", st.k === "over" ? { html: "<b>" + esc(t) + "</b>" } : t]; }),
        empty: "No certificates are set up for this pharmacy." }] };
    }
  };
  function builder(id) { var own = E.printDocs && E.printDocs[id]; return typeof own === "function" ? own : DOCS[id] || null; }
  function docFor(id, m, list, extra) { var f = builder(id); return f ? f(m, list, extra) : null; }
  // The body of a printout (between <body> and its screen-only footer line): exactly what the screen's print shows.
  function bodyOf(html) { var a = html.indexOf("<body>"), b = html.lastIndexOf("<p class='pf'>"); return a < 0 ? "" : html.slice(a + 6, b > a ? b : html.lastIndexOf("</body>")); }
  // A stock take's printout is the worker's own page: its body, without the screen-only Print button or anything that runs.
  function takeBody(html) {
    var s = String(html || ""), a = s.search(/<body[^>]*>/i), b = s.search(/<\/body>/i);
    if (a >= 0) s = s.slice(s.indexOf(">", a) + 1, b > a ? b : undefined);
    return s.replace(/<div class="no-print"[\s\S]*?<\/div>/i, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").trim();
  }

  // ── The registers in the pack, in the order an inspector asks for them. check: the Inspection check's entry for it.
  var REGS = [
    { id: "temperature", doc: "tempreg", title: "Temperature", path: "/temperature/entries", check: "temperature" },
    { id: "cleaning", doc: "cleanreg", title: "Cleaning", path: "/cleaning/entries", check: "cleaning" },
    { id: "dailyregister", doc: "drreg", title: "Daily register", path: "/daily-register/entries", check: "dailyregister" },
    { id: "locum", doc: "locreg", title: "Locum register", path: "/locumregister/entries", check: "locum" },
    { id: "ddapurchases", doc: "cdpreg", title: "Controlled drugs received", path: "/dda-purchases/entries", cd: true },
    { id: "ddasales", doc: "cdsreg", title: "Controlled drugs supplied", path: "/dda-sales/entries", cd: true },
    { id: "ddapoyc", doc: "poyreg", title: "POYC controlled drugs", path: "/dda-poyc/entries", cd: true },
    { id: "stocktakes", title: "Controlled-drug stock takes", check: "dda", takes: true },
    { id: "repeat", doc: "repreg", title: "Repeat prescriptions", path: "/repeat-prescriptions/entries" },
    { id: "certificates", doc: "certreg", title: "Certificates", check: "certificates", once: true }
  ];

  function errText(e) { return e && e.status === 403 ? "not allowed for this account" : e && e.network ? "no connection" : String((e && (e.message || e.error || e)) || "could not read"); }
  async function pool(list, n, fn) {
    var i = 0, ws = [];
    var w = async function () { while (i < list.length) { var k = i++; await fn(list[k], k); } };
    for (var j = 0; j < Math.min(n, list.length); j++) ws.push(w());
    await Promise.all(ws);
  }

  // ── Reading and building. opts.fetch(path) answers like E.apiFetch (or throws); opts.step(text, calls) reports progress.
  async function build(rg, opts) {
    opts = opts || {};
    // Anyone signed in may print the pack (owner, 9 Nov): each page is already printable by staff from its own screen.
    var raw = opts.fetch || function (p) { return E.apiFetch(p, { method: "GET" }); }, cache = {}, job = { calls: 0, paths: [] };
    var step = function (t) { if (opts.step) opts.step(t, job.calls); };
    var get = function (path) { // each path once per pack, even when asked twice at the same moment
      if (!cache[path]) { job.calls++; job.paths.push(path); cache[path] = Promise.resolve().then(function () { return raw(path); }).then(function (r) { if (!r || r.ok === false) throw new Error((r && r.error) || "No answer"); return r; }); cache[path].catch(function () {}); }
      return cache[path];
    };
    step("Checking every register");
    var check = await E.inspect.run(rg, get, function (path) { step(stepText(path)); });
    var D = check.data || {}, months = monthsIn(rg.from, rg.to), got = {}, err = {};
    // The registers' months (the check has read most of them already: those come from the cache).
    var tasks = [];
    REGS.forEach(function (R) {
      if (!R.path) return;
      got[R.id] = {};
      if (!builder(R.doc)) return; // printed from its own screen: nothing to read for it
      months.forEach(function (ym) { tasks.push([R, ym]); });
    });
    await pool(tasks, POOL, async function (t) {
      var R = t[0], ym = t[1];
      if (err[R.id]) return;
      step(R.title + ", " + monthName(ym));
      try { var r = await get(R.path + "?month=" + encodeURIComponent(ym)); got[R.id][ym] = r.entries || []; }
      catch (e) { if (e && e.cancelled) throw e; err[R.id] = errText(e); }
    });
    // Stock takes counted for these months (its own month, or the month before when taken in its first week), each printed as the worker prints it.
    var takes = [];
    if (D.err && D.err.dda) err.stocktakes = D.err.dda;
    else {
      takes = (D.stocktakes || []).map(function (s) { var d = maltaDayOf(s.created_at); return { id: s.id, day: d, closed: !!s.closed_at, ym: d ? (Number(d.slice(8)) <= 7 ? shiftYm(d.slice(0, 7), -1) : d.slice(0, 7)) : "" }; })
        .filter(function (s) { return s.day && (months.indexOf(s.ym) >= 0 || inRange(s.day, rg)); })
        .sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id; });
      var more = takes.length > MAX_TAKES ? takes.length - MAX_TAKES : 0; takes = takes.slice(0, MAX_TAKES); takes.more = more;
      await pool(takes, POOL, async function (s) {
        step("Stock take of " + dmy(s.day));
        try { var r = await get("/dda-stocktakes/stocktakes/" + encodeURIComponent(s.id) + "/report/html"); s.html = takeBody(r && typeof r.text === "string" ? r.text : ""); if (!s.html) s.error = "the printout was empty"; }
        catch (e) { if (e && e.cancelled) throw e; s.error = errText(e); }
      });
    }
    // The pharmacy's address and phone, as Bookings › Messages keeps them (the pharmacist in charge may read them; staff get blank lines).
    var place = { address: "", phone: "" };
    if (opts.place !== false && (!user().role || user().role === "admin")) {
      step("The pharmacy's details");
      try { var st = await get("/bookings/settings"); place = { address: (st.settings && st.settings.address) || "", phone: (st.settings && st.settings.phone) || "" }; } catch (e) { if (e && e.cancelled) throw e; }
    }
    var pack = { range: rg, at: new Date(), check: check, months: months, got: got, err: err, takes: takes, place: place, calls: job.calls, paths: job.paths };
    pack.contents = contents(pack);
    pack.html = html(pack);
    return pack;
  }
  function maltaDayOf(v) {
    var s = String(v == null ? "" : v).trim();
    if (!/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return isYmd(s.slice(0, 10)) ? s.slice(0, 10) : "";
    var ms = Date.parse(s.replace(" ", "T") + (/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
    return isNaN(ms) ? s.slice(0, 10) : (E.maltaYmd ? E.maltaYmd(new Date(ms)) : s.slice(0, 10));
  }
  function stepText(path) {
    var m = /month=(\d{4}-\d{2})/.exec(path || ""), w = { "/temperature": "Temperature", "/cleaning": "Cleaning", "/daily-register": "Daily register", "/locumregister": "Locum register", "/certificates": "Certificates", "/dda": "Controlled drugs" }, k = "";
    Object.keys(w).forEach(function (p) { if (!k && String(path).indexOf(p) === 0) k = w[p]; });
    return "Checking " + (k || "the registers") + (m ? ", " + monthName(m[1]) : "");
  }

  // ── Contents: one line per register. mark: ok (✓), gap (something missing), look (needs a look), unread (not read).
  function contents(pack) {
    var byCheck = {}; (pack.check.list || []).forEach(function (r) { byCheck[r.id] = r; });
    return REGS.map(function (R, i) {
      var c = R.check ? byCheck[R.check] : null, lines = 0, mark = "ok", found = [];
      if (R.path && !pack.err[R.id]) Object.keys(pack.got[R.id] || {}).forEach(function (ym) { lines += (pack.got[R.id][ym] || []).filter(function (e) { return R.id === "cleaning" || R.id === "temperature" ? true : inRange(e.entry_date, pack.range); }).length; });
      if (pack.err[R.id] && R.id !== "stocktakes") { mark = "unread"; found.push({ level: "look", text: "Not read: " + pack.err[R.id] + ". Make the pack again." }); }
      else if (c) {
        mark = c.status === "missing" ? "gap" : c.status === "look" ? "look" : c.status === "nofile" ? "nofile" : c.status === "unread" ? "unread" : "ok";
        found = c.reasons.slice();
      } else if (R.path && !builder(R.doc)) { mark = "elsewhere"; found.push({ level: "info", text: "Print it from its own screen (" + R.title + " › Print), month by month, and put it here." }); }
      else if (R.path) found.push({ level: "info", text: lines ? plural(lines, "line", "lines") + " in these days." : "Nothing recorded in these days." });
      if (R.takes) {
        var bad = pack.takes.filter(function (s) { return s.error; });
        if (bad.length && mark === "ok") mark = "look";
        bad.forEach(function (s) { found.push({ level: "look", text: "The stock take of " + dmy(s.day) + " could not be printed (" + s.error + ")." }); });
        if (pack.takes.more) found.push({ level: "info", text: "Only the first " + MAX_TAKES + " stock takes are printed; " + pack.takes.more + " more are in the Stock takes screen." });
      }
      return { n: i + 1, id: R.id, title: R.title, mark: mark, reasons: found };
    });
  }
  // The same words as the Inspection check's screen (In order, Missing, Look at this, Not on file, Not checked).
  var MARK = { ok: "✓ In order", gap: "Missing", look: "Look at this", nofile: "Not on file", unread: "Not checked", elsewhere: "From its screen" };
  var MARK_LONG = { ok: "In order", gap: "Missing", look: "Look at this", nofile: "Not on file", unread: "Not checked", elsewhere: "print it from its screen" };

  // ── The pack's HTML: one document, the registers' printouts inside it.
  function baseCss() { // the printouts' own look (E.months.printHtml), without its page rule: the pack sets its own pages
    var h = E.months.printHtml({ register: "x", sections: [] }), a = h.indexOf("<style>"), b = h.indexOf("</style>");
    return h.slice(a + 7, b).replace(/^@page\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/, "");
  }
  function html(pack) {
    var u = user(), loc = u.location_name || "", org = u.org_name || "", rt = (E.inspect.niceRange || E.inspect.rangeText)(pack.range), p = pack.at;
    var stamp = (E.maltaYmd ? dmy(E.maltaYmd(p)) : dmy(ymdLocal(p))) + " " + (E.maltaHm ? E.maltaHm(p) : pad(p.getHours()) + ":" + pad(p.getMinutes()));
    var foot = (loc ? loc + " · " : "") + "Inspection pack · " + rt;
    var fq = foot.replace(/["\\]/g, "'");
    var margin = "@bottom-left{content:\"" + fq + "\";font:9px system-ui,sans-serif;color:#000}@bottom-right{content:\"Page \" counter(page) \" of \" counter(pages);font:9px system-ui,sans-serif;color:#000}";
    var css = "@page{size:A4 portrait;margin:12mm 10mm 14mm;" + margin + "}@page land{size:A4 landscape;margin:12mm 10mm 14mm;" + margin + "}" + baseCss() +
      ".pk-pg{break-before:page;page-break-before:always}.pk-l{page:land}.pk-cover{min-height:240mm;display:flex;flex-direction:column}" +
      ".pk-k{font-size:14px;font-weight:700;margin:24px 0 6px}.pk-t{font-size:30px;font-weight:800;margin:0 0 4px;line-height:1.15}.pk-org{font-size:14px;margin:0 0 18px}" +
      ".pk-dl{display:grid;grid-template-columns:190px 1fr;gap:8px 16px;margin:10px 0 18px;font-size:13px}.pk-dl dt{font-weight:700}.pk-dl dd{margin:0;min-height:18px}.pk-blank{display:inline-block;min-width:260px;border-bottom:1px solid #000;height:16px}" +
      ".pk-head{border:2px solid #000;padding:10px 12px;font-size:14px;font-weight:700;margin:14px 0}.pk-head small{display:block;font-weight:400;font-size:11px;margin-top:2px}" +
      ".pk-h{font-size:20px;font-weight:800;margin:0 0 8px}.pk-key{font-size:11px;margin:8px 0 0}td.pk-m{font-weight:700;white-space:nowrap}td.pk-m.ok{font-weight:400}" +
      ".pk-gaps{border:1.5px solid #000;padding:8px 12px;margin:0 0 12px;break-inside:avoid}.pk-gaps h2{margin:0 0 4px;font-size:15px}.pk-gaps p{margin:0 0 4px;font-size:11px}.pk-gaps ul{margin:4px 0 0;padding-left:18px}.pk-gaps li{font-size:11.5px;margin:2px 0}.pk-gaps li.missing,.pk-gaps li.look{font-weight:700}" +
      ".pk-sec{font-size:11px;margin:0 0 6px}.pk-mo+.pk-mo{break-before:page;page-break-before:always}.pk-take+.pk-take{break-before:page;page-break-before:always}.pk-take .meta{font-size:11px;margin:0 0 10px}.pk-take h1{font-size:17px;margin:0 0 4px}" +
      ".pk-sign .sign{margin-top:34px}.pk-lines span{display:block;border-bottom:1px solid #000;height:28px}" +
      "@media screen{body{max-width:1100px;margin:18px auto;padding:0 16px}.pk-pg{border-top:1px dashed #999;margin-top:28px;padding-top:18px}}";
    var out = "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc("Inspection pack · " + (loc ? loc + " · " : "") + rt) + "</title><style>" + css + "</style></head><body>";
    out += cover(pack, loc, org, rt, stamp);
    out += contentsPage(pack, rt);
    var total = pack.contents.length + 1;
    REGS.forEach(function (R, i) { out += regSection(pack, R, pack.contents[i], i + 1, total); });
    out += signPage(pack, rt, total);
    out += "</body></html>"; // no script (CSP): E.printTab prints it from the app
    return out;
  }
  function blank() { return '<span class="pk-blank"></span>'; }
  function pharmacists(pack) { // who was in charge in these days, from the locum register
    var by = {}, list = [];
    Object.keys(pack.got.locum || {}).forEach(function (ym) { (pack.got.locum[ym] || []).forEach(function (e) {
      if (!inRange(e.entry_date, pack.range)) return;
      var name = String(e.locum_full_name || "").trim(); if (!name) return;
      var k = name.toLowerCase() + "|" + String(e.registration_number || "").trim().toLowerCase();
      if (!by[k]) { by[k] = { name: name, reg: String(e.registration_number || "").trim(), days: {}, first: e.entry_date, last: e.entry_date }; list.push(by[k]); }
      var o = by[k]; o.days[e.entry_date] = 1; if (e.entry_date < o.first) o.first = e.entry_date; if (e.entry_date > o.last) o.last = e.entry_date;
    }); });
    return list.sort(function (a, b) { return Object.keys(b.days).length - Object.keys(a.days).length || (a.last < b.last ? 1 : -1); });
  }
  function cover(pack, loc, org, rt, stamp) {
    var u = user(), ph = pharmacists(pack);
    var h = '<section class="pk-cover"><p class="pk-k">Inspection pack</p><h1 class="pk-t">' + esc(loc || org || "Pharmacy") + "</h1>" + (org && loc && org !== loc ? '<p class="pk-org">' + esc(org) + "</p>" : '<p class="pk-org"></p>') +
      '<dl class="pk-dl"><dt>Address</dt><dd>' + (pack.place.address ? esc(pack.place.address) : blank()) + "</dd><dt>Phone</dt><dd>" + (pack.place.phone ? esc(pack.place.phone) : blank()) + "</dd>" +
      "<dt>Days covered</dt><dd>" + esc(rt) + "</dd>" +
      "<dt>Responsible pharmacist</dt><dd>" + blank() + "</dd><dt>Registration no</dt><dd>" + blank() + "</dd>" +
      "<dt>Prepared</dt><dd>" + esc(stamp + " (Malta time)" + (u.full_name ? " by " + u.full_name : "")) + "</dd></dl>";
    h += '<p class="pk-head">' + esc(pack.check.head.text) + "<small>" + esc("From the Inspection check of " + rt + ". The contents page lists every register; each register's gaps are listed before its pages.") + "</small></p>";
    h += "<h2>Pharmacists in charge in these days (from the locum register)</h2><table><thead><tr><th>Name and surname</th><th>Registration no</th><th class='n'>Days</th><th>First</th><th>Last</th></tr></thead><tbody>" +
      (ph.length ? ph.map(function (o) { return "<tr><td>" + esc(o.name) + "</td><td>" + esc(o.reg) + "</td><td class='n'>" + Object.keys(o.days).length + "</td><td>" + dmy(o.first) + "</td><td>" + dmy(o.last) + "</td></tr>"; }).join("")
        : "<tr><td colspan='5' class='none'>" + esc(pack.err.locum ? "The locum register could not be read (" + pack.err.locum + ")." : "No pharmacist is recorded in the locum register in these days.") + "</td></tr>") + "</tbody></table></section>";
    return h;
  }
  function contentsPage(pack, rt) {
    var total = pack.contents.length + 1;
    return '<section class="pk-pg"><h2 class="pk-h">Contents</h2><p class="pk-sec">' + esc(rt) + ". Registers that are kept by the month print whole months, as their screens do; the check covers only the days above.</p>" +
      "<table><thead><tr><th class='n'>Section</th><th>Register</th><th>Status</th><th>What the check found</th></tr></thead><tbody>" +
      pack.contents.map(function (c) {
        return "<tr><td class='n'>" + c.n + "</td><td>" + esc(c.title) + "</td><td class='pk-m " + c.mark + "'>" + esc(MARK[c.mark]) + "</td><td>" + c.reasons.filter(function (x) { return x.level !== "info" || c.mark === "ok" || c.mark === "elsewhere"; }).slice(0, 4).map(function (x) { return esc(x.text); }).join("<br>") + "</td></tr>";
      }).join("") + "<tr><td class='n'>" + total + "</td><td>Sign-off</td><td></td><td>Pharmacist in charge and inspector</td></tr></tbody></table>" +
      '<p class="pk-key">Missing: something the register should have is not there. Look at this: worth a look before the inspector does. Not on file: nothing recorded yet. Not checked: the register could not be read when the pack was made. Every gap is listed in full at the start of its register.</p></section>';
  }
  function regSection(pack, R, c, n, total) {
    var land = false, parts = [];
    if (pack.err[R.id] && !R.takes) parts.push("<p class='none'>" + esc("Not printed: " + pack.err[R.id] + ".") + "</p>");
    else if (R.takes) {
      if (!pack.takes.length) parts.push("<p class='none'>" + esc(pack.err.stocktakes ? "Not printed: " + pack.err.stocktakes + "." : "No stock take was taken for these months.") + "</p>");
      pack.takes.forEach(function (s) { parts.push('<div class="pk-take">' + (s.error ? "<p class='none'>" + esc("The stock take of " + dmy(s.day) + " could not be printed: " + s.error + ".") + "</p>" : s.html) + "</div>"); });
    } else if (R.path && !builder(R.doc)) {
      parts.push("<p class='none'>" + esc("Not in this pack: print " + R.title + " from its own screen (" + R.title + " › Print), one page per month of these days, and put the pages here.") + "</p>");
    } else if (R.once) {
      var d0 = docFor(R.doc, "", pack.check.data && pack.check.data.certs || []); land = !!d0.landscape;
      parts.push('<div class="pk-mo">' + bodyOf(E.months.printHtml(d0)) + "</div>");
    } else {
      pack.months.forEach(function (ym) {
        var d = docFor(R.doc, ym, (pack.got[R.id] || {})[ym] || [], pack.check.data && pack.check.data.devices || []);
        land = land || !!d.landscape;
        parts.push('<div class="pk-mo">' + bodyOf(E.months.printHtml(d)) + "</div>");
      });
    }
    var shown = c.reasons.filter(function (x) { return x.level !== "ok"; });
    var gaps = '<div class="pk-gaps"><h2>' + esc(n + ". " + R.title + ": " + MARK_LONG[c.mark]) + '</h2><p>Section ' + n + " of " + total + "</p>" +
      (shown.length ? "<ul>" + shown.map(function (x) { return '<li class="' + esc(x.level) + '">' + esc(x.all || x.text) + "</li>"; }).join("") + "</ul>" : "<p>No gaps in these days.</p>") +
      (c.mark === "ok" && c.reasons[0] && c.reasons[0].level === "ok" ? "<p>" + esc(c.reasons[0].text) + "</p>" : "") + "</div>";
    return '<section class="pk-pg' + (land ? " pk-l" : "") + '" id="pk-' + R.id + '">' + gaps + parts.join("") + "</section>";
  }
  function signPage(pack, rt, n) {
    var line = function (labels) { return '<div class="sign">' + labels.map(function (l) { return "<div><span></span><small>" + esc(l) + "</small></div>"; }).join("") + "</div>"; };
    return '<section class="pk-pg pk-sign" id="pk-sign"><h2 class="pk-h">' + n + ". Sign-off</h2><p>" + esc("This pack covers " + rt + ". It was made from the registers kept in Eikon; each register's gaps are listed before its pages.") + "</p>" +
      "<h2>Pharmacist in charge</h2>" + line(["Name and surname", "Registration no", "Signature", "Date"]) +
      "<h2>Inspector</h2>" + line(["Name and surname", "Signature", "Date"]) +
      '<h2>Notes</h2><div class="pk-lines"><span></span><span></span><span></span><span></span><span></span></div></section>';
  }

  // ── Opening it. Call open() straight from the tap: the tab opens at once (a pop-up blocker allows it) showing that the
  // pack is being made, then the pack is written into it and printed. Returns { cancel(), done: Promise<pack> }.
  var WAIT = "<!doctype html><html lang='en'><head><meta charset='utf-8'><title>Making the inspection pack</title><style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;display:grid;place-items:center;min-height:90vh;color:#000;background:#fff}p{font-size:18px}</style></head><body><p>Making the inspection pack… keep this tab open.</p></body></html>";
  function open(rg, opts) {
    opts = opts || {};
    var w = null, cancelled = false;
    try { w = window.open("", "_blank"); } catch (e) { w = null; }
    if (w) { try { w.document.open(); w.document.write(WAIT); w.document.close(); } catch (e) {} }
    var fetch = function (p) { if (cancelled) return Promise.reject({ cancelled: true }); return (opts.fetch || function (q) { return E.apiFetch(q, { method: "GET" }); })(p); };
    var done = build(rg, { fetch: fetch, step: opts.step }).then(function (pack) {
      if (cancelled) throw { cancelled: true };
      api.last = pack;
      var tab = null;
      if (w && !isClosed(w)) { try { w.document.open(); w.document.write(pack.html); w.document.close(); tab = E.printTab(w, { delay: 150, focus: true }); } catch (e) { tab = null; } }
      if (!tab) { // the tab was refused or closed: a blob tab (or the link), as every register's print does
        var url = URL.createObjectURL(new Blob([pack.html], { type: "text/html" }));
        tab = E.openPrintUrlOrLink ? E.openPrintUrlOrLink(url, { delay: 150, focus: true }) : null;
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
      }
      pack.tab = tab;
      return pack;
    }, function (e) { if (w && !isClosed(w)) { try { w.close(); } catch (x) {} } throw e; });
    return { done: done, cancel: function () { cancelled = true; if (w && !isClosed(w)) { try { w.close(); } catch (x) {} } } };
  }
  function isClosed(w) { try { return !!w.closed; } catch (e) { return true; } }
  // About how many requests a pack makes (the check's, plus four registers a month, plus stock takes and the details).
  function estimate(rg) { var m = monthsIn(rg.from, rg.to).length; return 3 + 4 * m + 4 * m + m + 1; }

  var api = { build: build, open: open, estimate: estimate, contents: contents, html: html, bodyOf: bodyOf, takeBody: takeBody, docFor: docFor, DOCS: DOCS, REGS: REGS,
    lastInspection: lastInspection, lastInspectionBy: lastInspectionBy, loadLast: loadLast, setLastInspection: setLastInspection, last: null };
  E.inspack = api;
})();
