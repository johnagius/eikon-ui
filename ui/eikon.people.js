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

  // People's names in Title Case. The function below is the worker's eikonNameCase, character for character
  // (left at the margin so the two can be compared as text; tests do). The worker also applies it when a
  // record is saved, so this is only so people see it as soon as they leave the field.
function eikonNameCase(value) {
  if (typeof value !== "string") return value;
  if (/[0-9@]/.test(value)) return value;
  var hasLower = /\p{Ll}/u.test(value), hasUpper = /\p{Lu}/u.test(value);
  if (hasLower === hasUpper) return value;
  var letters = value.match(/\p{L}/gu) || [];
  if (hasUpper && !/\s/.test(value.trim()) && (letters.length <= 2 || (letters.length === 3 && !/[AEIOUY]/.test(value)))) return value;
  var out = value.toLowerCase().replace(/(^|[\s\-‐‑–—.(\/"“])(\p{Ll})/gu, function (m, pre, ch) { return pre + ch.toUpperCase(); });
  out = out.replace(/(^|[^\p{L}])(\p{Lu})(['’ʼ])(\p{Ll})/gu, function (m, pre, a, ap, b) { return pre + a + ap + b.toUpperCase(); });
  out = out.replace(/(^|[^\p{L}])Mc(\p{Ll})(?=\p{Ll})/gu, function (m, pre, a) { return pre + "Mc" + a.toUpperCase(); });
  out = out.replace(/(\s)(Ii|Iii|Iv|Vi|Vii|Viii|Ix)(?=$|[\s,.])/g, function (m, pre, r) { return pre + r.toUpperCase(); });
  if (out.toLowerCase() !== value.toLowerCase()) return value;
  return out;
}

  // The name fields of the new-layout screens: cased when the field is left. Only the value is set (and a
  // "change" sent); the screens read their fields when they save, so nothing else needs to know.
  var PERSON_INPUTS = ["client_name", "client_surname", "client_first", "client_last", "patient_name", "patientName", "person_name", "personName",
    "recipient_name", "locum_full_name", "cleaner_name", "staff_name", "doctor_name", "prescriber_name"];
  function isPersonInput(el) {
    if (!el || el.tagName !== "INPUT" || el.readOnly || el.disabled) return false;
    if (el.type && el.type !== "text" && el.type !== "search") return false;
    if (el.hasAttribute("data-no-namecase")) return false;
    if (el.hasAttribute("data-person-name") || el.id === "bkx-name") return true;
    var n = el.getAttribute("name") || "";
    if (PERSON_INPUTS.indexOf(n) >= 0) return true;
    return n === "name" && !!(el.closest && el.closest("#cus-new, #cus-edit, #scr-add, #poc-add"));
  }
  function caseOnLeave(ev) {
    var el = ev.target;
    if (!document.documentElement.hasAttribute("data-ui2") || !isPersonInput(el)) return;
    var v = el.value, nv = eikonNameCase(v);
    if (nv === v) return;
    el.value = nv;
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
  }
  if (!window.__eikonNameCaseOn) { window.__eikonNameCaseOn = true; document.addEventListener("focusout", caseOnLeave, true); }

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
    normName: normName, nameKey: nameKey, normEmail: normEmail, normPhone: normPhone, nameCase: eikonNameCase, isPersonInput: isPersonInput,
    find: find, link: link, byIdCard: byIdCard,
    // Off switches: the hook in the screens, and putting a new ID card on the one card-less person with that name.
    autoLink: true, attachCardByName: false
  };
  // For the screens: link after a save, without waiting and without ever failing the save.
  E.linkPerson = function (details, source, asked) {
    if (!E.people.autoLink) return null;
    if (asked && asked.link === false) return null; // the person said: this record only (eikon.people.confirm below)
    var p = link(details, source);
    E._lastPersonLink = p;
    return p;
  };
})();

/* ============================================================
   The ID card on a record and the person it belongs to (E.people.confirmPerson)
   Called by each new-layout screen right before it saves a record that has an ID card,
   so the question is the same everywhere. It never saves the record itself and never
   touches the form: the screen keeps everything until it gets { action: "save" }.

   A  the person (picked, or the one person with this name) has no ID card:
        "Add ID card 0012345M to Laura Borg's details?"  Yes (default) / No, just save / Go back.
        Yes sets the card on the person (POST /people, versioned) and, for an administrator,
        offers their earlier card-less records to tick (POST /people/:id/change-id-card, from "").
   B  the card belongs to someone with another name: the save stops.
        "0012345M belongs to Carmel Zammit. Is this Carmel Zammit?"
        Yes, it is Carmel Zammit (puts the name in the form, back to the form) / No, go back (default).
   C  the person has another ID card:
        "Change Laura Borg's ID card from 0012345M to 0023456M on their details and all their records?"
        with how many records per register (legal registers first). Change everywhere (administrators) /
        Keep 0012345M (default: puts it back in the form) / Only this record / Go back.
   Names compare as the worker's personNamesCompatible: no case, accents, punctuation or word order.
   Any lookup failing: the save goes ahead as before (a register entry is never blocked by a search).
   Returns { action: "save" | "back" | "fill", field, value, link, person, change }.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E || !E.people) return;
  var P = E.people;
  function str(v) { return v == null ? "" : String(v); }
  function esc(s) { return E.escapeHtml ? E.escapeHtml(str(s)) : str(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }

  // Identical to the worker's personNameWords / personNamesCompatible (the UI suite runs both side by side).
  function nameWords(raw) {
    return str(raw).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9\u0127\u0121\u017c\u010b]+/g, " ").trim().split(" ").filter(Boolean).sort();
  }
  function namesCompatible(a, b) {
    var x = nameWords(a), y = nameWords(b);
    if (!x.length || !y.length) return false;
    if (x.join(" ") === y.join(" ")) return true;
    var s = x.length <= y.length ? x : y, l = (x.length <= y.length ? y : x).slice();
    if (s.length < 2) return false;
    for (var i = 0; i < s.length; i++) { var k = l.indexOf(s[i]); if (k < 0) return false; l.splice(k, 1); }
    return true;
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function day(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v)); return m ? Number(m[3]) + " " + MON[Number(m[2]) - 1] + " " + m[1] : str(v); }
  function longestWord(n) { return str(n).trim().split(/\s+/).reduce(function (a, b) { return b.length > a.length ? b : a; }, ""); }
  function phonesOf(p) { return [P.normPhone(p && p.phone), P.normPhone(p && p.alt_phone)].filter(Boolean); }
  function contactDiffers(p, w) { // a phone or e-mail on both sides that differ: a namesake, not this person
    var wp = phonesOf(w), pp = phonesOf(p);
    if (wp.length && pp.length && !wp.some(function (x) { return pp.indexOf(x) >= 0; })) return true;
    return !!(w.email && p.email && P.normEmail(p.email) !== P.normEmail(w.email));
  }
  async function search(q) {
    var r = await E.apiFetch("/people?q=" + encodeURIComponent(q) + "&limit=50", { method: "GET", timeoutMs: 8000 });
    if (!r || !r.ok) throw new Error((r && r.error) || "search failed");
    return { people: (r.people || []).filter(function (p) { return !p.merged_into; }), history: r.history || [] };
  }

  // ---------- the dialog: role=alertdialog, focus kept inside, Escape = go back, focus returned after ----------
  function css() {
    if (document.getElementById("eikon-pconfirm-css")) return;
    var st = document.createElement("style"); st.id = "eikon-pconfirm-css";
    st.textContent =
      ".epc-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}" +
      ".epc{background:var(--panel2,#fff);color:var(--text,#141B24);border-radius:16px;width:100%;max-width:460px;padding:20px 20px 16px;box-shadow:0 12px 40px rgba(0,0,0,.25);font-size:15px;line-height:1.45}" +
      ".epc h2{font-size:18px;line-height:1.3;margin:0 0 8px;font-weight:700;overflow-wrap:anywhere}.epc p{margin:0 0 10px;color:var(--text,#141B24)}.epc .epc-m{color:var(--muted,#5B6675);font-size:13.5px}" +
      ".epc ul{margin:0 0 12px;padding:0;list-style:none;border:1px solid var(--border,#E2E7ED);border-radius:12px;max-height:220px;overflow:auto}.epc li{padding:8px 12px;border-top:1px solid var(--border,#E2E7ED);display:flex;gap:10px;align-items:center;justify-content:space-between}.epc li:first-child{border-top:0}.epc ul.epc-n{max-height:none;overflow:visible}" +
      ".epc li b{font-weight:600;font-variant-numeric:tabular-nums}.epc li label{display:flex;gap:10px;align-items:center;min-height:32px;cursor:pointer;flex:1}.epc li input{width:20px;height:20px;accent-color:var(--accent,#1F5FD8);flex:0 0 auto}" +
      ".epc-tag{font-size:11.5px;font-weight:600;padding:1px 7px;border-radius:999px;border:1px solid var(--border,#E2E7ED);color:var(--muted,#5B6675);margin-left:6px;white-space:nowrap}" +
      ".epc-acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px}" +
      ".epc-b{font:inherit;font-size:15px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border,#E2E7ED);background:transparent;color:var(--accent,#1F5FD8);cursor:pointer}" +
      ".epc-b.p{background:var(--accent,#1F5FD8);border-color:var(--accent,#1F5FD8);color:#fff}.epc-b:disabled{opacity:.55;cursor:default}" +
      ".epc-b:focus-visible{outline:3px solid rgba(10,143,106,.6);outline-offset:2px}" +
      ".epc-err{color:var(--danger,#BF3B2E);font-size:14px;margin:6px 0 0}.epc-err:empty{display:none}" +
      "@media (max-width:480px){.epc-acts{flex-direction:column-reverse;align-items:stretch}.epc-b{width:100%}.epc{padding:18px 16px 14px}}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .epc-b.p{color:#00160E}html[data-ui2]:not([data-ui2-visit]) .epc-ov{background:rgba(0,0,0,.65)}}";
    document.head.appendChild(st);
  }

  // open(step) shows a step and resolves with the id of the button pressed ("back" for Escape).
  // step = { title, html, buttons: [{ id, label, primary, focus }], busy } ; the same box is reused for the next step.
  function Dialog() {
    css();
    var self = this, back = document.activeElement, ov = document.createElement("div"), seq = 0;
    ov.className = "epc-ov";
    ov.innerHTML = '<div class="epc" role="alertdialog" aria-modal="true" aria-labelledby="epc-t" aria-describedby="epc-d"><h2 id="epc-t"></h2><div id="epc-d"></div><p class="epc-err" role="alert"></p><div class="epc-acts"></div></div>';
    var hidden = [];
    Array.prototype.forEach.call(document.body.children, function (el) { if (el !== ov && !el.hasAttribute("inert") && !/eikon-toast/.test(el.className || "")) { el.setAttribute("inert", ""); hidden.push(el); } });
    document.body.appendChild(ov);
    var box = ov.firstChild, resolveNow = null;
    function focusables() { return Array.prototype.filter.call(box.querySelectorAll("button,input,[href],[tabindex]:not([tabindex='-1'])"), function (x) { return !x.disabled; }); }
    ov.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); if (resolveNow) resolveNow("back"); return; }
      if (ev.key !== "Tab") return;
      var f = focusables(); if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus(); } else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
    });
    ov.addEventListener("mousedown", function (ev) { if (ev.target === ov) ev.preventDefault(); }); // a tap beside the box does nothing (no silent "no")
    self.box = box;
    self.err = function (t) { box.querySelector(".epc-err").textContent = t || ""; };
    self.busy = function (on) { Array.prototype.forEach.call(box.querySelectorAll(".epc-b"), function (b) { b.disabled = !!on; }); };
    self.open = function (step) {
      var my = ++seq;
      box.querySelector("#epc-t").textContent = step.title;
      box.querySelector("#epc-d").innerHTML = step.html || "";
      self.err(step.error || "");
      var acts = box.querySelector(".epc-acts"); acts.innerHTML = "";
      var first = null;
      step.buttons.forEach(function (b) {
        var el = document.createElement("button"); el.type = "button"; el.className = "epc-b" + (b.primary ? " p" : ""); el.textContent = b.label; el.setAttribute("data-epc", b.id);
        el.addEventListener("click", function () { if (resolveNow && my === seq) resolveNow(b.id); });
        acts.appendChild(el); if (b.focus) first = el;
      });
      setTimeout(function () { try { (first || acts.lastChild).focus(); } catch (e) {} }, 0);
      return new Promise(function (res) { resolveNow = function (v) { resolveNow = null; res(v); }; });
    };
    self.close = function () {
      hidden.forEach(function (el) { el.removeAttribute("inert"); });
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (back && document.body.contains(back)) try { back.focus(); } catch (e) {}
    };
  }

  function registersHtml(pv) {
    if (!pv || !pv.registers || !pv.registers.length) return '<p class="epc-m">No other record has ' + esc(pv && pv.from) + " on it.</p>";
    return "<ul class=\"epc-n\" aria-label=\"Records that change\">" + pv.registers.map(function (r) {
      return "<li><span>" + esc(r.label) + (r.legal ? '<span class="epc-tag">legal register</span>' : "") + "</span><b>" + r.count + "</b></li>";
    }).join("") + "</ul>";
  }

  async function preview(person, from, to, rows) {
    return await E.apiFetch("/people/" + person.id + "/change-id-card", { method: "POST", body: JSON.stringify({ from: from, to: to, rows: rows || [] }), timeoutMs: 15000 });
  }
  async function adopt(h, w, card) { // a person known only from history: added to Customers first (as Customers' "adopt" does)
    var b = { name: h.name || w.name, id_card: card || "", source: "history" };
    ["phone", "alt_phone", "email", "address", "doctor_name"].forEach(function (k) { var v = str(h[k] || w[k]).trim(); if (v) b[k] = v; });
    var r = await E.apiFetch("/people", { method: "POST", body: JSON.stringify(b), timeoutMs: 10000 });
    return r && r.person;
  }

  // ---------- A ----------
  async function askAdd(d, p, w, ctx) {
    var rec = ctx.record || "record";
    var step = { title: "Add ID card " + w.id_card + " to " + p.name + "\u2019s details?",
      html: "<p>" + esc(p.name) + " has no ID card on their details yet. The " + esc(rec) + " is saved either way.</p>",
      buttons: [{ id: "back", label: "Go back" }, { id: "no", label: "No, just save the " + rec }, { id: "yes", label: "Yes, add it", primary: true, focus: true }] };
    for (;;) {
      var a = await d.open(step);
      if (a === "back") return { action: "back" };
      if (a === "no") return { action: "save", link: false };
      d.busy(true);
      try {
        var person = p.id ? (await E.apiFetch("/people", { method: "POST", body: JSON.stringify({ id: p.id, version: p.version, id_card: w.id_card }), timeoutMs: 10000 })).person : await adopt(p, w, w.id_card);
        if (!person) throw new Error("Not saved");
        return await offerStamp(d, person, w, ctx);
      } catch (e) {
        d.busy(false);
        var other = e && e.bodyJson && e.bodyJson.existing;
        step.error = other ? w.id_card + " already belongs to " + other.name + ". Go back and check the ID card." : (e && e.status === 409 ? p.name + " was changed on another screen. Go back and save again." : "Could not add it: " + str(e && e.message || e) + ". Nothing was saved.");
        if (other || (e && e.status === 409)) step.buttons = [{ id: "back", label: "Go back", primary: true, focus: true }];
      }
    }
  }
  // After A: the person's earlier records with their name and no card, to tick (administrators only; nothing ticked by default).
  async function offerStamp(d, person, w, ctx) {
    var done = { action: "save", person: person, link: true };
    var pv = null;
    try { pv = await preview(person, "", w.id_card); } catch (e) { pv = null; }
    if (!pv || !pv.can_apply || !pv.candidates || !pv.candidates.length) { if (E.toast) E.toast("ID card added to " + person.name + "\u2019s details", "success"); return done; }
    var list = pv.candidates.slice(0, 40);
    var step = { title: person.name + " has " + pv.candidates.length + (pv.candidates.length === 1 ? " earlier record" : " earlier records") + " without an ID card",
      html: "<p>Tick the ones that are " + esc(person.name) + " to add " + esc(w.id_card) + " to them too. Nothing is ticked unless you tick it.</p><ul aria-label=\"Earlier records without an ID card\">" + list.map(function (c, i) {
        return '<li><label><input type="checkbox" data-i="' + i + '"><span>' + esc([day(c.date), c.label, c.title].filter(Boolean).join(" \u00b7 ")) + (c.legal ? '<span class="epc-tag">legal register</span>' : "") + "</span></label></li>";
      }).join("") + "</ul>",
      buttons: [{ id: "skip", label: "Not now", focus: true }, { id: "stamp", label: "Add to the ticked records", primary: true }] };
    for (;;) {
      var a = await d.open(step);
      if (a !== "stamp") return done;
      var rows = Array.prototype.filter.call(d.box.querySelectorAll("input[data-i]"), function (x) { return x.checked; }).map(function (x) { var c = list[Number(x.getAttribute("data-i"))]; return { table: c.table, id: c.id }; });
      if (!rows.length) { step.error = "Tick at least one record, or press Not now."; continue; }
      d.busy(true);
      try {
        var pv2 = await preview(person, "", w.id_card, rows);
        var r = await E.apiFetch("/people/" + person.id + "/change-id-card", { method: "POST", body: JSON.stringify({ from: "", to: w.id_card, rows: rows, confirm: true, plan: pv2.plan }), timeoutMs: 20000 });
        if (E.toast) E.toast("ID card added to " + person.name + " and " + r.changed + (r.changed === 1 ? " earlier record" : " earlier records"), "success");
        done.change = r; return done;
      } catch (e) { d.busy(false); step.error = "Not added to the earlier records: " + str(e && e.message || e) + ". The card is on their details."; }
    }
  }

  // ---------- B ----------
  async function askWhose(d, ownerName, w, ctx) {
    var a = await d.open({ title: w.id_card + " belongs to " + ownerName + ". Is this " + ownerName + "?",
      html: "<p>This " + esc(ctx.record || "record") + " says " + esc(w.name) + ". Nothing is saved until you choose.</p>",
      buttons: [{ id: "use", label: "Yes, it is " + ownerName }, { id: "back", label: "No, go back and correct", primary: true, focus: true }] });
    if (a === "use") return { action: "fill", field: "name", value: ownerName };
    return { action: "back", field: "id_card" };
  }

  // ---------- C ----------
  async function askChange(d, p, w, ctx) {
    var rec = ctx.record || "record", from = P.normIdCard(p.id_card), to = w.id_card, pv = null, err = "";
    { try { pv = await preview(p, from, to); } catch (e) { if (e && e.bodyJson && e.bodyJson.code === "card_in_use") return await askWhose(d, e.bodyJson.owner.name || "someone else", w, ctx); err = "Could not count the records: " + str(e && e.message || e) + "."; } }
    var canApply = pv ? !!pv.can_apply : !!(E.state && E.state.user && E.state.user.role === "admin");
    var html = "<p>" + esc(p.name) + "\u2019s ID card is " + esc(from) + ". This " + esc(rec) + " says " + esc(to) + ".</p>" +
      (pv ? "<p>Changing it everywhere changes " + pv.total + (pv.total === 1 ? " record" : " records") + " and their details:</p>" + registersHtml(pv) : "") +
      (pv && pv.skipped_total ? '<p class="epc-m">' + pv.skipped_total + (pv.skipped_total === 1 ? " record" : " records") + " with " + esc(from) + " under another name " + (pv.skipped_total === 1 ? "is" : "are") + " not changed.</p>" : "") +
      (canApply ? '<p class="epc-m">You can undo the change afterwards.</p>' : '<p class="epc-m">Only an administrator can change it on every record.</p>');
    var buttons = ctx.details ? [{ id: "back", label: "Go back", focus: true }, { id: "only", label: "Only on their details" }]
      : [{ id: "back", label: "Go back" }, { id: "only", label: "Only this " + rec }, { id: "keep", label: "Keep " + from, focus: true }];
    if (canApply) buttons.push({ id: "change", label: "Change everywhere", primary: true });
    var step = { title: "Change " + p.name + "\u2019s ID card from " + from + " to " + to + " on their details and all their records?", html: html, buttons: buttons, error: err };
    for (;;) {
      var a = await d.open(step);
      if (a === "back") return { action: "back" };
      if (a === "keep") return { action: "fill", field: "id_card", value: from };
      if (a === "only") return { action: "save", link: false };
      d.busy(true);
      try {
        var person = p;
        if (!pv) pv = await preview(person, from, to);
        var r = await E.apiFetch("/people/" + person.id + "/change-id-card", { method: "POST", body: JSON.stringify({ from: from, to: to, confirm: true, plan: pv.plan }), timeoutMs: 30000 });
        var after = await d.open({ title: "ID card changed to " + to,
          html: "<p>Changed on " + esc(person.name) + "\u2019s details and " + r.changed + (r.changed === 1 ? " record" : " records") + ". The " + esc(rec) + " is saved next.</p>",
          buttons: [{ id: "undo", label: "Undo the change" }, { id: "go", label: "Save the " + rec, primary: true, focus: true }] });
        if (after === "undo") {
          d.busy(true);
          try {
            await E.apiFetch("/people/id-card-changes/" + encodeURIComponent(r.change_id) + "/undo", { method: "POST", body: "{}", timeoutMs: 30000 });
            if (E.toast) E.toast("Put back: " + person.name + "\u2019s ID card is " + from + " again", "success");
          } catch (e2) { if (E.toast) E.toast("Could not undo: " + str(e2 && e2.message || e2), "error"); }
          return { action: "back" };
        }
        return { action: "save", person: r.person, change: r, link: true };
      } catch (e) {
        d.busy(false);
        var j = e && e.bodyJson;
        if (j && j.code === "plan_changed") { pv = j; step.html = html.replace(/<ul[\s\S]*<\/ul>/, registersHtml(j)); step.error = "The records changed while you were deciding. Check the new numbers."; }
        else if (j && j.code === "card_in_use") return await askWhose(d, (j.owner && j.owner.name) || "someone else", w, ctx);
        else step.error = "Not changed: " + str(e && e.message || e) + ".";
      }
    }
  }

  // ---------- who is this, then which question ----------
  async function confirmPerson(details, ctx) {
    ctx = ctx || {};
    var go = { action: "save", link: true };
    if (!P.confirmCards) return go;
    var w = { name: P.normName(details && details.name), id_card: P.normIdCard(details && details.id_card), phone: str(details && details.phone), email: str(details && details.email) };
    if (!w.id_card || w.id_card.length < 3) return go;
    var what = null;
    try {
      var byCard = await search(w.id_card.replace(/^0+(?=\d)/, ""));
      var owner = byCard.people.filter(function (p) { return P.sameIdCard(p.id_card, w.id_card); })[0];
      var ownerH = owner ? null : byCard.history.filter(function (h) { return P.sameIdCard(h.id_card, w.id_card); })[0];
      var ownerName = owner ? owner.name : ownerH ? ownerH.name : "";
      if (ownerName && w.name && !namesCompatible(ownerName, w.name)) what = { q: "B", name: ownerName };
      else if (owner) return Object.assign(go, { person: owner });
      else if (ownerH) return go;
      else if (w.name.length >= 2) {
        var byName = await search(longestWord(w.name));
        var picked = ctx.picked || (E.personPick && E.personPick.picked && E.personPick.picked(ctx.key)) || null;
        if (picked && !namesCompatible(picked.name, w.name)) picked = null;
        var cands = byName.people.filter(function (p) { return namesCompatible(p.name, w.name) && !contactDiffers(p, w); });
        if (cands.length > 1 && picked) { var pc = cands.filter(function (p) { return picked.pid ? p.id === picked.pid : picked.id_card ? P.sameIdCard(p.id_card, picked.id_card) : !p.id_card; }); if (pc.length === 1) cands = pc; }
        if (cands.length === 1) what = { q: cands[0].id_card ? "C" : "A", p: cands[0] };
        else if (!cands.length) {
          var hs = byName.history.filter(function (h) { return namesCompatible(h.name, w.name) && !contactDiffers(h, w); });
          if (hs.length > 1 && picked) { var ph = hs.filter(function (h) { return picked.id_card ? P.sameIdCard(h.id_card, picked.id_card) : !h.id_card; }); if (ph.length === 1) hs = ph; }
          // Known only from earlier records: a card-less one is asked A (they are added to Customers on Yes). One with
          // another card is not asked C: history groups are by card, so that may simply be a namesake; only a person in
          // Customers is a confirmed identity whose records can be changed together.
          if (hs.length === 1 && !hs[0].id_card) what = { q: "A", p: hs[0], hist: true };
        }
      }
    } catch (e) { return go; } // the people list cannot be read: save as before
    if (!what) return go;
    var d = new Dialog(), out;
    try {
      if (what.q === "B") out = await askWhose(d, what.name, w, ctx);
      else if (what.q === "A") out = await askAdd(d, what.p, w, ctx);
      else out = await askChange(d, what.p, w, ctx);
    } catch (e) { out = { action: "back" }; }
    d.close();
    out.asked = what.q;
    return out;
  }

  // Customers: the person's own card edited. A different card: the same question as C (change on all their records
  // too, or on their details only). No card before: after the save, their card-less records are offered to tick.
  async function confirmCardEdit(person, typed) {
    var to = P.normIdCard(typed), from = P.normIdCard(person && person.id_card);
    if (!P.confirmCards || !person || !person.id || !to || to === from) return { action: "save" };
    if (!from) return { action: "save", stampAfter: true };
    var d = new Dialog(), out;
    try { out = await askChange(d, person, { name: person.name, id_card: to }, { record: "change", details: true }); } catch (e) { out = { action: "back" }; }
    d.close();
    return out;
  }
  async function stampAfterEdit(person) {
    if (!person || !person.id_card) return null;
    var d = new Dialog();
    try { return await offerStamp(d, person, { name: person.name, id_card: person.id_card }, {}); } catch (e) { return null; } finally { d.close(); }
  }
  P.confirmCardEdit = confirmCardEdit;
  P.stampAfterEdit = stampAfterEdit;
  P.nameWords = nameWords;
  P.namesCompatible = namesCompatible;
  P.confirmPerson = confirmPerson;
  P.confirmCards = true; // off switch for the three questions
})();
