// Roster planner — classic round trip (SPEC §13 A6), on the real worker, the planner's code and the classic Shifts screen:
//  - a rotation saved by the planner appears in classic (Staff › Edit › Weekly Patterns) with readable names, week A
//    marked Provisional;
//  - editing the employee in classic (phone) and saving keeps the rotation: ids, anchor and times intact, the planner
//    reads the same rotation back (only notes inside week entries would be dropped by classic — none here);
//  - a classic-made pattern (Marija's "Usual") applies in the planner: the rows are the ones classic's own "Apply"
//    would store for those days (same dates, times; holidays and closed days skipped);
//  - classic still opens every tab on rows the planner made (no page error) and its Save Rules keeps rota.* keys.
import { rpSeed } from "./_rpseed.mjs";

export default {
  title: "Roster planner: classic round trip (patterns saved by the planner in classic and back)",
  async run(t) {
    const S = await rpSeed(t, { tag: "classic", weeks: 5 });
    const p = await S.page();
    await t.open(p, "2", "shfreg", "shfreg");
    // the planner saves Joe's alternate-Saturday rotation, puts week 3 on the rota (rota rows the planner made), and an until-changed plan
    const saved = await p.evaluate(async ({ joe, mon }) => {
      const P = window.EIKON.rotaPlan, B = (s, e) => ({ start: s, end: e });
      const np = await P.savePatterns(joe, (s) => { s.rotations.push({ rid: "cl4ss", n: 2, anchor: mon, name: "Usual", weeks: [[B("13:30", "19:30"), B("13:30", "19:30"), B("13:30", "19:30"), B("13:30", "19:30"), B("13:30", "19:30"), B("08:00", "13:00"), null], [B("13:30", "19:30"), B("13:30", "19:30"), B("13:30", "19:30"), B("13:30", "19:30"), B("13:30", "19:30"), null, null]] }); s.usual = "cl4ss"; return s; });
      await P.setPlan(joe, { rid: "cl4ss", from: mon, through: P.untilChangedEnd(mon), keep: true });
      return np.patterns_json;
    }, { joe: S.ids.joe, mon: S.mon });
    const before = JSON.parse(saved);
    t.ok(before.patterns.map((x) => x.id).join() === "rot.cl4ss.1of2." + S.mon + ",rot.cl4ss.2of2." + S.mon && before.provisionalId === "rot.cl4ss.1of2." + S.mon, "planner: stored as rot ids " + JSON.stringify(before.patterns.map((x) => x.id)));

    // ---- classic: Staff › Edit Joe shows the two weeks, readable, week A provisional; change the phone, Save
    const c = await S.page();
    await t.open(c, "classic", "shifts", "shifts");
    await c.click('[data-tab="staff"]');
    await c.waitForSelector("#sh-etbody tr");
    const row = c.locator("#sh-etbody tr", { hasText: "Joe Vella" });
    await row.locator("button", { hasText: "Edit" }).click();
    await c.waitForSelector("#se-patlist");
    const list = await c.evaluate(() => [...document.querySelectorAll("#se-patlist > div")].map((d) => d.textContent.replace(/\s+/g, " ").trim()));
    t.ok(list.length === 2 && /^Usual · week A of 2 Provisional ?Mon: 13:30–19:30 • .*Sat: 08:00–13:00 • Sun: off/.test(list[0]) && /^Usual · week B of 2 ?Mon.*Sat: off/.test(list[1]), "classic lists the rotation as two readable weekly patterns, week A provisional: " + JSON.stringify(list));
    await c.fill("#se-phone", "79 000 111");
    const put = await t.write(c, /^\/shifts\/staff\/\d+$/, () => c.evaluate(() => { const b = [...document.querySelectorAll("#eikon-modal-actions button, .eikon-modal-overlay button")].find((x) => x.textContent.trim() === "Save"); b.click(); }), "PUT");
    const after = t.row("shift_staff", S.ids.joe);
    const pa = JSON.parse(after.patterns_json);
    t.ok(put.status === 200 && after.phone === "79 000 111", "classic saved the employee");
    t.ok(JSON.stringify(pa.patterns.map((x) => [x.id, x.name, x.week])) === JSON.stringify(before.patterns.map((x) => [x.id, x.name, x.week])) && pa.provisionalId === before.provisionalId, "classic's save keeps ids, names, week entries (role included) and the provisional id");
    const back = await p.evaluate((pj) => { const P = window.EIKON.rotaPlan, s = P.parse(pj), u = P.usualOf({ patterns_json: pj }); return { usual: s.usual, n: u.n, anchor: u.anchor, sum: P.summary(u, u.anchor) }; }, after.patterns_json);
    t.ok(back.usual === "cl4ss" && back.n === 2 && back.anchor === S.mon && /^Mon–Fri 13:30–19:30 · Saturdays 08:00–13:00 every other week/.test(back.sum), "the planner reads the same rotation back: " + JSON.stringify(back));

    // ---- a classic-made pattern applies in the planner: Marija's "Usual" over week 3, Keep
    const from = S.d(14), to = S.d(20);
    const r = await p.evaluate(async ({ id, from, to }) => {
      const E = window.EIKON, P = E.rotaPlan, staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff, rules = await E.rotaRules(true);
      const m = staff.find((x) => x.id === id), existing = (await E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to + "&staff_id=" + id, { method: "GET" })).shifts;
      const x = P.expand({ person: m, rotation: P.usualOf(m), from, to, hours: rules.hours, settings: rules.settings, existing });
      const res = await P.apply([x], { label: "classic pattern" });
      return { res, add: x.add.map((a) => [a.date, a.start_time, a.end_time]), skip: x.skip, closed: [0, 1, 2, 3, 4, 5, 6].map((i) => P.dates.add(from, i)).map((d) => [d, E.teamCover(d, { hours: rules.hours, settings: rules.settings }).closed]) };
    }, { id: S.ids.maria, from, to });
    // what classic's applyPatternModal sends for those days: week[getDay()] when not off and the day is open
    const pat = JSON.parse(S.people.find((x) => x.id === S.ids.maria).patterns_json).patterns[0];
    const want = r.closed.filter(([d, closed]) => { const e = pat.week[new Date(d + "T12:00:00Z").getUTCDay()]; return !closed && e && !e.off && e.start; }).map(([d]) => { const e = pat.week[new Date(d + "T12:00:00Z").getUTCDay()]; return [d, e.start, e.end]; });
    const got = S.rows(from, to, S.ids.maria).map((x) => [x.shift_date, x.start_time, x.end_time]);
    t.ok(r.res.done && JSON.stringify(got) === JSON.stringify(want) && JSON.stringify(r.add) === JSON.stringify(want), "a classic-made pattern applies in the planner as classic's Apply would: " + JSON.stringify({ got, want, words: r.res.words }));

    // ---- classic opens every tab on the planner's rows, and its Save Rules keeps rota.*
    await c.goto(t.base + "?ui=classic#shifts"); await c.waitForSelector("#sh-tabbar");
    const tabs = [];
    for (const tab of ["calendar", "schedule", "staff", "leave", "integration", "settings"]) {
      await c.click('[data-tab="' + tab + '"]'); await c.waitForTimeout(250);
      tabs.push(tab + ":" + (await c.evaluate(() => (document.querySelector("#sh-content") || {}).textContent.length > 40)));
    }
    t.ok(tabs.every((x) => x.endsWith(":true")), "classic opens every tab: " + tabs.join(" "));
    await t.write(c, /^\/shifts\/settings$/, () => c.click("#ss-saverules"), "PUT");
    const set = JSON.parse(t.db.prepare("SELECT settings_json FROM shift_settings WHERE location_id = ?").get(S.loc).settings_json);
    t.ok(set.rota && set.rota.plans && set.rota.plans[String(S.ids.joe)] && set.rota.plans[String(S.ids.joe)].rid === "cl4ss", "classic Save Rules keeps rota.plans: " + JSON.stringify(set.rota));
  }
};
