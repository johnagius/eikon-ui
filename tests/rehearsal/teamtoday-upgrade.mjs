// Upgrade rehearsal for Today's team (team-hub, T-C1): one added READ-ONLY route, GET /team/today. No table, column or
// index is added (it only calls the schema checks the rota, locum register and board already run, and reads the
// handover's "I've read it" table only if it is there). The worker as it was (base commit, or OLD_WORKER=path) records a
// team day, then this copy's worker takes over the same database, then the old one again. Proves: the schema is
// identical; every existing row in the team tables is byte-for-byte unchanged after the new route reads; every list the
// screens make answers the same; rollback and forward again work.
// Run: node --no-warnings tests/rehearsal/teamtoday-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "teamtoday-rehearsal-"));
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


// ---- 1. the live worker: a team day, odd text
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
let wrote = 0;
const W = async (m, p, b) => { const r = await api(m, p, { token: T, body: b }); if (r.status === 200 || r.status === 201) wrote++; else console.log("    write", p, r.status, r.text.slice(0, 120)); return r; };
const s1 = await W("POST", "/shifts/staff", { full_name: "Ċensina \"Ina\" Zammit", designation: "pharmacist", employment_type: "fulltime", contracted_hours: 40, phone: "79 123 456" });
const s2 = await W("POST", "/shifts/staff", { full_name: "Ġorġ <b>Borg</b>", designation: "assistant", employment_type: "parttime", contracted_hours: 20 });
const id1 = s1.json && (s1.json.staff_id || s1.json.id), id2 = s2.json && (s2.json.staff_id || s2.json.id);
await W("POST", "/shifts/assignments", { staff_id: id1, shift_date: day(0), start_time: "08:00", end_time: "13:00", notes: "Ħal Qormi" });
await W("POST", "/shifts/assignments", { staff_id: id2, shift_date: day(0), start_time: "13:00", end_time: "19:30", notes: "" });
const lv = await W("POST", "/shifts/leaves", { staff_id: id2, leave_type: "annual", start_date: day(3), end_date: day(-4), reason: "Festa f'Għargħur" });
await W("POST", "/shifts/leaves/" + (lv.json && lv.json.leave_id) + "/approve", {});
await W("POST", "/shifts/leaves", { staff_id: id1, leave_type: "sick", start_date: day(1), end_date: day(0), reason: "" });
await W("PUT", "/shifts/opening-hours", { default: { open: "07:30", close: "19:30", closed: false }, weekly: {}, overrides: { [day(0)]: { open: "08:00", close: "19:30", closed: false, note: "Festa" } } });
await W("PUT", "/shifts/settings", { pharmacistRequired: true, minPharmacists: 1 });
await W("POST", "/locumregister/entries", { entry_date: day(0), time_in: "08:00", time_out: "13:00", locum_full_name: "Ċensina Zammit", registration_number: "R\"12\"" });
await W("PUT", "/instructions/daily", { ymd: day(1), notes: "Notes ċ ġ ħ ż", handover_out: [{ id: "b1", sev: "r", text: "Fridge <door>", created_at: new Date().toISOString() }, { id: "b2", sev: "g", text: "Cotton wool" }] });
await W("POST", "/board/messages", { body: "Group only: staff meeting @Demo", scope: "org" });
await W("POST", "/board/messages", { body: "Everyone: Ozempic 1mg?", scope: "all" });
ok(wrote >= 13, "old worker: " + wrote + " team writes (rota, shifts, leave, hours, settings, locum, handover, board)");
const TABLES = ["shift_staff", "shift_assignments", "shift_leaves", "shift_opening_hours", "shift_settings", "locum_register_entries", "instructions_daily", "board_messages", "board_mentions"];
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all());
const snap = () => JSON.stringify(TABLES.map((t) => DB.db.prepare("SELECT * FROM " + t + " ORDER BY id").all()));
const READS = ["/shifts/staff", "/shifts/assignments-range?from=" + day(1) + "&to=" + day(-1), "/shifts/leaves?year=" + day(0).slice(0, 4), "/shifts/opening-hours", "/shifts/settings",
  "/locumregister/entries?month=" + day(0).slice(0, 7), "/instructions/daily?ymd=" + day(1), "/board/messages", "/board/dashboard", "/today"];
const strip = (t) => t.replace(/"time":"\d\d:\d\d"/g, "").replace(/"now":"[^"]*"/g, "");
const readAll = async () => { const o = {}; for (const p of READS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.text); } return o; };
const readsOld = await readAll(), schemaOld = schema(), rowsOld = snap(); // the screens' own reads first: their schema checks run on first use
const before = await api("GET", "/team/today", { token: T });
ok(before.status === 404 || !before.json || !before.json.shifts, "the old worker has no /team/today (" + before.status + ")");

// ---- 2. the new worker on the same database
worker = NEW;
const r = await api("GET", "/team/today", { token: T });
const j = r.json || {};
ok(r.status === 200 && j.shifts.length === 2 && j.shifts[0].full_name === "Ċensina \"Ina\" Zammit" && j.shifts[0].phone === "79 123 456", "new worker: today's two shifts from the old worker's rota " + r.text.slice(0, 160));
ok(j.leave.length === 1 && j.leave[0].leave_type === "annual" && j.leave_pending === 1, "the approved leave covering today, and the one waiting");
ok(j.hours.override === true && j.hours.open === "08:00" && j.settings.pharmacistRequired === true, "today's override and the rota settings");
ok(j.locum_today.length === 1 && j.locum_today[0].registration_number === "R\"12\"", "the pharmacist in charge from the locum register");
ok(j.handover.from_ymd === day(1) && j.handover.total === 2 && j.handover.critical === 1 && j.handover.seen_by_me === null, "yesterday's handover, critical counted; no 'I've read it' table");
{ const d = JSON.parse(readsOld["/board/dashboard"].slice(4)); ok(j.board.unread_messages === d.unread_messages && j.board.unread_mentions === d.unread_mentions, "the board counts equal the board's own summary " + JSON.stringify(j.board)); }
{ const a = JSON.parse(schemaOld).map((x) => x.name), b = JSON.parse(schema()).map((x) => x.name); console.log("    added:", b.filter((n) => !a.includes(n)).join(", ") || "none", "removed:", a.filter((n) => !b.includes(n)).join(", ") || "none"); }
ok(schema() === schemaOld, "the schema is identical: no table, column or index added");
ok(snap() === rowsOld, "every existing row is byte-for-byte unchanged in all " + TABLES.length + " team tables");
const readsNew = await readAll();
const diff = READS.filter((p) => readsNew[p] !== readsOld[p]);
ok(!diff.length, "every list the screens make answers the same before and after (" + READS.length + " reads)" + (diff.length ? " differs: " + diff.join(", ") : ""));
const w = await api("POST", "/shifts/assignments", { token: T, body: { staff_id: id1, shift_date: day(0), start_time: "15:00", end_time: "19:30", notes: "" } });
ok(w.status === 200 && (await api("GET", "/team/today", { token: T })).json.shifts.length === 3, "a classic write on the new worker lands and is shown (a third shift today)");

// ---- 3. rollback and forward again
worker = OLD;
ok((await api("GET", "/shifts/assignments-range?from=" + day(0) + "&to=" + day(0), { token: T })).text.includes("15:00"), "after a rollback the old worker reads the rota as before");
worker = NEW;
ok((await api("GET", "/team/today", { token: T })).status === 200 && schema() === schemaOld, "forward again: answers; the schema is still the same");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
