// Register corrections: the reason sent with a corrected line (correction_reason) lands in that update's audit entry,
// next to before/after. Nothing else about the update changes: the register row stores exactly what it stored before
// (no new column, no reason on the row), and a body without the field writes the same audit entry as before.
import { test, eq, ok } from "./lib.mjs";

const D = "2026-10-05";
const CASES = [
  { name: "DDA sales", table: "dda_sales_entries", action: "DDA_SALES_ENTRY_UPDATE", path: "/dda-sales/entries",
    body: { entry_date: D, client_name: "Carmen Grech", client_id_card: "0123456M", client_address: "12 Triq il-Kbira, Mosta", medicine_name_dose: "Morphine 10mg", quantity: 10, doctor_name: "Dr Abela", doctor_reg_no: "1234", prescription_serial_no: "S-1", urgent: 0 }, change: { quantity: 5 } },
  { name: "DDA POYC", table: "dda_poyc_entries", action: "DDA_POYC_ENTRY_UPDATE", path: "/dda-poyc/entries",
    body: { entry_date: D, client_name: "Carmen Grech", client_id_card: "123456M", client_address: "12 Triq il-Kbira, Mosta", medicine_name_dose: "Morphine 10mg", quantity: 10, doctor_name: "Dr Abela", doctor_reg_no: "1234", prescription_serial_no: "P-1" }, change: { doctor_reg_no: "4321" } },
  { name: "DDA purchases", table: "dda_purchases_entries", action: "DDA_PURCHASES_ENTRY_UPDATE", path: "/dda-purchases/entries",
    body: { entry_date: D, dda_name_dose: "Morphine 10mg", quantity: 50, agent: "Agent Ltd", invoice_number: "INV-9" }, change: { quantity: 40 } },
  { name: "Daily register", table: "daily_register_entries", action: "DAILY_REGISTER_ENTRY_UPDATE", path: "/daily-register/entries",
    body: { entry_date: D, client_name: "Joe Borg", client_id: "222M", medicine_name_dose: "Amoxil 500mg", posology: "1 tds", prescriber_name: "Dr Galea", prescriber_reg_no: "77" }, change: { posology: "1 bd" } },
  { name: "Repeat prescriptions", table: "repeat_prescription_entries", action: "REPEAT_RX_ENTRY_UPDATE", path: "/repeat-prescriptions/entries",
    body: { entry_date: D, expires_date: "2027-04-05", client_name: "Joe Borg", client_id: "222M", medicine_name_dose: "Lipitor 20mg", posology: "1 nocte", prescriber_name: "Dr Galea", prescriber_reg_no: "77" }, change: { medicine_name_dose: "Lipitor 40mg" } },
  { name: "Paid out", table: "paid_out_entries", action: "PAID_OUT_ENTRY_UPDATE", path: "/paid-out/entries",
    body: { entry_date: D, entry_time: "10:15", payee_name: "Window cleaner", fee: "25.00", payment_method: "cash", invoice_no: "", cheque_no: "", reason: "windows" }, change: { fee: "20.00" } },
  { name: "Locum register", table: "locum_register_entries", action: "LOCUM_REGISTER_ENTRY_UPDATE", path: "/locumregister/entries",
    body: { entry_date: D, time_in: "08:00", time_out: "13:00", locum_full_name: "Dr Locum", registration_number: "R123" }, change: { time_out: "14:00" } },
  { name: "Cleaning", table: "cleaning_entries", action: "CLEANING_ENTRY_UPDATE", path: "/cleaning/entries",
    body: { entry_date: D, time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Maria", notes: "floors" }, change: { time_out: "08:45" } },
  { name: "Locum receipts", table: "locum_receipts", action: "LOCUM_RECEIPT_UPDATE", path: "/locumreceipts/receipts", headers: { "X-Eikon-Edit-Pass": "!4321" }, idKey: "id",
    body: { receipt_date: D, hours: 8, locum_full_name: "Dr Locum", registration_number: "R123", day_type: "normal", fee_per_hour: 30 }, change: { hours: 7 } },
  { name: "Credit notes", table: "credit_notes", action: "CREDITNOTE_UPDATE", path: "/creditnotes/entries",
    body: { issue_date: D, client_name: "Joe", client_surname: "Borg", telephone: "79000000", email: "", receipt_number: "R1", amount: 25.5, expiry_date: "", no_expiry: 1 }, change: { amount: 20 } },
];

const newId = (j) => j && (j.entry_id || j.id || (j.entry && j.entry.id) || (j.receipt && j.receipt.id));
const audits = (DB, action) => DB.db.prepare("SELECT * FROM audit_log WHERE action = ? ORDER BY id").all(action).map((r) => ({ ...r, details: JSON.parse(r.details_json || "{}") }));
const row = (DB, t, id) => DB.db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id);
const strip = (r) => { const o = { ...r }; delete o.updated_at; delete o.updated_by; return o; };

for (const C of CASES) {
  test(`correction-reason: ${C.name}: the reason is in the update's audit entry, the row is what a plain update stores`, async ({ api, bootstrap, DB }) => {
    const { token } = await bootstrap();
    const mk = async () => { const c = await api("POST", C.path, { token, body: C.body }); eq(c.status, 200, C.name + " create: " + c.text); const id = newId(c.json) || DB.db.prepare(`SELECT MAX(id) AS m FROM ${C.table}`).get().m; ok(id, "no id"); return id; };
    const a = await mk(), b = await mk();
    // a: corrected with a reason; b: the same update without one (as the classic screen sends it)
    const put = (id, extra) => api("PUT", C.path + "/" + id, { token, headers: C.headers, body: { ...C.body, ...C.change, ...extra } });
    const r1 = await put(a, { correction_reason: "  Quantity   typed wrong\n(prescription says otherwise)  " });
    eq(r1.status, 200, r1.text);
    const r2 = await put(b, {});
    eq(r2.status, 200, r2.text);
    const rows = audits(DB, C.action);
    eq(rows.length, 2, "two update audit entries");
    const ea = rows.find((x) => String(x.entity_id) === String(a)), eb = rows.find((x) => String(x.entity_id) === String(b));
    eq(ea.details.correction_reason, "Quantity typed wrong (prescription says otherwise)", "reason, spaces tidied");
    ok(ea.details.before && ea.details.after, "before/after kept");
    eq("correction_reason" in eb.details, false, "no reason key when none was sent");
    // same detail keys otherwise
    const keys = (d) => Object.keys(d).filter((k) => k !== "correction_reason" && k !== "before" && k !== "after").sort().join(",");
    eq(keys(ea.details), keys(eb.details), "the other detail keys are unchanged");
    // the two stored rows are the same in every column except id and the clock / who columns
    const ra = strip(row(DB, C.table, a)), rb = strip(row(DB, C.table, b));
    for (const k of Object.keys(ra)) if (k !== "id" && k !== "created_at") eq(JSON.stringify(ra[k]), JSON.stringify(rb[k]), C.name + " column " + k);
    ok(!Object.values(ra).some((v) => /typed wrong/.test(String(v))), "the reason is not written on the row");
  });
}

test("correction-reason: a long reason is cut to 500 characters; an empty one adds nothing", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const C = CASES[0];
  const id = (await api("POST", C.path, { token, body: C.body })).json.entry_id;
  eq((await api("PUT", C.path + "/" + id, { token, body: { ...C.body, correction_reason: "x".repeat(900) } })).status, 200);
  eq((await api("PUT", C.path + "/" + id, { token, body: { ...C.body, correction_reason: "   " } })).status, 200);
  const rows = audits(DB, C.action);
  eq(rows[0].details.correction_reason.length, 500);
  eq("correction_reason" in rows[1].details, false);
});

