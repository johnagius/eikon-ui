// Privacy (gdpr block): export everything held on one person, erase one person (anonymise in place, 24-hour undo),
// Settings › Download our records parts. Every test seeds the same person in three places: this pharmacy (org 1,
// location 1), another pharmacy of the same group (org 1, location 2) and another group (org 2, location 3); only the
// first may ever be read or changed.
import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Every table the worker makes, made up front (a second copy of the worker with its ensure*Schema functions exported).
let ens = null;
async function ensureAll(app) {
  if (!ens) {
    let src = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "cloudflare-worker", "code"), "utf8");
    const names = Array.from(new Set([...src.matchAll(/^(?:const|async function) (ensure\w*Schema)\b(?!__)/gm)].map((m) => m[1])));
    src += "\nexport const __ens = {" + names.join(",") + "};\nexport function __reset() { _contactsSchemaReady = false; }\n"; // module-level "done" flag of the contacts tables
    const f = join(mkdtempSync(join(tmpdir(), "eikon-ens-")), "w.mjs");
    writeFileSync(f, src);
    ens = await import(pathToFileURL(f).href);
  }
  ens.__reset();
  const log = console.log; console.log = () => {};
  try { for (const fn of Object.values(ens.__ens)) { try { await fn({ DB: app.DB }); } catch (e) {} } } finally { console.log = log; }
}

const NAME = "Laura Borg", CARD = "0012345M", PHONE = "79123456", EMAIL = "laura.borg@example.com";
const PERSONAL = [NAME, CARD, PHONE, EMAIL, "Triq il-Kbira"];

function ins(app, table, row0) {
  const row = Object.assign({}, row0);
  // NOT NULL columns without a default the test does not care about: a blank of their type
  for (const c of app.DB.db.prepare("PRAGMA table_info(" + table + ")").all()) if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = /INT|REAL/i.test(c.type) ? 0 : "";
  const cols = Object.keys(row);
  return app.DB.db.prepare("INSERT INTO " + table + " (" + cols.join(",") + ") VALUES (" + cols.map(() => "?").join(",") + ")").run(...cols.map((c) => row[c])).lastInsertRowid;
}

