// Upgrade rehearsal for the stock flow (d-stock): the worker as it was (base commit, or OLD_WORKER=path) writes stock
// data, this copy's worker takes over and uses every new route, then the old one again (rollback). Every existing row and
// every list the screens read must be unchanged; the only schema change is two new tables.
// Run: node --no-warnings tests/rehearsal/stockflow-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "stockflow-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? (await import("node:fs")).readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "john@eikon.mt", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
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
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10), month = day(0).slice(0, 7);
// ---- 1. the live worker: a pharmacy and a branch of the same group with stock data of every kind
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const s = async (m, p, body) => { const r = await api(m, p, { token: T, body }); if (r.status >= 400) console.log("  seed refused", m, p, r.status, r.text.slice(0, 100)); return r.json || {}; };
const ids = [];
for (let i = 0; i < 30; i++) ids.push((await s("POST", "/order-diary/entries", { order_date: day(i % 10), item_name: ["Augmentin 625 x14", "Ventolin inhaler", "Ċetirizine 10mg"][i % 3], qty: 1 + (i % 3), supplier: ["GSK", "Ħili Pharma", ""][i % 3], notes: i % 4 ? "" : "For Ġorġ" })).id);
await s("PUT", "/order-diary/entries/" + ids[1], { status: "received" }); await s("PUT", "/order-diary/entries/" + ids[2], { status: "not_received" });
await s("POST", "/order-diary/carry-over", { from_date: day(3), to_date: day(2) });
const co = await s("POST", "/client-orders/entries", { order_date: day(1), client_name: "Borg Anna", contact: "79111222", client_phone: "79111222", items: "Ventolin inhaler", priority: 2 });
await s("POST", "/alerts/entries", { entry_date: day(0), alert_type: "recall", status: "open", item_name: "Valsartan 80mg", batch: "VX1", quantity: "4", reason: "Recall", storage_location: "room" });
await s("POST", "/quotations/entries", { quote_date: day(2), item_description: "Ventolin inhaler", supplier: "GSK", vat_rate: 18, cost_excl_vat: 2.4, qty_purchased: 1, retail_price: 4.5 });
await s("POST", "/near-expiry/entries", { product_name: "Ventolin", expiry_date: day(-20), location: "A3", notes: "" });
await s("POST", "/returns/entries", { entry_date: day(4), description: "Amoxil", quantity: "2", supplier: "GSK" });

// ---- snapshot every existing table and every list the screens read
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const VOL = (t) => ["sessions", "audit_log", "rate_limits", "login_attempts", "eikon_schema"].includes(t) || /^stock_flow_/.test(t);
const dump = () => { const o = {}; for (const t of tables()) if (!VOL(t)) o[t] = DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all(); return o; };
const READS = ["/order-diary/entries?date=" + day(0), "/order-diary/entries?date=" + day(2), "/order-diary/items", "/client-orders/entries?month=" + month, "/alerts/entries", "/quotations/entries", "/near-expiry/entries", "/returns/entries?open=1"];
const reads = async () => { const o = {}; for (const p of READS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + JSON.stringify(r.json && (r.json.entries || r.json.items)); } return o; };
const before = dump(), readsBefore = await reads();

// ---- 2. this copy's worker takes over and uses every new route
worker = NEW;
const open = await api("GET", "/stock-flow/open?from=" + day(30), { token: T });
ok(open.status === 200 && open.json.open.length > 0, "the new worker lists the open lines (" + (open.json && open.json.open.length) + ")");
ok((await api("POST", "/stock-flow/ordered", { token: T, body: { diary_ids: ids.slice(0, 6), supplier: "GSK" } })).status === 200, "mark ordered");
ok((await api("POST", "/stock-flow/ordered/undo", { token: T, body: { diary_ids: ids.slice(0, 2) } })).status === 200, "undo a mark");
ok((await api("POST", "/stock-flow/links", { token: T, body: { diary_id: ids[4], source: "order", source_id: co.entry_id || co.id } })).status === 200, "link a line to a customer order");
const after = dump();
ok(JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(before).sort()), "no existing table added or dropped (only stock_flow_ordered and stock_flow_links are new)");
for (const t of Object.keys(before)) ok(JSON.stringify(before[t]) === JSON.stringify(after[t]), "table " + t + ": every row unchanged (" + before[t].length + " rows)");
const newT = tables().filter((t) => /^stock_flow_/.test(t)).sort();
ok(JSON.stringify(newT) === JSON.stringify(["stock_flow_links", "stock_flow_ordered"]), "the new tables: " + newT.join(", "));
const readsNew = await reads();
for (const p of READS) ok(readsNew[p] === readsBefore[p], "the new worker reads " + p + " exactly as the old one");
ok((await api("GET", "/auth/me", { token: T })).status === 200, "the session from before still works");

// ---- 3. rollback: the old worker on the database the new one used
worker = OLD;
const readsBack = await reads();
for (const p of READS) ok(readsBack[p] === readsBefore[p], "rolled back, the old worker reads " + p + " exactly as before");
ok((await api("POST", "/order-diary/entries", { token: T, body: { order_date: day(0), item_name: "After rollback", qty: 1, supplier: "", notes: "" } })).status === 200, "rolled back, the old worker still saves to the order diary");
console.log(`\nstockflow upgrade rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
