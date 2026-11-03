/* ============================================================
   EIKON — Search that acts  (eikon.search.js), new layout only
   One engine for Today's search box and for the search dialog that "/" or Ctrl/Cmd+K opens on any new-layout screen.
   - Results in groups: Screens (titles plus the synonyms below), People (GET /people through E.personPick.find),
     Orders still open (the endpoint the Orders screen reads) and today's Bookings (the endpoint Bookings reads).
   - Reads only, scoped by the server to the signed-in pharmacy. No new endpoints. Answers are cached per sign-in for
     45 s and dropped after any save. People are asked at most once per pause in typing; orders and bookings once per
     45 s, then filtered here.
   - Arrow keys move, Enter opens the highlighted result (or the first), Escape closes and gives focus back.
   - Scanning: a USB scanner types like a keyboard, very fast, then Enter. A burst of keys each under 30 ms apart,
     ending in Enter and matching a Maltese ID card (1 to 7 digits and a letter) or an order code (6 characters, the
     ones the order slips print), opens that person or that order. Only on Today (nothing being typed into a form)
     or in the dialog. Ordinary typing, however quick, has gaps over 30 ms and is never taken for a scan.
   - The camera (where the device has one) reads the same codes: the browser's own BarcodeDetector, or ZXing loaded
     on demand from the same pinned address the Emergency POS uses. Nothing is loaded until the camera is asked for.
   - The classic layout is untouched: nothing here runs unless html[data-ui2] is set (and not on a classic visit).
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // ---- Open a screen with its form open: Customers' hand-over (modules.customers.js), mode "new" ----
  // One note for the whole app: sessionStorage "eikon_cus_hand" = { to, mode: "new" | "find", person, back, at }, written
  // by E.customerHandoff (a customer's page, and the search below) and taken once by the screen (E.takeCustomerHandoff).
  // Orders, Questions and Deliveries read it themselves (they also take "find", and Cancel goes back to the person).
  // Every other rebuilt screen reads it with one line in its render:
  //   return E.takeOpenForm("poreg", S.mount, load(), { btn: "[data-act=add]", form: "#por-add", fill: { name: "client_name", ... } });
  // (a screen that has already taken the note passes it as the fifth argument). When its first load is in, the
  // screen's own main button is pressed (the same path as a tap: nothing is saved), the person goes into the fields
  // that are still empty (E.fillEmpty: nothing typed is overwritten), and focus goes to the first empty field (or to
  // o.focus, for a screen whose form is always there). Returns `ready`, so the render still returns its load.
  E.takeOpenForm = function (screen, mount, ready, o, hand) {
    var h = hand !== undefined ? hand : (E.takeCustomerHandoff ? E.takeCustomerHandoff(screen) : null);
    if (!h || h.mode !== "new" || !mount) return ready;
    o = o || {};
    var here = function () { return document.body.contains(mount) && (!E.state || E.state.activeModuleId === screen); };
    var vis = function (el) { return !!el && !el.disabled && el.type !== "hidden" && (el.offsetParent !== null || el.getClientRects().length > 0); };
    var put = function (el) { if (!el) return; try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } if (el.scrollIntoView) try { el.scrollIntoView({ block: "center" }); } catch (e) {} };
    var later = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var waitFor = async function (fn, ms) { var t = Date.now(); while (Date.now() - t < ms) { if (!here()) return null; var x = fn(); if (x) return x; await later(40); } return null; };
    var run = async function () {
      if (!here()) return;
      if (o.btn) { // the form may be open already (then it is filled, never reopened)
        var b = await waitFor(function () { var x = (o.form && mount.querySelector(o.form)) || mount.querySelector(o.btn); return x && !x.disabled ? x : null; }, 4000);
        if (!b) return; if (!(o.form && b.matches(o.form))) b.click();
      }
      var f = o.form ? await waitFor(function () { return mount.querySelector(o.form); }, 3000) : null;
      await later(40); // after the screen's own "focus the first field" (30 ms), so ours is the last word
      if (!here()) return;
      if (f && f.isConnected === false) f = o.form ? mount.querySelector(o.form) : null;
      var p = h.person || {}, map = {};
      if (f && o.fill) Object.keys(o.fill).forEach(function (k) { if (p[k] != null && String(p[k]).trim()) map[o.fill[k]] = String(p[k]).trim(); });
      if (f && E.fillEmpty) E.fillEmpty(f, map);
      var target = null;
      if (o.focus) target = await waitFor(function () { var x = mount.querySelector(o.focus); return vis(x) ? x : null; }, 3000);
      if (!target && f) {
        var all = Array.prototype.filter.call(f.querySelectorAll("input,select,textarea"), function (x) { return vis(x) && !x.readOnly && !/^(checkbox|radio|button|submit)$/.test(x.type); });
        target = all.filter(function (x) { return !String(x.value || "").trim(); })[0] || all[0] || null;
      }
      if (!target) return;
      put(target);
      // A late redraw (a second list arriving) can replace the form: put focus back on the same field, once, within 1.5 s.
      var name = target.getAttribute("name"), sel = o.focus && target.matches(o.focus) ? o.focus : null, until = Date.now() + 1500;
      (function guard() {
        if (Date.now() > until || !here()) return;
        if (document.activeElement === document.body || !document.activeElement) {
          var again = sel ? mount.querySelector(sel) : (name && f ? (mount.querySelector(o.form) || f).querySelector('[name="' + name + '"]') : null);
          if (vis(again)) { put(again); return; }
        }
        setTimeout(guard, 100);
      })();
    };
    return Promise.resolve(ready).then(function (v) { run().catch(function () {}); return v; }, function (e) { run().catch(function () {}); throw e; });
  };

  // ---- Synonyms: the words people use for a screen. One list, keyed by the card id (old id) or the tab id. ----
  var SYN = {
    today: ["home", "start", "dashboard"],
    customers: ["customer", "patient", "people", "person", "client"],
    bookings: ["booking", "appointment", "clinic", "diary", "calendar"],
    stock: ["stock", "inventory"],
    registers: ["registers", "books", "inspector", "inspection"],
    services: ["services", "clinical"],
    money: ["money", "till", "cash"],
    team: ["team", "staff"],
    settings: ["settings", "password", "sign out", "logout", "classic layout"],
    temperature: ["fridge", "temp", "temperature", "thermometer", "cold chain"],
    cleaning: ["cleaning", "clean", "hygiene"],
    dailyregister: ["daily register", "POM", "prescription only", "day book"],
    locumregister: ["locum register", "pharmacist in charge", "PIC"],
    "dda-purchases": ["DDA", "CD", "controlled", "controlled drugs", "CD purchases", "DDA purchases", "CD received"],
    "dda-sales": ["DDA", "CD", "controlled", "controlled drugs", "CD sales", "DDA sales", "morphine", "methadone"],
    "dda-poyc": ["DDA", "CD", "controlled", "POYC", "CD POYC"],
    dda_stocktakes: ["DDA", "CD", "controlled", "CD count", "stock-take", "stocktake"],
    repeatprescriptions: ["Rx", "repeat", "repeats", "prescription", "script"],
    endofday: ["till", "cash", "end of day", "close the day", "takings", "Z reading", "X reading", "bank bag", "EOD"],
    paidout: ["paid out", "petty cash", "courier", "cash out"],
    "emergency-pos": ["till", "till down", "POS", "sell", "sale", "emergency"],
    creditnotes: ["credit note", "credit", "voucher", "refund"],
    locumreceipts: ["locum pay", "locum receipt", "locum fees"],
    poct: ["POCT", "blood pressure", "BP", "glucose", "cholesterol", "test", "INR"],
    vaccines: ["vaccine", "vaccination", "jab", "flu", "travel"],
    screening: ["screening", "health check"],
    pharmacovigilance: ["adverse reaction", "ADR", "side effect", "yellow card", "pharmacovigilance"],
    ocps: ["pill", "contraceptive", "OCP", "COC"],
    pharmacycalc: ["calculator", "warfarin", "levothyroxine", "steroid taper", "insulin", "methotrexate", "dose"],
    otcmindmap: ["OTC", "symptom", "recommend", "over the counter"],
    labels: ["label", "labels", "print label"],
    alerts: ["recall", "quarantine", "alert", "drug alert"],
    nearexpiry: ["expiry", "expire", "expiring", "short dated", "short expiry"],
    ssreg: ["shortage", "shortages", "out of stock", "looking for"],
    scarcestock: ["scarce", "hard to get", "spare"],
    "order-diary": ["order diary", "supplier order", "to order", "wholesaler order"],
    "supplier-inventory": ["supplier stock", "wholesaler", "supplier"],
    quotations: ["quotation", "quote", "price check", "margin", "price"],
    returns: ["return", "returns", "send back"],
    stocktransfers: ["transfer", "transfers", "move stock"],
    rotreg: ["who's in", "who is in", "rota", "this week"],
    shifts: ["shift", "shifts", "leave", "holiday", "plan rota"],
    instructions: ["handover", "instructions", "notes for the next shift"],
    messageboard: ["messages", "chat", "board", "message"],
    contacts: ["contacts", "phone numbers", "doctor", "rep", "head office"],
    certificates: ["certificate", "licence", "license", "calibration"],
    audit: ["audit", "who changed", "history of changes"],
    clientorders: ["order", "orders", "ordered in"],
    tickets: ["question", "questions", "ticket", "query"],
    deliveries: ["delivery", "deliveries", "home delivery"],
    appointments: ["appointments (classic)"],
    loyalty: ["loyalty", "points", "card"]
  };
  E.SEARCH_SYNONYMS = SYN;

  var TTL = 45000, WAIT = 250, GAP = 30, MIN = 4, PER = 5; // a scan: at least MIN keys, each under GAP ms after the last, then Enter
  var ID_RE = /^\d{1,7}[A-Za-z]$/, CODE_RE = /^[A-HJ-NP-Za-hj-np-z2-9]{6}$/; // order codes: no 0/O/1/I (modules.clientorders.js)

  function str(v) { return v == null ? "" : String(v); }
  function low(v) { return str(v).toLowerCase(); }
  function esc(s) { return E.escapeHtml ? E.escapeHtml(str(s)) : str(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addMonths(k) { var d = new Date(); d = new Date(d.getFullYear(), d.getMonth() + k, 1); return d; }
  function on() { var h = document.documentElement; return h.hasAttribute("data-ui2") && !h.hasAttribute("data-ui2-visit") && !!(E.state && E.state.user) && E.isUi2 && E.isUi2(); }
  function editable(el) { return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); }
  function user() { return (E.state && E.state.user) || {}; }
  function scope() { var u = user(); return [u.org_id, u.location_id, u.id || u.user_id].join(":"); }

  // ---- answers kept per sign-in, dropped after any save ----
  var cache = {}, cacheScope = "";
  function cached(k, fn) {
    var sc = scope(); if (sc !== cacheScope) { cache = {}; cacheScope = sc; }
    var c = cache[k], now = Date.now();
    if (c && now - c.at < TTL && !(E.lastWriteAt && E.lastWriteAt > c.at)) return c.p;
    var p = Promise.resolve().then(fn).catch(function () { delete cache[k]; return null; });
    cache[k] = { at: now, p: p }; return p;
  }
  E.searchCacheClear = function () { cache = {}; };

  // ---- Screens: the rail tabs, Bookings, and every hub card (E.ui2Screens, modules.hubs.js) ----
  function screenList() {
    var out = [], seen = {};
    var tabs = [].concat(E.UI2_RAIL || [], E.UI2_RAIL_FOOT || []);
    if (E.modules.bookings && !tabs.some(function (t) { return t.id === "bookings"; })) tabs.splice(2, 0, { id: "bookings", title: "Bookings" });
    tabs.forEach(function (t) {
      if (!E.modules[t.id] || seen[t.id]) return; seen[t.id] = 1;
      out.push({ key: t.id, title: t.title, desc: t.id === "bookings" ? "Today's bookings and the waiting list." : "", hub: "Tab", go: "#" + t.id });
    });
    ((E.ui2Screens && E.ui2Screens()) || []).forEach(function (s) { if (!seen[s.key]) { seen[s.key] = 1; out.push(s); } });
    // The Customers screen's own strip: rebuilt ones open here; what is only in the classic look (Loyalty, and Appointments
    // until Bookings is set up, when Bookings above answers "appointment") says so, and comes back to Customers.
    var bkReady = !!(E.bookingsReady && E.bookingsReady());
    [["clientorders", "Orders", "Items ordered in for a customer."], ["tickets", "Questions", "Questions customers are waiting on."], ["deliveries", "Deliveries", "Home deliveries, routes and proof of delivery."],
     ["appointments", "Appointments (classic look)", "Clinic appointments and the waiting list, until Bookings is set up."], ["loyalty", "Loyalty (classic look)", "Loyalty cards, points and campaigns."]].forEach(function (x) {
      if (seen[x[0]] || (x[0] === "appointments" && bkReady)) return; var nat = (E.UI2_NATIVE || {})[x[0]];
      if (nat) { seen[x[0]] = 1; out.push({ key: x[0], title: (E.modules[nat] && E.modules[nat].title) || x[1], desc: x[2], hub: "Customers", go: "#" + nat }); }
      else if (E.modules[x[0]] && E.openClassic) { seen[x[0]] = 1; out.push({ key: x[0], title: x[1], old: E.modules[x[0]].title || "", desc: x[2], hub: "Customers", open: function () { try { sessionStorage.setItem("eikon_ui2_return", "customers"); } catch (e) {} E.openClassic(x[0]); } }); }
    });
    return out;
  }
  function wordStart(hay, q) { hay = low(hay); var i = hay.indexOf(q); while (i >= 0) { if (i === 0 || /[^a-z0-9]/.test(hay.charAt(i - 1))) return true; i = hay.indexOf(q, i + 1); } return false; }
  function screenScore(s, q) {
    var t = low(s.title), syn = (SYN[s.key] || []).map(low), best = 99;
    if (t === q || syn.indexOf(q) >= 0) best = 0;
    else if (t.indexOf(q) === 0) best = 1;
    else if (syn.some(function (w) { return w.indexOf(q) === 0; })) best = 2;
    else if (wordStart(t, q) || wordStart(s.old, q) || syn.some(function (w) { return wordStart(w, q); })) best = 3;
    else if (q.length >= 3 && (t.indexOf(q) >= 0 || low(s.old).indexOf(q) >= 0)) best = 4;
    else if (q.length >= 4 && low(s.desc).indexOf(q) >= 0) best = 5;
    return best;
  }
  function screens(q) {
    q = low(q).trim().replace(/\s+/g, " "); if (!q) return [];
    return screenList().map(function (s, i) { return { s: s, sc: screenScore(s, q), i: i }; })
      .filter(function (x) { return x.sc < 99; }).sort(function (a, b) { return a.sc - b.sc || a.i - b.i; })
      .slice(0, PER).map(function (x) { return x.s; });
  }

  // ---- Doing things: a verb names a form ("new order", "record dda", "log fridge", "deliver"), and so does a person
  // with a noun ("grech order", "0456789M dda"). Enter opens that screen with its form open (E.takeOpenForm above).
  // A query with no verb and no person is searched exactly as before.
  // id: the rebuilt screen; key: its card (an admin-only card is not offered to staff); label: the screen's own button;
  // words: what people call it; verbs: verbs that name it on their own; fill: it takes a person; note: when it is not a
  // form that opens (End of day, a stock take: the screen opens at its first figure or its button).
  var VERBS = ["new", "add", "record", "log", "enter", "make", "start", "create", "write", "close", "ask", "deliver", "supply", "count", "receive"];
  var FILLER = ["for", "a", "an", "the", "of", "to", "with", "from"];
  var DDA = ["dda", "cd", "cds", "controlled", "controlled drug", "controlled drugs"];
  var ACTS = [
    { id: "ordreg", key: "clientorders", label: "New order", fill: true, words: ["order", "orders", "customer order", "client order", "special order"] },
    { id: "tktreg", key: "tickets", label: "New question", fill: true, verbs: ["ask"], words: ["question", "questions", "query", "ticket"] },
    { id: "dlvreg", key: "deliveries", label: "New delivery", fill: true, verbs: ["deliver"], words: ["delivery", "deliveries", "home delivery"] },
    { id: "cdsreg", key: "dda-sales", label: "New prescription", fill: true, verbs: ["supply"], words: DDA.concat(["dda sale", "dda sales", "cd sale", "cd sales", "sale", "morphine", "methadone", "fentanyl", "oxycodone", "pethidine"]) },
    { id: "poyreg", key: "dda-poyc", label: "New prescription", fill: true, words: ["poyc", "dda poyc", "cd poyc"] },
    { id: "cdpreg", key: "dda-purchases", label: "New invoice", verbs: ["receive"], words: DDA.concat(["dda purchase", "dda purchases", "cd purchase", "cd purchases", "dda received", "cd received", "dda delivery", "cd delivery", "dda invoice", "cd invoice", "invoice", "purchase", "purchases"]) },
    { id: "ddstreg", key: "dda_stocktakes", label: "Start a stock take", note: "the button is ready", verbs: ["count"], words: ["stock take", "stocktake", "stock-take", "dda count", "cd count"] },
    { id: "repreg", key: "repeatprescriptions", label: "New prescription", fill: true, words: ["repeat", "repeats", "repeat prescription", "repeat prescriptions", "rx", "prescription", "script"] },
    { id: "drreg", key: "dailyregister", label: "New entry", fill: true, words: ["daily register", "pom", "prescription only", "day book"] },
    { id: "today", key: "temperature", label: "Log today’s readings", note: "the first reading", words: ["fridge", "fridges", "temperature", "temperatures", "temp", "temps", "reading", "readings", "thermometer", "cold chain", "room"] },
    { id: "cleanreg", key: "cleaning", label: "New cleaning", words: ["cleaning", "clean", "hygiene"] },
    { id: "eodreg", key: "endofday", label: "Close the day", note: "the first figure", verbs: ["close"], words: ["end of day", "eod", "the day", "day", "till", "takings", "z reading", "x reading", "cash up", "bank bag"] },
    { id: "poreg", key: "paidout", label: "New payment", words: ["paid out", "petty cash", "payment", "courier", "cash out"] },
    { id: "cnreg", key: "creditnotes", label: "New credit note", words: ["credit note", "credit notes", "credit", "voucher", "refund"] },
    { id: "pocreg", key: "poct", label: "New test", fill: true, words: ["test", "tests", "bp", "blood pressure", "glucose", "cholesterol", "poct", "inr"] },
    { id: "odreg", key: "order-diary", label: "Add an item", words: ["order diary", "supplier order", "wholesaler order", "to order"] },
    { id: "qtreg", key: "quotations", label: "New quote", words: ["quote", "quotes", "quotation", "price check"] },
    { id: "alertreg", key: "alerts", label: "New alert", words: ["alert", "alerts", "recall", "quarantine", "drug alert"] },
    { id: "nexreg", key: "nearexpiry", label: "Add an item", words: ["expiry", "near expiry", "short dated", "short expiry", "expiring"] },
    { id: "pvreg", key: "pharmacovigilance", label: "New report", words: ["reaction", "adverse reaction", "adr", "side effect", "yellow card"] },
    { id: "lrcreg", key: "locumreceipts", label: "New receipt", words: ["locum receipt", "locum receipts", "locum pay", "receipt"] },
    { id: "locreg", key: "locumregister", label: "New locum", words: ["locum", "locum register", "pharmacist in charge", "pic"] },
    { id: "conreg", key: "contacts", label: "Add a contact", words: ["contact", "contacts", "phone number"] }
  ];
  E.SEARCH_ACTIONS = ACTS;
  function actOk(a) {
    if (!E.modules[a.id]) return false;
    var card = E.modules[a.key], u = user();
    return !(card && card.adminOnly && u.role && u.role !== "admin");
  }
  function actScreen(a) { return a.id === "today" ? "Today" : ((E.modules[a.id] && E.modules[a.id].title) || ""); }
  // Which phrase of `words` sits in the tokens (the last token may still be being typed: a start of 2+ letters will do).
  function phraseAt(tk, i, ph, part) {
    var w = ph.split(" ");
    if (i + w.length > tk.length) return false;
    for (var j = 0; j < w.length; j++) {
      var t = tk[i + j], last = i + j === tk.length - 1 && j === w.length - 1;
      if (t !== w[j] && !(part && last && t.length >= 2 && w[j].indexOf(t) === 0)) return false;
    }
    return true;
  }
  function personish(s) { s = str(s).trim(); if (!s) return false; var d = s.replace(/\D/g, ""); if (ID_RE.test(s.replace(/\s+/g, ""))) return true; if (/\d/.test(s)) return d.length >= 6 && /^[\d\s+]+$/.test(s); return s.replace(/[^A-Za-zÀ-ɏ]/g, "").length >= 2; }
  // { acts: the best forms, verb: a verb was typed, who: what is left (a person) } — or null.
  function doing(q) {
    var raw = str(q).trim().split(/\s+/).filter(Boolean), tk = raw.map(function (x) { return low(x).replace(/[.,;:!?]+$/, ""); });
    if (!tk.length) return null;
    var used = {}, verb = false, scored = [];
    tk.forEach(function (t, i) { if (VERBS.indexOf(t) >= 0) { used[i] = 1; verb = true; } });
    var part = verb; // a word still being typed ("new ord") counts only after a verb: "abela te" is a name being typed
    ACTS.forEach(function (a, ai) {
      if (!actOk(a)) return;
      var mine = {}, sc = 0;
      (a.verbs || []).forEach(function (v) { tk.forEach(function (t, i) { if (t === v) { mine[i] = 1; sc += 2; } }); });
      var ph = a.words.slice().sort(function (x, y) { return y.split(" ").length - x.split(" ").length; });
      for (var i = 0; i < tk.length; i++) {
        if (mine[i]) continue;
        for (var k = 0; k < ph.length; k++) {
          if (phraseAt(tk, i, ph[k], part)) { var n = ph[k].split(" ").length; for (var j = 0; j < n; j++) mine[i + j] = 1; sc += n; i += n - 1; break; }
        }
      }
      if (sc) scored.push({ a: a, sc: sc, ai: ai, mine: mine });
    });
    if (!scored.length) return null;
    scored.forEach(function (x) { Object.keys(x.mine).forEach(function (i) { used[i] = 1; }); });
    var best = Math.max.apply(null, scored.map(function (x) { return x.sc; }));
    var acts = scored.filter(function (x) { return x.sc === best; }).sort(function (x, y) { return x.ai - y.ai; }).slice(0, 3).map(function (x) { return x.a; });
    var who = raw.filter(function (x, i) { return !used[i] && FILLER.indexOf(tk[i]) < 0; }).join(" ");
    if (!verb && !acts.some(function (a) { return (a.verbs || []).some(function (v) { return tk.indexOf(v) >= 0; }); })) {
      // no verb: only a person with a noun ("grech order") does something; a noun alone is searched as before
      if (!personish(who)) return null;
      acts = acts.filter(function (a) { return a.fill; });
      if (!acts.length) return null;
      return { acts: acts, verb: false, who: who };
    }
    return { acts: acts, verb: true, who: personish(who) ? who : "" };
  }
  E.searchDoing = doing; // for the tests
  function doRow(a, c) {
    var scr = actScreen(a), what = a.note || "opens the form";
    if (!c) return { a: a, title: a.label, sub: scr + " · " + what };
    if (c.typed) return { a: a, c: c, title: a.label + " for " + (c.id_card || "“" + c.name + "”"), sub: scr + " · opens the form, " + (c.id_card ? "the ID card" : "the name") + " filled in" };
    return { a: a, c: c, title: a.label + " for " + c.name, sub: scr + " · opens the form, filled in" + (c.id_card ? " · " + c.id_card : "") };
  }
  function doIt(r) {
    var c = r.c, p = c ? { name: c.typed && c.id_card ? "" : str(c.name), id_card: str(c.id_card), phone: str(c.phone), address: str(c.address) } : null;
    // person id 0: Cancel stays on the screen (a customer's page passes its id, and Cancel goes back there)
    if (E.customerHandoff) E.customerHandoff(r.a.id, "new", p, ""); else hand("eikon_cus_hand", { to: r.a.id, mode: "new", at: Date.now(), back: "", person: p || {} });
    go("#" + r.a.id);
  }

  // ---- Orders still open, and today's bookings: read once, filtered here ----
  function openOrders() {
    return cached("orders", async function () {
      var rows = null;
      try { var r = await E.apiFetch("/client-orders/entries?from=" + ymd(addMonths(-11)) + "&to=" + ymd(addMonths(2)) + "&fulfilled=0", { method: "GET", timeoutMs: 8000 }); if (r && r.ok) rows = r.entries || []; } catch (e) { rows = null; }
      if (!rows) { // a server without date ranges: this month and the two before, as the Orders screen does
        var res = await Promise.all([0, -1, -2].map(function (k) { var d = addMonths(k); return E.apiFetch("/client-orders/entries?month=" + d.getFullYear() + "-" + pad(d.getMonth() + 1), { method: "GET", timeoutMs: 8000 }).catch(function () { return null; }); }));
        rows = [].concat.apply([], res.map(function (x) { return (x && x.entries) || []; }));
      }
      var seen = {};
      return rows.filter(function (e) { return !Number(e.fulfilled) && !seen[e.id] && (seen[e.id] = 1); });
    });
  }
  function bookingsReady() {
    try { var u = user(); if (localStorage.getItem("eikon_bk_ready_" + (u.org_id || "") + "_" + (u.location_id || "")) === "1") return true; } catch (e) {}
    return !!(E.state && E.state.todayBookings);
  }
  function todaysBookings() {
    if (!E.modules.bookings || !bookingsReady()) return Promise.resolve([]);
    var t = ymd(new Date());
    return cached("bookings|" + t, async function () {
      var r = await E.apiFetch("/bookings?from=" + t + "&to=" + t, { method: "GET", timeoutMs: 8000 });
      return ((r && r.bookings) || []).filter(function (b) { return b.status !== "cancelled"; });
    });
  }
  function words(q) { return low(q).trim().split(/\s+/).filter(Boolean); }
  function orderMatch(e, q) {
    var s = str(q).trim(), code = s.replace(/\s+/g, "").toUpperCase();
    if (code.length >= 3 && e.order_code && str(e.order_code).toUpperCase().indexOf(code) === 0) return 0;
    var n = low(e.client_name), ws = words(s);
    if (ws.length && ws.every(function (w) { return n.indexOf(w) >= 0; })) return 1;
    var dg = s.replace(/\D/g, ""); if (dg.length >= 4 && /^[\d\s+]+$/.test(s) && str(e.client_phone).replace(/\D/g, "").indexOf(dg) >= 0) return 2;
    if (s.length >= 3 && low(e.items_text || e.items).indexOf(low(s)) >= 0) return 3;
    return -1;
  }
  function bookingMatch(b, q) { var n = low(b.personName), ws = words(q); return ws.length > 0 && ws.every(function (w) { return n.indexOf(w) >= 0; }); }
  function people(q) {
    var s = str(q).trim();
    var ok = /\d/.test(s) ? s.replace(/\s+/g, "").length >= 3 : s.replace(/[^A-Za-zÀ-ɏ]/g, "").length >= 2;
    if (!ok) return Promise.resolve([]);
    var pp = E.personPick ? Promise.resolve(E.personPick) : Promise.resolve(window.EIKON_LATE).then(function () { return E.personPick; }); // loads with the late files
    // ċ ġ ħ ż: the server's LOWER() knows only A to Z, so "ħabela" found nobody. Ask for the longest stretch without them
    // ("abela") and keep here the names that have every word typed (the browser's lower case knows Maltese).
    var MT = /[ċġħżĊĠĦŻ]/, wq = s;
    if (MT.test(s) && !/\d/.test(s)) { var best = s.split(/[\sċġħżĊĠĦŻ]+/).reduce(function (a, b) { return b.length > a.length ? b : a; }, ""); if (best.length >= 2) wq = best; }
    return pp.then(function (p) {
      if (!p || !p.find) return [];
      if (wq === s) return p.find(s, PER);
      return Promise.resolve(p.find(wq, 30)).then(function (list) { var ws = words(s); return (list || []).filter(function (c) { var n = low(c.name); return ws.every(function (w) { return n.indexOf(w) >= 0; }); }).slice(0, PER); });
    }).catch(function () { return []; });
  }

  // ---- Where each result goes ----
  function go(hash) {
    if (str(E.routeHash ? E.routeHash() : location.hash) === hash && E.renderActiveModule) { E.renderActiveModule(); return; }
    window.location.hash = hash;
  }
  function hand(key, val) { try { sessionStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val)); } catch (e) {} }
  function openPerson(c) {
    if (c && c.pid) { hand("eikon_customers_open", { id: c.pid, at: Date.now() }); return go("#customers"); }
    hand("eikon_customers_q", (c && (c.id_card || c.name)) || ""); go("#customers"); // seen only in the registers: Customers offers to add them
  }
  function addPerson(card) { hand("eikon_customers_open", { new: true, id_card: card, at: Date.now() }); go("#customers"); }
  function openOrder(e) {
    if (E.modules.ordreg) { hand("eikon_ordreg_q", { q: e.order_code || e.client_name || "", at: Date.now() }); return go("#ordreg"); }
    if (E.openClassic) E.openClassic("clientorders");
  }
  function openBooking(b) { hand("eikon_bk_open", { id: b.id, date: b.date || ymd(new Date()), at: Date.now() }); go("#bookings"); }
  function openScreen(s) { if (s.open) s.open(); else go(s.go); }
  function toCustomers(q) { hand("eikon_customers_q", str(q).trim()); go("#customers"); }

  // ---- The engine: one per input (Today's box, the dialog) ----
  var seqAll = 0;
  function Engine(input, box, opts) {
    var self = this; opts = opts || {};
    this.input = input; this.box = box; this.opts = opts; this.items = []; this.act = -1; this.groups = {}; this.timer = null; this.seq = 0; this.q = "";
    var lid = box.id || ("esr-l" + (++seqAll)); box.id = lid; this.lid = lid;
    box.setAttribute("role", "listbox"); box.setAttribute("aria-label", "Results");
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-controls", lid); input.setAttribute("aria-expanded", "false"); input.setAttribute("autocomplete", "off");
    var sr = document.createElement("span"); sr.className = "esr-sr"; sr.setAttribute("aria-live", "polite"); box.parentNode.insertBefore(sr, box.nextSibling); this.sr = sr;
    input.addEventListener("input", function () { self.typed(); });
    input.addEventListener("keydown", function (ev) { self.key(ev); });
    box.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // a tap must not take focus from the box
    box.addEventListener("click", function (ev) { var t = ev.target.closest && ev.target.closest("[data-i]"); if (t) self.choose(Number(t.getAttribute("data-i"))); });
    if (opts.blurClose) input.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== input) self.hide(); }, 150); });
    if (opts.blurClose) input.addEventListener("focus", function () { if (str(input.value).trim()) self.typed(true); });
  }
  Engine.prototype.typed = function (now) {
    var self = this, q = str(this.input.value).trim();
    this.q = q; clearTimeout(this.timer); this.note = null;
    if (!q) { this.groups = {}; this.draw(); return; }
    var dg = doing(q), keepActs = this.groups.q === q && this.groups.acts;
    this.groups = { acts: keepActs || (dg && dg.verb ? dg.acts.map(function (a) { return doRow(a); }) : []), doing: dg, screens: screens(q), people: this.groups.people && this.groups.q === q ? this.groups.people : null, orders: null, bookings: null, q: q, pending: true };
    this.draw();
    this.timer = setTimeout(function () { self.remote(q); }, now ? 0 : WAIT);
  };
  Engine.prototype.remote = async function (q) {
    var my = ++this.seq, self = this;
    var dg = doing(q), who = dg && dg.who && dg.acts.some(function (a) { return a.fill; }) ? dg.who : ""; // "grech order": the people are Grech
    var res = await Promise.all([dg && dg.verb && !dg.who ? [] : people(who || q), q.length >= 2 ? openOrders() : null, q.length >= 2 ? todaysBookings() : null]);
    if (my !== this.seq || str(this.input.value).trim() !== q || !document.body.contains(this.input)) return;
    var acts = [];
    if (dg) {
      var fillers = dg.acts.filter(function (a) { return a.fill; }), found = (res[0] || []).slice(0, 3);
      if (who) found.forEach(function (c) { fillers.forEach(function (a) { acts.push(doRow(a, c)); }); });
      if (who && !found.length && dg.verb) { var card = ID_RE.test(who.replace(/\s+/g, "")); fillers.forEach(function (a) { acts.push(doRow(a, card ? { typed: true, id_card: who.replace(/\s+/g, "").toUpperCase(), name: "" } : { typed: true, name: who })); }); }
      if (dg.verb) dg.acts.forEach(function (a) { acts.push(doRow(a)); });
      acts = acts.slice(0, PER);
    }
    var ords = (res[1] || []).map(function (e) { return { e: e, m: orderMatch(e, q) }; }).filter(function (x) { return x.m >= 0; })
      .sort(function (a, b) { return a.m - b.m || (str(a.e.needed_by || "9") < str(b.e.needed_by || "9") ? -1 : 1); }).slice(0, PER).map(function (x) { return x.e; });
    var bks = (res[2] || []).filter(function (b) { return bookingMatch(b, q); }).slice(0, PER);
    this.groups = { acts: acts, doing: dg, screens: screens(q), people: res[0] || [], orders: ords, bookings: bks, q: q, pending: false };
    this.draw();
    var n = this.items.length - (this.items.length && this.items[this.items.length - 1].kind === "more" ? 1 : 0);
    self.sr.textContent = n ? n + (n === 1 ? " result" : " results") + ". Arrow down to choose, Enter opens." : "Nothing found.";
  };
  Engine.prototype.draw = function () {
    var g = this.groups, q = this.q, items = [], html = "", self = this;
    function group(label, list, kind, row) {
      if (!list || !list.length) return;
      html += '<div class="esr-grp" role="group" aria-label="' + esc(label) + '"><div class="esr-lab" aria-hidden="true">' + esc(label) + "</div>";
      list.forEach(function (x) { var i = items.length; items.push({ kind: kind, x: x }); var r = row(x); html += '<div class="esr-opt" role="option" id="' + self.lid + "-" + i + '" data-i="' + i + '" aria-selected="false"><b>' + r[0] + "</b>" + (r[1] ? "<span>" + r[1] + "</span>" : "") + "</div>"; });
      html += "</div>";
    }
    if (this.note) group(this.note.label, [this.note], "note", function (n) { return [esc(n.title), esc(n.sub || "")]; });
    if (q) {
      group("Actions", g.acts, "do", function (r) { return [esc(r.title), esc(r.sub)]; });
      group("Screens", g.screens, "screen", function (s) { return [esc(s.title), esc([s.hub && s.hub !== "Tab" ? s.hub : "", s.desc].filter(Boolean).join(" · "))]; });
      group("People", g.people, "person", function (c) { return [esc(c.name), esc([c.id_card, c.phone, c.pid ? "Customers" : "In the registers"].filter(Boolean).join(" · "))]; });
      group("Open orders", g.orders, "order", function (e) { return [esc(e.client_name), esc([e.items_text || e.items, e.order_code ? "Code " + e.order_code : "", e.needed_by ? "Needed " + e.needed_by : ""].filter(Boolean).join(" · "))]; });
      group("Today's bookings", g.bookings, "booking", function (b) { return [esc(b.start + " " + b.personName), esc([b.end ? "until " + b.end : "", b.status === "arrived" ? "Here" : ""].filter(Boolean).join(" · "))]; });
      if (E.modules.customers && q.length >= 2) group("More", [{ q: q }], "more", function (m) { return ["Find “" + esc(m.q) + "” in Customers", "Every register, by name, ID card or phone"]; });
      if (g.pending) html += '<div class="esr-wait" aria-hidden="true">Looking…</div>';
    }
    this.items = items;
    if (this.act >= items.length) this.act = items.length ? 0 : -1;
    if (this.act < 0 && items.length && this.opts.preselect !== false) this.act = 0;
    this.box.innerHTML = html;
    var open = items.length > 0 || !!(q && g.pending);
    if (open && this.opts.blurClose && document.activeElement !== this.input) open = false; // Today: only while the box has focus
    this.box.hidden = !open && this.opts.blurClose;
    this.input.setAttribute("aria-expanded", items.length ? "true" : "false");
    this.mark();
  };
  Engine.prototype.mark = function () {
    var a = this.act, kids = this.box.querySelectorAll("[data-i]");
    for (var i = 0; i < kids.length; i++) kids[i].setAttribute("aria-selected", Number(kids[i].getAttribute("data-i")) === a ? "true" : "false");
    if (a >= 0 && this.items[a]) { this.input.setAttribute("aria-activedescendant", this.lid + "-" + a); var el = document.getElementById(this.lid + "-" + a); if (el && el.scrollIntoView) try { el.scrollIntoView({ block: "nearest" }); } catch (e) {} }
    else this.input.removeAttribute("aria-activedescendant");
  };
  Engine.prototype.hide = function () { this.groups = {}; this.items = []; this.act = -1; this.note = null; this.box.innerHTML = ""; if (this.opts.blurClose) this.box.hidden = true; this.input.setAttribute("aria-expanded", "false"); this.input.removeAttribute("aria-activedescendant"); };
  Engine.prototype.key = function (ev) {
    if (ev.defaultPrevented) return; // the scanner took this Enter
    var n = this.items.length;
    if (ev.key === "ArrowDown") { if (!n) return; ev.preventDefault(); this.act = (this.act + 1) % n; this.mark(); }
    else if (ev.key === "ArrowUp") { if (!n) return; ev.preventDefault(); this.act = this.act <= 0 ? n - 1 : this.act - 1; this.mark(); }
    else if (ev.key === "Enter") {
      ev.preventDefault();
      var q = str(this.input.value).trim(); if (!q && !this.note) return;
      var self = this;
      if (this.groups.pending) { // Enter before the pause ended: ask now, then open the first answer
        clearTimeout(this.timer); this.remote(q).then(function () { if (self.items.length) self.choose(self.act >= 0 ? self.act : 0); });
        return;
      }
      if (n) this.choose(this.act >= 0 ? this.act : 0);
    }
    else if (ev.key === "Escape") { if (this.opts.onEscape) { ev.preventDefault(); this.opts.onEscape(); } else if (n) { ev.preventDefault(); this.hide(); } }
  };
  Engine.prototype.choose = function (i) {
    var it = this.items[i]; if (!it) return;
    if (this.opts.onChoose) this.opts.onChoose();
    if (it.kind === "screen") openScreen(it.x);
    else if (it.kind === "person") openPerson(it.x);
    else if (it.kind === "order") openOrder(it.x);
    else if (it.kind === "booking") openBooking(it.x);
    else if (it.kind === "note" && it.x.run) it.x.run();
    else if (it.kind === "more") toCustomers(it.x.q);
    else if (it.kind === "do") doIt(it.x);
  };
  // A scanned card nobody has: one choice, add them (Customers, the card filled in).
  Engine.prototype.offer = function (note) { this.note = note; this.groups = { screens: [], people: [], orders: [], bookings: [], q: this.q, pending: false }; this.act = 0; this.draw(); this.act = 0; this.mark(); this.sr.textContent = note.title; };

  // ---- A scanned (or camera-read) code: an order code or an ID card ----
  // An order code is looked for first (a 6-character code can look like an ID card: 23456M); then the ID card.
  async function act(code, where) {
    var raw = str(code).replace(/\s+/g, "");
    var looksOrder = CODE_RE.test(raw), looksId = ID_RE.test(raw);
    if (!looksOrder && !looksId) return false;
    if (looksOrder) {
      var ords = (await openOrders()) || [];
      var hit = ords.filter(function (e) { return str(e.order_code).toUpperCase() === raw.toUpperCase(); });
      if (hit.length) { closeDialog(false); openOrder(hit[0]); return true; }
      if (!looksId) { show(where, { label: "Scanned", title: "No open order with code " + raw.toUpperCase(), sub: "It may be collected already. Open Orders to look", run: function () { if (E.modules.ordreg) { hand("eikon_ordreg_q", { q: raw.toUpperCase(), at: Date.now() }); go("#ordreg"); } } }); return true; }
    }
    var card = raw.toUpperCase();
    var found = [];
    try { var pp = E.personPick || (await Promise.resolve(window.EIKON_LATE).then(function () { return E.personPick; })); if (pp && pp.find) found = await pp.find(card, 10); } catch (e) {}
    var key = E.idCardKey || function (x) { return str(x).toUpperCase().replace(/^0+(?=\d)/, ""); };
    var same = found.filter(function (c) { return c.id_card && key(c.id_card) === key(card); });
    if (same.length === 1) { closeDialog(false); openPerson(same[0]); return true; }
    if (same.length > 1) { closeDialog(false); toCustomers(card); return true; } // two records with one card: Customers shows both
    show(where, { label: "Scanned", title: "No one with card " + card + " — add?", sub: "Opens Customers with the card filled in", run: function () { addPerson(card); } });
    return true;
  }
  function show(where, note) {
    if (!dlg.open && !openDialog("")) { if (E.toast) E.toast(note.title, "warn"); return; }
    dlg.engine.input.value = ""; dlg.engine.q = ""; dlg.engine.offer(note);
  }
  E.searchAct = act; // also used by the tests

  // ---- The dialog ----
  var dlg = { open: false, root: null, engine: null, back: null };
  function css() {
    if (document.getElementById("eikon-search-css")) return;
    var st = document.createElement("style"); st.id = "eikon-search-css";
    st.textContent =
      ".esr-ov{position:fixed;inset:0;z-index:2000;background:rgba(20,27,36,.38);display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px 16px}" +
      ".esr{width:100%;max-width:620px;background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.22);overflow:hidden;display:flex;flex-direction:column;max-height:76vh}" +
      ".esr-bar{display:flex;align-items:center;gap:10px;padding:0 10px 0 16px;height:56px;border-bottom:1px solid var(--border)}" +
      ".esr-bar:focus-within{box-shadow:inset 0 0 0 2px var(--accent)}" +
      ".esr-bar input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text);font:inherit;font-size:17px;height:100%}" +
      ".esr-bar input::placeholder{color:var(--muted)}" +
      ".esr-btn{font:inherit;font-size:14px;font-weight:600;height:36px;min-width:44px;padding:0 12px;border-radius:18px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".esr-btn svg{display:block}" +
      ".esr-list{overflow-y:auto;padding:4px 0 8px}.esr-list:empty{display:none}" +
      ".esr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:12px 16px 4px}" +
      ".esr-opt{display:block;min-height:44px;padding:8px 16px;cursor:pointer;border-left:3px solid transparent}" +
      ".esr-opt b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.esr-opt span{display:block;font-size:12.5px;color:var(--muted);margin-top:1px;overflow-wrap:anywhere}" +
      ".esr-opt[aria-selected=true]{background:rgba(127,127,127,.12);border-left-color:var(--accent)}@media (hover:hover){.esr-opt:hover{background:rgba(127,127,127,.08)}}" +
      ".esr-wait{font-size:12.5px;color:var(--muted);padding:6px 16px}" +
      ".esr-foot{display:flex;gap:14px;flex-wrap:wrap;padding:8px 16px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)}" +
      ".esr-foot kbd{font:inherit;font-weight:600;background:rgba(127,127,127,.14);border-radius:5px;padding:1px 6px;color:var(--text)}" +
      ".esr-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
      ".esr-cam{position:relative;background:#000;aspect-ratio:4/3;max-height:46vh}.esr-cam video{width:100%;height:100%;object-fit:cover;display:block}" +
      ".esr-cam p{position:absolute;left:0;right:0;bottom:0;margin:0;padding:8px 12px;font-size:13px;color:#fff;background:rgba(0,0,0,.5)}" +
      // Today's box: the same results, under the box
      ".tdy-results{grid-column:1;margin-top:6px;background:var(--panel2);border:1px solid var(--border);border-radius:14px;overflow:hidden;max-height:60vh;overflow-y:auto}" +
      ".tdy-results .esr-lab:first-child{margin-top:10px}" +
      "@media (max-width:600px){.esr-ov{padding:0;align-items:stretch}.esr{max-width:none;max-height:none;height:100%;border-radius:0;border:0}.esr-foot{display:none}}";
    document.head.appendChild(st);
  }
  function camOk() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false; }
  function openDialog(prefill) {
    if (!on()) return false;
    if (dlg.open) { try { dlg.engine.input.focus(); } catch (e) {} return true; }
    css();
    dlg.back = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    var ov = document.createElement("div"); ov.className = "esr-ov";
    ov.innerHTML = '<div class="esr" role="dialog" aria-modal="true" aria-labelledby="esr-title">' +
      '<h2 id="esr-title" class="esr-sr">Search</h2>' +
      '<div class="esr-bar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" style="color:var(--muted);flex:none"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input id="esr-q" type="search" spellcheck="false" aria-label="Search screens, people, orders and bookings" placeholder="A screen, a person, an order, a booking…">' +
      (camOk() ? '<button type="button" class="esr-btn" data-act="cam" aria-label="Scan with the camera"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10.5 8v8M14 8v8M17 8v8"/></svg></button>' : "") +
      '<button type="button" class="esr-btn" data-act="close">Close</button></div>' +
      '<div class="esr-camwrap"></div>' +
      '<div class="esr-list" id="esr-list"></div>' +
      '<div class="esr-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> opens</span><span><kbd>Esc</kbd> closes</span><span><kbd>N</kbd> new, on a screen</span><span><kbd>' + (/Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘" : "Ctrl") + '</kbd> <kbd>Enter</kbd> saves a form</span><span>A scanned ID card or order code opens it</span></div></div>';
    document.body.appendChild(ov);
    dlg.root = ov; dlg.open = true;
    var input = ov.querySelector("#esr-q");
    dlg.engine = new Engine(input, ov.querySelector("#esr-list"), { onEscape: function () { closeDialog(true); }, onChoose: function () { closeDialog(false); } });
    ov.addEventListener("mousedown", function (ev) { if (ev.target === ov) { ev.preventDefault(); closeDialog(true); } });
    ov.querySelector('[data-act="close"]').addEventListener("click", function () { closeDialog(true); });
    var cb = ov.querySelector('[data-act="cam"]'); if (cb) cb.addEventListener("click", function () { camera.toggle(); });
    // Focus stays inside: Tab and Shift+Tab go round the box and its buttons.
    ov.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !ev.defaultPrevented) { ev.preventDefault(); closeDialog(true); return; }
      if (ev.key !== "Tab") return;
      var f = Array.prototype.filter.call(ov.querySelectorAll("input,button"), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && (i === f.length - 1 || i < 0)) { ev.preventDefault(); f[0].focus(); }
    });
    if (prefill) { input.value = prefill; dlg.engine.typed(); }
    try { input.focus(); } catch (e) {}
    return true;
  }
  function closeDialog(restore) {
    if (!dlg.open) return;
    camera.stop();
    dlg.open = false;
    var ov = dlg.root; dlg.root = null; dlg.engine = null;
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var back = dlg.back; dlg.back = null;
    if (restore && back && document.body.contains(back)) try { back.focus(); } catch (e) {}
  }
  E.searchOpen = openDialog; E.searchClose = closeDialog;
  E.searchIsOpen = function () { return dlg.open; };

  // The one place ZXing is fetched (only when the camera is asked for and the browser has no BarcodeDetector).
  // Uses E.loadVendor("zxing") where the app has it; otherwise the pinned CDN file the Emergency POS uses.
  function loadZxing() {
    if (window.ZXing) return Promise.resolve();
    if (E.loadVendor) return Promise.resolve(E.loadVendor("zxing")).then(function () { if (!window.ZXing) throw new Error("ZXing missing"); });
    return Promise.reject(new Error("ZXing not available"));
  }

  // ---- Camera: BarcodeDetector first, ZXing (on demand) where the browser has none. Same order as the Emergency POS. ----
  var camera = {
    stream: null, reader: null, stopped: true,
    toggle: function () { if (!this.stopped) this.stop(); else this.start(); },
    stop: function () {
      this.stopped = true;
      try { if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (this.reader) this.reader.reset(); } catch (e) {}
      this.stream = null; this.reader = null;
      var w = dlg.root && dlg.root.querySelector(".esr-camwrap"); if (w) w.innerHTML = "";
      var b = dlg.root && dlg.root.querySelector('[data-act="cam"]'); if (b) b.setAttribute("aria-pressed", "false");
    },
    start: function () {
      var self = this, w = dlg.root && dlg.root.querySelector(".esr-camwrap"); if (!w) return;
      this.stopped = false;
      var b = dlg.root.querySelector('[data-act="cam"]'); if (b) b.setAttribute("aria-pressed", "true");
      w.innerHTML = '<div class="esr-cam"><video id="esr-video" playsinline muted></video><p role="status">Hold the ID card or the order slip up to the camera.</p></div>';
      var video = w.querySelector("video"), msg = w.querySelector("p");
      var done = function (text) { if (self.stopped) return; self.stop(); act(text, "dialog").then(function (ok) { if (!ok && dlg.open) { dlg.engine.input.value = str(text); dlg.engine.typed(); } }); };
      var fail = function (t) { if (msg) msg.textContent = t; };
      if (typeof window.BarcodeDetector !== "undefined") {
        var det; try { det = new window.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "data_matrix", "pdf417", "ean_13"] }); } catch (e) { try { det = new window.BarcodeDetector(); } catch (e2) { det = null; } }
        if (det) {
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (st) {
            if (self.stopped) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
            self.stream = st; video.srcObject = st; try { video.play(); } catch (e) {}
            var tick = function () {
              if (self.stopped) return;
              if (video.readyState < 2) { setTimeout(tick, 120); return; }
              det.detect(video).then(function (r) { if (r && r[0] && r[0].rawValue) done(r[0].rawValue); else setTimeout(tick, 120); }).catch(function () { setTimeout(tick, 200); });
            };
            setTimeout(tick, 300);
          }).catch(function (e) { fail("The camera could not be opened: " + str(e && e.message || e)); });
          return;
        }
      }
      var go2 = function () {
        if (self.stopped) return;
        try {
          self.reader = new window.ZXing.BrowserMultiFormatReader();
          self.reader.decodeFromVideoDevice(null, "esr-video", function (res) { if (res) done(res.getText()); });
        } catch (e) { fail("The scanner could not start: " + str(e && e.message || e)); }
      };
      if (window.ZXing) return go2();
      fail("Loading the scanner…");
      loadZxing().then(function () { if (msg) msg.textContent = "Hold the ID card or the order slip up to the camera."; go2(); },
        function () { fail("The scanner could not be loaded. Check the connection, or type the card or code."); });
    }
  };

  // ---- Today's box: the same engine, results under the box ----
  E.searchAttachToday = function (input, box) {
    if (!input || !box || input.__esr) return null;
    css(); input.__esr = true;
    var eng = new Engine(input, box, { blurClose: true, onEscape: function () { if (eng.items.length || str(input.value)) { input.value = ""; input.dispatchEvent(new Event("input")); eng.hide(); } } });
    if (str(input.value).trim() && document.activeElement === input) eng.typed(true);
    return eng;
  };

  // ---- Keys: the shortcut, and the scanner ----
  var burst = { keys: "", last: 0, el: null, before: "", fast: true };
  function scanPlace(el) {
    if (dlg.open) return el && dlg.root && dlg.root.contains(el) && el.id === "esr-q" ? "dialog" : "";
    if (!E.state || E.state.activeModuleId !== "today") return "";
    if (!el || el === document.body || !editable(el)) return "today";
    return el.id === "tdy-q" ? "today" : ""; // a form field on Today (a fridge reading, a name) keeps what is typed
  }
  document.addEventListener("keydown", function (ev) {
    if (!on()) return;
    var el = document.activeElement;
    // "/" from anywhere that is not a field, Ctrl/Cmd+K from anywhere
    if (!ev.altKey && (((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && low(ev.key) === "k") || (ev.key === "/" && !ev.ctrlKey && !ev.metaKey && !editable(el)))) {
      var mo = document.querySelector(".eikon-modal-overlay"); if (mo && mo.style.display === "flex" && !dlg.open) return; // another dialog is open
      ev.preventDefault();
      if (dlg.open) { try { dlg.engine.input.focus(); dlg.engine.input.select(); } catch (e) {} } else openDialog("");
      return;
    }
    // the scanner: fast keys, then Enter
    var t = ev.timeStamp || (window.performance ? performance.now() : Date.now());
    if (ev.key && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      var gap = t - burst.last;
      if (!burst.keys || gap >= GAP || burst.el !== el) { burst.keys = ""; burst.el = el; burst.before = el && "value" in el ? str(el.value) : ""; burst.selStart = el && el.selectionStart; }
      burst.keys += ev.key; burst.last = t;
      return;
    }
    if (ev.key === "Enter") {
      var keys = burst.keys, fast = keys.length >= MIN && t - burst.last < GAP && burst.el === el;
      burst.keys = "";
      if (!fast) return;
      var code = keys.replace(/\s+/g, "");
      if (!(ID_RE.test(code) || CODE_RE.test(code))) return;
      var where = scanPlace(el); if (!where) return;
      ev.preventDefault(); ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      if (el && "value" in el && str(el.value) !== burst.before) { el.value = burst.before; try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {} } // the code is not left in the box
      E._lastScan = { code: code, where: where, at: Date.now() };
      act(code, where);
      return;
    }
    if (ev.key !== "Shift") burst.keys = "";
  }, true);
  // Leaving the screen closes the dialog (a result was opened, or Back was pressed).
  window.addEventListener("hashchange", function () { if (dlg.open) closeDialog(false); });
})();
