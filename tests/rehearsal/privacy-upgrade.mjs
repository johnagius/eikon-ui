// Upgrade rehearsal for Privacy (gdpr block): two new tables, five new routes, one guarded line in scheduled().
// The worker as it was (base commit, or OLD_WORKER=path) fills a pharmacy (people with profiles, orders, questions,
// deliveries, repeat prescriptions, DDA sales, bookings, loyalty, credit notes); this copy's worker takes over the same
// database. Proves:
//   - the read-only new routes (privacy summary, export, Settings download parts, erasures list) and the timer leave every
//     existing table byte-for-byte unchanged (audit_log only gains lines; schema marks gain one);
//   - an erase changes exactly the rows and columns its plan listed and nothing else; the legal registers are untouched;
//   - the undo puts every one of those rows back byte for byte (the person's version and stamps move, as any edit);
//   - the schema change is exactly gdpr_erasures, gdpr_erasure_rows and their indexes;
//   - rollback: the old worker answers the same as before on the upgraded database.
// Run: node --no-warnings tests/rehearsal/privacy-upgrade.mjs [baseCommit]
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
globalThis.fetch = async (u) => { throw new Error("network refused " + u); };
const dir = mkdtempSync(join(tmpdir(), "privacy-rehearsal-"));
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
const NAMES = ["Laura Borg", "Carmel Zammit", "Ċettina Micallef", "Joseph Grech"];
const pids = [];
for (const [i, n] of NAMES.entries()) {
  const card = (100000 + i) + "M", phone = "7912345" + i;
  const r = await api("POST", "/people", { token: T, body: { name: n, id_card: card, phone, email: "p" + i + "@example.com", address: i + " Triq il-Kbira", notes: "Note " + i } });
  pids.push(r.json.person.id);
  await api("POST", "/people/" + r.json.person.id + "/profile", { token: T, body: { prefers: "whatsapp", allergies: "Penicillin " + i } });
  await api("POST", "/client-orders/entries", { token: T, body: { order_date: D(-i), client_name: n, client_phone: phone, client_email: "p" + i + "@example.com", items_text: "Item " + i, needed_by: D(i), priority: 2, notes: "ring" } });
  await api("POST", "/client-tickets/entries", { token: T, body: { open_date: D(-i), client_name: n, phone, issue: "Question " + i, category: "General Enquiry", priority: 2, status: "Open", ticket_id: "TKT-0000" + i } });
  await api("POST", "/client-deliveries/entries", { token: T, body: { order_date: D(-i), scheduled_date: D(1), client_name: n, phone, delivery_address: "1 Triq", items: "Box " + i, status: "Scheduled", delivery_id: "DEL-0000" + i } });
  await api("POST", "/repeat-prescriptions/entries", { token: T, body: { entry_date: D(-20 - i), client_name: n, client_id: card, medicine_name_dose: "Med " + i, posology: "1 od", prescriber_name: "Dr A", prescriber_reg_no: "1", collect_every_days: 28 } });
  await api("POST", "/dda-sales/entries", { token: T, body: { entry_date: D(-i), client_name: n, client_id_card: card, client_address: "1 Triq", medicine_name_dose: "Morphine 10mg", quantity: 1, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S" + i } });
  await api("POST", "/creditnotes", { token: T, body: { issue_date: D(-i), client_name: n.split(" ")[0], client_surname: n.split(" ")[1], telephone: phone, amount: 5 + i } });
}
const pv = await api("POST", "/bookings/providers", { token: T, body: { name: "Maria", hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((x) => [x, [["08:00", "20:00"]]])) } });
const sv = await api("POST", "/bookings/services", { token: T, body: { name: "Flu vaccine", durationMin: 10, providerIds: [pv.json.provider.id] } });
await api("POST", "/bookings", { token: T, body: { serviceId: sv.json.service.id, date: D(3), start: "10:00", personName: NAMES[0], personEmail: "p0@example.com" } });
await api("POST", "/loyalty/campaigns", { token: T, body: { id: "c1", name: "Stamps", type: "stamp_card", active: true, open_ended: true, stamp_target: 10 } });
await api("POST", "/loyalty/transactions", { token: T, body: { client_id: "0100000M", client_name: NAMES[0], campaign_id: "c1", items: [{ desc: "A", qty: 2 }], stamps_awarded: 2, action: "record", date: D(0) } });

const reads = async () => JSON.stringify(await Promise.all([
  ...pids.map((id) => api("GET", "/people/" + id, { token: T }).then((r) => r.json)),
  ...pids.map((id) => api("GET", "/people/" + id + "/now", { token: T }).then((r) => r.json)),
  api("GET", "/people?q=borg", { token: T }).then((r) => r.json),
  api("GET", "/client-orders/entries?month=" + D(0).slice(0, 7), { token: T }).then((r) => r.json),
  api("GET", "/dda-sales/entries?month=" + D(0).slice(0, 7), { token: T }).then((r) => r.json),
  api("GET", "/loyalty/transactions", { token: T }).then((r) => r.json)
])).replace(/"(time|now|generated_at|date)":"[^"]*"/g, "");
await reads();
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const schema = () => DB.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
const SKIP = ["audit_log", "eikon_schema"];
const marks = () => DB.db.prepare("SELECT * FROM eikon_schema").all().map((r) => JSON.stringify(r));
const rows = (ts) => { const o = {}; for (const t of ts) if (!SKIP.includes(t)) for (const r of DB.db.prepare("SELECT rowid AS __rid, * FROM " + t).all()) o[t + ":" + r.__rid] = r; return o; };
const diff = (a, b) => { const out = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (!a[k] || !b[k]) { out[k] = a[k] ? "gone" : "added"; continue; } const c = Object.keys(a[k]).filter((x) => JSON.stringify(a[k][x]) !== JSON.stringify(b[k][x])); if (c.length) out[k] = c.sort(); } return out; };
const marksOld = marks(), oldTables = tables(), oldSchema = schema(), before = rows(oldTables), readsOld = await reads();
const auditOld = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => JSON.stringify(r));
ok(oldTables.length > 20 && pids.length === 4, "old worker: a pharmacy with " + oldTables.length + " tables, " + Object.keys(before).length + " rows, 4 people and their records");

