// Upgrade rehearsal for the rota notices (B5, John 2026-11-10): the worker as it was (OLD_WORKER=path, or the given
// commit, default the root commit) records a pharmacy's rota; this copy's worker takes over the same database with the
// VAPID secret set and a device subscribed, then the old one again. Proves: every table that existed keeps its exact
// schema and every row byte-for-byte (only push_subscriptions, rota_notices, their indexes and a schema mark are new);
// every list the screens read answers the same; each write a screen makes stores the same row under both workers (a
// second database replays the same writes on the old worker), while the new one also tells the device; rollback works
// with the new tables present, and forward again.
// Run: node --no-warnings tests/rehearsal/push-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "push-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const quiet = console.log; console.log = (...a) => { if (!/^\[(shifts|rota push)\]/.test(String(a[0]))) quiet(...a); };

const pushes = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => { const s = String(u && u.url || u); if (s.startsWith("https://fcm.googleapis.com/")) { pushes.push(s); return new Response("", { status: 201 }); } return realFetch(u, init); };
const KEY = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");

function makeDb() { const DB = new D1Shim(); return DB.exec(CORE_SCHEMA).then(() => DB); }
const A = { DB: await makeDb(), worker: OLD }, B = { DB: await makeDb(), worker: OLD }; // A: upgraded; B: stays on the old worker
const envOf = (S) => ({ DB: S.DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000", ...(S.worker === NEW ? { VAPID_PRIVATE_KEY: KEY } : {}) });
const jobs = [];
async function api(S, method, path, { body, token, form } = {}) {
  const h = new Headers(); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await S.worker.fetch(new Request("https://eikon.test" + path, { method, headers: h, body: payload }), envOf(S), { waitUntil(p) { jobs.push(p); }, passThroughOnException() {} });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const day = (n) => new Date(Date.UTC(2026, 10, 16 + n)).toISOString().slice(0, 10); // from Mon 16 Nov 2026

async function seed(S) {
  await api(S, "POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
  S.T = (await api(S, "POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
  const W = async (m, p, b) => { const r = await api(S, m, p, { token: S.T, body: b }); if (r.status !== 200) console.log("    write", p, r.status, r.text.slice(0, 120)); return r.json || {}; };
  S.W = W;
  S.p1 = (await W("POST", "/shifts/staff", { full_name: "Ċensina \"Ċensi\" Żammit", designation: "pharmacist", employment_type: "fulltime", contracted_hours: 40 })).staff_id;
  S.p2 = (await W("POST", "/shifts/staff", { full_name: "Ġorġ <b>Borg</b>", designation: "assistant", employment_type: "parttime", contracted_hours: 20 })).staff_id;
  await W("POST", "/shifts/assignments", { staff_id: S.p1, shift_date: day(0), start_time: "08:00", end_time: "13:00", notes: "Ħal Qormi; \"cover\", ok" });
  await W("POST", "/shifts/assignments", { staff_id: S.p2, shift_date: day(0), start_time: "13:00", end_time: "19:30", notes: "" });
  await W("POST", "/shifts/apply-pattern", { staff_id: S.p2, start_date: day(1), end_date: day(20), mode: "fill", dates: [day(2), day(9), day(16)].map((date) => ({ date, start_time: "09:00", end_time: "17:00" })) });
  const lv = await W("POST", "/shifts/leaves", { staff_id: S.p2, leave_type: "annual", start_date: day(3), end_date: day(4), reason: "Festa f'Għargħur" });
  await W("POST", "/shifts/leaves/" + lv.leave_id + "/approve", {});
  S.pending = (await W("POST", "/shifts/leaves", { staff_id: S.p1, leave_type: "annual", start_date: day(8), end_date: day(9), reason: "" })).leave_id;
  await W("PUT", "/shifts/settings", { pharmacistRequired: true, minPharmacists: 1, calendarToken: "rehearsaltoken123" });
}
await seed(A); await seed(B);

const tables = (DB) => DB.q("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name");
const dump = (DB, names) => Object.fromEntries(names.map((n) => [n, DB.q(`SELECT * FROM "${n}" ORDER BY rowid`)]));
const before = tables(A.DB), names = before.filter((t) => t.type === "table").map((t) => t.name);
const rowsBefore = JSON.stringify(dump(A.DB, names.filter((n) => n !== "audit_log" && n !== "sessions")));
const reads = async (S) => {
  const g = async (p) => { const r = await api(S, "GET", p, { token: S.T }); return r.status + " " + r.text; };
  return [await g("/shifts/staff?include_inactive=1"), await g("/shifts/assignments-range?from=" + day(-7) + "&to=" + day(30)), await g("/shifts/leaves?year=2026"), await g("/shifts/settings"), await g("/shifts/opening-hours")]
    .map((s) => s.replace(/"(created_at|updated_at|reviewed_at)":"[^"]*"/g, "")).join("\n");
};
const oldReads = await reads(A);

// ---- 2. the new worker takes over (secret set), reads, and a device signs up
A.worker = NEW;
const newReads = await reads(A);
ok(newReads === oldReads, "every list the screens read answers the same under the new worker");
const sub = await api(A, "POST", "/rota/push/subscribe", { token: A.T, body: { staff_id: A.p1, subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/rehearsal", keys: { p256dh: "x", auth: "y" } } } });
ok(sub.status === 200 && sub.json.ok, "a device signs up on the upgraded database");
{ const now = dump(A.DB, names.filter((n) => n !== "audit_log" && n !== "sessions")), was = JSON.parse(rowsBefore);
  // eikon_schema (the once-per-database DDL marks) only gains the new mark; every other table is exactly as it was.
  const diff = Object.keys(was).filter((n) => n === "eikon_schema" ? JSON.stringify(now[n].filter((r) => r.k !== "ensureRotaPushSchema")) !== JSON.stringify(was[n]) : JSON.stringify(now[n]) !== JSON.stringify(was[n]));
  ok(!diff.length, "every existing row of every existing table is byte-for-byte unchanged after reads and a sign-up" + (diff.length ? ": " + diff.join(", ") : "")); }
const after = tables(A.DB);
const same = before.every((t) => after.some((x) => JSON.stringify(x) === JSON.stringify(t)));
const added = after.filter((x) => !before.some((t) => JSON.stringify(x) === JSON.stringify(t))).map((x) => x.type + " " + x.name).sort();
ok(same, "every table and index that existed keeps its exact definition");
ok(JSON.stringify(added) === JSON.stringify(["index idx_push_subs_endpoint", "index idx_push_subs_staff", "index idx_rota_notices_staff", "table push_subscriptions", "table rota_notices"].concat(before.some((t) => t.name === "eikon_schema") ? [] : ["table eikon_schema"]).sort()), "only the two new tables and their indexes are added: " + added.join(", "));

// ---- 3. the same writes on both databases: identical rows (new worker also tells the device)
const shiftCols = "staff_id, shift_date, start_time, end_time, role_override, notes, org_id, location_id, created_by";
const shifts = (S) => JSON.stringify(S.DB.q(`SELECT ${shiftCols} FROM shift_assignments ORDER BY shift_date, staff_id, start_time`));
const leaves = (S) => JSON.stringify(S.DB.q(`SELECT staff_id, leave_type, start_date, start_time, end_date, end_time, hours_requested, reason, status, reviewed_by FROM shift_leaves ORDER BY id`));
const firstId = (S, d) => S.DB.q("SELECT id FROM shift_assignments WHERE staff_id=? AND shift_date=?", S.p1, d)[0].id;
for (const S of [A, B]) {
  await S.W("POST", "/shifts/assignments", { staff_id: S.p1, shift_date: day(1), start_time: "07:30", end_time: "14:00", notes: "" });
  await S.W("PUT", "/shifts/assignments/" + firstId(S, day(1)), { staff_id: S.p1, shift_date: day(1), start_time: "13:30", end_time: "19:30", role_override: "pharmacist", notes: "Ċ ġ ħ ż" });
  await S.W("POST", "/shifts/apply-pattern", { staff_id: S.p1, start_date: day(14), end_date: day(20), mode: "fill", dates: [day(14), day(15)].map((date) => ({ date, start_time: "08:00", end_time: "14:00" })) });
  await S.W("DELETE", "/shifts/assignments/" + firstId(S, day(0)));
  await S.W("POST", "/shifts/leaves/" + S.pending + "/approve", {});
}
await Promise.all(jobs);
ok(shifts(A) === shifts(B), "shift rows written by the new worker == the old worker's, column for column");
ok(leaves(A) === leaves(B), "leave rows == the old worker's");
ok(pushes.length === 5, "the device got one push per save (5 saves): " + pushes.length);
const texts = A.DB.q("SELECT text FROM rota_notices ORDER BY id").map((r) => r.text);
ok(JSON.stringify(texts) === JSON.stringify(["New shift: Tue 17 Nov 07:30–14:00", "Your Tue 17 Nov shift changed to 13:30–19:30", "Your shifts changed on Mon 30 Nov and Tue 1 Dec", "Your Mon 16 Nov shift (08:00–13:00) was removed", "Your leave 24–25 Nov was approved"]), "notice words: " + JSON.stringify(texts));

// ---- 4. rollback with the new tables present, then forward again
A.worker = OLD;
const rb = await reads(A);
ok(rb === await (async () => { B.worker = OLD; return reads(B); })(), "rolled back: the old worker reads the upgraded database exactly as the database that never upgraded");
const w2 = await api(A, "POST", "/shifts/assignments", { token: A.T, body: { staff_id: A.p1, shift_date: day(5), start_time: "08:00", end_time: "12:00", notes: "" } });
ok(w2.status === 200, "rolled back: the old worker writes as before (no push, tables ignored)");
A.worker = NEW;
ok((await api(A, "POST", "/shifts/assignments", { token: A.T, body: { staff_id: A.p1, shift_date: day(6), start_time: "08:00", end_time: "12:00", notes: "" } })).status === 200, "forward again: writes and still tells the device");
await Promise.all(jobs);
ok(pushes.length === 6, "one more push");
globalThis.fetch = realFetch;
quiet(`\npush rehearsal: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