// One pharmacy's worth of the person's records. Returns the ids keyed by table.
function seedPerson(app, org, loc, extra = "") {
  const at = { org_id: org, location_id: loc };
  const ids = {};
  const put = (t, r) => { (ids[t] = ids[t] || []).push(Number(ins(app, t, Object.assign({}, at, r)))); };
  put("client_orders_entries", { order_date: "2026-10-01", client_name: NAME, client_phone: PHONE, client_email: EMAIL, client_address: "1 Triq il-Kbira", items_text: "Vitamin D" + extra, notes: "call after 5" });
  put("client_tickets_entries", { open_date: "2026-10-02", client_name: NAME, phone: PHONE, email: EMAIL, issue: "Is this safe with ibuprofen?", notes_log: '[{"text":"rang her"}]' });
  put("client_deliveries", { order_date: "2026-10-03", client_name: NAME, phone: PHONE, delivery_address: "1 Triq il-Kbira", contains_controlled: 0, items: "[]" });
  put("client_deliveries", { order_date: "2026-10-04", client_name: NAME, phone: PHONE, delivery_address: "1 Triq il-Kbira", contains_controlled: 1, items: "[]" });
  put("dda_sales_entries", { entry_date: "2026-10-05", client_name: NAME, client_id_card: CARD, client_address: "1 Triq il-Kbira", medicine_name_dose: "Morphine 10mg", quantity: 1, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S1" });
  put("dda_poyc_entries", { entry_date: "2026-10-05", client_name: NAME, client_id_card: "12345M", client_address: "1 Triq il-Kbira", medicine_name_dose: "Tramadol", quantity: 1, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S2" });
  put("daily_register_entries", { entry_date: "2026-10-06", client_name: NAME, client_id: CARD, medicine_name_dose: "Amoxicillin", posology: "1 tds", prescriber_name: "Dr Galea", prescriber_reg_no: "R2" });
  put("repeat_prescription_entries", { entry_date: "2026-10-06", client_name: NAME, client_id: CARD, medicine_name_dose: "Ramipril", posology: "1 od", prescriber_name: "Dr Galea", prescriber_reg_no: "R2" });
  put("bk_bookings", { service_id: 1, provider_id: 1, person_name: NAME, person_phone: PHONE, person_email: EMAIL, date: "2026-10-07", start_time: "09:00", end_time: "09:15", notes: "flu jab" });
  put("appt_appointments", { patient_name: NAME, patient_id_card: CARD, patient_phone: PHONE, date: "2026-10-08", time: "10:00", status: "booked", notes: "knee" });
  put("vaccinations", { given_on: "2026-10-09", client_first: "Laura", client_last: "Borg", phone: PHONE, id_card: CARD, vaccine_name: "Flu" });
  put("poct_records", { record_id: "R" + org + loc, test_type: "bp", performed_at_iso: "2026-10-10T09:00:00Z", patient_id: CARD, patient_name: NAME, patient_phone: PHONE, record_json: JSON.stringify({ patient: { patientId: CARD, name: NAME, phone: PHONE }, bp: { sys: 130 } }) });
  put("loyalty_clients", { id_card: CARD, name: NAME });
  put("loyalty_transactions", { client_id_card: CARD, client_name: NAME, txn_date: "2026-10-11", total: 12.5, points_awarded: 12 });
  put("credit_notes", { issue_date: "2026-10-12", client_name: "Laura", client_surname: "Borg", telephone: PHONE, email: EMAIL, amount: 5 });
  put("pos_sales", { sale_date: "2026-10-13", client_name: NAME, client_id: CARD, total: 3, created_by: 1, offline_id: "o" + org + loc });
  put("contacts_clients", { name: NAME, id_card: CARD, phone: PHONE, address: "1 Triq il-Kbira" });
  put("label_history", { label_id: "L" + org + loc, label_json: JSON.stringify({ patientName: NAME, drug: "Amoxicillin", name: "Amoxicillin 500" }) });
  put("vaccines_orders", { created_at: "2026-10-14", client_first: "Laura", client_last: "Borg", phone: PHONE, email: EMAIL });
  put("screening_campaigns", { campaign_id: "C" + org + loc, campaign_json: JSON.stringify({ name: "BP week", participants: [{ id: "p1", name: NAME, idCard: CARD, phone: PHONE, sys: 120 }, { id: "p2", name: "Mark Vella", idCard: "0099999M", phone: "79000000" }] }) });
  put("poct_patients", { patient_id: CARD, name: NAME, phone: PHONE, address: "1 Triq il-Kbira", patient_json: JSON.stringify({ patientId: CARD, name: NAME, phone: PHONE, age: 52 }) });
  put("pharmacy_calc_patients", { patient_name: NAME, id_card: CARD });
  put("bk_waitlist", { service_id: 1, person_name: NAME, person_phone: PHONE });
  put("appt_waitlist", { patient_name: NAME, patient_id_card: CARD, patient_phone: PHONE, added_date: "2026-10-16" });
  put("pv_reports", { report_id: "PV" + org + loc, report_json: JSON.stringify({ pt_id: CARD, pt_initials: "L.B.", report_date: "2026-10-15", reaction: "rash" }) });
  return ids;
}

async function world(app) {
  await ensureAll(app);
  const A = await app.bootstrap();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Second Pharmacy')").run();
  app.DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (3, 2, 'Other Pharmacy')").run();
  const staff = await app.addUser({ email: "staff@example.com", role: "staff", name: "Sara Grech" });
  const B = await app.addUser({ email: "b@example.com", locationId: 2, name: "Ben Zammit" });
  const C = await app.addUser({ orgId: 2, locationId: 3, email: "c@example.com", name: "Carl Farrugia" });
  const mk = async (u) => (await app.api("POST", "/people", { token: u.token, body: { name: NAME, id_card: CARD, phone: PHONE, email: EMAIL, address: "1 Triq il-Kbira", notes: "allergic to penicillin" } })).json.person;
  const pA = await mk(A), pB = await mk(B), pC = await mk(C);
  const ids = seedPerson(app, 1, 1);
  seedPerson(app, 1, 2, " (second pharmacy)");
  seedPerson(app, 2, 3, " (other group)");
  await app.api("POST", "/people/" + pA.id + "/profile", { token: A.token, body: { prefers: "whatsapp", allergies: "penicillin", version: 0 } });
  ins(app, "cust_messages", { org_id: 1, location_id: 1, person_id: pA.id, person_name: NAME, channel: "email", to_addr: EMAIL, subject: "Ready", body: "Dear Laura, your order is ready", status: "sent" });
  ins(app, "cust_msg_optout", { email: EMAIL, org_id: 1, location_id: 1 });
  // Same name only (no phone, no card): maybe. Same name, another card: someone else.
  const maybe = Number(ins(app, "client_orders_entries", { org_id: 1, location_id: 1, order_date: "2026-09-01", client_name: NAME, items_text: "Plasters" }));
  const other = Number(ins(app, "dda_sales_entries", { org_id: 1, location_id: 1, entry_date: "2026-09-02", client_name: NAME, client_id_card: "0777777M", client_address: "Mosta", medicine_name_dose: "Oxycodone", quantity: 1, doctor_name: "Dr X", doctor_reg_no: "R9", prescription_serial_no: "S9" }));
  const stranger = Number(ins(app, "client_orders_entries", { org_id: 1, location_id: 1, order_date: "2026-09-03", client_name: "Mark Vella", client_phone: "79000000", items_text: "Soap" }));
  return { A, B, C, staff, pA, pB, pC, ids, maybe, other, stranger };
}

const PERSON_TABLES = ["people", "cust_profile", "cust_messages", "cust_msg_optout", "client_orders_entries", "client_tickets_entries", "client_deliveries", "dda_sales_entries", "dda_poyc_entries",
  "daily_register_entries", "repeat_prescription_entries", "bk_bookings", "appt_appointments", "vaccinations", "poct_records", "loyalty_clients", "loyalty_transactions", "credit_notes",
  "pos_sales", "contacts_clients", "label_history", "vaccines_orders", "screening_campaigns", "pv_reports", "poct_patients", "pharmacy_calc_patients", "bk_waitlist", "appt_waitlist", "audit_log"];
function snapshot(app) {
  const s = {};
  for (const t of PERSON_TABLES) for (const r of app.DB.db.prepare("SELECT rowid AS __rid, * FROM " + t).all()) s[t + ":" + r.__rid] = r;
  return s;
}
function diff(a, b) {
  const out = {};
  for (const k of Object.keys(a)) {
    if (!b[k]) { out[k] = "deleted"; continue; }
    const cols = Object.keys(a[k]).filter((c) => JSON.stringify(a[k][c]) !== JSON.stringify(b[k][c]));
    if (cols.length) out[k] = cols.sort();
  }
  for (const k of Object.keys(b)) if (!a[k]) out[k] = "added";
  return out;
}

test("privacy: staff are refused on every privacy route (403), also for the preview", async (app) => {
  const w = await world(app);
  const T = w.staff.token, id = w.pA.id;
  for (const [m, p] of [["POST", "/people/" + id + "/privacy"], ["POST", "/people/" + id + "/export"], ["POST", "/people/" + id + "/erase"], ["GET", "/people/" + id + "/erasures"],
    ["POST", "/people/erasures/gdpr_00000000-0000-0000-0000-000000000000/undo"], ["GET", "/export/records?part=customers"]]) {
    const r = await app.api(m, p, { token: T, body: m === "POST" ? {} : undefined });
    eq(r.status, 403, m + " " + p);
  }
});

test("privacy: export holds every table that names the person, this pharmacy only; same-name rows only when ticked", async (app) => {
  const w = await world(app);
  const r = await app.api("POST", "/people/" + w.pA.id + "/export", { token: w.A.token, body: {} });
  eq(r.status, 200, r.text.slice(0, 200));
  const x = r.json;
  eq(x.format, "eikon.person-export.v1");
  const tables = x.sections.map((s) => s.table).sort();
  for (const t of ["cust_profile", "cust_messages", "cust_msg_optout", "client_orders_entries", "client_tickets_entries", "client_deliveries", "dda_sales_entries", "dda_poyc_entries", "daily_register_entries",
    "repeat_prescription_entries", "bk_bookings", "appt_appointments", "vaccinations", "poct_records", "loyalty_clients", "loyalty_transactions", "credit_notes", "pos_sales", "contacts_clients",
    "vaccines_orders", "screening_campaigns", "pv_reports", "poct_patients", "pharmacy_calc_patients", "bk_waitlist", "appt_waitlist"]) ok(tables.includes(t), "missing " + t + " in " + tables.join(","));
  // never another pharmacy's row
  const all = x.sections.flatMap((s) => s.rows);
  ok(all.every((row) => row.org_id === undefined || (row.org_id === 1 && row.location_id === 1)), "a row from another pharmacy");
  ok(!JSON.stringify(x).includes("second pharmacy") && !JSON.stringify(x).includes("other group"), "another pharmacy's text in the export");
  // the same-name-only order and the other card's DDA line are not in it; the stranger neither
  const orders = x.sections.find((s) => s.table === "client_orders_entries").rows.map((o) => o.id);
  eq(orders, [w.ids.client_orders_entries[0]], "orders");
  ok(!x.sections.find((s) => s.table === "dda_sales_entries").rows.some((o) => o.id === w.other), "someone else's DDA line");
  // label: same name only (labels hold no card) → only when ticked
  ok(!tables.includes("label_history"), "label without a tick");
  const pre = (await app.api("POST", "/people/" + w.pA.id + "/privacy", { token: w.A.token, body: {} })).json;
  const maybeKeys = pre.sections.flatMap((s) => s.maybe.map((m) => m.key));
  ok(maybeKeys.includes("client_orders_entries:" + w.maybe), "maybe listed: " + maybeKeys.join(","));
  const r2 = await app.api("POST", "/people/" + w.pA.id + "/export", { token: w.A.token, body: { rows: maybeKeys } });
  ok(r2.json.sections.find((s) => s.table === "client_orders_entries").rows.some((o) => o.id === w.maybe), "ticked row exported");
  ok(r2.json.sections.some((s) => s.table === "label_history"), "ticked label exported");
  const g = await app.api("GET", "/people/" + w.pA.id + "/export?rows=" + encodeURIComponent(maybeKeys.join(",")), { token: w.A.token });
  eq(g.status, 200); eq(g.json.rows, r2.json.rows, "GET with ?rows= gives the same file");
  // the screening entry is the person's only, not the whole campaign
  const sc = x.sections.find((s) => s.table === "screening_campaigns").rows;
  eq(sc.length, 1); eq(sc[0].entry.name, NAME);
  // audited, counts only
  const a = app.DB.db.prepare("SELECT * FROM audit_log WHERE action = 'PERSON_EXPORT'").all();
  eq(a.length, 3); eq(a[0].location_id, 1);
  ok(!PERSONAL.some((p) => a[0].details_json.includes(p)), "personal data in the audit row: " + a[0].details_json);
  // another pharmacy's admin cannot reach this person
  eq((await app.api("POST", "/people/" + w.pA.id + "/export", { token: w.B.token, body: {} })).status, 404);
  eq((await app.api("POST", "/people/" + w.pA.id + "/export", { token: w.C.token, body: {} })).status, 404);
});

test("privacy: erase changes exactly the planned rows and columns; legal registers, other pharmacies and other people untouched", async (app) => {
  const w = await world(app);
  const pre = await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} });
  eq(pre.status, 200, pre.text.slice(0, 200));
  ok(pre.json.preview && pre.json.plan, "preview");
  const sec = (t) => pre.json.sections.find((s) => s.table === t);
  eq(sec("dda_sales_entries").action, "keep"); eq(sec("dda_sales_entries").change, 0); eq(sec("dda_sales_entries").other, 1);
  eq(sec("client_deliveries").change, 0, "deliveries are kept (medicines dispensed)"); eq(sec("client_deliveries").keep, 2);
  eq(sec("credit_notes").action, "keep"); eq(sec("pos_sales").action, "keep"); ok(sec("client_deliveries").legal && sec("credit_notes").legal, "kept as the law may need them");
  eq(pre.json.overridden, [], "nothing set by the pharmacy's settings");
  eq(sec("client_orders_entries").columns.sort(), ["client_address", "client_email", "client_name", "client_phone", "notes"]);
  const before = snapshot(app);
  const r = await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { confirm: true, plan: pre.json.plan, reason: "Asked in person" } });
  eq(r.status, 200, r.text.slice(0, 300));
  const after = snapshot(app);
  const d = diff(before, after);
  delete d[Object.keys(d).find((k) => k.startsWith("audit_log:") && d[k] === "added")];
  const want = {
    ["people:" + w.pA.id]: ["address", "email", "id_card", "name", "notes", "phone", "source", "updated_at", "updated_by", "version"],
    ["cust_profile:1"]: ["allergies", "prefers"],
    ["client_orders_entries:" + w.ids.client_orders_entries[0]]: ["client_address", "client_email", "client_name", "client_phone", "notes"],
    ["client_tickets_entries:" + w.ids.client_tickets_entries[0]]: ["client_name", "email", "notes_log", "phone"],
    ["contacts_clients:" + w.ids.contacts_clients[0]]: ["address", "id_card", "name", "phone"],
    ["vaccines_orders:" + w.ids.vaccines_orders[0]]: ["client_first", "client_last", "email", "phone"],
    // John (2026-11-11): bookings, loyalty and messages are anonymised
    ["cust_messages:1"]: ["body", "person_name", "subject", "to_addr"],
    ["bk_bookings:" + w.ids.bk_bookings[0]]: ["notes", "person_email", "person_name", "person_phone"],
    ["bk_waitlist:" + w.ids.bk_waitlist[0]]: ["person_name", "person_phone"],
    ["appt_appointments:" + w.ids.appt_appointments[0]]: ["notes", "patient_id_card", "patient_name", "patient_phone"],
    ["appt_waitlist:" + w.ids.appt_waitlist[0]]: ["patient_id_card", "patient_name", "patient_phone"],
    ["loyalty_clients:" + w.ids.loyalty_clients[0]]: ["id_card", "name"],
    ["loyalty_transactions:" + w.ids.loyalty_transactions[0]]: ["client_id_card", "client_name"]
  };
  // the update stamp may land in the same second as the insert
  // the stamps may not move: same second as the insert, same user as the creator
  const stamp = (c) => c !== "updated_at" && c !== "updated_by";
  const got = Object.assign({}, d); const pk = "people:" + w.pA.id; if (Array.isArray(got[pk])) got[pk] = got[pk].filter(stamp);
  want[pk] = want[pk].filter(stamp);
  const byKey = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  eq(byKey(got), byKey(want), "rows changed");
  const p = after["people:" + w.pA.id];
  eq([p.name, p.id_card, p.phone, p.email, p.notes, p.source], ["Erased person #" + w.pA.id, "", "", "", "", "erased"]);
  eq(after["client_orders_entries:" + w.ids.client_orders_entries[0]].items_text, "Vitamin D", "what was ordered stays");
  for (const t of ["credit_notes", "pos_sales", "client_deliveries", "label_history", "dda_sales_entries"]) for (const id of w.ids[t] || []) eq(after[t + ":" + id], before[t + ":" + id], t + " kept byte for byte");
  // the log holds exactly the changed values
  const n = Object.entries(want).reduce((a, [k, cols]) => a + cols.filter((c) => !["version", "updated_by", "updated_at"].includes(c)).length, 0);
  eq(r.json.logged_values, n); eq(r.json.logged_rows, Object.keys(want).length); eq(r.json.changed, Object.keys(want).length);
  const a = app.DB.db.prepare("SELECT * FROM audit_log WHERE action = 'PERSON_ERASE'").get();
  ok(a && !PERSONAL.some((x) => a.details_json.includes(x)), "audit row without personal data: " + (a && a.details_json));
  // a second erase is refused
  eq((await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} })).json.code, "already_erased");
});

