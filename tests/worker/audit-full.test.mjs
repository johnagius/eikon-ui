// Backlog item 1: no register or money line disappears or changes without a full record of what it was.
import { test, eq, ok } from "./lib.mjs";

const DDA = { entry_date: "2026-10-05", client_name: "Carmen Grech", client_id_card: "123456M", client_address: "12 Triq il-Kbira, Mosta", medicine_name_dose: "Morphine 10mg", quantity: 10, doctor_name: "Dr Abela", doctor_reg_no: "1234", prescription_serial_no: "S-1", urgent: 0 };

function auditRows(DB, action) {
  return DB.db.prepare("SELECT * FROM audit_log WHERE action = ? ORDER BY id").all(action).map((r) => ({ ...r, details: JSON.parse(r.details_json || "{}") }));
}
function rowOf(DB, table, id) { return DB.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id); }
function sameRow(got, want, msg) {
  ok(got && typeof got === "object", msg + ": no row in the audit");
  for (const k of Object.keys(want)) eq(got[k], want[k], msg + ": column " + k);
}

test("audit-full: deleting a DDA sale keeps every column of the line, readable on the Audit trail", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const c = await api("POST", "/dda-sales/entries", { token, body: DDA });
  eq(c.status, 200, c.text);
  const id = c.json.entry_id;
  const row = rowOf(DB, "dda_sales_entries", id);
  ok(row && row.medicine_name_dose === "Morphine 10mg");
  eq((await api("DELETE", "/dda-sales/entries/" + id, { token })).status, 200);
  eq(rowOf(DB, "dda_sales_entries", id), undefined, "line still there");
  const log = await api("GET", "/audit/log?module=ddasales&action=DDA_SALES_ENTRY_DELETE", { token });
  eq(log.status, 200, log.text);
  const e = (log.json.entries || [])[0];
  ok(e, "no audit entry");
  sameRow(e.details.before, row, "DDA delete");
  eq(e.details.prescription_serial_no, "S-1", "old detail key kept");
});

