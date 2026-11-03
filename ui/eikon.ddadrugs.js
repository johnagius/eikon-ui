/* Controlled-drug medicine suggestions for the new-layout DDA registers (supplied, POYC, received).
   Typing a generic name OR a brand finds the medicine: "ativ" offers lorazepam, "xan" alprazolam, "oxycontin" oxycodone.
   What is offered, best first:
     1. what this pharmacy has written before in this register (this month from the screen, the two months before read
        once from the same /entries route the screen uses), exactly as they wrote it;
     2. the fixed list the classic register already offers (same words as classic);
     3. the generic name alone ("Lorazepam "), so the strength and form can be typed after it.
   Choosing one only puts that text in the box; anything can still be typed by hand. Nothing here is sent anywhere
   and no saved field changes. The brand list is static and needs a pharmacist's check (see DRUGS). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // generic name, other spellings, brands. Only well-established brand/generic pairs; a pharmacist should review.
  var DRUGS = [
    // benzodiazepines
    { g: "Alprazolam", b: ["Xanax"] },
    { g: "Bromazepam", b: ["Lexotan"] },
    { g: "Chlordiazepoxide", b: ["Librium"] },
    { g: "Clobazam", b: ["Frisium"] },
    { g: "Clonazepam", b: ["Rivotril"] },
    { g: "Clorazepate", also: ["Dipotassium clorazepate"], b: ["Tranxene"] },
    { g: "Diazepam", b: ["Valium", "Stesolid"] },
    { g: "Flunitrazepam", b: ["Rohypnol"] },
    { g: "Flurazepam", b: ["Dalmane"] },
    { g: "Lorazepam", b: ["Ativan", "Tavor"] },
    { g: "Lormetazepam", b: ["Noctamid"] },
    { g: "Mexazolam", b: [] },
    { g: "Midazolam", b: ["Hypnovel", "Dormicum", "Buccolam"] },
    { g: "Nitrazepam", b: ["Mogadon"] },
    { g: "Oxazepam", b: [] },
    { g: "Prazepam", b: [] },
    { g: "Temazepam", b: ["Normison"] },
    { g: "Triazolam", b: ["Halcion"] },
    // z-drugs
    { g: "Zolpidem", b: ["Stilnox", "Ambien"] },
    { g: "Zopiclone", b: ["Imovane", "Zimovane"] },
    { g: "Zaleplon", b: ["Sonata"] },
    // opioids
    { g: "Morphine", b: ["MST Continus", "Oramorph", "Sevredol", "Zomorph"] },
    { g: "Oxycodone", b: ["OxyContin", "OxyNorm"] },
    { g: "Oxycodone/Naloxone", b: ["Targin"] },
    { g: "Fentanyl", b: ["Durogesic", "Abstral", "Effentora", "Instanyl", "PecFent"] },
    { g: "Hydromorphone", b: ["Palladone", "Jurnista"] },
    { g: "Tapentadol", b: ["Palexia"] },
    { g: "Tramadol", b: ["Tramal", "Zydol"] },
    { g: "Tramadol/Paracetamol", b: ["Zaldiar"] },
    { g: "Tramadol/Dexketoprofen", b: ["Skudexa"] },
    { g: "Methadone", b: ["Physeptone", "Methadose"] },
    { g: "Buprenorphine", b: ["Subutex", "Temgesic", "Transtec", "BuTrans"] },
    { g: "Buprenorphine/Naloxone", b: ["Suboxone"] },
    { g: "Pethidine", also: ["Meperidine"], b: [] },
    { g: "Pentazocine", b: ["Fortral"] },
    { g: "Codeine", b: [] },
    { g: "Dihydrocodeine", b: ["DF118"] },
    { g: "Alfentanil", b: ["Rapifen"] },
    { g: "Remifentanil", b: ["Ultiva"] },
    { g: "Sufentanil", b: ["Sufenta"] },
    { g: "Ketamine", b: ["Ketalar"] },
    { g: "Esketamine", b: ["Spravato"] },
    // stimulants and others
    { g: "Methylphenidate", b: ["Ritalin", "Concerta", "Medikinet", "Equasym"] },
    { g: "Dexamfetamine", also: ["Dexamphetamine", "Dextroamphetamine"], b: ["Dexedrine"] },
    { g: "Lisdexamfetamine", also: ["Lisdexamphetamine"], b: ["Elvanse", "Vyvanse"] },
    { g: "Modafinil", b: ["Provigil"] },
    { g: "Phenobarbital", also: ["Phenobarbitone"], b: ["Luminal", "Gardenal"] },
    { g: "Chloral hydrate", b: [] },
    { g: "Sodium oxybate", b: ["Xyrem"] },
    { g: "Tianeptine", b: ["Stablon"] },
    { g: "Pregabalin", b: ["Lyrica"] },
    { g: "Gabapentin", b: ["Neurontin"] },
    { g: "Cannabis", b: ["Bedrocan"] },
    { g: "Nabiximols", b: ["Sativex"] },
    { g: "Nabilone", b: ["Cesamet"] }
  ];

  // The classic registers' own fixed lists (modules.ddasales.js and modules.ddapoyc.js), word for word.
  var SALES = ["Alprazolam 0.25mg", "Alprazolam 0.5mg", "Bromazepam 3mg", "Buprenorphine/Naloxone 8mg/2mg", "Cannabis 22/1 x10g", "Cannabis 27/1 x10g", "Clonazepam 0.5mg", "Clonazepam 2mg", "Dexamfetamine 5mg", "Diazepam 5mg", "Lorazepam 1mg", "Mexazolam 1mg", "Methylphenidate 10mg", "Methylphenidate 18mg SR", "Methylphenidate 36mg SR", "Morphine 10mg injection", "Morphine 10mg/ml", "Morphine sulphate 10mg tablets", "Nitrazepam 5mg", "Tianeptine 12.5mg", "Tramadol 50mg", "Tramadol/Dexketoprofen 75/25mg", "Zolpidem 10mg"];
  var POYC = ["Alprazolam 0.25mg tablets", "Alprazolam 0.5mg tablets", "Bromazepam 1.5mg tablets", "Bromazepam 3mg tablets", "Bromazepam 6mg tablets", "Chloral Hydrate 500mg/5ml 200ml oral solution", "Chlordiazepoxide 5mg capsules", "Clobazam 10mg tablets", "Clonazepam 0.5mg scored tablets", "Clonazepam 0.5mg/5ml oral solution", "Clonazepam 2.5mg/5ml oral solution", "Clonazepam 2mg cross scored tablets", "Dexamfetamine Sulphate 5mg tablets", "Diazepam 10mg/2ml injections", "Diazepam 2mg tablets", "Diazepam 5mg tablets", "Diazepam rectal tubes 10mg/2.5ml", "Diazepam rectal tubes 5mg/2.5ml", "Diazepam syrup 2mg/5ml", "Fentanyl 25mcg/hour transdermal patches", "Fentanyl 50mcg/hour transdermal patches", "Lorazepam 1mg tablets", "Lorazepam 2mg tablets", "Lormetazepam 1mg tablets", "Methylphenidate 10mg tablets", "Methylphenidate 18mg PR tablets", "Methylphenidate 27mg PR tablets", "Methylphenidate 36mg PR tablets", "Midazolam 10mg 2ml IV injections", "Midazolam 10mg 5ml IV injections", "Morphine 10mg/ml 1ml injections IV/SC", "Morphine Sulphate 10mg/5ml solution", "Morphine Sulphate 10mg SR tablets", "Morphine Sulphate 30mg SR tablets", "Morphine Sulphate 60mg SR tablets", "Morphine Sulphate 100mg SR tablets", "Morphine Sulphate 15mg 1ml injections IV/SC", "Morphine Sulphate 20mg/ml injections", "Morphine Sulphate 30mg/ml 1ml injections", "Nitrazepam 2.5mg/5ml solution", "Nitrazepam 5mg tablets", "Pethidine Hydrochloride 50mg tablets", "Pethidine Hydrochloride 50mg/ml injections", "Pethidine Hydrochloride 100mg/2ml injections", "Phenobarbital 30mg tablets", "Phenobarbitone Sodium 25g - 50g powder crystalline", "Temazepam 10mg tablets", "Tramadol 50mg capsules"];
  // Received: a pharmacy buys in what it supplies under both schemes, so both lists are offered (same words as classic).
  var FIXED = { "/dda-sales": SALES, "/dda-poyc": POYC, "/dda-purchases": SALES.concat(POYC) };
  var MAX = 8;

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function norm(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/[^a-z0-9.]+/g, " ").trim();
  }
  function words(s) { var n = norm(s); return n ? n.split(" ") : []; }
  function hasRun(w, run) { // the words of run appear one after another in w
    for (var i = 0; i + run.length <= w.length; i++) { var ok = true; for (var j = 0; j < run.length; j++) if (w[i + j] !== run[j]) { ok = false; break; } if (ok) return true; }
    return false;
  }
  DRUGS.forEach(function (d) {
    d.gw = words(d.g);
    d.names = [d.g].concat(d.also || []).map(words);
    d.bw = d.b.map(words);
  });

  // Which drugs a written medicine is (by generic, other spelling or brand). A combination wins over its parts.
  var drugCache = {};
  function drugsOf(text) {
    var k = norm(text); if (drugCache[k]) return drugCache[k];
    var w = words(text), hit = DRUGS.filter(function (d) {
      var all = function (n) { return n.every(function (x) { return w.indexOf(x) >= 0; }); };
      return d.names.some(all) || d.bw.some(function (b) { return hasRun(w, b); });
    });
    hit = hit.filter(function (d) { return !hit.some(function (o) { return o !== d && o.gw.length > d.gw.length && d.gw.every(function (x) { return o.gw.indexOf(x) >= 0; }); }); });
    return (drugCache[k] = hit);
  }
  // every typed word must start a word of the text or of the drug's names and brands
  function score(qw, textW, aliasW) {
    var inText = qw.every(function (q) { return textW.some(function (x) { return x.indexOf(q) === 0; }); });
    if (!inText && !qw.every(function (q) { return textW.concat(aliasW).some(function (x) { return x.indexOf(q) === 0; }); })) return -1;
    return (inText ? 0 : 2) + (textW[0] && textW[0].indexOf(qw[0]) === 0 ? 0 : 1);
  }
  function aliasWords(ds) { var out = []; ds.forEach(function (d) { d.names.forEach(function (n) { out = out.concat(n); }); d.bw.forEach(function (b) { out = out.concat(b); }); }); return out; }
  function brandNote(ds, qw) { // brands to show, the one typed first
    var b = []; ds.forEach(function (d) { b = b.concat(d.b); });
    b.sort(function (x, y) { var mx = qw.some(function (q) { return words(x).some(function (w) { return w.indexOf(q) === 0; }); }), my = qw.some(function (q) { return words(y).some(function (w) { return w.indexOf(q) === 0; }); }); return (my ? 1 : 0) - (mx ? 1 : 0); });
    return b.slice(0, 3).join(", ");
  }

  function suggest(q, own, fixed) {
    var qw = words(q), seen = {}, rows = [];
    var push = function (text, src, n) {
      var k = norm(text); if (!k || seen[k]) return; seen[k] = 1;
      var ds = drugsOf(text), tw = words(text), s = qw.length ? score(qw, tw, aliasWords(ds)) : 0;
      if (s < 0) return;
      rows.push({ text: text, fill: text, src: src, n: n || 0, s: s, ds: ds });
    };
    var counts = {}, firstSpelling = {};
    own.forEach(function (t) { t = String(t || "").trim(); var k = norm(t); if (!k) return; counts[k] = (counts[k] || 0) + 1; if (!firstSpelling[k]) firstSpelling[k] = t; });
    Object.keys(counts).forEach(function (k) { push(firstSpelling[k], 0, counts[k]); });
    if (qw.length) {
      fixed.forEach(function (t) { push(t, 1); });
      DRUGS.forEach(function (d) {
        var k = norm(d.g); if (seen[k]) return;
        var s = score(qw, d.gw, aliasWords([d]).concat(d.names.reduce(function (a, n) { return a.concat(n); }, [])));
        if (s < 0) return; seen[k] = 1;
        rows.push({ text: d.g, fill: d.g + " ", src: 2, n: 0, s: s, ds: [d], generic: true });
      });
    }
    rows.sort(function (a, b) { return a.s - b.s || a.src - b.src || b.n - a.n || a.text.localeCompare(b.text); });
    var out = rows.slice(0, MAX), g = rows.filter(function (r) { return r.generic; })[0];
    if (g && out.indexOf(g) < 0) out[out.length - 1] = g; // the plain name is always offered when it matches
    out.forEach(function (r) { r.brands = brandNote(r.ds, qw); });
    return out;
  }

  // the two months before this one, read once per register from the route the screen already uses
  var PAST = {};
  function ym(back) { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - back); return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); }
  function past(path, field, back) {
    var key = path + "|" + back.join(), c = PAST[key];
    if (c && (c.list || Date.now() - c.at < 60000) && Date.now() - c.at < 10 * 60000) return c;
    c = PAST[key] = { at: Date.now(), list: null, wait: [] };
    Promise.all(back.map(function (b) { return E.apiFetch(path + "/entries?month=" + ym(b), { method: "GET" }).catch(function () { return null; }); })).then(function (rs) {
      var list = []; rs.forEach(function (r) { ((r && r.ok && r.entries) || []).forEach(function (e) { if (e && e[field]) list.push(e[field]); }); });
      c.list = list; c.wait.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
    });
    return c;
  }

  function css() {
    if (document.getElementById("eikon-ddam-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-ddam-css";
    st.textContent =
      ".ddam-host{position:relative}" +
      ".ddam-lb{position:absolute;left:8px;right:8px;top:100%;z-index:60;margin-top:2px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.2);max-height:min(352px,55vh);overflow:auto;padding:4px 0;overscroll-behavior:contain}" +
      ".ddam-lb[hidden]{display:none}" +
      ".ddam-op{display:flex;flex-direction:column;justify-content:center;min-height:44px;padding:6px 12px;cursor:pointer;font-size:15px;line-height:1.3;-webkit-tap-highlight-color:transparent}" +
      ".ddam-op .ddam-b{font-size:12.5px;color:var(--muted);margin-top:1px}" +
      ".ddam-op[aria-selected=true]{background:var(--bg);box-shadow:inset 3px 0 0 var(--accent)}" +
      "@media (hover:hover){.ddam-op:hover{background:var(--bg)}}" + // a finger leaves no lasting highlight on a phone
      ".ddam-note{font-size:12px;color:var(--muted);padding:6px 12px 4px}";
    document.head.appendChild(st);
  }

  var seq = 0;
  // Attach to one medicine box. opts: { path: "/dda-sales", field: "medicine_name_dose", known: () => [text], back: [1, 2], fixed: [text] }
  // back: [] reads no past months (for a register without an /entries?month= route).
  E.ddaMedSuggest = function (input, opts) {
    if (!input || input.disabled || input._ddaMed) return;
    input._ddaMed = 1; css();
    var host = input.parentNode, id = "ddam-" + (++seq), lb = document.createElement("div"), items = [], active = -1, open = false;
    var fixed = opts.fixed || FIXED[opts.path] || SALES, back = opts.back || [1, 2]; // opts.fixed: a register with its own list (stock takes: none, the dosage has its own box)
    input.removeAttribute("list"); // the browser's own list would open on top of this one
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false"); input.setAttribute("aria-controls", id);
    if (!input.getAttribute("aria-label")) input.setAttribute("aria-label", "Medicine, strength and form");
    lb.id = id; lb.className = "ddam-lb"; lb.setAttribute("role", "listbox"); lb.setAttribute("aria-label", "Suggested medicines"); lb.hidden = true;
    host.classList.add("ddam-host"); host.appendChild(lb);

    function close() { open = false; active = -1; lb.hidden = true; lb.innerHTML = ""; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
    function mark() {
      [].forEach.call(lb.querySelectorAll("[role=option]"), function (o, i) { o.setAttribute("aria-selected", i === active ? "true" : "false"); if (i === active && o.scrollIntoView) o.scrollIntoView({ block: "nearest" }); });
      if (active >= 0) input.setAttribute("aria-activedescendant", id + "-" + active); else input.removeAttribute("aria-activedescendant");
    }
    function render(force) {
      if (!document.body.contains(input) || input.disabled) return;
      var q = input.value, p = past(opts.path, opts.field, back);
      if (!p.list && p.wait.indexOf(rerender) < 0) p.wait.push(rerender);
      if (!norm(q) && !force) return close();
      var own = (opts.known ? opts.known() || [] : []).concat(p.list || []);
      items = suggest(q, own, fixed);
      if (!items.length) return close();
      lb.innerHTML = (!norm(q) ? '<div class="ddam-note" aria-hidden="true">Written here before</div>' : "") + items.map(function (r, i) {
        var bs = r.brands ? r.brands.split(", ") : [];
        var sub = r.generic ? bs.slice(1).concat(["add the strength"]).join(" · ") : [r.brands, r.src === 0 ? "written here before" : ""].filter(Boolean).join(" · ");
        return '<div role="option" class="ddam-op" id="' + id + "-" + i + '" data-n="' + i + '" aria-selected="false"><span>' + esc(r.text) + (r.generic && bs.length ? " — " + esc(bs[0]) : "") + "</span>" + (sub ? '<span class="ddam-b">' + esc(sub) + "</span>" : "") + "</div>";
      }).join("");
      if (active >= items.length) active = -1;
      open = true; lb.hidden = false; input.setAttribute("aria-expanded", "true"); mark();
    }
    function rerender() { if (open && document.activeElement === input) render(); }
    function choose(i) {
      var r = items[i]; if (!r) return;
      input.value = r.fill; active = -1;
      try { input.setSelectionRange(r.fill.length, r.fill.length); } catch (e) {}
      if (r.generic) render(); else close(); // after the plain name, offer the strengths written before
    }
    input.addEventListener("input", function () { active = -1; render(); });
    input.addEventListener("click", function () { if (!open) render(true); });
    input.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== input) close(); }, 0); });
    input.addEventListener("keydown", function (ev) {
      var k = ev.key;
      if (k === "ArrowDown" || k === "ArrowUp") {
        ev.preventDefault();
        if (!open) { render(true); if (!open) return; }
        active = k === "ArrowDown" ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1); mark();
      } else if (k === "Enter" && open && active >= 0) { ev.preventDefault(); choose(active); }
      else if (k === "Escape" && open) { ev.preventDefault(); ev.stopPropagation(); close(); }
      else if (k === "Tab") close();
    });
    lb.addEventListener("pointerdown", function (ev) { ev.preventDefault(); }); // keep the keyboard up and the box focused
    lb.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    lb.addEventListener("click", function (ev) { var o = ev.target.closest && ev.target.closest("[role=option]"); if (o) { choose(Number(o.getAttribute("data-n"))); input.focus(); } });
  };
  E.ddaDrugs = { list: DRUGS, suggest: function (q, own, path) { return suggest(q, own || [], FIXED[path] || SALES); } }; // for tests
})();
