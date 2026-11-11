// Upgrade rehearsal for the roster planner's worker additions (John 2026-11-10, decisions 4a and 5a):
// W1 POST /shifts/apply-plan (one step, all or nothing) and W3 approved leave as all-day events in the calendar feed.
// No table, column or index is added. The worker as it was (base commit, or OLD_WORKER=path) records a rota with odd
// text, leave of every status and a calendar token; this copy's worker takes over the same database, then the old one
// again. Proves: the schema is identical; every existing row in the rota tables is byte-for-byte unchanged after the new
// worker reads (feed included); every list the screens make answers the same; the feed's shift events are the same and
// only approved leave is added; the new route writes rows the old worker reads and edits as its own; rollback and
// forward again work.
// Run: node --no-warnings tests/rehearsal/rotaplan-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "rotaplan-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = OLD;
const quiet = console.log; console.log = (...a) => { if (!/^\[shifts\]/.test(String(a[0]))) quiet(...a); };
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
const day = (n) => { const [y, m, d] = malta().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// ---- 1. the live worker: a rota with odd text, leave of every status, a calendar token, a classic pattern apply
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
let wrote = 0;
const W = async (m, p, b) => { const r = await api(m, p, { token: T, body: b }); if (r.status === 200 || r.status === 201) wrote++; else console.log("    write", p, r.status, r.text.slice(0, 120)); return r; };
const pj = JSON.stringify({ patterns: [{ id: "rot.k3f9.1of2." + day(0), name: "Usual · week A of 2", week: [{ off: true }, { off: false, start: "08:00", end: "14:00", role_override: "" }, { off: true }, { off: true }, { off: true }, { off: true }, { off: false, start: "08:00", end: "13:00", role_override: "" }], createdAt: 1 }], provisionalId: "rot.k3f9.1of2." + day(0) });
const s1 = await W("POST", "/shifts/staff", { full_name: "Ċensina \"Ċensi\" Żammit", designation: "pharmacist", employment_type: "fulltime", contracted_hours: 40, phone: "79 123 456", patterns_json: pj });
const s2 = await W("POST", "/shifts/staff", { full_name: "Ġorġ <b>Borg</b>", designation: "assistant", employment_type: "parttime", contracted_hours: 20 });
const id1 = s1.json && s1.json.staff_id, id2 = s2.json && s2.json.staff_id;
await W("POST", "/shifts/assignments", { staff_id: id1, shift_date: day(0), start_time: "08:00", end_time: "13:00", notes: "Ħal Qormi; \"cover\", ok" });
await W("POST", "/shifts/assignments", { staff_id: id2, shift_date: day(0), start_time: "13:00", end_time: "19:30", notes: "" });
await W("POST", "/shifts/apply-pattern", { staff_id: id2, start_date: day(1), end_date: day(20), mode: "fill", dates: [day(2), day(9), day(16)].map((date) => ({ date, start_time: "09:00", end_time: "17:00" })) });
const lv = await W("POST", "/shifts/leaves", { staff_id: id2, leave_type: "annual", start_date: day(3), end_date: day(4), reason: "Festa f'Għargħur" });
await W("POST", "/shifts/leaves/" + lv.json.leave_id + "/approve", {});
const lv2 = await W("POST", "/shifts/leaves", { staff_id: id1, leave_type: "sick", start_date: day(5), end_date: day(5), start_time: "10:00", end_time: "12:00", reason: "private" });
await W("POST", "/shifts/leaves/" + lv2.json.leave_id + "/approve", {});
await W("POST", "/shifts/leaves", { staff_id: id1, leave_type: "annual", start_date: day(8), end_date: day(9), reason: "" });
const lv3 = await W("POST", "/shifts/leaves", { staff_id: id1, leave_type: "annual", start_date: day(12), end_date: day(12), reason: "" });
await W("POST", "/shifts/leaves/" + lv3.json.leave_id + "/reject", {});
await W("PUT", "/shifts/opening-hours", { default: { open: "07:30", close: "19:30", closed: false }, weekly: {}, overrides: { [day(0)]: { open: "08:00", close: "19:30", closed: false, note: "Festa" } } });
await W("PUT", "/shifts/settings", { pharmacistRequired: true, minPharmacists: 1, calendarToken: "rehearsaltoken0001", rota: { plans: {} } });
ok(wrote >= 14, "old worker: " + wrote + " rota writes (staff with a rotation pattern, shifts, apply-pattern, leave approved/pending/refused, hours, settings + token)");
const TABLES = ["shift_staff", "shift_assignments", "shift_leaves", "shift_opening_hours", "shift_settings", "shift_calendar_tokens"];
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all());
const snap = () => JSON.stringify(TABLES.map((t) => DB.db.prepare("SELECT * FROM " + t + " ORDER BY id").all()));
const READS = ["/shifts/staff?include_inactive=1", "/shifts/assignments-range?from=" + day(-1) + "&to=" + day(30), "/shifts/assignments?year=" + day(0).slice(0, 4) + "&month=" + Number(day(0).slice(5, 7)),
  "/shifts/leaves?year=" + day(0).slice(0, 4), "/shifts/opening-hours", "/shifts/settings", "/team/today"];
