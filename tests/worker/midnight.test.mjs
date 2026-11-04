// The pharmacy's day is Malta's (UTC+1 in winter, UTC+2 in summer). Between 23:00 and 24:00 UTC in winter (22:00-24:00
// in summer) Malta is already on the next day: what the worker dates by itself (no date in the body) must use Malta's
// day then, and must store exactly what it stored before at any other hour.
import { test, eq, ok } from "./lib.mjs";

const RealDate = Date;
// Run fn with the worker's clock (Date, and SQLite's 'now' through the d1 shim) at `iso`, signed in at that moment
// (a session made at the real time would have expired, or not yet begun, at another date): fn(token).
let creds = null;
async function at(iso, fn) {
  const off = RealDate.parse(iso) - RealDate.now(), prev = globalThis.Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
  FakeDate.__eikonFake = true;
  globalThis.Date = FakeDate;
  try {
    let token = null;
    if (creds) { const l = await creds.api("POST", "/auth/login", { body: { email: creds.email, password: creds.password } }); token = l.json && l.json.token; ok(token, "login at " + iso + ": " + l.text); }
    return await fn(token);
  } finally { globalThis.Date = prev; }
}
const utcDay = (iso) => iso.slice(0, 10);
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta" }), OFF = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", timeZoneName: "longOffset" });
const maltaDay = (iso) => DAY.format(new RealDate(iso));
// Moments: in the window (winter, summer) and in the day, where the stored date must equal the old UTC date.
const WINDOW = ["2026-11-03T23:30:00Z", "2026-07-15T22:30:00Z", "2026-07-15T23:59:00Z", "2026-12-31T23:10:00Z"];
const DAYTIME = ["2026-11-03T12:00:00Z", "2026-11-03T22:59:00Z", "2026-11-04T00:30:00Z", "2026-07-15T08:00:00Z", "2026-07-15T21:59:00Z"];

async function returnFromNearExpiry(api, token, bulk) {
  const ne = await api("POST", "/near-expiry/entries", { token, body: { product_name: "Ħ-syrup " + Math.random(), expiry_date: "2027-01-31", location: "Shelf 3", notes: "" } });
  eq(ne.status, 200, ne.text);
  const id = ne.json.entry && ne.json.entry.id;
  ok(id, "near expiry id: " + ne.text);
  const r = bulk
    ? await api("POST", "/near-expiry/entries/create-returns-bulk", { token, body: { near_expiry_ids: [id], supplier: "PharmaCo", quantity: "2" } })
    : await api("POST", "/near-expiry/entries/create-return", { token, body: { near_expiry_id: id, supplier: "PharmaCo", quantity: "2" } });
  eq(r.status, 200, r.text);
  return id;
}

test("midnight: a return made from Near expiry is dated Malta's day in the window, and exactly as before in the day", async ({ api, bootstrap, DB }) => {
  const b = await bootstrap(); creds = { api, email: b.email, password: b.password };
  for (const bulk of [false, true]) {
    for (const iso of WINDOW.concat(DAYTIME)) {
      const neId = await at(iso, (token) => returnFromNearExpiry(api, token, bulk));
      const row = DB.one("SELECT entry_date FROM returns_entries WHERE near_expiry_id = ?", neId);
      eq(row && row.entry_date, maltaDay(iso), (bulk ? "bulk " : "") + "return made at " + iso);
      if (DAYTIME.includes(iso)) eq(row.entry_date, utcDay(iso), "daytime: the same date the worker stored before (" + iso + ")");
      else ok(row.entry_date !== utcDay(iso), "the window is where the old UTC date was a day behind (" + iso + ")");
    }
  }
});

test("midnight: an Emergency POS sale with no sale_date, and the list with no date, use Malta's day", async ({ api, bootstrap, DB }) => {
  const b = await bootstrap(); creds = { api, email: b.email, password: b.password };
  for (const iso of WINDOW.concat(DAYTIME)) {
    await at(iso, async (token) => {
      const s = await api("POST", "/emergency-pos/sales", { token, body: { items: [{ name: "Panadol", qty: 1, price: 3.5, vat_rate: 0 }], payment_method: "card", receipt_no: "R-" + iso } });
      eq(s.status, 200, s.text);
      const row = DB.one("SELECT sale_date FROM pos_sales WHERE id = ?", s.json.id);
      eq(row.sale_date, maltaDay(iso), "sale at " + iso);
      const l = await api("GET", "/emergency-pos/sales", { token });
      ok((l.json.sales || []).some((x) => x.id === s.json.id), "the list with no date shows the sale made now (" + iso + ")");
    });
  }
  // a sale_date sent by the screen is kept as sent, at any hour
  const s2 = await at(WINDOW[0], (token) => api("POST", "/emergency-pos/sales", { token, body: { sale_date: "2026-11-03", items: [{ name: "x", qty: 1, price: 1, vat_rate: 0 }], payment_method: "card", receipt_no: "R-kept" } }));
  eq(DB.one("SELECT sale_date FROM pos_sales WHERE id = ?", s2.json.id).sale_date, "2026-11-03");
});

