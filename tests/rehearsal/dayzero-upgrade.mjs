// Upgrade rehearsal for dayzero (Finish round): location_since on /auth/me and the sign-in, hours_saved on /team/today,
// setup.details_saved on /today, GET/PUT /pharmacy/details. No table, column or index is added.
// The worker as it was (base commit, or OLD_WORKER=path) fills a database as a pharmacy has it today: credit notes
// (used and with notes), label templates and pharmacy details saved by the label screen, questions, deliveries, end of
// day. This copy's worker takes over; then the old worker again (rollback); then the new.
// Proves: the schema is unchanged; every existing row of every table is byte-for-byte unchanged; every list answers the
// same apart from the new fields; the details save keeps the label templates and history; the old worker reads them.
// Run: node --no-warnings tests/rehearsal/dayzero-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "dayzero-rehearsal-"));
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
const day = (n) => malta(new Date(Date.now() - n * 864e5));

// ---- 1. the live worker: a pharmacy as it is today
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const cn = (i) => ({ issue_date: day(i), client_name: "Ġużeppi", client_surname: "Borg" + i, telephone: "7900000" + (i % 10), email: "", receipt_number: "R-" + i, amount: 5 + i, expiry_date: i % 3 ? day(-90) : "", no_expiry: i % 3 ? 0 : 1 });
for (let i = 0; i < 12; i++) {
  const r = await api("POST", "/creditnotes/entries", { token: T, body: cn(i) });
  if (i % 4 === 0) await api("POST", "/creditnotes/entries/" + r.json.id + "/purchases", { token: T, body: { amount: 2, receipt_number: "U" + i } });
  if (i % 5 === 0) await api("POST", "/creditnotes/entries/" + r.json.id + "/notes", { token: T, body: { text: "Called " + i } });
}
const labels = { labelHistory: [{ id: "L1", drugName: "Amoxil 500mg" }], templates: [{ id: "tpl_mine", name: "Mine", size: "standard", fields: ["drugName", "pharmacyDetails"] }], pharmacyDetails: { name: "Demo Pharmacy", address: "1, Triq il-Kbira, Ħamrun", phone: "2123 4567", licence: "PH 1" } };
await api("PUT", "/labels/state", { token: T, body: { state: labels } });
for (let i = 0; i < 4; i++) await api("POST", "/client-tickets/entries", { token: T, body: { ticket_id: "", open_date: day(i), client_name: "Paul Vella", phone: "79", email: "", issue: "Stock?", category: "General Enquiry", priority: 2, status: "Open", assigned_to: "", followup_date: null, notes_log: "[]" } });
for (let i = 0; i < 3; i++) await api("POST", "/client-deliveries/entries", { token: T, body: { delivery_id: "", order_date: day(i), scheduled_date: day(i), scheduled_time_slot: "Morning", client_name: "Paul Vella", phone: "79", email: "", delivery_address: "1 Triq", address_notes: "", delivery_method: "In-house Driver", priority: 2, status: "Scheduled", signature_required: 0, signature_obtained: 0, delivery_attempts: 0, contains_controlled: 0, cold_chain_required: 0, items: "[]", delivery_log: "[]", internal_notes: "" } });
await api("PUT", "/endofday/record", { token: T, body: { record: { date: day(2), eod_date: day(2), time_of_day: "PM", staff: "Maria Borg", staff_name: "Maria Borg", float_amount: "150.00", x: [{ amount: "900", remark: "" }], epos: [], cheques: [], paid_outs: [], cash: {}, deposit: {}, bag_number: "B1", notes: "", action: "SAVE" } } });

const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const SKIP = ["sessions", "audit_log", "login_attempts", "eikon_schema"];
const dump = () => { const o = {}; for (const t of tables()) if (!SKIP.includes(t)) o[t] = JSON.stringify(DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all()); return o; };
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all());
const LISTS = ["/auth/me", "/creditnotes/list", "/labels/state", "/client-tickets/entries", "/client-deliveries/entries", "/today", "/registers/today", "/money/today", "/team/today"];
// the new worker's additions, left out to compare: since and hours_saved on the day screens, cn_no on credit notes
const strip = (j) => JSON.stringify(j, (k, v) => (["generated_at", "server_time", "now", "time", "checked_at", "hours_saved", "location_since", "details_saved"].includes(k)) ? undefined : v);
const lists = async () => { const o = {}; for (const p of LISTS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.json); } return o; };
const listsOld = await lists(), tablesOld = tables(), before = dump(), schemaOld = schema();
const oldRoute = await api("GET", "/pharmacy/details", { token: T });
ok(oldRoute.status === 404 || (oldRoute.json && oldRoute.json.ok === false), "the live worker has no /pharmacy/details (" + oldRoute.status + ")");
console.log("old worker:", tablesOld.length, "tables,", JSON.parse(before.credit_notes).length, "credit notes");

// ---- 2. the new worker on the same database
worker = NEW;
const listsNew = await lists();
ok(LISTS.every((p) => listsNew[p] === listsOld[p]), "every list answers the same on the new worker, apart from the new fields (" + LISTS.length + " lists)" + LISTS.filter((p) => listsNew[p] !== listsOld[p]).map((p) => " · " + p).join(""));
const me = (await api("GET", "/auth/me", { token: T })).json.user;
ok(me.location_since === day(2), "/auth/me says when the pharmacy started (" + me.location_since + ": never later than its first saved day)");
ok((await api("GET", "/pharmacy/details", { token: T })).json.since === me.location_since, "/pharmacy/details says the same start");
const g = await api("GET", "/pharmacy/details", { token: T });
ok(g.status === 200 && g.json.details.address === labels.pharmacyDetails.address && g.json.saved === true, "details read what the label screen saved");
const mid = dump();
const changed = Object.keys(before).filter((t) => before[t] !== mid[t]);
ok(changed.length === 0, "reading changed nothing: every row of every table byte-for-byte the same (" + Object.keys(before).length + " tables)" + (changed.length ? ": " + changed.join(", ") : ""));
ok(schema() === schemaOld, "the schema is unchanged (no table, column or index added)");
const p = await api("PUT", "/pharmacy/details", { token: T, body: { ...labels.pharmacyDetails, phone: "2123 9999" } });
const lab = (await api("GET", "/labels/state", { token: T })).json.state;
ok(p.status === 200 && JSON.stringify(lab.templates) === JSON.stringify(labels.templates) && lab.labelHistory.length === 1 && lab.pharmacyDetails.phone === "2123 9999", "the details save keeps the templates and the label history");
const after = dump(), ch2 = Object.keys(before).filter((t) => before[t] !== after[t]);
ok(ch2.length === 1 && ch2[0] === "label_settings", "the save touches only this pharmacy's label_settings row: " + ch2.join(", "));

// ---- 3. rollback: the old worker on the same database
worker = OLD;
const lab2 = (await api("GET", "/labels/state", { token: T })).json.state;
ok(lab2.pharmacyDetails.phone === "2123 9999" && JSON.stringify(lab2.templates) === JSON.stringify(labels.templates), "the old label screen reads the details saved by the new one, templates intact");
ok((await api("PUT", "/labels/state", { token: T, body: { state: lab2 } })).status === 200, "and saves over them as before");
worker = NEW;
ok((await api("GET", "/pharmacy/details", { token: T })).json.details.phone === "2123 9999", "the new worker reads what the old one saved");

console.log(`\ndayzero rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
