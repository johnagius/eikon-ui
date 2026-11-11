// One-click public demo (owner, 2026-11-11): the doors, the guard, the isolation in both directions, the reset (wipe +
// seed) touching only the demo group, and the nightly run. The world: two live groups, a live supplier and a live head
// office, and the demo group 2 (its pharmacy 2 has a real sign-in of its own, which must keep working).
import { test, eq, ok } from "./lib.mjs";
import { maltaYmd } from "../clock.mjs";
import { boardSchema } from "./boardequiv.test.mjs"; // the board keeps a per-isolate "schema ready" flag: each test database gets the tables

const DEMO_ENV = { DEMO_ORG_ID: "2", DEMO_LOCATION_ID: "2", DEMO_PHARMACY2_LOCATION_ID: "399", DEMO_SUPPLIER_LOCATION_ID: "598", DEMO_HQ_LOCATION_ID: "898" };
const DEMO_LOCS = [2, 399, 598, 898];

async function world(app, on = true) {
  const live = await app.bootstrap({ org: "Borg Pharmacies", location: "Borg Pharmacy", email: "maria@live.example", name: "Maria Borg" }); // org 1, location 1
  boardSchema(app.DB.db);
  app.DB.db.exec(`CREATE TABLE IF NOT EXISTS board_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, message_id INTEGER, title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium', created_by INTEGER, created_by_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS board_suggestion_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, suggestion_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));`); // as ensureBoardSchema makes them
  const q = (sql, ...a) => app.DB.db.prepare(sql).run(...a);
  q("INSERT INTO orgs (id, name) VALUES (2, 'Demo Pharmacy')"); q("INSERT INTO locations (id, org_id, name) VALUES (2, 2, 'Demo Pharmacy')");
  q("INSERT INTO orgs (id, name) VALUES (3, 'Zammit Group')"); q("INSERT INTO locations (id, org_id, name) VALUES (3, 3, 'Zammit Pharmacy')");
  q("INSERT INTO locations (id, org_id, name) VALUES (650, 3, 'Zammit Head Office')");
  q("INSERT INTO orgs (id, name) VALUES (400, 'Test Supplier')"); q("INSERT INTO locations (id, org_id, name) VALUES (400, 400, 'Test Supplier')");
  const john = await app.addUser({ orgId: 2, locationId: 2, email: "john@demo-owner.example", name: "John Agius" });
  const other = await app.addUser({ orgId: 3, locationId: 3, email: "rita@zammit.example", name: "Rita Zammit" });
  const ho = await app.addUser({ orgId: 3, locationId: 650, email: "ho@zammit.example", name: "Head Office" });
  const sup = await app.addUser({ orgId: 400, locationId: 400, email: "sales@supplier.example", name: "Supplier Sales" });
  // FIN-roles adds users.is_pharmacist / plans_rota on first use: settle the schema first (as on the live database after the
  // first request), so the byte-for-byte snapshots below compare values, not a column added in between.
  eq((await app.api("GET", "/team/me", { token: live.token })).status, 200);
  if (on) { // as after the first reset (doors stay shut until one has finished); the reset tests run real ones
    Object.assign(app.env, DEMO_ENV);
    app.DB.db.exec("CREATE TABLE IF NOT EXISTS demo_state (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '{}', at TEXT NOT NULL DEFAULT (datetime('now')))");
    app.DB.db.prepare("INSERT INTO demo_state (k, v) VALUES ('reset', ?)").run(JSON.stringify({ last_day: "2026-01-01" }));
  }
  return { live: live.token, john, other: other.token, ho: ho.token, sup: sup.token };
}
async function door(app, d = "pharmacy", ip = "203.0.113.7") {
  const r = await app.api("POST", "/auth/demo", { body: { door: d }, headers: { "CF-Connecting-IP": ip } });
  eq(r.status, 200, r.text);
  return r.json;
}
// Every row of every table that is not the demo's, as text: must be byte-for-byte the same before and after a reset.
function liveSnapshot(DB) {
  const out = {};
  for (const { name } of DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const cols = DB.db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
    const owners = cols.filter((c) => /^(org_id|location_id)$/.test(c) || /_(org_id|location_id)$/.test(c));
    let rows = DB.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    if (owners.length) rows = rows.filter((r) => !owners.some((c) => (/org_id$/.test(c) ? Number(r[c]) === 2 : DEMO_LOCS.includes(Number(r[c])))));
    if (["users"].includes(name)) rows = rows.filter((r) => !/@demo\.eikon\.invalid$/.test(r.email));
    if (["eikon_schema", "sessions", "demo_state", "demo_signins", "board_user_state", "supplier_order_items", "board_mentions", "board_suggestion_comments"].includes(name)) continue; // checked on their own
    out[name] = JSON.stringify(rows);
  }
  return out;
}

test("demo: off unless DEMO_ORG_ID and DEMO_LOCATION_ID are set (404, no flag, no reset)", async (app) => {
  const w = await world(app, false);
  eq((await app.api("GET", "/auth/demo")).status, 404);
  eq((await app.api("POST", "/auth/demo", { body: { door: "pharmacy" } })).status, 404);
  const me = await app.api("GET", "/auth/me", { token: w.john.token });
  eq(me.json.user.demo, undefined, "no demo flag when off");
  let p; await app.worker.scheduled({}, app.env, { waitUntil(x) { p = x; } }); await p;
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'demo_state'").get().c, 0, "the cron does nothing for the demo");
  app.env.DEMO_ORG_ID = "2"; // one of the two is not enough
  eq((await app.api("GET", "/auth/demo")).status, 404);
});

