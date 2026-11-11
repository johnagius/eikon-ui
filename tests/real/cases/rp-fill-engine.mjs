// Roster planner — the fill engines on the real worker (BOARD F2, F4, F5, F6 + F7 for each; the grid UI is B2's rp-fill):
//  F2 chosen weekdays over 6 months — Mon–Fri every week, Sat+Sun every other week, Tue+Thu every 3rd week: the rows
//     stored are exactly the date sets worked out here independently (Sundays closed, the closing override, the opening
//     override, Malta holidays, a day of leave skipped);
//  F4 copy a day to a day, a week forward ×3 (Keep: part-day leave trimmed, closed day skipped), a month to the next by
//     weekday position (1st Mon → 1st Mon; a missing 5th weekday named);
//  F5 a role at every opening hour: pharmacists over 2 weeks → E.rotaCheck shows no cover gap; a manager → the day the
//     only manager is on leave is listed "Still no manager …";
//  F6 fill the gaps (every added row inside a gap that was there) · same as last week (rows = the week before + 7 days,
//     notes and roles kept, the closed day named);
//  F7 for each: the worker's count = the preview's adds, rows after = before ∪ adds (Keep), Replace removes exactly the
//     preview's list, Undo = the snapshot; and the "split" answer of W1 falls back person by person, same rows.
import { rpSeed, maltaHoliday } from "./_rpseed.mjs";
import { ymdAdd } from "../../clock.mjs";

