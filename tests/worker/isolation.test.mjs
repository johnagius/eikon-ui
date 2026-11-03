// One pharmacy's records stay its own (backlog item 3).
//
// Pharmacy A is org 1, location 1. "Branch" is another pharmacy in the SAME group (org 1, location 2).
// "Stranger" is a pharmacy in another group (org 2, location 50).
// For every per-pharmacy register: A creates a row; Branch and Stranger try to list it, read it by id,
// change it and delete it. Every write must be refused, nothing may change in the database, and lists
// must not show the row. Then A must still be able to change and delete its own row.
//
// The second half pins down what a group shares ON PURPOSE (Cherubino head office, stock transfers,
// scarce stock, board 'org'/'all' messages (board.test.mjs), shared contact lists, quotations' "All our pharmacies",
// order-diary item suggestions, the company-admin overview, the POS catalogue fallback). Those must
// keep working exactly as before.
import { test, eq, ok } from "./lib.mjs";

const MARK = "Isomark";
const D = "2026-10-30";
const M = "2026-10";

// One body that satisfies every register's create validation (extra fields are ignored by the worker).
function sink(tag) {
  const t = MARK + tag;
  return {
    entry_date: D, order_date: D, quote_date: D, issue_date: D, open_date: D, date: D, receipt_date: D, shift_date: D,
    expiry_date: "2027-01-31", expires_date: "2027-04-30", needed_by: D, pick_up_date: D, scheduled_date: D, expiry: "2027-01-31",
    entry_time: "10:00", time: "10:00", time_in: "08:00", time_out: "09:00", start_time: "08:00", end_time: "12:00",
    client_name: t, client_surname: "Vella", name: t, full_name: t, patient_name: t, locum_full_name: t, payee_name: t,
    client_phone: "79123456", phone: "79123456", telephone: "79123456", client_id_card: "123456M", client_id: "123456M", id_card: "123456M",
    client_address: "1 Triq", delivery_address: "1 Triq",
    description: t, item_description: t, item_name: t, items_text: t, product_name: t, medicine_name_dose: "Morphine 10mg " + t, dda_name_dose: "Morphine 10mg " + t,
    quantity: 2, qty: 2, amount: 5, deposit: 0, priority: 2, status: "Open", category: "General Enquiry", issue: t, ticket_id: "TKT-" + tag,
    doctor_name: "Dr A", doctor_reg_no: "12", prescriber_name: "Dr A", prescriber_reg_no: "12", prescription_serial_no: "S-" + tag, posology: "1 od",
    registration_number: "R-1", supplier: "Supp", invoice_number: "INV1", batch: "B1", storage_location: "room", alert_type: "Recall", reason: "r",
    cleaner_name: "K", staff_name: "M", notes: t, title: t, vat_rate: 18, retail_price: 2, cost_excl_vat: 1, qty_purchased: 1,
    fee: 25, fee_per_hour: 10, hours: 4, rate: 10, agent: "AM Mangion", calc_type: "dose", data: { note: t }, result_json: {}, input_json: {}
  };
}

