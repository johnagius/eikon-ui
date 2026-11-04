// Upgrade rehearsal for the Bookings calendar (2026-11: walk-ins, repeats, confirmations, no-shows, blocked time read by
// everyone, notify:false, the freed time offered on a move, the import's "still to come").
// The worker as it was (the .166 candidate, or OLD_WORKER=path) builds a busy Bookings database: services, people with
// rooms, bookings in every state, a move, a cancel by the customer on their link, e-mails and reminders sent, the waiting
// list, time off and a day away, and a move from the old Appointments. Then this copy's worker takes over the same
// database, then the old one again (rollback).
// Proves: every row that existed in every bk_* table (and the old appt_* tables) is byte-for-byte unchanged; the only
// schema change is four columns added to bk_bookings that read '' / 0 for every existing booking; sessions, private
// links made by the old worker and the stored e-mail key (BOOKINGS_KEY unchanged) keep working; the new routes work on
// the old data; the old worker still reads and books on the upgraded database.
// Local only: in-memory SQLite, no network (e-mail providers are stubbed), nothing reaches Cloudflare.
// Run: node --no-warnings tests/rehearsal/bookings-calendar-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const sent = [];
globalThis.fetch = async (u, init) => {
  if (/api\.resend\.com|api\.brevo\.com/.test(String(u))) { sent.push({ url: String(u), body: JSON.parse(init.body) }); return new Response('{"id":"stub"}', { status: 200 }); }
  throw new Error("rehearsal: no network (" + u + ")");
};
const dir = mkdtempSync(join(tmpdir(), "bk-cal-rehearsal-"));
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { maxBuffer: 64 << 20 });
const base = process.argv[2] || git("log", "--format=%H", "-1", "--grep=base .166 candidate").toString().trim() || git("rev-list", "--max-parents=0", "HEAD").toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : git("show", base + ":cloudflare-worker/code"));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const quiet = () => {}; const out = console.log.bind(console); console.log = quiet; console.info = quiet; console.warn = quiet;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
// BOOKINGS_KEY is the same before and after: it encrypts the stored e-mail keys and signs every private link.
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000", BOOKINGS_KEY: "rehearsal-bookings-key-0123456789", PUBLIC_BASE_URL: "https://eikon.test", BK_TEST_NOW: "2027-02-26 09:00" };
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
async function cron(at) { let p; await worker.scheduled({}, { ...env, BK_TEST_NOW: at }, { waitUntil(x) { p = x; } }); await p; }
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; out((c ? "  ok   " : "  FAIL ") + m); };
const q = (s, ...a) => DB.db.prepare(s).all(...a);
const sql = (s, ...a) => DB.db.prepare(s).run(...a);
const must = async (r, what) => { if (r.status >= 400) out("     refused: " + what + " " + r.status + " " + r.text.slice(0, 160)); return r; };

