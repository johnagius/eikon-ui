// Portals (FIN): the distributor (400-599) and head-office (600-900) portals in the new layout.
//
// The world: group 1 has Pharmacy A (1) and Pharmacy B (2), two distributors (450 and 451) and its head office (650).
// Group 2 has a stranger pharmacy (50), its own distributor (470) and head office (670). Group 12 is the client the
// Cherubino screens were made for: one pharmacy (80) and its head office (680).
//   - GET /hq/stock (new, read only): a head office sees the open recalls and the near-expiry counts of its own
//     group's pharmacies only; pharmacies, distributors and the other group get nothing of it; no row changes.
//   - The distributor's existing routes: an order or a problem report reaches only the distributor it was sent to.
//   - /cherubino/*: org 12 keeps every route; every other org gets 404 Not found and nothing is written.
import { test, eq, ok } from "./lib.mjs";

function mt(offset) {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const p = t.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + offset)).toISOString().slice(0, 10);
}

async function world(app) {
  const A = await app.bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  const db = app.DB.db;
  const loc = (id, org, name) => db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(id, org, name);
  loc(2, 1, "Pharmacy B"); loc(450, 1, "Island Distributors"); loc(451, 1, "Second Distributor"); loc(650, 1, "Chain head office");
  db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  loc(50, 2, "Stranger Pharmacy"); loc(470, 2, "Other Distributor"); loc(670, 2, "Other head office");
  db.prepare("INSERT INTO orgs (id, name) VALUES (12, 'Bespoke Group')").run();
  loc(80, 12, "Bespoke Pharmacy"); loc(680, 12, "Bespoke head office");
  const u = (o) => app.addUser(o).then((x) => x.token);
  const T = {
    A: A.token,
    B: await u({ orgId: 1, locationId: 2, email: "admin@b.mt", name: "Admin B" }),
    sup: await u({ orgId: 1, locationId: 450, email: "sup@g.mt", name: "Ramona Ellul" }),
    sup2: await u({ orgId: 1, locationId: 451, email: "sup2@g.mt", name: "Second Supplier" }),
    ho: await u({ orgId: 1, locationId: 650, email: "ho@g.mt", name: "Kurt Muscat" }),
    hoStaff: await u({ orgId: 1, locationId: 650, email: "hostaff@g.mt", role: "staff", name: "Ops Staff" }),
    stranger: await u({ orgId: 2, locationId: 50, email: "admin@s.mt", name: "Stranger" }),
    sup3: await u({ orgId: 2, locationId: 470, email: "sup@other.mt", name: "Other Supplier" }),
    ho2: await u({ orgId: 2, locationId: 670, email: "ho@other.mt", name: "Other HO" }),
    b12: await u({ orgId: 12, locationId: 80, email: "ph@bespoke.mt", name: "Bespoke Pharmacist" }),
    ho12: await u({ orgId: 12, locationId: 680, email: "ho@bespoke.mt", name: "Bespoke HO" })
  };
  const must = async (m, p, token, body) => { const r = await app.api(m, p, { token, body }); ok(r.status < 300, m + " " + p + " → " + r.status + " " + r.text.slice(0, 200)); return r.json; };
  T.must = must;
  return T;
}

function dump(DB) {
  const tables = DB.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  return tables.filter((t) => !/^(sessions|audit_log|schema_marks|login_attempts)$/.test(t)).map((t) => t + ":" + JSON.stringify(DB.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())).join("\n");
}

