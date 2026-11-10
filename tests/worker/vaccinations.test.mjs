// Vaccinations given (Services, 2026-11-09): a record per vaccine given, the month's list, one person's history, recalls
// due, closing a recall. A = org 1 / location 1 (admin). Branch = org 1 / location 2. Other = org 2.
import { test, eq, ok } from "./lib.mjs";

function malta(n = 0) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 864e5)); }
const base = (o = {}) => Object.assign({ given_on: malta(0), client_first: "Ġorġ", client_last: "Żammit", phone: "79000111", email: "", vaccine_name: "Havrix 1440",
  dose: "1st", batch: "AHAVB123", expiry_date: "2027-06-30", site: "Left upper arm", consent_by: "Patient", next_due: malta(180) }, o);

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

test("vaccinations: record one; month, history and due read it back; who gave it from the session; audited", async (app) => {
  const w = await world(app);
  const r = await app.api("POST", "/vaccines/given", { token: w.staff.token, body: base({ org_id: 2, location_id: 3, given_by_name: "Someone else" }) });
  eq(r.status, 200, r.text);
  const g = r.json.given;
  eq([g.client_first, g.client_last, g.vaccine_name, g.batch, g.expiry_date, g.site, g.consent_by, g.dose, g.next_state], ["Ġorġ", "Żammit", "Havrix 1440", "AHAVB123", "2027-06-30", "Left upper arm", "Patient", "1st", 0]);
  eq(g.given_by_name, "Staff One", "the signed-in person, not the body");
  const row = app.DB.db.prepare("SELECT org_id, location_id FROM vaccinations WHERE id = ?").get(g.id);
  eq([row.org_id, row.location_id], [1, 1], "the session's pharmacy");
  const m = await app.api("GET", "/vaccines/given?month=" + malta(0).slice(0, 7), { token: w.A.token });
  eq(m.json.given.map((x) => x.id), [g.id]);
  const h = await app.api("GET", "/vaccines/given?first=" + encodeURIComponent("Ġorġ") + "&last=" + encodeURIComponent("Żammit"), { token: w.A.token });
  eq(h.json.given.length, 1, "history by name (Maltese letters): " + h.text);
  await app.api("POST", "/vaccines/given", { token: w.A.token, body: base({ client_first: "Joseph", client_last: "Grech", phone: "", next_due: "" }) });
  eq((await app.api("GET", "/vaccines/given?first=joseph&last=GRECH", { token: w.A.token })).json.given.length, 1, "history by name, any case");
  eq((await app.api("GET", "/vaccines/given?phone=79000111", { token: w.A.token })).json.given.length, 1, "history by phone");
  const d = await app.api("GET", "/vaccines/given/due?to=" + malta(200), { token: w.A.token });
  eq(d.json.due.map((x) => x.id), [g.id], "the recall is due within 200 days");
  eq((await app.api("GET", "/vaccines/given/due?to=" + malta(100), { token: w.A.token })).json.due.length, 0, "not yet due within 100 days");
  eq((await app.api("GET", "/vaccines/given/due", { token: w.A.token })).json.due.length, 0, "default: the next 14 days");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'VAX_GIVEN_CREATE'").get().c, 2);
});

