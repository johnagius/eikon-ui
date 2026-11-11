// Upgrade rehearsal for Today's money (money-hub): one added READ-ONLY route, GET /money/today. No table, column or index
// is added (it only calls the schema checks its screens already run). The worker as it was (base commit, or
// OLD_WORKER=path) records a money day, then this copy's worker takes over the same database, then the old one again.
// Proves: the schema is identical; every existing row in the six money tables is byte-for-byte unchanged after the
// new route reads; every list the money screens make answers the same; rollback and forward again work.
// Run: node --no-warnings tests/rehearsal/moneytoday-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "moneytoday-rehearsal-"));
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


// ---- 1. the live worker: a busy money day in two pharmacies, odd text
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const rec = (d, x, locked) => ({ record: { date: day(d), eod_date: day(d), time_of_day: "PM", staff: "Ċensina Zammit", staff_name: "Ċensina Zammit", float_amount: "150.00", x: [{ amount: x, remark: "Main \"till\" <b>" }], epos: [{ amount: "300.10", remark: "" }], cheques: [], paid_outs: [{ amount: "12.50", remark: "Milk" }], cash: { n500: "0", n200: "1", n100: "2", n50: "0", n20: "3", n10: "0", n5: "1", coins_total: "41.15" }, deposit: {}, bov_bag_number: "B-1", notes: "ħ" } });
let wrote = 0;
const W = async (m, p, b) => { const r = await api(m, p, { token: T, body: b }); if (r.status === 200) wrote++; return r; };
await W("PUT", "/endofday/record", rec(0, "1234.56")); await W("PUT", "/endofday/record", rec(1, "900")); await W("PUT", "/endofday/record", rec(3, "800"));
await W("POST", "/eod/lock", { eod_date: day(1) });
await W("POST", "/paid-out/entries", { entry_date: day(0), entry_time: "10:15", payee_name: "Ħobża Bakery", fee: "12.50", payment_method: "cash", invoice_no: "I1", cheque_no: "", reason: "Milk" });
await W("POST", "/emergency-pos/sales", { sale_date: day(0), receipt_no: "E1", items: [{ name: "Panadol", qty: 2, price: 3.25, vat_rate: 0 }], payment_method: "cash", amount_tendered: 10, offline_id: "off-1" });
const cn = await W("POST", "/creditnotes/entries", { issue_date: day(5), client_name: "Ġorġ", client_surname: "Borg", telephone: "79000000", email: "", receipt_number: "R1", amount: 25.5, expiry_date: day(-10), no_expiry: 0 });
await W("POST", "/creditnotes/entries/" + cn.json.id + "/purchases", { amount: 5, receipt_number: "R2" });
await W("PUT", "/shifts/opening-hours", { default: { open: "08:00", close: "19:00", closed: false }, openSaturday: true, openSunday: false, overrides: {} });
ok(wrote === 9, "old worker: " + wrote + " money writes (end of day, lock, paid out, emergency sale, credit note and its use, opening hours)");
const TABLES = ["end_of_day", "paid_out_entries", "pos_sales", "credit_notes", "credit_note_purchases", "shift_opening_hours"];
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all());
const snap = () => JSON.stringify(TABLES.map((t) => DB.db.prepare("SELECT * FROM " + t + " ORDER BY id").all()));
const m = malta().slice(0, 7);
const READS = ["/eod/get?date=" + day(0), "/eod/get?date=" + day(1), "/eod/dates?month=" + m, "/paid-out/entries?month=" + m, "/emergency-pos/sales?date=" + day(0), "/creditnotes/list", "/shifts/opening-hours", "/today"];
const strip = (t) => t.replace(/"time":"\d\d:\d\d"/g, "").replace(/"waiting_days":\d+/g, "");
const readAll = async () => { const o = {}; for (const p of READS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.text); } return o; };
const readsOld = await readAll(), schemaOld = schema(), rowsOld = snap(); // the screens' own reads first: their schema checks run on first use
const before = await api("GET", "/money/today", { token: T });
ok(before.status === 404 || !before.json || !before.json.end_of_day, "the old worker has no /money/today (" + before.status + ")");

// ---- 2. the new worker on the same database
worker = NEW;
const r = await api("GET", "/money/today", { token: T });
ok(r.status === 200 && r.json.end_of_day.today.takings === 1234.56 && r.json.end_of_day.today.locked === false, "new worker: today's takings so far from the old worker's record");
ok(r.json.end_of_day.earlier.some((e) => e.date === day(3) && e.state === "unlocked") && !r.json.end_of_day.earlier.some((e) => e.date === day(1)), "the earlier unlocked day found, the locked one not");
ok(r.json.paid_out.total === 12.5 && r.json.emergency.total === 6.5 && r.json.credit_notes.held === 20.5 && r.json.credit_notes.soon === 1, "paid out, emergency till, credit notes held (and expiring) as the screens add them up");
ok(r.json.end_of_day.closes_at === "19:00", "the saved opening hours are read");
{ const a = JSON.parse(schemaOld).map((x) => x.name), b = JSON.parse(schema()).map((x) => x.name); console.log("    added:", b.filter((n) => !a.includes(n)).join(", ") || "none", "removed:", a.filter((n) => !b.includes(n)).join(", ") || "none"); }
ok(schema() === schemaOld, "the schema is identical: no table, column or index added");
ok(snap() === rowsOld, "every existing row is byte-for-byte unchanged in all six money tables");
const readsNew = await readAll();
const diff = READS.filter((p) => readsNew[p] !== readsOld[p]);
ok(!diff.length, "every list the screens make answers the same before and after (" + READS.length + " reads)" + (diff.length ? " differs: " + diff.join(", ") : ""));
const w = await api("POST", "/paid-out/entries", { token: T, body: { entry_date: day(0), entry_time: "12:00", payee_name: "Courier", fee: "7.25", payment_method: "cash", invoice_no: "", cheque_no: "", reason: "" } });
ok(w.status === 200 && (await api("GET", "/money/today", { token: T })).json.paid_out.total === 19.75, "a classic write on the new worker lands and is counted");

// ---- 3. rollback and forward again
worker = OLD;
ok((await api("POST", "/eod/lock", { token: T, body: { eod_date: day(0) } })).status === 200, "after a rollback the old worker locks the day as before");
worker = NEW;
const r3 = (await api("GET", "/money/today", { token: T })).json;
ok(r3.end_of_day.today.locked === true && schema() === schemaOld, "forward again: the lock is read; the schema is still the same");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