test("portals: /hq/stock — a head office sees its own pharmacies' open recalls and near expiry, nobody else does", async (app) => {
  const T = await world(app);
  const { must } = T;
  await must("POST", "/alerts/entries", T.A, { entry_date: mt(-1), alert_type: "recall", status: "open", item_name: "Valsartan 80mg", batch: "VX1", storage_location: "room" });
  await must("POST", "/alerts/entries", T.A, { entry_date: mt(-2), alert_type: "quarantine", status: "in_progress", item_name: "Insulin pens", batch: "Q7", storage_location: "fridge" });
  const closed = await must("POST", "/alerts/entries", T.A, { entry_date: mt(-3), alert_type: "recall", status: "open", item_name: "Closed thing", storage_location: "room" });
  await must("PUT", "/alerts/entries/" + (closed.id || closed.entry_id), T.A, { entry_date: mt(-3), alert_type: "recall", status: "closed", item_name: "Closed thing", storage_location: "room" });
  await must("POST", "/near-expiry/entries", T.A, { product_name: "Brufen 400", expiry_date: mt(10), location: "Shelf", notes: "" });
  await must("POST", "/near-expiry/entries", T.A, { product_name: "Old stock", expiry_date: mt(-5), location: "Shelf", notes: "" });
  await must("POST", "/near-expiry/entries", T.A, { product_name: "Far away", expiry_date: mt(120), location: "Shelf", notes: "" });
  await must("POST", "/near-expiry/entries", T.B, { product_name: "Clexane", expiry_date: mt(25), location: "Fridge", notes: "" });
  await must("POST", "/alerts/entries", T.stranger, { entry_date: mt(-1), alert_type: "recall", status: "open", item_name: "Stranger recall", storage_location: "room" });

  const before = dump(app.DB);
  const r = await app.api("GET", "/hq/stock", { token: T.ho });
  eq(r.status, 200, r.text);
  const ph = r.json.pharmacies;
  eq(ph.map((p) => p.name).join("|"), "Pharmacy A|Pharmacy B", "only the group's own pharmacies, never a distributor or the head office");
  const a = ph.find((p) => p.id === 1), b = ph.find((p) => p.id === 2);
  eq(a.alerts.open, 2, "open and in-progress alerts count, closed ones do not");
  eq(a.alerts.recalls, 1); eq(a.alerts.quarantines, 1);
  eq(a.alerts.items[0].item, "Valsartan 80mg", "newest first");
  eq(a.near_expiry.within_30, 1); eq(a.near_expiry.expired, 1); eq(a.near_expiry.first, mt(10));
  eq(b.alerts.open, 0); eq(b.near_expiry.within_30, 1);
  ok(!/Stranger/.test(r.text), "nothing from the other group");
  // a head-office staff account reads it too (stock alerts carry no money and no patient)
  eq((await app.api("GET", "/hq/stock", { token: T.hoStaff })).status, 200);
  // the other group's head office sees its own pharmacy only
  const r2 = await app.api("GET", "/hq/stock", { token: T.ho2 });
  eq(r2.json.pharmacies.map((p) => p.name).join("|"), "Stranger Pharmacy");
  eq(r2.json.pharmacies[0].alerts.items[0].item, "Stranger recall");
  ok(!/Valsartan|Brufen/.test(r2.text), "never another group's stock");
  // pharmacies and distributors are refused
  for (const k of ["A", "B", "sup", "stranger"]) eq((await app.api("GET", "/hq/stock", { token: T[k] })).status, 403, k + " is not a head office");
  eq((await app.api("GET", "/hq/stock", {})).status, 401);
  eq(dump(app.DB), before, "reading changes nothing");
});

test("portals: /hq/stock — a group with no alerts or near-expiry tables yet reads as nothing", async (app) => {
  const T = await world(app);
  try { app.DB.db.prepare("DROP TABLE IF EXISTS alerts_entries").run(); app.DB.db.prepare("DROP TABLE IF EXISTS near_expiry_entries").run(); } catch (e) {}
  const r = await app.api("GET", "/hq/stock", { token: T.ho });
  eq(r.status, 200, r.text);
  eq(r.json.pharmacies.length, 2);
  eq(r.json.pharmacies[0].alerts.open, 0); eq(r.json.pharmacies[0].near_expiry.within_30, 0);
});

