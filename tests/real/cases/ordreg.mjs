// Orders (ordreg) vs classic Client Orders: the same order typed into both stores the same row.
// This is the case that would have caught .127 (the new screen sent contact/pick_up_date/deposit, the server reads
// client_phone/pickup_date/deposit_amount: phone, pick-up date and deposit came back empty).
import { ymd } from "../lib.mjs";
const IN = { name: "Camilleri Rita", phone: "79222333", items: "Augmentin 625 x14", needed: ymd(2), pickup: ymd(3), deposit: "5.50", priority: "1", notes: "Call after 5" };
export default {
  title: "Orders",
  async run(t) {
    const T = "client_orders_entries", p = await t.page();
    // classic
    await t.open(p, "classic", "clientorders", "clientorders", "#co-new");
    let m = t.maxId(T);
    await p.click("#co-new"); await p.waitForSelector("#co-client");
    await p.fill("#co-client", IN.name); await p.fill("#co-contact", IN.phone); await p.fill("#co-items", IN.items);
    await p.selectOption("#co-priority", IN.priority); await p.fill("#co-needed", IN.needed); await p.fill("#co-pickup", IN.pickup);
    await p.fill("#co-deposit", IN.deposit); await p.fill("#co-notes", IN.notes);
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = t.since(T, m)[0];
    // new layout
    await t.open(p, "2", "clientorders", "ordreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#ord-add");
    await p.fill("#ord-add [name=client_name]", IN.name); await p.fill("#ord-add [name=contact]", IN.phone); await p.fill("#ord-add [name=items]", IN.items);
    await p.fill("#ord-add [name=needed_by]", IN.needed); await p.fill("#ord-add [name=pick_up_date]", IN.pickup); await p.fill("#ord-add [name=deposit]", IN.deposit);
    await p.selectOption("#ord-add [name=priority]", IN.priority); await p.fill("#ord-add [name=notes]", IN.notes);
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#ord-add button[type=submit]"));
    const fresh = t.since(T, m)[0];
    t.has("orders(new)", fresh, { client_name: IN.name, client_phone: IN.phone, items_text: IN.items, needed_by: IN.needed, pickup_date: IN.pickup, priority: 1, notes: IN.notes });
    t.same("orders", classic, fresh, { order_code: "the classic makes a 6-letter pick-up code; the new screen has none (ordreg.js add)" });
  },
};