// ---- 2. the new worker on the same database: reads first
worker = NEW;
ok(await reads() === readsOld, "the old routes answer the same on the new worker (people, story, search, orders, DDA, loyalty)");
const pr = await api("POST", "/people/" + pids[0] + "/privacy", { token: T, body: {} });
const ex = await api("POST", "/people/" + pids[0] + "/export", { token: T, body: {} });
const parts = {};
for (const p of ["customers", "staff", "accounts"]) parts[p] = (await api("GET", "/export/records?part=" + p, { token: T })).json;
for (const p of ["bookings", "appointments", "messages", "tills", "loyalty", "shifts", "leave"]) parts[p] = (await api("GET", "/export/records?part=" + p + "&from=" + D(-60) + "&to=" + D(30), { token: T })).json;
const er0 = await api("GET", "/people/" + pids[0] + "/erasures", { token: T });
const waits = []; await NEW.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.allSettled(waits);
ok(pr.status === 200 && ex.status === 200 && er0.status === 200 && Object.values(parts).every((x) => x && x.ok), "new read routes answer: privacy summary, export (" + ex.json.rows + " rows in " + ex.json.sections.length + " tables), 10 download parts, erasures list; timer ran");
ok(parts.customers.rows.length === 4 && parts.bookings.rows.length === 1 && parts.loyalty.rows.length === 1, "download parts: 4 customers, 1 booking, 1 loyalty visit");
let d = diff(before, rows(oldTables));
ok(Object.keys(d).length === 0, "after the reads and the timer every existing table is byte-for-byte unchanged (" + Object.keys(before).length + " rows)" + (Object.keys(d).length ? ": " + JSON.stringify(d).slice(0, 400) : ""));