test("vaccinations: the next dose closes the earlier recall for the same vaccine and person; close by hand", async (app) => {
  const w = await world(app);
  const one = (await app.api("POST", "/vaccines/given", { token: w.A.token, body: base({ given_on: malta(-200), next_due: malta(-20) }) })).json.given;
  const flu = (await app.api("POST", "/vaccines/given", { token: w.A.token, body: base({ vaccine_name: "Influvac", given_on: malta(-300), next_due: malta(-5) }) })).json.given;
  const other = (await app.api("POST", "/vaccines/given", { token: w.A.token, body: base({ client_first: "Maria", phone: "79999999", given_on: malta(-200), next_due: malta(-20) }) })).json.given;
  eq((await app.api("GET", "/vaccines/given/due?to=" + malta(0), { token: w.A.token })).json.due.map((x) => x.id), [one.id, other.id, flu.id], "overdue, earliest first");
  const two = await app.api("POST", "/vaccines/given", { token: w.A.token, body: base({ vaccine_name: "havrix 1440", dose: "2nd", next_due: "" }) });
  eq(two.json.closed_recalls, 1, two.text);
  eq((await app.api("GET", "/vaccines/given/due?to=" + malta(0), { token: w.A.token })).json.due.map((x) => x.id), [other.id, flu.id], "Ġorġ's Havrix recall answered; Maria's and the flu one stay");
  eq((await app.api("POST", "/vaccines/given/" + flu.id + "/close", { token: w.A.token })).status, 200);
  eq((await app.api("POST", "/vaccines/given/" + flu.id + "/close", { token: w.A.token })).json.already, true);
  eq((await app.api("GET", "/vaccines/given/due?to=" + malta(0), { token: w.A.token })).json.due.map((x) => x.id), [other.id]);
  const st = app.DB.db.prepare("SELECT next_state, closed_at, closed_by FROM vaccinations WHERE id IN (?, ?) ORDER BY id").all(one.id, flu.id);
  eq(st.map((x) => x.next_state), [1, 2], "1 = dose given, 2 = closed by hand");
  ok(st.every((x) => x.closed_at && x.closed_by === 1), "closed_at and closed_by kept: " + JSON.stringify(st));
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM vaccinations").get().c, 4, "nothing is deleted");
});

test("vaccinations: refusals (consent, site, dates, names) and nothing stored", async (app) => {
  const w = await world(app);
  const bad = [{ consent_by: "" }, { consent_by: "Neighbour" }, { site: "" }, { site: "Ear" }, { given_on: malta(1) }, { given_on: "2026-02-30" }, { client_last: "" }, { vaccine_name: "" },
    { expiry_date: "June" }, { next_due: malta(0) }, { next_due: "soon" }];
  for (const b of bad) eq((await app.api("POST", "/vaccines/given", { token: w.A.token, body: base(b) })).status, 400, JSON.stringify(b));
  eq((await app.api("GET", "/vaccines/given", { token: w.A.token })).status, 400, "a list needs a month or a person");
  eq((await app.api("GET", "/vaccines/given?month=2026-13", { token: w.A.token })).status, 400);
  eq((await app.api("GET", "/vaccines/given/due?to=x", { token: w.A.token })).status, 400);
  eq((await app.api("GET", "/vaccines/given?month=2026-11")).status, 401);
  eq((await app.api("DELETE", "/vaccines/given", { token: w.A.token })).status, 405);
  eq((await app.api("POST", "/vaccines/given/999/close", { token: w.A.token })).status, 404);
  const u = await app.addUser({ orgId: 1, locationId: 1, email: "user@example.com", name: "Plain User", role: "user" });
  eq((await app.api("POST", "/vaccines/given", { token: u.token, body: base() })).status, 403, "only staff and admins record");
  eq((await app.api("GET", "/vaccines/given/due", { token: u.token })).status, 403);
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM vaccinations").get().c, 0);
});

test("vaccinations: each pharmacy its own (branch, other group): lists, history, due and close", async (app) => {
  const w = await world(app);
  const g = (await app.api("POST", "/vaccines/given", { token: w.A.token, body: base({ next_due: malta(3) }) })).json.given;
  for (const u of [w.branch, w.other]) {
    eq((await app.api("GET", "/vaccines/given?month=" + malta(0).slice(0, 7), { token: u.token })).json.given.length, 0);
    eq((await app.api("GET", "/vaccines/given?phone=79000111", { token: u.token })).json.given.length, 0);
    eq((await app.api("GET", "/vaccines/given/due?to=" + malta(10), { token: u.token })).json.due.length, 0);
    eq((await app.api("POST", "/vaccines/given/" + g.id + "/close", { token: u.token })).status, 404);
  }
  eq(app.DB.db.prepare("SELECT next_state FROM vaccinations WHERE id = ?").get(g.id).next_state, 0, "still open");
  // a dose given at the branch does not close A's recall
  await app.api("POST", "/vaccines/given", { token: w.branch.token, body: base({ next_due: "" }) });
  eq((await app.api("GET", "/vaccines/given/due?to=" + malta(10), { token: w.A.token })).json.due.length, 1);
});

