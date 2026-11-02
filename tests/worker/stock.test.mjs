import { test, eq, ok } from "./lib.mjs";

const prod = (description, extra = {}) => ({ description, cost_excl_vat: 10, retail_price: 20, vat_rate: 18, barcode: "", ...extra });

test("supplier import: replaces the catalogue atomically and keeps out-of-stock flags", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const r1 = await api("POST", "/supplier-products/bulk-import", { token, body: { rows: [prod("Amoxicillin 500"), prod("Metformin 850"), prod("Enalapril 20")] } });
  eq(r1.status, 200, r1.text);
  eq(DB.q("SELECT COUNT(*) AS c FROM supplier_products")[0].c, 3);
  const metformin = DB.one("SELECT id FROM supplier_products WHERE description='Metformin 850'");
  const oos = await api("PUT", "/supplier-products/entries/" + metformin.id + "/stock-status", { token, body: { out_of_stock: 1 } });
  eq(oos.status, 200, oos.text);
  // Re-import the same list: Metformin must still be out of stock
  const r2 = await api("POST", "/supplier-products/bulk-import", { token, body: { rows: [prod("Amoxicillin 500"), prod("Metformin 850"), prod("Enalapril 20"), prod("Paracetamol 500")] } });
  eq(r2.status, 200, r2.text);
  eq(DB.q("SELECT COUNT(*) AS c FROM supplier_products")[0].c, 4);
  eq(DB.one("SELECT out_of_stock FROM supplier_products WHERE description='Metformin 850'").out_of_stock, 1, "OOS flag survives an import");
  eq(DB.one("SELECT out_of_stock FROM supplier_products WHERE description='Paracetamol 500'").out_of_stock, 0);
  eq(DB.q("SELECT COUNT(*) AS c FROM supplier_stock_changes WHERE change_type='back_in_stock'")[0].c, 0, "a still out-of-stock item is not announced as back in stock");
  eq(DB.q("SELECT COUNT(*) AS c FROM supplier_stock_changes WHERE change_type='added' AND product_description='Paracetamol 500'")[0].c, 1, "new items are still announced");
  // A failure mid-import leaves the previous catalogue intact
  const origBatch = DB.batch.bind(DB);
  DB.batch = async () => { throw new Error("simulated D1 failure"); };
  const r3 = await api("POST", "/supplier-products/bulk-import", { token, body: { rows: [prod("Only one")] } });
  DB.batch = origBatch;
  eq(r3.status, 500);
  eq(DB.q("SELECT COUNT(*) AS c FROM supplier_products")[0].c, 4, "nothing deleted when the batch fails");
  // Rows without a description are reported, not silently dropped into an empty catalogue
  const r4 = await api("POST", "/supplier-products/bulk-import", { token, body: { rows: [{ description: "" }] } });
  eq(r4.status, 400);
  eq(DB.q("SELECT COUNT(*) AS c FROM supplier_products")[0].c, 4);
});

test("scarce stock: requests are capped, you cannot request your own offer, and depletion deletes nothing", async ({ api, bootstrap, addUser, DB }) => {
  const { token: owner } = await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Sister Pharmacy')").run();
  const sister = await addUser({ locationId: 2, email: "sister@example.com", name: "Sister" });
  // Owner lists a near-expiry item and offers it
  const ne = await api("POST", "/near-expiry/entries", { token: owner, body: { product_name: "Insulin glargine", expiry_date: "2027-01-31", location: "Fridge 1", notes: "" } });
  eq(ne.status, 200, ne.text);
  const neId = DB.one("SELECT id FROM near_expiry_entries").id;
  const offer = await api("POST", "/scarce-stock/offers", { token: owner, body: { item_name: "Insulin glargine", quantity_available: 10, near_expiry_id: neId, entry_date: "2026-10-31" } });
  eq(offer.status, 200, offer.text);
  const offerId = DB.one("SELECT id FROM scarce_stock_offers").id;
  // Owner cannot request their own offer
  eq((await api("POST", "/scarce-stock/offers/" + offerId + "/requests", { token: owner, body: { quantity_requested: 1 } })).status, 400);
  // Sister cannot request more than is left
  const tooMany = await api("POST", "/scarce-stock/offers/" + offerId + "/requests", { token: sister.token, body: { quantity_requested: 15 } });
  eq(tooMany.status, 400, tooMany.text);
  // Sister requests 6, then 4 (exactly what is left)
  eq((await api("POST", "/scarce-stock/offers/" + offerId + "/requests", { token: sister.token, body: { quantity_requested: 6 } })).status, 200);
  eq((await api("POST", "/scarce-stock/offers/" + offerId + "/requests", { token: sister.token, body: { quantity_requested: 5 } })).status, 400, "only 4 left");
  eq((await api("POST", "/scarce-stock/offers/" + offerId + "/requests", { token: sister.token, body: { quantity_requested: 4 } })).status, 200);
  // Fully requested: the offer closes, the near-expiry entry is still there
  eq(DB.one("SELECT is_closed FROM scarce_stock_offers WHERE id=?", offerId).is_closed, 1);
  eq(DB.q("SELECT COUNT(*) AS c FROM near_expiry_entries")[0].c, 1, "near-expiry entry not deleted");
  ok(DB.one("SELECT 1 AS x FROM audit_log WHERE action='SCARCE_OFFER_DEPLETED'"));
  eq(DB.q("SELECT COUNT(*) AS c FROM audit_log WHERE action='NEAR_EXPIRY_AUTO_DELETE'")[0].c, 0);
});

