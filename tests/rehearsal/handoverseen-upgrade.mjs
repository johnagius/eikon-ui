// Upgrade rehearsal for the handover "Got it" (Team & shifts, T-C3).
// The worker as it was (base commit, or OLD_WORKER=path) fills a database with a month of handovers (notes and points,
// Maltese text), the standing and how-to instructions and a busy board; this copy's worker takes over, reads every
// day, and two people press Got it; then the old worker again (rollback). Proves: every existing row of every table is
// unchanged (instructions_daily byte-identical); the only schema change is one new table, handover_seen; every read
// answers the same before and after; the old worker ignores the new table and still saves a handover.
// Run: node --no-warnings tests/rehearsal/handoverseen-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "handoverseen-rehearsal-"));
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

// ---- 1. the live worker: a month of handovers, the instructions, a board
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
for (let n = 1; n <= 35; n++) {
  if (n % 7 === 0) continue; // closed days
  const pts = [{ id: "b_" + n + "_1", sev: n % 3 ? "g" : "r", text: "Ċempel lil Mrs Borg dwar l-insulina (" + n + ")", created_at: "2026-10-01T08:00:00.000Z" }];
  if (n % 2) pts.push({ id: "b_" + n + "_2", sev: "y", text: "Ħili Pharma short by 2", created_at: "2026-10-01T09:00:00.000Z" });
  await api("PUT", "/instructions/daily", { token: T, body: { ymd: day(n), notes: n % 4 ? "Inspector may visit" : "", handover_out: pts } });
}
await api("PUT", "/instructions/global", { token: T, body: { global: { opening: { text: "Alarm, lights, shutters", updated_at: "" }, permanent_handover: { text: "Count the CD cupboard every evening", updated_at: "" } } } });
for (let i = 0; i < 20; i++) await api("POST", "/board/messages", { token: T, body: { body: "Message " + i, scope: i % 2 ? "org" : "all" } });
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const dump = (skip) => { const o = {}; for (const t of tables()) if (!skip.includes(t)) o[t] = JSON.stringify(DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all()); return o; };
const LISTS = [...Array.from({ length: 8 }, (_, i) => "/instructions/daily?ymd=" + day(i)), "/instructions/daily?month=" + month, "/instructions/daily?month=" + last, "/instructions/global", "/board/messages?scope=all&before=999999&limit=50", "/board/messages?pinned=1&limit=30"];
const strip = (j) => JSON.stringify(j, (k, v) => (k === "generated_at" || k === "server_time" || k === "now") ? undefined : v);
const lists = async () => { const o = {}; for (const p of LISTS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.json); } return o; };
const listsOld = await lists(), tablesOld = tables(), before = dump(["sessions", "audit_log", "login_attempts", "eikon_schema"]);
const schemaOld = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
const dailyOld = JSON.stringify(DB.db.prepare("SELECT * FROM instructions_daily ORDER BY rowid").all());
console.log("old worker:", DB.db.prepare("SELECT COUNT(*) AS c FROM instructions_daily").get().c, "handover days,", DB.db.prepare("SELECT COUNT(*) AS c FROM board_messages").get().c, "board messages");
const auditOld = JSON.stringify(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all());

// ---- 2. the new worker on the same database
worker = NEW;
const listsNew = await lists();
ok(LISTS.every((p) => listsNew[p] === listsOld[p]), "every handover day, month list, the instructions and the board answer identically (" + LISTS.length + " reads)");
const g0 = await api("GET", "/instructions/daily/seen?ymd=" + day(1), { token: T });
ok(g0.status === 200 && g0.json.seen.length === 0, "nobody has read yesterday's handover yet");
const s1 = await api("POST", "/instructions/daily/seen", { token: T, body: { ymd: day(1) } });
ok(s1.status === 200 && s1.json.seen.user_name === "Maria Borg", "the pharmacist presses Got it");
DB.db.prepare("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) SELECT org_id, 'karl@demo.mt', 'Karl Vella', 'staff', pass_salt_b64, pass_hash_b64, pass_iters, 1, default_location_id FROM users WHERE email = 'maria@demo.mt'").run();
const K = (await api("POST", "/auth/login", { body: { email: "karl@demo.mt", password: "Demo-Pass-2026" } })).json.token;
ok((await api("POST", "/instructions/daily/seen", { token: K, body: { ymd: day(1) } })).status === 200 && (await api("POST", "/instructions/daily/seen", { token: K, body: { ymd: day(1) } })).json.already === true, "staff press Got it; a second press changes nothing");
ok(DB.db.prepare("SELECT COUNT(*) AS c FROM handover_seen").get().c === 2, "one row per person per day");
const added = tables().filter((t) => !tablesOld.includes(t));
ok(added.length === 1 && added[0] === "handover_seen", "the only schema change is one new table: " + added.join(", "));
const after = dump(["sessions", "audit_log", "login_attempts", "eikon_schema", "handover_seen", "users"]);
const schemaNow = DB.db.prepare("SELECT * FROM eikon_schema ORDER BY rowid").all().map((r) => JSON.stringify(r));
ok(schemaOld.every((r) => schemaNow.includes(r)), "the schema bookkeeping keeps every old line (" + (schemaNow.length - schemaOld.length) + " new: the new table's)");
const changed = Object.keys(before).filter((t) => t !== "users" && before[t] !== after[t]);
ok(changed.length === 0, "every row of every existing table is byte-for-byte unchanged (" + (Object.keys(before).length - 1) + " tables; users only gained the test's staff member)" + (changed.length ? ": " + changed.join(", ") : ""));
ok(JSON.stringify(DB.db.prepare("SELECT * FROM instructions_daily ORDER BY rowid").all()) === dailyOld, "instructions_daily is byte-identical after Got it");
const usersOld = JSON.parse(before.users), usersNow = DB.db.prepare("SELECT * FROM users ORDER BY rowid").all();
ok(JSON.stringify(usersNow.slice(0, usersOld.length)) === before.users && usersNow.length === usersOld.length + 1, "every existing user row unchanged (the one more is the test's staff member)");
const auditNow = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all();
ok(JSON.stringify(auditNow.slice(0, JSON.parse(auditOld).length)) === auditOld, "the audit keeps every old entry");
const listsAfter = await lists();
ok(LISTS.every((p) => listsAfter[p] === listsOld[p]), "after Got it every read still answers as before");

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
const lists3 = await lists();
ok(LISTS.every((p) => lists3[p] === listsOld[p]), "after a rollback every read answers as before");
const w3 = await api("PUT", "/instructions/daily", { token: T, body: { ymd: day(0), notes: "After rollback", handover_out: [] } });
ok(w3.status === 200 && DB.db.prepare("SELECT notes FROM instructions_daily WHERE ymd = ?").get(day(0)).notes === "After rollback", "after a rollback the old worker still saves a handover (it ignores the new table)");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
