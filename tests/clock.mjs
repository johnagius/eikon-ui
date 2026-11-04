// One clock and one calendar for every test suite, so the suites pass at any hour.
// A pharmacy's day is Malta's day (Europe/Malta: UTC+1 in winter, UTC+2 in summer): the worker's /today and the
// header use it, and so does a browser in Malta. Between 22:00/23:00 and 24:00 UTC Malta is already on the next day,
// so a test that dates things in UTC (toISOString().slice(0, 10)) or in the machine's zone breaks for an hour or two.
//
//   EIKON_FAKE_NOW=2026-11-03T23:30:00Z   run as if it were that moment (the clock keeps running from there): the
//                                         test process and the worker it loads (Date patched) and every page.
//   EIKON_BROWSER_TZ=UTC                  the pages' time zone (default Europe/Malta, like the pharmacies' devices).
export const MALTA = "Europe/Malta";
export const BROWSER_TZ = process.env.EIKON_BROWSER_TZ || MALTA;
const RealDate = Date;
const fake = process.env.EIKON_FAKE_NOW ? RealDate.parse(process.env.EIKON_FAKE_NOW) : NaN;
export const CLOCK_OFFSET = Number.isFinite(fake) ? fake - RealDate.now() : 0;

// Shift this process's clock (Date and Date.now; SQLite's datetime('now') keeps the real time, which only the
// rows' created_at/updated_at use). Call before the worker is loaded or the app is made.
export function installNodeClock() {
  if (!CLOCK_OFFSET || globalThis.Date.__eikonFake) return;
  const off = CLOCK_OFFSET;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); }
    static now() { return RealDate.now() + off; }
  }
  FakeDate.__eikonFake = true;
  globalThis.Date = FakeDate;
}

// Page init script (pass CLOCK_OFFSET): the same shift inside the page.
export function browserClock(off) {
  if (!off || (window.Date && window.Date.__eikonFake)) return;
  const R = window.Date;
  function D(...a) { if (!new.target) return new D().toString(); return a.length ? new R(...a) : new R(R.now() + off); }
  D.prototype = R.prototype; D.now = () => R.now() + off; D.parse = R.parse; D.UTC = R.UTC; D.__eikonFake = true;
  window.Date = D;
}

// Context options every page should have: Malta's zone (or EIKON_BROWSER_TZ).
export const contextTz = () => ({ timezoneId: BROWSER_TZ });
// Apply the zone and the clock to a new context.
export async function prepareContext(ctx) { if (CLOCK_OFFSET) await ctx.addInitScript(browserClock, CLOCK_OFFSET); return ctx; }

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: MALTA, year: "numeric", month: "2-digit", day: "2-digit" });
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: MALTA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// Malta's calendar day `n` days from today (or from `at`), as YYYY-MM-DD: the day the worker's /today calls today.
export function maltaYmd(n = 0, at) {
  const t = at === undefined ? Date.now() : (at instanceof RealDate ? at.getTime() : Number(at));
  const [y, m, d] = fmt.format(new RealDate(t)).split("-").map(Number);
  return new RealDate(RealDate.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const maltaHm = (at) => hmFmt.format(new RealDate(at === undefined ? Date.now() : at));
// Whole days from YYYY-MM-DD a to b (calendar arithmetic, no zone).
export const ymdDiff = (a, b) => Math.round((RealDate.parse(b + "T12:00:00Z") - RealDate.parse(a + "T12:00:00Z")) / 864e5);
export const ymdAdd = (s, n) => new RealDate(RealDate.parse(s + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
