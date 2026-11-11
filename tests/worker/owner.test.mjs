// How we are doing (/owner/summary, /owner/records): the owner's figures, read only, and who may see them.
//
// The world: group 1 ("Chain Group") has Pharmacy A (location 1, its admin and a staff member), Pharmacy B
// (location 2, its admin), a supplier (location 400) and head office (location 600). Group 2 has a stranger
// pharmacy (location 50) and its own head office (location 601). A and B record money, controlled drugs and
// customers; nobody but A's admin and group 1's head office may ever see A's figures, and head office never sees
// a patient's name or ID card. Nothing any of these calls does may change a single byte in the database.
import { test, eq, ok } from "./lib.mjs";

function mt(offset) { // a Malta day, offset days from today
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const p = t.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + offset)).toISOString().slice(0, 10);
}
const TODAY = mt(0), D1 = mt(-3), D2 = mt(-2), FROM = mt(-6), TO = TODAY;
const Q = `?from=${FROM}&to=${TO}`;

async function world(app) {
  const A = await app.bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  const db = app.DB.db;
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (400, 1, 'Group supplier')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (600, 1, 'Chain head office')").run();
  db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Stranger Pharmacy')").run();
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (601, 2, 'Other head office')").run();
  const u = (o) => app.addUser(o).then((x) => x.token);
  const T = {
    A: A.token,
    staffA: await u({ orgId: 1, locationId: 1, email: "staff@a.mt", role: "staff", name: "Staff A" }),
    B: await u({ orgId: 1, locationId: 2, email: "admin@b.mt", name: "Admin B" }),
    supplier: await u({ orgId: 1, locationId: 400, email: "sup@g.mt", name: "Supplier" }),
    ho: await u({ orgId: 1, locationId: 600, email: "ho@g.mt", name: "Head Office" }),
    hoStaff: await u({ orgId: 1, locationId: 600, email: "hostaff@g.mt", role: "staff", name: "HO Staff" }),
    stranger: await u({ orgId: 2, locationId: 50, email: "admin@s.mt", name: "Stranger" }),
    ho2: await u({ orgId: 2, locationId: 601, email: "ho@other.mt", name: "Other HO" })
  };
  const { api } = app;
  const must = async (m, p, token, body, headers) => { const r = await api(m, p, { token, body, headers }); ok(r.status < 300, m + " " + p + " → " + r.status + " " + r.text.slice(0, 200)); return r.json; };
  // Pharmacy A: one closed day with the classic sums, a paid out, a credit note partly used, a locum, CDs, an overdue order
  await must("PUT", "/endofday/record", T.A, { record: { eod_date: D1, time_of_day: "PM", staff_name: "Maria", float_amount: 500,
    x: [{ amount: "1000.50", remark: "" }], epos: [{ amount: "200", remark: "" }], cheques: [{ amount: "50", remark: "" }], paid_outs: [{ amount: "20.25", remark: "Courier" }],
    cash: { n500: 1, n200: 1, n50: 1, coins_total: "30.25" }, notes: "" } });
  await must("PUT", "/endofday/record", T.A, { record: { eod_date: D2, time_of_day: "PM", staff_name: "Maria", float_amount: 500, x: [{ amount: "777.77", remark: "" }], epos: [], cheques: [], paid_outs: [], cash: { n500: 2, n200: 1, n50: 1, n20: 1, n5: 1, coins_total: "2.77" }, notes: "" } });
  await must("POST", "/paid-out/entries", T.A, { entry_date: D1, entry_time: "10:00", payee_name: "Courier Ltd", fee: 20.25, payment_method: "cash", invoice_no: "", cheque_no: "", reason: "" });
  const cn = await must("POST", "/creditnotes/entries", T.A, { issue_date: D1, client_name: "Ġużeppi", client_surname: "Zammit", telephone: "79000001", amount: 40, no_expiry: 1 });
  await must("POST", `/creditnotes/entries/${cn.id}/purchases`, T.A, { amount: 15, receipt_number: "R1" });
  await must("POST", "/locumreceipts/receipts", T.A, { receipt_date: D1, hours: 4, locum_full_name: "Dr Locum", registration_number: "R-9", fee_per_hour: 20, total_fee: 80, day_type: "normal" }, { "X-Eikon-Edit-Pass": "!4321" });
  await must("POST", "/dda-sales/entries", T.A, { entry_date: D1, client_name: "Patient Secret", client_id_card: "777777M", client_address: "1 Triq Sigriet", medicine_name_dose: "Morphine 10mg", quantity: 3, doctor_name: "Dr A", doctor_reg_no: "12", prescription_serial_no: "S1" });
  await must("POST", "/dda-sales/entries", T.A, { entry_date: D2, client_name: "Patient Secret", client_id_card: "777777M", client_address: "1 Triq Sigriet", medicine_name_dose: "Morphine 10mg", quantity: 2, doctor_name: "Dr A", doctor_reg_no: "12", prescription_serial_no: "S2" });
  await must("POST", "/client-orders/entries", T.A, { order_date: D1, client_name: "Order Secret", client_phone: "79111111", items_text: "Vitamin D", priority: 2, needed_by: D2 });
  // Pharmacy B and the stranger: different, recognisable amounts
  await must("PUT", "/endofday/record", T.B, { record: { eod_date: D1, time_of_day: "PM", staff_name: "Ben", float_amount: 500, x: [{ amount: "333.33", remark: "" }], epos: [], cheques: [], paid_outs: [], cash: { n500: 1, coins_total: "333.33" }, notes: "" } });
  await must("PUT", "/endofday/record", T.stranger, { record: { eod_date: D1, time_of_day: "PM", staff_name: "Sam", float_amount: 500, x: [{ amount: "9999.99", remark: "" }], epos: [], cheques: [], paid_outs: [], cash: {}, notes: "" } });
  return T;
}

