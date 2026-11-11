// Today's services (svc-hub): GET /services/today answers, in one bounded read, what is waiting across the clinical
// services: reaction reports not sent, screening follow-ups due and campaigns running, tests done today, vaccine batches
// expiring and today's bookings. Nothing is added to /today. Read only, this pharmacy only, admin and staff.
import { test, eq, ok } from "./lib.mjs";

const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plus = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

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

const pv = (id, status, date, extra) => Object.assign({ id, status, report_type: "Initial", report_date: date, created_at: date + "T09:00:00.000Z", pt_initials: "Ġ.B.",
  reaction_meddra: "Rash", reaction_description: "Itchy rash on arms", reaction_seriousness: "Non-serious", drugs: [{ name: "Amoxicillin 500mg" }] }, extra || {});

async function seed(api, token, db, loc, today) {
  eq((await api("PUT", "/pharmacovigilance/state", { token, body: { state: { reports: [
    pv("pv_1", "Draft", plus(today, -6)),
    pv("pv_2", "", plus(today, -2), { reaction_seriousness: "Serious – Hospitalisation", reaction_meddra: "Angioedema", drugs: [{ name: "Ramipril 5mg" }] }),
    pv("pv_3", "Submitted to MPA", plus(today, -20)),
    pv("pv_4", "Closed", plus(today, -40))
  ], deleted_ids: [] } } })).status, 200);
  const person = (id, name, date, fus) => ({ id, idCard: "", name, phone: "", email: "", dob: "", type: "Walk-in", date, resultNotes: "", resultCategory: "Normal", referral: "No referral needed", referralNotes: "", poctResults: {}, followUps: fus || [] });
  eq((await api("PUT", "/screening/state", { token, body: { state: { campaigns: [
    { id: "c_on", name: "Blood pressure week", type: "Blood Pressure Check", startDate: plus(today, -3), endDate: plus(today, 4), status: "Active", location: "Pharmacy Floor", targetScreenings: "50",
      participants: [person("p1", "Ċensu Borg", today, [{ id: "f1", scheduledDate: plus(today, -1), reason: "Recheck BP", status: "Pending", notes: "" }]), person("p2", "Marija Zammit", plus(today, -2)), person("p3", "Helena Vella", today)] },
    { id: "c_old", name: "Diabetes day", type: "Diabetes Screening", startDate: plus(today, -60), endDate: plus(today, -59), status: "Active",
      participants: [person("p4", "Ġorġ Abela", plus(today, -60), [
        { id: "f2", scheduledDate: today, reason: "HbA1c again", status: "Scheduled", notes: "" },
        { id: "f3", scheduledDate: plus(today, -10), reason: "", status: "Completed", notes: "" },
        { id: "f4", scheduledDate: plus(today, 5), reason: "", status: "Pending", notes: "" }])] },
    { id: "c_cancel", name: "Cancelled fair", type: "Other", startDate: plus(today, -1), endDate: plus(today, 1), status: "Cancelled", participants: [] },
    { id: "c_plan", name: "Next month", type: "Other", startDate: plus(today, 20), endDate: "", status: "Active", participants: [] }
  ], deleted_ids: [] } } })).status, 200);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO poct_records (org_id, location_id, record_id, test_type, performed_at_iso, performed_at_local, record_json) VALUES
    (1, ?, 'r1', 'bp', ?, ?, '{}'), (1, ?, 'r2', 'bg', ?, ?, '{}'), (1, ?, 'r3', 'bp', ?, ?, '{}')`)
    .run(loc, now, today + "T10:00", loc, now, today + "T11:00", loc, plus(today, -1) + "T09:00:00.000Z", plus(today, -1) + "T10:00");
  db.prepare(`INSERT INTO vaccines_stock (org_id, location_id, vaccine_name, qty, batch, expiry_date, updated_at) VALUES
    (1, ?, 'Vaxigrip Tetra', 4, 'VX1', ?, ?), (1, ?, 'Boostrix', 2, 'BX9', ?, ?), (1, ?, 'Havrix', 0, 'H0', ?, ?), (1, ?, 'Engerix B', 5, 'E5', ?, ?), (1, ?, 'Typhim Vi', 3, '', '', ?)`)
    .run(loc, plus(today, -3), now, loc, plus(today, 12), now, loc, plus(today, -9), now, loc, plus(today, 200), now, loc, now);
  const sv = Number(db.prepare("INSERT INTO bk_services (org_id, location_id, name) VALUES (1, ?, 'Flu vaccine')").run(loc).lastInsertRowid);
  const bk = db.prepare("INSERT INTO bk_bookings (org_id, location_id, service_id, provider_id, person_name, date, start_time, end_time, status) VALUES (1, ?, ?, 1, ?, ?, ?, ?, ?)");
  bk.run(loc, sv, "Rita Camilleri", today, "00:00", "00:10", "booked");     // started, not marked
  bk.run(loc, sv, "Paul Grech", today, "00:01", "00:11", "done");
  bk.run(loc, sv, "Kurt Zahra", today, "23:58", "23:59", "confirmed");      // still to come
  bk.run(loc, sv, "Anna Galea", today, "23:00", "23:10", "cancelled");      // not counted
  bk.run(loc, sv, "Josephine Pace", plus(today, 1), "09:00", "09:10", "booked"); // tomorrow
  const ok1 = await api("POST", "/vaccines/orders", { token, body: { section: "other", client_first: "Ġużeppi", client_last: "Borg", phone: "79000000", items: [{ vaccine_name: "Boostrix", qty: 1 }] } });
  eq(ok1.status < 300, true, "vaccine order: " + ok1.text);
}

test("services today: one read says what is waiting across the clinical services", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const today = maltaToday();
  const first = await api("GET", "/services/today", { token }); // makes the tables, nothing in them yet
  eq(first.status, 200, first.text);
  const j0 = first.json;
  eq(j0.ok, true); eq(j0.date, today);
  eq(j0.pv.drafts, 0); eq(j0.pv.oldest_draft_date, null); eq(j0.screening.running.length, 0); eq(j0.followups.count, 0);
  eq(j0.poct.today, 0); eq(j0.vaccines.expired, 0); eq(j0.vaccines.expiring30, 0); eq(j0.vaccines.orders_today, 0); eq(j0.vaccines.due, null, "no vaccinations table yet: nothing made here");
  eq(j0.bookings.length, 0); eq(j0.bookings_summary.total, 0);

  await seed(api, token, DB.db, 1, today);
  const n = counter(DB);
  const r = await api("GET", "/services/today", { token });
  eq(r.status, 200, r.text);
  const own = n.sql.filter((q) => !/FROM (sessions|locations|orgs) |^SELECT s\.id AS session_id/.test(q));
  ok(own.length <= 7, "at most 7 statements of its own, one request: " + own.length + " " + JSON.stringify(own));
  ok(n.rows <= 30, "a handful of rows returned: " + n.rows);
  const j = r.json;
  // reports: Draft and blank not sent; Submitted and Closed are sent; oldest first; serious counted
  eq(j.pv.drafts, 2); eq(j.pv.serious, 1); eq(j.pv.oldest_draft_date, plus(today, -6));
  eq(j.pv.reports.map((x) => x.id).join(), "pv_1,pv_2");
  eq(j.pv.reports[1].serious, true); eq(j.pv.reports[1].reaction, "Angioedema"); eq(j.pv.reports[1].medicine, "Ramipril 5mg");
  ok(!JSON.stringify(j.pv).includes("Ġ.B."), "no patient details from a report");
  // screening: only the running campaign (not ended, cancelled or planned); its people, today's, target
  eq(j.screening.running.length, 1);
  const c = j.screening.running[0];
  eq(c.name, "Blood pressure week"); eq(c.screened, 3); eq(c.today, 2); eq(c.target, 50); eq(c.end, plus(today, 4));
  // follow-ups due today or earlier, any campaign, not Completed/Cancelled, not in the future
  eq(j.followups.count, 2); eq(j.followups.overdue, 1);
  eq(j.followups.due.map((x) => x.name).join(), "Ċensu Borg,Ġorġ Abela");
  eq(j.followups.due[0].campaign_id, "c_on"); eq(j.followups.due[0].participant_id, "p1"); eq(j.followups.due[1].reason, "HbA1c again");
  // tests today by the Malta day (yesterday's not counted)
  eq(j.poct.today, 2);
  // vaccines: still in stock, expired or within 30 days; none in stock or with no date are left out; out of stock by name
  eq(j.vaccines.expired, 1); eq(j.vaccines.expiring30, 1); eq(j.vaccines.out_of_stock, 1);
  eq(j.vaccines.batches.map((x) => x.name).join(), "Vaxigrip Tetra,Boostrix");
  eq(j.vaccines.orders_today, 1);
  // bookings today: cancelled and tomorrow's left out; the ones still to see first; one started and not marked
  const s2 = j.bookings_summary;
  eq(s2.total, 3); eq(s2.done, 1); eq(s2.late, 1); eq(s2.to_come, 1);
  eq(j.bookings.map((x) => x.person_name).join(), "Rita Camilleri,Kurt Zahra,Paul Grech");
  ok(j.bookings[1].service === "Flu vaccine" && j.bookings[1].start_time === "23:58" && j.bookings[1].status === "confirmed", JSON.stringify(j.bookings[1]));

  // doses due, once vax's vaccinations record exists (its columns; made here only for the test): open, due today or earlier
  DB.db.exec(`CREATE TABLE vaccinations (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL, given_on TEXT NOT NULL,
    client_first TEXT NOT NULL, client_last TEXT NOT NULL, vaccine_name TEXT NOT NULL, dose TEXT NOT NULL DEFAULT '', next_due TEXT NOT NULL DEFAULT '', next_state INTEGER NOT NULL DEFAULT 0)`);
  const vx = DB.db.prepare("INSERT INTO vaccinations (org_id, location_id, given_on, client_first, client_last, vaccine_name, dose, next_due, next_state) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)");
  vx.run(1, plus(today, -30), "Ċettina", "Vella", "Engerix B", "Dose 2", plus(today, -3), 0);   // overdue
  vx.run(1, plus(today, -28), "Kurt", "Zahra", "Havrix", "Dose 2", today, 0);                   // due today
  vx.run(1, plus(today, -28), "Paul", "Grech", "Havrix", "Dose 2", plus(today, 2), 0);          // later
  vx.run(1, plus(today, -60), "Anna", "Galea", "Engerix B", "Dose 2", plus(today, -10), 1);     // closed
  vx.run(1, plus(today, -500), "Old", "Recall", "Engerix B", "1st", plus(today, -400), 0);     // over a year overdue: vax's bound
  vx.run(2, plus(today, -30), "Other", "Pharmacy", "Engerix B", "Dose 2", plus(today, -3), 0);  // another pharmacy
  const due = (await api("GET", "/services/today", { token })).json.vaccines.due;
  eq(due.count, 2); eq(due.overdue, 1);
  eq(due.first.map((x) => x.name + "|" + x.vaccine + "|" + x.next_due).join(), "Ċettina Vella|Engerix B|" + plus(today, -3) + ",Kurt Zahra|Havrix|" + today);

  // read only: every report and campaign exactly as saved
  const pvs = (await api("GET", "/pharmacovigilance/state", { token })).json.reports;
  eq(pvs.length, 4);
  // /today is not touched
  const t = (await api("GET", "/today", { token })).json;
  eq(t.services_today, undefined, "/today carries nothing new");
});

test("services today: another pharmacy sees only its own; admin and staff only", async (app) => {
  const { api, bootstrap, DB } = app;
  const A = await bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  const B = await app.addUser({ orgId: 1, locationId: 2, email: "b@example.com", name: "B Admin" });
  const S = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  const U = await app.addUser({ orgId: 1, locationId: 1, email: "user@example.com", name: "User", role: "user" });
  const today = maltaToday();
  await api("GET", "/services/today", { token: A.token });
  await seed(api, A.token, DB.db, 1, today);
  const b = (await api("GET", "/services/today", { token: B.token })).json;
  eq(b.pv.drafts, 0, "B does not see A's reports"); eq(b.screening.running.length, 0); eq(b.followups.count, 0); eq(b.poct.today, 0); eq(b.vaccines.expired, 0); eq(b.vaccines.orders_today, 0); eq(b.bookings_summary.total, 0);
  const s = await api("GET", "/services/today", { token: S.token });
  eq(s.status, 200, s.text); eq(s.json.pv.drafts, 2, "staff read reports, as on Pharmacovigilance");
  eq((await api("GET", "/services/today", { token: U.token })).status, 403, "a user role opens none of these screens");
  eq((await api("GET", "/services/today", {})).status, 401);
});
