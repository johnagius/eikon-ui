// Roster planner, rules and live warnings (SPEC §13 A10): on the shared busy-pharmacy seed (its own pharmacy), with the
// rules and availability set through the planner's own sheets (E.rotaSet: Rules, "When can't they work?") and the rows
// as the server stores them, E.rotaCheck lists each of the 11 kinds on its seeded case and NOT on the case next to it:
//   cover (Tue gap) vs Mon · staff (minimum 2: Tue 15:30–19:30 one person) vs Mon · leave (whole day; part-day overlap)
//   vs a day off leave and a shift after the part-day leave · asked (pending) vs the next day · double vs two shifts that
//   only touch · hours (45 h on a 40 h contract) vs 37.5 h · wtd (50 h) vs 45 h · rest (9.5 h) vs 19.5 h · closed (Staff
//   training) vs a holiday the pharmacy opened · avail (Saturdays only 09:00–13:00: an 08:00 start) vs a shift inside it ·
//   twoph (two pharmacists 09:00–17:00) vs a 30-minute handover.
// Cover words == E.teamCover == the classic checkCov (ported as in rota.mjs). Turning a kind off in Rules hides it;
// "A pharmacist must be on: No" hides the cover gaps. Every item has a one-tap fix. 0 requests for the list.
import { rpSeed } from "./_rpseed.mjs";
import { ymdAdd } from "../../clock.mjs";

function classicGaps(ds, S) { // modules.shifts.js checkCov with its ohFor, gaps joined (as tests/real/cases/rota.mjs)
  const t2m = (t) => { if (!t) return 0; const p = t.split(":"); return +p[0] * 60 + (+p[1] || 0); };
  const ohFor = (d) => { const ov = (S.hours.overrides || {})[d]; if (ov) return ov; if (S.ph(d)) return { open: "", close: "", closed: true }; const w = new Date(d).getDay(); const b = (S.hours.weekly && S.hours.weekly[w]) || S.hours.default; return { open: b.open || "07:30", close: b.close || "19:30", closed: !!b.closed }; };
  const oh = ohFor(ds); if (oh.closed) return [];
  const min = parseInt(S.settings.minPharmacists, 10) || 1, need = !!S.settings.pharmacistRequired;
  const onLeave = {}; S.leaves.filter((l) => l.status === "approved" && l.start_date <= ds && l.end_date >= ds).forEach((l) => { onLeave[l.staff_id] = true; });
  const openM = t2m(oh.open || "07:30"), closeM = t2m(oh.close || "19:30"); const ev = [];
  S.shifts.filter((s) => s.shift_date === ds).forEach((s) => { if (onLeave[s.staff_id]) return; const e = S.staff.find((x) => x.id === s.staff_id); if (!((e && (e.designation === "pharmacist" || e.designation === "locum")) || s.role_override === "pharmacist")) return; const st = Math.max(openM, t2m(s.start_time)), et = Math.min(closeM, t2m(s.end_time)); if (et > st) ev.push({ t: st, d: 1 }, { t: et, d: -1 }); });
  const hm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  if (!ev.length) return need ? [hm(openM) + "–" + hm(closeM)] : [];
  ev.sort((a, b) => a.t - b.t || b.d - a.d); const g = []; let c = 0, cur = openM, i = 0;
  while (i < ev.length && ev[i].t <= openM) { c += ev[i].d; i++; }
  while (cur < closeM) { const nx = i < ev.length ? Math.min(ev[i].t, closeM) : closeM; if (nx > cur) { if (need && c < min) g.push([cur, nx]); cur = nx; } while (i < ev.length && ev[i].t === cur) { c += ev[i].d; i++; } if (i >= ev.length && cur >= closeM) break; if (i >= ev.length && cur < closeM) { if (need && c < min) g.push([cur, closeM]); break; } }
  const j = []; g.forEach((x) => { if (j.length && j[j.length - 1][1] === x[0]) j[j.length - 1][1] = x[1]; else j.push(x.slice()); });
  return j.map((x) => hm(x[0]) + "–" + hm(x[1]));
}

