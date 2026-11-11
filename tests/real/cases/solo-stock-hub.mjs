// Stock hub, round 2 (stock-hub): "Add all to today's order" is the row's own "Add to order", once per waiting item.
// Two identical customer orders: the first is added with its row's button (as it offers: quantity, cheapest supplier),
// the second by Add all. Same POST body, same diary row but id and clock, the same kind of link row. Every waiting
// item is then on today's order (one POST each) and nothing is left waiting. Runs alone at the end: Add all writes a
// diary line for every customer order still waiting in the shared database, and the case takes them all away again.
import { ymd } from "../lib.mjs";
const ITEM = "Ħ-Seretide 250 stockhub", SUP = "Alliance Ħ hub", DEAR = "GSK Ż hub";
export default {
  title: "Stock hub: Add all to today's order = each row's Add to order",
  async run(t) {
    const D = "order_diary_entries";
    const order = { order_date: ymd(0), client_name: "Borg Carmen stockhub", contact: "79111222", client_phone: "79111222", items: ITEM, needed_by: ymd(-2), pick_up_date: ymd(-2), priority: 2, notes: "" };
    const o1 = await t.api("POST", "/client-orders/entries", order), o2 = await t.api("POST", "/client-orders/entries", order);
    const o3 = await t.api("POST", "/client-orders/entries", { ...order, client_name: "Vella Maria stockhub", items: "Ċ-Panadol 500 stockhub" }); // a third waiting item, so Add all is offered once the first is placed
    const oid1 = o1.entry_id || o1.id, oid2 = o2.entry_id || o2.id, oid3 = o3.entry_id || o3.id;
    await t.api("POST", "/quotations/entries", { quote_date: ymd(-1), item_description: ITEM, supplier: SUP, vat_rate: 18, cost_excl_vat: 2.5, qty_purchased: 1, retail_price: 6 });
    await t.api("POST", "/quotations/entries", { quote_date: ymd(-1), item_description: ITEM, supplier: DEAR, vat_rate: 18, cost_excl_vat: 3.1, qty_purchased: 1, retail_price: 6 });
    const m0 = t.maxId(D), l0 = t.maxId("stock_flow_links");
    const p = await t.page();
    try {
      await t.open(p, "2", "stock", "stock", "[data-view=order]"); await p.click("[data-view=order]"); await p.waitForSelector("[data-sug]");
      const k1 = `order:${oid1}:0`;
      for (let i = 0; i < 10 && !(await p.$(`[data-act=sug][data-k="${k1}"]`)); i++) { const more = await p.$('[data-act=q58-more][data-key="stk:sug"]'); if (!more) break; await more.click(); await p.waitForTimeout(150); }
      // a late line is grey with only "Late" in red (SH4), and no aria-expanded is anything but true/false (SH1)
      const look = await p.evaluate((k) => { const r = document.querySelector(`[data-sug="${k}"]`); return { late: [...r.querySelectorAll(".stk-w")].map((e) => e.textContent).join("|"), bad: [...document.querySelectorAll("[aria-expanded]")].map((e) => e.getAttribute("aria-expanded")).filter((v) => v !== "true" && v !== "false") }; }, k1);
      t.ok(look.late === "Late" && !look.bad.length, "a late waiting line says Late in red and nothing else in red; aria-expanded only true/false: " + JSON.stringify(look));
      await p.click(`[data-act=sug][data-k="${k1}"]`); await p.waitForSelector("#stk-sug");
      const nRow = await t.write(p, /\/order-diary\/entries$/, () => p.click("#stk-sug button[type=submit]"));
      await p.waitForFunction(() => !document.querySelector("#stk-sug") && document.querySelector("[data-act=all]"), null, { timeout: 8000 });
      await t.idle(p);
      const waiting = await p.evaluate(() => Number((document.querySelector(".stk-h h2 b") || {}).textContent || 0));
      const sent = []; const onReq = (r) => { if (r.method() === "POST" && /\/order-diary\/entries$/.test(new URL(r.url()).pathname)) sent.push(r.postDataJSON()); };
      p.on("request", onReq);
      await p.click("[data-act=all]"); await p.waitForSelector("[data-act=all-go]");
      const asked = await p.textContent(".stk-all-box");
      await p.click("[data-act=all-go]");
      await p.waitForFunction(() => !document.querySelector(".stk-all-box") && !document.querySelector("[data-sug]"), null, { timeout: 60000 }).catch(() => {});
      await t.idle(p); p.off("request", onReq);
      const after = await p.evaluate(() => ({ left: document.querySelectorAll("[data-sug]").length, done: (document.querySelector(".stk-done") || {}).textContent || "" }));
      t.ok(/Put all \d+ on today's order/.test(asked), "Add all says what it will do before it does it: " + asked.slice(0, 120));
      t.ok(waiting > 1 && sent.length === waiting && after.left === 0 && new RegExp("^" + waiting + " items are on today's order").test(after.done), `one POST per waiting item and none left waiting: waiting ${waiting}, sent ${sent.length}, left ${after.left}, said "${after.done}"`);
      const twin = sent.filter((b) => b.item_name === ITEM);
      t.ok(twin.length === 1 && JSON.stringify(twin[0]) === JSON.stringify(nRow.body), "Add all sends the row's own body:\n row     " + JSON.stringify(nRow.body) + "\n add all " + JSON.stringify(twin));
      const rows = await t.mine(D, m0, { item_name: ITEM }, 2);
      t.ok(rows.length === 2, "two diary lines for the item: " + rows.length);
      t.same("add all", rows[0], rows[1]);
      const links = t.since("stock_flow_links", l0).filter((l) => rows.some((r) => r.id === l.diary_id));
      t.ok(links.length === 2 && links.every((l) => l.source === "order") && links.map((l) => l.source_id).sort().join() === [oid1, oid2].sort().join(), "each line is linked to its own customer's order: " + JSON.stringify(links.map((l) => [l.diary_id, l.source, l.source_id])));
    } finally {
      // leave the shared database as it was: every line and link added here, the two orders and the quotes
      t.db.prepare("DELETE FROM stock_flow_links WHERE id > ?").run(l0);
      t.db.prepare("DELETE FROM order_diary_entries WHERE id > ?").run(m0);
      t.db.prepare("DELETE FROM client_orders_entries WHERE id IN (?, ?)").run(oid1, oid2); t.db.prepare("DELETE FROM client_orders_entries WHERE id = ?").run(oid3);
      t.db.prepare("DELETE FROM quotation_entries WHERE item_description = ?").run(ITEM);
    }
  },
};