function dump(DB) { // every table, every row: the database as text
  const tables = DB.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  return tables.map((t) => t + ":" + JSON.stringify(DB.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())).join("\n");
}

test("owner: a pharmacy's admin sees its own figures, worked out with End of day's own sums", async (app) => {
  const T = await world(app);
  const r = await app.api("GET", "/owner/summary" + Q + `&cmp_from=${mt(-13)}&cmp_to=${mt(-7)}`, { token: T.A });
  eq(r.status, 200, r.text.slice(0, 300));
  eq(r.json.group, false); eq(r.json.pharmacies.length, 1);
  const p = r.json.pharmacies[0];
  eq(p.id, 1); eq(p.name, "Pharmacy A");
  // day 1: X 1000.50 − EPOS 200 − cheques 50 − paid outs 20.25 = expected 730.25; till 780.25 − float 500 = cash 280.25; under by 450
  const d1 = p.days.find((d) => d.date === D1);
  eq([d1.takings, d1.epos, d1.cheques, d1.paid_outs, d1.expected, d1.cash, d1.over_under], [1000.5, 200, 50, 20.25, 730.25, 280.25, -450]);
  eq(d1.paid_out_register, 20.25);
  const d2 = p.days.find((d) => d.date === D2);
  eq([d2.takings, d2.cash, d2.over_under], [777.77, 777.77, 0]); // 1000+200+50+20+5+2.77 − float 500
  eq(p.money.takings, 1778.27); eq(p.money.paid_outs, 20.25); eq(p.money.short_days, 1); eq(p.money.over_days, 0); eq(p.money.days_closed, 2);
  eq(p.money.locum_cost, 80); eq(p.money.locum_hours, 4);
  eq(p.prev.takings, 0, "nothing in the week before");
  eq([p.credit.open, p.credit.open_total, p.credit.issued, p.credit.issued_total, p.credit.used_total], [1, 25, 1, 40, 15]);
  eq([p.orders.new, p.orders.open, p.orders.overdue], [1, 1, 1]);
  eq(p.dda.supplied, [{ name: "Morphine 10mg", lines: 2, qty: 5 }]);
  ok(p.registers.eod_not_locked.includes(D1), "an unlocked day is listed");
  ok(!JSON.stringify(r.json).includes("333.33") && !JSON.stringify(r.json).includes("9999.99"), "no other pharmacy's figures");
  eq(r.json.pharmacies_allowed, [{ id: 1, name: "Pharmacy A" }]);
});

test("owner: staff, another pharmacy of the group, another group and a supplier never see a pharmacy's figures", async (app) => {
  const T = await world(app);
  const { api } = app;
  for (const path of ["/owner/summary" + Q, "/owner/records" + Q + "&kinds=eod,paid_outs,dda_supplied"]) {
    eq((await api("GET", path)).status, 401, "signed out: " + path);
    for (const who of ["staffA", "hoStaff", "supplier"]) {
      const r = await api("GET", path, { token: T[who] });
      eq(r.status, 403, who + " " + path); ok(!r.text.includes("1000.5") && !r.text.includes("Patient Secret"), who + " sees nothing");
    }
    for (const [who, loc] of [["A", 2], ["A", 50], ["A", 600], ["B", 1], ["stranger", 1], ["ho", 50], ["ho", 600], ["ho", 400], ["ho2", 1], ["ho2", 2]]) {
      const r = await api("GET", path + "&loc=" + loc, { token: T[who] });
      eq(r.status, 403, who + " asking for location " + loc + " " + path); ok(!r.text.includes("1000.5") && !r.text.includes("777.77"), who + " sees nothing of A");
    }
    eq((await api("GET", path + "&loc=x1", { token: T.A })).status, 400);
  }
  // Their own answers hold only their own pharmacy.
  const b = await api("GET", "/owner/summary" + Q, { token: T.B });
  eq(b.status, 200); eq(b.json.pharmacies.map((p) => p.id), [2]); eq(b.json.pharmacies[0].money.takings, 333.33);
  ok(!b.text.includes("1000.5") && !b.text.includes("777.77"), "B never sees A's takings");
  const s = await api("GET", "/owner/summary" + Q, { token: T.stranger });
  eq(s.json.pharmacies.map((p) => p.id), [50]); ok(!s.text.includes("Pharmacy A"), "the stranger does not even see A's name");
  const s2 = await api("GET", "/owner/summary" + Q, { token: T.ho2 });
  eq(s2.status, 200); eq(s2.json.pharmacies.map((p) => p.id), [50], "the other group's head office sees its own pharmacy only");
  ok(!s2.text.includes("Pharmacy A") && !s2.text.includes("1000.5"), "nothing of group 1");
  const rb = await api("GET", "/owner/records" + Q + "&kinds=eod,dda_supplied", { token: T.B });
  eq(rb.json.records.dda_supplied, []); eq(rb.json.records.eod.map((d) => d.takings), [333.33]);
});