// Every per-pharmacy register with a by-id route. create: [path]; id: from the create answer;
// list: GET path that must not show the row to others; get: GET-by-id (optional);
// update: [method, path(id)]; del: list of [method, path(id), body?] (every delete door the router has).
const REGISTERS = [
  { name: "client orders", table: "client_orders_entries", create: "/client-orders/entries", list: "/client-orders/entries?month=" + M,
    update: ["PUT", (id) => "/client-orders/entries/" + id], del: [["DELETE", (id) => "/client-orders/entries/" + id]] },
  { name: "client tickets (questions)", table: "client_tickets_entries", create: "/client-tickets/entries", list: "/client-tickets/entries",
    update: ["PUT", (id) => "/client-tickets/entries/" + id], del: [["DELETE", (id) => "/client-tickets/entries/" + id]] },
  { name: "order diary", table: "order_diary_entries", create: "/order-diary/entries", list: "/order-diary/entries?date=" + D,
    update: ["PUT", (id) => "/order-diary/entries/" + id], del: [["DELETE", (id) => "/order-diary/entries/" + id]] },
  { name: "credit notes", table: "credit_notes", create: "/creditnotes/entries", list: "/creditnotes/list",
    update: ["PUT", (id) => "/creditnotes/entries/" + id], del: [["DELETE", (id) => "/creditnotes/entries/" + id]] },
  { name: "paid out", table: "paid_out_entries", create: "/paid-out/entries", list: "/paid-out/entries?month=" + M,
    update: ["PUT", (id) => "/paid-out/entries/" + id], del: [["DELETE", (id) => "/paid-out/entries/" + id]] },
  { name: "near expiry", table: "near_expiry_entries", create: "/near-expiry/entries", list: "/near-expiry/entries",
    update: ["PUT", (id) => "/near-expiry/entries/" + id], del: [["DELETE", (id) => "/near-expiry/entries/" + id]] },
  { name: "cleaning", table: "cleaning_entries", create: "/cleaning/entries", list: "/cleaning/entries?month=" + M,
    update: ["PUT", (id) => "/cleaning/entries/" + id], del: [["DELETE", (id) => "/cleaning/entries/" + id]] },
  { name: "locum register", table: "locum_register_entries", create: "/locumregister/entries", list: "/locumregister/entries?month=" + M,
    update: ["PUT", (id) => "/locumregister/entries/" + id], del: [["DELETE", (id) => "/locumregister/entries/" + id]] },
  { name: "locum receipts", table: "locum_receipts", headers: { "X-Eikon-Edit-Pass": "!4321" }, create: "/locumreceipts/receipts", list: "/locumreceipts/receipts?month=" + M,
    update: ["PUT", (id) => "/locumreceipts/receipts/" + id], del: [["DELETE", (id) => "/locumreceipts/receipts/" + id]] },
  { name: "daily register", table: "daily_register_entries", create: "/daily-register/entries", list: "/daily-register/entries?month=" + M,
    update: ["PUT", (id) => "/daily-register/entries/" + id], del: [["DELETE", (id) => "/daily-register/entries/" + id]] },
  { name: "alerts", table: "alerts_entries", create: "/alerts/entries", list: "/alerts/entries?month=" + M,
    update: ["PUT", (id) => "/alerts/entries/" + id], del: [["DELETE", (id) => "/alerts/entries/" + id]] },
  { name: "returns", table: "returns_entries", create: "/returns/entries", list: "/returns/entries?month=" + M,
    update: ["PUT", (id) => "/returns/entries/" + id], del: [["DELETE", (id) => "/returns/entries/" + id]] },
  { name: "deliveries", table: "client_deliveries", create: "/client-deliveries/entries", list: "/client-deliveries/entries",
    update: ["PUT", (id) => "/client-deliveries/entries/" + id], del: [["DELETE", (id) => "/client-deliveries/entries/" + id]] },
  { name: "DDA sales", table: "dda_sales_entries", create: "/dda-sales/entries", list: "/dda-sales/entries?month=" + M,
    update: ["PUT", (id) => "/dda-sales/entries/" + id],
    del: [["DELETE", (id) => "/dda-sales/entries/" + id], ["POST", (id) => "/dda-sales/entries/" + id + "/delete"], ["POST", () => "/dda-sales/entries/delete", (id) => ({ id })]] },
  { name: "DDA POYC", table: "dda_poyc_entries", create: "/dda-poyc/entries", list: "/dda-poyc/entries?month=" + M,
    update: ["PUT", (id) => "/dda-poyc/entries/" + id],
    del: [["DELETE", (id) => "/dda-poyc/entries/" + id], ["POST", (id) => "/dda-poyc/entries/" + id + "/delete"], ["POST", () => "/dda-poyc/entries/delete", (id) => ({ id })]] },
  { name: "DDA purchases", table: "dda_purchases_entries", create: "/dda-purchases/entries", list: "/dda-purchases/entries?month=" + M,
    update: ["PUT", (id) => "/dda-purchases/entries/" + id], del: [["DELETE", (id) => "/dda-purchases/entries/" + id]] },
  { name: "repeat prescriptions", table: "repeat_prescription_entries", create: "/repeat-prescriptions/entries", list: "/repeat-prescriptions/entries?month=" + M,
    update: ["PUT", (id) => "/repeat-prescriptions/entries/" + id], del: [["DELETE", (id) => "/repeat-prescriptions/entries/" + id]] },
  { name: "DDA stock-takes", table: "dda_stocktakes", create: "/dda-stocktakes/stocktakes", list: "/dda-stocktakes/stocktakes",
    listHas: (j, id) => JSON.stringify(j).includes('"id":' + id + ','), get: (id) => "/dda-stocktakes/stocktakes/" + id, getHas: (g) => g.status < 300, update: ["PUT", (id) => "/dda-stocktakes/stocktakes/" + id], del: [] },
  { name: "temperature devices", table: "temperature_devices", create: "/temperature/devices", list: "/temperature/devices?include_inactive=1",
    update: ["PUT", (id) => "/temperature/devices/" + id], del: [] },
  { name: "end-of-day contacts", table: "end_of_day_contacts", create: "/endofday/contacts", list: "/endofday/contacts",
    update: ["PUT", (id) => "/endofday/contacts/" + id], del: [] },
  { name: "appointments: doctors", table: "appt_doctors", create: "/appointments/doctors", list: "/appointments/doctors",
    get: (id) => "/appointments/doctors/" + id, update: ["PUT", (id) => "/appointments/doctors/" + id], del: [["DELETE", (id) => "/appointments/doctors/" + id]] },
  { name: "appointments: clinics", table: "appt_clinics", create: "/appointments/clinics", list: "/appointments/clinics",
    get: (id) => "/appointments/clinics/" + id, update: ["PUT", (id) => "/appointments/clinics/" + id], del: [["DELETE", (id) => "/appointments/clinics/" + id]] },
  { name: "appointments: entries", table: "appt_appointments", create: "/appointments/entries", list: "/appointments/entries?date=" + D,
    get: (id) => "/appointments/entries/" + id, update: ["PUT", (id) => "/appointments/entries/" + id], del: [["DELETE", (id) => "/appointments/entries/" + id]] },
  { name: "appointments: waitlist", table: "appt_waitlist", create: "/appointments/waitlist", list: "/appointments/waitlist",
    get: (id) => "/appointments/waitlist/" + id, update: ["PUT", (id) => "/appointments/waitlist/" + id], del: [["DELETE", (id) => "/appointments/waitlist/" + id]] },
  { name: "loyalty campaigns", table: "loyalty_campaigns", create: "/loyalty/campaigns", list: "/loyalty/campaigns",
    update: ["PUT", (id) => "/loyalty/campaigns/" + id], del: [["DELETE", (id) => "/loyalty/campaigns/" + id]] },
  { name: "loyalty clients", table: "loyalty_clients", create: "/loyalty/clients", list: "/loyalty/clients",
    update: null, del: [["DELETE", () => "/loyalty/clients/0123456M"]] },
  { name: "shift staff", table: "shift_staff", create: "/shifts/staff", list: "/shifts/staff?include_inactive=1",
    update: ["PUT", (id) => "/shifts/staff/" + id], del: [["DELETE", (id) => "/shifts/staff/" + id]] },
  { name: "people", table: "people", create: "/people", list: "/people?q=" + MARK.toLowerCase(),
    get: (id) => "/people/" + id, update: ["POST", () => "/people", (id) => ({ id, version: 1, notes: "changed" })], del: [] },
];
// The worker builds the contact tables once per process (a module flag), so the contacts register runs in the
// same test (same database) as the shared-contacts checks below.
const CONTACT_CLIENTS = { name: "contacts: clients (per pharmacy)", table: "contacts_clients", create: "/contacts/clients", list: "/contacts/clients",
  update: ["POST", () => "/contacts/clients", (id) => ({ id, name: "changed", phone: "1" })], del: [["DELETE", (id) => "/contacts/clients/" + id]] };

