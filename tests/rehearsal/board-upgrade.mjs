// Upgrade rehearsal for the board cost change (Team round 2): the board list, its refresh, the pinned list and
// /board/dashboard now read through two added indexes (CREATE INDEX IF NOT EXISTS idx_board_msg_scope_id,
// idx_board_msg_org_scope_id); the 30-pinned cap is per group. No table or column is added
// and no row is changed by the upgrade. The worker as it was (base commit, or OLD_WORKER=path) records a board (posts
// through its own API in two groups, pins, mentions, read marks, plus 5,000 bulk messages), then this copy's worker takes
// over the same database, then the old one again. Proves: only those two indexes (and the board's schema mark) are
// added; every existing row in the board tables is byte-for-byte unchanged after the new worker reads; every list the
// screens make answers the same (the dashboard's unread count now stops at 100); a pin and a post on the new worker
// land; rollback and forward again work.
// Run: node --no-warnings tests/rehearsal/board-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "board-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = OLD;
const quiet = console.log; console.log = () => {};
async function api(method, path, { body, token, form } = {}) {
  const h = new Headers(); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + path, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; quiet((c ? "  ok   " : "  FAIL ") + m); };

// ---- 1. the live worker: a board in two groups, odd text, pins, mentions, read marks
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Sliema')").run();
DB.db.prepare("INSERT INTO orgs (id, name) VALUES (4, 'Supplier Ltd')").run();
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (450, 4, 'Depot')").run();
const login = async (email, password) => (await api("POST", "/auth/login", { body: { email, password } })).json.token;
const T = await login("maria@demo.mt", "Demo-Pass-2026");
async function addUser(org, loc, email) {
  const enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode("Passw0rd!"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  DB.db.prepare(`INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,1,?)`)
    .run(org, email, email.split("@")[0], "admin", Buffer.from(salt).toString("base64"), Buffer.from(new Uint8Array(bits)).toString("base64"), 100000, loc);
  return login(email, "Passw0rd!");
}
const TB = await addUser(1, 2, "branch@demo.mt"), TO = await addUser(2, 50, "sliema@other.mt"), TS = await addUser(4, 450, "depot@sup.mt");
let wrote = 0;
const W = async (tk, m, p, b) => { const r = await api(m, p, { token: tk, body: b }); if (r.status === 200) wrote++; else quiet("    write", p, r.status, r.text.slice(0, 120)); return r; };
const p1 = await W(T, "POST", "/board/messages", { body: "Group only: staff meeting @Branch ċ ġ ħ ż", scope: "org" });
const p2 = await W(T, "POST", "/board/messages", { body: "Everyone: Ozempic 1mg? \"quoted\" <b>x</b> @Sliema", scope: "all" });
const p3 = await W(TO, "POST", "/board/messages", { body: "Other group private @Sliema", scope: "org" });
await W(TS, "POST", "/board/messages", { body: "Supplier: new price list #suggestion", scope: "all" });
await W(T, "PUT", "/board/messages/" + p1.json.id + "/pin", {});
await W(TO, "PUT", "/board/messages/" + p3.json.id + "/pin", {});
await W(TO, "PUT", "/board/messages/" + p2.json.id + "/pin", {});
// 5,000 more as the old worker stores them (bulk, both scopes, four groups)
{ const ins = DB.db.prepare("INSERT INTO board_messages (org_id, location_id, user_id, user_name, location_name, org_name, body, scope, created_at, updated_at) VALUES (?, ?, 1, 'Bulk', 'Bulk', 'Bulk', ?, ?, datetime('now', ?), datetime('now', ?))");
  DB.db.exec("BEGIN"); for (let i = 0; i < 5000; i++) { const org = [1, 2, 2, 4][i % 4], sc = i % 3 ? "org" : "all", ago = "-" + (5000 - i) + " minutes"; ins.run(org, org, "bulk " + i, sc, ago, ago); } DB.db.exec("COMMIT"); }
await W(TB, "GET", "/board/messages?scope=all&limit=50"); // the branch opened the board once (read mark)
ok(wrote >= 8, "old worker: " + wrote + " board writes (posts in three groups, pins, a read mark) + 5,000 bulk messages");
const TABLES = ["board_messages", "board_mentions", "board_user_state", "board_suggestions"];
const schema = () => DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
const snap = () => JSON.stringify(TABLES.map((t) => DB.db.prepare("SELECT * FROM " + t + " ORDER BY " + (t === "board_user_state" ? "user_id" : "id")).all()));
const marks = () => JSON.stringify(DB.db.prepare("SELECT k, v FROM eikon_schema WHERE k != 'ensureBoardSchema' ORDER BY k").all());
const maxId = DB.db.prepare("SELECT MAX(id) AS m FROM board_messages").get().m;
const READS = ["/board/dashboard", "/board/messages?scope=all&limit=50", "/board/messages?scope=org&limit=50", "/board/messages?pinned=1&limit=30", "/board/messages?scope=all&limit=50&before=" + (maxId - 2000),
  "/board/messages?scope=all&limit=50&after=" + (maxId - 20), "/board/mentions", "/board/suggestions"]; // the dashboard first: a fresh list open moves the read mark
// read without moving the read marks: the after/before/pinned ones and the dashboard never write; fresh opens do (MAX) — restore them
const readAll = async () => { const o = {}; const st = DB.db.prepare("SELECT * FROM board_user_state").all();
  for (const tk of [T, TB, TO, TS]) for (const p of READS) { const r = await api("GET", p, { token: tk }); o[tk.slice(0, 6) + p] = r.status + " " + r.text; }
  DB.db.exec("DELETE FROM board_user_state"); for (const r of st) DB.db.prepare("INSERT INTO board_user_state VALUES (?, ?)").run(r.user_id, r.last_read_id);
  return o; };
const readsOld = await readAll(), schemaOld = schema(), rowsOld = snap(), marksOld = marks();
{ const d = (await api("GET", "/board/dashboard", { token: TO })).json; ok(d.unread_messages > 100, "the other group has " + d.unread_messages + " unread on the old dashboard (the new one says 100 = \"99+\", John 2026-11-10)"); }
// Owner decision (2026-11-10): /board/dashboard unread_messages exact up to 99, then 100 ("99+"). The old answer with
// that cap applied is what the new worker must give, byte for byte; everything else unchanged.
const capDash = (k, v) => { if (!k.endsWith("/board/dashboard") || !v.startsWith("200 ")) return v; const o = JSON.parse(v.slice(4)); if (o.unread_messages >= 100) o.unread_messages = 100; return "200 " + JSON.stringify(o); };

// ---- 2. the new worker on the same database
worker = NEW;
const readsNew = await readAll();
const added = schema().filter((x) => !schemaOld.some((y) => y.name === x.name)), removed = schemaOld.filter((x) => !schema().some((y) => y.name === x.name));
quiet("    added:", added.map((x) => x.name).join(", ") || "none", "| removed:", removed.map((x) => x.name).join(", ") || "none");
ok(added.length === 2 && added.every((x) => x.type === "index" && x.tbl_name === "board_messages") && !removed.length, "only the two board indexes are added; nothing removed");
ok(JSON.stringify(schema().filter((x) => x.type === "table")) === JSON.stringify(schemaOld.filter((x) => x.type === "table")), "every table definition is identical (no column added)");
ok(snap() === rowsOld, "every existing row is byte-for-byte unchanged in all " + TABLES.length + " board tables (" + JSON.parse(rowsOld)[0].length + " messages)");
ok(marks() === marksOld, "no other schema step re-ran (only the board's mark changes)");
const diff = Object.keys(readsOld).filter((k) => readsNew[k] !== capDash(k, readsOld[k]));
const capped = Object.keys(readsOld).filter((k) => readsOld[k] !== capDash(k, readsOld[k]) && JSON.parse(readsNew[k].slice(4)).unread_messages === 100).length;
ok(!diff.length && capped >= 1, "every list the screens make answers the same for four users in three groups (" + Object.keys(readsOld).length + " reads; " + capped + " dashboard(s) over 99 unread now say 100)" + (diff.length ? " differs: " + diff.join(", ") : ""));
const np = await api("POST", "/board/messages", { token: TO, body: { body: "New worker post", scope: "org" } });
const pn = await api("PUT", "/board/messages/" + np.json.id + "/pin", { token: TO, body: {} });
ok(np.status === 200 && pn.json.is_pinned === 1, "a post and a pin on the new worker land");
const seenBy = async (tk) => ((await api("GET", "/board/messages?pinned=1&limit=30", { token: tk })).json.messages || []).map((m) => m.id);
ok((await seenBy(TO)).includes(np.json.id) && !(await seenBy(T)).includes(np.json.id) && !(await seenBy(TS)).includes(np.json.id), "the new group-only pin stays in its group");

// ---- 3. rollback and forward again
worker = OLD;
const rb = await api("GET", "/board/messages?scope=org&limit=50", { token: TO });
ok(rb.status === 200 && rb.text.includes("New worker post") && (await api("GET", "/board/dashboard", { token: T })).status === 200, "after a rollback the old worker reads the board as before (the added indexes do not get in its way)");
ok((await api("POST", "/board/messages", { token: T, body: { body: "Old worker again", scope: "all" } })).status === 200, "and writes to it");
worker = NEW;
const fw = await api("GET", "/board/messages?scope=all&limit=50", { token: TS });
ok(fw.status === 200 && fw.text.includes("Old worker again") && !fw.text.includes("New worker post"), "forward again: answers, the supplier sees everyone's messages and no group's private one");
quiet(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
