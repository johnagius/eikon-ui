// Upgrade rehearsal for the portals (FIN): one added READ-ONLY route, GET /hq/stock (a head office's stock alerts across
// its pharmacies), and /cherubino/* answered only to org 12 (Not found to every other org). No table, column or index.
// The worker as it was (base commit, or OLD_WORKER=path) records a distributor's day, a head office's group and the
// Cherubino group's day; this copy's worker takes over the same database, then the old one again. Proves: the schema is
// identical; every row of every table is byte-for-byte unchanged after the new worker's reads and the refused calls;
// every read the distributor, the head office and org 12 make answers the same; rollback and forward again work.
// Run: node --no-warnings tests/rehearsal/portals-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "portals-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = OLD;
async function api(method, path, { body, token, form } = {}) {
  const h = new Headers(); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + path, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const malta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = (n) => { const [y, m, d] = malta().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };

// ---- 1. the live worker: the people and their day
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const loc = (id, org, name) => DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(id, org, name);
DB.db.prepare("INSERT INTO orgs (id, name) VALUES (12, 'Cherubino Group')").run();
loc(2, 1, "Branch"); loc(450, 1, "Island Distributors"); loc(650, 1, "Head Office"); loc(80, 12, "Cherubino Ħamrun"); loc(680, 12, "Cherubino HQ");
const login = async (email) => (await api("POST", "/auth/login", { body: { email, password: "Demo-Pass-2026" } })).json.token;
const mk = async (orgId, locationId, email, name, role = "admin") => {
  const enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode("Demo-Pass-2026"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  DB.db.prepare("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,1,?)")
    .run(orgId, email, name, role, Buffer.from(salt).toString("base64"), Buffer.from(new Uint8Array(bits)).toString("base64"), 100000, locationId);
  return login(email);
};
const T = { ph: await login("maria@demo.mt"), sup: await mk(1, 450, "sup@demo.mt", "Ramona Ellul"), ho: await mk(1, 650, "ho@demo.mt", "Kurt Muscat"),
  c12: await mk(12, 80, "ph@cherubino.mt", "Ġorġ Pace"), ho12: await mk(12, 680, "ho@cherubino.mt", "Joe Cassar") };
let wrote = 0;
const W = async (tok, m, p, b) => { const r = await api(m, p, { token: tok, body: b }); if (r.status === 200 || r.status === 201) wrote++; else console.log("    write", p, r.status, r.text.slice(0, 120)); return r; };
const prod = (await W(T.sup, "POST", "/supplier-products/entries", { description: "Augmentin \"625\" <b>x14</b>", stock_code: "AUG", barcode: "5001", cost_excl_vat: 8.2, cost_incl_vat: 0, vat_rate: 0, discount_pct: 0, discount_euro: 0, qty_purchased: 1, qty_free: 0, batch: "B1", expiry_date: "31/01/2027", retail_price: 12.5 })).json.id;
const ord = (await W(T.ph, "POST", "/supplier-orders", { supplier_location_id: 450, supplier_name: "Island Distributors", notes: "Ħ note", items: [{ product_id: prod, description: "Augmentin", qty_requested: 2, cost_excl_vat: 8.2, retail_price: 12.5, vat_rate: 0 }] })).json.id;
const det = (await api("GET", "/supplier-orders/" + ord, { token: T.sup })).json;
await W(T.ph, "POST", "/supplier-orders/items/" + det.items[0].id + "/feedback", { problem_type: "Damaged", notes: "Box crushed" });
await W(T.ph, "POST", "/alerts/entries", { entry_date: day(1), alert_type: "recall", status: "open", item_name: "Valsartan 80mg", batch: "VX1", storage_location: "room" });
await W(T.ph, "POST", "/near-expiry/entries", { product_name: "Clexane", expiry_date: day(-10), location: "Fridge", notes: "" });
await W(T.c12, "POST", "/cherubino/orders", { description: "Panadol", quantity: 2, order_date: day(0) });
await W(T.ho12, "POST", "/cherubino/oos", { description: "Ventolin" });
await W(T.ho12, "POST", "/cherubino/short-expiry/upload", { items: [{ stk_code: "A1", stk_desc: "Paracetamol", batch: "B1", expiry: "2026/12", qty: 10, loc_code: "WSL" }], wipe: true });
ok(wrote === 8, "old worker: " + wrote + " writes (product, order, problem, alert, near expiry, Cherubino order, OOS, short expiry)");

const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all());
const snap = () => { const ts = DB.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sessions', 'audit_log', 'login_attempts', 'schema_marks') ORDER BY name").all().map((r) => r.name); return JSON.stringify(ts.map((t) => [t, DB.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])); };
const READS = [[T.sup, "/supplier-products/entries"], [T.sup, "/supplier-orders/received"], [T.sup, "/supplier-orders/feedback"], [T.sup, "/supplier-orders/" + ord],
  [T.ho, "/admin/pharmacy-overview"], [T.ho, "/owner/summary?loc=all"], [T.ph, "/supplier-orders/sent"], [T.ph, "/alerts/entries"],
  [T.ho12, "/cherubino/orders?date=" + day(0) + "&all_org=1"], [T.c12, "/cherubino/oos"], [T.ho12, "/cherubino/short-expiry"], [T.ho12, "/cherubino/locations"]];
const strip = (t) => t.replace(/"(time|now|generated_at)":"[^"]*"/g, "");
const readAll = async () => { const o = {}; for (const [tok, p] of READS) { const r = await api("GET", p, { token: tok }); o[p] = r.status + " " + strip(r.text); } return o; };
const readsOld = await readAll(), schemaOld = schema(), rowsOld = snap();
const before = await api("GET", "/hq/stock", { token: T.ho });
ok(before.status === 404, "the old worker has no /hq/stock (" + before.status + ")");
ok((await api("GET", "/cherubino/oos", { token: T.ph })).status === 200, "the old worker answers /cherubino/oos to org 1 (" + "what changes" + ")");

// ---- 2. the new worker on the same database
worker = NEW;
const r = await api("GET", "/hq/stock", { token: T.ho });
ok(r.status === 200 && r.json.pharmacies.length === 2 && r.json.pharmacies.find((p) => p.id === 1).alerts.items[0].item === "Valsartan 80mg" && r.json.pharmacies.find((p) => p.id === 1).near_expiry.expired === 0 && r.json.pharmacies.find((p) => p.id === 1).near_expiry.within_30 === 1,
  "new worker: the head office's stock alerts from the old worker's rows " + r.text.slice(0, 200));
for (const [tok, p, w] of [[T.ph, "/cherubino/oos", 404], [T.ho, "/cherubino/short-expiry", 404], [T.sup, "/cherubino/orders?date=" + day(0), 404], [T.ho12, "/cherubino/oos", 200], [T.c12, "/cherubino/oos", 200]]) ok((await api("GET", p, { token: tok })).status === w, "new worker: " + p + " answers " + w);
ok((await api("POST", "/cherubino/oos", { token: T.ph, body: { description: "Refused" } })).status === 404, "a write to /cherubino/ from org 1 is refused");
{ const a = JSON.parse(schemaOld).map((x) => x.name), b = JSON.parse(schema()).map((x) => x.name); console.log("    added:", b.filter((n) => !a.includes(n)).join(", ") || "none", "removed:", a.filter((n) => !b.includes(n)).join(", ") || "none"); }
ok(schema() === schemaOld, "the schema is identical: no table, column or index added");
ok(snap() === rowsOld, "every row of every table is byte-for-byte unchanged");
const readsNew = await readAll(), diff = READS.map((x) => x[1]).filter((p) => readsNew[p] !== readsOld[p]);
ok(!diff.length, "every read the distributor, head office and org 12 make answers the same (" + READS.length + " reads)" + (diff.length ? " differs: " + diff.join(", ") : ""));

// ---- 3. rollback to the old worker, then forward again
worker = OLD;
const readsBack = await readAll(), diffB = READS.map((x) => x[1]).filter((p) => readsBack[p] !== readsOld[p]);
ok(!diffB.length && snap() === rowsOld, "rollback: the old worker reads the same, nothing changed" + (diffB.length ? " differs: " + diffB.join(", ") : ""));
worker = NEW;
ok((await api("GET", "/hq/stock", { token: T.ho })).status === 200 && snap() === rowsOld, "forward again: /hq/stock answers, rows unchanged");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