test("vaccinations: orders and vaccine stock are not touched", async (app) => {
  const w = await world(app);
  await app.api("POST", "/vaccines/stock/rows", { token: w.A.token, body: { vaccine_name: "Havrix 1440", qty: 5, batch: "AHAVB123", expiry_date: "2027-06-30" } });
  const before = JSON.stringify(app.DB.db.prepare("SELECT * FROM vaccines_stock").all());
  await app.api("POST", "/vaccines/given", { token: w.A.token, body: base() });
  eq(JSON.stringify(app.DB.db.prepare("SELECT * FROM vaccines_stock").all()), before, "stock unchanged");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM vaccines_orders").get().c, 0);
});

test("vaccinations: month, due and history read through an index (rows read = rows shown, not the whole table)", async (app) => {
  const w = await world(app);
  await app.api("POST", "/vaccines/given", { token: w.A.token, body: base() }); // makes the table
  const plan = (sql, args) => app.DB.db.prepare("EXPLAIN QUERY PLAN " + sql).all(...args).map((r) => r.detail).join(" | ");
  const m = plan("SELECT id FROM vaccinations WHERE org_id = ? AND location_id = ? AND given_on >= ? AND given_on < ? ORDER BY given_on DESC, id DESC LIMIT 500", [1, 1, "2026-11-01", "2026-12-01"]);
  ok(/USING (COVERING )?INDEX idx_vaccinations_org_loc_given/.test(m), "month: " + m);
  const d = plan("SELECT id FROM vaccinations WHERE org_id = ? AND location_id = ? AND next_state = 0 AND next_due >= ? AND next_due <= ? ORDER BY next_due ASC, id ASC LIMIT 200", [1, 1, "2025-11-01", "2026-11-20"]);
  ok(/USING (COVERING )?INDEX idx_vaccinations_org_loc_due/.test(d), "due: " + d);
  const h1 = plan("SELECT id FROM vaccinations WHERE org_id = ? AND location_id = ? AND client_last = ? COLLATE NOCASE AND client_first = ? COLLATE NOCASE LIMIT 100", [1, 1, "Grech", "Joseph"]);
  ok(/idx_vaccinations_org_loc_name/.test(h1), "history by name: " + h1);
  const h2 = plan("SELECT id FROM vaccinations WHERE org_id = ? AND location_id = ? AND phone = ? LIMIT 100", [1, 1, "79"]);
  ok(/idx_vaccinations_org_loc_phone/.test(h2), "history by phone: " + h2);
});

test("vaccinations: the dose that closes a recall finds it through an index too", async (app) => {
  const w = await world(app);
  await app.api("POST", "/vaccines/given", { token: w.A.token, body: base() });
  const d = app.DB.db.prepare("EXPLAIN QUERY PLAN UPDATE vaccinations SET next_state = 1 WHERE org_id = ? AND location_id = ? AND id <> ? AND next_state = 0 AND next_due <> '' AND vaccine_name = ? COLLATE NOCASE AND ((client_last = ? COLLATE NOCASE AND client_first = ? COLLATE NOCASE) OR phone = ?)").all(1, 1, 0, "x", "a", "b", "c").map((r) => r.detail).join(" | ");
  ok(!/SCAN vaccinations/.test(d) && !/^SEARCH vaccinations USING INDEX idx_vaccinations_org_loc_given \(org_id=\? AND location_id=\?\)$/.test(d), "close: " + d);
});
