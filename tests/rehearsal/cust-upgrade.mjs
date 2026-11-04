// Upgrade rehearsal for Customers & messaging (d-cust): three new tables, five new routes, nothing else.
// The worker as it was (base commit, or OLD_WORKER=path) fills a pharmacy (people, orders, questions, deliveries, repeat
// prescriptions, bookings with a sender and an opt-out, loyalty); this copy's worker takes over the same database, every
// new route is used; then the old worker again (rollback).
// Proves: every table that existed is byte-for-byte unchanged (all rows, all columns) by the take-over and by the new
// routes — apart from audit_log (new lines), the schema marks and bk_senders' send counters (one e-mail moves them as
// a booking e-mail does); the schema change is exactly the three new tables and their indexes; the old routes answer
// the same; after a rollback the old worker answers the same again.
// Run: node --no-warnings tests/rehearsal/cust-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
const { maltaYmd } = await import(pathToFileURL(join(ROOT, "tests/clock.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const sent = []; globalThis.fetch = async (u, init) => { if (/api\.resend\.com/.test(String(u))) { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}'); } throw new Error("network refused " + u); };
const dir = mkdtempSync(join(tmpdir(), "cust-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000", BOOKINGS_KEY: "rehearsal-bookings-key-0123456789", PUBLIC_BASE_URL: "https://eikon.test" };
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
const D = (n) => maltaYmd(n);

// ---- 1. the live worker fills a pharmacy
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const NAMES = ["Zammit Carmel", "Micallef Ċettina", "Grech Carmen", "O'Neill <b>Ann</b>", "Vella Ġorġ"];
const pids = [];
for (const [i, n] of NAMES.entries()) {
  const r = await api("POST", "/people", { token: T, body: { name: n, id_card: (100000 + i) + "M", phone: "7912345" + i, email: i % 2 ? "" : "p" + i + "@example.com", notes: i === 0 ? "Call after 5" : "" } });
  pids.push(r.json.person.id);
  await api("POST", "/client-orders/entries", { token: T, body: { order_date: D(-i), client_name: n, client_phone: "7912345" + i, items_text: "Item " + i, needed_by: D(i), priority: 2 } });
  await api("POST", "/client-tickets/entries", { token: T, body: { open_date: D(-i), client_name: n, phone: "7912345" + i, issue: "Question " + i, category: "General Enquiry", priority: 2, status: "Open", ticket_id: "TKT-0000" + i } });
  await api("POST", "/client-deliveries/entries", { token: T, body: { order_date: D(-i), scheduled_date: D(1), client_name: n, phone: "7912345" + i, delivery_address: "1 Triq", items: "Box " + i, status: "Scheduled", delivery_id: "DEL-0000" + i } });
  await api("POST", "/repeat-prescriptions/entries", { token: T, body: { entry_date: D(-20 - i), client_name: n, client_id: (100000 + i) + "M", medicine_name_dose: "Med " + i, posology: "1 od", prescriber_name: "Dr A", prescriber_reg_no: "1", collect_every_days: 28 } });
}
const orders = (await api("GET", "/client-orders/entries?month=" + D(0).slice(0, 7), { token: T })).json.entries || [];
if (orders[0]) await api("PUT", "/client-orders/entries/" + orders[0].id, { token: T, body: { fulfilled: true } });
await api("POST", "/bookings/senders", { token: T, body: { kind: "resend", apiKey: "re_secret", fromEmail: "hello@demo.mt", fromName: "Demo Pharmacy" } });
const pv = await api("POST", "/bookings/providers", { token: T, body: { name: "Maria", hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((x) => [x, [["08:00", "20:00"]]])) } });
const sv = await api("POST", "/bookings/services", { token: T, body: { name: "Flu vaccine", durationMin: 10, providerIds: [pv.json.provider.id] } });
await api("POST", "/bookings", { token: T, body: { serviceId: sv.json.service.id, date: D(3), start: "10:00", personName: NAMES[0], personEmail: "p0@example.com" } });
DB.db.prepare("INSERT INTO bk_optout (email, org_id, location_id) VALUES ('p2@example.com', 1, 1)").run();
await api("POST", "/loyalty/campaigns", { token: T, body: { id: "c1", name: "Stamps", type: "stamp_card", active: true, open_ended: true, stamp_target: 10 } });
await api("POST", "/loyalty/transactions", { token: T, body: { client_id: "0100000M", client_name: NAMES[0], campaign_id: "c1", items: [{ desc: "A", qty: 2 }], stamps_awarded: 2, action: "record", date: D(0) } });
const reads = async () => JSON.stringify(await Promise.all([
  ...pids.map((id) => api("GET", "/people/" + id, { token: T }).then((r) => r.json)),
  api("GET", "/people?q=zammit", { token: T }).then((r) => r.json),
  api("GET", "/client-orders/entries?month=" + D(0).slice(0, 7), { token: T }).then((r) => r.json),
  api("GET", "/client-tickets/entries?month=" + D(0).slice(0, 7), { token: T }).then((r) => r.json),
  api("GET", "/loyalty/transactions", { token: T }).then((r) => r.json),
  api("GET", "/bookings/senders", { token: T }).then((r) => { const j = r.json; (j.senders || []).forEach((s) => { delete s.usedToday; delete s.usedMonth; delete s.usedThisMonth; delete s.lastOkAt; }); delete j.serverNow; return j; }), // the one e-mail sent moves the counters, as a booking e-mail does
])).replace(/"(time|now|generated_at)":"[^"]*"/g, "");
await reads();
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const schema = () => DB.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
const SKIP = ["audit_log", "eikon_schema", "bk_senders"];
const marks = () => DB.db.prepare("SELECT * FROM eikon_schema").all().map((r) => JSON.stringify(r));
const snap = (ts) => { const o = {}; for (const t of ts) if (!SKIP.includes(t)) o[t] = JSON.stringify(DB.db.prepare("SELECT * FROM " + t).all()); return o; };
const marksOld = marks(); const oldTables = tables(), oldSchema = schema(), before = snap(oldTables), readsOld = await reads();
const sendersCols = (rows) => JSON.stringify(rows.map((r) => { const c = { ...r }; for (const k of ["used_day", "used_today", "used_month", "used_this_month", "last_ok_at", "last_error", "cooldown_until", "last_fail_at"]) delete c[k]; return c; }));
const sendersBefore = sendersCols(DB.db.prepare("SELECT * FROM bk_senders").all());
const auditBefore = JSON.stringify(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all());
ok(oldTables.length > 20 && pids.length === 5, "old worker: a pharmacy with " + oldTables.length + " tables, 5 people and their records");

// ---- 2. the new worker on the same database
worker = NEW;
const readsNew = await reads();
ok(readsNew === readsOld, "the old routes answer the same on the new worker (people, search, orders, questions, loyalty, senders)");
for (const id of pids) { const n = await api("GET", "/people/" + id + "/now", { token: T }); if (n.status !== 200) ok(false, "now " + id + " " + n.status); }
ok(true, "GET /people/:id/now answers for every person");
const n1 = (await api("GET", "/people/" + pids[1] + "/now", { token: T })).json;
ok(n1.waiting.orders.length + n1.waiting.ready.length === 1 && n1.waiting.questions.length === 1 && n1.activity.length >= 4, "a name with Ċ finds its order, question, delivery and repeat (" + n1.activity.length + " in the story)");
await api("POST", "/people/" + pids[0] + "/profile", { token: T, body: { prefers: "whatsapp", sms_ok: false, allergies: "Penicillin" } });
const w = await api("POST", "/messages", { token: T, body: { person_id: pids[0], channel: "whatsapp", purpose: "ready", ref_kind: "order", ref_id: orders[0] ? orders[0].id : 0, to: "79123450", body: "Hi Carmel, your order is ready." } });
const e = await api("POST", "/messages", { token: T, body: { person_id: pids[0], channel: "email", to: "p0@example.com", body: "Hi Carmel", client_key: "k" } });
const no = await api("POST", "/messages", { token: T, body: { person_id: pids[2], channel: "email", to: "p2@example.com", body: "Hi" } });
await api("GET", "/messages/setup", { token: T });
ok(w.status === 200 && e.status === 200 && sent.length === 1 && no.status === 409, "new routes used: profile, WhatsApp recorded, one e-mail sent, a Bookings stop respected");
const after = snap(oldTables);
const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
ok(changed.length === 0, "every existing table is byte-for-byte unchanged (" + Object.keys(before).length + " tables, all rows, all columns)" + (changed.length ? ": changed " + changed.join(", ") : ""));
ok(sendersCols(DB.db.prepare("SELECT * FROM bk_senders").all()) === sendersBefore, "bk_senders: only the send counters moved (one e-mail), as a booking e-mail moves them");
ok(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all().slice(0, JSON.parse(auditBefore).length).map((r) => JSON.stringify(r)).join("\n") === JSON.parse(auditBefore).map((r) => JSON.stringify(r)).join("\n"), "audit_log: the old lines unchanged, new lines added (CUST_PROFILE, CUST_MESSAGE)");
const mk = marks(); ok(marksOld.every((m) => mk.includes(m)) && mk.filter((m) => !marksOld.includes(m)).every((m) => /ensureCustMsgSchema/.test(m)), "schema marks: the old ones unchanged, one added for the new tables: " + mk.filter((m) => !marksOld.includes(m)).join(" "));
const added = schema().filter((s) => !oldSchema.some((o) => o.name === s.name && o.sql === s.sql)).map((s) => s.type + " " + s.name);
const gone = oldSchema.filter((o) => !schema().some((s) => s.name === o.name && s.sql === o.sql)).map((s) => s.name);
const extra = added.filter((x) => !/^(table|index) (cust_|idx_cust_|uq_cust_)/.test(x) && !/schema_marks/.test(x));
ok(gone.length === 0 && extra.length === 0 && added.filter((x) => /^table cust_/.test(x)).length === 3, "schema: only added — " + added.join(", ") + (gone.length ? " | changed/gone: " + gone.join(", ") : "") + (extra.length ? " | unexpected: " + extra.join(", ") : ""));

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
const rb = await reads(); if (rb !== readsOld) { const a = JSON.parse(rb), b = JSON.parse(readsOld); a.forEach((x, i) => { if (JSON.stringify(x) !== JSON.stringify(b[i])) console.log("DIFF", i, JSON.stringify(x).slice(0, 600), "\n WAS", JSON.stringify(b[i]).slice(0, 600)); }); }
ok(rb === readsOld, "rollback: the old worker answers the same as before the upgrade (the new tables are simply not read)");
const o2 = await api("POST", "/client-orders/entries", { token: T, body: { order_date: D(0), client_name: "After Rollback", client_phone: "79000000", items_text: "X", needed_by: D(0), priority: 2 } });
ok(o2.status === 200, "rollback: the old worker still writes");
console.log(`\ncust-upgrade rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