test("privacy: erase with every retention switched to erase anonymises the registers too (GDPR_POLICY variable)", async () => {
  const app = await makeApp({ env: { GDPR_POLICY: JSON.stringify({ cd: "erase", rx: "erase", pv: "erase", vaccinations: "erase", poct: "erase", calculator: "erase", bookings: "erase", loyalty: "erase", messages: "erase", money: "erase", labels: "erase", bogus: "erase", trail: "erase", optout: "erase", erase: "keep" }) } });
  const w = await world(app);
  const pre = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} })).json;
  eq(pre.overridden.map((o) => o.key).sort(), ["calculator", "cd", "labels", "money", "poct", "pv", "rx", "vaccinations"], "the keys the variable changed are listed; unknown keys and optout/trail/erase are not taken");
  const before = snapshot(app);
  const r = await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { confirm: true, plan: pre.plan } });
  eq(r.status, 200, r.text.slice(0, 300));
  const after = snapshot(app);
  const d = diff(before, after);
  const changed = new Set(Object.keys(d).map((k) => k.split(":")[0]));
  for (const t of ["dda_sales_entries", "dda_poyc_entries", "daily_register_entries", "repeat_prescription_entries", "bk_bookings", "appt_appointments", "vaccinations", "poct_records", "credit_notes", "pos_sales", "client_deliveries",
    "loyalty_clients", "loyalty_transactions", "cust_messages", "screening_campaigns", "pv_reports", "poct_patients", "pharmacy_calc_patients", "bk_waitlist", "appt_waitlist"]) ok(changed.has(t), "not anonymised: " + t);
  const pp = after["poct_patients:1"]; eq(JSON.parse(pp.patient_json), { patientId: pp.patient_id, name: "Erased person #" + w.pA.id, phone: "", age: 52 }, "patient list JSON follows the columns");
  ok(!changed.has("cust_msg_optout"), "opt-outs are always kept");
  // nothing personal left in this pharmacy's rows, except the stopped e-mail and someone else's line
  for (const [k, row] of Object.entries(after)) {
    if (k.startsWith("audit_log") || k.startsWith("cust_msg_optout") || k === "dda_sales_entries:" + w.other || k === "client_orders_entries:" + w.maybe || k.startsWith("label_history")) continue;
    if (row.org_id !== 1 || row.location_id !== 1) continue;
    const s = JSON.stringify(row);
    for (const p of [CARD, PHONE, EMAIL, "Laura"]) ok(!s.includes(p), k + " still holds " + p + ": " + s);
  }
  // screening: the other participant is untouched
  const sc = JSON.parse(after["screening_campaigns:1"].campaign_json);
  eq(sc.participants[1], { id: "p2", name: "Mark Vella", idCard: "0099999M", phone: "79000000" });
  eq(sc.participants[0].sys, 120, "results stay");
  // the loyalty card keeps a unique tombstone
  ok(/^ERASED-\d+-\d+$/.test(after["loyalty_clients:1"].id_card), after["loyalty_clients:1"].id_card);
  // other pharmacies untouched
  for (const k of Object.keys(d)) { const row = before[k] || after[k]; ok(row.org_id === undefined || (row.org_id === 1 && row.location_id === 1) || k.startsWith("audit_log"), "changed elsewhere: " + k); }
});