test("demo: three doors; each gives a 2-hour demo session in its own place; the real sign-in of the demo pharmacy is untouched", async (app) => {
  const w = await world(app);
  const g = await app.api("GET", "/auth/demo");
  eq(g.json.doors, ["pharmacy", "supplier", "hq"]);
  for (const [d, loc] of [["pharmacy", 2], ["supplier", 598], ["hq", 898]]) {
    const r = await door(app, d);
    eq([r.demo, r.user.location_id, r.user.org_id, r.user.role, r.user.demo_door], [true, loc, 2, "admin", d]);
    const left = Date.parse(r.expires_at) - Date.now();
    ok(left > 7100e3 && left <= 7200e3, "two hours: " + left);
    const me = await app.api("GET", "/auth/me", { token: r.token });
    eq([me.json.user.demo, me.json.user.location_id], [true, loc]);
  }
  eq(app.DB.db.prepare("SELECT org_id FROM locations WHERE id IN (399, 598, 898) ORDER BY id").all().map((x) => x.org_id), [2, 2, 2], "demo places made inside the demo group");
  // nobody can sign in to a demo account with a password
  eq((await app.api("POST", "/auth/login", { body: { email: "visitor.pharmacy@demo.eikon.invalid", password: "" } })).status, 400);
  eq((await app.api("POST", "/auth/login", { body: { email: "visitor.pharmacy@demo.eikon.invalid", password: "Passw0rd!" } })).status, 401);
  // John's own sign-in still works, and is a (guarded) demo-group session
  const j = await app.api("POST", "/auth/login", { body: { email: "john@demo-owner.example", password: "Passw0rd!" } });
  eq(j.status, 200);
  eq((await app.api("GET", "/auth/me", { token: j.json.token })).json.user.demo, true);
  eq((await app.api("POST", "/auth/demo", { body: { door: "nope" } })).status, 404);
  // SU's "next location number" is not moved by the made-up demo places
  app.env.SUPERUSER_EMAILS = "maria@live.example";
  eq((await app.api("GET", "/su/api/overview", { token: w.live })).json.next_location_id, 651);
});

test("demo: no door before the first reset has finished, none after a wipe, back after the next reset", async (app) => {
  const w = await world(app);
  app.DB.db.prepare("DELETE FROM demo_state").run();
  eq((await app.api("GET", "/auth/demo")).json.doors, []);
  eq((await app.api("POST", "/auth/demo", { body: { door: "pharmacy" } })).status, 503);
  app.env.SUPERUSER_EMAILS = "maria@live.example";
  let r; do { r = await app.api("POST", "/su/api/demo/reset", { token: w.live, body: {} }); } while (r.json.ok && !r.json.done);
  eq((await app.api("GET", "/auth/demo")).json.doors, ["pharmacy", "supplier", "hq"]);
  do { r = await app.api("POST", "/su/api/demo/wipe", { token: w.live, body: {} }); } while (r.json.ok && !r.json.done);
  eq([r.json.phase, (await app.api("GET", "/auth/demo")).json.doors], ["wiped", []]);
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM people WHERE location_id = 2").get().c, 0);
  do { r = await app.api("POST", "/su/api/demo/reset", { token: w.live, body: {} }); } while (r.json.ok && !r.json.done);
  eq((await app.api("GET", "/auth/demo")).json.doors.length, 3);
});

test("demo: /auth/demo is rate-limited per address (12 an hour); other addresses still get in", async (app) => {
  await world(app);
  for (let i = 0; i < 12; i++) await door(app, "pharmacy", "198.51.100.1");
  const r = await app.api("POST", "/auth/demo", { body: { door: "pharmacy" }, headers: { "CF-Connecting-IP": "198.51.100.1" } });
  eq(r.status, 429, r.text);
  await door(app, "pharmacy", "198.51.100.2");
});

