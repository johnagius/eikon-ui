// Upgrade rehearsal for roles (finish round): the rights matrix of every EXISTING account, before vs after.
// Data: the predeploy database (tools/predeploy.mjs, ~55k rows over 21 pharmacies, filled by the OLD worker):
//   node --no-warnings tools/predeploy.mjs --old old.js --skip-tests --rows 55000 --work <dir> --save-old <db> --stop-after-fill
// Then: node --no-warnings tests/rehearsal/roles-upgrade.mjs <db> [old-worker-file]   (old default: the base commit)
// 1 the old worker adds every kind of account that exists today (admin, second admin, staff, legacy "user", switched off,
//   head office 650, supplier 450, another group, a support e-mail) and a rota at their pharmacy; every one signs in.
// 2 rights matrix under the old worker: every account × every route family (reads, and writes run on a copy of the
//   database that is thrown away after each call): the HTTP status.
// 3 the new worker takes over the same file (the same sessions): the same matrix. Must be identical except
//   "answer own leave" for a non-admin (W4, now 403). Every existing account still signs in with its password; every
//   session still answers; users / sessions / shift_* rows identical on their old columns; the only schema change is
//   the added columns (users.is_pharmacist 0, users.plans_rota NULL, shift_staff.user_id NULL for every row).
// 4 rollback: the old worker again on the upgraded file: its matrix equals step 2.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(path.join(ROOT, "tests/worker/d1shim.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (u) => { throw new Error("rehearsal: network refused " + String(u).slice(0, 60)); };
const SRC_DB = process.argv[2];
if (!SRC_DB || !fs.existsSync(SRC_DB)) { console.error("usage: roles-upgrade.mjs <predeploy old db> [old worker file]"); process.exit(2); }
const WORK = fs.mkdtempSync(path.join(path.dirname(path.resolve(SRC_DB)), "roles-rehearsal-"));
const oldFile = path.join(WORK, "old.mjs"), newFile = path.join(WORK, "new.mjs");
if (process.argv[3]) fs.copyFileSync(process.argv[3], oldFile);
else fs.writeFileSync(oldFile, execFileSync("git", ["-C", ROOT, "show", execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim() + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
fs.copyFileSync(path.join(ROOT, "cloudflare-worker/code"), newFile);
let isoN = 0;
async function isolate(file) { const d = path.join(WORK, "iso-" + (++isoN) + ".mjs"); fs.copyFileSync(file, d); const m = (await import(pathToFileURL(d).href)).default; fs.unlinkSync(d); return m; }
const quiet = () => {}; const out = console.log.bind(console);
console.log = quiet; console.info = quiet; console.warn = quiet; console.error = quiet; console.debug = quiet;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; out((c ? "  ok   " : "  FAIL ") + m); };

const LIVE = path.join(WORK, "live.db");
fs.copyFileSync(SRC_DB, LIVE);
let DB = new D1Shim(LIVE);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "john@eikon.mt", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = await isolate(oldFile);
async function api(method, p, { body, token } = {}) {
  const h = new Headers(); let payload;
  if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + p, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const PW = "Demo-Pass-2026";
async function insertUser(org, loc, email, name, role, active) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(PW), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  DB.db.prepare("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(org, email, name, role, Buffer.from(salt).toString("base64"), Buffer.from(new Uint8Array(bits)).toString("base64"), 100000, active, loc);
}

// ---- 1. every kind of account that exists today, under the old worker
const L7 = 7; // Maria's pharmacy in the predeploy data
for (const [id, name] of [[450, "Medi Supplies"], [650, "Head Office"]]) DB.db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (?, 1, ?)").run(id, name);
const PEOPLE = [ // email, name, role, active, org, loc
  ["karl@demo.mt", "Karl Borg", "staff", 1, 1, L7], ["rita@demo.mt", "Rita Grech", "staff", 1, 1, L7], ["legacy@demo.mt", "Lino Limited", "user", 1, 1, L7],
  ["admin2@demo.mt", "Anna Second", "admin", 1, 1, L7], ["john@eikon.mt", "John Support", "admin", 1, 1, L7], ["leaver@demo.mt", "Leo Leaver", "staff", 0, 1, L7],
  ["ho@demo.mt", "Helen Office", "admin", 1, 1, 650], ["supplier@demo.mt", "Sam Supplier", "admin", 1, 1, 450]];
for (const [e, n, r, a, o, l] of PEOPLE) await insertUser(o, l, e, n, r, a);
const ALL = ["maria@demo.mt", "branch@demo.mt", "other@demo.mt"].concat(PEOPLE.map((p) => p[0]));
const tok = {};
for (const e of ALL) { const L = await api("POST", "/auth/login", { body: { email: e, password: PW } }); if (L.json && L.json.token) tok[e] = L.json.token; }
ok(!tok["leaver@demo.mt"] && Object.keys(tok).length === ALL.length - 1, "old worker: every active account signs in (" + (ALL.length - 1) + "), the switched-off one does not");
const T = tok["maria@demo.mt"];
// A rota at Maria's pharmacy, made through the old worker the way the screens make it.
const mkStaff = async (full_name, email) => (await api("POST", "/shifts/staff", { token: T, body: { full_name, designation: "assistant", employment_type: "fulltime", contracted_hours: 40, email, phone: "", registration_number: "", patterns_json: "[]" } })).json.staff_id;
const S = { karl: await mkStaff("Karl Borg", "karl@demo.mt"), rita: await mkStaff("Rita Grech", "rita@demo.mt"), maria: await mkStaff("Maria Borg", "maria@demo.mt") };
const mkShift = async (t, sid) => (await api("POST", "/shifts/assignments", { token: t, body: { staff_id: sid, shift_date: "2026-12-02", start_time: "08:00", end_time: "14:00", notes: "" } })).json.shift_id;
const SH = { karl: await mkShift(T, S.karl), rita: await mkShift(T, S.rita), maria: await mkShift(T, S.maria) };
const mkLeave = async (t, sid) => (await api("POST", "/shifts/leaves", { token: t, body: { staff_id: sid, leave_type: "annual", start_date: "2026-12-14", end_date: "2026-12-15", hours_requested: 16, reason: "" } })).json.leave_id;
const LV = { karlOwn: await mkLeave(tok["karl@demo.mt"], S.karl), ritaByMaria: await mkLeave(T, S.rita), mariaOwn: await mkLeave(T, S.maria), ritaOwn: await mkLeave(tok["rita@demo.mt"], S.rita) };
const prevMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const today = new Date().toISOString().slice(0, 10), month = today.slice(0, 7);
const curSettings = async () => ((await api("GET", "/shifts/settings", { token: T })).json || {}).settings || {};
const settings0 = await curSettings();

// The probes: route families a screen uses, reads and writes. Writes run on a throw-away copy (restored after each call).
const READS = ["/auth/me", "/today", "/team/today", "/money/today", "/registers/today", "/temperature/devices", "/cleaning/entries?month=" + month,
  "/dda-sales/entries?month=" + month, "/paid-out/entries?month=" + month, "/people?q=borg", "/board/messages?limit=5", "/audit/log?limit=5", "/team/users",
  "/owner/summary", "/su/api/overview", "/shifts/staff?include_inactive=1", "/shifts/assignments-range?from=2026-12-01&to=2026-12-31", "/shifts/leaves?year=2026",
  "/shifts/settings", "/shifts/opening-hours", "/registers/signoffs?month=" + prevMonth, "/instructions/daily/seen?ymd=" + today, "/bookings/settings", "/cherubino/oos/items"];
const WRITES = [
  ["leave: ask (own)", "POST", "/shifts/leaves", (e) => ({ staff_id: e === "karl@demo.mt" ? S.karl : S.rita, leave_type: "annual", start_date: "2026-12-21", end_date: "2026-12-21", hours_requested: 8, reason: "" })],
  ["leave: answer Rita's (asked by Maria)", "POST", "/shifts/leaves/" + LV.ritaByMaria + "/approve"],
  ["leave: answer own (Karl's)", "POST", "/shifts/leaves/" + LV.karlOwn + "/approve"],
  ["leave: answer own (Rita's)", "POST", "/shifts/leaves/" + LV.ritaOwn + "/reject"],
  ["leave: answer own (Maria's)", "POST", "/shifts/leaves/" + LV.mariaOwn + "/approve"],
  ["shift: add for someone", "POST", "/shifts/assignments", () => ({ staff_id: S.maria, shift_date: "2026-12-03", start_time: "09:00", end_time: "13:00", notes: "" })],
  ["shift: change someone's", "PUT", "/shifts/assignments/" + SH.maria, () => ({ start_time: "10:00", end_time: "14:00", role_override: "", notes: "" })],
  ["shift: remove someone's", "DELETE", "/shifts/assignments/" + SH.rita],
  ["shift: fill (apply-plan)", "POST", "/shifts/apply-plan", () => ({ items: [{ staff_id: S.maria, from: "2026-12-07", to: "2026-12-13" }] })],
  ["rota person: add", "POST", "/shifts/staff", () => ({ full_name: "Paula New", designation: "assistant", employment_type: "fulltime", contracted_hours: 40, email: "", phone: "", registration_number: "", patterns_json: "[]" })],
  ["rota person: change", "PUT", "/shifts/staff/" + S.maria, () => ({ full_name: "Maria Borg", designation: "pharmacist", employment_type: "fulltime", contracted_hours: 40, email: "maria@demo.mt", phone: "", registration_number: "", patterns_json: "[]" })],
  ["rota person: remove", "DELETE", "/shifts/staff/" + S.rita],
  ["rota rules", "PUT", "/shifts/settings", () => Object.assign({}, settings0, { minPharmacists: 2 })],
  ["opening hours", "PUT", "/shifts/opening-hours", () => ({ default: { open: "08:00", close: "19:00", closed: false }, openSaturday: true, openSunday: false, overrides: {} })],
  ["register sign-off", "POST", "/registers/signoffs", () => ({ register: "temperature", month: prevMonth })],
  ["cleaning entry", "POST", "/cleaning/entries", () => ({ entry_date: today, time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Karl", notes: "" })],
  ["paid out", "POST", "/paid-out/entries", () => ({ entry_date: today, entry_time: "09:00", payee_name: "Courier Ltd", fee: 5, payment_method: "cash", reason: "x" })],
  ["temperature device", "POST", "/temperature/devices", () => ({ name: "Fridge X", device_type: "fridge", min_limit: 2, max_limit: 8 })],
  ["add a sign-in", "POST", "/team/users", () => ({ email: "new.one@demo.mt", full_name: "New One", role: "staff" })],
  ["handover seen", "POST", "/instructions/daily/seen", () => ({ ymd: today })]];

const PROBE_DB = path.join(WORK, "probe.db");
function reopen(file) { try { DB.db.close(); } catch (e) {} DB = new D1Shim(file); env.DB = DB; }
async function matrix(tag) {
  const m = {};
  for (const e of Object.keys(tok)) for (const p of READS) m[e + " | GET " + p] = (await api("GET", p, { token: tok[e] })).status;
  // writes: each on a fresh copy of the live file
  try { DB.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) {}
  for (const e of Object.keys(tok)) for (const [name, method, p, body] of WRITES) {
    fs.copyFileSync(LIVE, PROBE_DB); reopen(PROBE_DB);
    m[e + " | " + name] = (await api(method, p, { token: tok[e], body: body ? body(e) : undefined })).status;
  }
  reopen(LIVE);
  return m;
}
const snapOld = (cols) => { const o = {}; for (const [t, c] of Object.entries(cols)) o[t] = JSON.stringify(DB.db.prepare("SELECT " + c.join(",") + " FROM " + t + " ORDER BY id").all()); return o; };
const colsOf = (t) => DB.db.prepare("PRAGMA table_info(" + t + ")").all().map((c) => c.name);
const TABLES = ["users", "sessions", "shift_staff", "shift_assignments", "shift_leaves", "shift_settings", "shift_opening_hours", "locations", "orgs"];
const COLS0 = Object.fromEntries(TABLES.map((t) => [t, colsOf(t)]));
const rows0 = snapOld(COLS0);
const me0 = {}; for (const e of Object.keys(tok)) me0[e] = (await api("GET", "/auth/me", { token: tok[e] })).text;

const M0 = await matrix("old");
out("     old worker: " + Object.keys(M0).length + " checks over " + Object.keys(tok).length + " accounts");

// ---- 3. the new worker takes over the same file and the same sessions
// First, on a throw-away copy: the very first request the new worker sees is a People action on the c464c50 schema
// (no is_pharmacist / plans_rota yet): it must add the columns before it reads them, and answer as before.
{
  try { DB.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (e) {}
  fs.copyFileSync(LIVE, PROBE_DB); reopen(PROBE_DB);
  worker = await isolate(newFile);
  const karlId = DB.db.prepare("SELECT id FROM users WHERE email = 'karl@demo.mt'").get().id;
  const first = await api("POST", "/team/users/" + karlId + "/active", { token: T, body: { active: true } });
  const list = await api("GET", "/team/users", { token: T });
  ok(first.status === M0["maria@demo.mt | add a sign-in"] && list.status === 200 && list.json.users.every((u) => u.is_pharmacist === false), "first request on the old schema is a People action (POST /team/users/:id/active): " + first.status + "; the list answers with every existing person not a pharmacist");
  reopen(LIVE);
}
worker = await isolate(newFile);
const M1 = await matrix("new");
const diffK = Object.keys(M0).filter((k) => M0[k] !== M1[k]), diff = diffK.map((k) => k + ": " + M0[k] + " → " + M1[k]);
// Whose leave each probe answers (Rita's rota row carries her e-mail: the request Maria made for her is Rita's own).
const OWNER = { "leave: answer Rita's (asked by Maria)": "rita@demo.mt", "leave: answer own (Karl's)": "karl@demo.mt", "leave: answer own (Rita's)": "rita@demo.mt", "leave: answer own (Maria's)": "maria@demo.mt" };
const ADMINS = new Set(["maria@demo.mt", "admin2@demo.mt", "john@eikon.mt", "branch@demo.mt", "other@demo.mt", "ho@demo.mt", "supplier@demo.mt"]);
const expected = (k) => { const [e, probe] = k.split(" | "); return OWNER[probe] === e && !ADMINS.has(e) && M1[k] === 403; };
const unexpected = diffK.filter((k) => !expected(k));
diffK.forEach((k) => out("       " + (expected(k) ? "intended   " : "UNEXPECTED ") + k + ": " + M0[k] + " → " + M1[k]));
ok(unexpected.length === 0, "rights matrix identical for every existing account except answering their own leave (" + diff.length + " intended difference(s), " + unexpected.length + " unexpected)");
ok(diff.includes("karl@demo.mt | leave: answer own (Karl's): 200 → 403") && M1["maria@demo.mt | leave: answer own (Maria's)"] === M0["maria@demo.mt | leave: answer own (Maria's)"], "Karl (staff) can no longer approve his own leave; the admin still approves her own");
const me1 = {}; for (const e of Object.keys(tok)) me1[e] = (await api("GET", "/auth/me", { token: tok[e] })).text;
ok(Object.keys(tok).every((e) => me1[e] === me0[e]), "every session survives the upgrade: /auth/me byte-identical for all " + Object.keys(tok).length);
const relog = []; for (const e of ALL) { const L = await api("POST", "/auth/login", { body: { email: e, password: PW } }); relog.push(e + ":" + L.status); }
ok(relog.filter((x) => x.endsWith(":200")).length === ALL.length - 1 && relog.includes("leaver@demo.mt:401"), "every existing active account signs in again with its password; the switched-off one still does not");
const rows1 = snapOld(COLS0);
ok(TABLES.every((t) => t === "sessions" ? true : rows1[t] === rows0[t]), "users, shift_* rows identical on every old column after the upgrade (sessions: only the new sign-ins added)");
const s0 = JSON.parse(rows0.sessions), s1 = JSON.parse(rows1.sessions);
ok(JSON.stringify(s1.slice(0, s0.length)) === JSON.stringify(s0), "every existing session row unchanged");
const added = TABLES.flatMap((t) => colsOf(t).filter((c) => !COLS0[t].includes(c)).map((c) => t + "." + c));
ok(JSON.stringify(added.sort()) === JSON.stringify(["shift_staff.user_id", "users.is_pharmacist", "users.plans_rota"]), "only added columns: " + added.join(", "));
const u = DB.db.prepare("SELECT COUNT(*) AS n, SUM(is_pharmacist) AS ph, SUM(plans_rota IS NULL) AS pn FROM users").get();
ok(u.ph === 0 && u.pn === u.n, "every existing account: is_pharmacist 0, plans_rota NULL (= today's rota access) — " + u.n + " accounts");
ok(DB.db.prepare("SELECT COUNT(*) AS c FROM shift_staff WHERE user_id IS NOT NULL").get().c === 0, "no rota person linked by the upgrade (" + DB.db.prepare("SELECT COUNT(*) AS c FROM shift_staff").get().c + " rota rows)");
ok(M1["karl@demo.mt | shift: change someone's"] === 200 && M1["karl@demo.mt | rota rules"] === 200 && M1["karl@demo.mt | shift: fill (apply-plan)"] === M0["karl@demo.mt | shift: fill (apply-plan)"], "existing staff keep planning the rota (Q1-A)");
const iso = ["branch@demo.mt", "other@demo.mt", "ho@demo.mt", "supplier@demo.mt"].every((e) => Object.keys(M0).filter((k) => k.startsWith(e + " |")).every((k) => M0[k] === M1[k]));
ok(iso, "another pharmacy, another group, head office 650 and supplier 450: every answer unchanged");

// ---- 4. rollback: the old worker on the upgraded file
worker = await isolate(oldFile);
const M2 = await matrix("rollback");
const back = Object.keys(M0).filter((k) => M0[k] !== M2[k]);
back.forEach((k) => out("       rollback differs: " + k + ": " + M0[k] + " → " + M2[k]));
ok(back.length === 0, "rollback: the old worker on the upgraded database answers exactly as before (" + Object.keys(M2).length + " checks)");

fs.writeFileSync(path.join(WORK, "matrix.json"), JSON.stringify({ before: M0, after: M1, rollback: M2 }, null, 1));
out("     matrix: " + path.join(WORK, "matrix.json"));
out(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
