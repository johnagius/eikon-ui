import { test, eq, ok } from "./lib.mjs";

// Controlled drugs by medicine (new layout cdreg): two read-only routes over the four controlled-drug registers.
// They change nothing, stay inside the pharmacy, are bounded by date (at most 400 days, on the date indexes), and
// without `from` the ledger starts at the latest stock-take count of the medicine so a balance can be worked out.
const today = new Date().toISOString().slice(0, 10);
const shift = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TABLES = ["dda_purchases_entries", "dda_sales_entries", "dda_poyc_entries", "dda_stocktakes", "dda_stocktake_items"];
const snapAll = (DB) => JSON.stringify(TABLES.map((t) => DB.q(`SELECT * FROM ${t} ORDER BY id`)));

const sale = (date, med, q, serial) => ({ entry_date: date, client_name: "Carmel Zammit", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: med, quantity: q, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: serial });

async function seed(app) {
  const s = await app.bootstrap();
  const { api, DB } = app, token = s.token;
  const post = async (p, body) => { const r = await api("POST", p, { token, body }); eq(r.status, 200, p + " " + r.text); return r.json; };
  // a count 20 days ago: 50 morphine tablets, 10 fentanyl patches
  const st = await post("/dda-stocktakes/stocktakes", {});
  await post(`/dda-stocktakes/stocktakes/${st.stocktake_id}/items`, { item_name: "Morphine", dosage: "10mg tablets", qty_tablets: 50 });
  await post(`/dda-stocktakes/stocktakes/${st.stocktake_id}/items`, { item_name: "Fentanyl", dosage: "25mcg patches", qty_tablets: 10 });
  DB.db.prepare("UPDATE dda_stocktakes SET created_at = ? WHERE id = ?").run(shift(today, -20) + " 08:00:00", st.stocktake_id);
  // an older count (200 days ago) and an old line (300 days ago) the default period leaves out
  const old = await post("/dda-stocktakes/stocktakes", {});
  await post(`/dda-stocktakes/stocktakes/${old.stocktake_id}/items`, { item_name: "Morphine", dosage: "10mg tablets", qty_tablets: 5 });
  DB.db.prepare("UPDATE dda_stocktakes SET created_at = ? WHERE id = ?").run(shift(today, -200) + " 08:00:00", old.stocktake_id);
  await post("/dda-purchases/entries", { entry_date: shift(today, -300), dda_name_dose: "Morphine 10mg tablets", quantity: 99, agent: "Old Agent", invoice_number: "OLD-1" });
  // since the count: +30 received, -2 supplied, -1 POYC; a fentanyl sale; a different medicine
  await post("/dda-purchases/entries", { entry_date: shift(today, -10), dda_name_dose: "Morphine 10mg tablets", quantity: 30, agent: "Alfred Gera & Sons", invoice_number: "INV-1" });
  await post("/dda-sales/entries", sale(shift(today, -5), "Morphine 10mg tablets", 2, "S-1"));
  await post("/dda-poyc/entries", sale(shift(today, -3), "morphine  10mg tablets", 1, "P-1"));
  await post("/dda-sales/entries", sale(shift(today, -2), "Fentanyl 25mcg patches", 1, "S-2"));
  await post("/dda-sales/entries", sale(shift(today, -1), "Alprazolam 0.5mg", 1, "S-3"));
  return { token };
}

test("dda register: the ledger starts at the count before the latest, lists every line of the medicine in date order and changes nothing", async (app) => {
  const { api, DB } = app;
  const { token } = await seed(app);
  const before = snapAll(DB);
  const r = await api("GET", "/dda-register/ledger?term=morphine&to=" + today, { token });
  eq(r.status, 200, r.text);
  const j = r.json;
  eq(j.auto_from, true); eq(j.from, shift(today, -200), "from = the day of the count before the latest");
  eq(j.counts.map((c) => c.qty_tablets), [5, 50], "both counts of it within 400 days, oldest first");
  eq(j.received.map((e) => e.quantity), [30], "the line before that count is left out");
  const fen = (await api("GET", "/dda-register/ledger?term=fentanyl&to=" + today, { token })).json;
  eq(fen.from, shift(today, -20), "counted once: from that count");
  eq(j.supplied.map((e) => e.prescription_serial_no), ["S-1"]);
  eq(j.poyc.map((e) => e.prescription_serial_no), ["P-1"], "any spelling that contains the word (double space, lower case)");
  ok(!("client_address" in j.supplied[0]), "the ledger does not carry the address");
  eq(snapAll(DB), before, "reading changes no row in any controlled-drug table");

  // an explicit period, and the 400-day ceiling
  const all = (await api("GET", `/dda-register/ledger?term=morphine&from=${shift(today, -1000)}&to=${today}`, { token })).json;
  eq(all.from, shift(today, -400), "never more than 400 days"); eq(all.received.map((e) => e.quantity), [99, 30]);
  // a medicine never counted: the last 92 days
  const alp = (await api("GET", "/dda-register/ledger?term=alpraz&to=" + today, { token })).json;
  eq(alp.from, shift(today, -92)); eq(alp.counts.length, 0); eq(alp.supplied.length, 1);
  // wildcards are words, not patterns
  eq((await api("GET", "/dda-register/ledger?term=%25%25&to=" + today, { token })).json.supplied.length, 0, "'%%' matches nothing");
  eq((await api("GET", "/dda-register/ledger?term=m&to=" + today, { token })).status, 400, "one letter is refused");
  eq((await api("GET", "/dda-register/ledger?term=morphine&from=2026-13-01", { token })).status, 400);
  // without `to`: the pharmacy's day (Malta), not the UTC one
  const malta = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  eq((await api("GET", "/dda-register/ledger?term=morphine", { token })).json.to, malta, "to defaults to Malta's today");
});

