// Bulk routes write many rows per statement, so each one stays inside D1's limits at its maximum size: at most
// 100 bound parameters per statement, and a few hundred statements per request instead of one (or two) per row.
// Before: a 5,000-row supplier import ran 10,000-15,000 statements (5,001 in one batch), a 500-row contacts import
// 504, a 500-product POS batch ~520, a 500-item short-expiry batch ~500, a 10-year shift pattern ~3,100 and
// 1,000 end-of-day contacts ~2,000.
// (Named to load last: ensureContactsSchema keeps a module-level "done" flag, so once a test has used the contacts
// routes a later test's fresh database never gets those tables; isolation.test.mjs needs them made for it.)
import { test, eq, ok } from "./lib.mjs";

// Counts the D1 statements a request runs (each statement inside env.DB.batch counts once) and refuses, as D1
// does, a statement with more than 100 bound parameters.
function countStatements(DB) {
  const st = { n: 0, inBatch: false, maxParams: 0, batches: [] };
  const proto = Object.getPrototypeOf(DB.prepare("SELECT 1"));
  const saved = {};
  for (const m of ["first", "all", "run", "raw"]) {
    saved[m] = proto[m];
    proto[m] = function (...a) {
      if (!st.inBatch) st.n++;
      st.maxParams = Math.max(st.maxParams, this.params.length);
      if (this.params.length > 100) throw new Error("too many SQL variables (" + this.params.length + ")");
      return saved[m].apply(this, a);
    };
  }
  const batch = DB.batch;
  DB.batch = async function (s) { st.n += s.length; st.batches.push(s.length); st.inBatch = true; try { return await batch.call(this, s); } finally { st.inBatch = false; } };
  st.restore = () => { Object.assign(proto, saved); DB.batch = batch; };
  return st;
}
async function measured(DB, fn) {
  const c = countStatements(DB);
  try { const r = await fn(); return { r, n: c.n, maxParams: c.maxParams, batches: c.batches }; } finally { c.restore(); }
}
const range = (n) => Array.from({ length: n }, (_, i) => i);
const prod = (i, fam) => ({ description: fam + " product " + i, stock_code: "SC" + i, barcode: String(5000000000000 + i), cost_excl_vat: (i % 977) / 7,
  cost_incl_vat: (i % 977) / 6, vat_rate: [18, 5, 0][i % 3], discount_pct: i % 4, discount_euro: (i % 5) / 3, qty_purchased: 1 + (i % 4), qty_free: i % 2,
  batch: "B" + i, expiry_date: "2027-0" + (1 + (i % 9)), retail_price: (i % 911) / 3.3 });

test("bulk: a 5,000-row supplier import is one atomic batch of a few hundred statements, and every row and stock change is stored", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const first = await measured(DB, () => api("POST", "/supplier-products/bulk-import", { token, body: { rows: range(5000).map((i) => prod(i, "Alpha")) } }));
  eq(first.r.status, 200, first.r.text);
  eq([first.r.json.imported, first.r.json.changes], [5000, 5000]);
  ok(first.maxParams <= 100, "max bound parameters " + first.maxParams);
  ok(first.batches[0] < 400, "the replace batch has " + first.batches[0] + " statements (was 5,001)");
  ok(first.n < 600, "first import ran " + first.n + " statements (was 10,000+)");
  eq(DB.one("SELECT COUNT(*) AS c FROM supplier_products").c, 5000);
  const p = DB.one("SELECT * FROM supplier_products WHERE description = 'Alpha product 123'");
  eq([p.cost_excl_vat, p.cost_incl_vat, p.vat_rate, p.qty_purchased, p.batch], [Math.round((123 / 7) * 100) / 100, Math.round((123 / 6) * 100) / 100, 18, 4, "B123"]);
  eq(DB.one("SELECT typeof(cost_excl_vat) AS a, typeof(qty_free) AS b FROM supplier_products WHERE id = ?", p.id), { a: "real", b: "integer" });

  // Swap the whole catalogue: 5,000 removed + 5,000 added notifications, in order.
  const swap = await measured(DB, () => api("POST", "/supplier-products/bulk-import", { token, body: { rows: range(5000).map((i) => prod(i, "Beta")) } }));
  eq(swap.r.status, 200, swap.r.text);
  eq(swap.r.json.changes, 10000);
  ok(swap.n < 700, "a full swap ran " + swap.n + " statements (was ~15,000)");
  ok(swap.batches.every((b, i) => i === 0 || b <= 50), "notification batches of <= 50: " + JSON.stringify(swap.batches));
  const ch = DB.q("SELECT product_description, change_type FROM supplier_stock_changes WHERE id > 5000 ORDER BY id");
  eq(ch.length, 10000);
  eq([ch[0], ch[4999], ch[5000], ch[9999]], [{ product_description: "Alpha product 0", change_type: "removed" }, { product_description: "Alpha product 4999", change_type: "removed" },
    { product_description: "Beta product 0", change_type: "added" }, { product_description: "Beta product 4999", change_type: "added" }]);

  // A row the database refuses (NaN profit -> NULL) still leaves the old catalogue untouched.
  const bad = range(5000).map((i) => prod(i, "Gamma")); bad[4321].retail_price = "Infinity";
  eq((await api("POST", "/supplier-products/bulk-import", { token, body: { rows: bad } })).status, 500);
  eq(DB.one("SELECT COUNT(*) AS c FROM supplier_products WHERE description LIKE 'Beta%'").c, 5000, "nothing half-replaced");
});