function idOf(json) {
  if (!json) return null;
  for (const k of ["id", "entry_id", "stocktake_id", "device_id", "staff_id"]) if (json[k] != null) return json[k];
  for (const k of ["entry", "client", "person", "campaign", "item", "appointment"]) if (json[k] && json[k].id != null) return json[k].id;
  return null;
}

async function world(app) {
  const A = await app.bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B (same group)')").run();
  app.DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Stranger Pharmacy')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const stranger = await app.addUser({ orgId: 2, locationId: 50, email: "stranger@example.com", name: "Stranger Admin" });
  return { A: A.token, branch: branch.token, stranger: stranger.token };
}

function restore(DB, table, id, before) {
  const rows = JSON.parse(before);
  DB.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  for (const r of rows) { const k = Object.keys(r); DB.db.prepare(`INSERT INTO ${table} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...k.map((x) => r[x])); }
}
const snap = (DB, table, id) => JSON.stringify(DB.q(`SELECT * FROM ${table} WHERE id = ?`, id));

// Runs the whole matrix and returns one line per (register, route) with what happened.
async function runMatrix(app, regs, T) {
  const { api, DB } = app;
  T = T || await world(app);
  const rows = [];
  let n = 0;
  for (const r of regs) {
    n++;
    const c = await api("POST", r.create, { headers: r.headers, token: T.A, body: sink(String(n)) });
    const id = idOf(c.json);
    if (c.status >= 300 || id == null) { rows.push({ reg: r.name, route: "create", who: "A", res: "SETUP FAIL " + c.status + " " + c.text.slice(0, 120), bad: true }); continue; }
    const before = snap(DB, r.table, id);
    if (before === "[]") { rows.push({ reg: r.name, route: "create", who: "A", res: "SETUP FAIL row not in " + r.table, bad: true }); continue; }
    const mine = await api("GET", r.list, { headers: r.headers, token: T.A });
    if (!(r.listHas ? r.listHas(mine.json, id) : mine.text.includes(MARK + n))) rows.push({ reg: r.name, route: "GET " + r.list, who: "A", res: "own row missing from own list (" + mine.status + ")", bad: true });
    for (const who of ["branch", "stranger"]) {
      const tok = T[who];
      const l = await api("GET", r.list, { headers: r.headers, token: tok });
      const shown = r.listHas ? r.listHas(l.json, id) : l.text.includes(MARK + n);
      rows.push({ reg: r.name, route: "GET list", who, res: shown ? "LEAK: row listed" : "hidden (" + l.status + ")", bad: shown });
      if (r.get) {
        const g = await api("GET", r.get(id), { headers: r.headers, token: tok });
        const leak = r.getHas ? r.getHas(g) : (g.status < 300 && g.text.includes(MARK + n));
        rows.push({ reg: r.name, route: "GET :id", who, res: leak ? "LEAK: " + g.status : "refused " + g.status, bad: leak });
      }
      if (r.update) {
        const [m, p, b] = r.update;
        const u = await api(m, p(id), { headers: r.headers, token: tok, body: b ? b(id) : { ...sink(String(n)), notes: "changed by " + who, client_name: "changed", name: "changed", description: "changed", item_name: "changed", item_description: "changed" } });
        const changed = snap(DB, r.table, id) !== before;
        rows.push({ reg: r.name, route: m + " :id", who, res: (changed ? "CHANGED ROW " : u.status < 300 ? "said ok, row unchanged " : "refused ") + u.status, bad: changed, soft: !changed && u.status < 300 });
        if (changed) restore(DB, r.table, id, before);
      }
      for (const [m, p, b] of r.del) {
        const d = await api(m, p(id), { headers: r.headers, token: tok, body: b ? b(id) : undefined });
        const changed = snap(DB, r.table, id) !== before;
        rows.push({ reg: r.name, route: m + " " + p(":id"), who, res: (changed ? "DELETED/CHANGED ROW " : d.status < 300 ? "said ok, row unchanged " : "refused ") + d.status, bad: changed, soft: !changed && d.status < 300 });
        if (changed) restore(DB, r.table, id, before);
      }
    }
    if (snap(DB, r.table, id) !== before) { rows.push({ reg: r.name, route: "row after all calls", who: "-", res: "ROW DIFFERS", bad: true }); restore(DB, r.table, id, before); }
    // A is not locked out of its own row.
    if (r.update) {
      const [m, p, b] = r.update;
      const u = await api(m, p(id), { headers: r.headers, token: T.A, body: b ? b(id) : { ...sink(String(n)), notes: "own edit" } });
      if (u.status >= 300) rows.push({ reg: r.name, route: m + " :id", who: "A", res: "OWN UPDATE REFUSED " + u.status + " " + u.text.slice(0, 100), bad: true });
    }
    if (r.del.length) {
      const [m, p, b] = r.del[0];
      const d = await api(m, p(id), { headers: r.headers, token: T.A, body: b ? b(id) : undefined });
      const gone = snap(DB, r.table, id) === "[]";
      if (d.status >= 300 || !gone) rows.push({ reg: r.name, route: m + " :id", who: "A", res: "OWN DELETE FAILED " + d.status + " gone=" + gone + " " + d.text.slice(0, 100), bad: true });
    }
  }
  return rows;
}

function report(rows) {
  if (process.env.ISO_MATRIX) for (const r of rows) console.log(`MATRIX\t${r.reg}\t${r.route}\t${r.who}\t${r.res}`);
  return rows.filter((r) => r.bad);
}

test("isolation: every per-pharmacy register refuses another pharmacy in the same group and another group", async (app) => {
  const bad = report(await runMatrix(app, REGISTERS));
  eq(bad.map((r) => `${r.reg} | ${r.route} | ${r.who} | ${r.res}`), [], "cross-pharmacy access");
});

test("isolation: credit-note uses and notes cannot be removed from another pharmacy", async (app) => {
  const { api, DB } = app;
  const T = await world(app);
  const cn = await api("POST", "/creditnotes/entries", { token: T.A, body: sink("cn") });
  eq(cn.status, 200, cn.text);
  const id = cn.json.id;
  const pu = await api("POST", `/creditnotes/entries/${id}/purchases`, { token: T.A, body: { amount: 2, receipt_number: "R9" } });
  const no = await api("POST", `/creditnotes/entries/${id}/notes`, { token: T.A, body: { text: "kept" } });
  eq(pu.status, 200, pu.text); eq(no.status, 200, no.text);
  const before = JSON.stringify([DB.q("SELECT * FROM credit_note_purchases"), DB.q("SELECT * FROM credit_note_notes")]);
  for (const who of ["branch", "stranger"]) {
    const a = await api("DELETE", `/creditnotes/entries/${id}/purchases/${pu.json.id}`, { token: T[who] });
    const b = await api("DELETE", `/creditnotes/entries/${id}/notes/${no.json.id}`, { token: T[who] });
    eq([a.status, b.status], [404, 404], who + " refused");
    const c = await api("POST", `/creditnotes/entries/${id}/purchases`, { token: T[who], body: { amount: 1 } });
    eq(c.status, 404, who + " cannot add a use");
    const l = await api("GET", "/creditnotes/list", { token: T[who] });
    ok(!l.text.includes("R9") && !l.text.includes("kept"), who + " does not see the uses/notes");
  }
  eq(JSON.stringify([DB.q("SELECT * FROM credit_note_purchases"), DB.q("SELECT * FROM credit_note_notes")]), before, "nothing changed");
  // The pharmacy itself still removes its own use and note.
  eq((await api("DELETE", `/creditnotes/entries/${id}/purchases/${pu.json.id}`, { token: T.A })).status, 200);
  eq((await api("DELETE", `/creditnotes/entries/${id}/notes/${no.json.id}`, { token: T.A })).status, 200);
  eq(DB.q("SELECT COUNT(*) AS c FROM credit_note_purchases")[0].c + DB.q("SELECT COUNT(*) AS c FROM credit_note_notes")[0].c, 0);
});

// ───────────────────────── Shared ON PURPOSE inside a group: must not change ─────────────────────────

test("isolation, group sharing kept: quotations 'All our pharmacies' shows every branch; edits stay as before (Decision 4)", async (app) => {
  const { api, DB } = app;
  const T = await world(app);
  const q = await api("POST", "/quotations/entries", { token: T.A, body: sink("qt") });
  eq(q.status, 200, q.text);
  const own = await api("GET", "/quotations/entries", { token: T.branch });
  ok(!own.text.includes(MARK + "qt"), "branch's own view hides A's quote");
  const all = await api("GET", "/quotations/entries?all_org=1", { token: T.branch });
  ok(all.text.includes(MARK + "qt"), "branch's 'All our pharmacies' view shows A's quote");
  const st = await api("GET", "/quotations/entries?all_org=1", { token: T.stranger });
  ok(!st.text.includes(MARK + "qt"), "another group never sees it");
  // Another group cannot touch it.
  eq((await api("PUT", "/quotations/entries/" + q.json.id, { token: T.stranger, body: { notes: "x" } })).status, 404);
  eq((await api("DELETE", "/quotations/entries/" + q.json.id, { token: T.stranger })).status, 404);
  // The classic screen offers edit/delete on every row of the "All Org Locations" view, so a branch
  // can still edit a sibling's quote. Left as it is until John decides (Decision 4).
  const e = await api("PUT", "/quotations/entries/" + q.json.id, { token: T.branch, body: { notes: "edited by branch" } });
  eq(e.status, 200, e.text);
  eq(DB.q("SELECT notes FROM quotation_entries WHERE id=?", q.json.id)[0].notes, "edited by branch");
});

test("isolation, group sharing kept: Cherubino orders, OOS list, price checks and short expiry work across the group", async (app) => {
  const { api, DB } = app;
  const T = await world(app);
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (600, 1, 'Head Office')").run();
  const ho = (await app.addUser({ orgId: 1, locationId: 600, email: "ho@example.com", name: "Head Office" })).token;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta" }).format(new Date());
  const o = await api("POST", "/cherubino/orders", { token: T.A, body: { description: "Aerius", quantity: 3, order_date: today } });
  eq(o.status, 200, o.text);
  const hoList = await api("GET", "/cherubino/orders?all_org=1&date=" + today, { token: ho });
  ok(hoList.json.orders.some((x) => x.id === o.json.id), "head office sees every branch's order");
  const brList = await api("GET", "/cherubino/orders?all_org=1&date=" + today, { token: T.branch });
  ok(brList.json.orders.some((x) => x.id === o.json.id), "a branch sees the group's orders too");
  eq((await api("PUT", "/cherubino/orders/" + o.json.id, { token: ho, body: { ordered: true } })).status, 200, "head office ticks a branch's order");
  eq(DB.q("SELECT ordered FROM cherubino_orders WHERE id=?", o.json.id)[0].ordered, 1);
  eq((await api("PUT", "/cherubino/orders/" + o.json.id, { token: T.branch, body: { description: "x" } })).status, 403, "branch cannot edit A's order (as before)");
  eq((await api("DELETE", "/cherubino/orders/" + o.json.id, { token: T.branch })).status, 403, "branch cannot delete A's order (as before)");
  eq((await api("PUT", "/cherubino/orders/" + o.json.id, { token: T.stranger, body: { description: "x" } })).status, 404);

  // OOS: a branch proposes, head office approves, another branch reports it back in stock.
  const p = await api("POST", "/cherubino/oos", { token: T.A, body: { description: "Ventolin" } });
  eq(p.status, 200, p.text);
  eq((await api("PUT", "/cherubino/oos/" + p.json.id, { token: ho, body: { action: "approve" } })).status, 200);
  eq((await api("PUT", "/cherubino/oos/" + p.json.id, { token: T.branch, body: { action: "mark_back_in_stock" } })).status, 200);
  eq(DB.q("SELECT status FROM cherubino_oos WHERE id=?", p.json.id)[0].status, "back_in_stock");
  ok((await api("GET", "/cherubino/oos", { token: T.branch })).text.includes("Ventolin"), "OOS list is group-wide");
  ok(!(await api("GET", "/cherubino/oos", { token: T.stranger })).text.includes("Ventolin"));

  // Price changes: one branch records, each branch ticks its own check.
  const pc = await api("POST", "/cherubino/price-changes", { token: ho, body: { product_name: "Panadol", old_price: 2, new_price: 2.5 } });
  eq(pc.status, 200, pc.text);
  eq((await api("POST", `/cherubino/price-changes/${pc.json.id}/check`, { token: T.A })).status, 200);
  eq((await api("POST", `/cherubino/price-changes/${pc.json.id}/check`, { token: T.branch })).status, 200);
  eq(DB.q("SELECT COUNT(*) AS c FROM cherubino_price_checks WHERE price_change_id=?", pc.json.id)[0].c, 2);
  ok((await api("GET", "/cherubino/price-changes", { token: T.branch })).text.includes("Panadol"));

  // Warehouse short expiry: head office uploads once; each branch orders against the shared stock.
  const up = await api("POST", "/cherubino/short-expiry/upload", { token: ho, body: { items: [{ stk_code: "A1", stk_desc: "Shortexp 500", batch: "B1", expiry: "2026/12", qty: 10, loc_code: "WSL" }], wipe: true } });
  eq(up.status, 200, up.text);
  const se = await api("GET", "/cherubino/short-expiry", { token: T.branch });
  ok(se.text.includes("Shortexp 500"), "branch sees the warehouse list");
  const itemId = DB.q("SELECT id FROM cherubino_short_expiry")[0].id;
  eq((await api("POST", "/cherubino/short-expiry/order", { token: T.A, body: { item_id: itemId, quantity: 4 } })).status, 200);
  eq((await api("POST", "/cherubino/short-expiry/order", { token: T.branch, body: { item_id: itemId, quantity: 6 } })).status, 200);
  eq((await api("POST", "/cherubino/short-expiry/order", { token: T.branch, body: { item_id: itemId, quantity: 7 } })).status, 400, "the group shares one stock figure");
});

test("isolation, group sharing kept: stock transfers between branches of a group", async (app) => {
  const { api, DB } = app;
  const T = await world(app);
  const it = await api("POST", "/stock-transfers/items", { token: T.A, body: { item_description: "Clexane 40", batch: "B", expiry_date: "2027-06-30", quantity_available: 5 } });
  ok(it.status === 200 || it.status === 201, it.text);
  const itemId = it.json.id || it.json.item_id || (it.json.item && it.json.item.id);
  ok(itemId, it.text);
  ok((await api("GET", "/stock-transfers/items", { token: T.branch })).text.includes("Clexane 40"), "a branch sees the group's transfer stock");
  ok(!(await api("GET", "/stock-transfers/items", { token: T.stranger })).text.includes("Clexane 40"), "another group does not");
  const rq = await api("POST", `/stock-transfers/items/${itemId}/requests`, { token: T.branch, body: { quantity_requested: 2 } });
  ok(rq.status === 200 || rq.status === 201, rq.text);
  eq(DB.q("SELECT COUNT(*) AS c FROM stock_transfer_requests WHERE item_id=?", itemId)[0].c, 1, "branch request recorded");
  eq((await api("PUT", "/stock-transfers/items/" + itemId, { token: T.branch, body: { quantity_available: 1 } })).status, 403, "only the owner edits the item (as before)");
});

test("isolation, group sharing kept: scarce stock offers and needs are seen by every pharmacy", async (app) => {
  const { api } = app;
  const T = await world(app);
  const of = await api("POST", "/scarce-stock/offers", { token: T.A, body: { entry_date: D, item_name: "Ozempic", quantity_available: 2, expiry_date: "2027-06-30" } });
  eq(of.status, 200, of.text);
  for (const who of ["branch", "stranger"]) ok((await api("GET", "/scarce-stock/offers", { token: T[who] })).text.includes("Ozempic"), who + " sees the offer");
  const nd = await api("POST", "/scarce-stock/needs", { token: T.A, body: { entry_date: D, item_name: "Mounjaro", quantity_needed: 1 } });
  eq(nd.status, 200, nd.text);
  for (const who of ["branch", "stranger"]) ok((await api("GET", "/scarce-stock/needs", { token: T[who] })).text.includes("Mounjaro"), who + " sees the need");
});

// Board 'org'/'all' sharing inside a group is checked in board.test.mjs (the board's tables are built once per
// worker process, so it must stay in that one test).

test("isolation, group sharing kept: group contact lists, order-diary suggestions and the company-admin overview", async (app) => {
  const { api } = app;
  const T = await world(app);
  // The pharmacy's own client contacts stay its own.
  const bad = report(await runMatrix(app, [CONTACT_CLIENTS], T));
  eq(bad.map((r) => `${r.reg} | ${r.route} | ${r.who} | ${r.res}`), [], "cross-pharmacy access");
  // Contact lists other than 'clients' are shared by the whole group, and any branch may edit them.
  eq((await api("GET", "/contacts/suppliers", { token: T.A })).status, 200);
  const s = await api("POST", "/contacts/suppliers", { token: T.A, body: { name: "Group Supplier Ltd", phone: "21000000" } });
  eq(s.status, 200, s.text);
  const sid = s.json.id;
  ok((await api("GET", "/contacts/suppliers", { token: T.branch })).text.includes("Group Supplier Ltd"), "branch sees the group's suppliers");
  ok(!(await api("GET", "/contacts/suppliers", { token: T.stranger })).text.includes("Group Supplier Ltd"));
  eq((await api("POST", "/contacts/suppliers", { token: T.branch, body: { id: sid, name: "Group Supplier Ltd", phone: "21999999" } })).status, 200, "branch edits a shared contact");
  // Order diary item suggestions are a group-wide list.
  eq((await api("POST", "/order-diary/entries", { token: T.A, body: { order_date: D, item_name: "Suggestme 500", supplier: "AM" } })).status, 200);
  ok((await api("GET", "/order-diary/items?q=suggestme", { token: T.branch })).text.includes("Suggestme 500"), "suggestions shared in the group");
  // Company admin (location 600-900) overview lists the group's pharmacies (< 400).
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (601, 1, 'Head Office')").run();
  const ho = (await app.addUser({ orgId: 1, locationId: 601, email: "ho2@example.com", name: "HO" })).token;
  const ov = await api("GET", "/admin/pharmacy-overview?month=" + M, { token: ho });
  eq(ov.status, 200, ov.text.slice(0, 200));
  ok(ov.text.includes("Pharmacy A") && ov.text.includes("Pharmacy B (same group)"), "overview covers both branches");
  eq((await api("GET", "/admin/pharmacy-overview?month=" + M, { token: T.branch })).status, 403, "a pharmacy is not a company admin");
});

test("isolation, group sharing kept: POS catalogue 'all_org' reads the group's list and falls back to the chain catalogue", async (app) => {
  const { api, DB } = app;
  const T = await world(app);
  eq((await api("GET", "/emergency-pos/catalog", { token: T.A })).status, 200);
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (3, 'Chain catalogue')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (3, 3, 'Catalogue')").run();
  const add = DB.db.prepare("INSERT INTO pos_products (org_id, location_id, barcode, name, price, vat_rate, category, unit, is_active) VALUES (?,?,?,?,?,?,?,?,1)");
  add.run(3, 3, "111", "Chainprod", 1.5, 18, "", "");
  // Group 1 has no catalogue yet: every branch gets the chain one.
  const q = "/emergency-pos/catalog?limit=2000&offset=0&all_org=1&fallback_org=3&fallback_location=3";
  ok((await api("GET", q, { token: T.branch })).text.includes("Chainprod"), "fallback to the chain catalogue");
  // Once pharmacy A loads a catalogue, the whole group reads it.
  add.run(1, 1, "222", "Groupprod", 2, 18, "", "");
  const br = await api("GET", q, { token: T.branch });
  ok(br.text.includes("Groupprod") && !br.text.includes("Chainprod"), "branch reads the group's catalogue");
  ok(!(await api("GET", "/emergency-pos/catalog", { token: T.branch })).text.includes("Groupprod"), "without all_org a branch reads its own");
});

test("isolation: team sign-ins (/team/users) are per pharmacy: Branch and Stranger see and change none of A's people", async (app) => {
  const T = await world(app);
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "iso-staff@example.com", name: "Iso Staff", role: "staff" });
  await app.api("GET", "/team/users", { token: T.A }); // the column exists before the snapshot
  const snapUsers = () => JSON.stringify(app.DB.db.prepare("SELECT * FROM users WHERE org_id = 1 AND default_location_id = 1 ORDER BY id").all());
  const before = snapUsers();
  const bad = [];
  for (const [who, tok] of [["Branch", T.branch], ["Stranger", T.stranger]]) {
    const l = await app.api("GET", "/team/users", { token: tok });
    if (l.text.includes("admin@example.com") || l.text.includes("iso-staff@example.com")) bad.push(who + " list shows A's people");
    for (const id of [1, staff.user.id]) {
      for (const [p, b] of [["password"], ["active", { active: false }], ["role", { role: "staff" }]]) {
        const r = await app.api("POST", "/team/users/" + id + "/" + p, { token: tok, body: b });
        if (r.status !== 404) bad.push(who + " " + p + " on " + id + " -> " + r.status);
      }
    }
  }
  eq(bad, []);
  eq(snapUsers(), before, "A's users unchanged");
  eq((await app.api("GET", "/auth/me", { token: staff.token })).status, 200, "A's staff still signed in");
});
