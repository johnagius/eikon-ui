// Register sign-offs (Registers & inspection, "daily"): the pharmacist signs off an ended month of a daily register.
// A = org 1 / location 1 (bootstrap admin). Branch = org 1 / location 2. Staff = org 1 / location 1, role staff.
import { test, eq, ok } from "./lib.mjs";

function malta(d) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date()); }
function shift(ym, k) { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); }
const NOW = malta().slice(0, 7), LAST = shift(NOW, -1);

async function world(app) {
  const A = await app.bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff One", role: "staff" });
  return { A, branch, staff };
}

test("signoff: the pharmacist signs off last month once; GET lists it; a repeat returns the first unchanged", async (app) => {
  const w = await world(app);
  const g0 = await app.api("GET", "/registers/signoffs?month=" + LAST, { token: w.A.token });
  eq(g0.status, 200, g0.text); eq(g0.json.signoffs, []);
  const p = await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "temperature", month: LAST, note: "Closed 2 days for works" } });
  eq(p.status, 200, p.text);
  eq([p.json.signoff.register, p.json.signoff.month, p.json.signoff.signed_name, p.json.signoff.note], ["temperature", LAST, "Maria Borg", "Closed 2 days for works"]);
  ok(p.json.signoff.signed_at, "signed_at set");
  const again = await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "temperature", month: LAST, note: "other" } });
  eq(again.status, 200); eq(again.json.already, true); eq(again.json.signoff.note, "Closed 2 days for works");
  const g = await app.api("GET", "/registers/signoffs?month=" + LAST, { token: w.A.token });
  eq(g.json.signoffs.length, 1); eq(g.json.signoffs[0].register, "temperature");
  const audit = app.DB.db.prepare("SELECT action, entity_type FROM audit_log WHERE action = 'REGISTER_SIGNOFF'").all();
  eq(audit.length, 1, "one audit entry");
  // staff of the same pharmacy see it
  eq((await app.api("GET", "/registers/signoffs?month=" + LAST, { token: w.staff.token })).json.signoffs.length, 1);
});

test("signoff: refusals: staff, this month, a future month, unknown register, bad month", async (app) => {
  const w = await world(app);
  eq((await app.api("POST", "/registers/signoffs", { token: w.staff.token, body: { register: "cleaning", month: LAST } })).status, 403);
  eq((await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "cleaning", month: NOW } })).status, 400);
  eq((await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "cleaning", month: shift(NOW, 1) } })).status, 400);
  eq((await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "ddasales", month: LAST } })).status, 400);
  eq((await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "cleaning", month: "2026-13" } })).status, 400);
  eq((await app.api("GET", "/registers/signoffs?month=nope", { token: w.A.token })).status, 400);
  eq((await app.api("GET", "/registers/signoffs?month=" + LAST)).status, 401);
  const t = app.DB.db.prepare("SELECT name FROM sqlite_master WHERE name = 'register_signoffs'").get();
  ok(!t || app.DB.db.prepare("SELECT COUNT(*) AS c FROM register_signoffs").get().c === 0, "nothing stored");
});

test("signoff: another pharmacy of the same group neither sees nor shares a sign-off", async (app) => {
  const w = await world(app);
  eq((await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "locum", month: LAST } })).status, 200);
  eq((await app.api("GET", "/registers/signoffs?month=" + LAST, { token: w.branch.token })).json.signoffs, []);
  const b = await app.api("POST", "/registers/signoffs", { token: w.branch.token, body: { register: "locum", month: LAST } });
  eq(b.status, 200); ok(!b.json.already, "the branch signs its own"); eq(b.json.signoff.signed_name, "Branch Admin");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM register_signoffs").get().c, 2);
});

test("signoff: reading a month costs one indexed query of that month's rows only", async (app) => {
  const w = await world(app);
  for (const r of ["temperature", "cleaning", "daily", "locum", "receipts"]) await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: r, month: LAST } });
  await app.api("POST", "/registers/signoffs", { token: w.A.token, body: { register: "temperature", month: shift(NOW, -2) } });
  const plan = app.DB.db.prepare("EXPLAIN QUERY PLAN SELECT register, month, signed_name, signed_at, note FROM register_signoffs WHERE org_id = ? AND location_id = ? AND month = ? ORDER BY register").all(1, 1, LAST);
  ok(plan.some((p) => /USING INDEX/.test(p.detail)), "uses the unique index: " + JSON.stringify(plan));
  eq((await app.api("GET", "/registers/signoffs?month=" + LAST, { token: w.A.token })).json.signoffs.length, 5);
});
