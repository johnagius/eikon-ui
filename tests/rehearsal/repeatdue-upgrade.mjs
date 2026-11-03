// Upgrade rehearsal for repeats coming due (backlog 3 item 7): two added columns on repeat_prescription_entries.
// The worker as it was (base commit, or OLD_WORKER=path) writes prescriptions of every shape, then this copy's worker
// takes over the same database, then the old one again (rollback).
// Proves: existing rows are byte-for-byte unchanged in their old columns; the only schema change is two added
// columns that read NULL for every existing row; the old answers (list, edit, delete) are the same apart from the
// two new keys; the classic edit on the new worker keeps a stored interval; the old worker still works afterwards.
// Run: node --no-warnings tests/rehearsal/repeatdue-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "repeatdue-rehearsal-"));
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
const RANGE = "/repeat-prescriptions/entries?from=" + day(400) + "&to=" + malta();

// ---- 1. the live worker: prescriptions of every shape (old, expired, renewed, custom expiry, odd text, two pharmacies)
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const RX = (o) => ({ entry_date: day(10), expires_date: "", client_name: "Grech Carmen", client_id: "123456M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", prescriber_name: "Dr Galea", prescriber_reg_no: "1202", ...o });
const shapes = [RX({}), RX({ entry_date: day(200) }), RX({ entry_date: day(150), client_id: "9M", client_name: "Vella Ġorġ", medicine_name_dose: "Ramipril 5mg — \"brand\"" }),
  RX({ entry_date: day(30), expires_date: day(-300) }), RX({ entry_date: day(1), client_name: "O'Neill <b>Ann</b>", posology: "½ tab" }), RX({ entry_date: day(380) })];
const ids = [];
for (const b of shapes) { const r = await api("POST", "/repeat-prescriptions/entries", { token: T, body: b }); ids.push(r.json && r.json.entry_id); }
// A row written straight into the table with an empty expiry (as very old data may be) and one in the branch.
DB.db.prepare("INSERT INTO repeat_prescription_entries (org_id, location_id, entry_date, expires_date, client_name, client_id, medicine_name_dose, posology, prescriber_name, prescriber_reg_no) VALUES (1,2,?,?,?,?,?,?,?,?)").run(day(5), day(-178), "Branch Pt", "77M", "Med", "1", "Dr X", "9");
ok(ids.every(Boolean) && ids.length === shapes.length, "old worker: " + ids.length + " prescriptions recorded");
const oldCols = DB.db.prepare("PRAGMA table_info(repeat_prescription_entries)").all().map((c) => c.name);
const snap = () => JSON.stringify(DB.db.prepare("SELECT " + oldCols.join(",") + " FROM repeat_prescription_entries ORDER BY id").all());
const rowsOld = snap();
const listOld = (await api("GET", RANGE, { token: T })).json.entries;
const monthOld = (await api("GET", "/repeat-prescriptions/entries?month=" + malta().slice(0, 7), { token: T })).json.entries;

// ---- 2. the new worker on the same database
worker = NEW;
const listNew = (await api("GET", RANGE, { token: T })).json.entries;
const cols2 = DB.db.prepare("PRAGMA table_info(repeat_prescription_entries)").all();
const added = cols2.filter((c) => !oldCols.includes(c.name)).map((c) => c.name + " " + c.type + (c.dflt_value == null ? "" : " default " + c.dflt_value) + (c.notnull ? " NOT NULL" : ""));
ok(added.join(", ") === "collect_every_days INTEGER, last_collected_date TEXT", "the only schema change is two added nullable columns: " + added.join(", "));
ok(snap() === rowsOld, "every existing row is byte-for-byte unchanged in its old columns (" + ids.length + " + 1)");
ok(DB.db.prepare("SELECT COUNT(*) c FROM repeat_prescription_entries WHERE collect_every_days IS NOT NULL OR last_collected_date IS NOT NULL").get().c === 0, "every existing row reads NULL in both (no interval: never shown as due)");
const strip = (a) => JSON.stringify(a.map((e) => { const o = { ...e }; delete o.collect_every_days; delete o.last_collected_date; return o; }));
ok(strip(listNew) === JSON.stringify(listOld), "the list answers the same rows, in the same order, with the same values (plus two keys)");
ok(listNew.every((e) => e.collect_every_days === null && e.last_collected_date === null), "the two new keys are present and null");
const monthNew = (await api("GET", "/repeat-prescriptions/entries?month=" + malta().slice(0, 7), { token: T })).json.entries;
ok(strip(monthNew) === JSON.stringify(monthOld), "the month view (classic list and print) is the same");
// A classic edit of an existing row on the new worker: same result as on the old one, interval untouched.
const e0 = await api("PUT", "/repeat-prescriptions/entries/" + ids[0], { token: T, body: RX({ posology: "2 at night" }) });
ok(e0.status === 200 && DB.db.prepare("SELECT posology, collect_every_days FROM repeat_prescription_entries WHERE id=?").get(ids[0]).posology === "2 at night", "a classic edit of an old row still applies");
// Use the new feature: interval on a new line, collected today; nothing else changes.
const before = JSON.stringify(DB.db.prepare("SELECT * FROM repeat_prescription_entries WHERE id <> ? ORDER BY id").all(ids[1]));
const n = await api("POST", "/repeat-prescriptions/entries", { token: T, body: RX({ entry_date: day(3), collect_every_days: 28 }) });
const c = await api("POST", "/repeat-prescriptions/entries/" + ids[1] + "/collected", { token: T, body: {} });
ok(n.status === 200 && c.status === 200, "new worker: a line with an interval, and Collected today on an old line");
const afterRows = DB.db.prepare("SELECT * FROM repeat_prescription_entries WHERE id <> ? AND id <> ? ORDER BY id").all(ids[1], n.json.entry_id);
ok(JSON.stringify(afterRows) === before, "using the new feature changed no other row");
const k = await api("PUT", "/repeat-prescriptions/entries/" + n.json.entry_id, { token: T, body: RX({ entry_date: day(3), posology: "1 daily" }) });
ok(k.status === 200 && DB.db.prepare("SELECT collect_every_days FROM repeat_prescription_entries WHERE id=?").get(n.json.entry_id).collect_every_days === 28, "a classic edit (no interval in the body) keeps the interval");

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
const l3 = await api("GET", RANGE, { token: T });
ok(l3.status === 200 && l3.json.entries.length === listOld.length + 1, "after a rollback the old worker lists every line (" + (l3.json && l3.json.entries.length) + ")");
const p3 = await api("PUT", "/repeat-prescriptions/entries/" + n.json.entry_id, { token: T, body: RX({ entry_date: day(3), posology: "1 daily (old)" }) });
ok(p3.status === 200 && DB.db.prepare("SELECT collect_every_days FROM repeat_prescription_entries WHERE id=?").get(n.json.entry_id).collect_every_days === 28, "after a rollback an edit on the old worker keeps the stored interval (it never names the column)");
const a3 = await api("POST", "/repeat-prescriptions/entries", { token: T, body: RX({ entry_date: day(2) }) });
const d3 = await api("DELETE", "/repeat-prescriptions/entries/" + ids[5], { token: T });
ok(a3.status === 200 && d3.status === 200, "after a rollback the old worker records and deletes as before");
// And forward again: the new worker reads the old worker's new line as "no interval".
worker = NEW;
const l4 = (await api("GET", RANGE, { token: T })).json.entries.find((e) => e.id === a3.json.entry_id);
ok(l4 && l4.collect_every_days === null, "forward again: a line the old worker wrote reads as no interval");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
