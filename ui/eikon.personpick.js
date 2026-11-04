/* People already known to this pharmacy, offered as you type an ID card or a name in a register form (new layout).
   One helper for every screen: E.personPick.attach(opts) after each redraw of the form.
     - Reads only: GET /people?q= (people saved in Customers, and people found in the registers' history),
       GET /dda-sales/clients?q= where a screen asks for it, and the rows the screen already loaded. The server scopes
       both to the signed-in pharmacy (org and location); nothing here widens that, and the cache is per sign-in.
     - Choosing a person writes the chosen value into the field being typed and fills the other person fields only
       where they are still empty. A complete ID card that matches one person exactly fills the empty fields by
       itself and says so quietly ("Filled from 12 Mar DDA sale"). Nothing typed is ever written over, and the field
       the person is in is never filled under their fingers.
     - ID cards are compared the way the server compares them (normalizeMtIdCard / mtIdCardLookupKeys): spaces out,
       upper case, 1 to 7 digits and a letter padded to 7 digits (123M -> 0000123M); padded and unpadded are the same.
   ARIA combobox (input) + listbox (list below the field, in the page flow so nothing is clipped on a phone):
   arrows move, Enter chooses, Escape closes, a tap chooses. Focus never leaves the input. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var TTL = 45000, WAIT = 220, MAX = 6;
  var LABEL = { dda_sale: "DDA sale", poyc: "POYC", repeat: "prescription", poct: "test", loyalty: "loyalty card", appointment: "appointment", waitlist: "waiting list", order: "order", delivery: "delivery", question: "question", calculator: "calculator" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var cache = {}, cacheScope = "", states = {}, seq = 0;

  function str(v) { return v == null ? "" : String(v); }
  function low(v) { return str(v).toLowerCase(); }
  function esc(s) { return E.escapeHtml ? E.escapeHtml(str(s)) : str(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  // the server's normalizeMtIdCard: no spaces, upper case, 1-7 digits + a letter padded to 7 digits
  function normId(raw) { var s = str(raw).replace(/\s+/g, "").toUpperCase(), m = /^(\d{1,7})([A-Z])$/.exec(s); return m ? ("0000000" + m[1]).slice(-7) + m[2] : s; }
  // the same card whether stored padded or not (mtIdCardLookupKeys): compare without the leading zeros
  function idKey(raw) { return normId(raw).replace(/^0+(?=\d)/, ""); }
  function fullId(raw) { return /^\d{1,7}[A-Z]$/.test(str(raw).replace(/\s+/g, "").toUpperCase()); }
  function idLike(q) { return /^\d{3,}[A-Za-z]?$/.test(str(q).replace(/\s+/g, "")); }
  function nameKey(n) { return low(n).trim().replace(/\s+/g, " "); }
  function when(d) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(d)); if (!m) return ""; return Number(m[3]) + " " + MON[Number(m[2]) - 1] + (Number(m[1]) === new Date().getFullYear() ? "" : " " + m[1]); }
  E.idCardNorm = normId; E.idCardKey = idKey;

  function css() {
    if (document.getElementById("eikon-personpick-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-personpick-css";
    st.textContent =
      ".epp-list{margin:2px 10px 6px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);color:var(--text);overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.08)}" +
      ".epp-opt{display:block;min-height:44px;padding:8px 12px;border-top:.5px solid var(--border);cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent}.epp-opt:first-child{border-top:0}" +
      ".epp-opt b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.epp-opt span{display:block;font-size:12.5px;color:var(--muted);margin-top:1px;overflow-wrap:anywhere}" +
      ".epp-opt[aria-selected=true]{background:rgba(127,127,127,.10);box-shadow:inset 3px 0 0 var(--accent)}@media (hover:hover){.epp-opt:hover{background:rgba(127,127,127,.10)}}" +
      ".epp-note{margin:0 14px 6px;font-size:12.5px;color:var(--muted)}.epp-note:empty{display:none}" +
      ".epp-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
      "input[aria-expanded=true].epp-on{outline:0}";
    document.head.appendChild(st);
  }

  function scope() { var u = (E.state && E.state.user) || {}; return [u.org_id, u.location_id, u.id || u.user_id].join(":"); }
  function cached(k, fn) {
    var sc = scope(); if (sc !== cacheScope) { cache = {}; cacheScope = sc; } // another sign-in never sees these answers
    var c = cache[k], now = Date.now();
    if (c && now - c.at < TTL && !(E.lastWriteAt && E.lastWriteAt > c.at)) return c.p; // a save makes them stale
    var p = Promise.resolve().then(fn).catch(function () { delete cache[k]; return []; });
    cache[k] = { at: now, p: p }; return p;
  }
  // what is sent to the server: an ID card without its leading zeros, so padded and unpadded both match the LIKE
  // A name of several words is sent as its longest word (the server matches one run of text, so "Carmel Zammit" would
  // miss "Zammit Carmel"); every word is then checked here (matches), in any order.
  // ċ ġ ħ ż: the server's LOWER()/LIKE know only A to Z, so "ħabela" never found "Ħabela". A name with them is sent as
  // its longest stretch without them ("abela"); matches() then keeps the names with every word typed, compared with
  // the browser's own lower case, which knows Maltese (as Customers and the search do).
  var MT = /[ċġħżĊĠĦŻ]/;
  function longest(list) { return list.reduce(function (a, b) { return b.length > a.length ? b : a; }, ""); }
  function wire(q) {
    var s = str(q).trim(); if (idLike(s)) return s.replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
    if (MT.test(s)) { var best = longest(s.split(/[\sċġħżĊĠĦŻ]+/)); if (best.length >= 2) return best; }
    var w = s.split(/\s+/); return w.length > 1 ? longest(w) : s;
  }
  E.personPickWire = wire; // for the tests

  var SOURCES = {
    people: function (q) {
      return cached("people|" + q, async function () {
        var r = await E.apiFetch("/people?q=" + encodeURIComponent(q) + "&limit=30", { method: "GET", timeoutMs: 8000 });
        if (!r || !r.ok) return [];
        var out = [];
        (r.people || []).forEach(function (p) { out.push({ pid: p.id, name: p.name, id_card: p.id_card, phone: p.phone, address: p.address, date: "", from: "Customers" }); });
        (r.history || []).forEach(function (h) {
          var kinds = Object.keys(h.sources || {});
          out.push({ name: h.name, id_card: h.id_card, phone: h.phone, address: h.address, date: str(h.last_date).slice(0, 10), from: kinds.length === 1 ? (LABEL[kinds[0]] || "record") : "records" });
        });
        return out;
      });
    },
    dda: function (q) {
      return cached("dda|" + q, async function () {
        var r = await E.apiFetch("/dda-sales/clients?q=" + encodeURIComponent(q) + "&limit=8", { method: "GET", timeoutMs: 8000 });
        return ((r && r.ok && r.clients) || []).map(function (c) { return { name: c.client_name, id_card: c.client_id_card, address: c.client_address, date: "", from: "DDA sale" }; });
      });
    }
  };

  // a query with a digit is an ID card, whole or in part (leading zeros do not count); otherwise every word of the name
  function matches(c, q) {
    var s = str(q).trim();
    if (/\d/.test(s)) return !!c.id_card && idKey(c.id_card).indexOf(s.replace(/\s+/g, "").toUpperCase().replace(/^0+(?=\d)/, "")) >= 0;
    var n = low(c.name);
    return low(s).split(/\s+/).every(function (t) { return n.indexOf(t) >= 0; });
  }
  // one row per person: the same ID card (padded or not) is one person; a name-only row joins the one with that name
  function merge(list) {
    var byId = {}, byName = {}, out = [];
    list.forEach(function (c) {
      if (!c || !str(c.name).trim()) return;
      var k = c.id_card ? idKey(c.id_card) : "", n = nameKey(c.name), g = k ? byId[k] : (byName[n] && byName[n].length === 1 ? byName[n][0] : null);
      if (!g) { g = { name: str(c.name).trim(), id_card: str(c.id_card).trim(), phone: "", address: "", dob: "", date: "", from: "" }; out.push(g); if (k) byId[k] = g; (byName[n] = byName[n] || []).push(g); }
      ["phone", "address", "dob"].forEach(function (f) { if (!g[f] && str(c[f]).trim()) g[f] = str(c[f]).trim(); });
      if (c.pid && !g.pid) g.pid = c.pid; // saved in Customers: the search (eikon.search.js) opens that record
      if (!g.id_card && c.id_card) { g.id_card = str(c.id_card).trim(); byId[idKey(c.id_card)] = g; }
      if (c.date && c.date > g.date) { g.date = c.date; g.from = c.from; } else if (!g.from) g.from = c.from;
    });
    return out;
  }
  function sortFor(list, q) {
    var ex = idLike(q) ? idKey(q) : "";
    return list.sort(function (a, b) {
      var ea = ex && idKey(a.id_card) === ex ? 0 : 1, eb = ex && idKey(b.id_card) === ex ? 0 : 1;
      if (ea !== eb) return ea - eb;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }
  function origin(c) {
    if (c.from === "Customers") return "Customers";
    if (c.from === "records") return "earlier records" + (c.date ? " (last " + when(c.date) + ")" : ""); // seen in several registers
    return (c.date ? when(c.date) + " " : "an earlier ") + (c.from || "record");
  }

  // ---- one combobox per field; state kept by key so a redraw of the form does not lose the list or the note ----
  var picks = {}; // the person last chosen on each screen, for E.people.confirmPerson (which of two namesakes)
  E.personPick = {
    norm: normId, key: idKey,
    picked: function (key) { var x = picks[key]; return x && Date.now() - x.at < 600000 ? x : null; },
    // The same lookup without a form, for the search (eikon.search.js): people saved in Customers and people seen in
    // the registers, one row each, best first. Same cache, same scope, same rules as the suggestions under a field.
    find: async function (q, max) {
      q = str(q).trim(); if (!q) return [];
      var list = ((await SOURCES.people(wire(q))) || []).filter(function (c) { return matches(c, q); });
      return sortFor(merge(list), q).slice(0, max || MAX);
    },
    attach: function (o) {
      if (!o || !o.form || !o.fields) return;
      css();
      ["id", "name"].forEach(function (kind) {
        var nm = o.fields[kind]; if (!nm || (o.suggest && o.suggest.indexOf(kind) < 0)) return;
        var el = o.form.querySelector('[name="' + nm + '"]'); if (!el || el.disabled) return;
        bind(o, kind, el);
      });
    }
  };

  function bind(o, kind, el) {
    var sk = o.key + "|" + kind, st = states[sk] || (states[sk] = { open: false, items: [], act: -1, q: "", note: "", noteFor: "" });
    if (el.__epp) return; el.__epp = true;
    var lid = "epp-" + o.key + "-" + kind, row = el.closest("label") || el.parentNode;
    if (el.hasAttribute("list")) el.removeAttribute("list"); // one list, not two (a datalist would open on top of this one)
    el.setAttribute("role", "combobox"); el.setAttribute("aria-autocomplete", "list"); el.setAttribute("aria-controls", lid); el.setAttribute("aria-expanded", "false");
    el.setAttribute("autocomplete", "off"); el.classList.add("epp-on");
    var box = document.createElement("div"); box.className = "epp-list"; box.id = lid; box.setAttribute("role", "listbox"); box.setAttribute("aria-label", kind === "id" ? "Known ID cards" : "Known people"); box.hidden = true;
    var note = document.createElement("div"); note.className = "epp-note"; note.setAttribute("role", "status");
    var sr = document.createElement("span"); sr.className = "epp-sr"; sr.setAttribute("aria-live", "polite");
    row.parentNode.insertBefore(note, row.nextSibling); row.parentNode.insertBefore(box, note); row.parentNode.insertBefore(sr, note.nextSibling);
    var form = o.form, timer = null;
    var other = function (f) { var nm = o.fields[f]; var x = nm && form.querySelector('[name="' + nm + '"]'); return x && !x.disabled ? x : null; };
    var sameKey = function () { return kind === "id" ? idKey(el.value) : nameKey(el.value); };
    if (st.note && st.noteFor === sameKey()) note.textContent = st.note; else { st.note = ""; st.noteFor = ""; }

    function draw() {
      var open = st.open && st.items.length > 0 && document.activeElement === el;
      box.hidden = !open; el.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) { box.innerHTML = ""; el.removeAttribute("aria-activedescendant"); return; }
      box.innerHTML = st.items.map(function (c, i) {
        var sub = [c.id_card, c.address || c.phone, c.date || c.from === "Customers" ? origin(c) : ""].filter(Boolean).join(" · ");
        return '<div class="epp-opt" role="option" id="' + lid + "-" + i + '" data-i="' + i + '" aria-selected="' + (i === st.act) + '"><b>' + esc(c.name) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>";
      }).join("");
      if (st.act >= 0) { el.setAttribute("aria-activedescendant", lid + "-" + st.act); var a = box.children[st.act]; if (a && a.scrollIntoView) try { a.scrollIntoView({ block: "nearest" }); } catch (e) {} }
      else el.removeAttribute("aria-activedescendant");
    }
    function close() { st.open = false; st.act = -1; draw(); }
    function say(t) { sr.textContent = t; }

    async function search() {
      var q = str(el.value).trim(), my = ++seq; st.q = el.value;
      var ok = kind === "id" ? idLike(q) || (q.replace(/\s+/g, "").length >= 3 && /\d/.test(q)) : q.replace(/[^A-Za-zÀ-ɏ]/g, "").length >= 2 && !/\d/.test(q);
      if (!ok) { st.items = []; close(); return; }
      var w = wire(q), lists = [];
      try { lists.push(((o.local && o.local()) || []).filter(function (c) { return matches(c, q); })); } catch (e) {}
      var rem = await Promise.all((o.sources || ["people"]).map(function (s) { return SOURCES[s] ? SOURCES[s](w) : Promise.resolve([]); }));
      if (my !== seq || !document.body.contains(el) || str(el.value).trim() !== q) return; // a newer search, or the form was redrawn or changed
      rem.forEach(function (r) { lists.push((r || []).filter(function (c) { return matches(c, q); })); });
      var items = sortFor(merge([].concat.apply([], lists)), q).slice(0, MAX);
      if (kind === "id" && o.exact !== false && fullId(q)) {
        var hit = items.filter(function (c) { return idKey(c.id_card) === idKey(q); });
        if (hit.length === 1 && st.exactFor !== idKey(q)) { st.exactFor = idKey(q); if (fill(hit[0], "exact")) { st.items = []; close(); return; } }
      }
      st.items = items; st.act = -1; st.open = document.activeElement === el; draw();
      if (st.open) say(items.length ? items.length + (items.length === 1 ? " person" : " people") + " known. Arrow down to choose." : "");
    }

    // write only into empty fields (and never into the one being typed in, unless it is the field the choice came from)
    function fill(c, how) {
      var done = [], ae = document.activeElement;
      if (how === "pick") {
        var v = kind === "id" ? (o.idValue ? o.idValue(c.id_card) : c.id_card) : c.name;
        if (v && (kind === "id" ? idKey(el.value) !== idKey(v) : nameKey(el.value) !== nameKey(v))) el.value = v;
      }
      ["id", "name", "address", "phone", "dob"].forEach(function (f) {
        if (f === kind) return;
        var x = other(f), val = f === "id" ? (c.id_card && (o.idValue ? o.idValue(c.id_card) : c.id_card)) : c[f];
        if (!x || !val || str(x.value).trim() || (x === ae && how !== "pick")) return;
        x.value = val; done.push(f);
      });
      picks[o.key] = { pid: c.pid || null, name: c.name, id_card: c.id_card || "", at: Date.now() };
      st.note = done.length ? "Filled from " + origin(c) : ""; st.noteFor = sameKey(); note.textContent = st.note;
      if (st.note) say(st.note);
      try { if (o.onFill) o.onFill({ person: c, filled: done, how: how, field: kind }); } catch (e) {}
      return done.length > 0;
    }
    function choose(i) {
      var c = st.items[i]; if (!c) return;
      st.items = []; st.open = false; st.act = -1; st.exactFor = kind === "id" ? idKey(c.id_card) : st.exactFor;
      draw(); fill(c, "pick");
      var again = document.body.contains(el) ? el : form.querySelector('[name="' + el.name + '"]'); // onFill may have redrawn the form
      if (again && document.activeElement !== again) try { again.focus(); } catch (e) {}
    }

    el.addEventListener("input", function () {
      if (st.note && st.noteFor !== sameKey()) { st.note = ""; note.textContent = ""; }
      if (st.exactFor && st.exactFor !== sameKey()) st.exactFor = ""; // another card: it may fill once again
      clearTimeout(timer); timer = setTimeout(search, WAIT);
    });
    el.addEventListener("keydown", function (ev) {
      var n = st.items.length, open = !box.hidden;
      if (ev.key === "ArrowDown") { if (!n) return; ev.preventDefault(); if (!open) { st.open = true; st.act = 0; } else st.act = (st.act + 1) % n; draw(); }
      else if (ev.key === "ArrowUp") { if (!open || !n) return; ev.preventDefault(); st.act = st.act <= 0 ? n - 1 : st.act - 1; draw(); }
      else if (ev.key === "Enter") { if (open && st.act >= 0) { ev.preventDefault(); ev.stopPropagation(); choose(st.act); } }
      else if (ev.key === "Escape") { if (open) { ev.preventDefault(); ev.stopPropagation(); close(); } }
      else if (ev.key === "Tab") { if (open) close(); }
    });
    el.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== el) { st.open = false; st.act = -1; if (document.body.contains(el)) draw(); } }, 120); });
    box.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // the tap must not take focus from the field
    box.addEventListener("click", function (ev) { var t = ev.target.closest && ev.target.closest(".epp-opt"); if (t) choose(Number(t.getAttribute("data-i"))); });

    // the form was redrawn while the list was open and the field kept focus: show the list again where it was
    if (st.open && st.items.length && document.activeElement === el && el.value === st.q) draw(); else { st.open = false; st.act = -1; }
  }
})();