export default {
  title: "Roster planner: the 11 warnings, each on its case and not its neighbour; cover = E.teamCover = classic",
  async run(t) {
    const S = await rpSeed(t, { tag: "rules", weeks: 3 }), d = S.d, I = S.ids;
    const add = (sid, day, s, e) => S.api("POST", "/shifts/assignments", { staff_id: sid, shift_date: day, start_time: s, end_time: e, notes: "" });
    await add(I.karl, d(5), "08:00", "13:00");                                        // hours: Karl 45 h on 40
    await add(I.rita, d(2), "08:00", "12:00");                                        // leave neighbour: Rita works the day before her leave
    await add(I.gorg, d(7), "08:00", "12:00"); await add(I.gorg, d(7), "11:00", "14:00");  // double
    await add(I.gorg, d(11), "08:00", "12:00"); await add(I.gorg, d(11), "12:00", "14:00"); // touching, not double
    for (const i of [7, 8, 9, 11, 12]) await add(I.censina, d(i), "07:30", "17:30");   // wtd: 50 h
    await add(I.joe, d(7), "13:30", "19:30"); await add(I.joe, d(8), "05:00", "12:00"); await add(I.joe, d(9), "07:30", "13:30"); // rest 9.5 h, then 19.5 h
    await add(I.karl, d(8), "09:00", "11:00"); await add(I.karl, d(8), "12:00", "16:00");  // part-day leave 08–12: one overlaps, one after
    await add(I.lara, d(9), "08:00", "12:00"); await add(I.lara, d(11), "08:00", "12:00"); // asked (pending d9) vs the day after
    await add(I.lara, d(12), "09:00", "13:00");                                        // avail: inside "Saturdays only 09:00–13:00"
    await add(I.gorg, d(10), "08:00", "12:00");                                        // closed: Staff training
    if (S.openDay) await add(I.maria, S.openDay, "08:00", "12:00");                     // a holiday the pharmacy opened: not "closed"

    const p = await S.page();
    await t.open(p, "2", "shfreg", "shfreg");
    // Rules through the planner's sheet: at least 2 people on at once
    await p.evaluate(() => window.EIKON.rotaSet.open("rules")); await p.waitForSelector(".rps [data-f=rules]"); await t.idle(p);
    await p.fill(".rps [data-f=rules] [name=minstaff]", "2");
    await t.write(p, /\/shifts\/settings$/, () => p.click(".rps [data-f=rules] [type=submit]"), "PUT"); await p.keyboard.press("Escape");
    // Lara: Saturdays only 09:00–13:00 (the availability sheet)
    const lara = S.people.find((x) => x.id === I.lara);
    await p.evaluate((x) => window.EIKON.rotaSet.open("availability", x), lara); await p.waitForSelector(".rps [data-f=avail]"); await t.idle(p);
    await p.selectOption(".rps [data-f=avail] [name=w6]", "only"); await p.fill(".rps [data-f=avail] [name=w6f]", "09:00"); await p.fill(".rps [data-f=avail] [name=w6t]", "13:00");
    await t.write(p, /\/shifts\/settings$/, () => p.click(".rps [data-f=avail] [type=submit]"), "PUT"); await p.keyboard.press("Escape");

    const from = d(0), to = d(13), api = (u) => S.api("GET", u);
    const shifts = (await api(`/shifts/assignments-range?from=${ymdAdd(from, -1)}&to=${ymdAdd(to, 1)}`)).shifts, staff = (await api("/shifts/staff?include_inactive=1")).staff;
    const leaves = (await api("/shifts/leaves?year=" + from.slice(0, 4))).leaves.concat(to.slice(0, 4) !== from.slice(0, 4) ? (await api("/shifts/leaves?year=" + to.slice(0, 4))).leaves : []);
    const hours = (await api("/shifts/opening-hours")).hours, settings = (await api("/shifts/settings")).settings;
    const run = (o) => p.evaluate(({ from, to, o }) => { const E = window.EIKON, n0 = performance.getEntriesByType("resource").length; const r = E.rotaCheck({ from, to }, o); return { r, reqs: performance.getEntriesByType("resource").length - n0 }; }, { from, to, o });
    const { r, reqs } = await run({ shifts, staff, leaves, hours, settings });
    const has = (k, day, sid, re) => r.some((x) => x.kind === k && x.date === day && (sid == null || String(x.staff_id) === String(sid)) && (!re || re.test(x.words)));
    const kinds = {};
    r.forEach((x) => { kinds[x.kind] = (kinds[x.kind] || 0) + 1; });
    t.note("kinds " + JSON.stringify(kinds));
    const pairs = [
      ["cover", has("cover", d(1), null, /^No pharmacist Tue \d+ \w+ 14:00–19:30$/), !has("cover", d(0))],
      ["staff", has("staff", d(1), null, /^Only 1 person on Tue \d+ \w+ 15:30–19:30 \(at least 2 wanted\)$/), !has("staff", d(0))],
      ["leave (whole day)", has("leave", d(3), I.rita, /^Rita is on annual leave Thu \d+ \w+ but planned 11:30–19:30$/), !has("leave", d(2), I.rita)],
      ["leave (part day)", r.filter((x) => x.kind === "leave" && x.date === d(8) && x.staff_id === I.karl).length === 1 && has("leave", d(8), I.karl, /planned 09:00–11:00$/), !has("leave", d(8), I.karl, /12:00–16:00/)],
      ["asked", has("asked", d(9), I.lara, /^Lara asked for annual leave Wed \d+ \w+ \(planned 08:00–12:00\)$/), !has("asked", d(11), I.lara)],
      ["double", has("double", d(7), I.gorg, /^Ġorġ has two shifts at once on Mon \d+ \w+ \(08:00–12:00 and 11:00–14:00\)$/), !has("double", d(11), I.gorg)],
      ["hours", has("hours", d(0), I.karl, /^Karl: 45 h in the week of \d+ \w+ \(contract 40 h\)$/), !r.some((x) => (x.kind === "hours" || x.kind === "wtd") && x.staff_id === I.maria)],
      ["wtd", has("wtd", d(7), I.censina, /^Ċensina: 50 h in the week of \d+ \w+ — over the 48-hour limit$/), !has("wtd", d(0), I.karl)],
      ["rest", has("rest", d(8), I.joe, /^Joe: 9\.5 h rest between Mon \d+ \w+ 19:30 and Tue \d+ \w+ 05:00 \(11 h needed\)$/), !has("rest", d(9), I.joe)],
      ["closed", has("closed", d(10), null, /^Thu \d+ \w+: Closed — 1 shift planned$/), !r.some((x) => x.kind === "closed" && x.date !== d(10))],
      ["avail", has("avail", d(5), I.lara, /^Lara can only work 09:00–13:00 on Saturdays — planned Sat \d+ \w+ 08:00–13:00$/), !has("avail", d(12), I.lara)],
      ["twoph", has("twoph", d(4), null, /are both on as pharmacist Fri \d+ \w+ 09:00–(14:00|17:00)/), !has("twoph", d(0))]
    ];
    for (const [k, yes, no] of pairs) t.ok(yes && no, `${k}: fires on its case (${yes}) and not on its neighbour (${no}): ` + JSON.stringify(r.filter((x) => x.kind === k.split(" ")[0]).map((x) => x.date + " " + x.words)));
    t.ok(r.every((x) => x.fix && x.fix.label && x.fix.act && x.id && ["problem", "warn", "info"].includes(x.level)), "every item has a level, an id and a one-tap fix");
    t.ok(reqs === 0, "the list costs no request: " + reqs);
    // the holiday the pharmacy opened (Duty roster) is not "closed"
    if (S.openDay) { const h = await p.evaluate(({ day, o }) => window.EIKON.rotaCheck(day, o).map((x) => x.kind), { day: S.openDay, o: { shifts: (await api(`/shifts/assignments-range?from=${S.openDay}&to=${S.openDay}`)).shifts, staff, leaves: [], hours, settings } }); t.ok(!h.includes("closed"), "a public holiday opened by an override is not a closed day: " + JSON.stringify(h)); }

    // cover words == E.teamCover == classic checkCov, day by day
    const ph = await p.evaluate((ds) => Object.fromEntries(ds.map((x) => [x, window.EIKON.maltaHoliday(x)])), [...Array(14).keys()].map(d));
    const weekly = {}; for (let w = 0; w < 7; w++) weekly[w] = hours.weekly[w];
    for (let i = 0; i < 14; i++) {
      const day = d(i), mine = r.filter((x) => x.kind === "cover" && x.date === day).map((x) => x.from + "–" + x.to);
      const tc = await p.evaluate(({ day, o }) => window.EIKON.teamCover(day, o), { day, o: { hours, settings, shifts, staff, leaves } });
      const cl = classicGaps(day, { hours: { ...hours, weekly }, settings, leaves, shifts, staff, ph: (x) => !!ph[x] });
      t.ok(mine.join() === tc.gaps.map((g) => g.from + "–" + g.to).join() && mine.join() === cl.join() && (!mine.length || tc.words === "No pharmacist " + mine.join(", ")), `cover ${day}: rotaCheck ${mine} = teamCover ${tc.words} = classic ${cl}`);
    }

    // turning a kind off in Rules hides it; "a pharmacist must be on: No" hides the gaps
    await p.goto("about:blank"); await t.open(p, "2", "shfreg", "shfreg");
    await p.evaluate(() => window.EIKON.rotaSet.open("rules")); await p.waitForSelector(".rps [data-f=rules]"); await t.idle(p);
    await p.uncheck(".rps [data-f=rules] [name=w_twoph]"); await p.selectOption(".rps [data-f=rules] [name=req]", "0");
    await t.write(p, /\/shifts\/settings$/, () => p.click(".rps [data-f=rules] [type=submit]"), "PUT");
    const s2 = (await api("/shifts/settings")).settings, r2 = (await run({ shifts, staff, leaves, hours, settings: s2 })).r;
    t.ok(!r2.some((x) => x.kind === "twoph" || x.kind === "cover") && r2.some((x) => x.kind === "staff") && s2.rota.warn.twoph === false && s2.pharmacistRequired === false && s2.rota.minStaff === 2 && s2.rota.avail[String(I.lara)].w[6].from === "09:00",
      "twoph off and cover not required: both gone, the rest stay, availability kept: " + JSON.stringify(s2.rota));

    // approving part-day leave trims the shifts it touches (Karl, 08:00–12:00 on d(8)): inside → removed, after → kept as
    // it is, around → the part before kept (PUT whole record) and the part after added (the classic add body)
    const wide = (await add(I.karl, d(8), "07:00", "14:00")).shift_id;
    const kd = (await api(`/shifts/assignments-range?from=${d(8)}&to=${d(8)}&staff_id=${I.karl}`)).shifts, lv = leaves.find((l) => l.id === S.leave.part);
    const sent = []; p.on("request", (q) => { if (q.method() !== "GET" && /\/shifts\/assignments/.test(q.url())) sent.push(q.method() + " " + new URL(q.url()).pathname + " " + (q.postData() || "")); });
    const res = await p.evaluate(async ({ lv, kd }) => { const S2 = window.EIKON.rotaSet, plan = S2.leaveTrim(lv, kd); return { words: plan.words, out: await S2.applyLeaveTrim(plan) }; }, { lv, kd });
    const after = S.rows(d(8), d(8), I.karl).map((x) => x.start_time + "–" + x.end_time + (x.id === wide ? "*" : "")).sort().join(", ");
    t.ok(res.words.split("; ").sort().join("; ").replace(/\w{3} \d+ \w{3} /g, "") === "07:00–14:00 becomes 07:00–08:00 and 12:00–14:00; 09:00–11:00 goes" && res.out.done === 2 && !res.out.failed.length && after === "07:00–08:00*, 12:00–14:00, 12:00–16:00",
      "part-day leave approved: the shifts it touches trimmed in words, the rest untouched: " + JSON.stringify(res) + " → " + after);
    const put = sent.find((x) => x.startsWith("PUT")), post = sent.find((x) => x.startsWith("POST"));
    t.ok(sent.length === 3 && put && JSON.stringify(Object.keys(JSON.parse(put.split(" ").slice(2).join(" ")))) === JSON.stringify(["id", "staff_id", "shift_date", "start_time", "end_time", "role_override", "notes"]) && post && JSON.stringify(Object.keys(JSON.parse(post.split(" ").slice(2).join(" ")))) === JSON.stringify(["staff_id", "shift_date", "start_time", "end_time", "notes"]), "the classic bodies: DELETE, whole-record PUT, the + Add shift POST: " + JSON.stringify(sent));
    const yrs = await p.evaluate(() => [window.EIKON.rotaSet.leaveYears("2027-01-04", "2027-01-31"), window.EIKON.rotaSet.leaveYears("2026-12-28", "2027-01-03"), window.EIKON.rotaSet.leaveYears("2026-11-16", "2026-11-22")]);
    t.ok(JSON.stringify(yrs) === "[[2026,2027],[2026,2027],[2026]]", "leave read per year: a January range also reads the December year (D-7): " + JSON.stringify(yrs));
  }
};
