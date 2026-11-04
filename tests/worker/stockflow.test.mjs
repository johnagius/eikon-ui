// Stock flow (d-stock): the ordering flow over the order diary. Additive only: two new tables, four new routes; the
// order diary, customer orders and alerts rows are read, never changed by these routes.
import { test, eq, ok } from "./lib.mjs";

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
async function diary(api, token, body) {
  const r = await api("POST", "/order-diary/entries", { token, body: { order_date: day(0), qty: 1, supplier: "", notes: "", ...body } });
  eq(r.status, 200, r.text); return r.json.id;
}

test("stock flow: open lines across days, carried lines once, ordered marks and undo, received lines listed", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const a = await diary(api, token, { order_date: day(-5), item_name: "Augmentin 625 x14", qty: 2, supplier: "GSK" });
  const b = await diary(api, token, { order_date: day(-2), item_name: "Ventolin inhaler", supplier: "Alliance" });
  const old = await diary(api, token, { order_date: day(-90), item_name: "Too old", supplier: "GSK" });
  const c = await diary(api, token, { order_date: day(0), item_name: "Ensure vanilla x24", supplier: "Ħili Pharma" });
  eq((await api("PUT", "/order-diary/entries/" + c, { token, body: { status: "received" } })).status, 200);
  // carry Augmentin's day forward: the earlier line is no longer open, the carried one is
  eq((await api("POST", "/order-diary/carry-over", { token, body: { from_date: day(-5), to_date: day(-4) } })).json.carried, 1);
  const before = DB.q("SELECT * FROM order_diary_entries ORDER BY id");

  const r = await api("GET", "/stock-flow/open?from=" + day(-60), { token });
  eq(r.status, 200, r.text);
  const names = r.json.open.map((x) => x.item_name + "@" + x.order_date).sort();
  eq(names, ["Augmentin 625 x14@" + day(-4), "Ventolin inhaler@" + day(-2)], "one Augmentin (the carried one), Ventolin, nothing older than from");
  ok(!r.json.open.some((x) => x.id === old || x.id === a), "the old line and the carried-from line are not open");
  eq(r.json.open.find((x) => x.item_name === "Augmentin 625 x14").first_date, day(-5), "a carried line says the day it was first written");
  eq(r.json.received.map((x) => x.id), [c], "received recently");

  // mark Augmentin's ORIGINAL line ordered: the carried line inherits it
  const m = await api("POST", "/stock-flow/ordered", { token, body: { diary_ids: [a, b], supplier: "GSK" } });
  eq(m.status, 200, m.text); eq(m.json.marked, 2);
  const r2 = await api("GET", "/stock-flow/open?from=" + day(-60), { token });
  ok(r2.json.open.every((x) => x.ordered_at), "both open lines show as ordered (the carried one through its earlier day)");
  eq(r2.json.open[0].ordered_by_name.length > 0, true, "who ordered it");
  const u = await api("POST", "/stock-flow/ordered/undo", { token, body: { diary_ids: [b] } });
  eq(u.json.cleared, 1);
  const r3 = await api("GET", "/stock-flow/open?from=" + day(-60), { token });
  eq(r3.json.open.find((x) => x.id === b).ordered_at, null, "undo takes the mark off");
  // marking again updates in place (one row per line)
  await api("POST", "/stock-flow/ordered", { token, body: { diary_ids: [a], supplier: "Alliance" } });
  eq(DB.q("SELECT COUNT(*) AS c FROM stock_flow_ordered WHERE diary_id = " + a)[0].c, 1);
  eq(DB.q("SELECT supplier FROM stock_flow_ordered WHERE diary_id = " + a)[0].supplier, "Alliance");

  eq(DB.q("SELECT * FROM order_diary_entries ORDER BY id"), before, "the order diary rows are untouched by the stock-flow routes");
  ok(DB.q("SELECT action FROM audit_log WHERE action LIKE 'STOCK_FLOW_%'").length >= 3, "each mark is in the audit trail");
  // nothing given / nonsense refused
  eq((await api("POST", "/stock-flow/ordered", { token, body: { diary_ids: [] } })).status, 400);
  eq((await api("POST", "/stock-flow/ordered", { token, body: { diary_ids: ["x", -1] } })).status, 400);
});