test("demo guard: accounts, passwords, sending, push, sender keys, calendar secret, bulk and big bodies refused; normal work allowed", async (app) => {
  const w = await world(app);
  const { token } = await door(app);
  const T = (m, p, body) => app.api(m, p, { token, body });
  // accounts and passwords
  eq((await T("POST", "/team/users", { email: "x@y.example", full_name: "X", role: "admin" })).status, 403);
  const tu = await T("GET", "/team/users");
  eq(tu.status, 200, tu.text);
  ok(!tu.text.includes("john@demo-owner.example"), "the real sign-in of the demo pharmacy is not shown to visitors");
  eq((await T("PUT", "/team/users/" + w.john.user.id, { role: "staff" })).status, 403);
  eq((await T("POST", "/auth/change-password", { current_password: "a", new_password: "bbbbbbbbbbbb" })).status, 403);
  eq((await T("POST", "/auth/unlock", { password: "" })).json.ok, true, "the idle lock opens without a password");
  eq((await T("GET", "/su/api/overview")).status, 403);
  eq((await T("POST", "/admin/names/run", {})).status, 403);
  // nothing leaves the sandbox
  const msg = await T("POST", "/messages", { channel: "email", to: "someone@example.com", text: "hi" });
  eq([msg.status, msg.json.error], [403, "Not sent — this is the demo"]);
  eq((await T("POST", "/messages", { channel: "whatsapp", to: "79001101", text: "hi" })).json.not_sent, true);
  eq((await T("POST", "/bookings/senders", { kind: "resend", key: "re_x" })).status, 403);
  eq((await T("POST", "/bookings/senders/1/test", {})).json.error, "Not sent — this is the demo");
  eq((await T("POST", "/rota/push/subscribe", { staff_id: 1, subscription: { endpoint: "https://fcm.googleapis.com/x" } })).json.push, false);
  const bs = await T("PUT", "/bookings/settings", { provider: "resend", apiKey: "re_live", fromEmail: "a@b.example", publicSlug: "borg-pharmacy", address: "Triq il-Kbira" });
  eq(bs.status, 200, bs.text);
  const bset = app.DB.db.prepare("SELECT provider, api_key_enc, public_slug, address FROM bk_settings WHERE location_id = 2").get();
  eq([bset.provider, bset.api_key_enc || "", bset.public_slug || "", bset.address], ["off", "", "", "Triq il-Kbira"], "keys, provider and the public address are not taken; the rest is");
  await T("PUT", "/shifts/settings", { pharmacistRequired: true, calendarToken: "secret-from-the-demo" });
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM shift_calendar_tokens").get().c, 0, "no calendar feed secret made");
  // bulk and size
  const many = Array.from({ length: 51 }, (_, i) => ({ description: "Item " + i }));
  eq((await T("POST", "/supplier-products/bulk-import", { products: many })).status, 403);
  eq((await T("PUT", "/poct/state", { records: [{ id: "x", notes: "x".repeat(300 * 1024) }] })).status, 413);
  // exports and reports of other pharmacies: isolation holds (owner figures, records, overview, audit, registers)
  eq((await T("GET", "/owner/summary?loc=1")).status, 403);
  eq((await T("GET", "/owner/records?kinds=eod&loc=3")).status, 403);
  eq((await T("GET", "/admin/pharmacy-overview")).status, 403);
  const H = await door(app, "hq");
  eq((await app.api("GET", "/owner/summary?loc=3", { token: H.token })).status, 403, "the demo head office cannot name a live pharmacy");
  eq((await app.api("GET", "/owner/summary?loc=1", { token: H.token })).status, 403);
  await app.api("POST", "/daily-register/entries", { token: w.live, body: { entry_date: maltaYmd(0), client_id: "0099999M", client_name: "Live Secret", medicine_name_dose: "Amoxil", posology: "1-1-1", prescriber_name: "Dr Abela", prescriber_reg_no: "R1" } });
  for (const path of ["/daily-register/entries?month=" + maltaYmd(0).slice(0, 7), "/daily-register/report?from=" + maltaYmd(-5) + "&to=" + maltaYmd(0), "/audit/log", "/people?q=Secret", "/today", "/contacts/clients/aggregated"]) {
    let r; try { r = await T("GET", path); } catch (e) { throw new Error(path + ": " + e.message); }
    ok(!r.text.includes("Live Secret") && !r.text.includes("0099999M"), "no live patient in " + path);
  }
  // normal writes work inside the demo pharmacy
  const devs = (await T("GET", "/temperature/devices")).json.devices;
  const te = await T("POST", "/temperature/entries", { device_id: devs[0].id, entry_date: maltaYmd(0), min_temp: 20, max_temp: 23 });
  eq(te.status, 200, te.text);
  eq((await T("POST", "/people", { name: "Borg Joseph", id_card: "0000123M", phone: "79001234" })).status, 200);
  eq(app.DB.db.prepare("SELECT location_id FROM people WHERE id_card LIKE '%123M'").get().location_id, 2);
});