test("audit-full: cleaning and credit-note deletes keep the whole row (and a credit note's uses and notes)", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await api("POST", "/cleaning/entries", { token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Maria", notes: "floors" } });
  const cl = DB.db.prepare("SELECT * FROM cleaning_entries").get();
  eq((await api("DELETE", "/cleaning/entries/" + cl.id, { token })).status, 200);
  sameRow(auditRows(DB, "CLEANING_ENTRY_DELETE")[0].details.before, cl, "cleaning delete");

  const cn = await api("POST", "/creditnotes/entries", { token, body: { issue_date: "2026-10-01", client_name: "Joe", client_surname: "Borg", telephone: "79000000", amount: 25.5, no_expiry: 1 } });
  eq(cn.status, 200, cn.text);
  const cid = cn.json.id;
  eq((await api("POST", `/creditnotes/entries/${cid}/purchases`, { token, body: { amount: 5, receipt_number: "R9" } })).status, 200);
  eq((await api("POST", `/creditnotes/entries/${cid}/notes`, { token, body: { text: "called client" } })).status, 200);
  const cnRow = rowOf(DB, "credit_notes", cid);
  eq((await api("DELETE", "/creditnotes/entries/" + cid, { token })).status, 200);
  const b = auditRows(DB, "CREDITNOTE_DELETE")[0].details.before;
  sameRow(b, cnRow, "credit note delete");
  eq(b.purchases.length, 1); eq(b.purchases[0].amount, 5); eq(b.purchases[0].receipt_number, "R9");
  eq(b.notes.length, 1); eq(b.notes[0].text, "called client");
});

test("audit-full: an update records the row before and after", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const id = (await api("POST", "/dda-sales/entries", { token, body: DDA })).json.entry_id;
  const before = rowOf(DB, "dda_sales_entries", id);
  const u = await api("PUT", "/dda-sales/entries/" + id, { token, body: { ...DDA, quantity: 4, medicine_name_dose: "Morphine 5mg" } });
  eq(u.status, 200, u.text);
  const after = rowOf(DB, "dda_sales_entries", id);
  const a = auditRows(DB, "DDA_SALES_ENTRY_UPDATE");
  eq(a.length, 1);
  sameRow(a[0].details.before, before, "before");
  sameRow(a[0].details.after, after, "after");
  eq(a[0].details.before.quantity, 10); eq(a[0].details.after.quantity, 4);
  eq(a[0].details.quantity, 4, "old detail key kept");

  await api("POST", "/cleaning/entries", { token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Maria", notes: "" } });
  const cl = DB.db.prepare("SELECT * FROM cleaning_entries").get();
  await api("PUT", "/cleaning/entries/" + cl.id, { token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "09:00", cleaner_name: "Karl", staff_name: "Maria", notes: "late" } });
  const ca = auditRows(DB, "CLEANING_ENTRY_UPDATE")[0].details;
  eq(ca.before.time_out, "08:30"); eq(ca.after.time_out, "09:00"); eq(ca.after.notes, "late");
});

test("audit-full: each previously unaudited handler leaves exactly one audit row", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const cid = (await api("POST", "/creditnotes/entries", { token, body: { issue_date: "2026-10-01", client_name: "Joe", client_surname: "Borg", telephone: "79000000", amount: 25 } })).json.id;
  const pid = (await api("POST", `/creditnotes/entries/${cid}/purchases`, { token, body: { amount: 5 } })).json.id;
  const nid = (await api("POST", `/creditnotes/entries/${cid}/notes`, { token, body: { text: "n1" } })).json.id;
  eq((await api("DELETE", `/creditnotes/entries/${cid}/purchases/${pid}`, { token })).status, 200);
  eq((await api("DELETE", `/creditnotes/entries/${cid}/notes/${nid}`, { token })).status, 200);
  eq((await api("PUT", "/instructions/daily", { token, body: { ymd: "2026-10-30", notes: "Call Dr Abela", handover_out: [] } })).status, 200);
  eq((await api("PUT", "/instructions/global", { token, body: { global: { pinned: "Fridge 2 is broken" } } })).status, 200);
  const calc = await api("POST", "/pharmacy-calc/records", { token, body: { patient_name: "Rita", id_card: "555M", start_date: "2026-10-01", calc_type: "warfarin", calc_data_json: { dose: 3 } } });
  eq(calc.status, 201, calc.text);
  eq((await api("DELETE", "/pharmacy-calc/records/" + calc.json.id, { token })).status, 200);
  eq((await api("POST", "/loyalty/clients", { token, body: { id_card: "0123456M", name: "C. Grech" } })).status, 200);
  eq((await api("PUT", "/shifts/settings", { token, body: { weekStart: 1 } })).status, 200);

  const purchaseBefore = auditRows(DB, "CREDITNOTE_PURCHASE_DELETE");
  for (const [action, n] of [["CREDITNOTE_PURCHASE_ADD", 1], ["CREDITNOTE_PURCHASE_DELETE", 1], ["CREDITNOTE_NOTE_ADD", 1], ["CREDITNOTE_NOTE_DELETE", 1],
    ["INSTRUCTIONS_DAILY_CREATE", 1], ["INSTRUCTIONS_GLOBAL_PUT", 1], ["PHARMACY_CALC_RECORD_CREATE", 1], ["PHARMACY_CALC_RECORD_DELETE", 1],
    ["LOYALTY_CLIENT_CREATE", 1], ["SHIFT_SETTINGS_PUT", 1]]) {
    eq(auditRows(DB, action).length, n, action);
  }
  eq(purchaseBefore[0].details.before.amount, 5, "deleted credit-note use kept");
  eq(auditRows(DB, "PHARMACY_CALC_RECORD_DELETE")[0].details.before.patient_name, "Rita");
  // Clearing a day's handover deletes the row: that is audited too, with what it said.
  eq((await api("PUT", "/instructions/daily", { token, body: { ymd: "2026-10-30", notes: "", handover_out: [] } })).status, 200);
  const del = auditRows(DB, "INSTRUCTIONS_DAILY_DELETE");
  eq(del.length, 1); eq(del[0].details.before.notes, "Call Dr Abela");
});

