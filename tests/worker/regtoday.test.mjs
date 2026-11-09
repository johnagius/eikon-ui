// Today's registers (regs-hub): GET /registers/today answers, in one bounded read, what each register needs today;
// nothing is added to /today (re-read every minute). Read only, this pharmacy only.
import { test, eq, ok } from "./lib.mjs";

const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plus = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const shiftYm = (ym, n) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

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

test("registers today: one read says what each register needs today", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const today = maltaToday(), lastYm = shiftYm(today.slice(0, 7), -1);
  const devs = (await api("GET", "/temperature/devices", { token })).json.devices;
  ok(devs.length >= 2, "default fridge and room");
  const fridge = devs.find((d) => d.device_type === "fridge") || devs[0];
  eq((await api("POST", "/temperature/entries", { token, body: { device_id: fridge.id, entry_date: today, min_temp: 3, max_temp: 9.5, notes: "" } })).status, 200);
  eq((await api("POST", "/cleaning/entries", { token, body: { entry_date: plus(today, -9), time_in: "08:00", time_out: "08:30", cleaner_name: "Karl Ċassar", staff_name: "Maria", notes: "" } })).status, 200);
  eq((await api("POST", "/locumregister/entries", { token, body: { entry_date: today, time_in: "08:00", time_out: "19:00", locum_full_name: "Pharm. Daniela Spiteri", registration_number: "PH 1234" } })).status, 200);
  eq((await api("POST", "/dda-sales/entries", { token, body: { entry_date: lastYm + "-10", client_name: "Zammit Carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg/ml", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1201", prescription_serial_no: "S5001" } })).status, 200);
  const certs = (await api("GET", "/certificates/items", { token })).json.items;
  const c0 = certs.find((c) => c.item_key === "thermometer_calibration") || certs[0];
  eq((await api("PUT", "/certificates/items/" + c0.id, { token, body: { last_date: plus(today, -400), interval_months: 12, certified_person: c0.requires_person ? "Rita" : undefined } })).status, 200);

  const n = counter(DB);
  const r = await api("GET", "/registers/today", { token });
  eq(r.status, 200, r.text);
  const j = r.json;
  eq(j.ok, true); eq(j.date, today);
  // the sign-in check (session, pharmacy, group) and the default-devices/certificates checks are paid by every screen, /today too
  const own = n.sql.filter((q) => !/FROM (sessions|locations|orgs) |^SELECT s\.id AS session_id|^SELECT id FROM temperature_devices|^SELECT COUNT\(\*\) AS c FROM certificates_items/.test(q));
  ok(own.length <= 10, "at most 10 reads of its own: " + own.length + " " + JSON.stringify(own));
  ok(n.rows <= 40, "a handful of rows returned: " + n.rows);

  const tf = j.temperature.find((d) => d.device_id === fridge.id);
  eq(tf.today.max, 9.5); eq(tf.out_of_range, true); eq(tf.note, false);
  ok(j.temperature.some((d) => d.device_id !== fridge.id && d.today === null), "the room is not logged yet");
  eq(j.daily_register.count_today, 0);
  eq(j.cleaning.days_since, 9); eq(j.cleaning.by, "Karl Ċassar");
  eq(j.locum.signed, true); eq(j.locum.entries[0].name, "Pharm. Daniela Spiteri");
  eq(j.stocktake.last_month, lastYm); eq(j.stocktake.last_month_counted, null); eq(j.stocktake.last_month_lines, true); eq(j.stocktake.open, null);
  ok(j.certificates.some((c) => c.status === "expired" && c.title === c0.title), "expired certificate: " + JSON.stringify(j.certificates));
  eq(j.end_of_day.saved, false);
  ok(Array.isArray(j.signoffs) && j.signoffs.length === 0, "V2: sign-offs are read on the hub's first open, before any daily register was opened: " + JSON.stringify(j.signoffs));

  // a stock-take, still open: it counts for its month and is reported as open
  eq((await api("POST", "/dda-stocktakes/stocktakes", { token, body: {} })).status, 200);
  const r2 = (await api("GET", "/registers/today", { token })).json;
  ok(r2.stocktake.open && r2.stocktake.open.day === today, "open stock-take today: " + JSON.stringify(r2.stocktake));
  const day = Number(today.slice(8));
  if (day <= 7) eq(r2.stocktake.last_month_counted, today, "a take in the first week counts for last month");
  else eq(r2.stocktake.this_month_counted, today);

  // /today is not touched: it is re-read every minute, so nothing of this is added to it
  const t = (await api("GET", "/today", { token })).json;
  eq(t.registers, undefined, "/today carries no registers block");
  ok(Array.isArray(t.before_opening) && t.counts, "the rest of /today unchanged");
});

test("registers today: another pharmacy sees only its own; staff may read; sign-offs read when the table exists", async (app) => {
  const { api, bootstrap, DB } = app;
  const A = await bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  const B = await app.addUser({ orgId: 1, locationId: 2, email: "b@example.com", name: "B Admin" });
  const S = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  const today = maltaToday();
  eq((await api("POST", "/locumregister/entries", { token: A.token, body: { entry_date: today, time_in: "08:00", time_out: "19:00", locum_full_name: "Pharm. A", registration_number: "PH 1" } })).status, 200);
  const b = (await api("GET", "/registers/today", { token: B.token })).json;
  eq(b.locum.signed, false, "B does not see A's pharmacist");
  const s = await api("GET", "/registers/today", { token: S.token });
  eq(s.status, 200, s.text);
  DB.db.prepare("CREATE TABLE IF NOT EXISTS register_signoffs (id INTEGER PRIMARY KEY, org_id INTEGER, location_id INTEGER, register TEXT, month TEXT, signed_by INTEGER, signed_name TEXT, note TEXT, signed_at TEXT)").run();
  DB.db.prepare("INSERT INTO register_signoffs (org_id, location_id, register, month, signed_by, signed_name, signed_at) VALUES (1, 1, 'temperature', ?, 1, 'Maria Borg', '2026-11-01 09:00:00'), (1, 2, 'temperature', ?, 2, 'B', '2026-11-01 09:00:00')").run(shiftYm(today.slice(0, 7), -1), shiftYm(today.slice(0, 7), -1));
  const a = (await api("GET", "/registers/today", { token: A.token })).json;
  eq(a.signoffs.length, 1); eq(a.signoffs[0].signed_by, "Maria Borg");
  const unauth = await api("GET", "/registers/today", {});
  eq(unauth.status, 401);
});