// ---- 1. the OLD worker builds a busy Bookings pharmacy (a Friday; the week after)
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
ok(!!T, "old worker: signed in");
const ALL = (a, b, room) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [room ? [a, b, room] : [a, b]]]));
const room = (await must(await api("POST", "/bookings/rooms", { token: T, body: { name: "Room 1" } }), "room")).json.room.id;
const pA = (await must(await api("POST", "/bookings/providers", { token: T, body: { name: "Maria Borg", title: "Pharm.", hours: ALL("09:00", "13:00", room) } }), "provider")).json.provider.id;
const pB = (await must(await api("POST", "/bookings/providers", { token: T, body: { name: "Ċensina Żammit", speciality: "Physiotherapy", hours: ALL("09:00", "12:00") } }), "provider")).json.provider.id;
const sA = (await must(await api("POST", "/bookings/services", { token: T, body: { name: "B12 injection", durationMin: 15, priceCents: 1000, providerIds: [pA] } }), "service")).json.service.id;
const sB = (await must(await api("POST", "/bookings/services", { token: T, body: { name: "Physiotherapy", durationMin: 45, bufferMin: 15, priceCents: 3500, providerIds: [pB] } }), "service")).json.service.id;
await must(await api("PUT", "/bookings/settings", { token: T, body: { provider: "resend", fromName: "Demo Pharmacy", fromEmail: "b@demo.mt", apiKey: "re_rehearsal_key", phone: "2123 4567", publicEnabled: true } }), "settings");
const bk = async (svc, date, start, who, extra = {}) => (await must(await api("POST", "/bookings", { token: T, body: { serviceId: svc, date, start, personName: who, personPhone: "79" + String(start).replace(":", "") + "11", ...extra } }), "book " + who)).json.booking;
const b1 = await bk(sA, "2027-03-01", "09:00", "Carmen Grech", { personEmail: "carmen@example.com", personIdCard: "0012345M" });
const b2 = await bk(sA, "2027-03-01", "09:15", "Ġorġ Ħili");
const b3 = await bk(sB, "2027-03-01", "09:00", "Rita Vella", { personEmail: "rita@example.com" });
const b4 = await bk(sA, "2027-03-02", "10:00", "Pawlu Ħaġġar", { personPhone: "+356 7900 1122" });
const b5 = await bk(sA, "2027-03-02", "10:30", "Anna Borg", { personEmail: "anna@example.com" });
const b6 = await bk(sA, "2027-02-27", "11:00", "Joseph Abela", { personEmail: "joseph@example.com" });
await api("PATCH", "/bookings/" + b2.id, { token: T, body: { version: 1, status: "arrived" } });
await api("PATCH", "/bookings/" + b4.id, { token: T, body: { version: 1, status: "no_show" } });
await api("PATCH", "/bookings/" + b5.id, { token: T, body: { version: 1, date: "2027-03-03", start: "11:00" } });
await api("PATCH", "/bookings/" + b3.id, { token: T, body: { version: 1, status: "confirmed" } });
await api("POST", "/bookings/waitlist", { token: T, body: { serviceId: sA, personName: "Doris Ellul", personPhone: "79000009" } });
await api("POST", "/bookings/exceptions", { token: T, body: { providerId: pA, date: "2027-03-01", kind: "off", start: "12:00", end: "12:30", note: "Lunch" } });
await api("POST", "/bookings/providers/" + pB + "/away", { token: T, body: { from: "2027-03-04", to: "2027-03-04", reason: "Course" } });
await cron("2027-02-26 18:30"); // the evening reminder for tomorrow's booking (b6)
const linkOf = (to) => { const m = sent.filter((x) => (x.body.to || [])[0] === to).map((x) => /https:\/\/eikon\.test(\/b\/[0-9a-f]{32}\.[0-9a-z]+\.[A-Za-z0-9_-]{43})/.exec(x.body.html)).filter(Boolean); return m.length ? m[0][1] : ""; };
const annaLink = linkOf("anna@example.com"), carmenLink = linkOf("carmen@example.com");
ok(!!annaLink && !!carmenLink && sent.length >= 4, "old worker: confirmations, a move and a reminder were e-mailed (" + sent.length + "), with private links");
await api("POST", annaLink + "/cancel", {}); // the customer cancels on their own link
// the old Appointments, with a move into Bookings
await api("GET", "/appointments/doctors", { token: T });
sql("INSERT INTO appt_doctors (org_id, location_id, name, default_fee) VALUES (1,1,'Dr Abela',15)");
for (const [d, st] of [["2027-01-10", "Completed"], ["2027-03-05", "Scheduled"]]) sql("INSERT INTO appt_appointments (org_id, location_id, doctor_id, patient_name, date, time, status) VALUES (1,1,1,'Lucia Borg',?,'10:00',?)", d, st);
await must(await api("POST", "/bookings/import-legacy", { token: T, body: {} }), "import");
sql("INSERT INTO appt_appointments (org_id, location_id, doctor_id, patient_name, date, time, status) VALUES (1,1,1,'Kurt Pace','2027-03-08','09:00','Scheduled')"); // added after the move

const TABLES = q("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'bk_%' OR name LIKE 'appt_%') ORDER BY name").map((r) => r.name);
const snap = () => Object.fromEntries(TABLES.map((t) => [t, q(`SELECT * FROM ${t} ORDER BY rowid`)]));
const cols = (t) => q(`PRAGMA table_info(${t})`).map((c) => c.name);
const before = snap(), colsBefore = Object.fromEntries(TABLES.map((t) => [t, cols(t)]));
const nBk = before.bk_bookings.length;
ok(nBk >= 8 && before.bk_messages.length >= 4 && before.appt_appointments.length === 3, `old worker: ${nBk} bookings in every state, ${before.bk_messages.length} messages, ${TABLES.length} bk_/appt_ tables`);