test("stock flow: links tie a diary line to a customer order or a recall of the same pharmacy, and follow carried lines", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const co = await api("POST", "/client-orders/entries", { token, body: { order_date: day(0), client_name: "Borg Anna", contact: "79111222", client_phone: "79111222", items: "Ventolin inhaler", priority: 2 } });
  eq(co.status, 200, co.text); const coId = co.json.entry_id || co.json.id;
  const al = await api("POST", "/alerts/entries", { token, body: { entry_date: day(0), alert_type: "recall", status: "open", item_name: "Valsartan 80mg", batch: "VX1", quantity: "4", reason: "Recall", storage_location: "room" } });
  eq(al.status, 200, al.text); const alId = DB.one("SELECT id FROM alerts_entries").id;
  const d1 = await diary(api, token, { order_date: day(-1), item_name: "Ventolin inhaler", supplier: "Alliance" });
  const d2 = await diary(api, token, { item_name: "Valsartan 80mg", supplier: "Ħili Pharma" });
  const coBefore = DB.q("SELECT * FROM client_orders_entries"), alBefore = DB.q("SELECT * FROM alerts_entries");
  eq((await api("POST", "/stock-flow/links", { token, body: { diary_id: d1, source: "order", source_id: coId } })).status, 200);
  eq((await api("POST", "/stock-flow/links", { token, body: { diary_id: d1, source: "order", source_id: coId } })).status, 200, "the same link twice is fine");
  eq(DB.q("SELECT COUNT(*) AS c FROM stock_flow_links")[0].c, 1, "and stored once");
  eq((await api("POST", "/stock-flow/links", { token, body: { diary_id: d2, source: "alert", source_id: alId } })).status, 200);
  eq((await api("POST", "/stock-flow/links", { token, body: { diary_id: d2, source: "other", source_id: alId } })).status, 400, "unknown source refused");
  eq((await api("POST", "/stock-flow/links", { token, body: { diary_id: d2, source: "order", source_id: 999 } })).status, 404, "unknown order refused");
  await api("POST", "/order-diary/carry-over", { token, body: { from_date: day(-1), to_date: day(0) } });
  const r = await api("GET", "/stock-flow/open?from=" + day(-30), { token });
  const vent = r.json.open.find((x) => x.item_name === "Ventolin inhaler");
  ok(vent && vent.id !== d1, "the carried Ventolin line is the open one");
  eq(vent.links, [{ source: "order", source_id: coId }], "and keeps the link to Borg Anna's order");
  eq(r.json.open.find((x) => x.id === d2).links, [{ source: "alert", source_id: alId }]);
  eq(DB.q("SELECT * FROM client_orders_entries"), coBefore, "customer orders untouched");
  eq(DB.q("SELECT * FROM alerts_entries"), alBefore, "alerts untouched");
});

test("stock flow: another pharmacy of the same group, and another group, see and touch nothing of ours", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Sister Pharmacy')").run();
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (3, 2, 'Other Pharmacy')").run();
  const sister = await addUser({ locationId: 2, email: "sister@example.com", name: "Sister" });
  const other = await addUser({ orgId: 2, locationId: 3, email: "other@example.com", name: "Other" });
  const mine = await diary(api, token, { item_name: "Augmentin 625 x14", supplier: "GSK" });
  const co = await api("POST", "/client-orders/entries", { token, body: { order_date: day(0), client_name: "Borg Anna", contact: "79111222", client_phone: "79111222", items: "Augmentin 625 x14", priority: 2 } });
  const coId = co.json.entry_id || co.json.id;
  await api("POST", "/stock-flow/ordered", { token, body: { diary_ids: [mine], supplier: "GSK" } });
  await api("POST", "/stock-flow/links", { token, body: { diary_id: mine, source: "order", source_id: coId } });
  const theirs = await diary(api, sister.token, { item_name: "Sister item", supplier: "GSK" });
  for (const who of [sister, other]) {
    const r = await api("GET", "/stock-flow/open?from=" + day(-30), { token: who.token });
    eq(r.status, 200, r.text);
    ok(!r.json.open.some((x) => x.id === mine), "our line is not in their list");
    eq((await api("POST", "/stock-flow/ordered", { token: who.token, body: { diary_ids: [mine] } })).status, 400, "they cannot mark our line");
    eq((await api("POST", "/stock-flow/ordered/undo", { token: who.token, body: { diary_ids: [mine] } })).status, 400, "nor take our mark off");
    eq((await api("POST", "/stock-flow/links", { token: who.token, body: { diary_id: mine, source: "order", source_id: coId } })).status, 404, "nor link our line");
  }
  eq((await api("POST", "/stock-flow/links", { token: sister.token, body: { diary_id: theirs, source: "order", source_id: coId } })).status, 404, "nor link their line to our customer's order");
  eq(DB.q("SELECT COUNT(*) AS c FROM stock_flow_ordered")[0].c, 1);
  eq(DB.q("SELECT location_id FROM stock_flow_ordered")[0].location_id, 1);
  const ours = await api("GET", "/stock-flow/open?from=" + day(-30), { token });
  ok(ours.json.open.find((x) => x.id === mine).ordered_at, "our mark is still there");
  ok(!ours.json.open.some((x) => x.id === theirs), "and we do not see the sister pharmacy's line");
  // without a session: refused
  eq((await api("GET", "/stock-flow/open")).status, 401);
});