test("privacy: a ticked same-name row is erased, an unticked one is not; a stale plan is refused and changes nothing", async (app) => {
  const w = await world(app);
  const pre = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} })).json;
  const key = "client_orders_entries:" + w.maybe;
  const pre2 = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { rows: [key] } })).json;
  ok(pre2.plan !== pre.plan, "ticking changes the plan");
  const before = snapshot(app);
  const stale = await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { rows: [key], confirm: true, plan: pre.plan } });
  eq(stale.status, 409); eq(stale.json.code, "plan_changed");
  eq(diff(before, snapshot(app)), {}, "nothing changed");
  const r = await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { rows: [key], confirm: true, plan: pre2.plan } });
  eq(r.status, 200);
  const o = app.DB.db.prepare("SELECT client_name FROM client_orders_entries WHERE id = ?").get(w.maybe);
  eq(o.client_name, "Erased person #" + w.pA.id);
  eq(app.DB.db.prepare("SELECT client_name FROM client_orders_entries WHERE id = ?").get(w.stranger).client_name, "Mark Vella");
});

test("privacy: undo within 24 hours puts every row back byte for byte and deletes the copies; a row changed since is left alone", async (app) => {
  const w = await world(app);
  const before = snapshot(app);
  const pre = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} })).json;
  const r = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { confirm: true, plan: pre.plan } })).json;
  // someone edits one anonymised order meanwhile
  app.DB.db.prepare("UPDATE client_tickets_entries SET client_name = 'Walk-in' WHERE id = ?").run(w.ids.client_tickets_entries[0]);
  const list = (await app.api("GET", "/people/" + w.pA.id + "/erasures", { token: w.A.token })).json.erasures;
  eq(list.length, 1); eq(list[0].can_undo, true);
  const u = await app.api("POST", "/people/erasures/" + r.erasure_id + "/undo", { token: w.A.token, body: {} });
  eq(u.status, 200, u.text.slice(0, 200));
  eq(u.json.skipped.map((s) => s.table + ":" + s.reason), ["client_tickets_entries:changed since"]);
  const after = snapshot(app);
  const d = diff(before, after);
  for (const k of Object.keys(d)) if (k.startsWith("audit_log")) delete d[k];
  const pk = "people:" + w.pA.id;
  eq(d[pk].filter((c) => c !== "updated_at"), ["updated_by", "version"].filter((c) => d[pk].includes(c)), "person back");
  delete d[pk];
  eq(d, { ["client_tickets_entries:" + w.ids.client_tickets_entries[0]]: ["client_name", "email", "notes_log", "phone"] }, "everything else byte-identical");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasure_rows").get().c, 0, "copies deleted");
  eq(app.DB.db.prepare("SELECT status FROM gdpr_erasures").get().status, "undone");
  eq((await app.api("POST", "/people/erasures/" + r.erasure_id + "/undo", { token: w.A.token, body: {} })).status, 409);
  ok(app.DB.db.prepare("SELECT 1 FROM audit_log WHERE action = 'PERSON_ERASE_UNDO'").get(), "undo audited");
});

