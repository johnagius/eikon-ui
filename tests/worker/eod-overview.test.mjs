// End of day (Money, eod): GET /endofday/overview answers the screen in one read: every saved day of a month, and for
// the day being closed the last day saved before it and that day's paid outs. The emergency till is not part of the
// end of day (John, 2026-11-09): not read, not returned.
// Read only, this pharmacy only, date-bounded on each table's index; the old per-day routes answer as before.
import { test, eq, ok } from "./lib.mjs";

function counter(DB) {
  const c = { stmts: 0, rows: 0, sql: [] };
  const orig = DB.prepare.bind(DB);
  DB.prepare = function (sql) {
    const st = orig(sql), s = String(sql);
    if (/^\s*(CREATE|ALTER|PRAGMA|INSERT|UPDATE|DELETE)\b/i.test(s)) return st;
    c.stmts++; c.sql.push(s.replace(/\s+/g, " ").slice(0, 110));
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
const day = (d, staff, extra = {}) => ({ record: { date: d, eod_date: d, time_of_day: "PM", staff, staff_name: staff, float_amount: "150.00", x: [{ amount: "900.00", remark: "Main till" }], epos: [{ amount: "300.00", remark: "" }], cheques: [], paid_outs: [], cash: { n50: "9", coins_total: "12.40" }, deposit: { n50: 9 }, bag_number: "B-" + d.slice(8), notes: "", action: "SAVE", ...extra } });

test("eod overview: the month and the day being closed in one read", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch Pharmacy')").run();
  const other = await addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Paul Branch" });
  const put = (b, tk = token) => api("PUT", "/endofday/record", { token: tk, body: b });
  eq((await put(day("2026-09-29", "Karl", { action: "LOCK", locked_at: "x" }))).status, 200);
  eq((await put(day("2026-10-02", "Ġorġ Żammit"))).status, 200);
  eq((await put(day("2026-10-05", "Maria", { action: "LOCK", locked_at: "x" }))).status, 200);
  eq((await put(day("2026-11-01", "Maria"))).status, 200); // another month: not in October's list
  for (const [d, fee, m] of [["2026-10-06", 12.5, "cash"], ["2026-10-06", 30, "cheque"], ["2026-10-07", 9, "cash"]])
    eq((await api("POST", "/paid-out/entries", { token, body: { entry_date: d, entry_time: "10:00", payee_name: "Courier Ltd", fee, payment_method: m, reason: "Delivery" } })).status, 200);
  for (const [m, pr] of [["cash", 12.5], ["card", 8.9], ["cash", 3.1], ["card", 1.1]])
    eq((await api("POST", "/emergency-pos/sales", { token, body: { sale_date: "2026-10-06", items: [{ name: "Panadol", qty: 1, price: pr, vat_rate: 0 }], payment_method: m, amount_tendered: m === "cash" ? 20 : null } })).status, 200);
  const voidMe = await api("POST", "/emergency-pos/sales", { token, body: { sale_date: "2026-10-06", items: [{ name: "Panadol", qty: 1, price: 99, vat_rate: 0 }], payment_method: "cash", amount_tendered: 100 } });
  eq((await api("DELETE", "/emergency-pos/sales/" + voidMe.json.id, { token, body: { reason: "test" } })).status, 200);
  eq((await put(day("2026-10-03", "Paul"), other.token)).status, 200); // another pharmacy's day

  const n = counter(DB);
  const r = await api("GET", "/endofday/overview?month=2026-10&date=2026-10-06", { token });
  eq(r.status, 200, r.text);
  const j = r.json, sql0 = n.sql.slice(), rows0 = n.rows;
  eq(j.records.map((x) => x.date), ["2026-10-02", "2026-10-05"], "October's saved days at this pharmacy only");
  eq(j.records[0].staff_name, "Ġorġ Żammit"); eq(j.records[1].locked_at !== "", true); eq(j.records[0].location_name, "Demo Pharmacy");
  // the same record the per-day route gives
  const one = (await api("GET", "/endofday/record?date=2026-10-02", { token })).json.record;
  eq(j.records[0], one, "a record in the month is the same as GET /endofday/record gives");
  eq(j.before.date, "2026-10-05"); eq(!!j.before.locked_at, true);
  eq(j.paid_out.map((p) => [p.fee, p.payment_method]), [[12.5, "cash"], [30, "cheque"]], "that day's paid outs only");
  eq(j.emergency_till, undefined, "no emergency-till sales: not part of the end of day");
  ok(!sql0.some((q) => /pos_sales/.test(q)), "pos_sales is not read: " + JSON.stringify(sql0));
  const own = sql0.filter((q) => !/FROM (sessions|locations|orgs) |^SELECT s\.id AS session_id/.test(q));
  eq(j.hours, {}, "no opening hours saved: {}");
  ok(own.length <= 4, "four reads of its own: " + JSON.stringify(own));
  ok(rows0 <= 12, "only the rows the screen needs: " + rows0);

  // the last day before the 1st of a month is found in the month before
  const nov = (await api("GET", "/endofday/overview?month=2026-10&date=2026-10-01", { token })).json;
  eq(nov.before.date, "2026-09-29"); eq(nov.paid_out, []); eq(nov.emergency_till, undefined);
  // month alone: no day part
  const m = (await api("GET", "/endofday/overview?month=2026-11", { token })).json;
  eq(m.records.map((x) => x.date), ["2026-11-01"]); eq(m.before, undefined); eq(m.paid_out, undefined);
  // checks
  // saved opening hours come back as saved (the screen applies the Shifts rule to them)
  const hrs = { default: { open: "08:00", close: "19:30" }, openSaturday: true, openSunday: false, overrides: { "2026-10-12": { closed: true } } };
  DB.db.prepare("INSERT INTO shift_opening_hours (org_id, location_id, hours_json, updated_at) VALUES (1, 1, ?, datetime('now'))").run(JSON.stringify(hrs));
  eq((await api("GET", "/endofday/overview?month=2026-10&date=2026-10-06", { token })).json.hours, hrs, "the opening hours as saved");
  eq((await api("GET", "/endofday/overview?month=2026-13", { token })).status, 400);
  eq((await api("GET", "/endofday/overview?month=2026-10&date=6-10-2026", { token })).status, 400);
  eq((await api("GET", "/endofday/overview?month=2026-10")).status, 401);
  const u = await addUser({ email: "user@example.com", role: "user", name: "Till User" });
  eq((await api("GET", "/endofday/overview?month=2026-10", { token: u.token })).status, 403, "the same roles as the End of day record");
});

test("eod overview: each query uses its (org, location, date) index", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await api("GET", "/endofday/overview?month=2026-10&date=2026-10-06", { token }); // creates the tables
  const plan = (sql) => DB.db.prepare("EXPLAIN QUERY PLAN " + sql).all(1, 1, "2026-10-01", "2026-11-01").map((r) => r.detail).join(" | ");
  ok(/idx_end_of_day_org_loc_date|sqlite_autoindex_end_of_day/.test(plan("SELECT e.* FROM end_of_day e WHERE e.org_id = ? AND e.location_id = ? AND e.eod_date >= ? AND e.eod_date < ?")), "month range on the index");
  const p1 = (sql) => DB.db.prepare("EXPLAIN QUERY PLAN " + sql).all(1, 1, "2026-10-06").map((r) => r.detail).join(" | ");
  ok(/USING INDEX|USING COVERING INDEX/.test(p1("SELECT e.* FROM end_of_day e WHERE e.org_id = ? AND e.location_id = ? AND e.eod_date < ? ORDER BY e.eod_date DESC LIMIT 1")), "day before on the index");
  ok(/idx_paid_out_org_loc_date/.test(p1("SELECT id FROM paid_out_entries WHERE org_id = ? AND location_id = ? AND entry_date = ?")), "paid outs on their index");
});
