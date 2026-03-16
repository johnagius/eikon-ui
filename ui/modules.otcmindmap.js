/* ui/modules.otcmindmap.js
   Eikon – OTC Mindmap (Pharmacy / Clinical)

   Interactive canvas-based mindmap for exploring OTC medication relationships.
   Search a condition (e.g. "cold") and visualise medications, symptoms,
   alternatives, and cautions as an expandable graph.

   Features:
     - Canvas-rendered force-directed mindmap (60 fps)
     - Grouped link-filter panel (symptom, treats, similar, caution, alternative)
     - Select-all / unselect-all per group and globally
     - Collapsible link-type groups
     - Pan & zoom with mouse/touch
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  /* ── helpers ─────────────────────────────────────────────────────────── */
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function uid() { return "om_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ── OTC knowledge base ─────────────────────────────────────────────── */
  /* Each entry: { id, label, type, links:[{target,rel}] }
     type = condition | symptom | medication | category
     rel  = symptom | treats | similar | caution | alternative              */

  var KB = buildKB();

  function buildKB() {
    var nodes = [];
    var id = 0;
    function n(label, type) { var o = { id: id++, label: label, type: type, links: [] }; nodes.push(o); return o; }
    function link(a, b, rel) { a.links.push({ target: b.id, rel: rel }); b.links.push({ target: a.id, rel: rel }); }

    /* ── Conditions ── */
    var cold = n("Common Cold", "condition");
    var flu = n("Flu", "condition");
    var cough = n("Cough", "condition");
    var sorethroat = n("Sore Throat", "condition");
    var headache = n("Headache", "condition");
    var migraine = n("Migraine", "condition");
    var allergy = n("Hay Fever / Allergy", "condition");
    var sinusitis = n("Sinusitis", "condition");
    var indigestion = n("Indigestion", "condition");
    var heartburn = n("Heartburn / GERD", "condition");
    var diarrhoea = n("Diarrhoea", "condition");
    var constipation = n("Constipation", "condition");
    var nausea = n("Nausea / Vomiting", "condition");
    var pain = n("Pain / Inflammation", "condition");
    var musclepain = n("Muscle Pain", "condition");
    var backpain = n("Back Pain", "condition");
    var toothache = n("Toothache", "condition");
    var periodpain = n("Period Pain", "condition");
    var eczema = n("Eczema / Dermatitis", "condition");
    var acne = n("Acne", "condition");
    var athletes = n("Athlete's Foot", "condition");
    var thrush = n("Thrush (Oral/Vaginal)", "condition");
    var conjunctivitis = n("Conjunctivitis", "condition");
    var hayfever = n("Allergic Rhinitis", "condition");
    var insomnia = n("Insomnia", "condition");
    var warts = n("Warts / Verrucas", "condition");
    var coldsore = n("Cold Sore", "condition");
    var mouthulcer = n("Mouth Ulcer", "condition");
    var earache = n("Earache", "condition");
    var cystitis = n("Cystitis", "condition");
    var haemorrhoids = n("Haemorrhoids", "condition");
    var travelSick = n("Travel Sickness", "condition");
    var dryskin = n("Dry Skin", "condition");
    var sunburn = n("Sunburn", "condition");
    var bites = n("Insect Bites / Stings", "condition");
    var nappyrash = n("Nappy Rash", "condition");
    var ibs = n("IBS", "condition");

    /* ── Symptoms ── */
    var sRunnyNose = n("Runny Nose", "symptom");
    var sSneeze = n("Sneezing", "symptom");
    var sCongestion = n("Nasal Congestion", "symptom");
    var sFever = n("Fever", "symptom");
    var sBodyAche = n("Body Aches", "symptom");
    var sFatigue = n("Fatigue", "symptom");
    var sWateryEyes = n("Watery Eyes", "symptom");
    var sItchyEyes = n("Itchy Eyes", "symptom");
    var sItchySkin = n("Itchy Skin", "symptom");
    var sDryCough = n("Dry Cough", "symptom");
    var sChestyCough = n("Chesty Cough", "symptom");
    var sSwallowPain = n("Painful Swallowing", "symptom");
    var sHeadPain = n("Head Pain", "symptom");
    var sBloating = n("Bloating", "symptom");
    var sNausea = n("Nausea", "symptom");
    var sRash = n("Rash", "symptom");
    var sRedness = n("Redness", "symptom");
    var sBurning = n("Burning Sensation", "symptom");
    var sDizziness = n("Dizziness", "symptom");

    /* ── Medications ── */
    var paracetamol = n("Paracetamol", "medication");
    var ibuprofen = n("Ibuprofen", "medication");
    var aspirin = n("Aspirin", "medication");
    var codeine = n("Codeine (low-dose)", "medication");
    var pseudoephedrine = n("Pseudoephedrine", "medication");
    var phenylephrine = n("Phenylephrine", "medication");
    var xylometazoline = n("Xylometazoline Spray", "medication");
    var cetirizine = n("Cetirizine", "medication");
    var loratadine = n("Loratadine", "medication");
    var chlorphenamine = n("Chlorphenamine", "medication");
    var fexofenadine = n("Fexofenadine", "medication");
    var dextromethorphan = n("Dextromethorphan", "medication");
    var guaifenesin = n("Guaifenesin", "medication");
    var pholcodine = n("Pholcodine", "medication");
    var benzydamine = n("Benzydamine Spray", "medication");
    var strepsils = n("Strepsils / Lozenges", "medication");
    var difflam = n("Difflam Rinse", "medication");
    var omeprazole = n("Omeprazole", "medication");
    var ranitidine = n("Ranitidine", "medication");
    var gaviscon = n("Gaviscon / Alginate", "medication");
    var antacid = n("Antacid Tablets", "medication");
    var loperamide = n("Loperamide", "medication");
    var ors = n("ORS (Oral Rehydration)", "medication");
    var lactulose = n("Lactulose", "medication");
    var senna = n("Senna", "medication");
    var macrogol = n("Macrogol (Movicol)", "medication");
    var bisacodyl = n("Bisacodyl", "medication");
    var domperidone = n("Domperidone", "medication");
    var diclofenac = n("Diclofenac Gel", "medication");
    var voltarol = n("Voltarol", "medication");
    var deepHeat = n("Deep Heat / Freeze", "medication");
    var hydrocortisone = n("Hydrocortisone 1%", "medication");
    var emollient = n("Emollient (E45/Cetraben)", "medication");
    var benzoylPeroxide = n("Benzoyl Peroxide", "medication");
    var salicylicAcid = n("Salicylic Acid", "medication");
    var clotrimazole = n("Clotrimazole", "medication");
    var terbinafine = n("Terbinafine", "medication");
    var miconazole = n("Miconazole", "medication");
    var fluconazole = n("Fluconazole", "medication");
    var chloramphenicol = n("Chloramphenicol Eye", "medication");
    var sodCromoglicate = n("Sod. Cromoglicate Eye", "medication");
    var aciclovir = n("Aciclovir Cream", "medication");
    var bonjela = n("Bonjela / Iglu", "medication");
    var simethicone = n("Simethicone", "medication");
    var mebeverine = n("Mebeverine", "medication");
    var buscopan = n("Buscopan (Hyoscine)", "medication");
    var diphenhydramine = n("Diphenhydramine", "medication");
    var melatonin = n("Melatonin (OTC)", "medication");
    var hypromelose = n("Hypromellose Eye", "medication");
    var olive_ear = n("Olive Oil Ear Drops", "medication");
    var canesten = n("Canesten HC", "medication");
    var anusol = n("Anusol / Germoloids", "medication");
    var hyoscine = n("Hyoscine (Kwells)", "medication");
    var cinnarizine = n("Cinnarizine (Stugeron)", "medication");
    var calamine = n("Calamine Lotion", "medication");
    var sunscreen = n("Sunscreen SPF50+", "medication");
    var sudocrem = n("Sudocrem", "medication");
    var anthisan = n("Anthisan Cream", "medication");
    var salineNasal = n("Saline Nasal Spray", "medication");
    var honeyLemon = n("Honey & Lemon (OTC)", "medication");
    var sumatriptan = n("Sumatriptan (OTC)", "medication");
    var naproxen = n("Naproxen", "medication");
    var cranberry = n("Cranberry Sachets", "medication");
    var potCitrate = n("Pot. Citrate Sachets", "medication");
    var glycerin = n("Glycerin Suppositories", "medication");
    var metanium = n("Metanium", "medication");

    /* ── Symptom links ── */
    link(cold, sRunnyNose, "symptom"); link(cold, sSneeze, "symptom"); link(cold, sCongestion, "symptom"); link(cold, sFever, "symptom"); link(cold, sBodyAche, "symptom"); link(cold, sFatigue, "symptom"); link(cold, sDryCough, "symptom"); link(cold, sSwallowPain, "symptom");
    link(flu, sFever, "symptom"); link(flu, sBodyAche, "symptom"); link(flu, sFatigue, "symptom"); link(flu, sCongestion, "symptom"); link(flu, sDryCough, "symptom"); link(flu, sHeadPain, "symptom");
    link(cough, sDryCough, "symptom"); link(cough, sChestyCough, "symptom");
    link(sorethroat, sSwallowPain, "symptom"); link(sorethroat, sRedness, "symptom");
    link(headache, sHeadPain, "symptom"); link(migraine, sHeadPain, "symptom"); link(migraine, sNausea, "symptom"); link(migraine, sDizziness, "symptom");
    link(allergy, sWateryEyes, "symptom"); link(allergy, sItchyEyes, "symptom"); link(allergy, sSneeze, "symptom"); link(allergy, sRunnyNose, "symptom"); link(allergy, sCongestion, "symptom");
    link(sinusitis, sCongestion, "symptom"); link(sinusitis, sHeadPain, "symptom"); link(sinusitis, sFever, "symptom");
    link(indigestion, sBloating, "symptom"); link(indigestion, sNausea, "symptom"); link(indigestion, sBurning, "symptom");
    link(heartburn, sBurning, "symptom"); link(heartburn, sNausea, "symptom");
    link(nausea, sNausea, "symptom"); link(nausea, sDizziness, "symptom");
    link(eczema, sItchySkin, "symptom"); link(eczema, sRash, "symptom"); link(eczema, sRedness, "symptom");
    link(conjunctivitis, sRedness, "symptom"); link(conjunctivitis, sWateryEyes, "symptom"); link(conjunctivitis, sItchyEyes, "symptom");
    link(pain, sBodyAche, "symptom"); link(musclepain, sBodyAche, "symptom"); link(backpain, sBodyAche, "symptom");
    link(travelSick, sNausea, "symptom"); link(travelSick, sDizziness, "symptom");
    link(sunburn, sRedness, "symptom"); link(sunburn, sBurning, "symptom");
    link(bites, sItchySkin, "symptom"); link(bites, sRedness, "symptom");
    link(dryskin, sItchySkin, "symptom");
    link(ibs, sBloating, "symptom"); link(ibs, sNausea, "symptom");

    /* ── Treats links ── */
    link(paracetamol, cold, "treats"); link(paracetamol, flu, "treats"); link(paracetamol, headache, "treats"); link(paracetamol, sorethroat, "treats"); link(paracetamol, toothache, "treats"); link(paracetamol, periodpain, "treats"); link(paracetamol, earache, "treats"); link(paracetamol, pain, "treats"); link(paracetamol, backpain, "treats"); link(paracetamol, migraine, "treats");
    link(ibuprofen, cold, "treats"); link(ibuprofen, headache, "treats"); link(ibuprofen, pain, "treats"); link(ibuprofen, musclepain, "treats"); link(ibuprofen, backpain, "treats"); link(ibuprofen, toothache, "treats"); link(ibuprofen, periodpain, "treats"); link(ibuprofen, sorethroat, "treats"); link(ibuprofen, sinusitis, "treats"); link(ibuprofen, migraine, "treats"); link(ibuprofen, earache, "treats");
    link(aspirin, headache, "treats"); link(aspirin, pain, "treats"); link(aspirin, cold, "treats");
    link(codeine, pain, "treats"); link(codeine, cough, "treats");
    link(pseudoephedrine, cold, "treats"); link(pseudoephedrine, sinusitis, "treats"); link(pseudoephedrine, hayfever, "treats");
    link(phenylephrine, cold, "treats"); link(phenylephrine, sinusitis, "treats");
    link(xylometazoline, cold, "treats"); link(xylometazoline, sinusitis, "treats"); link(xylometazoline, hayfever, "treats");
    link(salineNasal, cold, "treats"); link(salineNasal, sinusitis, "treats"); link(salineNasal, hayfever, "treats");
    link(cetirizine, allergy, "treats"); link(cetirizine, hayfever, "treats"); link(cetirizine, bites, "treats"); link(cetirizine, eczema, "treats");
    link(loratadine, allergy, "treats"); link(loratadine, hayfever, "treats"); link(loratadine, bites, "treats");
    link(chlorphenamine, allergy, "treats"); link(chlorphenamine, bites, "treats"); link(chlorphenamine, hayfever, "treats");
    link(fexofenadine, allergy, "treats"); link(fexofenadine, hayfever, "treats");
    link(dextromethorphan, cough, "treats"); link(guaifenesin, cough, "treats"); link(pholcodine, cough, "treats"); link(honeyLemon, cough, "treats"); link(honeyLemon, sorethroat, "treats");
    link(benzydamine, sorethroat, "treats"); link(strepsils, sorethroat, "treats"); link(difflam, sorethroat, "treats"); link(difflam, mouthulcer, "treats");
    link(omeprazole, heartburn, "treats"); link(omeprazole, indigestion, "treats");
    link(ranitidine, heartburn, "treats"); link(ranitidine, indigestion, "treats");
    link(gaviscon, heartburn, "treats"); link(gaviscon, indigestion, "treats");
    link(antacid, heartburn, "treats"); link(antacid, indigestion, "treats");
    link(loperamide, diarrhoea, "treats"); link(ors, diarrhoea, "treats");
    link(lactulose, constipation, "treats"); link(senna, constipation, "treats"); link(macrogol, constipation, "treats"); link(bisacodyl, constipation, "treats"); link(glycerin, constipation, "treats");
    link(domperidone, nausea, "treats");
    link(diclofenac, musclepain, "treats"); link(diclofenac, backpain, "treats"); link(diclofenac, pain, "treats");
    link(voltarol, musclepain, "treats"); link(voltarol, backpain, "treats");
    link(deepHeat, musclepain, "treats"); link(deepHeat, backpain, "treats");
    link(hydrocortisone, eczema, "treats"); link(hydrocortisone, bites, "treats"); link(hydrocortisone, haemorrhoids, "treats");
    link(emollient, eczema, "treats"); link(emollient, dryskin, "treats"); link(emollient, nappyrash, "treats");
    link(benzoylPeroxide, acne, "treats"); link(salicylicAcid, acne, "treats"); link(salicylicAcid, warts, "treats");
    link(clotrimazole, athletes, "treats"); link(clotrimazole, thrush, "treats");
    link(terbinafine, athletes, "treats"); link(miconazole, athletes, "treats"); link(miconazole, thrush, "treats");
    link(fluconazole, thrush, "treats");
    link(chloramphenicol, conjunctivitis, "treats"); link(sodCromoglicate, conjunctivitis, "treats"); link(sodCromoglicate, allergy, "treats"); link(hypromelose, conjunctivitis, "treats");
    link(aciclovir, coldsore, "treats");
    link(bonjela, mouthulcer, "treats");
    link(simethicone, indigestion, "treats"); link(simethicone, ibs, "treats");
    link(mebeverine, ibs, "treats"); link(buscopan, ibs, "treats"); link(buscopan, periodpain, "treats");
    link(diphenhydramine, insomnia, "treats"); link(melatonin, insomnia, "treats");
    link(olive_ear, earache, "treats");
    link(canesten, thrush, "treats");
    link(anusol, haemorrhoids, "treats");
    link(hyoscine, travelSick, "treats"); link(cinnarizine, travelSick, "treats");
    link(calamine, sunburn, "treats"); link(calamine, bites, "treats"); link(calamine, eczema, "treats");
    link(sunscreen, sunburn, "treats");
    link(sudocrem, nappyrash, "treats"); link(metanium, nappyrash, "treats");
    link(anthisan, bites, "treats");
    link(sumatriptan, migraine, "treats"); link(naproxen, migraine, "treats"); link(naproxen, periodpain, "treats"); link(naproxen, pain, "treats"); link(naproxen, musclepain, "treats");
    link(cranberry, cystitis, "treats"); link(potCitrate, cystitis, "treats");

    /* ── Similar links ── */
    link(cold, flu, "similar"); link(cold, sinusitis, "similar"); link(cold, allergy, "similar");
    link(headache, migraine, "similar"); link(sinusitis, hayfever, "similar"); link(allergy, hayfever, "similar");
    link(indigestion, heartburn, "similar"); link(indigestion, ibs, "similar");
    link(pain, musclepain, "similar"); link(pain, backpain, "similar"); link(musclepain, backpain, "similar");
    link(eczema, dryskin, "similar"); link(eczema, acne, "similar");
    link(constipation, ibs, "similar"); link(diarrhoea, ibs, "similar");
    link(nausea, travelSick, "similar");
    link(periodpain, pain, "similar");
    link(coldsore, mouthulcer, "similar");
    link(sunburn, bites, "similar");
    link(athletes, thrush, "similar");

    /* ── Caution links ── */
    link(aspirin, ibuprofen, "caution"); link(ibuprofen, naproxen, "caution");
    link(omeprazole, ranitidine, "caution");
    link(codeine, loperamide, "caution"); link(codeine, diphenhydramine, "caution");
    link(pseudoephedrine, phenylephrine, "caution");
    link(chlorphenamine, diphenhydramine, "caution");
    link(senna, bisacodyl, "caution"); link(lactulose, macrogol, "caution");
    link(paracetamol, codeine, "caution");

    /* ── Alternative links ── */
    link(paracetamol, ibuprofen, "alternative"); link(cetirizine, loratadine, "alternative"); link(cetirizine, fexofenadine, "alternative"); link(loratadine, fexofenadine, "alternative"); link(cetirizine, chlorphenamine, "alternative");
    link(omeprazole, gaviscon, "alternative"); link(ranitidine, gaviscon, "alternative"); link(antacid, gaviscon, "alternative");
    link(lactulose, senna, "alternative"); link(lactulose, macrogol, "alternative"); link(senna, bisacodyl, "alternative");
    link(dextromethorphan, pholcodine, "alternative");
    link(clotrimazole, terbinafine, "alternative"); link(clotrimazole, miconazole, "alternative");
    link(diclofenac, voltarol, "alternative"); link(diclofenac, deepHeat, "alternative");
    link(hyoscine, cinnarizine, "alternative");
    link(pseudoephedrine, xylometazoline, "alternative"); link(phenylephrine, xylometazoline, "alternative");
    link(benzydamine, strepsils, "alternative"); link(benzydamine, difflam, "alternative");
    link(sumatriptan, naproxen, "alternative");
    link(cranberry, potCitrate, "alternative");
    link(sudocrem, metanium, "alternative");
    link(benzoylPeroxide, salicylicAcid, "alternative");
    link(calamine, anthisan, "alternative");
    link(emollient, sudocrem, "alternative");
    link(glycerin, bisacodyl, "alternative");
    link(salineNasal, xylometazoline, "alternative");

    // build index
    var byId = {};
    nodes.forEach(function (nd) { byId[nd.id] = nd; });
    return { nodes: nodes, byId: byId };
  }

  /* ── Link-type metadata ─────────────────────────────────────────────── */
  var LINK_TYPES = {
    symptom:     { label: "Symptoms",     color: "#ffcc66", icon: "\uD83E\uDE7A", dash: false },
    treats:      { label: "Treatments",   color: "#2ee59d", icon: "\uD83D\uDC8A", dash: false },
    similar:     { label: "Similar",      color: "#4ea1ff", icon: "\uD83D\uDD17", dash: [6, 4] },
    caution:     { label: "Cautions",     color: "#ff6b9d", icon: "\u26A0\uFE0F", dash: [4, 4] },
    alternative: { label: "Alternatives", color: "#b98eff", icon: "\uD83D\uDD04", dash: [8, 3] }
  };

  var NODE_COLORS = {
    condition:  { fill: "#1a3a5c", stroke: "#4ea1ff", text: "#c8e1ff" },
    symptom:    { fill: "#3a2e10", stroke: "#ffcc66", text: "#ffe6a0" },
    medication: { fill: "#0f3329", stroke: "#2ee59d", text: "#a0f0cc" },
    category:   { fill: "#2a1a3a", stroke: "#b98eff", text: "#d9c4ff" }
  };

  /* ── styles ─────────────────────────────────────────────────────────── */
  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return; stylesDone = true;
    var s = document.createElement("style"); s.id = "eikon-otcmindmap-style";
    s.textContent = [
      ".om{--ac:#4ea1ff;--ac2:#7c6cff;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.035);--pnl2:rgba(255,255,255,.055);--bd:rgba(255,255,255,.09);--bd2:rgba(255,255,255,.14);--r:14px;--r2:10px;--txt:#e8eefc;--mut:rgba(170,183,214,.72);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--txt);margin:-14px;min-height:calc(100vh - 56px);background:radial-gradient(1200px 600px at 10% 8%,rgba(78,161,255,.10),transparent 60%),radial-gradient(900px 500px at 88% 15%,rgba(124,108,255,.07),transparent 55%)}",
      ".om *{box-sizing:border-box}",

      /* layout */
      ".om .om-wrap{display:flex;height:calc(100vh - 56px);overflow:hidden}",
      ".om .om-main{flex:1;display:flex;flex-direction:column;min-width:0}",
      ".om .om-panel{width:280px;flex-shrink:0;border-left:1px solid var(--bd);background:rgba(11,18,32,.6);backdrop-filter:blur(10px);display:flex;flex-direction:column;overflow:hidden;transition:width .2s}",
      ".om .om-panel.collapsed{width:0;border-left:none;overflow:hidden}",

      /* top bar */
      ".om .om-topbar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--bd);background:rgba(11,18,32,.5);backdrop-filter:blur(6px);flex-shrink:0}",
      ".om .om-topbar h2{margin:0;font-size:16px;font-weight:900;letter-spacing:.3px;white-space:nowrap;display:flex;align-items:center;gap:8px}",
      ".om .om-search{flex:1;min-width:0;max-width:420px;position:relative}",
      ".om .om-search input{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.28);color:var(--txt);padding:9px 14px 9px 36px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .2s,box-shadow .2s}",
      ".om .om-search input:focus{border-color:rgba(78,161,255,.55);box-shadow:0 0 0 3px rgba(78,161,255,.1)}",
      ".om .om-search input::placeholder{color:rgba(170,183,214,.4)}",
      ".om .om-search .search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--mut);font-size:14px;pointer-events:none}",
      ".om .om-search .om-dd{position:absolute;top:100%;left:0;right:0;margin-top:4px;background:linear-gradient(165deg,#1a2640,#141e30);border:1px solid var(--bd2);border-radius:var(--r2);max-height:260px;overflow-y:auto;box-shadow:0 12px 36px rgba(0,0,0,.5);z-index:100;display:none}",
      ".om .om-search .om-dd.open{display:block}",
      ".om .om-dd-item{padding:9px 14px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background .1s}",
      ".om .om-dd-item:hover,.om .om-dd-item.hl{background:rgba(78,161,255,.12)}",
      ".om .om-dd-item .dd-type{font-size:10px;padding:2px 7px;border-radius:6px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;flex-shrink:0}",
      ".om .om-dd-item .dd-type.condition{background:rgba(78,161,255,.15);color:#8ac4ff}",
      ".om .om-dd-item .dd-type.symptom{background:rgba(255,204,102,.15);color:#ffcc66}",
      ".om .om-dd-item .dd-type.medication{background:rgba(46,229,157,.15);color:#6af0be}",
      ".om .om-topbar-actions{display:flex;gap:6px;flex-shrink:0;align-items:center}",

      /* toolbar buttons */
      ".om .om-btn{border:1px solid var(--bd);background:var(--pnl2);color:var(--txt);padding:7px 12px;border-radius:var(--r2);cursor:pointer;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;transition:all .12s;white-space:nowrap}",
      ".om .om-btn:hover{background:rgba(255,255,255,.08);border-color:var(--bd2);transform:translateY(-1px)}",
      ".om .om-btn:active{transform:translateY(0)}",
      ".om .om-btn.pri{background:linear-gradient(135deg,rgba(78,161,255,.2),rgba(124,108,255,.15));border-color:rgba(78,161,255,.35);color:#8ac4ff}",
      ".om .om-btn.pri:hover{border-color:rgba(78,161,255,.5);box-shadow:0 4px 16px rgba(78,161,255,.12)}",
      ".om .om-btn.sm{padding:5px 8px;font-size:11px;border-radius:8px}",

      /* canvas area */
      ".om .om-canvas-wrap{flex:1;position:relative;overflow:hidden;cursor:grab}",
      ".om .om-canvas-wrap:active{cursor:grabbing}",
      ".om .om-canvas-wrap canvas{display:block;width:100%;height:100%}",

      /* stats bar */
      ".om .om-stats{display:flex;gap:14px;padding:6px 16px;border-top:1px solid var(--bd);font-size:11px;color:var(--mut);flex-shrink:0;align-items:center;background:rgba(11,18,32,.4)}",
      ".om .om-stats span{display:flex;align-items:center;gap:4px}",
      ".om .om-stats .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}",

      /* panel */
      ".om .om-panel-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--bd);flex-shrink:0}",
      ".om .om-panel-hd h3{margin:0;font-size:13px;font-weight:800;letter-spacing:.2px}",
      ".om .om-panel-body{flex:1;overflow-y:auto;padding:8px 0}",

      /* link group */
      ".om .om-lg{border-bottom:1px solid var(--bd)}",
      ".om .om-lg-hd{display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;transition:background .1s;user-select:none}",
      ".om .om-lg-hd:hover{background:rgba(255,255,255,.04)}",
      ".om .om-lg-hd .lg-arrow{font-size:10px;color:var(--mut);transition:transform .15s;width:14px;text-align:center;flex-shrink:0}",
      ".om .om-lg-hd .lg-arrow.open{transform:rotate(90deg)}",
      ".om .om-lg-hd .lg-icon{font-size:14px;flex-shrink:0}",
      ".om .om-lg-hd .lg-label{font-size:12px;font-weight:700;flex:1}",
      ".om .om-lg-hd .lg-count{font-size:10px;color:var(--mut);padding:2px 7px;background:var(--pnl2);border-radius:8px;font-weight:700}",
      ".om .om-lg-hd .lg-check{width:16px;height:16px;cursor:pointer;accent-color:var(--ac);flex-shrink:0}",
      ".om .om-lg-bd{display:none;padding:2px 14px 8px 36px}",
      ".om .om-lg-bd.open{display:block}",

      /* link item */
      ".om .om-li{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px}",
      ".om .om-li input{width:14px;height:14px;cursor:pointer;accent-color:var(--ac);flex-shrink:0}",
      ".om .om-li .li-label{flex:1;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:color .1s}",
      ".om .om-li .li-label:hover{color:var(--ac)}",

      /* global actions in panel */
      ".om .om-panel-actions{display:flex;gap:6px;padding:10px 14px;border-bottom:1px solid var(--bd);flex-shrink:0}",

      /* empty state */
      ".om .om-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:40px;color:var(--mut)}",
      ".om .om-empty .big-icon{font-size:56px;margin-bottom:16px;opacity:.5}",
      ".om .om-empty .msg{font-size:15px;margin-bottom:6px;font-weight:600}",
      ".om .om-empty .sub{font-size:12px;max-width:340px;line-height:1.5}",

      /* tooltip */
      ".om .om-tooltip{position:absolute;pointer-events:none;background:linear-gradient(165deg,#1e2e48,#161f30);border:1px solid var(--bd2);border-radius:10px;padding:10px 14px;font-size:12px;max-width:240px;box-shadow:0 8px 28px rgba(0,0,0,.5);z-index:50;opacity:0;transition:opacity .12s}",
      ".om .om-tooltip.show{opacity:1}",
      ".om .om-tooltip .tt-name{font-weight:800;font-size:13px;margin-bottom:4px;display:flex;align-items:center;gap:6px}",
      ".om .om-tooltip .tt-type{font-size:10px;padding:2px 6px;border-radius:5px;font-weight:700;text-transform:uppercase}",
      ".om .om-tooltip .tt-links{font-size:11px;color:var(--mut);margin-top:4px}",

      /* legend (bottom-left) */
      ".om .om-legend{position:absolute;bottom:12px;left:12px;display:flex;gap:10px;font-size:10px;color:var(--mut);background:rgba(11,18,32,.65);border:1px solid var(--bd);border-radius:8px;padding:6px 12px;backdrop-filter:blur(6px);pointer-events:none}",
      ".om .om-legend span{display:flex;align-items:center;gap:4px}",
      ".om .om-legend .ld{width:18px;height:3px;border-radius:2px}",

      /* zoom controls */
      ".om .om-zoom{position:absolute;bottom:12px;right:12px;display:flex;gap:4px}",
      ".om .om-zoom button{width:32px;height:32px;border:1px solid var(--bd);background:rgba(11,18,32,.65);backdrop-filter:blur(6px);color:var(--txt);border-radius:8px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .1s}",
      ".om .om-zoom button:hover{background:rgba(255,255,255,.08);border-color:var(--bd2)}",

      /* scrollbar */
      ".om ::-webkit-scrollbar{width:5px}",
      ".om ::-webkit-scrollbar-track{background:transparent}",
      ".om ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}",

      /* responsive */
      "@media(max-width:800px){.om .om-panel{width:240px}.om .om-topbar h2{display:none}}",
      "@media(max-width:600px){.om .om-panel{position:absolute;right:0;top:0;bottom:0;z-index:20;width:260px;box-shadow:-8px 0 30px rgba(0,0,0,.4)}.om .om-panel.collapsed{width:0}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ── state ───────────────────────────────────────────────────────────── */
  var mount, cvs, ctx2d;
  var W = 0, H = 0, dpr = 1;
  var cam = { x: 0, y: 0, zoom: 1 };
  var graph = { nodes: [], edges: [] };
  var visibleEdges = {};          // edge-key → boolean
  var groupOpen = {};             // rel-type → boolean (panel collapse)
  var hoveredNode = null;
  var dragNode = null;
  var panStart = null;
  var animId = null;
  var settled = false;
  var panelEl = null;
  var panelCollapsed = false;
  var tooltipEl = null;
  var searchInput = null;
  var ddEl = null;
  var rootNodeId = null;
  var lastRebuild = 0;

  /* ── graph building ─────────────────────────────────────────────────── */
  function buildGraph(centerId) {
    rootNodeId = centerId;
    var centerNode = KB.byId[centerId];
    if (!centerNode) return;

    var visited = {};
    var queue = [centerId];
    visited[centerId] = true;

    // BFS 2 levels deep
    for (var depth = 0; depth < 2; depth++) {
      var next = [];
      for (var qi = 0; qi < queue.length; qi++) {
        var nd = KB.byId[queue[qi]];
        if (!nd) continue;
        for (var li = 0; li < nd.links.length; li++) {
          var t = nd.links[li].target;
          if (!visited[t]) { visited[t] = true; next.push(t); }
        }
      }
      queue = next;
    }

    // Build node list & edge list
    var gNodes = [];
    var gEdges = [];
    var inGraph = {};
    var ids = Object.keys(visited);

    for (var i = 0; i < ids.length; i++) {
      var nid = Number(ids[i]);
      var nd2 = KB.byId[nid];
      if (!nd2) continue;
      inGraph[nid] = true;
      var angle = Math.random() * Math.PI * 2;
      var dist = (nid === centerId) ? 0 : (80 + Math.random() * 200);
      gNodes.push({
        id: nid,
        label: nd2.label,
        type: nd2.type,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        vx: 0, vy: 0,
        radius: nid === centerId ? 28 : (nd2.type === "condition" ? 22 : (nd2.type === "medication" ? 18 : 15)),
        pinned: false,
        depth: 0
      });
    }

    // Compute depth from center (for sizing)
    var depthMap = {}; depthMap[centerId] = 0;
    var bfsQ = [centerId];
    while (bfsQ.length > 0) {
      var cur = bfsQ.shift();
      var curDepth = depthMap[cur];
      var curNd = KB.byId[cur];
      if (!curNd) continue;
      for (var j = 0; j < curNd.links.length; j++) {
        var tgt = curNd.links[j].target;
        if (inGraph[tgt] && depthMap[tgt] === undefined) {
          depthMap[tgt] = curDepth + 1;
          bfsQ.push(tgt);
        }
      }
    }
    for (var gi = 0; gi < gNodes.length; gi++) {
      gNodes[gi].depth = depthMap[gNodes[gi].id] || 0;
    }

    // Build edges (deduplicated)
    var edgeSet = {};
    for (var k = 0; k < ids.length; k++) {
      var nid3 = Number(ids[k]);
      var nd3 = KB.byId[nid3];
      if (!nd3) continue;
      for (var m = 0; m < nd3.links.length; m++) {
        var lnk = nd3.links[m];
        if (!inGraph[lnk.target]) continue;
        var a = Math.min(nid3, lnk.target), b = Math.max(nid3, lnk.target);
        var ekey = a + "-" + b + "-" + lnk.rel;
        if (edgeSet[ekey]) continue;
        edgeSet[ekey] = true;
        gEdges.push({ source: nid3, target: lnk.target, rel: lnk.rel, key: ekey });
      }
    }

    graph = { nodes: gNodes, edges: gEdges };
    rebuildNodeMap();

    // Reset visibility - all on
    visibleEdges = {};
    for (var ei = 0; ei < gEdges.length; ei++) { visibleEdges[gEdges[ei].key] = true; }

    // Reset camera
    cam.x = 0; cam.y = 0; cam.zoom = 1;
    settled = false;
    lastRebuild = Date.now();
  }

  /* ── force simulation ───────────────────────────────────────────────── */
  var SIM_ITERS = 1;  // per frame for speed
  var ALPHA = 0.3;
  var ALPHA_DECAY = 0.9985;
  var MIN_ALPHA = 0.001;

  function simStep() {
    if (settled) return;
    var nodes = graph.nodes;
    var edges = graph.edges;
    if (nodes.length === 0) return;

    for (var iter = 0; iter < SIM_ITERS; iter++) {
      // Repulsion (charge)
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var dx = nodes[j].x - nodes[i].x;
          var dy = nodes[j].y - nodes[i].y;
          var d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = 0.5; dy = 0.5; d2 = 0.5; }
          var force = 8000 / d2;
          var fx = dx / Math.sqrt(d2) * force;
          var fy = dy / Math.sqrt(d2) * force;
          if (!nodes[i].pinned) { nodes[i].vx -= fx * ALPHA; nodes[i].vy -= fy * ALPHA; }
          if (!nodes[j].pinned) { nodes[j].vx += fx * ALPHA; nodes[j].vy += fy * ALPHA; }
        }
      }

      // Attraction (spring) — only visible edges
      for (var k = 0; k < edges.length; k++) {
        var e = edges[k];
        if (!visibleEdges[e.key]) continue;
        var si = nodeById(e.source), ti = nodeById(e.target);
        if (!si || !ti) continue;
        var edx = ti.x - si.x, edy = ti.y - si.y;
        var ed = Math.sqrt(edx * edx + edy * edy) || 1;
        var idealLen = 140;
        var spring = (ed - idealLen) * 0.008 * ALPHA;
        var sfx = edx / ed * spring, sfy = edy / ed * spring;
        if (!si.pinned) { si.vx += sfx; si.vy += sfy; }
        if (!ti.pinned) { ti.vx -= sfx; ti.vy -= sfy; }
      }

      // Center gravity
      for (var g = 0; g < nodes.length; g++) {
        if (!nodes[g].pinned) {
          nodes[g].vx -= nodes[g].x * 0.001 * ALPHA;
          nodes[g].vy -= nodes[g].y * 0.001 * ALPHA;
        }
      }

      // Velocity update
      var totalV = 0;
      for (var v = 0; v < nodes.length; v++) {
        if (nodes[v].pinned) { nodes[v].vx = 0; nodes[v].vy = 0; continue; }
        nodes[v].vx *= 0.88;
        nodes[v].vy *= 0.88;
        var speed = Math.sqrt(nodes[v].vx * nodes[v].vx + nodes[v].vy * nodes[v].vy);
        if (speed > 8) { nodes[v].vx = nodes[v].vx / speed * 8; nodes[v].vy = nodes[v].vy / speed * 8; }
        nodes[v].x += nodes[v].vx;
        nodes[v].y += nodes[v].vy;
        totalV += speed;
      }

      ALPHA *= ALPHA_DECAY;
      if (ALPHA < MIN_ALPHA && totalV < 0.5) { settled = true; }
    }
  }

  var _nodeMap = {};
  function nodeById(id) { return _nodeMap[id] || null; }
  function rebuildNodeMap() {
    _nodeMap = {};
    for (var i = 0; i < graph.nodes.length; i++) { _nodeMap[graph.nodes[i].id] = graph.nodes[i]; }
  }

  /* ── rendering (Canvas) ─────────────────────────────────────────────── */
  function render() {
    if (!ctx2d || !cvs) return;
    simStep();

    ctx2d.save();
    ctx2d.clearRect(0, 0, W * dpr, H * dpr);
    ctx2d.scale(dpr, dpr);

    // camera transform
    ctx2d.translate(W / 2 + cam.x, H / 2 + cam.y);
    ctx2d.scale(cam.zoom, cam.zoom);

    var nodes = graph.nodes;
    var edges = graph.edges;

    // Draw edges
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (!visibleEdges[e.key]) continue;
      var sn = nodeById(e.source), tn = nodeById(e.target);
      if (!sn || !tn) continue;
      var lt = LINK_TYPES[e.rel] || LINK_TYPES.similar;

      ctx2d.beginPath();
      ctx2d.strokeStyle = lt.color + "55";
      ctx2d.lineWidth = 1.5;
      if (lt.dash) { ctx2d.setLineDash(lt.dash); } else { ctx2d.setLineDash([]); }

      // Check if either endpoint is hovered
      if (hoveredNode && (e.source === hoveredNode.id || e.target === hoveredNode.id)) {
        ctx2d.strokeStyle = lt.color + "cc";
        ctx2d.lineWidth = 2.5;
      }

      ctx2d.moveTo(sn.x, sn.y);
      ctx2d.lineTo(tn.x, tn.y);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }

    // Draw nodes
    for (var j = 0; j < nodes.length; j++) {
      var nd = nodes[j];
      var nc = NODE_COLORS[nd.type] || NODE_COLORS.condition;
      var r = nd.radius;
      var isHovered = hoveredNode && hoveredNode.id === nd.id;
      var isRoot = nd.id === rootNodeId;

      // Glow for root/hovered
      if (isRoot || isHovered) {
        ctx2d.beginPath();
        var grad = ctx2d.createRadialGradient(nd.x, nd.y, r * 0.5, nd.x, nd.y, r * 2.5);
        grad.addColorStop(0, nc.stroke + "40");
        grad.addColorStop(1, nc.stroke + "00");
        ctx2d.fillStyle = grad;
        ctx2d.arc(nd.x, nd.y, r * 2.5, 0, Math.PI * 2);
        ctx2d.fill();
      }

      // Node circle
      ctx2d.beginPath();
      ctx2d.arc(nd.x, nd.y, r, 0, Math.PI * 2);
      ctx2d.fillStyle = isHovered ? nc.stroke + "30" : nc.fill;
      ctx2d.fill();
      ctx2d.strokeStyle = isHovered ? nc.stroke : nc.stroke + "88";
      ctx2d.lineWidth = isRoot ? 3 : (isHovered ? 2.5 : 1.5);
      ctx2d.stroke();

      // Label
      var fontSize = r < 18 ? 9 : (r < 22 ? 10 : 11);
      ctx2d.font = (isRoot ? "800 " : "600 ") + fontSize + "px system-ui,-apple-system,sans-serif";
      ctx2d.fillStyle = isHovered ? "#fff" : nc.text;
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";

      // Word wrap for labels
      var words = nd.label.split(/\s+/);
      var lines = [];
      var line = "";
      var maxW = r * 2.8;
      for (var w = 0; w < words.length; w++) {
        var test = line ? line + " " + words[w] : words[w];
        if (ctx2d.measureText(test).width > maxW && line) {
          lines.push(line);
          line = words[w];
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);

      var lh = fontSize + 2;
      var startY = nd.y + r + 10 + (lines.length > 1 ? 0 : lh / 2) - (lines.length * lh / 2);
      for (var l = 0; l < lines.length; l++) {
        // text shadow for readability
        ctx2d.fillStyle = "rgba(0,0,0,.6)";
        ctx2d.fillText(lines[l], nd.x + 1, startY + l * lh + 1);
        ctx2d.fillStyle = isHovered ? "#fff" : nc.text;
        ctx2d.fillText(lines[l], nd.x, startY + l * lh);
      }

      // Type icon inside node
      var icon = nd.type === "condition" ? "\uD83C\uDFE5" : (nd.type === "medication" ? "\uD83D\uDC8A" : (nd.type === "symptom" ? "\uD83E\uDE7A" : "\uD83D\uDD17"));
      ctx2d.font = (r * 0.7) + "px serif";
      ctx2d.fillText(icon, nd.x, nd.y);
    }

    ctx2d.restore();

    animId = requestAnimationFrame(render);
  }

  /* ── interaction ────────────────────────────────────────────────────── */
  function screenToWorld(sx, sy) {
    return {
      x: (sx - W / 2 - cam.x) / cam.zoom,
      y: (sy - H / 2 - cam.y) / cam.zoom
    };
  }

  function hitTest(sx, sy) {
    var w = screenToWorld(sx, sy);
    var bestDist = Infinity, best = null;
    for (var i = 0; i < graph.nodes.length; i++) {
      var nd = graph.nodes[i];
      var dx = nd.x - w.x, dy = nd.y - w.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < nd.radius + 6 && d < bestDist) { bestDist = d; best = nd; }
    }
    return best;
  }

  function bindCanvas() {
    if (!cvs) return;

    cvs.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      var rect = cvs.getBoundingClientRect();
      var sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      var nd = hitTest(sx, sy);
      if (nd) {
        dragNode = nd;
        nd.pinned = true;
        ALPHA = 0.3; settled = false;
      } else {
        panStart = { mx: ev.clientX, my: ev.clientY, cx: cam.x, cy: cam.y };
      }
      ev.preventDefault();
    });

    window.addEventListener("pointermove", function (ev) {
      if (dragNode) {
        var rect = cvs.getBoundingClientRect();
        var w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
        dragNode.x = w.x;
        dragNode.y = w.y;
        dragNode.vx = 0; dragNode.vy = 0;
        ALPHA = Math.max(ALPHA, 0.05); settled = false;
        return;
      }
      if (panStart) {
        cam.x = panStart.cx + (ev.clientX - panStart.mx);
        cam.y = panStart.cy + (ev.clientY - panStart.my);
        return;
      }
      // Hover
      if (cvs) {
        var rect2 = cvs.getBoundingClientRect();
        var sx = ev.clientX - rect2.left, sy = ev.clientY - rect2.top;
        var nd = hitTest(sx, sy);
        if (nd !== hoveredNode) {
          hoveredNode = nd;
          updateTooltip(ev.clientX - rect2.left, ev.clientY - rect2.top);
        }
      }
    });

    window.addEventListener("pointerup", function () {
      if (dragNode) { dragNode.pinned = false; dragNode = null; }
      panStart = null;
    });

    cvs.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var factor = ev.deltaY < 0 ? 1.1 : 0.9;
      cam.zoom = clamp(cam.zoom * factor, 0.15, 4);
    }, { passive: false });

    // Double-click to expand node
    cvs.addEventListener("dblclick", function (ev) {
      var rect = cvs.getBoundingClientRect();
      var nd = hitTest(ev.clientX - rect.left, ev.clientY - rect.top);
      if (nd) {
        buildGraph(nd.id);
        ALPHA = 0.3; settled = false;
        rebuildPanel();
        updateStats();
      }
    });
  }

  function updateTooltip(sx, sy) {
    if (!tooltipEl) return;
    if (!hoveredNode) { tooltipEl.classList.remove("show"); return; }
    var nd = hoveredNode;
    var kbNode = KB.byId[nd.id];
    var linkCount = kbNode ? kbNode.links.length : 0;
    var typeColors = { condition: "#4ea1ff", symptom: "#ffcc66", medication: "#2ee59d" };
    var bgColors = { condition: "rgba(78,161,255,.15)", symptom: "rgba(255,204,102,.15)", medication: "rgba(46,229,157,.15)" };
    tooltipEl.innerHTML =
      '<div class="tt-name"><span class="tt-type" style="background:' + (bgColors[nd.type] || "var(--pnl2)") + ';color:' + (typeColors[nd.type] || "var(--txt)") + '">' + esc(nd.type) + '</span> ' + esc(nd.label) + '</div>' +
      '<div class="tt-links">' + linkCount + ' connection' + (linkCount !== 1 ? 's' : '') + ' \u00b7 double-click to expand</div>';
    tooltipEl.classList.add("show");
    tooltipEl.style.left = clamp(sx + 14, 0, W - 250) + "px";
    tooltipEl.style.top = clamp(sy - 10, 0, H - 80) + "px";
  }

  /* ── panel building ─────────────────────────────────────────────────── */
  function rebuildPanel() {
    if (!panelEl) return;
    var body = panelEl.querySelector(".om-panel-body");
    if (!body) return;
    body.innerHTML = "";

    if (graph.edges.length === 0) {
      body.innerHTML = '<div style="padding:20px 14px;color:var(--mut);font-size:12px;text-align:center;">Search for a condition to see links</div>';
      return;
    }

    // Group edges by rel type
    var groups = {};
    for (var i = 0; i < graph.edges.length; i++) {
      var e = graph.edges[i];
      if (!groups[e.rel]) groups[e.rel] = [];
      groups[e.rel].push(e);
    }

    var order = ["symptom", "treats", "similar", "caution", "alternative"];
    for (var oi = 0; oi < order.length; oi++) {
      var rel = order[oi];
      if (!groups[rel] || groups[rel].length === 0) continue;
      var lt = LINK_TYPES[rel];
      var isOpen = groupOpen[rel] !== false; // default open

      var grp = document.createElement("div");
      grp.className = "om-lg";

      // Header
      var hd = document.createElement("div");
      hd.className = "om-lg-hd";
      var allOn = groups[rel].every(function (e) { return visibleEdges[e.key]; });
      hd.innerHTML =
        '<span class="lg-arrow ' + (isOpen ? "open" : "") + '">\u25B6</span>' +
        '<span class="lg-icon">' + lt.icon + '</span>' +
        '<span class="lg-label" style="color:' + lt.color + '">' + lt.label + '</span>' +
        '<span class="lg-count">' + groups[rel].length + '</span>' +
        '<input type="checkbox" class="lg-check" ' + (allOn ? "checked" : "") + ' title="Toggle all ' + lt.label + '">';

      (function (rel2, grp2, hd2) {
        // Toggle collapse
        hd2.addEventListener("click", function (ev) {
          if (ev.target.type === "checkbox") return;
          groupOpen[rel2] = !groupOpen[rel2];
          var bd = grp2.querySelector(".om-lg-bd");
          var arrow = hd2.querySelector(".lg-arrow");
          if (bd) bd.classList.toggle("open");
          if (arrow) arrow.classList.toggle("open");
        });

        // Group checkbox
        var gCb = hd2.querySelector(".lg-check");
        gCb.addEventListener("change", function () {
          var on = gCb.checked;
          var items = grp2.querySelectorAll(".om-li input");
          for (var x = 0; x < items.length; x++) { items[x].checked = on; }
          for (var y = 0; y < groups[rel2].length; y++) { visibleEdges[groups[rel2][y].key] = on; }
          ALPHA = 0.15; settled = false;
          updateStats();
        });
      })(rel, grp, hd);

      grp.appendChild(hd);

      // Body (link items)
      var bd = document.createElement("div");
      bd.className = "om-lg-bd" + (isOpen ? " open" : "");

      for (var j = 0; j < groups[rel].length; j++) {
        var edge = groups[rel][j];
        var sNode = KB.byId[edge.source], tNode = KB.byId[edge.target];
        var label = (sNode ? sNode.label : "?") + " \u2194 " + (tNode ? tNode.label : "?");

        var li = document.createElement("div");
        li.className = "om-li";
        li.innerHTML = '<input type="checkbox" ' + (visibleEdges[edge.key] ? "checked" : "") + '><span class="li-label" title="' + esc(label) + '">' + esc(label) + '</span>';

        (function (ekey, li2) {
          var cb = li2.querySelector("input");
          cb.addEventListener("change", function () {
            visibleEdges[ekey] = cb.checked;
            // Update group checkbox
            var grpEl = li2.closest(".om-lg");
            if (grpEl) {
              var all = grpEl.querySelectorAll(".om-li input");
              var allChecked = true;
              for (var x = 0; x < all.length; x++) { if (!all[x].checked) { allChecked = false; break; } }
              var gCb = grpEl.querySelector(".lg-check");
              if (gCb) gCb.checked = allChecked;
            }
            ALPHA = 0.1; settled = false;
            updateStats();
          });

          // Click label to highlight edge
          var lbl = li2.querySelector(".li-label");
          lbl.addEventListener("click", function () {
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event("change"));
          });
        })(edge.key, li);

        bd.appendChild(li);
      }

      grp.appendChild(bd);
      body.appendChild(grp);
    }
  }

  function setAllEdges(on) {
    for (var key in visibleEdges) { visibleEdges[key] = on; }
    rebuildPanel();
    ALPHA = 0.15; settled = false;
    updateStats();
  }

  /* ── stats bar ──────────────────────────────────────────────────────── */
  function updateStats() {
    var statsEl = mount && mount.querySelector(".om-stats");
    if (!statsEl) return;
    var nc = { condition: 0, symptom: 0, medication: 0 };
    for (var i = 0; i < graph.nodes.length; i++) { var t = graph.nodes[i].type; if (nc[t] !== undefined) nc[t]++; }
    var visCount = 0, totCount = 0;
    for (var k in visibleEdges) { totCount++; if (visibleEdges[k]) visCount++; }
    statsEl.innerHTML =
      '<span><span class="dot" style="background:#4ea1ff"></span>' + nc.condition + ' conditions</span>' +
      '<span><span class="dot" style="background:#2ee59d"></span>' + nc.medication + ' medications</span>' +
      '<span><span class="dot" style="background:#ffcc66"></span>' + nc.symptom + ' symptoms</span>' +
      '<span style="margin-left:auto">' + visCount + '/' + totCount + ' links visible</span>';
  }

  /* ── search ─────────────────────────────────────────────────────────── */
  function doSearch(q) {
    q = norm(q);
    if (!q) return [];
    var results = [];
    for (var i = 0; i < KB.nodes.length; i++) {
      var nd = KB.nodes[i];
      var lab = norm(nd.label);
      var score = 0;
      if (lab === q) score = 100;
      else if (lab.indexOf(q) === 0) score = 80;
      else if (lab.indexOf(q) >= 0) score = 60;
      else {
        // Fuzzy: check each word
        var words = q.split(/\s+/);
        var matched = 0;
        for (var w = 0; w < words.length; w++) {
          if (lab.indexOf(words[w]) >= 0) matched++;
        }
        if (matched > 0) score = 30 + (matched / words.length) * 20;
      }
      if (score > 0) results.push({ node: nd, score: score });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 20);
  }

  function showDropdown(results) {
    if (!ddEl) return;
    if (results.length === 0) { ddEl.classList.remove("open"); return; }
    ddEl.innerHTML = "";
    var typeColors = { condition: "condition", symptom: "symptom", medication: "medication" };
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var item = document.createElement("div");
      item.className = "om-dd-item";
      item.innerHTML = '<span class="dd-type ' + (typeColors[r.node.type] || "") + '">' + esc(r.node.type) + '</span>' + esc(r.node.label);
      (function (nodeId) {
        item.addEventListener("click", function () {
          buildGraph(nodeId);
          ALPHA = 0.3; settled = false;
          rebuildPanel();
          updateStats();
          ddEl.classList.remove("open");
          if (searchInput) searchInput.value = KB.byId[nodeId].label;
        });
      })(r.node.id);
      ddEl.appendChild(item);
    }
    ddEl.classList.add("open");
  }

  /* ── resize ─────────────────────────────────────────────────────────── */
  function resize() {
    if (!cvs) return;
    var wrap = cvs.parentElement;
    if (!wrap) return;
    dpr = window.devicePixelRatio || 1;
    W = wrap.clientWidth;
    H = wrap.clientHeight;
    cvs.width = W * dpr;
    cvs.height = H * dpr;
    cvs.style.width = W + "px";
    cvs.style.height = H + "px";
    ctx2d = cvs.getContext("2d");
  }

  /* ── main render ────────────────────────────────────────────────────── */
  async function renderModule(moduleCtx) {
    mount = moduleCtx.mount;
    mount.innerHTML = "";
    ensureStyles();

    // Stop any previous animation
    if (animId) { cancelAnimationFrame(animId); animId = null; }

    var root = document.createElement("div");
    root.className = "om";

    root.innerHTML =
      '<div class="om-wrap">' +
        '<div class="om-main">' +
          /* top bar */
          '<div class="om-topbar">' +
            '<h2>\uD83E\uDDE0 OTC Mindmap</h2>' +
            '<div class="om-search">' +
              '<span class="search-icon">\uD83D\uDD0D</span>' +
              '<input type="text" placeholder="Search conditions, symptoms, medications\u2026" autocomplete="off" spellcheck="false">' +
              '<div class="om-dd"></div>' +
            '</div>' +
            '<div class="om-topbar-actions">' +
              '<button class="om-btn sm om-btn-fit" title="Fit to screen">\u2922 Fit</button>' +
              '<button class="om-btn sm om-btn-panel" title="Toggle link panel">\u2630</button>' +
            '</div>' +
          '</div>' +
          /* canvas */
          '<div class="om-canvas-wrap">' +
            '<canvas></canvas>' +
            '<div class="om-tooltip"></div>' +
            '<div class="om-legend">' +
              '<span><span class="ld" style="background:#ffcc66"></span>Symptom</span>' +
              '<span><span class="ld" style="background:#2ee59d"></span>Treatment</span>' +
              '<span><span class="ld" style="background:#4ea1ff"></span>Similar</span>' +
              '<span><span class="ld" style="background:#ff6b9d"></span>Caution</span>' +
              '<span><span class="ld" style="background:#b98eff"></span>Alternative</span>' +
            '</div>' +
            '<div class="om-zoom">' +
              '<button class="om-zoom-in" title="Zoom in">+</button>' +
              '<button class="om-zoom-out" title="Zoom out">\u2212</button>' +
            '</div>' +
          '</div>' +
          /* stats */
          '<div class="om-stats"></div>' +
        '</div>' +
        /* panel */
        '<div class="om-panel">' +
          '<div class="om-panel-hd">' +
            '<h3>\uD83D\uDD17 Links</h3>' +
          '</div>' +
          '<div class="om-panel-actions">' +
            '<button class="om-btn sm om-sa">Select All</button>' +
            '<button class="om-btn sm om-ua">Unselect All</button>' +
          '</div>' +
          '<div class="om-panel-body"></div>' +
        '</div>' +
      '</div>';

    mount.appendChild(root);

    // Cache elements
    cvs = root.querySelector("canvas");
    panelEl = root.querySelector(".om-panel");
    tooltipEl = root.querySelector(".om-tooltip");
    searchInput = root.querySelector(".om-search input");
    ddEl = root.querySelector(".om-dd");

    // Resize & start rendering
    resize();
    window.addEventListener("resize", resize);
    bindCanvas();

    // Search
    var searchTimer = null;
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var q = searchInput.value.trim();
        if (q.length < 2) { ddEl.classList.remove("open"); return; }
        var results = doSearch(q);
        showDropdown(results);
      }, 120);
    });

    searchInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ddEl.classList.remove("open"); }
      if (ev.key === "Enter") {
        var q = searchInput.value.trim();
        var results = doSearch(q);
        if (results.length > 0) {
          buildGraph(results[0].node.id);
          ALPHA = 0.3; settled = false;
          rebuildPanel();
          updateStats();
          ddEl.classList.remove("open");
          searchInput.value = results[0].node.label;
        }
      }
    });

    // Close dropdown on outside click
    document.addEventListener("click", function (ev) {
      if (ddEl && !ddEl.contains(ev.target) && ev.target !== searchInput) {
        ddEl.classList.remove("open");
      }
    });

    // Panel toggle
    root.querySelector(".om-btn-panel").addEventListener("click", function () {
      panelCollapsed = !panelCollapsed;
      panelEl.classList.toggle("collapsed", panelCollapsed);
      setTimeout(resize, 220);
    });

    // Fit button
    root.querySelector(".om-btn-fit").addEventListener("click", function () {
      if (graph.nodes.length === 0) return;
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var i = 0; i < graph.nodes.length; i++) {
        var nd = graph.nodes[i];
        if (nd.x < minX) minX = nd.x; if (nd.x > maxX) maxX = nd.x;
        if (nd.y < minY) minY = nd.y; if (nd.y > maxY) maxY = nd.y;
      }
      var gw = maxX - minX + 100, gh = maxY - minY + 100;
      var zoom = Math.min(W / gw, H / gh, 2);
      cam.zoom = clamp(zoom * 0.85, 0.15, 4);
      cam.x = -(minX + maxX) / 2 * cam.zoom;
      cam.y = -(minY + maxY) / 2 * cam.zoom;
    });

    // Zoom buttons
    root.querySelector(".om-zoom-in").addEventListener("click", function () {
      cam.zoom = clamp(cam.zoom * 1.25, 0.15, 4);
    });
    root.querySelector(".om-zoom-out").addEventListener("click", function () {
      cam.zoom = clamp(cam.zoom * 0.8, 0.15, 4);
    });

    // Select all / Unselect all
    root.querySelector(".om-sa").addEventListener("click", function () { setAllEdges(true); });
    root.querySelector(".om-ua").addEventListener("click", function () { setAllEdges(false); });

    // Show empty state initially
    graph = { nodes: [], edges: [] };
    rebuildNodeMap();
    rebuildPanel();
    updateStats();

    // Start render loop
    animId = requestAnimationFrame(render);

    // Show empty canvas message
    renderEmptyState(root.querySelector(".om-canvas-wrap"));
  }

  function renderEmptyState(wrap) {
    if (!wrap) return;
    var el = document.createElement("div");
    el.className = "om-empty";
    el.innerHTML =
      '<div class="big-icon">\uD83E\uDDE0</div>' +
      '<div class="msg">OTC Mindmap</div>' +
      '<div class="sub">Search for a condition, symptom, or medication to explore OTC relationships. Try "cold", "headache", or "paracetamol".</div>';
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.zIndex = "5";
    wrap.appendChild(el);

    // Remove on first search
    var origBuild = buildGraph;
    buildGraph = function (id) {
      if (el.parentNode) el.parentNode.removeChild(el);
      buildGraph = origBuild;
      origBuild(id);
    };
  }

  /* ── register ───────────────────────────────────────────────────────── */
  E.registerModule({
    id: "otcmindmap",
    title: "OTC Mindmap",
    icon: "\uD83E\uDDE0",
    order: 71,
    render: renderModule
  });

})();