test("privacy: after 24 hours the copies are wiped (scheduled run and any privacy call) and undo says it is too late", async (app) => {
  const w = await world(app);
  const pre = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} })).json;
  const r = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { confirm: true, plan: pre.plan } })).json;
  ok(app.DB.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasure_rows").get().c > 0, "copies kept for the undo");
  const until = app.DB.db.prepare("SELECT undo_until, created_at FROM gdpr_erasures").get();
  eq(Date.parse(until.undo_until + "Z") - Date.parse(until.created_at + "Z"), 24 * 3600e3, "24 hours");
  app.DB.db.prepare("UPDATE gdpr_erasures SET undo_until = datetime('now', '-1 minute')").run();
  const waits = [];
  await app.worker.scheduled({}, app.env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasure_rows").get().c, 0, "copies wiped");
  const h = app.DB.db.prepare("SELECT status, purged_at FROM gdpr_erasures").get();
  eq(h.status, "final"); ok(h.purged_at);
  const u = await app.api("POST", "/people/erasures/" + r.erasure_id + "/undo", { token: w.A.token, body: {} });
  eq(u.status, 409); eq(u.json.code, "too_late");
  // another pharmacy's admin cannot see or undo it
  eq((await app.api("POST", "/people/erasures/" + r.erasure_id + "/undo", { token: w.B.token, body: {} })).status, 404);
  eq((await app.api("GET", "/people/" + w.pA.id + "/erasures", { token: w.B.token })).json.erasures.length, 0);
});

