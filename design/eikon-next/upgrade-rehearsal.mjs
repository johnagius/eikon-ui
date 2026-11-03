// Upgrade rehearsal: the live worker (fixes-1) writes data, then the waiting worker (bookings-15)
// takes over the same database. Every existing row must be unchanged, logins must keep working,
// and every list the screens read must return the same records.
import { pathToFileURL } from "node:url";
const LIVE = "/tmp/claude-0/-home-user-eikon-ui/a14b1a07-7863-5333-b96b-a89485eb56dd/scratchpad/live";
const { D1Shim } = await import(pathToFileURL(LIVE + "/tests/worker/d1shim.mjs").href);
const { CORE_SCHEMA } = await import(pathToFileURL(LIVE + "/tests/worker/harness.mjs").href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const here = new URL(".", import.meta.url).pathname;
const OLD = (await import(pathToFileURL(here + "old.mjs").href)).default;
const NEW = (await import(pathToFileURL(here + "new.mjs").href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "3600" };
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

// ---- 1. the live server: sign up, a second chain, data on many screens
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const L = await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } }); const T = L.json.token;
const seeded = [], refused = [];
async function seed(m, p, body) { const r = await api(m, p, { token: T, body }); (r.status < 400 ? seeded : refused).push(m + " " + p + (r.status < 400 ? "" : " " + r.status + " " + r.text.slice(0, 90))); return r; }
const devs = (await api("GET", "/temperature/devices", { token: T })).json?.devices || [];
for (let i = 1; i <= 3; i++) for (const dv of devs.slice(0, 2)) await seed("POST", "/temperature/entries", { device_id: dv.id, entry_date: day(i), min_temp: 3.2, max_temp: 6.1 });
await seed("POST", "/cleaning/entries", { entry_date: day(2), time_in: "08:00", time_out: "08:40", cleaner_name: "Karl", staff_name: "Maria", notes: "" });
await seed("POST", "/dda-sales/entries", { entry_date: day(1), client_name: "Zammit Carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S1" });
await seed("POST", "/paid-out/entries", { entry_date: day(0), entry_time: "09:00", payee_name: "Courier Ltd", fee: 12.5, payment_method: "cash", reason: "Gozo" });
await seed("POST", "/client-tickets/entries", { client_name: "Borg Anna", client_phone: "79111222", issue: "Panadol syrup?", category: "General Enquiry", open_date: day(0) });
await seed("POST", "/client-deliveries/entries", { client_name: "Borg Anna", client_phone: "79111222", delivery_address: "5 Triq il-Mithna", order_date: day(0), delivery_date: day(0), items: "Panadol", status: "Pending" });
await seed("PUT", "/instructions/daily", { ymd: day(0), notes: "Inspector came", handover_out: [{ id: "b1", sev: "r", text: "Methadone at 9", created_at: new Date().toISOString() }] });
await seed("POST", "/appointments/entries", { patient_name: "Vella Anna", patient_phone: "79000000", appt_date: day(-1), appt_time: "10:00", date: day(-1), time: "10:00", service: "Blood pressure", notes: "staff note" });
await seed("POST", "/creditnotes/entries", { issue_date: day(0), entry_date: day(0), client_name: "Anna Borg", client_surname: "Borg", client_first_name: "Anna", telephone: "79111222", amount: 15.5, reason: "Return" });
await seed("POST", "/repeat-prescriptions/entries", { entry_date: day(30), client_name: "Zammit Carmel", client_id: "123456M", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", medicine: "Atorvastatin 20mg", dosage: "1 at night", date_written: day(30), valid_until: day(-150) });
await seed("POST", "/quotations/entries", { quote_date: day(0), item_description: "Panadol 500mg x24", supplier: "GSK", vat_rate: 18, cost_excl_vat: 2.4, qty_purchased: 10, retail_price: 4.5 });
await seed("POST", "/order-diary/entries", { entry_date: day(0), order_date: day(0), supplier: "Actavis", item_name: "Augmentin 625", quantity: 2, client_name: "Mrs Borg" });
await seed("POST", "/alerts/entries", { entry_date: day(0), alert_type: "recall", status: "open", item_name: "Losartan 50mg", batch: "L9", expiry: "2027-03-01", quantity: "6", reason: "Recall", storage_location: "room" });
await seed("POST", "/near-expiry/entries", { product_name: "Ventolin", batch: "V1", expiry_date: day(-40), quantity: 3 });
await seed("POST", "/daily-register/entries", { entry_date: day(0), client_name: "Grech Joseph", client_id: "654321M", medicine_name_dose: "Amoxil 500mg", posology: "1 tds", prescriber_name: "Dr Galea", prescriber_reg_no: "R1300", quantity: "21", doctor_name: "Dr Galea" });
console.log("seeded with the live server:", seeded.length, "| refused (wrong guess of fields, not part of the check):", refused.length);
refused.forEach((r) => console.log("   - " + r));

// ---- snapshot every table and every list the screens read
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const dump = (skip) => { const o = {}; for (const t of tables()) { if (skip(t)) continue; o[t] = DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all(); } return o; };
const volatile = (t) => /^bk_/.test(t) || ["sessions", "audit_log", "rate_limits", "login_attempts"].includes(t);
const before = dump(volatile);
const READS = ["/temperature/entries?month=" + month, "/cleaning/entries?month=" + month, "/dda-sales/entries?month=" + month, "/paid-out/entries?month=" + month,
  "/client-tickets/entries", "/client-deliveries/entries", "/instructions/daily?ymd=" + day(0), "/appointments/entries", "/creditnotes/entries", "/repeat-prescriptions/entries",
  "/quotations/entries", "/order-diary/entries?date=" + day(0), "/alerts/entries", "/near-expiry/entries", "/daily-register/entries?month=" + month, "/auth/me"];
const idsOf = (j) => { const arr = j && (j.entries || j.items || j.tickets || j.deliveries || j.notes || (j.record ? [j.record] : null) || (j.user ? [j.user] : null)); return Array.isArray(arr) ? arr.map((r) => JSON.stringify([r.id, r.client_name || r.payee_name || r.item_name || r.item_description || r.email || r.notes || r.device_id])).sort() : null; };
const readsBefore = {}; for (const p of READS) { const r = await api("GET", p, { token: T }); readsBefore[p] = { status: r.status, ids: idsOf(r.json) }; }
const rowCount = Object.values(before).reduce((n, rows) => n + rows.length, 0);
console.log("snapshot:", Object.keys(before).length, "tables,", rowCount, "rows");

// ---- 2. the waiting server takes over the same database
worker = NEW;
const me = await api("GET", "/auth/me", { token: T });
ok(me.status === 200 && me.json?.user?.email === "maria@demo.mt", "a session signed in on the old server still works on the new one");
const L2 = await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } });
ok(L2.json?.ok === true, "signing in with the same password works on the new server");
let same = 0; for (const p of READS) { const r = await api("GET", p, { token: T }); const b = readsBefore[p]; const eq = r.status === b.status && JSON.stringify(idsOf(r.json)) === JSON.stringify(b.ids); if (eq) same++; else console.log("   differs:", p, b.status, "→", r.status, JSON.stringify(b.ids)?.slice(0, 120), "→", JSON.stringify(idsOf(r.json))?.slice(0, 120)); }
ok(same === READS.length, `every list the screens read returns the same records (${same}/${READS.length})`);
// use the new features: set up bookings, book, import the old appointments
const su = await api("GET", "/bookings/setup", { token: T }); ok(su.status === 200, "Bookings opens on the upgraded database (its tables create themselves)");
const imp = await api("POST", "/bookings/import-legacy?dry=1", { token: T, body: {} }); ok(imp.status < 500, "the old appointments can be checked for import: " + imp.status + " " + imp.text.slice(0, 80));
const imp2 = await api("POST", "/bookings/import-legacy", { token: T, body: {} }); ok(imp2.status < 500, "and imported: " + imp2.status + " " + imp2.text.slice(0, 80));
const after = dump(volatile);
let changed = []; for (const t of Object.keys(before)) if (JSON.stringify(before[t]) !== JSON.stringify(after[t])) changed.push(t + " (" + before[t].length + "→" + (after[t] || []).length + " rows)");
ok(changed.length === 0, "every existing table is byte-for-byte unchanged after the upgrade, Bookings set-up and import" + (changed.length ? ": " + changed.join(", ") : ""));
const added = tables().filter((t) => !(t in before) && !volatile(t)); ok(added.length === 0, "the only new tables are bk_ ones" + (added.length ? ": " + added.join(", ") : ""));
// ---- 3. rollback: the old server again, on the upgraded database
worker = OLD;
const me3 = await api("GET", "/auth/me", { token: T }); ok(me3.status === 200, "after a rollback the same session still works");
let same3 = 0; for (const p of READS) { const r = await api("GET", p, { token: T }); if (r.status === readsBefore[p].status && JSON.stringify(idsOf(r.json)) === JSON.stringify(readsBefore[p].ids)) same3++; else console.log("   differs after rollback:", p); }
ok(same3 === READS.length, `after a rollback every list still returns the same records (${same3}/${READS.length})`);
console.log("new tables:", tables().filter((t) => /^bk_/.test(t)).join(", "));
console.log(pass, "passed,", fail, "failed");