// ---- 2. the NEW worker takes over the same database
worker = NEW;
const g = await api("GET", "/bookings?from=2027-02-27&to=2027-03-05", { token: T });
ok(g.status === 200 && g.json.bookings.length === nBk - 0 - before.bk_bookings.filter((b) => b.date < "2027-02-27" || b.date > "2027-03-05").length, "new worker: the old session reads the week (" + g.status + ")");
const added = cols("bk_bookings").filter((c) => !colsBefore.bk_bookings.includes(c));
ok(JSON.stringify(added) === JSON.stringify(["series_id", "confirmed_at", "confirmed_via", "walk_in"]), "the only schema change: four columns added to bk_bookings (" + added.join(", ") + ")");
ok(TABLES.every((t) => t === "bk_bookings" || JSON.stringify(cols(t)) === JSON.stringify(colsBefore[t])), "every other bk_/appt_ table has the same columns");
const nb = q("SELECT * FROM bk_bookings ORDER BY rowid");
ok(nb.every((r) => r.series_id === "" && r.confirmed_at === "" && r.confirmed_via === "" && r.walk_in === 0), "every existing booking reads '' / 0 in the new columns");
const strip = (rows, keep) => rows.map((r) => JSON.stringify(Object.fromEntries(keep.map((c) => [c, r[c]]))));
// reads, page views and the evening job on the new worker, then every old row compared
await api("GET", "/bookings/setup", { token: T });
const ex = await api("GET", "/bookings/exceptions?from=2027-03-01&to=2027-03-04", { token: T });
ok(ex.status === 200 && ex.json.exceptions.length === 2 && ex.json.exceptions.some((e) => e.note === "Lunch") && ex.json.exceptions.some((e) => e.note === "Course" && !e.start), "new: time off and the day away read back as the old worker stored them");
const per = await api("GET", "/bookings/person?phone=" + encodeURIComponent("79001122"), { token: T });
ok(per.status === 200 && per.json.noShows === 1 && per.json.total === 1, "new: Pawlu's old no-show is counted from his phone written another way (+356 7900 1122)");
ok(g.json.noShows[b4.id] === undefined && g.json.mail.on === true && (g.json.messages[b6.id] || []).some((m) => m.kind === "remind_evening" && m.status === "sent"), "new: the day list shows the reminder the old worker sent, and that e-mails still work with the stored key");
const page = await api("GET", carmenLink);
ok(page.status === 200 && /Carmen, you&#39;re booked|Carmen, you're booked/.test(page.text) && /be there/.test(page.text), "new: a private link made by the old worker still opens, now with Yes, I'll be there");
const compare = (A, B, skip = {}) => { const diffs = []; for (const t of TABLES) { const keep = colsBefore[t].filter((c) => !(skip[t] || []).includes(c)); const a = strip(A[t], keep), b = strip(B[t].slice(0, A[t].length), keep); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(t + "#" + i); if (B[t].length < A[t].length) diffs.push(t + " lost rows"); } return diffs; };
const before2 = snap();
const d1 = compare(before, before2);
ok(!d1.length, "every row that existed in " + TABLES.length + " bk_/appt_ tables is byte-for-byte unchanged after the new worker read the week, the set-up, time off, a customer's record and served an old link" + (d1.length ? ": " + d1.slice(0, 5).join(" ") : ""));
await cron("2027-02-28 18:30"); // tomorrow's reminders, by the new worker
const after = snap();
// sending an e-mail counts it on the sender (used today/this month, last sent), as the old worker does on every send
const USAGE = ["used_day", "used_today", "used_month", "used_this_month", "last_ok_at", "last_fail_at", "last_error", "cooldown_until"];
const d2 = compare(before, after, { bk_senders: USAGE });
ok(!d2.length, "and after the new worker's evening reminders: unchanged too, apart from the sender's send counters" + (d2.length ? ": " + d2.slice(0, 5).join(" ") : ""));
ok(after.bk_messages.length > before2.bk_messages.length, "the new worker's reminders went out (" + (after.bk_messages.length - before2.bk_messages.length) + " new message rows; old rows untouched)");

// ---- 3. the new behaviour on the old data
const conf = await api("POST", carmenLink + "/confirm", {});
const c1 = q("SELECT status, confirmed_via, version FROM bk_bookings WHERE id=?", b1.id)[0];
ok(conf.status === 200 && c1.status === "confirmed" && c1.confirmed_via === "customer" && c1.version === b1.version + 1, "new: Carmen confirms an old booking on her old link");
const mv = await api("PATCH", "/bookings/" + b1.id, { token: T, body: { version: c1.version, date: "2027-03-01", start: "10:00", notify: false } });
ok(mv.status === 200 && mv.json.message === "not-told" && mv.json.offer && mv.json.offer.personName === "Doris Ellul", "new: an old booking moved without an e-mail; the freed 09:00 is offered to Doris, waiting since the old worker");
const rp = await api("POST", "/bookings", { token: T, body: { serviceId: sA, providerId: pA, date: "2027-03-01", start: "11:00", personName: "Ryan Pace", repeat: { everyDays: 7, count: 3 } } });
ok(rp.status === 201 && rp.json.series.length === 3, "new: a weekly repeat on the upgraded database");
const imp = await api("POST", "/bookings/import-legacy?dry=1", { token: T, body: {} });
ok(imp.json.report.bookings === 1 && imp.json.report.upcoming === 1 && imp.json.report.skipped === 2, "new: the import's check finds only the appointment added after the move (1, still to come), the two moved before are skipped");
ok(JSON.stringify(q("SELECT * FROM appt_appointments ORDER BY rowid")) === JSON.stringify(after.appt_appointments), "the old appt_ tables are never written by the new worker");

// ---- 4. rollback: the old worker on the upgraded database
worker = OLD;
const og = await api("GET", "/bookings?from=2027-03-01&to=2027-03-15", { token: T });
const ob = await api("POST", "/bookings", { token: T, body: { serviceId: sA, date: "2027-03-02", start: "11:30", personName: "After Rollback" } });
const rr = q("SELECT series_id, confirmed_via, walk_in FROM bk_bookings WHERE id=?", ob.json && ob.json.booking ? ob.json.booking.id : 0)[0] || {};
ok(og.status === 200 && og.json.bookings.some((b) => b.personName === "Ryan Pace") && ob.status === 201 && rr.series_id === "" && rr.walk_in === 0, "rollback: the old worker reads the new rows and books on the upgraded database (new columns take their defaults)");

out(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