test("portals: a distributor sees only the orders and problem reports sent to it", async (app) => {
  const T = await world(app);
  const { must } = T;
  const p1 = await must("POST", "/supplier-products/entries", T.sup, { description: "Augmentin 625mg x14", stock_code: "AUG", barcode: "5001", cost_excl_vat: 8.2, cost_incl_vat: 8.2, vat_rate: 0, discount_pct: 0, discount_euro: 0, qty_purchased: 1, qty_free: 0, batch: "", expiry_date: mt(40), retail_price: 12.5 });
  await must("POST", "/supplier-products/entries", T.sup2, { description: "Second's product", stock_code: "S2", barcode: "", cost_excl_vat: 1, cost_incl_vat: 1.18, vat_rate: 18, discount_pct: 0, discount_euro: 0, qty_purchased: 1, qty_free: 0, batch: "", expiry_date: "", retail_price: 2 });
  const o1 = await must("POST", "/supplier-orders", T.A, { supplier_location_id: 450, supplier_name: "Island Distributors", notes: "", items: [{ product_id: p1.id, description: "Augmentin 625mg x14", stock_code: "AUG", qty_requested: 3, cost_excl_vat: 8.2, retail_price: 12.5, vat_rate: 0 }] });
  await must("POST", "/supplier-orders", T.B, { supplier_location_id: 451, supplier_name: "Second Distributor", notes: "", items: [{ description: "Second's product", qty_requested: 1, cost_excl_vat: 1, retail_price: 2, vat_rate: 18 }] });
  const mine = await must("GET", "/supplier-orders/received", T.sup);
  eq(mine.entries.map((o) => o.pharmacy_name).join("|"), "Pharmacy A", "450 gets only the order sent to 450");
  const theirs = await must("GET", "/supplier-orders/received", T.sup2);
  eq(theirs.entries.map((o) => o.pharmacy_name).join("|"), "Pharmacy B");
  eq((await must("GET", "/supplier-orders/received", T.sup3)).entries.length, 0, "a distributor in another group gets nothing");
  eq((await app.api("GET", "/supplier-orders/" + o1.id, { token: T.sup2 })).status, 403, "another distributor cannot open the order");
  eq((await app.api("PUT", "/supplier-orders/" + o1.id + "/confirm", { token: T.sup2, body: { status: "shipped", items: [] } })).status, 404, "nor send it");
  // products: each distributor its own list
  eq((await must("GET", "/supplier-products/entries", T.sup)).entries.map((p) => p.description).join("|"), "Augmentin 625mg x14");
  // the order shipped by its own distributor, the classic body: the pharmacy sees it as shipped with the delivery date
  const det = await must("GET", "/supplier-orders/" + o1.id, T.sup);
  await must("PUT", "/supplier-orders/" + o1.id + "/confirm", T.sup, { status: "shipped", items: det.items.map((i) => ({ id: i.id, unavailable: 0, qty_confirmed: i.qty_requested, notes: "" })), supplier_notes: "Van on Thursday", scheduled_delivery_date: mt(2) });
  const sent = await must("GET", "/supplier-orders/sent", T.A);
  const so = (sent.entries || sent.orders || []).find((o) => o.id === o1.id);
  eq(so.status, "shipped"); eq(so.scheduled_delivery_date, mt(2)); eq(so.supplier_notes, "Van on Thursday");
  // a problem report reaches 450 only
  await must("POST", "/supplier-orders/items/" + det.items[0].id + "/feedback", T.A, { problem_type: "Damaged", notes: "Box crushed" });
  eq((await must("GET", "/supplier-orders/feedback", T.sup)).entries.length, 1);
  eq((await must("GET", "/supplier-orders/feedback", T.sup2)).entries.length, 0);
  const fb = (await must("GET", "/supplier-orders/feedback", T.sup)).entries[0];
  eq((await app.api("PUT", "/supplier-orders/feedback/" + fb.id + "/resolve", { token: T.sup2, body: { resolution_status: "Resolved", supplier_notes: "" } })).status, 403);
  await must("PUT", "/supplier-orders/feedback/" + fb.id + "/resolve", T.sup, { resolution_status: "Credit Issued", supplier_notes: "Credit note CN-12 sent" });
  const after = (await must("GET", "/supplier-orders/feedback", T.sup)).entries[0];
  eq(after.resolution_status, "Credit Issued"); eq(after.supplier_notes, "Credit note CN-12 sent");
});

test("portals: /cherubino/* stays for org 12 and answers Not found to every other org", async (app) => {
  const T = await world(app);
  const day = mt(0);
  // org 12: every screen's routes work as before
  const c = await app.api("POST", "/cherubino/orders", { token: T.b12, body: { description: "Panadol", quantity: 2, order_date: day } });
  eq(c.status, 200, c.text);
  eq((await app.api("GET", "/cherubino/orders?date=" + day + "&all_org=1", { token: T.ho12 })).json.orders.length, 1);
  for (const p of ["/cherubino/price-changes?limit=200", "/cherubino/locations", "/cherubino/short-expiry", "/cherubino/oos"]) eq((await app.api("GET", p, { token: T.ho12 })).status, 200, "org 12 " + p);
  const oos = await app.api("POST", "/cherubino/oos", { token: T.ho12, body: { description: "Ventolin" } });
  eq(oos.status, 200, oos.text);
  // every other org: Not found, for reading and for writing, and nothing is written
  const before = dump(app.DB);
  for (const k of ["A", "ho", "sup", "stranger", "ho2"]) {
    for (const p of ["/cherubino/orders?date=" + day + "&all_org=1", "/cherubino/price-changes", "/cherubino/locations", "/cherubino/short-expiry", "/cherubino/oos"]) {
      const r = await app.api("GET", p, { token: T[k] });
      eq(r.status, 404, k + " GET " + p);
    }
    eq((await app.api("POST", "/cherubino/orders", { token: T[k], body: { description: "X", quantity: 1, order_date: day } })).status, 404, k + " POST order");
    eq((await app.api("POST", "/cherubino/oos", { token: T[k], body: { description: "X" } })).status, 404, k + " POST oos");
    eq((await app.api("DELETE", "/cherubino/oos/" + oos.json.id, { token: T[k] })).status, 404, k + " DELETE oos");
  }
  eq(dump(app.DB), before, "nothing written by the refused calls");
  eq((await app.api("GET", "/cherubino/oos", { token: T.b12 })).json.items.length, 1, "org 12's list untouched");
});
