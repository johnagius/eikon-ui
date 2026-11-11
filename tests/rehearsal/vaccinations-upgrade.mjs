// Upgrade rehearsal for vaccinations given (Services, 2026-11-09).
// The worker as it was (base commit, or OLD_WORKER=path) fills a database with vaccine orders, stock, the catalogue,
// adverse-reaction reports and the audit; this copy's worker takes over, reads every list, records vaccinations; then the old worker again (rollback), then the new.
// Proves: every existing row of every table is unchanged; the only schema change is one new table; every list answers
// the same before and after; the old worker ignores the new table.
// Run: node --no-warnings tests/rehearsal/vaccinations-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "vaxgiven-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? (await import("node:fs")).readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
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
const malta = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const day = (n) => malta(new Date(Date.now() - n * 864e5)), month = day(0).slice(0, 7);
const last = (() => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); })();

// ---- 1. the live worker: vaccine catalogue, stock, orders (which take stock off), reaction reports, as a pharmacy has them today
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
for (const nm of ["Havrix 1440", "Boostrix", "Typhim Vi", "Influvac"]) {
  await api("POST", "/vaccines/catalog", { token: T, body: { brand_name: nm, vaccinates_for: "x", dosing_schedule: "0, 6 months", routine_in_malta: nm === "Influvac" ? "yes" : "", travel_always: "KE,TZ", travel_highrisk: "IN" } });
  await api("POST", "/vaccines/stock/rows", { token: T, body: { vaccine_name: nm, qty: 20, batch: "B-" + nm.slice(0, 3), expiry_date: "2027-0" + (nm.length % 9 + 1) + "-28" } });
}
for (let n = 0; n < 25; n++) await api("POST", "/vaccines/orders", { token: T, body: { section: n % 2 ? "travel" : "other", country_code: n % 2 ? "KE" : "", country_name: n % 2 ? "Kenya" : "", client_first: "Ġorġ" + n, client_last: "Zammit", phone: "7900" + (1000 + n), email: "", items: [{ name: "Havrix 1440", qty: 1 }, { name: n % 3 ? "Boostrix" : "Typhim Vi", qty: 1 }] } });
await api("PUT", "/pharmacovigilance/state", { token: T, body: { state: { reports: [{ id: "pv_1_abc", created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T09:00:00Z", status: "Draft", pt_initials: "G.Ż.", drugs: [{ name: "Havrix 1440", route: "IM" }], reaction_meddra: "Injection site reaction" }], deleted_ids: [] } } });
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const dump = (skip) => { const o = {}; for (const t of tables()) if (!skip.includes(t)) o[t] = JSON.stringify(DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all()); return o; };
const LISTS = ["/vaccines/catalog", "/vaccines/orders", "/vaccines/orders?month=" + month, "/vaccines/stock/rows", "/pharmacovigilance/state", "/today"];
const strip = (j) => JSON.stringify(j, (k, v) => (k === "generated_at" || k === "server_time" || k === "now") ? undefined : v);
const lists = async () => { const o = {}; for (const p of LISTS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.json); } return o; };
const listsOld = await lists(), tablesOld = tables(), SKIP = ["sessions", "audit_log", "login_attempts", "eikon_schema"], before = dump(SKIP);
const schemaOld = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
const auditOld = JSON.stringify(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all());
ok(JSON.parse(listsOld["/vaccines/orders"].slice(4)).orders.length === 25, "25 orders on the live worker");
const oldGet = await api("GET", "/vaccines/given?month=" + month, { token: T });
ok(oldGet.status === 404 || oldGet.status === 405 || (oldGet.json && oldGet.json.ok === false), "the live worker has no such route (the screen then says recording needs the update): " + oldGet.status);
console.log("old worker:", tablesOld.length, "tables");

// ---- 2. the new worker on the same database
worker = NEW;
const listsNew = await lists();
ok(LISTS.every((p) => listsNew[p] === listsOld[p]), "every vaccines/reactions list (and Today) answers identically on the new worker (" + LISTS.length + " lists)" + LISTS.filter((p) => listsNew[p] !== listsOld[p]).map((p) => " · " + p).join(""));
const g1 = await api("POST", "/vaccines/given", { token: T, body: { given_on: day(0), client_first: "Ġorġ1", client_last: "Zammit", phone: "79001001", vaccine_name: "Havrix 1440", dose: "1st", batch: "B-Hav", expiry_date: "2027-02-28", site: "Left upper arm", consent_by: "Patient", next_due: malta(new Date(Date.now() + 180 * 864e5)) } });
ok(g1.status === 200 && g1.json.given && g1.json.given.given_by_name === "Maria Borg", "a vaccination is recorded: " + g1.status);
const due = await api("GET", "/vaccines/given/due?to=" + malta(new Date(Date.now() + 200 * 864e5)), { token: T });
ok(due.json && due.json.due.length === 1, "its recall is listed");
const added = tables().filter((t) => !tablesOld.includes(t));
ok(added.length === 1 && added[0] === "vaccinations", "the only schema change is one new table: " + added.join(", "));
const after = dump(SKIP.concat(["vaccinations"]));
const schemaNow = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
ok(schemaOld.every((r) => schemaNow.includes(r)), "the schema bookkeeping keeps every old line (" + (schemaNow.length - schemaOld.length) + " new)");
const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
ok(changed.length === 0, "every row of every existing table (orders, items, stock, catalogue, reports) is byte-for-byte unchanged (" + Object.keys(before).length + " tables)" + (changed.length ? ": " + changed.join(", ") : ""));
const auditNow = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all(), nOld = JSON.parse(auditOld).length;
ok(JSON.stringify(auditNow.slice(0, nOld)) === auditOld && auditNow.slice(nOld).every((a) => a.action === "VAX_GIVEN_CREATE"), "the audit keeps every old entry; the only new one is the vaccination");
const listsAfter = await lists();
ok(LISTS.every((p) => listsAfter[p] === listsOld[p]), "the lists still answer the same with a vaccination recorded (stock untouched)");

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
const lists3 = await lists();
ok(LISTS.every((p) => lists3[p] === listsOld[p]), "after a rollback every list answers as before");
const w3 = await api("POST", "/vaccines/orders", { token: T, body: { section: "other", country_code: "", country_name: "", client_first: "Karl", client_last: "Vella", phone: "79111222", email: "", items: [{ name: "Boostrix", qty: 1 }] } });
ok(w3.status === 200, "after a rollback the old worker still takes orders (it ignores the new table)");
worker = NEW;
ok((await api("GET", "/vaccines/given?month=" + month, { token: T })).json.given.length === 1, "upgrading again, the vaccination is still there");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
