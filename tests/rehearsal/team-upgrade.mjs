// Upgrade rehearsal for team sign-ins (backlog 2 item 4), adapted from design/eikon-next/upgrade-rehearsal.mjs.
// The worker as it was (base commit, or OLD_WORKER=path) builds a database with every kind of existing account,
// then this copy's worker takes over the same database, then the old one again (rollback).
// Proves: existing accounts, passwords, sessions and roles keep working exactly; nobody existing is asked to change
// a password; session length is unchanged; the only schema change is one added column that reads 0 for everyone.
// Run: node --no-warnings tests/rehearsal/team-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "team-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? (await import("node:fs")).readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "john@eikon.mt", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
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
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10), month = day(0).slice(0, 7);
async function insertUser(orgId, locId, email, role, active, pw) {
  const enc = new TextEncoder(); const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  DB.db.prepare("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(orgId, email, email.split("@")[0], role, b64(salt), b64(new Uint8Array(bits)), 100000, active, locId);
}

// ---- 1. the live worker: every kind of account that exists today
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Other')").run();
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (600, 1, 'Head Office')").run();
const PEOPLE = [
  ["maria@demo.mt", "Demo-Pass-2026", "admin", 1],
  ["staff@demo.mt", "Staff-Pass-2026", "staff", 1, 1, 1],
  ["legacy@demo.mt", "Legacy-Pass-2026", "user", 1, 1, 1],
  ["admin2@demo.mt", "Admin2-Pass-2026", "admin", 1, 1, 1],
  ["branch@demo.mt", "Branch-Pass-2026", "admin", 1, 1, 2],
  ["other@demo.mt", "Other-Pass-2026", "admin", 1, 2, 50],
  ["ho@demo.mt", "Ho-Pass-2026", "admin", 1, 1, 600],
  ["john@eikon.mt", "John-Pass-2026", "admin", 1, 1, 1],
  ["leaver@demo.mt", "Leaver-Pass-2026", "staff", 0, 1, 1]
];
for (const [e, pw, role, act, o, l] of PEOPLE.slice(1)) await insertUser(o, l, e, role, act, pw);
const tok = {}, loginOld = {}, meOld = {};
for (const [e, pw] of PEOPLE) { const L = await api("POST", "/auth/login", { body: { email: e, password: pw } }); loginOld[e] = L; if (L.json && L.json.token) tok[e] = L.json.token; }
ok(!tok["leaver@demo.mt"] && Object.keys(tok).length === PEOPLE.length - 1, "old worker: every active account signs in, the switched-off one does not");
const T = tok["maria@demo.mt"];
const devs = (await api("GET", "/temperature/devices", { token: T })).json?.devices || [];
for (const dv of devs.slice(0, 2)) await api("POST", "/temperature/entries", { token: T, body: { device_id: dv.id, entry_date: day(1), min_temp: 3.2, max_temp: 6.1 } });
await api("POST", "/cleaning/entries", { token: tok["staff@demo.mt"], body: { entry_date: day(1), time_in: "08:00", time_out: "08:40", cleaner_name: "Karl", staff_name: "Staff", notes: "" } });
// What each person can and cannot open today (role access).
const PROBES = ["/auth/me", "/today", "/temperature/devices", "/temperature/entries?month=" + month, "/cleaning/entries?month=" + month, "/audit?limit=5", "/team/users", "/su/api/overview"];
const strip = (j) => JSON.stringify(j, (k, v) => (k === "token" || k === "generated_at" || k === "server_time" || k === "now") ? undefined : v);
const probe = async () => { const o = {}; for (const e of Object.keys(tok)) for (const p of PROBES) { const r = await api("GET", p, { token: tok[e] }); o[e + " " + p] = r.status; } return o; };
const probesOld = await probe();
for (const e of Object.keys(tok)) meOld[e] = strip((await api("GET", "/auth/me", { token: tok[e] })).json);
const userCols = DB.db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
const usersOld = JSON.stringify(DB.db.prepare("SELECT " + userCols.join(",") + " FROM users ORDER BY id").all());
const sessOld = JSON.stringify(DB.db.prepare("SELECT * FROM sessions ORDER BY id").all());
const ttlOf = (L) => { const s = DB.db.prepare("SELECT expires_at FROM sessions WHERE user_id = ? ORDER BY id DESC").get(L.json.user.id); return Math.round((new Date(s.expires_at) - Date.now()) / 1000); };
console.log("old worker:", PEOPLE.length, "accounts (admin, staff, legacy 'user', second admin, branch, other group, head office, superuser, switched off),", Object.keys(tok).length, "open sessions");

// ---- 2. the new worker on the same database
worker = NEW;
let sameMe = 0; for (const e of Object.keys(tok)) { const r = await api("GET", "/auth/me", { token: tok[e] }); if (r.status === 200 && strip(r.json) === meOld[e]) sameMe++; else console.log("   /auth/me differs for", e, r.status, r.text.slice(0, 160)); }
ok(sameMe === Object.keys(tok).length, `every session signed in on the old worker answers /auth/me identically on the new one (${sameMe}/${Object.keys(tok).length})`);
const cols2 = DB.db.prepare("PRAGMA table_info(users)").all();
const added = cols2.filter((c) => !userCols.includes(c.name));
ok(added.length === 1 && added[0].name === "must_change_password" && String(added[0].dflt_value) === "0", "the only schema change to users is one added column, default 0: " + added.map((c) => c.name + " default " + c.dflt_value).join(", "));
ok(DB.db.prepare("SELECT COUNT(*) AS c FROM users WHERE must_change_password <> 0").get().c === 0, "every existing account reads must_change_password = 0 (nobody is asked to change a password)");
ok(JSON.stringify(DB.db.prepare("SELECT " + userCols.join(",") + " FROM users ORDER BY id").all()) === usersOld, "every existing users row is byte-for-byte unchanged in its old columns");
ok(JSON.stringify(DB.db.prepare("SELECT * FROM sessions ORDER BY id").all()) === sessOld, "every existing session row is unchanged (none ended, none extended)");
const probesNew = await probe();
const diffs = Object.keys(probesOld).filter((k) => probesOld[k] !== probesNew[k] && !k.endsWith(" /team/users"));
ok(diffs.length === 0, "every person opens exactly the same screens with the same answers (" + Object.keys(probesOld).length + " probes)" + (diffs.length ? ": " + diffs.map((k) => k + " " + probesOld[k] + "→" + probesNew[k]).join("; ") : ""));
const teamNew = Object.keys(tok).map((e) => e + "=" + probesNew[e + " /team/users"]).join(", ");
ok(Object.keys(tok).every((e) => probesNew[e + " /team/users"] === (PEOPLE.find((p) => p[0] === e)[2] === "admin" ? 200 : 403)), "the new /team/users opens for admins only: " + teamNew);
let sameLogin = 0, ttlSame = 0;
for (const [e, pw] of PEOPLE) {
  const L = await api("POST", "/auth/login", { body: { email: e, password: pw } });
  const o = loginOld[e];
  if (L.status === o.status && strip(L.json) === strip(o.json)) sameLogin++; else console.log("   login differs for", e, o.status, "→", L.status, L.text.slice(0, 160));
  if (L.json && L.json.token) { const t = ttlOf(L); if (Math.abs(t - 2592000) <= 2) ttlSame++; else console.log("   ttl", e, t); }
}
ok(sameLogin === PEOPLE.length, `every account signs in (or is refused) with the same answer as before, no must_change (${sameLogin}/${PEOPLE.length})`);
ok(ttlSame === PEOPLE.length - 1, "sessions still last SESSION_TTL_SECONDS (30 days here), as before");
// Use the new feature and check nobody else was touched.
const usersMid = JSON.stringify(DB.db.prepare("SELECT * FROM users ORDER BY id").all());
const sessMid = DB.db.prepare("SELECT id, user_id, token_hash_b64, expires_at FROM sessions ORDER BY id").all();
const c = await api("POST", "/team/users", { token: T, body: { email: "newbie@demo.mt", full_name: "New Bie", role: "staff" } });
ok(c.status === 200 && !!c.json.temporary_password, "maria adds a new staff sign-in on the new worker");
const r1 = await api("POST", "/team/users", { token: T, body: { email: "john@eikon.mt", full_name: "x" } });
const r2 = await api("POST", "/team/users/" + DB.db.prepare("SELECT id FROM users WHERE email='john@eikon.mt'").get().id + "/password", { token: T });
const r3 = await api("POST", "/team/users/" + DB.db.prepare("SELECT id FROM users WHERE email='admin2@demo.mt'").get().id + "/active", { token: T, body: { active: false } });
const r4 = await api("POST", "/team/users/" + DB.db.prepare("SELECT id FROM users WHERE email='other@demo.mt'").get().id + "/password", { token: T });
const r5 = await api("POST", "/team/users/" + DB.db.prepare("SELECT id FROM users WHERE email='branch@demo.mt'").get().id + "/active", { token: T, body: { active: false } });
ok([r1.status, r2.status, r3.status, r4.status, r5.status].join() === "403,403,403,404,404", "refused: superuser e-mail, superuser reset, another admin, another group, another branch: " + [r1.status, r2.status, r3.status, r4.status, r5.status].join(","));
const usersAfter = DB.db.prepare("SELECT * FROM users ORDER BY id").all();
ok(JSON.stringify(usersAfter.filter((u) => u.email !== "newbie@demo.mt")) === usersMid, "using Team changed no existing account (only the new row was added)");
const sessAfter = DB.db.prepare("SELECT id, user_id, token_hash_b64, expires_at FROM sessions ORDER BY id").all();
ok(sessMid.every((s) => sessAfter.some((a) => JSON.stringify(a) === JSON.stringify(s))), "using Team ended no existing session");
const NB = await api("POST", "/auth/login", { body: { email: "newbie@demo.mt", password: c.json.temporary_password } });
ok(NB.json?.must_change === true && (await api("GET", "/today", { token: NB.json.token })).status === 403, "only the new sign-in must set its own password first");

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
let sameMe3 = 0; for (const e of Object.keys(tok)) { const r = await api("GET", "/auth/me", { token: tok[e] }); if (r.status === 200 && strip(r.json) === meOld[e]) sameMe3++; }
ok(sameMe3 === Object.keys(tok).length, `after a rollback every old session still answers the same (${sameMe3}/${Object.keys(tok).length})`);
let login3 = 0; for (const [e, pw] of PEOPLE) { const L = await api("POST", "/auth/login", { body: { email: e, password: pw } }); if (L.status === loginOld[e].status) login3++; }
ok(login3 === PEOPLE.length, "after a rollback every account signs in as before");
const probes3 = await probe();
ok(Object.keys(probesOld).every((k) => probesOld[k] === probes3[k]), "after a rollback every person opens the same screens");
const NB3 = await api("POST", "/auth/login", { body: { email: "newbie@demo.mt", password: c.json.temporary_password } });
ok(NB3.status === 200, "after a rollback the new sign-in still works (the old worker ignores must_change: it can use the app with its temporary password)");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
