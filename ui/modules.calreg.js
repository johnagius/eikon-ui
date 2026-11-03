/* Pharmacy calculators, new layout: dosing plans and supply for one patient. Five calculators, the same as the classic
   screen: levothyroxine alternate dosing, prednisolone/prednisone taper, warfarin variable dosing, insulin supply and
   methotrexate weekly. The maths is the classic screen's, copied unchanged (same inputs give the same plan, the same
   tablets and boxes, the same messages); only the input and output are new. Results update as you type; the tablet
   search runs in a background worker so a slow combination never freezes the screen.
   Save and print is the classic action: one POST /pharmacy-calc/records with the same fields and the same saved plan
   (calc_data_json), then the same printout. Saved plans are listed (GET /pharmacy-calc/records) and can be printed again
   (GET /pharmacy-calc/records/:id). Deleting a saved plan stays in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var CALCS = [["lev", "Levothyroxine"], ["pred", "Steroid taper"], ["war", "Warfarin"], ["ins", "Insulin supply"], ["mtx", "Methotrexate"]];
  var TITLE = { lev: "Levothyroxine alternate dosing", pred: "Prednisolone / prednisone taper", war: "Warfarin variable dosing", ins: "Insulin supply", mtx: "Methotrexate weekly" };
  // the classic records list's names for each calc_type
  var TYPE_LABEL = { lev: "Levothyroxine", pred: "Prednisolone / Prednisone", war: "Warfarin", ins: "Insulin", mtx: "Methotrexate" };
  var DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
  var LEV_MARKET = [25, 50, 75, 100]; // mcg, as the classic screen
  var LEV_BOX_DEFAULTS = { 25: 28, 50: 28, 75: 90, 100: 28 };
  var ALT2_DEFAULTS = { 1: "1", 2: "2", 3: "1", 4: "2", 5: "1", 6: "2", 0: "1" };
  var ALT3_DEFAULTS = { 1: "1", 2: "2", 3: "3", 4: "1", 5: "2", 6: "3", 0: "1" };
  var SPLIT = [["none", "Whole tablets only"], ["halves", "Allow halves (½)"], ["quarters", "Allow halves and quarters (¼)"]];

  var S = { mount: null, calc: "lev", v: null, pat: null, res: null, resJob: 0, job: 0, working: false, slow: false, records: [], patients: [], recLoading: false, recError: "", q: "", open: null, openRec: null, openErr: "", saving: false, err: "", msg: null };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function escHtml(s) { return esc(s); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayYmd() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function low(s) { return String(s || "").toLowerCase(); }

  // ───────────── The classic screen's engine, copied unchanged (modules.pharmacycalc.js) ─────────────
  // Maltese ID: 0-7 digits and a letter, digits padded to 7 (789M -> 0000789M); anything else is kept as typed.
  var MALTA_ID_RE = /^(\d{0,7})([A-Za-z])$/;
  function normaliseMalteseId(raw) {
    var s = String(raw || "").trim();
    var m = MALTA_ID_RE.exec(s);
    if (!m) return s;
    var digits = m[1].padStart(7, "0");
    var letter = m[2].toUpperCase();
    return digits + letter;
  }
  function parseNum(v) {
    if (v == null) return NaN;
    var s = String(v).trim().replace(",", ".");
    if (s === "") return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function parseIntSafe(v, fallback) {
    var n = parseInt(String(v).trim(), 10);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }
  function fmtDate(d) {
    return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  }
  function addDays(dt, days) {
    var d = new Date(dt.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }
  function roundFixed(n, dp) {
    if (!Number.isFinite(n)) return "";
    var f = Math.pow(10, dp);
    return (Math.round(n * f) / f).toFixed(dp);
  }
  function formatStrength(x) {
    var n = Number(x);
    if (!Number.isFinite(n)) return "";
    return roundFixed(n, 2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }
  function normalizeStrengthList(str) {
    return Array.from(new Set(
      String(str || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean)
        .map(function (p) { var n = parseNum(p); return Number.isFinite(n) && n > 0 ? Number(roundFixed(n, 4)) : null; })
        .filter(function (x) { return x !== null; })
    )).sort(function (a, b) { return a - b; });
  }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function generatePieces(strengths, splitting) {
    var pieces = [];
    var allowHalves = splitting === "halves" || splitting === "quarters";
    var allowQuarters = splitting === "quarters";
    strengths.forEach(function (s) {
      pieces.push({ strength: s, value: s, isHalf: false, isQuarter: false });
      if (allowHalves) pieces.push({ strength: s, value: s / 2, isHalf: true, isQuarter: false });
      if (allowQuarters) pieces.push({ strength: s, value: s / 4, isHalf: false, isQuarter: true });
    });
    pieces.sort(function (a, b) { return b.value - a.value; });
    return pieces;
  }
  function buildItemsFromCombo(combo) {
    var map = new Map();
    combo.forEach(function (p) {
      var key = Number(roundFixed(p.strength, 4));
      if (!map.has(key)) map.set(key, { strength: p.strength, wholeCount: 0, halfCount: 0, quarterCount: 0 });
      var obj = map.get(key);
      if (p.isQuarter) obj.quarterCount += 1;
      else if (p.isHalf) obj.halfCount += 1;
      else obj.wholeCount += 1;
    });
    return Array.from(map.values()).sort(function (a, b) { return b.strength - a.strength; });
  }
  function scoreCombo(items) {
    var distinct = items.length;
    var phys = items.reduce(function (acc, it) {
      return acc + it.wholeCount + Math.ceil(it.halfCount / 2) + Math.ceil(it.quarterCount / 4);
    }, 0);
    var splits = items.reduce(function (acc, it) { return acc + it.halfCount + it.quarterCount; }, 0);
    var total = items.reduce(function (acc, it) { return acc + it.wholeCount + it.halfCount + it.quarterCount; }, 0);
    var score = phys * 1000 + distinct * 100 + splits * 20 + total * 5;
    return { score: score };
  }
  function findBestComboExact(target, strengths, splitting, maxPieces) {
    var eps = 1e-6;
    var pieces = generatePieces(strengths, splitting || "none");
    if (Math.abs(target) < eps) return { ok: true, sum: 0, items: [] };
    var best = null;
    function dfs(startIndex, combo, sum) {
      if (combo.length > maxPieces) return;
      if (Math.abs(sum - target) < eps) {
        var items = buildItemsFromCombo(combo);
        var sc = scoreCombo(items);
        if (!best || sc.score < best.scoreDetails.score) {
          best = { ok: true, sum: sum, items: items, scoreDetails: sc };
        }
      }
      if (sum - target > eps) return;
      for (var i = startIndex; i < pieces.length; i++) {
        combo.push(pieces[i]);
        dfs(i, combo, sum + pieces[i].value);
        combo.pop();
      }
    }
    dfs(0, [], 0);
    if (!best) return { ok: false, reason: "No combination found", target: target };
    return best;
  }
  function describeCombo(items, unitLabel) {
    var parts = [];
    items.forEach(function (it) {
      if (it.wholeCount > 0) parts.push(it.wholeCount + " × " + formatStrength(it.strength) + " " + unitLabel);
      if (it.halfCount > 0) {
        var hw = plural(it.halfCount, "half", "halves");
        parts.push(it.halfCount + " " + hw + " of " + formatStrength(it.strength) + " " + unitLabel);
      }
      if (it.quarterCount > 0) {
        parts.push(it.quarterCount + " " + plural(it.quarterCount, "quarter", "quarters") + " of " + formatStrength(it.strength) + " " + unitLabel);
      }
    });
    return parts.length ? parts.join(" + ") : "0";
  }
  function comboToPatientSentence(items) {
    var parts = [];
    items.forEach(function (it) {
      if (it.wholeCount > 0) parts.push((it.wholeCount === 1 ? "1 tablet" : it.wholeCount + " tablets") + " of " + formatStrength(it.strength) + " mg");
      if (it.halfCount > 0) parts.push((it.halfCount === 1 ? "1 half tablet" : it.halfCount + " halves") + " of " + formatStrength(it.strength) + " mg");
      if (it.quarterCount > 0) parts.push((it.quarterCount === 1 ? "1 quarter tablet" : it.quarterCount + " quarters") + " of " + formatStrength(it.strength) + " mg");
    });
    if (!parts.length) return "no tablets";
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }
  // The same tablet search for the same dose is asked once per calculation (warfarin asks it for every day).
  var MEMO = null;
  function combo(target, strengths, splitting, maxPieces) {
    if (!MEMO) return findBestComboExact(target, strengths, splitting, maxPieces);
    var k = target + "|" + strengths.join(",") + "|" + splitting + "|" + maxPieces;
    if (!MEMO.has(k)) MEMO.set(k, findBestComboExact(target, strengths, splitting, maxPieces));
    return MEMO.get(k);
  }
  function startOf(sd) {
    if (!sd || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) return null;
    return new Date(sd + "T00:00:00");
  }

  // Each calculator: the classic doCalc, with the form fields read from v and the result returned
  // ({ error } with the classic message, or { model } exactly as the classic saves it).
  function calcLev(v) {
    var weeks = parseIntSafe(v.weeks, 0);
    if (weeks <= 0) return { error: "Enter a valid number of weeks." };
    var mode = v.mode;
    var d1 = parseNum(v.d1);
    if (!Number.isFinite(d1) || d1 <= 0) return { error: "Enter a valid Dose 1 value." };
    var prescribedDoses = [{ idx: 1, mcg: d1 }];
    if (mode !== "single") {
      var d2 = parseNum(v.d2);
      if (!Number.isFinite(d2) || d2 <= 0) return { error: "Enter a valid Dose 2 value." };
      prescribedDoses.push({ idx: 2, mcg: d2 });
    }
    if (mode === "alt3") {
      var d3raw = String(v.d3 == null ? "" : v.d3).trim(), d3 = d3raw ? parseNum(d3raw) : NaN;
      if (!Number.isFinite(d3) || d3 <= 0) return { error: "Enter a valid Dose 3 value for alternating 3-dose mode." };
      prescribedDoses.push({ idx: 3, mcg: d3 });
    }
    var startDate = startOf(v.startDate);
    if (!startDate) return { error: "Enter a valid start date." };
    var splitting = v.split;
    var doseResolutions = {};
    for (var pi = 0; pi < prescribedDoses.length; pi++) {
      var pd = prescribedDoses[pi];
      var cb = combo(pd.mcg, LEV_MARKET, splitting, 16);
      if (!cb.ok) return { error: "Cannot represent " + pd.mcg + " mcg/day with available market strengths (25, 50, 75, 100 mcg)" + (splitting === "none" ? ". Try allowing halves or quarters." : ".") };
      doseResolutions[pd.idx] = { mcg: pd.mcg, combo: cb };
    }
    var daysTotal = weeks * 7;
    var schedule = [];
    var marketTotals = {};
    LEV_MARKET.forEach(function (s) { marketTotals[s] = { strength: s, wholeCount: 0, halfCount: 0, quarterCount: 0 }; });
    for (var i = 0; i < daysTotal; i++) {
      var date = addDays(startDate, i);
      var dow = date.getDay();
      var which;
      if (mode === "single") {
        which = 1;
      } else {
        which = parseIntSafe((v.days && v.days[dow]) || "1", 1);
        if (which > prescribedDoses.length) which = 1;
      }
      var res = doseResolutions[which] || doseResolutions[1];
      res.combo.items.forEach(function (it) {
        marketTotals[it.strength].wholeCount += it.wholeCount;
        marketTotals[it.strength].halfCount += it.halfCount;
        marketTotals[it.strength].quarterCount += (it.quarterCount || 0);
      });
      schedule.push({ date: date, dow: dow, doseIdx: which, mcg: res.mcg, comboItems: res.combo.items });
    }
    var dispensing = LEV_MARKET.map(function (s) {
      var mt = marketTotals[s];
      var wholes = mt.wholeCount;
      var halves = mt.halfCount;
      var quarters = mt.quarterCount;
      var physicalTablets = wholes + Math.ceil(halves / 2) + Math.ceil(quarters / 4);
      if (physicalTablets === 0) return null;
      var boxSize = clamp(parseIntSafe(v.box[s], parseIntSafe(v.boxDef, 30)), 1, 999999);
      var boxes = Math.ceil(physicalTablets / boxSize);
      return { strength: s, wholes: wholes, halves: halves, quarters: quarters, physicalTablets: physicalTablets, boxSize: boxSize, boxes: boxes, extra: boxes * boxSize - physicalTablets };
    }).filter(function (x) { return x !== null; });
    return { model: { startDate: startDate, weeks: weeks, prescribedDoses: prescribedDoses, doseResolutions: doseResolutions, schedule: schedule, dispensing: dispensing } };
  }

  function calcPred(v) {
    var startDate = startOf(v.startDate);
    if (!startDate) return { error: "Enter a valid start date." };
    var drug = v.drug || "Prednisolone";
    var steps = (v.steps || []).map(function (node) {
      return { doseMg: parseNum(node.dose), days: parseIntSafe(node.days, 0), note: String(node.note == null ? "" : node.note).trim() };
    });
    if (!steps.length) return { error: "Add at least one taper step." };
    for (var i = 0; i < steps.length; i++) {
      if (!Number.isFinite(steps[i].doseMg) || steps[i].doseMg < 0) return { error: "Step " + (i + 1) + " dose is invalid." };
      if (!Number.isFinite(steps[i].days) || steps[i].days <= 0) return { error: "Step " + (i + 1) + " days must be positive." };
    }
    var splitting = v.split;
    var policy = v.policy;
    var maxTabs = clamp(parseIntSafe(v.maxTabs, 12), 1, 50);
    var strengths = normalizeStrengthList(v.strengths);
    if (policy === "only5") strengths = [5];
    if (policy === "only20_5") strengths = [5, 20];
    if (!strengths.length) return { error: "Enter at least one tablet strength." };
    var stepPlans = [], totals = {};
    strengths.forEach(function (s) { totals[Number(roundFixed(s, 4))] = { strength: s, wholePieces: 0, halfPieces: 0, quarterPieces: 0 }; });
    var cursor = new Date(startDate.getTime());
    for (var si = 0; si < steps.length; si++) {
      var st = steps[si];
      var cb = (st.doseMg === 0) ? { ok: true, sum: 0, items: [] } : combo(st.doseMg, strengths, splitting, maxTabs);
      if (!cb.ok) return { error: "Cannot represent " + st.doseMg + " mg/day with given strengths. Try allowing halves/quarters or adjusting strengths." };
      cb.items.forEach(function (it) {
        var key = Number(roundFixed(it.strength, 4));
        if (!totals[key]) totals[key] = { strength: it.strength, wholePieces: 0, halfPieces: 0, quarterPieces: 0 };
        totals[key].wholePieces += it.wholeCount * st.days;
        totals[key].halfPieces += it.halfCount * st.days;
        totals[key].quarterPieces += (it.quarterCount || 0) * st.days;
      });
      var stepStart = new Date(cursor.getTime());
      var stepEnd = addDays(stepStart, st.days - 1);
      cursor = addDays(stepEnd, 1);
      stepPlans.push({ stepNumber: si + 1, doseMg: st.doseMg, days: st.days, note: st.note, start: stepStart, end: stepEnd, comboItems: cb.items });
    }
    var totalRows = Object.values(totals).filter(function (x) { return x.wholePieces + x.halfPieces + x.quarterPieces > 0; })
      .sort(function (a, b) { return b.strength - a.strength; })
      .map(function (x) {
        return { strength: x.strength, wholePieces: x.wholePieces, halfPieces: x.halfPieces, quarterPieces: x.quarterPieces, tabletsToDispense: x.wholePieces + Math.ceil(x.halfPieces / 2) + Math.ceil(x.quarterPieces / 4) };
      });
    var tabsPerBox = clamp(parseIntSafe(v.tabsPerBox, 30), 1, 999999);
    var roundBoxes = v.roundBoxes === "yes";
    var totalAll = totalRows.reduce(function (a, r) { return a + r.tabletsToDispense; }, 0);
    var boxes = roundBoxes ? Math.ceil(totalAll / tabsPerBox) : null;
    return { model: { drug: drug, startDate: startDate, strengths: strengths, splitting: splitting, stepPlans: stepPlans, totalRows: totalRows, tabsPerBox: tabsPerBox, roundBoxes: roundBoxes, totalDispensedTabsAll: totalAll, boxes: boxes } };
  }

  function calcWar(v) {
    var startDate = startOf(v.startDate);
    if (!startDate) return { error: "Enter a valid start date." };
    var weeks = parseIntSafe(v.weeks, 0);
    if (weeks <= 0) return { error: "Enter a valid number of weeks." };
    var strengths = normalizeStrengthList(v.strengths);
    if (!strengths.length) return { error: "Enter at least one tablet strength." };
    var splitting = v.split;
    var maxTabs = clamp(parseIntSafe(v.maxTabs, 8), 1, 30);
    var daysTotal = weeks * 7;
    var getDayDose;
    var mode = v.mode;
    if (mode === "weekly") {
      var dosesByDow = {};
      [0, 1, 2, 3, 4, 5, 6].forEach(function (d) { dosesByDow[d] = parseNum(v.days[d]); });
      getDayDose = function (i) { var dt = addDays(startDate, i); return { date: dt, dow: dt.getDay(), doseMg: dosesByDow[dt.getDay()] }; };
    } else {
      var cycle = String(v.cycle || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean)
        .map(function (p) { var n = parseNum(p); return Number.isFinite(n) && n >= 0 ? n : null; }).filter(function (x) { return x !== null; });
      if (!cycle.length) return { error: "Cycle pattern is empty. Enter doses like 5,2.5." };
      getDayDose = function (i) { var dt = addDays(startDate, i); return { date: dt, dow: dt.getDay(), doseMg: cycle[i % cycle.length] }; };
    }
    var schedule = [];
    var totals = {};
    strengths.forEach(function (s) { totals[Number(roundFixed(s, 4))] = { strength: s, wholePieces: 0, halfPieces: 0, quarterPieces: 0 }; });
    for (var i = 0; i < daysTotal; i++) {
      var day = getDayDose(i);
      if (!Number.isFinite(day.doseMg) || day.doseMg < 0) return { error: "Invalid dose on " + fmtDate(day.date) };
      var cb = day.doseMg === 0 ? { ok: true, sum: 0, items: [] } : combo(day.doseMg, strengths, splitting, maxTabs);
      if (!cb.ok) return { error: "Cannot represent " + day.doseMg + " mg on " + fmtDate(day.date) + " with given strengths." };
      cb.items.forEach(function (it) {
        var key = Number(roundFixed(it.strength, 4));
        if (!totals[key]) totals[key] = { strength: it.strength, wholePieces: 0, halfPieces: 0, quarterPieces: 0 };
        totals[key].wholePieces += it.wholeCount;
        totals[key].halfPieces += it.halfCount;
        totals[key].quarterPieces += (it.quarterCount || 0);
      });
      schedule.push({ date: day.date, dow: day.dow, doseMg: day.doseMg, items: cb.items });
    }
    var packData = v.pack || {};
    var dispByStrength = Object.values(totals).filter(function (x) { return x.wholePieces + x.halfPieces + x.quarterPieces > 0; })
      .sort(function (a, b) { return b.strength - a.strength; })
      .map(function (x) {
        var tabletsDispense = x.wholePieces + Math.ceil(x.halfPieces / 2) + Math.ceil(x.quarterPieces / 4);
        var key = String(roundFixed(x.strength, 4));
        var pack = packData[key] || { tabsPerSheet: 14, sheetsPerBox: 2 };
        var tps = clamp(parseIntSafe(pack.tabsPerSheet, 14), 1, 999999);
        var spb = clamp(parseIntSafe(pack.sheetsPerBox, 2), 1, 999999);
        var sheets = Math.ceil(tabletsDispense / tps);
        var boxes = Math.ceil(sheets / spb);
        return { strength: x.strength, wholePieces: x.wholePieces, halfPieces: x.halfPieces, quarterPieces: x.quarterPieces, tabletsDispense: tabletsDispense, tabsPerSheet: tps, sheetsPerBox: spb, sheetsNeeded: sheets, boxesNeeded: boxes };
      });
    return { model: { startDate: startDate, weeks: weeks, daysTotal: daysTotal, schedule: schedule, dispByStrength: dispByStrength } };
  }

  function calcIns(v) {
    var startDate = startOf(v.startDate);
    if (!startDate) return { error: "Enter a valid start date." };
    var weeks = parseIntSafe(v.weeks, 0);
    if (weeks <= 0) return { error: "Enter a valid number of weeks." };
    var daysTotal = weeks * 7;
    var doses = { morning: parseNum(v.morning), afternoon: parseNum(v.afternoon), evening: parseNum(v.evening), night: parseNum(v.night) };
    for (var k in doses) { if (!Number.isFinite(doses[k]) || doses[k] < 0) return { error: "All dose fields must be valid non-negative numbers." }; }
    var dailyUnits = doses.morning + doses.afternoon + doses.evening + doses.night;
    var injectionsPerDay = [doses.morning, doses.afternoon, doses.evening, doses.night].filter(function (x) { return x > 0; }).length;
    var type = v.type;
    var unitsPerContainer = parseIntSafe(v.unitsPerCont, 0);
    if (unitsPerContainer <= 0) return { error: "Units per container must be positive." };
    var containersPerBox = parseIntSafe(v.contsPerBox, 0);
    if (containersPerBox <= 0) return { error: "Containers per box must be positive." };
    var includePriming = v.priming === "yes";
    var primeUnits = parseNum(v.primeUnits);
    var includeDiscard = v.discard === "yes";
    var discardDays = parseIntSafe(v.discardDays, 0);
    var roundToBoxes = v.roundBoxes === "yes";
    var dailyPriming = includePriming ? primeUnits * injectionsPerDay : 0;
    var dailyTotalUsed = dailyUnits + dailyPriming;
    var totalUnitsNeededNoWaste = dailyUnits * daysTotal;
    var totalPrimingUnits = dailyPriming * daysTotal;
    var containersUsed = 0, wastedFromDiscard = 0, remaining = 0, openedDayIndex = 0;
    function openNew(dayIdx) { containersUsed++; remaining = unitsPerContainer; openedDayIndex = dayIdx; }
    if (dailyTotalUsed > 0) openNew(0);
    for (var day = 0; day < daysTotal && dailyTotalUsed > 0; day++) {
      if (includeDiscard && (day - openedDayIndex) >= discardDays) { wastedFromDiscard += remaining; openNew(day); }
      var need = dailyTotalUsed;
      while (need > 0) {
        if (need <= remaining) { remaining -= need; need = 0; }
        else { need -= remaining; remaining = 0; openNew(day); }
      }
    }
    if (includeDiscard && dailyTotalUsed > 0 && (daysTotal - openedDayIndex) >= discardDays) {
      wastedFromDiscard += remaining;
      remaining = 0;
    }
    var boxesNeeded = roundToBoxes ? Math.ceil(containersUsed / containersPerBox) : null;
    return { model: { startDate: startDate, weeks: weeks, daysTotal: daysTotal, doses: doses, dailyUnits: dailyUnits, injectionsPerDay: injectionsPerDay, type: type, unitsPerContainer: unitsPerContainer, containersPerBox: containersPerBox, includePriming: includePriming, primeUnits: primeUnits, includeDiscard: includeDiscard, discardDays: discardDays, dailyPriming: dailyPriming, dailyTotalUsed: dailyTotalUsed, totalUnitsNeededNoWaste: totalUnitsNeededNoWaste, totalPrimingUnits: totalPrimingUnits, containersUsed: containersUsed, wastedFromDiscard: wastedFromDiscard, leftoverUnitsAtEnd: remaining, roundToBoxes: roundToBoxes, boxesNeeded: boxesNeeded } };
  }

  function nextOrSameWeekday(startDate, targetDow) {
    var d = new Date(startDate.getTime());
    var diff = (targetDow - d.getDay() + 7) % 7;
    return addDays(d, diff);
  }
  function calcMtx(v) {
    var startDate = startOf(v.startDate);
    if (!startDate) return { error: "Enter a valid start date." };
    var weeks = parseIntSafe(v.weeks, 0);
    if (weeks <= 0) return { error: "Enter a valid number of weeks." };
    var weeklyDose = parseNum(v.weeklyDose);
    if (!Number.isFinite(weeklyDose) || weeklyDose <= 0) return { error: "Weekly dose must be a positive number." };
    var tabletStrength = parseNum(v.strength);
    if (!Number.isFinite(tabletStrength) || tabletStrength <= 0) return { error: "Tablet strength must be a positive number." };
    var allowHalves = v.split !== "no";
    var allowQuarters = v.split === "quarters";
    var tabsPerBox = clamp(parseIntSafe(v.tabsPerBox, 30), 1, 999999);
    var roundToBoxes = v.roundBoxes === "yes";
    var targetDow = parseIntSafe(v.weekday, 0);
    var firstDoseDate = nextOrSameWeekday(startDate, targetDow);
    var eps = 1e-9;
    var exactTabs = weeklyDose / tabletStrength;
    var isInteger = Math.abs(exactTabs - Math.round(exactTabs)) < eps;
    var isHalfInteger = Math.abs(exactTabs * 2 - Math.round(exactTabs * 2)) < eps;
    var isQuarterInteger = Math.abs(exactTabs * 4 - Math.round(exactTabs * 4)) < eps;
    var canRepresent = isInteger || (allowHalves && isHalfInteger) || (allowQuarters && isQuarterInteger);
    if (!canRepresent) return { error: "Weekly dose " + formatStrength(weeklyDose) + " mg cannot be represented by " + formatStrength(tabletStrength) + " mg tablets (try enabling halves or quarters)." };
    var wholeTabsPerDose = Math.floor(exactTabs);
    var remainder = exactTabs - wholeTabsPerDose;
    var halfPieceNeeded = (!isInteger && allowHalves && Math.abs(remainder - 0.5) < eps) ? 1 : 0;
    var quarterPieceNeeded = (!isInteger && !halfPieceNeeded && allowQuarters && isQuarterInteger) ? Math.round(remainder * 4) : 0;
    var tabsDispensePerDose = wholeTabsPerDose + (halfPieceNeeded ? 1 : 0) + (quarterPieceNeeded >= 4 ? Math.floor(quarterPieceNeeded / 4) : quarterPieceNeeded > 0 ? 1 : 0);
    var schedule = [];
    for (var i = 0; i < weeks; i++) schedule.push({ doseDate: addDays(firstDoseDate, i * 7), wholeTabs: wholeTabsPerDose, halfPieces: halfPieceNeeded, quarterPieces: quarterPieceNeeded, tabsDispense: tabsDispensePerDose });
    var totalWholeTabsUsed = wholeTabsPerDose * weeks;
    var totalHalfPiecesUsed = halfPieceNeeded * weeks;
    var totalQuarterPiecesUsed = quarterPieceNeeded * weeks;
    var totalTabsToDispense = totalWholeTabsUsed + Math.ceil(totalHalfPiecesUsed / 2) + Math.ceil(totalQuarterPiecesUsed / 4);
    var boxes = roundToBoxes ? Math.ceil(totalTabsToDispense / tabsPerBox) : null;
    return { model: { startDate: startDate, firstDoseDate: firstDoseDate, weeks: weeks, weeklyDose: weeklyDose, tabletStrength: tabletStrength, tabsPerBox: tabsPerBox, roundToBoxes: roundToBoxes, schedule: schedule, totalWholeTabsUsed: totalWholeTabsUsed, totalHalfPiecesUsed: totalHalfPiecesUsed, totalQuarterPiecesUsed: totalQuarterPiecesUsed, totalTabsToDispense: totalTabsToDispense, boxes: boxes } };
  }

  var RUN = { lev: calcLev, pred: calcPred, war: calcWar, ins: calcIns, mtx: calcMtx };
  function runCalc(id, v) { MEMO = new Map(); try { return RUN[id](v); } finally { MEMO = null; } }

  // The same functions, run in a background worker (built from their own source, so there is one copy of the maths).
  var WORKER_SRC = null;
  function workerSource() {
    if (WORKER_SRC) return WORKER_SRC;
    var fns = [parseNum, parseIntSafe, clamp, fmtDate, addDays, roundFixed, formatStrength, normalizeStrengthList, generatePieces, buildItemsFromCombo, scoreCombo, findBestComboExact, combo, startOf,
      calcLev, calcPred, calcWar, calcIns, nextOrSameWeekday, calcMtx, runCalc];
    WORKER_SRC = '"use strict";var LEV_MARKET=' + JSON.stringify(LEV_MARKET) + ";var MEMO=null;\n" + fns.map(String).join("\n") +
      "\nvar RUN={lev:calcLev,pred:calcPred,war:calcWar,ins:calcIns,mtx:calcMtx};\n" +
      'self.onmessage=function(e){var d=e.data,r;try{r=runCalc(d.calc,d.v);}catch(x){r={error:"Could not work this out: "+String((x&&x.message)||x)};}self.postMessage({id:d.id,r:r});};';
    return WORKER_SRC;
  }
  var W = { w: null, url: null, busy: false, broken: false };
  function worker() {
    if (W.broken) return null;
    if (W.w) return W.w;
    try {
      if (!W.url) W.url = URL.createObjectURL(new Blob([workerSource()], { type: "application/javascript" }));
      W.w = new Worker(W.url);
      W.w.onmessage = function (e) { W.busy = false; done(e.data.id, e.data.r); };
      W.w.onerror = function () { W.busy = false; try { W.w.terminate(); } catch (x) {} W.w = null; W.broken = true; compute(); };
      return W.w;
    } catch (e) { W.broken = true; return null; }
  }

  // ───────────── Printing: the classic screen's printouts, unchanged ─────────────
  var _lastPrintAt = 0;
  function openPrintTabWithHtml(html) {
    var now = Date.now();
    if (now - _lastPrintAt < 900) return;
    _lastPrintAt = now;
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    try {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e1) {
      try { window.open(url, "_blank"); } catch (e2) {}
    }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
  function buildPrintHtml(title, meta, innerHtml) {
    var pName = meta.patientName || "____________________";
    var pId = meta.idCard || "____________________";
    var pharmName = meta.pharmacyName || "____________________";
    var note = meta.note ? "<div><b>Note:</b> " + escHtml(meta.note) + "</div>" : "";
    return "<!doctype html>\n<html>\n<head>\n<meta charset='utf-8'/>\n<meta name='viewport' content='width=device-width,initial-scale=1'/>\n<title>" + escHtml(title) + "</title>\n<style>\n@page{size:A4;margin:14mm;}\nbody{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;color:#000;}\n.sheet{padding:12px;}\n.ph{border-bottom:3px solid #000;padding-bottom:10px;margin-bottom:14px;}\n.ph h1{font-size:18px;margin:0;}\n.pmeta{margin-top:8px;font-size:12px;line-height:1.4;}\n.pline{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;}\n.pline div{border:2px solid #000;padding:5px 8px;border-radius:8px;font-weight:800;}\ntable{width:100%;border-collapse:collapse;margin:8px 0;page-break-inside:avoid;}\nth,td{border:2px solid #000;padding:7px 8px;font-size:12px;vertical-align:top;}\nth{font-weight:900;text-align:left;}\n.bt{font-weight:900;font-size:13px;margin:14px 0 8px;text-transform:uppercase;letter-spacing:0.6px;}\n.warn{border:3px solid #000;padding:10px;border-radius:12px;font-weight:900;font-size:13px;margin:12px 0;}\n.bigwarn{border:4px solid #000;padding:10px;border-radius:12px;font-weight:900;font-size:14px;margin:12px 0;}\n</style>\n</head>\n<body>\n<div class='sheet'>\n<div class='ph'>\n<h1>" + escHtml(title) + "</h1>\n<div class='pmeta'>\n<div class='pline'><div>Pharmacy: " + escHtml(pharmName) + "</div></div>\n<div class='pline'><div>Patient: " + escHtml(pName) + "</div><div>ID: " + escHtml(pId) + "</div></div>\n" + (note ? "<div style='margin-top:8px;'>" + note + "</div>" : "") + "\n</div></div>\n" + innerHtml + "\n</div>\n<script>\nwindow.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){}try{window.print();}catch(e){}},80);});\nwindow.addEventListener('afterprint',function(){setTimeout(function(){try{window.close();}catch(e){}},250);});\n</scr" + "ipt>\n</body></html>";
  }
  function levParts(x) {
    return x.comboItems.map(function (it) {
      var s = "";
      if (it.wholeCount) s += it.wholeCount + "× " + formatStrength(it.strength) + " mcg";
      if (it.halfCount) s += (s ? ", " : "") + it.halfCount + "× ½ of " + formatStrength(it.strength) + " mcg";
      if (it.quarterCount) s += (s ? ", " : "") + it.quarterCount + "× ¼ of " + formatStrength(it.strength) + " mcg";
      return s;
    }).join(" + ") || "0 mcg";
  }
  var PRINT = {
    lev: function (m, meta) {
      var resHtml = m.prescribedDoses.map(function (pd) {
        var res = m.doseResolutions[pd.idx];
        return "<tr><td><b>Dose " + pd.idx + ": " + formatStrength(pd.mcg) + " mcg</b></td><td>" + escHtml(describeCombo(res.combo.items, "mcg")) + "</td></tr>";
      }).join("");
      var dispRows = m.dispensing.map(function (d) {
        var splitInfo = "";
        if (d.halves) splitInfo += " + " + d.halves + " halves";
        if (d.quarters) splitInfo += " + " + d.quarters + " quarters";
        return "<tr><td><b>" + formatStrength(d.strength) + " mcg</b></td><td>" + d.wholes + splitInfo + "</td><td>" + d.physicalTablets + "</td><td>" + d.boxSize + "</td><td>" + d.boxes + "</td></tr>";
      }).join("");
      var schedRows = m.schedule.map(function (x) {
        return "<tr><td>" + fmtDate(x.date) + "</td><td>" + DOW[x.dow] + "</td><td><b>" + formatStrength(x.mcg) + " mcg</b></td><td>" + escHtml(levParts(x)) + "</td></tr>";
      }).join("");
      var inner = "<div class='bt'>Prescription → Combination</div>" +
        "<table><thead><tr><th>Prescribed Dose</th><th>Tablets to use</th></tr></thead><tbody>" + resHtml + "</tbody></table>" +
        "<div class='bt'>Market Strength Dispensing</div>" +
        "<table><thead><tr><th>Strength</th><th>Pieces needed</th><th>Physical tabs</th><th>Tabs/box</th><th>Boxes</th></tr></thead><tbody>" + dispRows + "</tbody></table>" +
        "<div class='bt'>Daily Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Prescribed</th><th>Tablets to take</th></tr></thead><tbody>" + schedRows + "</tbody></table>";
      return buildPrintHtml("Levothyroxine Dosing Plan", meta, inner);
    },
    pred: function (m, meta) {
      var stepRowsHtml = m.stepPlans.map(function (sp) {
        var comboText = sp.comboItems.length === 0 ? "<b>Stop (0 mg)</b>" : "<b>Take once daily:</b> " + describeCombo(sp.comboItems, "mg");
        var noteHtml = sp.note ? "<div><b>Note:</b> " + escHtml(sp.note) + "</div>" : "";
        return "<tr><td><b>Step " + sp.stepNumber + "</b></td><td>" + fmtDate(sp.start) + " → " + fmtDate(sp.end) + " (" + sp.days + " days)</td><td><b>" + formatStrength(sp.doseMg) + " mg/day</b><br>" + comboText + noteHtml + "</td></tr>";
      }).join("");
      var totHtml = m.totalRows.map(function (r) {
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + r.halfPieces + "</td><td><b>" + r.tabletsToDispense + "</b></td></tr>";
      }).join("") || "<tr><td colspan='4'>No tablets required.</td></tr>";
      var boxLine = m.roundBoxes ? "<div><b>Box rounding:</b> " + m.totalDispensedTabsAll + " total → " + m.boxes + " " + plural(m.boxes, "box", "boxes") + " (" + m.tabsPerBox + " per box)</div>" : "";
      var inner = "<div class='bt'>Taper Schedule</div>" +
        "<table><thead><tr><th>Step</th><th>Date range</th><th>Daily instruction</th></tr></thead><tbody>" + stepRowsHtml + "</tbody></table>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Strength</th><th>Whole tablets</th><th>Half pieces</th><th>To dispense</th></tr></thead><tbody>" + totHtml + "</tbody></table>" + boxLine;
      return buildPrintHtml(m.drug + " Taper Plan", meta, inner);
    },
    war: function (m, meta) {
      var dispRows = m.dispByStrength.map(function (r) {
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + r.halfPieces + "</td><td><b>" + r.tabletsDispense + "</b></td><td>" + r.tabsPerSheet + "</td><td>" + r.sheetsNeeded + "</td><td>" + r.sheetsPerBox + "</td><td><b>" + r.boxesNeeded + "</b></td></tr>";
      }).join("") || "<tr><td colspan='8'>No tablets required.</td></tr>";
      var schedRows = m.schedule.map(function (x) {
        var inst = x.items.length === 0 ? "<b>0 mg — no tablets</b>" : "<b>" + comboToPatientSentence(x.items) + "</b>";
        return "<tr><td>" + fmtDate(x.date) + "</td><td>" + DOW[x.dow] + "</td><td><b>" + formatStrength(x.doseMg) + " mg</b></td><td>" + inst + "</td></tr>";
      }).join("");
      var inner = "<div class='warn'>WARFARIN SAFETY NOTE: Follow this schedule exactly unless prescriber/INR clinic changes it. If dose changes, update this plan.</div>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Strength</th><th>Whole tabs</th><th>Half pieces</th><th>To dispense</th><th>Tabs/sheet</th><th>Sheets needed</th><th>Sheets/box</th><th>Boxes</th></tr></thead><tbody>" + dispRows + "</tbody></table>" +
        "<div class='bt'>Patient Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets to take</th></tr></thead><tbody>" + schedRows + "</tbody></table>";
      return buildPrintHtml("Warfarin Dosing Plan (Variable Schedule)", meta, inner);
    },
    ins: function (m, meta) {
      var typeLabel = m.type === "pen" ? "Cartridge/Pen" : "Vial";
      var primingText = m.includePriming ? "Priming included: " + formatStrength(m.primeUnits) + " units/injection × " + m.injectionsPerDay + " injection(s)/day = " + formatStrength(m.dailyPriming) + " units/day." : "Priming not included.";
      var discardText = m.includeDiscard ? "Discard rule: discard after " + m.discardDays + " days from first use." : "Discard rule not included.";
      var boxLine = m.roundToBoxes ? "<tr><td>Boxes to dispense</td><td><b>" + m.boxesNeeded + "</b> (" + m.containersPerBox + " per box)</td></tr>" : "";
      var inner = "<div class='bt'>Daily Dose</div>" +
        "<table><thead><tr><th>Time</th><th>Units</th></tr></thead><tbody>" +
        "<tr><td>Morning</td><td><b>" + formatStrength(m.doses.morning) + " units</b></td></tr>" +
        "<tr><td>Afternoon</td><td><b>" + formatStrength(m.doses.afternoon) + " units</b></td></tr>" +
        "<tr><td>Evening</td><td><b>" + formatStrength(m.doses.evening) + " units</b></td></tr>" +
        "<tr><td>Night</td><td><b>" + formatStrength(m.doses.night) + " units</b></td></tr>" +
        "<tr><td><b>Total/day</b></td><td><b>" + formatStrength(m.dailyUnits) + " units</b></td></tr>" +
        "</tbody></table>" +
        "<div class='bt'>Supply Summary</div>" +
        "<div class='warn'>" + escHtml(primingText) + "<br>" + escHtml(discardText) + "</div>" +
        "<table><tbody>" +
        "<tr><td>Container type</td><td><b>" + typeLabel + "</b></td></tr>" +
        "<tr><td>Units per container</td><td><b>" + m.unitsPerContainer + " units</b></td></tr>" +
        "<tr><td>Estimated containers</td><td><b>" + m.containersUsed + "</b></td></tr>" + boxLine +
        "<tr><td>Units needed (dose only)</td><td><b>" + formatStrength(m.totalUnitsNeededNoWaste) + " units</b></td></tr>" +
        "<tr><td>Units for priming</td><td><b>" + formatStrength(m.totalPrimingUnits) + " units</b></td></tr>" +
        "<tr><td>Units wasted (discard)</td><td><b>" + formatStrength(m.wastedFromDiscard) + " units</b></td></tr>" +
        "<tr><td>Leftover at end</td><td><b>" + formatStrength(m.leftoverUnitsAtEnd) + " units</b></td></tr>" +
        "</tbody></table>";
      return buildPrintHtml("Insulin Daily Dose + Supply Plan", meta, inner);
    },
    mtx: function (m, meta) {
      var rows = m.schedule.map(function (s) {
        var dt = []; if (s.wholeTabs > 0) dt.push(s.wholeTabs + " tablet(s)"); if (s.halfPieces > 0) dt.push("+ ½ tablet"); if (s.quarterPieces > 0) dt.push("+ ¼ tablet");
        return "<tr><td>" + fmtDate(s.doseDate) + "</td><td>" + DOW[s.doseDate.getDay()] + "</td><td><b>" + formatStrength(m.weeklyDose) + " mg</b></td><td><b>" + (dt.join(" ") || "0") + "</b> of " + formatStrength(m.tabletStrength) + " mg</td></tr>";
      }).join("");
      var boxLine = m.roundToBoxes ? "<div><b>Dispense:</b> " + m.totalTabsToDispense + " tablets → " + m.boxes + " " + plural(m.boxes, "box", "boxes") + " (" + m.tabsPerBox + " per box)</div>" : "<div><b>Dispense:</b> " + m.totalTabsToDispense + " tablets exact</div>";
      var inner = "<div class='bigwarn'>TAKE ONCE WEEKLY ONLY — NOT DAILY</div>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Weekly dose</th><th>Tablet strength</th><th>First dose</th><th>Duration</th></tr></thead><tbody><tr><td><b>" + formatStrength(m.weeklyDose) + " mg</b></td><td><b>" + formatStrength(m.tabletStrength) + " mg</b></td><td><b>" + fmtDate(m.firstDoseDate) + " (" + DOW[m.firstDoseDate.getDay()] + ")</b></td><td><b>" + m.weeks + " week(s)</b></td></tr></tbody></table>" +
        boxLine +
        "<div class='bt'>Weekly Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets to take</th></tr></thead><tbody>" + rows + "</tbody></table>";
      return buildPrintHtml("Methotrexate Weekly Dosing Plan", meta, inner);
    }
  };
  // A saved plan printed again: the classic reprintRecord, unchanged (it works from the saved JSON, where dates are text).
  function reprintHtml(rec, data) {
    var user = (E.state && E.state.user) ? E.state.user : null;
    var meta = { pharmacyName: (user && user.location_name) || (user && user.org_name) || "", patientName: rec.patient_name || "", idCard: rec.id_card || "", note: rec.note || "" };
    var ct = rec.calc_type;
    var inner = "";
    function d(iso) { return iso ? fmtDate(new Date(iso)) : "—"; }
    if (ct === "pred") {
      var stepRows = (data.stepPlans || []).map(function (sp) {
        var comboText = (sp.comboItems && sp.comboItems.length) ? ("<b>Take once daily:</b> " + describeCombo(sp.comboItems, "mg")) : "<b>Stop (0 mg)</b>";
        var noteHtml = sp.note ? "<div><b>Note:</b> " + escHtml(sp.note) + "</div>" : "";
        return "<tr><td><b>Step " + sp.stepNumber + "</b></td><td>" + d(sp.start) + " → " + d(sp.end) + " (" + sp.days + " days)</td><td><b>" + formatStrength(sp.doseMg) + " mg/day</b><br>" + comboText + noteHtml + "</td></tr>";
      }).join("");
      var totRows = (data.totalRows || []).map(function (r) {
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + r.halfPieces + "</td><td><b>" + r.tabletsToDispense + "</b></td></tr>";
      }).join("") || "<tr><td colspan='4'>No tablets required.</td></tr>";
      var boxLine = data.roundBoxes ? "<div><b>Box rounding:</b> " + data.totalDispensedTabsAll + " total → " + data.boxes + " box(es) (" + data.tabsPerBox + " per box)</div>" : "";
      inner = "<div class='bt'>Taper Schedule</div>" +
        "<table><thead><tr><th>Step</th><th>Date range</th><th>Daily instruction</th></tr></thead><tbody>" + stepRows + "</tbody></table>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Strength</th><th>Whole tabs</th><th>Half pieces</th><th>To dispense</th></tr></thead><tbody>" + totRows + "</tbody></table>" + boxLine;
      return buildPrintHtml((data.drug || "Prednisolone") + " Taper Plan", meta, inner);
    } else if (ct === "lev") {
      var resRows = (data.prescribedDoses || []).map(function (pd) {
        var res = data.doseResolutions && data.doseResolutions[pd.idx];
        var cmb = res ? describeCombo(res.combo.items, "mcg") : "—";
        return "<tr><td><b>Dose " + pd.idx + ": " + formatStrength(pd.mcg) + " mcg</b></td><td>" + escHtml(cmb) + "</td></tr>";
      }).join("");
      var dispRows = (data.dispensing || []).map(function (d2) {
        var si = ""; if (d2.halves) si += " + " + d2.halves + " halves"; if (d2.quarters) si += " + " + d2.quarters + " quarters";
        return "<tr><td><b>" + formatStrength(d2.strength) + " mcg</b></td><td>" + d2.wholes + si + "</td><td>" + d2.physicalTablets + "</td><td>" + d2.boxSize + "</td><td>" + d2.boxes + "</td></tr>";
      }).join("");
      var schedRows = (data.schedule || []).map(function (x) {
        var inst = (x.comboItems || []).map(function (it) {
          var s = ""; if (it.wholeCount) s += it.wholeCount + "× " + formatStrength(it.strength) + " mcg"; if (it.halfCount) s += (s ? ", " : "") + it.halfCount + "× ½ of " + formatStrength(it.strength) + " mcg"; if (it.quarterCount) s += (s ? ", " : "") + it.quarterCount + "× ¼ of " + formatStrength(it.strength) + " mcg"; return s;
        }).join(" + ") || "0 mcg";
        return "<tr><td>" + d(x.date) + "</td><td>" + DOW[new Date(x.date).getDay()] + "</td><td><b>" + formatStrength(x.mcg) + " mcg</b></td><td>" + escHtml(inst) + "</td></tr>";
      }).join("");
      inner = "<div class='bt'>Prescription → Combination</div>" +
        "<table><thead><tr><th>Prescribed Dose</th><th>Tablets to use</th></tr></thead><tbody>" + resRows + "</tbody></table>" +
        "<div class='bt'>Market Strength Dispensing</div>" +
        "<table><thead><tr><th>Strength</th><th>Pieces needed</th><th>Physical tabs</th><th>Tabs/box</th><th>Boxes</th></tr></thead><tbody>" + dispRows + "</tbody></table>" +
        "<div class='bt'>Daily Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Prescribed</th><th>Tablets to take</th></tr></thead><tbody>" + schedRows + "</tbody></table>";
      return buildPrintHtml("Levothyroxine Dosing Plan", meta, inner);
    } else if (ct === "war") {
      var wdispRows = (data.dispByStrength || []).map(function (r) {
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + (r.halfPieces || 0) + "</td><td><b>" + r.tabletsDispense + "</b></td><td>" + r.tabsPerSheet + "</td><td>" + r.sheetsNeeded + "</td><td>" + r.sheetsPerBox + "</td><td><b>" + r.boxesNeeded + "</b></td></tr>";
      }).join("") || "<tr><td colspan='8'>No tablets required.</td></tr>";
      var wschedRows = (data.schedule || []).map(function (x) {
        var inst = (x.items && x.items.length) ? "<b>" + comboToPatientSentence(x.items) + "</b>" : "<b>0 mg — no tablets</b>";
        return "<tr><td>" + d(x.date) + "</td><td>" + DOW[x.dow] + "</td><td><b>" + formatStrength(x.doseMg) + " mg</b></td><td>" + inst + "</td></tr>";
      }).join("");
      inner = "<div class='warn'>WARFARIN SAFETY NOTE: Follow this schedule exactly unless prescriber/INR clinic changes it. If dose changes, update this plan.</div>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Strength</th><th>Whole tabs</th><th>Half pieces</th><th>To dispense</th><th>Tabs/sheet</th><th>Sheets needed</th><th>Sheets/box</th><th>Boxes</th></tr></thead><tbody>" + wdispRows + "</tbody></table>" +
        "<div class='bt'>Patient Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets to take</th></tr></thead><tbody>" + wschedRows + "</tbody></table>";
      return buildPrintHtml("Warfarin Dosing Plan (Variable Schedule)", meta, inner);
    } else if (ct === "ins") {
      var tl = data.type === "pen" ? "Cartridge/Pen" : "Vial";
      var primingText = data.includePriming ? "Priming included: " + formatStrength(data.primeUnits) + " units/injection × " + data.injectionsPerDay + " injection(s)/day = " + formatStrength(data.dailyPriming) + " units/day." : "Priming not included.";
      var discardText = data.includeDiscard ? "Discard rule: discard after " + data.discardDays + " days from first use." : "Discard rule not included.";
      var iboxLine = data.roundToBoxes ? "<tr><td>Boxes to dispense</td><td><b>" + data.boxesNeeded + "</b> (" + data.containersPerBox + " per box)</td></tr>" : "";
      inner = "<div class='bt'>Daily Dose</div>" +
        "<table><thead><tr><th>Time</th><th>Units</th></tr></thead><tbody>" +
        "<tr><td>Morning</td><td><b>" + formatStrength(data.doses.morning) + " units</b></td></tr>" +
        "<tr><td>Afternoon</td><td><b>" + formatStrength(data.doses.afternoon) + " units</b></td></tr>" +
        "<tr><td>Evening</td><td><b>" + formatStrength(data.doses.evening) + " units</b></td></tr>" +
        "<tr><td>Night</td><td><b>" + formatStrength(data.doses.night) + " units</b></td></tr>" +
        "</tbody></table>" +
        "<div class='bt'>Supply Calculation</div>" +
        "<p>" + escHtml(primingText) + "</p><p>" + escHtml(discardText) + "</p>" +
        "<table><tbody>" +
        "<tr><td>Container type</td><td><b>" + escHtml(tl) + "</b></td></tr>" +
        "<tr><td>Units per container</td><td><b>" + data.unitsPerContainer + " units</b></td></tr>" +
        "<tr><td>Containers required</td><td><b>" + data.containersUsed + "</b></td></tr>" + iboxLine +
        "<tr><td>Units needed (dose only)</td><td><b>" + formatStrength(data.totalUnitsNeededNoWaste) + " units</b></td></tr>" +
        "<tr><td>Units for priming</td><td><b>" + formatStrength(data.totalPrimingUnits) + " units</b></td></tr>" +
        "<tr><td>Units wasted (discard)</td><td><b>" + formatStrength(data.wastedFromDiscard || 0) + " units</b></td></tr>" +
        "<tr><td>Leftover at end</td><td><b>" + formatStrength(data.leftoverUnitsAtEnd || 0) + " units</b></td></tr>" +
        "</tbody></table>";
      return buildPrintHtml("Insulin Daily Dose + Supply Plan", meta, inner);
    } else if (ct === "mtx") {
      var fd3 = data.firstDoseDate ? new Date(data.firstDoseDate) : null;
      var mrows = (data.schedule || []).map(function (s) {
        var dt = []; if (s.wholeTabs > 0) dt.push(s.wholeTabs + " tablet(s)"); if (s.halfPieces > 0) dt.push("+ ½ tablet"); if (s.quarterPieces > 0) dt.push("+ ¼ tablet");
        return "<tr><td>" + d(s.doseDate) + "</td><td>" + DOW[new Date(s.doseDate).getDay()] + "</td><td><b>" + formatStrength(data.weeklyDose) + " mg</b></td><td><b>" + (dt.join(" ") || "0") + "</b> of " + formatStrength(data.tabletStrength) + " mg</td></tr>";
      }).join("");
      var mboxLine = data.roundToBoxes ? "<div><b>Dispense:</b> " + data.totalTabsToDispense + " tablets → " + data.boxes + " box(es) (" + data.tabsPerBox + " per box)</div>" : "<div><b>Dispense:</b> " + data.totalTabsToDispense + " tablets exact</div>";
      inner = "<div class='bigwarn'>TAKE ONCE WEEKLY ONLY — NOT DAILY</div>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Weekly dose</th><th>Tablet strength</th><th>First dose</th><th>Duration</th></tr></thead><tbody>" +
        "<tr><td><b>" + formatStrength(data.weeklyDose) + " mg</b></td><td><b>" + formatStrength(data.tabletStrength) + " mg</b></td><td><b>" + (fd3 ? fmtDate(fd3) + " (" + DOW[fd3.getDay()] + ")" : "—") + "</b></td><td><b>" + data.weeks + " week(s)</b></td></tr>" +
        "</tbody></table>" + mboxLine +
        "<div class='bt'>Weekly Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets to take</th></tr></thead><tbody>" + mrows + "</tbody></table>";
      return buildPrintHtml("Methotrexate Weekly Dosing Plan", meta, inner);
    }
    return null;
  }

  // ───────────── Form values (the classic defaults) ─────────────
  function defaults(id) {
    if (id === "lev") {
      var days = {}; DAYS.forEach(function (d) { days[d[0]] = (d[0] >= 1 && d[0] <= 5) ? "1" : "2"; });
      return { weeks: "12", mode: "alt2", split: "none", d1: "100", d2: "125", d3: "", days: days, boxDef: "28", box: { 25: "28", 50: "28", 75: "90", 100: "28" } };
    }
    if (id === "pred") return { drug: "Prednisolone", maxTabs: "12", steps: [[30, 5], [20, 5], [10, 5], [5, 5]].map(function (s) { return { dose: String(s[0]), days: String(s[1]), note: "" }; }), strengths: "5,10,20", split: "halves", policy: "optimize", tabsPerBox: "30", roundBoxes: "yes" };
    if (id === "war") return { weeks: "4", mode: "weekly", split: "halves", days: { 1: "5", 2: "2.5", 3: "5", 4: "2.5", 5: "5", 6: "2.5", 0: "5" }, cycle: "5,2.5", strengths: "1,3,5", maxTabs: "8", pack: {}, packRaw: {} };
    if (id === "ins") return { weeks: "4", morning: "0", afternoon: "0", evening: "0", night: "0", type: "pen", unitsPerCont: "300", contsPerBox: "5", roundBoxes: "yes", priming: "yes", primeUnits: "2", discard: "yes", discardDays: "28" };
    return { weeks: "8", weeklyDose: "10", weekday: "0", strength: "2.5", split: "no", tabsPerBox: "30", roundBoxes: "yes" };
  }
  function freshValues() { var o = {}; CALCS.forEach(function (c) { o[c[0]] = defaults(c[0]); }); return o; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function inputsFor(id) { var v = clone(S.v[id]); v.startDate = S.pat.start; return v; }

  // ───────────── Live calculation ─────────────
  var waiters = [];
  function compute() {
    clearTimeout(S.calcT); S.dirty = false;
    var id = ++S.job, calc = S.calc, v = inputsFor(calc);
    S.working = true; S.slow = false;
    var bx = S.mount && S.mount.querySelector("#cal-res"); if (bx) bx.setAttribute("aria-busy", "true");
    var w = worker();
    if (w) {
      if (W.busy) { try { W.w.terminate(); } catch (e) {} W.w = null; w = worker(); } // a newer question: drop the old search
      if (w) { W.busy = true; w.postMessage({ id: id, calc: calc, v: v }); clearTimeout(S.slowT); S.slowT = setTimeout(function () { if (S.job === id && S.working) { S.slow = true; paintResult(); } }, 400); S.jobCalc = calc; return; }
    }
    S.jobCalc = calc;
    var r; try { r = runCalc(calc, v); } catch (x) { r = { error: "Could not work this out: " + String((x && x.message) || x) }; }
    done(id, r);
  }
  function done(id, r) {
    if (id !== S.job) return;
    clearTimeout(S.slowT);
    S.working = false; S.slow = false; S.res = { calc: S.jobCalc, r: r }; S.resJob = id;
    paintResult();
    var ws = waiters; waiters = []; ws.forEach(function (f) { f(); });
  }
  function later() { S.dirty = true; clearTimeout(S.calcT); S.calcT = setTimeout(compute, 160); }
  function current() { // the result for what is on the screen now (a change still waiting to be worked out is worked out first)
    if (S.dirty) compute();
    if (!S.working && S.res && S.resJob === S.job) return Promise.resolve(S.res);
    return new Promise(function (ok) { waiters.push(function () { ok(S.res); }); });
  }

  // ───────────── Look ─────────────
  function css() {
    if (document.getElementById("eikon-calreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-calreg-css";
    st.textContent =
      ".cal{max-width:1120px;margin:0 auto}" +
      ".cal-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".cal h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.cal-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;max-width:640px}" +
      ".cal-btn{font:inherit;font-size:14px;font-weight:600;min-height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".cal-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cal-btn:disabled{opacity:.55;cursor:default}.cal-btn.sm{min-height:30px;font-size:13px;padding:0 12px}" +
      ".cal-seg{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:16px}" +
      ".cal-seg button{font:inherit;font-size:14px;font-weight:600;min-height:40px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;padding:4px 8px;line-height:1.2;overflow-wrap:anywhere}" +
      ".cal-seg button.on{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".cal-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;margin-top:16px;align-items:start}" +
      "@media (min-width:1000px){.cal-grid{grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr)}.cal-out{position:sticky;top:12px}}" +
      ".cal-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin:0}" +
      ".cal-form label,.cal-form .row{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".cal-form label>span{flex:0 0 128px;font-size:15px}.cal-form label>i{font-style:normal;color:var(--muted);font-size:13px;white-space:nowrap}" +
      ".cal-form input,.cal-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".cal-form .hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:16px 14px 5px;border-top:.5px solid var(--border)}.cal-form .hd:first-child{border-top:0;padding-top:10px}" +
      ".cal-help{font-size:13px;color:var(--muted);padding:2px 14px 10px;line-height:1.45}" +
      ".cal-step{border-top:.5px solid var(--border)}.cal-step .sh{display:flex;align-items:center;justify-content:space-between;padding:10px 14px 0;font-size:13px;font-weight:700}" +
      ".cal-step label{border-top:0}" +
      ".cal-x{font:inherit;font-size:13px;font-weight:600;border:0;background:none;color:var(--danger);cursor:pointer;padding:6px 4px}" +
      ".cal-acts{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px}.cal-acts.end{justify-content:flex-end;border-top:.5px solid var(--border);margin:14px -16px 0;padding:12px 16px 0}" +
      ".cal-note{margin:8px 14px 10px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12);font-size:13.5px;line-height:1.45}.cal-note b{font-weight:700}" +
      ".cal-note.big{font-size:15px}" +
      ".cal-out{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:14px 16px;min-width:0}" +
      ".cal-out h2{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}" +
      ".cal-big{display:flex;flex-wrap:wrap;gap:10px 18px;margin:4px 0 6px}.cal-big div{min-width:0}.cal-big b{display:block;font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}.cal-big span{display:block;font-size:13px;color:var(--muted);margin-top:2px}" +
      ".cal-h3{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px}" +
      ".cal-list{border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".cal-li{display:flex;gap:10px;align-items:baseline;padding:9px 12px;border-top:.5px solid var(--border);font-size:14.5px;line-height:1.4}.cal-li:first-child{border-top:0}" +
      ".cal-li .k{flex:0 0 auto;min-width:0;font-weight:600}.cal-li .v{flex:1;min-width:0;text-align:right;overflow-wrap:anywhere}.cal-li .v small,.cal-li .k small{display:block;color:var(--muted);font-size:12.5px;font-weight:400}" +
      ".cal-li.col{display:block}.cal-li.col .v{text-align:left}" +
      ".cal-tbl{width:100%;border-collapse:collapse;font-size:13.5px}.cal-tbl th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:.5px solid var(--border)}" +
      ".cal-tbl td{padding:7px 8px;border-bottom:.5px solid var(--border);vertical-align:top;overflow-wrap:anywhere}.cal-tbl tr:last-child td{border-bottom:0}.cal-tbl td:first-child{white-space:nowrap}" +
      ".cal-more{font-size:12.5px;color:var(--muted);margin:6px 2px 0}" +
      ".cal-check{padding:12px 14px;border-radius:10px;background:rgba(201,138,18,.12);font-size:14.5px;line-height:1.45}.cal-check b{font-weight:700}" +
      ".cal-wait{color:var(--muted);font-size:14.5px;padding:6px 0}" +
      ".cal-err{color:var(--danger);font-size:14px;margin-top:12px;line-height:1.45}" +
      ".cal-ok{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:rgba(28,138,91,.12);font-size:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}" +
      ".cal-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:26px 2px 7px;display:flex;gap:8px}.cal-lab b{color:var(--text)}" +
      ".cal-find{display:flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:0 12px;margin-bottom:8px}" +
      ".cal-find input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:11px 0}.cal-find:focus-within{border-color:var(--accent)}" +
      ".cal-recs{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".cal-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-top:.5px solid var(--border);padding:10px 16px;min-height:52px;cursor:pointer}" +
      ".cal-recs>.cal-row:first-child{border-top:0}.cal-row:hover{background:rgba(118,118,128,.06)}.cal-row .t{flex:1;min-width:0}.cal-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}" +
      ".cal-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".cal-det{padding:4px 16px 12px;border-top:.5px solid var(--border);font-size:14px}.cal-det p{margin:6px 0}" +
      ".cal-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:18px;color:var(--muted)}" +
      ".cal-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      ".cal-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}" +
      ".cal-form .row:focus-within{background:rgba(10,143,106,.07)}" +
      ".cal-form label:focus-within{box-shadow:inset 3px 0 0 var(--accent)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .cal-seg button.on{color:#00160E}html[data-ui2]:not([data-ui2-visit]) :is(.cal-err,.cal-x){color:#FF7A72}}" +
      "@media (max-width:760px){.cal-seg{grid-template-columns:repeat(3,minmax(0,1fr))}}" +
      "@media (max-width:600px){.cal{padding:4px 16px 0}.cal h1{font-size:32px}.cal-form label>span{flex-basis:104px}.cal-row{padding:10px 14px}.cal-big b{font-size:30px}}";
    document.head.appendChild(st);
  }

  // ───────────── Form ─────────────
  var DEC = ' inputmode="decimal" autocomplete="off"', INT = ' inputmode="numeric" autocomplete="off"';
  function fld(name, lab, val, extra, unit) {
    return "<label><span>" + lab + '</span><input name="' + name + '" value="' + esc(val) + '"' + (extra || "") + ">" + (unit ? "<i>" + unit + "</i>" : "") + "</label>";
  }
  function pick(name, lab, val, opts, dis) {
    return "<label><span>" + lab + '</span><select name="' + name + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? " selected" : "") + (dis && dis.indexOf(o[0]) >= 0 ? " disabled" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select></label>";
  }
  var YESNO = [["yes", "Yes"], ["no", "No"]];

  function patientHtml() {
    var p = S.pat, names = {};
    var opts = S.patients.filter(function (x) { var k = low(x.patient_name); if (!k || names[k]) return false; names[k] = 1; return true; }).slice(0, 400);
    return '<div class="hd">Patient</div>' +
      fld("pat.name", "Name", p.name, ' list="cal-pats" autocomplete="off" placeholder="Name and surname"') +
      fld("pat.id", "ID card", p.id, ' autocomplete="off" autocapitalize="characters" placeholder="e.g. 789M or 1234567A"') +
      fld("pat.start", "Start date", p.start, ' type="date"') +
      fld("pat.note", "Note", p.note, ' autocomplete="off" placeholder="Optional, on the printout"') +
      '<div class="cal-help">Maltese ID cards are padded for you: 789M becomes 0000789M.</div>' +
      '<datalist id="cal-pats">' + opts.map(function (x) { return '<option value="' + esc(x.patient_name) + '">' + esc(x.id_card) + "</option>"; }).join("") + "</datalist>";
  }

  function levHtml(v) {
    var h = '<div class="hd">Prescription</div>' +
      fld("lev.weeks", "Duration", v.weeks, INT, "weeks") +
      pick("lev.mode", "Pattern", v.mode, [["single", "Same dose every day"], ["alt2", "Alternating 2 doses"], ["alt3", "Alternating 3 doses"]]) +
      pick("lev.split", "Splitting", v.split, SPLIT) +
      fld("lev.d1", "Dose 1", v.d1, DEC, "mcg a day") +
      (v.mode !== "single" ? fld("lev.d2", "Dose 2", v.d2, DEC, "mcg a day") : "") +
      (v.mode === "alt3" ? fld("lev.d3", "Dose 3", v.d3, DEC + ' placeholder="Dose 3"', "mcg a day") : "") +
      '<div class="cal-help">Market strengths: 25, 50, 75 and 100 mcg. Write the prescribed dose; the tablets are worked out for you.</div>';
    if (v.mode !== "single") {
      h += '<div class="hd" id="cal-levdays">Which dose on which day</div><div role="group" aria-labelledby="cal-levdays">' + DAYS.map(function (d) {
        return pick("lev.days." + d[0], DOW[d[0]], v.days[d[0]], [["1", "Dose 1 · " + (v.d1 || "?") + " mcg"], ["2", "Dose 2 · " + (v.d2 || "?") + " mcg"], ["3", "Dose 3 · " + (v.d3 || "?") + " mcg"]], v.mode === "alt2" ? ["3"] : null);
      }).join("") + "</div>";
    }
    h += '<div class="hd">Pack sizes (tablets a box)</div>' + fld("lev.boxDef", "Default box", v.boxDef, INT, "tablets") +
      LEV_MARKET.map(function (s) { return fld("lev.box." + s, s + " mcg box", v.box[s], INT, "tablets"); }).join("") +
      '<div class="cal-help">75 mcg boxes are 90 tablets; 25, 50 and 100 mcg are 28 tablets by default.</div>';
    return h;
  }

  function predHtml(v) {
    var h = '<div class="hd">Taper</div>' +
      pick("pred.drug", "Drug", v.drug, [["Prednisolone", "Prednisolone"], ["Prednisone", "Prednisone"]]) +
      fld("pred.maxTabs", "Most tablets", v.maxTabs, INT, "a day") +
      '<div class="hd">Steps</div>';
    h += v.steps.map(function (s, i) {
      return '<div class="cal-step"><div class="sh"><span>Step ' + (i + 1) + '</span><button type="button" class="cal-x" data-act="step-del" data-i="' + i + '" aria-label="Remove step ' + (i + 1) + '">Remove</button></div>' +
        fld("pred.steps." + i + ".dose", "Dose", s.dose, DEC, "mg a day") + fld("pred.steps." + i + ".days", "Days", s.days, INT, "days") + fld("pred.steps." + i + ".note", "Note", s.note, ' autocomplete="off" placeholder="Optional"') + "</div>";
    }).join("");
    if (!v.steps.length) h += '<div class="cal-help">No steps yet.</div>';
    h += '<div class="cal-acts"><button type="button" class="cal-btn sm" data-act="step-add">Add a step</button><button type="button" class="cal-btn sm" data-act="step-example">Reset to the example</button></div>' +
      '<div class="hd">Tablets</div>' +
      fld("pred.strengths", "Strengths", v.strengths, ' autocomplete="off"', "mg") +
      '<div class="cal-help">Separate strengths with commas, e.g. 5,10,20. Use a point for a decimal (2.5).</div>' +
      pick("pred.split", "Splitting", v.split, SPLIT) +
      pick("pred.policy", "In stock", v.policy, [["optimize", "Use the strengths above"], ["only5", "5 mg only"], ["only20_5", "20 mg and 5 mg only"]]) +
      fld("pred.tabsPerBox", "Box", v.tabsPerBox, INT, "tablets") +
      pick("pred.roundBoxes", "Whole boxes", v.roundBoxes, [["yes", "Yes, round up to whole boxes"], ["no", "No, exact"]]);
    return h;
  }

  function packRowsHtml(v) {
    var ss = normalizeStrengthList(v.strengths);
    if (!ss.length) return '<div class="cal-help">Write the strengths first.</div>';
    return ss.map(function (s) {
      var key = String(roundFixed(s, 4)), raw = v.packRaw[key] || {}, pk = v.pack[key] || { tabsPerSheet: 14, sheetsPerBox: 2 };
      return fld("war.pack." + key + ".tps", formatStrength(s) + " mg sheet", raw.tps != null ? raw.tps : String(pk.tabsPerSheet), INT, "tablets") +
        fld("war.pack." + key + ".spb", formatStrength(s) + " mg box", raw.spb != null ? raw.spb : String(pk.sheetsPerBox), INT, "sheets");
    }).join("");
  }
  function warHtml(v) {
    var h = '<div class="cal-note"><b>Warfarin:</b> this is a variable dosing schedule. If the INR clinic changes the dose, this plan must be updated.</div>' +
      '<div class="hd">Prescription</div>' +
      fld("war.weeks", "Duration", v.weeks, INT, "weeks") +
      pick("war.mode", "Pattern", v.mode, [["weekly", "Weekly (Monday to Sunday)"], ["cycle", "Repeating cycle"]]) +
      pick("war.split", "Splitting", v.split, SPLIT);
    if (v.mode === "weekly") {
      h += '<div class="hd" id="cal-wardays">Dose each day</div><div role="group" aria-labelledby="cal-wardays">' + DAYS.map(function (d) {
        return fld("war.days." + d[0], DOW[d[0]], v.days[d[0]], DEC, "mg");
      }).join("") + "</div>";
    } else {
      h += fld("war.cycle", "Cycle", v.cycle, ' autocomplete="off"', "mg") +
        '<div class="cal-help">Doses in order, separated by commas: 5,2.5 alternates; 5,5,2.5 is a 3-day cycle. Use a point for a decimal.</div>';
    }
    h += '<div class="hd">Tablets</div>' +
      fld("war.strengths", "Strengths", v.strengths, ' autocomplete="off"', "mg") +
      '<div class="cal-help">Separate strengths with commas, e.g. 1,3,5.</div>' +
      fld("war.maxTabs", "Most tablets", v.maxTabs, INT, "a dose") +
      '<div class="hd">Blister packs</div><div id="cal-pack">' + packRowsHtml(v) + "</div>";
    return h;
  }

  function insHtml(v) {
    return '<div class="cal-note"><b>Insulin:</b> this is a supply estimate. Always follow the product’s storage and discard instructions.</div>' +
      '<div class="hd">Daily dose</div>' +
      fld("ins.weeks", "Duration", v.weeks, INT, "weeks") +
      fld("ins.morning", "Morning", v.morning, DEC, "units") + fld("ins.afternoon", "Afternoon", v.afternoon, DEC, "units") +
      fld("ins.evening", "Evening", v.evening, DEC, "units") + fld("ins.night", "Night", v.night, DEC, "units") +
      '<div class="hd">Device</div>' +
      pick("ins.type", "Container", v.type, [["pen", "Cartridge or pen (e.g. 300 units)"], ["vial", "Vial (e.g. 1000 units)"]]) +
      fld("ins.unitsPerCont", "Each holds", v.unitsPerCont, INT, "units") +
      fld("ins.contsPerBox", "Box", v.contsPerBox, INT, "containers") +
      pick("ins.roundBoxes", "Whole boxes", v.roundBoxes, [["yes", "Yes, round up to whole boxes"], ["no", "No, exact"]]) +
      '<div class="hd">Wastage</div>' +
      pick("ins.priming", "Priming", v.priming, [["yes", "Include priming"], ["no", "Leave out"]]) +
      fld("ins.primeUnits", "Priming dose", v.primeUnits, DEC, "units an injection") +
      pick("ins.discard", "Discard rule", v.discard, [["yes", "Include the discard rule"], ["no", "Leave out"]]) +
      fld("ins.discardDays", "Discard after", v.discardDays, INT, "days");
  }

  function mtxHtml(v) {
    return '<div class="cal-note big"><b>Methotrexate: once a week only, not daily.</b> Daily dosing can cause serious harm.</div>' +
      '<div class="hd">Prescription</div>' +
      fld("mtx.weeks", "Duration", v.weeks, INT, "weeks") +
      fld("mtx.weeklyDose", "Weekly dose", v.weeklyDose, DEC, "mg") +
      pick("mtx.weekday", "Day of week", v.weekday, [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["0", "Sunday"]]) +
      '<div class="hd">Tablets</div>' +
      fld("mtx.strength", "Strength", v.strength, DEC, "mg") +
      pick("mtx.split", "Splitting", v.split, [["no", "Whole tablets only"], ["halves", "Halves (clinical instruction)"], ["quarters", "Halves and quarters (clinical instruction)"]]) +
      '<div class="cal-help">Recommended: do not split methotrexate. Halves or quarters only with a clinical instruction.</div>' +
      fld("mtx.tabsPerBox", "Box", v.tabsPerBox, INT, "tablets") +
      pick("mtx.roundBoxes", "Whole boxes", v.roundBoxes, YESNO);
  }

  var FORMS = { lev: levHtml, pred: predHtml, war: warHtml, ins: insHtml, mtx: mtxHtml };

  // ───────────── Results ─────────────
  function big(n, unit, sub) { return "<div><b>" + esc(n) + "</b><span>" + esc(unit) + (sub ? " · " + esc(sub) : "") + "</span></div>"; }
  function li(k, v, sub) { return '<div class="cal-li"><div class="k">' + k + '</div><div class="v">' + v + (sub ? "<small>" + sub + "</small>" : "") + "</div></div>"; }
  function sd(d) { return DOW[d.getDay()].slice(0, 3) + " " + fmtDate(d); }

  function resultLev(m) {
    var h = '<div class="cal-h3">Tablets for each dose</div><div class="cal-list">' + m.prescribedDoses.map(function (pd) {
      var res = m.doseResolutions[pd.idx];
      return li("Dose " + pd.idx + " · " + esc(formatStrength(pd.mcg)) + " mcg", esc(res.combo.items.length ? describeCombo(res.combo.items, "mcg") : "0 mcg"));
    }).join("") + "</div>";
    var boxes = m.dispensing.reduce(function (a, d) { return a + d.boxes; }, 0);
    h = '<div class="cal-big">' + big(String(boxes), boxes === 1 ? "box to dispense" : "boxes to dispense", m.weeks + " weeks") + "</div>" + h;
    h += '<div class="cal-h3">To dispense</div><div class="cal-list">' + m.dispensing.map(function (d) {
      var pieces = d.wholes + " whole" + (d.halves ? " + " + d.halves + " halves" : "") + (d.quarters ? " + " + d.quarters + " quarters" : "");
      return li(esc(formatStrength(d.strength)) + " mcg", "<b>" + d.boxes + " " + plural(d.boxes, "box", "boxes") + "</b> of " + d.boxSize, esc(d.physicalTablets + " tablets needed (" + pieces + ") · " + d.extra + " extra"));
    }).join("") + "</div>";
    h += '<div class="cal-h3">Plan, first 21 days</div><table class="cal-tbl"><thead><tr><th scope="col">Day</th><th scope="col">Dose</th><th scope="col">Tablets</th></tr></thead><tbody>' + m.schedule.slice(0, 21).map(function (x) {
      return "<tr><td>" + esc(sd(x.date)) + "</td><td><b>" + esc(formatStrength(x.mcg)) + "&nbsp;mcg</b></td><td>" + esc(levParts(x)) + "</td></tr>";
    }).join("") + "</tbody></table>" + (m.schedule.length > 21 ? '<p class="cal-more">The full ' + m.schedule.length + "-day plan is on the printout.</p>" : "");
    return h;
  }
  function resultPred(m) {
    var last = m.stepPlans[m.stepPlans.length - 1], days = m.stepPlans.reduce(function (a, s) { return a + s.days; }, 0);
    var h = '<div class="cal-big">' + big(String(m.totalDispensedTabsAll), "tablets to dispense", m.roundBoxes ? m.boxes + " " + plural(m.boxes, "box", "boxes") + " of " + m.tabsPerBox : "exact, no boxes") + big(String(days), "days", "ends " + fmtDate(last.end)) + "</div>";
    h += '<div class="cal-h3">Taper</div><div class="cal-list">' + m.stepPlans.map(function (sp) {
      var t = sp.comboItems.length === 0 ? "Stop (0 mg)" : "Take " + describeCombo(sp.comboItems, "mg") + " once daily";
      return '<div class="cal-li col"><div class="k">Step ' + sp.stepNumber + " · " + esc(formatStrength(sp.doseMg)) + " mg a day<small>" + esc(fmtDate(sp.start) + " to " + fmtDate(sp.end) + " (" + sp.days + " days)") + '</small></div><div class="v">' + esc(t) + (sp.note ? "<small>Note: " + esc(sp.note) + "</small>" : "") + "</div></div>";
    }).join("") + "</div>";
    h += '<div class="cal-h3">To dispense</div><div class="cal-list">' + (m.totalRows.length ? m.totalRows.map(function (r) {
      return li(esc(formatStrength(r.strength)) + " mg", "<b>" + r.tabletsToDispense + " tablets</b>", esc(r.wholePieces + " whole, " + r.halfPieces + " half pieces" + (r.quarterPieces ? ", " + r.quarterPieces + " quarter pieces" : "")));
    }).join("") : li("Nothing", "No tablets required.")) + "</div>";
    return h;
  }
  function resultWar(m) {
    var tabs = m.dispByStrength.reduce(function (a, r) { return a + r.tabletsDispense; }, 0), bx = m.dispByStrength.reduce(function (a, r) { return a + r.boxesNeeded; }, 0);
    var h = '<div class="cal-big">' + big(String(bx), bx === 1 ? "box to dispense" : "boxes to dispense", tabs + " tablets") + "</div>";
    h += '<div class="cal-h3">To dispense</div><div class="cal-list">' + (m.dispByStrength.length ? m.dispByStrength.map(function (r) {
      return li(esc(formatStrength(r.strength)) + " mg", "<b>" + r.boxesNeeded + " " + plural(r.boxesNeeded, "box", "boxes") + "</b> · " + r.tabletsDispense + " tablets",
        esc(r.sheetsNeeded + " " + plural(r.sheetsNeeded, "sheet", "sheets") + " of " + r.tabsPerSheet + ", " + r.sheetsPerBox + " sheets a box · " + r.wholePieces + " whole, " + r.halfPieces + " half pieces"));
    }).join("") : li("Nothing", "No tablets required (all doses are 0).")) + "</div>";
    h += '<div class="cal-h3">Plan, first 14 days</div><table class="cal-tbl"><thead><tr><th scope="col">Day</th><th scope="col">Dose</th><th scope="col">Tablets</th></tr></thead><tbody>' + m.schedule.slice(0, 14).map(function (x) {
      return "<tr><td>" + esc(sd(x.date)) + "</td><td><b>" + esc(formatStrength(x.doseMg)) + "&nbsp;mg</b></td><td>" + esc(x.items.length === 0 ? "0 mg, no tablets" : comboToPatientSentence(x.items)) + "</td></tr>";
    }).join("") + "</tbody></table>" + (m.schedule.length > 14 ? '<p class="cal-more">The full ' + m.schedule.length + "-day plan is on the printout.</p>" : "");
    return h;
  }
  function resultIns(m) {
    var h = '<div class="cal-big">' + big(String(m.containersUsed), (m.type === "pen" ? "cartridges or pens" : "vials"), m.unitsPerContainer + " units each") +
      (m.roundToBoxes ? big(String(m.boxesNeeded), m.boxesNeeded === 1 ? "box" : "boxes", m.containersPerBox + " a box") : "") + "</div>";
    h += '<div class="cal-list">' +
      li("Dates", esc(fmtDate(m.startDate) + " to " + fmtDate(addDays(m.startDate, m.daysTotal - 1))), esc(m.weeks + " weeks")) +
      li("Daily dose", "<b>" + esc(formatStrength(m.dailyUnits)) + " units</b>", esc(m.injectionsPerDay + " injection(s) a day")) +
      li("Units for the doses", esc(formatStrength(m.totalUnitsNeededNoWaste)) + " units") +
      li("Units for priming", esc(formatStrength(m.totalPrimingUnits)) + " units", m.includePriming ? esc(formatStrength(m.primeUnits) + " units an injection × " + m.injectionsPerDay + " = " + formatStrength(m.dailyPriming) + " units a day") : "Priming not included") +
      li("Units thrown away", esc(formatStrength(m.wastedFromDiscard)) + " units", m.includeDiscard ? esc("Discarded " + m.discardDays + " days after first use") : "Discard rule not included") +
      li("Left over at the end", esc(formatStrength(m.leftoverUnitsAtEnd)) + " units") + "</div>";
    return h;
  }
  function resultMtx(m) {
    var per = m.schedule[0] || {}, dt = []; if (per.wholeTabs > 0) dt.push(per.wholeTabs + " tablet(s)"); if (per.halfPieces > 0) dt.push("+ ½ tablet"); if (per.quarterPieces > 0) dt.push("+ ¼ tablet");
    var h = '<div class="cal-check"><b>Once a week only, not daily.</b></div>' +
      '<div class="cal-big">' + big(String(m.totalTabsToDispense), "tablets to dispense", m.roundToBoxes ? m.boxes + " " + plural(m.boxes, "box", "boxes") + " of " + m.tabsPerBox : "exact") + "</div>";
    h += '<div class="cal-list">' + li("Each week", "<b>" + esc(dt.join(" ") || "0") + "</b> of " + esc(formatStrength(m.tabletStrength)) + " mg", esc(formatStrength(m.weeklyDose) + " mg, once a week")) +
      li("First dose", esc(DOW[m.firstDoseDate.getDay()] + " " + fmtDate(m.firstDoseDate))) +
      li("Totals", esc(m.totalWholeTabsUsed + " whole, " + m.totalHalfPiecesUsed + " halves, " + m.totalQuarterPiecesUsed + " quarters")) + "</div>";
    h += '<div class="cal-h3">Weekly plan' + (m.schedule.length > 8 ? ", first 8 weeks" : "") + '</div><table class="cal-tbl"><thead><tr><th scope="col">Day</th><th scope="col">Dose</th><th scope="col">Tablets</th></tr></thead><tbody>' + m.schedule.slice(0, 8).map(function (s) {
      var d2 = []; if (s.wholeTabs > 0) d2.push(s.wholeTabs + " tablet(s)"); if (s.halfPieces > 0) d2.push("+ ½ tablet"); if (s.quarterPieces > 0) d2.push("+ ¼ tablet");
      return "<tr><td>" + esc(sd(s.doseDate)) + "</td><td><b>" + esc(formatStrength(m.weeklyDose)) + "&nbsp;mg</b></td><td>" + esc((d2.join(" ") || "0") + " of " + formatStrength(m.tabletStrength) + " mg") + "</td></tr>";
    }).join("") + "</tbody></table>" + (m.schedule.length > 8 ? '<p class="cal-more">The full plan is on the printout.</p>' : "");
    return h;
  }
  var RESULTS = { lev: resultLev, pred: resultPred, war: resultWar, ins: resultIns, mtx: resultMtx };

  function resultHtml() {
    var r = S.res && S.res.calc === S.calc && S.resJob === S.job ? S.res.r : null;
    if (!r && !S.slow && S.res && S.res.calc === S.calc) r = S.res.r; // the last answer stays up while the next one is worked out
    if (!r) return '<div class="cal-wait">' + (S.slow ? "Still working out the tablets: there are many combinations to try…" : "Working it out…") + "</div>";
    if (r.error) return '<div class="cal-check"><b>Check:</b> ' + esc(r.error) + "</div>";
    return RESULTS[S.calc](r.model);
  }
  function paintResult() {
    var box = S.mount && S.mount.querySelector("#cal-res"); if (!box) return;
    box.innerHTML = resultHtml();
    box.setAttribute("aria-busy", S.working ? "true" : "false");
    var say = S.mount.querySelector("#cal-say"), r = S.res && S.resJob === S.job ? S.res.r : null;
    if (say) say.textContent = !r ? "" : r.error ? "Check: " + r.error : (box.querySelector(".cal-big") || box).textContent.replace(/\s+/g, " ").trim().slice(0, 160);
  }

  // ───────────── Saved plans ─────────────
  function savedAt(s) { return String(s || "").replace("T", " ").replace(/\.\d+Z?$/, "").slice(0, 16); }
  function recordsHtml() {
    var h = '<div class="cal-lab">Saved plans <b>' + S.records.length + "</b></div>";
    if (S.recLoading && !S.records.length) return h + '<div class="cal-quiet">Opening the saved plans…</div>';
    if (S.recError) return h + '<div class="cal-quiet">' + esc(S.recError) + "</div>";
    if (!S.records.length) return h + '<div class="cal-quiet">No saved plans yet. Save and print a plan to keep it here.</div>';
    h += '<label class="cal-find"><span class="cal-sr">Find a saved plan</span><input type="search" id="cal-q" value="' + esc(S.q) + '" placeholder="Find by patient name or ID card" autocomplete="off"></label>';
    var q = low(S.q).trim(), rows = S.records.filter(function (r) { return !q || low(r.patient_name).indexOf(q) >= 0 || low(r.id_card).indexOf(q) >= 0 || low(normaliseMalteseId(S.q)) === low(r.id_card); });
    if (!rows.length) return h + '<div class="cal-quiet">No saved plan for “' + esc(S.q) + "”.</div>";
    var shown = rows.slice(0, q ? 60 : 20);
    h += '<div class="cal-recs">' + shown.map(function (r) {
      var open = String(S.open) === String(r.id);
      var row = '<button type="button" class="cal-row" data-act="rec" data-id="' + esc(r.id) + '" aria-expanded="' + open + '"><div class="t"><b>' + esc((r.patient_name || "No name") + " · " + (TYPE_LABEL[r.calc_type] || r.calc_type || "")) + "</b><span>" +
        esc([r.id_card, r.start_date ? "starts " + r.start_date : "", "saved " + savedAt(r.created_at)].filter(Boolean).join(" · ")) + "</span></div></button>";
      if (open) row += '<div class="cal-det">' + detailHtml() + "</div>";
      return row;
    }).join("") + "</div>";
    if (rows.length > shown.length) h += '<p class="cal-more">' + (rows.length - shown.length) + " older plans: search by name or ID card to find them.</p>";
    return h;
  }
  function detailHtml() {
    if (S.openErr) return "<p>" + esc(S.openErr) + "</p>";
    var rec = S.openRec; if (!rec) return "<p>Opening…</p>";
    var data = rec.data, ct = rec.calc_type, t = "";
    if (!data) return "<p>The saved plan could not be read.</p>";
    try {
      if (ct === "lev") t = "Levothyroxine · " + (data.weeks || "?") + " weeks · " + (data.prescribedDoses || []).map(function (pd) { return "Dose " + pd.idx + ": " + formatStrength(pd.mcg) + " mcg"; }).join(", ") + ". " + (data.dispensing || []).map(function (d) { return formatStrength(d.strength) + " mcg: " + d.boxes + " " + plural(d.boxes, "box", "boxes"); }).join(", ");
      else if (ct === "pred") t = (data.drug || "Prednisolone") + " taper · " + (data.stepPlans || []).length + " steps · " + (data.totalDispensedTabsAll || 0) + " tablets" + (data.boxes ? " · " + data.boxes + " " + plural(data.boxes, "box", "boxes") : "");
      else if (ct === "war") t = "Warfarin · " + (data.weeks || "?") + " weeks · " + (data.dispByStrength || []).map(function (r) { return formatStrength(r.strength) + " mg: " + r.tabletsDispense + " tablets, " + r.boxesNeeded + " " + plural(r.boxesNeeded, "box", "boxes"); }).join(", ");
      else if (ct === "ins") t = "Insulin · " + (data.weeks || "?") + " weeks · " + formatStrength(data.dailyUnits) + " units a day · " + data.containersUsed + " containers" + (data.roundToBoxes ? ", " + data.boxesNeeded + " " + plural(data.boxesNeeded, "box", "boxes") : "");
      else if (ct === "mtx") t = "Methotrexate · " + formatStrength(data.weeklyDose) + " mg once a week · " + (data.weeks || "?") + " weeks · " + data.totalTabsToDispense + " tablets";
    } catch (e) { t = ""; }
    return "<p>" + esc(t) + '</p><div class="cal-acts" style="padding:4px 0 0"><button type="button" class="cal-btn sm p" data-act="reprint">Print again</button><button type="button" class="cal-btn sm" data-act="rec-close">Close</button></div>';
  }
  function paintRecords() { var x = S.mount && S.mount.querySelector("#cal-recs"); if (!x) return; var ae = document.activeElement, q = ae && ae.id === "cal-q", caret = q ? ae.selectionStart : null; x.innerHTML = recordsHtml(); wireRecords(x); if (q) { var again = x.querySelector("#cal-q"); if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) {} } } }

  async function fetchRecords() { var r = await E.apiFetch("/pharmacy-calc/records?include_json=1", { method: "GET" }); if (!r || r.ok === false) throw new Error((r && r.error) || "Could not load the saved plans"); return Array.isArray(r.records) ? r.records : []; }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.recLoading = true; S.recError = ""; paintRecords();
    try { S.records = await fetchRecords(); } catch (e) { if (!keepView) S.recError = e && e.network ? "Can't reach the server to show the saved plans. The calculators still work." : String((e && (e.message || e)) || "Could not load the saved plans"); }
    S.recLoading = false; paintRecords(); // the list sits outside the form: drawing it never touches what is being typed
    E.whenFormIdle(S.mount, paint);
  }
  async function loadPatients() {
    try { var r = await E.apiFetch("/pharmacy-calc/patients", { method: "GET" }); S.patients = (r && Array.isArray(r.patients)) ? r.patients : []; } catch (e) { S.patients = []; }
    // only the suggestion list changes: the form is not redrawn under the fingers
    var dl = S.mount && S.mount.querySelector("#cal-pats");
    if (dl) { var names = {}; dl.innerHTML = S.patients.filter(function (x) { var k = low(x.patient_name); if (!k || names[k]) return false; names[k] = 1; return true; }).slice(0, 400).map(function (x) { return '<option value="' + esc(x.patient_name) + '">' + esc(x.id_card) + "</option>"; }).join(""); }
  }

  // ───────────── Screen ─────────────
  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "calreg") return; // left before a reply came back: do not draw over the next screen
    if (!fromState) keep(); // what is typed is kept; fromState: the values were just changed in code
    var h = '<div class="cal"><button class="cal-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("calreg")) + '</button>' +
      '<h1>Pharmacy calculators</h1><p class="cal-sub">Dosing plans and the tablets or insulin to dispense, for one patient.</p>' +
      '<div class="cal-seg" role="group" aria-label="Calculator">' + CALCS.map(function (c) { return '<button type="button" data-calc="' + c[0] + '" aria-pressed="' + (S.calc === c[0]) + '" class="' + (S.calc === c[0] ? "on" : "") + '">' + esc(c[1]) + "</button>"; }).join("") + "</div>" +
      '<div class="cal-grid"><form class="cal-form" id="cal-form" autocomplete="off" aria-label="' + esc(TITLE[S.calc]) + '" novalidate>' +
      patientHtml() + FORMS[S.calc](S.v[S.calc]) + "</form>" +
      '<section class="cal-out" aria-labelledby="cal-out-h"><h2 id="cal-out-h">' + esc(TITLE[S.calc]) + '</h2><div id="cal-res" aria-busy="false">' + resultHtml() + '</div><div class="cal-sr" aria-live="polite" id="cal-say"></div>' +
      (S.err ? '<div class="cal-err" role="alert">' + esc(S.err) + "</div>" : "") +
      (S.msg ? '<div class="cal-ok" role="status"><span>' + esc(S.msg) + '</span><button type="button" class="cal-btn sm" data-act="print-again">Print again</button></div>' : "") +
      '<div class="cal-acts end"><button type="button" class="cal-btn" data-act="reset">Start again</button><button type="submit" form="cal-form" class="cal-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save and print") + "</button></div></section></div>" +
      '<div id="cal-recs">' + recordsHtml() + "</div>" +
      '<p class="cal-foot">The calculations, the saved plan and the printout are the same as on the classic screen. Deleting a saved plan is in the <a href="#" data-act="classic">classic calculators screen</a>.</p></div>';
    var ae = document.activeElement, sel = "";
    if (ae && m.contains(ae)) sel = ae.name ? '[name="' + ae.name + '"]' : ae.id ? "#" + ae.id : ae.getAttribute("data-calc") ? '[data-calc="' + ae.getAttribute("data-calc") + '"]' : "";
    var caret = null; if (sel) try { caret = typeof ae.selectionStart === "number" ? ae.selectionStart : null; } catch (e) { caret = null; }
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) { again.focus(); if (caret != null) try { again.setSelectionRange(caret, caret); } catch (e) {} } }
    wire(m); wireRecords(m.querySelector("#cal-recs"));
    paintResult();
  }

  function setPath(name, val) {
    var p = name.split("."), root = p[0] === "pat" ? S.pat : S.v[p[0]], o = root;
    if (!o) return;
    for (var i = 1; i < p.length - 1; i++) { if (o[p[i]] == null) o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = val;
  }
  function keep() {
    var f = S.mount && S.mount.querySelector("#cal-form"); if (!f) return;
    f.querySelectorAll("input[name],select[name]").forEach(function (el) { if (el.name.indexOf("war.pack.") === 0) return; setPath(el.name, el.value); });
  }
  // A blister-pack size is taken as the classic table takes it: a whole number from 1 to 9999, 14 tablets and 2 sheets when unclear.
  function packInput(name, raw) {
    var p = name.split("."), key = p.slice(2, p.length - 1).join("."), which = p[p.length - 1], v = S.v.war;
    v.packRaw[key] = v.packRaw[key] || {}; v.packRaw[key][which] = raw;
    if (!v.pack[key]) v.pack[key] = { tabsPerSheet: 14, sheetsPerBox: 2 };
    if (which === "tps") v.pack[key].tabsPerSheet = clamp(parseIntSafe(raw, 14), 1, 9999); else v.pack[key].sheetsPerBox = clamp(parseIntSafe(raw, 2), 1, 9999);
  }
  function focus(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); if (x && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form") && document.activeElement !== x)) x.focus(); }, 30); }

  // The classic screen's pattern rules for levothyroxine when the pattern changes.
  function levMode(v, mode, prev) {
    var changed = mode !== prev; v.mode = mode;
    DAYS.forEach(function (d) {
      if (mode === "single") v.days[d[0]] = "1";
      else if (mode === "alt2") { if (changed || v.days[d[0]] === "3") v.days[d[0]] = ALT2_DEFAULTS[d[0]]; }
      else if (changed) v.days[d[0]] = ALT3_DEFAULTS[d[0]];
    });
  }

  function lookupPatient(by) {
    var p = S.pat, hit = null, f = S.mount && S.mount.querySelector("#cal-form");
    if (by === "name") { var n = low(p.name).trim(); if (!n || p.id) return; S.patients.some(function (x) { if (low(x.patient_name).trim() === n) { hit = x; return true; } return false; }); if (hit) { p.id = hit.id_card || ""; var el = f && f.querySelector('[name="pat.id"]'); if (el) el.value = p.id; } }
    else { var id = low(normaliseMalteseId(p.id)); if (!id || p.name) return; S.patients.some(function (x) { if (low(x.id_card) === id) { hit = x; return true; } return false; }); if (hit) { p.name = hit.patient_name || ""; var el2 = f && f.querySelector('[name="pat.name"]'); if (el2) el2.value = p.name; } }
  }

  function wire(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      if (b.closest("#cal-recs")) return;
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), v = S.v[S.calc];
        if (act === "back") window.location.hash = E.ui2BackHash("calreg");
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "calreg"); } catch (x) {} E.openClassic("pharmacycalc"); }
        else if (act === "reset") { keep(); S.v[S.calc] = defaults(S.calc); if (S.calc === "lev") S.levModeShown = S.v.lev.mode; S.err = ""; S.msg = null; paint(true); compute(); focus('[data-calc="' + S.calc + '"]'); }
        else if (act === "step-add") { keep(); v.steps.push({ dose: "5", days: "5", note: "" }); paint(true); compute(); focus('[name="pred.steps.' + (v.steps.length - 1) + '.dose"]'); }
        else if (act === "step-example") { keep(); S.v.pred.steps = defaults("pred").steps; paint(true); compute(); }
        else if (act === "step-del") { keep(); v.steps.splice(Number(b.getAttribute("data-i")), 1); paint(true); compute(); focus(v.steps.length ? '[name="pred.steps.' + Math.max(0, Math.min(Number(b.getAttribute("data-i")), v.steps.length - 1)) + '.dose"]' : '[data-act="step-add"]'); }
        else if (act === "print-again") { if (S.printed) openPrintTabWithHtml(S.printed); }
      });
    });
    m.querySelectorAll(".cal-seg [data-calc]").forEach(function (b) {
      b.addEventListener("click", function () { keep(); var c = b.getAttribute("data-calc"); if (c === S.calc) return; S.calc = c; S.err = ""; S.msg = null; S.res = null; paint(true); compute(); var x = S.mount.querySelector('[data-calc="' + c + '"]'); if (x) x.focus(); });
    });
    var f = m.querySelector("#cal-form"); if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); save(); });
    f.addEventListener("input", function (ev) {
      var el = ev.target; if (!el || !el.name) return;
      if (el.name.indexOf("war.pack.") === 0) packInput(el.name, el.value); else setPath(el.name, el.value);
      if (/^lev\.d[123]$/.test(el.name)) { var n = el.name.slice(5); m.querySelectorAll('[name^="lev.days."] option[value="' + n + '"]').forEach(function (o) { o.textContent = "Dose " + n + " · " + (el.value || "?") + " mcg"; }); }
      if (el.name === "war.strengths") { var pk = m.querySelector("#cal-pack"); if (pk) pk.innerHTML = packRowsHtml(S.v.war); }
      if (S.msg) { S.msg = null; var ok = m.querySelector(".cal-ok"); if (ok) ok.remove(); }
      if (el.name.indexOf("pat.") === 0 && el.name !== "pat.start") { if (el.name === "pat.name") lookupPatient("name"); return; } // the patient does not change the plan
      later();
    });
    f.addEventListener("change", function (ev) {
      var el = ev.target; if (!el || !el.name) return;
      if (el.name === "pat.id") { var n = normaliseMalteseId(el.value); if (n !== el.value.trim()) el.value = n; S.pat.id = el.value; lookupPatient("id"); return; }
      if (el.name === "lev.mode") { keep(); levMode(S.v.lev, el.value, S.levModeShown || "alt2"); S.levModeShown = el.value; paint(true); compute(); return; }
      if (el.name === "war.mode") { keep(); paint(true); compute(); return; }
      if (el.name === "ins.type") { keep(); if (el.value === "pen") { S.v.ins.unitsPerCont = "300"; S.v.ins.contsPerBox = "5"; } else { S.v.ins.unitsPerCont = "1000"; S.v.ins.contsPerBox = "1"; } paint(true); compute(); return; }
      if (el.tagName === "SELECT" || el.name === "pat.start") { setPath(el.name, el.value); compute(); }
    });
  }
  function wireRecords(x) {
    if (!x) return;
    x.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act");
        if (act === "rec") { var id = b.getAttribute("data-id"); if (String(S.open) === id) { S.open = null; paintRecords(); return; } openRecord(id); }
        else if (act === "rec-close") { var was = S.open; S.open = null; paintRecords(); var r = S.mount.querySelector('.cal-row[data-id="' + was + '"]'); if (r) r.focus(); }
        else if (act === "reprint") { if (S.openRec && S.openRec.data) { var html = reprintHtml(S.openRec, S.openRec.data); if (html) openPrintTabWithHtml(html); else E.toast("Printing again is not available for this calculator.", "warning"); } }
      });
    });
    var q = x.querySelector("#cal-q");
    if (q) q.addEventListener("input", function () { S.q = q.value; clearTimeout(S.qT); S.qT = setTimeout(paintRecords, 120); });
  }
  async function openRecord(id) {
    S.open = id; S.openRec = null; S.openErr = ""; paintRecords();
    var r = S.mount.querySelector('.cal-row[data-id="' + id + '"]'); if (r) r.focus();
    try {
      var x = await E.apiFetch("/pharmacy-calc/records/" + encodeURIComponent(String(id)), { method: "GET" });
      var rec = (x && x.record) || (x && Array.isArray(x.records) && x.records[0]) || null;
      if (!rec) throw new Error("The saved plan was not found");
      var data = null; try { data = typeof rec.calc_data_json === "string" ? JSON.parse(rec.calc_data_json) : rec.calc_data_json; } catch (e) { data = null; }
      rec.data = data;
      if (String(S.open) === String(id)) S.openRec = rec;
    } catch (e) { if (String(S.open) === String(id)) S.openErr = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not open the saved plan"); }
    if (E.state.activeModuleId !== "calreg") return;
    paintRecords(); var r2 = S.mount.querySelector('.cal-row[data-id="' + id + '"]'); if (r2) r2.focus();
  }

  async function save() {
    if (S.saving) return;
    keep();
    var p = S.pat; S.err = ""; S.msg = null;
    var name = String(p.name || "").trim(), idCard = normaliseMalteseId(String(p.id || "").trim());
    if (idCard !== String(p.id || "").trim()) p.id = idCard;
    var res = await current(), r = res && res.r, calc = res && res.calc;
    if (!r || calc !== S.calc) { paint(true); return; }
    if (r.error) S.err = "Check the plan first: " + r.error + " Nothing was saved.";
    else if (!name) S.err = "Write the patient's name. Nothing was saved.";
    else if (!idCard) S.err = "Write the patient's ID card number. Nothing was saved.";
    if (S.err) { paint(true); var e1 = S.mount.querySelector(".cal-err"); if (e1 && e1.scrollIntoView) e1.scrollIntoView({ block: "nearest" }); return; }
    var model = r.model;
    var payload = { patient_name: name, id_card: idCard, start_date: p.start, calc_type: calc, calc_data_json: JSON.stringify(model) };
    var user = (E.state && E.state.user) ? E.state.user : null;
    var meta = { pharmacyName: (user && user.location_name) ? user.location_name : ((user && user.org_name) ? user.org_name : ""), patientName: name, idCard: idCard, note: String(p.note || "").trim() };
    var html = PRINT[calc](model, meta);
    S.saving = true; paint(true);
    var saved = false;
    try {
      await E.postOnce("/pharmacy-calc/records", payload, { list: fetchRecords,
        same: function (x) { return x.patient_name === payload.patient_name && x.id_card === payload.id_card && x.calc_type === payload.calc_type && x.start_date === payload.start_date; } });
      saved = true;
    } catch (x) { S.err = E.saveFailText(x) + " The plan was still opened for printing."; }
    // as on the classic screen, the plan is printed whether or not the save went through
    S.printed = html; openPrintTabWithHtml(html);
    S.saving = false;
    if (saved) { S.msg = "Saved for " + name + ". The plan opened in a new tab to print."; E.toast(TYPE_LABEL[calc] + " plan saved for " + name, "success"); }
    paint(true);
    return load();
  }

  E.registerModule({
    id: "calreg", title: "Pharmacy calculators", order: 3, icon: "🧮", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.err = ""; S.msg = null; S.q = ""; S.open = null; S.openRec = null; S.saving = false;
      if (!S.v) S.v = freshValues();
      S.pat = { name: "", id: "", start: todayYmd(), note: "" }; S.levModeShown = S.v.lev.mode;
      css(); paint(); compute(); loadPatients(); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("calreg") < 0) E.UI2_DESTINATIONS.push("calreg");
  if (E.UI2_PARENT) E.UI2_PARENT.calreg = "services";
})();
