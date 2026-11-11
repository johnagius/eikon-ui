import { test, eq, ok } from "./lib.mjs";
const cnBody = (n) => ({ issue_date: "2026-11-10", client_name: "Paul", client_surname: "Vella" + n, telephone: "79000000", email: "", receipt_number: "R" + n, amount: 10, expiry_date: "", no_expiry: 1 });

test("credit notes (W6): credit notes are numbered per pharmacy; notes already stored keep their number", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  // Pharmacy 1 already has notes from before (made with the old schema: no cn_no column yet).
  eq((await api("GET", "/creditnotes/list", { token })).status, 200); // makes the tables
  // Simulate notes stored before the column existed: rows with cn_no NULL and big shared ids.
  DB.db.prepare("INSERT INTO credit_notes (id, org_id, location_id, issue_date, client_name, client_surname, telephone, amount, no_expiry) VALUES (40, 1, 1, '2026-10-01', 'Old', 'One', '79', 5, 1)").run();
  DB.db.prepare("INSERT INTO credit_notes (id, org_id, location_id, issue_date, client_name, client_surname, telephone, amount, no_expiry) VALUES (41, 1, 1, '2026-10-02', 'Old', 'Two', '79', 5, 1)").run();
  const before = DB.db.prepare("SELECT * FROM credit_notes ORDER BY id").all();
  // A new pharmacy (another group) starts at 1.
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (3, 'Fresh Org')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (60, 3, 'Ħamrun Pharmacy')").run();
  const fresh = await addUser({ orgId: 3, locationId: 60, email: "owner@fresh.mt", role: "admin", name: "Joseph Camilleri" });
  const f1 = await api("POST", "/creditnotes/entries", { token: fresh.token, body: cnBody(1) });
  eq(f1.status, 200, f1.text); eq(f1.json.cn_no, 1, "first note of a new pharmacy is No. 1");
  const f2 = await api("POST", "/creditnotes/entries", { token: fresh.token, body: cnBody(2) });
  eq(f2.json.cn_no, 2);
  ok(f1.json.id > 41, "the row id is still the shared one (" + f1.json.id + ")");
  // The pharmacy with notes carries on after its highest number (41), never repeating one.
  const o1 = await api("POST", "/creditnotes/entries", { token, body: cnBody(3) });
  eq(o1.json.cn_no, 44, "continues after every number this database ever showed (the new pharmacy's notes are rows 42 and 43): no number printed anywhere is given twice");
  const o2 = await api("POST", "/creditnotes/entries", { token, body: cnBody(4) });
  eq(o2.json.cn_no, 45);
  // A third pharmacy in the same group: its own 1.
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const br = await addUser({ orgId: 1, locationId: 2, email: "br@example.com", role: "admin", name: "Branch Admin" });
  eq((await api("POST", "/creditnotes/entries", { token: br.token, body: cnBody(5) })).json.cn_no, 1);
  // Rows stored before are byte-identical; the list sends cn_no (null for them).
  const after = DB.db.prepare("SELECT * FROM credit_notes WHERE id IN (40, 41) ORDER BY id").all();
  eq(after, before, "old rows unchanged (cn_no still null)");
  eq(after.map((r) => r.cn_no), [null, null]);
  const list = (await api("GET", "/creditnotes/list", { token })).json.entries;
  const byId = Object.fromEntries(list.map((e) => [e.id, e.cn_no]));
  eq(byId[40], null); eq(byId[41], null); eq(byId[o1.json.id], 44);
  const fl = (await api("GET", "/creditnotes/list", { token: fresh.token })).json.entries.map((e) => e.cn_no).sort();
  eq(fl, [1, 2]);
  // An edit (the classic body) never changes the number
  const up = await api("PUT", "/creditnotes/entries/" + f1.json.id, { token: fresh.token, body: { ...cnBody(1), amount: 12 } });
  eq(up.status, 200, up.text);
  eq(DB.db.prepare("SELECT cn_no FROM credit_notes WHERE id = ?").get(f1.json.id).cn_no, 1);
  // Delete the newest then add: the number is not reused below the highest still stored
  eq((await api("DELETE", "/creditnotes/entries/" + f2.json.id, { token: fresh.token })).status, 200);
  eq((await api("POST", "/creditnotes/entries", { token: fresh.token, body: cnBody(6) })).json.cn_no, 3, "a deleted note's number (2) is never given again");
});

test("credit notes (W6): question and delivery numbers stay per pharmacy whatever the device sends", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (3, 'Fresh Org')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (60, 3, 'Ħamrun Pharmacy')").run();
  const fresh = await addUser({ orgId: 3, locationId: 60, email: "owner@fresh.mt", role: "admin", name: "Joseph Camilleri" });
  const tk = (id) => ({ ticket_id: id, open_date: "2026-11-10", client_name: "Paul Vella", phone: "79", email: "", issue: "Stock?", category: "General Enquiry", priority: 2, status: "Open", assigned_to: "", followup_date: null, notes_log: "[]" });
  for (let i = 0; i < 3; i++) await api("POST", "/client-tickets/entries", { token, body: tk("") });
  const a = await api("POST", "/client-tickets/entries", { token: fresh.token, body: tk("") });
  eq(a.json.ticket_id, "TKT-00001", "a new pharmacy's first question");
  const dv = (id) => ({ delivery_id: id, order_date: "2026-11-10", scheduled_date: "2026-11-10", scheduled_time_slot: "Morning", client_name: "Paul Vella", phone: "79", email: "", delivery_address: "1 Triq", address_notes: "", delivery_method: "In-house Driver", priority: 2, status: "Scheduled", signature_required: 0, signature_obtained: 0, delivery_attempts: 0, contains_controlled: 0, cold_chain_required: 0, items: "[]", delivery_log: "[]", internal_notes: "" });
  for (let i = 0; i < 2; i++) await api("POST", "/client-deliveries/entries", { token, body: dv("") });
  const d = await api("POST", "/client-deliveries/entries", { token: fresh.token, body: dv("") });
  eq(d.json.delivery_id, "DEL-00001", "a new pharmacy's first delivery");
});