test("midnight: scarce stock refuses an item from Near expiry that expires today (Malta) in the window too", async ({ api, bootstrap }) => {
  const b = await bootstrap(); creds = { api, email: b.email, password: b.password };
  await at(WINDOW[0], async (token) => {
    const today = maltaDay(WINDOW[0]); // 2026-11-04, while UTC is still on the 3rd
    const ne = await api("POST", "/near-expiry/entries", { token, body: { product_name: "Insulin pen", expiry_date: today, location: "Fridge", notes: "" } });
    const id = ne.json.entry && ne.json.entry.id; ok(id, ne.text);
    const r = await api("POST", "/scarce-stock/offers", { token, body: { entry_date: today, item_name: "Insulin pen", expiry_date: today, quantity_available: 1, near_expiry_id: id } });
    eq(r.status, 400, "expires today in Malta: " + r.text);
  });
});

test("midnight: a waitlist line with no date is added on Malta's day", async ({ api, bootstrap, DB }) => {
  const b = await bootstrap(); creds = { api, email: b.email, password: b.password };
  for (const iso of [WINDOW[0], DAYTIME[0]]) {
    const r = await at(iso, (token) => api("POST", "/appointments/waitlist", { token, body: { patientName: "Borg Ċensa " + iso, patientPhone: "79000000" } }));
    ok(r.status === 200 || r.status === 201, r.text);
    const row = DB.one("SELECT added_date FROM appt_waitlist WHERE patient_name = ?", "Borg Ċensa " + iso);
    eq(row && row.added_date, maltaDay(iso), "added at " + iso);
  }
});

test("midnight: shifts with no year/month answer Malta's month (1 December 00:30 Malta is December)", async ({ api, bootstrap }) => {
  const b = await bootstrap(); creds = { api, email: b.email, password: b.password };
  const st = await api("POST", "/shifts/staff", { token: b.token, body: { full_name: "Karl Vella", role: "pharmacist" } });
  const staffId = st.json && st.json.staff_id;
  ok(staffId, "staff: " + st.text);
  const sh = await api("POST", "/shifts/assignments", { token: b.token, body: { staff_id: staffId, shift_date: "2026-12-01", start_time: "08:00", end_time: "14:00" } });
  ok(sh.status === 200 || sh.status === 201, sh.text);
  const r = await at("2026-11-30T23:30:00Z", (token) => api("GET", "/shifts/assignments", { token }));
  eq(r.status, 200, r.text);
  eq((r.json.shifts || []).map((x) => x.shift_date), ["2026-12-01"], "no params at 00:30 on 1 December (Malta) = December");
  const r2 = await at("2026-11-30T12:00:00Z", (token) => api("GET", "/shifts/assignments", { token }));
  eq((r2.json.shifts || []).length, 0, "at noon on 30 November it is still November, as before");
});

test("midnight: every 15 minutes of 2026 and 2027, Malta's day differs from UTC's only from 23:00 UTC (winter) or 22:00 UTC (summer) to midnight", async () => {
  // The changed lines replace "UTC's day now" by "Malta's day now", so outside these hours they store exactly what they stored before.
  let differ = 0;
  for (let t = RealDate.UTC(2026, 0, 1); t < RealDate.UTC(2028, 0, 1); t += 15 * 60000) {
    const iso = new RealDate(t).toISOString(), h = new RealDate(t).getUTCHours();
    const summer = OFF.format(new RealDate(t)).includes("+02:00");
    const inWindow = h >= (summer ? 22 : 23);
    eq(maltaDay(iso) !== utcDay(iso), inWindow, iso);
    if (inWindow) differ++;
  }
  ok(differ > 0);
});