test("privacy: scheduled purge is one indexed read when nothing is due, and harmless before the first erase", async (app) => {
  await app.bootstrap();
  const waits = [];
  await app.worker.scheduled({}, app.env, { waitUntil: (p) => waits.push(p) });
  await Promise.allSettled(waits); // no gdpr table yet: nothing happens, nothing throws
  ok(!app.DB.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'gdpr_erasures'").get(), "no table made by the timer");
  await ensureAll(app);
  const plan = app.DB.db.prepare("EXPLAIN QUERY PLAN SELECT erasure_id FROM gdpr_erasures WHERE purged_at IS NULL AND undo_until < datetime('now') LIMIT 20").all().map((r) => r.detail).join(" | ");
  ok(/idx_gdpr_erasures_due/.test(plan), plan);
});

test("privacy: Settings download parts are this pharmacy's rows only, paged, dated parts need days", async (app) => {
  const w = await world(app);
  const get = (p, t = w.A.token) => app.api("GET", "/export/records?" + p, { token: t });
  const c = await get("part=customers");
  eq(c.status, 200); eq(c.json.rows.map((r) => r.id), [w.pA.id]);
  eq(c.json.rows[0].allergies, "penicillin"); eq(c.json.next, null);
  eq((await get("part=customers", w.B.token)).json.rows.map((r) => r.id), [w.pB.id]);
  eq((await get("part=bookings")).status, 400);
  const b = await get("part=bookings&from=2026-10-01&to=2026-10-31");
  eq(b.json.rows.length, 1); eq(b.json.rows[0].person_name, NAME);
  eq((await get("part=bookings&from=2026-11-01&to=2026-11-30")).json.rows.length, 0);
  for (const p of ["messages", "tills", "loyalty", "appointments", "shifts", "leave"]) eq((await get("part=" + p + "&from=2026-01-01&to=2026-12-31")).status, 200, p);
  eq((await get("part=tills&from=2026-01-01&to=2026-12-31")).json.rows.length, 1);
  eq((await get("part=messages&from=" + new Date().toISOString().slice(0, 10) + "&to=" + new Date().toISOString().slice(0, 10))).json.rows.length, 1);
  const acc = (await get("part=accounts")).json.rows;
  ok(acc.every((u) => !("pass_hash_b64" in u)), "no password hashes");
  eq(acc.map((u) => u.email).sort(), ["admin@example.com", "staff@example.com"]);
  eq((await get("part=staff")).status, 200);
  eq((await get("part=nope")).status, 400);
  // paging
  for (let i = 0; i < 1005; i++) ins(app, "people", { org_id: 1, location_id: 1, name: "Person " + i });
  const p1 = (await get("part=customers")).json;
  eq(p1.rows.length, 1000); ok(p1.next);
  const p2 = (await get("part=customers&after=" + p1.next)).json;
  eq(p2.rows.length, 6); eq(p2.next, null);
});

test("privacy: what the panel reads uses indexes for the person's own rows", async (app) => {
  const w = await world(app);
  const plan = (sql, args) => app.DB.db.prepare("EXPLAIN QUERY PLAN " + sql).all(...args).map((r) => r.detail).join(" | ");
  ok(/idx_cust_msg_person/.test(plan("SELECT rowid FROM cust_messages WHERE org_id = ? AND location_id = ? AND (person_id IN (?))", [1, 1, w.pA.id])), "messages by person");
  ok(/idx_bk_bookings_day/.test(plan("SELECT id FROM bk_bookings WHERE org_id = ? AND location_id = ? AND date >= ? AND date <= ? AND id > ? ORDER BY id LIMIT 1001", [1, 1, "2026-10-01", "2026-10-31", 0])), "bookings by day");
  ok(/idx_pos_sales_org_loc_date/.test(plan("SELECT id FROM pos_sales WHERE org_id = ? AND location_id = ? AND sale_date >= ? AND sale_date <= ? AND id > ? ORDER BY id LIMIT 1001", [1, 1, "2026-10-01", "2026-10-31", 0])), "tills by day");
});

// ── John's retention answers (2026-11-11), one test per rule ─────────────────────────────────────────────────────────
// Legal records (CD/POYC, prescriptions, deliveries, PV, vaccinations, tests, labels) KEEP the name; bookings, loyalty
// and messages are ANONYMISED; undo 24 hours; do-not-email lists KEEP; credit notes and till receipts KEEP.
const JOHN = { cd: "keep", rx: "keep", pv: "keep", vaccinations: "keep", poct: "keep", calculator: "keep", bookings: "erase", loyalty: "erase", messages: "erase", money: "keep", labels: "keep", erase: "erase" };
// The person's rows of this pharmacy, everything ticked (same-name rows too, so the labels are in scope), erased.
async function eraseAll(app, w) {
  ins(app, "bk_optout", { email: EMAIL, org_id: 1, location_id: 1 });
  const pre0 = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} })).json;
  const rows = pre0.sections.flatMap((s) => s.maybe.map((m) => m.key));
  const pre = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { rows } })).json;
  const all = (t) => app.DB.db.prepare("SELECT rowid AS __rid, * FROM " + t + " WHERE org_id = 1 AND location_id = 1 ORDER BY rowid").all();
  const tables = ["dda_sales_entries", "dda_poyc_entries", "daily_register_entries", "repeat_prescription_entries", "client_deliveries", "pv_reports", "vaccinations", "poct_records", "poct_patients",
    "screening_campaigns", "label_history", "bk_bookings", "bk_waitlist", "appt_appointments", "appt_waitlist", "loyalty_clients", "loyalty_transactions", "cust_messages", "cust_msg_optout", "bk_optout",
    "credit_notes", "pos_sales", "pharmacy_calc_patients"];
  const before = Object.fromEntries(tables.map((t) => [t, all(t)]));
  const r = await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: { rows, confirm: true, plan: pre.plan, reason: "retention test" } });
  eq(r.status, 200, r.text.slice(0, 300));
  const after = Object.fromEntries(tables.map((t) => [t, all(t)]));
  const sec = (t) => pre.sections.find((s) => s.table === t) || { table: t, missing: true };
  return { pre, r: r.json, before, after, sec, tomb: "Erased person #" + w.pA.id };
}
function keptByteForByte(x, tables, why) {
  for (const t of tables) {
    ok(x.before[t].length > 0, t + ": the test seeds rows");
    eq(x.after[t], x.before[t], t + " kept byte for byte (" + why + ")");
    eq(x.sec(t).action, "keep", t + " listed as kept"); eq(x.sec(t).change, 0, t + " nothing planned");
  }
}