const strip = (t) => t.replace(/"time":"\d\d:\d\d"/g, "").replace(/"now":"[^"]*"/g, "");
const readAll = async () => { const o = {}; for (const p of READS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.text); } return o; };
const feed = async (q) => (await api("GET", "/shifts/ical?token=rehearsaltoken0001" + (q || ""))).text.replace(/DTSTAMP:\S+/g, "DTSTAMP:x").replace(/LAST-MODIFIED:\S+\r\n/g, ""); // the new feed stamps each event with its row's own time
const events = (t) => t.split("BEGIN:VEVENT").slice(1).map((e) => "BEGIN:VEVENT" + e.split("END:VEVENT")[0] + "END:VEVENT");
const readsOld = await readAll(), schemaOld = schema(), rowsOld = snap(), feedOld = await feed(), feedOld1 = await feed("&staff_id=" + id1);
const plan0 = await api("POST", "/shifts/apply-plan", { token: T, body: { items: [] } });
ok(plan0.status === 404, "the old worker has no apply-plan (" + plan0.status + ")");
ok(!/UID:leave-/.test(feedOld), "the old feed has no leave events");

// ---- 2. the new worker on the same database
worker = NEW;
const feedNew = await feed(), feedNew1 = await feed("&staff_id=" + id1);
ok(schema() === schemaOld, "the schema is identical: no table, column or index added");
ok(snap() === rowsOld, "every existing row is byte-for-byte unchanged in all " + TABLES.length + " rota tables after the new worker's reads (feed included)");
const readsNew = await readAll();
const diff = READS.filter((p) => readsNew[p] !== readsOld[p]);
ok(!diff.length, "every list the screens make answers the same before and after (" + READS.length + " reads)" + (diff.length ? " differs: " + diff.join(", ") : ""));
{
  const oldEv = events(feedOld), newEv = events(feedNew);
  const shiftsNew = newEv.filter((e) => e.includes("UID:shift-")), leaveNew = newEv.filter((e) => e.includes("UID:leave-"));
  ok(JSON.stringify(shiftsNew) === JSON.stringify(oldEv), "the feed's " + oldEv.length + " shift events are the same (UID, times, summary, note; stamps aside)");
  ok(leaveNew.length === 2 && leaveNew.some((e) => e.includes("UID:leave-" + lv.json.leave_id + "@eikon") && e.includes("Annual leave")) && leaveNew.some((e) => e.includes("UID:leave-" + lv2.json.leave_id + "@eikon") && e.includes("— Leave 10:00–12:00")),
    "only the two approved leaves are added, as all-day events (annual named, sick reads 'Leave')");
  ok(!/private|Għargħur/.test(feedNew), "no leave reason in the feed");
  ok(feedNew.startsWith(feedOld.split("BEGIN:VEVENT")[0]) && feedNew.endsWith("END:VCALENDAR\r\n"), "calendar header unchanged, ends as before");
  ok(events(feedNew1).filter((e) => e.includes("UID:shift-")).join() === events(feedOld1).join() && events(feedNew1).filter((e) => e.includes("UID:leave-")).length === 1, "per-person feed: same shifts, only her own approved leave");
}
// The new route on rows the old worker wrote: replace one old row, keep the others, add two.
const range = async () => (await api("GET", "/shifts/assignments-range?from=" + day(0) + "&to=" + day(20) + "&staff_id=" + id2, { token: T })).json.shifts;
const r0 = await range();
const goes = r0.find((x) => x.shift_date === day(9));
const plan = await api("POST", "/shifts/apply-plan", { token: T, body: { items: [{ staff_id: id2, from: day(0), to: day(20), seen: r0.map((x) => x.id), remove: [goes.id],
  add: [{ date: day(9), start_time: "13:00", end_time: "19:30", notes: "Ċ after" }, { date: day(10), start_time: "08:00", end_time: "12:00", role_override: "pharmacist" }] }] } });
ok(plan.status === 200 && plan.json.added === 2 && plan.json.removed === 1, "apply-plan on the old worker's rows: " + plan.text.slice(0, 120));
const r1 = await range();
ok(JSON.stringify(r1.filter((x) => r0.some((y) => y.id === x.id))) === JSON.stringify(r0.filter((x) => x.id !== goes.id)), "the rows it did not remove are unchanged, ids kept");
const stale = await api("POST", "/shifts/apply-plan", { token: T, body: { items: [{ staff_id: id2, from: day(0), to: day(20), seen: r0.map((x) => x.id), remove: [], add: [{ date: day(11), start_time: "08:00", end_time: "12:00" }] }] } });
ok(stale.status === 409 && JSON.stringify(await range()) === JSON.stringify(r1), "a stale preview is refused and changes nothing");
const schemaAfter = schema();
ok(schemaAfter === schemaOld, "still no schema change after the new route wrote");

// ---- 3. rollback and forward again
worker = OLD;
const r2 = await range();
ok(JSON.stringify(r2) === JSON.stringify(r1), "after a rollback the old worker reads the planner's rows as its own");
const added = r2.find((x) => x.shift_date === day(10));
const ed = await api("PUT", "/shifts/assignments/" + added.id, { token: T, body: Object.assign({}, added, { notes: "edited in classic" }) });
const dl = await api("DELETE", "/shifts/assignments/" + r2.find((x) => x.shift_date === day(9)).id, { token: T });
const ap = await api("POST", "/shifts/apply-pattern", { token: T, body: { staff_id: id2, start_date: day(15), end_date: day(17), mode: "overwrite", dates: [{ date: day(16), start_time: "10:00", end_time: "18:00" }] } });
ok(ed.status === 200 && dl.status === 200 && ap.status === 200 && (await range()).find((x) => x.id === added.id).notes === "edited in classic", "the old worker edits, deletes and re-applies over them");
ok(!/UID:leave-/.test(await feed()), "the old feed is back to shifts only");
worker = NEW;
ok((await api("GET", "/shifts/assignments-range?from=" + day(0) + "&to=" + day(0), { token: T })).status === 200 && schema() === schemaOld && /UID:leave-/.test(await feed()), "forward again: answers; leave back in the feed; the schema is still the same");
console.log = quiet;
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
