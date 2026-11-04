// Batch 6 (2026-11-04): W2 Maltese letters in server name searches, W3 numbers issued by the server,
// W4 scarce stock offers shared inside a group (one org) only. Midnight dates: midnight.test.mjs.
import { test, eq, ok } from "./lib.mjs";

const D = "2026-11-04";
const NAMES = ["Ċachia Marija", "Żammit Ġorġ", "Ħaġġar Pawlu", "Buħaġiar Rita", "Borg Anna", "Vella Joseph", "ċaruana ħelen"];

// Stored as they are in a live pharmacy (older rows were never re-cased), straight into the table.
async function addPeople(api, token, DB) {
  await api("GET", "/people?q=xx", { token }); // creates the table
  for (const n of NAMES) DB.db.prepare("INSERT INTO people (org_id, location_id, name) VALUES (1, 1, ?)").run(n);
}
const names = (r) => (r.json.people || []).map((p) => p.name).sort();
const hist = (r) => (r.json.history || []).map((p) => p.name).sort();

// ---------------------------------------------------------------- W2
test("batch6 W2: /people?q= finds Ċachia from 'cachia', Żammit from 'zammit', and capitals/lowercase alike", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await addPeople(api, token, DB);
  eq(names(await api("GET", "/people?q=cachia", { token })), ["Ċachia Marija"]);
  eq(names(await api("GET", "/people?q=zammit", { token })), ["Żammit Ġorġ"]);
  eq(names(await api("GET", "/people?q=gorg", { token })), ["Żammit Ġorġ"]);
  eq(names(await api("GET", "/people?q=haggar", { token })), ["Ħaġġar Pawlu"]);
  eq(names(await api("GET", "/people?q=buhagiar", { token })), ["Buħaġiar Rita"]);
  eq(names(await api("GET", "/people?q=CARUANA", { token })), ["ċaruana ħelen"]);
  eq(names(await api("GET", "/people?q=Ċaruana", { token })), ["ċaruana ħelen"], "a capital Ċ in the query finds a lowercase ċ stored");
  eq(names(await api("GET", "/people?q=ħelen", { token })), ["ċaruana ħelen"]);
  // Queries and names without those letters: exactly as before
  eq(names(await api("GET", "/people?q=borg", { token })), ["Borg Anna"]);
  eq(names(await api("GET", "/people?q=vella", { token })), ["Vella Joseph"]);
  eq(names(await api("GET", "/people?q=ar", { token })), ["Buħaġiar Rita", "Marija", "Ħaġġar Pawlu", "ċaruana ħelen"].map((x) => x === "Marija" ? "Ċachia Marija" : x).sort());
});

test("batch6 W2: history (legacy registers) and the register lists fold Maltese letters too", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const t = await api("POST", "/client-tickets/entries", { token, body: { ticket_id: "TKT-00001", open_date: D, client_name: "Ċachia Ġużeppi", issue: "Asked about stock", category: "Stock" } });
  eq(t.status, 200, t.text);
  const dv = await api("POST", "/client-deliveries/entries", { token, body: { delivery_id: "DEL-00001", order_date: D, client_name: "Żerafa Ħili", delivery_address: "Triq il-Kbira" } });
  eq(dv.status, 200, dv.text);
  const r = await api("GET", "/people?q=cachia", { token });
  eq(hist(r), ["Ċachia Ġużeppi"], r.text);
  eq(hist(await api("GET", "/people?q=zerafa hili", { token })), ["Żerafa Ħili"]);
  const tl = await api("GET", "/client-tickets/entries?q=guzeppi", { token });
  eq((tl.json.entries || []).map((e) => e.client_name), ["Ċachia Ġużeppi"], tl.text);
  eq((await api("POST", "/appointments/waitlist", { token, body: { patient_name: "Ħili Żaren" } })).status, 201);
  ok((await api("GET", "/appointments/waitlist?q=zaren", { token })).text.includes("Ħili Żaren"), "waiting list");
  eq((await api("POST", "/loyalty/clients", { token, body: { name: "Ġatt Ċensu", id_card: "123456M" } })).status, 200);
  ok((await api("GET", "/loyalty/clients?q=gatt censu", { token })).text.includes("Ġatt Ċensu"), "loyalty clients");
  ok((await api("GET", "/client-deliveries/entries", { token })).text.includes("Żerafa"), "delivery stored");
});

test("batch6 W2: 5,000 people — a folded search stays fast", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await api("GET", "/people?q=xx", { token }); // creates the table
  const ins = DB.db.prepare("INSERT INTO people (org_id, location_id, name, phone) VALUES (1, 1, ?, ?)");
  const sur = ["Ċachia", "Żammit", "Borg", "Vella", "Camilleri", "Farrugia", "Ħaġġar", "Grech", "Galea", "Abela"];
  DB.db.exec("BEGIN");
  for (let i = 0; i < 5000; i++) ins.run(sur[i % 10] + " Person" + i, "79" + String(100000 + i));
  DB.db.exec("COMMIT");
  const t0 = performance.now();
  const r = await api("GET", "/people?q=cachia&limit=50", { token });
  const ms = performance.now() - t0;
  eq(r.json.people.length, 50);
  ok(r.json.people.every((p) => p.name.startsWith("Ċachia")), "only Ċachia");
  ok(ms < 1500, "5,000 people searched in " + Math.round(ms) + " ms");
});

