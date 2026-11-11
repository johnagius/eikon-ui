(function () {
  "use strict";
  // ---- Roster planner: patterns engine + fill/copy/repeat engine + its components (owner B1) ----
  // Contract: the Director's Phase 0 stub (RP BOARD). Names and shapes as agreed; every function here is real.
  //
  // Words used in shapes:
  //   ymd  = "YYYY-MM-DD" (Malta calendar day)       hm = "HH:MM"
  //   block = { start:hm, end:hm, role_override?:"pharmacist"|"", notes?:"" }
  //   week7 = [Mon..Sun], each day null (off) | block | [block, block] (split)
  //           stored per classic as week entries { off } / { off:false, start, end, role_override } (+ ".b" sibling for a split)
  //   row  = a shift_assignments row as GET /shifts/assignments-range returns it
  //          { id, staff_id, shift_date, start_time, end_time, role_override, notes }
  //   date = { date, start_time, end_time, role_override, notes }  (one entry of POST /shifts/apply-pattern dates[])
  //   skip.why ∈ "closed" | "holiday" | "leave" | "leave-part" | "unavailable" | "past" | "inactive"
  //   (pending leave is NOT a skip: the add carries asked:true and the preview lists it as "asked for leave")
  //
  // Storage (SPEC §2.3, no worker change): each rotation week is an ordinary classic weekly pattern
  //   { id: "rot.<rid>.<k>of<n>.<anchorMonday>", name: "Usual · week A of 2", week: [Sun..Sat], createdAt }
  // so the classic Shifts screen lists, edits and applies it unchanged; the second block of a split day lives in a
  // sibling "<id>.b". provisionalId = week A of the usual rotation. Classic patterns (plain ids) are 1-week rotations.
  // Pattern save: one whole-record PUT /shifts/staff/:id built from the person read fresh just before (1 GET + 1 PUT).
  // Apply (§2.4): the preview comes from 1 GET of the rows in range; then one POST /shifts/apply-plan (W1: all or
  // nothing, ≤ 12 people a request) — or, on a server without it, POST /shifts/apply-pattern per person (Keep = "fill";
  // anything removed = "overwrite" re-sending every row it keeps) — then 1 GET to verify; a write that did not land
  // as intended is put back (only what this write changed). Undo = the same diff back to the snapshot.
  var E = window.EIKON = window.EIKON || {};
  var P = E.rotaPlan = { ready: true, stub: false, version: 1 };

  // ---------------------------------------------------------------------------------------------------------------
  // Dates and words
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], WDS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
  var WDF = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var LETTER = ["A", "B", "C", "D"];
  var YMD = /^\d{4}-\d{2}-\d{2}$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  var dt = function (ymd) { return new Date(ymd + "T12:00:00Z"); };
  var ymdOf = function (d) { return d.toISOString().slice(0, 10); };
  var add = function (ymd, n) { var d = dt(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };
  var days = function (a, b) { return Math.round((dt(b) - dt(a)) / 864e5); };
  var mi = function (ymd) { return (dt(ymd).getUTCDay() + 6) % 7; }; // Monday = 0 … Sunday = 6
  var monday = function (ymd) { return add(ymd, -mi(ymd)); };
  var addMonths = function (ymd, n) { var p = ymd.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1, 12)); var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate(); d.setUTCDate(Math.min(p[2], last)); return ymdOf(d); };
  var monthEnd = function (ymd) { var p = ymd.split("-").map(Number); return ymdOf(new Date(Date.UTC(p[0], p[1], 0, 12))); };
  var hm = function (t) { return String(t == null ? "" : t).trim().slice(0, 5); };
  var mn = function (t) { var p = hm(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); };
  var tm = function (m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  var str = function (v) { return v == null ? "" : String(v); };
  var low = function (s) { return str(s).toLowerCase().trim(); };
  var today = function () { return E.maltaYmd ? E.maltaYmd(new Date()) : ymdOf(new Date()); };
  var dayW = function (ymd) { var d = dt(ymd); return WD[mi(ymd)] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()]; };
  var dateW = function (ymd) { var d = dt(ymd); return d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  var rangeW = function (a, b) {
    if (a === b) return dayW(a) + " " + a.slice(0, 4);
    var x = dt(a), y = dt(b);
    if (a.slice(0, 7) === b.slice(0, 7)) return x.getUTCDate() + " – " + y.getUTCDate() + " " + MON[y.getUTCMonth()] + " " + y.getUTCFullYear();
    if (a.slice(0, 4) === b.slice(0, 4)) return x.getUTCDate() + " " + MON[x.getUTCMonth()] + " – " + y.getUTCDate() + " " + MON[y.getUTCMonth()] + " " + y.getUTCFullYear();
    return dateW(a) + " – " + dateW(b);
  };
  var plural = function (n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); };
  var first = function (n) { var w = str(n).trim().split(/\s+/); while (w.length > 1 && /^(dr|pharm|mr|mrs|ms|miss|fr|prof|sr)\.?$/i.test(w[0])) w.shift(); return w[0] || "Someone"; }; // titles are not first names (Visual S10)
  var listDays = function (ds, max) { max = max || 3; var u = ds.filter(function (d, i) { return ds.indexOf(d) === i; }).sort(); return u.slice(0, max).map(dayW).join(", ") + (u.length > max ? ", …" : ""); };
  var span = function (a, b) { return a + "–" + b; };
  P.words = { day: dayW, date: dateW, range: rangeW, plural: plural, first: first };
  P.dates = { add: add, days: days, monday: monday, addMonths: addMonths, monthEnd: monthEnd, weekday: mi, today: today };

  // ---------------------------------------------------------------------------------------------------------------
  // Blocks, weeks, rotations
  function block(b) {
    if (!b || typeof b !== "object") return null;
    var s = hm(b.start || b.start_time), e = hm(b.end || b.end_time);
    if (!s || !e || b.off === true || b.off === 1 || b.off === "true") return null;
    return { start: s, end: e, role_override: str(b.role_override).trim(), notes: str(b.notes) };
  }
  function blocks(day) { // a week7 day -> [block]
    if (!day) return [];
    if (Array.isArray(day)) return day.map(block).filter(Boolean);
    var b = block(day); return b ? [b] : [];
  }
  function dayOut(list) { return !list.length ? null : list.length === 1 ? list[0] : list.slice(); }
  function week7(w) { var o = []; for (var d = 0; d < 7; d++) o.push(dayOut(blocks(w && w[d]))); return o; }
  // classic week (Sun..Sat entries) <-> week7 (Mon..Sun blocks)
  function fromClassic(cw) { var o = []; for (var d = 0; d < 7; d++) { var e = cw && cw[(d + 1) % 7]; o.push(isOff(e) ? null : block(e)); } return o; }
  function toClassic(w, bi) {
    var o = [];
    for (var c = 0; c < 7; c++) {
      var b = blocks(w && w[(c + 6) % 7])[bi || 0];
      if (!b) { o.push({ off: true }); continue; }
      var e = { off: false, start: b.start, end: b.end, role_override: b.role_override || "" };
      if (b.notes) e.notes = b.notes;
      o.push(e);
    }
    return o;
  }
  function isOff(e) {
    e = e && typeof e === "object" ? e : {};
    var v = e.off;
    if (v === true || v === 1 || (typeof v === "string" && /^(true|1|yes|y|on)$/i.test(v.trim()))) return true;
    return !hm(e.start || e.start_time) || !hm(e.end || e.end_time);
  }
  var ROT = /^rot\.([A-Za-z0-9_-]{1,24})\.(\d)of(\d)\.(\d{4}-\d{2}-\d{2})(\.b)?$/;
  var baseName = function (n) { return str(n).replace(/\s*·\s*second shift$/, "").replace(/\s*·\s*week [A-D] of \d.*$/, "").trim() || "Usual"; };
  P.newRid = function () { return Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-2); };

  // parse(patterns_json string|object) -> { usual: rid|id|null, provisionalId, rotations: [{ rid, n, anchor, weeks: [week7],
  //   names, ids, split: [week7|null], name, createdAt }], plain: [{ id, name, week: week7, createdAt }], extra }
  P.parse = function (pj) {
    var o = pj;
    if (typeof o === "string") { try { o = JSON.parse(o || "{}"); } catch (e) { o = {}; } }
    if (Array.isArray(o)) o = { patterns: o }; // an older row's '[]' default
    o = o && typeof o === "object" ? o : {};
    var list = Array.isArray(o.patterns) ? o.patterns : [], rot = {}, order = [], plain = [];
    list.forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var id = str(p.id), m = ROT.exec(id);
      if (!m || +m[2] < 1 || +m[2] > +m[3] || +m[3] > 4) { plain.push({ id: id, name: str(p.name || "Pattern"), week: fromClassic(p.week), createdAt: p.createdAt || null }); return; }
      var r = rot[m[1]];
      if (!r) { r = rot[m[1]] = { rid: m[1], n: +m[3], anchor: m[4], weeks: [], names: [], ids: [], split: [], name: baseName(p.name), createdAt: p.createdAt || null }; order.push(m[1]); }
      var k = +m[2] - 1;
      if (m[5]) r.split[k] = fromClassic(p.week);
      else { r.weeks[k] = fromClassic(p.week); r.names[k] = str(p.name); r.ids[k] = id; if (k === 0) r.name = baseName(p.name); }
    });
    var rotations = order.map(function (k) {
      var r = rot[k];
      for (var i = 0; i < r.n; i++) {
        var w = r.weeks[i] || [null, null, null, null, null, null, null], s = r.split[i] || null;
        r.weeks[i] = w.map(function (b, d) { return dayOut([b, s && s[d]].filter(Boolean)); });
        if (!r.ids[i]) r.ids[i] = "rot." + r.rid + "." + (i + 1) + "of" + r.n + "." + r.anchor;
        r.split[i] = s;
      }
      return r;
    });
    var prov = o.provisionalId != null && o.provisionalId !== "" ? str(o.provisionalId) : null, usual = null;
    rotations.forEach(function (r) { if (r.ids.indexOf(prov) >= 0) usual = r.rid; });
    if (!usual && prov) plain.forEach(function (p) { if (p.id === prov) usual = p.id; });
    if (!usual && !prov && list[0]) { var f = str(list[0].id), mm = ROT.exec(f); usual = mm ? mm[1] : f || null; } // classic: no provisional = the first
    var extra = {}; Object.keys(o).forEach(function (k) { if (k !== "patterns" && k !== "provisionalId") extra[k] = o[k]; });
    return { usual: usual, provisionalId: prov, rotations: rotations, plain: plain, extra: extra };
  };

  // toPatternsJson(state) -> string { patterns:[{id,name,week,createdAt}], provisionalId } that classic reads as it is.
  // state = parse() shape, edited: rotations[i] { rid, n, anchor (moved to its Monday), weeks (week7 × n), name }, plain[], usual.
  P.toPatternsJson = function (st) {
    st = st || {};
    var pats = [], prov = null, now = Date.now(), rots = (st.rotations || []).slice();
    (st.plain || []).forEach(function (p) {
      var w = week7(p.week);
      if (w.some(function (d) { return Array.isArray(d); })) { // a split day cannot live in a plain pattern: a 1-week rotation, same name
        rots.push({ rid: P.newRid(), n: 1, anchor: monday(today()), weeks: [w], name: p.name, createdAt: p.createdAt, was: p.id });
        return;
      }
      pats.push({ id: str(p.id), name: str(p.name || "Pattern"), week: toClassic(w, 0), createdAt: p.createdAt || now });
      if (st.usual != null && str(st.usual) === str(p.id)) prov = str(p.id);
    });
    rots.forEach(function (r) {
      var n = Math.max(1, Math.min(4, parseInt(r.n || (r.weeks || []).length, 10) || 1)), anchor = monday(YMD.test(str(r.anchor)) ? r.anchor : today());
      var rid = /^[A-Za-z0-9_-]{1,24}$/.test(str(r.rid)) ? str(r.rid) : P.newRid(), name = baseName(r.name || (r.names && r.names[0]) || "Usual");
      for (var k = 0; k < n; k++) {
        var w = week7((r.weeks || [])[k]), id = "rot." + rid + "." + (k + 1) + "of" + n + "." + anchor, nm = n > 1 ? name + " · week " + LETTER[k] + " of " + n : name;
        pats.push({ id: id, name: nm, week: toClassic(w, 0), createdAt: r.createdAt || now });
        if (w.some(function (d) { return Array.isArray(d) && d.length > 1; })) pats.push({ id: id + ".b", name: nm + " · second shift", week: toClassic(w, 1), createdAt: r.createdAt || now });
        if (k === 0 && st.usual != null && (str(st.usual) === str(r.rid) || (r.was && str(st.usual) === str(r.was)))) prov = id;
      }
    });
    if (!prov && pats.length) prov = pats[0].id;
    return JSON.stringify(Object.assign({}, st.extra || {}, { patterns: pats, provisionalId: prov }));
  };

  // One rotation from a parse() entry, a plain pattern, or a bare { weeks | week, n, anchor }.
  function asRotation(r) {
    if (!r) return null;
    if (Array.isArray(r.weeks) && r.weeks.length) {
      var n = Math.max(1, Math.min(52, parseInt(r.n || r.weeks.length, 10) || 1)), ws = [];
      for (var k = 0; k < n; k++) ws.push(week7(r.weeks[k]));
      return { rid: r.rid || null, n: n, anchor: YMD.test(str(r.anchor)) ? monday(r.anchor) : null, weeks: ws, name: r.name || "" };
    }
    if (Array.isArray(r.week)) return { rid: r.id || r.rid || null, n: 1, anchor: null, weeks: [week7(r.week)], name: r.name || "" };
    return null;
  }
  P.asRotation = asRotation;
  // The week of the rotation a date falls in: ((weeks between its Monday and the anchor Monday) mod n).
  P.weekIndex = function (ymd, anchor, n) {
    if (!n || n <= 1 || !anchor) return 0;
    var w = Math.floor(days(monday(anchor), monday(ymd)) / 7);
    return ((w % n) + n) % n;
  };
  // The usual rotation of a person (staff row), or null.
  P.usualOf = function (person) {
    var s = P.parse(person && person.patterns_json);
    var r = s.rotations.filter(function (x) { return x.rid === s.usual; })[0] || s.plain.filter(function (x) { return x.id === s.usual; })[0] || s.rotations[0] || s.plain[0];
    return r ? Object.assign(asRotation(r), { rid: r.rid || r.id, name: r.name }) : null;
  };

  // Validation in words ("Saturday: end must be after start"), [] when fine.
  P.validate = function (rot) {
    var r = asRotation(rot), out = [];
    if (!r) return ["Add at least one day"];
    (rot.weeks || [rot.week]).forEach(function (w, k) {
      (w || []).forEach(function (day, d) {
        var raw = Array.isArray(day) ? day : day ? [day] : [], lab = (r.n > 1 ? "Week " + LETTER[k] + " " : "") + WDF[d];
        if (raw.length > 2) out.push(lab + ": at most two shifts a day");
        raw.forEach(function (b) {
          if (!b || b.off) return;
          var s = hm(b.start || b.start_time), e = hm(b.end || b.end_time);
          if (!s && !e) return;
          if (!HM.test(s) || !HM.test(e)) out.push(lab + ": write both times, like 08:00");
          else if (mn(e) <= mn(s)) out.push(lab + ": end must be after start");
        });
        var bs = blocks(day);
        if (bs.length === 2 && mn(bs[0].start) < mn(bs[1].end) && mn(bs[1].start) < mn(bs[0].end)) out.push(lab + ": the two shifts overlap");
      });
    });
    if (!out.length && !r.weeks.some(function (w) { return w.some(function (d) { return blocks(d).length; }); })) out.push("Add at least one day");
    return out.filter(function (x, i) { return out.indexOf(x) === i; });
  };

  // Plain summary: "Mon–Fri 08:00–14:00 · Saturdays 08:00–13:00 every other week (next on 21 Nov)".
  P.summary = function (rot, from) {
    var r = asRotation(rot); if (!r) return "No usual week yet";
    from = from || today();
    var desc = [], anchor = r.anchor || monday(from);
    for (var d = 0; d < 7; d++) {
      var per = r.weeks.map(function (w) { return blocks(w[d]).map(function (b) { return span(b.start, b.end) + (b.role_override === "pharmacist" ? " (as pharmacist)" : ""); }).join(" + "); });
      var on = per.map(function (x, k) { return x ? k : -1; }).filter(function (k) { return k >= 0; });
      if (!on.length) { desc.push(null); continue; }
      var same = on.every(function (k) { return per[k] === per[on[0]]; });
      if (on.length === r.n && same) { desc.push({ every: true, text: per[on[0]] }); continue; }
      if (same) {
        var next = null, dd = add(monday(from), d);
        for (var i = 0; i < r.n * 7 + 7 && !next; i += 7) { var x = add(dd, i); if (x >= from && on.indexOf(P.weekIndex(x, anchor, r.n)) >= 0) next = x; }
        var how = r.n === 2 ? "every other week" : on.length === 1 ? "every " + ["", "", "2nd", "3rd", "4th"][r.n] + " week" : "in weeks " + on.map(function (k) { return LETTER[k]; }).join(" and ") + " of " + r.n;
        desc.push({ every: false, text: per[on[0]] + " " + how + (next ? " (next on " + dayW(next).slice(4) + ")" : "") });
        continue;
      }
      desc.push({ every: false, text: per.map(function (x, k) { return x ? x + " (week " + LETTER[k] + ")" : ""; }).filter(Boolean).join(", ") });
    }
    var out = [], d0 = 0;
    while (d0 < 7) {
      if (!desc[d0]) { d0++; continue; }
      if (desc[d0].every) {
        var e = d0; while (e + 1 < 7 && desc[e + 1] && desc[e + 1].every && desc[e + 1].text === desc[d0].text) e++;
        out.push((e > d0 + 1 ? WD[d0] + "–" + WD[e] : e === d0 + 1 ? WD[d0] + ", " + WD[e] : WD[d0]) + " " + desc[d0].text);
        d0 = e + 1;
      } else { out.push(WDS[d0] + " " + desc[d0].text); d0++; }
    }
    return out.length ? out.join(" · ") : "No usual week yet";
  };

  // Rotations built from other things (all pure).
  // rotationFromWeekdays({ weekdays: [1..7 Mon=1], every: 1..n, anchor: ymd, block }) -> rotation (week A = those days)
  P.rotationFromWeekdays = function (o) {
    o = o || {};
    var n = Math.max(1, Math.min(52, parseInt(o.every, 10) || 1)), b = block(o.block) || null, wk = [], set = {};
    (o.weekdays || []).forEach(function (x) { set[(parseInt(x, 10) - 1 + 7) % 7] = 1; });
    var w0 = []; for (var d = 0; d < 7; d++) w0.push(set[d] && b ? Object.assign({}, b) : null);
    wk.push(w0); for (var k = 1; k < n; k++) wk.push([null, null, null, null, null, null, null]);
    return { rid: null, n: n, anchor: monday(YMD.test(str(o.anchor)) ? o.anchor : today()), weeks: wk, names: [], ids: [], split: [] };
  };
  // rotationFromRows(rows of one person, fromMonday, weeks 1..n) -> rotation (several shifts a day kept, notes and roles too)
  P.rotationFromRows = function (rows, fromMonday, weeks) {
    var n = Math.max(1, parseInt(weeks, 10) || 1), m = monday(YMD.test(str(fromMonday)) ? fromMonday : today()), wk = [];
    for (var k = 0; k < n; k++) wk.push([[], [], [], [], [], [], []]);
    (rows || []).slice().sort(byTime).forEach(function (r) {
      var i = days(m, r.shift_date || r.date); if (i < 0 || i >= n * 7) return;
      var b = block(r); if (b) wk[Math.floor(i / 7)][i % 7].push(b);
    });
    return { rid: null, n: n, anchor: m, weeks: wk.map(function (w) { return w.map(dayOut); }), names: [], ids: [], split: [], fromRows: true };
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Expansion
  var keyOf = function (r) { return [r.shift_date || r.date, hm(r.start_time || r.start), hm(r.end_time || r.end), str(r.role_override), str(r.notes)].join("|"); };
  function byTime(a, b) { var x = (a.shift_date || a.date) + hm(a.start_time || a.start), y = (b.shift_date || b.date) + hm(b.start_time || b.start); return x < y ? -1 : x > y ? 1 : 0; }
  var yes = function (v) { return v === true || v === 1 || v === "1" || v === "true"; };
  function dayOpen(ymd, hours, settings) {
    if (E.teamCover) return E.teamCover(ymd, { hours: hours || {}, settings: settings || {}, shifts: [], staff: [], leaves: [] });
    var ph = E.maltaHoliday ? E.maltaHoliday(ymd) : "", ov = hours && hours.overrides && hours.overrides[ymd];
    if (ov) return { closed: yes(ov.closed), holiday: ph || null, open: hm(ov.open), close: hm(ov.close) };
    return { closed: !!ph, holiday: ph || null, open: "07:30", close: "19:30" };
  }
  var leaveSpan = function (l, ymd) {
    if (E.rotaCheck && E.rotaCheck.leaveSpan) return E.rotaCheck.leaveSpan(l, ymd);
    if (!l || !(l.start_date <= ymd && (l.end_date || l.start_date) >= ymd)) return null;
    var a = l.start_time && l.start_date === ymd ? mn(l.start_time) : 0, z = l.end_time && (l.end_date || l.start_date) === ymd ? mn(l.end_time) : 1440;
    return z > a ? [a, z] : [0, 1440];
  };
  var LT = { annual: "annual leave", sick: "sick leave", urgent_family: "urgent family leave", maternity: "maternity leave", paternity: "paternity leave", parental: "parental leave", miscarriage: "miscarriage leave", other: "leave" };
  var leaveW = function (t) { return LT[low(t)] || "leave"; };
  function availOf(o) { var s = (o && o.settings) || {}; return (o && o.avail) || (s.rota && s.rota.avail) || {}; }
  function availWords(avail, person, ymd, st, et) {
    if (E.rotaCheck && E.rotaCheck.availWords) return E.rotaCheck.availWords({ avail: avail }, person, ymd, st, et);
    var a = avail && avail[str(person && person.id)]; if (!a) return "";
    var byDate = a.d && a.d[ymd] != null, v = byDate ? a.d[ymd] : a.w && a.w[String(dt(ymd).getUTCDay())];
    if (v == null || v === "" || v === "yes") return "";
    if (v === "no") return first(person.full_name) + " can't work " + (byDate ? "on " + dayW(ymd) : WDS[mi(ymd)]);
    if (v && v.from && v.to && st != null && mn(st) >= mn(v.from) && mn(et) <= mn(v.to)) return "";
    return v && v.from ? first(person.full_name) + " can only work " + hm(v.from) + "–" + hm(v.to) + (byDate ? " on " + dayW(ymd) : " on " + WDS[mi(ymd)]) : "";
  }

  // expand({ person, rotation | pattern | rows, from, to, hours, settings, leaves, avail, existing: [row], mode, anyway,
  //   days: [ymd] (days the operation targets even with nothing to add: Clear, Replace of a copy), rules: false (no skipping),
  //   noPast }) -> { staff_id, name, from, to, mode, add: [date & { staff_id, asked?, week?, trimmed? }], keep: [row],
  //   remove: [row], skip: [{ date, why, words }], trim: [{ date, words }], asked: [{ date, words }], snapshot: [row] }
  // Keep (default): a day that already has any shift keeps it and gets nothing. Replace: a targeted day becomes what is
  // asked (a shift equal to one asked for stays, same id); days skipped by the rules keep what they have.
  P.expand = function (o) {
    o = o || {};
    var person = o.person || {}, sid = person.id, from = str(o.from), to = str(o.to) || from;
    var out = { staff_id: sid == null ? null : sid, name: str(person.full_name), from: from || null, to: to || null, mode: o.mode === "replace" ? "replace" : "keep", add: [], keep: [], remove: [], skip: [], trim: [], asked: [], snapshot: [] };
    if (!YMD.test(from) || !YMD.test(to) || to < from) return out;
    var mode = out.mode, rules = o.rules !== false, rot = asRotation(o.rotation || o.pattern);
    var existing = (o.existing || []).filter(function (r) { return str(r.staff_id) === str(sid) && r.shift_date >= from && r.shift_date <= to; }).slice().sort(byTime);
    out.snapshot = existing.slice();
    var exBy = {}; existing.forEach(function (r) { (exBy[r.shift_date] = exBy[r.shift_date] || []).push(r); });
    var want = {}, wk = {};
    if (rot) {
      var anchor = rot.anchor || monday(from);
      for (var d = from; d <= to; d = add(d, 1)) {
        var k = P.weekIndex(d, anchor, rot.n), bs0 = blocks(rot.weeks[k][mi(d)]);
        if (bs0.length) { want[d] = bs0; if (rot.n > 1) wk[d] = LETTER[k] || String(k + 1); }
      }
    } else (o.rows || []).forEach(function (r) {
      var dd = r.date || r.shift_date, b = block(r); if (!YMD.test(str(dd)) || dd < from || dd > to || !b) return;
      (want[dd] = want[dd] || []).push(b);
    });
    var targeted = {}; (o.days || []).forEach(function (x) { if (YMD.test(str(x)) && x >= from && x <= to) targeted[x] = 1; });
    var leaves = (o.leaves || []).filter(function (l) { return str(l.staff_id) === str(sid); });
    var avail = availOf(o), inactive = person.is_active === 0 || person.is_active === false || person.is_active === "0";
    var past = o.noPast ? today() : "";
    Object.keys(want).concat(Object.keys(targeted)).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort().forEach(function (day) {
      var bs = (want[day] || []).map(function (b) { return Object.assign({}, b); }), ex = exBy[day] || [], skipped = null;
      if (bs.length && rules) {
        if (inactive) skipped = { date: day, why: "inactive", words: first(person.full_name) + " is not active" };
        else if (past && day < past) skipped = { date: day, why: "past", words: "In the past" };
        else {
          var c = dayOpen(day, o.hours, o.settings);
          if (c && c.closed) skipped = c.holiday ? { date: day, why: "holiday", words: "Public holiday (" + c.holiday + ")" } : { date: day, why: "closed", words: "The pharmacy is closed" };
        }
        if (!skipped) {
          var app = leaves.filter(function (l) { return low(l.status) === "approved" && leaveSpan(l, day); });
          var whole = app.filter(function (l) { var s = leaveSpan(l, day); return s[0] <= 0 && s[1] >= 1440; })[0];
          if (whole) skipped = { date: day, why: "leave", words: first(person.full_name) + " is on " + leaveW(whole.leave_type) };
          else if (app.length) {
            var kept = [];
            bs.forEach(function (b) {
              var s = mn(b.start), e = mn(b.end), parts = [[s, e]];
              app.forEach(function (l) { var ls = leaveSpan(l, day), nx = []; parts.forEach(function (p) { if (ls[1] <= p[0] || ls[0] >= p[1]) nx.push(p); else { if (ls[0] > p[0]) nx.push([p[0], ls[0]]); if (ls[1] < p[1]) nx.push([ls[1], p[1]]); } }); parts = nx; });
              parts.sort(function (x, y) { return (y[1] - y[0]) - (x[1] - x[0]); });
              if (parts.length && parts[0][1] - parts[0][0] === e - s) kept.push(b);
              else if (parts.length && parts[0][1] - parts[0][0] >= 60) {
                var nb = Object.assign({}, b, { start: tm(parts[0][0]), end: tm(parts[0][1]), trimmed: true });
                out.trim.push({ date: day, words: dayW(day) + " " + span(nb.start, nb.end) + " (" + leaveW(app[0].leave_type) + " " + span(hm(app[0].start_time) || "00:00", hm(app[0].end_time) || "24:00") + ")" });
                kept.push(nb);
              }
            });
            if (!kept.length) skipped = { date: day, why: "leave-part", words: first(person.full_name) + " is on " + leaveW(app[0].leave_type) + " for most of the day" };
            bs = kept;
          }
        }
        if (!skipped && !o.anyway) {
          var aw = ""; bs.some(function (b) { aw = availWords(avail, person, day, b.start, b.end); return !!aw; });
          if (aw) skipped = { date: day, why: "unavailable", words: aw };
        }
        if (!skipped) {
          var pend = leaves.filter(function (l) { return low(l.status) === "pending" && leaveSpan(l, day); })[0];
          if (pend) { out.asked.push({ date: day, words: first(person.full_name) + " asked for " + leaveW(pend.leave_type) + " on " + dayW(day) }); bs.forEach(function (b) { b.asked = true; }); }
        }
      }
      if (skipped) { out.skip.push(skipped); return; }
      if (mode === "keep") {
        if (ex.length) { if (bs.length) ex.forEach(function (r) { out.keep.push(r); }); return; }
        bs.forEach(function (b) { out.add.push(dateRow(day, b, sid, wk[day])); });
        return;
      }
      var left = ex.slice();
      bs.forEach(function (b) {
        var row = dateRow(day, b, sid, wk[day]), j = -1;
        left.some(function (r, i) { if (keyOf(r) === keyOf(row)) { j = i; return true; } return false; });
        if (j >= 0) { out.keep.push(left[j]); left.splice(j, 1); } else out.add.push(row);
      });
      left.forEach(function (r) { out.remove.push(r); });
    });
    return out;
  };
  function dateRow(d, b, sid, week) {
    var r = { date: d, start_time: b.start, end_time: b.end, role_override: b.role_override || "", notes: b.notes || "", staff_id: sid };
    if (b.asked) r.asked = true; if (week) r.week = week; if (b.trimmed) r.trimmed = true;
    return r;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Fill, copy and repeat (§2.5) — each -> [ expansion ] (one per person).
  // data = { staff: [person], shifts: [row] (existing, the range), leaves, hours, settings, avail }
  function staffList(data) { var s = data && data.staff; return Array.isArray(s) ? s : Object.keys(s || {}).map(function (k) { return s[k]; }); }
  function personOf(data, sid) { return staffList(data).filter(function (p) { return str(p.id) === str(sid); })[0] || { id: isNaN(+sid) ? sid : +sid, full_name: "Staff #" + sid }; }
  function common(o, person, from, to, extra) {
    var d = o.data || {};
    return Object.assign({ person: person, from: from, to: to, hours: d.hours, settings: d.settings, leaves: d.leaves, avail: d.avail, existing: d.shifts, mode: o.mode, anyway: o.anyway, rules: o.rules, noPast: o.noPast }, extra || {});
  }
  // repeat({ rows, srcFrom, srcTo, times | until, people: [person], data, mode, align: "weekday"|"date", to: { from }, everyDays })
  //   Copies the source days forward: a single day repeats on the next days (everyDays: 7 = the same weekday each week),
  //   a week or 2–4 weeks every span; a whole month month by month, keeping the weekdays (align "weekday", default) or
  //   the dates. to: { from } copies once to another start (copy a day / week / month elsewhere).
  //   Replace: each target window becomes the copy (a source day with nothing clears the target day).
  P.repeat = function (o) {
    o = o || {};
    var a = str(o.srcFrom), b = str(o.srcTo) || a; if (!YMD.test(a) || !YMD.test(b) || b < a) return [];
    var len = days(a, b) + 1, isMonth = a.slice(8) === "01" && b === monthEnd(a), until = YMD.test(str(o.until)) ? o.until : null;
    var times = Math.max(0, Math.min(520, parseInt(o.times, 10) || 0)), every = Math.max(1, parseInt(o.everyDays, 10) || len);
    var src = (o.rows || []).filter(function (r) { return r.shift_date >= a && r.shift_date <= b; });
    var people = o.people && o.people.length ? o.people : staffList(o.data).filter(function (p) { return src.some(function (r) { return str(r.staff_id) === str(p.id); }); });
    var copies = [], missing = []; // { map(sourceDay) -> target day | null, from, to }; missing: a 5th weekday the target month has not
    var shift = function (off) { return function (d) { return add(d, off); }; };
    var monthMap = function (ms) { // the same weekday in the same week of the month (2nd Tuesday -> 2nd Tuesday), or the same date
      if (o.align === "date") return function (d) { var t = ms.slice(0, 8) + d.slice(8); return YMD.test(t) && t <= monthEnd(ms) ? t : null; };
      return function (d) { var nth = Math.floor((+d.slice(8) - 1) / 7), f1 = add(ms, (mi(d) - mi(ms) + 7) % 7), t = add(f1, 7 * nth); if (t.slice(0, 7) === ms.slice(0, 7)) return t; missing.push({ date: d, nth: nth, wd: mi(d), month: ms }); return null; };
    };
    if (o.to && YMD.test(str(o.to.from))) {
      var t0 = o.to.from;
      if (isMonth && t0.slice(8) === "01") copies.push({ map: monthMap(t0), from: t0, to: monthEnd(t0) });
      else copies.push({ map: shift(days(a, t0)), from: t0, to: add(b, days(a, t0)) });
    } else if (isMonth) {
      for (var m = 1; m <= (times || 600); m++) {
        var ms = addMonths(a, m); if (until && ms > until) break;
        copies.push({ map: monthMap(ms), from: ms, to: until && monthEnd(ms) > until ? until : monthEnd(ms) });
        if (!times && !until) break;
      }
    } else {
      for (var k = 1; k <= (times || 5200); k++) {
        var f = add(a, every * k); if (until && f > until) break;
        copies.push({ map: shift(every * k), from: f, to: until && add(b, every * k) > until ? until : add(b, every * k) });
        if (!times && !until) break;
      }
    }
    if (!copies.length) return [];
    var from = copies[0].from, to = copies[copies.length - 1].to;
    return people.map(function (p) {
      var rows = [], dayset = [];
      copies.forEach(function (c) {
        src.forEach(function (r) {
          if (str(r.staff_id) !== str(p.id)) return;
          var nd = c.map(r.shift_date); if (!nd || nd < c.from || nd > c.to) return;
          rows.push({ date: nd, start_time: r.start_time, end_time: r.end_time, role_override: r.role_override || "", notes: r.notes || "" });
        });
        if (o.mode === "replace") for (var x = a; x <= b; x = add(x, 1)) { var t = c.map(x); if (t && t >= c.from && t <= c.to) dayset.push(t); }
      });
      missing.length = 0;
      copies.forEach(function (c) { src.forEach(function (r) { if (str(r.staff_id) === str(p.id)) c.map(r.shift_date); }); });
      var x = P.expand(common(o, p, from, to, { rows: rows, days: dayset })), seen = {};
      missing.forEach(function (m) { // "No 5th Tuesday in March" — said, never dropped quietly
        var k = m.month + m.wd; if (seen[k]) return; seen[k] = 1; var mm = dt(m.month);
        x.skip.push({ date: m.month, why: "no-day", words: "No " + ["1st", "2nd", "3rd", "4th", "5th"][m.nth] + " " + WDF[m.wd] + " in " + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][mm.getUTCMonth()] });
      });
      return x;
    });
  };
  // paste({ rows, cells: [{ staff_id, date }] (the copied rectangle), target: { staff_id?, date }, data, mode })
  //   The copied people × days land at the target day (top-left); one copied person onto another when target.staff_id
  //   is given. Replace: a copied empty cell clears its target cell.
  P.paste = function (o) {
    o = o || {}; var cells = o.cells || []; if (!cells.length || !o.target || !YMD.test(str(o.target.date))) return [];
    var d0 = cells.map(function (c) { return c.date; }).sort()[0], off = days(d0, o.target.date);
    var ppl = cells.map(function (c) { return str(c.staff_id); }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var onto = o.target.staff_id != null && ppl.length === 1 ? str(o.target.staff_id) : null;
    return ppl.map(function (sid) {
      var to = onto || sid, mine = cells.filter(function (c) { return str(c.staff_id) === sid; });
      var tdays = mine.map(function (c) { return add(c.date, off); }).sort();
      var rows = (o.rows || []).filter(function (r) { return str(r.staff_id) === sid && mine.some(function (c) { return c.date === r.shift_date; }); })
        .map(function (r) { return { date: add(r.shift_date, off), start_time: r.start_time, end_time: r.end_time, role_override: r.role_override || "", notes: r.notes || "" }; });
      return P.expand(common(o, personOf(o.data, to), tdays[0], tdays[tdays.length - 1], { rows: rows, days: o.mode === "replace" ? tdays : [] }));
    });
  };
  // setHours({ cells: [{ staff_id, date }], block, data, mode })  one block on every selected cell (Keep: only empty cells)
  P.setHours = function (o) {
    o = o || {}; var b = block(o.block); if (!b) return [];
    return groupCells(o.cells).map(function (g) {
      return P.expand(common(o, personOf(o.data, g.sid), g.days[0], g.days[g.days.length - 1], { rows: g.days.map(function (d) { return { date: d, start_time: b.start, end_time: b.end, role_override: b.role_override, notes: b.notes }; }), days: o.mode === "replace" ? g.days : [] }));
    });
  };
  // clear({ cells, data }) -> every shift on the selected cells goes (Replace with nothing; no rules)
  P.clear = function (o) {
    o = o || {};
    return groupCells(o.cells).map(function (g) { return P.expand(common(Object.assign({}, o, { mode: "replace", rules: false }), personOf(o.data, g.sid), g.days[0], g.days[g.days.length - 1], { rows: [], days: g.days })); });
  };
  function groupCells(cells) {
    var by = {}, order = [];
    (cells || []).forEach(function (c) { if (!YMD.test(str(c.date))) return; var s = str(c.staff_id); if (!by[s]) { by[s] = []; order.push(s); } if (by[s].indexOf(c.date) < 0) by[s].push(c.date); });
    return order.map(function (s) { return { sid: s, days: by[s].sort() }; });
  }
  // lastWeek({ monday, people, data, mode }) — "Same as last week": data.shifts holds the week before too.
  P.lastWeek = function (o) {
    o = o || {}; var m = monday(YMD.test(str(o.monday)) ? o.monday : today()), pm = add(m, -7);
    return P.repeat(Object.assign({}, o, { srcFrom: pm, srcTo: add(pm, 6), rows: ((o.data && o.data.shifts) || []).filter(function (r) { return r.shift_date >= pm && r.shift_date < m; }), to: { from: m } }));
  };
  // pattern({ people, from, to, data, mode, rotation? }) — each person's usual pattern (or the given rotation) over a range.
  P.pattern = function (o) {
    o = o || {};
    return (o.people || []).map(function (p) { var r = o.rotation || P.usualOf(p); var x = P.expand(common(o, p, o.from, o.to, r ? { rotation: r } : { rows: [] })); if (!r) x.noPattern = true; return x; });
  };
  // weekdays({ people, from, to, weekdays: [1..7], every: 1|2|n, anchor?, block, data, mode })  Mon–Fri / weekends / any set
  P.weekdays = function (o) {
    o = o || {}; var r = P.rotationFromWeekdays({ weekdays: o.weekdays, every: o.every, anchor: o.anchor || o.from, block: o.block });
    return (o.people || []).map(function (p) { return P.expand(common(o, p, o.from, o.to, { rotation: r })); });
  };
  // days({ people, dates: [ymd], block, data, mode })  scattered days, one shift each
  P.days = function (o) {
    o = o || {}; var cells = [];
    (o.people || []).forEach(function (p) { (o.dates || []).forEach(function (d) { cells.push({ staff_id: p.id, date: d }); }); });
    return P.setHours(Object.assign({}, o, { cells: cells }));
  };
  // gaps({ from, to, role: "pharmacist"|designation, people (who may cover; default: everyone with that role), data })
  //   For every open hour without the role, a shift for the free person with the fewest planned hours (not on leave,
  //   available); a gap nobody can take is in `unfilled` on the first expansion. "pharmacist" = E.teamCover's rule;
  //   another role counts people of that designation. Gap shifts are extra shifts: nothing kept away, nothing removed.
  P.gaps = function (o) {
    o = o || {}; var d = o.data || {}, role = low(o.role || "pharmacist"), from = str(o.from), to = str(o.to) || from;
    if (!YMD.test(from) || !YMD.test(to) || to < from) return [];
    var isRole = function (p) { var g = low(p && p.designation); return role === "pharmacist" ? g === "pharmacist" || g === "locum" : g === role; };
    var cands = (o.people && o.people.length ? o.people : staffList(d).filter(isRole)).filter(function (p) { return !(p.is_active === 0 || p.is_active === false); });
    var shifts = (d.shifts || []).slice(), rows = {}, unfilled = [], planned = {}, avail = availOf(d);
    shifts.forEach(function (r) { planned[str(r.staff_id)] = (planned[str(r.staff_id)] || 0) + Math.max(0, mn(r.end_time) - mn(r.start_time)); });
    for (var day = from; day <= to; day = add(day, 1)) {
      gapsOn(day, role, d, shifts, isRole).forEach(function (g) {
        var free = cands.filter(function (p) {
          if (shifts.some(function (r) { return str(r.staff_id) === str(p.id) && r.shift_date === day && mn(r.start_time) < mn(g.to) && mn(g.from) < mn(r.end_time); })) return false;
          if ((d.leaves || []).some(function (l) { return str(l.staff_id) === str(p.id) && low(l.status) === "approved" && leaveSpan(l, day); })) return false;
          return !availWords(avail, p, day, g.from, g.to);
        }).sort(function (x, y) { return (planned[str(x.id)] || 0) - (planned[str(y.id)] || 0); });
        if (!free.length) { unfilled.push({ date: day, from: g.from, to: g.to, words: "Still no " + (role === "pharmacist" ? "pharmacist" : (DESIGW[role] || role).toLowerCase()) + " " + dayW(day) + " " + span(g.from, g.to) }); return; }
        var p = free[0], r = { staff_id: p.id, shift_date: day, date: day, start_time: g.from, end_time: g.to, role_override: role === "pharmacist" && !isRole(p) ? "pharmacist" : "", notes: "" };
        (rows[str(p.id)] = rows[str(p.id)] || []).push(r); shifts.push(r);
        planned[str(p.id)] = (planned[str(p.id)] || 0) + mn(g.to) - mn(g.from);
      });
    }
    var out = cands.filter(function (p) { return rows[str(p.id)]; }).map(function (p) {
      var x = P.expand(common(Object.assign({}, o, { mode: "keep" }), p, from, to, { rows: rows[str(p.id)], existing: [] }));
      x.keep = []; x.extra = true; x.snapshot = (d.shifts || []).filter(function (r) { return str(r.staff_id) === str(p.id) && r.shift_date >= from && r.shift_date <= to; });
      return x;
    });
    if (!out.length) out.push(Object.assign(P.expand({ person: {}, from: from, to: to, rows: [] }), { staff_id: null }));
    out[0].unfilled = unfilled;
    return out;
  };
  var DESIGW = { assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner" };
  function gapsOn(day, role, d, shifts, isRole) {
    var c = dayOpen(day, d.hours, d.settings); if (!c || c.closed) return [];
    if (role === "pharmacist") return E.teamCover ? E.teamCover(day, { hours: d.hours || {}, settings: Object.assign({}, d.settings || {}, { pharmacistRequired: true }), shifts: shifts, staff: staffList(d), leaves: d.leaves || [] }).gaps : [];
    if (!c.open) return [];
    var a = mn(c.open), z = mn(c.close), ev = [], away = {}, who = {};
    (d.leaves || []).forEach(function (l) { if (low(l.status) === "approved" && leaveSpan(l, day)) away[str(l.staff_id)] = 1; });
    staffList(d).forEach(function (p) { who[str(p.id)] = p; });
    shifts.forEach(function (r) { if (r.shift_date !== day || away[str(r.staff_id)] || !isRole(who[str(r.staff_id)])) return; var s = Math.max(a, mn(r.start_time)), e = Math.min(z, mn(r.end_time)); if (e > s) ev.push([s, 1], [e, -1]); });
    ev.sort(function (p, q) { return p[0] - q[0] || q[1] - p[1]; });
    var n = 0, cur = a, i = 0, g = [];
    while (cur < z) { while (i < ev.length && ev[i][0] <= cur) n += ev[i++][1]; var nx = i < ev.length ? Math.min(ev[i][0], z) : z; if (n < 1) { if (g.length && g[g.length - 1][1] === cur) g[g.length - 1][1] = nx; else g.push([cur, nx]); } cur = nx; }
    return g.map(function (x) { return { from: tm(x[0]), to: tm(x[1]) }; });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Preview (always before a write): counts, words, day marks.
  // preview(personRows, expansion | [expansion], mode, opts) — personRows is accepted for the contract and not needed
  // (each expansion carries its snapshot); preview(expansions, opts) works too. opts.after = { shifts, staff, leaves,
  // hours, settings } adds the "afterwards" cover words (E.teamCover over the range with the change made).
  P.preview = function (rows, ex, mode, opts) {
    if (ex === undefined || (ex && !Array.isArray(ex) && !ex.add && typeof ex === "object")) { opts = ex; ex = rows; }
    else if (typeof ex === "string") { opts = mode; ex = rows; }
    var list = (Array.isArray(ex) ? ex : [ex]).filter(function (x) { return x && x.add; });
    opts = opts || {};
    var c = { add: 0, keep: 0, remove: 0, skip: 0, asked: 0, trim: 0, people: 0 }, why = {}, whyDays = {}, removes = [], marks = [], asked = [], trims = [], names = [];
    var from = null, to = null;
    list.forEach(function (x) {
      if (!x.from) return;
      if (!from || x.from < from) from = x.from; if (!to || x.to > to) to = x.to;
      if (x.add.length || x.remove.length) c.people++;
      c.add += x.add.length; c.keep += x.keep.length; c.remove += x.remove.length; c.skip += x.skip.length; c.asked += (x.asked || []).length; c.trim += (x.trim || []).length;
      x.skip.forEach(function (s) { var k = s.why === "leave-part" ? "leave" : s.why; why[k] = (why[k] || 0) + 1; (whyDays[k] = whyDays[k] || []).push(s.date); marks.push({ date: s.date, staff_id: x.staff_id, mark: "skip", why: s.why, words: s.words }); });
      x.add.forEach(function (r) { marks.push({ date: r.date, staff_id: x.staff_id, mark: "add", why: r.asked ? "asked" : "", words: span(r.start_time, r.end_time) + (r.week ? " · week " + r.week : "") + (r.asked ? " · asked for leave" : "") }); });
      x.keep.forEach(function (r) { marks.push({ date: r.shift_date, staff_id: x.staff_id, mark: "keep", why: "has-shift", words: span(hm(r.start_time), hm(r.end_time)) + " already planned" }); });
      x.remove.forEach(function (r) { removes.push({ r: r, name: x.name }); marks.push({ date: r.shift_date, staff_id: x.staff_id, mark: "remove", why: "", words: span(hm(r.start_time), hm(r.end_time)) + " goes" }); });
      (x.asked || []).forEach(function (a) { asked.push(a); });
      (x.trim || []).forEach(function (t) { trims.push(t); });
      if (x.name && names.indexOf(x.name) < 0) names.push(x.name);
    });
    var title = (names.length === 1 ? names[0] : names.length ? plural(names.length, "person", "people") : "") + (from ? (names.length ? ", " : "") + rangeW(from, to) : "");
    var bits = [c.add ? "Adds " + plural(c.add, "shift") : "Adds nothing"];
    if (c.keep) bits.push("keeps " + plural(c.keep, "shift") + " already planned");
    bits.push(c.remove ? "removes " + plural(c.remove, "shift") : "removes nothing");
    var sk = [];
    if (why.holiday) sk.push(plural(why.holiday, "public holiday"));
    if (why.closed) sk.push(plural(why.closed, "day") + " the pharmacy is closed");
    if (why.leave) sk.push(plural(why.leave, "day") + " of leave");
    if (why.unavailable) sk.push(plural(why.unavailable, "day") + " " + (names.length === 1 ? first(names[0]) : "someone") + " can't work (" + listDays(whyDays.unavailable) + ")");
    if (why.inactive) sk.push(plural(why.inactive, "day") + " for someone not active");
    if (why.past) sk.push(plural(why.past, "day") + " in the past");
    list.forEach(function (x) { x.skip.forEach(function (s0) { if (s0.why === "no-day" && sk.indexOf(s0.words) < 0) sk.push(s0.words); }); });
    var removesW = removes.length ? "Removes " + plural(removes.length, "shift") + ": " + removes.slice(0, 6).map(function (x) { return (names.length > 1 ? first(x.name) + " " : "") + dayW(x.r.shift_date) + " " + span(hm(x.r.start_time), hm(x.r.end_time)) + (x.r.notes ? " (note: '" + x.r.notes + "')" : ""); }).join(", ") + (removes.length > 6 ? ", and " + (removes.length - 6) + " more" : "") : "";
    var button = c.add && c.remove ? "Add " + c.add + ", remove " + c.remove : c.add ? "Add " + plural(c.add, "shift") : c.remove ? "Remove " + plural(c.remove, "shift") : "";
    marks.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return {
      counts: c, days: marks, nothing: !button,
      words: { title: title, line: bits.join(" · "), skips: sk.length ? "Skips: " + sk.join(" · ") : "", removes: removesW, after: opts.after && from ? afterWords(list, opts.after, from, to) : "",
        asked: asked.length ? asked.slice(0, 3).map(function (a) { return a.words; }).join(" · ") + (asked.length > 3 ? " · and " + (asked.length - 3) + " more" : "") + " (they get the shift for now)" : "",
        trims: trims.length ? "Shortened around part-day leave: " + trims.slice(0, 3).map(function (t) { return t.words; }).join(", ") + (trims.length > 3 ? ", …" : "") : "",
        button: button || "Nothing to change", nothing: !button ? (c.keep ? "Every day already has a shift: nothing to add." : "Nothing to add in these dates.") : "" }
    };
  };
  function afterWords(list, a, from, to) {
    if (!E.teamCover) return "";
    var gone = {}, adds = [];
    list.forEach(function (x) { x.remove.forEach(function (r) { gone[str(r.id)] = 1; }); x.add.forEach(function (r) { adds.push({ staff_id: x.staff_id, shift_date: r.date, start_time: r.start_time, end_time: r.end_time, role_override: r.role_override }); }); });
    var shifts = (a.shifts || []).filter(function (r) { return !gone[str(r.id)]; }).concat(adds), bad = [];
    for (var d = from; d <= to && bad.length < 50; d = add(d, 1)) {
      var cv = E.teamCover(d, { hours: a.hours || {}, settings: a.settings || {}, shifts: shifts, staff: a.staff || [], leaves: a.leaves || [] });
      if (cv && cv.gaps && cv.gaps.length) bad.push(dayW(d) + " " + cv.gaps.map(function (g) { return span(g.from, g.to); }).join(", "));
    }
    if (!bad.length) return "Afterwards every open hour has a pharmacist.";
    return "Afterwards still no pharmacist on " + bad.slice(0, 2).join(" · ") + (bad.length > 2 ? " and " + (bad.length - 2) + " more days" : "");
  }

  // toOps([expansion]) -> classic apply-pattern bodies (servers without W1), ≤ 1,500 days each:
  //   [{ staff_id, start_date, end_date, mode: "fill"|"overwrite", dates: [date] }]. Only adds on empty days = "fill" with
  //   the new rows; anything removed (or extra shifts on busy days) = "overwrite" over the range re-sending every kept row.
  P.toOps = function (exs) {
    var out = [];
    (Array.isArray(exs) ? exs : [exs]).filter(Boolean).forEach(function (x) {
      if (!x.from || (!x.add.length && !x.remove.length)) return;
      var gone = {}; x.remove.forEach(function (r) { gone[str(r.id)] = 1; });
      var over = x.remove.length > 0 || !!x.extra, rows = x.add.map(plainDate);
      if (over) (x.snapshot || []).forEach(function (r) { if (!gone[str(r.id)]) rows.push(plainDate(r)); });
      rows.sort(byTime);
      var lo = over ? x.from : rows[0].date, hi = over ? x.to : rows[rows.length - 1].date;
      for (var s = lo; s <= hi;) {
        var e = add(s, 1499); if (e > hi) e = hi;
        var part = rows.filter(function (r) { return r.date >= s && r.date <= e; });
        if (part.length || over) out.push({ staff_id: x.staff_id, start_date: s, end_date: e, mode: over ? "overwrite" : "fill", dates: part });
        s = add(e, 1);
      }
    });
    return out;
  };
  function plainDate(r) { return { date: r.date || r.shift_date, start_time: hm(r.start_time), end_time: hm(r.end_time), role_override: str(r.role_override), notes: str(r.notes) }; }

  // ---------------------------------------------------------------------------------------------------------------
  // Apply, verify, put back, undo, recent changes.
  var api = function (path, opts) { return E.apiFetch(path, opts || { method: "GET" }); };
  var post = function (path, body) { return api(path, { method: "POST", body: JSON.stringify(body), landCheck: false, timeoutMs: 60000 }); };
  var hasW1 = null; // null = not known yet, true, false (this server has no /shifts/apply-plan)
  P._server = function (v) { if (v !== undefined) hasW1 = v; return hasW1; };
  async function readRows(items) { // 1 GET for the union range (with staff_id when it is one person)
    if (!items.length) return [];
    var lo = items[0].from, hi = items[0].to; items.forEach(function (x) { if (x.from < lo) lo = x.from; if (x.to > hi) hi = x.to; });
    var one = items.every(function (x) { return str(x.staff_id) === str(items[0].staff_id); });
    var r = await api("/shifts/assignments-range?from=" + lo + "&to=" + hi + (one ? "&staff_id=" + encodeURIComponent(items[0].staff_id) : ""));
    return (r && r.shifts) || [];
  }
  var rowsFor = function (all, x) { return (all || []).filter(function (r) { return str(r.staff_id) === str(x.staff_id) && r.shift_date >= x.from && r.shift_date <= x.to; }); };
  var bag = function (rows) { var m = {}; rows.forEach(function (r) { var k = keyOf(r); m[k] = (m[k] || 0) + 1; }); return m; };
  function sameBag(a, b) { var x = bag(a), y = bag(b), k; for (k in x) if (x[k] !== (y[k] || 0)) return false; for (k in y) if (!x[k]) return false; return true; }
  function contains(have, want) { var x = bag(have), y = bag(want); for (var k in y) if ((x[k] || 0) < y[k]) return false; return true; }
  // diff(now, target) -> { remove: [rows of now not in target], add: [dates of target not in now] } (equal rows keep their ids)
  function diff(now, target) {
    var t = bag(target), rm = [], ad = [], n = bag(now);
    now.slice().sort(byTime).forEach(function (r) { var k = keyOf(r); if (t[k]) t[k]--; else rm.push(r); });
    target.slice().sort(byTime).forEach(function (r) { var k = keyOf(r); if (n[k]) n[k]--; else ad.push(plainDate(r)); });
    return { remove: rm, add: ad };
  }
  P._diff = diff;
  function expected(item) { // the rows the person should have afterwards
    var gone = {}; item.remove.forEach(function (r) { gone[str(r.id)] = 1; });
    return item.snapshot.filter(function (r) { return !gone[str(r.id)]; }).concat(item.add.map(function (r) { return Object.assign(plainDate(r), { shift_date: r.date, staff_id: item.staff_id }); }));
  }
  // Only what this write did, taken back: the current rows minus its added rows, plus its removed rows that are gone.
  function revert(cur, x) {
    var ad = bag(x.add.map(function (r) { return { shift_date: r.date, start_time: r.start_time, end_time: r.end_time, role_override: r.role_override, notes: r.notes }; }));
    var base = cur.filter(function (r) { var k = keyOf(r); if (ad[k]) { ad[k]--; return false; } return true; });
    var have = bag(base), snap = bag(x.snapshot);
    x.remove.forEach(function (r) { var k = keyOf(r); if ((have[k] || 0) < (snap[k] || 0)) { base.push(r); have[k] = (have[k] || 0) + 1; } });
    return base;
  }
  // The one write path: items = [{ staff_id, from, to, add: [date], remove: [row], snapshot: [row], seenIds? }].
  // W1 when the server has it (≤ 12 people a request, all or nothing), else apply-pattern per person.
  async function write(items, onProgress) {
    var todo = items.filter(function (x) { return x.add.length || x.remove.length; }), total = todo.length, done = 0;
    if (!total) return;
    if (hasW1 === false) return legacy(todo, onProgress, 0, total);
    var groups = [], g = [], n = 0;
    var flush = function () { if (g.length) groups.push(g); g = []; n = 0; };
    todo.forEach(function (x) { if (x.add.length > 3660) { flush(); groups.push([x]); return; } if (g.length >= 12 || n + x.add.length > 8000) flush(); g.push(x); n += x.add.length; });
    flush();
    for (var i = 0; i < groups.length; i++) {
      var gr = groups[i];
      if (gr.length === 1 && gr[0].add.length > 3660) { await legacy(gr, null, 0, 1); done++; if (onProgress) onProgress(done, total); continue; }
      try {
        await post("/shifts/apply-plan", { items: gr.map(function (x) { return { staff_id: x.staff_id, from: x.from, to: x.to, seen: x.seenIds || x.snapshot.map(function (r) { return r.id; }), remove: x.remove.map(function (r) { return r.id; }), add: x.add.map(plainDate) }; }) });
        hasW1 = true;
      } catch (e) {
        if (e && (e.status === 404 || e.status === 405) && hasW1 !== true) { hasW1 = false; return legacy(todo.slice(done), onProgress, done, total); }
        if (e && e.status === 400 && e.bodyJson && e.bodyJson.code === "split") {
          for (var j = 0; j < gr.length; j++) { if (gr.length > 1) await write([gr[j]], null); else await legacy(gr, null, 0, 1); done++; if (onProgress) onProgress(done, total); }
          continue;
        }
        if (e && e.status === 409) e.changed = true;
        throw e;
      }
      done += gr.length; if (onProgress) onProgress(done, total);
    }
  }
  async function legacy(items, onProgress, base, total) {
    for (var i = 0; i < items.length; i++) {
      var ops = P.toOps([items[i]]);
      for (var j = 0; j < ops.length; j++) await post("/shifts/apply-pattern", ops[j]);
      if (onProgress) onProgress(base + i + 1, total);
    }
  }
  // Put people's rows (each item's range) to targets[i](current rows) — a function of what is there now. Returns the items still not right.
  async function putBack(items, target) {
    var now = await readRows(items), todo = [], want = [];
    items.forEach(function (x, i) { var cur = rowsFor(now, x), t = target(cur, i); want[i] = t; if (!sameBag(cur, t)) { var d = diff(cur, t); todo.push({ staff_id: x.staff_id, from: x.from, to: x.to, add: d.add, remove: d.remove, snapshot: cur, seenIds: cur.map(function (r) { return r.id; }) }); } });
    if (todo.length) await write(todo, null);
    var again = await readRows(items);
    return items.filter(function (x, i) { return !sameBag(rowsFor(again, x), want[i]); });
  }

  // Recent changes: memory + sessionStorage eikon_rota_undo:<loc>, at most 5 operations and ~4,000 rows.
  var MEM = null;
  var locKey = function () { return "eikon_rota_undo:" + (E.state && E.state.user ? E.state.user.location_id : "x"); };
  function loadRecent() { if (MEM && MEM.key === locKey()) return MEM.list; var l = []; try { l = JSON.parse(sessionStorage.getItem(locKey()) || "[]") || []; } catch (e) { l = []; } MEM = { key: locKey(), list: Array.isArray(l) ? l : [] }; return MEM.list; }
  function saveRecent(list) {
    var rows = 0; list = list.slice(0, 5).filter(function (op, i) { rows += op.items.reduce(function (n, x) { return n + x.before.length + x.after.length; }, 0); return i === 0 || rows <= 4000; });
    MEM = { key: locKey(), list: list };
    try { sessionStorage.setItem(locKey(), JSON.stringify(list)); } catch (e) {}
  }
  P.recent = function () {
    return loadRecent().map(function (op) { return { undoId: op.id, at: op.at, label: op.label, words: op.words, staff: op.items.map(function (x) { return x.staff_id; }), rows: op.items.reduce(function (n, x) { return n + x.added + x.removed; }, 0), undone: !!op.undone, restoreFailed: !!op.restoreFailed, unsure: !!op.unsure }; });
  };
  function record(label, words, items, extra) {
    var op = Object.assign({ id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), label: label || words, words: words,
      items: items.map(function (x) { return { staff_id: x.staff_id, name: x.name || "", from: x.from, to: x.to, before: x.snapshot.map(slim), after: expected(x).map(slim), added: x.add.length, removed: x.remove.length }; }) }, extra || {});
    var l = loadRecent().slice(); l.unshift(op); saveRecent(l);
    return op.id;
  }
  function slim(r) { return { staff_id: r.staff_id, shift_date: r.shift_date || r.date, start_time: hm(r.start_time), end_time: hm(r.end_time), role_override: str(r.role_override), notes: str(r.notes) }; }
  function doneWords(items) {
    var a = 0, r = 0, names = []; items.forEach(function (x) { a += x.add.length; r += x.remove.length; if ((x.add.length || x.remove.length) && names.indexOf(first(x.name)) < 0) names.push(first(x.name)); });
    var who = names.length === 1 && names[0] !== "Someone" ? " for " + names[0] : names.length > 1 ? " for " + plural(names.length, "person", "people") : "";
    if (a && r) return "Added " + plural(a, "shift") + " and removed " + r + who;
    if (a) return "Added " + plural(a, "shift") + who;
    if (r) return "Removed " + plural(r, "shift") + who;
    return "Nothing to change";
  }
  function failText(e) { try { return E.saveFailText ? E.saveFailText(e).replace(/^Not saved: /, "") : str(e && e.message || e); } catch (x) { return str(e && e.message || e); } }

  // apply(ops, { label, onProgress(done, total) }) -> Promise { done, undoId, inserted, removed, words, failed?, changed? }
  //   ops = [{ staff_id, name?, from, to, add: [date], keep?: [row], remove: [row], snapshot: [row] }] — expansions as they are.
  //   Never rejects: every outcome comes back in words.
  P.apply = async function (ops, opts) {
    opts = opts || {};
    var items = (Array.isArray(ops) ? ops : [ops]).filter(function (x) { return x && x.staff_id != null && x.from && ((x.add && x.add.length) || (x.remove && x.remove.length)); })
      .map(function (x) { return { staff_id: x.staff_id, name: x.name || "", from: x.from, to: x.to, add: (x.add || []).map(plainDate), remove: (x.remove || []).slice(), snapshot: x.snapshot || x.existing || null }; });
    if (!items.length) return { done: true, undoId: null, inserted: 0, removed: 0, words: "Nothing to change" };
    try { // a snapshot the screen did not pass is read now (1 GET)
      var need = items.filter(function (x) { return !x.snapshot; });
      if (need.length) { var rr = await readRows(need); need.forEach(function (x) { x.snapshot = rowsFor(rr, x); }); }
      items.forEach(function (x) { x.snapshot = rowsFor(x.snapshot, x); });
    } catch (e0) { return { done: false, undoId: null, inserted: 0, removed: 0, words: "Nothing was changed — " + failText(e0) }; }
    var words = doneWords(items), err = null;
    try { await write(items, opts.onProgress); } catch (e) { err = e; }
    if (err && err.changed) return { done: false, changed: true, undoId: null, inserted: 0, removed: 0, staff_ids: (err.bodyJson && err.bodyJson.staff_ids) || [], words: "Someone changed these shifts since the preview, so nothing was saved. Look at the preview again." };
    // verify (1 GET): every intended change is in place (rows others added meanwhile do not count against it)
    var now = null;
    try { now = await readRows(items); } catch (e2) { now = null; }
    var landed = now && items.every(function (x) { var cur = rowsFor(now, x); return contains(cur, expected(x)) && !x.remove.some(function (r) { return cur.some(function (c) { return str(c.id) === str(r.id); }); }); });
    var sum = function (k) { return items.reduce(function (n, x) { return n + x[k].length; }, 0); };
    if (landed) return { done: true, undoId: record(opts.label, words, items), inserted: sum("add"), removed: sum("remove"), words: words, recovered: !!err };
    if (!now) return { done: false, undoId: record(opts.label, words, items, { unsure: true }), inserted: 0, removed: 0, words: "We could not tell if it was saved (" + failText(err || "no connection") + "). Look at the rota before trying again; Recent changes can put it back.", failed: { staff_id: items[0].staff_id, words: "unsure", restored: false } };
    if (items.every(function (x) { return sameBag(rowsFor(now, x), x.snapshot); })) return { done: false, undoId: null, inserted: 0, removed: 0, words: "Nothing was changed — " + failText(err || "the server did not save it"), failed: { staff_id: items[0].staff_id, words: failText(err), restored: true } };
    var left;
    try { left = await putBack(items, function (cur, i) { return revert(cur, items[i]); }); } catch (e3) { left = items; }
    if (!left.length) return { done: false, undoId: null, inserted: 0, removed: 0, words: "Nothing was changed — " + failText(err || "part of it did not save, so it was put back"), failed: { staff_id: items[0].staff_id, words: failText(err), restored: true } };
    var x0 = left[0], uid = record(opts.label, words, items, { restoreFailed: true }), have = 0;
    try { var cur = rowsFor(await readRows([x0]), x0), hb = bag(cur); x0.snapshot.forEach(function (r) { var k = keyOf(r); if (hb[k]) { hb[k]--; have++; } }); } catch (e4) {}
    return { done: false, undoId: uid, inserted: 0, removed: 0, failed: { staff_id: x0.staff_id, words: "restore failed", restored: false },
      words: (x0.name ? first(x0.name) + "'s" : "The") + " shifts from " + dateW(x0.from) + " to " + dateW(x0.to) + " could not be put back; " + have + " of the " + plural(x0.snapshot.length, "earlier shift") + " " + (have === 1 ? "is" : "are") + " on the rota now. Try Undo again in a minute (Recent changes)." };
  };

  // undo(undoId, { anyway }) -> Promise { done, words, changedSince: [{ staff_id, date, words }] }
  //   The range is read again first; a change made since (by anyone) is named and nothing is done unless anyway.
  P.undo = async function (undoId, opts) {
    opts = opts || {};
    var list = loadRecent(), op = list.filter(function (x) { return x.id === undoId; })[0];
    if (!op) return { done: false, words: "That change is no longer in Recent changes.", changedSince: [] };
    if (op.undone) return { done: false, words: "Already undone.", changedSince: [] };
    var items = op.items.map(function (x) { return { staff_id: x.staff_id, name: x.name, from: x.from, to: x.to }; }), now;
    try { now = await readRows(items); } catch (e) { return { done: false, words: "Not undone — " + failText(e), changedSince: [] }; }
    var since = [];
    if (!op.restoreFailed && !op.unsure) op.items.forEach(function (x, i) {
      var d = diff(rowsFor(now, items[i]), x.after);
      d.remove.forEach(function (r) { since.push({ staff_id: x.staff_id, date: r.shift_date, words: first(x.name) + " " + dayW(r.shift_date) + " " + span(hm(r.start_time), hm(r.end_time)) + " was added since" }); });
      d.add.forEach(function (r) { since.push({ staff_id: x.staff_id, date: r.date, words: first(x.name) + " " + dayW(r.date) + " " + span(r.start_time, r.end_time) + " was changed or removed since" }); });
    });
    if (since.length && !opts.anyway) return { done: false, words: "Since then: " + since.slice(0, 3).map(function (s) { return s.words; }).join(" · ") + (since.length > 3 ? " · and " + (since.length - 3) + " more" : "") + ". Undo anyway? That will be lost.", changedSince: since };
    var left;
    try { left = await putBack(items, function (cur, i) { return op.items[i].before; }); } catch (e2) { return { done: false, words: "Not undone — " + failText(e2) + ". Try again in a minute.", changedSince: since }; }
    if (left.length) return { done: false, words: "Not everything could be put back. Try Undo again in a minute.", changedSince: since };
    op.undone = true; op.undoneAt = new Date().toISOString(); saveRecent(list);
    return { done: true, words: "Undone: " + op.words.charAt(0).toLowerCase() + op.words.slice(1), changedSince: since };
  };

  // ---------------------------------------------------------------------------------------------------------------
  // "Until changed" (§2.6): 12 months ahead, remembered in settings_json.rota.plans[staff_id] = { rid, from, through, keep }.
  var PLANS = null;
  P.plans = async function (fresh) {
    if (!E.rotaMeta) return PLANS || {};
    try { var r = await E.rotaMeta.get(!!fresh); PLANS = (r && r.plans && typeof r.plans === "object") ? r.plans : {}; } catch (e) { PLANS = PLANS || {}; }
    return PLANS;
  };
  P.untilChangedEnd = function (from) { return add(addMonths(from, 12), -1); };
  P.setPlan = async function (sid, plan) {
    if (!E.rotaMeta) return null;
    var v = await E.rotaMeta.merge("plans", function (cur) { cur = cur && typeof cur === "object" ? cur : {}; if (plan) cur[str(sid)] = plan; else delete cur[str(sid)]; return cur; });
    PLANS = v || {}; return PLANS;
  };
  // extendDue(today?, plans?, staff?) -> [{ staff_id, through, from, to, words }] for plans ending in < 8 weeks (sync; P.plans() fills the cache)
  P.extendDue = function (now, plans, staff) {
    now = YMD.test(str(now)) ? now : today(); plans = plans || PLANS || {};
    var who = {}; (staff || []).forEach(function (p) { who[str(p.id)] = p; });
    return Object.keys(plans).map(function (sid) {
      var p = plans[sid]; if (!p || !YMD.test(str(p.through)) || days(now, p.through) >= 56) return null;
      var name = who[sid] ? first(who[sid].full_name) + "'s" : "The";
      return { staff_id: isNaN(+sid) ? sid : +sid, through: p.through, from: add(p.through, 1), to: add(addMonths(add(p.through, 1), 6), -1), rid: p.rid,
        words: name + " usual week is on the rota until " + dateW(p.through) + (p.through < now ? " (ended)" : "") };
    }).filter(Boolean).sort(function (a, b) { return a.through < b.through ? -1 : 1; });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Pattern save: read the person fresh, change only patterns_json, PUT the classic whole record (1 GET + 1 PUT).
  P.savePatterns = async function (sid, fn) {
    var r = await api("/shifts/staff?include_inactive=1"), p = ((r && r.staff) || []).filter(function (x) { return str(x.id) === str(sid); })[0];
    if (!p) throw new Error("This person is no longer on the rota");
    var st = P.parse(p.patterns_json), nx = fn(st) || st, pj = P.toPatternsJson(nx);
    var body = { full_name: p.full_name, designation: p.designation, employment_type: p.employment_type, contracted_hours: p.contracted_hours, email: p.email || "", phone: p.phone || "", registration_number: p.registration_number || "", is_active: p.is_active ? 1 : 0, patterns_json: pj };
    await api("/shifts/staff/" + encodeURIComponent(sid), { method: "PUT", body: JSON.stringify(body) });
    return Object.assign({}, p, { patterns_json: pj });
  };

  // ===============================================================================================================
  // Components (rendered by Plan shifts, B2, in its person panel / sheets). Each returns { close() } and calls back.
  // The ONE "Fill…" entry point is Plan shifts' own sheet (modules.shfreg.js), which drives this engine for every kind.
  //   ui.editor(mount, person, { onSaved(person), onApply(person), onCancel })     the usual week / rotation (§2.2)
  //   ui.applyDialog(mount, { kind, person, people, rotation?, cells?, from, to, data?, mode?, onDone(result), onCancel })
  //   ui.recent(mount, { onDone })                                                   Recent changes, each with Undo
  //   ui.undoToast(result, { onUndone })                                             "Added 238 shifts for Maria · Undo" (10 s)
  //   ui.extendLine(mount, { staff, onDone })                                        "…on the rota until 15 Nov 2027 · Extend 6 months"
  var esc = function (s) { return E.escapeHtml ? E.escapeHtml(str(s)) : str(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var DESIG = { pharmacist: "Pharmacist", locum: "Locum pharmacist", assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  var uid = 0, nid = function (p) { return "rp-" + p + "-" + (++uid); };
  function css() {
    if (document.getElementById("rp-style")) return;
    var st = document.createElement("style"); st.id = "rp-style";
    st.textContent =
      ".rp{font-size:15px;color:var(--text)}.rp h2{font-size:19px;font-weight:700;margin:0 0 4px}.rp .rp-sum{color:var(--muted);font-size:14px;margin:0 0 12px;line-height:1.45}" +
      ".rp-btn{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".rp-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.rp-btn:disabled{opacity:.55;cursor:default}.rp-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}" +
      ".rp-btn.l{border:0;background:none;color:var(--accent);padding:0 6px}.rp-btn:focus-visible,.rp-chip:focus-visible,.rp input:focus-visible,.rp select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".rp-chip{font:inherit;font-size:13.5px;min-height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;font-variant-numeric:tabular-nums}" +
      ".rp-chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".rp-f{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 0;border-top:.5px solid var(--border)}.rp-f:first-of-type{border-top:0}" +
      ".rp-f>.lab,.rp-f>legend{flex:0 0 120px;font-weight:600;font-size:14.5px;padding:0}.rp-f>.in{flex:1 1 260px;min-width:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}" +
      "fieldset.rp-f{margin:0;border:0;border-top:.5px solid var(--border);min-width:0}" +
      ".rp input[type=date],.rp input[type=time],.rp input[type=number],.rp select{font:inherit;font-size:16px;color:inherit;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:6px 10px;min-height:40px}" +
      ".rp input[type=time]{width:auto;min-width:9em}.rp input[type=number]{width:5em}.rp label.r{display:flex;align-items:center;gap:8px;min-height:40px;cursor:pointer}.rp label.r input{width:20px;height:20px;margin:0}" +
      ".rp-days{display:grid;grid-template-columns:minmax(92px,auto) 1fr;gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".rp-days .d{padding:8px 12px;border-top:.5px solid var(--border);display:flex;align-items:center;font-weight:600}.rp-days .t{padding:6px 12px;border-top:.5px solid var(--border);display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}" +
      ".rp-days .d:nth-child(1),.rp-days .t:nth-child(2){border-top:0}.rp-days .t i{font-style:normal;color:var(--muted)}.rp-days .off{color:var(--muted);font-size:14px}" +
      ".rp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}.rp-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;align-items:center;margin-top:14px}" +
      ".rp-err{color:var(--danger);font-size:14px;margin:10px 0 0}.rp-err ul{margin:4px 0 0 18px;padding:0}.rp-ok{color:var(--ok);font-weight:600}" +
      ".rp-pv{margin-top:14px;padding:12px 14px;border-radius:12px;background:rgba(118,118,128,.05);line-height:1.5}.rp-pv b.t{display:block;font-size:15.5px}.rp-pv p{margin:4px 0 0;font-size:14px}.rp-pv .warn{color:var(--warn,#8A5A08)}.rp-pv .bad{color:var(--danger)}" +
      ".rp-strip{margin-top:10px;font-size:13px;font-variant-numeric:tabular-nums;max-width:520px}.rp-strip ol.wd li{font-weight:600;min-height:0;padding:0}.rp-strip h3{font-size:13.5px;margin:10px 0 4px;font-weight:700}.rp-strip ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}" +
      ".rp-strip li{border-radius:6px;padding:3px 0;text-align:center;border:1px solid transparent;min-height:22px}.rp-strip li.add{background:rgba(52,168,83,.18)}.rp-strip li.keep{background:rgba(90,162,255,.16)}.rp-strip li.remove{background:rgba(255,90,122,.2)}.rp-strip li.skip{border:1px dashed var(--border);color:var(--text)}" +
      ".rp-strip .key{display:flex;gap:12px;flex-wrap:wrap;color:var(--text);margin-top:6px}" +
      ".rp-rec li{display:flex;gap:10px;align-items:center;padding:10px 0;border-top:.5px solid var(--border)}.rp-rec{list-style:none;margin:0;padding:0}.rp-rec li:first-child{border-top:0}.rp-rec .w{flex:1;min-width:0}.rp-rec .w span{display:block;color:var(--muted);font-size:13px}" +
      ".rp-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;display:flex;gap:12px;align-items:center;max-width:calc(100vw - 32px);padding:10px 12px 10px 16px;border-radius:14px;background:#1d2633;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:14.5px}" +
      ".rp-toast .rp-btn{background:transparent;color:#9cc7ff;border-color:rgba(255,255,255,.3)}" +
      ".rp-ext{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px;padding:8px 0}" +
      ".rp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (prefers-color-scheme:dark){.rp-chip[aria-pressed=true],.rp-btn.p{color:#00160E}}" +
      "@media (max-width:600px){.rp input[type=date],.rp input[type=time],.rp input[type=number],.rp select,.rp label.r{min-height:44px}.rp-f>.lab,.rp-f>legend{flex-basis:100%}.rp-btn{min-height:44px;border-radius:22px}.rp-chip{min-height:44px;border-radius:22px}.rp-acts .rp-btn.p{flex:1 1 100%}.rp-days{grid-template-columns:1fr}.rp-days .t{border-top:0;padding-top:0}}";
    document.head.appendChild(st);
  }
  function on(root, sel, ev, fn) { root.addEventListener(ev, function (e) { var t = e.target && e.target.closest ? e.target.closest(sel) : null; if (t && root.contains(t)) fn(e, t); }); }
  var DAYS = WDF;
  var rulesP = function () { return E.rotaRules ? E.rotaRules().catch(function () { return { hours: null, settings: null }; }) : Promise.resolve({ hours: null, settings: null }); };
  function hoursChips(ymd, hours, settings) { // the day's opening hours, early half, late half
    var c = dayOpen(ymd || today(), hours, settings), out = [];
    if (!c || c.closed || !c.open) return out;
    var a = mn(c.open), z = mn(c.close), m = Math.round((a + z) / 60) * 30;
    out.push({ s: c.open, e: c.close, w: "Opening hours" }); if (z - a >= 240) { out.push({ s: c.open, e: tm(m), w: "Early" }); out.push({ s: tm(m), e: c.close, w: "Late" }); }
    return out;
  }
  var leavesC = {};
  async function leavesFor(from, to) { // GET /shifts/leaves?year (the year a leave starts in), the year before too when the range starts in January (D-7)
    var ys = [], y0 = +from.slice(0, 4), y1 = +to.slice(0, 4); if (from.slice(5, 7) === "01") ys.push(y0 - 1);
    for (var y = y0; y <= y1; y++) ys.push(y);
    var out = [];
    for (var i = 0; i < ys.length; i++) {
      var c = leavesC[ys[i]];
      if (!c || Date.now() - c.at > 60000) { c = leavesC[ys[i]] = { at: Date.now(), p: api("/shifts/leaves?year=" + ys[i]).then(function (r) { return (r && r.leaves) || []; }) }; c.p.catch(function () { delete leavesC[ys[i]]; }); }
      out = out.concat(await c.p);
    }
    return out;
  }

  // ---- ui.editor: the usual week / rotation -------------------------------------------------------------------
  P.ui = {};
  P.ui.editor = function (mount, person, opts) {
    css(); opts = opts || {};
    var st = P.parse(person && person.patterns_json), cur = P.usualOf(person), rules = { hours: null, settings: null };
    var R = cur ? { rid: cur.rid, n: cur.n, anchor: cur.anchor || monday(today()), weeks: cur.weeks.map(function (w) { return w.map(function (d) { return blocks(d); }); }), name: cur.name || "Usual" } : { rid: null, n: 1, anchor: monday(today()), weeks: [[[], [], [], [], [], [], []]], name: "Usual" };
    var k = 0, errs = [], saving = false, saved = "", closed = false, ids = { a: nid("anchor"), e: nid("err") };
    var isPh = /^(pharmacist|locum)$/.test(low(person && person.designation));
    rulesP().then(function (r) { rules = r || rules; if (!closed) paint(); });
    function rot() { return { n: R.n, anchor: R.anchor, weeks: R.weeks.map(function (w) { return w.map(dayOut); }) }; }
    function paint() {
      if (closed) return;
      var keepFocus = document.activeElement && mount.contains(document.activeElement) ? document.activeElement.getAttribute("data-f") : null;
      var w = R.weeks[k], h = '<div class="rp rp-ed"><h2>' + esc(first(person.full_name)) + "'s usual week</h2><p class=\"rp-sum\">" + esc(P.summary(rot())) + "</p>";
      h += '<div class="rp-tabs" role="group" aria-label="Weeks of the rotation">';
      if (R.n > 1) for (var i = 0; i < R.n; i++) h += '<button type="button" class="rp-chip" data-act="wk" data-k="' + i + '" aria-pressed="' + (i === k) + '">Week ' + LETTER[i] + "</button>";
      if (R.n < 4) h += '<button type="button" class="rp-btn l" data-act="addwk">+ Add a week' + (R.n === 1 ? " (rotation, e.g. alternate Saturdays)" : "") + "</button>";
      h += "</div>";
      if (R.n > 1) h += '<div class="rp-f"><label class="lab" for="' + ids.a + '">Week A starts</label><div class="in"><input type="date" id="' + ids.a + '" data-f="anchor" value="' + esc(R.anchor) + '"> <span class="rp-sum" style="margin:0">' + esc("This week is week " + LETTER[P.weekIndex(today(), R.anchor, R.n)]) + "</span></div></div>";
      h += '<div class="rp-days">';
      for (var d = 0; d < 7; d++) {
        var bs = w[d];
        h += '<div class="d" id="rp-dl-' + uid + "-" + d + '">' + DAYS[d] + "</div><div class=\"t\" role=\"group\" aria-labelledby=\"rp-dl-" + uid + "-" + d + '">';
        if (!bs.length) h += '<span class="off">Off</span><button type="button" class="rp-btn l" data-act="work" data-d="' + d + '">Works this day</button>';
        bs.forEach(function (b, bi) {
          h += '<input type="time" data-f="s' + d + "-" + bi + '" aria-label="' + DAYS[d] + (bi ? " second shift" : "") + ' start" value="' + esc(b.start) + '"><i>–</i><input type="time" data-f="e' + d + "-" + bi + '" aria-label="' + DAYS[d] + (bi ? " second shift" : "") + ' end" value="' + esc(b.end) + '">';
          if (!isPh) h += '<label class="r"><input type="checkbox" data-f="r' + d + "-" + bi + '"' + (b.role_override === "pharmacist" ? " checked" : "") + "> as pharmacist</label>";
          h += '<button type="button" class="rp-btn l" data-act="off" data-d="' + d + '" data-b="' + bi + '" aria-label="' + DAYS[d] + (bi ? ": remove the second shift" : ": off") + '">' + (bi ? "Remove" : "Off") + "</button>";
        });
        if (bs.length === 1) h += '<button type="button" class="rp-btn l" data-act="split" data-d="' + d + '">+ Second shift</button>';
        if (bs.length && d === 0) h += '<button type="button" class="rp-btn l" data-act="mf">Same hours Mon–Fri</button>';
        h += "</div>";
      }
      h += "</div>";
      var chips = hoursChips(add(monday(today()), 0), rules.hours, rules.settings);
      if (chips.length) h += '<div class="rp-f"><span class="lab">Quick hours</span><div class="in">' + chips.map(function (c) { return '<button type="button" class="rp-chip" data-act="chip" data-s="' + c.s + '" data-e="' + c.e + '">' + esc(c.w + " " + span(c.s, c.e)) + "</button>"; }).join("") + '<span class="rp-sum" style="margin:0">for every working day of week ' + (R.n > 1 ? LETTER[k] : "") + "</span></div></div>";
      if (R.n > 1) h += '<div class="rp-acts" style="justify-content:flex-start;margin-top:8px">' + (k > 0 ? '<button type="button" class="rp-btn" data-act="copyA">Copy week A into week ' + LETTER[k] + "</button>" : "") + '<button type="button" class="rp-btn d" data-act="rmwk">Remove week ' + LETTER[k] + "</button></div>";
      h += '<div id="' + ids.e + '" class="rp-err" role="alert">' + (errs.length ? "<ul>" + errs.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") + "</div>";
      h += '<div class="rp-acts">' + (saved ? '<span class="rp-ok" role="status">' + esc(saved) + "</span>" : "") + '<button type="button" class="rp-btn" data-act="cancel">' + (saved ? "Close" : "Cancel") + "</button>" +
        (saved && opts.onApply !== false ? '<button type="button" class="rp-btn p" data-act="apply">Put it on the rota…</button>' : '<button type="button" class="rp-btn p" data-act="save"' + (saving ? " disabled" : "") + ">" + (saving ? "Saving…" : "Save usual week") + "</button>") + "</div></div>";
      mount.innerHTML = h;
      if (keepFocus) { var f = mount.querySelector('[data-f="' + keepFocus + '"]'); if (f) f.focus(); }
    }
    function readInputs() { // what is typed, into R (the week on show)
      var w = R.weeks[k];
      for (var d = 0; d < 7; d++) w[d].forEach(function (b, bi) {
        var s = mount.querySelector('[data-f="s' + d + "-" + bi + '"]'), e = mount.querySelector('[data-f="e' + d + "-" + bi + '"]'), r = mount.querySelector('[data-f="r' + d + "-" + bi + '"]');
        if (s) b.start = s.value; if (e) b.end = e.value; if (r) b.role_override = r.checked ? "pharmacist" : "";
      });
      var a = mount.querySelector('[data-f="anchor"]'); if (a && YMD.test(a.value)) R.anchor = monday(a.value);
    }
    var last = { start: "08:00", end: "14:00" };
    mount.addEventListener("input", function () { readInputs(); saved = ""; });
    mount.addEventListener("change", function (e) { readInputs(); if (e.target.getAttribute("data-f") === "anchor") paint(); else { var s = mount.querySelector(".rp-sum"); if (s) s.textContent = P.summary(rot()); } });
    on(mount, "[data-act]", "click", function (e, t) {
      var a = t.getAttribute("data-act"), d = +t.getAttribute("data-d"), w;
      readInputs(); w = R.weeks[k]; saved = saved && a === "apply" ? saved : "";
      if (a === "wk") k = +t.getAttribute("data-k");
      else if (a === "addwk") { R.weeks.push(R.n === 1 ? R.weeks[0].map(function (x) { return x.map(function (b) { return Object.assign({}, b); }); }) : [[], [], [], [], [], [], []]); R.n++; k = R.n - 1; }
      else if (a === "rmwk") { R.weeks.splice(k, 1); R.n--; k = Math.max(0, k - 1); }
      else if (a === "copyA") R.weeks[k] = R.weeks[0].map(function (x) { return x.map(function (b) { return Object.assign({}, b); }); });
      else if (a === "work") { var prev = null; for (var i = d - 1; i >= 0 && !prev; i--) if (w[i][0]) prev = w[i][0]; w[d] = [Object.assign({ role_override: "", notes: "" }, prev ? { start: prev.start, end: prev.end } : last)]; }
      else if (a === "off") w[d].splice(+t.getAttribute("data-b"), 1);
      else if (a === "split") { var b0 = w[d][0]; w[d].push({ start: b0.end, end: tm(Math.min(1439, mn(b0.end) + 240)), role_override: "", notes: "" }); }
      else if (a === "mf") { for (var j = 1; j < 5; j++) w[j] = w[0].map(function (b) { return Object.assign({}, b); }); }
      else if (a === "chip") { var s = t.getAttribute("data-s"), en = t.getAttribute("data-e"); last = { start: s, end: en }; w.forEach(function (bs) { if (bs[0]) { bs[0].start = s; bs[0].end = en; } }); }
      else if (a === "cancel") { close(); if (opts.onCancel) opts.onCancel(); return; }
      else if (a === "apply") { var pp = opts.saved || person; close(); if (typeof opts.onApply === "function") opts.onApply(pp); else P.ui.applyDialog(mount, { kind: "pattern", person: pp, onDone: opts.onDone, onCancel: opts.onCancel }); return; }
      else if (a === "save") { save(); return; }
      paint();
      var back = mount.querySelector('[data-act="' + a + '"]' + (a === "wk" ? '[data-k="' + k + '"]' : "")); if (back) back.focus();
    });
    mount.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); close(); if (opts.onCancel) opts.onCancel(); } else if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") { e.preventDefault(); save(); } });
    async function save() {
      readInputs(); errs = P.validate(rot()); if (errs.length) { paint(); var x = mount.querySelector("[data-f]"); if (x) x.focus(); return; }
      saving = true; paint();
      try {
        var keepPlain = cur && R.n === 1 && !R.weeks[0].some(function (d) { return d.length > 1; }) && st.plain.some(function (p) { return p.id === cur.rid; });
        var np = await P.savePatterns(person.id, function (s) {
          if (keepPlain) { s.plain = s.plain.map(function (p) { return p.id === cur.rid ? Object.assign({}, p, { week: rot().weeks[0] }) : p; }); s.usual = cur.rid; return s; }
          var rid = cur && !s.plain.some(function (p) { return p.id === cur.rid; }) && s.rotations.some(function (r) { return r.rid === cur.rid; }) ? cur.rid : P.newRid();
          s.plain = s.plain.filter(function (p) { return !(cur && p.id === cur.rid); }); // the old usual (a classic pattern) becomes this rotation
          s.rotations = s.rotations.filter(function (r) { return r.rid !== rid; }).concat([{ rid: rid, n: R.n, anchor: R.anchor, weeks: rot().weeks, name: R.name || "Usual" }]);
          s.usual = rid; R.rid = rid; return s;
        });
        person = np; opts.saved = np; st = P.parse(np.patterns_json); cur = P.usualOf(np);
        saving = false; saved = "Saved: " + P.summary(rot()) + ".";
        paint(); var ap = mount.querySelector('[data-act="apply"]'); if (ap) ap.focus();
        if (opts.onSaved) opts.onSaved(np);
      } catch (e2) { saving = false; errs = [failText(e2) + ". What you set is still here: save again."]; paint(); }
    }
    function close() { closed = true; mount.innerHTML = ""; }
    paint();
    var f0 = mount.querySelector("[data-f], [data-act=work]"); if (f0) f0.focus();
    return { close: close };
  };

  // ---- ui.applyDialog: every fill, with its preview, the write and the undo ---------------------------------
  P.ui.applyDialog = function (mount, opts) {
    css(); opts = opts || {};
    var kind = opts.kind || "pattern", people = (opts.people && opts.people.length ? opts.people : opts.person ? [opts.person] : []).filter(Boolean);
    var allStaff = (opts.data && opts.data.staff) ? staffList(opts.data) : people.slice();
    var mon0 = monday(YMD.test(str(opts.from)) ? opts.from : today());
    var F = { kind: kind, who: people.map(function (p) { return str(p.id); }), from: YMD.test(str(opts.from)) ? opts.from : mon0, toKind: "until", to: "", mode: opts.mode === "replace" ? "replace" : "keep",
      weekdays: [1, 2, 3, 4, 5], every: 1, start: "08:00", end: "14:00", role: "pharmacist", repeatHow: "times", times: 4, until: add(mon0, 7 * 8 - 1), copyTo: add(mon0, 7), dates: (opts.cells || []).map(function (c) { return c.date; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort(),
      srcFrom: opts.srcFrom || (kind === "copy" ? mon0 : null), srcTo: opts.srcTo || (kind === "copy" ? add(mon0, 6) : null), unit: "week", anyway: false, roleWhoAll: true };
    if (kind === "copy" && opts.srcFrom && opts.srcTo) F.unit = opts.srcFrom === opts.srcTo ? "day" : (opts.srcFrom.slice(8) === "01" && opts.srcTo === monthEnd(opts.srcFrom)) ? "month" : "week";
    if (kind === "days" && !F.dates.length) F.dates = [];
    if (kind === "lastweek" || kind === "gaps" || kind === "role") { if (!F.who.length) F.who = []; }
    if (kind === "gaps" || kind === "role") { F.toKind = "date"; F.to = YMD.test(str(opts.to)) ? opts.to : add(F.from, 6); }
    if (YMD.test(str(opts.to))) { F.toKind = "date"; F.to = opts.to; }
    var D = { rules: null, shifts: null, leaves: null, key: "" }, exs = [], pv = null, busy = false, msg = "", bad = false, closed = false, timer = 0, ids = { live: nid("live") }, saving = null;
    var titles = { pattern: "Put a usual week on the rota", weekdays: "Chosen weekdays over a range", days: "Give these days a shift", copy: "Copy or repeat", lastweek: "Same as last week", gaps: "Fill the gaps", role: "A role at every opening hour" };
    function range() {
      var from = F.from, to;
      if (kind === "lastweek") { from = monday(F.from); to = add(from, 6); }
      else if (kind === "days") { from = F.dates[0] || F.from; to = F.dates[F.dates.length - 1] || from; }
      else if (kind === "copy") return copyRange();
      else to = F.toKind === "until" ? P.untilChangedEnd(from) : F.toKind === "month" ? monthEnd(from) : F.toKind === "year" ? from.slice(0, 4) + "-12-31" : F.to;
      return { from: from, to: YMD.test(str(to)) && to >= from ? to : from, read: kind === "lastweek" ? add(from, -7) : from };
    }
    function copyRange() {
      var a = F.srcFrom || mon0, b = F.srcTo || a, x = F.repeatHow === "to" ? { to: { from: F.copyTo } } : F.repeatHow === "until" ? { until: F.until } : { times: F.times };
      var t = P.repeat(Object.assign({ rows: [], srcFrom: a, srcTo: b, people: [{ id: 0 }], data: {} }, x)); // the target span (pure)
      var lo = t[0] && t[0].from || a, hi = t[0] && t[0].to || b;
      return { from: lo, to: hi, read: a < lo ? a : lo, readTo: hi > b ? hi : b };
    }
    function chosen() { var set = {}; F.who.forEach(function (s) { set[s] = 1; }); return allStaff.filter(function (p) { return set[str(p.id)]; }); }
    async function load() {
      var r = range(), lo = r.read || r.from, hi = r.readTo || r.to, key = lo + "|" + hi + "|" + (kind === "lastweek" || kind === "copy" || kind === "gaps" || kind === "role" || F.who.length !== 1 ? "*" : F.who[0]);
      if (D.key === key && D.shifts) return;
      var ppl = needStaff() ? api("/shifts/staff?include_inactive=1").then(function (x) { allStaff = (x && x.staff) || allStaff; }) : Promise.resolve();
      var res = await Promise.all([rulesP(), api("/shifts/assignments-range?from=" + lo + "&to=" + hi + (key.slice(-1) === "*" ? "" : "&staff_id=" + encodeURIComponent(F.who[0]))), leavesFor(lo, hi), ppl]);
      D = { rules: res[0] || {}, shifts: (res[1] && res[1].shifts) || [], leaves: res[2] || [], key: key };
    }
    function needStaff() { return (kind === "lastweek" || kind === "gaps" || kind === "role" || kind === "copy") && !(opts.data && opts.data.staff) && !allStaff.__full && (allStaff.__full = true); }
    function compute() {
      var r = range(), data = { staff: allStaff, shifts: D.shifts || [], leaves: D.leaves || [], hours: D.rules && D.rules.hours, settings: D.rules && D.rules.settings };
      var who = chosen(), blk = { start: F.start, end: F.end }, base = { data: data, mode: F.mode, anyway: F.anyway };
      if (kind === "pattern") exs = who.map(function (p) { var rot = opts.rotation || P.usualOf(p); var x = P.expand({ person: p, rotation: rot, rows: rot ? null : [], from: r.from, to: r.to, hours: data.hours, settings: data.settings, leaves: data.leaves, existing: data.shifts, mode: F.mode, anyway: F.anyway }); if (!rot) x.noPattern = true; x.rid = rot && rot.rid; return x; });
      else if (kind === "weekdays") exs = P.weekdays(Object.assign({ people: who, from: r.from, to: r.to, weekdays: F.weekdays, every: F.every, block: blk }, base));
      else if (kind === "days") exs = P.days(Object.assign({ people: who, dates: F.dates, block: blk }, base));
      else if (kind === "copy") exs = P.repeat(Object.assign({ rows: data.shifts, srcFrom: F.srcFrom, srcTo: F.srcTo, people: who.length ? who : null }, F.repeatHow === "to" ? { to: { from: F.copyTo } } : F.repeatHow === "until" ? { until: F.until } : { times: F.times }, base));
      else if (kind === "lastweek") exs = P.lastWeek(Object.assign({ monday: r.from, people: who.length ? who : null }, base));
      else exs = P.gaps({ from: r.from, to: r.to, role: kind === "gaps" ? "pharmacist" : F.role, people: F.roleWhoAll ? null : who, data: data });
      pv = P.preview(exs, { after: { shifts: data.shifts, staff: data.staff, leaves: data.leaves, hours: data.hours, settings: data.settings } });
    }
    function refresh(now) {
      clearTimeout(timer);
      timer = setTimeout(async function () {
        if (closed) return;
        try { await load(); compute(); msg = ""; bad = false; } catch (e) { pv = null; msg = "Can't read the rota for these dates — " + failText(e); bad = true; }
        paintPreview();
      }, now ? 0 : 250);
    }
    function whoHtml() {
      if (kind === "gaps" || kind === "role") {
        var roles = ["pharmacist", "assistant", "dispenser", "cashier", "manager", "cleaner"];
        return (kind === "role" ? '<div class="rp-f"><label class="lab" for="' + ids.live + 'r">Role</label><div class="in"><select id="' + ids.live + 'r" data-f="role">' + roles.map(function (x) { return '<option value="' + x + '"' + (F.role === x ? " selected" : "") + ">" + esc(DESIG[x]) + "</option>"; }).join("") + "</select></div></div>" : "") +
          '<div class="rp-f"><span class="lab">Who</span><div class="in rp-sum" style="margin:0">' + esc((kind === "gaps" || F.role === "pharmacist" ? "Pharmacists and locums" : "Everyone who is a " + DESIG[F.role].toLowerCase()) + ", fewest hours planned first; not on leave or unavailable") + "</div></div>";
      }
      var list = (people.length > 1 || kind === "copy" || kind === "lastweek") ? (people.length ? people : allStaff) : [];
      if (!list.length) return people[0] ? '<div class="rp-f"><span class="lab">Who</span><div class="in"><b>' + esc(people[0].full_name) + "</b></div></div>" : "";
      return '<fieldset class="rp-f"><legend>Who</legend><div class="in">' + list.map(function (p) { return '<label class="r"><input type="checkbox" data-f="who" value="' + esc(p.id) + '"' + (F.who.indexOf(str(p.id)) >= 0 ? " checked" : "") + ">" + esc(p.full_name) + "</label>"; }).join("") + "</div></fieldset>";
    }
    function dateField(lab, f, val) { var id = nid("d"); return '<div class="rp-f"><label class="lab" for="' + id + '">' + esc(lab) + '</label><div class="in"><input type="date" id="' + id + '" data-f="' + f + '" value="' + esc(val) + '"></div></div>'; }
    function hoursField() {
      var id = nid("t"), chips = hoursChips(kind === "days" ? F.dates[0] : F.from, D.rules && D.rules.hours, D.rules && D.rules.settings);
      return '<div class="rp-f"><label class="lab" for="' + id + '">Hours</label><div class="in"><input type="time" id="' + id + '" data-f="start" value="' + esc(F.start) + '" aria-label="Start"><i>–</i><input type="time" data-f="end" value="' + esc(F.end) + '" aria-label="End">' +
        chips.map(function (c) { return '<button type="button" class="rp-chip" data-act="hrs" data-s="' + c.s + '" data-e="' + c.e + '" aria-pressed="' + (F.start === c.s && F.end === c.e) + '">' + esc(c.w + " " + span(c.s, c.e)) + "</button>"; }).join("") + "</div></div>";
    }
    function paint() {
      if (closed) return;
      var h = '<div class="rp rp-ap" role="group" aria-label="' + esc(titles[kind]) + '"><h2>' + esc(titles[kind]) + "</h2>";
      if (kind === "pattern" && people.length === 1) h += '<p class="rp-sum">' + esc(P.summary(opts.rotation || P.usualOf(people[0]))) + "</p>";
      h += whoHtml();
      if (kind === "pattern" || kind === "weekdays" || kind === "gaps" || kind === "role") {
        h += dateField("From", "from", F.from);
        if (kind === "pattern" || kind === "weekdays") {
          var tid = nid("to");
          h += '<div class="rp-f"><label class="lab" for="' + tid + '">To</label><div class="in"><select id="' + tid + '" data-f="toKind">' + [["until", "Until changed (12 months, then Extend)"], ["month", "End of that month"], ["year", "End of the year"], ["date", "A date…"]].map(function (o) { return '<option value="' + o[0] + '"' + (F.toKind === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" +
            (F.toKind === "date" ? '<input type="date" data-f="to" aria-label="To" value="' + esc(F.to || add(F.from, 27)) + '">' : '<span class="rp-sum" style="margin:0">' + esc("to " + dateW(range().to)) + "</span>") + "</div></div>";
        } else h += dateField("To", "to", F.to);
      }
      if (kind === "weekdays") {
        h += '<fieldset class="rp-f"><legend>Days</legend><div class="in">' + WD.map(function (w, i) { return '<button type="button" class="rp-chip" data-act="wd" data-d="' + (i + 1) + '" aria-pressed="' + (F.weekdays.indexOf(i + 1) >= 0) + '" aria-label="' + WDF[i] + '">' + w + "</button>"; }).join("") +
          '<button type="button" class="rp-btn l" data-act="wdset" data-v="1,2,3,4,5">Mon–Fri</button><button type="button" class="rp-btn l" data-act="wdset" data-v="6,7">Weekends</button><button type="button" class="rp-btn l" data-act="wdset" data-v="1,2,3,4,5,6,7">Every day</button></div></fieldset>';
        var eid = nid("ev");
        h += '<div class="rp-f"><label class="lab" for="' + eid + '">How often</label><div class="in"><select id="' + eid + '" data-f="every">' + [[1, "Every week"], [2, "Every other week"], [3, "Every 3rd week"], [4, "Every 4th week"]].map(function (o) { return '<option value="' + o[0] + '"' + (+F.every === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" + (F.every > 1 ? '<span class="rp-sum" style="margin:0">' + esc("starting the week of " + dateW(monday(F.from))) + "</span>" : "") + "</div></div>";
      }
      if (kind === "days") {
        h += '<div class="rp-f"><span class="lab">Days</span><div class="in">' + (F.dates.length ? F.dates.map(function (d) { return '<button type="button" class="rp-chip" data-act="undate" data-d="' + d + '" aria-label="Remove ' + esc(dayW(d)) + '">' + esc(dayW(d)) + " ×</button>"; }).join("") : '<span class="rp-sum" style="margin:0">No days yet</span>') +
          '<input type="date" data-f="adddate" aria-label="Add a day"><button type="button" class="rp-btn" data-act="adddate">Add day</button></div></div>';
      }
      if (kind === "weekdays" || kind === "days") h += hoursField();
      if (kind === "copy") {
        var u = F.unit, sid = nid("src");
        h += '<div class="rp-f"><label class="lab" for="' + sid + '">Copy</label><div class="in"><select id="' + sid + '" data-f="unit">' + [["day", "A day"], ["week", "A week"], ["2w", "2 weeks"], ["4w", "4 weeks"], ["month", "A month"]].map(function (o) { return '<option value="' + o[0] + '"' + (u === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select><input type="date" data-f="srcFrom" aria-label="Starting" value="' + esc(F.srcFrom) + '"><span class="rp-sum" style="margin:0">' + esc(rangeW(F.srcFrom, F.srcTo)) + "</span></div></div>";
        h += '<fieldset class="rp-f"><legend>To</legend><div class="in">' +
          '<label class="r"><input type="radio" name="' + ids.live + 'h" data-f="repeatHow" value="times"' + (F.repeatHow === "times" ? " checked" : "") + '>Repeat it</label><input type="number" min="1" max="52" data-f="times" aria-label="How many times" value="' + esc(F.times) + '"><span>times</span>' +
          '<label class="r"><input type="radio" name="' + ids.live + 'h" data-f="repeatHow" value="until"' + (F.repeatHow === "until" ? " checked" : "") + '>Repeat until</label><input type="date" data-f="until" aria-label="Until" value="' + esc(F.until) + '">' +
          '<label class="r"><input type="radio" name="' + ids.live + 'h" data-f="repeatHow" value="to"' + (F.repeatHow === "to" ? " checked" : "") + '>Copy once to</label><input type="date" data-f="copyTo" aria-label="Copy to" value="' + esc(F.copyTo) + '"></div></fieldset>';
      }
      if (kind === "lastweek") h += dateField("Week of", "from", monday(F.from)) + '<p class="rp-sum">' + esc("Copies " + rangeW(add(monday(F.from), -7), add(monday(F.from), -1)) + " onto " + rangeW(monday(F.from), add(monday(F.from), 6))) + "</p>";
      if (kind !== "gaps" && kind !== "role") h += '<fieldset class="rp-f"><legend>Days that already have a shift</legend><div class="in"><label class="r"><input type="radio" name="' + ids.live + 'm" data-f="mode" value="keep"' + (F.mode === "keep" ? " checked" : "") + '>Keep them, fill only empty days</label><label class="r"><input type="radio" name="' + ids.live + 'm" data-f="mode" value="replace"' + (F.mode === "replace" ? " checked" : "") + ">Replace them</label></div></fieldset>";
      h += '<div id="' + ids.live + '" aria-live="polite"></div></div>';
      mount.innerHTML = h;
      paintPreview();
    }
    function paintPreview() {
      if (closed) return;
      var box = mount.querySelector("#" + ids.live); if (!box) return;
      var h = "";
      if (!pv && !msg) h = '<div class="rp-pv">Working out what changes…</div>';
      else if (pv) {
        var w = pv.words, np = exs.filter(function (x) { return x.noPattern; });
        h += '<div class="rp-pv"><b class="t">' + esc(w.title) + "</b><p>" + esc(w.line) + "</p>";
        if (np.length) h += '<p class="warn">' + esc(np.map(function (x) { return first(x.name); }).join(", ") + (np.length === 1 ? " has" : " have") + " no usual week yet — set it first in their Usual week.") + "</p>";
        if (w.removes) h += '<p class="bad">' + esc(w.removes) + "</p>";
        if (w.skips) h += "<p>" + esc(w.skips) + "</p>";
        if (w.trims) h += "<p>" + esc(w.trims) + "</p>";
        if (w.asked) h += '<p class="warn">' + esc(w.asked) + "</p>";
        if (exs[0] && exs[0].unfilled && exs[0].unfilled.length) h += '<p class="bad">' + esc(exs[0].unfilled.slice(0, 3).map(function (u) { return u.words; }).join(" · ") + (exs[0].unfilled.length > 3 ? " · and " + (exs[0].unfilled.length - 3) + " more" : "")) + "</p>";
        if (w.after) h += "<p" + (/still no pharmacist/.test(w.after) ? ' class="warn"' : "") + ">" + esc(w.after) + "</p>";
        if (exs.some(function (x) { return x.skip.some(function (s) { return s.why === "unavailable"; }); }) && !F.anyway) h += '<p><button type="button" class="rp-btn l" data-act="anyway">Add on the days they can\'t work too</button></p>';
        if (w.nothing) h += "<p>" + esc(w.nothing) + "</p>";
        if (pv.days.length) h += '<p><button type="button" class="rp-btn l" data-act="detail" aria-expanded="' + !!F.detail + '">' + (F.detail ? "Hide day by day" : "Show day by day") + "</button></p>" + (F.detail ? strip(pv.days) : "");
        h += "</div>";
      }
      if (msg) h += '<div class="rp-err" role="alert">' + esc(msg) + "</div>";
      var label = saving ? saving : pv ? pv.words.button : "…";
      h += '<div class="rp-acts"><button type="button" class="rp-btn" data-act="cancel">Cancel</button><button type="button" class="rp-btn p" data-act="go"' + (!pv || pv.nothing || busy ? " disabled" : "") + ">" + esc(label) + "</button></div>";
      box.innerHTML = h;
    }
    function strip(marks) { // month strips: + added, ● kept, − removed, · skipped (reason as the title and for screen readers)
      var by = {}; marks.forEach(function (m) { var k2 = m.date.slice(0, 7); (by[k2] = by[k2] || {})[m.date] = (by[k2][m.date] || []).concat([m]); });
      var sym = { add: "+", keep: "●", remove: "−", skip: "·" }, h = '<div class="rp-strip">';
      Object.keys(by).sort().slice(0, 14).forEach(function (mk) {
        var f = mk + "-01", pad0 = mi(f), n = +monthEnd(f).slice(8), cells = "";
        for (var i = 0; i < pad0; i++) cells += '<li aria-hidden="true"></li>';
        for (var d = 1; d <= n; d++) {
          var ymd = mk + "-" + String(d).padStart(2, "0"), ms = by[mk][ymd] || [], m0 = ms[0];
          var words = ms.map(function (m) { return (exs.length > 1 ? first(personOf({ staff: allStaff }, m.staff_id).full_name) + ": " : "") + m.words; }).join("; ");
          cells += "<li" + (m0 ? ' class="' + m0.mark + '" title="' + esc(dayW(ymd) + " — " + words) + '"' : "") + ">" + d + (m0 ? '<span class="rp-sr"> ' + esc(words) + "</span>" + '<span aria-hidden="true">' + sym[m0.mark] + "</span>" : "") + "</li>";
        }
        var dd = dt(f); h += "<h3>" + MON[dd.getUTCMonth()] + " " + dd.getUTCFullYear() + '</h3><ol class="wd" aria-hidden="true">' + WD.map(function (w) { return "<li>" + w.slice(0, 2) + "</li>"; }).join("") + "</ol><ol>" + cells + "</ol>";
      });
      return h + '<div class="key"><span>+ added</span><span>● kept</span><span>− removed</span><span>· skipped (reason on hover)</span></div></div>';
    }
    function setVal(f, v, t) {
      if (f === "who") { var s = str(t.value); F.who = t.checked ? F.who.concat([s]) : F.who.filter(function (x) { return x !== s; }); }
      else if (f === "every" || f === "times") F[f] = Math.max(1, parseInt(v, 10) || 1);
      else if (f === "srcFrom") { if (!YMD.test(v)) return; setSrc(v, F.unit); }
      else if (f === "unit") { F.unit = v; setSrc(F.srcFrom || mon0, v); }
      else if (f === "adddate") return;
      else F[f] = v;
      if (f === "role") F.roleWhoAll = true;
    }
    function setSrc(a, u) {
      if (u === "day") { F.srcFrom = a; F.srcTo = a; }
      else if (u === "month") { F.srcFrom = a.slice(0, 8) + "01"; F.srcTo = monthEnd(F.srcFrom); }
      else { var m = monday(a), n = u === "2w" ? 2 : u === "4w" ? 4 : 1; F.srcFrom = m; F.srcTo = add(m, 7 * n - 1); }
      var span0 = days(F.srcFrom, F.srcTo) + 1; F.copyTo = u === "month" ? addMonths(F.srcFrom, 1) : add(F.srcFrom, span0 < 7 ? 1 : span0);
    }
    var structural = { toKind: 1, unit: 1, repeatHow: 1, role: 1, every: 1, kind: 1 };
    mount.addEventListener("change", function (e) {
      var t = e.target, f = t.getAttribute && t.getAttribute("data-f"); if (!f) return;
      if (t.type === "radio" && !t.checked) return;
      setVal(f, t.value, t); pv = null; msg = "";
      if (structural[f] || f === "srcFrom" || f === "from") { var keep = f; paint(); var back = mount.querySelector('[data-f="' + keep + '"]'); if (back) back.focus(); } else paintPreview();
      refresh();
    });
    on(mount, "[data-act]", "click", function (e, t) {
      var a = t.getAttribute("data-act");
      if (a === "cancel") { close(); if (opts.onCancel) opts.onCancel(); return; }
      if (a === "go") { go(); return; }
      if (a === "detail") { F.detail = !F.detail; paintPreview(); var b = mount.querySelector('[data-act="detail"]'); if (b) b.focus(); return; }
      if (a === "anyway") { F.anyway = true; compute(); paintPreview(); return; }
      if (a === "hrs") { F.start = t.getAttribute("data-s"); F.end = t.getAttribute("data-e"); }
      else if (a === "wd") { var d = +t.getAttribute("data-d"); F.weekdays = F.weekdays.indexOf(d) >= 0 ? F.weekdays.filter(function (x) { return x !== d; }) : F.weekdays.concat([d]).sort(); }
      else if (a === "wdset") F.weekdays = t.getAttribute("data-v").split(",").map(Number);
      else if (a === "undate") F.dates = F.dates.filter(function (x) { return x !== t.getAttribute("data-d"); });
      else if (a === "adddate") { var inp = mount.querySelector('[data-f="adddate"]'); if (inp && YMD.test(inp.value) && F.dates.indexOf(inp.value) < 0) F.dates = F.dates.concat([inp.value]).sort(); }
      pv = null; var sel = '[data-act="' + a + '"]' + (t.getAttribute("data-d") && a === "wd" ? '[data-d="' + t.getAttribute("data-d") + '"]' : "");
      paint(); var bk = mount.querySelector(sel) || mount.querySelector('[data-f="adddate"]'); if (bk) bk.focus();
      refresh();
    });
    mount.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); if (opts.onCancel) opts.onCancel(); }
      else if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-f") === "adddate") { e.preventDefault(); var b = mount.querySelector('[data-act="adddate"]'); if (b) b.click(); }
    });
    async function go() {
      if (!pv || pv.nothing || busy) return;
      busy = true; saving = "Saving…"; msg = ""; paintPreview();
      var res = await P.apply(exs, { label: titles[kind], onProgress: function (d, n) { if (n > 1) { saving = "Saving… " + d + " of " + n; paintPreview(); } } });
      busy = false; saving = null;
      if (res.done) {
        if (kind === "pattern" && F.toKind === "until") {
          for (var i = 0; i < exs.length; i++) { var x = exs[i]; if (x.rid && (x.add.length || x.remove.length || x.keep.length)) { try { await P.setPlan(x.staff_id, { rid: x.rid, from: x.from, through: x.to, keep: F.mode === "keep" }); } catch (e3) { res.words += ". (Could not remember 'until changed': " + failText(e3) + ")"; } } }
        }
        close();
        P.ui.undoToast(res, { onUndone: opts.onUndone || opts.onDone });
        if (opts.onDone) opts.onDone(res);
        return;
      }
      if (res.changed) { D.key = ""; pv = null; refresh(true); }
      msg = res.words; bad = true; paintPreview();
      var gb = mount.querySelector('[data-act="go"]'); if (gb) gb.focus();
    }
    function close() { closed = true; clearTimeout(timer); mount.innerHTML = ""; }
    paint(); refresh(true);
    var f0 = mount.querySelector("input, select, button"); if (f0) f0.focus();
    return { close: close, _state: F, _preview: function () { return pv; }, _exs: function () { return exs; } };
  };

  // ---- ui.recent: Recent changes, each with Undo --------------------------------------------------------------
  P.ui.recent = function (mount, opts) {
    css(); opts = opts || {}; var closed = false, ask = null, msg = "", busy = false;
    function when(iso) { var d = new Date(iso); return E.maltaHm ? E.maltaHm(d) : d.toISOString().slice(11, 16); }
    function paint() {
      if (closed) return;
      var l = P.recent(), h = '<div class="rp rp-rc"><h2>Recent changes</h2>';
      if (!l.length) h += '<p class="rp-sum">Nothing yet. Fills, copies and patterns you put on the rota in this session are listed here, each with Undo.</p>';
      else h += '<ul class="rp-rec">' + l.map(function (r) {
        var b = r.undone ? '<span class="rp-sum" style="margin:0">Undone</span>' : '<button type="button" class="rp-btn" data-act="undo" data-id="' + esc(r.undoId) + '"' + (busy ? " disabled" : "") + ">Undo</button>";
        if (ask && ask.id === r.undoId) b = '<button type="button" class="rp-btn" data-act="keep">Keep it</button><button type="button" class="rp-btn d" data-act="anyway" data-id="' + esc(r.undoId) + '">Undo anyway</button>';
        return '<li><div class="w"><b>' + esc(r.words) + "</b><span>" + esc(when(r.at) + (r.restoreFailed ? " · could not be put back — Undo to try again" : r.unsure ? " · not sure it saved — Undo puts it back" : "")) + "</span>" + (ask && ask.id === r.undoId ? '<span role="alert">' + esc(ask.words) + "</span>" : "") + "</div>" + b + "</li>";
      }).join("") + "</ul>";
      h += (msg ? '<p role="status">' + esc(msg) + "</p>" : "") + '<div class="rp-acts"><button type="button" class="rp-btn" data-act="close">Close</button></div></div>';
      mount.innerHTML = h;
    }
    on(mount, "[data-act]", "click", async function (e, t) {
      var a = t.getAttribute("data-act"), id = t.getAttribute("data-id");
      if (a === "close") { closed = true; mount.innerHTML = ""; if (opts.onCancel) opts.onCancel(); return; }
      if (a === "keep") { ask = null; paint(); return; }
      if (a !== "undo" && a !== "anyway") return;
      busy = true; msg = "Undoing…"; paint();
      var r = await P.undo(id, { anyway: a === "anyway" });
      busy = false;
      if (!r.done && r.changedSince && r.changedSince.length && a !== "anyway") { ask = { id: id, words: r.words }; msg = ""; paint(); var x = mount.querySelector('[data-act="anyway"]'); if (x) x.focus(); return; }
      ask = null; msg = r.words; paint();
      if (r.done && opts.onDone) opts.onDone(r);
    });
    paint();
    return { close: function () { closed = true; mount.innerHTML = ""; } };
  };

  // ---- ui.undoToast: "Added 238 shifts for Maria · Undo" for 10 s ------------------------------------------
  P.ui.undoToast = function (res, opts) {
    css(); opts = opts || {};
    var old = document.getElementById("rp-toast"); if (old) old.remove();
    if (!res || !res.words) return { close: function () {} };
    var t = document.createElement("div"); t.id = "rp-toast"; t.className = "rp-toast"; t.setAttribute("role", "status");
    t.innerHTML = "<span>" + esc(res.words) + "</span>" + (res.undoId ? '<button type="button" class="rp-btn" data-act="undo">Undo</button>' : "");
    document.body.appendChild(t);
    var timer = setTimeout(function () { t.remove(); }, 10000);
    var b = t.querySelector("button");
    if (b) b.addEventListener("click", async function () {
      clearTimeout(timer); b.disabled = true; t.firstChild.textContent = "Undoing…";
      var r = await P.undo(res.undoId);
      if (!r.done && r.changedSince && r.changedSince.length) {
        t.firstChild.textContent = r.words; b.disabled = false; b.textContent = "Undo anyway";
        b.onclick = async function (ev) { ev.stopImmediatePropagation(); b.disabled = true; var r2 = await P.undo(res.undoId, { anyway: true }); t.firstChild.textContent = r2.words; b.remove(); setTimeout(function () { t.remove(); }, 6000); if (r2.done && opts.onUndone) opts.onUndone(r2); };
        return;
      }
      t.firstChild.textContent = r.words; b.remove(); setTimeout(function () { t.remove(); }, 6000);
      if (r.done && opts.onUndone) opts.onUndone(r);
    }, { once: true });
    return { close: function () { clearTimeout(timer); t.remove(); } };
  };

  // ---- ui.extendLine: one quiet line 8 weeks before an "until changed" plan runs out ----------------------
  P.ui.extendLine = function (mount, opts) {
    css(); opts = opts || {}; var closed = false;
    P.plans().then(function () {
      if (closed) return;
      var due = P.extendDue(today(), null, opts.staff || []);
      if (!due.length) { mount.innerHTML = ""; return; }
      mount.innerHTML = '<div class="rp">' + due.map(function (x) { return '<div class="rp-ext"><span>' + esc(x.words) + '</span><button type="button" class="rp-btn" data-act="ext" data-sid="' + esc(x.staff_id) + '">Extend 6 months</button></div>'; }).join("") + "</div>";
    });
    on(mount, '[data-act="ext"]', "click", function (e, t) {
      var x = P.extendDue(today(), null, opts.staff || []).filter(function (d) { return str(d.staff_id) === t.getAttribute("data-sid"); })[0]; if (!x) return;
      var p = (opts.staff || []).filter(function (s) { return str(s.id) === str(x.staff_id); })[0] || { id: x.staff_id, full_name: "" };
      var host = opts.dialogMount || mount;
      P.ui.applyDialog(host, { kind: "pattern", person: p, from: x.from > today() ? x.from : today(), to: x.to, mode: "keep", onDone: async function (r) { try { var pl = (await P.plans(true))[str(x.staff_id)] || {}; await P.setPlan(x.staff_id, Object.assign({}, pl, { through: x.to })); } catch (e2) {} if (opts.onDone) opts.onDone(r); }, onCancel: opts.onCancel });
    });
    return { close: function () { closed = true; mount.innerHTML = ""; } };
  };
})();
