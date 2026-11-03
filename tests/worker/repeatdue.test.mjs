// Backlog 3 item 7: repeat prescriptions coming due. Two additive columns on repeat_prescription_entries
// (collect_every_days, last_collected_date), a "Collected today" route, and the classic screen's full-replace PUT
// must never wipe either of them.
import { test, eq, ok } from "./lib.mjs";

function maltaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function daysAgo(n) { const [y, m, d] = maltaToday().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); }
const RX = (o = {}) => ({ entry_date: daysAgo(10), expires_date: "", client_name: "Grech Carmen", client_id: "123456M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", prescriber_name: "Dr Galea", prescriber_reg_no: "1202", ...o });
// Exactly what the classic screen's validatePayload sends on an edit (modules.repeatprescriptions.js): no new fields.
const CLASSIC = (o = {}) => ({ entry_date: daysAgo(10), expires_date: "", client_name: "Grech Carmen", client_id: "123456M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 in the morning", prescriber_name: "Dr Galea", prescriber_reg_no: "1202", ...o });
const row = (DB, id) => DB.db.prepare("SELECT * FROM repeat_prescription_entries WHERE id = ?").get(id);
const list = async (api, token) => (await api("GET", "/repeat-prescriptions/entries?from=" + daysAgo(60) + "&to=" + maltaToday(), { token })).json.entries;

test("repeatdue: create takes the interval, GET returns both new columns", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const a = await api("POST", "/repeat-prescriptions/entries", { token, body: RX({ collect_every_days: 28 }) });
  eq(a.status, 200, a.text);
  const b = await api("POST", "/repeat-prescriptions/entries", { token, body: RX({ client_id: "9M", client_name: "Vella Joe" }) });
  eq(b.status, 200, b.text);
  eq(row(DB, a.json.entry_id).collect_every_days, 28);
  eq(row(DB, b.json.entry_id).collect_every_days, null, "no interval = NULL");
  const es = await list(api, token);
  const ea = es.find((e) => e.id === a.json.entry_id), eb = es.find((e) => e.id === b.json.entry_id);
  eq(ea.collect_every_days, 28); eq(ea.last_collected_date, null);
  ok("collect_every_days" in eb && "last_collected_date" in eb, "GET lists both columns");
  for (const bad of [0.5, 400, "abc", -3]) eq((await api("POST", "/repeat-prescriptions/entries", { token, body: RX({ collect_every_days: bad }) })).status, 400, "bad interval " + bad);
  eq((await api("POST", "/repeat-prescriptions/entries", { token, body: RX({ collect_every_days: "" }) })).status, 200, "empty = no interval");
});

test("repeatdue: the classic screen's full-replace PUT keeps the interval and the last collection", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const id = (await api("POST", "/repeat-prescriptions/entries", { token, body: RX({ collect_every_days: 28 }) })).json.entry_id;
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token, body: {} })).status, 200);
  const u = await api("PUT", "/repeat-prescriptions/entries/" + id, { token, body: CLASSIC() });
  eq(u.status, 200, u.text);
  const r = row(DB, id);
  eq(r.posology, "1 in the morning", "the correction applied");
  eq(r.collect_every_days, 28, "classic PUT wiped the interval");
  eq(r.last_collected_date, maltaToday(), "classic PUT wiped the last collection");
  // A body that DOES carry it changes it; "" clears it; last_collected_date in a PUT body is ignored.
  eq((await api("PUT", "/repeat-prescriptions/entries/" + id, { token, body: CLASSIC({ collect_every_days: 56, last_collected_date: "2020-01-01" }) })).status, 200);
  eq(row(DB, id).collect_every_days, 56); eq(row(DB, id).last_collected_date, maltaToday(), "PUT does not set the collection date");
  eq((await api("PUT", "/repeat-prescriptions/entries/" + id, { token, body: CLASSIC({ collect_every_days: "" }) })).status, 200);
  eq(row(DB, id).collect_every_days, null);
  eq((await api("PUT", "/repeat-prescriptions/entries/" + id, { token, body: CLASSIC({ collect_every_days: 999 }) })).status, 400);
});