test("dda register: the medicines list has every spelling written or counted in the period", async (app) => {
  const { api, DB } = app;
  const { token } = await seed(app);
  const before = snapAll(DB);
  const r = await api("GET", "/dda-register/medicines?to=" + today, { token });
  eq(r.status, 200, r.text);
  const j = r.json;
  eq(j.from, shift(today, -92));
  eq(j.received.map((x) => x.name), ["Morphine 10mg tablets"], "the 300-day-old line is outside the period");
  eq(j.received[0].qty, 30, "with the quantity received in the period");
  eq(j.supplied.map((x) => x.name).sort(), ["Alprazolam 0.5mg", "Fentanyl 25mcg patches", "Morphine 10mg tablets"]);
  eq(j.poyc.map((x) => x.name), ["morphine  10mg tablets"], "as written");
  eq(j.counted.map((x) => x.item_name + " " + x.dosage).sort(), ["Fentanyl 25mcg patches", "Morphine 10mg tablets"]);
  eq(snapAll(DB), before, "the list changes nothing");
});

test("dda register: another pharmacy sees none of it; staff can read; bounded reads use the date indexes", async (app) => {
  const { api, DB } = app;
  const { token } = await seed(app);
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch" });
  const b = (await api("GET", "/dda-register/ledger?term=morphine&to=" + today, { token: branch.token })).json;
  eq([b.received.length, b.supplied.length, b.poyc.length, b.counts.length], [0, 0, 0, 0], "another pharmacy of the group sees nothing");
  const bm = (await api("GET", "/dda-register/medicines?to=" + today, { token: branch.token })).json;
  eq([bm.received.length, bm.supplied.length, bm.poyc.length, bm.counted.length], [0, 0, 0, 0]);
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  eq((await api("GET", "/dda-register/ledger?term=morphine&to=" + today, { token: staff.token })).status, 200, "staff read it, as they read the registers");
  eq((await api("GET", "/dda-register/ledger?term=morphine")).status, 401, "signed out: refused");
  // the query plans: each register is read through its (org, location, date) index, stock takes through created_at
  const plan = (sql) => DB.q("EXPLAIN QUERY PLAN " + sql).map((x) => x.detail).join(" | ");
  for (const [t, col] of [["dda_purchases_entries", "dda_name_dose"], ["dda_sales_entries", "medicine_name_dose"], ["dda_poyc_entries", "medicine_name_dose"]]) {
    const p = plan(`SELECT id FROM ${t} WHERE org_id = 1 AND location_id = 1 AND entry_date >= '2026-01-01' AND entry_date <= '2026-02-01' AND lower(${col}) LIKE '%x%' ESCAPE '\\'`);
    ok(/USING INDEX idx_dda_\w+_org_loc_date/.test(p), t + " uses its date index: " + p);
  }
  const ps = plan(`SELECT i.id FROM dda_stocktakes s JOIN dda_stocktake_items i ON i.org_id = s.org_id AND i.location_id = s.location_id AND i.stocktake_id = s.id
    WHERE s.org_id = 1 AND s.location_id = 1 AND s.created_at >= '2026-01-01' AND s.created_at < '2026-02-01'`);
  ok(/idx_dda_stocktakes_org_loc_created/.test(ps) && /idx_dda_stocktake_items_stocktake/.test(ps), "stock takes by date, items by stock take: " + ps);
});
