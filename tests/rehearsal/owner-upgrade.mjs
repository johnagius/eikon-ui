// Upgrade rehearsal for How we're doing (/owner/summary, /owner/records), adapted from team-upgrade.mjs.
// The worker as it was (base commit, or OLD_WORKER=path) builds a database for a group of two pharmacies and its
// head office, a staff member, and another group, with every register the new page reads. Then this copy's worker
// takes over the same database: every existing GET answers byte for byte as before; every new read, by every kind of
// account, leaves every table byte-identical (no schema change, no row written, no audit line); refusals are as
// designed. Then the old worker again (rollback): still the same answers.
// Run: node --no-warnings tests/rehearsal/owner-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "owner-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = OLD;
async function api(method, path, { body, token, form, headers } = {}) {
  const h = new Headers(headers || {}); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + path, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const mt = (n) => { const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); const p = t.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] - n)).toISOString().slice(0, 10); };
async function insertUser(orgId, locId, email, role) {
  const enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16)), pw = "Passw0rd!";
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  DB.db.prepare("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,1,?)")
    .run(orgId, email, email.split("@")[0], role, Buffer.from(salt).toString("base64"), Buffer.from(new Uint8Array(bits)).toString("base64"), 100000, locId);
  return (await api("POST", "/auth/login", { body: { email, password: pw } })).json.token;
}
function dump() {
  const tables = DB.db.prepare("SELECT name, sql FROM sqlite_master ORDER BY type, name").all();
  return tables.map((t) => t.name + "|" + t.sql + "|" + (t.sql && /^CREATE TABLE/i.test(t.sql) ? JSON.stringify(DB.db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()) : "")).join("\n");
}

// ---- the old worker builds the database
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Chain", location_name: "Pharmacy A", admin_email: "a@x.mt", admin_full_name: "Maria", admin_password: "Passw0rd!" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B'), (600, 1, 'Head office')").run();
DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other')").run(); DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Stranger')").run();
const T = { A: (await api("POST", "/auth/login", { body: { email: "a@x.mt", password: "Passw0rd!" } })).json.token, B: await insertUser(1, 2, "b@x.mt", "admin"), staff: await insertUser(1, 1, "s@x.mt", "staff"), ho: await insertUser(1, 600, "ho@x.mt", "admin"), str: await insertUser(2, 50, "x@x.mt", "admin") };
const must = async (m, p, tok, body, headers) => { const r = await api(m, p, { token: tok, body, headers }); if (r.status >= 300) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 200)); return r.json; };
for (const [tok, k] of [[T.A, 0], [T.B, 1]]) {
  for (let i = 1; i <= 12; i++) await must("PUT", "/endofday/record", tok, { record: { eod_date: mt(i), time_of_day: "PM", staff_name: "S", float_amount: 500, x: [{ amount: String(900 + i + k), remark: "" }], epos: [{ amount: "100", remark: "" }], cheques: [], paid_outs: [{ amount: "5", remark: "" }], cash: { n500: 1, n200: 3, coins_total: "1.5" }, notes: "", action: i > 2 ? "LOCK" : "SAVE", ...(i > 2 ? { locked_at: new Date().toISOString() } : {}) } });
  for (let i = 1; i <= 6; i++) await must("POST", "/paid-out/entries", tok, { entry_date: mt(i), entry_time: "10:00", payee_name: "Courier", fee: 5 + i, payment_method: "cash", invoice_no: "", cheque_no: "", reason: "" });
  const cn = await must("POST", "/creditnotes/entries", tok, { issue_date: mt(3), client_name: "Ġorġ", client_surname: "Żammit", telephone: "79000000", amount: 30, no_expiry: 1 });
  await must("POST", `/creditnotes/entries/${cn.id}/purchases`, tok, { amount: 10, receipt_number: "R" });
  await must("POST", "/locumreceipts/receipts", tok, { receipt_date: mt(2), hours: 4, locum_full_name: "Dr L", registration_number: "R1", fee_per_hour: 20, total_fee: 80, day_type: "normal" }, { "X-Eikon-Edit-Pass": "!4321" });
  for (const p of ["/dda-sales/entries", "/dda-poyc/entries"]) await must("POST", p, tok, { entry_date: mt(2), client_name: "Borg", client_id_card: "1M", client_address: "x", medicine_name_dose: "Morphine", quantity: 2, doctor_name: "Dr", doctor_reg_no: "1", prescription_serial_no: "S" + k });
  await must("POST", "/dda-purchases/entries", tok, { entry_date: mt(2), dda_name_dose: "Morphine", quantity: 20, agent: "A", invoice_number: "I" });
  await must("POST", "/client-orders/entries", tok, { order_date: mt(5), client_name: "Vella", client_phone: "1", items_text: "x", priority: 2, needed_by: mt(2) });
  await must("POST", "/client-tickets/entries", tok, { ticket_id: "TKT-1", open_date: mt(4), client_name: "Vella", phone: "1", issue: "q", category: "General Enquiry", priority: 2, status: "Open" });
  await must("POST", "/client-deliveries/entries", tok, { delivery_id: "DEL-1", order_date: mt(4), scheduled_date: mt(2), client_name: "Vella", delivery_address: "x", status: "Scheduled" });
  await must("POST", "/repeat-prescriptions/entries", tok, { entry_date: mt(20), expires_date: mt(-5), client_name: "Vella", client_id: "1M", medicine_name_dose: "x", posology: "1", prescriber_name: "Dr", prescriber_reg_no: "1" });
  await must("POST", "/cleaning/entries", tok, { entry_date: mt(3), time_in: "08:00", time_out: "09:00", cleaner_name: "K", staff_name: "S", notes: "" });
  await must("POST", "/locumregister/entries", tok, { entry_date: mt(3), time_in: "08:00", time_out: "13:00", locum_full_name: "Dr L", registration_number: "R1" });
  const st = await must("POST", "/shifts/staff", tok, { full_name: "Doris", designation: "assistant", contracted_hours: 20 });
  await must("POST", "/shifts/assignments", tok, { staff_id: st.staff_id || st.id, shift_date: mt(2), start_time: "09:00", end_time: "13:00" });
  await must("GET", "/today", tok); // the screens' first read creates the tables a new pharmacy has, as before
}
const GETS = ["/today", "/endofday?date=" + mt(3), "/paid-out/entries?month=" + mt(1).slice(0, 7), "/creditnotes/list", "/dda-sales/entries?month=" + mt(2).slice(0, 7), "/admin/pharmacy-overview?month=" + mt(1).slice(0, 7), "/client-orders/entries", "/shifts/staff"];
const strip = (s) => s.replace(/"(now|generated_at|server_time|ts)":"[^"]*"/g, "");
const snap = async () => { const o = {}; for (const who of Object.keys(T)) for (const g of GETS) { const r = await api("GET", g, { token: T[who] }); o[who + " " + g] = r.status + " " + strip(r.text); } return o; };
const oldAnswers = await snap();
const before = dump();
ok((await api("GET", "/owner/summary", { token: T.A })).status === 404, "the old worker has no /owner/summary (404), as expected");