// ---------------------------------------------------------------- W3
test("batch6 W3: a question keeps the device's number when unused; a repeated number gets the next one; reply carries it", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const body = (id) => ({ ticket_id: id, open_date: D, client_name: "Borg Anna", issue: "Q", category: "Other" });
  const a = await api("POST", "/client-tickets/entries", { token, body: body("TKT-00001") });
  eq(a.json.ticket_id, "TKT-00001", a.text);
  const b = await api("POST", "/client-tickets/entries", { token, body: body("TKT-00001") }); // second device, same counter
  eq(b.json.ticket_id, "TKT-00002", b.text);
  const c = await api("POST", "/client-tickets/entries", { token, body: body("") }); // nothing sent
  eq(c.json.ticket_id, "TKT-00003", c.text);
  const d = await api("POST", "/client-tickets/entries", { token, body: body("Q-77") }); // an unused number of another shape is kept
  eq(d.json.ticket_id, "Q-77", d.text);
  ok(a.json.entry_id && b.json.entry_id, "entry_id still sent (older clients read it)");
  eq(DB.q("SELECT ticket_id FROM client_tickets_entries ORDER BY id").map((r) => r.ticket_id), ["TKT-00001", "TKT-00002", "TKT-00003", "Q-77"]);
  const aud = DB.q("SELECT details_json FROM audit_log WHERE action = 'CLIENT_TICKET_CREATE' ORDER BY id").map((r) => JSON.parse(r.details_json));
  eq([aud[1].ticket_id, aud[1].ticket_id_sent], ["TKT-00002", "TKT-00001"], "the audit names the number given and the one sent");
});

test("batch6 W3: existing duplicates are never renumbered; numbers are per pharmacy; deliveries alike", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const br = (await addUser({ orgId: 1, locationId: 2, email: "br@example.com" })).token;
  await api("GET", "/client-tickets/entries", { token }); await api("GET", "/client-deliveries/entries", { token });
  // Old rows as older clients left them: TKT-00001 twice, a gap, and TKT-00007.
  for (const id of ["TKT-00001", "TKT-00001", "TKT-00007"]) DB.db.prepare("INSERT INTO client_tickets_entries (org_id, location_id, ticket_id, open_date, client_name) VALUES (1, 1, ?, ?, 'Old')").run(id, D);
  for (const id of ["DEL-00001", "DEL-00001"]) DB.db.prepare("INSERT INTO client_deliveries (org_id, location_id, delivery_id, order_date, client_name, delivery_address) VALUES (1, 1, ?, ?, 'Old', 'x')").run(id, D);
  const before = JSON.stringify(DB.q("SELECT * FROM client_tickets_entries ORDER BY id")) + JSON.stringify(DB.q("SELECT * FROM client_deliveries ORDER BY id"));
  const t = await api("POST", "/client-tickets/entries", { token, body: { ticket_id: "TKT-00002", open_date: D, client_name: "N", issue: "Q", category: "O" } });
  eq(t.json.ticket_id, "TKT-00002", "an unused number in a gap is kept");
  const t2 = await api("POST", "/client-tickets/entries", { token, body: { ticket_id: "TKT-00001", open_date: D, client_name: "N", issue: "Q", category: "O" } });
  eq(t2.json.ticket_id, "TKT-00008", "above the highest stored");
  const tb = await api("POST", "/client-tickets/entries", { token: br, body: { ticket_id: "TKT-00001", open_date: D, client_name: "N", issue: "Q", category: "O" } });
  eq(tb.json.ticket_id, "TKT-00001", "another pharmacy of the group has its own numbers");
  const dv = await api("POST", "/client-deliveries/entries", { token, body: { delivery_id: "DEL-00001", order_date: D, client_name: "N", delivery_address: "x" } });
  eq(dv.json.delivery_id, "DEL-00002", dv.text);
  ok(dv.json.id, "id still sent");
  const dv2 = await api("POST", "/client-deliveries/entries", { token, body: { order_date: D, client_name: "N", delivery_address: "x" } });
  eq(dv2.json.delivery_id, "DEL-00003", dv2.text);
  const after = JSON.stringify(DB.q("SELECT * FROM client_tickets_entries WHERE id <= 3 ORDER BY id")) + JSON.stringify(DB.q("SELECT * FROM client_deliveries WHERE id <= 2 ORDER BY id"));
  eq(after, before, "old rows byte for byte");
  ok(DB.q("SELECT name FROM sqlite_master WHERE name = 'idx_client_tickets_org_loc_ticket_id'").length === 1, "ticket index");
  ok(DB.q("SELECT name FROM sqlite_master WHERE name = 'idx_client_deliveries_org_loc_delivery_id'").length === 1, "delivery index");
  const plan = DB.q("EXPLAIN QUERY PLAN SELECT 1 FROM client_tickets_entries WHERE org_id = 1 AND location_id = 1 AND ticket_id = 'TKT-00001'").map((r) => r.detail).join(" ");
  ok(/idx_client_tickets_org_loc_ticket_id/.test(plan), plan);
});