test("audit-full: superuser wipe, password reset and user delete are audited under the target org, never the password", async (app) => {
  const { api, bootstrap, addUser, DB, env } = app;
  const { token } = await bootstrap();
  env.SUPERUSER_EMAILS = "admin@example.com";
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (7, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (70, 7, 'Other Pharmacy')").run();
  const other = await addUser({ orgId: 7, locationId: 70, email: "other@demo.mt" });
  await api("POST", "/cleaning/entries", { token: other.token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Ann", notes: "" } });
  const before = DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c;

  eq((await api("POST", "/su/api/locations/70/wipe", { token, body: {} })).status, 200);
  eq((await api("POST", `/su/api/users/${other.user.id}/password`, { token, body: { password: "S3cret-New-Pass" } })).status, 200);
  eq((await api("DELETE", `/su/api/users/${other.user.id}`, { token })).status, 200);

  const wipe = auditRows(DB, "SU_LOCATION_WIPE");
  eq(wipe.length, 1); eq(wipe[0].org_id, 7); eq(wipe[0].location_id, 70);
  eq(wipe[0].details.rows_deleted.cleaning_entries, 1);
  const pw = auditRows(DB, "SU_PASSWORD_RESET");
  eq(pw.length, 1); eq(pw[0].org_id, 7);
  ok(!/S3cret-New-Pass/.test(pw[0].details_json), "password in the audit");
  const del = auditRows(DB, "SU_USER_DELETE");
  eq(del.length, 1); eq(del[0].org_id, 7); eq(del[0].details.before.email, "other@demo.mt");
  ok(!("pass_hash_b64" in del[0].details.before), "password hash in the audit");
  // The wipe left the audit itself alone.
  ok(DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log").get().c >= before + 3);
  ok(DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE location_id = 70").get().c >= 2, "wipe erased audit rows");
});

test("audit-full: another pharmacy, in another group or the same one, cannot read the audit rows", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const id = (await api("POST", "/dda-sales/entries", { token, body: DDA })).json.entry_id;
  eq((await api("DELETE", "/dda-sales/entries/" + id, { token })).status, 200);
  const mine = await api("GET", "/audit/log?module=ddasales", { token });
  ok((mine.json.entries || []).some((e) => e.action === "DDA_SALES_ENTRY_DELETE"), "own pharmacy cannot see it");

  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (9, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (90, 9, 'Other Pharmacy')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Sister Pharmacy')").run();
  const otherOrg = await addUser({ orgId: 9, locationId: 90, email: "other@demo.mt" });
  const sister = await addUser({ orgId: 1, locationId: 2, email: "sister@demo.mt" });
  for (const [who, t] of [["other group", otherOrg.token], ["same group, other pharmacy", sister.token]]) {
    const r = await api("GET", "/audit/log?module=ddasales", { token: t });
    eq(r.status, 200, r.text);
    eq((r.json.entries || []).filter((e) => e.action === "DDA_SALES_ENTRY_DELETE").length, 0, who + " sees the deleted line");
    const all = await api("GET", "/audit/log?limit=1000", { token: t });
    ok(!(all.json.entries || []).some((e) => /Carmen Grech/.test(JSON.stringify(e.details))), who + " sees the patient");
  }
});

test("audit-full: the action still succeeds when the audit cannot be written", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const id = (await api("POST", "/dda-sales/entries", { token, body: DDA })).json.entry_id;
  const orig = DB.prepare.bind(DB);
  DB.prepare = function (sql) {
    if (/INSERT INTO audit_log/i.test(String(sql))) throw new Error("D1_ERROR: audit_log is read-only");
    return orig(sql);
  };
  const d = await api("DELETE", "/dda-sales/entries/" + id, { token });
  eq(d.status, 200, d.text);
  eq(rowOf(DB, "dda_sales_entries", id), undefined);
  const c = await api("POST", "/cleaning/entries", { token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "", cleaner_name: "Karl", staff_name: "Maria", notes: "" } });
  eq(c.status, 200, c.text);
});

test("audit-full: details stay under 10 KB with a truncated marker; earlier audit rows are not changed by later writes", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const oldRows = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all();
  ok(oldRows.length > 0, "bootstrap wrote audit rows");
  const long = "x".repeat(60000);
  await api("POST", "/cleaning/entries", { token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Maria", notes: long } });
  const cl = DB.db.prepare("SELECT * FROM cleaning_entries").get();
  eq((await api("DELETE", "/cleaning/entries/" + cl.id, { token })).status, 200);
  const a = auditRows(DB, "CLEANING_ENTRY_DELETE")[0];
  ok(Buffer.byteLength(a.details_json) <= 10000, "details_json is " + Buffer.byteLength(a.details_json) + " bytes");
  eq(a.details.truncated, true);
  eq(a.details.before.cleaner_name, "Karl");
  ok(/truncated/.test(a.details.before.notes), "cut field marked");
  eq(a.location_id, 1, "new row names its pharmacy");
  // The column was added, and nothing in the older rows changed.
  const now = DB.db.prepare("SELECT * FROM audit_log WHERE id <= ? ORDER BY id").all(oldRows[oldRows.length - 1].id);
  eq(now.length, oldRows.length);
  const cols = ["id", "org_id", "user_id", "action", "entity_type", "entity_id", "details_json", "created_at"];
  const pick = (r) => cols.map((k) => r[k]);
  for (let i = 0; i < now.length; i++) eq(pick(now[i]), pick(oldRows[i]), "old audit row " + oldRows[i].id + " changed");
});