// ---- this copy's worker takes over
worker = NEW;
const newAnswers = await snap();
const diff = Object.keys(oldAnswers).filter((k) => oldAnswers[k] !== newAnswers[k]);
ok(!diff.length, "every existing read answers exactly as before (" + Object.keys(oldAnswers).length + " reads)" + (diff.length ? ": " + diff.slice(0, 3).join(", ") : ""));
ok(dump() === before, "existing reads under the new worker leave the database byte-identical");
const q = "?from=" + mt(13) + "&to=" + mt(0) + "&cmp_from=" + mt(27) + "&cmp_to=" + mt(14);
const kinds = "&kinds=eod,paid_outs,locum_receipts,credit_notes,credit_note_uses,orders,questions,deliveries,repeats,dda_supplied,dda_poyc,dda_received";
const expect = [["A", "", 200], ["A", "&loc=2", 403], ["B", "", 200], ["B", "&loc=1", 403], ["staff", "", 403], ["ho", "", 200], ["ho", "&loc=1", 200], ["ho", "&loc=50", 403], ["ho", "&loc=600", 403], ["str", "", 200], ["str", "&loc=1", 403]];
let codes = [];
for (const [who, extra, want] of expect) for (const path of ["/owner/summary" + q + extra, "/owner/records" + q + kinds + extra, "/owner/records" + q + "&kinds=shifts,locum_register" + extra]) {
  const r = await api("GET", path, { token: T[who] }); codes.push(who + extra + ":" + r.status);
  if (r.status !== want) ok(false, who + " " + path + " → " + r.status + ", expected " + want);
}
ok(codes.length === 33, "every new read by every account answered as designed (" + codes.length + " reads: admins their own, head office its group, staff and strangers refused)");
const s = (await api("GET", "/owner/summary" + q, { token: T.ho })).json;
ok(s.pharmacies.map((p) => p.name).join() === "Pharmacy A,Pharmacy B" && s.pharmacies[0].money.days_closed === 12 && s.pharmacies[0].money.takings === 12 * 900 + 78, "head office: both pharmacies, 12 days closed, takings as saved (" + s.pharmacies[0].money.takings + ")");
const strTxt = (await api("GET", "/owner/summary" + q, { token: T.str })).text;
ok(!/Pharmacy A|Pharmacy B|Ġorġ/.test(strTxt), "another group sees none of this group's names or figures");
ok(dump() === before, "after " + (codes.length + 2) + " new reads the database is byte-identical: no table, column, index, row or audit line added");

// ---- rollback: the old worker again
worker = OLD;
const back = await snap();
ok(Object.keys(oldAnswers).every((k) => oldAnswers[k] === back[k]), "rollback: the old worker answers every read exactly as before");
ok(dump() === before, "rollback: database still byte-identical");
console.log(`\nowner rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
