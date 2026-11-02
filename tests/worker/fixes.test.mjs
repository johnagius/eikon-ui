// Regression tests for the live defects fixed on the current code base.
import { test, eq, ok } from "./lib.mjs";

const eodRec = (over = {}) => ({
  eod_date: "2026-10-30", time_of_day: "PM", staff_name: "Maria", float_amount: 500,
  x: [{ amount: "100.00" }], epos: [], cheques: [], paid_outs: [], cash: {}, bov_deposit: {}, bov_bag_number: "", notes: "", ...over
});

test("iCal: an unknown token with debug=1 no longer lists other pharmacies' tokens", async ({ api, bootstrap, DB }) => {
  await bootstrap();
  DB.db.exec(`CREATE TABLE IF NOT EXISTS shift_calendar_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER, location_id INTEGER, token TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')));`);
  DB.db.prepare("INSERT INTO shift_calendar_tokens (org_id, location_id, token) VALUES (1, 1, 'SECRET-TOKEN-ABC')").run();
  const r = await api("GET", "/shifts/ical?token=bogus&debug=1");
  eq(r.status, 404);
  ok(!r.text.includes("SECRET-TOKEN-ABC"), "token must not appear in the response");
  ok(!r.text.includes("tokenTableSample"), "no diagnostics dump");
  const r2 = await api("GET", "/shifts/ical?token=bogus", { headers: { Accept: "application/json" } });
  eq(r2.status, 404);
  ok(!r2.text.includes("SECRET-TOKEN-ABC"));
});

test("end of day: a new day saves with an empty bag number (was a 500)", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const s = await api("PUT", "/endofday/record", { token, body: { record: eodRec() } });
  eq(s.status, 200, s.text);
});

test("end of day: a stale save with locked_at '' cannot unlock a locked day", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  eq((await api("PUT", "/endofday/record", { token, body: { record: eodRec() } })).status, 200);
  const lock = await api("PUT", "/endofday/record", { token, body: { record: eodRec({ locked_at: new Date().toISOString(), action: "LOCK" }) } });
  eq(lock.status, 200, lock.text);
  ok(DB.one("SELECT locked_at FROM end_of_day").locked_at, "locked");
  // PC B loaded the day before it was locked and presses Save: payload carries locked_at:""
  const stale = await api("PUT", "/endofday/record", { token, body: { record: eodRec({ notes: "overwrite attempt", locked_at: "" }) } });
  eq(stale.status, 409, "stale save refused: " + stale.text);
  ok(DB.one("SELECT locked_at FROM end_of_day").locked_at, "still locked");
  eq(DB.one("SELECT notes FROM end_of_day").notes, "", "figures untouched");
  // Same with locked_at: null and with no locked_at at all
  eq((await api("PUT", "/endofday/record", { token, body: { record: eodRec({ locked_at: null }) } })).status, 409);
  eq((await api("PUT", "/endofday/record", { token, body: { record: eodRec() } })).status, 409);
  // An explicit unlock still works and is audited
  const un = await api("PUT", "/endofday/record", { token, body: { record: eodRec({ locked_at: "", unlock: true, action: "UNLOCK" }) } });
  eq(un.status, 200, un.text);
  ok(!DB.one("SELECT locked_at FROM end_of_day").locked_at, "unlocked");
  ok(DB.one("SELECT 1 AS x FROM audit_log WHERE action='EOD_UNLOCK'"), "unlock audited");
});

test("logout revokes the session on the server", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  eq((await api("GET", "/auth/me", { token })).status, 200);
  const out = await api("POST", "/auth/logout", { token });
  eq(out.status, 200, out.text);
  eq((await api("GET", "/auth/me", { token })).status, 401, "token no longer valid");
});

test("logout purges expired sessions", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  DB.db.prepare("INSERT INTO sessions (user_id, token_hash_b64, expires_at) VALUES (1, 'old', '2020-01-01T00:00:00.000Z')").run();
  await api("POST", "/auth/logout", { token });
  eq(DB.q("SELECT COUNT(*) AS c FROM sessions")[0].c, 0);
});

