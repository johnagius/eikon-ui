/* ============================================================
   EIKON — one person, whichever screen they were typed into  (eikon.people.js)
   Shared by the new-layout screens. Nothing here changes what a register saves:
   after a register has saved its own record, the person on it is found in the
   pharmacy's people list (GET /people, scoped by the server to this pharmacy)
   and reused; only when nobody matches is one person added (POST /people, which
   the server already turns into "return the existing person" for a known ID card).

   Matching, strictest first:
     1. the same ID card, normalised exactly as the worker does (123m = 0000123M)
     2. the same name AND the same phone or e-mail
     3. the same name, nothing on either side telling them apart, and exactly one
        such person (the server's own rule: its history view and its backfill
        already treat a card-less record with the same name as that person).
        A new ID card goes on that person only when they have none.
   Two possible matches: nothing is linked or added (staff merge in Customers).
   An existing person is never overwritten: only their empty fields are filled,
   by the server's own blank-filling create path or a versioned update.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  function str(v) { return v == null ? "" : String(v); }

  // Same as normalizeMtIdCard in the worker: no spaces, upper case, a Maltese card
  // (1 to 7 digits and a letter) padded to 7 digits. Anything else (a passport) as typed.
  function normIdCard(raw) {
    var s = str(raw).replace(/\s+/g, "").toUpperCase();
    if (!s) return "";
    var m = /^(\d{1,7})([A-Z])$/.exec(s);
    return m ? ("0000000" + m[1]).slice(-7) + m[2] : s;
  }
  // Same as mtIdCardLookupKeys in the worker: every spelling older rows may hold.
  function idCardKeys(raw) {
    var key = str(raw).replace(/\s+/g, "").toUpperCase(), norm = normIdCard(key), out = [];
    if (norm) out.push(norm);
    if (key && out.indexOf(key) < 0) out.push(key);
    var m = /^(\d{1,7})([A-Z])$/.exec(key);
    if (m) { var u = String(parseInt(m[1], 10)) + m[2]; if (out.indexOf(u) < 0) out.push(u); }
    return out;
  }
  function isMtIdCard(raw) { return /^\d{1,7}[A-Z]$/.test(str(raw).replace(/\s+/g, "").toUpperCase()); }
  function sameIdCard(a, b) { var x = normIdCard(a); return !!x && x === normIdCard(b); }
  // Names: trimmed, one space between words (the worker's peopleCleanBody); compared without case (its personKey).
  function normName(raw) { return str(raw).trim().replace(/\s+/g, " "); }
  function nameKey(raw) { return normName(raw).toLowerCase(); }
  // E-mail: trimmed, lower case (peopleCleanBody). Only a well-formed one is sent: the server refuses the rest.
  function normEmail(raw) { return str(raw).trim().toLowerCase(); }
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }
  // Phones are compared on their digits, without Malta's +356 / 00356; they are sent as typed.
  function normPhone(raw) {
    var d = str(raw).replace(/\D+/g, "");
    if (d.length > 8 && d.indexOf("00356") === 0) d = d.slice(5);
    else if (d.length === 11 && d.indexOf("356") === 0) d = d.slice(3);
    return d;
  }
  function phonesOf(p) { return [normPhone(p && p.phone), normPhone(p && p.alt_phone)].filter(Boolean); }

  // What a screen hands over, cleaned the way the server will clean it.
  function clean(d) {
    d = d || {};
    var email = normEmail(d.email), dob = str(d.date_of_birth).trim();
    return {
      name: normName(d.name), id_card: normIdCard(d.id_card), phone: str(d.phone).trim(), alt_phone: str(d.alt_phone).trim(),
      email: validEmail(email) ? email : "", address: str(d.address).trim(), doctor_name: str(d.doctor_name).trim(),
      date_of_birth: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : ""
    };
  }
  // A phone or an e-mail on both sides that differ: two people who share a name.
  function conflicts(p, w) {
    if (w.id_card && p.id_card && !sameIdCard(p.id_card, w.id_card)) return true;
    var wp = phonesOf(w), pp = phonesOf(p);
    if (wp.length && pp.length && !wp.some(function (x) { return pp.indexOf(x) >= 0; })) return true;
    if (w.email && p.email && normEmail(p.email) !== w.email) return true;
    return false;
  }
  function confirms(p, w) {
    var pp = phonesOf(p);
    return phonesOf(w).some(function (x) { return pp.indexOf(x) >= 0; }) || (!!w.email && normEmail(p.email) === w.email);
  }

  async function search(q) {
    var r = await E.apiFetch("/people?q=" + encodeURIComponent(q) + "&limit=50", { method: "GET", timeoutMs: 10000 });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not search people");
    return { people: Array.isArray(r.people) ? r.people : [], history: Array.isArray(r.history) ? r.history : [] };
  }

  // find(details) → { person, how } | { person: null, ambiguous: [..] } | { person: null, adopt: historyGroup }
  async function find(details) {
    var w = clean(details);
    if (!w.id_card && w.name.length < 2) return { person: null };
    if (w.id_card) {
      var byCard = await search(w.id_card);
      var hit = byCard.people.filter(function (p) { return !p.merged_into && sameIdCard(p.id_card, w.id_card); })[0];
      if (hit) return { person: hit, how: "id_card" };
    }
    if (w.name.length < 2) return { person: null };
    var byName = await search(w.name), k = nameKey(w.name);
    var same = byName.people.filter(function (p) { return !p.merged_into && nameKey(p.name) === k; });
    var ok = same.filter(function (p) { return !conflicts(p, w); });
    var sure = ok.filter(function (p) { return confirms(p, w); });
    if (sure.length === 1) return { person: sure[0], how: "name+contact" };
    if (sure.length > 1) return { person: null, ambiguous: sure };
    // An ID card nobody holds yet, and exactly one person with this name, no card and nothing that differs: the
    // server already counts them as one (its history view hides the card-less name, its backfill joins them, the
    // person's story is read by name), so the card goes on that person. Two such people: a person of its own.
    if (w.id_card) return ok.length === 1 && E.people.attachCardByName ? { person: ok[0], how: "name+card" } : { person: null };
    // No card: the one person with this name and nothing that differs. Two of them: do not guess.
    if (ok.length === 1) return { person: ok[0], how: "name" };
    if (ok.length > 1) return { person: null, ambiguous: ok };
    // A card-less entry whose name is in history with exactly one ID card is that person (the backfill's rule).
    var hist = byName.history.filter(function (g) { return g && g.id_card && nameKey(g.name) === k && !conflicts(g, w); });
    if (hist.length === 1) return { person: null, adopt: hist[0] };
    if (hist.length > 1) return { person: null, ambiguous: hist };
    return { person: null };
  }

  var FILL = ["phone", "alt_phone", "email", "address", "doctor_name", "date_of_birth"];
  var queue = Promise.resolve();

  // link(details, source) → { person, created, how } | { person: null, skipped: why }. Never throws.
  // One at a time, so two saves in a row cannot both add the same person.
  function link(details, source) {
    var run = async function () {
      try {
        var w = clean(details);
        if (w.name.length < 2) return { person: null, skipped: "no name" };
        var f = await find(w);
        if (f.ambiguous) return { person: null, skipped: "ambiguous", candidates: f.ambiguous };
        if (f.person) {
          var p = f.person, fill = {};
          FILL.forEach(function (k) { if (w[k] && !str(p[k]).trim()) fill[k] = w[k]; });
          if (fill.phone && phonesOf(p).indexOf(normPhone(fill.phone)) >= 0) delete fill.phone;
          if (w.id_card && !p.id_card && f.how !== "id_card") fill.id_card = w.id_card; // a blank card filled, never a card changed
          if (!Object.keys(fill).length) return { person: p, created: false, how: f.how };
          var body = f.how === "id_card"
            ? Object.assign({ name: p.name, id_card: p.id_card }, fill) // the server's own path: fills the blanks of the card's owner
            : Object.assign({ id: p.id, version: p.version }, fill);   // a versioned update of the empty fields only
          try {
            var u = await E.apiFetch("/people", { method: "POST", body: JSON.stringify(body), timeoutMs: 10000 });
            return { person: (u && u.person) || p, created: false, how: f.how, filled: Object.keys(fill) };
          } catch (e1) { return { person: p, created: false, how: f.how, filled: [] }; } // changed elsewhere: the match still stands
        }
        var nb = { name: w.name, source: String(source || "register").slice(0, 40) };
        var a = f.adopt;
        nb.id_card = w.id_card || (a ? normIdCard(a.id_card) : "");
        ["phone", "alt_phone", "email", "address", "doctor_name"].forEach(function (k) { var v = w[k] || (a && k !== "email" ? str(a[k]).trim() : ""); if (v) nb[k] = v; });
        if (w.date_of_birth) nb.date_of_birth = w.date_of_birth;
        var r = await E.apiFetch("/people", { method: "POST", body: JSON.stringify(nb), timeoutMs: 10000 });
        return { person: (r && r.person) || null, created: !!(r && r.created), how: a ? "history" : "new" };
      } catch (e) { return { person: null, skipped: "error", error: String((e && e.message) || e) }; }
    };
    var p = queue.then(run, run);
    queue = p.then(function () {}, function () {});
    return p;
  }

  // A known ID card's person, for filling a form's empty fields. Null when there is none or on any error.
  async function byIdCard(raw) {
    var c = normIdCard(raw); if (!c) return null;
    try { var r = await search(c); return r.people.filter(function (p) { return !p.merged_into && sameIdCard(p.id_card, c); })[0] || null; } catch (e) { return null; }
  }

  E.people = {
    normIdCard: normIdCard, idCardKeys: idCardKeys, isMtIdCard: isMtIdCard, sameIdCard: sameIdCard,
    normName: normName, nameKey: nameKey, normEmail: normEmail, normPhone: normPhone,
    find: find, link: link, byIdCard: byIdCard,
    // Off switches: the hook in the screens, and putting a new ID card on the one card-less person with that name.
    autoLink: true, attachCardByName: false
  };
  // For the screens: link after a save, without waiting and without ever failing the save.
  E.linkPerson = function (details, source) {
    if (!E.people.autoLink) return null;
    var p = link(details, source);
    E._lastPersonLink = p;
    return p;
  };
})();
