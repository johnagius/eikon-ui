// Upgrade rehearsal for Today's services (svc-hub): one added READ-ONLY route, GET /services/today. No table, column or
// index is added (it only calls the schema checks its screens already run, and reads vax's vaccinations table only if it
// is there). The worker as it was (base commit, or OLD_WORKER=path) records a services day, then this copy's worker takes
// over the same database, then the old one again. Proves: the schema is identical; every existing row in the services
// tables is byte-for-byte unchanged after the new route reads; every list the screens make answers the same; rollback
// and forward again work.
// Run: node --no-warnings tests/rehearsal/svctoday-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "svctoday-rehearsal-"));
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


// ---- 1. the live worker: a services day, odd text
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
let wrote = 0;
const W = async (m, p, b) => { const r = await api(m, p, { token: T, body: b }); if (r.status === 200 || r.status === 201) wrote++; else console.log("    write", p, r.status, r.text.slice(0, 120)); return r; };
await W("PUT", "/pharmacovigilance/state", { state: { reports: [{ id: "pv_r1", status: "Draft", report_date: day(4), pt_initials: "Ġ.\"B\"", reaction_meddra: "Rash", reaction_seriousness: "Serious – Other medically important", drugs: [{ name: "Amoxil <b>500</b>" }] },
  { id: "pv_r2", status: "Submitted to MPA", report_date: day(9), reaction_meddra: "Nausea", drugs: [] }], deleted_ids: [] } });
await W("PUT", "/screening/state", { state: { campaigns: [{ id: "c_r1", name: "Ħamrun BP week", type: "Blood Pressure Check", startDate: day(2), endDate: day(-2), status: "Active", targetScreenings: "30",
  participants: [{ id: "p_r1", name: "Ċensu Borg", date: day(0), followUps: [{ id: "f_r1", scheduledDate: day(1), reason: "Recheck", status: "Pending", notes: "" }] }] }], deleted_ids: [] } });
await W("PUT", "/poct/state", { records: [{ id: "r_r1", testType: "bp", testLabel: "Blood Pressure", performedAtIso: new Date().toISOString(), performedAtLocal: day(0) + "T10:00", patient: { patientId: "0000123M", name: "Ċensu Borg", phone: "79000000" }, results: { sys: 150, dia: 95 } }],
  patients: [{ patientId: "0000123M", name: "Ċensu Borg", phone: "79000000" }] });
await W("POST", "/vaccines/stock/rows", { vaccine_name: "Vaxigrip Tetra", qty: 3, batch: "VX\"1\"", expiry_date: day(-10) });
await W("POST", "/vaccines/orders", { section: "other", client_first: "Ġużeppi", client_last: "Żammit", phone: "79111111", items: [{ vaccine_name: "Vaxigrip Tetra", qty: 1 }] });
const pr = await W("POST", "/bookings/providers", { name: "Maria Borg", kind: "pharmacist", hours: { 1: [["00:00", "23:59"]], 2: [["00:00", "23:59"]], 3: [["00:00", "23:59"]], 4: [["00:00", "23:59"]], 5: [["00:00", "23:59"]], 6: [["00:00", "23:59"]], 0: [["00:00", "23:59"]] } });
const sv = await W("POST", "/bookings/services", { name: "Flu vaccine", durationMin: 10, bufferMin: 0, priceCents: 1500, providerIds: [pr.json && pr.json.provider && pr.json.provider.id] });
await W("POST", "/bookings", { serviceId: sv.json && sv.json.service && sv.json.service.id, date: day(-1), start: "10:00", personName: "Rita Ħili", personPhone: "79222222" });
ok(wrote >= 8, "old worker: " + wrote + " services writes (reports, campaign, test, vaccine stock and order, Bookings set-up and a booking)");
const TABLES = ["pv_reports", "screening_campaigns", "poct_records", "poct_patients", "vaccines_stock", "vaccines_orders", "vaccines_order_items", "bk_services", "bk_providers", "bk_bookings"];
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all());
const snap = () => JSON.stringify(TABLES.map((t) => DB.db.prepare("SELECT * FROM " + t + " ORDER BY id").all()));
const READS = ["/pharmacovigilance/state", "/screening/state", "/poct/state", "/vaccines/stock/rows", "/vaccines/orders", "/bookings/setup", "/bookings?from=" + day(0) + "&to=" + day(-2), "/today"];
const strip = (t) => t.replace(/"time":"\d\d:\d\d"/g, "").replace(/"now":"[^"]*"/g, "");
const readAll = async () => { const o = {}; for (const p of READS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.text); } return o; };
const readsOld = await readAll(), schemaOld = schema(), rowsOld = snap(); // the screens' own reads first: their schema checks run on first use
const before = await api("GET", "/services/today", { token: T });
ok(before.status === 404 || !before.json || !before.json.pv, "the old worker has no /services/today (" + before.status + ")");

// ---- 2. the new worker on the same database
worker = NEW;
const r = await api("GET", "/services/today", { token: T });
ok(r.status === 200 && r.json.pv.drafts === 1 && r.json.pv.serious === 1, "new worker: the report not sent yet, from the old worker's record");
ok(r.json.followups.count === 1 && r.json.followups.overdue === 1 && r.json.screening.running.length === 1 && r.json.screening.running[0].today === 1, "the follow-up overdue and the campaign running");
ok(r.json.poct.today === 1 && r.json.vaccines.orders_today === 1 && r.json.vaccines.expiring30 === 1 && r.json.vaccines.due === null, "the test and vaccine order today, the batch expiring; no doses due without vax's table " + JSON.stringify([r.json.poct, r.json.vaccines]));
{ const a = JSON.parse(schemaOld).map((x) => x.name), b = JSON.parse(schema()).map((x) => x.name); console.log("    added:", b.filter((n) => !a.includes(n)).join(", ") || "none", "removed:", a.filter((n) => !b.includes(n)).join(", ") || "none"); }
ok(schema() === schemaOld, "the schema is identical: no table, column or index added");
ok(snap() === rowsOld, "every existing row is byte-for-byte unchanged in all " + TABLES.length + " services tables");
const readsNew = await readAll();
const diff = READS.filter((p) => readsNew[p] !== readsOld[p]);
ok(!diff.length, "every list the screens make answers the same before and after (" + READS.length + " reads)" + (diff.length ? " differs: " + diff.join(", ") : ""));
const w = await api("PUT", "/pharmacovigilance/state", { token: T, body: { state: { reports: [{ id: "pv_r1", status: "Submitted to MPA", report_date: day(4), reaction_meddra: "Rash", drugs: [] }], deleted_ids: [] } } });
ok(w.status === 200 && (await api("GET", "/services/today", { token: T })).json.pv.drafts === 0, "a classic write on the new worker lands and is counted (report sent: none left)");

// ---- 3. rollback and forward again
worker = OLD;
ok((await api("GET", "/pharmacovigilance/state", { token: T })).json.reports.length === 2, "after a rollback the old worker reads the reports as before");
worker = NEW;
ok((await api("GET", "/services/today", { token: T })).status === 200 && schema() === schemaOld, "forward again: answers; the schema is still the same");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