test("warehouse short-expiry upload is refused for a pharmacy login and allowed for the warehouse", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const items = [{ stk_code: "A1", stk_desc: "Paracetamol 500", batch: "B1", expiry: "2026/12", qty: 10, loc_code: "WSL" }];
  const r = await api("POST", "/cherubino/short-expiry/upload", { token, body: { items, wipe: true } });
  eq(r.status, 403, r.text);
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (600, 1, 'Warehouse')").run();
  const wh = await addUser({ locationId: 600, email: "wh@example.com", name: "Warehouse" });
  const r2 = await api("POST", "/cherubino/short-expiry/upload", { token: wh.token, body: { items, wipe: true } });
  eq(r2.status, 200, r2.text);
  eq(r2.json.inserted, 1);
});

test("Cherubino OOS: Keep keeps, Reject only removes a pending proposal", async ({ api, bootstrap, addUser, DB }) => {
  const { token: pharmacy } = await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (600, 1, 'Head office')").run();
  const admin = await addUser({ locationId: 600, email: "ho@example.com", name: "Head office" });
  // Branch proposes an item -> pending
  const add = await api("POST", "/cherubino/oos", { token: pharmacy, body: { description: "Enalapril 20mg" } });
  eq(add.status, 200, add.text);
  const id = DB.one("SELECT id, status FROM cherubino_oos").id;
  eq(DB.one("SELECT status FROM cherubino_oos").status, "pending");
  // Admin approves -> active
  eq((await api("PUT", "/cherubino/oos/" + id, { token: admin.token, body: { action: "approve" } })).status, 200);
  eq(DB.one("SELECT status FROM cherubino_oos").status, "active");
  // Branch reports back in stock
  eq((await api("PUT", "/cherubino/oos/" + id, { token: pharmacy, body: { action: "mark_back_in_stock" } })).status, 200);
  eq(DB.one("SELECT status FROM cherubino_oos").status, "back_in_stock");
  // Admin presses Keep OOS -> row stays, active again
  const keep = await api("PUT", "/cherubino/oos/" + id, { token: admin.token, body: { action: "keep" } });
  eq(keep.status, 200, keep.text);
  eq(DB.one("SELECT status FROM cherubino_oos").status, "active");
  // Reject on a non-pending row is refused
  eq((await api("PUT", "/cherubino/oos/" + id, { token: admin.token, body: { action: "reject" } })).status, 400);
  eq(DB.q("SELECT COUNT(*) AS c FROM cherubino_oos")[0].c, 1, "still there");
  // Reject on a fresh pending proposal deletes it
  await api("POST", "/cherubino/oos", { token: pharmacy, body: { description: "Metformin 850" } });
  const pend = DB.one("SELECT id FROM cherubino_oos WHERE status='pending'").id;
  eq((await api("PUT", "/cherubino/oos/" + pend, { token: admin.token, body: { action: "reject" } })).status, 200);
  eq(DB.q("SELECT COUNT(*) AS c FROM cherubino_oos")[0].c, 1);
});

test("client orders: one range call returns the same rows as the month calls, and ranges are capped", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  for (const d of ["2025-12-30", "2026-01-15", "2026-11-02"]) {
    const r = await api("POST", "/client-orders/entries", { token, body: { order_date: d, client_name: "C " + d, client_phone: "79000000", items_text: "Item" } });
    eq(r.status < 300, true, r.text);
  }
  const range = await api("GET", "/client-orders/entries?from=2025-01-01&to=2027-01-01", { token });
  eq(range.status, 200, range.text);
  eq(range.json.entries.length, 3);
  eq((await api("GET", "/client-orders/entries?month=2026-01", { token })).json.entries.length, 1, "month calls still work");
  eq((await api("GET", "/client-orders/entries?from=2020-01-01&to=2027-01-01", { token })).status, 400, "more than 4 years is refused");
  eq((await api("GET", "/client-orders/entries", { token })).status, 400);
});

