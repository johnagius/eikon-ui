// Upgrade rehearsal for register sign-offs (Registers & inspection, "daily").
// The worker as it was (base commit, or OLD_WORKER=path) fills a database with readings, cleanings, daily register,
// locum register and locum receipt lines; this copy's worker takes over, reads every register, signs a month off;
// then the old worker again (rollback). Proves: every existing row of every table is unchanged; the only schema change
// is one new table; every list answers the same before and after; the old worker ignores the new table.
// Run: node --no-warnings tests/rehearsal/signoff-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "signoff-rehearsal-"));
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

// ---- 1. the live worker: a month and a half of every daily register
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const devs = (await api("GET", "/temperature/devices", { token: T })).json?.devices || [];
for (let n = 1; n <= 45; n++) {
  if (n % 9 === 0) continue; // a missed day now and then
  for (const dv of devs.slice(0, 2)) await api("POST", "/temperature/entries", { token: T, body: { device_id: dv.id, entry_date: day(n), min_temp: 3.1, max_temp: 6.4 + (n % 3), notes: n % 5 ? "" : "Door left open, closed, re-checked" } });
  if (n % 6 === 0) await api("POST", "/cleaning/entries", { token: T, body: { entry_date: day(n), time_in: "08:00", time_out: "08:40", cleaner_name: "Ġorġ Żammit", staff_name: "Maria Borg", notes: "" } });
  await api("POST", "/daily-register/entries", { token: T, body: { entry_date: day(n), client_name: "Ċensu Ħili", client_id: "12345" + (n % 10) + "M", medicine_name_dose: "Amoxil 500mg", posology: "1-1-1 x 7 days", prescriber_name: "Dr Abela", prescriber_reg_no: "1234" } });
  await api("POST", "/locumregister/entries", { token: T, body: { entry_date: day(n), time_in: "08:00", time_out: "13:00", locum_full_name: "Anna Vella", registration_number: "P123" } });
  if (n % 7 === 0) await api("POST", "/locumreceipts/receipts", { token: T, body: { receipt_date: day(n), hours: 5, locum_full_name: "Anna Vella", registration_number: "P123", day_type: "normal", fee_per_hour: 25 } });
}
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const dump = (skip) => { const o = {}; for (const t of tables()) if (!skip.includes(t)) o[t] = JSON.stringify(DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all()); return o; };
const LISTS = ["/temperature/entries?month=" + month, "/temperature/entries?month=" + last, "/cleaning/entries?month=" + last, "/daily-register/entries?month=" + last, "/locumregister/entries?month=" + last, "/locumreceipts/receipts?month=" + last, "/today"];
const strip = (j) => JSON.stringify(j, (k, v) => (k === "generated_at" || k === "server_time" || k === "now") ? undefined : v);
const lists = async () => { const o = {}; for (const p of LISTS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.json); } return o; };
const listsOld = await lists(), tablesOld = tables(), before = dump(["sessions", "audit_log", "login_attempts", "eikon_schema"]);
const schemaOld = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
const counts = ["temperature_entries", "cleaning_entries", "daily_register_entries", "locum_register_entries", "locum_receipts"].map((t) => { try { return t + " " + DB.db.prepare("SELECT COUNT(*) AS c FROM " + t).get().c; } catch (e) { return t + " ?"; } });
console.log("old worker:", counts.join(", "));
const auditOld = JSON.stringify(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all());

// ---- 2. the new worker on the same database
worker = NEW;
const listsNew = await lists();
ok(LISTS.every((p) => listsNew[p] === listsOld[p]), "every register list (and Today) answers identically on the new worker (" + LISTS.length + " lists)");
const g = await api("GET", "/registers/signoffs?month=" + last, { token: T });
ok(g.status === 200 && Array.isArray(g.json.signoffs) && g.json.signoffs.length === 0, "the new sign-off list starts empty");
const s = await api("POST", "/registers/signoffs", { token: T, body: { register: "temperature", month: last, note: "Missed days: closed" } });
ok(s.status === 200 && s.json.signoff.signed_name === "Maria Borg", "the pharmacist signs off last month's temperature register");
const added = tables().filter((t) => !tablesOld.includes(t));
ok(added.length === 1 && added[0] === "register_signoffs", "the only schema change is one new table: " + added.join(", "));
const after = dump(["sessions", "audit_log", "login_attempts", "eikon_schema", "register_signoffs"]);
const schemaNow = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
ok(schemaOld.every((r) => schemaNow.includes(r)), "the schema bookkeeping keeps every old line (" + (schemaNow.length - schemaOld.length) + " new: the new table's)");
const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
ok(changed.length === 0, "every row of every existing table is byte-for-byte unchanged (" + Object.keys(before).length + " tables)" + (changed.length ? ": " + changed.join(", ") : ""));
const auditNow = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all();
ok(JSON.stringify(auditNow.slice(0, JSON.parse(auditOld).length)) === auditOld && auditNow.slice(JSON.parse(auditOld).length).every((a) => a.action === "REGISTER_SIGNOFF"), "the audit keeps every old entry; the only new one is the sign-off");
ok(LISTS.every((p) => true) && (await lists())["/temperature/entries?month=" + last] === listsOld["/temperature/entries?month=" + last], "a signed-off month still lists exactly the same readings");

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
const lists3 = await lists();
ok(LISTS.every((p) => lists3[p] === listsOld[p]), "after a rollback every list answers as before");
const w3 = await api("POST", "/cleaning/entries", { token: T, body: { entry_date: day(0), time_in: "09:00", time_out: "", cleaner_name: "Karl", staff_name: "Maria Borg", notes: "" } });
ok(w3.status === 200, "after a rollback the old worker still saves (it ignores the new table)");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
