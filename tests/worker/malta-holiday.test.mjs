// Malta public holidays (Money, integrator): a closed public holiday is never a missed end of day. The worker's
// maltaHoliday (GET /money/today) and the screens' E.maltaHoliday (ui/core.js) are the same list: 14 days a year,
// Good Friday moving with Easter. The opening hours' override for the day still wins (a pharmacy on the roster opens).
import { test, eq, ok } from "./lib.mjs";
import { readFileSync } from "node:fs";

const src = (file, start) => { const s = readFileSync(new URL("../../" + file, import.meta.url), "utf8"), a = s.indexOf(start); let i = s.indexOf("{", a), d = 0;
  for (; i < s.length; i++) { if (s[i] === "{") d++; else if (s[i] === "}" && !--d) break; } return s.slice(a, i + 1); };
const worker = new Function(src("cloudflare-worker/code", "function maltaHoliday(") + "; function moneyBool(v) { return v === true || v === 1 || v === \"1\" || v === \"true\"; }\n" + src("cloudflare-worker/code", "function moneyHoursOn(") + "; return { maltaHoliday, moneyHoursOn };")();
const E = {}; new Function("E", src("ui/core.js", "E.maltaHoliday = function") + ";")(E);

test("malta holidays: Good Friday, the fixed days, the same in the worker and the screens", async () => {
  eq(worker.maltaHoliday("2026-04-03"), "Good Friday"); eq(worker.maltaHoliday("2027-03-26"), "Good Friday");
  eq(worker.maltaHoliday("2025-04-18"), "Good Friday"); eq(worker.maltaHoliday("2028-04-14"), "Good Friday");
  eq(worker.maltaHoliday("2026-04-05"), "", "Easter Sunday is not on the list");
  eq(worker.maltaHoliday("2026-12-13"), "Republic Day"); eq(worker.maltaHoliday("2026-11-09"), ""); eq(worker.maltaHoliday("nope"), "");
  for (let y = 2024; y <= 2040; y++) {
    let n = 0;
    for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) {
      const d = new Date(t).toISOString().slice(0, 10), w = worker.maltaHoliday(d);
      eq(E.maltaHoliday(d), w, "screen and worker agree on " + d);
      if (w) n++;
    }
    eq(n, 14, y + ": 14 public holidays");
  }
});

test("malta holidays: a holiday is a closed day unless the Shifts override opens it", async () => {
  eq(worker.moneyHoursOn({}, "2026-12-08").closed, true, "Immaculate Conception (a Tuesday): closed");
  eq(worker.moneyHoursOn({}, "2026-12-09").closed, false, "the next day: open");
  eq(worker.moneyHoursOn({ weekly: { 2: { closed: false } } }, "2026-12-08").closed, true, "weekly hours do not open a holiday");
  eq(worker.moneyHoursOn({ overrides: { "2026-12-08": { closed: false, close: "13:00" } } }, "2026-12-08"), { closed: false, close: "13:00" }, "an override for the day wins");
});

test("money today: the day after a public holiday does not ask for the holiday's end of day", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const plus = (n) => { const [y, m, d] = today.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  await api("GET", "/money/today", { token });
  // every day open (Sundays too); the last open day is yesterday unless yesterday is a holiday
  DB.db.prepare("INSERT INTO shift_opening_hours (org_id, location_id, hours_json) VALUES (1, 1, ?)").run(JSON.stringify({ openSaturday: true, openSunday: true }));
  const e = (await api("GET", "/money/today", { token })).json.end_of_day;
  let want = null; for (let i = 1; i <= 7; i++) if (!worker.maltaHoliday(plus(-i))) { want = plus(-i); break; }
  eq(e.last_open_day, want, "the last open day skips public holidays");
  ok(!e.earlier.some((x) => x.state === "missing" && worker.maltaHoliday(x.date)), "no holiday is a missing day: " + JSON.stringify(e.earlier));
  eq(e.open_today, !worker.maltaHoliday(today));
});
