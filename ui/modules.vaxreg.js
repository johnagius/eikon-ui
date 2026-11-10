/* Vaccines, new layout: the doses due (recalls), the vaccinations given and the vaccine orders taken for clients (this
   month first, then earlier ones), a search, a person's vaccination history, one form to record a vaccination (patient,
   vaccine, batch and expiry remembered from the last use, dose, site, consent, next dose) and one form to take an order.
   A reaction after a vaccine opens a pre-filled adverse-reaction report (pvreg). Vaccinations use their own routes
   (/vaccines/given) and never change orders or stock. Travel: choose the country and the vaccines the database recommends for it (always / if at
   higher risk) are one tap each; routine ones are offered for other orders. Each vaccine shows what stock holds.
   The order is saved exactly as the classic screen saves it (same fields, same item merging; the server takes the
   vaccines off stock) and prints in the classic layout, A4 or receipt. Stock rows, batches and the vaccine database
   stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, orders: [], catalog: [], stock: [], loading: false, error: "", q: "", adding: null, saving: false, err: "", printFor: 0, justSaved: 0, vm: "", vmOrders: [], vmLoading: false, vmErr: "",
    all200: false, given: [], givenLoading: false, givenErr: "", givenMissing: false, due: [], dueErr: "", giving: null, gfe: {}, gerr: "", gsaving: false, hist: null, closing: 0, justGiven: 0 };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var F = ["country", "client_first", "client_last", "phone", "email"];
  var COUNTRIES = null, countriesLoading = null; // [{ code, name, nn }] from the same map file the classic screen uses

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function low(s) { return String(s || "").trim().toLowerCase(); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toInt(v, def) { var n = parseInt(String(v == null ? "" : v), 10); return Number.isFinite(n) ? n : (def == null ? 0 : def); }
  function nowIso() { try { return new Date().toISOString(); } catch (e) { return ""; } }
  function when(iso) { // 3 Nov, 10:22 (the year only when it is not this year)
    var d = new Date(iso); if (isNaN(d)) return String(iso || "");
    return d.getDate() + " " + MON[d.getMonth()] + (d.getFullYear() === new Date().getFullYear() ? "" : " " + d.getFullYear()) + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function ym(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function dmy(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : String(s || ""); }
  function client(o) { return (String(o.client_first || "").trim() + " " + String(o.client_last || "").trim()).trim(); }
  function normName(s) { return String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }

  // The same rules as the classic screen
  function isRoutine(r) { var v = low(r && r.routine_in_malta); return v === "yes" || v === "y" || v === "1" || v === "true"; }
  function inList(cc, csv) {
    cc = String(cc || "").trim().toUpperCase(); if (!/^[A-Z]{2}$/.test(cc)) return false;
    return String(csv || "").split(",").some(function (p) { return String(p || "").trim().toUpperCase() === cc; });
  }
  function recommend(cc) {
    var always = [], high = [];
    S.catalog.forEach(function (v) { if (inList(cc, v.travel_always)) always.push(v); else if (inList(cc, v.travel_highrisk)) high.push(v); });
    var by = function (a, b) { return String(a.brand_name || "").localeCompare(String(b.brand_name || "")); };
    return { always: always.sort(by), high: high.sort(by) };
  }
  function buildItems(lines) { // merge the same vaccine typed twice, sorted by name (as the classic order panel does)
    var merged = {};
    lines.forEach(function (l) {
      var nm = String(l.name || "").trim(), q = toInt(l.qty, 0), k = nm.toLowerCase();
      if (!nm || q <= 0) return;
      merged[k] = merged[k] || { name: nm, qty: 0 }; merged[k].qty += q;
    });
    return Object.keys(merged).map(function (k) { return merged[k]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }
  function countryMatches(query) {
    var q = normName(query); if (!q || !COUNTRIES) return [];
    var hits = [];
    COUNTRIES.forEach(function (c) { var i = c.nn.indexOf(q); if (i >= 0) hits.push({ c: c, s: (i === 0 ? 0 : 50) + Math.min(i, 40) + Math.min(c.nn.length, 60) / 10 }); });
    hits.sort(function (a, b) { return a.s !== b.s ? a.s - b.s : String(a.c.name).localeCompare(String(b.c.name)); });
    return hits.map(function (x) { return x.c; });
  }
  function stockFor(name) { // the server takes stock from the row with this exact name and the earliest expiry
    var rows = S.stock.filter(function (r) { return String(r.vaccine_name || "").trim() === String(name || "").trim(); });
    if (!rows.length) return null;
    var qty = rows.reduce(function (a, r) { return a + toInt(r.qty, 0); }, 0);
    var exp = rows.map(function (r) { return String(r.expiry_date || ""); }).filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); }).sort()[0] || "";
    return { qty: qty, exp: exp };
  }

  // ── Vaccinations given (Services, 2026-11-09): record one, the doses due, a person's history, a reaction → report ──
  // Separate from orders: GET/POST /vaccines/given, GET /vaccines/given/due, POST /vaccines/given/:id/close.
  // Recording a vaccination never changes stock or orders (the order takes stock off, as before).
  var SITES = ["Left upper arm", "Right upper arm", "Left thigh", "Right thigh", "By mouth", "Nose", "Other"]; // the worker's list
  var DOSES = ["Dose 1", "Dose 2", "Dose 3", "Booster", "Only dose"];
  var CONSENT = [["Patient", "Given by the patient"], ["Parent or guardian", "Given by a parent or guardian"]];
  var GF = ["client_first", "client_last", "phone", "vaccine_name", "batch", "expiry_date", "given_on", "next_due", "notes"];
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function todayY() { return E.maltaYmd ? E.maltaYmd(new Date()) : E.months.today(); }
  function ymdAdd(ymd, days, months) { var p = String(ymd).split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 + (months || 0), p[2] + (days || 0))); return d.toISOString().slice(0, 10); }
  function realYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T12:00:00Z")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s; }
  function dayWords(ymd) { // Mon 9 Nov (the year only when it is not this year)
    if (!realYmd(ymd)) return String(ymd || ""); var d = new Date(ymd + "T12:00:00Z");
    return WD[d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()] + (d.getUTCFullYear() === Number(todayY().slice(0, 4)) ? "" : " " + d.getUTCFullYear());
  }
  function daysTo(ymd) { return Math.round((Date.parse(ymd + "T12:00:00Z") - Date.parse(todayY() + "T12:00:00Z")) / 864e5); }
  function nextDose(d) { var i = DOSES.indexOf(d); return i < 0 ? "" : i <= 1 ? DOSES[i + 1] : i <= 3 ? "Booster" : ""; }
  function person(g) { return (String(g.client_first || "").trim() + " " + String(g.client_last || "").trim()).trim(); }
  function initials(first, last) { return [first, last].map(function (x) { var c = String(x || "").trim().charAt(0); return c ? c.toUpperCase() + "." : ""; }).join(""); }
  // What this device remembers per pharmacy: the last batch and expiry of each vaccine, the last site, recent vaccines.
  function secKey() { return "eikon_vax_sec:" + ((((E.state && E.state.user) || {}).location_id) || 0); }
  function lastSection() { var v = ""; try { v = localStorage.getItem(secKey()) || ""; } catch (e) {} return v === "other" ? "other" : "travel"; } // the kind of order chosen last on this device (VISUAL V4)
  function memKey() { var u = (E.state && E.state.user) || {}; return "eikon_vax_mem:" + (u.location_id || 0); }
  function mem() { try { var m = JSON.parse(localStorage.getItem(memKey()) || "null"); if (m && typeof m === "object") return { batches: m.batches || {}, site: m.site || "", recent: Array.isArray(m.recent) ? m.recent : [] }; } catch (e) {} return { batches: {}, site: "", recent: [] }; }
  function remember(b) {
    var m = mem(); m.batches[low(b.vaccine_name)] = { batch: b.batch, expiry_date: b.expiry_date }; m.site = b.site;
    m.recent = [b.vaccine_name].concat(m.recent.filter(function (x) { return low(x) !== low(b.vaccine_name); })).slice(0, 6);
    try { localStorage.setItem(memKey(), JSON.stringify(m)); } catch (e) {}
  }
  function batchFor(name) { // the batch last used for this vaccine (this device, or this month's list), else the stock row the server takes from
    var k = low(name); if (!k) return null;
    var g = S.given.filter(function (x) { return low(x.vaccine_name) === k && x.batch; })[0];
    if (g) return { batch: g.batch, expiry_date: g.expiry_date || "", from: "Last used batch" };
    var m = mem().batches[k]; if (m && m.batch) return { batch: m.batch, expiry_date: m.expiry_date || "", from: "Last used batch" };
    var rows = S.stock.filter(function (r) { return low(r.vaccine_name) === k && String(r.batch || "").trim() && toInt(r.qty, 0) > 0; })
      .sort(function (a, b) { return String(a.expiry_date || "9999").localeCompare(String(b.expiry_date || "9999")); });
    return rows.length ? { batch: String(rows[0].batch).trim(), expiry_date: String(rows[0].expiry_date || ""), from: "From stock" } : null;
  }

  async function loadGiven() {
    var want = S.vm; S.givenLoading = true; S.givenErr = "";
    try {
      var r = await E.apiFetch("/vaccines/given?month=" + encodeURIComponent(want), { method: "GET" });
      if (want !== S.vm) return;
      S.given = (r && r.given) || []; S.givenMissing = false;
    } catch (e) {
      if (want !== S.vm) return;
      if (e && (e.status === 404 || e.status === 405)) S.givenMissing = true;
      else S.givenErr = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the vaccinations");
    }
    S.givenLoading = false;
  }
  async function loadDue() {
    try { var r = await E.apiFetch("/vaccines/given/due?to=" + ymdAdd(todayY(), 14), { method: "GET" }); S.due = (r && r.due) || []; S.dueErr = ""; }
    catch (e) { S.due = []; S.dueErr = e && (e.status === 404 || e.status === 405) ? "" : "Could not load the doses due."; }
  }
  async function loadHist() {
    var h = S.hist; if (!h) return; h.loading = true; h.err = "";
    var qs = h.first && h.last ? "first=" + encodeURIComponent(h.first) + "&last=" + encodeURIComponent(h.last) + (h.phone ? "&phone=" + encodeURIComponent(h.phone) : "") : "phone=" + encodeURIComponent(h.phone);
    try { var r = await E.apiFetch("/vaccines/given?" + qs, { method: "GET" }); if (S.hist !== h) return; h.rows = (r && r.given) || []; }
    catch (e) { if (S.hist !== h) return; h.err = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the history"); }
    h.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function dueRow(g) {
    var n = daysTo(g.next_due), nd = nextDose(g.dose), what = nd || "Next dose";
    var pill = n < 0 ? '<em class="vxg-pill r">Overdue · ' + (-n) + (n === -1 ? " day" : " days") + "</em>" : n === 0 ? '<em class="vxg-pill a">' + esc(what) + " due today</em>" : '<em class="vxg-pill">Due ' + esc(dayWords(g.next_due)) + "</em>";
    var acts = S.closing === g.id
      ? '<i>Close this recall without a dose?</i><button class="vax-btn" data-act="due-close-yes" data-gid="' + g.id + '">Yes, not needed</button><button class="vax-btn t" data-act="due-close-no">Keep</button>'
      : '<button class="vax-btn" data-act="due-give" data-gid="' + g.id + '">Record ' + esc(nd ? nd.toLowerCase() : "the dose") + '</button><button class="vax-btn t" data-act="due-close" data-gid="' + g.id + '" aria-label="' + esc("Not needed: close the recall for " + person(g)) + '">Not needed</button>';
    return '<div class="vxg-row' + (S.openGid === g.id ? " new" : "") + '"><div class="t"><b>' + esc(person(g)) + "</b> " + pill + '<div class="m">' + esc(g.vaccine_name) + (nd ? " · " + esc(nd) : "") + "</div><span>" +
      esc([(g.dose ? g.dose + " given " : "Given ") + dayWords(g.given_on), g.phone].filter(Boolean).join(" · ")) + '</span></div><div class="a">' + acts + "</div></div>";
  }
  function givenRow(g, inHist) {
    var sub = [dayWords(g.given_on), g.batch ? "batch " + g.batch + (g.expiry_date ? ", expires " + dmy(g.expiry_date) : "") : "", g.consent_by ? "consent: " + low(g.consent_by) : "", g.given_by_name ? "by " + g.given_by_name : "",
      g.next_due ? (Number(g.next_state) === 0 ? "next dose due " + dayWords(g.next_due) : Number(g.next_state) === 1 ? "next dose given" : "recall closed") : ""].filter(Boolean).join(" · ");
    return '<div class="vxg-row' + (S.justGiven === g.id ? " new" : "") + '"><div class="t">' + (inHist ? "<b>" + esc(g.vaccine_name) + "</b>" : '<button type="button" class="vxg-name" data-act="hist" data-gid="' + g.id + '" aria-label="' + esc("Vaccination history of " + person(g)) + '">' + esc(person(g)) + "</button>") +
      '<div class="m">' + esc([inHist ? "" : g.vaccine_name, g.dose, g.site].filter(Boolean).join(" · ")) + "</div><span>" + esc(sub) + '</span></div><div class="a"><button class="vax-btn" data-act="react" data-gid="' + g.id + '" aria-label="' + esc("Report a reaction after " + g.vaccine_name + " given to " + person(g)) + '">Reaction</button></div></div>';
  }
  function dueHtml() {
    if (S.givenMissing || (!S.due.length && !S.dueErr)) return "";
    if (S.dueErr) return '<div class="vxr-lab">Doses due</div><div class="vxr-quiet" role="alert">' + esc(S.dueErr) + "</div>";
    var over = S.due.filter(function (g) { return daysTo(g.next_due) < 0; }).length;
    var n = S.dueAll ? S.due.length : Math.min(S.due.length, 5);
    return '<div class="vxr-lab">Doses due <b>' + S.due.length + "</b>" + (over ? '<span class="vxg-over">' + over + " overdue</span>" : "") + '<span class="vxg-to">overdue first, then the next 14 days</span></div><div class="vxr-list vxg-due">' + S.due.slice(0, n).map(dueRow).join("") + "</div>" +
      (S.due.length > 5 ? '<button type="button" class="vax-btn t vxg-more" data-act="due-all" aria-expanded="' + !!S.dueAll + '">' + (S.dueAll ? "Show fewer" : "Show all " + S.due.length + " doses due") + "</button>" : "");
  }
  function givenHtml() {
    var label = E.months.label(S.vm);
    if (S.givenMissing) return '<div class="vxr-lab">Vaccinations given</div><div class="vxr-quiet">Recording vaccinations needs the latest server update. Orders work as before.</div>';
    if (S.givenLoading && !S.given.length) return '<div class="vxr-lab">Vaccinations given · ' + esc(label) + "</div>" + skel("vaccinations");
    if (S.givenErr) return '<div class="vxr-lab">Vaccinations given</div>' + trouble(S.givenErr);
    return '<div class="vxr-lab">Vaccinations given · ' + esc(label) + " <b>" + S.given.length + "</b></div>" + (S.given.length ? '<div class="vxr-list">' + S.given.map(function (g) { return givenRow(g); }).join("") + "</div>"
      : '<div class="vxr-quiet" data-empty>' + esc(E.months.empty(S.vm, "No vaccination recorded this month yet. Press Record a vaccination after you give one.")) + "</div>");
  }
  function histHtml() {
    var h = S.hist, nm = (h.first + " " + h.last).trim() || h.phone;
    var out = '<div class="vxg-hist"><button type="button" class="vxr-back" data-act="hist-close">‹ All vaccinations</button><div class="vxr-top"><div><h2>' + esc(nm) + '</h2><p class="vxr-sub">' + esc(h.phone ? "Phone " + h.phone : "Vaccinations recorded here") + "</p></div>" +
      '<button class="vax-btn p" data-act="hist-give">Record a vaccination for ' + esc(h.first || nm) + "</button></div>";
    if (h.loading && !h.rows.length) out += skel("the history");
    else if (h.err) out += '<div class="vxr-quiet" role="alert">' + esc(h.err) + ' <button type="button" class="vax-btn" data-act="hist-retry" style="margin-left:6px">Try again</button></div>';
    else if (!h.rows.length) out += '<div class="vxr-quiet">No vaccination recorded for ' + esc(nm) + " yet.</div>";
    else out += '<div class="vxr-lab">Vaccinations <b>' + h.rows.length + '</b></div><div class="vxr-list">' + h.rows.map(function (g) { return givenRow(g, true); }).join("") + "</div>";
    return out + "</div>";
  }

  function givingHtml() {
    var a = S.giving, fe = S.gfe || {}, today = todayY(), m = mem();
    var fld = function (k, label, extra, after) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + (fe[k] ? ' aria-invalid="true" aria-describedby="vxg-e-' + k + '"' : "") + ">" + (after || "") + (fe[k] ? '<small class="vxr-ferr" id="vxg-e-' + k + '">' + esc(fe[k]) + "</small>" : "") + "</label>"; };
    var seg = function (act, list, val, label, errK) {
      return '<div class="vxg-seg" role="radiogroup" aria-label="' + label + '"' + (fe[errK] ? ' aria-invalid="true" aria-describedby="vxg-e-' + errK + '"' : "") + ">" + list.map(function (x) { var v = Array.isArray(x) ? x[0] : x, t = Array.isArray(x) ? x[1] : x, on = v === val;
        return '<button type="button" role="radio" class="vax-btn' + (on ? " p" : "") + '" data-act="' + act + '" data-v="' + esc(v) + '" aria-checked="' + on + '">' + esc(t) + "</button>"; }).join("") + "</div>" +
        (fe[errK] ? '<small class="vxr-ferr vxg-segerr" id="vxg-e-' + errK + '">' + esc(fe[errK]) + "</small>" : "");
    };
    var recent = m.recent.filter(function (x) { return low(x) !== low(a.vaccine_name); }).slice(0, 5);
    var h = '<form class="vxr-form" id="vxg-add" autocomplete="off" novalidate><div class="vxg-ttl">Record a vaccination</div>' +
      '<div class="hd"><span>Patient</span></div>' +
      fld("client_first", "Name", ' autocapitalize="words"') + fld("client_last", "Surname", ' autocapitalize="words"') + fld("phone", "Phone", ' type="tel" inputmode="tel" placeholder="Optional"') +
      '<div class="hd"><span>Vaccine</span></div>' +
      fld("vaccine_name", "Vaccine", ' list="vxr-names" placeholder="e.g. Havrix 1440"') +
      (recent.length ? '<div class="vxr-chips" role="group" aria-label="Vaccines used lately">' + recent.map(function (x) { return '<button type="button" class="vax-btn" data-act="gv-pick" data-v="' + esc(x) + '">' + esc(x) + "</button>"; }).join("") + "</div>" : "") +
      '<div class="vxg-l">Dose</div>' + seg("gdose", DOSES, a.dose, "Dose", "dose") +
      fld("batch", "Batch", ' autocapitalize="characters" placeholder="Batch or lot"', a.batchFrom ? "<small>" + esc(a.batchFrom) + "</small>" : "") +
      fld("expiry_date", "Expiry", ' type="date"') +
      '<div class="hd"><span>Given</span></div>' +
      fld("given_on", "Date", ' type="date" max="' + today + '"') +
      '<div class="vxg-l">Where</div>' + seg("gsite", SITES, a.site, "Where it was given", "site") +
      fld("next_due", "Next dose", ' type="date" min="' + ymdAdd(a.given_on && realYmd(a.given_on) ? a.given_on : today, 1) + '"') +
      '<div class="vxr-chips" role="group" aria-label="Next dose due in">' + [["1m", "In 1 month"], ["6m", "In 6 months"], ["1y", "In 1 year"], ["no", "No next dose"]].map(function (x) { return '<button type="button" class="vax-btn" data-act="gnext" data-v="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>" +
      '<div class="hd"><span>Consent</span></div>' + seg("gcons", CONSENT, a.consent_by, "Consent", "consent_by") +
      fld("notes", "Notes", ' placeholder="Optional"') +
      '<div class="note">Recording a vaccination does not change stock. Stock is taken off when you record the order.</div>' +
      (S.gerr ? '<div class="vxr-err" role="alert">' + esc(S.gerr) + "</div>" : "") +
      '<div class="acts" style="justify-content:flex-end"><button type="button" class="vax-btn" data-act="give-cancel">Cancel</button><button type="submit" class="vax-btn p"' + (S.gsaving ? " disabled" : "") + ">" + (S.gsaving ? "Saving…" : "Save vaccination") + "</button></div></form>";
    return h;
  }
  function startGiving(pre) {
    S.adding = null; S.fe = {}; S.err = ""; S.closing = 0;
    var m = mem();
    S.giving = Object.assign({ client_first: "", client_last: "", phone: "", vaccine_name: "", dose: "", batch: "", expiry_date: "", batchFrom: "", given_on: todayY(), site: m.site || "", next_due: "", consent_by: "", notes: "", order_id: 0 }, pre || {});
    if (S.giving.vaccine_name && !S.giving.batch) fillBatch(true);
    S.gfe = {}; S.gerr = ""; paint(true); window.scrollTo(0, 0);
    focus(S.giving.client_first ? (S.giving.vaccine_name ? "#vxg-add [data-act=gdose]" : "#vxg-add [name=vaccine_name]") : "#vxg-add [name=client_first]");
  }
  function fillBatch(force) { // a new vaccine brings its remembered batch and expiry, never over what was typed by hand
    var a = S.giving; if (!a) return false;
    if (!force && a.batch && !a.batchFrom) return false;
    var b = batchFor(a.vaccine_name);
    if (b) { a.batch = b.batch; a.expiry_date = b.expiry_date; a.batchFrom = b.from; return true; }
    if (a.batchFrom) { a.batch = ""; a.expiry_date = ""; a.batchFrom = ""; return true; }
    return false;
  }
  function keepG() {
    var f = S.mount && S.mount.querySelector("#vxg-add"); if (!f || !S.giving) return;
    GF.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.giving[k] = String(el.value || "").trim(); });
  }
  function closeGiving() { S.giving = null; S.gfe = {}; S.gerr = ""; paint(true); setTimeout(function () { var b = S.mount && S.mount.querySelector(".vxr-top [data-act=give]"); if (b) b.focus(); }, 0); }
  async function saveGiven() {
    if (S.gsaving) return;
    keepG(); var a = S.giving, fe = {}, today = todayY();
    if (!a.client_first) fe.client_first = "Write the patient's name.";
    if (!a.client_last) fe.client_last = "Write the patient's surname.";
    if (!a.vaccine_name) fe.vaccine_name = "Write the vaccine given.";
    if (!realYmd(a.given_on)) fe.given_on = "Choose the day it was given.";
    else if (a.given_on > today) fe.given_on = "The day it was given cannot be after today.";
    if (a.expiry_date && !realYmd(a.expiry_date)) fe.expiry_date = "Choose the expiry date of the batch.";
    else if (a.expiry_date && realYmd(a.given_on) && a.expiry_date < a.given_on) fe.expiry_date = "This batch expired on " + dmy(a.expiry_date) + ". Check the batch and its expiry.";
    if (a.next_due && !realYmd(a.next_due)) fe.next_due = "Choose the day the next dose is due, or leave it empty.";
    else if (a.next_due && realYmd(a.given_on) && a.next_due <= a.given_on) fe.next_due = "The next dose must be due after the day it was given.";
    if (SITES.indexOf(a.site) < 0) fe.site = "Choose where it was given.";
    if (!CONSENT.some(function (c) { return c[0] === a.consent_by; })) fe.consent_by = "Choose who gave consent. Nothing is saved without it.";
    S.gfe = fe; var keys = Object.keys(fe);
    if (keys.length) {
      S.gerr = keys.map(function (k) { return fe[k]; }).join(" ") + " Nothing was saved."; paint(true);
      var first = S.mount.querySelector("#vxg-add [aria-invalid=true]"); if (first) { var fb = first.getAttribute("role") === "radiogroup" ? first.querySelector("button") : first; if (fb) fb.focus(); }
      return;
    }
    var body = { given_on: a.given_on, client_first: a.client_first, client_last: a.client_last, phone: a.phone, email: "", id_card: "", vaccine_name: a.vaccine_name, dose: a.dose, batch: a.batch, expiry_date: a.expiry_date,
      site: a.site, consent_by: a.consent_by, next_due: a.next_due, order_id: toInt(a.order_id, 0), notes: a.notes };
    S.gsaving = true; S.gerr = ""; paint(true);
    var since = Date.now() - 10 * 60 * 1000;
    try {
      var r = await E.postOnce("/vaccines/given", body, {
        list: async function () { var r0 = await E.apiFetch("/vaccines/given?month=" + body.given_on.slice(0, 7), { method: "GET" }); return (r0 && r0.given) || []; },
        same: function (g) { return Date.parse(String(g.created_at).replace(" ", "T") + "Z") >= since && low(g.client_first) === low(body.client_first) && low(g.client_last) === low(body.client_last) && low(g.vaccine_name) === low(body.vaccine_name) && g.given_on === body.given_on && String(g.batch) === body.batch; }
      });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      remember(body);
      if (E.linkPerson) E.linkPerson({ name: body.client_first + " " + body.client_last, phone: body.phone }, "register:vaccines");
      E.toast("Saved · " + body.vaccine_name + " for " + body.client_first + " " + body.client_last + (r.closed_recalls ? " · the dose due is done" : ""), "success");
      S.giving = null; S.gfe = {}; S.justGiven = r.given ? r.given.id : 0;
      if (body.given_on.slice(0, 7) !== S.vm) { S.vm = body.given_on.slice(0, 7); S.vmOrders = []; loadMonth(); }
    } catch (x) { S.gerr = E.saveFailText(x); }
    S.gsaving = false;
    await Promise.all([loadGiven(), loadDue()]); if (S.hist) loadHist();
    paint(true);
    if (!S.giving) { var nb = S.mount && S.mount.querySelector(".vxg-row.new [data-act=react]"); if (nb) nb.focus(); }
  }
  async function closeRecall(id) {
    try { await E.apiFetch("/vaccines/given/" + id + "/close", { method: "POST", body: "{}" }); S.due = S.due.filter(function (g) { return g.id !== id; }); E.toast("Recall closed", "success"); }
    catch (x) { E.toast(E.saveFailText(x), "warn"); }
    S.closing = 0; paint(true); var b = S.mount && S.mount.querySelector(".vxg-due [data-act=due-give], .vxr-top [data-act=give]"); if (b) b.focus();
  }
  // "A reaction after this vaccine": the reaction report opens with what the vaccination already says (V-C3).
  function reaction(g) {
    var route = /arm|thigh/i.test(g.site || "") ? "IM" : g.site === "By mouth" ? "Oral" : "Other";
    var pre = { at: Date.now(), from: "vaxreg", who: person(g), on: g.given_on, pt_initials: initials(g.client_first, g.client_last), pt_id: g.id_card || "",
      drug_name: g.vaccine_name, drug_dose: g.dose || "", drug_route: route, drug_start_date: g.given_on, drug_stop_date: g.given_on, drug_indication: "Vaccination", drug_batch_no: g.batch || "",
      reaction_start: g.given_on, notes: "Vaccinated " + dmy(g.given_on) + (g.site ? ", " + low(g.site) : "") + (g.dose ? ", " + low(g.dose) : "") + (g.batch ? ", batch " + g.batch + (g.expiry_date ? " (expires " + dmy(g.expiry_date) + ")" : "") : "") + "." };
    try { sessionStorage.setItem("eikon_pv_prefill", JSON.stringify(pre)); } catch (e) {}
    window.location.hash = "#pvreg";
  }
  function orderReaction(o) { // an order has no batch or site: the vaccines and the day only
    var its = o.items || [], d = String(o.created_at || "").slice(0, 10), day = E.maltaYmd ? E.maltaYmd(new Date(o.created_at)) || d : d;
    var pre = { at: Date.now(), from: "vaxreg", who: client(o), on: day, pt_initials: initials(o.client_first, o.client_last), drug_name: its.length ? its[0].name : "", drug_route: "IM", drug_start_date: day, drug_indication: "Vaccination", reaction_start: day,
      more_drugs: its.slice(1).map(function (it) { return it.name; }) };
    try { sessionStorage.setItem("eikon_pv_prefill", JSON.stringify(pre)); } catch (e) {}
    window.location.hash = "#pvreg";
  }

  function css() {
    if (document.getElementById("eikon-vaxreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-vaxreg-css";
    st.textContent =
      ".vxr{max-width:880px;margin:0 auto}" +
      ".vxr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".vxr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".vxr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.vxr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".vax-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".vax-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.vax-btn:disabled{opacity:.55;cursor:default}.vax-btn.t{border:0;background:none;color:var(--accent);padding:0 4px}" +
      ".vxr-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".vxr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.vxr-lab b{color:var(--text)}" +
      ".vxr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".vxr-row{display:flex;gap:12px;align-items:center;padding:11px 16px;border-top:.5px solid var(--border)}.vxr-row:first-child{border-top:0}.vxr-row.new{background:rgba(10,143,106,.08)}" +
      ".vxr-row .t{flex:1;min-width:0}.vxr-row b{font-size:15px;font-weight:600}.vxr-row .m{font-size:14px;margin-top:2px;overflow-wrap:anywhere}.vxr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".vxr-row .a{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}.vxr-row .a i{font-style:normal;font-size:12.5px;color:var(--muted);width:100%;text-align:right}" +
      ".vxr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".vxr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".vxr-form label>span{flex:0 0 104px;font-size:15px}.vxr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}.vxr-form label small{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}" +
      ".vxr-seg{display:flex;gap:6px;padding:8px 14px}.vxr-seg .vax-btn{flex:1}" +
      ".vxr-form .hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:12px 14px 4px;border-top:.5px solid var(--border);display:flex;justify-content:space-between;gap:8px}" +
      ".vxr-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 10px}.vxr-chips .vax-btn{height:auto;min-height:34px;padding:5px 12px;white-space:normal;text-align:left;line-height:1.25}" +
      ".vxr-chips .vax-btn em{display:block;font-style:normal;font-weight:400;font-size:12px;opacity:.85}" +
      ".vxr-form .ln{border-top:.5px solid var(--border);padding:0 14px}.vxr-form .ln .row{display:flex;align-items:center;gap:8px;min-height:44px}" +
      ".vxr-form .ln input.n{flex:1;min-width:0}.vxr-form .ln input.q{flex:0 0 56px;text-align:center;border:1px solid var(--border);border-radius:8px;padding:6px 4px;box-sizing:border-box}.vxr-form .ln .x{flex:0 0 32px;height:32px;padding:0;border-radius:16px}" +
      ".vxr-form .ln .hint{font-size:12.5px;color:var(--muted);padding:0 0 8px;margin-top:-4px}.vxr-form .ln .hint.lo{color:var(--danger)}" +
      ".vxr-form .note{font-size:13px;color:var(--muted);padding:8px 14px 0}.vxr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:space-between;align-items:center;flex-wrap:wrap}" +
      ".vxr-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".vxr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      // Quality pass (2026-11-03): sentence-case headings, figures that line up, errors beside their fields, a skeleton
      // while loading, and 44 px targets on a phone.
      ".vxr-lab,.vxr-form .hd{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none}.vxr-lab b,.vxr-row .m,.vxr-form .ln input.q,.vxr-form .ln .hint{font-variant-numeric:tabular-nums}" +
      ".vxr-form label{flex-wrap:wrap}.vxr-ferr{flex-basis:100%;margin:-6px 0 8px 116px;color:var(--danger);font-size:13px;font-weight:500}.vxr-form .ln .vxr-ferr{margin:0 0 8px}" +
      ".vxr-skel{display:block;height:64px;border-top:.5px solid var(--border);background:linear-gradient(90deg,rgba(118,118,128,.06),rgba(118,118,128,.14),rgba(118,118,128,.06));background-size:200% 100%;animation:vxrsk 1.2s linear infinite}.vxr-skel:first-of-type{border-top:0}" +
      "@keyframes vxrsk{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.vxr-skel{animation:none}}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .vxr-ferr{color:#FF7A72}}" + // 5:1 on the tinted row being typed in
      ".vxr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      // Vaccinations given, doses due, history (2026-11-09)
      ".vxr-top .acts2{display:flex;gap:8px;flex-wrap:wrap}.vxg-row{display:flex;gap:12px;align-items:center;padding:11px 16px;border-top:.5px solid var(--border)}.vxg-row:first-child{border-top:0}.vxg-row.new{background:rgba(10,143,106,.08)}" +
      ".vxg-row .t{flex:1;min-width:0}.vxg-row b{font-size:15px;font-weight:600}.vxg-row .m{font-size:14px;margin-top:2px;overflow-wrap:anywhere}.vxg-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}" +
      ".vxg-row .a{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}.vxg-row .a i{font-style:normal;font-size:13px;color:var(--muted);width:100%;text-align:right}" +
      ".vxg-name{border:0;background:none;padding:0;font:inherit;font-size:15px;font-weight:600;color:var(--accent);cursor:pointer;text-align:left;min-height:24px}.vxg-name:hover{text-decoration:underline}" +
      ".vxg-pill{display:inline-block;font-style:normal;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(118,118,128,.14);color:var(--muted);margin-left:6px;vertical-align:1px}" +
      ".vxg-pill.r{background:rgba(215,38,28,.12);color:var(--danger)}.vxg-pill.a{background:rgba(201,138,18,.16);color:var(--warn,#8A5A08)}.vxg-over{color:var(--danger);font-weight:600}" +
      ".vxg-more{margin:6px 0 0;min-height:34px}.vxg-to{margin-left:auto;font-weight:400}.vxg-hist h2{font-size:24px;margin:0;font-weight:700;letter-spacing:-.02em}" +
      ".vxg-ttl{font-size:17px;font-weight:700;padding:10px 14px 2px}.vxg-l{font-size:15px;padding:10px 14px 0;border-top:.5px solid var(--border)}" +
      ".vxg-seg{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px 10px}.vxg-seg .vax-btn{height:auto;min-height:34px;padding:6px 12px}.vxg-seg[aria-invalid=true] .vax-btn{border-color:var(--danger)}.vxg-segerr{display:block;margin:-4px 14px 8px!important}" +
      ".vxr-form label small:not(.vxr-ferr){color:var(--muted);font-weight:500}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .vxg-pill.r,html[data-ui2]:not([data-ui2-visit]) .vxg-over{color:#FF7A72}html[data-ui2]:not([data-ui2-visit]) .vxg-pill.a{color:#F2B84B}}" +
      "@media (max-width:600px){.vxg-row{flex-wrap:wrap}.vxg-row .a{width:100%;justify-content:flex-start}.vxg-row .a i{text-align:left}.vxg-seg .vax-btn{min-height:44px}.vxg-name{min-height:44px}.vxr-top .acts2{width:100%}.vxr-top .acts2 .vax-btn{flex:1}}" +
      "@media (max-width:600px){.vxr{padding:4px 16px 0}.vxr h1{font-size:32px}.vxr-form label>span{flex-basis:92px}.vxr-row{flex-wrap:wrap}.vxr-row .a{width:100%;justify-content:flex-start}.vxr-row .a i{text-align:left}" +
      ".vax-btn{height:44px;border-radius:22px}.vxr-chips .vax-btn{min-height:44px}.vxr-form .ln .x{flex-basis:44px;height:44px;border-radius:22px}.vxr-q{height:44px}.vxr-ferr{margin-left:0}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    var side = Promise.all([ // suggestions and stock: the screen works without them
      E.apiFetch("/vaccines/catalog", { method: "GET" }).then(function (r) { S.catalog = (r && r.items) || []; }).catch(function () {}),
      E.apiFetch("/vaccines/stock/rows", { method: "GET" }).then(function (r) { S.stock = (r && r.rows) || []; }).catch(function () {})
    ]);
    await Promise.all([side, loadGiven(), loadDue(), S.all200 ? loadAll(keepView) : null]); // the latest 200 orders only once a search needs them
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  async function loadAll(keepView) { // the latest 200 orders, for the search
    S.all200 = true;
    try {
      var r = await E.apiFetch("/vaccines/orders", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load vaccine orders");
      S.orders = r.orders || r.items || []; S.error = "";
    } catch (e) { S.all200 = false; if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load vaccine orders"); }
  }
  async function loadMonth() {
    var want = S.vm; S.vmLoading = true; S.vmErr = "";
    try {
      var r = await E.apiFetch("/vaccines/orders?month=" + encodeURIComponent(want), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load vaccine orders");
      if (want !== S.vm) return;
      S.vmOrders = (r.orders || r.items || []).slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id; });
    } catch (e) { if (want === S.vm) S.vmErr = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load vaccine orders"); }
    if (want !== S.vm) return;
    S.vmLoading = false; E.whenFormIdle(S.mount, paint);
  }
  // The month's orders on paper: one line per order (the classic screen prints one order at a time; this is the list).
  function printMonth() {
    var MB = E.months;
    MB.print({ register: "Vaccine orders", month: S.vm, landscape: true, sections: [{ cols: ["Date", "Client", "Phone", "Email", "For", "Vaccines"],
      rows: S.vmOrders.slice().reverse().map(function (o) { var its = o.items || []; return [when(o.created_at), client(o), o.phone || "", o.email || "", o.section === "travel" ? "Travel" + (o.country_name ? " to " + o.country_name : "") : o.section === "other" ? "Routine and other" : String(o.section || ""), its.map(function (it) { return it.name + " × " + (it.qty || 1); }).join(", ")]; }) }] });
  }
  function loadCountries() { // a 3.5 MB map file, fetched once and only when a travel order is being taken
    if (COUNTRIES || countriesLoading) return countriesLoading;
    countriesLoading = (async function () {
      try {
        var res = await fetch(E.uiUrl ? E.uiUrl("./world_hi_res_v4_palette.html") : "./world_hi_res_v4_palette.html", { method: "GET", cache: "force-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var html = await res.text(), seen = {}, out = [], ta = document.createElement("textarea");
        (html.match(/<g\b[^>]*\bclass="country"[^>]*>/g) || []).forEach(function (tag) {
          var iso = (/\bdata-iso="([A-Za-z]{2})"/.exec(tag) || [])[1], nm = (/\bdata-name="([^"]*)"/.exec(tag) || [])[1];
          if (!iso || !nm) return; iso = iso.toUpperCase(); ta.innerHTML = nm; nm = ta.value.trim();
          if (!nm || seen[iso]) return; seen[iso] = 1; out.push({ code: iso, name: nm, nn: normName(nm) });
        });
        if (!out.length) throw new Error("no countries");
        COUNTRIES = out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      } catch (e) { COUNTRIES = null; }
      countriesLoading = null;
      var dl = S.mount && S.mount.querySelector("#vxr-countries"); // only the suggestion list changes: no redraw under a tap
      if (dl && COUNTRIES) dl.innerHTML = COUNTRIES.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("");
      if (S.adding && S.adding.country && !S.adding.cc) resolveCountry();
    })();
    return countriesLoading;
  }

  function chip(v, on) {
    return '<button type="button" class="vax-btn' + (on ? " p" : "") + '" data-act="pick" data-v="' + S.catalog.indexOf(v) + '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(v.brand_name) + (v.vaccinates_for ? "<em>" + esc(v.vaccinates_for) + "</em>" : "") + "</button>";
  }
  function hasLine(name) { return S.adding.lines.some(function (l) { return low(l.name) === low(name); }); }

  function orderRow(o) {
    var its = o.items || [], sec = o.section === "travel" ? "Travel" + (o.country_name ? " to " + o.country_name : "") : o.section === "other" ? "Routine and other" : String(o.section || "");
    var acts = S.printFor === o.id
      ? '<i>' + (S.justSaved === o.id ? "Saved. Print it?" : "Print on") + '</i><button class="vax-btn" data-act="print-a4" data-id="' + o.id + '">A4</button><button class="vax-btn" data-act="print-rc" data-id="' + o.id + '">Receipt</button><button class="vax-btn t" data-act="print-no">Not now</button>'
      : '<button class="vax-btn t" data-act="print" data-id="' + o.id + '" aria-label="Print the order for ' + esc(client(o)) + '">Print</button>' +
        (S.givenMissing ? "" : '<button class="vax-btn" data-act="o-give" data-id="' + o.id + '" aria-label="Record the vaccination given to ' + esc(client(o)) + '">Record given</button>') +
        '<button class="vax-btn t" data-act="o-react" data-id="' + o.id + '" aria-label="Report a reaction after the order for ' + esc(client(o)) + '">Reaction</button>';
    return '<div class="vxr-row' + (S.justSaved === o.id ? " new" : "") + '"><div class="t"><b>' + esc(client(o)) + '</b><div class="m">' + (its.length ? its.map(function (it) { return esc(it.name) + " × " + esc(it.qty || 1); }).join(", ") : "No vaccines") + "</div><span>" +
      esc(when(o.created_at)) + " · " + esc(sec) + (o.phone ? " · " + esc(o.phone) : "") + (o.email ? " · " + esc(o.email) : "") + '</span></div><div class="a">' + acts + "</div></div>";
  }

  function skel(what) { return '<div class="vxr-list" aria-busy="true" style="margin-top:16px"><span class="vxr-sr" role="status">Opening ' + what + '</span><i class="vxr-skel"></i><i class="vxr-skel"></i><i class="vxr-skel"></i></div>'; }
  function trouble(msg) { return '<div class="vxr-quiet" role="alert">' + esc(msg) + ' <button type="button" class="vax-btn" data-act="retry" style="margin-left:6px">Try again</button></div>'; }
  // What a search changes: redrawn on its own while typing, so the search box is never rebuilt under the fingers.
  function resultsHtml() {
    var h = "", q = low(S.q);
    if (q) {
      var seenO = {}, pool = S.vmOrders.concat(S.orders).filter(function (o) { if (seenO[o.id]) return false; seenO[o.id] = 1; return true; });
      var gHit = S.given.filter(function (g) { return [g.client_first, g.client_last, person(g), g.phone, g.vaccine_name, g.batch].some(function (v) { return low(v).indexOf(q) >= 0; }); });
      var hit = pool.filter(function (o) {
        return [o.client_first, o.client_last, client(o), o.phone, o.email, o.country_name, o.country_code, o.section].concat((o.items || []).map(function (it) { return it.name; })).some(function (v) { return low(v).indexOf(q) >= 0; });
      });
      var n = hit.length + gHit.length;
      return h + '<div class="vxr-lab">Found <b>' + n + "</b>" + (S.all200 ? "" : " <span>(searching older orders…)</span>") + "</div>" + (n ? (gHit.length ? '<div class="vxr-list">' + gHit.map(function (g) { return givenRow(g); }).join("") + "</div>" : "") + (hit.length ? '<div class="vxr-list"' + (gHit.length ? ' style="margin-top:10px"' : "") + ">" + hit.map(orderRow).join("") + "</div>" : "")
        : '<div class="vxr-quiet">Nothing matches “' + esc(S.q.trim()) + '”. Try part of the surname, the phone number or the vaccine.</div>');
    }
    // the orders taken in one month, any month (this month first)
    var cur = S.vmOrders;
    h += E.months.bar(S.vm, { label: "Vaccines" });
    h += givenHtml();
    if (S.vmLoading && !cur.length) h += skel(E.months.label(S.vm));
    else if (S.vmErr) h += trouble(S.vmErr);
    else h += '<div class="vxr-lab">Vaccine orders · ' + esc(E.months.label(S.vm)) + " <b>" + cur.length + "</b></div>" + (cur.length ? '<div class="vxr-list">' + cur.map(orderRow).join("") + "</div>" : '<div class="vxr-quiet" data-empty>' + esc(E.months.empty(S.vm, "No vaccine order this month yet. Press New order when a client asks for one.")) + "</div>");
    return h;
  }
  function paintResults() {
    var m = S.mount, box = m && m.querySelector("#vxr-res"); if (!box) return paint();
    box.innerHTML = resultsHtml(); wireMonths(box); bind(box);
  }
  function wireMonths(root) { E.months.wire(root, { month: function () { return S.vm; }, go: function (v) { S.vm = v; S.vmOrders = []; S.given = []; loadMonth(); loadGiven().then(function () { E.whenFormIdle(S.mount, paint); }); paint(); }, paint: function () { paint(); }, print: printMonth }); }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "vaxreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    if (S.giving && !S.gsaving && !fromState) keepG();
    var qi = m.querySelector("#vxr-q"); if (qi) S.q = qi.value;
    var h = '<div class="vxr"><button class="vxr-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("vaxreg")) + '</button>' +
      '<div class="vxr-top"><div><h1>Vaccines</h1><p class="vxr-sub">Vaccinations given, doses due, and vaccines ordered for clients.</p></div>' +
      (S.adding || S.giving ? "" : '<div class="acts2">' + (S.givenMissing ? "" : '<button class="vax-btn p" data-act="give">Record a vaccination</button>') + '<button class="vax-btn' + (S.givenMissing ? " p" : "") + '" data-act="add">New order</button></div>') + "</div>";
    if (S.giving) h += givingHtml();
    if (S.adding) {
      var a = S.adding, travel = a.section === "travel";
      var fe = S.fe || {};
      var fld = function (k, label, extra, hint) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + (fe[k] ? ' aria-invalid="true" aria-describedby="vxr-e-' + k + '"' : "") + ">" + (hint || "") + (fe[k] ? '<small class="vxr-ferr" id="vxr-e-' + k + '">' + esc(fe[k]) + "</small>" : "") + "</label>"; };
      h += '<form class="vxr-form" id="vxr-add" autocomplete="off">' +
        '<div class="vxr-seg" role="group" aria-label="Kind of order"><button type="button" class="vax-btn' + (travel ? " p" : "") + '" data-act="sec" data-sec="travel" aria-pressed="' + travel + '">Travel</button><button type="button" class="vax-btn' + (travel ? "" : " p") + '" data-act="sec" data-sec="other" aria-pressed="' + !travel + '">Routine and other</button></div>';
      if (travel) {
        h += fld("country", "Country", ' list="vxr-countries" placeholder="e.g. Kenya"', a.cc ? "<small>" + esc(a.cc) + "</small>" : "");
        if (a.cc) {
          var rec = recommend(a.cc);
          if (rec.always.length) h += '<div class="hd"><span>Recommended for ' + esc(a.country) + "</span></div>" + '<div class="vxr-chips">' + rec.always.map(function (v) { return chip(v, hasLine(v.brand_name)); }).join("") + "</div>";
          if (rec.high.length) h += '<div class="hd"><span>If at higher risk</span></div><div class="vxr-chips">' + rec.high.map(function (v) { return chip(v, hasLine(v.brand_name)); }).join("") + "</div>";
          if (!rec.always.length && !rec.high.length) h += '<div class="note" style="padding-bottom:8px">The vaccine database has no recommendation for ' + esc(a.country) + ". Add the vaccines below.</div>";
        }
      } else {
        var rt = S.catalog.filter(isRoutine).sort(function (x, y) { return String(x.brand_name).localeCompare(String(y.brand_name)); });
        if (rt.length) h += '<div class="hd"><span>Routine in Malta</span></div><div class="vxr-chips">' + rt.map(function (v) { return chip(v, hasLine(v.brand_name)); }).join("") + "</div>";
      }
      h += '<div class="hd"><span>Vaccines</span><span>Qty</span></div>' + a.lines.map(function (l, i) {
        var s = l.name ? stockFor(l.name) : null, le = fe["line" + i];
        return '<div class="ln"><div class="row"><input class="n" data-i="' + i + '" data-k="name" list="vxr-names" value="' + esc(l.name) + '" placeholder="Vaccine name" aria-label="Vaccine ' + (i + 1) + '"' + (fe.items && i === 0 ? ' aria-invalid="true" aria-describedby="vxr-e-items"' : "") + ">" +
          '<input class="q" data-i="' + i + '" data-k="qty" inputmode="numeric" value="' + esc(l.qty) + '" aria-label="Quantity of vaccine ' + (i + 1) + '"' + (le ? ' aria-invalid="true" aria-describedby="vxr-e-line' + i + '"' : "") + ">" +
          (a.lines.length > 1 ? '<button type="button" class="vax-btn x" data-act="rm" data-i="' + i + '" aria-label="Remove vaccine ' + (i + 1) + '">✕</button>' : "") + "</div>" +
          (s ? '<div class="hint' + (s.qty <= 0 ? " lo" : "") + '">' + (s.qty <= 0 ? "None in stock" : s.qty + " in stock") + (s.exp ? " · earliest expiry " + esc(dmy(s.exp)) : "") + "</div>" : "") +
          (le ? '<small class="vxr-ferr" id="vxr-e-line' + i + '">' + esc(le) + "</small>" : "") + (fe.items && i === 0 ? '<small class="vxr-ferr" id="vxr-e-items">' + esc(fe.items) + "</small>" : "") + "</div>";
      }).join("") +
        '<div class="acts" style="padding-top:2px"><button type="button" class="vax-btn t" data-act="line">Add a vaccine</button></div>' +
        '<div class="hd"><span>Client</span></div>' +
        fld("client_first", "Name", ' autocapitalize="words" autocomplete="off"') + fld("client_last", "Surname", ' autocapitalize="words"') +
        fld("phone", "Phone", ' type="tel" inputmode="tel"') + fld("email", "Email", ' type="email" inputmode="email" autocapitalize="off" placeholder="Optional"') +
        '<div class="note">Saving takes these vaccines off stock.</div>' + (S.err ? '<div class="vxr-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts" style="justify-content:flex-end"><button type="button" class="vax-btn" data-act="add-cancel">Cancel</button><button type="submit" class="vax-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save order") + "</button></div>" +
        '<datalist id="vxr-names">' + uniq(S.catalog.map(function (v) { return v.brand_name; }).concat(S.stock.map(function (r) { return r.vaccine_name; }))).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
        '<datalist id="vxr-countries">' + (COUNTRIES || []).map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("") + "</datalist></form>";
    }
    if (S.hist && !S.giving) h += histHtml();
    else if (S.loading && !S.given.length && !S.vmOrders.length && !S.due.length) h += skel("vaccines");
    else {
      if (S.openStock) h += '<div class="vxr-quiet" id="vxr-stock" role="status" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px"><span>Vaccine stock, batches and expiry are kept in the classic screen.</span><button type="button" class="vax-btn" data-act="classic">Open vaccine stock</button></div>';
      h += dueHtml();
      if (S.error && S.q) h += trouble(S.error);
      h += '<input class="vxr-q" id="vxr-q" type="search" autocomplete="off" aria-label="Search vaccinations and orders" placeholder="Name, phone, vaccine or batch" value="' + esc(S.q) + '">';
      h += '<div id="vxr-res">' + resultsHtml() + "</div>";
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Search covers this month’s vaccinations and the latest 200 orders. Stock, batches and expiry, the vaccine database and printed tables are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, keepSel = "";
    if (ae && m.contains(ae)) keepSel = ae.id === "vxr-q" ? "#vxr-q" : ae.name ? "[name=" + ae.name + "]" : ae.getAttribute("data-k") ? '[data-i="' + ae.getAttribute("data-i") + '"][data-k="' + ae.getAttribute("data-k") + '"]' :
      ae.getAttribute("data-act") ? '[data-act="' + ae.getAttribute("data-act") + '"]' + ["data-sec", "data-v", "data-i", "data-id"].map(function (k) { return ae.hasAttribute(k) ? "[" + k + '="' + ae.getAttribute(k) + '"]' : ""; }).join("") : "";
    m.innerHTML = h;
    if (keepSel) { var again = m.querySelector(keepSel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } } // typing keeps its place
    wireMonths(m);
    bind(m);
    pick(m);
  }
  function pick(m) { // people already known to this pharmacy, as in every register form (E.personPick)
    if (!E.personPick) return;
    var split = function (f) { return function (x) { if (!x || x.how !== "pick" || x.field !== "name") return; var fi = f.querySelector("[name=client_first]"), la = f.querySelector("[name=client_last]"); if (!fi || !la) return;
      var parts = String(fi.value || "").trim().split(/\s+/); if (parts.length > 1 && !String(la.value || "").trim()) { la.value = parts.pop(); fi.value = parts.join(" "); } }; };
    var fo = m.querySelector("#vxr-add"), fg = m.querySelector("#vxg-add");
    try { if (fo) E.personPick.attach({ key: "vaxreg", form: fo, fields: { name: "client_first", phone: "phone" }, onFill: split(fo) }); } catch (e) {}
    try { if (fg) E.personPick.attach({ key: "vaxgiven", form: fg, fields: { name: "client_first", phone: "phone" }, onFill: split(fg) }); } catch (e) {}
  }
  function bind(root) {
    var m = S.mount;
    root.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (act === "back") window.location.hash = E.ui2BackHash("vaxreg");
        else if (act === "retry") { if (S.givenErr) { loadGiven().then(function () { paint(); }); } if (S.error) { S.error = ""; loadAll().then(paintResults); } else { S.vmOrders = []; loadMonth(); paint(); } }
        else if (act === "give") startGiving();
        else if (act === "give-cancel") closeGiving();
        else if (act === "gdose" || act === "gsite" || act === "gcons") {
          keepG(); var k = act === "gdose" ? "dose" : act === "gsite" ? "site" : "consent_by", v0 = b.getAttribute("data-v");
          S.giving[k] = act === "gdose" && S.giving.dose === v0 ? "" : v0; if (S.gfe && S.gfe[k]) delete S.gfe[k]; paint(true);
        }
        else if (act === "gv-pick") { keepG(); S.giving.vaccine_name = b.getAttribute("data-v"); fillBatch(); paint(true); focus("#vxg-add [data-act=gdose]"); }
        else if (act === "gnext") {
          keepG(); var gv = b.getAttribute("data-v"), base0 = realYmd(S.giving.given_on) ? S.giving.given_on : todayY();
          S.giving.next_due = gv === "no" ? "" : ymdAdd(base0, 0, gv === "1m" ? 1 : gv === "6m" ? 6 : 12);
          var nd0 = S.mount.querySelector("#vxg-add [name=next_due]"); if (nd0) { nd0.value = S.giving.next_due; nd0.removeAttribute("aria-invalid"); }
        }
        else if (act === "due-give" || act === "hist" || act === "react") {
          var gid = Number(b.getAttribute("data-gid")), g = S.due.concat(S.given, (S.hist && S.hist.rows) || []).filter(function (x) { return x.id === gid; })[0]; if (!g) return;
          if (act === "react") reaction(g);
          else if (act === "hist") { S.hist = { first: g.client_first, last: g.client_last, phone: g.phone || "", rows: [], loading: true, err: "" }; paint(true); window.scrollTo(0, 0); loadHist(); focus("[data-act=hist-close]"); }
          else startGiving({ client_first: g.client_first, client_last: g.client_last, phone: g.phone || "", vaccine_name: g.vaccine_name, dose: nextDose(g.dose), site: g.site || mem().site });
        }
        else if (act === "due-all") { S.dueAll = !S.dueAll; paint(true); focus("[data-act=due-all]"); }
        else if (act === "due-close") { S.closing = Number(b.getAttribute("data-gid")); paint(true); focus('[data-act=due-close-yes]'); }
        else if (act === "due-close-no") { var cid = S.closing; S.closing = 0; paint(true); focus('[data-act=due-close][data-gid="' + cid + '"]'); }
        else if (act === "due-close-yes") closeRecall(Number(b.getAttribute("data-gid")));
        else if (act === "hist-close") { S.hist = null; paint(true); focus("#vxr-q"); }
        else if (act === "hist-retry") loadHist();
        else if (act === "hist-give") { var hh = S.hist; startGiving({ client_first: hh.first, client_last: hh.last, phone: hh.phone }); }
        else if (act === "o-give" || act === "o-react") {
          var oo = S.vmOrders.concat(S.orders).filter(function (x) { return x.id === id; })[0]; if (!oo) return;
          if (act === "o-react") orderReaction(oo);
          else startGiving({ client_first: oo.client_first, client_last: oo.client_last, phone: oo.phone || "", vaccine_name: (oo.items && oo.items[0] && oo.items[0].name) || "", order_id: oo.id });
        }
        else if (act === "add") { S.giving = null; S.hist = null; S.adding = { section: lastSection(), country: "", cc: "", lines: [{ name: "", qty: "1" }] }; S.err = ""; S.printFor = 0; S.justSaved = 0; paint(true); if (S.adding.section === "travel") { loadCountries(); focus("[name=country]"); } else focus('.vxr-form [data-i="0"][data-k=name]'); }
        else if (act === "add-cancel") closeAdd();
        else if (act === "sec") { keep(); S.adding.section = b.getAttribute("data-sec"); try { localStorage.setItem(secKey(), S.adding.section); } catch (x) {} if (S.adding.section === "travel") loadCountries(); paint(true); var sb = m.querySelector('[data-act=sec][data-sec="' + S.adding.section + '"]'); if (sb) sb.focus(); }
        else if (act === "pick") {
          keep(); var v = S.catalog[Number(b.getAttribute("data-v"))]; if (!v) return;
          var L2 = S.adding.lines, at = -1; L2.forEach(function (l, i) { if (low(l.name) === low(v.brand_name)) at = i; });
          if (at >= 0) { L2.splice(at, 1); if (!L2.length) L2.push({ name: "", qty: "1" }); }
          else { var empty = L2.filter(function (l) { return !l.name; })[0]; if (empty) { empty.name = v.brand_name; empty.qty = empty.qty || "1"; } else L2.push({ name: v.brand_name, qty: "1" }); }
          var vi = b.getAttribute("data-v"); paint(true); var nb = m.querySelector('[data-act=pick][data-v="' + vi + '"]'); if (nb) nb.focus();
        }
        else if (act === "line") { keep(); S.adding.lines.push({ name: "", qty: "1" }); paint(true); var ins = m.querySelectorAll(".vxr-form .ln input.n"); if (ins.length) ins[ins.length - 1].focus(); }
        else if (act === "rm") { keep(); S.adding.lines.splice(Number(b.getAttribute("data-i")), 1); paint(true); var add = m.querySelector("[data-act=line]"); if (add) add.focus(); }
        else if (act === "print") { S.printFor = id; S.justSaved = 0; paint(); var a4 = m.querySelector('[data-act=print-a4][data-id="' + id + '"]'); if (a4) a4.focus(); }
        else if (act === "print-a4" || act === "print-rc") { var o = S.orders.concat(S.vmOrders).find(function (x) { return x.id === id; }); if (o) printOrder(o, act === "print-rc" ? "RECEIPT" : "A4"); S.printFor = 0; S.justSaved = 0; paint(); }
        else if (act === "print-no") { S.printFor = 0; S.justSaved = 0; paint(); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "vaxreg"); } catch (x) {} E.openClassic("vaccines"); }
      });
    });
    var qn = root.querySelector("#vxr-q");
    if (qn) {
      qn.addEventListener("input", function () { S.q = qn.value; paintResults(); if (S.q.trim() && !S.all200 && !S.allLoading) { S.allLoading = true; loadAll().then(function () { S.allLoading = false; if (S.q.trim()) paintResults(); }); } });
      qn.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && qn.value) { ev.preventDefault(); qn.value = ""; S.q = ""; paintResults(); } });
    }
    var f = root.querySelector("#vxr-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !document.querySelector(".epp-list:not([hidden])")) { keep(); var a0 = S.adding || {}; var typed = F.some(function (k) { return a0[k]; }) || a0.lines.some(function (l) { return l.name; }); if (!typed) { ev.preventDefault(); closeAdd(); } } }); // Escape closes an empty form; typing is never thrown away
      f.addEventListener("input", function (ev) { var el = ev.target; if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); var s0 = el.closest("label,.ln"); s0 = s0 && s0.querySelector(".vxr-ferr"); if (s0) s0.remove(); } });
      var cn = f.querySelector("[name=country]");
      if (cn) {
        cn.addEventListener("focus", function () { loadCountries(); });
        cn.addEventListener("input", function () { if (S.adding.cc && low(cn.value) !== low(S.adding.country)) { S.adding.cc = ""; } clearTimeout(S.cT); S.cT = setTimeout(function () { if (COUNTRIES && countryMatches(cn.value).length && COUNTRIES.some(function (c) { return low(c.name) === low(cn.value); })) resolveCountry(); }, 250); });
        cn.addEventListener("change", function () { setTimeout(resolveCountry, 0); }); // after focus has moved on, so a Tab is not undone
        cn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); resolveCountry(); } }); // Enter takes the top match, as in the classic screen
      }
      f.querySelectorAll(".ln input.n").forEach(function (el) { el.addEventListener("change", function () { hint(el); }); }); // shows what stock holds for it, in place
    }
    var fg = root.querySelector("#vxg-add");
    if (fg) {
      fg.addEventListener("submit", function (ev) { ev.preventDefault(); saveGiven(); });
      fg.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !document.querySelector(".epp-list:not([hidden])")) { keepG(); var a0 = S.giving || {}; if (!a0.client_first && !a0.client_last && !a0.vaccine_name && !a0.order_id) { ev.preventDefault(); closeGiving(); } } });
      fg.addEventListener("input", function (ev) { var el = ev.target; if (el && el.name === "batch" && S.giving) { S.giving.batchFrom = ""; var sm = el.closest("label").querySelector("small:not(.vxr-ferr)"); if (sm) sm.remove(); }
        if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); var s0 = el.closest("label"); s0 = s0 && s0.querySelector(".vxr-ferr"); if (s0) s0.remove(); } });
      var vn = fg.querySelector("[name=vaccine_name]");
      if (vn) vn.addEventListener("change", function () { // the remembered batch and expiry come in place, without a redraw under the fingers
        if (!S.giving) return; S.giving.vaccine_name = vn.value.trim(); var bi = fg.querySelector("[name=batch]"), ei = fg.querySelector("[name=expiry_date]");
        if (bi) S.giving.batch = bi.value.trim(); if (!fillBatch()) return;
        if (bi) { bi.value = S.giving.batch; var lb = bi.closest("label"), sm = lb.querySelector("small:not(.vxr-ferr)"); if (sm) sm.remove(); if (S.giving.batchFrom) { var n0 = document.createElement("small"); n0.textContent = S.giving.batchFrom; lb.insertBefore(n0, lb.querySelector(".vxr-ferr")); } }
        if (ei) ei.value = S.giving.expiry_date;
      });
    }
  }
  function hint(el) {
    var ln = el.closest(".ln"), old = ln && ln.querySelector(".hint"), s = el.value.trim() ? stockFor(el.value) : null;
    if (old) old.remove(); if (!ln || !s) return;
    var d = document.createElement("div"); d.className = "hint" + (s.qty <= 0 ? " lo" : "");
    d.textContent = (s.qty <= 0 ? "None in stock" : s.qty + " in stock") + (s.exp ? " · earliest expiry " + dmy(s.exp) : ""); ln.appendChild(d);
  }
  function resolveCountry() { // the best match becomes the country, its recommendations appear
    keep(); var a = S.adding; if (!a || a.section !== "travel") return;
    if (!a.country) { if (a.cc) { a.cc = ""; paint(true); } return; }
    if (!COUNTRIES) return; // still loading: done when the list arrives
    var best = COUNTRIES.filter(function (c) { return low(c.name) === low(a.country); })[0] || countryMatches(a.country)[0];
    if (best && (best.code !== a.cc || best.name !== a.country)) { a.cc = best.code; a.country = best.name; paint(true); }
  }
  function closeAdd() { S.adding = null; S.err = ""; S.fe = {}; paint(true); setTimeout(function () { var b = S.mount && S.mount.querySelector(".vxr-top [data-act=add]"); if (b) b.focus(); }, 0); }
  function focus(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); var ae = document.activeElement; if (x && !(ae && ae !== document.body && S.mount.contains(ae) && ae.closest && ae.closest("form"))) x.focus(); }, 30); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x || "").trim(); if (k && !seen[low(k)]) { seen[low(k)] = 1; out.push(k); } }); return out.sort(function (x, y) { return x.localeCompare(y); }); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#vxr-add"); if (!f || !S.adding) return;
    F.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
    f.querySelectorAll("[data-k]").forEach(function (el) { var l = S.adding.lines[Number(el.getAttribute("data-i"))]; if (l) l[el.getAttribute("data-k")] = String(el.value || "").trim(); });
  }

  async function add() {
    if (S.saving) return;
    keep(); resolveCountry();
    var a = S.adding; S.err = "";
    var travel = a.section === "travel", items = buildItems(a.lines);
    var fe = {}, first = "";
    a.lines.forEach(function (l, i) { if (l.name && (!/^\d+$/.test(l.qty) || Number(l.qty) < 1)) { fe["line" + i] = "Write how many of " + l.name + " (a whole number)."; first = first || '[data-i="' + i + '"][data-k=qty]'; } }); // a line with no vaccine is left out
    if (!items.length && !Object.keys(fe).length) { fe.items = "Add at least one vaccine."; first = first || '[data-i="0"][data-k=name]'; }
    if (travel && a.country && !a.cc) { fe.country = (COUNTRIES ? "Choose the country from the list" : "The country list is still loading. Wait a moment") + ", or leave it empty."; first = first || "[name=country]"; }
    if (!a.client_first) { fe.client_first = "Write the client's name."; first = first || "[name=client_first]"; }
    if (!a.client_last) { fe.client_last = "Write the client's surname."; first = first || "[name=client_last]"; }
    if (!a.phone) { fe.phone = "Write the client's phone number."; first = first || "[name=phone]"; }
    S.fe = fe; S.err = Object.keys(fe).length ? Object.keys(fe).map(function (k) { return fe[k]; }).join(" ") + " Nothing was saved." : "";
    if (S.err) { paint(true); var fx = S.mount.querySelector("#vxr-add " + first); if (fx) fx.focus(); return; }
    // the same body the classic screen sends
    var body = { section: travel ? "travel" : "other", country_code: travel ? (a.cc || "") : "", country_name: travel ? (a.country || "") : "", client_first: a.client_first, client_last: a.client_last, phone: a.phone, email: a.email || "", items: items };
    S.saving = true; paint(true);
    var since = Date.now() - 10 * 60 * 1000, sig = JSON.stringify(items.map(function (it) { return [low(it.name), it.qty]; }));
    try {
      var r = await E.postOnce("/vaccines/orders", body, {
        list: async function () { var r0 = await E.apiFetch("/vaccines/orders", { method: "GET" }); return (r0 && r0.ok && (r0.orders || r0.items)) || []; },
        same: function (o) { return new Date(o.created_at).getTime() >= since && low(o.client_first) === low(body.client_first) && low(o.client_last) === low(body.client_last) && String(o.phone || "").trim() === body.phone && o.section === body.section &&
          JSON.stringify((o.items || []).map(function (it) { return [low(it.name), toInt(it.qty, 1)]; }).sort()) === JSON.stringify(JSON.parse(sig).sort()); }
      });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; S.fe = {}; E.toast("Saved · order for " + body.client_first + " " + body.client_last, "success");
      if (E.linkPerson) E.linkPerson({ name: body.client_first + " " + body.client_last, phone: body.phone, email: body.email }, "register:vaccines"); // one person in Customers, found or added
      var oid = r.order && r.order.id; if (oid) { S.printFor = oid; S.justSaved = oid; } // like the classic screen, offer to print it straight away
      S.q = "";
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; if (!S.adding) { S.vm = E.months.now(); S.vmOrders = []; loadMonth(); } await load();
    if (S.printFor) { var a4 = S.mount && S.mount.querySelector('[data-act=print-a4][data-id="' + S.printFor + '"]'); if (a4) a4.focus(); } // the form is gone: focus goes to the print offer
  }

  // Printing: the classic screen's layout, unchanged (A4, or a 75 mm receipt that fits its length)
  function printShell(title, bodyHtml, size) {
    var isReceipt = size === "RECEIPT";
    var pageCss = isReceipt ? "@page{size:75mm 40mm;margin:0}" : "@page{size:A4;margin:12mm}";
    var base = "*,*::before,*::after{box-sizing:border-box;}html,body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;padding:0;}" +
      (isReceipt ? "body{width:75mm;}#paper{padding:6mm;}#content{display:inline-block;width:100%;}" : "") +
      "h1{margin:0 0 10px 0;font-size:" + (isReceipt ? "16px" : "18px") + "}" +
      "table{width:100%;border-collapse:collapse;font-size:" + (isReceipt ? "11px" : "12px") + "}" +
      "th,td{border-bottom:1px solid #ddd;padding:" + (isReceipt ? "4px 4px" : "6px 6px") + ";vertical-align:top}" +
      "th{text-align:left;background:#f6f6f6}.muted{color:#666}.row{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}" +
      ".pill{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:3px 8px;font-size:11px;background:#fafafa}";
    return "<!doctype html><html><head><meta charset='utf-8'/><title>" + esc(title || "Print") + "</title><style id='pageSizeStyle'>" + pageCss + "</style><style>" + base + "</style></head><body>" +
      (isReceipt ? "<div id='paper'><div id='content'>" + bodyHtml + "</div></div>" : bodyHtml) + "</body></html>";
  }
  function printOrder(o, size) {
    var items = o.items || [];
    var rows = items.map(function (it) { return "<tr><td><b>" + esc(it.name || "") + "</b></td><td style='text-align:right'>" + esc(it.qty || 1) + "</td></tr>"; }).join("");
    var body = "<h1>Vaccine order</h1><div class='row'><span class='pill'><b>Created</b> " + esc(o.created_at || "") + "</span><span class='pill'><b>Section</b> " + esc(o.section || "") + "</span>" +
      (o.country_name ? "<span class='pill'><b>Country</b> " + esc(o.country_name) + " (" + esc(o.country_code || "") + ")</span>" : "") + "</div>" +
      "<div style='margin:10px 0'><div><b>Client:</b> " + esc((o.client_first || "") + " " + (o.client_last || "")) + "</div><div><b>Phone:</b> " + esc(o.phone || "") + "</div>" + (o.email ? "<div><b>Email:</b> " + esc(o.email) + "</div>" : "") + "</div>" +
      "<table><thead><tr><th>Vaccine</th><th style='text-align:right'>Qty</th></tr></thead><tbody>" + (rows || "<tr><td colspan='2' class='muted'>No items</td></tr>") + "</tbody></table>";
    var w = window.open("", "_blank");
    if (!w) { E.toast("The browser blocked the print window. Allow pop-ups for Eikon and press Print again.", "warn"); return; }
    try { w.document.open(); w.document.write(printShell("Vaccine order", body, size)); w.document.close(); } catch (e) {}
    try { w.focus(); } catch (e2) {}
    E.printTab(w, { delay: 120, focus: true, onReady: function (pw, doc) { if (doc.getElementById("paper")) E.fitReceiptPage(doc); } });
  }

  // Opened from Today's services (V-C2, the 16:31 directive): sessionStorage eikon_svc_open { to: "vaxreg", f, p, at }, taken
  // once, under a minute old. f "due": the doses due, on that person's dose (p = the vaccination's id; all of them shown when
  // it is past the first five, or when the hub asked for every dose due); f "stock": the stock and expiry are in the classic
  // screen, so a line says so with the way there.
  function takeOpen() {
    var so = null; try { so = JSON.parse(sessionStorage.getItem("eikon_svc_open") || "null"); } catch (e) { so = null; }
    if (!so || so.to !== "vaxreg") return null;
    try { sessionStorage.removeItem("eikon_svc_open"); } catch (e) {}
    return Date.now() - Number(so.at || 0) < 60000 && (so.f === "due" || so.f === "stock") ? { f: so.f, p: Number(so.p) || 0 } : null;
  }
  function applyOpen(o) {
    if (!o || !S.mount || E.state.activeModuleId !== "vaxreg") return;
    if (o.f === "stock") { S.openStock = true; paint(true); focus("#vxr-stock [data-act=classic]"); return; }
    var i = -1; S.due.forEach(function (g, k) { if (i < 0 && g.id === o.p) i = k; });
    if (i >= 5 || (!o.p && S.due.length > 5)) S.dueAll = true;
    S.openGid = i >= 0 ? o.p : 0; paint(true);
    var sel = i >= 0 ? '.vxg-due [data-act=due-give][data-gid="' + o.p + '"]' : ".vxg-due [data-act=due-give]";
    setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); if (!x) return; try { x.scrollIntoView({ block: "center" }); } catch (e) {} if (E.focusIfIdle) E.focusIfIdle(x); else x.focus(); }, 30);
  }

  E.registerModule({
    id: "vaxreg", title: "Vaccines", order: 3, icon: "✚", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.err = ""; S.fe = {}; S.q = ""; S.printFor = 0; S.justSaved = 0; S.vm = E.months.now(); S.vmOrders = [];
      S.giving = null; S.gfe = {}; S.gerr = ""; S.hist = null; S.closing = 0; S.justGiven = 0; S.given = []; S.due = []; S.all200 = false; S.orders = []; S.error = ""; S.openGid = 0; S.openStock = false;
      var so = takeOpen(); E.months.reset(); css(); paint(); loadMonth(); var ld = load(); if (so) ld = ld.then(function () { applyOpen(so); });
      return E.takeOpenForm("vaxreg", S.mount, ld, { btn: "[data-act=add]", form: "#vxr-add" } /* q5-2: a half-typed form comes back */, null); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("vaxreg") < 0) E.UI2_DESTINATIONS.push("vaxreg");
  if (E.UI2_PARENT) E.UI2_PARENT.vaxreg = "services";
})();
