// Upgrade rehearsal for hotfix .179 (End of day): PUT /endofday/record now refuses an all-zero body over a day that
// has counted figures unless it says confirm_zero: true. No table, column or index is added. The worker as it was (base
// commit, or OLD_WORKER=path) records days, then this copy's worker takes over the same database, then the old one again.
// Proves: the schema is identical; every stored day reads byte-for-byte the same; the saves the screens make (figures,
// a float change with the figures, a new empty day, a lock, an unlock) answer and store the same as the old worker;
// only zeros over figures differ (refused, row unchanged), and confirm_zero clears them; rollback and forward again work.
// Run: node --no-warnings tests/rehearsal/eodzero-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "eodzero-rehearsal-"));
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
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all());
const rows = () => JSON.stringify(DB.db.prepare("SELECT * FROM end_of_day ORDER BY id").all());
const strip = (t) => t.replace(/"(updated_at|saved_at|locked_at|created_at)":"[^"]*"/g, '"$1":"T"').replace(/"(id)":\d+/g, '"$1":0');
const rec = (d, x, extra = {}) => ({ record: { date: d, eod_date: d, time_of_day: "PM", staff: "Ċensina Zammit", staff_name: "Ċensina Zammit", float_amount: "150.00", x: [{ amount: x, remark: "Main \"till\" <b>" }], epos: [{ amount: "300.10", remark: "" }], cheques: [], paid_outs: [{ amount: "12.50", remark: "Ħobż" }], cash: { n50: "6", n20: "9", coins_total: "41.15" }, deposit: { n50: 6, n20: 9 }, bag_number: "B-1", notes: "ok", action: "SAVE", ...extra } });
const zero = (d, extra = {}) => rec(d, "0.00", { epos: [{ amount: "0", remark: "" }], paid_outs: [], cash: { n50: "0", coins_total: "0.00" }, deposit: {}, bag_number: "", ...extra });

await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const P = (b) => api("PUT", "/endofday/record", { token: T, body: b }), G = (d) => api("GET", "/endofday/record?date=" + d, { token: T });
// 1. the old worker: days saved, one locked, one empty
for (const [d, x] of [["2026-09-01", "900.00"], ["2026-09-02", "1234.56"], ["2026-09-03", "800"]]) await P(rec(d, x));
await P(zero("2026-09-04"));
await P(rec("2026-09-03", "800", { locked_at: new Date().toISOString(), action: "LOCK" }));
const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
const readOld = []; for (const d of days) readOld.push((await G(d)).text);
// the same saves on both workers, each on its own fresh day, compared
async function sequence(prefix) {
  const out = [];
  const d1 = prefix + "-10", d2 = prefix + "-11";
  out.push((await P(rec(d1, "500.00"))).status, (await P(rec(d1, "500.00", { float_amount: "160.00" }))).status, (await P(zero(d2))).status, (await P(zero(d2, { float_amount: "90" }))).status);
  out.push((await P(rec(d1, "500.00", { locked_at: new Date().toISOString(), action: "LOCK" }))).status, (await P({ record: { date: d1, eod_date: d1, unlock: true, action: "UNLOCK", locked_at: "" } })).status);
  out.push(strip((await G(d1)).text), strip((await G(d2)).text));
  return out;
}
const seqOld = await sequence("2026-07");
const schemaOld = schema(), rowsOld = rows();
// 2. the new worker takes over
worker = NEW;
const readNew = []; for (const d of days) readNew.push((await G(d)).text);
ok(readNew.every((t, i) => t === readOld[i]), "every stored day reads byte-for-byte the same");
ok(schema() === schemaOld && rows() === rowsOld, "the schema and every row are unchanged by the new worker's reads");
const seqNew = await sequence("2026-08");
ok(JSON.stringify(seqNew.slice(0, 6)) === JSON.stringify(seqOld.slice(0, 6)), "the screens' saves answer the same: " + seqNew.slice(0, 6).join(","));
ok(seqNew[6].replace(/2026-08/g, "X") === seqOld[6].replace(/2026-07/g, "X") && seqNew[7].replace(/2026-08/g, "X") === seqOld[7].replace(/2026-07/g, "X"), "and store the same");
const before = rows(), r = await P(zero("2026-09-01"));
ok(r.status === 409 && r.json.code === "would_clear_figures" && rows() === before, "zeros over figures: refused, nothing changed");
ok((await P(zero("2026-09-03"))).json.error === "Locked - cannot update", "a locked day answers as before");
ok((await P(zero("2026-09-02", { confirm_zero: true }))).status === 200 && JSON.parse((await G("2026-09-02")).text).record.x[0].amount === "0.00", "confirm_zero clears them");
// 3. rollback: the old worker on the new worker's rows, then forward again
worker = OLD;
ok((await G("2026-08-10")).status === 200 && (await P(rec("2026-09-02", "777.00"))).status === 200, "rollback: the old worker reads and saves the new worker's days");
ok(schema() === schemaOld, "rollback: the schema is still the same");
worker = NEW;
ok(JSON.parse((await G("2026-09-02")).text).record.x[0].amount === "777.00" && (await P(zero("2026-09-02"))).status === 409, "forward again: the old worker's save is read; the guard holds");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