test("credit notes: more than 100 notes still list (lookups are batched under D1's 100-parameter limit)", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  eq((await api("GET", "/creditnotes/list", { token })).status, 200); // creates the tables
  const ins = DB.db.prepare("INSERT INTO credit_notes (org_id, location_id, issue_date, client_name, client_surname, telephone, receipt_number, amount, expiry_date, no_expiry) VALUES (1, 1, '2026-10-01', ?, 'X', '79000000', ?, 5, '2027-10-01', 0)");
  for (let i = 0; i < 150; i++) ins.run("Client " + i, "R" + i);
  const prep = DB.prepare.bind(DB);
  DB.prepare = (sql) => { const st = prep(sql); const bind = st.bind.bind(st); st.bind = (...a) => { if (a.length > 100) throw new Error("too many SQL variables"); return bind(...a); }; return st; };
  const r = await api("GET", "/creditnotes/list", { token });
  DB.prepare = prep;
  eq(r.status, 200, r.text.slice(0, 200));
  const list = r.json.entries || r.json.notes || r.json.items || r.json.creditNotes || [];
  eq(list.length, 150);
});

test("ui files: build-stamped scripts are cacheable for a day; index.html and unstamped files stay short", async () => {
  const { makeApp } = await import("./harness.mjs");
  const app = await makeApp({ env: { UI_CACHE_SECONDS: "300" } });
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => /raw\.githubusercontent\.com/.test(String(u)) ? new Response("x") : orig(u);
  try {
    const cc = async (p) => (await app.raw("GET", p)).headers.get("cache-control");
    eq(await cc("/ui/core.js?v=2026-11-02.11"), "public, max-age=86400");
    eq(await cc("/ui/core.js?v=1730000000000"), "public, max-age=300", "Date.now() stamps are not build stamps");
    eq(await cc("/ui/index.html?v=2026-11-02.11"), "public, max-age=300", "the page itself always stays short");
    eq(await cc("/ui/core.js"), "public, max-age=300");
  } finally { globalThis.fetch = orig; }
});

test("ui files: with UI_CACHE_SECONDS=0 (production), stamped files are still cached; the page and unstamped files are not", async () => {
  const { makeApp } = await import("./harness.mjs");
  const app = await makeApp({ env: { UI_CACHE_SECONDS: "0" } });
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => /raw\.githubusercontent\.com/.test(String(u)) ? new Response("x") : orig(u);
  try {
    const cc = async (p) => (await app.raw("GET", p)).headers.get("cache-control");
    eq(await cc("/ui/core.js?v=2026-11-02.20"), "public, max-age=86400");
    eq(await cc("/ui/index.html?v=2026-11-02.20"), "no-store");
    eq(await cc("/ui/core.js"), "no-store");
  } finally { globalThis.fetch = orig; }
});

test("debug mode: saving a certificate or a temperature device with the debug header answers, it no longer crashes after saving", async () => {
  const { makeApp } = await import("./harness.mjs");
  const app = await makeApp();
  const { token } = await app.bootstrap();
  const items = (await app.api("GET", "/certificates/items", { token })).json.items;
  const r = await app.api("PUT", "/certificates/items/" + items[0].id, { token, body: { last_date: "2026-01-10", interval_months: 12 }, headers: { "X-Eikon-Debug": "1" } });
  eq(r.status, 200, r.text);
  const devs = (await app.api("GET", "/temperature/devices", { token })).json.devices;
  if (devs.length) {
    const d = devs[0];
    const r2 = await app.api("PUT", "/temperature/devices/" + d.id, { token, body: { name: d.name, device_type: d.device_type, min_limit: d.min_limit, max_limit: d.max_limit, active: 1 }, headers: { "X-Eikon-Debug": "1" } });
    eq(r2.status, 200, r2.text);
  }
});

test("updates never turn a stored NULL into the text 'null' (no String(x !== undefined ? x : existing.x) left)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../cloudflare-worker/code", import.meta.url), "utf8");
  const bad = src.match(/String\((body|b)\.(\w+) !== undefined \? \1\.\2 : (existing|cur|prev|row)\.\w+\)/g) || [];
  eq(bad, [], "every kept field falls back to an empty string, not String(null)");
});