test("owner: a group's head office sees each of its pharmacies and the group combined, never a patient's details", async (app) => {
  const T = await world(app);
  const { api } = app;
  const all = await api("GET", "/owner/summary" + Q + "&loc=all", { token: T.ho });
  eq(all.status, 200, all.text.slice(0, 300)); eq(all.json.group, true); eq(all.json.scope, "all");
  eq(all.json.pharmacies.map((p) => [p.id, p.money.takings]), [[1, 1778.27], [2, 333.33]], "both pharmacies, by name; not the supplier, not head office");
  eq(all.json.pharmacies_allowed.map((p) => p.id), [1, 2]);
  ok(!all.text.includes("9999.99") && !all.text.includes("Stranger"), "never another group's");
  const one = await api("GET", "/owner/summary" + Q + "&loc=2", { token: T.ho });
  eq(one.json.scope, "one"); eq(one.json.pharmacies.map((p) => p.id), [2]);
  const rec = await api("GET", "/owner/records" + Q + "&loc=1&kinds=dda_supplied,orders,credit_notes,eod", { token: T.ho });
  eq(rec.status, 200); eq(rec.json.patient_details, false);
  eq(rec.json.records.dda_supplied.map((x) => [x.medicine_name_dose, x.quantity, x.client_name, x.client_id_card, x.client_address]), [["Morphine 10mg", 3, "", "", ""], ["Morphine 10mg", 2, "", "", ""]]);
  ok(!rec.text.includes("Patient Secret") && !rec.text.includes("777777M") && !rec.text.includes("Order Secret") && !rec.text.includes("Zammit"), "no names, ID cards or phones");
  eq(rec.json.records.eod.length, 2);
  // The pharmacy's own admin sees the lines in full (it is their register).
  const own = await api("GET", "/owner/records" + Q + "&kinds=dda_supplied,credit_notes", { token: T.A });
  eq(own.json.patient_details, true); ok(own.text.includes("Patient Secret") && own.text.includes("Zammit"));
  eq(own.json.records.credit_notes[0].used, 15);
  eq((await api("GET", "/owner/records" + Q + "&kinds=everything", { token: T.A })).status, 400, "an unknown kind is refused");
  eq((await api("GET", "/owner/summary?from=2026-01-01&to=2028-01-01", { token: T.A })).status, 400, "at most 400 days");
  eq((await api("GET", "/owner/summary?from=2026-02-30&to=2026-03-01", { token: T.A })).status, 400);
});

test("owner: reading figures and records changes nothing in the database; a new pharmacy reads as all zero", async (app) => {
  const T = await world(app);
  const before = dump(app.DB);
  const calls = ["/owner/summary", "/owner/summary" + Q, "/owner/summary" + Q + "&cmp_from=" + mt(-30) + "&cmp_to=" + mt(-20),
    "/owner/records" + Q + "&kinds=eod,paid_outs,locum_receipts,credit_notes,credit_note_uses,orders,questions,deliveries,repeats,dda_supplied,dda_poyc,dda_received",
    "/owner/records" + Q + "&kinds=shifts,locum_register"];
  for (const who of ["A", "B", "ho", "staffA", "stranger", "ho2"]) for (const c of calls) await app.api("GET", c, { token: T[who] });
  for (const c of calls) await app.api("GET", c + (c.includes("?") ? "&" : "?") + "loc=1", { token: T.ho });
  eq(dump(app.DB), before, "byte-identical database after every read");
  // A pharmacy that has never used a register (tables not created yet) gets zeros, not an error
  const fresh = await app.api("GET", "/owner/summary" + Q, { token: T.stranger });
  eq(fresh.status, 200); eq(fresh.json.pharmacies[0].credit.open, 0); eq(fresh.json.pharmacies[0].staff, []);
});
