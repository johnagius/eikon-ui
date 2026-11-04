// Stock tab, one ordering flow (d-stock), run alone at the end (it adds orders, diary lines and quotes others count): every write it makes is a classic screen's own, proven on twin rows.
//   Add to order (a customer's order) = the classic order diary's quick add: the same diary row, plus a link row.
//   Mark ordered = only new stock_flow_ordered rows; the diary rows are untouched.
//   Arrived / Not in = the classic ✓ / ✗: the same diary row and the same audit entry.
//   Order from the cheaper supplier = the classic Edit Item with only the supplier changed.
//   Ready for the customer told = the Orders screen's Ready: the same order row.
import { ymd } from "../lib.mjs";
const STAMP = ["id", "created_at", "updated_at", "entity_id"];
const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => !STAMP.includes(k)).map((k) => [k, strip(v[k])])) : v;
const ITEM = "Ħ-Ventolin Evohaler dstock", SUP = "Alliance Ħ", DEAR = "GSK Ż";
export default {
  title: "Stock: one ordering flow (to order, ordered, arrived, tell the customer)",
  async run(t) {
    const D = "order_diary_entries", CO = "client_orders_entries";
    const audit = (id, since) => t.db.prepare("SELECT * FROM audit_log WHERE id > ? AND entity_type = ? AND entity_id = ? ORDER BY id").all(since, D, String(id));
    const sameAudit = (label, a, b) => {
      if (!t.ok(a.length === 1 && b.length === 1, `${label}: one audit entry each (classic ${a.length}, new ${b.length})`)) return;
      const n = (r) => JSON.stringify({ action: r.action, user_id: r.user_id, location_id: r.location_id, details: strip(JSON.parse(r.details_json || "null")) });
      t.ok(n(a[0]) === n(b[0]), `${label}: audit differs:\n classic ${n(a[0]).slice(0, 300)}\n new     ${n(b[0]).slice(0, 300)}`);
    };
    // Two identical customer orders for the item, and two quotes: Alliance is the cheaper.
    const order = { order_date: ymd(0), client_name: "Ċassar Ġorġ dstock", contact: "79123123", client_phone: "79123123", items: ITEM, needed_by: ymd(1), pick_up_date: ymd(1), priority: 2, notes: "" };
    const o1 = (await t.api("POST", "/client-orders/entries", order)); const o2 = (await t.api("POST", "/client-orders/entries", order));
    const oid1 = o1.entry_id || o1.id, oid2 = o2.entry_id || o2.id;
    await t.api("POST", "/quotations/entries", { quote_date: ymd(-1), item_description: ITEM, supplier: SUP, vat_rate: 18, cost_excl_vat: 2.5, qty_purchased: 1, retail_price: 6 });
    await t.api("POST", "/quotations/entries", { quote_date: ymd(-1), item_description: ITEM, supplier: DEAR, vat_rate: 18, cost_excl_vat: 3.1, qty_purchased: 1, retail_price: 6 });
    const p = await t.page();
    await p.addInitScript(() => { window.__arrived = []; window.addEventListener("eikon:stock-arrived", (e) => window.__arrived.push(e.detail)); });

    // ── Add to order: the classic quick add vs the Stock tab's suggestion ──
    let m = t.maxId(D);
    await t.open(p, "classic", "order-diary", "order-diary", "#od-qa-name");
    await p.fill("#od-qa-name", ITEM); await p.fill("#od-qa-qty", "1"); await p.fill("#od-qa-sup", SUP);
    const cAdd = await t.write(p, /\/order-diary\/entries$/, () => p.click("#od-qa-add"));
    const a = t.since(D, m, { item_name: ITEM })[0];
    // the classic line is not for anyone: link nothing, so the first customer's item is still waiting in the Stock tab
    await t.open(p, "2", "stock", "stock", "[data-sug]");
    const sugSel = `[data-act=sug][data-k="order:${oid1}:0"], [data-act=sug][data-k="order:${oid2}:0"]`;
    for (let i = 0; i < 10 && !(await p.$(sugSel)); i++) { const more = await p.$('[data-act=q58-more][data-key="stk:sug"]'); if (!more) break; await more.click(); await p.waitForTimeout(150); } // a busy day: 30 at a time
    const sugs = await p.$$eval("[data-sug]", (els) => els.map((e) => e.getAttribute("data-sug")));
    t.ok(sugs.some((k) => k === `order:${oid1}:0` || k === `order:${oid2}:0`), "the customer's item waits to be put on an order: " + sugs.length + " waiting, ours " + oid1 + "/" + oid2);
    await p.locator(sugSel).first().click(); await p.waitForSelector("#stk-sug");
    t.ok(await p.inputValue("#stk-sug [name=supplier]") === SUP, "the supplier offered is the cheapest in Price check (" + await p.inputValue("#stk-sug [name=supplier]") + ")");
    m = t.maxId(D); const mLink = t.maxId("stock_flow_links");
    const nAdd = await t.write(p, /\/order-diary\/entries$/, () => p.click("#stk-sug button[type=submit]"));
    const b = (await t.mine(D, m, { item_name: ITEM }))[0];
    t.ok(JSON.stringify(nAdd.body) === JSON.stringify(cAdd.body), "the classic quick add body:\n classic " + JSON.stringify(cAdd.body) + "\n new     " + JSON.stringify(nAdd.body));
    t.same("add", a, b);
    await p.waitForFunction(() => !document.querySelector("#stk-sug"), null, { timeout: 5000 }).catch(() => {});
    const link = (await t.mine("stock_flow_links", mLink, { diary_id: b && b.id }))[0];
    t.ok(link && link.source === "order" && [oid1, oid2].includes(link.source_id) && link.location_id === 1, "a link row ties the line to the customer's order: " + JSON.stringify(link));
    const linkedOid = link && link.source_id;

    // ── Mark ordered: new rows only ──
    const before = t.db.prepare("SELECT * FROM order_diary_entries ORDER BY id").all();
    await p.waitForSelector(`[data-act=ordered][data-sup="${SUP.toLowerCase()}"]`);
    await t.write(p, /\/stock-flow\/ordered$/, () => p.click(`[data-act=ordered][data-sup="${SUP.toLowerCase()}"]`));
    t.ok(JSON.stringify(t.db.prepare("SELECT * FROM order_diary_entries ORDER BY id").all()) === JSON.stringify(before), "marking ordered changes no order diary row");
    const marks = t.db.prepare("SELECT diary_id FROM stock_flow_ordered WHERE diary_id IN (?, ?)").all(a.id, b.id).map((r) => r.diary_id).sort();
    t.ok(JSON.stringify(marks) === JSON.stringify([a.id, b.id].sort()), "both lines of the item are marked ordered (one row, two diary lines): " + JSON.stringify(marks));

    // ── Arrived: classic ✓ on a, the Stock tab's Arrived on b (the row holds both lines: first undo a's) ──
    let au = t.maxId("audit_log");
    await t.open(p, "classic", "order-diary", "order-diary", `[data-sid='${a.id}'][data-s=received]`);
    const cRecv = await t.write(p, new RegExp("/order-diary/entries/" + a.id + "$"), () => p.click(`[data-sid='${a.id}'][data-s=received]`), "PUT");
    await t.open(p, "2", "stock", "stock", "[data-view=coming]");
    await p.click("[data-view=coming]");
    await p.waitForSelector(`[data-act=arrived][data-ids="${b.id}"]`);
    const nRecv = await t.write(p, new RegExp("/order-diary/entries/" + b.id + "$"), () => p.click(`[data-act=arrived][data-ids="${b.id}"]`), "PUT");
    t.ok(JSON.stringify(cRecv.body) === JSON.stringify(nRecv.body), "Arrived sends the classic Received body: " + JSON.stringify(nRecv.body));
    t.same("arrived", t.row(D, a.id), t.row(D, b.id));
    sameAudit("arrived audit", audit(a.id, au), audit(b.id, au));
    // the customer is now to be told, and the hook heard it
    await p.waitForSelector(`.stk-tell [data-act=ready][data-oid="${linkedOid}"]`, { timeout: 8000 }).then(() => t.ok(1), () => t.fail("the customer whose item arrived is not listed to be told"));
    const ev = await p.evaluate(() => window.__arrived);
    t.ok(ev.length === 1 && ev[0].customers.some((c) => c.client_order_id === linkedOid && c.client_phone === "79123123"), "eikon:stock-arrived names the customer: " + JSON.stringify(ev).slice(0, 300));
    const said = await p.textContent(".stk-done").catch(() => "");
    t.ok(/Ċassar Ġorġ dstock is waiting for it: tell them/i.test(said), "the arrival says who is waiting: " + said);

    // ── Ready: the Orders screen's Ready on the twin order vs the Stock tab's ──
    const twin = linkedOid === oid1 ? oid2 : oid1;
    await t.open(p, "2", "clientorders", "ordreg", "#ord-q");
    await p.fill("#ord-q", "dstock"); await p.waitForSelector(`[data-act=ready][data-id="${twin}"]`); // a busy list is drawn 30 at a time: find the twin by name
    const cReady = await t.write(p, new RegExp("/client-orders/entries/" + twin + "$"), () => p.click(`[data-act=ready][data-id="${twin}"]`), "PUT");
    await t.open(p, "2", "stock", "stock", `.stk-tell [data-act=ready][data-oid="${linkedOid}"]`);
    const nReady = await t.write(p, new RegExp("/client-orders/entries/" + linkedOid + "$"), () => p.click(`.stk-tell [data-act=ready][data-oid="${linkedOid}"]`), "PUT");
    t.ok(JSON.stringify(cReady.body) === JSON.stringify(nReady.body), "Ready sends the Orders screen's body: " + JSON.stringify(nReady.body));
    t.same("ready", t.row(CO, twin), t.row(CO, linkedOid), { fulfilled_at: "the moment each was pressed" });
    await p.waitForFunction((id) => !document.querySelector(`.stk-tell [data-oid="${id}"]`), linkedOid, { timeout: 5000 }).then(() => t.ok(1), () => t.fail("the customer told stays in the list"));

    // ── Order from the cheaper supplier = the classic Edit Item, supplier only ──
    const od = { order_date: ymd(0), item_name: ITEM + " x2", qty: 2, supplier: DEAR, notes: "For Ġużeppi" };
    m = t.maxId(D); await t.api("POST", "/order-diary/entries", od); await t.api("POST", "/order-diary/entries", od);
    const [c1, c2] = t.since(D, m).map((r) => r.id);
    // Price check knows the item under the longer name too
    await t.api("POST", "/quotations/entries", { quote_date: ymd(-1), item_description: ITEM + " x2", supplier: SUP, vat_rate: 18, cost_excl_vat: 2.5, qty_purchased: 1, retail_price: 6 });
    await t.api("POST", "/quotations/entries", { quote_date: ymd(-1), item_description: ITEM + " x2", supplier: DEAR, vat_rate: 18, cost_excl_vat: 3.1, qty_purchased: 1, retail_price: 6 });
    au = t.maxId("audit_log");
    await t.open(p, "classic", "order-diary", "order-diary", `[data-eid='${c1}']`);
    await p.click(`[data-eid='${c1}']`); await p.waitForSelector("#od-e-sup"); await p.waitForTimeout(120);
    await p.fill("#od-e-name", od.item_name); await p.fill("#od-e-qty", String(od.qty)); await p.fill("#od-e-sup", SUP); await p.fill("#od-e-notes", od.notes);
    const cEd = await t.write(p, new RegExp("/order-diary/entries/" + c1 + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    await t.open(p, "2", "stock", "stock", "[data-view=order]"); await p.click("[data-view=order]");
    // c1 is now Alliance's, c2 still GSK's: c2's row offers the cheaper supplier
    await p.waitForSelector(`[data-act=move][data-id="${c2}"]`);
    const nEd = await t.write(p, new RegExp("/order-diary/entries/" + c2 + "$"), () => p.click(`[data-act=move][data-id="${c2}"]`), "PUT");
    t.ok(JSON.stringify(cEd.body) === JSON.stringify(nEd.body), "Order from the cheaper supplier sends the classic Edit Item body:\n classic " + JSON.stringify(cEd.body) + "\n new     " + JSON.stringify(nEd.body));
    t.same("move", t.row(D, c1), t.row(D, c2));
    sameAudit("move audit", audit(c1, au), audit(c2, au));

    // ── Not in = classic ✗ ──
    au = t.maxId("audit_log");
    await t.api("POST", "/stock-flow/ordered", { diary_ids: [c1, c2], supplier: SUP });
    await t.open(p, "classic", "order-diary", "order-diary", `[data-sid='${c1}'][data-s=not_received]`);
    const cNot = await t.write(p, new RegExp("/order-diary/entries/" + c1 + "$"), () => p.click(`[data-sid='${c1}'][data-s=not_received]`), "PUT");
    await t.open(p, "2", "stock", "stock", "[data-view=coming]"); await p.click("[data-view=coming]");
    await p.waitForSelector(`[data-act=notin][data-ids="${c2}"]`);
    const nNot = await t.write(p, new RegExp("/order-diary/entries/" + c2 + "$"), () => p.click(`[data-act=notin][data-ids="${c2}"]`), "PUT");
    t.ok(JSON.stringify(cNot.body) === JSON.stringify(nNot.body), "Not in sends the classic Not received body: " + JSON.stringify(nNot.body));
    t.same("not in", t.row(D, c1), t.row(D, c2));
    sameAudit("not in audit", audit(c1, au), audit(c2, au));
    await p.click("[data-view=order]");
    const back = await p.textContent(`[data-line="${c1}"], [data-line="${c2}"]`).catch(() => "");
    t.ok(/did not come/.test(back), "a line that did not come is back under To order and says so: " + back);
    // leave the shared database as the other cases expect it
    t.db.prepare("DELETE FROM client_orders_entries WHERE id IN (?, ?)").run(oid1, oid2);
    t.db.prepare("DELETE FROM order_diary_entries WHERE item_name LIKE ?").run(ITEM + "%");
    t.db.prepare("DELETE FROM quotation_entries WHERE item_description LIKE ?").run(ITEM + "%");
  },
};