// ---- 3. erase one person: exactly the planned rows and columns
const plan = (await api("POST", "/people/" + pids[0] + "/erase", { token: T, body: {} })).json;
const planned = {};
for (const s of plan.sections) if (s.change) planned[s.table] = s.columns.slice().sort();
const er = await api("POST", "/people/" + pids[0] + "/erase", { token: T, body: { confirm: true, plan: plan.plan, reason: "rehearsal" } });
ok(er.status === 200 && er.json.changed === plan.total_change, "erase: " + er.json.changed + " rows changed as the plan said (" + Object.keys(planned).join(", ") + ")");
const afterErase = rows(oldTables);
d = diff(before, afterErase);
const bad = Object.entries(d).filter(([k, cols]) => {
  const t = k.split(":")[0];
  if (!planned[t] || !Array.isArray(cols)) return true;
  const allowed = new Set(planned[t].concat(t === "people" ? ["version", "updated_at", "updated_by"] : []));
  return cols.some((c) => !allowed.has(c));
});
ok(bad.length === 0, "erase: only the planned tables and columns changed" + (bad.length ? ": " + JSON.stringify(bad).slice(0, 400) : ""));
ok(Object.keys(d).filter((k) => k.startsWith("people:")).length === 1 && Object.keys(d).every((k) => !/^(dda_sales_entries|repeat_prescription_entries)/.test(k)), "erase: one customer record; DDA and repeat prescriptions kept (John: legal records keep the name)");
ok(["bk_bookings", "loyalty_clients", "loyalty_transactions"].every((t) => !!planned[t] === Object.keys(d).some((k) => k.startsWith(t + ":"))) && ["bk_bookings", "loyalty_"].every((t) => Object.keys(planned).some((x) => x.startsWith(t))), "erase: the person's bookings and loyalty are anonymised (John), as the plan said: " + Object.keys(planned).filter((t) => /^(bk_|loyalty_)/.test(t)).join(", "));
ok(Object.keys(d).every((k) => { const r = before[k]; return Number(r.location_id) === 1; }), "erase: only this pharmacy's rows");
const others = Object.keys(d).filter((k) => JSON.stringify(before[k]).includes("Carmel") || JSON.stringify(before[k]).includes("Joseph"));
ok(others.length === 0, "erase: nobody else's rows changed");

// ---- 4. undo: every row back
const un = await api("POST", "/people/erasures/" + er.json.erasure_id + "/undo", { token: T, body: {} });
d = diff(before, rows(oldTables));
const pk = "people:" + pids[0];
const left = Object.entries(d).filter(([k, cols]) => !(k === pk && cols.every((c) => ["version", "updated_at", "updated_by"].includes(c))));
ok(un.status === 200 && un.json.skipped.length === 0 && left.length === 0, "undo: every changed row back byte for byte (the person's version and stamps moved, as any edit)" + (left.length ? ": " + JSON.stringify(left).slice(0, 300) : ""));
ok(DB.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasure_rows").get().c === 0, "undo: the copies of the old values are deleted");

// ---- 5. audit, marks, schema
const auditNew = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all();
ok(auditNew.slice(0, auditOld.length).map((r) => JSON.stringify(r)).join("\n") === auditOld.join("\n"), "audit_log: the old lines unchanged; added " + auditNew.slice(auditOld.length).map((r) => r.action).join(", "));
const mk = marks(); ok(marksOld.every((m) => mk.includes(m)) && mk.filter((m) => !marksOld.includes(m)).every((m) => /ensureGdprSchema|ensureCustMsgSchema/.test(m)), "schema marks: the old ones unchanged; added " + mk.filter((m) => !marksOld.includes(m)).map((m) => JSON.parse(m).k).join(" "));
const added = schema().filter((s) => !oldSchema.some((o) => o.name === s.name && o.sql === s.sql)).map((s) => s.type + " " + s.name);
const gone = oldSchema.filter((o) => !schema().some((s) => s.name === o.name && s.sql === o.sql)).map((s) => s.name);
ok(gone.length === 0 && added.every((x) => /gdpr_/.test(x)) && added.filter((x) => /^table /.test(x)).length === 2, "schema: only added — " + added.join(", ") + (gone.length ? " | changed/gone: " + gone.join(", ") : ""));

// ---- 6. rollback
worker = OLD;
const rb = await reads();
const calm = (x) => x.replace(/"(version|updated_at)":("[^"]*"|\d+)/g, ""); // the erased-and-undone person's version and stamp moved, as any edit
ok(calm(rb) === calm(readsOld), "rollback: the old worker answers the same as before the upgrade (the person's version and stamp aside)");
const o2 = await api("POST", "/client-orders/entries", { token: T, body: { order_date: D(0), client_name: "After Rollback", client_phone: "79000000", items_text: "X", needed_by: D(0), priority: 2 } });
ok(o2.status === 200, "rollback: the old worker still writes");
console.log(`\nprivacy-upgrade rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