test("correction-reason: end of day and temperature updates carry it too", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const rec = (x) => ({ eod_date: D, time_of_day: "PM", staff_name: "Maria", float_amount: 500, x: [{ amount: 100, remark: "" }], epos: [], cheques: [], paid_outs: [], cash: { "50": 1 }, notes: "", ...x });
  eq((await api("PUT", "/endofday/record", { token, body: { record: rec() } })).status, 200);
  eq((await api("PUT", "/endofday/record", { token, body: { record: rec({ notes: "fixed", correction_reason: "X reading was wrong" }) } })).status, 200);
  eq(audits(DB, "EOD_UPDATE")[0].details.correction_reason, "X reading was wrong");
  // a locked day unlocked for a correction: the unlock's audit entry carries the reason too; the day is otherwise as before
  eq((await api("PUT", "/endofday/record", { token, body: { record: rec({ notes: "fixed", locked_at: new Date().toISOString(), action: "LOCK" }) } })).status, 200);
  const lockedRow = DB.db.prepare("SELECT * FROM end_of_day").get();
  ok(lockedRow.locked_at, "locked");
  eq((await api("PUT", "/endofday/record", { token, body: { record: rec({ notes: "ignored on unlock", locked_at: "", unlock: true, action: "UNLOCK", correction_reason: "Cheque total typed twice" }) } })).status, 200);
  const un = audits(DB, "EOD_UNLOCK")[0];
  eq(un.details.correction_reason, "Cheque total typed twice");
  const after = DB.db.prepare("SELECT * FROM end_of_day").get();
  eq(after.locked_at, null);
  for (const k of Object.keys(lockedRow)) if (!["locked_at", "updated_at", "updated_by"].includes(k)) eq(JSON.stringify(after[k]), JSON.stringify(lockedRow[k]), "unlock changed " + k);
  const dev = (await api("GET", "/temperature/devices", { token })).json.devices[0];
  eq((await api("POST", "/temperature/entries", { token, body: { device_id: dev.id, entry_date: D, min_temp: 3, max_temp: 7 } })).status, 200);
  eq((await api("POST", "/temperature/entries", { token, body: { device_id: dev.id, entry_date: D, min_temp: 3, max_temp: 6, correction_reason: "Max misread" } })).status, 200);
  const t = audits(DB, "TEMP_ENTRY_UPSERT");
  eq("correction_reason" in t[0].details, false);
  eq(t[1].details.correction_reason, "Max misread");
  ok(t[1].details.before && t[1].details.after);
});