test("bulk: 500-row contacts import runs in tens of statements and returns each row's id in order", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  // The table as ensureContactsSchema makes it (which skips its work if an earlier test already ran it).
  DB.db.exec(`CREATE TABLE IF NOT EXISTS contacts_clients (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '', id_card TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', alt_phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_by INTEGER, updated_by INTEGER)`);
  await api("GET", "/contacts/clients", { token }); // schema work done before counting
  const rows = range(500).map((i) => ({ name: "Client " + i, id_card: i % 3 ? "" : i + "M", address: "Triq " + i, phone: "79" + i, alt_phone: "" }));
  const r = await measured(DB, () => api("POST", "/contacts/clients/bulk", { token, body: { rows } }));
  eq(r.r.status, 200, r.r.text);
  ok(r.n < 60, "ran " + r.n + " statements (was 504)");
  ok(r.maxParams <= 100);
  const ids = r.r.json.ids;
  eq(ids.length, 500);
  eq(DB.q("SELECT id, name FROM contacts_clients ORDER BY id").map((x) => [x.id, x.name]), ids.map((id, i) => [id, "Client " + i]));
});

test("bulk: a 500-product POS batch runs in tens of statements; repeated names and barcode rules are as before", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  // barcode nullable, as the route expects for "no barcode"
  DB.db.exec(`CREATE TABLE pos_products (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL, barcode TEXT DEFAULT '', name TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0, vat_rate REAL NOT NULL DEFAULT 18, category TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(org_id, location_id, name))`);
  const products = range(500).map((i) => ({ name: "Item " + (i % 400), barcode: i < 400 ? "BC" + i : "", price: i, vat_rate: 18, category: "C", unit: "box" }));
  const r = await measured(DB, () => api("POST", "/emergency-pos/catalog", { token, body: { products, wipe: true, file_name: "a.csv", total_rows: 500 } }));
  eq(r.r.status, 200, r.r.text);
  eq(r.r.json.upserted, 500);
  // < 70: batch-3 adds a fixed per-request cost (session columns, schema-version marks), not a per-row one.
  ok(r.n < 70, "ran " + r.n + " statements (was ~520)");
  eq(DB.one("SELECT COUNT(*) AS c FROM pos_products").c, 400);
  eq(DB.one("SELECT barcode, price FROM pos_products WHERE name = 'Item 7'"), { barcode: "BC7", price: 407 }, "the later row's price, the earlier barcode kept");
});