// ---------------------------------------------------------------- W4
async function groups(app) {
  const A = await app.bootstrap({ org: "Chain One", location: "Chain One A" });              // org 1, location 1
  const db = app.DB.db;
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Chain One B')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (601, 1, 'Chain One Head Office')").run();
  db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Chain Two')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Chain Two X')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (51, 2, 'Chain Two Y')").run();
  db.prepare("INSERT INTO orgs (id, name) VALUES (3, 'Lone Pharmacy Ltd')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (70, 3, 'Lone Pharmacy')").run();
  const u = async (o, l, e) => (await app.addUser({ orgId: o, locationId: l, email: e })).token;
  return { A: A.token, B: await u(1, 2, "b@x.mt"), HO: await u(1, 601, "ho@x.mt"), X: await u(2, 50, "x@x.mt"), Y: await u(2, 51, "y@x.mt"), L: await u(3, 70, "l@x.mt") };
}
const offerNames = async (api, token) => ((await api("GET", "/scarce-stock/offers", { token })).json.offers || []).map((o) => o.item_name).sort();

test("batch6 W4: scarce stock offers are seen and asked for only inside the offering pharmacy's group (org)", async (app) => {
  const { api, DB } = app;
  const T = await groups(app);
  const mk = async (tok, name) => { const r = await api("POST", "/scarce-stock/offers", { token: tok, body: { entry_date: D, item_name: name, quantity_available: 5, expiry_date: "2027-06-30" } }); eq(r.status, 200, r.text); return r.json.id; };
  const oA = await mk(T.A, "Ozempic A"), oX = await mk(T.X, "Mounjaro X"), oL = await mk(T.L, "Insulin L");
  eq(await offerNames(api, T.A), ["Ozempic A"]);
  eq(await offerNames(api, T.B), ["Ozempic A"], "same group, other branch");
  eq(await offerNames(api, T.HO), ["Ozempic A"], "the group's head office");
  eq(await offerNames(api, T.Y), ["Mounjaro X"]);
  eq(await offerNames(api, T.L), ["Insulin L"], "a pharmacy alone in its org sees only its own");
  eq((await api("GET", "/scarce-stock/offers?open=1", { token: T.X })).json.offers.map((o) => o.item_name), ["Mounjaro X"]);
  // asking
  const ok1 = await api("POST", `/scarce-stock/offers/${oA}/requests`, { token: T.B, body: { quantity_requested: 1 } });
  eq(ok1.status, 200, ok1.text);
  for (const [who, id] of [["X", oA], ["L", oA], ["A", oX], ["Y", oL]]) {
    const r = await api("POST", `/scarce-stock/offers/${id}/requests`, { token: T[who], body: { quantity_requested: 1 } });
    eq(r.status, 404, who + " asking another group's offer: " + r.text);
  }
  eq(DB.q("SELECT COUNT(*) AS c FROM scarce_stock_offer_requests")[0].c, 1, "only the same-group request stored");
  // owner-only actions unchanged
  eq((await api("POST", `/scarce-stock/offers/${oA}/place-on-transfer`, { token: T.X })).status, 403);
  const pt = await api("POST", `/scarce-stock/offers/${oA}/place-on-transfer`, { token: T.A });
  ok(pt.status === 200 || pt.status === 201, pt.text);
  // group data untouched
  eq(DB.q("SELECT id, org_id, name FROM locations ORDER BY id").map((r) => r.id + ":" + r.org_id).join(","), "1:1,2:1,50:2,51:2,70:3,601:1");
});

test("batch6 W4: a request made earlier on another group's offer stays on record, can be withdrawn, not changed", async (app) => {
  const { api, DB } = app;
  const T = await groups(app);
  const r = await api("POST", "/scarce-stock/offers", { token: T.A, body: { entry_date: D, item_name: "Clexane", quantity_available: 5 } });
  const oid = r.json.id;
  // as the old worker allowed: X (another group) asked before the change
  DB.db.prepare("INSERT INTO scarce_stock_offer_requests (offer_id, requester_org_id, requester_location_id, quantity_requested, note, created_by) VALUES (?, 2, 50, 2, 'old ask', 1)").run(oid);
  const rid = DB.q("SELECT id FROM scarce_stock_offer_requests")[0].id;
  const own = (await api("GET", "/scarce-stock/offers", { token: T.A })).json.offers[0];
  eq(own.total_requested, 2, "the owner still sees the earlier request");
  eq((await api("PUT", "/scarce-stock/offer-requests/" + rid, { token: T.X, body: { quantity_requested: 3 } })).status, 404);
  eq(DB.q("SELECT quantity_requested FROM scarce_stock_offer_requests")[0].quantity_requested, 2);
  eq((await api("DELETE", "/scarce-stock/offer-requests/" + rid, { token: T.X })).status, 200, "withdrawn");
});
