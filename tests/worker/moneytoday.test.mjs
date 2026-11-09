// Today's money (money-hub): GET /money/today answers, in one bounded read, what is left to close today and what the
// till and the credit notes hold; nothing is added to /today (re-read every minute). Read only, this pharmacy only,
// each part only for the roles that can read the screen behind it.
import { test, eq, ok } from "./lib.mjs";

const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plus = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dow = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();

function counter(DB) {
  const c = { stmts: 0, rows: 0, sql: [] };
  const orig = DB.prepare.bind(DB);
  DB.prepare = function (sql) {
    const st = orig(sql), s = String(sql);
    if (/^\s*(CREATE|ALTER|PRAGMA|INSERT|UPDATE|DELETE)\b/i.test(s)) return st;
    c.stmts++; c.sql.push(s.replace(/\s+/g, " ").slice(0, 90));
    const wrap = (o) => {
      const all = o.all && o.all.bind(o), first = o.first && o.first.bind(o), bind = o.bind && o.bind.bind(o);
      if (all) o.all = async (...a) => { const r = await all(...a); c.rows += (r.results || []).length; return r; };
      if (first) o.first = async (...a) => { const r = await first(...a); if (r) c.rows++; return r; };
      if (bind) o.bind = (...a) => wrap(bind(...a));
      return o;
    };
    return wrap(st);
  };
  return c;
}

function eodRow(db, loc, day, { locked = false, x = "0", cash = {} } = {}) {
  db.prepare(`INSERT INTO end_of_day (org_id, location_id, eod_date, time_of_day, staff_name, float_amount, x_json, epos_json, cheques_json, paid_outs_json, cash_json, saved_at, locked_at)
    VALUES (1, ?, ?, 'PM', 'Maria Borg', 100, ?, '[{"amount":"200","remark":""}]', '[]', '[{"amount":"12.50","remark":"courier"}]', ?, datetime('now'), ?)`)
    .run(loc, day, JSON.stringify([{ amount: x, remark: "" }]), JSON.stringify(cash), locked ? "2026-11-01 20:00:00" : null);
}