test("bulk: a 500-item short-expiry batch runs in tens of statements", async ({ api, bootstrap, addUser, DB }) => {
  await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (600, 1, 'Warehouse')").run();
  const wh = await addUser({ locationId: 600, email: "wh@example.com", name: "Warehouse" });
  const items = range(500).map((i) => ({ stk_code: "S" + i, stk_desc: i % 50 ? "Desc " + i : "", batch: "L" + i, expiry: "2027/01", qty: i, loc_code: "WSL" }));
  const r = await measured(DB, () => api("POST", "/cherubino/short-expiry/upload", { token: wh.token, body: { items, wipe: true } }));
  eq(r.r.status, 200, r.r.text);
  eq(r.r.json.inserted, 490);
  // < 60: as above, batch-3's fixed per-request statements.
  ok(r.n < 60, "ran " + r.n + " statements (was ~500)");
  eq(DB.q("SELECT stk_desc FROM cherubino_short_expiry ORDER BY id").map((x) => x.stk_desc), items.filter((x) => x.stk_desc).map((x) => x.stk_desc));
});

test("bulk: a 10-year shift pattern runs in ~100 statements; a longer range or more shifts is refused before anything is deleted", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const staffId = (await api("POST", "/shifts/staff", { token, body: { full_name: "Anna Vella" } })).json.staff_id;
  const week = range(7).map((d) => (d === 0 ? { off: true } : { start: "09:00", end: "17:00" }));
  const r = await measured(DB, () => api("POST", "/shifts/apply-pattern", { token, body: { staff_id: staffId, mode: "overwrite", start_date: "2026-01-01", end_date: "2036-01-08", pattern: { week } } }));
  eq(r.r.status, 200, r.r.text);
  eq(r.r.json.inserted, DB.one("SELECT COUNT(*) AS c FROM shift_assignments").c);
  ok(r.r.json.inserted > 3100, "inserted " + r.r.json.inserted);
  ok(r.n < 150, "ran " + r.n + " statements (was ~3,100)");
  const before = DB.one("SELECT COUNT(*) AS c FROM shift_assignments").c;
  const long = await api("POST", "/shifts/apply-pattern", { token, body: { staff_id: staffId, mode: "overwrite", start_date: "2026-01-01", end_date: "2036-01-09", pattern: { week } } });
  eq([long.status, long.json.error], [400, "A pattern can cover at most 10 years (3,660 days) at a time"]);
  const many = await api("POST", "/shifts/apply-pattern", { token, body: { staff_id: staffId, mode: "overwrite", start_date: "2026-01-01", end_date: "2026-01-01", dates: range(3661).map(() => ({ date: "2026-01-01", start_time: "09:00", end_time: "10:00" })) } });
  eq([many.status, many.json.error], [400, "At most 3,660 shifts can be applied at a time"]);
  eq(DB.one("SELECT COUNT(*) AS c FROM shift_assignments").c, before, "nothing deleted by a refused request");
});

test("bulk: 1,000 end-of-day contacts save in tens of statements, ids in list order; more than 1,000 is refused unchanged", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const seed = await api("PUT", "/endofday/contacts", { token, body: { contacts: range(300).map((i) => ({ display_name: "Bank " + i, phone: "21" + i })) } });
  eq(seed.status, 200, seed.text);
  const list = range(1000).map((i) => ({ display_name: "Bank " + (i % 600), phone: "p" + i, email: i % 2 ? "" : "e" + i }));
  const r = await measured(DB, () => api("PUT", "/endofday/contacts", { token, body: { contacts: list } }));
  eq(r.r.status, 200, r.r.text);
  ok(r.n < 50, "ran " + r.n + " statements (was ~2,000)");
  const byName = new Map(DB.q("SELECT id, display_name FROM end_of_day_contacts").map((x) => [x.display_name, x.id]));
  eq(r.r.json.ids, list.map((c) => byName.get(c.display_name)));
  eq(DB.one("SELECT phone, email, is_active FROM end_of_day_contacts WHERE display_name = 'Bank 5'"), { phone: "p605", email: "", is_active: 1 }, "the last copy wins");
  eq(DB.one("SELECT COUNT(*) AS c FROM end_of_day_contacts WHERE is_active = 1").c, 600);
  const big = await api("PUT", "/endofday/contacts", { token, body: { contacts: range(1001).map((i) => ({ display_name: "X" + i })) } });
  eq([big.status, big.json.error], [400, "At most 1,000 contacts can be saved at once"]);
  eq(DB.one("SELECT COUNT(*) AS c FROM end_of_day_contacts WHERE is_active = 1").c, 600, "a refused save changes nothing");
});