test("demo isolation: board, supplier marketplace, scarce stock, suggestions and supplier orders keep live and demo apart both ways", async (app) => {
  const w = await world(app);
  const P = await door(app, "pharmacy"), S = await door(app, "supplier");
  const A = (t, m, p, body) => app.api(m, p, { token: t, body });
  await A(w.live, "GET", "/board/messages"); // the board's tables are made on first read
  // board: a live "everyone" message is not shown to the demo; a demo "everyone" message is stored for its group only
  await A(w.live, "POST", "/board/messages", { body: "Live note to every pharmacy", scope: "all" });
  await A(P.token, "POST", "/board/messages", { body: "Demo visitor says hi to everyone", scope: "all" });
  eq(app.DB.db.prepare("SELECT scope FROM board_messages WHERE body LIKE 'Demo visitor%'").get().scope, "org");
  for (const path of ["/board/messages", "/board/messages?scope=all", "/board/messages?pinned=1", "/board/dashboard"]) {
    const r = await A(P.token, "GET", path);
    eq(r.status, 200, path + " " + r.text);
    ok(!r.text.includes("Live note"), "demo does not see live board: " + path);
  }
  for (const t of [w.live, w.other]) ok(!(await A(t, "GET", "/board/messages")).text.includes("Demo visitor"), "live does not see demo board");
  ok(!(await A(P.token, "GET", "/board/users/search?q=a")).text.includes("Maria Borg"), "mentions search stays in the demo group");
  const liveMsg = app.DB.db.prepare("SELECT id FROM board_messages WHERE body LIKE 'Live note%'").get().id;
  eq((await A(P.token, "POST", "/board/messages/" + liveMsg + "/pin", {})).status, 404, "a live message cannot be pinned from the demo");
  // supplier marketplace
  await A(w.sup, "POST", "/supplier-products/entries", { description: "Live supplier paracetamol", cost_excl_vat: 1, retail_price: 2 });
  await A(S.token, "POST", "/supplier-products/entries", { description: "Demo distributor ibuprofen", cost_excl_vat: 1, retail_price: 2 });
  const dinv = (await A(P.token, "GET", "/supplier-products/inventory")).json.entries.map((x) => x.description);
  const linv = (await A(w.live, "GET", "/supplier-products/inventory")).json.entries.map((x) => x.description);
  eq([dinv, linv], [["Demo distributor ibuprofen"], ["Live supplier paracetamol"]]);
  ok(!(await A(w.live, "GET", "/supplier-products/changes")).text.includes("Demo distributor"), "stock changes too");
  // supplier orders: never across
  const item = [{ description: "x", qty_requested: 1 }];
  eq((await A(P.token, "POST", "/supplier-orders", { supplier_location_id: 400, items: item })).status, 400, "demo cannot order from a live supplier");
  eq((await A(w.live, "POST", "/supplier-orders", { supplier_location_id: 598, items: item })).status, 400, "live cannot order from the demo distributor");
  const o = await A(P.token, "POST", "/supplier-orders", { supplier_location_id: 598, supplier_name: "Demo Distributor", items: item });
  eq(o.status, 200, o.text);
  eq((await A(w.sup, "GET", "/supplier-orders/received")).json.entries.length, 0, "the live supplier receives nothing from the demo");
  eq((await A(S.token, "GET", "/supplier-orders/received")).json.entries.length, 1);
  eq((await A(w.sup, "GET", "/supplier-orders/" + o.json.id)).status, 404);
  // scarce stock needs (read across every group): apart both ways
  await A(w.live, "POST", "/scarce-stock/needs", { entry_date: maltaYmd(0), item_name: "Live need Mounjaro", quantity_needed: 1 });
  await A(P.token, "POST", "/scarce-stock/needs", { entry_date: maltaYmd(0), item_name: "Demo need Ozempic", quantity_needed: 1 });
  const dn = (await A(P.token, "GET", "/scarce-stock/needs")).text, ln = (await A(w.other, "GET", "/scarce-stock/needs")).text;
  ok(dn.includes("Demo need") && !dn.includes("Live need"), "demo sees its own needs only");
  ok(ln.includes("Live need") && !ln.includes("Demo need"), "live never sees demo needs");
  const liveNeed = app.DB.db.prepare("SELECT id FROM scarce_stock_needs WHERE item_name LIKE 'Live need%'").get().id;
  eq((await A(P.token, "POST", "/scarce-stock/needs/" + liveNeed + "/offers", { quantity_offered: 1 })).status, 404, "demo cannot offer on a live need");
  // board suggestions (read across every group)
  await A(w.live, "POST", "/board/suggestions", { title: "Live idea" });
  await A(P.token, "POST", "/board/suggestions", { title: "Demo idea" });
  const ds = (await A(P.token, "GET", "/board/suggestions")).json.suggestions.map((x) => x.title), ls = (await A(w.other, "GET", "/board/suggestions")).json.suggestions.map((x) => x.title);
  eq([ds, ls], [["Demo idea"], ["Live idea"]]);
  // head office: the demo head office sees the demo pharmacies only; the live head office never sees them
  const H = await door(app, "hq");
  const hs = await A(H.token, "GET", "/owner/summary");
  eq(hs.status, 200, hs.text);
  ok(!hs.text.includes("Borg Pharmacy") && !hs.text.includes("Zammit"), "demo head office: demo pharmacies only");
  const lh = await A(w.ho, "GET", "/owner/summary");
  ok(lh.status === 200 && !lh.text.includes("Demo Pharmacy"), "live head office never sees the demo: " + lh.text.slice(0, 200));
  // e-mail: never from the demo, whatever is set up
  const calls = []; const f0 = globalThis.fetch;
  globalThis.fetch = async (u) => { calls.push(String(u)); return new Response("{}"); };
  try {
    app.DB.db.prepare("INSERT INTO bk_senders (org_id, location_id, kind, label, position, cred_enc, from_email) VALUES (2, 2, 'resend', 'R', 0, 'x', 'a@b.example')").run();
    await A(P.token, "POST", "/bookings/providers", { name: "Maria", kind: "pharmacist", hours: { 1: [["09:00", "12:00"]] } });
  } catch (e) {} finally { globalThis.fetch = f0; }
  eq(calls.filter((u) => /resend|brevo/.test(u)).length, 0);
});