test("money today: one read says what is left to close and what the till and credit notes hold", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const today = maltaToday();
  const first = await api("GET", "/money/today", { token }); // makes the tables, nothing in them yet
  eq(first.status, 200, first.text);
  const j0 = first.json;
  eq(j0.ok, true); eq(j0.date, today);
  eq(j0.end_of_day.today, null);
  eq(j0.paid_out.total, 0); eq(j0.emergency.count, 0); eq(j0.credit_notes.open, 0); eq(j0.credit_notes.held, 0);
  // no opening hours saved: the Shifts screen's defaults (Sunday closed), so the last open day is never a Sunday
  ok(j0.end_of_day.last_open_day && dow(j0.end_of_day.last_open_day) !== 0, "last open day: " + j0.end_of_day.last_open_day);
  ok(j0.end_of_day.earlier.some((e) => e.state === "missing" && e.date === j0.end_of_day.last_open_day), "the last open day has no end of day: " + JSON.stringify(j0.end_of_day.earlier));

  const db = DB.db;
  // today started (not locked) with X €1,234.56 and the till counted; an earlier day started and never locked; the last open day locked
  eodRow(db, 1, today, { x: "1234.56", cash: { n500: "2", n50: "1", coins_total: "8.25" } });
  eodRow(db, 1, plus(today, -9), { x: "50" });
  eodRow(db, 1, j0.end_of_day.last_open_day, { locked: true, x: "900" });
  eodRow(db, 1, plus(today, -20), { x: "70" }); // older than two weeks: not looked at
  db.prepare("INSERT INTO paid_out_entries (org_id, location_id, entry_date, entry_time, payee_name, fee, payment_method) VALUES (1, 1, ?, '10:00', 'DHL', 12.5, 'cash'), (1, 1, ?, '11:00', 'Ċensu', 7.25, 'cash'), (1, 1, ?, '11:00', 'Yesterday', 99, 'cash')").run(today, today, plus(today, -1));
  db.prepare("INSERT INTO pos_sales (org_id, location_id, sale_date, receipt_no, items_json, subtotal, vat_total, total, payment_method, voided, created_by) VALUES (1, 1, ?, 'E1', '[]', 10, 0, 10, 'cash', 0, 1), (1, 1, ?, 'E2', '[]', 5.5, 0, 5.5, 'card', 0, 1), (1, 1, ?, 'E3', '[]', 40, 0, 40, 'cash', 1, 1)").run(today, today, today);
  const cn = async (b) => (await api("POST", "/creditnotes/entries", { token, body: Object.assign({ issue_date: plus(today, -30), client_name: "Ġorġ", client_surname: "Borg", telephone: "79000000" }, b) })).json.id;
  const a = await cn({ amount: 25.5, no_expiry: 1 });
  eq((await api("POST", `/creditnotes/entries/${a}/purchases`, { token, body: { amount: 5 } })).status, 200);
  await cn({ amount: 10, expiry_date: plus(today, 10) });       // expires soon
  await cn({ amount: 4, expiry_date: plus(today, 40) });        // later
  await cn({ amount: 99, expiry_date: plus(today, -1) });       // expired: not held any more
  const used = await cn({ amount: 8, no_expiry: 1 });           // used up
  eq((await api("POST", `/creditnotes/entries/${used}/purchases`, { token, body: { amount: 8 } })).status, 200);

  const n = counter(DB);
  const r = await api("GET", "/money/today", { token });
  eq(r.status, 200, r.text);
  const own = n.sql.filter((q) => !/FROM (sessions|locations|orgs) |^SELECT s\.id AS session_id/.test(q));
  ok(own.length <= 5, "at most 5 reads of its own: " + own.length + " " + JSON.stringify(own));
  ok(n.rows <= 30, "a handful of rows returned: " + n.rows);
  const j = r.json, e = j.end_of_day;
  eq(e.today.locked, false); eq(e.today.staff, "Maria Borg"); eq(e.today.takings, 1234.56);
  // the End of day screen's sums: expected 1234.56 − 200 − 12.50 = 1022.06; cash 1058.25 − 100 float = 958.25; under 63.81
  eq(e.today.over_under, -63.81); eq(e.today.counted, true);
  ok(e.earlier.some((x) => x.date === plus(today, -9) && x.state === "unlocked"), "day 9 started, not locked: " + JSON.stringify(e.earlier));
  ok(!e.earlier.some((x) => x.date === e.last_open_day), "the last open day is locked: " + JSON.stringify(e.earlier));
  ok(!e.earlier.some((x) => x.date === plus(today, -20)), "nothing older than two weeks");
  ok(typeof e.open_today === "boolean" && /^\d\d:\d\d$/.test(e.closes_at), "today's hours: " + JSON.stringify(e));
  eq(j.paid_out.total, 19.75); eq(j.paid_out.count, 2);
  eq(j.emergency.total, 15.5); eq(j.emergency.count, 2, "a voided sale is not counted");
  const c = j.credit_notes;
  eq(c.open, 3); eq(c.held, 34.5); eq(c.soon, 1); eq(c.soon_total, 10); eq(c.soon_first, plus(today, 10)); eq(c.soon_days, 30);
  ok(!JSON.stringify(c).includes("Borg"), "no customer names, only totals");

  // opening hours: closed on the day before today, so the last open day is the one before it
  db.prepare("INSERT INTO shift_opening_hours (org_id, location_id, hours_json) VALUES (1, 1, ?)").run(JSON.stringify({ default: { open: "08:00", close: "20:00", closed: false }, openSaturday: true, openSunday: true, overrides: { [plus(today, -1)]: { closed: true } } }));
  const h = (await api("GET", "/money/today", { token })).json.end_of_day;
  // (public holidays are closed days too: tests/worker/malta-holiday.test.mjs; skipped here so the test holds any day of the year)
  const hol = (d) => { const [y, mo, dd] = d.split("-").map(Number), md = d.slice(5); if (["01-01", "02-10", "03-19", "03-31", "05-01", "06-07", "06-29", "08-15", "09-08", "09-21", "12-08", "12-13", "12-25"].includes(md)) return true;
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, e = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30, l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - e - (c % 4)) % 7, m = Math.floor((a + 11 * e + 22 * l) / 451);
    return new Date(Date.UTC(y, Math.floor((e + l - 7 * m + 114) / 31) - 1, ((e + l - 7 * m + 114) % 31) + 1 - 2)).toISOString().slice(0, 10) === d; };
  let lod = plus(today, -2); while (hol(lod)) lod = plus(lod, -1);
  eq(h.last_open_day, lod); eq(h.closes_at, "20:00"); eq(h.open_today, !hol(today));

  // /today is not touched
  const t = (await api("GET", "/today", { token })).json;
  eq(t.money, undefined, "/today carries no money block");
  ok(t.takings && t.counts, "the rest of /today unchanged");
});

test("money today: another pharmacy sees only its own; each part only for the roles that read its screen", async (app) => {
  const { api, bootstrap, DB } = app;
  const A = await bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  const B = await app.addUser({ orgId: 1, locationId: 2, email: "b@example.com", name: "B Admin" });
  const S = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  const U = await app.addUser({ orgId: 1, locationId: 1, email: "user@example.com", name: "User", role: "user" });
  const today = maltaToday();
  await api("GET", "/money/today", { token: A.token });
  eodRow(DB.db, 1, today, { x: "300" });
  DB.db.prepare("INSERT INTO paid_out_entries (org_id, location_id, entry_date, entry_time, payee_name, fee, payment_method) VALUES (1, 1, ?, '10:00', 'DHL', 12.5, 'cash')").run(today);
  const b = (await api("GET", "/money/today", { token: B.token })).json;
  eq(b.end_of_day.today, null, "B does not see A's day"); eq(b.paid_out.total, 0);
  const s = await api("GET", "/money/today", { token: S.token });
  eq(s.status, 200, s.text); eq(s.json.end_of_day.today.takings, 300, "staff read the day, as on End of day"); ok(s.json.credit_notes, "staff read credit notes");
  const u = await api("GET", "/money/today", { token: U.token });
  if (u.status === 200) {
    eq(u.json.end_of_day, null, "a user role cannot read end of day (as /eod)"); eq(u.json.credit_notes, null, "nor credit notes (as /creditnotes)");
    eq(u.json.paid_out.total, 12.5, "paid out, as /paid-out");
  } else eq(u.status, 403, u.text);
  eq((await api("GET", "/money/today", {})).status, 401);
});
