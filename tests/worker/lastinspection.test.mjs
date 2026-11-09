// Day of the last inspection (Registers & inspection, round 2): one per pharmacy, set by staff or the pharmacist,
// read by every device of that pharmacy. A = org 1 / location 1 (admin). Branch = org 1 / location 2. Other = org 2.
import { test, eq, ok } from "./lib.mjs";

function malta(n = 0) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 864e5)); }

async function world(app) {
  const A = await app.bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff One", role: "staff" });
  app.DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (3, 2, 'Other Pharmacy')").run();
  const other = await app.addUser({ orgId: 2, locationId: 3, email: "other@example.com", name: "Other Admin" });
  return { A, branch, staff, other };
}

test("last inspection: empty at first; staff sets it; every sign-in of the pharmacy reads it; audited", async (app) => {
  const w = await world(app);
  const g0 = await app.api("GET", "/registers/last-inspection", { token: w.A.token });
  eq(g0.status, 200, g0.text); eq(g0.json.last_date, "");
  const d = malta(-20);
  const p = await app.api("PUT", "/registers/last-inspection", { token: w.staff.token, body: { date: d } });
  eq(p.status, 200, p.text); eq([p.json.last_date, p.json.set_name], [d, "Staff One"]); ok(p.json.updated_at, "updated_at");
  eq((await app.api("GET", "/registers/last-inspection", { token: w.A.token })).json.last_date, d, "the admin's device sees the staff's day");
  const same = await app.api("PUT", "/registers/last-inspection", { token: w.A.token, body: { date: d } });
  eq(same.json.unchanged, true); eq(same.json.set_name, "Staff One", "the same day again changes nothing");
  const today = malta(0);
  eq((await app.api("PUT", "/registers/last-inspection", { token: w.A.token, body: { date: today } })).json.last_date, today, "today is allowed");
  const audit = app.DB.db.prepare("SELECT details_json FROM audit_log WHERE action = 'LAST_INSPECTION_SET' ORDER BY id").all();
  eq(audit.length, 2, "two changes, two audit lines");
  ok(audit[1].details_json.includes(d) && audit[1].details_json.includes(today), "the audit keeps the day before and after: " + audit[1].details_json);
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM register_last_inspection").get().c, 1, "one row per pharmacy");
  eq((await app.api("PUT", "/registers/last-inspection", { token: w.A.token, body: { date: "" } })).json.last_date, "", "an empty day clears it");
});

test("last inspection: each pharmacy its own (branch, other group); the body cannot pick another pharmacy", async (app) => {
  const w = await world(app);
  await app.api("PUT", "/registers/last-inspection", { token: w.A.token, body: { date: malta(-5), org_id: 2, location_id: 3 } });
  eq((await app.api("GET", "/registers/last-inspection", { token: w.branch.token })).json.last_date, "", "the branch of the same group does not see it");
  eq((await app.api("GET", "/registers/last-inspection", { token: w.other.token })).json.last_date, "", "another group does not see it");
  await app.api("PUT", "/registers/last-inspection", { token: w.branch.token, body: { date: malta(-9) } });
  eq((await app.api("GET", "/registers/last-inspection", { token: w.A.token })).json.last_date, malta(-5), "A keeps its own day");
  eq((await app.api("GET", "/registers/last-inspection", { token: w.branch.token })).json.last_date, malta(-9));
  const rows = app.DB.db.prepare("SELECT org_id, location_id FROM register_last_inspection ORDER BY location_id").all().map((r) => r.org_id + "/" + r.location_id).join(",");
  eq(rows, "1/1,1/2", "rows bound to the session's pharmacy: " + rows);
});

test("last inspection: refusals: a future day, bad dates, no sign-in, other methods", async (app) => {
  const w = await world(app);
  eq((await app.api("PUT", "/registers/last-inspection", { token: w.A.token, body: { date: malta(2) } })).status, 400, "after today");
  for (const bad of ["2026-02-30", "1999-12-31", "9/11/2026", "2026-13-01", "x"]) eq((await app.api("PUT", "/registers/last-inspection", { token: w.A.token, body: { date: bad } })).status, 400, bad);
  eq((await app.api("GET", "/registers/last-inspection")).status, 401);
  eq((await app.api("POST", "/registers/last-inspection", { token: w.A.token, body: { date: malta(-1) } })).status, 405);
  eq((await app.api("DELETE", "/registers/last-inspection", { token: w.A.token })).status, 405);
  eq((await app.api("GET", "/registers/last-inspection", { token: w.A.token })).json.last_date, "", "nothing was stored");
});