test("retention: the policy in force is exactly John's table (2026-11-11), and the preview says so", async (app) => {
  const w = await world(app);
  const pre = (await app.api("POST", "/people/" + w.pA.id + "/erase", { token: w.A.token, body: {} })).json;
  eq(Object.fromEntries(Object.keys(pre.policy).sort().map((k) => [k, pre.policy[k]])), Object.fromEntries(Object.keys(JOHN).sort().map((k) => [k, JOHN[k]])), "policy");
  eq(pre.overridden, [], "nothing set by the pharmacy's settings");
  eq(pre.undo_hours, 24);
});

for (const [rule, tables, why] of [
  ["controlled drugs (DDA, POYC) keep the name", ["dda_sales_entries", "dda_poyc_entries"], "controlled-drug register"],
  ["prescriptions (daily register, repeat prescriptions) keep the name", ["daily_register_entries", "repeat_prescription_entries"], "prescription register"],
  ["deliveries (with and without controlled drugs) keep the name", ["client_deliveries"], "medicines dispensed"],
  ["pharmacovigilance reports keep the person's details", ["pv_reports"], "report to the medicines authority"],
  ["vaccinations given keep the name", ["vaccinations"], "vaccination record"],
  ["tests (POCT results, patient list, screening) keep the name", ["poct_records", "poct_patients", "screening_campaigns"], "test results"],
  ["medicine labels keep the name, even when ticked", ["label_history"], "dispensing label"]
]) {
  test("retention (legal): " + rule, async (app) => {
    const w = await world(app);
    const x = await eraseAll(app, w);
    keptByteForByte(x, tables, why);
    for (const t of tables) ok(x.sec(t).legal, t + " is under 'the law may need them'");
    if (tables.includes("client_deliveries")) eq(x.after.client_deliveries.map((d) => d.client_name), [NAME, NAME], "both deliveries keep the name");
    if (tables.includes("dda_sales_entries")) ok(x.after.dda_sales_entries.some((d) => d.client_name === NAME && d.client_id_card === CARD), "DDA line keeps name and ID card");
  });
}

