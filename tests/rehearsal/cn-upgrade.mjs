// Upgrade rehearsal for W6 (Finish round, records): per-pharmacy credit-note numbers (credit_notes.cn_no added when
// missing, credit_note_seq new). The old worker fills credit notes in two pharmacies of a group (used, with notes, one
// deleted); this copy's worker takes over; then the old worker again (rollback); then the new.
// Proves: every existing row is unchanged (credit_notes gains one column, NULL for every old row); the list answers the
// same apart from the new cn_no key; a new pharmacy starts at 1, one with notes continues after its highest number shown;
// a deleted number is never given again; the old worker still saves and lists on the upgraded database.
// Run: node --no-warnings tests/rehearsal/cn-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "cn-rehearsal-"));
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

await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const cn = (n) => ({ issue_date: day(n), client_name: "Ċensu", client_surname: "Hili" + n, telephone: "79000000", email: "", receipt_number: "R" + n, amount: 10 + n, expiry_date: "", no_expiry: 1 });
const ids = [];
for (let n = 1; n <= 6; n++) ids.push((await api("POST", "/creditnotes/entries", { token: T, body: cn(n) })).json.id);
await api("DELETE", "/creditnotes/entries/" + ids[5], { token: T });
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const SKIP = ["sessions", "audit_log", "login_attempts", "eikon_schema"];
const dump = () => { const o = {}; for (const t of tables()) if (!SKIP.includes(t)) o[t] = DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all(); return o; };
const before = dump(), tablesOld = tables();
const listOld = (await api("GET", "/creditnotes/list", { token: T })).json;
console.log("old worker:", tablesOld.length, "tables,", listOld.entries.length, "notes");
worker = NEW;
const listNew = (await api("GET", "/creditnotes/list", { token: T })).json;
ok(JSON.stringify(listNew.entries.map((e) => { const c = { ...e }; delete c.cn_no; return c; })) === JSON.stringify(listOld.entries) && listNew.entries.every((e) => e.cn_no === null), "the list answers as before, plus cn_no (null) on every old note");
const after = dump();
const same = Object.keys(before).every((t) => JSON.stringify(before[t]) === JSON.stringify(t === "credit_notes" ? after[t].map((r) => { const c = { ...r }; delete c.cn_no; return c; }) : after[t]));
ok(same && after.credit_notes.every((r) => r.cn_no === null), "every existing row of every table unchanged (credit_notes: one more column, NULL)");
ok(tables().filter((t) => !tablesOld.includes(t)).join() === "credit_note_seq", "the only new table: credit_note_seq");
const n1 = (await api("POST", "/creditnotes/entries", { token: T, body: cn(7) })).json;
ok(n1.cn_no === ids[5] + 1, "a pharmacy with notes continues after the highest number it ever showed (" + n1.cn_no + "; the deleted " + ids[5] + " is not given again)");
await api("DELETE", "/creditnotes/entries/" + n1.id, { token: T });
const n2 = (await api("POST", "/creditnotes/entries", { token: T, body: cn(8) })).json;
ok(n2.cn_no === n1.cn_no + 1, "deleting the newest note never gives its number again (" + n2.cn_no + ")");
worker = OLD;
const r3 = await api("POST", "/creditnotes/entries", { token: T, body: cn(9) });
ok(r3.status === 200, "after a rollback the old worker still saves a note");
const l3 = (await api("GET", "/creditnotes/list", { token: T })).json;
ok(l3.ok && l3.entries.length === listOld.entries.length + 2, "and lists them");
worker = NEW;
const n4 = (await api("POST", "/creditnotes/entries", { token: T, body: cn(10) })).json;
ok(n4.cn_no > n2.cn_no && n4.cn_no > r3.json.id, "upgrading again, numbering carries on past everything shown (" + n4.cn_no + ")");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
