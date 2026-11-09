// Upgrade rehearsal for the day of the last inspection (Registers & inspection, round 2).
// The worker as it was (base commit, or OLD_WORKER=path) fills a database with registers, a sign-off and the audit;
// this copy's worker takes over, reads every list, keeps a day; then the old worker again (rollback), then the new.
// Proves: every existing row of every table is unchanged; the only schema change is one new table; every list answers
// the same before and after; the old worker ignores the new table.
// Run: node --no-warnings tests/rehearsal/lastinspection-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "lastinsp-rehearsal-"));
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

// ---- 1. the live worker: registers, a sign-off and the audit trail, as a pharmacy has them today
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const devs = (await api("GET", "/temperature/devices", { token: T })).json?.devices || [];
for (let n = 1; n <= 40; n++) {
  for (const dv of devs.slice(0, 2)) await api("POST", "/temperature/entries", { token: T, body: { device_id: dv.id, entry_date: day(n), min_temp: 3.1, max_temp: 6.4, notes: "" } });
  if (n % 6 === 0) await api("POST", "/cleaning/entries", { token: T, body: { entry_date: day(n), time_in: "08:00", time_out: "08:40", cleaner_name: "Ġorġ Żammit", staff_name: "Maria Borg", notes: "" } });
  await api("POST", "/locumregister/entries", { token: T, body: { entry_date: day(n), time_in: "08:00", time_out: "13:00", locum_full_name: "Anna Vella", registration_number: "P123" } });
  if (n % 10 === 0) await api("POST", "/dda-sales/entries", { token: T, body: { entry_date: day(n), client_name: "Ċensu Ħili", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S" + n } });
}
await api("POST", "/registers/signoffs", { token: T, body: { register: "temperature", month: last } }); // a table from batch-9 (absent on an older base: fine)
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const dump = (skip) => { const o = {}; for (const t of tables()) if (!skip.includes(t)) o[t] = JSON.stringify(DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all()); return o; };
const LISTS = ["/temperature/devices", "/temperature/entries?month=" + month, "/temperature/entries?month=" + last, "/cleaning/entries?month=" + last, "/locumregister/entries?month=" + last, "/dda-sales/entries?month=" + last, "/certificates/items", "/dda-stocktakes/stocktakes", "/registers/signoffs?month=" + last, "/today"];
const strip = (j) => JSON.stringify(j, (k, v) => (k === "generated_at" || k === "server_time" || k === "now") ? undefined : v);
const lists = async () => { const o = {}; for (const p of LISTS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.json); } return o; };
const listsOld = await lists(), tablesOld = tables(), SKIP = ["sessions", "audit_log", "login_attempts", "eikon_schema"], before = dump(SKIP);
const schemaOld = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
const auditOld = JSON.stringify(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all());
const oldGet = await api("GET", "/registers/last-inspection", { token: T });
ok(oldGet.status === 404 || oldGet.status === 405 || (oldGet.json && oldGet.json.ok === false), "the live worker has no such route (the screen then keeps the day in the browser): " + oldGet.status);
console.log("old worker:", tablesOld.length, "tables");

// ---- 2. the new worker on the same database
worker = NEW;
const listsNew = await lists();
ok(LISTS.every((p) => listsNew[p] === listsOld[p]), "every register list (and Today) answers identically on the new worker (" + LISTS.length + " lists)" + LISTS.filter((p) => listsNew[p] !== listsOld[p]).map((p) => " · " + p).join(""));
const g = await api("GET", "/registers/last-inspection", { token: T });
ok(g.status === 200 && g.json.last_date === "", "the day starts empty");
const d = day(14), s = await api("PUT", "/registers/last-inspection", { token: T, body: { date: d } });
ok(s.status === 200 && s.json.last_date === d && s.json.set_name === "Maria Borg", "the day of the last inspection is kept");
const added = tables().filter((t) => !tablesOld.includes(t));
ok(added.length === 1 && added[0] === "register_last_inspection", "the only schema change is one new table: " + added.join(", "));
const after = dump(SKIP.concat(["register_last_inspection"]));
const schemaNow = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
ok(schemaOld.every((r) => schemaNow.includes(r)), "the schema bookkeeping keeps every old line (" + (schemaNow.length - schemaOld.length) + " new)");
const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
ok(changed.length === 0, "every row of every existing table is byte-for-byte unchanged (" + Object.keys(before).length + " tables)" + (changed.length ? ": " + changed.join(", ") : ""));
const auditNow = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all(), nOld = JSON.parse(auditOld).length;
ok(JSON.stringify(auditNow.slice(0, nOld)) === auditOld && auditNow.slice(nOld).every((a) => a.action === "LAST_INSPECTION_SET"), "the audit keeps every old entry; the only new one is the day set");
ok(strip((await api("GET", "/today", { token: T })).json) === listsOld["/today"].slice(4), "Today answers the same with the day set");

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
const lists3 = await lists();
ok(LISTS.every((p) => lists3[p] === listsOld[p]), "after a rollback every list answers as before");
const w3 = await api("POST", "/cleaning/entries", { token: T, body: { entry_date: day(0), time_in: "09:00", time_out: "", cleaner_name: "Karl", staff_name: "Maria Borg", notes: "" } });
ok(w3.status === 200, "after a rollback the old worker still saves (it ignores the new table)");
worker = NEW;
ok((await api("GET", "/registers/last-inspection", { token: T })).json.last_date === d, "upgrading again, the day is still there");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
