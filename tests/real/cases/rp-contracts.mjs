// Roster planner (RP round) Phase 0: the shared seed works and every contract the four builders share is present with
// its agreed shape (E.rotaPlan, E.rotaCheck, E.rotaMeta, E.rotaHoursPut, E.rotaSet, E.rotaMe/E.rotaMeSet, E.rotaPrint,
// E.rotaCal). Stays green after the builders replace the stubs (it checks shapes, not stub behaviour).
import { rpSeed } from "./_rpseed.mjs";

export default {
  title: "Roster planner contracts and the busy-pharmacy seed",
  async run(t) {
    const S = await rpSeed(t, { tag: "contracts", weeks: 30 });
    t.ok(S.people.length === 8 && Object.values(S.ids).every(Boolean), "seed: 8 people in their own pharmacy");
    t.ok(S.rows(S.mon, S.d(6)).length === 23, "seed: a busy first week (23 shifts): " + S.rows(S.mon, S.d(6)).length);
    const p = await S.page();
    await t.open(p, "2", "shfreg", "shfreg");
    const r = await p.evaluate(async ({ mon, to, ids }) => {
      const E = window.EIKON, f = (x) => typeof x === "function";
      const staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff;
      const shifts = (await E.apiFetch("/shifts/assignments-range?from=" + mon + "&to=" + to, { method: "GET" })).shifts;
      const rules = await E.rotaRules(true);
      const chk = E.rotaCheck({ from: mon, to }, { staff, shifts, leaves: [], hours: rules.hours, settings: rules.settings, avail: {} });
      const P = E.rotaPlan, parsed = P.parse(staff.find((s) => s.id === ids.maria).patterns_json), ex = P.expand({ person: { id: ids.maria }, from: mon, to });
      const pv = P.preview([], ex, "keep"), meta = await E.rotaMeta.get(true);
      return {
        fns: [P.parse, P.toPatternsJson, P.expand, P.preview, P.apply, P.undo, P.recent, P.repeat, P.paste, P.setHours, P.clear, P.gaps, P.lastWeek, P.toOps, P.rotationFromWeekdays, P.rotationFromRows,
          P.ui.editor, P.ui.applyDialog, P.ui.recent, E.rotaCheck, E.rotaMeta.get, E.rotaMeta.merge, E.rotaHoursPut, E.rotaMe, E.rotaMeSet, E.rotaPrint, E.rotaCal.ui.panel, E.rotaCal.feedUrl,
          E.rotaSet.ui.availability, E.rotaSet.ui.leave, E.rotaSet.ui.details, E.rotaSet.ui.hours, E.rotaSet.ui.rules, E.rotaSet.balance].map(f),
        kinds: ["pattern", "weekdays", "days", "repeat", "lastWeek", "gaps"].filter((k) => f(P[k])), fillMenu: typeof P.ui.fillMenu, parsed: { usual: parsed.usual, plain: parsed.plain.length, rot: Array.isArray(parsed.rotations) },
        ex: ["add", "keep", "remove", "skip"].every((k) => Array.isArray(ex[k])), pv: !!(pv.counts && pv.words && Array.isArray(pv.days)),
        cover: chk.filter((c) => c.kind === "cover").map((c) => c.date + " " + c.words), shape: chk.every((c) => c.kind && c.level && c.date && c.words && c.fix),
        me: (E.rotaMe(staff) || {}).id, meta: !!(meta && typeof meta === "object")
      };
    }, { mon: S.mon, to: S.d(6), ids: S.ids });
    t.ok(r.fns.every(Boolean), "every contract function exists: " + JSON.stringify(r.fns.map((x, i) => x ? "" : i).filter(String)));
    t.ok(r.kinds.length === 6 && r.fillMenu === "undefined", "the engine has every fill of the brief (pattern, weekdays, days, copy/repeat, last week, gaps/role) and no second Fill… chooser: " + r.kinds.join());
    t.ok(r.parsed.usual === "p" + S.people.find((x) => x.id === S.ids.maria).patterns_json.match(/"provisionalId":"p([^"]+)"/)[1] && r.parsed.plain === 1 && r.parsed.rot, "rotaPlan.parse reads a classic pattern as the usual one: " + JSON.stringify(r.parsed));
    t.ok(r.ex && r.pv, "expand / preview shapes");
    t.ok(r.cover.length === 1 && r.cover[0].startsWith(S.d(1) + " No pharmacist") && /14:00–19:30/.test(r.cover[0]) && r.shape, "rotaCheck: the seeded Tuesday gap, in E.teamCover's words: " + JSON.stringify(r.cover));
    t.ok(r.me === S.ids.maria, "rotaMe: 'marija  cassar' signed in = Marija Cassar on the rota");
    t.ok(r.meta, "rotaMeta.get");
  }
};