test("emergency POS: the server computes the money, VAT follows the discount, short cash is refused", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const items = [{ barcode: "1", name: "Item A", qty: 1, price: 100, vat_rate: 18 }, { barcode: "2", name: "Item B", qty: 2, price: 5, vat_rate: 0 }];
  // Client sends wrong totals and a 10 % discount; server recomputes
  const s1 = await api("POST", "/emergency-pos/sales", { token, body: { offline_id: "o1", receipt_no: "R-1", items, subtotal: 1, vat_total: 1, total: 1, discount_pct: 10, payment_method: "cash", amount_tendered: 100 } });
  eq(s1.status, 200, s1.text);
  eq(s1.json.subtotal, 110);
  eq(s1.json.total, 99);
  eq(s1.json.vat_total, 13.73, "VAT 15.25 on the 100 line, reduced by the 10 % discount");
  eq(s1.json.change_given, 1);
  eq(DB.one("SELECT discount_pct FROM pos_sales").discount_pct, 10);
  // Cash below total is refused
  const s2 = await api("POST", "/emergency-pos/sales", { token, body: { offline_id: "o2", receipt_no: "R-2", items, payment_method: "cash", amount_tendered: 50 } });
  eq(s2.status, 400, s2.text);
  eq(DB.q("SELECT COUNT(*) AS c FROM pos_sales")[0].c, 1);
  // Card needs no tendered amount
  eq((await api("POST", "/emergency-pos/sales", { token, body: { offline_id: "o3", receipt_no: "R-3", items, payment_method: "card" } })).status, 200);
  // Discount above 10 % is clamped
  const s4 = await api("POST", "/emergency-pos/sales", { token, body: { offline_id: "o4", receipt_no: "R-4", items, discount_pct: 50, payment_method: "card" } });
  eq(s4.json.total, 99);
  // Offline sync keeps a short cash sale (money already taken) but flags it
  const sync = await api("POST", "/emergency-pos/sales/sync", { token, body: { sales: [{ offline_id: "o5", receipt_no: "R-5", items, payment_method: "cash", amount_tendered: 20 }] } });
  eq(sync.status, 200, sync.text);
  eq(sync.json.synced, 1);
  ok(/tendered below total/.test(DB.one("SELECT notes FROM pos_sales WHERE offline_id='o5'").notes));
  // Duplicate offline_id is idempotent
  const dup = await api("POST", "/emergency-pos/sales", { token, body: { offline_id: "o1", receipt_no: "R-1", items, payment_method: "cash", amount_tendered: 100 } });
  eq(dup.json.duplicate, true);
});

test("stock transfers: open=1 leaves out closed items and their requests; without it everything comes back", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  for (const n of ["Open item", "Closed item"]) {
    const r = await api("POST", "/stock-transfers/items", { token, body: { item_description: n, quantity_available: 5, entry_date: "2026-10-01", expiry_date: "2027-12-31" } });
    eq(r.status < 300, true, r.text);
  }
  DB.db.prepare("UPDATE stock_transfer_items SET is_closed = 1 WHERE item_description = 'Closed item'").run();
  const all = await api("GET", "/stock-transfers/items", { token });
  const open = await api("GET", "/stock-transfers/items?open=1", { token });
  eq(all.json.items.length, 2); eq(open.json.items.map((i) => i.item_description), ["Open item"]);
});

test("scarce stock: more than 100 needs and offers still list (no D1 parameter limit), open=1 leaves out closed", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await api("GET", "/scarce-stock/needs", { token }); // creates the tables
  const ins = DB.db.prepare("INSERT INTO scarce_stock_needs (org_id, location_id, entry_date, item_name, quantity_needed, is_closed) VALUES (1, 1, '2026-10-01', ?, 1, ?)");
  for (let i = 0; i < 150; i++) ins.run("Need " + i, i < 30 ? 1 : 0);
  // Real D1 refuses more than 100 bound parameters; make the shim do the same for this test.
  const prep = DB.prepare.bind(DB);
  DB.prepare = (sql) => { const st = prep(sql); const bind = st.bind.bind(st); st.bind = (...a) => { if (a.length > 100) throw new Error("too many SQL variables"); return bind(...a); }; return st; };
  const all = await api("GET", "/scarce-stock/needs", { token });
  eq(all.status, 200, all.text); eq(all.json.needs.length, 150);
  eq((await api("GET", "/scarce-stock/needs?open=1", { token })).json.needs.length, 120);
  eq((await api("GET", "/scarce-stock/offers", { token })).status, 200);
  DB.prepare = prep;
});

test("returns: open=1 lists every return not yet credited plus the last 60 days, not the whole history", async () => {
  const { makeApp } = await import("./harness.mjs");
  const app = await makeApp();
  const { token } = await app.bootstrap();
  const add = (entry_date, description, credit) => app.api("POST", "/returns/entries", { token, body: { entry_date, description, credit_note_received: credit } });
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  eq((await add(d(-400), "Old, still waiting for credit", 0)).status < 300, true);
  await add(d(-400), "Old and credited", 1);
  await add(d(-10), "Recent and credited", 1);
  const all = (await app.api("GET", "/returns/entries", { token })).json.entries.map((e) => e.description);
  eq(all.length, 3, "without open=1 nothing changes");
  const open = (await app.api("GET", "/returns/entries?open=1", { token })).json.entries.map((e) => e.description).sort();
  eq(open, ["Old, still waiting for credit", "Recent and credited"]);
});