export default {
  title: "Roster planner: fill engines (weekdays, copy/repeat, role, gaps, last week) with preview = DB and undo",
  async run(t) {
    const S = await rpSeed(t, { tag: "fill", weeks: 6 });
    const mk = async (full_name, designation) => (await S.api("POST", "/shifts/staff", { full_name, designation, employment_type: "fulltime", contracted_hours: 40, email: "", phone: "", registration_number: "", is_active: 1, patterns_json: "{}" })).staff_id;
    const ids = { wk: await mk("Fill Weekdays", "assistant"), we: await mk("Fill Weekends", "assistant"), tt: await mk("Fill Tue Thu", "assistant"), mo: await mk("Fill Month", "assistant") };
    const lvDay = ymdAdd(S.mon, 21); // a Monday: approved whole-day leave for "Fill Weekdays"
    const lv = await S.api("POST", "/shifts/leaves", { staff_id: ids.wk, leave_type: "annual", start_date: lvDay, end_date: lvDay, start_time: null, end_time: null, hours_requested: 8, reason: "", status: "pending" });
    await S.api("POST", "/shifts/leaves/" + lv.leave_id + "/approve");
    const p = await S.page();
    await t.open(p, "2", "shfreg", "shfreg");
    const fields = (r) => [r.staff_id, r.shift_date, r.start_time, r.end_time, r.role_override, r.notes].join("|");
    const all = (from, to) => S.rows(from, to).map(fields).sort();
    // In the page: load what the screen would hold for [lo, hi], run one engine call, preview, apply.
    const run = (spec) => p.evaluate(async (spec) => {
      const E = window.EIKON, P = E.rotaPlan, rules = await E.rotaRules(true);
      const staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff;
      const shifts = (await E.apiFetch("/shifts/assignments-range?from=" + spec.lo + "&to=" + spec.hi, { method: "GET" })).shifts;
      let leaves = []; for (const y of [...new Set([spec.lo.slice(0, 4), spec.hi.slice(0, 4)])]) leaves = leaves.concat((await E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" })).leaves);
      const data = { staff, shifts, leaves, hours: rules.hours, settings: rules.settings }, who = (ids) => staff.filter((s) => ids.includes(s.id));
      const a = Object.assign({}, spec.args, { data }); if (a.people) a.people = who(a.people);
      const exs = P[spec.fn](a), pv = P.preview(exs);
      const res = spec.dry ? null : await P.apply(exs, { label: spec.fn });
      return { res, counts: pv.counts, words: pv.words, add: exs.flatMap((x) => x.add.map((r) => [x.staff_id, r.date, r.start_time, r.end_time, r.role_override, r.notes].join("|"))), remove: exs.flatMap((x) => x.remove.map((r) => r.id)), skip: exs.flatMap((x) => x.skip.map((s) => s.date + " " + s.why + " " + s.words)), unfilled: (exs[0] && exs[0].unfilled || []).map((u) => u.words), trim: exs.flatMap((x) => x.trim.map((q) => q.words)) };
    }, spec);
    const undo = (id) => p.evaluate((id) => window.EIKON.rotaPlan.undo(id, { anyway: true }), id);
    const calls = []; p.on("request", (r) => { const u = new URL(r.url()); if (/^\/shifts\/apply-(plan|pattern)$/.test(u.pathname)) calls.push(u.pathname); });

    // ---- F2 chosen weekdays over 6 months, three ways
    const from = S.d(14), to = ymdAdd(from, 181), wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
    const closed = (d) => { const ov = S.hours.overrides[d]; if (ov) return !!ov.closed; if (maltaHoliday(d)) return true; return !!S.hours.weekly[wd(d)].closed; };
    const weekNo = (d) => Math.floor((Date.parse(d) - Date.parse(from)) / 864e5 / 7); // from is a Monday
    const want = (days, every, sid, s, e, skip = []) => { const o = []; for (let d = from; d <= to; d = ymdAdd(d, 1)) if (days.includes(wd(d)) && weekNo(d) % every === 0 && !closed(d) && !skip.includes(d)) o.push([sid, d, s, e, "", ""].join("|")); return o; };
    const before2 = all(from, to);
    const f2 = [];
    for (const [sid, weekdays, every, days, s, e, skip] of [[ids.wk, [1, 2, 3, 4, 5], 1, [1, 2, 3, 4, 5], "08:00", "14:00", [lvDay]], [ids.we, [6, 7], 2, [6, 0], "08:00", "13:00", []], [ids.tt, [2, 4], 3, [2, 4], "09:00", "17:00", []]]) {
      const r = await run({ fn: "weekdays", lo: from, hi: to, args: { people: [sid], from, to, weekdays, every, block: { start: s, end: e } } });
      const exp = want(days, every, sid, s, e, skip), got = S.rows(from, to, sid).map(fields);
      f2.push({ sid, r, exp, got });
      t.ok(r.res.done && JSON.stringify(got) === JSON.stringify(exp) && JSON.stringify(r.add) === JSON.stringify(exp), "F2 " + JSON.stringify(weekdays) + " every " + every + ": stored == the date set worked out independently (" + exp.length + " shifts): " + JSON.stringify({ missing: exp.filter((x) => !got.includes(x)).slice(0, 3), extra: got.filter((x) => !exp.includes(x)).slice(0, 3) }));
      t.ok(r.res.inserted === r.counts.add && got.length === r.counts.add, "F7: the worker's count = the preview's adds (" + r.counts.add + ")");
    }
    t.ok(f2[0].r.skip.some((s) => s.startsWith(lvDay + " leave Fill is on annual leave")) && f2[0].r.words.skips.includes("1 day of leave"), "F2: the day of leave is skipped and named: " + f2[0].r.words.skips);
    t.ok(f2[1].r.skip.filter((s) => / closed /.test(s)).every((s) => wd(s.slice(0, 10)) === 0 || S.hours.overrides[s.slice(0, 10)]) && /days the pharmacy is closed/.test(f2[1].r.words.skips), "F2: the weekend fill skips the Sundays the pharmacy is closed, and says so: " + f2[1].r.words.skips);
    for (const x of f2) { const u = await undo(x.r.res.undoId); t.ok(u.done, "F7 undo: " + u.words); }
    t.ok(JSON.stringify(all(from, to)) === JSON.stringify(before2), "F7: after the three undos the 6 months are exactly as before");

    // ---- F4 copy a day → a day; a week forward ×3 (Keep); a month → the next by weekday position
    const b4 = all(S.mon, ymdAdd(S.mon, 70));
    const dayCopy = await p.evaluate(async ({ mon, d0, d14 }) => {
      const E = window.EIKON, P = E.rotaPlan, rules = await E.rotaRules(), staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff;
      const shifts = (await E.apiFetch("/shifts/assignments-range?from=" + mon + "&to=" + P.dates.add(mon, 27), { method: "GET" })).shifts;
      const exs = P.repeat({ rows: shifts, srcFrom: d0, srcTo: d0, to: { from: d14 }, data: { staff, shifts, leaves: [], hours: rules.hours, settings: rules.settings } });
      const res = await P.apply(exs, { label: "day" }); return { res, n: P.preview(exs).counts.add, src: shifts.filter((r) => r.shift_date === d0).length };
    }, { mon: S.mon, d0: S.d(0), d14: S.d(14) });
    const srcDay = S.rows(S.d(0), S.d(0)).map((r) => fields(Object.assign({}, r, { shift_date: S.d(14) }))).sort();
    t.ok(dayCopy.res.done && dayCopy.n === dayCopy.src && JSON.stringify(S.rows(S.d(14), S.d(14)).map(fields).sort()) === JSON.stringify(srcDay), "F4: a day copied to a day two weeks on (" + dayCopy.n + " shifts, notes and roles kept)");
    await undo(dayCopy.res.undoId);
    const wk = await p.evaluate(async ({ mon }) => {
      const E = window.EIKON, P = E.rotaPlan, rules = await E.rotaRules(), staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff;
      const shifts = (await E.apiFetch("/shifts/assignments-range?from=" + mon + "&to=" + P.dates.add(mon, 27), { method: "GET" })).shifts;
      let leaves = (await E.apiFetch("/shifts/leaves?year=" + mon.slice(0, 4), { method: "GET" })).leaves; if (P.dates.add(mon, 27).slice(0, 4) !== mon.slice(0, 4)) leaves = leaves.concat((await E.apiFetch("/shifts/leaves?year=" + P.dates.add(mon, 27).slice(0, 4), { method: "GET" })).leaves);
      const exs = P.repeat({ rows: shifts, srcFrom: mon, srcTo: P.dates.add(mon, 6), times: 3, data: { staff, shifts, leaves, hours: rules.hours, settings: rules.settings } });
      const pv = P.preview(exs), res = await P.apply(exs, { label: "week x3" });
      return { res, pv: pv.counts, words: pv.words, skip: exs.flatMap((x) => x.skip.map((s) => s.date + " " + s.why)), trim: exs.flatMap((x) => x.trim.map((q) => q.words)), asked: exs.flatMap((x) => x.asked.map((a) => a.date)) };
    }, { mon: S.mon });
    const src = S.rows(S.mon, S.d(6));
    const expWk = []; for (const k of [1, 2, 3]) for (const r of src) { const d = ymdAdd(r.shift_date, 7 * k); if (closed(d)) continue; if (r.staff_id === S.ids.rita && d === S.d(3)) continue; let s0 = r.start_time; if (r.staff_id === S.ids.karl && d === S.d(8)) s0 = "12:00"; expWk.push(fields(Object.assign({}, r, { shift_date: d, start_time: s0 }))); }
    const gotWk = S.rows(S.d(7), S.d(27)).map(fields).sort();
    t.ok(wk.res.done && JSON.stringify(gotWk) === JSON.stringify(expWk.sort()) && wk.pv.add === expWk.length, "F4: week 1 repeated ×3 = the source +7/+14/+21 days (" + expWk.length + " shifts), the closed day skipped, Karl's part-day leave trimmed: " + JSON.stringify({ missing: expWk.filter((x) => !gotWk.includes(x)).slice(0, 3), extra: gotWk.filter((x) => !expWk.includes(x)).slice(0, 3) }));
    t.ok(wk.skip.some((s) => s.startsWith(S.closedDay + " closed")) && wk.trim.some((q) => /12:00–15:30/.test(q)) && /days? the pharmacy is closed/.test(wk.words.skips), "F4: the preview names the closed day and the trim: " + JSON.stringify({ skips: wk.words.skips, trims: wk.words.trims, asked: wk.words.asked }));
    await undo(wk.res.undoId);
    t.ok(JSON.stringify(all(S.mon, ymdAdd(S.mon, 70))) === JSON.stringify(b4), "F7: undo of the day copy and the ×3 repeat → as before");
    // a month → the next month by weekday position, on "Fill Month"
    const m0 = ymdAdd(S.mon, 70).slice(0, 8) + "01", mEnd = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
    const m1 = (() => { const [y, mo] = m0.split("-").map(Number); return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10); })();
    const firstOf = (m, w) => { let d = m; while (wd(d) !== w) d = ymdAdd(d, 1); return d; };
    const srcDays = [0, 1, 2, 3, 4].map((n) => ymdAdd(firstOf(m0, 3), 7 * n)).filter((d) => d <= mEnd(m0)); // every Wednesday of the month
    for (const d of srcDays) await S.api("POST", "/shifts/assignments", { staff_id: ids.mo, shift_date: d, start_time: "10:00", end_time: "16:00", notes: "Wed " + d.slice(8) });
    const moR = await p.evaluate(async ({ m0, m0e, m1e, sid }) => {
      const E = window.EIKON, P = E.rotaPlan, rules = await E.rotaRules(), staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff;
      const shifts = (await E.apiFetch("/shifts/assignments-range?from=" + m0 + "&to=" + m1e + "&staff_id=" + sid, { method: "GET" })).shifts;
      const exs = P.repeat({ rows: shifts, srcFrom: m0, srcTo: m0e, times: 1, people: staff.filter((s) => s.id === sid), data: { staff, shifts, leaves: [], hours: rules.hours, settings: rules.settings } });
      const res = await P.apply(exs, { label: "month" }); return { res, skip: exs[0].skip.map((s) => s.why + " " + s.words), add: exs[0].add.map((r) => r.date + " " + r.notes) };
    }, { m0, m0e: mEnd(m0), m1e: mEnd(m1), sid: ids.mo });
    const expM = srcDays.map((d, n) => [ymdAdd(firstOf(m1, 3), 7 * n), d]).filter(([d]) => d <= mEnd(m1) && !closed(d)).map(([d, s]) => d + " Wed " + s.slice(8));
    const missM = srcDays.length === 5 && ymdAdd(firstOf(m1, 3), 28) > mEnd(m1);
    t.ok(moR.res.done && JSON.stringify(moR.add) === JSON.stringify(expM) && JSON.stringify(S.rows(m1, mEnd(m1), ids.mo).map((r) => r.shift_date + " " + r.notes)) === JSON.stringify(expM), "F4: a month → the next by weekday position (nth Wednesday → nth Wednesday): " + JSON.stringify({ add: moR.add, expM }));
    t.ok(!missM || moR.skip.some((s) => /^no-day No 5th Wednesday in /.test(s)), "F4: a missing 5th weekday is named: " + JSON.stringify(moR.skip));
    await undo(moR.res.undoId);

    // ---- F5 a role at every opening hour; F6 fill the gaps
    const r2 = { lo: S.mon, hi: S.d(13) };
    const coverAfter = () => p.evaluate(async ({ lo, hi }) => {
      const E = window.EIKON, rules = await E.rotaRules(), staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff;
      const shifts = (await E.apiFetch("/shifts/assignments-range?from=" + lo + "&to=" + hi, { method: "GET" })).shifts, leaves = (await E.apiFetch("/shifts/leaves?year=" + lo.slice(0, 4), { method: "GET" })).leaves.concat(hi.slice(0, 4) !== lo.slice(0, 4) ? (await E.apiFetch("/shifts/leaves?year=" + hi.slice(0, 4), { method: "GET" })).leaves : []);
      return E.rotaCheck({ from: lo, to: hi }, { staff, shifts, leaves, hours: rules.hours, settings: rules.settings }).filter((c) => c.kind === "cover").map((c) => c.date + " " + c.words);
    }, r2);
    const gapsBefore = await coverAfter();
    const b5 = all(r2.lo, r2.hi);
    const f6 = await run({ fn: "gaps", lo: r2.lo, hi: r2.hi, args: { from: r2.lo, to: r2.hi, role: "pharmacist" } });
    const gapsAfter = await coverAfter();
    const added = all(r2.lo, r2.hi).filter((x) => !b5.includes(x));
    const inGap = (row) => { const [, d, s, e] = row.split("|"); return gapsBefore.some((g) => g.startsWith(d + " ") && g.match(/(\d\d:\d\d)–(\d\d:\d\d)/g).some((sp) => { const [a, z] = sp.split("–"); return s >= a && e <= z; })); };
    t.ok(gapsBefore.length >= 5 && f6.res.done && gapsAfter.length === 0 && f6.unfilled.length === 0, "F5/F6: pharmacists for every open hour over 2 weeks → E.rotaCheck shows no cover gap (" + gapsBefore.length + " gaps before): " + JSON.stringify(gapsAfter));
    t.ok(added.length === f6.counts.add && added.every(inGap) && f6.res.inserted === f6.counts.add, "F6: every added row lies inside a gap that was there, count = preview: " + JSON.stringify(added.filter((x) => !inGap(x)).slice(0, 3)));
    await undo(f6.res.undoId);
    t.ok(JSON.stringify(all(r2.lo, r2.hi)) === JSON.stringify(b5), "F7: undo of the gap fill → as before");
    const f5 = await run({ fn: "gaps", lo: S.d(7), hi: S.d(13), args: { from: S.d(7), to: S.d(13), role: "manager" } });
    t.ok(f5.res.done && f5.unfilled.length === 1 && f5.unfilled[0].startsWith("Still no manager " + (await p.evaluate((d) => window.EIKON.rotaPlan.words.day(d), S.d(8)))) && !f5.add.some((x) => x.includes("|" + S.d(8) + "|") || x.includes("|" + S.closedDay + "|")), "F5: a manager at every opening hour — the day Karl (the only manager) is on leave is listed by name: " + JSON.stringify(f5.unfilled));
    await undo(f5.res.undoId);

    // ---- F6 same as last week (Keep) and a Replace whose removals = the preview's list
    const manual = await S.api("POST", "/shifts/assignments", { staff_id: S.ids.joe, shift_date: S.d(7), start_time: "10:00", end_time: "11:00", notes: "hand-made" });
    const b6 = S.rows(S.d(7), S.d(13));
    const lw = await run({ fn: "lastWeek", lo: S.mon, hi: S.d(13), args: { monday: S.d(7) } });
    const exp6 = src.map((r) => { const d = ymdAdd(r.shift_date, 7); if (closed(d) || (r.staff_id === S.ids.joe && d === S.d(7))) return null; return fields(Object.assign({}, r, { shift_date: d, start_time: r.staff_id === S.ids.karl && d === S.d(8) ? "12:00" : r.start_time })); }).filter(Boolean).sort();
    const got6 = S.rows(S.d(7), S.d(13)).map(fields).filter((x) => !b6.map(fields).includes(x)).sort();
    t.ok(lw.res.done && JSON.stringify(got6) === JSON.stringify(exp6) && S.rows(S.d(7), S.d(13)).some((r) => r.id === manual.shift_id), "F6: same as last week = the week before + 7 days (notes, roles kept; the closed day skipped; Joe's day with a hand-made shift kept): " + JSON.stringify({ missing: exp6.filter((x) => !got6.includes(x)).slice(0, 3), extra: got6.filter((x) => !exp6.includes(x)).slice(0, 3) }));
    await undo(lw.res.undoId);
    const rep = await run({ fn: "lastWeek", lo: S.mon, hi: S.d(13), args: { monday: S.d(7), mode: "replace" } });
    t.ok(rep.res.done && JSON.stringify(rep.remove) === JSON.stringify([manual.shift_id]) && /^Removes 1 shift: Joe Mon \d+ \w+ 10:00–11:00 \(note: 'hand-made'\)$/.test(rep.words.removes) && !S.rows(S.d(7), S.d(13)).some((r) => r.id === manual.shift_id), "F7 Replace: removes exactly the preview's list: " + rep.words.removes);
    const u7 = await undo(rep.res.undoId);
    t.ok(u7.done && JSON.stringify(S.rows(S.d(7), S.d(13)).map(fields).sort()) === JSON.stringify(b6.map(fields).sort()), "F7: Undo of the Replace puts the hand-made shift back");

    // ---- W1 says "split": person by person, then apply-pattern for a person still too big — same rows
    calls.length = 0;
    await p.route("**/shifts/apply-plan", async (r) => { const b = r.request().postDataJSON(); if (b.items.length > 1 || b.items[0].staff_id === S.ids.joe) return r.fulfill({ status: 400, contentType: "application/json", body: '{"ok":false,"error":"Too many shifts for one step","code":"split"}' }); return r.continue(); });
    const sp = await run({ fn: "lastWeek", lo: S.mon, hi: S.d(13), args: { monday: S.d(7) } });
    await p.unroute("**/shifts/apply-plan");
    const got8 = S.rows(S.d(7), S.d(13)).map(fields).filter((x) => !b6.map(fields).includes(x)).sort();
    t.ok(sp.res.done && JSON.stringify(got8) === JSON.stringify(exp6) && calls.includes("/shifts/apply-pattern") && calls.filter((c) => c === "/shifts/apply-plan").length > 2, "W1 'split' → per person, and apply-pattern for the one still refused: same rows (" + calls.length + " writes: " + [...new Set(calls)].join(", ") + ")");
    await undo(sp.res.undoId);
  }
};