test("repeatdue: Collected today sets the Malta date, is audited, can be undone, refuses the future", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const id = (await api("POST", "/repeat-prescriptions/entries", { token, body: RX({ collect_every_days: 30 }) })).json.entry_id;
  const before = { ...row(DB, id) };
  const c = await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token, body: {} });
  eq(c.status, 200, c.text);
  eq(c.json.last_collected_date, maltaToday()); eq(c.json.previous, null);
  const after = row(DB, id);
  eq(after.last_collected_date, maltaToday());
  for (const k of ["entry_date", "expires_date", "client_name", "client_id", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no", "collect_every_days", "created_by", "created_at"]) eq(after[k], before[k], "unchanged " + k);
  const log = DB.db.prepare("SELECT * FROM audit_log WHERE action = 'REPEAT_RX_ENTRY_COLLECTED' ORDER BY id").all();
  eq(log.length, 1, "audited");
  const det = JSON.parse(log[0].details_json || "{}");
  eq(det.last_collected_date, maltaToday()); ok(det.before && det.after, "before/after kept: " + log[0].details_json.slice(0, 200));
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token, body: { date: daysAgo(-1) } })).status, 400, "future refused");
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token, body: { date: daysAgo(30) } })).status, 400, "before written refused");
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token, body: { date: "3 Nov" } })).status, 400);
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token, body: { date: daysAgo(2) } })).status, 200, "a past day (Undo)");
  eq(row(DB, id).last_collected_date, daysAgo(2));
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token, body: { date: null } })).status, 200, "clear");
  eq(row(DB, id).last_collected_date, null);
});

test("repeatdue: Collected today is scoped to the pharmacy (same group, other group, staff)", async (app) => {
  const { api, bootstrap, DB } = app;
  const A = await bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B (same group)')").run();
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Stranger Pharmacy')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const stranger = await app.addUser({ orgId: 2, locationId: 50, email: "stranger@example.com", name: "Stranger Admin" });
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  const id = (await api("POST", "/repeat-prescriptions/entries", { token: A.token, body: RX({ collect_every_days: 28 }) })).json.entry_id;
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token: branch.token, body: {} })).status, 404, "same group, other pharmacy");
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token: stranger.token, body: {} })).status, 404, "other group");
  eq((await api("PUT", "/repeat-prescriptions/entries/" + id, { token: branch.token, body: CLASSIC({ collect_every_days: 7 }) })).status, 404);
  eq(row(DB, id).last_collected_date, null); eq(row(DB, id).collect_every_days, 28);
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected", { token: staff.token, body: {} })).status, 200, "staff of this pharmacy may");
  eq((await api("POST", "/repeat-prescriptions/entries/" + id + "/collected")).status, 401, "signed out");
  ok(!(await list(api, branch.token)).some((e) => e.id === id), "branch does not list it");
});

test("repeatdue: /today sends the repeats superset (interval or running out soon, with the patient's other valid lines), this pharmacy only", async (app) => {
  const { api, bootstrap, DB } = app;
  const A = await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const post = async (o, t = A.token) => (await api("POST", "/repeat-prescriptions/entries", { token: t, body: RX(o) })).json.entry_id;
  const withEvery = await post({ client_id: "1M", client_name: "Every Pt", collect_every_days: 28 });
  const sibling = await post({ client_id: "1 m", client_name: "Every Pt", medicine_name_dose: "Ramipril 5mg" }); // same card, typed with a space
  const soon = await post({ client_id: "2M", client_name: "Soon Pt", entry_date: daysAgo(170) }); // runs out in about 13 days
  const far = await post({ client_id: "3M", client_name: "Far Pt" }); // no interval, six months to go: not sent
  const gone = await post({ client_id: "4M", client_name: "Gone Pt", entry_date: daysAgo(200), collect_every_days: 30 }); // expired: not sent
  await post({ client_id: "5M", client_name: "Branch Pt", collect_every_days: 28 }, branch.token);
  const t = (await api("GET", "/today", { token: A.token })).json;
  ok(t.repeats && Array.isArray(t.repeats.entries), "repeats section: " + JSON.stringify(t.repeats).slice(0, 200));
  const got = t.repeats.entries.map((e) => e.id).sort((a, b) => a - b);
  eq(JSON.stringify(got), JSON.stringify([withEvery, sibling, soon].sort((a, b) => a - b)), "superset");
  ok(!got.includes(far) && !got.includes(gone), "far / expired left out");
  eq(t.repeats.lookahead_days, 92); eq(t.repeats.truncated, false);
  const e = t.repeats.entries.find((x) => x.id === withEvery);
  eq(e.collect_every_days, 28); ok("last_collected_date" in e && !("prescriber_reg_no" in e), "only what the card needs");
  const tb = (await api("GET", "/today", { token: branch.token })).json;
  eq(tb.repeats.entries.length, 1, "the branch sees only its own"); eq(tb.repeats.entries[0].client_name, "Branch Pt");
});