test("demo reset: wipes only the demo group, keeps every live row byte-for-byte, keeps the real sign-in, seeds every section", async (app) => {
  const w = await world(app);
  const A = (t, m, p, body) => app.api(m, p, { token: t, body });
  // live data in many tables, from three live places
  await A(w.live, "GET", "/board/messages");
  for (const t of [w.live, w.other]) {
    const devs = (await A(t, "GET", "/temperature/devices")).json.devices;
    await A(t, "POST", "/temperature/entries", { device_id: devs[0].id, entry_date: maltaYmd(-1), min_temp: 3, max_temp: 7 });
    await A(t, "POST", "/people", { name: "Live Person", id_card: "0099999M", phone: "79999999" });
    await A(t, "POST", "/daily-register/entries", { entry_date: maltaYmd(0), client_id: "0099999M", client_name: "Live Person", medicine_name_dose: "Amoxil", posology: "1-1-1", prescriber_name: "Dr Abela", prescriber_reg_no: "R1" });
    await A(t, "POST", "/board/messages", { body: "Live board", scope: "all" });
    await A(t, "PUT", "/endofday/record", { record: { date: maltaYmd(-1), eod_date: maltaYmd(-1), time_of_day: "PM", staff: "Live", staff_name: "Live", float_amount: "150", x: [{ amount: "100" }], epos: [], cheques: [], paid_outs: [], cash: {}, deposit: {}, notes: "", action: "SAVE" } });
    await A(t, "POST", "/scarce-stock/needs", { entry_date: maltaYmd(0), item_name: "Live need", quantity_needed: 1 });
    await A(t, "POST", "/shifts/staff", { full_name: "Live Staff", designation: "pharmacist" });
  }
  await A(w.sup, "POST", "/supplier-products/entries", { description: "Live product", cost_excl_vat: 1 });
  const lo = await A(w.live, "POST", "/supplier-orders", { supplier_location_id: 400, supplier_name: "Test Supplier", items: [{ description: "Live product", qty_requested: 2 }] });
  eq(lo.status, 200, lo.text);
  // junk the visitors left in the demo
  const P = await door(app);
  await A(P.token, "POST", "/people", { name: "Mouse Mickey", id_card: "0000001M", phone: "79000000" });
  await A(P.token, "POST", "/board/messages", { body: "visitor junk" });
  // John signs in to the demo pharmacy with his password: his session must survive the reset
  const john = await app.api("POST", "/auth/login", { body: { email: "john@demo-owner.example", password: "Passw0rd!" } });
  const before = liveSnapshot(app.DB);
  const liveItems = JSON.stringify(app.DB.db.prepare("SELECT * FROM supplier_order_items WHERE order_id = ?").all(lo.json.id));
  app.env.SUPERUSER_EMAILS = "maria@live.example";
  let r, n = 0;
  do { r = await A(w.live, "POST", "/su/api/demo/reset", {}); eq(r.status, 200, r.text); n++; } while (!r.json.done && n < 20);
  ok(r.json.done, "reset finished: " + r.text);
  eq(r.json.problems, [], "every seed call answered 2xx");
  eq(r.json.skipped.filter((t) => !["sync_jobs"].includes(t)), [], "every table with no group column is known");
  const after = liveSnapshot(app.DB);
  for (const t of Object.keys(before)) eq(after[t], before[t], "live rows of " + t + " unchanged");
  eq(JSON.stringify(app.DB.db.prepare("SELECT * FROM supplier_order_items WHERE order_id = ?").all(lo.json.id)), liveItems, "live order lines unchanged");
  eq((await app.api("GET", "/auth/me", { token: john.json.token })).status, 200, "the real sign-in of the demo pharmacy keeps its session");
  eq((await app.api("GET", "/auth/me", { token: P.token })).status, 401, "visitors' sessions end with the reset");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM people WHERE id_card = '0000001M'").get().c, 0, "visitor junk gone");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.eikon.invalid')").get().c, 0, "the seeding sessions are gone too");
  // every section has its 2-3 items
  const cnt = (t, where = "location_id = 2") => app.DB.db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE ${where}`).get().c;
  const want = { people: 8, temperature_entries: 11, cleaning_entries: 3, daily_register_entries: 3, dda_purchases_entries: 2, dda_sales_entries: 2, dda_poyc_entries: 2, dda_stocktakes: 1,
    locum_register_entries: 2, locum_receipts: 2, client_orders_entries: 3, client_tickets_entries: 2, client_deliveries: 2, repeat_prescription_entries: 2, near_expiry_entries: 3, returns_entries: 2,
    alerts_entries: 1, order_diary_entries: 3, scarce_stock_offers: 1, scarce_stock_needs: 1, stock_transfer_items: 2, bk_services: 2, bk_bookings: 4, poct_records: 3, screening_campaigns: 1,
    vaccines_stock: 2, vaccinations: 3, pv_reports: 2, label_history: 3, end_of_day: 3, paid_out_entries: 3, pos_sales: 2, credit_notes: 2, shift_staff: 4, shift_leaves: 2, board_messages: 2, register_last_inspection: 1 };
  for (const [t, c] of Object.entries(want)) eq([t, cnt(t)], [t, c]);
  ok(cnt("shift_assignments") >= 12, "this week's rota: " + cnt("shift_assignments"));
  ok(cnt("instructions_daily") === 1 && JSON.parse(app.DB.db.prepare("SELECT handover_json FROM instructions_daily WHERE location_id = 2").get().handover_json).length === 3, "handover");
  ok(app.DB.db.prepare("SELECT COUNT(*) AS c FROM certificates_items WHERE location_id = 2 AND COALESCE(last_date, '') != ''").get().c >= 2, "certificates dated");
  eq([cnt("end_of_day", "location_id = 399"), cnt("daily_register_entries", "location_id = 399")], [3, 2], "second pharmacy");
  eq([cnt("supplier_products", "location_id = 598"), cnt("supplier_orders", "supplier_location_id = 598"), cnt("supplier_order_item_feedback", "supplier_location_id = 598")], [4, 3, 1], "distributor");
  ok(app.DB.db.prepare("SELECT name FROM people WHERE location_id = 2").all().every((x) => !/[ċġħżĊĠĦŻ]/.test(x.name.split(" ")[0])), "no Maltese letters in surnames");
  // the distributor and head office screens read it
  const S = await door(app, "supplier"), H = await door(app, "hq");
  eq((await A(S.token, "GET", "/supplier-orders/received")).json.entries.length, 3);
  const ov = await A(H.token, "GET", "/admin/pharmacy-overview");
  eq(ov.status, 200, ov.text);
  ok(ov.text.includes("Demo Pharmacy") && ov.text.includes("Demo Pharmacy Sliema") && !ov.text.includes("Borg Pharmacy"), "head office overview: the two demo pharmacies");
  // a second reset gives the same demo, not twice as much
  do { r = await A(w.live, "POST", "/su/api/demo/reset", {}); } while (!r.json.done);
  for (const [t, c] of Object.entries(want)) eq([t, cnt(t)], [t, c], "again");
  const again = liveSnapshot(app.DB);
  for (const t of Object.keys(before)) eq(again[t], before[t], "live rows of " + t + " unchanged after a second reset");
  // staff and visitors cannot reset
  eq((await A(P.token, "POST", "/su/api/demo/reset", {})).status, 401);
  eq((await A(w.other, "POST", "/su/api/demo/reset", {})).status, 403);
});

test("demo reset: refuses to wipe when the demo group has a location it does not know, or the demo pharmacy is in another group", async (app) => {
  const w = await world(app);
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (7, 2, 'Someone real')").run();
  app.DB.db.prepare("INSERT INTO temperature_devices (org_id, location_id, name) VALUES (2, 7, 'Real fridge')").run();
  app.env.SUPERUSER_EMAILS = "maria@live.example";
  const r = await app.api("POST", "/su/api/demo/reset", { token: w.live, body: {} });
  eq(r.status, 409, r.text);
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM temperature_devices WHERE location_id = 7").get().c, 1);
  app.env.DEMO_LOCATION_ID = "3"; // a live pharmacy of group 3
  eq((await app.api("POST", "/su/api/demo/reset", { token: w.live, body: {} })).status, 409);
  app.env.DEMO_LOCATION_ID = "2"; app.env.DEMO_SUPPLIER_LOCATION_ID = "400"; // a live supplier: that door stays shut, never touched
  app.DB.db.prepare("DELETE FROM locations WHERE id = 7").run();
  app.DB.db.prepare("DELETE FROM temperature_devices WHERE location_id = 7").run();
  let x; do { x = await app.api("POST", "/su/api/demo/reset", { token: w.live, body: {} }); } while (x.json && x.json.ok && !x.json.done);
  eq(app.DB.db.prepare("SELECT org_id, name FROM locations WHERE id = 400").get(), { org_id: 400, name: "Test Supplier" });
  eq((await app.api("GET", "/auth/demo")).json.doors, ["pharmacy", "hq"]);
});

test("demo nightly: the 10-minute cron resets once per Malta day from 03:00, carries on across runs, bounded per run", async (app) => {
  await world(app);
  const run = async (when, extra = {}) => { let p; await app.worker.scheduled({}, { ...app.env, DEMO_TEST_NOW: when, ...extra }, { waitUntil(x) { p = x; } }); await p; };
  const st = () => { try { return JSON.parse(app.DB.db.prepare("SELECT v FROM demo_state WHERE k = 'reset'").get().v); } catch (e) { return {}; } };
  await run("2026-11-12 02:50");
  eq(st().running, undefined, "not before 03:00");
  await run("2026-11-12 03:00", { DEMO_RESET_STEPS: "5" });
  ok(st().running === true, "started, not finished in 5 steps");
  for (let i = 0; i < 60 && st().running; i++) await run("2026-11-12 03:10", { DEMO_RESET_STEPS: "5" });
  eq([st().running, st().last_day], [false, "2026-11-12"]);
  const people = () => app.DB.db.prepare("SELECT COUNT(*) AS c FROM people WHERE location_id = 2").get().c;
  eq(people(), 8);
  app.DB.db.prepare("DELETE FROM people WHERE location_id = 2").run();
  await run("2026-11-12 04:00");
  eq(people(), 0, "once a day only");
  await run("2026-11-13 14:00");
  eq(people(), 0, "not in the afternoon (a deploy at 14:00 does not wipe the visitors' work)");
  // the next night, with the default budget: every run stays well under D1's 1,000 queries per invocation
  let n = 0; const p0 = app.DB.prepare.bind(app.DB), b0 = app.DB.batch.bind(app.DB), most = [];
  app.DB.prepare = (sql) => { n++; return p0(sql); }; app.DB.batch = (a) => { n += a.length; return b0(a); };
  try { for (let i = 0; i < 12 && (i === 0 || st().running); i++) { n = 0; await run("2026-11-13 03:" + String(5 + i * 10 % 50).padStart(2, "0")); most.push(n); } }
  finally { app.DB.prepare = p0; app.DB.batch = b0; }
  ok(st().running === false && st().last_day === "2026-11-13" && people() === 8, "the next night, in " + most.length + " runs");
  ok(most.length > 1 && Math.max(...most) < 800, "bounded per run: " + most.join(", ") + " queries");
});

test("demo guard: privacy — a demo session never exports or erases a person, undoes an erase or downloads the records (nothing written)", async (app) => {
  const w = await world(app);
  const P = await door(app);
  const mk = await app.api("POST", "/people", { token: P.token, body: { name: "Borg Maria", id_card: "0000456M", phone: "79004567", email: "maria@example.com" } });
  eq(mk.status, 200, mk.text);
  const pid = mk.json.person.id;
  const person0 = JSON.stringify(app.DB.db.prepare("SELECT * FROM people WHERE id = ?").get(pid));
  const audit0 = app.DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;
  for (const token of [P.token, w.john.token]) { // the visitor (an admin of the demo pharmacy) and the demo group's real sign-in
    for (const [m, p, body] of [["POST", "/people/" + pid + "/export", {}], ["GET", "/people/" + pid + "/export", undefined], ["POST", "/people/" + pid + "/erase", {}],
      ["POST", "/people/" + pid + "/erase", { confirm: true, plan: "x" }], ["POST", "/people/erasures/gdpr_00000000-0000-0000-0000-000000000000/undo", {}],
      ["GET", "/export/records?part=customers", undefined], ["GET", "/export/records?part=bookings&from=2026-01-01&to=2026-12-31", undefined]]) {
      const r = await app.api(m, p, { token, body });
      eq([m + " " + p, r.status, r.json && r.json.demo], [m + " " + p, 403, true], r.text.slice(0, 200));
    }
  }
  eq(JSON.stringify(app.DB.db.prepare("SELECT * FROM people WHERE id = ?").get(pid)), person0, "the person is unchanged");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'gdpr_erasures'").get().c, 0, "no erasure table made, nothing erased");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'PERSON_E%'").get().c, 0, "no export or erase audited");
  ok(app.DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c >= audit0, "audit untouched otherwise");
  // live pharmacies are not affected by the guard
  const lp = (await app.api("POST", "/people", { token: w.live, body: { name: "Live Person", id_card: "0099999M", phone: "79999999" } })).json.person;
  eq((await app.api("POST", "/people/" + lp.id + "/export", { token: w.live, body: {} })).status, 200, "a live admin still exports");
});

test("demo reset: the privacy tables (gdpr_erasures, gdpr_erasure_rows) lose only the demo's rows; live erasures and their undo copies stay byte for byte", async (app) => {
  const w = await world(app);
  // a live erasure with its undo copies
  const lp = (await app.api("POST", "/people", { token: w.live, body: { name: "Live Person", id_card: "0099999M", phone: "79999999", email: "live@example.com" } })).json.person;
  const pre = (await app.api("POST", "/people/" + lp.id + "/erase", { token: w.live, body: {} })).json;
  const er = await app.api("POST", "/people/" + lp.id + "/erase", { token: w.live, body: { confirm: true, plan: pre.plan } });
  eq(er.status, 200, er.text.slice(0, 200));
  // demo rows in both tables (as if left from before the guard)
  app.DB.db.prepare("INSERT INTO gdpr_erasures (erasure_id, org_id, location_id, person_id, undo_until) VALUES ('gdpr_demo', 2, 2, 1, datetime('now', '+1 day'))").run();
  app.DB.db.prepare("INSERT INTO gdpr_erasure_rows (erasure_id, org_id, location_id, table_name, row_id, column_name, old_value, new_value) VALUES ('gdpr_demo', 2, 2, 'people', 1, 'name', 'Demo Old', 'Erased person #1')").run();
  app.DB.db.prepare("INSERT INTO gdpr_erasure_rows (erasure_id, org_id, location_id, table_name, row_id, column_name, old_value, new_value) VALUES ('gdpr_demo', 2, 399, 'people', 2, 'name', 'Demo Old 2', 'Erased person #2')").run();
  const live = () => JSON.stringify([app.DB.db.prepare("SELECT * FROM gdpr_erasures WHERE org_id = 1 ORDER BY rowid").all(), app.DB.db.prepare("SELECT * FROM gdpr_erasure_rows WHERE org_id = 1 ORDER BY rowid").all()]);
  const live0 = live();
  ok(app.DB.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasure_rows WHERE org_id = 1").get().c > 0, "the live erasure keeps undo copies");
  const before = liveSnapshot(app.DB);
  app.env.SUPERUSER_EMAILS = "maria@live.example";
  let r, n = 0;
  do { r = await app.api("POST", "/su/api/demo/reset", { token: w.live, body: {} }); eq(r.status, 200, r.text); n++; } while (!r.json.done && n < 20);
  ok(r.json.done, r.text);
  eq(r.json.skipped.filter((t) => /^gdpr_/.test(t)), [], "both privacy tables are in the wipe plan");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasures WHERE org_id = 2").get().c + app.DB.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasure_rows WHERE org_id = 2").get().c, 0, "the demo's privacy rows are gone");
  eq(live(), live0, "live erasures and undo copies byte for byte");
  const after = liveSnapshot(app.DB);
  for (const t of Object.keys(before)) eq(after[t], before[t], "live rows of " + t + " unchanged");
  const u = await app.api("POST", "/people/erasures/" + er.json.erasure_id + "/undo", { token: w.live, body: {} });
  eq(u.status, 200, "the live undo still works: " + u.text.slice(0, 200));
  eq(app.DB.db.prepare("SELECT name FROM people WHERE id = ?").get(lp.id).name, "Live Person");
});

// Finish round (integrator, batch-20): roles, records, dayzero and portals added tables and routes; the demo guard and the
// reset cover them.
test("demo guard: roles — a visitor cannot add a pharmacist or an admin, change anyone's rights or role, or link the rota to a sign-in (nothing written)", async (app) => {
  const w = await world(app);
  const P = await door(app);
  const T = (m, p, body) => app.api(m, p, { token: P.token, body });
  const st = await T("POST", "/shifts/staff", { full_name: "Karl Vella", designation: "assistant" });
  eq(st.status, 200, st.text);
  const sid = st.json.id || st.json.staff_id || (st.json.staff && st.json.staff.id);
  ok(sid, "rota person made: " + st.text);
  const users0 = JSON.stringify(app.DB.db.prepare("SELECT * FROM users ORDER BY id").all());
  const staff0 = JSON.stringify(app.DB.db.prepare("SELECT * FROM shift_staff ORDER BY id").all());
  for (const [m, p, body] of [
    ["POST", "/team/users", { email: "ph@x.example", full_name: "Anna Pharm", role: "pharmacist", password: "Passw0rd!Passw0rd" }],
    ["POST", "/team/users", { email: "ad@x.example", full_name: "Second Admin", role: "admin", password: "Passw0rd!Passw0rd" }],
    ["POST", "/team/users/" + w.john.user.id + "/rights", { is_pharmacist: true, plans_rota: false }],
    ["POST", "/team/users/" + w.john.user.id + "/role", { role: "staff" }],
    ["POST", "/team/users/" + P.user.id + "/rights", { is_pharmacist: true }],
    ["POST", "/shifts/staff/" + sid + "/link", { user_id: w.john.user.id }],
    ["POST", "/shifts/staff/" + sid + "/link", { user_id: P.user.id }]]) {
    const r = await T(m, p, body);
    eq([m + " " + p, r.status, r.json && r.json.demo], [m + " " + p, 403, true], r.text.slice(0, 200));
  }
  eq(JSON.stringify(app.DB.db.prepare("SELECT * FROM users ORDER BY id").all()), users0, "no sign-in added or changed");
  eq(JSON.stringify(app.DB.db.prepare("SELECT * FROM shift_staff ORDER BY id").all()), staff0, "no rota row linked");
  const me = await T("GET", "/team/me");
  eq(me.status, 200, me.text);
  eq((await T("GET", "/shifts/staff")).status, 200, "the rota still reads");
  // a live admin is not affected by the guard
  const lst = await app.api("POST", "/shifts/staff", { token: w.live, body: { full_name: "Live Karl", designation: "assistant" } });
  const lid = lst.json.id || lst.json.staff_id || (lst.json.staff && lst.json.staff.id);
  eq((await app.api("POST", "/shifts/staff/" + lid + "/link", { token: w.live, body: { user_id: 1 } })).status, 200, "a live admin still links");
});

test("demo reset: finish-round tables (partials, balance warnings, credit-note numbers, pharmacy details) lose only the demo's rows; seed has details and one open partial; demo head office stock sees only demo pharmacies", async (app) => {
  const w = await world(app);
  const today = maltaYmd(0);
  const line = (q, serial) => ({ entry_date: today, client_name: "Live Person", client_id_card: "0099999M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg tablets", quantity: q, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: serial });
  const L = (m, p, body) => app.api(m, p, { token: w.live, body });
  // live rows in every new table
  eq((await L("PUT", "/pharmacy/details", { name: "Borg Pharmacy", address: "5, Triq San Pawl, Sliema", phone: "", licence: "" })).status, 200);
  const s = await L("POST", "/dda-sales/entries", { ...line(2, "L-1"), balance_warning: { balance: 0, after: -2, since: today, counted: 0 } });
  eq(s.status, 200, s.text);
  eq((await L("POST", "/dda-partials", { register: "sales", entry_id: s.json.entry_id, prescribed: 10 })).status, 200);
  const cn = await L("POST", "/creditnotes/entries", { issue_date: today, client_name: "Live", client_surname: "Person", telephone: "79999999", email: "", receipt_number: "R-1", amount: 5, expiry_date: "", no_expiry: 1 });
  eq(cn.status, 200, cn.text);
  // visitor junk in the same tables
  const P = await door(app);
  const V = (m, p, body) => app.api(m, p, { token: P.token, body });
  const vs = await V("POST", "/dda-sales/entries", { ...line(1, "V-1"), balance_warning: { balance: 0, after: -1, since: today, counted: 0 } });
  eq(vs.status, 200, vs.text);
  eq((await V("POST", "/dda-partials", { register: "sales", entry_id: vs.json.entry_id, prescribed: 99 })).status, 200);
  for (let i = 0; i < 3; i++) await V("POST", "/creditnotes/entries", { issue_date: today, client_name: "Visitor", client_surname: String(i), telephone: "79000000", email: "", receipt_number: "V", amount: 1, expiry_date: "", no_expiry: 1 });
  eq((await V("PUT", "/pharmacy/details", { name: "Visitor's name", address: "Somewhere", phone: "", licence: "" })).status, 200, "the demo pharmacy's details are sandbox data (reset nightly)");
  const NEW = ["dda_partials", "dda_partial_parts", "dda_balance_warnings", "credit_note_seq", "label_settings"];
  const liveRows = () => JSON.stringify(NEW.map((t) => app.DB.db.prepare(`SELECT * FROM ${t} WHERE org_id <> 2 ORDER BY rowid`).all()));
  const live0 = liveRows();
  ok(NEW.every((t) => app.DB.db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE org_id = 1`).get().c > 0), "live rows in every new table");
  const before = liveSnapshot(app.DB);
  app.env.SUPERUSER_EMAILS = "maria@live.example";
  let r, n = 0;
  do { r = await L("POST", "/su/api/demo/reset", {}); eq(r.status, 200, r.text); n++; } while (!r.json.done && n < 20);
  ok(r.json.done, r.text);
  eq(r.json.problems, [], "every seed call answered 2xx");
  eq(r.json.skipped.filter((t) => NEW.includes(t)), [], "every new table is in the wipe plan");
  eq(liveRows(), live0, "live rows of the new tables byte for byte");
  const after = liveSnapshot(app.DB);
  for (const t of Object.keys(before)) eq(after[t], before[t], "live rows of " + t + " unchanged");
  const one = (sql) => app.DB.db.prepare(sql).get();
  eq(one("SELECT COUNT(*) AS c FROM dda_partials WHERE location_id = 2 AND prescribed = 99").c, 0, "visitor's partial gone");
  eq(one("SELECT COUNT(*) AS c FROM dda_balance_warnings WHERE org_id = 2").c, 0, "visitor's warnings gone (the seed stays within stock)");
  eq(one("SELECT COUNT(*) AS c FROM dda_partials WHERE location_id = 2").c, 1, "the seed's one open partial");
  const ps = await door(app);
  const pl = await app.api("GET", "/dda-partials?register=sales", { token: ps.token });
  eq(pl.status, 200, pl.text);
  ok(pl.text.includes("Morphine 10mg tablets"), "the partial lists: " + pl.text.slice(0, 200));
  const det = await app.api("GET", "/pharmacy/details", { token: ps.token });
  eq([det.json.saved, det.json.details.address], [true, "1, Triq il-Kbira, Birkirkara"], "seeded details replace the visitor's");
  const cnl = app.DB.db.prepare("SELECT cn_no FROM credit_notes WHERE location_id = 2 ORDER BY id").all().map((x) => x.cn_no);
  eq(cnl, [1, 2], "the demo's credit notes number from 1 again; live numbers unchanged");
  // the demo head office's stock read names only the demo's pharmacies
  const H = await door(app, "hq");
  const hs = await app.api("GET", "/hq/stock", { token: H.token });
  eq(hs.status, 200, hs.text);
  const names = hs.json.pharmacies.map((x) => x.name).sort();
  ok(names.length === 2 && !names.some((x) => /Borg|Zammit/.test(x)), "demo pharmacies only: " + names.join(", "));
});
