/* ============================================================
   EIKON — Customers  (modules.customers.js)
   One person, one row. Built on the shared people routes:
     GET  /people?q=        people first, then people found only in history
     GET  /people/:id       the person and their story across every register
     POST /people           create, adopt from history, or update with a version
   - Search as you type; a name, an ID card or a phone number all work
   - A customer who only exists in old registers is adopted with one tap
   - Nothing says "Saved" before the server says so; a stale edit is shown, not lost
   - Registers stay one tap away, with the person carried across
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var state = { mount: null, q: "", also: {}, results: null, loading: false, error: "", selected: null, detail: null, detailLoading: false, editing: false, saving: false, timer: null, seq: 0 };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function initials(name) {
    var p = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
  }
  function hue(name) { var h = 0; for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % 360; return h; }
  function av(name, cls) { return '<span class="cus-av ' + (cls || "") + '" style="background:hsl(' + hue(name) + ' 45% 32%)">' + esc(initials(name)) + '</span>'; }
  function when(ymd) {
    if (!ymd) return "";
    var t = new Date(); var today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    if (ymd === today) return "today";
    var d = new Date(ymd + "T12:00:00"); if (!isFinite(d.getTime())) return ymd;
    var diff = Math.round((new Date(today + "T12:00:00") - d) / 86400000);
    if (diff === 1) return "yesterday";
    if (diff > 1 && diff < 7) return diff + " days ago";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + (d.getFullYear() !== t.getFullYear() ? " " + d.getFullYear() : "");
  }
  function nextWhen(ymd) {
    var t = new Date(); var today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    if (ymd === today) return "Today";
    var d = new Date(ymd + "T12:00:00"); if (!isFinite(d.getTime())) return ymd;
    var diff = Math.round((d - new Date(today + "T12:00:00")) / 86400000);
    if (diff === 1) return "Tomorrow";
    if (diff > 1 && diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  // One word for every kind of record the server's people search returns (PEOPLE_SOURCES in the worker; a UI test
  // reads that list, so a kind added there without a word here fails the suite). Unknown: "record", never "undefined".
  var WORDS = { order: ["order", "orders"], question: ["question", "questions"], delivery: ["delivery", "deliveries"], dda_sale: ["DDA sale", "DDA sales"], poyc: ["POYC", "POYC"],
    repeat: ["repeat prescription", "repeat prescriptions"], poct: ["POCT", "POCT"], loyalty: ["loyalty card", "loyalty cards"], appointment: ["appointment", "appointments"],
    waitlist: ["waiting list", "waiting lists"], calculator: ["calculator record", "calculator records"], booking: ["booking", "bookings"], booking_waitlist: ["Bookings waiting list", "Bookings waiting lists"],
    vaccine: ["vaccine order", "vaccine orders"], credit_note: ["credit note", "credit notes"], contact: ["contact", "contacts"] };
  function sourceWords(sources) {
    return Object.keys(sources || {}).map(function (k) { var n = Number(sources[k]) || 0, w = WORDS[k] || ["record", "records"]; return n + " " + w[n === 1 ? 0 : 1]; }).join(", ");
  }
  E.customersSourceWords = sourceWords; // for the tests
  E.customersSourceKinds = Object.keys(WORDS);
  // A delivery's title comes as its stored item list (JSON): show the item names, never the raw text.
  function storyTitle(t) {
    var s = String(t || "").trim(); if (s.charAt(0) !== "[") return s;
    try { var a = JSON.parse(s); if (Array.isArray(a)) return a.map(function (i) { return i && typeof i === "object" ? String(i.name || "").trim() : String(i || "").trim(); }).filter(Boolean).join(", "); } catch (e) {}
    return s;
  }
  E.customersStoryTitle = storyTitle; // for the tests
  function kindMeta(kind) {
    return ({ order: ["Order", "#clientorders", "blu"], question: ["Question", "#tickets", "amb"], delivery: ["Delivery", "#deliveries", "blu"], dda_sale: ["DDA sale", "#dda-sales", "red"], poyc: ["POYC", "#dda-poyc", "red"],
      repeat: ["Repeat prescription", "#repeatprescriptions", "grn"], poct: ["POCT", "#poct", "grn"], loyalty: ["Loyalty", "#loyalty", "gry"], appointment: ["Appointment", "#appointments", "blu"], waitlist: ["Waiting list", "#appointments", "gry"], calculator: ["Calculator", "#pharmacycalc", "gry"],
      booking: ["Booking", "#bookings", "blu"], booking_waitlist: ["Bookings waiting list", "#bookings", "gry"], vaccine: ["Vaccine order", "#vaccines", "grn"], credit_note: ["Credit note", "#creditnotes", "gry"], contact: ["Contact", "#contacts", "gry"] })[kind] || ["Record", "#dashboard", "gry"];
  }

  function injectCss() {
    if (document.getElementById("eikon-customers-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-customers-css";
    st.textContent =
      ".cus{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:360px minmax(0,1fr);gap:18px;align-items:start}" +
      ".cus-back{display:none}@media (max-width:900px){.cus{grid-template-columns:minmax(0,1fr)}.cus-side,.cus-detail{min-width:0}.cus-detail{order:-1}.cus-pick{display:none}.cus.has-sel .cus-side{display:none}.cus-back{display:inline-block;border:0;background:none;color:var(--accent);font:inherit;font-size:16px;font-weight:500;padding:4px 0 12px;cursor:pointer}}@media (max-width:600px){.cus{padding:0 16px}.cus-search input,.cus-form input,.cus-form textarea{font-size:16px}.cus-form input{height:44px}}" +
      ".cus-ferr{display:block;font-size:12.5px;font-weight:600;color:var(--danger);margin-top:4px}.cus-form [aria-invalid=true],.cus-form [aria-invalid=true]:focus{border-color:var(--danger)}" +
      ".cus-search{display:flex;align-items:center;gap:10px;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:0 14px;height:48px}" +
      ".cus-search input{flex:1;border:0;outline:0;background:transparent;color:var(--text);font-size:15.5px;min-width:0}.cus-search input::placeholder{color:var(--muted)}" +
      ".cus-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 2px 7px;display:flex;gap:8px;align-items:center}.cus-lab b{color:var(--text)}.cus-lab a{margin-left:auto;color:var(--accent);font-weight:600;text-transform:none;letter-spacing:0;font-size:12.5px;cursor:pointer}" +
      ".cus-list{display:flex;flex-direction:column;gap:8px}" +
      ".cus-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);cursor:pointer;text-align:left;width:100%;color:var(--text)}" +
      ".cus-item:hover{border-color:rgba(10,143,106,.45)}.cus-item.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--shadow,rgba(10,143,106,.14));background:rgba(10,143,106,.05)}" +
      ".cus-av{width:38px;height:38px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:700;font-size:13px;color:#fff}.cus-av.lg{width:62px;height:62px;font-size:21px}.cus-av.ghost{background:rgba(127,127,127,.18)!important;color:var(--muted)}" +
      ".cus-t{flex:1;min-width:0}.cus-t b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cus-t span{display:block;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".cus-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}.cus-pill.blu{background:rgba(10,143,106,.14);color:var(--accent)}.cus-pill.grn{background:rgba(28,138,91,.16);color:var(--ok)}.cus-pill.amb{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.cus-pill.red{background:rgba(191,59,46,.14);color:var(--danger)}" +
      ".cus-btn{font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--panel);white-space:nowrap;color:var(--text);cursor:pointer}.cus-btn:disabled{opacity:.55;cursor:default}.cus-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cus-btn.sm{padding:6px 10px;font-size:12.5px}" +
      ".cus-quiet{border:1px dashed var(--border);border-radius:12px;padding:20px;color:var(--muted);font-size:13.5px;line-height:1.5;background:var(--panel2)}" +
      ".cus-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:18px 20px}" +
      ".cus-head{display:flex;gap:16px;align-items:flex-start}.cus-head h1{font-size:26px;letter-spacing:-.025em;margin:0 0 6px;line-height:1.1;font-weight:800}.cus-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:14px;color:var(--muted)}.cus-meta b{color:var(--text);font-weight:600}" +
      ".cus-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 18px;margin:16px 0 0;padding-top:14px;border-top:1px solid var(--border)}.cus-facts div{padding:4px 0}.cus-facts small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}.cus-facts span{font-size:15px;font-weight:600;word-break:break-word}.cus-facts span.none{color:var(--muted);font-weight:500}" +
      ".cus-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.cus-actions .right{margin-left:auto}" +
      ".cus-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;margin-top:16px}@media (max-width:1100px){.cus-grid{grid-template-columns:1fr}}" +
      ".cus-story{list-style:none;margin:0;padding:0}.cus-story li{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border);align-items:flex-start}.cus-story li:first-child{border-top:0;padding-top:4px}.cus-story i{width:9px;height:9px;border-radius:50%;flex:none;margin-top:6px;background:var(--muted)}.cus-story i.blu{background:var(--accent)}.cus-story i.grn{background:var(--ok)}.cus-story i.amb{background:#C98A12}.cus-story i.red{background:var(--danger)}" +
      ".cus-story .t{flex:1;min-width:0}.cus-story .t b{display:block;font-size:14px;font-weight:600;letter-spacing:-.01em}.cus-story .t span{font-size:12.5px;color:var(--muted)}.cus-story .d{font-size:12.5px;color:var(--muted);white-space:nowrap}" +
      ".cus-counts{display:flex;gap:6px;flex-wrap:wrap}.cus-counts a{height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--border);background:var(--panel);display:inline-flex;align-items:center;font-size:12.5px;font-weight:600;color:var(--text);cursor:pointer;gap:6px}.cus-counts a b{color:var(--muted);font-weight:600}" +
      ".cus-form{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin-top:14px}@media (max-width:700px){.cus-form{grid-template-columns:1fr}}.cus-form label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}.cus-form .w{grid-column:1/-1}" +
      ".cus-form input,.cus-form textarea{width:100%;box-sizing:border-box;height:38px;border:1px solid var(--border);border-radius:9px;background:var(--bg);padding:0 10px;color:var(--text);font-size:14px}.cus-form textarea{height:70px;padding:8px 10px;resize:vertical}.cus-form input:focus,.cus-form textarea:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--shadow,rgba(10,143,106,.18))}" +
      ".cus-warn{background:rgba(201,138,18,.14);border:1px solid rgba(201,138,18,.35);color:var(--warn,#A06A0E);border-radius:10px;padding:8px 12px;font-size:13px;margin-top:12px}" +
      ".cus-src{font-size:12px;color:var(--muted);margin-top:6px}" +
      ".cus-t span.cus-also{white-space:normal;color:var(--text);font-size:12.5px;margin-top:2px}" +
      ".cus-regs{display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center;margin-top:18px;padding-top:12px;border-top:1px solid var(--border);font-size:12.5px}.cus-regs span{color:var(--muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;margin-right:4px}.cus-regs a{color:var(--accent);font-weight:600;cursor:pointer}" +
      ".cus-story .t b{overflow-wrap:anywhere}.cus-counts a,.cus-regs a{text-decoration:none}.cus-counts a b+b{font-weight:500}" +
      // d-cust: the record — waiting now, allergies, how they like to hear from us, loyalty, messages in the story
      ".cus-col{display:flex;flex-direction:column;gap:16px;min-width:0}.cus-grid>.cus-col>.cus-card{margin:0}" +
      ".cus-tel{color:inherit;text-decoration:none}.cus-tel:hover b{text-decoration:underline}" +
      ".cus-allergy,.cus-note{margin-top:14px;border-radius:10px;padding:10px 14px;font-size:14.5px;line-height:1.4}.cus-allergy{background:rgba(191,59,46,.10);border:1px solid rgba(191,59,46,.35);color:var(--text)}.cus-allergy b{color:var(--danger);margin-right:8px}" +
      ".cus-note{background:rgba(201,138,18,.10);border:1px solid rgba(201,138,18,.30)}.cus-note b{color:var(--warn,#8A5A08);margin-right:8px}" +
      ".cus-wl{list-style:none;margin:0;padding:0}.cus-w{display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--border)}.cus-w:first-child{border-top:0;padding-top:2px}" +
      ".cus-w>i{width:10px;height:10px;border-radius:50%;flex:none;background:var(--muted)}.cus-w>i.blu{background:var(--accent)}.cus-w>i.grn{background:var(--ok)}.cus-w>i.amb{background:#C98A12}.cus-w>i.red{background:var(--danger)}" +
      ".cus-w .t{flex:1;min-width:0}.cus-w .t b{display:block;font-size:14.5px;font-weight:650;overflow-wrap:anywhere}.cus-w .t span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}.cus-w em.ok{font-style:normal;color:var(--ok);font-weight:600}" +
      ".cus-w .a{display:flex;gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end}" +
      ".cus-story li.msg .t span.mt{display:block;color:var(--text);font-size:13px;margin:2px 0}" +
      ".cus-pref fieldset{border:0;margin:0 0 10px;padding:0}.cus-pref legend,.cus-fl{font-size:12px;font-weight:700;color:var(--muted);margin:0 0 6px;padding:0;display:block}" +
      ".cus-chips{display:flex;gap:6px;flex-wrap:wrap}.cus-chip{position:relative;display:inline-flex}.cus-chip input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}" +
      ".cus-chip span{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--border);background:var(--panel);font-size:13.5px;font-weight:600;color:var(--text)}" +
      ".cus-chip input:checked+span{background:var(--accent);border-color:var(--accent);color:#fff}.cus-chip.no input:checked+span{background:rgba(191,59,46,.12);border-color:var(--danger);color:var(--danger)}.cus-chip.no input:checked+span:before{content:'\\2715\\00a0'}.cus-chip input:focus-visible+span{outline:3px solid var(--accent);outline-offset:2px}" +
      ".cus-pref input[name=allergies],.cus-loyx input,#cus-loy select{width:100%;box-sizing:border-box;height:40px;border:1px solid var(--border);border-radius:9px;background:var(--bg);padding:0 10px;color:var(--text);font-size:15px}" +
      "#cus-loy select{height:38px}.cus-loy{list-style:none;margin:0;padding:0}.cus-loy li{padding:8px 0;border-top:1px solid var(--border)}.cus-loy li:first-child{border-top:0;padding-top:0}.cus-loy b{display:block;font-size:14px}.cus-loy span{display:block;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .cus-chip input:checked+span{color:#00160E}html[data-ui2]:not([data-ui2-visit]) .cus-chip.no input:checked+span{color:var(--danger)}}" +
      ".cus-bar{height:6px;border-radius:3px;background:rgba(127,127,127,.18);margin-top:6px;overflow:hidden}.cus-bar i{display:block;height:100%;background:var(--accent);border-radius:3px}" +
      "@media (max-width:600px){.cus-btn{min-height:44px}.cus-btn.sm{min-height:44px;padding:0 12px}.cus-chip span{min-height:44px}.cus-w{flex-wrap:wrap}.cus-w .a{width:100%;justify-content:flex-start;padding-left:20px}.cus-pref input[name=allergies],#cus-loy select,#cus-loy input{font-size:16px;height:44px}.cus-tel b{display:inline-block;min-height:44px;line-height:44px}}"; // links now (keyboard and a long-press reach them), still looking like chips
    document.head.appendChild(st);
  }

  // ---------- data ----------
  // The server compares names with SQLite's LOWER(), which only knows A to Z: "ħabela" never found "Ħabela", nor "Ġorġ"
  // anyone. A search with ċ ġ ħ ż asks the server for its longest stretch without them ("abela"), then keeps here only
  // the people whose name has every word typed, compared with the browser's own lower case, which knows Maltese.
  var MT = /[ċġħżĊĠĦŻ]/;
  function serverQ(q) {
    if (!MT.test(q)) return q;
    var best = String(q).split(/[\sċġħżĊĠĦŻ]+/).reduce(function (a, b) { return b.length > a.length ? b : a; }, "");
    return best.length >= 2 ? best : q;
  }
  // q5-7: ċ ġ ħ ż left out too. "zammit" is also asked as its longest stretch without c, g, h or z ("ammit",
  // E.people.mtStretch), so Żammit comes back with Zammit; the rows are then compared with those letters folded.
  function asks(q) {
    var a = [serverQ(q)], st = E.people && E.people.mtStretch ? E.people.mtStretch(q) : "";
    if (st && a.indexOf(st) < 0 && st.toLowerCase() !== a[0].toLowerCase()) a.push(st);
    return a;
  }
  function hasAll(row, q) {
    var hay = [row.name, row.id_card, row.phone, row.alt_phone, row.email].join(" ");
    if (E.people && E.people.hasWordsMt) return E.people.hasWordsMt(hay, q);
    hay = hay.toLowerCase();
    return String(q).toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) >= 0; });
  }
  // two answers as one: each card once (by id), each history row once (by its key), cards in the order they came
  function joinAnswers(list) {
    var r = Object.assign({}, list[0]), seenP = {}, seenH = {};
    r.people = []; r.history = [];
    list.forEach(function (x) {
      (x.people || []).forEach(function (p) { if (!seenP[p.id]) { seenP[p.id] = 1; r.people.push(p); } });
      (x.history || []).forEach(function (h) { var k = h.key || (String(h.id_card || "") + "|" + String(h.name || "").toLowerCase()); if (!seenH[k]) { seenH[k] = 1; r.history.push(h); } });
    });
    r.people.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
    // as the server does within one answer: a history row with a card's ID card or exact name is that card
    var nk = function (n) { return String(n || "").trim().toLowerCase().replace(/\s+/g, " "); }, ik = E.idCardKey || function (x) { return String(x || "").toUpperCase(); };
    var ids = {}, names = {}; r.people.forEach(function (p) { if (p.id_card) ids[ik(p.id_card)] = 1; names[nk(p.name)] = 1; });
    r.history = r.history.filter(function (h) { return !(h.id_card && ids[ik(h.id_card)]) && !names[nk(h.name)]; })
      .sort(function (a, b) { var x = String(a.last_date || ""), y = String(b.last_date || ""); return x !== y ? (x < y ? 1 : -1) : String(a.name || "").localeCompare(String(b.name || "")); });
    return r;
  }
  E.customersServerQ = serverQ; // for the tests
  E.customersAsks = asks; // for the tests
  async function search(q) {
    var mySeq = ++state.seq;
    state.loading = true; state.error = "";
    renderList();
    try {
      var wq = asks(q);
      var all = await Promise.all(wq.map(function (w) { return E.apiFetch("/people?q=" + encodeURIComponent(w) + "&limit=30", { method: "GET", timeoutMs: 12000 }); }));
      if (mySeq !== state.seq) return;
      var r = all[0];
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not search");
      if (wq.length > 1) r = joinAnswers(all.filter(function (x) { return x && x.ok; }));
      if (wq.length > 1 || wq[0] !== q) r = Object.assign({}, r, { q: q, people: (r.people || []).filter(function (x) { return hasAll(x, q); }), history: (r.history || []).filter(function (x) { return hasAll(x, q); }) });
      state.results = r;
    } catch (e) {
      if (mySeq !== state.seq) return;
      state.error = (e && e.network) ? "Can't reach the server." : String(e && (e.message || e) || "Could not search");
    }
    state.loading = false;
    renderList();
  }

  async function open(id) {
    state.selected = id; state.detail = null; state.detailLoading = true; state.editing = false; state.bkAsk = false; state.now = null; state.loy = null; state.loyForm = false; state.prefErr = ""; state.prefSaving = false;
    renderList(); renderDetail();
    // The person, and what they need now (open orders, questions, deliveries, repeats, bookings, how to tell them),
    // asked together. An older server without /now: the page is as before.
    var nowP = E.apiFetch("/people/" + id + "/now", { method: "GET", timeoutMs: 12000 }).then(function (n) { return n && n.ok && n.waiting ? n : { off: true }; }, function (e) { return { off: true, error: e && e.network ? "Can't reach the server." : "" }; });
    try {
      var r = await E.apiFetch("/people/" + id, { method: "GET", timeoutMs: 12000 });
      if (state.selected !== id) return;
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not open");
      state.detail = r;
      if (r.person && r.person.id !== id) state.selected = r.person.id; // merged record opened its survivor
    } catch (e) {
      if (state.selected !== id) return;
      state.detail = { error: (e && e.network) ? "Can't reach the server." : String(e && (e.message || e) || "Could not open") };
    }
    var nw = await nowP;
    if (state.selected !== id && !(state.detail && state.detail.person && state.selected === state.detail.person.id)) return;
    state.now = nw;
    state.detailLoading = false;
    renderDetail();
    loadLoyalty();
  }
  async function reloadNow() {
    var p = state.detail && state.detail.person; if (!p) return;
    try { var n = await E.apiFetch("/people/" + p.id + "/now", { method: "GET", timeoutMs: 12000 }); if (n && n.ok && n.waiting && state.detail && state.detail.person && state.detail.person.id === p.id) { state.now = n; E.whenFormIdle(state.mount, renderDetail); } } catch (e) {}
  }

  async function adopt(h, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    try {
      var r = await E.apiFetch("/people", { method: "POST", body: JSON.stringify({ name: h.name, id_card: h.id_card || "", phone: h.phone || "", alt_phone: h.alt_phone || "", email: h.email || "", address: h.address || "", doctor_name: h.doctor_name || "", source: "history" }) });
      if (!r || !r.ok || !r.person) throw new Error((r && r.error) || "Could not add");
      E.toast(r.created ? h.name + " added to Customers" : h.name + " was already a customer", "success");
      await search(state.q);
      open(r.person.id);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Add"; }
      E.toast(E.saveFailText ? E.saveFailText(e) : "Not added: " + String(e && (e.message || e) || "error"), "error");
    }
  }

  // A missing name is said under the field (and read out), the field is marked and focused; nothing typed is lost.
  // (E.formErrors in core.js: the one way every screen marks, says and clears form problems)
  function fieldError(form, name, msg) { E.formErrors(form, msg ? [{ field: name, msg: msg }] : [], { cls: "cus-ferr", at: "field" }); }

  async function save(form) {
    if (state.saving || !state.detail || !state.detail.person) return;
    var p = state.detail.person;
    var body = { id: p.id, version: p.version };
    ["name", "id_card", "phone", "alt_phone", "email", "address", "doctor_name", "date_of_birth", "notes"].forEach(function (k) { var el = form.querySelector("[name=" + k + "]"); if (el) body[k] = el.value; });
    if (!String(body.name || "").trim()) return fieldError(form, "name", "Write the customer's name. Nothing was saved yet.");
    state.saving = true;
    var btn = form.querySelector("[data-act=save]"); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    // a changed ID card: on their details only, or on all their records too (E.people.confirmCardEdit); Go back keeps the form
    var asked = E.people && E.people.confirmCardEdit ? await E.people.confirmCardEdit(p, body.id_card) : { action: "save" };
    if (asked.action !== "save") { state.saving = false; if (btn) { btn.disabled = false; btn.textContent = "Save"; } var idf = form.querySelector("[name=id_card]"); if (idf) idf.focus(); return; }
    if (asked.change && asked.person) { body.version = asked.person.version; body.id_card = asked.person.id_card; } // the card already changed everywhere: save the rest on top
    try {
      var r = await E.apiFetch("/people", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok || !r.person) throw new Error((r && r.error) || "Save failed");
      state.detail.person = r.person; state.editing = false;
      E.toast("Saved " + r.person.name, "success");
      if (asked.stampAfter && r.person.id_card && E.people.stampAfterEdit) await E.people.stampAfterEdit(r.person);
      search(state.q);
      renderDetail();
    } catch (e) {
      var j = e && e.bodyJson;
      if (e && e.status === 409 && j && j.current) {
        // Someone else saved first. Show their version, and say what this person had typed so nothing has to be remembered.
        var LBL = { name: "Name", id_card: "ID card", phone: "Phone", alt_phone: "Other phone", email: "Email", address: "Address", doctor_name: "Doctor", date_of_birth: "Born", notes: "Notes" };
        var mine = Object.keys(LBL).filter(function (k) { return k in body && String(body[k] || "") !== String(p[k] || "") && String(body[k] || "") !== String(j.current[k] || ""); })
          .map(function (k) { return LBL[k] + " “" + String(body[k] || "") + "”"; });
        state.detail.person = j.current; state.editing = true;
        state.conflict = "Someone else changed this record while you were editing. Their version is shown below; make your change again." + (mine.length ? " Yours was: " + mine.join(", ") + "." : "");
        renderDetail();
      } else if (e && e.status === 409 && j && j.existing) {
        state.conflict = "Another customer already has this ID card: " + j.existing.name + ". Open them instead, or merge the two.";
        state.conflictExisting = j.existing;
        renderDetail();
      } else {
        E.toast(E.saveFailText ? E.saveFailText(e) : "Not saved: " + String(e && (e.message || e) || "error"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Save"; }
      }
    } finally { state.saving = false; }
  }

  async function createNew(form) {
    var body = {};
    ["name", "id_card", "phone", "email", "address"].forEach(function (k) { var el = form.querySelector("[name=" + k + "]"); if (el) body[k] = el.value; });
    if (!String(body.name || "").trim()) return fieldError(form, "name", "Write the customer's name. Nothing was saved yet.");
    var btn = form.querySelector("[data-act=create]"); if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    try {
      // The same person typed again without an ID card (same name and phone or e-mail, or the one person with this
      // name and nothing that differs) is opened, not added twice. A card is matched by the server itself, below.
      var f = null; if (E.people && !E.people.normIdCard(body.id_card)) { try { f = await E.people.find(body); } catch (e0) { f = null; } }
      var r = f && f.person ? { ok: true, created: false, person: f.person } : await E.apiFetch("/people", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok || !r.person) throw new Error((r && r.error) || "Could not add");
      E.toast(r.created ? r.person.name + " added" : r.person.name + " already exists, opened", "success");
      state.creating = false;
      await search(state.q);
      open(r.person.id);
    } catch (e) {
      E.toast(E.saveFailText ? E.saveFailText(e) : "Not added: " + String(e && (e.message || e) || "error"), "error");
      if (btn) { btn.disabled = false; btn.textContent = "Add customer"; }
    }
  }

  // ---------- hand-over to the rebuilt screens (BACKLOG4 item 1) ----------
  // A customer's action opens the screen of the new layout, never the classic one. One note in sessionStorage says
  // which screen, whether to open its New form ("new") or to show this person's records ("find"), who the person is,
  // and which button on their page to come back to. The screen takes it once, on opening (E.takeCustomerHandoff).
  var HAND = "eikon_cus_hand";
  // q5-5: mode "open" (Today's Open on a waiting customer) carries the record's id: the screen lands on that very row.
  E.customerHandoff = function (to, mode, p, back, id) {
    p = p || {};
    try { sessionStorage.setItem(HAND, JSON.stringify({ to: to, mode: mode, at: Date.now(), back: back || "", id: Number(id) || 0,
      person: { id: p.id || 0, name: p.name || "", id_card: p.id_card || "", phone: p.phone || "", email: p.email || "", address: p.address || "" } })); } catch (e) {}
  };
  E.takeCustomerHandoff = function (to) {
    var h = null;
    try { h = JSON.parse(sessionStorage.getItem(HAND) || "null"); } catch (e) { h = null; }
    if (!h || h.to !== to) return null; // meant for another screen: left for it
    try { sessionStorage.removeItem(HAND); } catch (e) {}
    h.person = h.person || {};
    if (!h.at || Date.now() - Number(h.at) > 60000 || (h.mode !== "new" && !(h.mode === "open" && Number(h.id) > 0) && !String(h.person.name || "").trim())) return null; // an old hand-over is ignored; "new" may come with nobody (the search's "new order")
    return h;
  };
  // Back to the person's page, with focus on the button that was pressed (Escape or Cancel on a form opened from it).
  E.customerReturn = function (h) {
    if (!h || !h.person || !Number(h.person.id)) return false;
    try { sessionStorage.setItem("eikon_customers_open", JSON.stringify({ id: Number(h.person.id), at: Date.now(), focus: h.back || "" })); } catch (e) {}
    window.location.hash = "#customers";
    return true;
  };
  // The person's buttons: the rebuilt screen with its New form open and the person filled in.
  var GO = { order: "ordreg", question: "tktreg", delivery: "dlvreg" };
  // The counts under "In the registers": the register, showing this person. The screens that can search take the
  // person; the others open as they are. Only Loyalty, and Appointments until Bookings is set up, stay in the classic look.
  var FIND = { ordreg: 1, tktreg: 1, dlvreg: 1, repreg: 1 };
  function classicLook(kind) { return kind === "loyalty" || ((kind === "appointment" || kind === "waitlist") && !(E.bookingsReady && E.bookingsReady())); }
  function goAction(what) {
    var p = state.detail && state.detail.person; if (!p || !GO[what]) return;
    E.customerHandoff(GO[what], "new", p, what);
    window.location.hash = "#" + GO[what];
  }
  function goCount(kind) {
    var p = state.detail && state.detail.person; if (!p) return;
    var old = kindMeta(kind)[1].replace(/^#/, "");
    if (((kind === "appointment" || kind === "waitlist") && E.bookingsReady && E.bookingsReady()) || kind === "booking" || kind === "booking_waitlist") { window.location.hash = "#bookings"; return; }
    var nat = E.UI2_NATIVE && E.UI2_NATIVE[old];
    if (nat) { if (FIND[nat]) E.customerHandoff(nat, "find", p, ""); window.location.hash = "#" + nat; return; }
    // the classic look (Loyalty; Appointments while Bookings is not set up): the person is carried, and its back link returns here
    if (E.carryPerson) E.carryPerson(p);
    try { sessionStorage.setItem("eikon_ui2_return", "customers"); } catch (e) {}
    E.openClassic(old);
  }
  function bookingCarry(p) {
    try { sessionStorage.setItem("eikon_bk_carry", JSON.stringify({ name: p.name || "", phone: p.phone || "", email: p.email || "", at: Date.now() })); } catch (e) {}
  }

  // ---------- render ----------
  function render() {
    if (E.state.activeModuleId !== "customers") return; // left before a reply came back: do not draw over the next screen
    var m = state.mount; if (!m) return;
    m.innerHTML = '<div class="cus"><div class="cus-side">' +
      '<div class="cus-search"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="color:rgba(60,60,67,.55);flex:none;display:block"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span><input id="cus-q" type="search" autocomplete="off" aria-label="Find a customer by name, ID card or phone" placeholder="Name, ID card or phone" value="' + esc(state.q) + '"></div>' +
      '<div id="cus-list"></div>' +
      '<div class="cus-regs"><span>Registers</span>' + regsStrip().map(function (x) { return '<a href="#' + x[2] + '" data-reg="' + x[0] + '">' + x[1] + '</a>'; }).join("") + '</div>' +
      (E.modules.dupreg || (window.EIKON_LATE && !E._lateIn) ? '<div class="cus-regs"><span>Tidy up</span><a href="#dupreg" data-dupes>Possible duplicates</a></div>' : "") +
      '</div><div class="cus-detail" id="cus-detail"></div></div>';
    m.querySelectorAll("[data-reg]").forEach(function (el) { el.addEventListener("click", function (ev) {
      var reg = el.getAttribute("data-reg"), nat = E.UI2_NATIVE && E.UI2_NATIVE[reg];
      ev.preventDefault();
      if (reg === "appointments" && E.bookingsReady && E.bookingsReady()) { window.location.hash = "#bookings"; return; }
      if (nat) { window.location.hash = "#" + nat; return; } // the router waits for screens still loading: never the classic look for a rebuilt one
      try { sessionStorage.setItem("eikon_ui2_return", "customers"); } catch (e) {} E.openClassic(reg); }); });
    var q = m.querySelector("#cus-q");
    q.addEventListener("input", function () {
      state.q = q.value;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(function () { search(state.q.trim()); }, 220);
    });
    q.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        if (state.timer) clearTimeout(state.timer);
        search(state.q.trim()).then(function () {
          var first = state.results && (state.results.people[0]);
          if (first) open(first.id);
        });
      }
      if (e.key === "Escape") { q.value = ""; state.q = ""; search(""); }
    });
    renderList(); renderDetail();
    search(state.q.trim());
    E.focusSoon(q);
  }

  // The Customers registers: rebuilt ones open in the new layout; what is still only in the classic look says so.
  function regsStrip() {
    var bk = E.bookingsReady && E.bookingsReady();
    return [["clientorders", "Orders"], ["tickets", "Questions"], ["deliveries", "Deliveries"], ["appointments", bk ? "Bookings" : "Appointments (classic look)"], ["loyalty", "Loyalty (classic look)"]]
      .filter(function (x) { var nat = E.UI2_NATIVE && E.UI2_NATIVE[x[0]]; return nat || (x[0] === "appointments" && bk) || E.modules[x[0]] || (window.EIKON_LATE && !E._lateIn); })
      .map(function (x) { var nat = E.UI2_NATIVE && E.UI2_NATIVE[x[0]]; return [x[0], x[1], x[0] === "appointments" && bk ? "bookings" : nat || x[0]]; });
  }

  // A history row that is a card in the list (same ID card, or same phone and name in any order: E.people.cardOf) is
  // that person, not someone to Add: it is said on their card ("Also in the registers as Claire Grech") and on their
  // page. Nothing is merged or written; the rows stay as the registers have them.
  function alsoSplit(r) {
    var people = r.people || [], all = r.history || [], also = {}, hist = [];
    all.forEach(function (h) {
      var c = E.people && E.people.cardOf ? E.people.cardOf(h, people) : null;
      if (c) (also[c.id] = also[c.id] || []).push(h); else hist.push(h);
    });
    state.also = also;
    return { hist: hist, also: also };
  }
  E.customersAlsoSplit = alsoSplit; // for the tests
  function alsoLine(list, long) {
    return "Also in the registers as " + list.map(function (h) {
      return h.name + (long ? ": " + sourceWords(h.sources) + (h.last_date ? ", last " + when(String(h.last_date).slice(0, 10)) : "") : "");
    }).join(long ? "; " : ", ") + (long ? "." : "");
  }

  function renderList() {
    if (E.state.activeModuleId !== "customers") return; // left before a reply came back: do not draw over the next screen
    var m = state.mount; if (!m) return;
    var box = m.querySelector("#cus-list"); if (!box) return;
    var r = state.results;
    var html = "";
    if (state.error) html += '<div class="cus-warn">' + esc(state.error) + ' <a data-act="retry" style="cursor:pointer;font-weight:600">Try again</a></div>';
    if (!r) { box.innerHTML = html + (state.loading ? '<div class="cus-lab">Searching…</div>' : ""); bindList(); return; }
    var people = r.people || [], hist = alsoSplit(r).hist, also = state.also;
    var qq = String(r.q || "").trim();
    html += '<div class="cus-lab">' + (qq.length >= 2 ? 'Customers <b>' + people.length + '</b>' : 'Recent customers') + (state.loading ? ' · searching…' : '') + '<a data-act="new">+ New</a></div>';
    if (people.length) {
      html += '<div class="cus-list">' + people.map(function (p) {
        var sub = [p.phone, p.id_card].filter(Boolean).join(" · ") || p.email || p.address || "No details yet";
        var aka = also[p.id] ? '<span class="cus-also">' + esc(alsoLine(also[p.id])) + '</span>' : "";
        return '<button class="cus-item' + (p.id === state.selected ? " on" : "") + '" data-person="' + p.id + '">' + av(p.name) + '<span class="cus-t"><b>' + esc(p.name) + '</b><span>' + esc(sub) + '</span>' + aka + '</span></button>';
      }).join("") + '</div>';
    } else if (qq && qq.trim().length < 2 && !state.loading) {
      // The search starts at two letters (the server answers one letter with the recent list): do not say "no one" yet.
      html += '<div class="cus-quiet">Keep typing: two letters or more find a customer.</div>';
    } else if (qq && !state.loading && !hist.length) {
      html += '<div class="cus-quiet">No one called “' + esc(qq) + '” yet.<br><a data-act="new" style="color:var(--accent);font-weight:600;cursor:pointer">Add them as a new customer ›</a></div>';
    } else if (!qq && !state.loading) {
      html += '<div class="cus-quiet">Type a name, an ID card or a phone number. People found only in the registers show under <b>From history</b>: tap <b>Add</b> to give them a customer card.</div>';
    }
    if (hist.length) {
      html += '<div class="cus-lab">From history <b>' + hist.length + '</b></div><div class="cus-list">' + hist.map(function (h, i) {
        var sub = [h.phone, h.id_card].filter(Boolean).join(" · ");
        i = (r.history || []).indexOf(h); // Add takes the row by its place in the server's list
        return '<div class="cus-item" data-hist="' + i + '">' + av(h.name, "ghost") + '<span class="cus-t"><b>' + esc(h.name) + '</b><span>' + esc(sub ? sub + " · " : "") + esc(sourceWords(h.sources)) + (h.last_date ? ", last " + esc(when(h.last_date)) : "") + '</span></span><button class="cus-btn sm p" data-adopt="' + i + '" aria-label="Add ' + esc(h.name) + ' as a customer">Add</button></div>';
      }).join("") + '</div>';
    }
    box.innerHTML = html;
    bindList();
  }

  function bindList() {
    var m = state.mount; if (!m) return;
    m.querySelectorAll("[data-person]").forEach(function (el) { el.addEventListener("click", function () { open(Number(el.getAttribute("data-person"))); }); });
    m.querySelectorAll("[data-adopt]").forEach(function (el) { el.addEventListener("click", function (e) { e.stopPropagation(); adopt(state.results.history[Number(el.getAttribute("data-adopt"))], el); }); });
    m.querySelectorAll("[data-hist]").forEach(function (el) { el.addEventListener("click", function () { var b = el.querySelector("[data-adopt]"); if (b && !b.disabled) adopt(state.results.history[Number(el.getAttribute("data-hist"))], b); }); });
    m.querySelectorAll('[data-act="retry"]').forEach(function (el) { el.addEventListener("click", function () { search(state.q.trim()); }); });
    m.querySelectorAll('[data-act="new"]').forEach(function (el) { el.addEventListener("click", function () { state.creating = true; state.selected = null; state.detail = null; renderList(); renderDetail(); }); });
  }

  // The right keyboard for each field on a phone: capitals for an ID card, digits for a phone, @ for an e-mail.
  var KB = { id_card: ' autocapitalize="characters" spellcheck="false"', phone: ' inputmode="tel"', alt_phone: ' inputmode="tel"', email: ' inputmode="email" autocapitalize="off" spellcheck="false"', name: ' autocapitalize="words"' };
  function field(label, name, value, type, wide) {
    return '<div' + (wide ? ' class="w"' : "") + '><label for="cus-f-' + name + '">' + label + '</label>' + (type === "textarea" ? '<textarea id="cus-f-' + name + '" name="' + name + '">' + esc(value) + '</textarea>' : '<input id="cus-f-' + name + '" name="' + name + '" type="' + (type || "text") + '" value="' + esc(value) + '" autocomplete="off"' + (KB[name] || "") + '>') + '</div>';
  }

  // On narrow screens an open customer replaces the list (iOS style), with "‹ Customers" to go back.
  function renderDetail() {
    renderDetailInner();
    var m = state.mount; if (!m) return;
    var wrap = m.querySelector(".cus"), box = m.querySelector("#cus-detail"); if (!wrap || !box) return;
    var open = !!(state.selected || state.creating), was = wrap.classList.contains("has-sel");
    wrap.classList.toggle("has-sel", open);
    if (open && !box.querySelector(".cus-back")) {
      var b = document.createElement("button"); b.type = "button"; b.className = "cus-back"; b.textContent = "‹ Customers";
      b.addEventListener("click", function () { state.selected = null; state.creating = false; state.detail = null; state.editing = false; renderList(); renderDetail(); });
      box.insertBefore(b, box.firstChild);
    }
    if (open && !was && window.matchMedia && window.matchMedia("(max-width:900px)").matches) try { window.scrollTo(0, 0); } catch (e) {}
  }
  function renderDetailInner() {
    if (E.state.activeModuleId !== "customers") return; // left before a reply came back: do not draw over the next screen
    var m = state.mount; if (!m) return;
    var box = m.querySelector("#cus-detail"); if (!box) return;
    if (state.creating) {
      box.innerHTML = '<form class="cus-card" id="cus-new"><div class="cus-lab" style="margin-top:0">New customer</div>' +
        '<div class="cus-form">' + field("Name", "name", state.q && !/\d/.test(state.q) ? state.q : "", "text", true) + field("ID card", "id_card", /^\d{1,7}\s*[a-zA-Z]$/.test(state.q.trim()) ? state.q.trim() : "") + field("Phone", "phone", /^[\d\s+]+$/.test(state.q.trim()) ? state.q.trim() : "", "tel") + field("E-mail", "email", "", "email") + field("Address", "address", "", "text", true) + '</div>' +
        '<div class="cus-actions"><button type="submit" class="cus-btn p" data-act="create">Add customer</button><button type="button" class="cus-btn" data-act="cancel">Cancel</button></div></form>';
      var f = box.querySelector("#cus-new");
      f.addEventListener("submit", function (e) { e.preventDefault(); createNew(f); });
      f.querySelector('[data-act="cancel"]').addEventListener("click", function () { state.creating = false; renderDetail(); });
      E.focusSoon(function () { return f.querySelector("[name=name]"); }); // never away from a field the person went to meanwhile
      return;
    }
    if (!state.selected) {
      box.innerHTML = '<div class="cus-quiet cus-pick" style="padding:34px;text-align:center">Pick a customer on the left, or search for one.<br><span style="font-size:12.5px">Everything the pharmacy has done with them, in one place.</span></div>';
      return;
    }
    if (state.detailLoading && !state.detail) { box.innerHTML = '<div class="cus-card"><div class="cus-lab" style="margin:0">Opening…</div></div>'; return; }
    var d = state.detail || {};
    if (d.error) { box.innerHTML = '<div class="cus-card"><div class="cus-warn">' + esc(d.error) + '</div><div class="cus-actions"><button class="cus-btn" data-act="reopen">Try again</button></div></div>'; box.querySelector('[data-act="reopen"]').addEventListener("click", function () { open(state.selected); }); return; }
    var p = d.person || {}, act = d.activity || [], counts = d.counts || {}, nw = state.now && !state.now.off ? state.now : null, pr = (nw && nw.profile) || {};
    if (nw && nw.counts) { counts = Object.assign({}, counts); Object.keys(nw.counts).forEach(function (k) { if ((nw.counts[k] || 0) > (counts[k] || 0)) counts[k] = nw.counts[k]; }); } // a name with Ċ Ġ Ħ Ż: only /now finds its records
    if (nw && nw.activity && nw.activity.length > act.length) act = nw.activity;
    var f1 = first(p);
    var html = '<div class="cus-card">';
    html += '<div class="cus-head">' + av(p.name, "lg") + '<div style="flex:1;min-width:0"><h1>' + esc(p.name) + '</h1><div class="cus-meta">' +
      (p.phone ? '<a class="cus-tel" href="tel:' + esc(String(p.phone).replace(/\s+/g, "")) + '" aria-label="' + esc("Call " + p.name + ", " + p.phone) + '"><b>' + esc(p.phone) + '</b></a>' : '<span>No phone</span>') + (p.id_card ? '<span class="cus-pill">' + esc(p.id_card) + '</span>' : "") + (d.loyalty ? '<span class="cus-pill">Loyalty · ' + esc(Number(d.loyalty.points || 0).toLocaleString("en-GB")) + ' pts</span>' : counts.loyalty ? '<span class="cus-pill">Loyalty card</span>' : "") + (counts.repeat ? '<span class="cus-pill grn">Repeat prescription</span>' : "") + (p.merged_from ? '<span class="cus-pill amb">Merged record opened</span>' : "") +
      (pr.prefers ? '<span class="cus-pill blu">Prefers ' + esc(CHW[pr.prefers] || pr.prefers) + '</span>' : "") + (pr.lang === "mt" ? '<span class="cus-pill">Malti</span>' : "") +
      '</div></div>' + (state.editing ? "" : '<button class="cus-btn" data-act="edit">Edit</button>') + '</div>';
    if (!state.editing && pr.allergies) html += '<div class="cus-allergy" role="note"><b>Allergies</b> ' + esc(pr.allergies) + '</div>';
    if (!state.editing && p.notes) html += '<div class="cus-note" role="note"><b>Note</b> ' + esc(p.notes) + '</div>';
    if (state.conflict) { html += '<div class="cus-warn">' + esc(state.conflict) + (state.conflictExisting ? ' <a data-person="' + state.conflictExisting.id + '" style="cursor:pointer;font-weight:600">Open ' + esc(state.conflictExisting.name) + ' ›</a>' : "") + '</div>'; }
    if (state.editing) {
      html += '<form id="cus-edit"><div class="cus-form">' + field("Name", "name", p.name, "text", true) + field("ID card", "id_card", p.id_card) + field("Date of birth", "date_of_birth", p.date_of_birth, "date") + field("Phone", "phone", p.phone, "tel") + field("Other phone", "alt_phone", p.alt_phone, "tel") + field("E-mail", "email", p.email, "email") + field("Doctor", "doctor_name", p.doctor_name) + field("Address", "address", p.address, "text", true) + field("Notes", "notes", p.notes, "textarea", true) + '</div>' +
        '<div class="cus-actions"><button type="submit" class="cus-btn p" data-act="save">Save</button><button type="button" class="cus-btn" data-act="cancel">Cancel</button></div></form>';
    } else {
      var fact = function (l, v) { return '<div><small>' + l + '</small><span' + (v ? "" : ' class="none"') + '>' + (v ? esc(v) : "–") + '</span></div>'; };
      var last = act[0];
      var na = d.next_appointment;
      html += '<div class="cus-facts">' + fact("Last visit", last ? when(last.date) + " · " + kindMeta(last.kind)[0] : "") + (na ? fact("Next appointment", nextWhen(na.date) + (na.time ? " " + na.time : "") + (na.doctor ? " · " + na.doctor : "")) : "") + fact("Address", p.address) + fact("Doctor", p.doctor_name) + fact("E-mail", p.email) + (p.alt_phone ? fact("Other phone", p.alt_phone) : "") + '</div>';
      html += '<div class="cus-actions"><button class="cus-btn p" data-go="order">New order</button><button class="cus-btn" data-go="question">Question</button><button class="cus-btn" data-go="delivery">Delivery</button><button class="cus-btn" data-act="book" data-go="booking"' + (E.bookingsReady && E.bookingsReady() ? "" : ' aria-expanded="' + !!state.bkAsk + '" aria-controls="cus-bk"') + '>Booking</button>' + (E.tell ? '<button class="cus-btn" data-act="tell-any">Message ' + esc(f1 || "") + '</button>' : "") + '</div>';
      // Bookings not set up here yet: say so calmly, offer the set-up (new layout), and keep the classic Appointments one tap away.
      if (state.bkAsk && !(E.bookingsReady && E.bookingsReady())) {
        var admin = !!(E.state && E.state.user && E.state.user.role === "admin");
        html += '<div class="cus-quiet" id="cus-bk" data-cus-bk role="status" style="margin-top:12px;padding:14px 16px"><b style="color:var(--text)">Set up Bookings first.</b> ' +
          (admin ? "One service and who does it, in about a minute. " + esc(p.name) + " is filled in after." : "Your pharmacist sets it up once, on the Bookings screen.") +
          '<div class="cus-actions" style="margin-top:10px">' + (admin ? '<button class="cus-btn p" data-act="bk-setup">Set up Bookings</button>' : "") +
          '<button class="cus-btn" data-act="bk-classic">Book in Appointments (classic look)</button></div></div>';
      }
    }
    html += '</div>';

    html += '<div class="cus-grid"><div class="cus-col">' + waitingHtml(state.now, p) + storyHtml(Object.assign({}, d, { activity: act }), state.now, p) + '</div><div class="cus-col">' + prefHtml(state.now, p) + loyaltyHtml(d, p) + '<div class="cus-card"><div class="cus-lab" style="margin-top:0">In the registers</div>';
    var ck = Object.keys(counts).filter(function (k) { return counts[k]; });
    html += ck.length ? '<div class="cus-counts">' + ck.map(function (k) { var km = kindMeta(k); return '<a href="' + km[1] + '" data-count="' + esc(k) + '">' + esc(km[0]) + ' <b>' + counts[k] + '</b>' + (classicLook(k) ? '<b>(classic look)</b>' : "") + '</a>'; }).join("") + '</div>' : '<div class="cus-src">Not in any register yet.</div>';
    var aka = state.also && (state.also[p.id] || state.also[state.selected]);
    if (aka && aka.length) html += '<div class="cus-src" data-cus-also>' + esc(alsoLine(aka, true)) + '</div>';
    html += '<div class="cus-src">' + (p.source && p.source.indexOf("history") === 0 ? "Added from the registers" : "Added by hand") + (p.updated_at ? ", last changed " + esc(when(String(p.updated_at).slice(0, 10))) : "") + '.</div>';
    html += '</div></div></div>';
    box.innerHTML = html;

    box.querySelectorAll("[data-tell]").forEach(function (el) { el.addEventListener("click", function () { var r = (state.wrows || [])[Number(el.getAttribute("data-tell"))]; if (r && r.tell) tellFrom(Object.assign({ back: el }, r.tell)); }); });
    box.querySelectorAll("[data-open]").forEach(function (el) { el.addEventListener("click", function () {
      var r = (state.wrows || [])[Number(el.getAttribute("data-open"))]; if (!r || !r.open) return;
      if (r.open[0] === "bookings") { bookingCarry(p); location.hash = "#bookings"; return; }
      E.customerHandoff(r.open[0], r.open[1] ? "open" : "find", p, "", r.open[1]); window.location.hash = "#" + r.open[0]; }); });
    var ta = box.querySelector('[data-act="tell-any"]'); if (ta) ta.addEventListener("click", function () { tellFrom({ purpose: "other", back: ta }); });
    var pf = box.querySelector("#cus-pref");
    if (pf) {
      var sync = function () { var b = pf.querySelector("[data-act=pref-save]"); if (b && !state.prefSaving) b.disabled = !Object.keys(prefChanged(pf)).length; };
      pf.addEventListener("input", sync); pf.addEventListener("change", sync); sync();
      pf.addEventListener("submit", function (ev) { ev.preventDefault(); savePref(pf); });
    }
    var lb = box.querySelector("#cus-loy-box"); if (lb) bindLoy(lb);

    var eb = box.querySelector('[data-act="edit"]'); if (eb) eb.addEventListener("click", function () { state.editing = true; state.conflict = ""; state.conflictExisting = null; renderDetail(); E.focusSoon(function () { return box.querySelector("[name=name]"); }); }); // never away from a field the person went to meanwhile
    var f = box.querySelector("#cus-edit");
    if (f) {
      f.addEventListener("submit", function (e) { e.preventDefault(); save(f); });
      f.querySelector('[data-act="cancel"]').addEventListener("click", function () { state.editing = false; state.conflict = ""; state.conflictExisting = null; renderDetail(); });
    }
    box.querySelectorAll("[data-go]:not([data-act])").forEach(function (el) { el.addEventListener("click", function () { goAction(el.getAttribute("data-go")); }); });
    box.querySelectorAll("[data-count]").forEach(function (el) { el.addEventListener("click", function (ev) { ev.preventDefault(); goCount(el.getAttribute("data-count")); }); });
    box.querySelectorAll('[data-act="book"]').forEach(function (el) { el.addEventListener("click", function () {
      var p = (state.detail && state.detail.person) || {};
      if (!(E.bookingsReady && E.bookingsReady())) { // not set up here: the note above opens or closes, nothing leaves the page
        state.bkAsk = !state.bkAsk; renderDetail();
        setTimeout(function () { var b = box.querySelector(state.bkAsk ? "#cus-bk .cus-btn" : '[data-act="book"]'); if (b) b.focus(); }, 0);
        return;
      }
      bookingCarry(p);
      location.hash = "#bookings";
    }); });
    var bkn = box.querySelector("#cus-bk");
    if (bkn) bkn.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); state.bkAsk = false; renderDetail(); setTimeout(function () { var b = box.querySelector('[data-act="book"]'); if (b) b.focus(); }, 0); } });
    box.querySelectorAll('[data-act="bk-setup"]').forEach(function (el) { el.addEventListener("click", function () { state.bkAsk = false; bookingCarry((state.detail && state.detail.person) || {}); location.hash = "#bookings"; }); });
    box.querySelectorAll('[data-act="bk-classic"]').forEach(function (el) { el.addEventListener("click", function () { state.bkAsk = false; goCount("appointment"); }); });
    box.querySelectorAll("[data-person]").forEach(function (el) { el.addEventListener("click", function () { state.conflict = ""; state.conflictExisting = null; open(Number(el.getAttribute("data-person"))); }); });
  }

  // ---------- d-cust: the customer record — who they are, what they need from us now, how to tell them ----------
  function first(p) { return E.tell ? E.tell.firstName(p.name) : String(p.name || "").split(" ")[0]; }
  function poss(n) { return n ? n + (/s$/i.test(n) ? "'" : "'s") : "their"; }
  var CHW = { whatsapp: "WhatsApp", sms: "SMS", email: "E-mail", call: "a call" };
  function toldLine(msgs, kind, id) {
    var m = (msgs || []).filter(function (x) { return x.ref_kind === kind && Number(x.ref_id) === Number(id) && x.status !== "failed"; })[0];
    return m ? "Told by " + (CHW[m.channel] || m.channel) + " " + when(String(m.at || "").slice(0, 10)) : "";
  }
  // Every thing waiting for this person, most urgent first: [{ key, tone, title, sub, told, tell, open }]
  function waitingRows(nw, p) {
    var w = (nw && nw.waiting) || {}, msgs = nw && nw.messages, out = [], t = E.maltaYmd ? E.maltaYmd() : "";
    (w.ready || []).forEach(function (o) {
      var told = toldLine(msgs, "order", o.id);
      out.push({ key: "ready-" + o.id, rank: told ? 3 : 1, tone: told ? "grn" : "blu", title: "Ready to collect · " + storyTitle(o.items), sub: ["Ready " + when(String(o.ready_at || "").slice(0, 10)), o.code].filter(Boolean).join(" · "), told: told,
        tell: { purpose: "ready", ref: { kind: "order", id: o.id }, vars: { items: storyTitle(o.items), code: o.code }, subtitle: storyTitle(o.items) }, open: ["ordreg", o.id] });
    });
    (w.orders || []).forEach(function (o) {
      var late = o.needed_by && t && o.needed_by < t;
      out.push({ key: "order-" + o.id, rank: late ? 0 : 2, tone: late ? "red" : "amb", title: "Order waiting · " + storyTitle(o.items), sub: o.needed_by ? (late ? "Late · needed " + when(o.needed_by) : "Needed " + nextWhen(o.needed_by).toLowerCase()) : "No date", open: ["ordreg", o.id] });
    });
    (w.questions || []).forEach(function (q) {
      if (q.done) {
        var told = toldLine(msgs, "question", q.id);
        out.push({ key: "answer-" + q.id, rank: told ? 3 : 1, tone: told ? "grn" : "blu", title: "Answered · " + q.issue, sub: (q.last_note ? "“" + q.last_note + "”" : "Resolved " + when(String(q.done_at || "").slice(0, 10))), told: told,
          tell: { purpose: "answer", ref: { kind: "question", id: q.id }, vars: { issue: q.issue, answer: q.last_note || "" }, subtitle: q.issue }, open: ["tktreg", q.id] });
      } else {
        var lateQ = q.followup_date && t && q.followup_date < t;
        out.push({ key: "question-" + q.id, rank: lateQ ? 0 : 2, tone: lateQ ? "red" : "amb", title: "Question waiting · " + q.issue, sub: [q.ref, "opened " + when(q.open_date), q.followup_date ? (lateQ ? "follow-up late" : "follow up " + nextWhen(q.followup_date).toLowerCase()) : ""].filter(Boolean).join(" · "), open: ["tktreg", q.id] });
      }
    });
    (w.deliveries || []).forEach(function (d) {
      var told = toldLine(msgs, "delivery", d.id);
      out.push({ key: "delivery-" + d.id, rank: 2, tone: "blu", title: "Delivery " + (d.date ? nextWhen(d.date).toLowerCase() : "") + (d.slot ? " · " + d.slot.toLowerCase() : "") + " · " + storyTitle(d.items), sub: [d.status, d.address].filter(Boolean).join(" · "), told: told,
        tell: { purpose: "delivery", ref: { kind: "delivery", id: d.id }, vars: { date: d.date, slot: d.slot }, subtitle: storyTitle(d.items) }, open: ["dlvreg", d.id] });
    });
    if (E.repeatDue && (w.repeats || []).length) {
      var b = E.repeatDue.buckets(w.repeats);
      b.due.forEach(function (x) {
        var told = toldLine(msgs, "repeat", x.e.id);
        out.push({ key: "repeat-" + x.e.id, rank: x.s.kind === "overdue" ? 0 : 1, tone: x.s.kind === "overdue" ? "red" : "amb", title: E.repeatDue.words(x.s) + " · " + x.e.medicine_name_dose, sub: "Repeat prescription" + (x.e.posology ? " · " + x.e.posology : ""), told: told,
          tell: { purpose: "repeat", ref: { kind: "repeat", id: x.e.id }, vars: { medicine: x.e.medicine_name_dose, due: x.s.next }, subtitle: x.e.medicine_name_dose }, open: ["repreg", 0] });
      });
      b.runout.forEach(function (x) {
        out.push({ key: "runout-" + x.e.id, rank: 2, tone: "amb", title: E.repeatDue.words(x.s) + " · " + x.e.medicine_name_dose, sub: "Prescription · ask the doctor for a new one", open: ["repreg", 0] });
      });
    }
    (w.bookings || []).forEach(function (k) {
      var told = toldLine(msgs, "booking", k.id);
      out.push({ key: "booking-" + k.id, rank: 2, tone: "blu", title: "Booking " + nextWhen(k.date).toLowerCase() + " at " + k.time + (k.service ? " · " + k.service : ""), sub: k.ref || "", told: told,
        tell: { purpose: "booking", ref: { kind: "booking", id: k.id }, vars: { service: k.service, date: k.date, time: k.time }, subtitle: k.service, label: "Remind" }, open: ["bookings", 0] });
    });
    return out.sort(function (a, b) { return a.rank - b.rank; });
  }
  E.customersWaitingRows = waitingRows; // for the tests

  function waitingHtml(nw, p) {
    if (!nw || nw.off) return "";
    var rows = waitingRows(nw, p), f = first(p);
    var h = '<div class="cus-card cus-now" aria-labelledby="cus-now-h"><div class="cus-lab" style="margin-top:0" id="cus-now-h">Waiting now' + (rows.length ? " <b>" + rows.length + "</b>" : "") + "</div>";
    if (!rows.length) return h + '<div class="cus-src" style="font-size:14px">Nothing waiting for ' + esc(f || p.name) + '.</div></div>';
    h += '<ul class="cus-wl">' + rows.map(function (r, i) {
      return '<li class="cus-w"><i class="' + r.tone + '" aria-hidden="true"></i><div class="t"><b>' + esc(r.title) + '</b><span>' + esc(r.sub) + (r.told ? ' · <em class="ok">' + esc(r.told) + '</em>' : "") + '</span></div><div class="a">' +
        (r.tell ? '<button type="button" class="cus-btn sm' + (r.told ? "" : " p") + '" data-tell="' + i + '">' + esc(r.told ? "Tell again" : (r.tell.label || "Tell") + " " + f) + '</button>' : "") +
        '<button type="button" class="cus-btn sm" data-open="' + i + '" aria-label="' + esc("Open " + r.title) + '">Open</button></div></li>';
    }).join("") + "</ul></div>";
    state.wrows = rows;
    return h;
  }

  // The person's story: every register, and the messages sent to them, newest first.
  function storyItems(d, nw) {
    var act = (nw && !nw.off && nw.activity) ? nw.activity : (d.activity || []);
    var items = act.map(function (a) { return { date: a.date, a: a }; });
    ((nw && !nw.off && nw.messages) || []).forEach(function (m) { items.push({ date: String(m.at || "").slice(0, 10), m: m, at: m.at }); });
    items.sort(function (x, y) { return x.date !== y.date ? (x.date < y.date ? 1 : -1) : (x.m && !y.m ? -1 : !x.m && y.m ? 1 : 0); });
    return items;
  }
  var PURW = { ready: "Order ready", repeat: "Repeat due", answer: "Answer", delivery: "Delivery", booking: "Booking reminder", other: "Message" };
  function storyHtml(d, nw, p) {
    var items = storyItems(d, nw);
    var h = '<div class="cus-card"><div class="cus-lab" style="margin-top:0">Story' + (items.length ? ' <b>' + items.length + '</b>' : "") + '</div>';
    if (!items.length) return h + '<div class="cus-quiet">Nothing recorded yet. Orders, questions, deliveries, DDA sales, repeat prescriptions, appointments and messages for ' + esc(p.name) + ' will show here.</div></div>';
    return h + '<ul class="cus-story">' + items.slice(0, 60).map(function (it) {
      if (it.m) {
        var m = it.m, failed = m.status === "failed";
        return '<li class="msg"><i class="' + (failed ? "red" : "grn") + '"></i><div class="t"><b>' + esc((CHW[m.channel] || m.channel) + " · " + (PURW[m.purpose] || "Message") + (failed ? " · not sent" : "")) + '</b><span class="mt">' + esc(String(m.body || "").replace(/\s+/g, " ").slice(0, 160)) + '</span><span>' + esc([m.channel === "email" ? m.to : "", m.channel !== "email" ? "from this device" : (m.sender ? "via " + m.sender : ""), m.by ? "by " + m.by : ""].filter(Boolean).join(" · ")) + '</span></div><span class="d">' + esc(when(it.date)) + '</span></li>';
      }
      var a = it.a, km = kindMeta(a.kind), title = storyTitle(a.title);
      return '<li><i class="' + km[2] + '"></i><div class="t"><b>' + esc(km[0]) + (title ? ' · ' + esc(title) : "") + '</b><span>' + esc([a.ref, a.doctor ? "Dr " + String(a.doctor).replace(/^dr\.?\s*/i, "") : ""].filter(Boolean).join(" · ")) + '</span></div><span class="d">' + esc(when(a.date)) + '</span></li>';
    }).join("") + '</ul></div>';
  }

  // How they like to be told: one small form; only what was changed is sent (nothing is said for them).
  function prefHtml(nw, p) {
    if (!nw || nw.off) return "";
    var pr = nw.profile || {}, f = first(p) || p.name;
    var radio = function (name, val, label, cur) { return '<label class="cus-chip"><input type="radio" name="' + name + '" value="' + val + '"' + (cur === val ? " checked" : "") + '><span>' + label + '</span></label>'; };
    var tick = function (k, label) { return '<label class="cus-chip no"><input type="checkbox" name="' + k + '"' + (pr[k] === false ? " checked" : "") + '><span>' + label + '</span></label>'; }; // ticked = they said no
    var em = nw.email || {};
    return '<form class="cus-card cus-pref" id="cus-pref" autocomplete="off" aria-labelledby="cus-pref-h"><div class="cus-lab" style="margin-top:0" id="cus-pref-h">Good to know about ' + esc(f) + '</div>' +
      '<label class="cus-fl" for="cus-allergy">Allergies</label><input id="cus-allergy" name="allergies" value="' + esc(pr.allergies || "") + '" placeholder="e.g. Penicillin. Empty if none known" autocomplete="off" style="margin-bottom:12px">' +
      '<fieldset><legend>Likes to hear from us by</legend><div class="cus-chips">' + radio("prefers", "whatsapp", "WhatsApp", pr.prefers) + radio("prefers", "sms", "SMS", pr.prefers) + radio("prefers", "email", "E-mail", pr.prefers) + radio("prefers", "call", "A call", pr.prefers) + radio("prefers", "", "Not said", pr.prefers || "") + '</div></fieldset>' +
      '<fieldset><legend>Said no to</legend><div class="cus-chips">' + tick("whatsapp_ok", "WhatsApp") + tick("sms_ok", "SMS") + tick("email_ok", "E-mail") + '</div>' + (em.opted_out ? '<div class="cus-src">Their e-mail address stopped e-mails from the pharmacy.</div>' : "") + '</fieldset>' +
      '<fieldset><legend>Language</legend><div class="cus-chips">' + radio("lang", "en", "English", pr.lang || "en") + radio("lang", "mt", "Malti", pr.lang) + '</div></fieldset>' +
      (state.prefErr ? '<div class="cus-warn" role="alert">' + esc(state.prefErr) + '</div>' : "") +
      '<div class="cus-actions" style="margin-top:12px"><button type="submit" class="cus-btn p" data-act="pref-save" disabled>' + (state.prefSaving ? "Saving…" : "Save") + '</button></div>' +
      (!em.ready ? '<div class="cus-src">' + esc(em.why || "E-mail is not set up here.") + ' WhatsApp and SMS work from this device.</div>' : "") + '</form>';
  }
  function prefChanged(f) {
    var nw = state.now || {}, pr = nw.profile || {}, out = {};
    var pv = (f.querySelector("[name=prefers]:checked") || {}).value || ""; if (pv !== (pr.prefers || "")) out.prefers = pv;
    var lv = (f.querySelector("[name=lang]:checked") || {}).value || "en"; if (lv !== (pr.lang || "en")) out.lang = lv;
    ["whatsapp_ok", "sms_ok", "email_ok"].forEach(function (k) { var no = f.querySelector("[name=" + k + "]").checked, was = pr[k] === false; if (no !== was) out[k] = !no; }); // a "no" taken back is a yes they gave
    var al = String(f.querySelector("[name=allergies]").value || "").trim(); if (al !== (pr.allergies || "")) out.allergies = al;
    return out;
  }
  async function savePref(f) {
    var p = state.detail && state.detail.person, ch = prefChanged(f); if (!p || state.prefSaving || !Object.keys(ch).length) return;
    var body = Object.assign({ version: (state.now.profile || {}).version || 0 }, ch);
    state.prefSaving = true; state.prefErr = ""; var b = f.querySelector("[data-act=pref-save]"); if (b) { b.disabled = true; b.textContent = "Saving…"; }
    try {
      var r = await E.apiFetch("/people/" + p.id + "/profile", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not saved");
      state.now.profile = r.profile; state.prefSaving = false; E.toast("Saved for " + (first(p) || p.name), "success");
      renderDetail(); E.focusSoon(function () { return state.mount && state.mount.querySelector("#cus-pref-h"); });
    } catch (x) {
      state.prefSaving = false;
      var j = x && x.bodyJson;
      if (x && x.status === 409 && j && j.current) { state.now.profile = j.current; state.prefErr = "Someone else changed this meanwhile. Theirs is shown; make your change again."; }
      else state.prefErr = E.saveFailText(x);
      renderDetail(); E.focusSoon(function () { return state.mount && state.mount.querySelector("#cus-pref [data-act=pref-save]"); });
    }
  }

  // ---------- Loyalty in the record (classic endpoints and bodies: GET /loyalty/campaigns, GET /loyalty/transactions?client=,
  // POST /loyalty/transactions with exactly the body the classic Loyalty screen sends) ----------
  function loyNormId(raw) { var s = String(raw || "").trim().toUpperCase(); var m = s.match(/^(\d+)([A-Z]?)$/); return m ? m[1].padStart(7, "0") + m[2] : s; } // the classic normMtId
  function loyActive(c) { if (!c.active) return false; if (c.open_ended) return true; var t = E.maltaYmd ? E.maltaYmd() : ""; return !(c.end_date && c.end_date < t) && !(c.start_date && c.start_date > t); }
  async function loadLoyalty() {
    var p = state.detail && state.detail.person; if (!p || !p.id_card) { state.loy = null; return; }
    var id = p.id;
    try {
      var r = await Promise.all([E.apiFetch("/loyalty/campaigns", { method: "GET", timeoutMs: 10000 }), E.apiFetch("/loyalty/transactions?client=" + encodeURIComponent(loyNormId(p.id_card)), { method: "GET", timeoutMs: 10000 })]);
      if (!state.detail || !state.detail.person || state.detail.person.id !== id) return;
      state.loy = { camps: (r[0] && r[0].campaigns) || [], txns: (r[1] && r[1].transactions) || [] };
    } catch (e) { state.loy = { error: true }; }
    var box = state.mount && state.mount.querySelector("#cus-loy-box"); if (box) E.whenFormIdle(state.mount, function () { var b2 = state.mount.querySelector("#cus-loy-box"); if (b2) { b2.innerHTML = loyInner(state.detail.person); bindLoy(b2); } });
  }
  function loyInner(p) {
    if (!p.id_card) return '<div class="cus-src">Loyalty is by ID card. Add ' + esc(poss(first(p))) + ' ID card with Edit.</div>';
    var L = state.loy; if (!L) return '<div class="cus-src">Loading…</div>';
    if (L.error) return '<div class="cus-src">Could not load loyalty. <a data-act="loy-retry" href="#" style="color:var(--accent);font-weight:600">Try again</a></div>';
    var act = L.camps.filter(loyActive), byC = {};
    L.txns.forEach(function (t) { var s = byC[t.campaign_id] = byC[t.campaign_id] || { stamps: 0, points: 0, n: 0, spend: 0, last: "" }; s.stamps += Number(t.stamps_awarded) || 0; s.points += Number(t.points_awarded) || 0; s.n++; s.spend += Number(t.total) || 0; if (String(t.date || "") > s.last) s.last = String(t.date || ""); });
    var shown = L.camps.filter(function (c) { return byC[c.id] || loyActive(c); });
    var h = shown.length ? '<ul class="cus-loy">' + shown.map(function (c) {
      var s = byC[c.id] || { stamps: 0, points: 0, n: 0, spend: 0 }, line = "", pct = null;
      if (c.type === "stamp_card") { var tg = Number(c.stamp_target) || 10, e = s.stamps % tg; line = e + " of " + tg + " stamps" + (e + 1 >= tg ? " · next one completes the card" : ""); pct = e / tg; }
      else if (c.type === "points") { var th = Number(c.redeem_threshold) || 100; line = s.points.toLocaleString("en-GB") + " points" + (s.points >= th ? " · reward ready (" + (c.reward || "reward") + ")" : " · " + (th - (s.points % th)) + " to the reward"); pct = Math.min(1, (s.points % th) / th); }
      else if (c.type === "buy_x_get_y") { var bq = Number(c.buy_qty) || 3, ac = s.n % bq; line = ac + " of " + bq + " purchases" + (ac + 1 >= bq ? " · next one is free" : ""); pct = ac / bq; }
      else if (c.type === "tiered") line = "€" + s.spend.toFixed(2) + " spent";
      else if (c.type === "discount") line = (c.discount_pct || 10) + "% off" + (c.brand ? " " + c.brand : "");
      else line = s.n + (s.n === 1 ? " purchase" : " purchases");
      return '<li><b>' + esc(c.name) + (loyActive(c) ? "" : ' <span class="cus-src" style="display:inline">(ended)</span>') + '</b><span>' + esc(line) + '</span>' + (pct != null ? '<span class="cus-bar" role="img" aria-label="' + Math.round(pct * 100) + ' percent"><i style="width:' + Math.round(pct * 100) + '%"></i></span>' : "") + '</li>';
    }).join("") + '</ul>' : '<div class="cus-src">No loyalty campaign is running.</div>';
    if (state.loyForm && act.length) {
      var cid = state.loyForm.campaign_id || (act.length === 1 ? act[0].id : ""), cc = act.filter(function (c) { return c.id === cid; })[0];
      h += '<form id="cus-loy" class="cus-form" autocomplete="off" style="grid-template-columns:1fr 1fr"><div class="w"><label for="cus-ly-c">Campaign</label><select id="cus-ly-c" name="campaign_id"><option value="">Choose…</option>' + act.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === cid ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("") + '</select></div>' +
        '<div class="w"><label for="cus-ly-d">What they bought</label><input id="cus-ly-d" name="desc" value="' + esc(state.loyForm.desc || "") + '"></div>' +
        '<div><label for="cus-ly-q">Quantity</label><input id="cus-ly-q" name="qty" inputmode="numeric" value="' + esc(state.loyForm.qty || "1") + '"></div>' +
        '<div><label for="cus-ly-t">Total spend (€)</label><input id="cus-ly-t" name="total" inputmode="decimal" value="' + esc(state.loyForm.total || "") + '" placeholder="0.00"></div>' +
        '<div class="w"><label for="cus-ly-r">Receipt no. (if any)</label><input id="cus-ly-r" name="receipt_no" value="' + esc(state.loyForm.receipt_no || "") + '"></div>' +
        (state.loyErr ? '<div class="w cus-warn" role="alert">' + esc(state.loyErr) + '</div>' : "") +
        '<div class="w cus-actions" style="margin-top:4px"><button type="submit" class="cus-btn p" data-act="loy-save"' + (state.loySaving ? " disabled" : "") + '>' + (state.loySaving ? "Saving…" : "Add purchase") + '</button><button type="button" class="cus-btn" data-act="loy-cancel">Cancel</button></div></form>';
    } else if (act.length) h += '<div class="cus-actions" style="margin-top:10px"><button type="button" class="cus-btn" data-act="loy-add">Add a purchase</button></div>';
    return h;
  }
  async function saveLoy(f) {
    var p = state.detail && state.detail.person; if (!p || state.loySaving) return;
    var v = function (n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };
    state.loyForm = { campaign_id: v("campaign_id"), desc: v("desc"), qty: v("qty"), total: v("total"), receipt_no: v("receipt_no") };
    var camp = (state.loy.camps || []).filter(function (c) { return c.id === state.loyForm.campaign_id; })[0];
    var probs = []; if (!camp) probs.push({ field: "campaign_id", msg: "Choose the campaign." }); if (!state.loyForm.desc) probs.push({ field: "desc", msg: "Write what they bought." });
    if (probs.length) { state.loyErr = ""; E.formErrors(f, probs, { cls: "cus-ferr", at: "field" }); return; }
    var qty = parseInt(state.loyForm.qty, 10) || 1, total = parseFloat(String(state.loyForm.total).replace(",", ".")) || 0, items = [{ desc: state.loyForm.desc, qty: qty }];
    // the classic screen's own sums and words (modules.loyalty.js submitTransaction)
    var stampsAwarded = 0, pointsAwarded = 0, actionLabel = "";
    if (camp.type === "stamp_card") { stampsAwarded = items.reduce(function (a, i) { return a + i.qty; }, 0); actionLabel = "Awarded " + stampsAwarded + " stamp" + (stampsAwarded !== 1 ? "s" : ""); }
    if (camp.type === "points") { pointsAwarded = Math.round((camp.points_per_unit || 1) * total); actionLabel = "Awarded " + pointsAwarded + " points"; }
    if (camp.type === "discount") actionLabel = "Applied " + (camp.discount_pct || 10) + "% discount";
    if (camp.type === "event") actionLabel = "Event purchase recorded";
    if (camp.type === "buy_x_get_y") actionLabel = "Purchase tracked (" + camp.buy_qty + " → " + camp.get_qty + " free)";
    if (camp.type === "tiered") actionLabel = "Spend recorded (€" + total.toFixed(2) + ")";
    var txn = { id: Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8), client_id: loyNormId(p.id_card), client_name: String(p.name || "").trim(), campaign_id: camp.id, receipt_no: state.loyForm.receipt_no,
      items: items, total: total, notes: "", stamps_awarded: stampsAwarded, points_awarded: pointsAwarded, action: "record", action_label: actionLabel, date: E.maltaYmd ? E.maltaYmd() : new Date().toISOString().slice(0, 10), created_at: new Date().toISOString() };
    state.loySaving = true; state.loyErr = ""; repaintLoy();
    try {
      var r = await E.apiFetch("/loyalty/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(txn) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not saved");
      state.loySaving = false; state.loyForm = false; E.toast(actionLabel || "Purchase added", "success");
      await loadLoyalty(); repaintLoy(); E.focusSoon(function () { return state.mount && state.mount.querySelector("#cus-loy-box [data-act=loy-add]"); });
    } catch (x) { state.loySaving = false; state.loyErr = E.saveFailText(x); repaintLoy(); }
  }
  function repaintLoy() { var b = state.mount && state.mount.querySelector("#cus-loy-box"); if (b && state.detail && state.detail.person) { b.innerHTML = loyInner(state.detail.person); bindLoy(b); } }
  function bindLoy(b) {
    var a = b.querySelector("[data-act=loy-add]"); if (a) a.addEventListener("click", function () { state.loyForm = {}; state.loyErr = ""; repaintLoy(); E.focusSoon(function () { var s = b.querySelector("#cus-ly-c"); return s && !s.value ? s : b.querySelector("#cus-ly-d"); }); });
    var c = b.querySelector("[data-act=loy-cancel]"); if (c) c.addEventListener("click", function () { state.loyForm = false; state.loyErr = ""; repaintLoy(); E.focusSoon(function () { return b.querySelector("[data-act=loy-add]"); }); });
    var rt = b.querySelector("[data-act=loy-retry]"); if (rt) rt.addEventListener("click", function (ev) { ev.preventDefault(); state.loy = null; repaintLoy(); loadLoyalty(); });
    var f = b.querySelector("#cus-loy"); if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); saveLoy(f); });
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); state.loyForm = false; repaintLoy(); E.focusSoon(function () { return b.querySelector("[data-act=loy-add]"); }); } });
      f.addEventListener("input", function () { state.loyForm = state.loyForm || {}; ["campaign_id", "desc", "qty", "total", "receipt_no"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) state.loyForm[k] = el.value; }); });
    }
  }
  function loyaltyHtml(d, p) {
    var counts = d.counts || {};
    if (!p.id_card && !counts.loyalty && !d.loyalty) return '<div class="cus-card"><div class="cus-lab" style="margin-top:0">Loyalty</div><div id="cus-loy-box">' + loyInner(p) + '</div></div>';
    return '<div class="cus-card"><div class="cus-lab" style="margin-top:0">Loyalty' + (d.loyalty ? ' <b>' + esc(Number(d.loyalty.points || 0).toLocaleString("en-GB")) + ' pts</b>' : "") + '</div><div id="cus-loy-box">' + loyInner(p) + '</div></div>';
  }

  function tellFrom(spec) {
    var d = state.detail || {}, p = d.person; if (!p || !E.tell) return;
    var nw = state.now && !state.now.off ? state.now : null;
    E.tell.open(Object.assign({ person: p, profile: nw ? Object.assign({}, nw.profile, { opted_out: nw.email && nw.email.opted_out }) : null, email: nw ? nw.email : null, back: document.activeElement,
      onSent: function () { reloadNow(); } }, spec || { purpose: "other" }));
  }

  async function render0(ctx) {
    state.mount = ctx && ctx.mount;
    state.creating = false; state.conflict = ""; state.conflictExisting = null;
    try { var carried = sessionStorage.getItem("eikon_customers_q"); if (carried) { state.q = carried; sessionStorage.removeItem("eikon_customers_q"); } } catch (e) {}
    // From the search (eikon.search.js): open one person, or start a new one with the scanned ID card filled in.
    var go = null; try { go = JSON.parse(sessionStorage.getItem("eikon_customers_open") || "null"); sessionStorage.removeItem("eikon_customers_open"); } catch (e) {}
    if (go && go.at && Date.now() - go.at > 60000) go = null; // an old hand-over is ignored
    if (go && go.new) { state.selected = null; state.detail = null; state.q = String(go.id_card || ""); state.creating = true; }
    injectCss();
    render();
    // Back from a form opened on this person's page (Escape or Cancel there): the person again, focus on the button pressed.
    if (go && Number(go.id) > 0) open(Number(go.id)).then(function () {
      if (!go.focus || state.selected !== Number(go.id) || !state.mount) return;
      var b = state.mount.querySelector('#cus-detail [data-go="' + String(go.focus).replace(/[^a-z]/g, "") + '"]'); if (b) try { b.focus(); } catch (e) {}
    });
  }
  function destroy() { if (state.timer) { clearTimeout(state.timer); state.timer = null; } state.seq++; }

  E.registerModule({ id: "customers", title: "Customers", order: 1, icon: "◯", ui2Only: true, render: render0, destroy: destroy });
})();