test("retention: bookings, doctor appointments and both waiting lists are anonymised (what and when stay)", async (app) => {
  const w = await world(app);
  const x = await eraseAll(app, w);
  for (const t of ["bk_bookings", "bk_waitlist", "appt_appointments", "appt_waitlist"]) { eq(x.sec(t).action, "erase", t); ok(x.sec(t).change > 0, t + " planned"); }
  const b = x.after.bk_bookings[0], b0 = x.before.bk_bookings[0];
  eq([b.person_name, b.person_phone, b.person_email, b.notes], [x.tomb, "", "", ""]); eq([b.date, b.start_time, b.service_id], [b0.date, b0.start_time, b0.service_id]);
  const a = x.after.appt_appointments[0];
  eq([a.patient_name, a.patient_id_card, a.patient_phone, a.notes, a.date, a.time], [x.tomb, "", "", "", "2026-10-08", "10:00"]);
  eq([x.after.bk_waitlist[0].person_name, x.after.bk_waitlist[0].person_phone], [x.tomb, ""]);
  eq([x.after.appt_waitlist[0].patient_name, x.after.appt_waitlist[0].patient_id_card, x.after.appt_waitlist[0].patient_phone], [x.tomb, "", ""]);
});

test("retention: loyalty card and visits are anonymised (amounts and points stay)", async (app) => {
  const w = await world(app);
  const x = await eraseAll(app, w);
  for (const t of ["loyalty_clients", "loyalty_transactions"]) eq(x.sec(t).action, "erase", t);
  const c = x.after.loyalty_clients[0];
  eq(c.name, x.tomb); ok(/^ERASED-\d+-\d+$/.test(c.id_card), c.id_card);
  const v = x.after.loyalty_transactions[0], v0 = x.before.loyalty_transactions[0];
  eq([v.client_name, v.client_id_card], [x.tomb, ""]); eq([v.total, v.points_awarded, v.txn_date], [v0.total, v0.points_awarded, v0.txn_date]);
});

test("retention: messages sent to the person are anonymised (address, subject and text gone; channel and status stay)", async (app) => {
  const w = await world(app);
  const x = await eraseAll(app, w);
  eq(x.sec("cust_messages").action, "erase");
  const m = x.after.cust_messages[0], m0 = x.before.cust_messages[0];
  eq([m.person_name, m.to_addr, m.subject, m.body], [x.tomb, "", "", "(erased)"]); eq([m.channel, m.status, m.person_id], [m0.channel, m0.status, m0.person_id]);
});

test("retention: undo for 24 hours puts the anonymised bookings, loyalty and messages back byte for byte", async (app) => {
  const w = await world(app);
  const x = await eraseAll(app, w);
  const h = app.DB.db.prepare("SELECT undo_until, created_at FROM gdpr_erasures WHERE erasure_id = ?").get(x.r.erasure_id);
  eq(Date.parse(h.undo_until + "Z") - Date.parse(h.created_at + "Z"), 24 * 3600e3, "24 hours");
  const u = await app.api("POST", "/people/erasures/" + x.r.erasure_id + "/undo", { token: w.A.token, body: {} });
  eq(u.status, 200, u.text.slice(0, 200)); eq(u.json.skipped, []);
  for (const t of ["bk_bookings", "bk_waitlist", "appt_appointments", "appt_waitlist", "loyalty_clients", "loyalty_transactions", "cust_messages"])
    eq(app.DB.db.prepare("SELECT rowid AS __rid, * FROM " + t + " WHERE org_id = 1 AND location_id = 1 ORDER BY rowid").all(), x.before[t], t + " back");
});

test("retention: do-not-email lists (customer e-mails and booking e-mails) are kept, also if the settings variable says erase", async () => {
  const app = await makeApp({ env: { GDPR_POLICY: JSON.stringify({ optout: "erase" }) } });
  const w = await world(app);
  const x = await eraseAll(app, w);
  for (const t of ["cust_msg_optout", "bk_optout"]) { eq(x.after[t], x.before[t], t + " kept"); eq(x.after[t].map((r) => r.email), [EMAIL], t); eq(x.sec(t).action, "keep", t); }
});

test("retention: credit notes and emergency till receipts are kept with the name", async (app) => {
  const w = await world(app);
  const x = await eraseAll(app, w);
  keptByteForByte(x, ["credit_notes", "pos_sales"], "money record");
  eq([x.after.credit_notes[0].client_name, x.after.pos_sales[0].client_name], ["Laura", NAME]);
});
